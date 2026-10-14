import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  orders,
  users,
  gigs,
  projects,
  proposals,
  messages,
  disputes,
  auditLogs,
  saveOrdersToDisk,
  saveMessagesToDisk,
  syncUserBalances,
  ensureWallet,
  getReviewWindowDays,
  isAutoAcceptEnabled,
  DEFAULT_SITE_SETTINGS,
  financeLedger,
  Order,
  Gig,
  Project,
  Message
} from '../store.js';
import {
  requireAuth,
  requireAdmin,
  requireRole,
  rateLimit,
  resolveAuthenticatedUserId,
  safeUser,
  orderParticipantSafeUser
} from '../auth.js';
import {
  canAccessOrderWorkstream,
  validateStoredWorkstreamFiles
} from '../access.js';
import { broadcastMessage } from '../websocket.js';
import { releaseOrderFunds } from './payments.js';

export const ordersRouter = Router();

export function sanitizePublicGig(g: Gig): Omit<Gig, 'moderationStatus' | 'moderationNotes'> {
  const { moderationStatus, moderationNotes, ...publicGig } = g;
  return publicGig;
}

export function sanitizePublicProject(p: Project): Omit<Project, 'moderationStatus' | 'moderationNotes'> {
  const { moderationStatus, moderationNotes, ...publicProj } = p;
  return publicProj;
}

export function isGigPublic(g: Gig): boolean {
  if (g.status !== 'published') return false;
  if (g.moderationStatus && g.moderationStatus !== 'approved') return false;
  const author = users.find(u => u.id === g.freelancerId);
  if (author && author.status !== 'active') return false;
  return true;
}

export function isProjectPublic(p: Project): boolean {
  if (p.status !== 'open' && p.status !== 'published') return false;
  if (p.moderationStatus && p.moderationStatus !== 'approved') return false;
  const author = users.find(u => u.id === p.buyerId);
  if (author && author.status !== 'active') return false;
  return true;
}

// Resolves the gig price (gig + selected extras) from server-side data. Never trusts a price sent by the browser.
export function resolveGigOrderPrice(gigId: string, extraIds: unknown): { gig: Gig; gigPrice: number; extrasTitles: string[] } {
  const gig = gigs.find(g => g.id === gigId);
  if (!gig) throw Object.assign(new Error('Gig not found.'), { status: 404 });
  if (gig.status && gig.status !== 'published') throw Object.assign(new Error('This gig is not available for ordering.'), { status: 400 });
  const ids = Array.isArray(extraIds) ? Array.from(new Set(extraIds.map(String))) : [];
  let cents = Math.round(Number(gig.price) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw Object.assign(new Error('This gig has no valid price.'), { status: 400 });
  const extrasTitles: string[] = [];
  for (const id of ids) {
    const extra = (gig.extras || []).find(e => e.id === id);
    if (!extra) throw Object.assign(new Error(`Unknown add-on "${id}" for this gig.`), { status: 400 });
    cents += Math.round(Number(extra.price) * 100);
    extrasTitles.push(extra.title);
  }
  return { gig, gigPrice: cents / 100, extrasTitles };
}

export function enrichOrderWithServiceInfo(o: Order, isAdmin: boolean = false) {
  const gig = (o.gigId ? gigs.find(g => g.id === o.gigId) : undefined) ||
              gigs.find(g => g.freelancerId === o.sellerId) ||
              gigs.find(g => g.title.toLowerCase() === o.title.toLowerCase());
  const project = (o.projectId ? projects.find(p => p.id === o.projectId) : undefined) ||
                  projects.find(p => p.title.toLowerCase() === o.title.toLowerCase());
  const seller = users.find(u => u.id === o.sellerId);
  const buyer = users.find(u => u.id === o.buyerId);
  const sellerUsername = o.sellerUsername || gig?.freelancerUsername || (seller?.username || seller?.name || '').toLowerCase().replace(/\s+/g, '_');
  const buyerUsername = o.buyerUsername || (buyer?.username || buyer?.name || '').toLowerCase().replace(/\s+/g, '_');
  const gigSlug = o.gigSlug || gig?.slug;
  const serviceUrl = o.serviceUrl || (gig && gigSlug ? `/${sellerUsername}/${gigSlug}` : project ? `/project/${project.slug}` : undefined);
  const serviceTitle = gig?.title || project?.title || o.serviceTitle || o.title;
  const serviceThumbnail = o.serviceThumbnail || gig?.image || 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=500&fit=crop';

  const orderMessages = messages.filter(m => m.orderId === o.id);
  const lastMsg = orderMessages.length > 0 
    ? [...orderMessages].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] 
    : undefined;

  const reviewWindowDays = getReviewWindowDays();
  const reviewWindowEnabled = isAutoAcceptEnabled();
  let reviewWindowExpiresAt: string | undefined;
  if (o.status === 'delivered' && Array.isArray(o.deliveryHistory) && o.deliveryHistory.length > 0) {
    const lastDelivery = o.deliveryHistory[o.deliveryHistory.length - 1];
    if (lastDelivery?.deliveredAt) {
      const deliveredTime = new Date(lastDelivery.deliveredAt).getTime();
      if (!isNaN(deliveredTime)) {
        reviewWindowExpiresAt = new Date(deliveredTime + reviewWindowDays * 24 * 60 * 60 * 1000).toISOString();
      }
    }
  }

  const base = {
    ...o,
    gigId: o.gigId || gig?.id,
    projectId: o.projectId || project?.id,
    serviceUrl,
    serviceTitle,
    serviceThumbnail,
    sellerUsername,
    buyerUsername,
    lastMessage: lastMsg?.text,
    lastMessageTime: lastMsg?.timestamp,
    reviewWindowDays,
    reviewWindowEnabled,
    reviewWindowExpiresAt,
    acceptedVersion: o.acceptedVersion
  };

  if (!isAdmin) {
    const { adminNotes, isMuted, ...sanitized } = base;
    return sanitized;
  }
  return base;
}

// Buyer Review Window & Auto-Accept Engine
export function processAutoAcceptOrders(customNow?: number): Array<{
  orderId: string;
  acceptedVersion: number;
  amount: number;
  freelancerNet: number;
}> {
  if (!isAutoAcceptEnabled()) {
    return [];
  }

  const days = getReviewWindowDays();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const now = typeof customNow === 'number' ? customNow : Date.now();
  const processed: Array<{ orderId: string; acceptedVersion: number; amount: number; freelancerNet: number }> = [];

  for (const order of orders) {
    if (order.status !== 'delivered') continue;
    if (!Array.isArray(order.deliveryHistory) || order.deliveryHistory.length === 0) continue;

    const latestDelivery = order.deliveryHistory[order.deliveryHistory.length - 1];
    if (!latestDelivery || !latestDelivery.deliveredAt) continue;

    const deliveredAt = new Date(latestDelivery.deliveredAt).getTime();
    if (isNaN(deliveredAt)) continue;

    if (now - deliveredAt < windowMs) continue;

    if (Array.isArray(order.revisions)) {
      const hasRevisionOnVersion = order.revisions.some(
        r => r.deliveryVersion === latestDelivery.version || r.status === 'requested'
      );
      if (hasRevisionOnVersion) continue;
    }

    if (order.status === 'disputed') continue;
    const hasDispute = disputes.some(
      d => d.orderId === order.id && (d.status === 'open' || d.status === 'under_investigation')
    );
    if (hasDispute) continue;

    const esc = financeLedger.getEscrow(order.id);
    if (!esc || esc.remaining <= 0 || esc.status === 'released' || esc.status === 'refunded') {
      continue;
    }

    const requestKey = `auto_accept_${order.id}_v${latestDelivery.version}`;

    try {
      console.log(`[ReviewWindow] Auto-accepting order ${order.id} (delivery v${latestDelivery.version}) after ${days} days.`);
      const result = releaseOrderFunds(order, 'System Auto-Accept', `Auto-accept after buyer review window (${days} days) elapsed`, requestKey);

      order.acceptedVersion = latestDelivery.version;
      saveOrdersToDisk();

      const sysMsg: Message = {
        id: 'msg_' + now + '_' + Math.random().toString(36).slice(2, 6),
        orderId: order.id,
        senderId: 'system',
        senderName: 'WorkSphere Review Desk',
        text: `🎉 Order #${order.id} automatically accepted: Buyer review window (${days} days) closed without revisions or dispute. Escrow funds released to seller.`,
        timestamp: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'system',
        metadata: {
          action: 'order_auto_accepted',
          acceptedVersion: latestDelivery.version,
          reviewWindowDays: days
        }
      };
      messages.push(sysMsg);
      saveMessagesToDisk();
      broadcastMessage(sysMsg, order.id);

      auditLogs.unshift({
        id: 'log_' + now + '_' + Math.random().toString(36).slice(2, 6),
        actor: 'System Auto-Accept',
        role: 'super_admin',
        action: 'ORDER_AUTO_ACCEPTED',
        target: `Order #${order.id}`,
        details: `Order auto-accepted after ${days} days in delivered status without revision or dispute. Deliverable v${latestDelivery.version} approved. Escrow of $${order.amount} released (net payout $${result.freelancerNet}).`,
        timestamp: new Date(now).toLocaleString()
      });

      processed.push({
        orderId: order.id,
        acceptedVersion: latestDelivery.version,
        amount: order.amount,
        freelancerNet: result.freelancerNet
      });
    } catch (err: any) {
      console.error(`[ReviewWindow] Failed to auto-accept order ${order.id}:`, err);
    }
  }

  return processed;
}

setInterval(() => {
  try {
    processAutoAcceptOrders();
  } catch (err) {
    console.error('[ReviewWindow] Auto-accept job error:', err);
  }
}, 60 * 1000).unref?.();

// Routes
ordersRouter.get('/api/fees/quote', (req, res) => {
  try {
    let gigPrice: number;
    if (typeof req.query.gigId === 'string' && req.query.gigId) {
      const extraIds = typeof req.query.extraIds === 'string' && req.query.extraIds ? req.query.extraIds.split(',') : [];
      gigPrice = resolveGigOrderPrice(req.query.gigId, extraIds).gigPrice;
    } else {
      gigPrice = Number(req.query.amount);
    }
    if (!Number.isFinite(gigPrice) || gigPrice < 0) return res.status(400).json({ error: 'A valid gigId or amount is required.' });
    const q = financeLedger.quoteOrder(gigPrice);
    res.json({ ...q, config: financeLedger.getFeeConfig() });
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

ordersRouter.get('/api/gigs', (req, res) => {
  const publicGigs = gigs.filter(isGigPublic).map(sanitizePublicGig);
  res.json(publicGigs);
});

ordersRouter.get('/api/projects', (req, res) => {
  const publicProjects = projects.filter(isProjectPublic).map(sanitizePublicProject);
  res.json(publicProjects);
});

ordersRouter.get('/api/gigs/:id', (req, res) => {
  const gig = gigs.find(g => g.id === req.params.id);
  if (!gig) return res.status(404).json({ error: 'Gig not found' });
  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  const isOwner = authUserId && gig.freelancerId === authUserId;

  if (isGigPublic(gig)) {
    if (isAdmin || isOwner) return res.json(gig);
    return res.json(sanitizePublicGig(gig));
  }
  if (isAdmin || isOwner) return res.json(gig);
  return res.status(404).json({ error: 'Gig not found or unavailable' });
});

ordersRouter.get('/api/projects/:id', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  const isOwner = authUserId && project.buyerId === authUserId;

  if (isProjectPublic(project)) {
    if (isAdmin || isOwner) return res.json(project);
    return res.json(sanitizePublicProject(project));
  }
  if (isAdmin || isOwner) return res.json(project);
  return res.status(404).json({ error: 'Project not found or unavailable' });
});

ordersRouter.get('/api/my/gigs', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const myGigs = gigs.filter(g => g.freelancerId === authUserId);
  res.json(myGigs);
});

ordersRouter.get('/api/my/projects', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const myProjects = projects.filter(p => p.buyerId === authUserId);
  res.json(myProjects);
});

ordersRouter.get('/api/proposals', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) return res.json(proposals);
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userProposals = proposals.filter(p => isAdmin || p.freelancerId === authUserId);
  res.json(userProposals);
});

ordersRouter.get('/api/orders', (req, res) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.json(orders.map(o => enrichOrderWithServiceInfo(o, true)));
  }
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userOrders = orders.filter(o => isAdmin || o.buyerId === authUserId || o.sellerId === authUserId);
  res.json(userOrders.map(o => enrichOrderWithServiceInfo(o, isAdmin)));
});

ordersRouter.get('/api/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const authUserId = resolveAuthenticatedUserId(req);
  const caller = authUserId ? users.find(u => u.id === authUserId) : null;
  const isAdmin = !authUserId || caller?.role === 'admin' || caller?.role === 'super_admin';
  if (authUserId && !isAdmin && order.buyerId !== authUserId && order.sellerId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Access to this order is restricted to participants.' });
  }
  const enriched = enrichOrderWithServiceInfo(order, isAdmin);
  const buyer = users.find(u => u.id === order.buyerId);
  const seller = users.find(u => u.id === order.sellerId);
  const orderMessages = messages.filter(m => m.orderId === order.id);
  const dispute = disputes.find(d => d.orderId === order.id);

  res.json({
    ...enriched,
    buyer: buyer ? (isAdmin ? safeUser(buyer) : orderParticipantSafeUser(buyer)) : null,
    seller: seller ? (isAdmin ? safeUser(seller) : orderParticipantSafeUser(seller)) : null,
    messages: orderMessages,
    dispute
  });
});

// POST /api/orders
ordersRouter.post('/api/orders', requireAuth, rateLimit(30, 60_000), (req, res) => {
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = (req as any).authenticatedUser || users.find(u => u.id === authUserId);
    if (!caller || caller.status !== 'active') return res.status(403).json({ error: 'Account is not active' });

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (title.length < 3) return res.status(400).json({ error: 'A valid order title is required.' });
    const buyerId = caller.id;
    const sellerId = String(req.body?.sellerId || '');
    const buyer = caller;
    const seller = users.find(u => u.id === sellerId);
    if (!seller) return res.status(404).json({ error: 'Seller not found.' });
    if (buyerId === sellerId) return res.status(400).json({ error: 'You cannot order from yourself.' });
    ensureWallet(buyerId); ensureWallet(sellerId);
    if (buyer.status !== 'active' || seller.status !== 'active') return res.status(403).json({ error: 'Both accounts must be active to place an order.' });

    const id = 'ord_' + randomUUID().slice(0, 12);
    const today = new Date().toISOString().split('T')[0];
    let rawAmount = Number(req.body?.amount);
    const isInquiry = rawAmount === 0 && /^inquiry:/i.test(title);
    if (!isInquiry && req.body?.gigId) {
      const priced = resolveGigOrderPrice(String(req.body.gigId), req.body?.extraIds);
      if (priced.gig.freelancerId !== sellerId) return res.status(400).json({ error: 'This gig does not belong to the selected seller.' });
      rawAmount = priced.gigPrice;
    }

    let newOrd: Order;
    if (isInquiry) {
      newOrd = { id, title, buyerId, sellerId, amount: 0, status: 'in_progress', createdAt: today, dueDate: req.body.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0], gigId: req.body.gigId, projectId: req.body.projectId };
    } else {
      financeLedger.fundEscrow({ orderId: id, orderTitle: title, amount: rawAmount, buyerId, sellerId, actor: `user:${buyerId}` });
      newOrd = {
        id, title, buyerId, sellerId, amount: rawAmount, status: 'funded_in_escrow', createdAt: today,
        dueDate: req.body.dueDate || new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
        escrowProtectionStartDate: today,
        escrowProtectionEndDate: new Date(Date.now() + DEFAULT_SITE_SETTINGS.commission.escrowProtectionDays * 86400000).toISOString().split('T')[0],
        gigId: req.body.gigId, projectId: req.body.projectId,
        feeBreakdown: financeLedger.quoteOrder(rawAmount)
      };
      syncUserBalances();
    }
    const enriched = enrichOrderWithServiceInfo(newOrd);
    orders.unshift(enriched);
    saveOrdersToDisk();
    res.status(201).json(enriched);
  } catch (err: any) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Deliverables submission (both routes)
const handleDeliverSubmission = (req: any, res: any) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  if (!isAdmin && order.sellerId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Only the seller or an administrator can submit deliverables.' });
  }

  const allowedStatuses = ['funded_in_escrow', 'in_progress', 'revision'];
  if (!allowedStatuses.includes(order.status)) {
    return res.status(409).json({ error: `Cannot submit a deliverable for an order in "${order.status}" status.` });
  }

  if (!order.deliverableFiles) order.deliverableFiles = [];
  if (!order.deliveryHistory) order.deliveryHistory = [];

  const rawFiles = Array.isArray(req.body.files) && req.body.files.length > 0 
    ? req.body.files 
    : (req.body.name ? [{ name: req.body.name, size: req.body.size, url: req.body.url }] : []);
  if (rawFiles.length === 0) {
    return res.status(400).json({ error: 'At least one uploaded deliverable file is required.' });
  }
  const validation = validateStoredWorkstreamFiles(rawFiles, caller);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const uploadedFiles = validation.files.map((f: any, idx: number) => ({
    id: 'deliv_' + Date.now() + '_' + idx,
    name: f.name,
    size: f.size,
    url: f.url,
    uploadedAt: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
    type: 'deliverable'
  }));

  order.deliverableFiles.push(...uploadedFiles);
  order.status = 'delivered';
  order.deliveryNotes = req.body.notes || '';

  const version = order.deliveryHistory.length + 1;
  order.deliveryHistory.push({
    version,
    notes: req.body.notes || '',
    files: uploadedFiles,
    deliveredAt: new Date().toISOString()
  });

  const fileSummary = uploadedFiles.map((f: any) => `"${f.name}" (${f.size})`).join(', ');
  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'WorkSphere Deliveries',
    text: `📦 Deliverable (v${version}) submitted: ${fileSummary}${req.body.notes ? ` — "${req.body.notes}"` : ''}. Buyer review window initiated.`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'system',
    metadata: {
      action: 'deliverable_submitted',
      version,
      notes: req.body.notes
    }
  };
  messages.push(sysMsg);
  saveMessagesToDisk();
  saveOrdersToDisk();
  broadcastMessage(sysMsg, order.id);

  res.json({ success: true, files: uploadedFiles, file: uploadedFiles[0], order: enrichOrderWithServiceInfo(order) });
};

ordersRouter.post('/api/orders/:id/deliver', requireAuth, handleDeliverSubmission);
ordersRouter.post('/api/orders/:id/deliverable', requireAuth, handleDeliverSubmission);

// POST /api/orders/:id/revision
ordersRouter.post('/api/orders/:id/revision', requireAuth, (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  if (!isAdmin && order.buyerId !== authUserId) {
    return res.status(403).json({ error: 'Forbidden: Only the order buyer or an administrator can request revisions.' });
  }

  if (order.status !== 'delivered') {
    return res.status(409).json({ error: `Cannot request revisions for an order in "${order.status}" status (order must be delivered first).` });
  }

  const reason = (req.body.reason || '').trim();
  if (!reason) {
    return res.status(400).json({ error: 'A revision reason is required.' });
  }
  if (!order.revisions) order.revisions = [];
  const revisionEntry = {
    id: 'rev_' + Date.now(),
    requestedAt: new Date().toISOString(),
    reason,
    status: 'requested',
    deliveryVersion: order.deliveryHistory?.length || 1
  };
  order.revisions.push(revisionEntry);
  order.status = 'revision';

  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'WorkSphere Revision Desk',
    text: `🔄 Revision requested on delivery v${revisionEntry.deliveryVersion}: "${reason}"`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'system',
    metadata: {
      action: 'revision_requested',
      reason,
      revisionId: revisionEntry.id,
      deliveryVersion: revisionEntry.deliveryVersion
    }
  };
  messages.push(sysMsg);
  saveMessagesToDisk();
  saveOrdersToDisk();
  broadcastMessage(sysMsg, order.id);

  res.json({ success: true, revision: revisionEntry, order: enrichOrderWithServiceInfo(order) });
});

ordersRouter.patch('/api/orders/:id/extend-time', requireAdmin, (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const { days, newDueDate, reason } = req.body;
  const oldDate = order.dueDate;
  let targetDate = newDueDate;

  if (days && Number(days) > 0) {
    const current = new Date(order.dueDate || Date.now());
    current.setDate(current.getDate() + Number(days));
    targetDate = current.toISOString().split('T')[0];
  } else if (!targetDate) {
    targetDate = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
  }

  order.dueDate = targetDate;

  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'System / Admin Notice',
    text: `⏱️ Deadline extended from ${oldDate} to ${order.dueDate}. ${reason ? 'Reason: ' + reason : 'Admin approved time extension.'}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  messages.push(sysMsg);

  auditLogs.unshift({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: 'ORDER_DEADLINE_EXTENDED',
    target: `Order #${order.id}`,
    details: `Extended deadline to ${order.dueDate} (${days || 'custom'} days). ${reason || ''}`,
    timestamp: new Date().toLocaleString()
  });

  res.json({ success: true, order: enrichOrderWithServiceInfo(order), message: sysMsg });
});

ordersRouter.post('/api/orders/:id/admin-notes', requireAdmin, (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.adminNotes = req.body.notes || '';
  res.json({ success: true, adminNotes: order.adminNotes });
});

ordersRouter.patch('/api/orders/:id/mute', requireRole(['admin', 'super_admin', 'support']), (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.isMuted = !order.isMuted;
  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'Administration Alert',
    text: order.isMuted 
      ? `🔒 Chat paused by Administrator during case review. Neither party may send messages.`
      : `🔓 Chat unlocked by Administrator. Standard messaging resumed.`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  messages.push(sysMsg);
  res.json({ success: true, isMuted: order.isMuted });
});

ordersRouter.patch('/api/orders/:id/pause-timer', requireRole(['admin', 'super_admin', 'support']), (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.isTimerPaused = !order.isTimerPaused;
  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'Administration Alert',
    text: order.isTimerPaused 
      ? `⏸️ Delivery countdown paused by Administrator pending dispute/clarification.`
      : `▶️ Delivery countdown resumed by Administrator. Normal timer active.`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  messages.push(sysMsg);

  auditLogs.unshift({
    id: 'log_' + Date.now(),
    actor: 'Admin Chief',
    role: 'super_admin',
    action: order.isTimerPaused ? 'ORDER_TIMER_PAUSED' : 'ORDER_TIMER_RESUMED',
    target: `Order #${order.id}`,
    details: order.isTimerPaused ? 'Timer paused by Admin' : 'Timer resumed by Admin',
    timestamp: new Date().toLocaleString()
  });
  res.json({ success: true, isTimerPaused: order.isTimerPaused });
});

ordersRouter.post('/api/admin/orders/check-auto-accept', requireAdmin, (req, res) => {
  try {
    const processed = processAutoAcceptOrders();
    res.json({ success: true, processedCount: processed.length, processed });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Auto-accept check failed' });
  }
});

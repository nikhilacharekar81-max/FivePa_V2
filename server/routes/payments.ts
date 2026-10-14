import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  orders,
  users,
  messages,
  disputes,
  refunds,
  payouts,
  auditLogs,
  requestKeyCache,
  releaseCompletedOrders,
  saveOrdersToDisk,
  saveMessagesToDisk,
  syncUserBalances,
  ensureWallet,
  DEFAULT_SITE_SETTINGS,
  financeLedger,
  Order,
  Payout,
  Message
} from '../store.js';
import {
  requireAuth,
  rateLimit,
  adminActor,
  resolveAuthenticatedUserId,
  withdrawalVerificationCodes,
  IS_PRODUCTION
} from '../auth.js';
import { assertOrderOpen } from '../access.js';
import { broadcastMessage } from '../websocket.js';

export const paymentsRouter = Router();

export const refundCompletedOrders = new Set<string>();

export function areSimulatedDepositsAllowed(): boolean {
  if (IS_PRODUCTION) {
    return false;
  }
  return true;
}

export function releaseOrderFunds(order: Order, actor: string, reason: string, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  if (order.status === 'completed') {
    const replayed = financeLedger.replay<{ journal: any; freelancerNet: number; platformFee: number }>(requestKey);
    if (replayed) {
      if (requestKey) requestKeyCache.set(requestKey, replayed);
      return replayed;
    }
    throw new Error('Order is already completed; funds were already released.');
  }
  assertOrderOpen(order);
  const result = financeLedger.releaseEscrow({ orderId: order.id, actor, reason, requestKey });
  order.status = 'completed';
  if (!order.completedAt) {
    order.completedAt = new Date().toISOString();
  }
  if (Array.isArray(order.deliveryHistory) && order.deliveryHistory.length > 0) {
    order.acceptedVersion = order.deliveryHistory[order.deliveryHistory.length - 1].version;
  }
  const seller = users.find(u => u.id === order.sellerId);
  if (seller && !releaseCompletedOrders.has(order.id)) {
    releaseCompletedOrders.add(order.id);
    seller.earned = (seller.earned || 0) + result.freelancerNet;
    seller.completedJobs = (seller.completedJobs || 0) + 1;
  }
  syncUserBalances();
  saveOrdersToDisk();
  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}

export function refundOrderFunds(order: Order, amount: number | undefined, actor: string, reason: string, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  if (order.status === 'cancelled') {
    const replayed = financeLedger.replay<{ journal: any; buyerWallet: any; refunded: number; remaining: number }>(requestKey);
    if (replayed) {
      if (requestKey) requestKeyCache.set(requestKey, replayed);
      return replayed;
    }
    throw new Error('Order is already cancelled; funds were already handled.');
  }
  assertOrderOpen(order);
  const result = financeLedger.refundEscrow({ orderId: order.id, amount, reason, actor, requestKey });
  if (result.remaining === 0) {
    order.status = 'cancelled';
    refundCompletedOrders.add(order.id);
  }
  const existingRecord = refunds.find(r => r.orderId === order.id && (r.status === 'pending' || r.amount === result.refunded));
  if (existingRecord) {
    existingRecord.status = 'approved';
    existingRecord.amount = result.refunded;
  } else {
    refunds.push({
      id: 'ref_' + randomUUID().slice(0, 12),
      orderId: order.id,
      buyerId: order.buyerId,
      amount: result.refunded,
      reason,
      status: 'approved',
      createdAt: new Date().toISOString().substring(0, 10)
    });
  }
  syncUserBalances();
  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}

export function splitOrderFunds(order: Order, refundAmount: number, actor: string, reason: string, requestKey?: string) {
  if (requestKey && requestKeyCache.has(requestKey)) {
    return requestKeyCache.get(requestKey);
  }
  assertOrderOpen(order);
  const result = financeLedger.resolveEscrowSplit({ orderId: order.id, refundAmount, reason, actor });
  order.status = 'completed';
  const seller = users.find(u => u.id === order.sellerId);
  if (seller && !releaseCompletedOrders.has(order.id)) {
    releaseCompletedOrders.add(order.id);
    seller.earned = (seller.earned || 0) + result.release.freelancerNet;
    seller.completedJobs = (seller.completedJobs || 0) + 1;
  }
  const existingRecord = refunds.find(r => r.orderId === order.id && (r.status === 'pending' || r.amount === refundAmount));
  if (existingRecord) {
    existingRecord.status = 'approved';
    existingRecord.amount = refundAmount;
  } else {
    refunds.push({
      id: 'ref_' + randomUUID().slice(0, 12),
      orderId: order.id,
      buyerId: order.buyerId,
      amount: refundAmount,
      reason,
      status: 'approved',
      createdAt: new Date().toISOString().substring(0, 10)
    });
  }
  syncUserBalances();
  saveOrdersToDisk();
  if (requestKey) requestKeyCache.set(requestKey, result);
  return result;
}

const ALLOWED_METHODS: Record<string, keyof typeof DEFAULT_SITE_SETTINGS.wallets.allowedPayoutMethods> = {
  'UPI': 'upi', 'Bank Transfer': 'bankTransfer', 'Stripe': 'stripeConnect', 'Razorpay': 'razorpayX', 'PayPal': 'paypal'
};

export function handlePayoutRequest(req: Request, res: Response) {
  try {
    const freelancerId = resolveAuthenticatedUserId(req);
    if (!freelancerId) {
      return res.status(401).json({ error: 'Authentication required to request a payout.' });
    }
    const user = users.find(u => u.id === freelancerId) || users[0];
    ensureWallet(freelancerId);

    const rawMethod = String(req.body?.method || 'Bank Transfer');
    const settingKey = ALLOWED_METHODS[rawMethod];
    if (!settingKey || !DEFAULT_SITE_SETTINGS.wallets.allowedPayoutMethods[settingKey]) {
      return res.status(400).json({ error: `Unsupported payout method "${rawMethod}".` });
    }

    const numAmount = Number(req.body?.amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid withdrawal amount greater than $0.00' });
    }

    const currentBal = financeLedger.getWalletBalance(freelancerId) ?? user.walletBalance;
    if (currentBal < numAmount) {
      return res.status(400).json({ error: `Insufficient available funds. Available: $${currentBal.toFixed(2)}, Requested: $${numAmount.toFixed(2)}` });
    }

    const id = 'pay_' + randomUUID().slice(0, 8);
    const accountDetails = String(req.body?.accountDetails || 'Primary Bank Account');
    const { payout } = financeLedger.requestPayout({
      payoutId: id,
      freelancerId,
      amount: numAmount,
      method: rawMethod,
      accountDetails,
      actor: `user:${freelancerId}`
    });

    const record: Payout = {
      id,
      freelancerId,
      amount: payout.amount,
      method: rawMethod as Payout['method'],
      status: 'pending',
      createdAt: new Date().toISOString().substring(0, 10),
      accountDetails: payout.accountDetails
    };
    payouts.unshift(record);
    syncUserBalances();

    auditLogs.unshift({
      id: 'log_' + Date.now(),
      actor: user.name,
      role: user.role,
      action: 'PAYOUT_REQUESTED',
      target: `Payout #${record.id}`,
      details: `User requested withdrawal of $${numAmount.toFixed(2)} via ${record.method}`,
      timestamp: new Date().toLocaleString()
    });

    const newBalance = financeLedger.getWalletBalance(freelancerId) ?? user.walletBalance;
    const transaction = financeLedger.getTransactions().find(t => t.relatedPayoutId === id);

    res.status(201).json({
      success: true,
      newBalance,
      payout: record,
      transaction,
      ...record
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

// Routes
paymentsRouter.get('/api/disputes', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userDisputes = disputes.filter(d => {
    if (isAdmin) return true;
    const order = orders.find(o => o.id === d.orderId);
    return order && (order.buyerId === authUserId || order.sellerId === authUserId);
  });
  res.json(userDisputes);
});

paymentsRouter.get('/api/refunds', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userRefunds = refunds.filter(r => {
    if (isAdmin) return true;
    if (r.buyerId === authUserId) return true;
    const order = orders.find(o => o.id === r.orderId);
    return order && (order.buyerId === authUserId || order.sellerId === authUserId);
  });
  res.json(userRefunds);
});

paymentsRouter.get('/api/payouts', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin' || caller?.role === 'support';
  const userPayouts = payouts.filter(p => {
    if (isAdmin) return true;
    return p.freelancerId === authUserId;
  });
  res.json(userPayouts);
});

paymentsRouter.post('/api/payments/deposit', requireAuth, rateLimit(10, 60_000), (req, res) => {
  try {
    if (!areSimulatedDepositsAllowed()) {
      return res.status(501).json({ error: 'Deposits require a connected payment gateway in production.' });
    }

    const authUserId = (req as any).authenticatedUserId;
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    const caller = users.find(u => u.id === authUserId);
    if (!caller) {
      return res.status(401).json({ error: 'Authenticated user not found' });
    }

    const requestedUserId = req.body?.userId;
    const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
    if (requestedUserId && requestedUserId !== authUserId) {
      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: You cannot deposit funds into another user wallet.' });
      }
    }
    const targetUserId = (isAdmin && requestedUserId) ? requestedUserId : authUserId;
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid deposit amount greater than $0.00' });
    }
    if (amount > 5000) {
      return res.status(400).json({ error: 'Simulated deposits are limited to $5,000.' });
    }

    ensureWallet(targetUserId);
    const key = String(req.body?.idempotencyKey || req.body?.providerReference || randomUUID());
    const result = financeLedger.creditDeposit({
      userId: targetUserId,
      amount,
      reference: `SIM-${key}`,
      idempotencyKey: `SIM-${targetUserId}-${key}`,
      actor: `${caller.name} (Simulated)`,
      source: 'simulated'
    });
    syncUserBalances();
    const newBalance = financeLedger.getWalletBalance(targetUserId) ?? caller.walletBalance;
    const transaction = financeLedger.getTransactions().find(t => t.journalId === result.journal.id);

    auditLogs.unshift({
      id: 'log_' + Date.now(),
      actor: caller.name,
      role: caller.role,
      action: 'FUNDS_DEPOSITED',
      target: `User ${caller.name}`,
      details: `Deposited $${amount.toFixed(2)} (simulated). New Balance: $${newBalance.toFixed(2)}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, newBalance, transaction });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

paymentsRouter.post('/api/payments/withdraw', requireAuth, rateLimit(10, 60_000), handlePayoutRequest);

paymentsRouter.post('/api/orders/:id/release', requireAuth, (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const userId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === userId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  if (!isAdmin && userId !== order.buyerId) {
    return res.status(403).json({ error: 'Only the buyer or admin can release order funds' });
  }
  if (order.status !== 'delivered') {
    return res.status(400).json({ error: 'Cannot release escrow before deliverables have been submitted by the seller.' });
  }
  try {
    const actor = isAdmin ? adminActor(req) : (caller?.name || 'Buyer');
    const result = releaseOrderFunds(order, actor, 'Buyer approved deliverable');
    res.json({ success: true, order, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

paymentsRouter.post('/api/orders/:id/refund', requireAuth, (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const userId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === userId);
  const isAdmin = caller?.role === 'admin' || caller?.role === 'super_admin';
  if (!isAdmin && userId !== order.sellerId) {
    return res.status(403).json({ error: 'Only the seller or admin can refund order funds' });
  }
  try {
    const actor = isAdmin ? adminActor(req) : (caller?.name || 'Seller');
    const result = refundOrderFunds(order, undefined, actor, req.body.reason || 'Order refunded');
    res.json({ success: true, order, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

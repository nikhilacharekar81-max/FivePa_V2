import { Router } from 'express';
import { orders, users, messages, saveMessagesToDisk } from '../store.js';
import { requireAuth, rateLimit } from '../auth.js';
import { canAccessOrderWorkstream, validateMessageFileInfo } from '../access.js';
import { broadcastMessage, sanitizeAndCreateMessage } from '../websocket.js';

export const messagesRouter = Router();

// GET /api/messages/:orderId
messagesRouter.get('/api/messages/:orderId', requireAuth, (req, res) => {
  const order = orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!canAccessOrderWorkstream((req as any).authenticatedUser, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  const filtered = messages.filter(m => m.orderId === req.params.orderId);
  res.json(filtered);
});

// POST /api/messages
messagesRouter.post('/api/messages', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'User not found' });
  const orderId = req.body.orderId;
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });

  let order = orders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!canAccessOrderWorkstream(caller, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  const fileCheck = validateMessageFileInfo(req.body.fileInfo, caller);
  if (!fileCheck.ok) return res.status(400).json({ error: fileCheck.error });

  const clientMessageId = typeof req.body.clientMessageId === 'string' ? req.body.clientMessageId : undefined;
  if (clientMessageId) {
    const existing = messages.find(m => m.orderId === orderId && m.metadata?.clientMessageId === clientMessageId);
    if (existing) return res.json({ success: true, message: existing, deduplicated: true });
  }

  const newMsg = sanitizeAndCreateMessage(caller, order, req.body, fileCheck);

  messages.push(newMsg);
  saveMessagesToDisk();
  broadcastMessage(newMsg, order.id);
  res.json(newMsg);
});

// POST /api/orders/:id/message
messagesRouter.post('/api/orders/:id/message', requireAuth, rateLimit(10, 60_000), (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const userId = (req as any).authenticatedUserId;
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (!canAccessOrderWorkstream(user, order)) {
    return res.status(403).json({ error: 'Forbidden: You are not a participant of this Workstream.' });
  }
  const fileCheck = validateMessageFileInfo(req.body.fileInfo, user);
  if (!fileCheck.ok) return res.status(400).json({ error: fileCheck.error });

  const clientMessageId = typeof req.body.clientMessageId === 'string' ? req.body.clientMessageId : undefined;
  if (clientMessageId) {
    const existing = messages.find(m => m.orderId === order.id && m.metadata?.clientMessageId === clientMessageId);
    if (existing) return res.json({ success: true, message: existing, deduplicated: true });
  }

  const newMsg = sanitizeAndCreateMessage(user, order, req.body, fileCheck);

  messages.push(newMsg);
  saveMessagesToDisk();
  broadcastMessage(newMsg, order.id);

  res.json({ success: true, message: newMsg });
});

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { orders, users, messages, saveMessagesToDisk, Message } from './store.js';
import { verifyToken } from './auth.js';
import { canAccessOrderWorkstream, validateMessageFileInfo } from './access.js';

export const clients = new Set<WebSocket>();
export let wss: WebSocketServer | null = null;

export function broadcastMessage(message: Message, orderId: string) {
  const payload = JSON.stringify({ type: 'MESSAGE_RECEIVED', message });
  const updatePayload = JSON.stringify({ 
    type: 'WORKSTREAM_UPDATED', 
    orderId, 
    lastMessage: message.text, 
    lastMessageTime: message.timestamp 
  });

  const order = orders.find(o => o.id === orderId);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      const clientUserId = (client as any).authenticatedUserId;
      if (!clientUserId) continue; // never broadcast to unauthenticated sockets
      const clientUser = users.find(u => u.id === clientUserId);
      const isAuthorized = !!order && canAccessOrderWorkstream(clientUser, order);
      
      if (isAuthorized) {
        client.send(payload);
        client.send(updatePayload);
      }
    }
  }
}

export function sanitizeAndCreateMessage(
  sender: any,
  order: any,
  body: any,
  fileCheck: { ok: boolean; fileInfo?: any; error?: string }
): Message {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const isSystemOrStaff = sender?.role === 'admin' || sender?.role === 'super_admin' || sender?.role === 'support';
  
  let type = body.type;
  if (!isSystemOrStaff && (type === 'system' || type === 'deliverable')) {
    type = 'message';
  }
  if (type !== 'message' && type !== 'file') {
    type = 'message';
  }
  if (type !== 'file' && !text) {
    throw new Error('Message text is required.');
  }
  if (text.length > 5000) {
    throw new Error('Message is too long.');
  }

  const metadata: any = {};
  if (body.metadata && typeof body.metadata === 'object') {
    Object.assign(metadata, body.metadata);
  }
  if (body.clientMessageId) {
    metadata.clientMessageId = String(body.clientMessageId);
  }
  if (body.metadata?.clientMessageId) {
    metadata.clientMessageId = String(body.metadata.clientMessageId);
  }

  return {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    orderId: order.id,
    senderId: sender.id,
    senderName: sender.name,
    text: text.slice(0, 5000),
    timestamp: new Date().toISOString(),
    type,
    fileInfo: fileCheck.fileInfo,
    metadata
  };
}

function setupWebSocketHandlers(ws: WebSocket) {
  // Rate limiting map for this socket: max 30 messages per 10 seconds
  let messageCount = 0;
  let resetTime = Date.now() + 10000;

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) {
        ws.send(JSON.stringify({ error: 'Binary messages not supported' }));
        return;
      }

      const rawStr = data.toString();
      if (rawStr.length > 51200) {
        ws.send(JSON.stringify({ error: 'Message payload exceeds maximum allowed size' }));
        return;
      }

      const now = Date.now();
      if (now > resetTime) {
        messageCount = 1;
        resetTime = now + 10000;
      } else {
        messageCount++;
        if (messageCount > 30) {
          ws.send(JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }));
          return;
        }
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawStr);
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON payload' }));
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
        return;
      }

      if (parsed.type === 'NEW_MESSAGE') {
        const userId = (ws as any).authenticatedUserId;
        const user = users.find(u => u.id === userId);
        if (!user || user.status !== 'active') {
          ws.send(JSON.stringify({ error: 'Authentication required' }));
          return;
        }

        const orderId = parsed.orderId;
        if (typeof orderId !== 'string' || !orderId.trim()) {
          ws.send(JSON.stringify({ error: 'Valid orderId is required' }));
          return;
        }

        let order = orders.find(o => o.id === orderId.trim());
        if (!order) {
          ws.send(JSON.stringify({ error: 'Order not found' }));
          return;
        }

        if (!canAccessOrderWorkstream(user, order)) {
          ws.send(JSON.stringify({ error: 'Forbidden: You are not a participant of this Workstream.' }));
          return;
        }
        const wsFileCheck = validateMessageFileInfo(parsed.fileInfo, user);
        if (!wsFileCheck.ok) {
          ws.send(JSON.stringify({ error: wsFileCheck.error }));
          return;
        }

        const clientMessageId = typeof parsed.clientMessageId === 'string' ? parsed.clientMessageId : undefined;
        if (clientMessageId) {
          const existing = messages.find(m => m.orderId === order.id && m.metadata?.clientMessageId === clientMessageId);
          if (existing) {
            ws.send(JSON.stringify({ type: 'MESSAGE_ACK', clientMessageId, message: existing }));
            return;
          }
        }

        const newMsg = sanitizeAndCreateMessage(user, order, parsed, wsFileCheck);

        messages.push(newMsg);
        saveMessagesToDisk();
        broadcastMessage(newMsg, order.id);
        ws.send(JSON.stringify({ type: 'MESSAGE_ACK', clientMessageId, message: newMsg }));
      }
    } catch (e) {
      console.error('WS message processing error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
}

export function setupWebSocketServer(server: HttpServer) {
  wss = new WebSocketServer({ server });
  wss.on('error', (err) => {
    console.error('WSS Server error:', err);
  });

  wss.on('connection', (ws, req) => {
    try {
      if (!req.url) {
        ws.close(1008, 'Invalid connection URL');
        return;
      }

      let url: URL;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        ws.close(1008, 'Malformed URL');
        return;
      }

      const token = url.searchParams.get('token');
      let matchedUserId: string | null = null;

      if (token) {
        const payload = verifyToken(token);
        if (payload && payload.id) {
          const dbUser = users.find(u => u.id === payload.id);
          if (dbUser && dbUser.status === 'active') {
            matchedUserId = dbUser.id;
          }
        }
      }

      if (!matchedUserId) {
        try { ws.close(4401, 'Authentication required'); } catch {}
        return;
      }
      
      (ws as any).authenticatedUserId = matchedUserId;
      clients.add(ws);
      setupWebSocketHandlers(ws);

      // Send connection acknowledgement
      ws.send(JSON.stringify({ 
        type: 'CONNECTED', 
        userId: matchedUserId,
        serverTime: new Date().toISOString() 
      }));
    } catch (err) {
      console.error('WS Connection error:', err);
      try { ws.close(1011, 'Server error during connection'); } catch {}
    }
  });

  return wss;
}

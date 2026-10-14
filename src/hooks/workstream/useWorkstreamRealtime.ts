import { useEffect, useRef } from 'react';
import { Message, Order } from '../../types';
import { getAuthToken } from '../../utils/authToken';

export interface UseWorkstreamRealtimeProps {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  currentUser?: { id: string } | null;
  impersonatedUser?: { id: string } | null;
  onReconnect?: () => void;
}

/**
 * Hook responsible for establishing and maintaining the WebSocket connection
 * for real-time workstream message synchronization and order updates.
 */
export function useWorkstreamRealtime({
  setMessages,
  setOrders,
  currentUser,
  impersonatedUser,
  onReconnect
}: UseWorkstreamRealtimeProps) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Authenticate with the signed session token only. Never fall back to a user ID or an admin identity.
    const token = getAuthToken();
    if (!token) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}?token=${encodeURIComponent(token)}`;

    let reconnectTimeout: any = null;
    let isUnmounted = false;

    const connect = () => {
      if (isUnmounted) return;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        console.log('Real-time Workstream WebSocket connected successfully');
        if (onReconnect) onReconnect();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'MESSAGE_RECEIVED' && data.message) {
            const incomingMsg = data.message;
            setMessages(prev => {
              const alreadyExists = prev.some(m => m.id === incomingMsg.id);
              if (alreadyExists) return prev;
              const next = [...prev, incomingMsg];
              return next.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            });
            setOrders(prev => prev.map(o => {
              if (o.id === incomingMsg.orderId) {
                return {
                  ...o,
                  lastMessage: incomingMsg.text,
                  lastMessageTime: incomingMsg.timestamp
                };
              }
              return o;
            }));
          } else if (data.type === 'MESSAGE_ACK' && data.message) {
            setMessages(prev => prev.map(m => 
              m.metadata?.clientMessageId === data.clientMessageId ? data.message : m
            ));
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      socket.onerror = (err) => {
        console.warn('WebSocket error encountered:', err);
      };

      socket.onclose = (ev) => {
        if (ev.code === 4401) return; // rejected as unauthenticated: do not retry with the same credentials
        console.log('Workstream WebSocket disconnected, scheduling reconnect...');
        if (!isUnmounted) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        wsRef.current.close();
      }
    };
  }, [currentUser, impersonatedUser, setMessages, setOrders]);

  return {
    wsRef
  };
}

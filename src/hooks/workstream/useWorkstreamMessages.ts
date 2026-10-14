import { useState, useCallback, useRef } from 'react';
import { Message } from '../../types';

/**
 * Hook responsible for managing workstream messages state, per-workstream cache isolation,
 * race-condition prevention during workstream switching, and message ordering.
 */
export function useWorkstreamMessages() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessageText, setNewMessageText] = useState('');
  
  // Guard against out-of-order responses when user rapidly switches workstreams
  const activeFetchOrderIdRef = useRef<string | null>(null);

  const fetchMessages = useCallback(async (orderId: string) => {
    if (!orderId) return;
    activeFetchOrderIdRef.current = orderId;

    try {
      const token = localStorage.getItem('workperhour_token') || localStorage.getItem('token');
      const res = await fetch(`/api/messages/${orderId}`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });

      if (res.status === 401) {
        console.error('Authentication required for messages');
        return;
      }

      // Check race condition: if user switched to another workstream while fetch was in flight, ignore
      if (activeFetchOrderIdRef.current !== orderId) {
        return;
      }

      const data = res.ok ? await res.json() : [];
      const newOrderMessages: Message[] = Array.isArray(data) ? data : [];

      // Isolated cache merge: preserve all messages for other workstreams, update this order's messages
      setMessages(prev => {
        const otherMessages = prev.filter(m => m.orderId !== orderId);
        const combined = [...otherMessages, ...newOrderMessages];
        return combined.sort((a, b) => {
          const tA = a.timestamp ? new Date(a.timestamp).getTime() : NaN;
          const tB = b.timestamp ? new Date(b.timestamp).getTime() : NaN;
          const validA = !isNaN(tA);
          const validB = !isNaN(tB);
          if (!validA && !validB) return 0;
          if (!validA) return 1;
          if (!validB) return -1;
          return tA - tB;
        });
      });
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  }, []);

  const sendMessage = useCallback(async (text: string, type: string = 'text', fileInfo?: any) => {
    const activeOrderId = activeFetchOrderIdRef.current;
    if (!activeOrderId || !text.trim()) return;

    const token = localStorage.getItem('workperhour_token') || localStorage.getItem('token');
    const clientMessageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const tempMessage: Message = {
      id: clientMessageId,
      orderId: activeOrderId,
      senderId: 'current_user',
      senderName: 'You',
      text: text.trim(),
      timestamp: new Date().toISOString(),
      type: type as any,
      fileInfo,
      status: 'sending',
      metadata: { clientMessageId }
    };

    // Optimistic update
    setMessages(prev => [...prev, tempMessage]);
    setNewMessageText('');

    const attemptSend = async () => {
      try {
        const res = await fetch(`/api/orders/${activeOrderId}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            text: text.trim(),
            type,
            fileInfo,
            clientMessageId
          })
        });

        if (res.ok) {
          const data = await res.json();
          setMessages(prev => prev.map(m => m.id === clientMessageId ? { ...data.message, status: 'sent' } : m));
        } else {
          throw new Error('Server error');
        }
      } catch (err) {
        console.error('Error sending message:', err);
        setMessages(prev => prev.map(m => m.id === clientMessageId ? { ...m, status: 'failed' } : m));
      }
    };

    attemptSend();
  }, [setMessages, setNewMessageText]);

  const sendEvent = useCallback(async (
    orderId: string,
    text: string,
    type: 'system' = 'system',
    metadata: Record<string, any>,
    onError: (msg: string) => void
  ) => {
    const token = localStorage.getItem('workperhour_token') || localStorage.getItem('token');
    const clientMessageId = 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    const tempMessage: Message = {
      id: clientMessageId,
      orderId,
      senderId: 'current_user',
      senderName: 'System',
      text,
      timestamp: new Date().toISOString(),
      type,
      status: 'sending',
      metadata: { ...metadata, clientMessageId }
    };

    setMessages(prev => [...prev, tempMessage]);

    const attemptSend = async (retries = 3): Promise<void> => {
      try {
        const res = await fetch(`/api/orders/${orderId}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            text,
            type,
            metadata: { ...metadata, clientMessageId }
          })
        });

        if (res.ok) {
          const data = await res.json();
          setMessages(prev => prev.map(m => m.id === clientMessageId ? { ...data.message, status: 'sent' } : m));
        } else if (retries > 0) {
          await attemptSend(retries - 1);
        } else {
          throw new Error('Failed after retries');
        }
      } catch (err) {
        if (retries > 0) {
          await attemptSend(retries - 1);
        } else {
          console.error('Event sending failed:', err);
          setMessages(prev => prev.map(m => m.id === clientMessageId ? { ...m, status: 'failed' } : m));
          onError(`Failed to log event: ${text}`);
        }
      }
    };

    attemptSend();
  }, [setMessages]);

  return {
    messages,
    setMessages,
    newMessageText,
    setNewMessageText,
    fetchMessages,
    sendMessage,
    sendEvent
  };
}


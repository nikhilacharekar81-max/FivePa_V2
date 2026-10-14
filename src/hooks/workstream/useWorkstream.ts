import { useMemo, useCallback } from 'react';
import { useWorkstreamList } from './useWorkstreamList';
import { useWorkstreamFilters } from './useWorkstreamFilters';
import { useWorkstreamSelection } from './useWorkstreamSelection';
import { useWorkstreamMessages } from './useWorkstreamMessages';
import { useWorkstreamRealtime } from './useWorkstreamRealtime';
import { useWorkstreamActions } from './useWorkstreamActions';
import { useWorkstreamFiles } from './useWorkstreamFiles';
import { useWorkstreamDelivery } from './useWorkstreamDelivery';
import { useWorkstreamRevision } from './useWorkstreamRevision';
import { useWorkstreamEscrow } from './useWorkstreamEscrow';
import { useWorkstreamReview } from './useWorkstreamReview';
import { useWorkstreamMeeting } from './useWorkstreamMeeting';

/**
 * Top-level orchestration hook for all workstream sub-hooks.
 * Connects shared order state, messages, realtime events, and selected order synchronization.
 */
export function useWorkstream(props?: any) {
  const list = useWorkstreamList(props);
  const filters = useWorkstreamFilters(props);
  const selection = useWorkstreamSelection();
  const messages = useWorkstreamMessages();

  // Synchronize authoritative selected order with updated orders list (Phase 29)
  const currentSelectedOrder = useMemo(() => {
    const raw = props?.selectedOrder || selection.selectedOrder;
    if (!raw) return null;
    const authoritative = list.hydratedWorkstreamItems.find(o => o.id === raw.id);
    return authoritative || raw;
  }, [props?.selectedOrder, selection.selectedOrder, list.hydratedWorkstreamItems]);
  
  const onReconnect = useCallback(() => {
    if (currentSelectedOrder) {
      messages.fetchMessages(currentSelectedOrder.id);
    }
  }, [currentSelectedOrder, messages.fetchMessages]);

  const realtime = useWorkstreamRealtime({ ...props, onReconnect });
  const actions = useWorkstreamActions(props);

  const activeMessages = props?.messages || messages.messages;
  const activeSetMessages = props?.setMessages || messages.setMessages;

  const files = useWorkstreamFiles({
    selectedOrder: currentSelectedOrder,
    messages: activeMessages
  });

  const delivery = useWorkstreamDelivery({
    selectedOrder: currentSelectedOrder,
    setOrders: props?.setOrders,
    setSelectedOrder: props?.setSelectedOrder || selection.setSelectedOrder,
    setMessages: activeSetMessages
  });

  const revision = useWorkstreamRevision({
    selectedOrder: currentSelectedOrder,
    setOrders: props?.setOrders,
    setSelectedOrder: props?.setSelectedOrder || selection.setSelectedOrder,
    setMessages: activeSetMessages
  });

  const escrow = useWorkstreamEscrow({
    selectedOrder: currentSelectedOrder,
    setOrders: props?.setOrders,
    setSelectedOrder: props?.setSelectedOrder || selection.setSelectedOrder,
    setMessages: activeSetMessages
  });

  const review = useWorkstreamReview({
    selectedOrder: currentSelectedOrder,
    setOrders: props?.setOrders,
    setSelectedOrder: props?.setSelectedOrder || selection.setSelectedOrder,
    setMessages: activeSetMessages,
    setReviews: props?.setReviews,
    refresh: props?.refresh
  });
  const meeting = useWorkstreamMeeting(props);

  return {
    ...list,
    ...filters,
    ...selection,
    selectedOrder: currentSelectedOrder,
    ...messages,
    ...realtime,
    ...actions,
    ...files,
    ...delivery,
    ...revision,
    ...escrow,
    ...review,
    ...meeting
  };
}

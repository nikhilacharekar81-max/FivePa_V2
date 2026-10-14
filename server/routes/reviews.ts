import { Router } from 'express';
import {
  reviews,
  orders,
  users,
  messages,
  saveReviewsToDisk,
  saveOrdersToDisk,
  saveMessagesToDisk,
  Review,
  Message
} from '../store.js';
import { requireAuth } from '../auth.js';
import { canAccessOrderWorkstream } from '../access.js';
import { broadcastMessage } from '../websocket.js';

export const reviewsRouter = Router();

// GET /api/reviews
reviewsRouter.get('/api/reviews', (req, res) => res.json(reviews));

// GET /api/users/:userId/reviews
reviewsRouter.get('/api/users/:userId/reviews', (req, res) => {
  const userReviews = reviews.filter(r => r.targetUserId === req.params.userId);
  res.json(userReviews);
});

// GET /api/reviews/seller/:sellerId
reviewsRouter.get('/api/reviews/seller/:sellerId', (req, res) => {
  const userReviews = reviews.filter(r => r.targetUserId === req.params.sellerId);
  res.json(userReviews);
});

// GET /api/reviews/order/:orderId
reviewsRouter.get('/api/reviews/order/:orderId', (req, res) => {
  const orderReview = reviews.find(r => r.orderId === req.params.orderId);
  if (!orderReview) return res.status(404).json({ error: 'Review not found for this order' });
  res.json(orderReview);
});

// POST /api/reviews
reviewsRouter.post('/api/reviews', requireAuth, (req, res) => {
  const authUserId = (req as any).authenticatedUserId;
  const caller = users.find(u => u.id === authUserId);
  if (!caller) return res.status(401).json({ error: 'Authentication required to submit a review' });

  const { orderId, targetUserId, rating, comment, orderTitle } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const numRating = Number(rating);
  if (isNaN(numRating) || numRating < 1 || numRating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5 stars' });
  }

  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    return res.status(400).json({ error: 'Review comment cannot be empty' });
  }

  const order = orders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Workstream order not found' });
  if (!canAccessOrderWorkstream(caller, order)) {
    return res.status(403).json({ error: 'Forbidden: Only order participants can submit reviews.' });
  }

  // Completed-order eligibility
  if (order.status !== 'completed') {
    return res.status(409).json({ error: `Reviews can only be submitted for completed Workstreams (current status: ${order.status}).` });
  }

  // Duplicate-review prevention
  if (reviews.some(r => r.orderId === order.id && r.reviewerId === caller.id) || (order.review && order.review.reviewerId === caller.id)) {
    return res.status(409).json({ error: 'A review has already been submitted for this Workstream.' });
  }

  const resolvedTargetUserId = targetUserId || (caller.id === order.buyerId ? order.sellerId : order.buyerId);

  const newReview: Review = {
    id: 'rev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    orderId: order.id,
    reviewerId: caller.id,
    reviewerName: caller.name,
    reviewerAvatar: caller.avatar,
    targetUserId: resolvedTargetUserId,
    rating: numRating,
    comment: comment.trim(),
    orderTitle: orderTitle || order.title || 'Workstream Milestone Deliverable',
    gigId: req.body.gigId || order.gigId,
    projectId: req.body.projectId || order.projectId,
    createdAt: new Date().toISOString().split('T')[0]
  };

  reviews.unshift(newReview);
  saveReviewsToDisk();

  order.review = newReview;
  saveOrdersToDisk();

  // Dynamically update target user's rating and reviewsCount
  const targetUser = users.find(u => u.id === resolvedTargetUserId);
  if (targetUser) {
    const userReviews = reviews.filter(r => r.targetUserId === resolvedTargetUserId);
    targetUser.reviewsCount = userReviews.length;
    targetUser.rating = Number((userReviews.reduce((sum, r) => sum + r.rating, 0) / userReviews.length).toFixed(1));
  }

  // Broadcast system message to workstream
  const sysMsg: Message = {
    id: 'msg_' + Date.now(),
    orderId: order.id,
    senderId: 'system',
    senderName: 'WorkSphere Reviews',
    text: `⭐ Review submitted by ${caller.name} (${newReview.rating}/5 stars): "${newReview.comment}"`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type: 'system',
    metadata: {
      action: 'review_submitted',
      rating: newReview.rating,
      comment: newReview.comment
    }
  };
  messages.push(sysMsg);
  saveMessagesToDisk();
  broadcastMessage(sysMsg, order.id);

  res.status(201).json({ success: true, review: newReview, order });
});

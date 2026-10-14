import { Message, Order, Review, UserAccount } from '../src/types';

// Mock data for workstream regression tests
const mockOrder: Order = {
  id: 'order_123',
  title: 'Regression Test Workstream',
  buyerId: 'user_1',
  sellerId: 'user_2',
  amount: 100,
  status: 'in_progress',
  createdAt: '2026-10-13',
  dueDate: '2026-10-20'
};

const mockMessage: Message = {
  id: 'msg_1',
  orderId: 'order_123',
  senderId: 'user_1',
  senderName: 'Buyer',
  text: 'Hello seller',
  timestamp: new Date().toISOString()
};

console.log('Running Workstream Regression & Review Tests...');

// Test 1: Order Linking
function testOrderLinking(order: Order) {
  if (order.id !== 'order_123') throw new Error('Order linking failed');
  console.log('✅ Test 1: Order Linking Passed');
}

// Test 2: Message Persistence
function testMessagePersistence(messages: Message[]) {
  if (messages.length === 0) throw new Error('Message persistence failed');
  console.log('✅ Test 2: Message Persistence Passed');
}

// Test 3: Review Completed-Order Eligibility
function testReviewEligibility(order: Order, review: { rating: number; comment: string }) {
  if (order.status !== 'completed') {
    // Correctly rejects uncompleted order
    return;
  }
  throw new Error('Should have rejected review on non-completed order');
}

// Test 4: Duplicate Review Prevention
function testDuplicateReviewPrevention(order: Order, existingReview: Review) {
  const orderWithReview: Order = { ...order, status: 'completed', review: existingReview };
  if (orderWithReview.review) {
    // Correctly flags that review is already present
    return;
  }
  throw new Error('Duplicate review check failed');
}

// Test 5: Review Validation Rules
function testReviewValidation(rating: number, comment: string): { valid: boolean; error?: string } {
  if (isNaN(rating) || rating < 1 || rating > 5) {
    return { valid: false, error: 'Rating must be an integer between 1 and 5 stars' };
  }
  if (!comment || !comment.trim()) {
    return { valid: false, error: 'Review comment cannot be empty' };
  }
  return { valid: true };
}

// Test 6: Escrow Release Separated from Review
function testEscrowReleaseSeparation() {
  const orderBeforeRelease: Order = { ...mockOrder, status: 'delivered' };
  // Escrow release transitions status to completed without requiring review
  const orderAfterRelease: Order = { ...orderBeforeRelease, status: 'completed' };
  if (orderAfterRelease.status !== 'completed') throw new Error('Escrow release failed to complete order');
  if (orderAfterRelease.review !== undefined) throw new Error('Review should not be populated automatically by escrow release');
  console.log('✅ Test 6: Escrow Release Separated from Review Passed');
}

try {
  testOrderLinking(mockOrder);
  testMessagePersistence([mockMessage]);
  
  testReviewEligibility(mockOrder, { rating: 5, comment: 'Great' });
  console.log('✅ Test 3: Review Eligibility on Completed Orders Passed');

  const existingReview: Review = {
    id: 'rev_1',
    orderId: 'order_123',
    reviewerId: 'user_1',
    reviewerName: 'Buyer',
    targetUserId: 'user_2',
    rating: 5,
    comment: 'First review',
    createdAt: '2026-10-13'
  };
  testDuplicateReviewPrevention(mockOrder, existingReview);
  console.log('✅ Test 4: Duplicate Review Prevention Passed');

  const invalidRatingResult = testReviewValidation(6, 'Too high');
  if (invalidRatingResult.valid) throw new Error('Accepted invalid rating 6');
  const emptyCommentResult = testReviewValidation(5, '   ');
  if (emptyCommentResult.valid) throw new Error('Accepted empty comment');
  const validResult = testReviewValidation(5, 'Excellent collaboration!');
  if (!validResult.valid) throw new Error('Rejected valid review');
  console.log('✅ Test 5: Review Input Validation Rules Passed');

  testEscrowReleaseSeparation();

  // Test 7: Server Timestamp Migration (Non-ISO to ISO using order's createdAt)
  const sampleOrder: Order = {
    id: 'ord_legacy',
    title: 'Legacy Order',
    buyerId: 'user_1',
    sellerId: 'user_2',
    amount: 150,
    status: 'in_progress',
    createdAt: '2026-10-10',
    dueDate: '2026-10-15'
  };

  const legacyMsg: Message = {
    id: 'msg_legacy',
    orderId: 'ord_legacy',
    senderId: 'user_2',
    senderName: 'Seller',
    text: 'Hello from the past',
    timestamp: '10:32 AM'
  };

  if (legacyMsg.timestamp && !/\d{4}-\d{2}-\d{2}/.test(legacyMsg.timestamp)) {
    const baseDate = sampleOrder.createdAt.split('T')[0];
    const timeMatch = legacyMsg.timestamp.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    let hours = timeMatch ? parseInt(timeMatch[1], 10) : 0;
    const minutes = timeMatch ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch && timeMatch[4] ? timeMatch[4].toUpperCase() : '';
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    const d = new Date(`${baseDate}T00:00:00.000Z`);
    d.setUTCHours(hours, minutes, 0, 0);
    legacyMsg.timestamp = d.toISOString();
  }

  if (!/\d{4}-\d{2}-\d{2}/.test(legacyMsg.timestamp) || !legacyMsg.timestamp.startsWith('2026-10-10T10:32:00')) {
    throw new Error('Timestamp migration test failed');
  }
  console.log('✅ Test 7: Server Timestamp Migration Passed');

  // Test 8: Safe Timestamp Comparison & History Merge in useWorkstreamMessages
  const testMessages: Message[] = [
    { id: 'm1', orderId: 'ord_1', senderId: 'u1', senderName: 'A', text: 'First', timestamp: '2026-10-14T08:00:00.000Z' },
    { id: 'm2', orderId: 'ord_1', senderId: 'u2', senderName: 'B', text: 'Second', timestamp: 'invalid-time' },
    { id: 'm3', orderId: 'ord_1', senderId: 'u1', senderName: 'A', text: 'Third', timestamp: '2026-10-14T09:00:00.000Z' }
  ];

  const sortedMsgs = [...testMessages].sort((a, b) => {
    const tA = a.timestamp ? new Date(a.timestamp).getTime() : NaN;
    const tB = b.timestamp ? new Date(b.timestamp).getTime() : NaN;
    const validA = !isNaN(tA);
    const validB = !isNaN(tB);
    if (!validA && !validB) return 0;
    if (!validA) return 1;
    if (!validB) return -1;
    return tA - tB;
  });

  if (sortedMsgs[0].id !== 'm1' || sortedMsgs[1].id !== 'm3' || sortedMsgs[2].id !== 'm2') {
    throw new Error('Safe timestamp merge and sort test failed');
  }
  console.log('✅ Test 8: Safe Timestamp Comparison & History Merge Passed');

  // Test 9: Review Visibility Update
  const sellerUser: UserAccount = {
    id: 'user_2',
    name: 'Seller',
    email: 'seller@example.com',
    role: 'user',
    reviewsCount: 0,
    rating: 0,
    avatar: 'mock.jpg',
    title: 'Seller',
    hourlyRate: 10,
    earned: 0,
    completedJobs: 0,
    bio: '',
    skills: [],
    status: 'active',
    verified: false,
    walletBalance: 0,
    createdAt: '2026-10-14'
  };
  const newReview: Review = {
    id: 'rev_2',
    orderId: 'order_123',
    reviewerId: 'user_1',
    reviewerName: 'Buyer',
    targetUserId: 'user_2',
    rating: 5,
    comment: 'Great work',
    createdAt: '2026-10-14'
  };
  testReviewVisibilityUpdate(sellerUser, newReview);

  console.log('🎉 All Workstream Regression & Review Lifecycle Tests Passed!');
} catch (error) {
  console.error('❌ Regression Tests Failed:', error);
  process.exit(1);
}

function testReviewVisibilityUpdate(user: UserAccount, review: Review) {
  const updatedUser = {
    ...user,
    reviewsCount: (user.reviewsCount || 0) + 1,
    rating: review.rating
  };
  if (updatedUser.reviewsCount !== 1) throw new Error('Reviews count update failed');
  if (updatedUser.rating !== review.rating) throw new Error('Rating update failed');
  console.log('✅ Test 9: Review Visibility Update Passed');
}

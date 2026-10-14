import assert from 'node:assert';
import {
  orders,
  users,
  messages,
  auditLogs,
  disputes,
  processAutoAcceptOrders,
  isAutoAcceptEnabled,
  getReviewWindowDays,
  siteSettings,
  saveOrdersToDisk
} from '../server.ts';
import { financeLedger } from '../src/server/financeLedger.ts';
import type { Order, DeliveryRecord, UserAccount } from '../src/types.ts';

console.log('\n--- BUYER REVIEW WINDOW & AUTO-ACCEPT UNIT & SIMULATION TESTS ---');

let passed = 0;
function ok(name: string) {
  console.log(`  ✅ ${name}`);
  passed++;
}

async function run() {
  const T0 = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // 1. Verify default review window is 3 days
  const defaultDays = getReviewWindowDays();
  assert.strictEqual(defaultDays, 3, 'Default review window must be 3 days');
  assert.strictEqual(isAutoAcceptEnabled(), true, 'Auto-accept feature must be enabled by default');
  ok('default review window is 3 days and feature is enabled');

  // Setup test users in users array if needed
  const buyerId = 'usr_buyer_auto_' + T0;
  const sellerId = 'usr_seller_auto_' + T0;
  const buyer: UserAccount = {
    id: buyerId,
    name: 'AutoBuyer Test',
    email: `buyer_${T0}@test.com`,
    role: 'buyer',
    status: 'active',
    walletBalance: 1000,
    avatar: 'https://avatar.test/1.png'
  };
  const seller: UserAccount = {
    id: sellerId,
    name: 'AutoSeller Test',
    email: `seller_${T0}@test.com`,
    role: 'freelancer',
    status: 'active',
    walletBalance: 0,
    avatar: 'https://avatar.test/2.png'
  };
  users.push(buyer, seller);
  financeLedger.ensureWallet({ userId: buyerId, name: buyer.name, email: buyer.email, role: 'buyer' });
  financeLedger.ensureWallet({ userId: sellerId, name: seller.name, email: seller.email, role: 'freelancer' });
  financeLedger.creditDeposit({
    userId: buyerId,
    amount: 2000,
    reference: `DEP-TEST-${T0}`,
    idempotencyKey: `dep_test_${T0}`,
    actor: buyerId
  });

  // Setup order 1: delivered 2 days ago (T0 - 2 days). Window is 3 days -> Should NOT be auto-accepted yet
  const orderId1 = 'ord_auto_pending_' + T0;
  const amount1 = 100;
  financeLedger.fundEscrow({
    orderId: orderId1,
    orderTitle: 'Test Pending Review Order',
    amount: amount1,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const deliveryV1: DeliveryRecord = {
    version: 1,
    deliveredAt: new Date(T0 - 2 * ONE_DAY_MS).toISOString(),
    message: 'Finished work v1',
    files: [{ name: 'result.pdf', size: '1 MB', url: '/uploads/workstream/test1.pdf' }]
  };

  const order1: Order = {
    id: orderId1,
    title: 'Test Pending Review Order',
    buyerId,
    sellerId,
    amount: amount1,
    status: 'delivered',
    createdAt: new Date(T0 - 5 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 5 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [deliveryV1],
    deliverableFiles: deliveryV1.files
  };
  orders.push(order1);

  // Run at T0 (2 days after delivery) -> should be 0 processed
  const resPending = processAutoAcceptOrders(T0);
  assert.ok(!resPending.some(p => p.orderId === orderId1), 'Order delivered 2 days ago must not auto-accept at day 2');
  assert.strictEqual(order1.status, 'delivered', 'Order status must remain delivered');
  ok('premature order (2 days into 3-day window) remains untouched in delivered status');

  // Setup order 2: delivered 4 days ago (T0 - 4 days). Window is 3 days -> MUST be auto-accepted!
  const orderId2 = 'ord_auto_expired_' + T0;
  const amount2 = 200;
  financeLedger.fundEscrow({
    orderId: orderId2,
    orderTitle: 'Test Expired Review Order',
    amount: amount2,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const deliveryV2: DeliveryRecord = {
    version: 1,
    deliveredAt: new Date(T0 - 4 * ONE_DAY_MS).toISOString(),
    message: 'Completed deliverable v1',
    files: [{ name: 'app_final.zip', size: '5 MB', url: '/uploads/workstream/test2.zip' }]
  };

  const order2: Order = {
    id: orderId2,
    title: 'Test Expired Review Order',
    buyerId,
    sellerId,
    amount: amount2,
    status: 'delivered',
    createdAt: new Date(T0 - 7 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 3 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [deliveryV2],
    deliverableFiles: deliveryV2.files
  };
  orders.push(order2);

  const initialSellerBalance = seller.walletBalance;

  // Run at T0 (4 days after delivery)
  const resExpired = processAutoAcceptOrders(T0);
  const processed2 = resExpired.find(p => p.orderId === orderId2);
  assert.ok(processed2, 'Order delivered 4 days ago must be auto-accepted');
  assert.strictEqual(processed2.acceptedVersion, 1, 'Accepted version must be 1');
  assert.strictEqual(order2.status, 'completed', 'Order status must be updated to completed');
  assert.strictEqual(order2.acceptedVersion, 1, 'order.acceptedVersion must be recorded');
  assert.ok(order2.completedAt, 'order.completedAt must be populated');

  // Escrow check: funds must be released
  const esc2 = financeLedger.getEscrow(orderId2);
  assert.strictEqual(esc2?.status, 'released', 'Ledger escrow must be released');
  assert.strictEqual(esc2?.remaining, 0, 'Ledger escrow remaining balance must be 0');
  assert.ok(seller.walletBalance > initialSellerBalance, 'Freelancer wallet must receive net payout');
  ok('expired order is auto-accepted, escrow released to seller, and version recorded');

  // Check audit log and workstream system message
  const sysMessage = messages.find(m => m.orderId === orderId2 && m.type === 'system' && m.metadata?.action === 'order_auto_accepted');
  assert.ok(sysMessage, 'System message must be posted to order workstream');
  assert.ok(sysMessage.text.includes('automatically accepted'), 'System message text must explain review window expiration');

  const auditEntry = auditLogs.find(l => l.target === `Order #${orderId2}` && l.action === 'ORDER_AUTO_ACCEPTED');
  assert.ok(auditEntry, 'Audit log entry must be recorded for auto-acceptance');
  ok('system message and audit log entry recorded properly');

  // Idempotency: Running processAutoAcceptOrders again at T0 must not process order2 again
  const messagesCountBefore = messages.filter(m => m.orderId === orderId2).length;
  const sellerBalanceAfterFirst = seller.walletBalance;
  const resIdempotent = processAutoAcceptOrders(T0);
  assert.ok(!resIdempotent.some(p => p.orderId === orderId2), 'Second run must not re-process the completed order');
  assert.strictEqual(seller.walletBalance, sellerBalanceAfterFirst, 'Freelancer wallet balance must not increase again');
  assert.strictEqual(messages.filter(m => m.orderId === orderId2).length, messagesCountBefore, 'No duplicate messages created');
  ok('idempotency verified: re-running does not double-release or duplicate messages');

  // Safety exemption 1: Order with active revision request must NOT be auto-accepted
  const orderId3 = 'ord_auto_revised_' + T0;
  financeLedger.fundEscrow({
    orderId: orderId3,
    orderTitle: 'Test Revision Order',
    amount: 150,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const order3: Order = {
    id: orderId3,
    title: 'Test Revision Order',
    buyerId,
    sellerId,
    amount: 150,
    status: 'delivered',
    createdAt: new Date(T0 - 8 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 2 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [{
      version: 1,
      deliveredAt: new Date(T0 - 4 * ONE_DAY_MS).toISOString(),
      message: 'v1 deliverable',
      files: [{ name: 'draft.pdf', size: '1 MB', url: '/uploads/workstream/test3.pdf' }]
    }],
    revisions: [{
      version: 1,
      requestedAt: new Date(T0 - 3 * ONE_DAY_MS).toISOString(),
      reason: 'Please adjust color palette',
      status: 'requested',
      deliveryVersion: 1
    }]
  };
  orders.push(order3);

  const resRevision = processAutoAcceptOrders(T0);
  assert.ok(!resRevision.some(p => p.orderId === orderId3), 'Order with active revision must NOT be auto-accepted');
  assert.strictEqual(order3.status, 'delivered', 'Status must stay delivered while revision is pending');
  ok('order with active revision request is exempted from auto-accept');

  // Safety exemption 2: Order with open dispute must NOT be auto-accepted
  const orderId4 = 'ord_auto_disputed_' + T0;
  financeLedger.fundEscrow({
    orderId: orderId4,
    orderTitle: 'Test Disputed Order',
    amount: 120,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const order4: Order = {
    id: orderId4,
    title: 'Test Disputed Order',
    buyerId,
    sellerId,
    amount: 120,
    status: 'delivered',
    createdAt: new Date(T0 - 8 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 2 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [{
      version: 1,
      deliveredAt: new Date(T0 - 5 * ONE_DAY_MS).toISOString(),
      message: 'v1 deliverable',
      files: [{ name: 'code.zip', size: '2 MB', url: '/uploads/workstream/test4.zip' }]
    }]
  };
  orders.push(order4);
  disputes.push({
    id: 'disp_' + T0,
    orderId: orderId4,
    buyerId,
    sellerId,
    reason: 'Files corrupted',
    status: 'open',
    createdAt: new Date(T0 - 2 * ONE_DAY_MS).toISOString(),
    resolutionType: 'refund',
    notes: 'Buyer claims corrupt files'
  } as any);

  const resDisputed = processAutoAcceptOrders(T0);
  assert.ok(!resDisputed.some(p => p.orderId === orderId4), 'Order with open dispute must NOT be auto-accepted');
  assert.strictEqual(order4.status, 'delivered', 'Disputed order status must remain intact');
  ok('order with open dispute is exempted from auto-accept');

  // Feature Toggle Test: Turn off auto-accept via site settings
  const orderId5 = 'ord_auto_disabled_' + T0;
  financeLedger.fundEscrow({
    orderId: orderId5,
    orderTitle: 'Test Toggle Disabled Order',
    amount: 180,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const order5: Order = {
    id: orderId5,
    title: 'Test Toggle Disabled Order',
    buyerId,
    sellerId,
    amount: 180,
    status: 'delivered',
    createdAt: new Date(T0 - 10 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 2 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [{
      version: 1,
      deliveredAt: new Date(T0 - 6 * ONE_DAY_MS).toISOString(),
      message: 'v1 deliverable',
      files: [{ name: 'art.png', size: '3 MB', url: '/uploads/workstream/test5.png' }]
    }]
  };
  orders.push(order5);

  // Disable feature toggle
  siteSettings.updateSection('marketplace', { autoCompleteDeliveredEnabled: false }, 'Test Runner');
  assert.strictEqual(isAutoAcceptEnabled(), false, 'isAutoAcceptEnabled must return false when toggled off');

  const resDisabled = processAutoAcceptOrders(T0);
  assert.strictEqual(resDisabled.length, 0, 'No orders should be auto-accepted when toggle is disabled');
  assert.strictEqual(order5.status, 'delivered', 'Order must stay in delivered status when toggle is false');
  ok('single-setting toggle (autoCompleteDeliveredEnabled=false) completely disables auto-acceptance');

  // Re-enable toggle
  siteSettings.updateSection('marketplace', { autoCompleteDeliveredEnabled: true }, 'Test Runner');
  assert.strictEqual(isAutoAcceptEnabled(), true, 'isAutoAcceptEnabled must return true when re-enabled');

  // Now order5 should be processed
  const resReenabled = processAutoAcceptOrders(T0);
  assert.ok(resReenabled.some(p => p.orderId === orderId5), 'Order5 is auto-accepted once toggle is re-enabled');
  assert.strictEqual(order5.status, 'completed', 'Order5 is completed');
  ok('re-enabling toggle resumes auto-acceptance seamlessly');

  // Configurable Review Window Test: Change window to 5 days
  siteSettings.updateSection('marketplace', { autoCompleteDeliveredDays: 5 }, 'Test Runner');
  assert.strictEqual(getReviewWindowDays(), 5, 'Review window must update to 5 days');

  const orderId6 = 'ord_auto_custom_days_' + T0;
  financeLedger.fundEscrow({
    orderId: orderId6,
    orderTitle: 'Test Custom Days Order',
    amount: 250,
    buyerId,
    sellerId,
    actor: buyerId
  });

  const order6: Order = {
    id: orderId6,
    title: 'Test Custom Days Order',
    buyerId,
    sellerId,
    amount: 250,
    status: 'delivered',
    createdAt: new Date(T0 - 10 * ONE_DAY_MS).toISOString(),
    dueDate: new Date(T0 + 2 * ONE_DAY_MS).toISOString(),
    deliveryHistory: [{
      version: 1,
      deliveredAt: new Date(T0 - 4 * ONE_DAY_MS).toISOString(), // 4 days old < 5 days
      message: 'v1 deliverable',
      files: [{ name: 'doc.pdf', size: '2 MB', url: '/uploads/workstream/test6.pdf' }]
    }]
  };
  orders.push(order6);

  // At day 4 (4 days < 5 days): should NOT auto-accept
  const res4Days = processAutoAcceptOrders(T0);
  assert.ok(!res4Days.some(p => p.orderId === orderId6), 'Order at 4 days with 5-day window must NOT auto-accept');
  assert.strictEqual(order6.status, 'delivered');

  // Fast forward clock by 2 more days (fake clock = T0 + 2 days, so 6 days after delivery): should auto-accept!
  const res6Days = processAutoAcceptOrders(T0 + 2 * ONE_DAY_MS);
  assert.ok(res6Days.some(p => p.orderId === orderId6), 'Order at 6 days with 5-day window MUST auto-accept');
  assert.strictEqual(order6.status, 'completed');
  ok('configurable window (custom 5 days) and fake-clock fast-forwarding verified');

  // Reset site settings back to default 3 days
  siteSettings.updateSection('marketplace', { autoCompleteDeliveredDays: 3, autoCompleteDeliveredEnabled: true }, 'Test Reset');

  console.log(`\n🎉 All ${passed} Buyer Review Window & Auto-Accept tests passed successfully!`);
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Auto-accept test failed:', err);
  process.exit(1);
});

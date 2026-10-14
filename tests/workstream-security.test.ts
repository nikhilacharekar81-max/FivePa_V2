// Workstream security + lifecycle integration test.
// Boots the real server in test mode, drives the HTTP/WebSocket API with demo accounts and
// asserts the access-control and escrow rules. Data files are snapshotted and restored.
process.env.PORT = '3003';
process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { financeLedger } from '../src/server/financeLedger.js';

const PORT = 3003;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SNAPSHOT_DIR = path.join(DATA_DIR, '..', '.test-data-snapshot');

function snapshotData() {
  fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  if (fs.existsSync(DATA_DIR)) fs.cpSync(DATA_DIR, SNAPSHOT_DIR, { recursive: true });
}
function restoreData() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  if (fs.existsSync(SNAPSHOT_DIR)) fs.cpSync(SNAPSHOT_DIR, DATA_DIR, { recursive: true });
  fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
}

async function api(p: string, opts: { method?: string; token?: string; body?: any; raw?: Buffer; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${p}`, {
    method: opts.method || 'GET',
    headers,
    body: (opts.raw as any) ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined)
  });
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function demoToken(userId: string): Promise<string> {
  const r = await api('/api/auth/demo-session', { method: 'POST', body: { userId } });
  assert.strictEqual(r.status, 200, `demo-session for ${userId} should work in test mode (got ${r.status})`);
  return r.json.token;
}

function wsOutcome(url: string): Promise<{ closed: boolean; code?: number }> {
  return new Promise(resolve => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ closed: false }); }, 2500);
    ws.on('close', code => { clearTimeout(t); resolve({ closed: true, code }); });
    ws.on('error', () => { /* handled via close */ });
  });
}

let passed = 0;
const ok = (name: string) => { passed++; console.log(`  ✅ ${name}`); };

async function run() {
  snapshotData();
  await import('../server.js');
  await new Promise(r => setTimeout(r, 800));

  // Seed escrow for ord_2 in the ledger as instructed
  try {
    financeLedger.ensureWallet({ userId: 'usr_6', name: 'Sarah Jenkins', email: 'sarah@example.com', role: 'buyer' });
    financeLedger.creditDeposit({ userId: 'usr_6', amount: 1000, reference: 'test-dep', idempotencyKey: 'test-dep-ord2', actor: 'test' });
    financeLedger.fundEscrow({
      orderId: 'ord_2',
      orderTitle: 'Design Modern Figma UI/UX for SaaS Platforms and Mobile Apps',
      amount: 350,
      buyerId: 'usr_6',
      sellerId: 'usr_4',
      actor: 'test',
      skipMinimum: true
    });
  } catch {
    // already funded / seeded
  }

  console.log('--- WORKSTREAM SECURITY & LIFECYCLE TESTS ---');

  const ORDER = 'ord_2'; // buyer usr_6 (Sarah), seller usr_4 (Aisha), funded_in_escrow
  const buyer = await demoToken('usr_6');
  const seller = await demoToken('usr_4');
  const outsider = await demoToken('usr_3');

  // 1. privileged demo login blocked
  const adminDemo = await api('/api/auth/demo-session', { method: 'POST', body: { userId: 'usr_1' } });
  assert.strictEqual(adminDemo.status, 403, 'demo login for super admin must be refused');
  ok('demo login refused for privileged account');

  // 2. message history requires auth + participation
  assert.strictEqual((await api(`/api/messages/${ORDER}`)).status, 401);
  assert.strictEqual((await api(`/api/messages/${ORDER}`, { token: outsider })).status, 403);
  assert.strictEqual((await api(`/api/messages/${ORDER}`, { token: buyer })).status, 200);
  ok('message history: 401 anonymous, 403 outsider, 200 participant');

  // 3. sending requires participation on every path
  assert.strictEqual((await api('/api/messages', { method: 'POST', token: outsider, body: { orderId: ORDER, text: 'x' } })).status, 403);
  assert.strictEqual((await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: outsider, body: { text: 'x' } })).status, 403);
  assert.strictEqual((await api('/api/messages', { method: 'POST', body: { orderId: ORDER, text: 'x' } })).status, 401);
  const sent = await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: buyer, body: { text: 'hello', clientMessageId: 'cm_test_1' } });
  assert.strictEqual(sent.status, 200);
  const again = await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: buyer, body: { text: 'hello', clientMessageId: 'cm_test_1' } });
  assert.strictEqual(again.json.message.id, sent.json.message.id, 'same clientMessageId must not duplicate');
  ok('sending: outsider/anonymous rejected, participant accepted, retries deduplicated');

  // 4. WebSocket authentication
  const anon = await wsOutcome(`ws://localhost:${PORT}`);
  assert.ok(anon.closed, 'anonymous WebSocket must be closed');
  const rawId = await wsOutcome(`ws://localhost:${PORT}?token=usr_1`);
  assert.ok(rawId.closed, 'WebSocket with a raw user id as token must be closed');
  ok('WebSocket: anonymous and raw-user-id connections rejected');

  // 5. uploads
  const fileBytes = Buffer.from('%PDF-1.4 test deliverable');
  assert.strictEqual((await api('/api/workstream/upload?name=a.pdf', { method: 'POST', raw: fileBytes, headers: { 'Content-Type': 'application/pdf' } })).status, 401);
  assert.strictEqual((await api('/api/workstream/upload?name=evil.exe', { method: 'POST', token: seller, raw: fileBytes, headers: { 'Content-Type': 'application/octet-stream' } })).status, 415);
  assert.strictEqual((await api('/api/workstream/upload?name=x.svg', { method: 'POST', token: seller, raw: fileBytes, headers: { 'Content-Type': 'image/svg+xml' } })).status, 415);
  const up = await api('/api/workstream/upload?name=final.pdf', { method: 'POST', token: seller, raw: fileBytes, headers: { 'Content-Type': 'application/pdf' } });
  assert.strictEqual(up.status, 200);
  const fileUrl: string = up.json.url;
  ok('upload: anonymous 401, disallowed types 415, valid file accepted');

  // 6. download access: owner yes, outsider no, buyer only once referenced
  assert.strictEqual((await api(fileUrl)).status, 401);
  assert.strictEqual((await api(fileUrl, { token: seller })).status, 200);
  assert.strictEqual((await api(fileUrl, { token: outsider })).status, 403);
  assert.strictEqual((await api(fileUrl, { token: buyer })).status, 403, 'buyer must not access an unreferenced private upload');
  ok('download: anonymous 401, owner 200, outsider 403, unreferenced upload hidden from buyer');

  // 7. cannot attach / deliver someone else's file or placeholders
  const stolen = await api(`/api/orders/${ORDER}/message`, { method: 'POST', token: buyer, body: { text: 'f', type: 'file', fileInfo: { name: 'x', url: fileUrl } } });
  assert.strictEqual(stolen.status, 400);
  ok('cannot attach another user\'s uploaded file');

  // 8. lifecycle: nothing delivered yet -> release & revision refused
  const early = await api('/api/payments/escrow/release', { method: 'POST', token: buyer, body: { orderId: ORDER } });
  assert.strictEqual(early.status, 400, 'release before delivery must be refused');
  const earlyRev = await api(`/api/orders/${ORDER}/revision`, { method: 'POST', token: buyer, body: { reason: 'redo' } });
  assert.strictEqual(earlyRev.status, 409, 'revision before delivery must be refused');
  ok('release and revision refused before any delivery');

  // 9. delivery validation
  const placeholder = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { files: [{ name: 'x.zip', url: '#' }] } });
  assert.strictEqual(placeholder.status, 400);
  const empty = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { files: [] } });
  assert.strictEqual(empty.status, 400);
  const notMine = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { files: [{ name: 'x.pdf', url: '/api/workstream/files/does_not_exist.pdf' }] } });
  assert.strictEqual(notMine.status, 400);
  const delivered = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { notes: 'v1', files: [{ name: 'final.pdf', url: fileUrl }] } });
  assert.strictEqual(delivered.status, 200);
  assert.strictEqual(delivered.json.order.status, 'delivered');
  ok('delivery: placeholder/empty/missing rejected, real uploaded file accepted');

  // 10. buyer can now download the delivered file; outsider still cannot
  assert.strictEqual((await api(fileUrl, { token: buyer })).status, 200);
  assert.strictEqual((await api(fileUrl, { token: outsider })).status, 403);
  ok('delivered file visible to buyer only (plus seller/staff)');

  // 11. revision -> redelivery
  assert.strictEqual((await api(`/api/orders/${ORDER}/revision`, { method: 'POST', token: buyer, body: { reason: '' } })).status, 400);
  const rev = await api(`/api/orders/${ORDER}/revision`, { method: 'POST', token: buyer, body: { reason: 'Please adjust the colours' } });
  assert.strictEqual(rev.status, 200);
  assert.strictEqual(rev.json.order.status, 'revision');
  const up2 = await api('/api/workstream/upload?name=final_v2.pdf', { method: 'POST', token: seller, raw: Buffer.from('%PDF v2'), headers: { 'Content-Type': 'application/pdf' } });
  const redelivered = await api(`/api/orders/${ORDER}/deliverable`, { method: 'POST', token: seller, body: { files: [{ name: 'final_v2.pdf', url: up2.json.url }] } });
  assert.strictEqual(redelivered.status, 200);
  assert.strictEqual(redelivered.json.order.deliveryHistory.length, 2, 'both delivery versions persist');
  ok('revision requested and v2 delivered; both versions stored');

  // 12. release: only buyer, only once
  assert.strictEqual((await api('/api/payments/escrow/release', { method: 'POST', token: outsider, body: { orderId: ORDER } })).status, 403);
  assert.strictEqual((await api('/api/payments/escrow/release', { method: 'POST', token: seller, body: { orderId: ORDER } })).status, 403);
  const released = await api('/api/payments/escrow/release', { method: 'POST', token: buyer, body: { orderId: ORDER, requestKey: 'test-release-1' } });
  assert.strictEqual(released.status, 200, `release should succeed after delivery: ${JSON.stringify(released.json)}`);
  assert.strictEqual(released.json.order.status, 'completed');
  assert.strictEqual((await api('/api/payments/escrow/release', { method: 'POST', token: buyer, body: { orderId: ORDER } })).status, 400, 'second release refused');
  ok('escrow release: buyer only, completes order, cannot repeat');

  // 13. review
  assert.strictEqual((await api('/api/reviews', { method: 'POST', token: outsider, body: { orderId: ORDER, targetUserId: 'usr_4', rating: 5, comment: 'x' } })).status, 403);
  assert.strictEqual((await api('/api/reviews', { method: 'POST', token: buyer, body: { orderId: ORDER, targetUserId: 'usr_4', rating: 5, comment: '   ' } })).status, 400);
  const review = await api('/api/reviews', { method: 'POST', token: buyer, body: { orderId: ORDER, targetUserId: 'usr_4', rating: 4, comment: 'Solid work' } });
  assert.strictEqual(review.status, 201);
  assert.strictEqual((await api('/api/reviews', { method: 'POST', token: buyer, body: { orderId: ORDER, targetUserId: 'usr_4', rating: 4, comment: 'again' } })).status, 409);
  const profileReviews = await api('/api/users/usr_4/reviews');
  assert.ok(profileReviews.json.some((r: any) => r.orderId === ORDER && r.comment === 'Solid work'), 'review visible on seller profile');
  ok('review: validated, one per order, visible on seller profile');

  console.log(`\n🎉 ${passed} Workstream security/lifecycle checks passed`);
}

run()
  .then(() => { restoreData(); process.exit(0); })
  .catch(err => { console.error('❌ Workstream test failed:', err); restoreData(); process.exit(1); });

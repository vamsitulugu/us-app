// Pro / Razorpay tests — run:  node tests/pro.test.js
// Uses an in-memory fake Supabase and a fake Razorpay order call: no network, no keys.
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const Module = require('module');

process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
process.env.RAZORPAY_KEY_SECRET = 'test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';

// ── fake supabase ────────────────────────────────────────────────
const db = {
  couples: [{ id: 'c1', pro_plan: null, pro_expires_at: null }],
  users: [{ id: 'u1', name: 'Vamsi', phone_number: '+911234567890', couple_id: 'c1', account_status: 'active' },
          { id: 'u9', name: 'Other', phone_number: '+910000000000', couple_id: 'c2', account_status: 'active' }],
  pro_payments: []
};
function table(name) {
  const st = { f: [], op: 'select', patch: null, one: false };
  const q = {
    select() { return q; },
    insert(row) { st.op = 'insert'; db[name].push({ id: 'p' + db[name].length, ...row }); return Promise.resolve({ error: null }); },
    update(patch) { st.op = 'update'; st.patch = patch; return q; },
    eq(k, v) { st.f.push(r => String(r[k]) === String(v)); return q; },
    neq(k, v) { st.f.push(r => String(r[k]) !== String(v)); return q; },
    order() { return q; }, limit() { return q; },
    maybeSingle() { st.one = true; return q; },
    then(res, rej) {
      const rows = db[name].filter(r => st.f.every(f => f(r)));
      if (st.op === 'update') rows.forEach(r => Object.assign(r, st.patch));
      const out = st.one ? { data: rows[0] || null, error: null } : { data: rows, error: null };
      return Promise.resolve(out).then(res, rej);
    }
  };
  return q;
}
const fakeSupabase = { from: table };
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (/(^|\/)supabase$/.test(req)) return fakeSupabase;
  return origLoad.call(this, req, parent, ...rest);
};

const rzp = require('../lib/razorpay');
let orderCount = 0;
rzp.createOrder = async ({ amountPaise }) => ({ id: 'order_' + (++orderCount), amount: amountPaise });
const proRoute = require('../routes/pro');
const { PLANS, applyPurchase, statusFromCouple } = require('../lib/pro-plans');
const express = require('express');

(async () => {
  // plans & prices
  assert.strictEqual(PLANS.monthly.amountPaise, 9900);
  assert.strictEqual(PLANS.yearly.amountPaise, 49900);
  assert.strictEqual(PLANS.lifetime.amountPaise, 99900);

  // entitlement maths
  const now = new Date('2026-11-01T00:00:00Z');
  let r = applyPurchase({}, 'monthly', now);
  assert.strictEqual(r.pro_plan, 'monthly');
  assert.strictEqual(r.pro_expires_at, '2026-12-01T00:00:00.000Z');
  r = applyPurchase({ pro_plan: 'monthly', pro_expires_at: '2026-11-11T00:00:00Z' }, 'monthly', now);
  assert.strictEqual(r.pro_expires_at, '2026-12-11T00:00:00.000Z', 'renewing extends from current expiry');
  r = applyPurchase({ pro_plan: 'yearly', pro_expires_at: '2027-05-01T00:00:00Z' }, 'monthly', now);
  assert.strictEqual(r.pro_plan, 'yearly', 'monthly never replaces an active yearly');
  r = applyPurchase({ pro_plan: 'monthly', pro_expires_at: '2026-11-11T00:00:00Z' }, 'lifetime', now);
  assert.deepStrictEqual(r, { pro_plan: 'lifetime', pro_expires_at: null });
  assert.strictEqual(statusFromCouple({ pro_plan: 'monthly', pro_expires_at: '2026-10-01T00:00:00Z' }, now).isPro, false, 'expired = free');
  assert.strictEqual(statusFromCouple({ pro_plan: 'lifetime' }, now).isPro, true);

  // signatures
  const sig = crypto.createHmac('sha256', 'test_secret').update('order_x|pay_x').digest('hex');
  assert(rzp.verifyPaymentSignature('order_x', 'pay_x', sig));
  assert(!rzp.verifyPaymentSignature('order_x', 'pay_y', sig));
  assert(!rzp.verifyPaymentSignature('order_x', 'pay_x', 'deadbeef'));

  // http app
  const app = express();
  app.post('/api/pro/webhook', express.raw({ type: '*/*' }), proRoute.webhook);
  app.use(express.json());
  app.use('/api/pro', proRoute);
  const srv = await new Promise(ok => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api/pro`;
  const call = async (method, path, body, headers = {}, raw) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: raw || (body ? JSON.stringify(body) : undefined) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };

  assert.strictEqual((await call('GET', '/status?coupleId=c1')).json.isPro, false);

  // create-order rules
  assert.strictEqual((await call('POST', '/create-order', { coupleId: 'c1', plan: 'weekly', userId: 'u1' })).status, 400);
  assert.strictEqual((await call('POST', '/create-order', { coupleId: 'c1', plan: 'monthly', userId: 'u9' })).status, 403, 'user from another couple');
  assert.strictEqual((await call('POST', '/create-order', { coupleId: 'c1', plan: 'monthly' })).status, 403, 'no user');
  const o = await call('POST', '/create-order', { coupleId: 'c1', plan: 'yearly', userId: 'u1' });
  assert.strictEqual(o.status, 200);
  assert.strictEqual(o.json.amount, 49900);
  assert.strictEqual(o.json.keyId, 'rzp_test_abc');

  // verify: bad signature must not grant
  let v = await call('POST', '/verify', { coupleId: 'c1', userId: 'u1', razorpay_order_id: o.json.orderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'abcd' });
  assert.strictEqual(v.status, 400);
  assert.strictEqual((await call('GET', '/status?coupleId=c1')).json.isPro, false);

  // verify: good signature grants yearly, and is idempotent
  const good = crypto.createHmac('sha256', 'test_secret').update(`${o.json.orderId}|pay_1`).digest('hex');
  const body = { coupleId: 'c1', userId: 'u1', razorpay_order_id: o.json.orderId, razorpay_payment_id: 'pay_1', razorpay_signature: good };
  v = await call('POST', '/verify', body);
  assert.strictEqual(v.status, 200);
  assert.strictEqual(v.json.plan, 'yearly');
  const firstExpiry = v.json.expiresAt;
  v = await call('POST', '/verify', body);
  assert.strictEqual(v.json.expiresAt, firstExpiry, 'second verify must not extend again');

  // webhook after verify: no double grant; bad signature rejected
  const evt = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: o.json.orderId } } } });
  const hsig = crypto.createHmac('sha256', 'hook_secret').update(evt).digest('hex');
  assert.strictEqual((await call('POST', '/webhook', null, { 'x-razorpay-signature': 'nope' }, evt)).status, 400);
  assert.strictEqual((await call('POST', '/webhook', null, { 'x-razorpay-signature': hsig }, evt)).status, 200);
  assert.strictEqual((await call('GET', '/status?coupleId=c1')).json.expiresAt, firstExpiry);

  // webhook alone can grant (app was closed before verify)
  const o2 = await call('POST', '/create-order', { coupleId: 'c1', plan: 'lifetime', userId: 'u1' });
  const evt2 = JSON.stringify({ event: 'order.paid', payload: { payment: { entity: { id: 'pay_2', order_id: o2.json.orderId } } } });
  const h2 = crypto.createHmac('sha256', 'hook_secret').update(evt2).digest('hex');
  assert.strictEqual((await call('POST', '/webhook', null, { 'x-razorpay-signature': h2 }, evt2)).status, 200);
  assert.strictEqual((await call('GET', '/status?coupleId=c1')).json.plan, 'lifetime');
  assert.strictEqual((await call('POST', '/create-order', { coupleId: 'c1', plan: 'monthly', userId: 'u1' })).status, 409, 'lifetime cannot buy again');

  // the old receipt/history endpoint is gone
  assert.notStrictEqual((await call('GET', '/history?coupleId=c1&userId=u1')).status, 200);

  srv.close();
  console.log('pro tests passed');
})().catch(e => { console.error(e); process.exit(1); });

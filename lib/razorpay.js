// ════════════════════════════════════════════════════════════════
//  lib/razorpay.js — tiny Razorpay client (no SDK dependency)
//  Env vars (set on Render, never commit them):
//    RAZORPAY_KEY_ID          rzp_test_xxx / rzp_live_xxx   (public)
//    RAZORPAY_KEY_SECRET      secret — signs/verifies payments
//    RAZORPAY_WEBHOOK_SECRET  secret you type in the Razorpay dashboard
// ════════════════════════════════════════════════════════════════
const https = require('https');
const crypto = require('crypto');

const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';
const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || '';

function isConfigured() { return !!(keyId() && keySecret()); }

function safeEqualHex(a, b) {
  try {
    const x = Buffer.from(String(a || ''), 'hex');
    const y = Buffer.from(String(b || ''), 'hex');
    return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch (e) { return false; }
}

/** Razorpay Orders API: POST /v1/orders */
function createOrder({ amountPaise, receipt, notes }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes: notes || {} });
    const req = https.request({
      hostname: 'api.razorpay.com',
      path: '/v1/orders',
      method: 'POST',
      auth: `${keyId()}:${keySecret()}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* non-JSON error page */ }
        if (res.statusCode >= 200 && res.statusCode < 300 && json && json.id) return resolve(json);
        const msg = (json && json.error && json.error.description) || `Razorpay error ${res.statusCode}`;
        reject(new Error(msg));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Razorpay request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret) */
function verifyPaymentSignature(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature || !keySecret()) return false;
  const expected = crypto.createHmac('sha256', keySecret()).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook_secret) */
function verifyWebhookSignature(rawBody, signature) {
  if (!rawBody || !signature || !webhookSecret()) return false;
  const expected = crypto.createHmac('sha256', webhookSecret()).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

module.exports = { keyId, isConfigured, createOrder, verifyPaymentSignature, verifyWebhookSignature };

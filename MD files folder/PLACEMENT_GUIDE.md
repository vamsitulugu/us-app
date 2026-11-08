# Pro subscription — placement guide (retired)

This guide described the old manual UPI QR + payment-screenshot + admin-approval
system. That system has been removed. Pro is now paid through Razorpay directly
(same flow as the Android app).

See `RAZORPAY_SETUP.md` for setup. Code lives in:
- `routes/pro.js` — plans, status, create-order, verify, webhook
- `routes/admin-payments.js` — admin revenue view + payment re-check
- `lib/razorpay.js`, `lib/pro-plans.js`, `middleware/pro.js`
- `public/js/pro-card.js`, `public/pro.html` — web checkout

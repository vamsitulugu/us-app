# Pro with Razorpay — setup (do these once)

## 1. Database
Run `migrations/pro_razorpay.sql` in the Supabase SQL editor
(after `migrations/pro_subscription.sql`, which you already ran).

## 2. Render environment variables
| Name | Value |
|---|---|
| `RAZORPAY_KEY_ID` | `rzp_test_...` while testing, `rzp_live_...` when real |
| `RAZORPAY_KEY_SECRET` | the secret shown next to the key |
| `RAZORPAY_WEBHOOK_SECRET` | any long random text — you type the same text in step 3 |

Never put the secret in the web app, the Android app or git. The apps only
receive the public key id from the server.

## 3. Webhook (so Pro still activates if the app closes mid-payment)
Razorpay Dashboard → Settings → Webhooks → Add:
- URL: `https://us-app-av6d.onrender.com/api/pro/webhook`
- Secret: the same `RAZORPAY_WEBHOOK_SECRET`
- Events: `payment.captured` and `order.paid`

Also keep Razorpay's payment capture on **Automatic**
(Settings → Payment Capture), otherwise payments stay "authorized" and are
refunded after a few days.

## 4. Test mode
Use test keys and Razorpay's test UPI/card details from their docs.
Test payments appear under Test Mode in the dashboard.

## Plans (set in `lib/pro-plans.js`)
Monthly ₹99 = 30 days · Yearly ₹499 = 365 days · Lifetime ₹999.
Monthly/Yearly are one-time payments (no auto-renew). Buying again adds days
on top of what is left.

## What is gated (web, Android app and the server)
Twin AI Both mode · Memory Globe "Pin a Memory" · Music "add songs" ·
Watch Together cloud upload. The server answers HTTP 402 `PRO_REQUIRED`
for these when the couple is not Pro, so hiding buttons is not the only lock.

## Tests
`npm run test:pro`

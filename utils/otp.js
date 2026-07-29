// ═══════════════════════════════════════════════════════
//  OTP helpers — generate, hash, and (attempt to) deliver
// ═══════════════════════════════════════════════════════
const bcrypt = require('bcryptjs');

const OTP_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

async function hashOtp(code) {
  return bcrypt.hash(code, 10);
}

async function verifyOtp(code, hash) {
  return bcrypt.compare(code, hash);
}

// Sends the OTP over SMS if Twilio credentials are configured.
// Falls back to logging it to the server console ONLY outside production.
// In production, if Twilio isn't configured or fails, the code is never
// written to any log — the request fails loudly instead.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function sendOtpSms(phoneNumber, code) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  const twilioConfigured = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER;

  if (twilioConfigured) {
    try {
      const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await twilio.messages.create({
        body: `Your Twin Hearts verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
        from: TWILIO_FROM_NUMBER,
        to: phoneNumber
      });
      return { delivered: true, channel: 'sms' };
    } catch (err) {
      console.error('Twilio send failed:', err.message);
      if (IS_PRODUCTION) {
        throw new Error('Failed to send verification code. Please try again shortly.');
      }
      console.log(`📱 [DEV OTP FALLBACK, Twilio error] ${phoneNumber} -> ${code} (expires in ${OTP_TTL_MINUTES}m)`);
      return { delivered: false, channel: 'console' };
    }
  }

  if (IS_PRODUCTION) {
    console.error('OTP send blocked: Twilio is not configured and NODE_ENV=production, so the console fallback is disabled.');
    throw new Error('SMS delivery is not configured. Please contact support.');
  }

  console.log(`📱 [DEV OTP] ${phoneNumber} -> ${code} (expires in ${OTP_TTL_MINUTES}m)`);
  return { delivered: false, channel: 'console' };
}

module.exports = {
  OTP_TTL_MINUTES,
  MAX_ATTEMPTS,
  generateOtp,
  hashOtp,
  verifyOtp,
  sendOtpSms
};
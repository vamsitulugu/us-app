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
// Falls back to logging it to the server console in dev/test,
// so the flow is fully usable before an SMS provider is wired up.
async function sendOtpSms(phoneNumber, code) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
    try {
      const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await twilio.messages.create({
        body: `Your Twin Hearts verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
        from: TWILIO_FROM_NUMBER,
        to: phoneNumber
      });
      return { delivered: true, channel: 'sms' };
    } catch (err) {
      console.error('Twilio send failed, falling back to console log:', err.message);
    }
  }
  // Dev fallback — never do this in a real production SMS path.
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

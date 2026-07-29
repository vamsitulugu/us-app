// ═══════════════════════════════════════════════════════
//  Mailer helpers — verification / password-reset emails.
//  Mirrors utils/otp.js's delivery pattern: sends via SMTP
//  if configured, otherwise logs to console ONLY outside
//  production. In production with no SMTP configured (or a
//  send failure), the link is never logged — the request
//  fails loudly instead.
// ═══════════════════════════════════════════════════════
const nodemailer = require('nodemailer');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const APP_NAME = 'Twin Hearts';
const FROM_ADDRESS = process.env.SMTP_FROM || 'Twin Hearts <no-reply@usapp.love>';

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

async function sendMail({ to, subject, html, text, logFallbackLabel }) {
  const tx = getTransporter();

  if (tx) {
    try {
      await tx.sendMail({ from: FROM_ADDRESS, to, subject, html, text });
      return { delivered: true, channel: 'smtp' };
    } catch (err) {
      console.error('SMTP send failed:', err.message);
      if (IS_PRODUCTION) {
        throw new Error('Failed to send email. Please try again shortly.');
      }
      console.log(`✉️  [DEV EMAIL FALLBACK, SMTP error] ${logFallbackLabel}`);
      return { delivered: false, channel: 'console' };
    }
  }

  if (IS_PRODUCTION) {
    console.error('Email send blocked: SMTP is not configured and NODE_ENV=production, so the console fallback is disabled.');
    throw new Error('Email delivery is not configured. Please contact support.');
  }

  console.log(`✉️  [DEV EMAIL] ${logFallbackLabel}`);
  return { delivered: false, channel: 'console' };
}

function sendVerificationEmail(email, link) {
  return sendMail({
    to: email,
    subject: `Verify your email for ${APP_NAME}`,
    html: `<p>Hi,</p><p>Tap the link below to verify your email and finish signing up for ${APP_NAME}:</p><p><a href="${link}">${link}</a></p><p>This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>`,
    text: `Verify your email for ${APP_NAME}: ${link} (expires in 30 minutes)`,
    logFallbackLabel: `verify ${email} -> ${link}`
  });
}

function sendPasswordResetEmail(email, link) {
  return sendMail({
    to: email,
    subject: `Reset your ${APP_NAME} password`,
    html: `<p>Hi,</p><p>Tap the link below to reset your ${APP_NAME} password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>`,
    text: `Reset your ${APP_NAME} password: ${link} (expires in 30 minutes)`,
    logFallbackLabel: `reset ${email} -> ${link}`
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
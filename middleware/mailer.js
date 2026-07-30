// ═══════════════════════════════════════════════════════
//  Mailer — thin wrapper around nodemailer used ONLY for the
//  Forgot Password feature. Nothing else in the app sends email,
//  so this is additive and doesn't touch any existing flow.
//
//  Configure via .env (all optional — if SMTP_HOST is missing the
//  app still works, it just logs the email to the console instead
//  of actually sending it, so local/dev setups never crash):
//
//    SMTP_HOST=smtp.yourprovider.com
//    SMTP_PORT=587
//    SMTP_SECURE=false          (true if using port 465)
//    SMTP_USER=apikey_or_username
//    SMTP_PASS=your_smtp_password_or_api_key
//    MAIL_FROM="Twin Hearts <no-reply@usapp.love>"
//    APP_PUBLIC_URL=https://twinhearts.vercel.app   (used to build the reset link)
// ═══════════════════════════════════════════════════════
const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
} else {
  console.warn('[mailer] SMTP_HOST/SMTP_USER/SMTP_PASS not set — password reset emails will be logged to the console instead of sent.');
}

const FROM = process.env.MAIL_FROM || '"Twin Hearts 💕" <no-reply@usapp.love>';

function resetPasswordEmailHtml({ name, resetLink, expiresInMinutes }) {
  const safeName = name ? String(name).split(/[<>]/)[0] : 'there';
  return `
  <div style="background:#050303;padding:40px 16px;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#0b0606;border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:36px 32px;color:rgba(255,255,255,.92);">
      <div style="text-align:center;margin-bottom:22px;">
        <div style="font-family:Georgia,serif;font-size:22px;color:#fff;">Twin Hearts</div>
        <div style="font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#bc041d;margin-top:4px;">Everything Together</div>
      </div>
      <p style="font-size:14px;line-height:1.7;color:rgba(255,255,255,.85);">Hi ${safeName},</p>
      <p style="font-size:14px;line-height:1.7;color:rgba(255,255,255,.85);">
        We received a request to reset the password for your Twin Hearts account. Click the button
        below to choose a new password.
      </p>
      <div style="text-align:center;margin:30px 0;">
        <a href="${resetLink}"
           style="display:inline-block;padding:14px 30px;border-radius:13px;background:linear-gradient(135deg,#bc041d,#b41e2f);color:#fff;text-decoration:none;font-weight:600;font-size:14px;">
          Reset Password
        </a>
      </div>
      <p style="font-size:12.5px;line-height:1.7;color:rgba(255,255,255,.55);">
        This link expires in ${expiresInMinutes} minutes. If it has expired, you can request a new one
        from the Sign In screen.
      </p>
      <p style="font-size:12.5px;line-height:1.7;color:rgba(255,255,255,.55);">
        If you didn't request this, you can safely ignore this email — your password will not be
        changed.
      </p>
      <p style="font-size:11px;color:rgba(255,255,255,.35);margin-top:26px;word-break:break-all;">
        Or paste this link into your browser: ${resetLink}
      </p>
    </div>
  </div>`;
}

async function sendPasswordResetEmail({ to, name, resetLink, expiresInMinutes }) {
  const html = resetPasswordEmailHtml({ name, resetLink, expiresInMinutes });
  const text = `Hi ${name || 'there'},\n\nWe received a request to reset your Twin Hearts password. ` +
    `Open this link to choose a new password (expires in ${expiresInMinutes} minutes):\n\n${resetLink}\n\n` +
    `If you didn't request this, you can ignore this email.`;

  if (!transporter) {
    // Dev fallback — never blocks the flow, just makes the link visible
    // in server logs so the feature is testable without SMTP configured.
    console.log(`\n[mailer] (SMTP not configured) Password reset email for ${to}:\n${resetLink}\n`);
    return { delivered: false, logged: true };
  }

  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Reset your Twin Hearts password',
    text,
    html
  });
  return { delivered: true };
}

module.exports = { sendPasswordResetEmail };
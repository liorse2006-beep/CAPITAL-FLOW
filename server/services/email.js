const nodemailer = require('nodemailer');
const { GMAIL_USER, GMAIL_APP_PASSWORD } = require('../config');

function createTransport() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

async function sendOTPEmail(email, code) {
  const transport = createTransport();
  if (!transport) {
    console.log(`[EMAIL DEV] OTP for ${email}: ${code}`);
    return;
  }
  await transport.sendMail({
    from: `"Capital Flow" <${GMAIL_USER}>`,
    to: email,
    subject: `Your verification code: ${code}`,
    html: `
      <div style="background:#0A0A0A;padding:40px;font-family:sans-serif;color:#e4e4e7;max-width:480px;margin:0 auto;border-radius:8px;">
        <div style="color:#F59E0B;font-size:13px;font-weight:700;letter-spacing:.12em;margin-bottom:24px;">CAPITAL FLOW</div>
        <h2 style="font-size:22px;margin-bottom:8px;color:#fff;">Verify your email</h2>
        <p style="color:#71717a;font-size:14px;margin-bottom:32px;">Enter this code in the app to confirm your email address.</p>
        <div style="background:#111;border:1px solid #222;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#F59E0B;font-family:monospace;">${code}</span>
        </div>
        <p style="color:#525252;font-size:12px;">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(email, code) {
  const transport = createTransport();
  if (!transport) {
    console.log(`[EMAIL DEV] Reset OTP for ${email}: ${code}`);
    return;
  }
  await transport.sendMail({
    from: `"Capital Flow" <${GMAIL_USER}>`,
    to: email,
    subject: `Password reset code: ${code}`,
    html: `
      <div style="background:#0A0A0A;padding:40px;font-family:sans-serif;color:#e4e4e7;max-width:480px;margin:0 auto;border-radius:8px;">
        <div style="color:#F59E0B;font-size:13px;font-weight:700;letter-spacing:.12em;margin-bottom:24px;">CAPITAL FLOW</div>
        <h2 style="font-size:22px;margin-bottom:8px;color:#fff;">Reset your password</h2>
        <p style="color:#71717a;font-size:14px;margin-bottom:32px;">Use this code to set a new password.</p>
        <div style="background:#111;border:1px solid #222;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#F59E0B;font-family:monospace;">${code}</span>
        </div>
        <p style="color:#525252;font-size:12px;">This code expires in 15 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

async function sendWelcomeEmail(email) {
  const transport = createTransport();
  if (!transport) {
    console.log(`[EMAIL DEV] Welcome email for ${email}`);
    return;
  }
  await transport.sendMail({
    from: `"Capital Flow" <${GMAIL_USER}>`,
    to: email,
    subject: `Welcome to Capital Flow`,
    html: `
      <div style="background:#0A0A0A;padding:40px;font-family:sans-serif;color:#e4e4e7;max-width:480px;margin:0 auto;border-radius:8px;">
        <div style="color:#F59E0B;font-size:13px;font-weight:700;letter-spacing:.12em;margin-bottom:24px;">CAPITAL FLOW</div>
        <h2 style="font-size:22px;margin-bottom:8px;color:#fff;">You're in 🎉</h2>
        <p style="color:#a0a0a8;font-size:14px;line-height:1.6;margin-bottom:24px;">
          Your account is ready. Run your first scan to find unusual volume spikes across the S&amp;P 500,
          NASDAQ 100, or any sector you pick.
        </p>
        <ul style="color:#71717a;font-size:13px;line-height:2;margin:0 0 28px;padding-left:18px;">
          <li>Every plan gets one free trial scan per tool</li>
          <li>Star a ticker to add it to your Watchlist</li>
          <li>Upgrade any time for higher scan limits and alerts</li>
        </ul>
        <p style="color:#525252;font-size:12px;">Questions or feedback? Just reply to this email, or use the feedback button in the app.</p>
      </div>
    `,
  });
}

module.exports = { sendOTPEmail, sendPasswordResetEmail, sendWelcomeEmail };

const nodemailer = require('nodemailer');
const path = require('path');
const { GMAIL_USER, GMAIL_APP_PASSWORD, ADMIN_EMAIL } = require('../config');

// Embedded via cid (not a hosted URL) so the logo renders regardless of
// image-proxying/allow-listing in the recipient's mail client.
const LOGO_ATTACHMENT = {
  filename: 'logo-gold.jpeg',
  path: path.join(__dirname, '../assets/logo-gold.jpeg'),
  cid: 'capitalflow-logo',
};

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
    attachments: [LOGO_ATTACHMENT],
    html: `
      <div style="background:#0A0A0A;padding:40px;font-family:sans-serif;color:#e4e4e7;max-width:480px;margin:0 auto;border-radius:8px;">
        <table role="presentation" width="100%" style="margin-bottom:24px;">
          <tr>
            <td style="color:#F59E0B;font-size:13px;font-weight:700;letter-spacing:.12em;vertical-align:middle;">CAPITAL FLOW</td>
            <td style="text-align:right;vertical-align:middle;">
              <img src="cid:capitalflow-logo" width="40" height="40" alt="Capital Flow" style="border-radius:50%;display:inline-block;" />
            </td>
          </tr>
        </table>
        <h2 style="font-size:22px;margin-bottom:4px;color:#fff;">You're in 🎉</h2>
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#F59E0B;margin-bottom:20px;">THANK YOU FOR CHOOSING US</div>
        <p style="color:#a0a0a8;font-size:14px;line-height:1.6;margin-bottom:20px;">
          We mean that — out of every scanner out there, you picked us, and we don't take that lightly.
          We're genuinely glad to have you here.
        </p>
        <p style="color:#a0a0a8;font-size:14px;line-height:1.6;margin-bottom:24px;">
          Your account is ready. Run your first scan to find unusual volume spikes.
        </p>
        <p style="color:#525252;font-size:12px;">
          Questions or feedback? We'd love to hear from you — find us on Instagram
          <a href="https://instagram.com/capital_flow67" style="color:#F59E0B;text-decoration:none;">@capital_flow67</a>.
        </p>
      </div>
    `,
  });
}

// Fires once per genuinely new account (not on every login) so the admin
// finds out about signups in real time instead of only via the /admin panel.
async function sendNewSignupAdminAlert(email, method) {
  const transport = createTransport();
  if (!transport || !ADMIN_EMAIL) {
    console.log(`[EMAIL DEV] New signup alert: ${email} via ${method}`);
    return;
  }
  await transport.sendMail({
    from: `"Capital Flow" <${GMAIL_USER}>`,
    to: ADMIN_EMAIL,
    subject: `New signup — ${email}`,
    text: `${email} just signed up via ${method}.`,
  });
}

module.exports = { sendOTPEmail, sendPasswordResetEmail, sendWelcomeEmail, sendNewSignupAdminAlert };

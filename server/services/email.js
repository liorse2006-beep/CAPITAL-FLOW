const { Resend } = require('resend');
const { RESEND_API_KEY, RESEND_FROM_EMAIL, ADMIN_EMAIL, FRONTEND_URL, STATUS_PUBLIC_URL } = require('../config');

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// A plain hosted URL, not a cid attachment — Resend (like most providers)
// still exposes cid-embedded images as a downloadable attachment chip in
// several mail clients even with an inline content-disposition, since the
// image still travels as its own MIME part either way. A hosted <img src>
// is a normal remote image with no attachment UI at all.
const LOGO_URL = FRONTEND_URL + '/logo-gold.jpeg';

function maskedEmail(email) {
  const value = String(email || '');
  const at = value.indexOf('@');
  if (at <= 1) return '[redacted]';
  return value[0] + '***' + value.slice(at);
}

function requireDevEmailFallback(label, email, detail) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Transactional email is not configured in production');
  }
  const suffix = detail ? `: ${detail}` : '';
  console.info(`[EMAIL DEV] ${label} for ${maskedEmail(email)}${suffix}`);
}

// The Resend SDK does NOT throw on an API-level failure (bad recipient,
// unverified domain, over quota, etc) — it resolves with { data, error }.
// Every caller here was previously just `await`ing the call and treating
// "didn't throw" as success, which meant a real failure would silently
// never surface anywhere, not even in server logs. This makes that
// impossible: any send() result with a non-null error becomes a real
// rejection, so every existing .catch() at the call sites actually fires.
async function send(payload) {
  const result = await resend.emails.send(payload);
  if (result && result.error) {
    throw new Error('[Resend] ' + (result.error.message || JSON.stringify(result.error)));
  }
  return result;
}

async function sendOTPEmail(email, code) {
  if (!resend) {
    requireDevEmailFallback('OTP', email, code);
    return;
  }
  await send({
    from: RESEND_FROM_EMAIL,
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
  if (!resend) {
    requireDevEmailFallback('Reset OTP', email, code);
    return;
  }
  await send({
    from: RESEND_FROM_EMAIL,
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
  if (!resend) {
    requireDevEmailFallback('Welcome email', email);
    return;
  }
  await send({
    from: RESEND_FROM_EMAIL,
    to: email,
    subject: `Welcome to Capital Flow`,
    html: `
      <div style="background:#0A0A0A;padding:40px;font-family:sans-serif;color:#e4e4e7;max-width:480px;margin:0 auto;border-radius:8px;">
        <table role="presentation" width="100%" style="margin-bottom:24px;">
          <tr>
            <td style="color:#F59E0B;font-size:13px;font-weight:700;letter-spacing:.12em;vertical-align:middle;">CAPITAL FLOW</td>
            <td style="text-align:right;vertical-align:middle;">
              <img src="${LOGO_URL}" width="40" height="40" alt="Capital Flow" style="border-radius:50%;display:inline-block;" />
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
          <a href="https://instagram.com/capital_flow555" style="color:#F59E0B;text-decoration:none;">@capital_flow555</a>.
        </p>
      </div>
    `,
  });
}

// Fires once per genuinely new account (not on every login) so the admin
// finds out about signups in real time instead of only via the /admin panel.
async function sendNewSignupAdminAlert(email, method) {
  if (!resend || !ADMIN_EMAIL) {
    requireDevEmailFallback('New signup alert', email, method);
    return;
  }
  await send({
    from: RESEND_FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject: `New signup — ${email}`,
    text: `${email} just signed up via ${method}.`,
  });
}

// Fires on every successful self-service Whop purchase (payment_succeeded)
// so the admin finds out about paid upgrades in real time, the same way
// sendNewSignupAdminAlert does for new signups — this is the only place a
// tier change made outside the admin panel itself gets surfaced by email.
async function sendAdminUpgradeAlert(email, tier) {
  if (!resend || !ADMIN_EMAIL) {
    requireDevEmailFallback('Upgrade alert', email, tier);
    return;
  }
  await send({
    from: RESEND_FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject: `💳 New ${tier} upgrade — ${email}`,
    text: `${email} just upgraded to ${tier} via Whop checkout.`,
  });
}

function statusEmailUrl() {
  return (STATUS_PUBLIC_URL || `${FRONTEND_URL || ''}/status`).replace(/\/+$/, '');
}

function statusIncidentText({ incident, component, checks, relatedComponents, recovery }) {
  const started = incident.started_at ? new Date(incident.started_at * 1000).toISOString() : 'unknown';
  const responseTime = checks.responseMs == null ? 'unknown' : `${checks.responseMs} ms`;
  const endpoint = checks.endpoint || component.path || component.type || 'not disclosed';
  const httpStatus = checks.statusCode == null ? 'n/a' : checks.statusCode;
  const errorEvidence = checks.errorMessage || 'No additional diagnostic evidence was returned.';
  const lines = recovery
    ? [
        'CAPITAL FLOW STATUS — INCIDENT RESOLVED',
        '========================================',
        '',
        'SUMMARY',
        `${component.name} is operational again. The system passed the configured recovery checks.`,
        '',
        'INCIDENT DETAILS',
        `Incident ID: ${incident.public_id}`,
        `Affected component: ${component.name}`,
        `Incident severity: ${incident.severity}`,
        `Started: ${started}`,
        `Recovered: ${incident.resolved_at ? new Date(incident.resolved_at * 1000).toISOString() : 'unknown'}`,
        `Total downtime: ${Math.max(0, incident.outage_seconds || 0)} seconds`,
        '',
        'RECOVERY EVIDENCE',
        `Failed checks before recovery: ${incident.failure_count ?? 'unknown'}`,
        `Successful recovery checks: ${incident.recovery_count ?? 'unknown'}`,
        `Current response time: ${responseTime}`,
      ]
    : [
        'CAPITAL FLOW STATUS — SITE FUNCTIONALITY ALERT',
        '===============================================',
        '',
        'SUMMARY',
        `A confirmed problem is affecting ${component.name}. Administrator action may be required.`,
        `User-facing impact: ${incident.public_summary || 'The affected functionality may not work normally.'}`,
        '',
        'INCIDENT DETAILS',
        `Incident ID: ${incident.public_id}`,
        `Severity: ${incident.severity}`,
        `Affected component: ${component.name}`,
        `Started: ${started}`,
        `Confirmed failed checks: ${incident.failure_count ?? 'unknown'}`,
        '',
        'DIAGNOSTIC EVIDENCE',
        `Endpoint: ${endpoint}`,
        `HTTP status: ${httpStatus}`,
        `Response time: ${responseTime}`,
        `Error returned: ${errorEvidence}`,
        'Root cause: Not determined automatically. The information above is evidence, not a confirmed root cause.',
        '',
        'SYSTEM CORRELATION',
        relatedComponents || 'Status correlation is still in progress.',
        '',
        'RECOMMENDED NEXT CHECKS',
        'Review the affected component, recent deployments, provider availability, and the latest private diagnostics.',
      ];
  lines.push('', `STATUS PAGE`, statusEmailUrl());
  return lines.join('\n');
}

async function sendStatusIncidentAlert(payload) {
  const { recipient, incident, component, checks, relatedComponents } = payload;
  const subject = `[Capital Flow] SITE IMPACT — ${incident.title} (${incident.severity})`;
  const text = statusIncidentText({ incident, component, checks, relatedComponents, recovery: false });
  if (!resend) {
    requireDevEmailFallback('Status outage alert', recipient, incident.public_id);
    return;
  }
  await send({ from: RESEND_FROM_EMAIL, to: recipient, subject, text });
}

async function sendStatusRecoveryAlert(payload) {
  const { recipient, incident, component, checks } = payload;
  const subject = `[Capital Flow] RESOLVED — ${incident.title}`;
  const text = statusIncidentText({ incident, component, checks, recovery: true });
  if (!resend) {
    requireDevEmailFallback('Status recovery alert', recipient, incident.public_id);
    return;
  }
  await send({ from: RESEND_FROM_EMAIL, to: recipient, subject, text });
}

module.exports = {
  sendOTPEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendNewSignupAdminAlert,
  sendAdminUpgradeAlert,
  sendStatusIncidentAlert,
  sendStatusRecoveryAlert,
  statusIncidentText,
};

// The Gmail transactional fallback must be exercised without contacting a
// real provider. This subprocess starts with Resend disabled, replaces
// Nodemailer's transport with an in-memory spy, and verifies the exact
// message shape used for a password reset.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const EMAIL_SERVICE_PATH = path.join(__dirname, '../server/services/email.js');

test('password reset uses configured Gmail SMTP when Resend is absent', () => {
  const script = `
    process.env.NODE_ENV = 'staging';
    process.env.JWT_SECRET = 'a'.repeat(48);
    process.env.SESSION_SECRET = 'b'.repeat(48);
    process.env.TURSO_DB_URL = 'file::memory:';
    process.env.RESEND_API_KEY = '';
    process.env.GMAIL_USER = 'mailer@example.test';
    process.env.GMAIL_APP_PASSWORD = 'test-app-password';
    process.env.FRONTEND_URL = 'https://capital-flow.test';

    const nodemailer = require('nodemailer');
    let sent;
    nodemailer.createTransport = () => ({
      sendMail: async (payload) => {
        sent = payload;
        return { messageId: 'mock-message-id' };
      },
    });

    const { sendPasswordResetEmail } = require(${JSON.stringify(EMAIL_SERVICE_PATH)});
    sendPasswordResetEmail('customer@example.test', '123456')
      .then(() => {
        process.stdout.write(JSON.stringify({ from: sent.from, to: sent.to, subject: sent.subject }));
      })
      .catch((error) => {
        process.stderr.write(error.message);
        process.exitCode = 1;
      });
  `;

  const output = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, RESEND_API_KEY: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '' },
    encoding: 'utf8',
  });
  const jsonLine = output
    .trim()
    .split(/\r?\n/)
    .findLast((line) => line.startsWith('{') && line.endsWith('}'));
  assert.ok(jsonLine, 'the mocked transport did not report a sent message');
  const sent = JSON.parse(jsonLine);

  assert.strictEqual(sent.from, '"Capital Flow" <mailer@example.test>');
  assert.strictEqual(sent.to, 'customer@example.test');
  assert.strictEqual(sent.subject, 'Password reset code: 123456');
});

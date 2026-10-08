// The Gmail transactional fallback must be exercised without contacting a
// real provider. This subprocess starts with Resend disabled, replaces
// Nodemailer's transport with an in-memory spy, and verifies the exact
// message shape used for a password reset.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const EMAIL_SERVICE_PATH = path.join(__dirname, '../server/services/email.js');

for (const sender of ['sendApplicationBackupEmail', 'sendStatusBackupEmail']) {
  test(`${sender} preserves gzip attachment bytes through the Gmail MIME transport`, () => {
    const script = `
      process.env.NODE_ENV = 'staging';
      process.env.JWT_SECRET = 'a'.repeat(48);
      process.env.SESSION_SECRET = 'b'.repeat(48);
      process.env.TURSO_DB_URL = 'file::memory:';
      process.env.RESEND_API_KEY = '';
      process.env.GMAIL_USER = 'mailer@example.test';
      process.env.GMAIL_APP_PASSWORD = 'synthetic-only';
      const nodemailer = require('nodemailer');
      const makeTransport = nodemailer.createTransport.bind(nodemailer);
      const transport = makeTransport({ streamTransport: true, buffer: true, newline: 'unix' });
      let mime;
      nodemailer.createTransport = () => ({ sendMail: async (payload) => {
        const result = await transport.sendMail(payload);
        mime = result.message.toString('utf8');
        return result;
      }});
      const content = require('node:zlib').gzipSync(Buffer.from('synthetic backup, no customer data'));
      require(${JSON.stringify(EMAIL_SERVICE_PATH)})[${JSON.stringify(sender)}]({
        recipient: 'backup@example.test', filename: 'fixture.json.gz', content,
        tableCount: 1, createdAt: '2026-10-09T00:00:00.000Z'
      }).then(() => {
        const attachment = mime.split(/\\r?\\n--/).find(part => part.includes('filename=fixture.json.gz'));
        if (!attachment) throw new Error('attachment missing');
        const encoded = attachment.split(/\\r?\\n\\r?\\n/).slice(1).join('').replace(/\\s/g, '');
        require('node:assert/strict').deepEqual(Buffer.from(encoded, 'base64'), content);
      }).catch(error => { console.error(error.message); process.exitCode = 1; });
    `;
    execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, RESEND_API_KEY: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '' },
      encoding: 'utf8',
    });
  });
}

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

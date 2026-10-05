require('./helpers/testEnv');
process.env.STATUS_ADMIN_TOKEN = '';
process.env.ADMIN_TOKEN = '';
process.env.ADMIN_EMAIL = '';
process.env.SESSION_SECRET = '';
process.env.INDEPENDENT_STATUS_SERVICE = 'true';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

test('a forged old status cookie signed with an empty key never opens operator data', async () => {
  const app = express();
  app.use(require('../server/routes/status'));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const signature = crypto.createHmac('sha256', '').update(`status-admin:${expires}`).digest('base64url');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/status/api/summary`, {
      headers: { Cookie: `cf_status_admin=${expires}.${signature}` },
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/);
  } finally {
    server.close();
  }
});

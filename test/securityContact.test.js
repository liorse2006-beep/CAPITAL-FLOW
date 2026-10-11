require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const serveSecurityContact = require('../server/services/securityContact');

test('the exact public security contact is served through Express despite dotfile defaults', async (t) => {
  const app = express();
  app.use(express.static(path.join(__dirname, '../public')));
  app.get('/.well-known/security.txt', serveSecurityContact);
  app.use((_req, res) => res.status(404).send('Not found'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const expected = fs.readFileSync(path.join(__dirname, '../public/.well-known/security.txt'), 'utf8');
  for (const suffix of ['', '?path=../../.env']) {
    const response = await fetch(`${origin}/.well-known/security.txt${suffix}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(await response.text(), expected);
  }
  assert.equal((await fetch(`${origin}/.well-known/.env`)).status, 404);
  assert.equal((await fetch(`${origin}/.env`)).status, 404);
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.match(source, /app\.get\('\/.well-known\/security\.txt', require\('\.\/services\/securityContact'\)\)/);
});

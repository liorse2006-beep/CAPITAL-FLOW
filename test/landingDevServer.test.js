const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLandingServer } = require('../tools/run-landing-dev');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'capital-flow-landing-boundary-'));
  const root = path.join(directory, 'LANDING PAGE');
  const sibling = path.join(directory, 'LANDING PAGE-private');
  await fs.mkdir(root);
  await fs.mkdir(sibling);
  await fs.writeFile(path.join(root, 'index.html'), 'PUBLIC_FIXTURE');
  await fs.writeFile(path.join(sibling, 'marker.txt'), 'PRIVATE_SYNTHETIC_MARKER');
  const server = createLandingServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { root, sibling, port: server.address().port };
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
  });
}

test('landing preview serves its public root without exposing filesystem paths', async (t) => {
  const { port } = await fixture(t);
  assert.equal((await request(port, '/')).body, 'PUBLIC_FIXTURE');
  const missing = await request(port, '/missing.html');
  assert.equal(missing.status, 404);
  assert.equal(missing.body, 'Not found');
});

test('landing preview rejects sibling-prefix and encoded traversal paths', async (t) => {
  const { port } = await fixture(t);
  for (const pathname of [
    '/../LANDING%20PAGE-private/marker.txt',
    '/%2e%2e/LANDING%20PAGE-private/marker.txt',
    '/..%2fLANDING%20PAGE-private%2fmarker.txt',
    '/..%5cLANDING%20PAGE-private%5cmarker.txt',
  ]) {
    const result = await request(port, pathname);
    assert.equal(result.status, 403, pathname);
    assert.doesNotMatch(result.body, /PRIVATE_SYNTHETIC_MARKER/);
  }
});

test('landing preview rejects symlink escapes after canonical path resolution', async (t) => {
  const { port, root, sibling } = await fixture(t);
  await fs.symlink(sibling, path.join(root, 'jump'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await request(port, '/jump/marker.txt');
  assert.equal(result.status, 403);
  assert.doesNotMatch(result.body, /PRIVATE_SYNTHETIC_MARKER/);
});

test('malformed percent encodings cannot crash the landing preview', async (t) => {
  const { port } = await fixture(t);
  for (const pathname of ['/%ZZ', '/%E0%A4%A', '/%00']) {
    assert.equal((await request(port, pathname)).status, 400);
  }
  assert.equal((await request(port, '/index.html')).body, 'PUBLIC_FIXTURE');
});

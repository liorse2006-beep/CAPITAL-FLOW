const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const { resolvePublicUrl, isPublicHttpUrl } = require('../server/utils/publicUrlResolver');

function mockHeads(t, handler) {
  const calls = [];
  const request = (url, options, callback) => {
    calls.push({ url, options });
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () =>
      process.nextTick(() => {
        const result = handler(url, options);
        callback({ statusCode: result.status || 200, headers: { location: result.location }, destroy() {} });
      });
    return req;
  };
  t.mock.method(http, 'request', request);
  t.mock.method(https, 'request', request);
  return calls;
}

for (const status of [301, 302, 303, 307, 308]) {
  test(`article ${status} redirect is checked before a loopback request`, async (t) => {
    t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
    const calls = mockHeads(t, () => ({ status, location: 'http://127.0.0.1/private' }));
    const original = 'https://article.fixture.test/story';
    assert.equal(await resolvePublicUrl(original), original);
    assert.equal(calls.length, 1, 'no request may reach the private redirect hop');
  });
}

test('literal private, reserved and credential-bearing URLs never enter DNS or HTTP', async (t) => {
  let lookups = 0;
  t.mock.method(dns, 'lookup', async () => {
    lookups++;
    throw new Error('unexpected DNS');
  });
  const calls = mockHeads(t, () => ({}));
  for (const original of [
    'http://localhost/a',
    'http://x.localhost/a',
    'http://127.1/a',
    'http://2130706433/a',
    'http://10.1.1.1/a',
    'http://172.16.0.1/a',
    'http://192.168.1.1/a',
    'http://169.254.169.254/a',
    'http://100.64.0.1/a',
    'http://198.18.0.1/a',
    'http://0.0.0.0/a',
    'http://224.0.0.1/a',
    'http://[::1]/a',
    'http://[::]/a',
    'http://[::ffff:127.0.0.1]/a',
    'http://[fc00::1]/a',
    'http://[fe80::1]/a',
    'http://[2001:db8::1]/a',
    'https://user:password@article.fixture.test/a',
    'https://article.fixture.test:8443/a',
    'file:///tmp/a',
    'javascript:alert(1)',
  ]) {
    assert.equal(isPublicHttpUrl(original), false, original);
    assert.equal(await resolvePublicUrl(original), original);
  }
  assert.equal(lookups, 0);
  assert.equal(calls.length, 0);
});

test('private or mixed DNS answers are rejected before creating a connection', async (t) => {
  const calls = mockHeads(t, () => ({}));
  let lookup = 0;
  t.mock.method(dns, 'lookup', async () =>
    ++lookup === 1
      ? [{ address: '127.0.0.1', family: 4 }]
      : [
          { address: '1.1.1.1', family: 4 },
          { address: '::ffff:192.168.1.1', family: 6 },
        ]
  );
  for (const original of ['https://private.fixture.test/a', 'https://mixed.fixture.test/a'])
    assert.equal(await resolvePublicUrl(original), original);
  assert.equal(calls.length, 0);
});

test('a relative public redirect resolves and the connection is pinned to validated DNS', async (t) => {
  let lookups = 0;
  t.mock.method(dns, 'lookup', async () => {
    lookups++;
    return [{ address: '1.1.1.1', family: 4 }];
  });
  const calls = mockHeads(t, (url, options) => {
    assert.equal(options.method, 'HEAD');
    assert.equal(options.agent, false);
    assert.equal(options.autoSelectFamily, false);
    assert.deepEqual(Object.keys(options.headers), ['User-Agent']);
    let checked = false;
    options.lookup(url.hostname, {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, '1.1.1.1');
      assert.equal(family, 4);
      checked = true;
    });
    assert.equal(checked, true, 'the transport lookup cannot resolve a new rebinding address');
    return url.pathname === '/first' ? { status: 302, location: '/final' } : {};
  });
  assert.equal(await resolvePublicUrl('https://article.fixture.test/first'), 'https://article.fixture.test/final');
  assert.equal(lookups, 2, 'every hop independently checks its DNS answers');
  assert.equal(calls.length, 2);
});

test('a hostname redirect whose DNS becomes private is never requested', async (t) => {
  t.mock.method(dns, 'lookup', async (host) => [
    { address: host === 'article.fixture.test' ? '1.1.1.1' : '127.0.0.1', family: 4 },
  ]);
  const calls = mockHeads(t, () => ({ status: 302, location: 'https://private.fixture.test/a' }));
  const original = 'https://article.fixture.test/first';
  assert.equal(await resolvePublicUrl(original), original);
  assert.equal(calls.length, 1);
});

test('redirect loops and chains are bounded', async (t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  const calls = mockHeads(t, (url) => ({
    status: 302,
    location: url.pathname === '/loop' ? '/loop' : '/hop' + calls.length,
  }));
  const loop = 'https://article.fixture.test/loop';
  assert.equal(await resolvePublicUrl(loop), loop);
  assert.equal(calls.length, 1);
  calls.length = 0;
  const chain = 'https://article.fixture.test/start';
  assert.equal(await resolvePublicUrl(chain), chain);
  assert.equal(calls.length, 5, 'initial request plus at most four redirects');
});

test('slow DNS admits four resolutions and no unbounded queue', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let lookups = 0;
  t.mock.method(dns, 'lookup', async () => {
    lookups++;
    await gate;
    return [{ address: '1.1.1.1', family: 4 }];
  });
  mockHeads(t, () => ({}));
  const work = Array.from({ length: 4 }, (_, i) => resolvePublicUrl(`https://article.fixture.test/${i}`));
  assert.equal(
    await resolvePublicUrl('https://article.fixture.test/overflow'),
    'https://article.fixture.test/overflow'
  );
  assert.equal(lookups, 4);
  release();
  await Promise.all(work);
});

test('a slow DNS deadline returns the original link and late DNS cannot open a socket', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(dns, 'lookup', async () => {
    await gate;
    return [{ address: '1.1.1.1', family: 4 }];
  });
  const calls = mockHeads(t, () => ({}));
  const original = 'https://article.fixture.test/slow';
  // Production deadline timers are unref'd; keep this isolated test alive.
  const keepAlive = setTimeout(() => {}, 7000);
  try {
    assert.equal(await resolvePublicUrl(original), original);
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls.length, 0, 'DNS completing after the total deadline cannot start a request');
  } finally {
    release();
    clearTimeout(keepAlive);
  }
});

test('a synchronous connection failure falls back safely and releases admission', async (t) => {
  let lookups = 0;
  t.mock.method(dns, 'lookup', async () => {
    lookups++;
    return [{ address: '1.1.1.1', family: 4 }];
  });
  t.mock.method(https, 'request', () => {
    throw new Error('synthetic connection failure');
  });
  for (let index = 0; index < 6; index++) {
    const original = `https://article.fixture.test/fail${index}`;
    assert.equal(await resolvePublicUrl(original), original);
  }
  assert.equal(lookups, 6, 'failures must not leak all four admission slots');
});

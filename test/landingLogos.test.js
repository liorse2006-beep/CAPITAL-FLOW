const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLandingLogoHandler } = require('../server/services/landingLogos');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    status(value) {
      this.statusCode = value;
      return this;
    },
    type(value) {
      this.headers['Content-Type'] = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

test('oversized vector logo uses a small raster alternative without raising the size limit', async () => {
  const calls = [];
  const raster = Buffer.from('synthetic small raster');
  const handler = createLandingLogoHandler({
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return url.includes('format=svg')
        ? new Response(Buffer.alloc(115_131), { headers: { 'Content-Type': 'image/svg+xml' } })
        : new Response(raster, { headers: { 'Content-Type': 'image/png' } });
    },
  });
  const result = responseRecorder();
  await handler({ params: { symbol: 'afl' } }, result);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, raster);
  assert.equal(result.headers['Content-Type'], 'image/png');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://assets.parqet.com/logos/symbol/AFL?format=svg&size=32');
  assert.equal(calls[1].url, 'https://assets.parqet.com/logos/symbol/AFL?format=png&size=32');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[0].options.signal, calls[1].options.signal);
});

test('oversized chunked vector is cancelled at the cap, not buffered to its end', async () => {
  let pulled = 0;
  let cancelled = false;
  let calls = 0;
  const handler = createLandingLogoHandler({
    fetchFn: async () => {
      calls += 1;
      if (calls === 2) return new Response('small', { headers: { 'Content-Type': 'image/png' } });
      const body = new ReadableStream(
        {
          pull(controller) {
            pulled += 1;
            controller.enqueue(new Uint8Array(60_000));
            if (pulled === 5) controller.close();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 }
      );
      return new Response(body, { headers: { 'Content-Type': 'image/svg+xml' } });
    },
  });
  const result = responseRecorder();
  await handler({ params: { symbol: 'AJG' } }, result);
  assert.equal(cancelled, true);
  assert.equal(pulled, 2);
  assert.equal(calls, 2);
  assert.equal(result.statusCode, 200);
});

test('ordinary vector remains a single cached upstream request', async () => {
  let calls = 0;
  const handler = createLandingLogoHandler({
    fetchFn: async () => {
      calls += 1;
      return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } });
    },
  });
  const results = [responseRecorder(), responseRecorder()];
  await Promise.all(results.map((res) => handler({ params: { symbol: 'AAPL' } }, res)));
  assert.equal(calls, 1);
  assert.deepEqual(results[0].body, Buffer.from('<svg/>'));
  assert.equal(results[1].headers['Content-Type'], 'image/svg+xml');
});

test('unsafe ticker never reaches an upstream URL', async () => {
  let calls = 0;
  const handler = createLandingLogoHandler({ fetchFn: async () => calls++ });
  const result = responseRecorder();
  await handler({ params: { symbol: '../../private?token=secret' } }, result);
  assert.equal(result.statusCode, 400);
  assert.equal(calls, 0);
  assert.equal(result.body, 'Invalid symbol');
});

test('genuinely absent logo stays a cached 404, not another provider retry', async () => {
  let calls = 0;
  const handler = createLandingLogoHandler({
    fetchFn: async () => {
      calls += 1;
      return new Response(null, { status: 404 });
    },
  });
  for (let i = 0; i < 2; i += 1) {
    const result = responseRecorder();
    await handler({ params: { symbol: 'MRSH' } }, result);
    assert.equal(result.statusCode, 404);
    assert.equal(result.body, 'Logo unavailable');
  }
  assert.equal(calls, 1);
});

test('oversized raster fallback is also rejected and cannot trigger a third request', async () => {
  let calls = 0;
  const handler = createLandingLogoHandler({
    fetchFn: async () => {
      calls += 1;
      return new Response(Buffer.alloc(100_001), { headers: { 'Content-Type': 'image/png' } });
    },
  });
  const result = responseRecorder();
  await handler({ params: { symbol: 'LARGE' } }, result);
  assert.equal(result.statusCode, 502);
  assert.equal(result.body, 'Logo unavailable');
  assert.equal(calls, 2);
});

test('declared oversized image is cancelled without pulling its body', async () => {
  let pulled = 0;
  let cancelled = false;
  let calls = 0;
  const handler = createLandingLogoHandler({
    fetchFn: async () => {
      calls += 1;
      if (calls === 2) return new Response('small', { headers: { 'Content-Type': 'image/png' } });
      const body = new ReadableStream(
        {
          pull() {
            pulled += 1;
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 }
      );
      return new Response(body, { headers: { 'Content-Type': 'image/svg+xml', 'Content-Length': '312968' } });
    },
  });
  const result = responseRecorder();
  await handler({ params: { symbol: 'AJG' } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(pulled, 0);
  assert.equal(cancelled, true);
});

test('HTML response is cancelled and never exposed as an image or retried', async () => {
  let calls = 0;
  const handler = createLandingLogoHandler({
    fetchFn: async () => {
      calls += 1;
      return new Response('<html>private debug information</html>', { headers: { 'Content-Type': 'text/html' } });
    },
  });
  const result = responseRecorder();
  await handler({ params: { symbol: 'AAPL' } }, result);
  assert.equal(result.statusCode, 502);
  assert.equal(result.body, 'Logo unavailable');
  assert.equal(calls, 1);
});

test('raster alternative shares the original five-second deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const signals = [];
  let fallbackStarted;
  const ready = new Promise((resolve) => {
    fallbackStarted = resolve;
  });
  const handler = createLandingLogoHandler({
    fetchFn: async (url, options) => {
      calls += 1;
      signals.push(options.signal);
      if (calls === 1) {
        return new Response(Buffer.alloc(100_001), { headers: { 'Content-Type': 'image/svg+xml' } });
      }
      fallbackStarted();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true });
      });
    },
  });
  const result = responseRecorder();
  const pending = handler({ params: { symbol: 'AFL' } }, result);
  await ready;
  t.mock.timers.tick(5000);
  await pending;
  assert.equal(result.statusCode, 502);
  assert.equal(result.body, 'Logo unavailable');
  assert.equal(calls, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(signals[1].aborted, true);
});

test('temporary upstream failure expires but remains deduplicated before retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const handler = createLandingLogoHandler({
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error('synthetic upstream failure');
      return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
    },
  });
  for (let i = 0; i < 2; i += 1) {
    const result = responseRecorder();
    await handler({ params: { symbol: 'AAPL' } }, result);
    assert.equal(result.statusCode, 502);
  }
  assert.equal(calls, 1);
  t.mock.timers.tick(15_000);
  const result = responseRecorder();
  await handler({ params: { symbol: 'AAPL' } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(calls, 2);
});

test('real isolated HTTP route returns the recovered image and security/cache headers', async () => {
  const express = require('express');
  const app = express();
  const handler = createLandingLogoHandler({
    fetchFn: async (url) =>
      url.includes('format=svg')
        ? new Response(Buffer.alloc(312_968), { headers: { 'Content-Type': 'image/svg+xml' } })
        : new Response('synthetic bounded raster', { headers: { 'Content-Type': 'image/png' } }),
  });
  app.get('/landing-logo/:symbol', handler);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/landing-logo/AJG`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400, stale-while-revalidate=604800');
    assert.equal(await response.text(), 'synthetic bounded raster');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

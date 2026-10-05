// End-to-end proof for the actual guarantee that matters: a customer's
// live alert must reach them regardless of which worker in the cluster is
// holding their SSE connection versus which worker is handling the request
// that triggered the alert. Unit tests on clusterBus.js only prove the
// pub/sub mechanics in a single process (this test runner is never itself
// a cluster worker) — they can't catch a mistake in server.js's actual
// primary<->worker relay wiring. This spawns the real `node server.js`
// with CLUSTER_WORKERS=2 as a child process and drives it over real HTTP.
//
// Slower and more involved than the rest of the suite on purpose — this is
// the one test standing between "looks correct" and "actually verified" for
// the exact failure mode (a customer silently never getting a notification)
// that this whole cluster-safety change exists to prevent.
//
// Named .js, not .test.js, so `npm test`'s default `test/**/*.test.js` glob
// (which node:test runs with many files in parallel) never picks it up —
// spawning 2-3 real child processes per attempt of THIS test, on top of
// dozens of other test files already running concurrently, starves
// everyone of CPU/disk I/O on a typical dev machine and made this flaky for
// reasons that have nothing to do with whether the cluster code is correct.
// Run it deliberately and in isolation with `npm run test:cluster` — after
// any change to server.js, clusterBus.js, routes/stream.js's broadcast
// path, or the SSE ticket logic in middleware/authMiddleware.js.
//
// Retry only if socket assignment fails to put the two clients on distinct
// workers. Delivery, authorization, admission and isolation failures must
// fail immediately, not be hidden by a later successful attempt. This local
// SQLite test is not evidence of remote Turso behavior or production capacity.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const JWT_SECRET = 'cluster-it-jwt-secret-'.padEnd(32, 'x');
const SESSION_SECRET = 'cluster-it-session-secret-'.padEnd(32, 'x');
// Realistic tabs/devices stay inside the production per-session limit.
const CONNECTION_COUNT = 2;

async function retryFetch(base, url, opts, attempts = 10) {
  let lastBody;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(base + url, { ...opts, signal: AbortSignal.timeout(3000) });
    if (res.status === 200) return res;
    lastBody = await res.text().catch(() => '');
    await new Promise((r) => setTimeout(r, 100 * (i + 1)));
  }
  throw new Error(`${url} never returned 200 after ${attempts} attempts; last body: ${lastBody}`);
}

function waitForHealth(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function poll() {
      fetch(base + '/health', { signal: AbortSignal.timeout(3000) })
        .then(async (r) => {
          await r.arrayBuffer();
          return r.ok ? resolve() : retry();
        })
        .catch(retry);
      function retry() {
        if (Date.now() > deadline) return reject(new Error('server did not become healthy in time'));
        setTimeout(poll, 200);
      }
    })();
  });
}

async function connectSse(base, ticket, attempt = 1) {
  const result = await connectSseOnce(base, ticket);
  if (result.authError && attempt < 10) {
    result.close();
    await new Promise((r) => setTimeout(r, 100 * attempt));
    return connectSse(base, ticket, attempt + 1);
  }
  if (result.authError) throw new Error('SSE connection kept getting auth-error after retries');
  return result;
}

async function waitForBothWorkers(base, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  const pids = new Set();
  while (Date.now() < deadline) {
    // Probe worker ownership on fresh sockets, not one keep-alive connection
    // that correctly remains attached to the same worker on Linux.
    const res = await fetch(base + '/api/stream/_test-worker-pid', {
      headers: { Connection: 'close' },
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    if (res && res.ok) {
      const body = await res.json();
      if (body.pid) pids.add(body.pid);
      if (pids.size >= 2) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`cluster did not expose both worker processes in ${timeoutMs}ms (saw ${[...pids]})`);
}

async function connectSseOnce(base, ticket) {
  const controller = new AbortController();
  // Each client models an independent tab/device. A pooled fetch connection
  // can reuse a socket already owned by one worker and invalidate that model.
  const res = await new Promise((resolve, reject) => {
    const request = http.get(
      `${base}/api/stream?ticket=${ticket}`,
      { agent: false, signal: controller.signal },
      resolve
    );
    request.once('error', reject);
  });
  if (res.statusCode !== 200) {
    controller.abort();
    throw new Error(`SSE admission returned ${res.statusCode}`);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  const pending = [];
  let waiter = null;

  (async function pump() {
    try {
      for await (const value of res) {
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const eventMatch = raw.match(/^event: (.+)$/m);
          const dataMatch = raw.match(/^data: (.+)$/m);
          if (eventMatch && dataMatch) {
            const msg = { event: eventMatch[1], data: JSON.parse(dataMatch[1]) };
            if (waiter) {
              const w = waiter;
              waiter = null;
              w(msg);
            } else {
              pending.push(msg);
            }
          }
        }
      }
    } catch (e) {
      // connection closed — fine, test tears these down explicitly
    }
  })();

  function nextEvent(timeoutMs = 5000) {
    if (pending.length) return Promise.resolve(pending.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for SSE event')), timeoutMs);
      waiter = (msg) => {
        clearTimeout(t);
        resolve(msg);
      };
    });
  }

  const first = await nextEvent();
  const close = () => controller.abort();
  if (first.event === 'auth-error') return { authError: true, close };
  assert.strictEqual(first.event, 'connected');
  return { pid: first.data.pid, nextEvent, close };
}

async function runScenario(port, diagnostic) {
  const base = `http://127.0.0.1:${port}`;
  const dbFile = path.join(os.tmpdir(), `cluster-it-${Date.now()}-${port}.db`);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      NODE_ENV: 'test',
      CLUSTER_WORKERS: '2',
      PORT: String(port),
      JWT_SECRET,
      SESSION_SECRET,
      // The cluster integration test must always use its isolated SQLite
      // file. Do not let a developer/CI DATABASE_URL redirect this test to a
      // real hosted database.
      DATABASE_URL: '',
      TURSO_DB_URL: 'file:' + dbFile,
      ADMIN_EMAIL: 'admin@cluster-it.local',
      RESEND_API_KEY: '',
      TURNSTILE_SECRET: '',
      HCAPTCHA_SECRET: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    // On POSIX, terminate this test-owned process group, including cluster
    // workers. Killing only the primary leaves children holding the output
    // pipes open and prevents node:test from finishing after the assertion.
    detached: process.platform !== 'win32',
  });
  let childOutput = '';
  child.stdout.on('data', (d) => (childOutput += d));
  child.stderr.on('data', (d) => (childOutput += d));

  const clientsToClose = new Set();
  const cleanup = async () => {
    for (const client of clientsToClose) client.close();
    const stopped = new Promise((resolve) => child.once('close', resolve));
    const signalOwnedProcesses = (signal) => {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (err) {
        if (err.code !== 'ESRCH') throw err;
      }
    };
    signalOwnedProcesses('SIGTERM');
    let stopTimer;
    const closed = await Promise.race([
      stopped.then(() => true),
      new Promise((resolve) => {
        stopTimer = setTimeout(() => resolve(false), 3000);
      }),
    ]);
    clearTimeout(stopTimer);
    if (!closed) {
      signalOwnedProcesses('SIGKILL');
      await stopped;
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbFile + suffix);
      } catch (e) {}
    }
  };

  try {
    diagnostic('waiting for healthy application');
    await waitForHealth(base, 15000);
    diagnostic('waiting for two distinct worker processes');
    await waitForBothWorkers(base);
    diagnostic('seeding isolated users and opening SSE clients');

    const seedRes = await retryFetch(base, '/api/stream/_test-seed-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cluster-it-user@test.local' }),
    });
    const { userId } = await seedRes.json();

    const ticketRes = await retryFetch(base, '/api/stream/_test-issue-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const { ticket } = await ticketRes.json();

    const clients = await Promise.all(
      Array.from({ length: CONNECTION_COUNT }, async () => {
        const client = await connectSse(base, ticket);
        clientsToClose.add(client);
        return client;
      })
    );
    const peerSeed = await retryFetch(base, '/api/stream/_test-seed-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cluster-it-peer@test.local' }),
    });
    const { userId: peerUserId } = await peerSeed.json();
    const peerTicketResponse = await retryFetch(base, '/api/stream/_test-issue-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: peerUserId }),
    });
    const { ticket: peerTicket } = await peerTicketResponse.json();
    const peer = await connectSse(base, peerTicket);
    clientsToClose.add(peer);
    const pids = new Set(clients.map((c) => c.pid));
    if (pids.size < 2) {
      clients.forEach((c) => c.close());
      peer.close();
      const err = new Error(
        `all ${CONNECTION_COUNT} connections landed on the same worker (pid ${[...pids]}) — can't verify cross-worker delivery this attempt`
      );
      err.code = 'CLUSTER_DISTRIBUTION_UNOBSERVED';
      throw err;
    }

    diagnostic('verifying cross-worker delivery and cross-user isolation');
    const triggerRes = await fetch(base + '/api/stream/_test-broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, event: 'test-alert', data: { msg: 'hello from the cluster' } }),
    });
    assert.strictEqual(triggerRes.status, 200);
    await triggerRes.arrayBuffer();
    const peerTrigger = await fetch(base + '/api/stream/_test-broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: peerUserId, event: 'peer-only', data: { msg: 'private peer alert' } }),
    });
    assert.strictEqual(peerTrigger.status, 200);
    await peerTrigger.arrayBuffer();
    const peerEvent = await peer.nextEvent();
    assert.equal(peerEvent.event, 'peer-only', "the peer must not receive the first account's alert");
    assert.equal(peerEvent.data.msg, 'private peer alert');
    peer.close();

    const results = await Promise.all(
      clients.map(async (c) => {
        const msg = await c.nextEvent();
        return { pid: c.pid, event: msg.event, data: msg.data };
      })
    );
    clients.forEach((c) => c.close());

    for (const r of results) {
      assert.strictEqual(
        r.event,
        'test-alert',
        `client on pid ${r.pid} got event "${r.event}" instead of the broadcast`
      );
      assert.strictEqual(r.data.msg, 'hello from the cluster', `client on pid ${r.pid} got the wrong payload`);
    }

    return { pidsObserved: pids.size };
  } catch (err) {
    err.childOutput = childOutput;
    throw err;
  } finally {
    diagnostic("closing this test's SSE clients and child processes");
    await cleanup();
  }
}

test('a broadcast reaches SSE clients on every cluster worker, not just whichever one handled the trigger', async (t) => {
  const ATTEMPTS = 2;
  let lastErr;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      await runScenario(4321 + i, (message) => t.diagnostic(`attempt ${i + 1}: ${message}`));
      return; // success — proven for this run
    } catch (err) {
      lastErr = err;
      t.diagnostic(`attempt ${i + 1} failed: ${err.message}`);
      if (err.code !== 'CLUSTER_DISTRIBUTION_UNOBSERVED') break;
    }
  }
  console.error('--- last attempt cluster child process output ---\n' + (lastErr.childOutput || ''));
  throw new Error(
    `cross-worker broadcast delivery could not be verified after ${ATTEMPTS} attempts: ${lastErr.message}`
  );
});

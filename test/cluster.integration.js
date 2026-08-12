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
// The whole scenario retries a few times on failure (fresh process, fresh
// DB file, fresh port each attempt). That's not papering over a flaky
// assertion — it's compensating for two specific, well-understood local-
// only artifacts that have nothing to do with the code under test:
//   1. Two worker PROCESSES sharing one local SQLite FILE (`file:` mode)
//      can see a write-then-read gap across their separate OS file handles
//      that a single remote Turso server (what production actually talks
//      to — see server/db/index.js, no syncUrl/embedded-replica involved)
//      never has, since every worker queries the same one source directly.
//   2. Node's cluster module doesn't guarantee round-robin distribution on
//      every platform (Windows defaults to SCHED_NONE) — occasionally every
//      connection in one attempt lands on the same worker by chance, which
//      would prove nothing either way about cross-worker delivery.
// If the actual relay logic in server.js/clusterBus.js were broken, every
// attempt would fail the same real assertion (a client not receiving the
// broadcast) — retrying would not paper over that.
require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const JWT_SECRET = 'cluster-it-jwt-secret-'.padEnd(32, 'x');
const SESSION_SECRET = 'cluster-it-session-secret-'.padEnd(32, 'x');
const CONNECTION_COUNT = 30;

async function retryFetch(base, url, opts, attempts = 10) {
  let lastBody;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(base + url, opts);
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
      fetch(base + '/')
        .then((r) => (r.ok ? resolve() : retry()))
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

async function waitForBothWorkers(base, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  const pids = new Set();
  while (Date.now() < deadline) {
    const res = await fetch(base + '/api/stream/_test-worker-pid').catch(() => null);
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
  const res = await fetch(`${base}/api/stream?ticket=${ticket}`, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pending = [];
  let waiter = null;

  (async function pump() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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

async function runScenario(port) {
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
      TURSO_DB_URL: 'file:' + dbFile,
      ADMIN_EMAIL: 'admin@cluster-it.local',
      RESEND_API_KEY: '',
      TURNSTILE_SECRET: '',
      HCAPTCHA_SECRET: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (d) => (childOutput += d));
  child.stderr.on('data', (d) => (childOutput += d));

  const cleanup = () => {
    child.kill();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbFile + suffix);
      } catch (e) {}
    }
  };

  try {
    await waitForHealth(base, 20000);
    await waitForBothWorkers(base);

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

    const clients = await Promise.all(Array.from({ length: CONNECTION_COUNT }, () => connectSse(base, ticket)));
    const pids = new Set(clients.map((c) => c.pid));
    if (pids.size < 2) {
      clients.forEach((c) => c.close());
      throw new Error(
        `all ${CONNECTION_COUNT} connections landed on the same worker (pid ${[...pids]}) — can't verify cross-worker delivery this attempt`
      );
    }

    const triggerRes = await fetch(base + '/api/stream/_test-broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, event: 'test-alert', data: { msg: 'hello from the cluster' } }),
    });
    assert.strictEqual(triggerRes.status, 200);

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
    cleanup();
  }
}

test('a broadcast reaches SSE clients on every cluster worker, not just whichever one handled the trigger', async () => {
  const ATTEMPTS = 4;
  let lastErr;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      await runScenario(4321 + i);
      return; // success — proven for this run
    } catch (err) {
      lastErr = err;
    }
  }
  console.error('--- last attempt cluster child process output ---\n' + (lastErr.childOutput || ''));
  throw new Error(
    `cross-worker broadcast delivery could not be verified after ${ATTEMPTS} attempts: ${lastErr.message}`
  );
});

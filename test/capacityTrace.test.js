const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

test(
  'offline fixture correlates one real HTTP request and clears traces between stages',
  { timeout: 30000 },
  async (t) => {
    const fixture = spawn(process.execPath, ['scripts/isolated-capacity-audit.cjs', '--serve-fixture'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NODE_ENV: 'test',
        RESEND_API_KEY: '',
        GMAIL_USER: '',
        GMAIL_APP_PASSWORD: '',
        MASSIVE_API_KEY: '',
        FMP_API_KEY: '',
        FINNHUB_API_KEY: '',
        WHOP_API_KEY: '',
        TURNSTILE_SECRET: '',
        HCAPTCHA_SECRET: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (fixture.exitCode !== null || fixture.signalCode !== null) return;
      const exited = once(fixture, 'exit');
      fixture.kill('SIGTERM');
      await exited;
    });
    // Fixed loopback only. No configurable URL, real database or customer account.
    const origin = 'http://127.0.0.1:3001';
    let output = '';
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Isolated fixture readiness deadline')), 20000);
      fixture.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.includes('ISOLATED_CAPACITY_FIXTURE_READY')) {
          clearTimeout(deadline);
          resolve();
        }
      });
      fixture.stderr.resume();
      fixture.once('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      fixture.once('exit', () => {
        clearTimeout(deadline);
        reject(new Error('Isolated fixture exited before readiness'));
      });
    });
    const localFetch = (route, options = {}) =>
      fetch(origin + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
    const users = await (await localFetch('/__isolated-capacity-fixture/users')).json();
    assert.equal(users.fixture, 'synthetic-local-only-v1');
    assert.equal(users.productionCapacity, 'UNKNOWN');
    await (await localFetch('/__isolated-capacity-fixture/stats?reset=1')).json();
    const beganAt = Date.now();
    const response = await localFetch('/api/account/summary', {
      headers: { Authorization: 'Bearer ' + users.users[0].token, 'X-Isolated-Request-Id': '1.1' },
    });
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.user.id, users.users[0].id);
    const query = (ids) =>
      localFetch('/__isolated-capacity-fixture/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    const traceResponse = await query(['1.1']);
    assert.equal(traceResponse.status, 200);
    const trace = (await traceResponse.json()).requests['1.1'];
    assert.equal(trace.path, '/account/summary');
    assert.equal(trace.outcome, 'finished');
    const checkedAt = Date.now();
    // Wall clocks can tick/adjust differently between processes; processing
    // duration must use the server's own monotonic clock, not their ordering.
    assert.ok(Number.isSafeInteger(trace.receivedAt) && Math.abs(trace.receivedAt - beganAt) < 5000);
    assert.ok(Number.isSafeInteger(trace.finishedAt) && Math.abs(trace.finishedAt - checkedAt) < 5000);
    assert.ok(Number.isFinite(trace.handlingMs) && trace.handlingMs >= 0 && trace.handlingMs < 5000);
    assert.deepEqual(Object.keys(trace).sort(), ['finishedAt', 'handlingMs', 'outcome', 'path', 'receivedAt']);
    assert.equal((await query(['sensitive-user-token'])).status, 400);
    assert.equal((await query(Array(51).fill('1.1'))).status, 400);
    await (await localFetch('/__isolated-capacity-fixture/stats?reset=1')).json();
    assert.equal((await (await query(['1.1'])).json()).requests['1.1'], null);
  }
);

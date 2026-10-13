// Offline test-only observer. Runs outside the application's constrained cgroup.
// Linux exposes TCP_LISTEN rx_queue as sk_ack_backlog (tcp_ipv4.c).
// Only queue counts/times for fixed loopback port 3001 are retained, never sockets,
// addresses, credentials, request content or production configuration.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const SAMPLE_MS = 20;
const MAX_DURATION_MS = 120000;
const MAX_CHANGES = 512;

function parseListenerQueue(source) {
  if (typeof source !== 'string' || !source.includes('local_address')) return null;
  const matches = source
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[1] === '0100007F:0BB9' && fields[3] === '0A');
  if (matches.length !== 1 || !/^[A-Fa-f0-9]{8}:[A-Fa-f0-9]{8}$/.test(matches[0][4] || '')) return null;
  const queued = Number.parseInt(matches[0][4].split(':')[1], 16);
  return Number.isSafeInteger(queued) ? queued : null;
}

function onlyLoopbackRoute(source) {
  const lines = source.trim().split(/\r?\n/);
  return lines[0]?.includes('Iface') && lines.slice(1).every((line) => line.trim().split(/\s+/)[0] === 'lo');
}

function createRecorder() {
  const report = {
    scope: 'Offline loopback listener queue; separate observer cgroup, not production capacity',
    startedAtEpochMs: Date.now(),
    requestedSampleMs: SAMPLE_MS,
    samples: 0,
    unavailableSamples: 0,
    samplesWithQueue: 0,
    maxQueued: null,
    maxSamplingGapMs: 0,
    changes: [],
    droppedChanges: 0,
  };
  let previous;
  let lastTime;
  return {
    sample(queued, now = performance.now(), epoch = Date.now()) {
      if (lastTime !== undefined) report.maxSamplingGapMs = Math.max(report.maxSamplingGapMs, now - lastTime);
      lastTime = now;
      report.samples++;
      if (queued === null) report.unavailableSamples++;
      else {
        assert.ok(Number.isSafeInteger(queued) && queued >= 0);
        report.maxQueued = Math.max(report.maxQueued ?? 0, queued);
        if (queued > 0) report.samplesWithQueue++;
      }
      if (queued !== previous) {
        if (report.changes.length < MAX_CHANGES) report.changes.push({ atEpochMs: epoch, queued });
        else report.droppedChanges++;
        previous = queued;
      }
    },
    finish(reason) {
      assert.ok(['SIGTERM', 'SIGINT', 'deadline'].includes(reason));
      return {
        ...report,
        maxSamplingGapMs: Number(report.maxSamplingGapMs.toFixed(2)),
        finishedAtEpochMs: Date.now(),
        reason,
      };
    },
  };
}

function main() {
  assert.equal(process.platform, 'linux', 'The passive observer requires Linux; unavailable evidence is not zero');
  assert.ok(
    onlyLoopbackRoute(readFileSync('/proc/net/route', 'utf8')),
    'Observer must be in the offline fixture namespace'
  );
  const recorder = createRecorder();
  let finished = false;
  const sample = () => {
    let queued = null;
    try {
      queued = parseListenerQueue(readFileSync('/proc/net/tcp', 'utf8'));
    } catch {
      /* unavailable stays null */
    }
    recorder.sample(queued);
  };
  const interval = setInterval(sample, SAMPLE_MS);
  const deadline = setTimeout(() => finish('deadline'), MAX_DURATION_MS);
  function finish(reason) {
    if (finished) return;
    finished = true;
    clearInterval(interval);
    clearTimeout(deadline);
    sample();
    console.log('CAPACITY_LISTENER_OBSERVER ' + JSON.stringify(recorder.finish(reason)));
  }
  process.once('SIGTERM', () => finish('SIGTERM'));
  process.once('SIGINT', () => finish('SIGINT'));
  sample();
  console.log('CAPACITY_LISTENER_OBSERVER_READY');
}

if (require.main === module) main();
module.exports = { parseListenerQueue, onlyLoopbackRoute, createRecorder, SAMPLE_MS, MAX_DURATION_MS, MAX_CHANGES };

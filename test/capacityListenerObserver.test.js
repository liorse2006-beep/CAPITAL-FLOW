const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const {
  parseListenerQueue,
  onlyLoopbackRoute,
  createRecorder,
  MAX_CHANGES,
} = require('../scripts/capacity-listener-observer.cjs');
const header = 'sl local_address rem_address st tx_queue rx_queue';
const listener = (queue, address = '0100007F:0BB9', state = '0A') =>
  `0: ${address} 00000000:0000 ${state} 00000000:${queue} 00:00000000 00000000 0 0 9`;

test('observer reads only the offline IPv4 listening queue, never established payload byte counts', () => {
  assert.equal(
    parseListenerQueue(`${header}\n${listener('000001F4')}\n${listener('FFFFFFFF', '0100007F:0BBA')}\n`),
    500
  );
  assert.equal(parseListenerQueue(`${header}\n${listener('FFFFFFFF', undefined, '01')}\n`), null);
  assert.equal(parseListenerQueue(`${header}\n${listener('00000000', '00000000:0BB9')}\n`), null);
  assert.equal(parseListenerQueue('unavailable'), null);
  assert.equal(parseListenerQueue(`${header}\n${listener('not-hex')}\n`), null);
  assert.equal(parseListenerQueue(`${header}\n${listener('00000001')}\n${listener('00000002')}\n`), null);
});

test('external routing fails closed, while an offline namespace is allowed', () => {
  assert.equal(onlyLoopbackRoute('Iface Destination Gateway\n'), true);
  assert.equal(onlyLoopbackRoute('Iface Destination Gateway\nlo 00000000 00000000\n'), true);
  assert.equal(onlyLoopbackRoute('Iface Destination Gateway\neth0 00000000 00000000\n'), false);
  assert.equal(onlyLoopbackRoute('unavailable'), false);
});

test('recorder retains unavailable evidence, bounded changes and sampling gaps without credentials', () => {
  const recorder = createRecorder();
  recorder.sample(null, 0, 1000);
  recorder.sample(4, 100, 1100);
  recorder.sample(4, 120, 1120);
  for (let index = 0; index < 1000; index++) recorder.sample(index % 2, 140 + index * 20, 1140 + index * 20);
  const report = recorder.finish('SIGTERM');
  assert.equal(report.unavailableSamples, 1);
  assert.equal(report.maxQueued, 4);
  assert.equal(report.maxSamplingGapMs, 100);
  assert.equal(report.changes.length, MAX_CHANGES);
  assert.ok(report.droppedChanges > 0);
  assert.deepEqual(Object.keys(report.changes[0]).sort(), ['atEpochMs', 'queued']);
  assert.doesNotMatch(JSON.stringify(report), /Bearer|email|remotePort|password|secret/);
  const unavailable = createRecorder();
  unavailable.sample(null);
  assert.equal(unavailable.finish('deadline').maxQueued, null);
});

test('CI observer has a separate bounded cgroup and cannot replace or weaken the capacity gates', () => {
  const workflow = readFileSync(require.resolve('../.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /node scripts\/capacity-listener-observer\.cjs/);
  assert.match(workflow, /--cpus 1 --memory 128m --memory-swap 128m/);
  assert.match(workflow, /--network "container:\$fixture"/);
  assert.match(workflow, /exit "\$burst_status"/);
  const contract = readFileSync(require.resolve('../scripts/capacity-audit-contract.cjs'), 'utf8');
  assert.match(contract, /1, 5, 25, 50, 100, 200, 500/);
  assert.match(contract, /MAX_P95_MS = 2000/);
});

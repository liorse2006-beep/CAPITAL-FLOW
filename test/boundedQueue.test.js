const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedQueue } = require('../server/services/boundedQueue');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('a saturated queue yields to I/O instead of draining every task as microtasks', async () => {
  const run = createBoundedQueue({ concurrency: 1, maxWaiting: 500, waitTimeoutMs: 10000 });
  let completed = 0;
  const io = new Promise((resolve) => setImmediate(() => resolve(completed)));
  const tasks = Array.from({ length: 500 }, () =>
    run(() => {
      completed++;
    })
  );
  const completedBeforeIo = await io;
  await Promise.all(tasks);
  assert.equal(completed, 500);
  assert.ok(completedBeforeIo < 500, 'waiting I/O must run before all queued tasks finish');
});

test('queue preserves its concurrency bound and FIFO order across yielded handoffs', async () => {
  const run = createBoundedQueue({ concurrency: 2, maxWaiting: 100, waitTimeoutMs: 10000 });
  let active = 0;
  let peak = 0;
  const started = [];
  const tasks = Array.from({ length: 50 }, (_, index) =>
    run(async () => {
      started.push(index);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return index;
    })
  );
  assert.deepEqual(
    await Promise.all(tasks),
    Array.from({ length: 50 }, (_, index) => index)
  );
  assert.deepEqual(
    started,
    Array.from({ length: 50 }, (_, index) => index)
  );
  assert.equal(peak, 2);
});

test('new arrivals cannot bypass waiting work during a handoff', async () => {
  const run = createBoundedQueue({ concurrency: 1, maxWaiting: 10, waitTimeoutMs: 10000 });
  const gate = deferred();
  const started = [];
  const first = run(async () => {
    started.push('first');
    await gate.promise;
  });
  const second = run(() => {
    started.push('second');
  });
  gate.resolve();
  await first;
  const third = run(() => {
    started.push('third');
  });
  await Promise.all([second, third]);
  assert.deepEqual(started, ['first', 'second', 'third']);
});

test('expired waiting tasks never execute and do not prevent later work', async () => {
  const run = createBoundedQueue({ concurrency: 1, maxWaiting: 10, waitTimeoutMs: 10 });
  const gate = deferred();
  const first = run(() => gate.promise);
  let expiredTaskRan = false;
  const expired = run(() => {
    expiredTaskRan = true;
  });
  const rejected = assert.rejects(expired, { code: 'WORK_QUEUE_BUSY' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await rejected;
  gate.resolve();
  await first;
  assert.equal(await run(() => 'recovered'), 'recovered');
  assert.equal(expiredTaskRan, false);
});

test('full queue rejects excess work without calling its task', async () => {
  const run = createBoundedQueue({ concurrency: 1, maxWaiting: 1, waitTimeoutMs: 10000 });
  const gate = deferred();
  const first = run(() => gate.promise);
  const second = run(() => 'second');
  let excessRan = false;
  await assert.rejects(
    run(() => {
      excessRan = true;
    }),
    { code: 'WORK_QUEUE_BUSY' }
  );
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(excessRan, false);
});

test('failed work releases its slot and the queue recovers', async () => {
  const run = createBoundedQueue({ concurrency: 1, maxWaiting: 10, waitTimeoutMs: 10000 });
  const first = run(() => {
    throw new Error('synthetic failure');
  });
  const second = run(() => 'after failure');
  await assert.rejects(first, /synthetic failure/);
  assert.equal(await second, 'after failure');
});

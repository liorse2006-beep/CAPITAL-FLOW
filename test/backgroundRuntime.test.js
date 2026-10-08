require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('shutdown cancels timers, prevents new work and drains the admitted transaction', async () => {
  const {
    backgroundInterval,
    backgroundTimeout,
    runBackgroundTask,
    stopBackgroundTasks,
  } = require('../server/services/backgroundRuntime');
  let calls = 0;
  let release;
  backgroundInterval(() => {
    calls++;
  }, 10);
  backgroundTimeout(() => {
    calls++;
  }, 20);
  const running = runBackgroundTask(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  await Promise.resolve();
  let drained = false;
  const stop = stopBackgroundTasks().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 0);
  assert.equal(drained, false);
  await runBackgroundTask(() => {
    calls++;
  });
  assert.equal(calls, 0);
  release();
  await running;
  await stop;
  assert.equal(drained, true);
});

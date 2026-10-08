const { reportError } = require('../utils/reportError');
const timers = new Set();
const active = new Set();
let stopping = false;

function runBackgroundTask(work) {
  if (stopping) return Promise.resolve();
  const task = Promise.resolve().then(work);
  active.add(task);
  task.then(
    () => active.delete(task),
    () => active.delete(task)
  );
  return task;
}
function schedule(work, milliseconds, repeat) {
  if (stopping) return null;
  const callback = () => {
    if (!repeat) timers.delete(timer);
    runBackgroundTask(work).catch((error) => reportError(error, '[background task]'));
  };
  const timer = repeat ? setInterval(callback, milliseconds) : setTimeout(callback, milliseconds);
  timers.add(timer);
  timer.unref();
  return timer;
}
const backgroundInterval = (work, milliseconds) => schedule(work, milliseconds, true);
const backgroundTimeout = (work, milliseconds) => schedule(work, milliseconds, false);
function stopBackgroundTasks() {
  stopping = true;
  for (const timer of timers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  timers.clear();
  // Database stays open until already-admitted tasks have committed or rolled
  // back. The HTTP owner's bounded shutdown deadline still protects a hang.
  return Promise.allSettled([...active]);
}
module.exports = { runBackgroundTask, backgroundInterval, backgroundTimeout, stopBackgroundTasks };

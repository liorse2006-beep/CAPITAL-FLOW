// A process-wide bound includes work from overlapping callers, not just
// the size of one Promise.all batch. Waiting work also has a hard budget.
function createBoundedQueue({ concurrency, maxWaiting, waitTimeoutMs }) {
  let active = 0;
  const waiting = [];
  function busy() {
    const error = new Error('Work queue is at capacity');
    error.code = 'WORK_QUEUE_BUSY';
    return error;
  }
  function start(entry) {
    clearTimeout(entry.timer);
    active++;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        if (!waiting.length) {
          active--;
          return;
        }
        // Retain the slot until the handoff so a new caller cannot bypass
        // queued work. Yield between tasks: a chain of immediately resolved
        // database operations must not starve incoming sockets and timers.
        setImmediate(() => {
          active--;
          if (waiting.length) start(waiting.shift());
        });
      });
  }
  return function run(task) {
    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, timer: null };
      if (active < concurrency) return start(entry);
      if (waiting.length >= maxWaiting) return reject(busy());
      entry.timer = setTimeout(() => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(busy());
      }, waitTimeoutMs);
      entry.timer.unref();
      waiting.push(entry);
    });
  };
}

module.exports = { createBoundedQueue };

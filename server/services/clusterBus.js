// Minimal pub/sub over Node's built-in cluster IPC — the whole reason this
// exists is that SSE broadcast (routes/stream.js), the SSE ticket store
// (middleware/authMiddleware.js), and the background-scan trigger all used
// to be plain in-process state (a Set, a Map, a setInterval). That's exactly
// correct for a single process, but the instant this app runs as more than
// one worker (see server/cluster.js), "in-process" stops meaning "the whole
// app" — it means "whichever one worker happened to handle this", and every
// other worker's connected clients silently never hear about it. There is no
// error anywhere when that happens; it just looks like alerts stopped
// working for roughly however many workers minus one.
//
// publish()/subscribe() give every one of those three call sites a single
// mechanism instead of three different ad hoc fixes:
//   - In a single process (CLUSTER_WORKERS unset/1, local dev, the test
//     suite, every deployment before this) cluster.isWorker is false, so
//     publish() is exactly bus.emit() and nothing else — zero behavior
//     change from before this file existed.
//   - Under multiple cluster workers, publish() ALSO forwards to the
//     primary (server/cluster.js), which relays to every sibling worker,
//     each of which re-emits locally — so "publish once" reaches every
//     worker's own locally-connected clients, not just the one that
//     happened to run the code that called publish().
const cluster = require('cluster');
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50); // several independent subscribers is expected, not a leak

function publish(channel, payload) {
  bus.emit(channel, payload); // always deliver in this process first
  if (cluster.isWorker && process.send) {
    process.send({ __clusterBus: true, channel, payload });
  }
}

function subscribe(channel, handler) {
  bus.on(channel, handler);
  return () => bus.off(channel, handler);
}

// Worker side only: the primary relays other workers' publishes back down
// as { __clusterBus, __relayed: true, channel, payload } — re-emit those
// locally so this worker's own subscribers see them. __relayed guards
// against re-forwarding a message we only just received.
if (cluster.isWorker) {
  process.on('message', (msg) => {
    if (msg && msg.__clusterBus && msg.__relayed) {
      bus.emit(msg.channel, msg.payload);
    }
  });
}

// True only for the one worker that should run singleton background work
// (the scan scheduler, digest, backup, health monitor) — every other worker
// skips starting them entirely, so they run exactly once across the whole
// cluster instead of once per worker. In a non-cluster process (today's
// deployment, local dev, tests) cluster.isWorker is false, so this is
// always true — identical to today's "just start it" behavior.
function isSingletonWorker() {
  return !cluster.isWorker || cluster.worker.id === 1;
}

module.exports = { publish, subscribe, isSingletonWorker };

// Entry point Render (and `npm start`) actually runs. Defaults to exactly
// today's behavior — one plain process running server/index.js, no cluster
// module involved at all — unless CLUSTER_WORKERS is explicitly set above 1.
//
// Opting in is then just setting that one env var; nothing else about the
// deployment needs to change, and turning it back off (unset the var, or
// set it to 1) goes right back to today's exact process model. This is
// deliberately NOT the default: see server/services/clusterBus.js and the
// startup warning in server/index.js for what still doesn't fan out across
// workers automatically without it (rate-limit buckets become per-worker —
// a looser limit, not a broken one; SSE/scan-scheduling are handled by
// clusterBus and isSingletonWorker() and are safe either way).
const workerCount = parseInt(process.env.CLUSTER_WORKERS || '1', 10);

if (!Number.isFinite(workerCount) || workerCount <= 1) {
  require('./server/index');
} else {
  const cluster = require('cluster');
  const os = require('os');

  if (cluster.isPrimary) {
    // Windows defaults to SCHED_NONE, which can keep a burst of long-lived
    // SSE connections on one worker. Round-robin makes connection ownership
    // predictable across supported platforms and gives the cluster relay a
    // real chance to serve clients held by different workers.
    cluster.schedulingPolicy = cluster.SCHED_RR;
    const cpuCount = os.cpus().length;
    const actual = Math.min(workerCount, cpuCount);
    if (actual < workerCount) {
      console.warn(
        `[cluster] CLUSTER_WORKERS=${workerCount} requested but this machine only has ${cpuCount} CPU core(s) — starting ${actual} worker(s) instead. More workers than cores just adds scheduling overhead without adding real capacity.`
      );
    }

    const workers = [];
    for (let i = 0; i < actual; i++) workers.push(cluster.fork());

    // The whole point of clusterBus: relay any worker's publish() to every
    // OTHER worker (the sender already delivered to itself locally). This
    // is the entire cross-worker transport — no external service involved.
    for (const w of workers) {
      w.on('message', (msg) => {
        if (!msg || !msg.__clusterBus) return;
        for (const other of workers) {
          if (other !== w) other.send(Object.assign({}, msg, { __relayed: true }));
        }
      });
    }

    cluster.on('exit', (worker, code, signal) => {
      console.error(`[cluster] worker ${worker.process.pid} died (code=${code}, signal=${signal}) — restarting it`);
      const replacement = cluster.fork();
      const idx = workers.indexOf(worker);
      if (idx !== -1) workers[idx] = replacement;
      replacement.on('message', (msg) => {
        if (!msg || !msg.__clusterBus) return;
        for (const other of workers) {
          if (other !== replacement) other.send(Object.assign({}, msg, { __relayed: true }));
        }
      });
    });

    console.log(`[cluster] primary ${process.pid} running with ${actual} worker(s)`);
  } else {
    require('./server/index');
  }
}

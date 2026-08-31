// Per-user scan state — progress, live-result feed, and last results all
// belong to one account. This used to be a single global object, which meant
// two things at once: (a) only one scan could run server-wide, so a second
// user got "Scan already in progress", and (b) /progress and /last-results
// showed whichever scan the last person happened to run, regardless of who
// was asking.
const MAX_TRACKED_USERS = 500;
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

const userScanStates = new Map(); // userId → state

function newState() {
  return {
    running: false,
    progress: null,
    liveResults: [],
    lastResults: null,
    lastScanTime: null,
    lastDataStatus: null,
    lastDataAsOf: null,
    touchedAt: Date.now(),
  };
}

function pruneScanStates() {
  if (userScanStates.size <= MAX_TRACKED_USERS) return;
  const now = Date.now();
  for (const [id, s] of userScanStates) {
    if (!s.running && now - s.touchedAt > STATE_TTL_MS) userScanStates.delete(id);
  }
  // Still over the cap (a genuine flood of distinct users) — drop oldest
  // idle entries; Map iterates in insertion order.
  for (const [id, s] of userScanStates) {
    if (userScanStates.size <= MAX_TRACKED_USERS) break;
    if (!s.running) userScanStates.delete(id);
  }
}

function getUserScanState(userId) {
  let s = userScanStates.get(userId);
  if (!s) {
    s = newState();
    userScanStates.set(userId, s);
    pruneScanStates();
  }
  s.touchedAt = Date.now();
  return s;
}

module.exports = { getUserScanState };

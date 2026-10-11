// Test-only Linux transport diagnostics. Never imports application credentials.
const { readFileSync } = require('node:fs');
const TCP_FIELDS = Object.freeze([
  'ListenOverflows',
  'ListenDrops',
  'TCPSynRetrans',
  'TCPTimeouts',
  'TCPBacklogDrop',
  'TCPAbortOnTimeout',
]);
const CPU_FIELDS = Object.freeze(['nr_periods', 'nr_throttled', 'throttled_usec']);

function parseTcpCounters(source) {
  const lines = source.trim().split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('TcpExt:'));
  if (header < 0 || !lines[header + 1]?.startsWith('TcpExt:')) return null;
  const fields = lines[header].trim().split(/\s+/).slice(1);
  const values = lines[header + 1].trim().split(/\s+/).slice(1);
  if (fields.length !== values.length) return null;
  const result = {};
  for (const field of TCP_FIELDS) {
    const index = fields.indexOf(field);
    if (index < 0 || !/^\d+$/.test(values[index])) continue;
    const value = Number(values[index]);
    if (Number.isSafeInteger(value)) result[field] = value;
  }
  return result;
}

function readTcpCounters() {
  try {
    return parseTcpCounters(readFileSync('/proc/net/netstat', 'utf8'));
  } catch {
    return null;
  }
}

function counterDelta(before, after) {
  return counterDeltaForFields(before, after, TCP_FIELDS);
}

function counterDeltaForFields(before, after, fields) {
  if (!before || !after) return null;
  return Object.fromEntries(
    fields
      .filter(
        (field) =>
          Number.isSafeInteger(before[field]) && Number.isSafeInteger(after[field]) && after[field] >= before[field]
      )
      .map((field) => [field, after[field] - before[field]])
  );
}

function parseCgroupCpuStats(source) {
  const counters = {};
  let recognized = false;
  for (const line of source.trim().split(/\r?\n/)) {
    const [field, raw, extra] = line.trim().split(/\s+/);
    if (!CPU_FIELDS.includes(field)) continue;
    recognized = true;
    if (extra !== undefined || !/^\d+$/.test(raw || '')) continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value)) counters[field] = value;
  }
  return recognized ? counters : null;
}

function readCgroupCpuStats() {
  try {
    return parseCgroupCpuStats(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'));
  } catch {
    return null;
  }
}

function cgroupCpuCounterDelta(before, after) {
  return counterDeltaForFields(before, after, CPU_FIELDS);
}

function validRequestId(value) {
  return (
    typeof value === 'string' &&
    /^(1|5|25|50|100|200|500)\.[1-9]\d{0,3}$/.test(value) &&
    Number(value.split('.')[1]) <= 6000
  );
}

module.exports = {
  parseTcpCounters,
  readTcpCounters,
  counterDelta,
  validRequestId,
  parseCgroupCpuStats,
  readCgroupCpuStats,
  cgroupCpuCounterDelta,
};

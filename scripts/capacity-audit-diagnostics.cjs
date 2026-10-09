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
  if (!before || !after) return null;
  return Object.fromEntries(
    TCP_FIELDS.filter(
      (field) =>
        Number.isSafeInteger(before[field]) && Number.isSafeInteger(after[field]) && after[field] >= before[field]
    ).map((field) => [field, after[field] - before[field]])
  );
}

function validRequestId(value) {
  return (
    typeof value === 'string' &&
    /^(1|5|25|50|100|200|500)\.[1-9]\d{0,3}$/.test(value) &&
    Number(value.split('.')[1]) <= 6000
  );
}

module.exports = { parseTcpCounters, readTcpCounters, counterDelta, validRequestId };

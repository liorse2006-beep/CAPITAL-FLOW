// Release gate: fail on any high/critical npm advisory except ones listed in
// audit-allowlist.json with a reason and a review date. An expired entry fails
// the gate again, so an exception cannot silently become permanent.
const { execSync } = require('node:child_process');
const path = require('node:path');

const ALLOWLIST = require(path.join(__dirname, '..', 'audit-allowlist.json'));
const BLOCKING = new Set(['high', 'critical']);

function advisoryId(url) {
  const match = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(url || '');
  return match ? match[0].toUpperCase() : null;
}

function evaluate(report, allowlist, today = new Date().toISOString().slice(0, 10)) {
  const allowed = new Map(allowlist.map((entry) => [entry.id.toUpperCase(), entry]));
  const blocking = new Map();
  const ignored = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    for (const via of vulnerability.via) {
      if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via.url) || via.title;
      const entry = allowed.get(id);
      if (entry && entry.reviewBy >= today) ignored.set(id, entry);
      else blocking.set(id, { title: via.title, severity: via.severity, package: via.name, expired: !!entry });
    }
  }
  return { blocking: [...blocking.entries()], ignored: [...ignored.entries()] };
}

if (require.main === module) {
  let raw;
  try {
    raw = execSync('npm audit --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    raw = error.stdout; // npm audit exits non-zero whenever any advisory exists
  }
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    console.error('npm audit did not return a JSON report (registry or network failure).');
    process.exit(2);
  }
  if (report.error) {
    console.error('npm audit failed:', report.error.summary || report.error.code);
    process.exit(2);
  }
  const { blocking, ignored } = evaluate(report, ALLOWLIST);
  for (const [id, entry] of ignored) console.log(`Allowed until ${entry.reviewBy}: ${id} — ${entry.reason}`);
  if (blocking.length) {
    for (const [id, item] of blocking)
      console.error(
        `${item.severity.toUpperCase()} ${item.package}: ${id} ${item.title}${item.expired ? ' (allowlist entry expired)' : ''}`
      );
    process.exit(1);
  }
  console.log('No unapproved high or critical advisories.');
}

module.exports = { evaluate, advisoryId };

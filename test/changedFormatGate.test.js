const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { changedSourceFiles } = require('../scripts/check-changed-format.cjs');

test('formatting gate rejects an unavailable or invalid base instead of passing an empty file list', () => {
  assert.throws(() => changedSourceFiles('not-a-commit', 'a'.repeat(40)), /base commit/);
  assert.throws(() => changedSourceFiles('a'.repeat(40), 'not-a-commit'), /release commit/);
  assert.throws(() => changedSourceFiles('f'.repeat(40), 'e'.repeat(40)));
});

test('formatting gate recognizes tracked source extensions without a double-escaped shell regex', () => {
  const files = changedSourceFiles('', 'a'.repeat(40));
  assert.ok(files.includes('server/index.js'));
  assert.ok(files.includes('src/App.jsx'));
  assert.ok(files.includes('src/styles/index.css'));
  assert.ok(!files.includes('package-lock.json'));
});

test('both release workflows retain commit history and fail-closed formatting checks', () => {
  for (const filename of ['ci.yml', 'deploy.yml']) {
    const source = fs.readFileSync(require('node:path').join(__dirname, '../.github/workflows/', filename), 'utf8');
    assert.match(source, /fetch-depth: 0/);
    assert.match(source, /node scripts\/check-changed-format\.cjs/);
    assert.doesNotMatch(source, /xargs npx prettier|grep -E/);
  }
});

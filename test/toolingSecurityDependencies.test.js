const test = require('node:test');
const assert = require('node:assert/strict');
const lock = require('../package-lock.json');
const shellQuote = require('shell-quote');

function atLeast(version, minimum) {
  const actual = version.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

test('release tooling is locked to patched dependency versions', () => {
  for (const [name, minimum] of Object.entries({
    'brace-expansion': '1.1.21',
    concurrently: '10.0.6',
    'shell-quote': '1.11.0',
    'source-map-js': '1.2.2',
  })) {
    const dependency = lock.packages[`node_modules/${name}`];
    assert.equal(dependency.dev, true, `${name} must remain development-only`);
    assert.ok(atLeast(dependency.version, minimum), `${name} must include its security fix`);
    assert.equal(require(`../node_modules/${name}/package.json`).version, dependency.version);
  }
});

test('shell quoting rejects line terminators following comments without executing anything', () => {
  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(() => shellQuote.quote(['echo', { comment: 'comment' }, `untrusted${terminator}token`]), TypeError);
  }
  assert.equal(shellQuote.quote(['echo', 'normal value']), "echo 'normal value'");
});

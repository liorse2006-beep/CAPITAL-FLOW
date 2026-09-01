require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isExpectedDuplicateColumnError } = require('../server/db');

test('migration error handling ignores only duplicate-column errors', () => {
  assert.equal(isExpectedDuplicateColumnError({ message: 'duplicate column name: tier' }), true);
  assert.equal(isExpectedDuplicateColumnError({ message: 'column tier already exists' }), true);
  assert.equal(isExpectedDuplicateColumnError({ message: 'no such table: users' }), false);
  assert.equal(isExpectedDuplicateColumnError({ message: 'network request timed out' }), false);
});

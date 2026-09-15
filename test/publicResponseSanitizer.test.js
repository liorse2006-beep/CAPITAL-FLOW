const test = require('node:test');
const assert = require('node:assert/strict');
const { stripPublicProvenance } = require('../server/middleware/publicResponseSanitizer');

test('removes provider diagnostics from nested public payloads', () => {
  const payload = {
    dataStatus: 'partial',
    dataProvenance: { sources: ['Yahoo Finance', 'Finnhub'] },
    results: [
      { symbol: 'AAPL', dataProvenance: { status: 'complete' }, price: 100 },
      { symbol: 'MSFT', price: 200 },
    ],
  };

  assert.deepEqual(stripPublicProvenance(payload), {
    dataStatus: 'partial',
    results: [
      { symbol: 'AAPL', price: 100 },
      { symbol: 'MSFT', price: 200 },
    ],
  });
});

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const STATUS_VALUES = new Set([
  'complete',
  'partial',
  'unavailable',
  'stale',
  'ready',
  'waiting',
  'needs_schedule',
  'expired',
  'in_progress',
  'unknown',
]);

function isoOrNull(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return ISO_TIMESTAMP.test(iso) ? iso : null;
}

function normalizeStatus(value) {
  const status = String(value || 'unknown')
    .trim()
    .toLowerCase();
  return STATUS_VALUES.has(status) ? status : 'unknown';
}

function normalizeSource(source) {
  const item = source || {};
  const fields = Array.isArray(item.fields)
    ? item.fields.map((field) => String(field || '').trim()).filter(Boolean)
    : [];
  return {
    provider: String(item.provider || 'Unknown provider')
      .trim()
      .slice(0, 80),
    role: String(item.role || 'financial data')
      .trim()
      .slice(0, 80),
    fields,
    asOf: isoOrNull(item.asOf),
    status: normalizeStatus(item.status),
    timestampAvailable: isoOrNull(item.asOf) !== null,
  };
}

/**
 * Build the public provenance contract shared by every financial response.
 *
 * `asOf` is the oldest known source timestamp used by the response. A null
 * provider timestamp is intentional: the server must not turn request time
 * into a false claim about when an upstream provider produced the data.
 */
function buildFinancialProvenance({
  dataAsOf = null,
  capturedAt = null,
  status = 'unknown',
  quoteStatus = 'unknown',
  sources = [],
} = {}) {
  const normalizedSources = sources.map(normalizeSource);
  return {
    status: normalizeStatus(status),
    quoteStatus: normalizeStatus(quoteStatus),
    asOf: isoOrNull(dataAsOf),
    capturedAt: isoOrNull(capturedAt),
    timezone: 'UTC',
    sources: normalizedSources,
    limitations: [
      'Timestamps are UTC and describe the source data available to the server.',
      'A null source timestamp means that provider did not expose a verifiable timestamp for this response.',
      'Complete means the required fields passed validation; it does not guarantee real-time execution or investment performance.',
    ],
  };
}

const CAPITAL_FLOW_SOURCES = [
  {
    provider: 'Yahoo Finance',
    role: 'quote baseline',
    fields: ['price', 'volume', 'average volume', 'market cap', 'exchange'],
  },
  {
    provider: 'Finnhub',
    role: 'quote enrichment',
    fields: ['price', 'change', 'day high', 'day low', 'previous close'],
  },
  {
    provider: 'Finnhub',
    role: 'metric fallback',
    fields: ['average volume', 'market cap'],
  },
  {
    provider: 'Yahoo Finance',
    role: 'historical enrichment',
    fields: ['sparkline', 'sector'],
  },
];

const MOVING_AVERAGE_SOURCES = [
  {
    provider: 'Yahoo Finance',
    role: 'quote and historical bars',
    fields: ['price', 'volume', 'market cap', 'moving average', 'distance'],
  },
];

const FUNDAMENTALS_SOURCES = [
  {
    provider: 'Yahoo Finance',
    role: 'quote and key statistics',
    fields: ['price', 'market cap', 'float', 'short interest', 'forward P/E', 'PEG', 'earnings date'],
  },
  {
    provider: 'Finnhub',
    role: 'fundamental metrics',
    fields: ['current P/E', 'debt/equity', 'revenue growth'],
  },
];

const SECTOR_FLOW_SOURCES = [
  {
    provider: 'Yahoo Finance',
    role: 'ETF quote and history',
    fields: ['price', 'volume', 'average volume', 'day high', 'day low'],
  },
  {
    provider: 'Finnhub',
    role: 'quote fallback/enrichment',
    fields: ['price', 'change', 'previous close'],
  },
];

module.exports = {
  buildFinancialProvenance,
  CAPITAL_FLOW_SOURCES,
  MOVING_AVERAGE_SOURCES,
  FUNDAMENTALS_SOURCES,
  SECTOR_FLOW_SOURCES,
};

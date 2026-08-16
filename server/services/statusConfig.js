const {
  FRONTEND_URL,
  PORT,
  STATUS_TARGET_URL,
  STATUS_PUBLIC_URL,
  STATUS_FULL_ADMIN_URL,
  STATUS_CHECK_TIMEOUT_MS,
} = require('../config');

const DEFAULT_TARGET =
  STATUS_TARGET_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://capitalflow.vip' : FRONTEND_URL || `http://localhost:${PORT}`);

const COMPONENT_DEFINITIONS = [
  {
    key: 'website',
    name: 'Main website',
    description: 'The public Capital Flow application and landing page.',
    group: 'Core platform',
    criticality: 'critical',
    type: 'http-content',
    path: '/',
    expectedStatus: 200,
    contentIncludes: ['Capital Flow'],
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    slowMs: 1500,
    verySlowMs: 4000,
  },
  {
    key: 'backend',
    name: 'Backend API',
    description: 'Core API availability and server health response.',
    group: 'Core platform',
    criticality: 'critical',
    type: 'health-json',
    path: '/health',
    expectedStatus: 200,
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    slowMs: 800,
    verySlowMs: 2500,
  },
  {
    key: 'database',
    name: 'Database',
    description: 'Database connectivity and lightweight SELECT 1 query.',
    group: 'Core platform',
    criticality: 'critical',
    type: 'database-json',
    path: '/health',
    expectedStatus: 200,
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    slowMs: 500,
    verySlowMs: 1500,
  },
  {
    key: 'authentication',
    name: 'Authentication',
    description: 'Authentication route is reachable and rejects an anonymous request safely.',
    group: 'Core platform',
    criticality: 'major',
    type: 'auth-route',
    path: '/api/auth/login',
    method: 'POST',
    body: { email: 'status-probe@example.invalid', password: 'status-probe-only' },
    expectedStatus: 401,
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    slowMs: 800,
    verySlowMs: 2500,
  },
  {
    key: 'market-data',
    name: 'Market data',
    description: 'Known-symbol market data response from the configured provider chain.',
    group: 'Critical functionality',
    criticality: 'major',
    type: 'market-data',
    path: '/status/internal/market-data',
    expectedStatus: 200,
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    slowMs: 2000,
    verySlowMs: 5000,
  },
  {
    key: 'news',
    name: 'News providers',
    description: 'The news provider chain can answer a lightweight known-symbol request.',
    group: 'Critical functionality',
    criticality: 'major',
    type: 'news-sample',
    path: '/api/news/AAPL',
    expectedStatus: 401,
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    slowMs: 2000,
    verySlowMs: 5000,
    optional: true,
  },
  {
    key: 'yahoo',
    name: 'Yahoo Finance dependency',
    description: 'External market-data dependency used for charts and fallback quotes.',
    group: 'External dependencies',
    criticality: 'degraded',
    type: 'external-yahoo',
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    slowMs: 2000,
    verySlowMs: 5000,
  },
  {
    key: 'dns',
    name: 'DNS resolution',
    description: 'Public status target resolves through DNS.',
    group: 'Infrastructure',
    criticality: 'warning',
    type: 'dns',
    timeoutMs: 5000,
    slowMs: 500,
    verySlowMs: 1500,
  },
  {
    key: 'ssl',
    name: 'SSL certificate',
    description: 'Public HTTPS certificate is valid and not approaching expiry.',
    group: 'Infrastructure',
    criticality: 'warning',
    type: 'ssl',
    timeoutMs: 8000,
    slowMs: 1000,
    verySlowMs: 3000,
  },
];

const DISPLAY_STATUS = {
  operational: { label: 'Operational', shortLabel: 'Operational', tone: 'ok' },
  degraded: { label: 'Degraded Performance', shortLabel: 'Degraded', tone: 'warn' },
  partial: { label: 'Partial Outage', shortLabel: 'Partial outage', tone: 'partial' },
  major: { label: 'Major Outage', shortLabel: 'Major outage', tone: 'down' },
  maintenance: { label: 'Maintenance', shortLabel: 'Maintenance', tone: 'maintenance' },
  unknown: { label: 'Checking', shortLabel: 'Checking', tone: 'unknown' },
};

function getStatusTargetUrl() {
  return DEFAULT_TARGET.replace(/\/+$/, '');
}

function getStatusPublicUrl() {
  return (STATUS_PUBLIC_URL || `${getStatusTargetUrl()}/status`).replace(/\/+$/, '');
}

function getFullAdminUrl() {
  return (STATUS_FULL_ADMIN_URL || `${getStatusTargetUrl()}/admin`).replace(/\/+$/, '');
}

function getComponentDefinitions() {
  return COMPONENT_DEFINITIONS.map((component) => ({ ...component }));
}

module.exports = {
  DEFAULT_TARGET,
  DISPLAY_STATUS,
  getComponentDefinitions,
  getFullAdminUrl,
  getStatusPublicUrl,
  getStatusTargetUrl,
};

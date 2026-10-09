// Test-only Undici lifecycle correlation. Only the fixed offline fixture and
// a bounded synthetic marker are accepted. Headers/credentials are never stored.
const diagnostics = require('node:diagnostics_channel');
const { validRequestId } = require('./capacity-audit-diagnostics.cjs');
const ORIGIN = 'http://127.0.0.1:3001';
const ROUTES = ['/api/account/summary', '/api/watchlist', '/api/notifications', '/api/scan'];

function isolatedMarker(headers) {
  let marker;
  if (Array.isArray(headers)) {
    for (let index = 0; index < headers.length; index += 2) {
      if (String(headers[index]).toLowerCase() === 'x-isolated-request-id') {
        if (marker !== undefined) return null;
        marker = headers[index + 1];
      }
    }
  } else if (typeof headers === 'string') {
    const matches = headers.match(/^x-isolated-request-id:[^\r\n]*$/gim);
    if (matches?.length === 1) marker = matches[0].slice(matches[0].indexOf(':') + 1).trim();
  }
  return validRequestId(marker) ? marker : null;
}

function installClientRequestTrace() {
  let requests = new WeakMap();
  const traces = new Map();
  const subscriptions = {
    'undici:request:create': ({ request }) => {
      if (!request || String(request.origin) !== ORIGIN || !ROUTES.includes(request.path) || traces.size >= 6000)
        return;
      const id = isolatedMarker(request.headers);
      if (!id || traces.has(id)) return;
      const trace = { createdAt: Date.now(), sentAt: null, responseHeadersAt: null, erroredAt: null };
      requests.set(request, trace);
      traces.set(id, trace);
    },
    'undici:client:sendHeaders': ({ request }) => {
      const trace = request && requests.get(request);
      if (trace) trace.sentAt = Date.now();
    },
    'undici:request:headers': ({ request }) => {
      const trace = request && requests.get(request);
      if (trace) trace.responseHeadersAt = Date.now();
    },
    'undici:request:error': ({ request }) => {
      const trace = request && requests.get(request);
      if (trace) trace.erroredAt = Date.now();
    },
  };
  for (const [name, listener] of Object.entries(subscriptions)) diagnostics.subscribe(name, listener);
  return {
    get: (id) => (validRequestId(id) && traces.has(id) ? { ...traces.get(id) } : null),
    reset: () => {
      traces.clear();
      requests = new WeakMap();
    },
    stop: () => {
      for (const [name, listener] of Object.entries(subscriptions)) diagnostics.unsubscribe(name, listener);
      traces.clear();
    },
  };
}

module.exports = { isolatedMarker, installClientRequestTrace };

export function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  n = Number(n);
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

export function parseVolInput(str) {
  if (!str) return 0;
  var s = str.trim().toUpperCase();
  if (s.endsWith('M')) return parseFloat(s) * 1e6;
  if (s.endsWith('K')) return parseFloat(s) * 1e3;
  if (s.endsWith('B')) return parseFloat(s) * 1e9;
  return parseFloat(s) || 0;
}

// Human-readable summary of a watchlist alert's threshold, shared by every
// alert button (Capital Flow, MA Scanner, Watchlist) so the tooltip stays in
// sync across all three no matter which one changes the alert.
export function alertLevelLabel(level) {
  if (!level) return '';
  return level.type === 'price' ? '$' + level.targetPrice : level.minRatio + 'x';
}

/* Turns a raw fetch-rejection message into something a user can act on.
   Special-cases the known "a scan is already running" message so it isn't
   misclassified as a network failure. */
export function friendlyError(message) {
  if (!message) return 'Something went wrong — please try again.';
  if (message === 'Scan already in progress') {
    return 'A scan is already running. Please wait for it to complete.';
  }
  var m = message.toLowerCase();
  if (m.indexOf('fetch') >= 0 || m.indexOf('network') >= 0 || m.indexOf('failed') >= 0) {
    return 'Network error — check your connection and try again.';
  }
  // response.json() throws a SyntaxError when the server returns HTML or
  // plain-text instead of JSON (e.g. a 500 page from a crashed middleware).
  // The raw "Unexpected token '<'" message is meaningless to the user.
  if (m.indexOf('unexpected token') >= 0 || m.indexOf('json') >= 0 || m.indexOf('not valid json') >= 0) {
    return 'Something went wrong — please try again.';
  }
  return message;
}

// Financial values can be unavailable (null) independently from being zero.
// Keep that distinction visible everywhere a live percentage is rendered.
export function formatSignedPercent(value, decimals = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return (number >= 0 ? '+' : '') + number.toFixed(decimals) + '%';
}

// Prices are only meaningful when they are finite and positive. Keep an
// unavailable quote visibly unavailable instead of letting a malformed/null
// provider value crash a result card or becoming a fake "$0.00".
export function formatPrice(value, decimals = 2) {
  if (typeof value !== 'number' && typeof value !== 'string') return '—';
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  return '$' + number.toFixed(decimals);
}

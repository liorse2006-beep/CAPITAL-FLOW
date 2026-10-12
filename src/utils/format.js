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

const USER_ERROR_COPY = Object.freeze({
  'Prices are temporarily unavailable. Please try again.': 'Prices are temporarily unavailable. Please try again.',
  "We couldn't save your watchlist change. Please try again.":
    "We couldn't save your watchlist change. Please try again.",
  "We couldn't load your saved watchlist. Please try again.": "We couldn't load your watchlist. Please try again.",
  'Your watchlist is full. Remove a ticker before adding another.':
    'Your watchlist is full. Remove a stock before adding another.',
  'Could not load scheduled scans': "We couldn't load your scheduled scans. Please try again.",
  'Failed to create schedule': "We couldn't save your schedule. Please try again.",
  'Failed to update schedule': "We couldn't update your schedule. Please try again.",
  'Failed to remove schedule': "We couldn't remove your schedule. Please try again.",
  'Push notifications are not supported in this browser.':
    "Push isn't available in this browser. On iPhone, add the site to your Home Screen and open its icon.",
  'Allow notifications in your browser settings to enable push.': 'Allow notifications in your browser settings.',
  'Push notifications are temporarily unavailable.': 'Notifications are temporarily unavailable. Please try again.',
  'Could not save notification access. Please try again.':
    "We couldn't save your notification setting. Please try again.",
  'Could not enable notifications. Please try again.': 'Could not enable notifications. Please try again.',
  'Could not disable notifications. Please try again.': "We couldn't disable notifications. Please try again.",
});

/* Turns a raw fetch-rejection message into something a user can act on.
   Special-cases the known "a scan is already running" message so it isn't
   misclassified as a network failure. */
export function friendlyError(message) {
  if (typeof message !== 'string') return 'Something went wrong. Please try again.';
  if (Object.hasOwn(USER_ERROR_COPY, message)) return USER_ERROR_COPY[message];
  if (message === 'Scan already in progress') {
    return 'A scan is already running. Please wait for it to finish.';
  }
  if (
    message === "We couldn't load scan results. Please try again." ||
    message === 'Your scan is taking longer than expected. Please try again.'
  )
    return message;
  var m = message.toLowerCase();
  if (m.includes('fetch') || m.includes('network')) {
    return "We couldn't connect. Check your connection and try again.";
  }
  if (m.includes('sign in') || m === 'unauthorized') return 'Please sign in to continue.';
  if (m.includes('too many') || m.includes('rate limit'))
    return 'Too many attempts. Please try again in a few minutes.';
  if (m.includes('notification') && (m.includes('denied') || m.includes('blocked'))) {
    return 'Notifications are blocked. Allow them in your browser settings.';
  }
  // Never return an arbitrary API/provider error, HTML, identifier or stack
  // trace. Components can render their own trusted, localized instructions.
  return 'Something went wrong. Please try again.';
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

// Ratios are provider data too. Keep an unavailable RVOL visible instead of
// allowing a malformed value to throw while rendering an entire result list.
export function formatRatio(value, decimals = 2) {
  if (typeof value !== 'number' && typeof value !== 'string') return '—';
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  return number.toFixed(decimals) + 'x';
}

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
  'Prices are temporarily unavailable. Please try again.': 'המחירים אינם זמינים כרגע. אפשר לנסות שוב.',
  "We couldn't save your watchlist change. Please try again.":
    'לא הצלחנו לשמור את השינוי ברשימת המעקב. אפשר לנסות שוב.',
  "We couldn't load your saved watchlist. Please try again.": 'לא הצלחנו לטעון את רשימת המעקב. אפשר לנסות שוב.',
  'Your watchlist is full. Remove a ticker before adding another.':
    'רשימת המעקב מלאה. יש להסיר מניה לפני הוספת מניה נוספת.',
  'Could not load scheduled scans': 'לא הצלחנו לטעון את הסריקות המתוזמנות. אפשר לנסות שוב.',
  'Failed to create schedule': 'לא הצלחנו לשמור את התזמון. אפשר לנסות שוב.',
  'Failed to update schedule': 'לא הצלחנו לעדכן את התזמון. אפשר לנסות שוב.',
  'Failed to remove schedule': 'לא הצלחנו להסיר את התזמון. אפשר לנסות שוב.',
  'Push notifications are not supported in this browser.':
    'התראות למכשיר אינן זמינות בדפדפן הזה. באייפון יש להוסיף את האתר למסך הבית ולפתוח מהאייקון.',
  'Allow notifications in your browser settings to enable push.': 'יש לאפשר התראות בהגדרות הדפדפן.',
  'Push notifications are temporarily unavailable.': 'ההתראות אינן זמינות כרגע. אפשר לנסות שוב.',
  'Could not save notification access. Please try again.': 'לא הצלחנו לשמור את הגדרת ההתראות. אפשר לנסות שוב.',
  'Could not enable notifications. Please try again.': 'לא הצלחנו להפעיל התראות. אפשר לנסות שוב.',
  'Could not disable notifications. Please try again.': 'לא הצלחנו לכבות התראות. אפשר לנסות שוב.',
});

/* Turns a raw fetch-rejection message into something a user can act on.
   Special-cases the known "a scan is already running" message so it isn't
   misclassified as a network failure. */
export function friendlyError(message) {
  if (typeof message !== 'string') return 'לא הצלחנו להשלים את הפעולה. אפשר לנסות שוב.';
  if (Object.hasOwn(USER_ERROR_COPY, message)) return USER_ERROR_COPY[message];
  if (message === 'Scan already in progress') {
    return 'סריקה כבר מתבצעת. יש להמתין לסיום שלה.';
  }
  if (message === 'לא הצלחנו לקבל תוצאות לסריקה. אפשר לנסות שוב.' || message === 'הסריקה מתעכבת. אפשר לנסות שוב.')
    return message;
  var m = message.toLowerCase();
  if (m.includes('fetch') || m.includes('network')) {
    return 'לא הצלחנו להתחבר. יש לבדוק את החיבור ולנסות שוב.';
  }
  if (m.includes('sign in') || m === 'unauthorized') return 'יש להתחבר לחשבון כדי להמשיך.';
  if (m.includes('too many') || m.includes('rate limit'))
    return 'בוצעו יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.';
  if (m.includes('notification') && (m.includes('denied') || m.includes('blocked'))) {
    return 'ההתראות חסומות. יש לאפשר אותן בהגדרות הדפדפן.';
  }
  // Never return an arbitrary API/provider error, HTML, identifier or stack
  // trace. Components can render their own trusted, localized instructions.
  return 'לא הצלחנו להשלים את הפעולה. אפשר לנסות שוב.';
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

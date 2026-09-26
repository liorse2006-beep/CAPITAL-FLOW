export const WHOP_RETURN_STATE_KEY = 'vs_whop_return_state';

const RETURN_STATE_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_SCROLL_POSITION = 10_000_000;

export function createWhopReturnUrl(currentUrl = window.location.href) {
  const url = new URL(currentUrl);
  url.searchParams.set('status', 'success');
  return url.toString();
}

export function saveWhopReturnState(win = window) {
  try {
    const url = new URL(win.location.href);
    const scrollX = Number(win.scrollX) || 0;
    const scrollY = Number(win.scrollY) || 0;
    win.sessionStorage.setItem(
      WHOP_RETURN_STATE_KEY,
      JSON.stringify({
        pathname: url.pathname,
        scrollX: Math.max(0, Math.min(MAX_SCROLL_POSITION, scrollX)),
        scrollY: Math.max(0, Math.min(MAX_SCROLL_POSITION, scrollY)),
        savedAt: Date.now(),
      })
    );
  } catch {
    // Checkout still works if browser storage is unavailable; it just can't
    // restore the previous scroll position automatically.
  }
}

export function clearWhopReturnState(win = window) {
  try {
    win.sessionStorage.removeItem(WHOP_RETURN_STATE_KEY);
  } catch {
    // Storage may be disabled by the browser.
  }
}

export function restoreWhopReturnScroll(win = window, documentRef = win.document) {
  let state;
  try {
    const raw = win.sessionStorage.getItem(WHOP_RETURN_STATE_KEY);
    if (!raw) return false;
    state = JSON.parse(raw);
    win.sessionStorage.removeItem(WHOP_RETURN_STATE_KEY);
  } catch {
    clearWhopReturnState(win);
    return false;
  }

  const x = Number(state?.scrollX);
  const y = Number(state?.scrollY);
  const savedAt = Number(state?.savedAt);
  if (
    state?.pathname !== win.location.pathname ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > MAX_SCROLL_POSITION ||
    y > MAX_SCROLL_POSITION ||
    !Number.isFinite(savedAt) ||
    Date.now() - savedAt > RETURN_STATE_MAX_AGE_MS
  ) {
    return false;
  }

  let attempts = 0;
  const restore = () => {
    const maxY = Math.max(0, documentRef.documentElement.scrollHeight - win.innerHeight);
    if (y <= maxY + 1 || attempts >= 20) {
      win.scrollTo(x, y);
      return;
    }
    attempts += 1;
    win.setTimeout(restore, 150);
  };

  const requestFrame =
    typeof win.requestAnimationFrame === 'function'
      ? (callback) => win.requestAnimationFrame(callback)
      : (callback) => win.setTimeout(callback, 16);
  requestFrame(() => requestFrame(restore));
  return true;
}

export function redirectToWhopReturn(returnUrl, locationRef = window.location) {
  if (typeof returnUrl !== 'string' || !returnUrl) return false;
  const target = new URL(returnUrl, locationRef.href);
  if (target.origin !== locationRef.origin) return false;
  locationRef.replace(target.toString());
  return true;
}

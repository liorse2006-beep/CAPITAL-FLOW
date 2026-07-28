export function fmt(n) {
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

/* A deterministic, heuristic read on a scan result — never claims to
   predict anything, just tells the user which results are worth looking at
   first instead of leaving them to scan a wall of rows themselves. Reuses
   the same 5x/3x volume-ratio tiers already used for the RVOL badge color,
   so the label and the color always agree. Market cap is a rough proxy for
   liquidity/reliability: a 5x spike on a mega-cap is a cleaner signal than
   the same ratio on a thinly-traded small-cap, which can spike on noise. */
export function signalStrength(r) {
  if (r.volumeRatio >= 5 && r.marketCap >= 10e9) {
    return { tier: 'strong', label: 'Strong Signal' };
  }
  if (r.volumeRatio >= 3) {
    return { tier: 'solid', label: 'Solid Signal' };
  }
  return { tier: 'early', label: 'Early Signal' };
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
  return message;
}

export const MARKET_SIGNAL_NOTIFICATION = Object.freeze({
  title: 'Market Signal Detected',
  body: 'New market signal detected. Open Capital Flow to view it.',
});

export const UNVERIFIED_SIGNAL_NOTIFICATION = Object.freeze({
  title: 'Capital Flow',
  body: "We couldn't verify a market signal this time.",
});

export function marketSignalNotificationFor(results) {
  return Array.isArray(results) && results.length > 0
    ? MARKET_SIGNAL_NOTIFICATION
    : UNVERIFIED_SIGNAL_NOTIFICATION;
}

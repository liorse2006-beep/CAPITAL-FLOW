const MARKET_SIGNAL_NOTIFICATION = Object.freeze({
  title: 'זוהה אות בשוק',
  body: 'זוהה אות חדש בשוק. אפשר לפתוח את Capital Flow כדי לראות אותו.',
});

const UNVERIFIED_SIGNAL_NOTIFICATION = Object.freeze({
  title: 'Capital Flow',
  body: 'הפעם לא הצלחנו לאמת אות בשוק.',
});

function marketSignalNotificationFor(results) {
  return Array.isArray(results) && results.length > 0 ? MARKET_SIGNAL_NOTIFICATION : UNVERIFIED_SIGNAL_NOTIFICATION;
}

module.exports = {
  MARKET_SIGNAL_NOTIFICATION,
  UNVERIFIED_SIGNAL_NOTIFICATION,
  marketSignalNotificationFor,
};

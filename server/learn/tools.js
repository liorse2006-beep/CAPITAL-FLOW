// Calls-to-action shared by learning pages. Each points at a real app route.
const TOOLS = Object.freeze({
  volume: {
    href: '/scanner',
    label: 'לסורק הנפח',
    text: 'רוצים לראות אילו מניות נסחרות היום בנפח חריג?',
  },
  ma: {
    href: '/ma',
    label: 'לסורק הממוצעים',
    text: 'בדקו אילו מניות קרובות עכשיו לממוצע נע 9, 20, 50 או 150.',
  },
  flow: {
    href: '/flow',
    label: 'לתצוגת הסקטורים',
    text: 'אילו סקטורים זזים היום, ובאיזה נפח?',
  },
  fundamentals: {
    href: '/fundamentals',
    label: 'לבדיקת פונדמנטלים',
    text: 'בדקו את המדדים הפיננסיים של מניה ספציפית.',
  },
  watchlist: {
    href: '/watchlist',
    label: 'לרשימת המעקב',
    text: 'שמרו את המניות שמעניינות אתכם וקבלו התראה כשמשהו זז.',
  },
});

const TOOLS_EN = Object.freeze({
  '/scanner': {
    href: '/scanner',
    label: 'Open volume scanner',
    text: 'Which stocks are trading on unusual volume today?',
  },
  '/ma': {
    href: '/ma',
    label: 'Open MA scanner',
    text: 'See which stocks are close to their 9, 20, 50 or 150-day moving average.',
  },
  '/flow': {
    href: '/flow',
    label: 'Open sector view',
    text: 'Which sectors are moving today, and on how much volume?',
  },
  '/fundamentals': {
    href: '/fundamentals',
    label: 'Check fundamentals',
    text: "Look up a single stock's valuation and balance-sheet numbers.",
  },
  '/watchlist': {
    href: '/watchlist',
    label: 'Open watchlist',
    text: 'Save the stocks you follow and get an alert when something moves.',
  },
});

module.exports = { TOOLS, TOOLS_EN };

// Calls-to-action shared by learning pages. Each points at a real app route.
const TOOLS = Object.freeze({
  volume: {
    href: '/scanner',
    label: 'לסורק הנפח',
    text: 'רוצים לראות אילו מניות נסחרות היום בנפח חריג?',
    sub: 'סורק הנפח של Capital Flow מסנן מניות לפי יחס נפח, שווי שוק ונפח מינימלי.',
  },
  ma: {
    href: '/ma',
    label: 'לסורק הממוצעים',
    text: 'בדקו אילו מניות קרובות עכשיו לממוצע נע 9, 20, 50 או 150.',
    sub: 'סורק הממוצעים הנעים עובד על גרף יומי או שבועי, עם בחירת כיוון ומרחק.',
  },
  flow: {
    href: '/flow',
    label: 'לתצוגת הסקטורים',
    text: 'אילו סקטורים זזים היום, ובאיזה נפח?',
    sub: 'תצוגת הסקטורים משווה תנועת מחיר ונפח בין קרנות הסקטור המרכזיות.',
  },
  fundamentals: {
    href: '/fundamentals',
    label: 'לבדיקת פונדמנטלים',
    text: 'בדקו את המדדים הפיננסיים של מניה ספציפית.',
    sub: 'P/E, Forward P/E, PEG, חוב להון, צמיחה, Float ו-Short Interest — במקום אחד, לפי זמינות הנתונים.',
  },
  watchlist: {
    href: '/watchlist',
    label: 'לרשימת המעקב',
    text: 'שמרו את המניות שמעניינות אתכם וקבלו התראה כשמשהו זז.',
    sub: 'רשימת מעקב עם התראות מחיר ונפח, בחשבון אחד.',
  },
});

module.exports = { TOOLS };

// Translate display copy only. English entitlement labels remain stable keys
// for quotas/checklists and are never used as authorization decisions.
const COPY = {
  'Full market scans': 'סריקות שוק',
  'Sector scan breadth': 'סריקת סקטורים',
  'Fundamentals lookups': 'נתונים פיננסיים',
  'Advanced filters & sorting': 'סינון ומיון מתקדם',
  'Price charts': 'גרפי מחיר',
  'Watchlist tracking & quotes': 'רשימת מעקב ומחירים',
  'Historical volume context': 'נפח מסחר היסטורי',
  'Push notifications': 'התראות פוש',
  'Real-time alert stream': 'זרם התראות',
  'Daily scheduled scan': 'סריקה יומית מתוזמנת',
  'Custom watchlist alerts': 'התראות אישיות לרשימת המעקב',
  'Capital Flow Radar': 'רדאר Capital Flow',
  'Unlimited · 7-day trial': 'ללא הגבלה · ניסיון לשבעה ימים',
  '5 scans / 24h (shared)': '5 סריקות ב־24 שעות, במכסה משותפת',
  'Up to 5 sectors': 'עד 5 סקטורים',
  Unlimited: 'ללא הגבלה',
  '7-day trial': 'ניסיון לשבעה ימים',
  'Signed-in access': 'זמין לאחר התחברות',
  Included: 'כלול',
  '7-day trial · No card required': 'ניסיון לשבעה ימים · ללא כרטיס אשראי',
  'One-time purchase · Lifetime access': 'תשלום חד־פעמי · גישה ללא הגבלת זמן',
  Free: 'חינם',
};
export default function planCopy(value, language = 'en') {
  return language === 'he' ? COPY[value] || value : value;
}

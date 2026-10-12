// Preserve the existing Hebrew landing chrome; application copy is English.
const HEBREW_COPY = {
  'Preparing your workspace…': 'מכינים את סביבת העבודה…',
  'If loading takes longer, please try again in a moment': 'אם הטעינה מתעכבת, אפשר לנסות שוב בעוד רגע',
  'Almost ready…': 'כמעט מוכנים…',
  "We couldn't load Capital Flow": 'לא הצלחנו לטעון את Capital Flow',
  'The service is temporarily unavailable. Your session is saved and you can try again.':
    'השירות אינו זמין כרגע. ההתחברות שלך נשמרה ואפשר לנסות שוב.',
  'Try again': 'ניסיון נוסף',
  Accessibility: 'נגישות',
  Close: 'סגירה',
  'Text size': 'גודל טקסט',
  'Decrease text size': 'הקטנת טקסט',
  'Increase text size': 'הגדלת טקסט',
  Appearance: 'תצוגה',
  Dark: '\n                כהה\n              ',
  Light: '\n                בהירה\n              ',
  'High contrast': 'ניגודיות גבוהה',
  Active: 'פעיל',
  Off: 'כבוי',
  'Highlight links': 'הדגשת קישורים',
  'Reset settings': '\n            איפוס הגדרות\n          ',
  'Accessibility Statement ›': '\n            הצהרת נגישות\n          ',
  'Open accessibility menu': 'פתיחת תפריט נגישות',
  'Privacy preferences': 'העדפות פרטיות',
  'Essential cookies support sign-in. Analytics to improve the service are enabled only with your consent.':
    'עוגיות חיוניות מאפשרות להתחבר. אנליטיקה לשיפור השירות מופעלת רק באישור שלך.',
  'No analytics': '\n              ללא אנליטיקה\n            ',
  'Privacy Policy': '\n              מדיניות פרטיות\n            ',
  'Allow analytics': '\n            אישור אנליטיקה\n          ',
  Included: 'כלול',
  'Not included': 'לא כלול',
  'Your plan': 'המסלול שלך',
  'Get Elite': 'מעבר ל־Elite',
  'Continue with Premium': 'המשך סריקה עם Premium',
  Get: 'בחירת ',
  'Loading…': 'טוענים…',
  'Most popular': 'הכי פופולרי',
  'Premium and Elite feature comparison': 'השוואת מסלולי Premium ו־Elite',
  'A new version of Capital Flow is available': 'גרסה חדשה של Capital Flow זמינה',
  Refresh: '\n        עדכון\n      ',
};

export function copyFor(language, value) {
  if (language !== 'he') return value;
  return HEBREW_COPY[String(value).replace(/\s+/g, ' ').trim()] ?? value;
}

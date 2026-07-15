import React, { useState } from 'react';

const TOS_SECTIONS = [
  'Capital Flow הוא כלי דיגיטלי. שימוש באתר/באפליקציה מהווה הסכמה לתנאים המפורטים להלן.',
  'Capital Flow הוא כלי סריקה ומידע בלבד. הוא מציג נתוני שוק (נפחי מסחר, מחירים, ממוצעים נעים וכדומה) לצרכי מידע בלבד. אין לראות בשום תוכן באתר תוכן ייעוץ השקעות, המלצה לקנייה/מכירה, או ייעוץ פיננסי מכל סוג. אנחנו לא בעלי רישיון ייעוץ השקעות ולא פועלים ככאלה. כל החלטת השקעה, לרבות התוצאות הכספיות שלה (רווח או הפסד), היא באחריותו הבלעדית של המשתמש. מומלץ להתייעץ עם יועץ מוסמך לפני קבלת החלטות השקעה.',
  'החזר כספי יינתן רק במקרה של תקלה טכנית בתפקוד המוצר, שצוות המוצר ניסה לתקן ולא הצליח בתוך עד שבוע ימים מרגע הדיווח. מעבר למקרה זה, אין החזרים על תשלומים ששולמו.',
  'אנחנו עושים כמיטב יכולתנו כדי להציג נתונים מדויקים ועדכניים. יחד עם זאת, הנתונים מגיעים מספקי מידע חיצוניים (שאין לנו שליטה מלאה עליהם), ולכן ייתכנו לעיתים עיכובים, אי-דיוקים או הפרעות זמניות שאינן בשליטתנו. משתמש שמבצע פעולה על סמך נתון באתר מחויב לוודא את הנתון בעצמו לפני קבלת ההחלטה.',
  'לשאלות, תלונות או בקשות בנושא פרטיות/מדיניות — ניתן לפנות דרך עמוד האינסטגרם capital_flow67',
];

const PRIVACY_INTRO =
  'מסמך זה מסביר אילו נתונים Capital Flow אוסף, לשם מה, ואיך אפשר לבקש למחוק אותם. אנחנו אוספים רק את המינימום הדרוש להפעלת השירות.';

const DATA_COLLECTED = [
  {
    title: 'פרטי חשבון',
    body: 'כתובת אימייל, סיסמה מוצפנת (או פרטי התחברות Google אם נרשמת דרך Google), ורמת המנוי שלך (חינמי / פרימיום / אליט).',
  },
  {
    title: 'שימוש בשירות',
    body: 'מונה הסריקות שביצעת בכל קטגוריה (לצורך אכיפת המכסה החינמית), רשימת המעקב (Watchlist) שלך, וסף ההתראות שהגדרת לכל טיקר (למשתמשי Elite בלבד).',
  },
  {
    title: 'התראות Push',
    body: 'אם הפעלת התראות Push (Elite בלבד) — נשמר מזהה המנוי הטכני של הדפדפן/המכשיר שלך, כדי שנוכל לשלוח אליו התראה. אפשר לבטל בכל רגע מעמוד ה-Watchlist.',
  },
  {
    title: 'פידבק',
    body: 'אם שלחת לנו פידבק דרך כפתור המשוב באפליקציה — נשמר תוכן ההודעה, כתובת אימייל (אם סיפקת), והעמוד שבו נשלחה ההודעה.',
  },
  {
    title: 'נתוני שימוש טכניים (אופציונלי)',
    body: 'אם מופעל ניתוח שימוש (Analytics) — נאספים אירועים כלליים כמו כניסה לעמוד, הרצת סריקה, או פתיחת חלון שדרוג, לצורך הבנת השימוש במוצר ושיפורו. אם מופעל ניטור שגיאות (Error Monitoring) — נשמרים פרטים טכניים על תקלות בדפדפן (כתובת URL, הודעת שגיאה) לצורך תיקון באגים. שני השירותים האלה מופעלים רק אם הוגדר מפתח הפעלה בשרת; במצב ברירת המחדל הם כבויים.',
  },
];

const THIRD_PARTIES = [
  'Google — אם נרשמת/התחברת עם חשבון Google.',
  'ספקי נתוני שוק (Yahoo Finance, Finnhub) — לצורך הצגת מחירי מניות ונפחי מסחר. לא משותף איתם מידע אישי.',
  'שירות דוא"ל — לשליחת קודי אימות והתחברות.',
  'שירותי Push של הדפדפן/המכשיר (Google, Apple, Mozilla) — לצורך העברת התראות Push, אם הופעלו.',
  'Sentry ו-PostHog — ניטור שגיאות וניתוח שימוש, מופעלים רק אם הוגדרו במפורש בהגדרות השרת.',
  'Render — ספק האחסון (Hosting) שמריץ את השרת.',
  'Turso — ספק מסד הנתונים.',
];

const USER_RIGHTS = [
  'לבקש לצפות בנתונים שנשמרו על חשבונך.',
  'לבקש לתקן נתון שגוי.',
  'למחוק את החשבון וכל הנתונים המשויכים אליו לצמיתות — ישירות מתוך הגדרות החשבון באפליקציה, או בפנייה אלינו.',
  'לבטל הרשמה לכל התראה (Push, מעקב) בכל רגע.',
];

function Section({ title, children }) {
  return (
    <div className="policy-section">
      <h3 className="policy-subtitle">{title}</h3>
      {children}
    </div>
  );
}

export default function PolicyPage() {
  const [tab, setTab] = useState('terms');

  return (
    <div className="page-content policy-page" dir="rtl">
      <div className="policy-tabs">
        <button className={'policy-tab' + (tab === 'terms' ? ' active' : '')} onClick={() => setTab('terms')}>
          תנאי שימוש
        </button>
        <button className={'policy-tab' + (tab === 'privacy' ? ' active' : '')} onClick={() => setTab('privacy')}>
          מדיניות פרטיות
        </button>
      </div>

      {tab === 'terms' && (
        <>
          <h2 className="flow-title policy-title" dir="ltr">
            Terms of Service
          </h2>
          <div className="policy-card">
            {TOS_SECTIONS.map((text, i) => (
              <p key={i} className="policy-paragraph">
                {text}
              </p>
            ))}
          </div>
        </>
      )}

      {tab === 'privacy' && (
        <>
          <h2 className="flow-title policy-title" dir="ltr">
            Privacy Policy
          </h2>
          <div className="policy-card">
            <p className="policy-paragraph">{PRIVACY_INTRO}</p>

            <Section title="אילו נתונים נאספים">
              {DATA_COLLECTED.map((d, i) => (
                <p key={i} className="policy-paragraph">
                  <strong>{d.title}:</strong> {d.body}
                </p>
              ))}
            </Section>

            <Section title="עם מי המידע משותף">
              <ul className="policy-list">
                {THIRD_PARTIES.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              <p className="policy-paragraph">
                אנחנו לא מוכרים ולא משכירים את המידע שלך לאף גורם שלישי לצרכי שיווק.
              </p>
            </Section>

            <Section title="כמה זמן נשמר המידע">
              <p className="policy-paragraph">
                המידע נשמר כל עוד החשבון פעיל. עם מחיקת החשבון, כל הנתונים המשויכים אליו — פרטי החשבון, רשימת המעקב,
                התראות, ומנויי Push — נמחקים באופן מיידי ובלתי הפיך משרתי המערכת.
              </p>
            </Section>

            <Section title="הזכויות שלך">
              <ul className="policy-list">
                {USER_RIGHTS.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Section>

            <Section title="יצירת קשר">
              <p className="policy-paragraph">
                לכל שאלה או בקשה בנושא פרטיות — ניתן לפנות דרך עמוד האינסטגרם capital_flow67.
              </p>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

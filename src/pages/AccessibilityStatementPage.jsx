import React from 'react';

function Part({ number, title, children }) {
  return (
    <div className="policy-part">
      <h3 className="policy-part-title">
        {number}. {title}
      </h3>
      {children}
    </div>
  );
}

const MEASURES = [
  'אפשרות להגדיל ולהקטין את גודל הטקסט באתר.',
  'מצב ניגודיות גבוהה להגברת הקריאות.',
  'הדגשת קישורים (קו תחתון ומסגרת) לזיהוי קל יותר.',
  'תמיכה מלאה בניווט וניתוב עמודים באמצעות מקלדת (Tab / Enter / Escape).',
  'תוויות טקסט (aria-label) לכפתורים ואייקונים, לשימוש עם קוראי מסך.',
  'ניגודיות צבעים נבחרת בקפידה בין טקסט לרקע בכל האתר.',
  'מבנה סמנטי (כותרות, כפתורים, טפסים) התומך בטכנולוגיות מסייעות.',
];

const LIMITATIONS = [
  'חלק מהתכנים המגיעים מספקי מידע חיצוניים (כגון נתוני שוק וחדשות) אינם בשליטתנו המלאה ועשויים שלא לעמוד בכל דרישות הנגישות.',
  'האתר מצוי בתהליך שיפור מתמשך של רמת הנגישות, וייתכנו רכיבים בודדים שטרם הותאמו במלואם.',
];

export default function AccessibilityStatementPage() {
  return (
    <div className="page-content policy-page" dir="rtl" lang="he">
      <h2 className="flow-title policy-title">הצהרת נגישות</h2>
      <div className="policy-card">
        <p className="policy-paragraph policy-updated">עודכן לאחרונה: 1 באוגוסט 2026</p>

        <Part number={1} title="מחויבותנו לנגישות">
          <p className="policy-paragraph">
            אנו ב-Capital Flow רואים חשיבות רבה במתן שירות שוויוני ונגיש לכלל המשתמשים, לרבות אנשים עם מוגבלות.
            אנו פועלים בהתאם לתקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), ולתקן הישראלי
            ת"י 5568 המבוסס על הנחיות WCAG 2.0 ברמה AA, ככל שהדבר ניתן ורלוונטי לאופי האתר.
          </p>
        </Part>

        <Part number={2} title="אמצעי הנגישות באתר">
          <p className="policy-paragraph">בנוסף לתפריט הנגישות הצף (הסמל בפינה השמאלית התחתונה של המסך), האתר כולל:</p>
          <ul className="policy-list">
            {MEASURES.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Part>

        <Part number={3} title="מגבלות ידועות">
          <ul className="policy-list">
            {LIMITATIONS.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Part>

        <Part number={4} title="פנייה בנושא נגישות">
          <p className="policy-paragraph">
            אם נתקלתם בבעיית נגישות באתר, או שיש לכם הצעה לשיפור — נשמח שתפנו אלינו במייל
            {' '}
            <a className="policy-inline-link" href="mailto:liormenaiot@gmail.com">
              liormenaiot@gmail.com
            </a>
            . אנו נעשה כמיטב יכולתנו לטפל בפנייה בהקדם האפשרי.
          </p>
        </Part>
      </div>
    </div>
  );
}

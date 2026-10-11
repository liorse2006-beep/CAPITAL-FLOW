import useSeo from '../hooks/useSeo';

export default function AccessibilityStatementPage() {
  useSeo({
    title: 'הצהרת נגישות | Capital Flow',
    description: 'תכונות הנגישות ב־Capital Flow, מגבלות ידועות ודרכי יצירת קשר.',
    path: '/accessibility',
  });
  return (
    <article className="page-content policy-page" lang="he" dir="rtl">
      <h2 className="flow-title policy-title">הצהרת נגישות</h2>
      <div className="policy-card">
        <p className="policy-paragraph policy-updated">עודכן ב־11 באוקטובר 2026</p>
        <h3 className="policy-subtitle">המחויבות שלנו</h3>
        <p className="policy-paragraph">
          אנחנו פועלים לשיפור הנגישות של Capital Flow, כדי שאנשים עם מוגבלויות יוכלו להשתמש בשירות. עבודת השיפור נעשית
          בהתייחס לתקן הישראלי 5568 ולהנחיות WCAG ברמת AA, לפי העניין. אין במסמך זה אישור שבוצעה בדיקת התאמה מלאה לכל
          דרישות התקן.
        </p>
        <h3 className="policy-subtitle">האפשרויות באתר</h3>
        <p className="policy-paragraph">
          כפתור הנגישות הקבוע בתחתית המסך זמין בכל העמודים, כולל עמוד הבית. בתפריט אפשר:
        </p>
        <ul className="policy-list">
          <li>להגדיל ולהקטין את הטקסט.</li>
          <li>לבחור תצוגה כהה או בהירה.</li>
          <li>להפעיל ניגודיות גבוהה.</li>
          <li>להדגיש קישורים.</li>
          <li>לאפס את הגדרות הנגישות.</li>
        </ul>
        <p className="policy-paragraph">
          ההעדפות נשמרות במכשיר. ניתן לנווט באמצעות מקלדת; כפתורים ושדות כוללים תוויות לקוראי מסך. במידת הצורך אפשר
          להיעזר גם בהגדלה המובנית בדפדפן.
        </p>
        <h3 className="policy-subtitle">מגבלות ידועות</h3>
        <p className="policy-paragraph">
          גרפים, מידע מספקי שוק ומסך התשלום החיצוני אינם בשליטתנו המלאה. ייתכנו רכיבים שעדיין דורשים שיפור. אנו ממשיכים
          לבדוק ולתקן אותם.
        </p>
        <h3 className="policy-subtitle">פנייה בנושא נגישות</h3>
        <p className="policy-paragraph">
          נתקלת בקושי? אפשר לשלוח את כתובת העמוד ותיאור קצר אל{' '}
          <a className="policy-inline-link" href="mailto:liormenaiot@gmail.com" dir="ltr">
            liormenaiot@gmail.com
          </a>
          . אפשר לציין דרך מועדפת לחזרה אליך. נבחן את הפנייה וננסה לספק פתרון נגיש.
        </p>
      </div>
    </article>
  );
}

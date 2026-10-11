import { resetConsent } from '../analytics';
import useSeo from '../hooks/useSeo';

function Section({ title, children }) {
  return (
    <section className="policy-section">
      <h3 className="policy-subtitle">{title}</h3>
      {children}
    </section>
  );
}

export default function PolicyPage() {
  useSeo({
    title: 'תנאי שימוש ומדיניות פרטיות | Capital Flow',
    description: 'תנאי השימוש, פרטיות, תשלומים, החזרים ודרכי יצירת קשר עם Capital Flow.',
    path: '/policy',
  });
  return (
    <article className="page-content policy-page" lang="he" dir="rtl">
      <h2 className="flow-title policy-title">תנאי שימוש ומדיניות פרטיות</h2>
      <div className="policy-card">
        <p className="policy-paragraph policy-updated">עודכן ב־11 באוקטובר 2026</p>
        <p className="policy-paragraph">מסמך זה מסביר את תנאי השימוש ואת אופן הטיפול במידע ב־Capital Flow.</p>
        <Section title="השירות אינו ייעוץ השקעות">
          <p className="policy-paragraph">
            Capital Flow מציגה נתוני שוק וכלי סריקה למטרות חינוך ומחקר בלבד. המידע אינו ייעוץ השקעות, ייעוץ פיננסי או
            המלצה לקנייה או למכירה של נייר ערך. השירות אינו מספק ייעוץ השקעות מורשה. נתוני מחיר, נפח מסחר וממוצעים נעים
            עשויים להיות מעוכבים, מוערכים, חלקיים או שגויים. אין להסתמך עליהם כמקור יחיד. החלטות השקעה ותוצאותיהן הן
            באחריות המשתמש, ומומלץ להתייעץ עם בעל רישיון מתאים.
          </p>
        </Section>
        <Section title="זמינות ואחריות">
          <p className="policy-paragraph">
            השירות ניתן כפי שהוא וכפי שהוא זמין. אין התחייבות לפעילות רציפה, להיעדר שגיאות או לשלמות ולעדכניות של כל
            נתון. בכפוף לדין החל, מפעילי השירות אינם אחראים לנזקים הנובעים מהשימוש או מחוסר היכולת להשתמש בו, לרבות
            הפסדי מסחר. אין בתנאים אלה כדי לשלול זכות שלא ניתן להתנות עליה לפי דין.
          </p>
        </Section>
        <Section title="תשלום ובקשות להחזר">
          <p className="policy-paragraph">
            מסלולי Premium ו־Elite הם רכישה חד־פעמית, ללא חיוב חודשי חוזר. המחיר הסופי מוצג בתשלום המאובטח שמספקת Whop.
            איננו שומרים את מלוא פרטי הכרטיס.
          </p>
          <p className="policy-paragraph">
            בנוסף לזכויות לפי דין, ניתן לבקש החזר בשל תקלה בתפקוד המוצר שנמסרה לטיפולנו ולא תוקנה בתוך 14 ימים מהדיווח.
            מדיניות זו אינה מגבילה זכויות ביטול או החזר החלות לפי חוק. בקשת ביטול או החזר אפשר לשלוח לכתובת המייל
            המופיעה למטה; אין צורך להמתין 14 ימים כדי לממש זכות חוקית.
          </p>
        </Section>
        <Section title="איזה מידע נשמר">
          <ul className="policy-list">
            <li>כתובת מייל, פרטי התחברות מאובטחים ומסלול החשבון.</li>
            <li>מניות ברשימת המעקב, סריקות שמורות, תזמונים והגדרות התראות.</li>
            <li>אם מפעילים פוש: פרטי מינוי של הדפדפן או המכשיר הדרושים למשלוח. ניתן לבטל את הפוש בהגדרות.</li>
            <li>
              אנליטיקה אופציונלית: אירועים כגון ביקורים ושימוש בתכונות, רק לאחר אישור מפורש. ניטור תקלות טכני, כאשר
              מוגדר, משמש לאיתור בעיות ולא לפרסום.
            </li>
          </ul>
          <p className="policy-paragraph">
            איננו מוכרים מידע אישי למטרות שיווק או פרסום. מסירת המידע היא מרצון; מידע חיוני נדרש כדי ליצור חשבון ולהפעיל
            את התכונות שבחרת.
          </p>
        </Section>
        <Section title="עוגיות ואנליטיקה">
          <p className="policy-paragraph">
            עוגיות חיוניות מאפשרות התחברות ואבטחה. אנליטיקה באמצעות PostHog מופעלת רק באישור שלך, וניתן לדחות אותה בלי
            לפגוע בשימוש הרגיל באתר. כאשר מאשרים אנליטיקה, המידע עשוי להישמר בארצות הברית.
          </p>
          <button
            type="button"
            className="policy-inline-link"
            onClick={() => {
              resetConsent();
              window.location.reload();
            }}
          >
            שינוי העדפות פרטיות
          </button>
        </Section>
        <Section title="ספקי שירות ועיבוד מידע">
          <ul className="policy-list">
            <li>Google — התחברות לפי בחירתך.</li>
            <li>Resend — מיילים חיוניים לאימות חשבון ולאיפוס סיסמה.</li>
            <li>Whop — עיבוד תשלומים וניהול פרטי העסקה.</li>
            <li>
              שירותי אירוח, אחסון וגיבוי — להפעלת השירות ולהתאוששות מתקלות. גיבוי תפעולי נשלח למפעיל במייל כקובץ מוצפן;
              מפתח השחזור נשמר בנפרד ואינו נשלח עם הקובץ.
            </li>
            <li>PostHog וספק ניטור תקלות, אם מופעל — בהתאם להגדרות ולבחירת הפרטיות.</li>
          </ul>
          <p className="policy-paragraph">
            האימות המקומי בהרשמה אינו דורש פנייה לשירות CAPTCHA חיצוני. ספקי התשתית עשויים לעבד מידע מחוץ למדינת מגוריך,
            לרבות בארצות הברית ובאירופה, בהתאם לשירות ולמדיניות הספק.
          </p>
        </Section>
        <Section title="שמירה, מחיקה והזכויות שלך">
          <p className="policy-paragraph">
            מידע פעיל נשמר כל עוד החשבון פעיל. ניתן לבקש עיון ותיקון, לבטל התראות ולמחוק את החשבון דרך הגדרות החשבון או
            בפנייה אלינו. המחיקה מסירה את החשבון ואת הרשומות המקושרות ממסד הנתונים הפעיל. עותקים קודמים עשויים להישאר
            בגיבויים תפעוליים, ונתוני עסקאות אצל ספק התשלום כפופים למדיניותו ולדין החל.
          </p>
        </Section>
        <Section title="אבטחת מידע">
          <p className="policy-paragraph">
            אנו משתמשים בחיבורים מוצפנים ובהגבלת גישה למידע. אין שיטת אחסון או העברה שמבטיחה אבטחה מוחלטת.
          </p>
        </Section>
        <Section title="עדכונים ויצירת קשר">
          <p className="policy-paragraph">
            שינויים מהותיים במסמך ישתקפו בתאריך העדכון. לפניות בנושא השירות, ביטול, פרטיות או נגישות:{' '}
            <a className="policy-inline-link" href="mailto:liormenaiot@gmail.com" dir="ltr">
              liormenaiot@gmail.com
            </a>
            . אפשר לפנות גם דרך{' '}
            <a
              className="policy-inline-link"
              href="https://instagram.com/capital_flow555"
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram
            </a>
            .
          </p>
        </Section>
      </div>
    </article>
  );
}

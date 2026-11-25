import { Link } from 'react-router-dom';
import useSeo from '../hooks/useSeo';

export default function NotFoundPage() {
  useSeo({
    title: 'העמוד לא נמצא | Capital Flow',
    description: 'הקישור אינו זמין. אפשר לחזור לעמוד הבית.',
    noIndex: true,
  });
  return (
    <section className="page-content policy-page" lang="he" dir="rtl" aria-labelledby="not-found-title">
      <h2 id="not-found-title" className="flow-title">
        העמוד לא נמצא
      </h2>
      <p className="policy-paragraph">הקישור אינו זמין. אפשר לחזור לעמוד הבית ולהמשיך משם.</p>
      <Link className="upgrade-cta" to="/">
        חזרה לעמוד הבית
      </Link>
    </section>
  );
}

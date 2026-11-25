import { Link } from 'react-router-dom';
import PolicyPage from '../../pages/PolicyPage';
import AccessibilityStatementPage from '../../pages/AccessibilityStatementPage';

// Public legal information must not wait for a session/database request, and
// opening it must not trigger trial gates or paid-feature prompts.
export default function PublicLegalPage({ path }) {
  return (
    <main lang="he" dir="rtl">
      <nav className="page-content" aria-label="ניווט">
        <Link to="/" className="policy-inline-link">
          Capital Flow — חזרה לאתר
        </Link>
      </nav>
      {path === '/policy' ? <PolicyPage /> : <AccessibilityStatementPage />}
    </main>
  );
}

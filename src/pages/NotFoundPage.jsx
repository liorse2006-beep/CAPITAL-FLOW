import { Link } from 'react-router-dom';
import useSeo from '../hooks/useSeo';

export default function NotFoundPage() {
  useSeo({
    title: 'Page not found | Capital Flow',
    description: 'This link is unavailable. You can return to the homepage.',
    noIndex: true,
  });
  return (
    <section className="page-content policy-page" lang="en" dir="ltr" aria-labelledby="not-found-title">
      <h2 id="not-found-title" className="flow-title">
        Page not found
      </h2>
      <p className="policy-paragraph">This link is unavailable. Return to the homepage to continue.</p>
      <Link className="upgrade-cta" to="/">
        Back to home
      </Link>
    </section>
  );
}

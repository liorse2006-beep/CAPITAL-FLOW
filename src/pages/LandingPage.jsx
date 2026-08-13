import React, { useEffect, useRef } from 'react';
import bodyHtml from './landing/landing.body.html?raw';
import { initLandingEffects } from './landing/effects';
import { track } from '../analytics';
import './landing/landing.scoped.css';

// Public marketing page shown at "/" for logged-out visitors (see App.jsx:
// `location.pathname === '/' && !user`). Ported from a hand-authored static
// HTML prototype rather than rebuilt element-by-element as JSX — it's all
// visual/marketing copy with no app state, so the highest-fidelity path was
// to keep the markup and its effects (WebGL scan background, tilt cards,
// FAQ accordion, entrance animation) intact and just give them a React
// mount/unmount lifecycle. See landing/effects.js for the teardown logic
// that makes that safe inside an SPA route.
export default function LandingPage({ onGetStarted }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const cleanup = initLandingEffects(rootRef.current, onGetStarted);
    const root = rootRef.current;
    const previousTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description ? description.getAttribute('content') : null;

    document.title = 'Capital Flow — לראות מה זז בשוק';
    if (description) {
      description.setAttribute(
        'content',
        'Capital Flow סורק נפח חריג, שינויי מגמה וסקטורים חמים ב־S&P 500 וב־NASDAQ 100. מתחילים 7 ימים בחינם, ללא כרטיס אשראי.'
      );
    }

    function onMarketingClick(event) {
      const cta = event.target.closest('[data-cta-location]');
      if (cta && root.contains(cta)) {
        track('landing_cta_click', { placement: cta.getAttribute('data-cta-location') });
        return;
      }
      const faq = event.target.closest('.cf-faq-q');
      if (faq && root.contains(faq)) {
        track('landing_faq_open', { question: faq.textContent.replace(/\s+/g, ' ').trim() });
      }
    }

    root.addEventListener('click', onMarketingClick);
    return () => {
      root.removeEventListener('click', onMarketingClick);
      cleanup();
      document.title = previousTitle;
      if (description && previousDescription !== null) description.setAttribute('content', previousDescription);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cf-landing-page" dir="rtl" lang="he" ref={rootRef} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
  );
}

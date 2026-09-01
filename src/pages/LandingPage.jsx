import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import bodyHtml from './landing/landing.body.html?raw';
import Topography from '../components/Topography';
import { initLandingEffects } from './landing/effects';
import { track } from '../analytics';
import useSeo from '../hooks/useSeo';
import './landing/landing.scoped.css?landing-style-v2';

function mountTopography(root) {
  const mount = root.querySelector('#cfTopography');
  if (!mount) return () => {};

  const reactRoot = createRoot(mount);
  reactRoot.render(
    <Topography
      className="cf-topography"
      lowColor="#7a4b16"
      midColor="#e2a545"
      highColor="#fff4d2"
      speed={0.22}
      morphAmount={3.0}
      morphSpeed={0.05}
      bands={2.0}
      thickness={0.012}
      scale={1.0}
      pixelSize={1.0}
      glow={0.28}
      colorMode="elevation"
      contrast={2.6}
      brightness={0.8}
      fillBands={false}
      opacity={0.72}
      grain
      grainIntensity={0.025}
      mouseInteraction={false}
    />
  );

  return () => reactRoot.unmount();
}

// Public marketing page shown at "/" for logged-out visitors (see App.jsx:
// `location.pathname === '/' && !user`). Ported from a hand-authored static
// HTML prototype rather than rebuilt element-by-element as JSX — it's all
// visual/marketing copy with no app state, so the highest-fidelity path was
// to keep the markup and its effects (tilt cards, FAQ accordion, entrance
// animation) intact and just give them a React mount/unmount lifecycle.
function LandingPage({ onGetStarted }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const cleanupTopography = mountTopography(root);
    const cleanup = initLandingEffects(root, onGetStarted);
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflowY = html.style.overflowY;
    const previousBodyOverflowY = body.style.overflowY;

    // Keep one native scroll container for the landing page. The global app
    // shell reserves a scrollbar by making body scrollable, but on this long
    // marketing page that leaves body and html competing for wheel input.
    html.style.overflowY = 'auto';
    body.style.overflowY = 'visible';
    useSeo({
      title: 'Capital Flow — לראות מה זז בשוק',
      description:
        'Capital Flow עוזר לך לסרוק את השוק, למצוא מניות עם תנועה חריגה ולפתוח בדיקה מסודרת — בלי לעבור על עשרות טאבים. מתחילים ב־7 ימים בחינם.',
      path: '/',
    });

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
      cleanupTopography();
      html.style.overflowY = previousHtmlOverflowY;
      body.style.overflowY = previousBodyOverflowY;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cf-landing-page" dir="rtl" lang="he" ref={rootRef} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
  );
}

export default React.memo(LandingPage);

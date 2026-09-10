import React, { useEffect, useLayoutEffect, useRef } from 'react';
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
  useSeo({
    title: 'Capital Flow — מה שכל סוחר צריך, במקום אחד',
    description:
      'Capital Flow עוזר לך לסרוק את השוק, למצוא מניות עם תנועה חריגה ולפתוח בדיקה מסודרת — בלי לעבור על עשרות טאבים. מתחילים ב־7 ימים בחינם.',
    path: '/',
  });

  // Establish the native document scroll path before mounting any of the
  // landing-page effects. Some of those effects create WebGL canvases and do
  // synchronous layout work; if they run first, a phone can receive the first
  // touch gesture while the document is still using the app shell's second
  // scroll container.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverflowX = html.style.overflowX;
    const previousHtmlOverflowY = html.style.overflowY;
    const previousHtmlTouchAction = html.style.touchAction;
    const previousHtmlOverscrollBehaviorY = html.style.overscrollBehaviorY;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverflowX = body.style.overflowX;
    const previousBodyOverflowY = body.style.overflowY;
    const previousBodyTouchAction = body.style.touchAction;
    const previousBodyOverscrollBehaviorY = body.style.overscrollBehaviorY;
    const hadLandingScrollClass = html.classList.contains('cf-landing-scroll');

    // Keep the document root as the landing page's only scroll container.
    // Explicitly resetting the full overflow shorthand matters on mobile:
    // mixing the app shell's forced body scrollbar with a visible body can
    // otherwise leave html and body competing for the same touch gesture.
    html.classList.add('cf-landing-scroll');
    html.style.overflow = 'auto';
    html.style.overflowX = 'hidden';
    html.style.overflowY = 'auto';
    html.style.touchAction = 'pan-y';
    html.style.overscrollBehaviorY = 'auto';
    body.style.overflow = 'visible';
    body.style.overflowX = 'visible';
    body.style.overflowY = 'visible';
    body.style.touchAction = 'pan-y';
    body.style.overscrollBehaviorY = 'auto';

    return () => {
      if (!hadLandingScrollClass) html.classList.remove('cf-landing-scroll');
      html.style.overflow = previousHtmlOverflow;
      html.style.overflowX = previousHtmlOverflowX;
      html.style.overflowY = previousHtmlOverflowY;
      html.style.touchAction = previousHtmlTouchAction;
      html.style.overscrollBehaviorY = previousHtmlOverscrollBehaviorY;
      body.style.overflow = previousBodyOverflow;
      body.style.overflowX = previousBodyOverflowX;
      body.style.overflowY = previousBodyOverflowY;
      body.style.touchAction = previousBodyTouchAction;
      body.style.overscrollBehaviorY = previousBodyOverscrollBehaviorY;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const cleanupTopography = mountTopography(root);
    const cleanup = initLandingEffects(root, onGetStarted);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cf-landing-page" dir="rtl" lang="he" ref={rootRef} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
  );
}

export default React.memo(LandingPage);

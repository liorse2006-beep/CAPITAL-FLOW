import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import bodyHtml from './landing/landing.body.html?raw';
import SpecularButton from '../components/SpecularButton';
import { initLandingEffects } from './landing/effects';
import { track } from '../analytics';
import './landing/landing.scoped.css';

function mountSpecularCtas(root) {
  const mounted = [];
  const ctas = root.querySelectorAll('.cf-btn[data-cta-location]');

  ctas.forEach((button) => {
    const ctaLocation = button.getAttribute('data-cta-location');
    const label = button.textContent.replace(/\s+/g, ' ').trim();
    const isNav = button.classList.contains('cf-nav-cta');
    const isLarge = button.classList.contains('cf-btn-large');
    const isOutline = button.classList.contains('cf-btn-outline');
    const isPlan = Boolean(button.closest('.cf-plan-card'));
    const variant = isNav ? 'nav' : isPlan ? 'plan' : isOutline ? 'outline' : 'primary';
    const size = isNav ? 'sm' : isPlan ? 'md' : 'lg';
    const mount = document.createElement('span');
    mount.className = 'cf-specular-cta-mount';
    const reactRoot = createRoot(mount);

    button.replaceWith(mount);
    reactRoot.render(
      <SpecularButton
        size={size}
        radius={18}
        tint="#ffffff"
        tintOpacity={isOutline ? 0.04 : 0.02}
        blur={0}
        textColor={isOutline ? '#f5ead4' : '#241507'}
        lineColor="#fff1c5"
        baseColor={isOutline ? '#6e522b' : '#a96b1d'}
        intensity={1.15}
        shineSize={10}
        shineFade={40}
        thickness={1}
        speed={0.35}
        followMouse
        proximity={250}
        autoAnimate={false}
        type={button.getAttribute('type') || 'button'}
        className={`cf-specular-cta cf-specular-cta--${variant}${isLarge ? ' cf-specular-cta--large' : ''}`}
        data-cta-location={ctaLocation}
      >
        {label}
      </SpecularButton>
    );

    mounted.push({ button, mount, reactRoot });
  });

  return () => {
    mounted.forEach(({ button, mount, reactRoot }) => {
      reactRoot.unmount();
      if (mount.parentNode) mount.replaceWith(button);
    });
  };
}

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
    const root = rootRef.current;
    const cleanupSpecularCtas = mountSpecularCtas(root);
    const cleanup = initLandingEffects(root, onGetStarted);
    const previousTitle = document.title;
    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description ? description.getAttribute('content') : null;

    document.title = 'Capital Flow — לראות מה זז בשוק';
    if (description) {
      description.setAttribute(
        'content',
        'Capital Flow עוזר לך לסרוק את השוק, למצוא מניות עם תנועה חריגה ולפתוח בדיקה מסודרת — בלי לעבור על עשרות טאבים. מתחילים ב־7 ימים בחינם.'
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
      cleanupSpecularCtas();
      document.title = previousTitle;
      if (description && previousDescription !== null) description.setAttribute('content', previousDescription);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cf-landing-page" dir="rtl" lang="he" ref={rootRef} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
  );
}

import React from 'react';

// Brand splash shown while the app resolves the visitor's session on first
// load. Deliberately says nothing about servers or waiting — it just reads as
// a short, confident intro: the Capital Flow mark builds up, then a thin
// progress line sweeps beneath it. Pure CSS (see .splash-* in index.css), so
// it costs no JS and respects prefers-reduced-motion.
export default function SplashLoader({ label = 'Loading' }) {
  return (
    <div className="splash-screen" role="status" aria-live="polite" aria-label={label}>
      <div className="splash-mark" aria-hidden="true">
        <span className="splash-bar" />
        <span className="splash-bar" />
        <span className="splash-bar" />
      </div>
      <div className="splash-word">Capital Flow</div>
      <div className="splash-track" aria-hidden="true">
        <span className="splash-track-fill" />
      </div>
    </div>
  );
}

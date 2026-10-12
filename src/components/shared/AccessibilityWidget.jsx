import { useUiLanguage } from '../../context/UiLanguageContext';
import { copyFor } from '../../utils/landingUiCopy';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

var STORAGE_KEY = 'vs_a11y_settings';
var FONT_STEPS = [1, 1.1, 1.25, 1.4]; // multiplier applied via zoom — 100% / 110% / 125% / 140%
var DEFAULT_SETTINGS = { fontStep: 0, highContrast: false, highlightLinks: false, theme: 'dark' };

function loadSettings() {
  try {
    var raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!raw) return DEFAULT_SETTINGS;
    return {
      fontStep: FONT_STEPS[raw.fontStep] ? raw.fontStep : 0,
      highContrast: !!raw.highContrast,
      highlightLinks: !!raw.highlightLinks,
      theme: raw.theme === 'light' ? 'light' : 'dark',
    };
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

function applySettings(s) {
  var root = document.documentElement;
  root.style.zoom = FONT_STEPS[s.fontStep] || 1;
  root.classList.toggle('a11y-high-contrast', s.highContrast);
  root.classList.toggle('a11y-highlight-links', s.highlightLinks);
  root.setAttribute('data-theme', s.theme);
}

/* Floating accessibility toolbar — real, functioning controls (not
   decorative): text zoom, a light/dark theme switch, a high-contrast mode,
   and link highlighting, all persisted per-device and applied globally via
   attributes/classes/zoom on <html> so they hold across every page and
   reload. Rendered once, outside the app's own routing, so it's available
   even on the onboarding quiz / loading screens. This component is the sole
   owner of the `data-theme` attribute — nothing else in the app should set
   it, or it'll fight this widget's saved preference. */
export default function AccessibilityWidget() {
  const language = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    applySettings(settings);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {}
  }, [settings]);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const panel = document.getElementById('a11y-controls');
    panel?.querySelector('button')?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus?.();
    };
  }, [open]);

  function increaseFont() {
    setSettings((s) => ({ ...s, fontStep: Math.min(s.fontStep + 1, FONT_STEPS.length - 1) }));
  }
  function decreaseFont() {
    setSettings((s) => ({ ...s, fontStep: Math.max(s.fontStep - 1, 0) }));
  }
  function toggleContrast() {
    setSettings((s) => ({ ...s, highContrast: !s.highContrast }));
  }
  function toggleLinks() {
    setSettings((s) => ({ ...s, highlightLinks: !s.highlightLinks }));
  }
  function setTheme(theme) {
    setSettings((s) => ({ ...s, theme: theme }));
  }
  function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
  }

  return (
    <div className="a11y-widget">
      {open && (
        <div
          className="a11y-panel"
          role="dialog"
          aria-modal="false"
          id="a11y-controls"
          aria-label={copyFor(language, 'Accessibility')}
          lang={language}
          dir={language === 'he' ? 'rtl' : 'ltr'}
        >
          <div className="a11y-panel-header">
            <span>{copyFor(language, 'Accessibility')}</span>
            <button className="a11y-panel-close" onClick={() => setOpen(false)} aria-label={copyFor(language, 'Close')}>
              &times;
            </button>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">{copyFor(language, 'Text size')}</span>
            <div className="a11y-btn-group">
              <button
                className="a11y-btn"
                onClick={decreaseFont}
                disabled={settings.fontStep === 0}
                aria-label={copyFor(language, 'Decrease text size')}
              >
                A-
              </button>
              <button
                className="a11y-btn"
                onClick={increaseFont}
                disabled={settings.fontStep === FONT_STEPS.length - 1}
                aria-label={copyFor(language, 'Increase text size')}
              >
                A+
              </button>
            </div>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">{copyFor(language, 'Appearance')}</span>
            <div className="a11y-btn-group">
              <button
                className={'a11y-btn a11y-toggle' + (settings.theme === 'dark' ? ' on' : '')}
                onClick={() => setTheme('dark')}
                aria-pressed={settings.theme === 'dark'}
              >
                {copyFor(language, '\n                Dark\n              ')}
              </button>
              <button
                className={'a11y-btn a11y-toggle' + (settings.theme === 'light' ? ' on' : '')}
                onClick={() => setTheme('light')}
                aria-pressed={settings.theme === 'light'}
              >
                {copyFor(language, '\n                Light\n              ')}
              </button>
            </div>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">{copyFor(language, 'High contrast')}</span>
            <button
              className={'a11y-btn a11y-toggle' + (settings.highContrast ? ' on' : '')}
              onClick={toggleContrast}
              aria-label={copyFor(language, 'High contrast')}
              aria-pressed={settings.highContrast}
            >
              {settings.highContrast ? copyFor(language, 'Active') : copyFor(language, 'Off')}
            </button>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">{copyFor(language, 'Highlight links')}</span>
            <button
              className={'a11y-btn a11y-toggle' + (settings.highlightLinks ? ' on' : '')}
              onClick={toggleLinks}
              aria-label={copyFor(language, 'Highlight links')}
              aria-pressed={settings.highlightLinks}
            >
              {settings.highlightLinks ? copyFor(language, 'Active') : copyFor(language, 'Off')}
            </button>
          </div>

          <button className="a11y-reset-btn" onClick={resetSettings}>
            {copyFor(language, '\n            Reset settings\n          ')}
          </button>

          <Link className="a11y-statement-link" to="/accessibility" onClick={() => setOpen(false)}>
            {copyFor(language, '\n            Accessibility Statement ›\n          ')}
          </Link>
        </div>
      )}

      <button
        className="a11y-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label={copyFor(language, 'Open accessibility menu')}
        aria-expanded={open}
        aria-controls="a11y-controls"
        title={copyFor(language, 'Accessibility')}
      >
        <span aria-hidden="true">&#9855;</span>
      </button>
    </div>
  );
}

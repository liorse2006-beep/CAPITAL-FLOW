import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

var STORAGE_KEY = 'vs_a11y_settings'
var FONT_STEPS = [1, 1.1, 1.25, 1.4] // multiplier applied via zoom — 100% / 110% / 125% / 140%
var DEFAULT_SETTINGS = { fontStep: 0, highContrast: false, highlightLinks: false, theme: 'dark' }

function loadSettings() {
  try {
    var raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!raw) return DEFAULT_SETTINGS
    return {
      fontStep: FONT_STEPS[raw.fontStep] ? raw.fontStep : 0,
      highContrast: !!raw.highContrast,
      highlightLinks: !!raw.highlightLinks,
      theme: raw.theme === 'light' ? 'light' : 'dark',
    }
  } catch (e) {
    return DEFAULT_SETTINGS
  }
}

function applySettings(s) {
  var root = document.documentElement
  root.style.zoom = FONT_STEPS[s.fontStep] || 1
  root.classList.toggle('a11y-high-contrast', s.highContrast)
  root.classList.toggle('a11y-highlight-links', s.highlightLinks)
  root.setAttribute('data-theme', s.theme)
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
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(loadSettings)

  useEffect(() => {
    applySettings(settings)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {}
  }, [settings])

  function increaseFont() {
    setSettings((s) => ({ ...s, fontStep: Math.min(s.fontStep + 1, FONT_STEPS.length - 1) }))
  }
  function decreaseFont() {
    setSettings((s) => ({ ...s, fontStep: Math.max(s.fontStep - 1, 0) }))
  }
  function toggleContrast() {
    setSettings((s) => ({ ...s, highContrast: !s.highContrast }))
  }
  function toggleLinks() {
    setSettings((s) => ({ ...s, highlightLinks: !s.highlightLinks }))
  }
  function setTheme(theme) {
    setSettings((s) => ({ ...s, theme: theme }))
  }
  function resetSettings() {
    setSettings(DEFAULT_SETTINGS)
  }

  return (
    <div className="a11y-widget">
      {open && (
        <div className="a11y-panel" role="dialog" aria-modal="true" aria-label="Accessibility">
          <div className="a11y-panel-header">
            <span>Accessibility</span>
            <button className="a11y-panel-close" onClick={() => setOpen(false)} aria-label="Close">
              &times;
            </button>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">Text Size</span>
            <div className="a11y-btn-group">
              <button className="a11y-btn" onClick={decreaseFont} disabled={settings.fontStep === 0} aria-label="Decrease text size">
                A-
              </button>
              <button
                className="a11y-btn"
                onClick={increaseFont}
                disabled={settings.fontStep === FONT_STEPS.length - 1}
                aria-label="Increase text size"
              >
                A+
              </button>
            </div>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">Theme</span>
            <div className="a11y-btn-group">
              <button
                className={'a11y-btn a11y-toggle' + (settings.theme === 'dark' ? ' on' : '')}
                onClick={() => setTheme('dark')}
                aria-pressed={settings.theme === 'dark'}
              >
                Dark
              </button>
              <button
                className={'a11y-btn a11y-toggle' + (settings.theme === 'light' ? ' on' : '')}
                onClick={() => setTheme('light')}
                aria-pressed={settings.theme === 'light'}
              >
                Light
              </button>
            </div>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">High Contrast</span>
            <button
              className={'a11y-btn a11y-toggle' + (settings.highContrast ? ' on' : '')}
              onClick={toggleContrast}
              aria-pressed={settings.highContrast}
            >
              {settings.highContrast ? 'On' : 'Off'}
            </button>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">Highlight Links</span>
            <button
              className={'a11y-btn a11y-toggle' + (settings.highlightLinks ? ' on' : '')}
              onClick={toggleLinks}
              aria-pressed={settings.highlightLinks}
            >
              {settings.highlightLinks ? 'On' : 'Off'}
            </button>
          </div>

          <button className="a11y-reset-btn" onClick={resetSettings}>
            Reset Settings
          </button>

          <Link className="a11y-statement-link" to="/accessibility" onClick={() => setOpen(false)}>
            Accessibility Statement ›
          </Link>
        </div>
      )}

      <button
        className="a11y-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open accessibility menu"
        aria-expanded={open}
        title="Accessibility"
      >
        {/* A plain wheelchair glyph (U+267F) renders as Windows' built-in
            color emoji — a blue circle that ignores the button's own color,
            clashing with the app's palette. An SVG with stroke="currentColor"
            inherits it instead. */}
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="5" r="1.5" fill="currentColor" stroke="none" />
          <path d="M9 8v5l-3 7" />
          <path d="M9 13h5l3 6" />
          <path d="M6.5 12.5H14" />
          <path d="M14 8c1.5 0 3 1.2 3 3.2" />
        </svg>
      </button>
    </div>
  )
}

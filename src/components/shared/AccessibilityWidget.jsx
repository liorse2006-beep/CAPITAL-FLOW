import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

var STORAGE_KEY = 'vs_a11y_settings'
var FONT_STEPS = [1, 1.1, 1.25, 1.4] // multiplier applied via zoom — 100% / 110% / 125% / 140%
var DEFAULT_SETTINGS = { fontStep: 0, highContrast: false, highlightLinks: false }

function loadSettings() {
  try {
    var raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (!raw) return DEFAULT_SETTINGS
    return {
      fontStep: FONT_STEPS[raw.fontStep] ? raw.fontStep : 0,
      highContrast: !!raw.highContrast,
      highlightLinks: !!raw.highlightLinks,
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
}

/* Floating accessibility toolbar — real, functioning controls (not
   decorative): text zoom, a high-contrast mode, and link highlighting, all
   persisted per-device and applied globally via classes/zoom on <html> so
   they hold across every page and reload. Rendered once, outside the app's
   own routing, so it's available even on the onboarding quiz / loading
   screens. */
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
  function resetSettings() {
    setSettings(DEFAULT_SETTINGS)
  }

  return (
    <div className="a11y-widget">
      {open && (
        <div className="a11y-panel" dir="rtl" lang="he" role="dialog" aria-modal="true" aria-label="נגישות">
          <div className="a11y-panel-header">
            <span>נגישות</span>
            <button className="a11y-panel-close" onClick={() => setOpen(false)} aria-label="סגור">
              &times;
            </button>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">גודל טקסט</span>
            <div className="a11y-btn-group">
              <button className="a11y-btn" onClick={decreaseFont} disabled={settings.fontStep === 0} aria-label="הקטן טקסט">
                א-
              </button>
              <button
                className="a11y-btn"
                onClick={increaseFont}
                disabled={settings.fontStep === FONT_STEPS.length - 1}
                aria-label="הגדל טקסט"
              >
                א+
              </button>
            </div>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">ניגודיות גבוהה</span>
            <button
              className={'a11y-btn a11y-toggle' + (settings.highContrast ? ' on' : '')}
              onClick={toggleContrast}
              aria-pressed={settings.highContrast}
            >
              {settings.highContrast ? 'כבוי' : 'הפעל'}
            </button>
          </div>

          <div className="a11y-row">
            <span className="a11y-row-label">הדגשת קישורים</span>
            <button
              className={'a11y-btn a11y-toggle' + (settings.highlightLinks ? ' on' : '')}
              onClick={toggleLinks}
              aria-pressed={settings.highlightLinks}
            >
              {settings.highlightLinks ? 'כבוי' : 'הפעל'}
            </button>
          </div>

          <button className="a11y-reset-btn" onClick={resetSettings}>
            איפוס הגדרות
          </button>

          <Link className="a11y-statement-link" to="/accessibility" onClick={() => setOpen(false)}>
            הצהרת נגישות ‹
          </Link>
        </div>
      )}

      <button
        className="a11y-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="פתח תפריט נגישות"
        aria-expanded={open}
        title="נגישות"
      >
        <span aria-hidden="true">&#9855;</span>
      </button>
    </div>
  )
}

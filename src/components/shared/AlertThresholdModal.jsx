import React, { useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';

const PRESETS = [2, 3, 5];

export default function AlertThresholdModal({ symbol, current, onSave, onRemove, onClose }) {
  const [value, setValue] = useState(current ? String(current) : '');
  const panelRef = useModalA11y(onClose);

  function submit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed === '') {
      onRemove();
      return;
    }
    const num = parseFloat(trimmed);
    if (!(num > 0)) return;
    onSave(num);
  }

  function pickPreset(v) {
    setValue(String(v));
  }

  return (
    <div
      className="upgrade-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="upgrade-modal"
        style={{ width: 320 }}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={'Alert threshold for ' + symbol}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">×</button>

        <h2 className="upgrade-title" style={{ fontSize: 17 }}>
          {'התראת נפח — ' + symbol}
        </h2>
        <p className="upgrade-desc" style={{ marginBottom: 12 }}>
          שלח לי התראה כאשר הנפח של{' '}
          <strong style={{ color: 'var(--text-0)' }}>{symbol}</strong>{' '}
          יחצה את הסף שאקבע.
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--accent-dim)',
            border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--accent)',
              color: '#0a0a0a',
              padding: '2px 8px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}
          >
            3×
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-1)' }}>
            = נפח פי 3 מהממוצע היומי
          </span>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 8 }}>בחר סף מהיר</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => pickPreset(v)}
              style={{
                flex: 1,
                border: '1px solid ' + (parseFloat(value) === v ? 'var(--accent)' : 'var(--border-strong)'),
                background: parseFloat(value) === v ? 'var(--accent-dim)' : 'var(--bg-2)',
                color: parseFloat(value) === v ? 'var(--accent)' : 'var(--text-1)',
                borderRadius: 8,
                padding: '9px 0',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {v}×
            </button>
          ))}
        </div>

        <form onSubmit={submit}>
          <label style={{ fontSize: 12, color: 'var(--text-1)', display: 'block', marginBottom: 6 }}>
            או הכנס ידנית
          </label>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <input
              id="alert-threshold-input"
              className="auth-input"
              type="number"
              step="0.5"
              min="0.5"
              placeholder="e.g. 3"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ textAlign: 'center', paddingRight: 44 }}
            />
            <span
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 13,
                color: 'var(--text-2)',
                pointerEvents: 'none',
              }}
            >
              × RVOL
            </span>
          </div>

          <button className="upgrade-cta" type="submit" style={{ marginBottom: 10 }}>
            {value.trim() === '' ? 'הסר התראה' : 'שמור התראה'}
          </button>
        </form>

        {current && (
          <button
            type="button"
            onClick={onRemove}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              color: 'var(--text-2)',
              fontSize: 12,
              cursor: 'pointer',
              padding: '4px 0',
            }}
          >
            הסר התראה
          </button>
        )}
      </div>
    </div>
  );
}

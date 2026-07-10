import React, { useState } from 'react';

// Replaces window.prompt() for setting a per-ticker volume-ratio alert
// threshold — native prompts can't be styled, block Sentry replay capture,
// and read poorly on mobile Safari.
export default function AlertThresholdModal({ symbol, current, onSave, onRemove, onClose }) {
  const [value, setValue] = useState(current ? String(current) : '');

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

  return (
    <div
      className="upgrade-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="upgrade-modal" style={{ width: 320 }}>
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="upgrade-title">{'Alert — ' + symbol}</h2>
        <p className="upgrade-desc">
          {current
            ? 'Currently set at ' + current + 'x. Change the threshold or clear it below.'
            : 'Get notified when this ticker crosses a volume ratio threshold.'}
        </p>
        <form onSubmit={submit}>
          <input
            className="auth-input"
            type="number"
            step="0.5"
            min="0"
            placeholder="e.g. 3"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            style={{ textAlign: 'center', marginBottom: 14 }}
          />
          <button className="upgrade-cta" type="submit">
            {value.trim() === '' ? 'Remove Alert' : 'Save Alert'}
          </button>
        </form>
      </div>
    </div>
  );
}

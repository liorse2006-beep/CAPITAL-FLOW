import React, { useState } from 'react';
import useModalA11y from '../../hooks/useModalA11y';
import { formatPrice } from '../../utils/format';

const PRESETS = [2, 3, 5];

function VolumeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="20" x2="4" y2="14" />
      <line x1="10" y1="20" x2="10" y2="9" />
      <line x1="16" y1="20" x2="16" y2="5" />
      <line x1="22" y1="20" x2="22" y2="11" />
    </svg>
  );
}

function PriceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

// Which value (if any) to preload into the input when a step is opened —
// only prefilled when the existing alert is already that same type, so
// switching type always starts the new step from a clean slate.
function initValueFor(type, current) {
  if (!current || current.type !== type) return '';
  return String(type === 'volume' ? current.minRatio : current.targetPrice);
}

export default function AlertThresholdModal({ symbol, current, currentPrice, onSave, onRemove, onClose }) {
  const [step, setStep] = useState(current ? current.type : 'type'); // 'type' | 'volume' | 'price'
  const [value, setValue] = useState(initValueFor(current ? current.type : 'volume', current));
  const [submitting, setSubmitting] = useState(false);
  const panelRef = useModalA11y(onClose);

  function chooseType(type) {
    setValue(initValueFor(type, current));
    setStep(type);
  }

  const trimmed = value.trim();
  const editingSameType = !!current && current.type === step;

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    if (trimmed === '') {
      if (editingSameType) {
        setSubmitting(true);
        try {
          await onRemove();
        } finally {
          setSubmitting(false);
        }
      }
      return;
    }
    const num = parseFloat(trimmed);
    if (!(num > 0)) return;
    if (step === 'price' && !(currentPrice > 0)) return;
    setSubmitting(true);
    try {
      if (step === 'volume') {
        await onSave({ type: 'volume', minRatio: num });
      } else {
        await onSave({
          type: 'price',
          targetPrice: num,
          referencePrice: currentPrice,
          startingSide: currentPrice >= num ? 'above' : 'below',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function pickPreset(v) {
    setValue(String(v));
  }

  let buttonLabel = current ? 'עדכן התראה' : 'קבע התראה';
  let buttonDisabled = false;
  if (trimmed === '') {
    if (editingSameType) {
      buttonLabel = submitting ? 'מסיר…' : 'הסר התראה';
    } else {
      buttonDisabled = true;
    }
  } else if (step === 'price' && !(currentPrice > 0)) {
    buttonDisabled = true;
  }
  if (submitting) {
    buttonLabel = trimmed === '' ? 'מסיר…' : 'שומר…';
    buttonDisabled = true;
  }

  return (
    <div
      className="upgrade-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="upgrade-modal alert-modal"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        lang="he"
        dir="rtl"
        aria-label={'התראה עבור ' + symbol}
      >
        <button className="upgrade-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="alert-modal-header">
          <span className="alert-modal-dot" />
          <h2 className="alert-modal-title" lang="en" dir="ltr">
            {'ALERT · ' + symbol}
          </h2>
        </div>

        {step === 'type' ? (
          <>
            <p className="alert-modal-desc">איזו התראה תרצה להגדיר?</p>
            <div className="alert-type-grid">
              <button type="button" className="alert-type-card" onClick={() => chooseType('volume')}>
                <span className="alert-type-icon">
                  <VolumeIcon />
                </span>
                <span className="alert-type-name">נפח</span>
                <span className="alert-type-desc">חריגת נפח ביחס לממוצע</span>
              </button>
              <button type="button" className="alert-type-card" onClick={() => chooseType('price')}>
                <span className="alert-type-icon">
                  <PriceIcon />
                </span>
                <span className="alert-type-name">מחיר</span>
                <span className="alert-type-desc">חציית מחיר יעד</span>
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <button type="button" className="alert-modal-back" onClick={() => setStep('type')}>
              חזרה לבחירת סוג ההתראה
            </button>

            {step === 'volume' ? (
              <>
                <p className="alert-modal-desc">
                  שלחו לי התראה כאשר נפח המסחר של{' '}
                  <bdi className="alert-symbol" dir="ltr">
                    {symbol}
                  </bdi>{' '}
                  יעבור את סף ה־<bdi dir="ltr">RVOL</bdi> שאקבע.
                </p>

                <div className="alert-readout">
                  <div className="alert-readout-val" dir="ltr">
                    {(trimmed === '' ? '—' : parseFloat(trimmed) || '—') + '×'}
                  </div>
                  <div className="alert-readout-lbl">RVOL THRESHOLD</div>
                </div>

                <p className="alert-modal-sublabel">בחרו סף מהיר</p>
                <div className="alert-preset-row">
                  {PRESETS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={'alert-preset-btn' + (parseFloat(value) === v ? ' active' : '')}
                      onClick={() => pickPreset(v)}
                    >
                      {v}×
                    </button>
                  ))}
                </div>

                <label className="alert-modal-sublabel" htmlFor="alert-threshold-input">
                  או הזינו ערך ידנית
                </label>
                <div className="alert-input-wrap" dir="ltr">
                  <input
                    id="alert-threshold-input"
                    className="auth-input alert-number-input"
                    type="number"
                    step="0.5"
                    min="0.5"
                    placeholder="e.g. 3"
                    dir="ltr"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    style={{ textAlign: 'center' }}
                  />
                  <span className="alert-input-suffix" dir="ltr">
                    × RVOL
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="alert-modal-desc">
                  שלחו לי התראה כאשר המחיר של{' '}
                  <bdi className="alert-symbol" dir="ltr">
                    {symbol}
                  </bdi>{' '}
                  יחצה את מחיר היעד שאקבע.
                </p>

                <div className="alert-readout">
                  <div className="alert-readout-val" dir="ltr">
                    {trimmed === '' ? '—' : '$' + (parseFloat(trimmed) || '—')}
                  </div>
                  <div className="alert-readout-lbl">PRICE TARGET</div>
                </div>

                {formatPrice(currentPrice) !== '—' && (
                  <p className="alert-modal-current-price">
                    <span>מחיר נוכחי:</span> <bdi dir="ltr">{formatPrice(currentPrice)}</bdi>
                  </p>
                )}

                <label className="alert-modal-sublabel" htmlFor="alert-price-input">
                  מחיר יעד
                </label>
                <div className="alert-input-wrap" dir="ltr">
                  <input
                    id="alert-price-input"
                    className="auth-input alert-number-input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="e.g. 185.00"
                    dir="ltr"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    style={{ textAlign: 'center' }}
                  />
                  <span className="alert-input-suffix" dir="ltr">
                    $
                  </span>
                </div>
              </>
            )}

            <button className="upgrade-cta" type="submit" disabled={buttonDisabled} style={{ marginTop: 14 }}>
              {buttonLabel}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

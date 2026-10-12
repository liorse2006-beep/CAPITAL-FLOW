import { useUiLanguage } from '../../context/UiLanguageContext';
import { copyFor } from '../../utils/landingUiCopy';
import React from 'react';
import { TIER_COLUMNS, TIER_ROWS } from '../../constants/tierFeatures';
import planCopy from '../../utils/planCopy';

const TIER_RANK = { free: 0, premium: 1, elite: 2 };
const UPGRADE_COLUMNS = TIER_COLUMNS.filter((column) => column.key !== 'free');
const GENERIC_MATRIX_VALUES = new Set(['Included', 'Signed-in access']);

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function AccessCell({ value }) {
  const language = useUiLanguage();
  const included = value !== false;
  return (
    <span className={'tier-matrix-access ' + (included ? 'is-included' : 'is-excluded')}>
      <span
        className="tier-matrix-status"
        aria-label={included ? copyFor(language, 'Included') : copyFor(language, 'Not included')}
      >
        {included ? <CheckIcon /> : <CrossIcon />}
      </span>
    </span>
  );
}

function getVisibleFeatureDetail(value) {
  if (value === false || GENERIC_MATRIX_VALUES.has(value)) return null;
  return value;
}

function PlanAction({ column, userTier, trialEnded, payingTier, onCheckout }) {
  const language = useUiLanguage();
  if (userTier === column.key) {
    return <span className="tier-matrix-current">{copyFor(language, 'Your plan')}</span>;
  }
  if (TIER_RANK[userTier] > TIER_RANK[column.key]) return null;
  const label = trialEnded
    ? column.key === 'elite'
      ? copyFor(language, 'Get Elite')
      : copyFor(language, 'Continue with Premium')
    : copyFor(language, 'Get ') + column.label;
  return (
    <button
      className={'upgrade-cta tier-matrix-cta tier-matrix-cta-' + column.key}
      onClick={() => onCheckout(column.key)}
      disabled={payingTier === column.key}
    >
      {payingTier === column.key ? copyFor(language, 'Loading…') : label}
    </button>
  );
}

function PlanCard({ column, userTier, trialEnded, payingTier, onCheckout }) {
  const language = useUiLanguage();
  const headingId = 'tier-matrix-' + column.key + '-heading';

  return (
    <article className={'tier-matrix-plan ' + (column.featured ? 'is-featured' : '')} aria-labelledby={headingId}>
      <header className="tier-matrix-plan-heading">
        {column.featured && <span className="tier-matrix-popular">{copyFor(language, 'Most popular')}</span>}
        <h3 id={headingId} className="tier-matrix-plan-name">
          {column.label}
        </h3>
        <strong className="tier-matrix-plan-price" dir="ltr">
          {column.price}
        </strong>
        <span className="tier-matrix-plan-details">{planCopy(column.details, language)}</span>
      </header>

      <ul className="tier-matrix-feature-list">
        {TIER_ROWS.map((row) => {
          const featureValue = row[column.key];
          const specificValue = getVisibleFeatureDetail(featureValue);

          return (
            <li key={row.label} className={'tier-matrix-feature ' + (featureValue === false ? 'is-excluded' : '')}>
              <AccessCell value={featureValue} />
              <span className="tier-matrix-feature-name">
                {planCopy(row.label, language)}
                {specificValue && (
                  <span className="tier-matrix-feature-specific"> · {planCopy(specificValue, language)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <footer className="tier-matrix-plan-footer">
        <PlanAction
          column={column}
          userTier={userTier}
          trialEnded={trialEnded}
          payingTier={payingTier}
          onCheckout={onCheckout}
        />
      </footer>
    </article>
  );
}

export default function TierComparisonMatrix({ userTier = 'free', trialEnded = false, payingTier, onCheckout }) {
  const language = useUiLanguage();
  return (
    <div className="tier-matrix-scroll" dir={language === 'he' ? 'rtl' : 'ltr'} lang={language}>
      <div className="tier-matrix" role="group" aria-label={copyFor(language, 'Premium and Elite feature comparison')}>
        {UPGRADE_COLUMNS.map((column) => (
          <PlanCard
            key={column.key}
            column={column}
            userTier={userTier}
            trialEnded={trialEnded}
            payingTier={payingTier}
            onCheckout={onCheckout}
          />
        ))}
      </div>
    </div>
  );
}

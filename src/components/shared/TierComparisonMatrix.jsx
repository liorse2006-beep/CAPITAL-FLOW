import React from 'react';
import { TIER_COLUMNS, TIER_ROWS } from '../../constants/tierFeatures';

const TIER_RANK = { free: 0, premium: 1, elite: 2 };

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
  const included = value !== false;
  return (
    <span className={'tier-matrix-access ' + (included ? 'is-included' : 'is-excluded')}>
      <span className="tier-matrix-status" aria-label={included ? 'Included' : 'Not included'}>
        {included ? <CheckIcon /> : <CrossIcon />}
      </span>
      <span className="tier-matrix-value">{included ? value : 'Not included'}</span>
    </span>
  );
}

function PlanAction({ column, userTier, trialEnded, payingTier, onCheckout }) {
  if (userTier === column.key) {
    return <span className="tier-matrix-current">Your plan</span>;
  }
  if (TIER_RANK[userTier] > TIER_RANK[column.key]) return null;
  const label = trialEnded
    ? column.key === 'elite'
      ? 'Unlock Elite'
      : 'Keep scanning with Premium'
    : 'Get ' + column.label;
  return (
    <button
      className={'upgrade-cta tier-matrix-cta tier-matrix-cta-' + column.key}
      onClick={() => onCheckout(column.key)}
      disabled={payingTier === column.key}
    >
      {payingTier === column.key ? 'Loading…' : label}
    </button>
  );
}

export default function TierComparisonMatrix({ userTier = 'free', trialEnded = false, payingTier, onCheckout }) {
  return (
    <div className="tier-matrix-scroll">
      <table className="tier-matrix">
        <caption className="sr-only">Free, Premium, and Elite feature comparison</caption>
        <colgroup>
          <col className="tier-matrix-feature-col" />
          {TIER_COLUMNS.map((column) => (
            <col key={column.key} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="tier-matrix-feature-heading">
              What&apos;s included
            </th>
            {TIER_COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={'tier-matrix-plan-heading ' + (column.featured ? 'is-featured' : '')}
              >
                {column.featured && <span className="tier-matrix-popular">Most popular</span>}
                <span className="tier-matrix-plan-name">{column.label}</span>
                <strong className="tier-matrix-plan-price">{column.price}</strong>
                <span className="tier-matrix-plan-access">{column.access}</span>
                <span className="tier-matrix-plan-billing">{column.billing}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIER_ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="tier-matrix-feature-name">
                {row.label}
              </th>
              {TIER_COLUMNS.map((column) => (
                <td key={column.key} className={column.featured ? 'is-featured' : ''}>
                  <AccessCell value={row[column.key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="tier-matrix-action-label">
              Access
            </th>
            {TIER_COLUMNS.map((column) => (
              <td key={column.key} className={column.featured ? 'is-featured' : ''}>
                <PlanAction
                  column={column}
                  userTier={userTier}
                  trialEnded={trialEnded}
                  payingTier={payingTier}
                  onCheckout={onCheckout}
                />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

import React from 'react';

/**
 * The desktop result tables expose sorting through their column headers. At
 * phone widths those headers are intentionally replaced by cards, so this is
 * the equivalent compact control that keeps sorting available without
 * bringing the wide table back.
 */
export default function MobileResultSort({ options, value, direction, onSort }) {
  const directionLabel = direction === 'asc' ? 'Low to high' : 'High to low';

  return (
    <div className="mobile-results-sort" aria-label="Sort results">
      <span className="mobile-results-sort-label">SORT</span>
      <select
        className="mobile-results-sort-select"
        value={value}
        onChange={(event) => onSort(event.target.value)}
        aria-label="Sort results by"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="mobile-results-sort-direction"
        onClick={() => onSort(value)}
        aria-label={'Sort ' + directionLabel.toLowerCase()}
        title={directionLabel}
      >
        <span aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span>
        <span>{directionLabel}</span>
      </button>
    </div>
  );
}

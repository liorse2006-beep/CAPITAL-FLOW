import React from 'react';
import useModalA11y from '../../hooks/useModalA11y';

var CHECK = React.createElement(
  'svg',
  {
    viewBox: '0 0 24 24',
    width: 15,
    height: 15,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('polyline', { points: '20 6 9 17 4 12' })
);
var CROSS = React.createElement(
  'svg',
  {
    viewBox: '0 0 24 24',
    width: 13,
    height: 13,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
  React.createElement('line', { x1: '6', y1: '6', x2: '18', y2: '18' })
);

// value: true/false → check/cross icon. string → shown as plain text (e.g. "5 / 24h").
var ROWS = [
  { label: 'Price', free: 'Free', premium: '$14.90', elite: '$29.90' },
  { label: 'Scans', free: '1 trial / tool', premium: '5 / 24h', elite: 'Unlimited' },
  { label: 'Advanced filters & presets', free: false, premium: true, elite: true },
  { label: 'Float & short interest data', free: false, premium: true, elite: true },
  { label: 'Ticker notes & charts', free: false, premium: true, elite: true },
  { label: 'Push notifications', free: false, premium: false, elite: true },
  { label: 'Daily scheduled scan', free: false, premium: false, elite: true },
  { label: 'Custom watchlist alerts', free: false, premium: false, elite: true },
];

function cell(value, tierClass) {
  if (typeof value === 'string') {
    return React.createElement('td', { className: 'tier-table-cell ' + tierClass }, value);
  }
  return React.createElement(
    'td',
    { className: 'tier-table-cell ' + tierClass },
    value
      ? React.createElement('span', { className: 'tier-table-icon tier-table-icon-yes' }, CHECK)
      : React.createElement('span', { className: 'tier-table-icon tier-table-icon-no' }, CROSS)
  );
}

/* Full Free/Premium/Elite feature comparison, replacing the old two-card
   layout — one table, every row a feature, ✓/✗ (or a value like "5 / 24h")
   per tier. The user's current tier gets a "Your plan" badge instead of a
   CTA button; only tiers above the current one show a Get-<tier> button. */
function UpgradeModal(props) {
  var userTier = props.userTier || 'free';
  var onClose = props.onClose;
  var panelRef = useModalA11y(onClose);

  function ctaOrBadge(tierKey, tierLabel, ctaClass) {
    if (userTier === tierKey) {
      return React.createElement('span', { className: 'tier-table-current' }, 'Your plan');
    }
    var tierRank = { free: 0, premium: 1, elite: 2 };
    if (tierRank[userTier] > tierRank[tierKey]) return null; // already above this tier
    return React.createElement(
      'button',
      { className: 'upgrade-cta ' + ctaClass, onClick: onClose },
      'Get ' + tierLabel
    );
  }

  return React.createElement(
    'div',
    { className: 'upgrade-overlay', onClick: onClose },
    React.createElement(
      'div',
      {
        className: 'upgrade-modal tier-table-modal',
        ref: panelRef,
        tabIndex: -1,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Compare plans',
        onClick: function (e) {
          e.stopPropagation();
        },
      },
      React.createElement(
        'button',
        { className: 'upgrade-close', onClick: onClose, 'aria-label': 'Close' },
        '\xd7'
      ),
      React.createElement(
        'h2',
        { className: 'upgrade-title', style: { textAlign: 'center', marginBottom: 4 } },
        'Compare plans'
      ),
      React.createElement(
        'p',
        { className: 'upgrade-desc', style: { textAlign: 'center', marginBottom: 20 } },
        'Free gives you one trial scan per tool. Pick the plan that fits how you trade.'
      ),
      React.createElement(
        'div',
        { className: 'tier-table-wrap' },
        React.createElement(
          'table',
          { className: 'tier-table' },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              null,
              React.createElement('th', { className: 'tier-table-feature-head' }, ''),
              React.createElement('th', { className: 'tier-table-head' }, 'Free'),
              React.createElement('th', { className: 'tier-table-head tier-table-head-premium' }, 'Premium'),
              React.createElement('th', { className: 'tier-table-head tier-table-head-elite' }, 'Elite')
            )
          ),
          React.createElement(
            'tbody',
            null,
            ROWS.map(function (row) {
              return React.createElement(
                'tr',
                { key: row.label },
                React.createElement('td', { className: 'tier-table-feature' }, row.label),
                cell(row.free, ''),
                cell(row.premium, 'tier-table-cell-premium'),
                cell(row.elite, 'tier-table-cell-elite')
              );
            }),
            React.createElement(
              'tr',
              { className: 'tier-table-cta-row' },
              React.createElement('td', null),
              React.createElement('td', { className: 'tier-table-cell' }, ctaOrBadge('free', 'Free', '')),
              React.createElement(
                'td',
                { className: 'tier-table-cell tier-table-cell-premium' },
                ctaOrBadge('premium', 'Premium', '')
              ),
              React.createElement(
                'td',
                { className: 'tier-table-cell tier-table-cell-elite' },
                ctaOrBadge('elite', 'Elite', 'tier-table-elite-cta')
              )
            )
          )
        )
      )
    )
  );
}

export default UpgradeModal;

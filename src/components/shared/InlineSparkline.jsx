import React from 'react';

export default function InlineSparkline({ data }) {
  if (!data || data.length < 2) return React.createElement('span', { className: 'sparkline-empty' }, '—');
  var w = 60,
    h = 20;
  var min = data.reduce(function (a, b) {
    return Math.min(a, b);
  }, data[0]);
  var max = data.reduce(function (a, b) {
    return Math.max(a, b);
  }, data[0]);
  var range = max - min || 1;
  var pts = data
    .map(function (v, i) {
      return ((i / (data.length - 1)) * w).toFixed(1) + ',' + (h - ((v - min) / range) * (h - 2) - 1).toFixed(1);
    })
    .join(' ');
  var up = data[data.length - 1] >= data[0];
  return React.createElement(
    'svg',
    {
      viewBox: '0 0 ' + w + ' ' + h,
      className: 'inline-sparkline',
    },
    React.createElement('polyline', {
      points: pts,
      fill: 'none',
      stroke: up ? 'var(--green)' : 'var(--red)',
      strokeWidth: '1.5',
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
    })
  );
}

// Small illustrative SVG diagrams for learning pages. All values are
// schematic (every panel is labelled as an illustration), never market data.
// Hebrew pages read right-to-left, so sequence diagrams (equations, timelines,
// size scales) mirror their order by language; price charts keep time
// flowing left-to-right in both languages, as on any market chart.
const GOLD = '#f59e0b';
const GOLD_2 = '#fbbf24';
const BAR = '#3a3a3a';
const MUTED = '#a3a3ad';
const LINE = '#d4d4da';
const RED = '#f87171';

const T = {
  he: {
    average: 'ממוצע',
    price: 'מחיר',
    stages: ['בסיס', 'עלייה', 'פיזור', 'ירידה'],
    big: ['החברות', 'הגדולות'],
    funnel: ['כל המניות בקבוצה', 'נפח פי 2 ומעלה', 'שווי שוק מעל 2B', 'נשארו לבדיקה'],
    alerts: ['נפח פי 2.4', 'מחיר עבר 420$', 'ללא שינוי', 'התראה נשלחה'],
    resistance: 'התנגדות',
    support: 'תמיכה',
    breakout: 'פריצה בנפח',
    gap: 'גאפ',
    timelineNote: 'שעון ישראל, ברוב השנה',
    timeline: [
      ['לפני הפתיחה', '11:00–16:30'],
      ['מסחר רגיל', '16:30–23:00'],
      ['אחרי הסגירה', '23:00–03:00'],
    ],
    overbought: 'קנייה יתר 70',
    oversold: 'מכירת יתר 30',
    upper: 'רצועה עליונה',
    lower: 'רצועה תחתונה',
    low52: 'שפל 52 שבועות',
    high52: 'שיא 52 שבועות',
  },
  en: {
    average: 'Average',
    price: 'Price',
    stages: ['Base', 'Advance', 'Top', 'Decline'],
    big: ['Largest', 'companies'],
    funnel: ['All stocks in the list', 'Volume 2x or more', 'Market cap over 2B', 'Left to review'],
    alerts: ['Volume 2.4x', 'Price crossed $420', 'No change', 'Alert sent'],
    resistance: 'Resistance',
    support: 'Support',
    breakout: 'Breakout on volume',
    gap: 'Gap',
    timelineNote: 'New York time (ET)',
    timeline: [
      ['Pre-market', '4:00–9:30'],
      ['Regular session', '9:30–16:00'],
      ['After hours', '16:00–20:00'],
    ],
    overbought: 'Overbought 70',
    oversold: 'Oversold 30',
    upper: 'Upper band',
    lower: 'Lower band',
    low52: '52-week low',
    high52: '52-week high',
  },
};

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svg(width, height, label, body) {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" direction="ltr" style="direction:ltr" role="img" aria-label="${esc(
    label
  )}" focusable="false">${body}</svg>`;
}

function text(x, y, value, { size = 13, fill = MUTED, anchor = 'middle', mono = false, weight = 400 } = {}) {
  const family = mono ? 'JetBrains Mono, ui-monospace, Consolas, monospace' : 'Heebo, Arial, sans-serif';
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${family}">${esc(
    value
  )}</text>`;
}

function path(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
}

function series(fn, from = 10, to = 430, steps = 60) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = from + ((to - from) * i) / steps;
    out.push([x, fn(i / steps)]);
  }
  return out;
}

const BASE = [30, 36, 26, 34, 38, 28, 32, 35, 27, 33, 37, 29, 34, 31];

function volumeSpike({ label = 'RVOL 3×', spike = 3, alt }, L) {
  const avg = 32;
  const floor = 112;
  const scale = 0.95;
  let bars = '';
  BASE.forEach((h, i) => {
    bars += `<rect x="${12 + i * 27}" y="${floor - h * scale}" width="17" height="${h * scale}" fill="${BAR}" rx="2"/>`;
  });
  const spikeH = Math.min(avg * spike * scale, 100);
  const avgY = floor - avg * scale;
  return svg(
    440,
    122,
    alt,
    `${bars}<rect x="398" y="${floor - spikeH}" width="22" height="${spikeH}" fill="${GOLD}" rx="2"/>` +
      `<line x1="0" y1="${avgY}" x2="440" y2="${avgY}" stroke="${GOLD}" stroke-dasharray="4 4"/>` +
      text(392, floor - spikeH + 12, label, { fill: GOLD_2, anchor: 'end', mono: true }) +
      text(12, avgY - 6, L.average, { anchor: 'start', size: 11 })
  );
}

function priceWithMa({ label = 'SMA 50', wave = 9, trend = 46, alt }, L) {
  const ma = series((t) => 96 - trend * t);
  const price = series((t) => 96 - trend * t - 10 - Math.sin(t * 15) * wave - Math.sin(t * 37) * 3);
  return svg(
    440,
    122,
    alt,
    `<path d="${path(price)}" fill="none" stroke="${LINE}" stroke-width="1.6"/>` +
      `<path d="${path(ma)}" fill="none" stroke="${GOLD}" stroke-width="2"/>` +
      text(428, ma[ma.length - 1][1] + 16, label, { fill: GOLD_2, anchor: 'end', mono: true }) +
      text(14, price[0][1] - 8, L.price, { anchor: 'start', size: 11, fill: LINE })
  );
}

function crossover({ fast = 'SMA 50', slow = 'SMA 200', alt }) {
  const slowLine = series((t) => 70 - 10 * t);
  const fastLine = series((t) => 96 - 70 * t * t);
  const crossIndex = fastLine.findIndex((p, i) => p[1] < slowLine[i][1]);
  const [cx, cy] = fastLine[crossIndex];
  return svg(
    440,
    122,
    alt,
    `<path d="${path(slowLine)}" fill="none" stroke="${MUTED}" stroke-width="2"/>` +
      `<path d="${path(fastLine)}" fill="none" stroke="${GOLD}" stroke-width="2"/>` +
      `<circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${GOLD_2}" stroke-width="2"/>` +
      text(428, fastLine[fastLine.length - 1][1] - 6, fast, { fill: GOLD_2, anchor: 'end', mono: true }) +
      text(428, slowLine[slowLine.length - 1][1] + 16, slow, { anchor: 'end', mono: true })
  );
}

function stages({ alt }, L) {
  const curve = series((t) => {
    if (t < 0.25) return 92 + Math.sin(t * 60) * 3;
    if (t < 0.5) return 92 - (t - 0.25) * 280;
    if (t < 0.75) return 22 + Math.sin(t * 60) * 4;
    return 22 + (t - 0.75) * 300;
  });
  let body = '';
  L.stages.forEach((name, i) => {
    const x = 10 + i * 105;
    body += `<rect x="${x}" y="4" width="103" height="104" fill="${
      i === 1 ? 'rgba(245,158,11,.08)' : 'transparent'
    }" stroke="#222"/>`;
    body += text(x + 52, 120, `${i + 1} · ${name}`, { size: 11, fill: i === 1 ? GOLD_2 : MUTED });
  });
  return svg(440, 126, alt, body + `<path d="${path(curve)}" fill="none" stroke="${GOLD}" stroke-width="2"/>`);
}

function equation({ parts, result, alt, op2 = '=' }, L, rtl) {
  const [a, op, b] = parts;
  const box = (x, [value, caption], highlight) =>
    `<rect x="${x}" y="20" width="118" height="62" rx="8" fill="${highlight ? '#1f1708' : '#151515'}" stroke="${
      highlight ? '#6b4508' : '#2a2a2a'
    }"/>` +
    text(x + 59, 54, value, { size: 18, fill: highlight ? GOLD_2 : '#ececef', mono: true, weight: 500 }) +
    text(x + 59, 102, caption, { size: 14 });
  const [x1, xo1, x2, xo2, x3] = rtl ? [312, 292, 152, 140, 10] : [10, 148, 160, 300, 312];
  return svg(
    440,
    110,
    alt,
    box(x1, a, false) +
      text(xo1, 58, op, { size: 20, fill: MUTED, mono: true }) +
      box(x2, b, false) +
      text(xo2, 58, op2, { size: 20, fill: MUTED, mono: true }) +
      box(x3, result, true)
  );
}

function split({ partPct, partLabel, restLabel, alt }, L, rtl) {
  const width = 420;
  const part = Math.round((width * partPct) / 100);
  const partX = rtl ? 10 + width - part : 10;
  return svg(
    440,
    96,
    alt,
    `<rect x="10" y="22" width="${width}" height="34" rx="6" fill="${BAR}"/>` +
      `<rect x="${partX}" y="22" width="${part}" height="34" rx="6" fill="${GOLD}"/>` +
      text(partX + part / 2, 44, `${partPct}%`, { fill: '#1a1204', mono: true, weight: 500 }) +
      text(rtl ? 430 : 10, 80, partLabel, { anchor: rtl ? 'end' : 'start', fill: GOLD_2 }) +
      text(rtl ? 10 : 430, 80, restLabel, { anchor: rtl ? 'start' : 'end' })
  );
}

function timeline({ alt }, L, rtl) {
  const seg = (x, w, fill, [title, time], strong) =>
    `<rect x="${x}" y="26" width="${w}" height="30" rx="6" fill="${fill}"/>` +
    text(x + w / 2, 46, title, { fill: strong ? '#1a1204' : '#ececef', weight: 500 }) +
    text(x + w / 2, 78, time, { mono: true, size: 11 });
  const [pre, reg, after] = L.timeline;
  const layout = rtl
    ? [
        [300, 130],
        [120, 176],
        [10, 106],
      ]
    : [
        [10, 130],
        [144, 176],
        [324, 106],
      ];
  return svg(
    440,
    96,
    alt,
    seg(layout[0][0], layout[0][1], '#262626', pre, false) +
      seg(layout[1][0], layout[1][1], GOLD, reg, true) +
      seg(layout[2][0], layout[2][1], '#262626', after, false) +
      text(220, 14, L.timelineNote, { size: 11 })
  );
}

function capScale({ alt }, L, rtl) {
  const tiers = [
    ['Mega', '200B+'],
    ['Large', '10B–200B'],
    ['Mid', '2B–10B'],
    ['Small', '300M–2B'],
    ['Micro', '<300M'],
  ];
  let body = '';
  tiers.forEach(([name, range], i) => {
    const size = 52 - i * 9;
    const x = rtl ? 392 - i * 92 : 48 + i * 92;
    body += `<rect x="${x - size / 2}" y="${50 - size / 2}" width="${size}" height="${size}" rx="6" fill="${
      i === 0 ? GOLD : BAR
    }"/>`;
    body += text(x, 94, name, { fill: '#ececef', mono: true });
    body += text(x, 110, range, { size: 11, mono: true });
  });
  return svg(440, 116, alt, body);
}

function sectorBars({ highlight, alt }) {
  const rows = [
    ['XLK', 1.6],
    ['XLC', 1.1],
    ['XLY', 0.8],
    ['XLF', 0.5],
    ['XLI', 0.3],
    ['XLV', -0.2],
    ['XLE', -0.6],
    ['XLB', -0.4],
    ['XLRE', -0.9],
    ['XLP', 0.2],
    ['XLU', -0.3],
  ];
  if (highlight && !rows.some(([etf]) => etf === highlight)) rows.splice(0, 1, [highlight, 1.4]);
  const zero = 220;
  let body = `<line x1="${zero}" y1="2" x2="${zero}" y2="${rows.length * 17 + 2}" stroke="#333"/>`;
  rows.forEach(([etf, value], i) => {
    const y = 4 + i * 17;
    const w = Math.abs(value) * 90;
    const active = etf === highlight;
    const fill = active ? GOLD : value >= 0 ? '#4b4b4b' : '#2c2c2c';
    body += `<rect x="${value >= 0 ? zero : zero - w}" y="${y}" width="${w}" height="12" rx="2" fill="${fill}"/>`;
    body += text(value >= 0 ? zero - 8 : zero + 8, y + 10, etf, {
      size: 11,
      mono: true,
      anchor: value >= 0 ? 'end' : 'start',
      fill: active ? GOLD_2 : MUTED,
      weight: active ? 500 : 400,
    });
  });
  return svg(440, rows.length * 17 + 6, alt, body);
}

function indexBlocks({ alt }, L) {
  const blocks = [
    [10, 4, 150, 104, true],
    [164, 4, 110, 60, true],
    [164, 68, 110, 40, false],
    [278, 4, 74, 50, false],
    [278, 58, 74, 50, false],
    [356, 4, 74, 34, false],
    [356, 42, 74, 30, false],
    [356, 76, 74, 32, false],
  ];
  let body = '';
  blocks.forEach(([x, y, w, h, big]) => {
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${big ? GOLD : BAR}"/>`;
  });
  body += text(85, 60, L.big[0], { fill: '#1a1204', weight: 500 });
  body += text(85, 76, L.big[1], { fill: '#1a1204', weight: 500 });
  return svg(440, 112, alt, body);
}

function funnel({ alt }, L) {
  const counts = ['500', '60', '18', '5'];
  const widths = [420, 300, 190, 100];
  let body = '';
  L.funnel.forEach((label, i) => {
    const x = 220 - widths[i] / 2;
    body += `<rect x="${x}" y="${4 + i * 27}" width="${widths[i]}" height="22" rx="5" fill="${i === 3 ? GOLD : BAR}"/>`;
    body += text(220, 19 + i * 27, `${counts[i]} · ${label}`, { fill: i === 3 ? '#1a1204' : '#ececef', size: 12 });
  });
  return svg(440, 112, alt, body);
}

function alerts({ alt }, L, rtl) {
  const rows = [
    ['NVDA', L.alerts[0], true],
    ['MSFT', L.alerts[1], false],
    ['XOM', L.alerts[2], false],
  ];
  let body = '';
  rows.forEach(([ticker, label, hit], i) => {
    const y = 6 + i * 34;
    body += `<rect x="10" y="${y}" width="420" height="28" rx="6" fill="${hit ? '#1f1708' : '#151515'}" stroke="${
      hit ? '#6b4508' : '#262626'
    }"/>`;
    body += text(rtl ? 420 : 20, y + 19, ticker, {
      anchor: rtl ? 'end' : 'start',
      mono: true,
      fill: '#ececef',
      weight: 500,
    });
    body += text(rtl ? 340 : 100, y + 19, label, { anchor: rtl ? 'end' : 'start', fill: hit ? GOLD_2 : MUTED });
    if (hit)
      body += text(rtl ? 30 : 420, y + 19, L.alerts[3], { anchor: rtl ? 'start' : 'end', fill: GOLD_2, size: 11 });
  });
  return svg(440, 110, alt, body);
}

function volumePrice({ alt }, L) {
  const price = series((t) => (t < 0.7 ? 70 + Math.sin(t * 30) * 4 : 70 - (t - 0.7) * 150), 10, 430, 40);
  let bars = '';
  for (let i = 0; i < 20; i += 1) {
    const h = i === 14 ? 34 : 8 + ((i * 7) % 9);
    bars += `<rect x="${12 + i * 21}" y="${118 - h}" width="13" height="${h}" fill="${i === 14 ? GOLD : BAR}" rx="2"/>`;
  }
  return svg(
    440,
    122,
    alt,
    `<line x1="10" y1="60" x2="430" y2="60" stroke="#333" stroke-dasharray="3 4"/>` +
      `<path d="${path(price)}" fill="none" stroke="${LINE}" stroke-width="1.6"/>` +
      bars +
      text(14, 54, L.resistance, { anchor: 'start', size: 11 }) +
      text(318, 76, L.breakout, { fill: GOLD_2, size: 11 })
  );
}

function candle(x, open, close, high, low) {
  const up = close < open; // SVG y grows downward
  const color = up ? '#9ca3af' : '#4b4b4b';
  const top = Math.min(open, close);
  return (
    `<line x1="${x + 7}" y1="${high}" x2="${x + 7}" y2="${low}" stroke="${color}" stroke-width="1.5"/>` +
    `<rect x="${x}" y="${top}" width="14" height="${Math.max(2, Math.abs(open - close))}" rx="1.5" fill="${color}"/>`
  );
}

function gap({ alt }, L) {
  const before = [
    [80, 74, 70, 86],
    [76, 72, 66, 82],
    [74, 78, 68, 84],
    [78, 72, 66, 84],
    [72, 76, 68, 82],
  ];
  const after = [
    [40, 32, 28, 46],
    [34, 30, 24, 40],
    [32, 36, 26, 42],
    [36, 28, 22, 40],
  ];
  let body = '';
  before.forEach((c, i) => {
    body += candle(30 + i * 34, ...c);
  });
  after.forEach((c, i) => {
    body += candle(250 + i * 34, ...c);
  });
  body += `<rect x="214" y="46" width="30" height="20" fill="rgba(245,158,11,.15)" stroke="${GOLD}" stroke-dasharray="3 3"/>`;
  body += text(229, 100, L.gap, { fill: GOLD_2, size: 12 });
  return svg(440, 112, alt, body);
}

function levels({ alt, lineLabel }, L) {
  if (lineLabel) {
    // Single order level (limit/stop): price drifts down to the line only.
    const drift = series((t) => 34 + t * 54 + Math.sin(t * 16) * 7);
    return svg(
      440,
      122,
      alt,
      `<line x1="10" y1="92" x2="430" y2="92" stroke="${GOLD}" stroke-dasharray="5 4"/>` +
        `<path d="${path(drift)}" fill="none" stroke="${LINE}" stroke-width="1.6"/>` +
        text(430, 110, lineLabel, { anchor: 'end', size: 11, fill: GOLD_2, mono: true })
    );
  }
  const price = series((t) => 62 + Math.sin(t * 19) * 26 + Math.sin(t * 7) * 4);
  return svg(
    440,
    122,
    alt,
    `<line x1="10" y1="32" x2="430" y2="32" stroke="${RED}" stroke-dasharray="5 4" opacity=".8"/>` +
      `<line x1="10" y1="92" x2="430" y2="92" stroke="${GOLD}" stroke-dasharray="5 4"/>` +
      `<path d="${path(price)}" fill="none" stroke="${LINE}" stroke-width="1.6"/>` +
      text(430, 24, L.resistance, { anchor: 'end', size: 11, fill: RED }) +
      text(430, 110, L.support, { anchor: 'end', size: 11, fill: GOLD_2 })
  );
}

function oscillator({ alt }, L) {
  const line = series((t) => 62 - Math.sin(t * 9) * 38 - Math.sin(t * 23) * 6);
  return svg(
    440,
    122,
    alt,
    `<rect x="10" y="8" width="420" height="22" fill="rgba(248,113,113,.08)"/>` +
      `<rect x="10" y="94" width="420" height="22" fill="rgba(245,158,11,.10)"/>` +
      `<line x1="10" y1="30" x2="430" y2="30" stroke="#444"/><line x1="10" y1="94" x2="430" y2="94" stroke="#444"/>` +
      `<path d="${path(line)}" fill="none" stroke="${GOLD}" stroke-width="2"/>` +
      text(428, 24, L.overbought, { anchor: 'end', size: 11, fill: RED }) +
      text(428, 110, L.oversold, { anchor: 'end', size: 11, fill: GOLD_2 })
  );
}

function bands({ alt }, L) {
  const mid = series((t) => 70 - 20 * t);
  const width = (t) => 14 + Math.sin(t * 6) * 6 + (t > 0.7 ? 14 : 0);
  const upper = series((t) => 70 - 20 * t - width(t));
  const lower = series((t) => 70 - 20 * t + width(t));
  const price = series((t) => 70 - 20 * t + Math.sin(t * 17) * (width(t) - 3));
  return svg(
    440,
    122,
    alt,
    `<path d="${path(upper)}" fill="none" stroke="${MUTED}" stroke-width="1.2"/>` +
      `<path d="${path(lower)}" fill="none" stroke="${MUTED}" stroke-width="1.2"/>` +
      `<path d="${path(mid)}" fill="none" stroke="${GOLD}" stroke-dasharray="4 4" stroke-width="1.4"/>` +
      `<path d="${path(price)}" fill="none" stroke="${LINE}" stroke-width="1.6"/>` +
      text(14, upper[0][1] - 6, L.upper, { anchor: 'start', size: 11 }) +
      text(14, lower[0][1] + 14, L.lower, { anchor: 'start', size: 11 })
  );
}

function range({ alt, positionPct = 82, low = '$80', high = '$120', current = '$113' }, L) {
  const x = 20 + (400 * positionPct) / 100;
  return svg(
    440,
    80,
    alt,
    `<rect x="20" y="30" width="400" height="8" rx="4" fill="#2a2a2a"/>` +
      `<rect x="20" y="30" width="${x - 20}" height="8" rx="4" fill="rgba(245,158,11,.35)"/>` +
      `<circle cx="${x}" cy="34" r="9" fill="${GOLD}"/>` +
      text(x, 20, current, { mono: true, fill: GOLD_2, size: 12 }) +
      text(20, 60, low, { anchor: 'start', mono: true, size: 11 }) +
      text(420, 60, high, { anchor: 'end', mono: true, size: 11 }) +
      text(20, 76, L.low52, { anchor: 'start', size: 11 }) +
      text(420, 76, L.high52, { anchor: 'end', size: 11 })
  );
}

const RENDERERS = {
  volumeSpike,
  priceWithMa,
  crossover,
  stages,
  equation,
  split,
  timeline,
  capScale,
  sectorBars,
  indexBlocks,
  funnel,
  alerts,
  volumePrice,
  gap,
  levels,
  oscillator,
  bands,
  range,
};

function renderDiagram(diagram, lang = 'he') {
  if (!diagram) return '';
  const fn = RENDERERS[diagram.type];
  if (!fn) throw new Error(`Unknown diagram type: ${diagram.type}`);
  // Equation/split diagrams carry a full sentence in `label`; elsewhere
  // `label` is a short chart annotation, so the caption is the better alt.
  const alt = diagram.alt || (['equation', 'split'].includes(diagram.type) && diagram.label) || diagram.caption;
  return fn({ ...diagram, alt }, T[lang] || T.he, lang !== 'en');
}

module.exports = { renderDiagram, DIAGRAM_TYPES: Object.keys(RENDERERS) };

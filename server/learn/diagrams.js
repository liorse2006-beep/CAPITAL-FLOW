// Small illustrative SVG diagrams for learning pages. All values are
// schematic (every panel is labelled "המחשה"), never market data.
const GOLD = '#f59e0b';
const GOLD_2 = '#fbbf24';
const BAR = '#3a3a3a';
const MUTED = '#a3a3ad';
const LINE = '#d4d4da';

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svg(width, height, label, body) {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" direction="ltr" style="direction:ltr" role="img" aria-label="${esc(label)}" focusable="false">${body}</svg>`;
}

function text(x, y, value, { size = 13, fill = MUTED, anchor = 'middle', mono = false, weight = 400 } = {}) {
  const family = mono ? 'JetBrains Mono, ui-monospace, Consolas, monospace' : 'Heebo, Arial, sans-serif';
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${family}">${esc(value)}</text>`;
}

const BASE = [30, 36, 26, 34, 38, 28, 32, 35, 27, 33, 37, 29, 34, 31];

function volumeSpike({ label = 'RVOL 3×', spike = 3 } = {}) {
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
    'עמודות נפח יומי, קו ממוצע ועמודה אחרונה גבוהה בהרבה מהממוצע',
    `${bars}<rect x="398" y="${floor - spikeH}" width="22" height="${spikeH}" fill="${GOLD}" rx="2"/>` +
      `<line x1="0" y1="${avgY}" x2="440" y2="${avgY}" stroke="${GOLD}" stroke-dasharray="4 4"/>` +
      text(392, floor - spikeH + 12, label, { fill: GOLD_2, anchor: 'end', mono: true }) +
      text(12, avgY - 6, 'ממוצע', { anchor: 'start', size: 11 })
  );
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

function priceWithMa({ label = 'SMA 50', wave = 9, trend = 46 } = {}) {
  const ma = series((t) => 96 - trend * t);
  const price = series((t) => 96 - trend * t - 10 - Math.sin(t * 15) * wave - Math.sin(t * 37) * 3);
  return svg(
    440,
    122,
    'קו מחיר שנע מעל ממוצע נע עולה וחוזר אליו בתיקונים',
    `<path d="${path(price)}" fill="none" stroke="${LINE}" stroke-width="1.6"/>` +
      `<path d="${path(ma)}" fill="none" stroke="${GOLD}" stroke-width="2"/>` +
      text(428, ma[ma.length - 1][1] + 16, label, { fill: GOLD_2, anchor: 'end', mono: true }) +
      text(14, price[0][1] - 8, 'מחיר', { anchor: 'start', size: 11, fill: LINE })
  );
}

function crossover({ fast = 'SMA 50', slow = 'SMA 200' } = {}) {
  const slowLine = series((t) => 70 - 10 * t);
  const fastLine = series((t) => 96 - 70 * t * t);
  const crossIndex = fastLine.findIndex((p, i) => p[1] < slowLine[i][1]);
  const [cx, cy] = fastLine[crossIndex];
  return svg(
    440,
    122,
    'ממוצע קצר חוצה מעל ממוצע ארוך',
    `<path d="${path(slowLine)}" fill="none" stroke="${MUTED}" stroke-width="2"/>` +
      `<path d="${path(fastLine)}" fill="none" stroke="${GOLD}" stroke-width="2"/>` +
      `<circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${GOLD_2}" stroke-width="2"/>` +
      text(428, fastLine[fastLine.length - 1][1] - 6, fast, { fill: GOLD_2, anchor: 'end', mono: true }) +
      text(428, slowLine[slowLine.length - 1][1] + 16, slow, { anchor: 'end', mono: true })
  );
}

function stages() {
  const zones = [
    ['1', 'בסיס'],
    ['2', 'עלייה'],
    ['3', 'פיזור'],
    ['4', 'ירידה'],
  ];
  const curve = series((t) => {
    if (t < 0.25) return 92 + Math.sin(t * 60) * 3;
    if (t < 0.5) return 92 - (t - 0.25) * 280;
    if (t < 0.75) return 22 + Math.sin(t * 60) * 4;
    return 22 + (t - 0.75) * 300;
  });
  let body = '';
  zones.forEach(([n, name], i) => {
    const x = 10 + i * 105;
    body += `<rect x="${x}" y="4" width="103" height="104" fill="${i === 1 ? 'rgba(245,158,11,.08)' : 'transparent'}" stroke="#222"/>`;
    body += text(x + 52, 120, `${n} · ${name}`, { size: 11, fill: i === 1 ? GOLD_2 : MUTED });
  });
  return svg(
    440,
    126,
    'ארבעת שלבי המגמה: בסיס, עלייה, פיזור וירידה',
    body + `<path d="${path(curve)}" fill="none" stroke="${GOLD}" stroke-width="2"/>`
  );
}

function equation({ parts, result, label }) {
  // parts: [[value, caption], operator, [value, caption]]
  const [a, op, b] = parts;
  const box = (x, [value, caption], highlight) =>
    `<rect x="${x}" y="20" width="118" height="62" rx="8" fill="${highlight ? '#1f1708' : '#151515'}" stroke="${
      highlight ? '#6b4508' : '#2a2a2a'
    }"/>` +
    text(x + 59, 54, value, { size: 18, fill: highlight ? GOLD_2 : '#ececef', mono: true, weight: 500 }) +
    text(x + 59, 102, caption, { size: 14 });
  return svg(
    440,
    110,
    label,
    box(312, a, false) +
      text(292, 58, op, { size: 20, fill: MUTED, mono: true }) +
      box(152, b, false) +
      text(140, 58, '=', { size: 20, fill: MUTED, mono: true }) +
      box(10, result, true)
  );
}

function split({ partPct, partLabel, restLabel, label }) {
  const width = 420;
  const part = Math.round((width * partPct) / 100);
  return svg(
    440,
    96,
    label,
    `<rect x="10" y="22" width="${width}" height="34" rx="6" fill="${BAR}"/>` +
      `<rect x="${10 + width - part}" y="22" width="${part}" height="34" rx="6" fill="${GOLD}"/>` +
      text(10 + width - part / 2, 44, `${partPct}%`, { fill: '#1a1204', mono: true, weight: 500 }) +
      text(430, 80, partLabel, { anchor: 'end', fill: GOLD_2 }) +
      text(10, 80, restLabel, { anchor: 'start' })
  );
}

function timeline() {
  const seg = (x, w, fill, title, time, strong) =>
    `<rect x="${x}" y="26" width="${w}" height="30" rx="6" fill="${fill}"/>` +
    text(x + w / 2, 46, title, { fill: strong ? '#1a1204' : '#ececef', weight: 500 }) +
    text(x + w / 2, 78, time, { mono: true, size: 11 });
  return svg(
    440,
    96,
    'ציר זמן של יום מסחר בארה"ב בשעון ישראל: לפני הפתיחה, מסחר רגיל, אחרי הסגירה',
    seg(300, 130, '#262626', 'לפני הפתיחה', '11:00–16:30', false) +
      seg(120, 176, GOLD, 'מסחר רגיל', '16:30–23:00', true) +
      seg(10, 106, '#262626', 'אחרי הסגירה', '23:00–03:00', false) +
      text(220, 14, 'שעון ישראל, ברוב השנה', { size: 11 })
  );
}

function capScale() {
  const tiers = [
    ['Mega', '200B+'],
    ['Large', '10B–200B'],
    ['Mid', '2B–10B'],
    ['Small', '300M–2B'],
    ['Micro', '300M-'],
  ];
  let body = '';
  tiers.forEach(([name, range], i) => {
    const size = 52 - i * 9;
    const x = 392 - i * 92;
    body += `<rect x="${x - size / 2}" y="${50 - size / 2}" width="${size}" height="${size}" rx="6" fill="${
      i === 0 ? GOLD : BAR
    }"/>`;
    body += text(x, 94, name, { fill: '#ececef', mono: true });
    body += text(x, 110, range, { size: 11, mono: true });
  });
  return svg(440, 116, 'קטגוריות שווי שוק מחברות ענק ועד חברות קטנות מאוד', body);
}

function sectorBars({ highlight }) {
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
  return svg(440, rows.length * 17 + 6, `השוואת תנועה בין קרנות הסקטור, ${highlight || ''} מודגשת`, body);
}

function indexBlocks({ title }) {
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
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${big ? GOLD : BAR}" opacity="${big ? 1 : 0.9}"/>`;
  });
  body += text(85, 60, 'החברות', { fill: '#1a1204', weight: 500 });
  body += text(85, 76, 'הגדולות', { fill: '#1a1204', weight: 500 });
  return svg(440, 112, `${title}: מעט חברות גדולות תופסות חלק גדול מהמשקל`, body);
}

function funnel() {
  const rows = [
    ['500', 'כל המניות בקבוצה', 420],
    ['60', 'נפח פי 2 ומעלה', 300],
    ['18', 'שווי שוק מעל 2B', 190],
    ['5', 'נשארו לבדיקה', 100],
  ];
  let body = '';
  rows.forEach(([n, label, w], i) => {
    const x = 220 - w / 2;
    body += `<rect x="${x}" y="${4 + i * 27}" width="${w}" height="22" rx="5" fill="${i === 3 ? GOLD : BAR}"/>`;
    body += text(220, 19 + i * 27, `${n} · ${label}`, { fill: i === 3 ? '#1a1204' : '#ececef', size: 12 });
  });
  return svg(440, 112, 'משפך סינון: מכל המניות ועד רשימה קצרה לבדיקה', body);
}

function alerts() {
  const rows = [
    ['NVDA', 'נפח פי 2.4', true],
    ['MSFT', 'מחיר עבר 420$', false],
    ['XOM', 'ללא שינוי', false],
  ];
  let body = '';
  rows.forEach(([ticker, label, hit], i) => {
    const y = 6 + i * 34;
    body += `<rect x="10" y="${y}" width="420" height="28" rx="6" fill="${hit ? '#1f1708' : '#151515'}" stroke="${
      hit ? '#6b4508' : '#262626'
    }"/>`;
    body += text(420, y + 19, ticker, { anchor: 'end', mono: true, fill: '#ececef', weight: 500 });
    body += text(340, y + 19, label, { anchor: 'end', fill: hit ? GOLD_2 : MUTED });
    if (hit) body += text(30, y + 19, 'התראה נשלחה', { anchor: 'start', fill: GOLD_2, size: 11 });
  });
  return svg(440, 110, 'רשימת מעקב עם התראה שהופעלה על מניה אחת', body);
}

function volumePrice() {
  const price = series((t) => (t < 0.7 ? 70 + Math.sin(t * 30) * 4 : 70 - (t - 0.7) * 150), 10, 430, 40);
  let bars = '';
  for (let i = 0; i < 20; i += 1) {
    const h = i === 14 ? 34 : 8 + ((i * 7) % 9);
    bars += `<rect x="${12 + i * 21}" y="${118 - h}" width="13" height="${h}" fill="${i === 14 ? GOLD : BAR}" rx="2"/>`;
  }
  return svg(
    440,
    122,
    'מחיר פורץ מעל טווח דשדוש ביום עם נפח גבוה',
    `<line x1="10" y1="60" x2="430" y2="60" stroke="#333" stroke-dasharray="3 4"/>` +
      `<path d="${path(price)}" fill="none" stroke="${LINE}" stroke-width="1.6"/>` +
      bars +
      text(14, 54, 'התנגדות', { anchor: 'start', size: 11 }) +
      text(318, 76, 'פריצה בנפח', { fill: GOLD_2, size: 11 })
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
};

function renderDiagram(diagram) {
  if (!diagram) return '';
  const fn = RENDERERS[diagram.type];
  if (!fn) throw new Error(`Unknown diagram type: ${diagram.type}`);
  return fn(diagram);
}

module.exports = { renderDiagram, DIAGRAM_TYPES: Object.keys(RENDERERS) };

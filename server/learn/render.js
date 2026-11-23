const { PAGES, CATEGORIES, getPage, hasEnglish } = require('./content');
const { renderDiagram } = require('./diagrams');
const { ETFS } = require('../stocks/etfs');
const HEBREW_NAMES = require('../stocks/names');

const SITE_URL = 'https://capitalflow.vip';
const PUBLISHED = '2026-11-17';

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Copy is trusted product text but is still escaped. In Hebrew, runs of Latin
// letters, digits and symbols are isolated with <bdi> so numbers, tickers and
// ranges keep their order inside right-to-left sentences. A token never ends
// in punctuation and tokens only join across a single space, so "10%. RVOL"
// stays two runs with the period in its Hebrew place.
const TOKEN = String.raw`[A-Za-z0-9$%](?:[A-Za-z0-9$%.,:/+×÷=&'–\-]*[A-Za-z0-9$%×])?`;
const LTR_RUN = new RegExp(`${TOKEN}(?: ${TOKEN})*`, 'g');

function inline(value, lang = 'he') {
  const raw = String(value);
  if (lang === 'en') return esc(raw);
  let out = '';
  let last = 0;
  for (const match of raw.matchAll(LTR_RUN)) {
    out += esc(raw.slice(last, match.index));
    out += /[A-Za-z0-9]/.test(match[0]) ? `<bdi>${esc(match[0])}</bdi>` : esc(match[0]);
    last = match.index + match[0].length;
  }
  return out + esc(raw.slice(last));
}

function jsonLd(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

// Shown at the top of every content page, in every language, with no
// exceptions. Its wording is fixed by the owner; do not paraphrase it.
const TOP_DISCLAIMER = {
  he: 'התוכן לצורכי לימוד בלבד ואינו המלצה לפעולה. הנתונים עשויים להיות מעוכבים או לא מדויקים, ואין התחייבות לנכונותם.',
  en: 'For educational purposes only and not a recommendation to act. Data may be delayed or inaccurate, and its accuracy is not guaranteed.',
};

const UI = {
  he: {
    skip: 'דלג לתוכן',
    nav: 'ניווט ראשי',
    learn: 'מרכז הידע',
    scanners: 'סורקים',
    sectors: 'סקטורים',
    stocks: 'מניות',
    etfs: 'קרנות סל',
    cta: 'לסורק',
    footer: 'Capital Flow · כלי חינוכי למחקר מניות',
    policy: 'תנאי שימוש ופרטיות',
    accessibility: 'נגישות',
    keyPoints: 'מה חשוב לדעת',
    right: '✓ נכון',
    wrong: '✕ טעות נפוצה',
    faq: 'שאלות נפוצות',
    onPage: 'בעמוד הזה',
    rightWrong: 'נכון / טעות',
    related: 'קשור',
    illustration: 'המחשה',
    relevantTool: 'כלי רלוונטי',
    pageNav: 'ניווט בעמוד',
    otherLang: 'English',
    note: 'תוכן חינוכי בלבד. זה לא ייעוץ השקעות ולא המלצה לקנות או למכור. נתוני שוק יכולים להיות מעוכבים או חלקיים, אז כדאי לאמת לפני כל החלטה.',
    hubTitle: 'מרכז הידע של Capital Flow',
    hubLead: 'נפח מסחר, ממוצעים נעים, מכפילים וסקטורים. כל מושג מוסבר בקצרה, עם דוגמה ועם הטעות שכדאי להימנע ממנה.',
    hubMetaTitle: 'מרכז הידע — מדריכים לשוק ההון בעברית | Capital Flow',
    hubMetaDescription:
      'מדריכים קצרים בעברית: נפח מסחר חריג, RVOL, ממוצעים נעים, מכפיל רווח, PEG, Short Interest, סקטורים בשוק האמריקאי וסורקי מניות.',
  },
  en: {
    skip: 'Skip to content',
    nav: 'Main navigation',
    learn: 'Learn',
    scanners: 'Scanners',
    sectors: 'Sectors',
    stocks: 'Stocks',
    etfs: 'ETFs',
    cta: 'Open scanner',
    footer: 'Capital Flow · educational stock research tools',
    policy: 'Terms and privacy',
    accessibility: 'Accessibility',
    keyPoints: 'Key points',
    right: '✓ Do',
    wrong: '✕ Common mistake',
    faq: 'FAQ',
    onPage: 'On this page',
    rightWrong: 'Do / common mistake',
    related: 'Related',
    illustration: 'Illustration',
    relevantTool: 'Related tool',
    pageNav: 'Page navigation',
    otherLang: 'עברית',
    note: 'Educational content only. Not investment advice and not a recommendation to buy or sell. Market data can be delayed or incomplete, so verify before any decision.',
    hubTitle: 'Capital Flow learning center',
    hubLead:
      'Trading volume, moving averages, valuation ratios and sectors. Each concept explained briefly, with an example and the mistake to avoid.',
    hubMetaTitle: 'Learning center — stock market guides | Capital Flow',
    hubMetaDescription:
      'Short guides on unusual volume, RVOL, moving averages, P/E, PEG, short interest, U.S. market sectors and how to use a stock screener.',
  },
};

const STYLE = `
@font-face{font-family:Heebo;src:url(/fonts/heebo-hebrew-variable.woff2) format("woff2");font-weight:100 900;font-display:swap;unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
@font-face{font-family:Heebo;src:url(/fonts/heebo-latin-variable.woff2) format("woff2");font-weight:100 900;font-display:swap;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"JetBrains Mono";src:url(/fonts/jetbrains-mono-latin.woff2) format("woff2");font-display:swap}
:root{--bg:#0a0a0a;--panel:#111;--line:#232323;--line-2:#2e2e2e;--text:#ececef;--soft:#c9c9d0;--muted:#a3a3ad;--gold:#f59e0b;--gold-2:#fbbf24;--mono:"JetBrains Mono",ui-monospace,Consolas,monospace}
*{box-sizing:border-box}
html{color-scheme:dark;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:Heebo,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:16px;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:inherit}
a:focus-visible,summary:focus-visible{outline:2px solid var(--gold-2);outline-offset:3px;border-radius:4px}
.skip{position:absolute;inset-inline-start:-999px;top:8px;background:var(--gold);color:#1a1204;padding:8px 14px;border-radius:8px;font-weight:600}
.skip:focus{inset-inline-start:12px}
.top{border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5;background:rgba(10,10,10,.94);backdrop-filter:blur(6px)}
.top-in{max-width:1120px;margin:0 auto;padding:12px 22px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:600;font-size:15px}
.brand img{width:26px;height:26px;border-radius:7px}
.top nav{display:flex;gap:20px;align-items:center;font-size:14px}
.top nav a{color:var(--muted);text-decoration:none}
.top nav a:hover{color:var(--text)}
.top nav .cta{background:var(--gold);color:#1a1204;padding:6px 14px;border-radius:999px;font-weight:600}
.top nav .cta:hover{background:var(--gold-2);color:#1a1204}
.wrap{max-width:1120px;margin:0 auto;padding:26px 22px 64px;display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:40px}
.wrap.single{grid-template-columns:minmax(0,1fr)}
.crumb{font-size:13px;color:var(--muted);margin:0 0 10px}
.crumb a{color:var(--muted);text-decoration:none}
.crumb a:hover{color:var(--text)}
.crumb span{margin:0 6px;color:#555}
h1{font-size:clamp(28px,4.4vw,38px);line-height:1.2;font-weight:600;margin:0 0 8px;text-wrap:balance;letter-spacing:-.2px}
.top-note{font-size:13px;color:#8f8f99;margin:0 0 16px;line-height:1.55;max-width:70ch}
.lead{font-size:18px;color:var(--soft);margin:0 0 24px;max-width:62ch}
h2{font-size:19px;font-weight:600;margin:34px 0 4px}
.panel{background:#0f0f0f;border:1px solid var(--line);border-radius:12px;padding:14px 16px 10px;margin:0 0 6px}
.panel-head{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:6px}
.panel svg{display:block}
.points{list-style:none;margin:0;padding:0}
.points li{display:grid;grid-template-columns:30px minmax(0,1fr);gap:8px;padding:14px 0;border-bottom:1px solid #1b1b1b}
.points li:last-child{border-bottom:0}
.points .n{font-family:var(--mono);font-size:12px;color:var(--gold);padding-top:4px}
.points strong{display:block;font-weight:600;font-size:16px;margin-bottom:2px}
.points p{margin:0;color:#b9b9c1;font-size:15px;line-height:1.6}
.verdict{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:22px 0}
.verdict div{border-radius:12px;padding:12px 14px;font-size:15px;line-height:1.55}
.verdict b{display:block;font-size:12px;font-weight:600;margin-bottom:4px}
.ok{border:1px solid #1e3a2a;background:#0c1510}
.ok b{color:#86efac}
.no{border:1px solid #3f1d1d;background:#160c0c}
.no b{color:#fca5a5}
.cta-box{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;border:1px solid #5a3a06;background:#1a1204;border-radius:12px;padding:14px 16px;margin:26px 0}
.cta-box p{margin:0;font-weight:500}
.btn{background:var(--gold);color:#1a1204;text-decoration:none;font-weight:600;font-size:14px;padding:8px 16px;border-radius:999px;white-space:nowrap}
.btn:hover{background:var(--gold-2)}
.faq details{border-bottom:1px solid #1b1b1b;padding:12px 0}
.faq summary{cursor:pointer;font-weight:500;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--gold);font-family:var(--mono)}
.faq details[open] summary::after{content:"−"}
.faq details p{margin:8px 0 0;color:#b9b9c1;font-size:15px}
.side{position:sticky;top:76px;align-self:start;font-size:14px;border-inline-start:1px solid var(--line);padding-inline-start:18px}
.side h3{font-size:12px;font-weight:500;color:var(--muted);margin:0 0 8px;letter-spacing:.3px}
.side ul{list-style:none;margin:0 0 22px;padding:0}
.side li{padding:4px 0}
.side a{color:var(--muted);text-decoration:none}
.side a:hover{color:var(--gold-2)}
.note{margin-top:34px;font-size:13px;color:#8a8a93;border-top:1px solid var(--line);padding-top:14px;line-height:1.6}
.hub-cat{margin:34px 0 0}
.hub-cat h2{margin:0 0 4px}
.hub-cat > p{color:var(--muted);margin:0 0 14px}
.grid{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.card{display:block;height:100%;text-decoration:none;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;transition:border-color .15s}
.card:hover{border-color:#6b4508}
.card strong{display:block;font-weight:600;font-size:15px;margin-bottom:4px}
.card span{display:block;color:var(--muted);font-size:14px;line-height:1.5}
.mono{font-family:var(--mono);direction:ltr;unicode-bidi:isolate}
.price-row{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.price{font-size:26px;font-weight:600}
.price-row>div{display:flex;align-items:baseline;gap:10px}
.up{color:#86efac}.down{color:#fca5a5}
.insights{background:#1a1204;border:1px solid #5a3a06;border-radius:12px;padding:12px 16px;margin:4px 0 8px}
.insights h2{margin:0 0 4px;font-size:13px;color:var(--gold-2);font-weight:600}
.insights .points li{border-color:#3a2a0a;padding:10px 0}
.stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:8px 0}
.stat-grid div{background:#101010;padding:10px 12px}
.stat-grid dt{font-size:12px;color:var(--muted);margin-bottom:2px}
.stat-grid dt a{color:var(--muted)}
.stat-grid dd{margin:0;font-size:16px;font-weight:600}
.ma-rows{background:#0f0f0f;border:1px solid var(--line);border-radius:12px;padding:6px 16px;margin:8px 0}
.ma-rows div{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #1b1b1b;font-size:15px}
.ma-rows div:last-child{border-bottom:0}
.chip{display:inline-block;font-size:12px;padding:2px 10px;border-radius:999px;border:1px solid var(--line-2);background:#151515;color:var(--soft);text-decoration:none;margin:0 0 6px 6px}
a.chip:hover{border-color:#6b4508}
.tickers{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.tickers a{display:block;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px;text-decoration:none;font-size:14px}
.tickers a:hover{border-color:#6b4508}
.tickers b{font-family:var(--mono);font-weight:600;margin-inline-end:6px}
.tickers span{color:var(--muted)}
.foot{border-top:1px solid var(--line);color:var(--muted);font-size:13px}
.foot-in{max-width:1120px;margin:0 auto;padding:20px 22px;display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between}
.foot a{color:var(--muted)}
bdi{unicode-bidi:isolate}
@media (max-width:860px){.wrap{grid-template-columns:minmax(0,1fr);gap:0}.side{position:static;border:0;padding:0;margin-top:30px;border-top:1px solid var(--line);padding-top:18px}.side .toc{display:none}}
@media (max-width:560px){.top nav .wide{display:none}.verdict{grid-template-columns:minmax(0,1fr)}.lead{font-size:17px}.stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.card{transition:none}}
`;

function learnPath(lang, slug) {
  const base = lang === 'en' ? '/en/learn' : '/learn';
  return slug ? `${base}/${slug}` : base;
}

// alternates: { he: '/learn/x', en: '/en/learn/x' } — only languages that exist.
function layout({ lang = 'he', title, description, path, main, side, schema, robots, alternates, type = 'article' }) {
  const t = UI[lang];
  const canonical = SITE_URL + path;
  const links = alternates || { [lang]: path };
  const hreflang = Object.entries(links)
    .map(([code, href]) => `<link rel="alternate" hreflang="${code}" href="${SITE_URL}${href}">`)
    .concat(links.he ? [`<link rel="alternate" hreflang="x-default" href="${SITE_URL}${links.he}">`] : [])
    .join('\n');
  const otherLang = lang === 'he' ? 'en' : 'he';
  const switcher = links[otherLang]
    ? `<a class="wide" href="${links[otherLang]}" lang="${otherLang}">${t.otherLang}</a>`
    : '';
  const home = lang === 'en' ? '/en/learn' : '/';
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'en' ? 'ltr' : 'rtl'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots || 'index, follow, max-image-preview:large'}">
<meta name="theme-color" content="#0A0A0A">
<link rel="canonical" href="${canonical}">
${hreflang}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/heebo-${lang === 'en' ? 'latin' : 'hebrew'}-variable.woff2" as="font" type="font/woff2" crossorigin>
<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'he_IL'}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Capital Flow">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<style>${STYLE}</style>
${schema.map(jsonLd).join('\n')}
</head>
<body>
<a class="skip" href="#content">${t.skip}</a>
<header class="top"><div class="top-in">
<a class="brand" href="${home}"><img src="/icon-192.png" alt="" width="26" height="26">Capital Flow</a>
<nav aria-label="${t.nav}">
<a href="${learnPath(lang)}">${t.learn}</a>
<a class="wide" href="${lang === 'en' ? '/en' : ''}/stocks">${t.stocks}</a>
<a class="wide" href="${lang === 'en' ? '/en' : ''}/etfs">${t.etfs}</a>
${switcher}
<a class="cta" href="/scanner">${t.cta}</a>
</nav></div></header>
<div class="wrap${side ? '' : ' single'}">
<main id="content">${main}</main>
${side || ''}
</div>
<footer class="foot"><div class="foot-in">
<span>© ${t.footer}</span>
<span><a href="${learnPath(lang)}">${t.learn}</a>${lang === 'he' ? ' · <a href="/stocks">מניות</a> · <a href="/etfs">קרנות סל</a>' : ' · <a href="/en/stocks">Stocks</a> · <a href="/en/etfs">ETFs</a>'} · <a href="/policy">${
    t.policy
  }</a> · <a href="/accessibility">${t.accessibility}</a></span>
</div></footer>
</body>
</html>`;
}

function topNote(lang) {
  return `<p class="top-note" role="note">${esc(TOP_DISCLAIMER[lang])}</p>`;
}

function alternatesFor(slug) {
  const links = { he: learnPath('he', slug) };
  if (hasEnglish(slug)) links.en = learnPath('en', slug);
  return links;
}

// Learning pages point at the live stock and ETF pages that show the same
// concept on real data, so readers (and crawlers) move from the explanation to
// the numbers. Only terms that actually appear on those pages get links.
const DATA_TERMS = new Set([
  'unusual-volume',
  'relative-volume-rvol',
  'average-volume',
  'volume-and-price',
  'moving-average',
  'sma-vs-ema',
  'moving-average-20',
  'moving-average-50',
  'moving-average-150',
  'market-cap',
  'pe-ratio',
  'forward-pe',
  'peg-ratio',
  'debt-to-equity',
  'float',
  'short-interest',
  'eps',
  'week-52-high-low',
  'stock-screener',
  'institutional-money',
]);
const EXAMPLE_STOCKS = ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'META'];
const SECTOR_ANCHORS = new Set(ETFS.filter((e) => /^XL/.test(e.symbol)).map((e) => e.learn));
const LIVE = {
  he: { title: 'רואים את זה על נתונים אמיתיים', sector: 'כל המניות בסקטור', etfs: 'כל קרנות הסל' },
  en: { title: 'See it on real data', sector: 'All stocks in this sector', etfs: 'All ETFs' },
};

function liveLinks(page, lang) {
  const pre = lang === 'en' ? '/en' : '';
  const chip = (href, label) => `<li><a href="${href}">${label}</a></li>`;
  const etfChip = (e) =>
    chip(`${pre}/etfs/${e.symbol.toLowerCase()}`, `<b>${esc(e.symbol)}</b><span>${esc(e[lang])}</span>`);
  const items = [];
  for (const e of ETFS.filter((etf) => etf.learn === page.slug)) items.push(etfChip(e));
  if (SECTOR_ANCHORS.has(page.slug))
    items.push(chip(`${pre}/stocks#${page.slug}`, `<b>→</b><span>${LIVE[lang].sector}</span>`));
  if (page.slug === 'etf') {
    for (const e of ETFS.slice(0, 4)) items.push(etfChip(e));
    items.push(chip(`${pre}/etfs`, `<b>→</b><span>${LIVE[lang].etfs}</span>`));
  }
  if (DATA_TERMS.has(page.slug)) {
    for (const sym of EXAMPLE_STOCKS) {
      const name = lang === 'he' && HEBREW_NAMES[sym] ? HEBREW_NAMES[sym] : sym;
      items.push(chip(`${pre}/stocks/${sym.toLowerCase()}`, `<b>${sym}</b><span>${esc(name)}</span>`));
    }
  }
  if (!items.length) return '';
  return `<h2 id="live-data">${LIVE[lang].title}</h2><ul class="tickers">${items.join('')}</ul>`;
}

function renderPage(page, lang = 'he') {
  const t = UI[lang];
  const category = CATEGORIES[lang][page.category];
  const path = learnPath(lang, page.slug);
  const points = page.points
    .map(
      ([title, body], i) =>
        `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><div><strong>${inline(
          title,
          lang
        )}</strong><p>${inline(body, lang)}</p></div></li>`
    )
    .join('');
  const faq = page.faq
    .map(([q, a]) => `<details><summary>${inline(q, lang)}</summary><p>${inline(a, lang)}</p></details>`)
    .join('');
  const related = page.related
    .map((slug) => getPage(slug, lang))
    .filter(Boolean)
    .map((other) => `<li><a href="${learnPath(lang, other.slug)}">${esc(other.short || other.h1)}</a></li>`)
    .join('');
  const tool = page.tool;

  const main = `<p class="crumb"><a href="${learnPath(lang)}">${t.learn}</a><span>/</span><a href="${learnPath(
    lang
  )}#${page.category}">${esc(category.title)}</a></p>
<article>
<h1>${inline(page.h1, lang)}</h1>
${topNote(lang)}
<p class="lead">${inline(page.lead, lang)}</p>
<figure class="panel" style="margin:0"><div class="panel-head"><span>${esc(page.diagram.caption)}</span><span>${
    t.illustration
  }</span></div>${renderDiagram(page.diagram, lang)}</figure>
<h2 id="key-points">${t.keyPoints}</h2>
<ol class="points">${points}</ol>
<div class="verdict" id="right-wrong"><div class="ok"><b>${t.right}</b>${inline(page.right, lang)}</div><div class="no"><b>${
    t.wrong
  }</b>${inline(page.wrong, lang)}</div></div>
<aside class="cta-box" aria-label="${t.relevantTool}"><p>${inline(tool.text, lang)}</p><a class="btn" href="${esc(
    tool.href
  )}">${esc(tool.label)} ${lang === 'en' ? '→' : '←'}</a></aside>
${liveLinks(page, lang)}
${faq ? `<section class="faq" aria-labelledby="faq"><h2 id="faq">${t.faq}</h2>${faq}</section>` : ''}
<p class="note">${esc(t.note)}</p>
</article>`;

  const side = `<aside class="side" aria-label="${t.pageNav}">
<div class="toc"><h3>${t.onPage}</h3><ul><li><a href="#key-points">${t.keyPoints}</a></li><li><a href="#right-wrong">${
    t.rightWrong
  }</a></li>${faq ? `<li><a href="#faq">${t.faq}</a></li>` : ''}</ul></div>
${related ? `<h3>${t.related}</h3><ul>${related}</ul>` : ''}
</aside>`;

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.h1,
      description: page.description,
      inLanguage: lang,
      datePublished: PUBLISHED,
      dateModified: PUBLISHED,
      mainEntityOfPage: SITE_URL + path,
      image: `${SITE_URL}/og-image.png`,
      author: { '@type': 'Organization', name: 'Capital Flow', url: SITE_URL },
      publisher: {
        '@type': 'Organization',
        name: 'Capital Flow',
        logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png` },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t.learn, item: SITE_URL + learnPath(lang) },
        {
          '@type': 'ListItem',
          position: 2,
          name: category.title,
          item: `${SITE_URL}${learnPath(lang)}#${page.category}`,
        },
        { '@type': 'ListItem', position: 3, name: page.h1, item: SITE_URL + path },
      ],
    },
  ];
  if (page.faq.length) {
    schema.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    });
  }

  return layout({
    lang,
    title: page.title,
    description: page.description,
    path,
    main,
    side,
    schema,
    alternates: alternatesFor(page.slug),
  });
}

function renderHub(lang = 'he') {
  const t = UI[lang];
  const groups = Object.entries(CATEGORIES[lang])
    .map(([key, category]) => {
      const cards = PAGES.filter((page) => page.category === key)
        .map((page) => getPage(page.slug, lang))
        .filter(Boolean)
        .map(
          (page) =>
            `<li><a class="card" href="${learnPath(lang, page.slug)}"><strong>${inline(
              page.short || page.h1,
              lang
            )}</strong><span>${inline(page.lead, lang)}</span></a></li>`
        )
        .join('');
      return `<section class="hub-cat" id="${key}" aria-labelledby="${key}-t"><h2 id="${key}-t">${esc(
        category.title
      )}</h2><p>${esc(category.intro)}</p><ul class="grid">${cards}</ul></section>`;
    })
    .join('');

  const main = `<h1>${esc(t.hubTitle)}</h1>
${topNote(lang)}
<p class="lead">${esc(t.hubLead)}</p>
${groups}
<p class="note">${esc(t.note)}</p>`;

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: t.hubTitle,
      inLanguage: lang,
      url: SITE_URL + learnPath(lang),
      hasPart: PAGES.filter((page) => lang === 'he' || hasEnglish(page.slug)).map((page) => ({
        '@type': 'Article',
        headline: getPage(page.slug, lang).h1,
        url: SITE_URL + learnPath(lang, page.slug),
      })),
    },
  ];

  return layout({
    lang,
    title: t.hubMetaTitle,
    description: t.hubMetaDescription,
    path: learnPath(lang),
    main,
    schema,
    type: 'website',
    alternates: { he: '/learn', en: '/en/learn' },
  });
}

module.exports = { renderPage, renderHub, layout, inline, esc, topNote, learnPath, SITE_URL, PUBLISHED, UI };

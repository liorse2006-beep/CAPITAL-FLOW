const { layout, inline, esc, topNote, SITE_URL, UI } = require('../learn/render');
const { renderDiagram } = require('../learn/diagrams');
const HEBREW_NAMES = require('./names');
const { slugFor, indexesFor, SYMBOLS } = require('./universe');
const { insightsFor, formatDate } = require('./insights');
const { isIndexable } = require('./store');

const SECTORS = {
  Technology: ['טכנולוגיה', 'technology-sector'],
  'Financial Services': ['פיננסים', 'financials-sector'],
  Healthcare: ['בריאות', 'healthcare-sector'],
  'Consumer Cyclical': ['צריכה מחזורית', 'consumer-discretionary-sector'],
  'Consumer Defensive': ['צריכה בסיסית', 'consumer-staples-sector'],
  Energy: ['אנרגיה', 'energy-sector'],
  Industrials: ['תעשייה', 'industrials-sector'],
  'Basic Materials': ['חומרים', 'materials-sector'],
  'Real Estate': ['נדל"ן', 'real-estate-sector'],
  Utilities: ['תשתיות', 'utilities-sector'],
  'Communication Services': ['שירותי תקשורת', 'communication-services-sector'],
};

// Industries that have their own dedicated learning page.
const INDUSTRY_PAGES = {
  Semiconductors: 'semiconductors-sector',
  'Software - Infrastructure': 'software-sector',
  'Software - Application': 'software-sector',
  'Oil & Gas E&P': 'oil-gas-exploration-sector',
  'Telecom Services': 'telecom-sector',
};

const COUNTRIES = {
  'United States': 'ארה"ב',
  Netherlands: 'הולנד',
  'United Kingdom': 'בריטניה',
  Ireland: 'אירלנד',
  Canada: 'קנדה',
};

function displayName(snapshot) {
  return HEBREW_NAMES[snapshot.symbol] || snapshot.name || snapshot.symbol;
}

function money(value) {
  if (value == null) return null;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function big(value, prefix = '') {
  if (value == null) return null;
  const abs = Math.abs(value);
  const [div, unit] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  return `${prefix}${(value / div).toFixed(value / div >= 100 ? 0 : value / div >= 10 ? 1 : 2)}${unit}`;
}

function num(value, digits = 1) {
  return value == null ? null : value.toFixed(digits);
}

function signedPct(value) {
  if (value == null) return null;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

const UNAVAILABLE = 'לא זמין';

function stat(label, value, href) {
  const term = href ? `<a href="${href}">${esc(label)}</a>` : esc(label);
  return `<div><dt>${term}</dt><dd>${value == null ? `<span style="color:var(--muted);font-weight:400">${UNAVAILABLE}</span>` : `<span class="mono">${esc(value)}</span>`}</dd></div>`;
}

function maRow(label, average, price) {
  if (!average || !price)
    return `<div><span>${label}</span><span style="color:var(--muted)">${UNAVAILABLE}</span></div>`;
  const diff = (price / average - 1) * 100;
  return `<div><span>${label}</span><span><span class="mono" style="color:var(--muted)">${money(average)}</span> · <span class="mono ${
    diff >= 0 ? 'up' : 'down'
  }">${signedPct(diff)}</span></span></div>`;
}

function peersFor(snapshot, all) {
  const pool = [...all.values()].filter((s) => s.symbol !== snapshot.symbol && isIndexable(s));
  let peers = pool.filter((s) => s.industry && s.industry === snapshot.industry);
  if (peers.length < 3) peers = pool.filter((s) => s.sector && s.sector === snapshot.sector);
  return peers.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 8);
}

function aboutSentence(s) {
  const parts = [];
  const sector = SECTORS[s.sector];
  if (s.industry && sector) parts.push(`פועלת בענף ${s.industry}, בסקטור ${sector[0]}.`);
  else if (sector) parts.push(`פועלת בסקטור ${sector[0]}.`);
  const country = COUNTRIES[s.country] || s.country;
  if (s.city && country) parts.push(`המטה ב-${s.city}, ${country}.`);
  if (s.employees) parts.push(`כ-${Math.round(s.employees).toLocaleString('en-US')} עובדים.`);
  const indexes = indexesFor(s.symbol).map((name) => (name === 'Nasdaq-100' ? 'נאסד"ק 100' : name));
  if (indexes.length) parts.push(`נכללת ב-${indexes.join(' ובמדד ')}.`);
  return parts.join(' ');
}

function renderStockPage(snapshot, all) {
  const t = UI.he;
  const sym = snapshot.symbol;
  const he = HEBREW_NAMES[sym];
  const path = `/stocks/${slugFor(sym)}`;
  const indexable = isIndexable(snapshot);
  const sector = SECTORS[snapshot.sector];
  const industryPage = INDUSTRY_PAGES[snapshot.industry];
  const title = he
    ? `מניית ${he} (${sym}): נפח, ממוצעים נעים ונתונים | Capital Flow`
    : `${snapshot.name} (${sym}): נפח, ממוצעים נעים ונתונים | Capital Flow`;
  const description = `${he ? `מניית ${he}` : snapshot.name} (${sym}): מחיר, נפח מסחר, מרחק מממוצעים נעים 20, 50 ו-150, טווח 52 שבועות, מכפיל רווח, PEG, Float ו-Short Interest. מתעדכן אחרי כל יום מסחר.`;

  const insights = insightsFor(snapshot);
  const insightsHtml = insights.length
    ? `<section class="insights" aria-labelledby="insights-t"><h2 id="insights-t">מה הנתונים מראים</h2><ol class="points">${insights
        .map(
          (line, i) =>
            `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><div><p style="color:var(--text)">${inline(line)}</p></div></li>`
        )
        .join('')}</ol></section>`
    : '';

  const range =
    snapshot.high52 && snapshot.low52 && snapshot.price && snapshot.high52 > snapshot.low52
      ? `<figure class="panel" style="margin:10px 0 0"><div class="panel-head"><span>טווח 52 שבועות</span></div>${renderDiagram(
          {
            type: 'range',
            caption: 'מיקום המחיר בטווח 52 השבועות',
            positionPct: Math.max(
              0,
              Math.min(100, ((snapshot.price - snapshot.low52) / (snapshot.high52 - snapshot.low52)) * 100)
            ),
            low: money(snapshot.low52),
            high: money(snapshot.high52),
            current: money(snapshot.price),
          }
        )}</figure>`
      : '';

  const peers = peersFor(snapshot, all);
  const crumbs = [`<a href="/stocks">מניות</a>`];
  if (sector) crumbs.push(`<a href="/stocks#${sector[1]}">${esc(sector[0])}</a>`);

  const main = `<p class="crumb">${crumbs.join('<span>/</span>')}</p>
<article>
<div class="price-row">
<h1>${he ? `מניית ${esc(he)}` : esc(snapshot.name)} (<span class="mono">${esc(sym)}</span>)</h1>
<div><span class="mono price">${esc(money(snapshot.price) || '')}</span> ${
    snapshot.changePct != null
      ? `<span class="mono ${snapshot.changePct >= 0 ? 'up' : 'down'}">${esc(signedPct(snapshot.changePct))}</span>`
      : ''
  }</div>
</div>
${topNote('he')}
<p class="lead" style="font-size:15px;color:var(--muted)">${he ? `<span class="mono">${esc(snapshot.name)}</span> · ` : ''}מחיר סגירה ליום המסחר ${esc(
    formatDate(snapshot.session)
  )}</p>
${insightsHtml}
<h2 id="ma">מחיר מול הממוצעים הנעים</h2>
<div class="ma-rows">
${maRow('ממוצע נע <span class="mono">20</span>', snapshot.sma20, snapshot.price)}
${maRow('ממוצע נע <span class="mono">50</span>', snapshot.sma50, snapshot.price)}
${maRow('ממוצע נע <span class="mono">150</span>', snapshot.sma150, snapshot.price)}
</div>
${range}
<h2 id="stats">נתונים פיננסיים</h2>
<dl class="stat-grid">
${stat('שווי שוק', big(snapshot.marketCap, '$'), '/learn/market-cap')}
${stat('מכפיל רווח (P/E)', num(snapshot.pe), '/learn/pe-ratio')}
${stat('Forward P/E', num(snapshot.forwardPE), '/learn/forward-pe')}
${stat('יחס PEG', num(snapshot.peg, 2), '/learn/peg-ratio')}
${stat('חוב להון', num(snapshot.debtToEquity, 2), '/learn/debt-to-equity')}
${stat('צמיחת הכנסות (5 שנים)', snapshot.revenueGrowth5Y == null ? null : `${snapshot.revenueGrowth5Y.toFixed(1)}%`)}
${stat('Float', big(snapshot.floatShares), '/learn/float')}
${stat('Short מה-Float', snapshot.shortPercent == null ? null : `${(snapshot.shortPercent * 100).toFixed(1)}%`, '/learn/short-interest')}
${stat('נפח ממוצע (3 חודשים)', big(snapshot.avgVolume3m), '/learn/average-volume')}
${stat('נפח ביום האחרון', big(snapshot.volume), '/learn/relative-volume-rvol')}
${stat('דוח רבעוני הבא', snapshot.nextEarningsDate ? formatDate(snapshot.nextEarningsDate) : null, '/learn/eps')}
${stat('סקטור', sector ? sector[0] : null)}
</dl>
<h2 id="about">על החברה</h2>
<p style="margin:6px 0 10px">${inline(aboutSentence(snapshot) || 'פרטי החברה לא זמינים כרגע.')}</p>
<p style="margin:0 0 6px">${
    sector ? `<a class="chip" href="/learn/${sector[1]}">מדריך: סקטור ${esc(sector[0])}</a>` : ''
  }${industryPage && industryPage !== (sector && sector[1]) ? `<a class="chip" href="/learn/${industryPage}">מדריך: הענף</a>` : ''}</p>
${
  peers.length
    ? `<h2 id="peers">מניות נוספות ${peers[0].industry === snapshot.industry ? 'באותו ענף' : 'באותו סקטור'}</h2><ul class="tickers">${peers
        .map(
          (p) =>
            `<li><a href="/stocks/${slugFor(p.symbol)}"><b>${esc(p.symbol)}</b><span>${esc(displayName(p))}</span></a></li>`
        )
        .join('')}</ul>`
    : ''
}
<aside class="cta-box" aria-label="${t.relevantTool}"><p>רוצים לבדוק אם ${esc(sym)} נסחרת היום בנפח חריג?</p><a class="btn" href="/scanner">התחל לסרוק ←</a></aside>
<p class="note">${esc(t.note)}</p>
</article>`;

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title.replace(' | Capital Flow', ''),
      description,
      inLanguage: 'he',
      url: SITE_URL + path,
      dateModified: new Date(snapshot.asOf || Date.now()).toISOString().slice(0, 10),
      about: { '@type': 'Corporation', name: snapshot.name, tickerSymbol: sym },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'מניות', item: `${SITE_URL}/stocks` },
        { '@type': 'ListItem', position: 2, name: he ? `מניית ${he}` : snapshot.name, item: SITE_URL + path },
      ],
    },
  ];

  return layout({
    lang: 'he',
    title,
    description,
    path,
    main,
    schema,
    type: 'website',
    robots: indexable ? undefined : 'noindex, follow',
    alternates: { he: path },
  });
}

// Shown before the first snapshot exists for a symbol: honest and noindex.
function renderPendingStock(symbol) {
  const path = `/stocks/${slugFor(symbol)}`;
  const name = HEBREW_NAMES[symbol] ? `מניית ${HEBREW_NAMES[symbol]}` : symbol;
  const main = `<p class="crumb"><a href="/stocks">מניות</a></p><article><h1>${esc(name)} (<span class="mono">${esc(
    symbol
  )}</span>)</h1>${topNote('he')}<p class="lead">הנתונים של המניה הזו עדיין לא עודכנו. הם יופיעו כאן אחרי יום המסחר הבא.</p><aside class="cta-box"><p>בינתיים אפשר לסרוק את השוק.</p><a class="btn" href="/scanner">התחל לסרוק ←</a></aside><p class="note">${esc(
    UI.he.note
  )}</p></article>`;
  return layout({
    lang: 'he',
    title: `${name} (${symbol}) | Capital Flow`,
    description: `${name} (${symbol}) — נתוני מסחר ונתונים פיננסיים.`,
    path,
    main,
    schema: [],
    robots: 'noindex, follow',
    alternates: { he: path },
  });
}

function renderStocksHub(all) {
  const groups = new Map(Object.entries(SECTORS).map(([key, [label, slug]]) => [key, { label, slug, items: [] }]));
  const other = { label: 'מניות נוספות', slug: 'other', items: [] };
  for (const symbol of SYMBOLS) {
    const snapshot = all.get(symbol);
    const item = {
      symbol,
      name: snapshot ? displayName(snapshot) : HEBREW_NAMES[symbol] || symbol,
      cap: snapshot ? snapshot.marketCap || 0 : 0,
    };
    const group = snapshot && groups.get(snapshot.sector);
    (group || other).items.push(item);
  }
  const sections = [...groups.values(), other]
    .filter((g) => g.items.length)
    .map(
      (g) =>
        `<section class="hub-cat" id="${g.slug}" aria-labelledby="${g.slug}-t"><h2 id="${g.slug}-t">${esc(g.label)} <span style="color:var(--muted);font-weight:400;font-size:14px">(${
          g.items.length
        })</span></h2><ul class="tickers">${g.items
          .sort((a, b) => b.cap - a.cap)
          .map(
            (i) =>
              `<li><a href="/stocks/${slugFor(i.symbol)}"><b>${esc(i.symbol)}</b><span>${esc(i.name)}</span></a></li>`
          )
          .join('')}</ul></section>`
    )
    .join('');

  const main = `<h1>מניות: S&amp;P 500 ונאסד"ק 100</h1>
${topNote('he')}
<p class="lead">עמוד לכל מניה: מחיר, נפח, מרחק מהממוצעים הנעים, טווח 52 שבועות ונתונים פיננסיים. מתעדכן אחרי כל יום מסחר.</p>
${sections}
<p class="note">${esc(UI.he.note)}</p>`;

  return layout({
    lang: 'he',
    title: 'מניות S&P 500 ונאסד"ק 100 — נתונים לכל מניה | Capital Flow',
    description:
      'עמוד לכל מניה ב-S&P 500 ובנאסד"ק 100: מחיר, נפח מסחר, ממוצעים נעים, טווח 52 שבועות ונתונים פיננסיים, לפי סקטורים.',
    path: '/stocks',
    main,
    schema: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'מניות S&P 500 ונאסד"ק 100',
        inLanguage: 'he',
        url: `${SITE_URL}/stocks`,
      },
    ],
    type: 'website',
    alternates: { he: '/stocks' },
  });
}

module.exports = { renderStockPage, renderPendingStock, renderStocksHub };

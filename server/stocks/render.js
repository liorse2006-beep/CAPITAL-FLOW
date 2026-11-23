const { layout, inline, esc, topNote, SITE_URL, UI } = require('../learn/render');
const { renderDiagram } = require('../learn/diagrams');
const HEBREW_NAMES = require('./names');
const { slugFor, indexesFor, SYMBOLS } = require('./universe');
const STOCK_SET = new Set(SYMBOLS);
const { etfMeta } = require('./etfs');
const { insightsFor, formatDate } = require('./insights');
const { isIndexable } = require('./store');

const SECTORS = {
  Technology: { he: 'טכנולוגיה', en: 'Technology', learn: 'technology-sector' },
  'Financial Services': { he: 'פיננסים', en: 'Financials', learn: 'financials-sector' },
  Healthcare: { he: 'בריאות', en: 'Health Care', learn: 'healthcare-sector' },
  'Consumer Cyclical': { he: 'צריכה מחזורית', en: 'Consumer Discretionary', learn: 'consumer-discretionary-sector' },
  'Consumer Defensive': { he: 'צריכה בסיסית', en: 'Consumer Staples', learn: 'consumer-staples-sector' },
  Energy: { he: 'אנרגיה', en: 'Energy', learn: 'energy-sector' },
  Industrials: { he: 'תעשייה', en: 'Industrials', learn: 'industrials-sector' },
  'Basic Materials': { he: 'חומרים', en: 'Materials', learn: 'materials-sector' },
  'Real Estate': { he: 'נדל"ן', en: 'Real Estate', learn: 'real-estate-sector' },
  Utilities: { he: 'תשתיות', en: 'Utilities', learn: 'utilities-sector' },
  'Communication Services': {
    he: 'שירותי תקשורת',
    en: 'Communication Services',
    learn: 'communication-services-sector',
  },
};

// Industries that have their own dedicated learning page.
const INDUSTRY_PAGES = {
  Semiconductors: 'semiconductors-sector',
  'Software - Infrastructure': 'software-sector',
  'Software - Application': 'software-sector',
  'Oil & Gas E&P': 'oil-gas-exploration-sector',
  'Telecom Services': 'telecom-sector',
};

const COUNTRIES_HE = {
  'United States': 'ארה"ב',
  Netherlands: 'הולנד',
  'United Kingdom': 'בריטניה',
  Ireland: 'אירלנד',
  Canada: 'קנדה',
  Switzerland: 'שווייץ',
  Spain: 'ספרד',
};

const S = {
  he: {
    stocks: 'מניות',
    etfs: 'קרנות סל',
    unavailable: 'לא זמין',
    insights: 'מה הנתונים מראים',
    close: 'סגירה אחרונה',
    asOf: (d) => `הנתונים נכונים לסגירת יום המסחר ${d}.`,
    maTitle: 'מחיר מול הממוצעים הנעים',
    ma: (n) => `ממוצע נע <span class="mono">${n}</span>`,
    range: 'טווח 52 שבועות',
    rangeCaption: 'מיקום המחיר בטווח 52 השבועות',
    stats: 'נתונים פיננסיים',
    marketCap: 'שווי שוק',
    pe: 'מכפיל רווח (P/E)',
    forwardPE: 'Forward P/E',
    peg: 'יחס PEG',
    de: 'חוב להון',
    growth: 'צמיחת הכנסות (5 שנים)',
    float: 'Float',
    short: 'Short מה-Float',
    avgVol: 'נפח ממוצע (3 חודשים)',
    vol: 'נפח ביום האחרון',
    earnings: 'דוח רבעוני הבא',
    sector: 'סקטור',
    about: 'על החברה',
    aboutMissing: 'פרטי החברה לא זמינים כרגע.',
    guideSector: (name) => `מדריך: סקטור ${name}`,
    guideIndustry: 'מדריך: הענף',
    peersIndustry: 'מניות נוספות באותו ענף',
    peersSector: 'מניות נוספות באותו סקטור',
    stockCta: (sym) => `רוצים לבדוק אם ${sym} נסחרת היום בנפח חריג?`,
    scanBtn: 'התחל לסרוק ←',
    pending: 'הנתונים מתעדכנים כרגע ויופיעו כאן בקרוב.',
    pendingCta: 'בינתיים אפשר לסרוק את השוק.',
    tracks: (t) => `עוקבת אחרי ${t}.`,
    holdings: 'האחזקות הגדולות',
    holdingsNote: 'משקל באחוזים מתוך הקרן',
    fundFacts: 'נתוני הקרן',
    family: 'מנהל הקרן',
    expense: 'דמי ניהול',
    assets: 'נכסים מנוהלים',
    yield: 'תשואת דיבידנד',
    guideEtf: 'מדריך: מה זה ETF',
    guideTracked: 'מדריך: מה הקרן עוקבת אחריו',
    etfCta: 'רוצים לראות אילו סקטורים זזים היום?',
    etfBtn: 'לתצוגת הסקטורים ←',
  },
  en: {
    stocks: 'Stocks',
    etfs: 'ETFs',
    unavailable: 'N/A',
    insights: 'What the data shows',
    close: 'Last close',
    asOf: (d) => `Data as of the close of the ${d} session.`,
    maTitle: 'Price vs. moving averages',
    ma: (n) => `<span class="mono">${n}</span>-day moving average`,
    range: '52-week range',
    rangeCaption: 'Price position in the 52-week range',
    stats: 'Key data',
    marketCap: 'Market cap',
    pe: 'P/E ratio',
    forwardPE: 'Forward P/E',
    peg: 'PEG ratio',
    de: 'Debt/Equity',
    growth: 'Revenue growth (5Y)',
    float: 'Float',
    short: 'Short % of float',
    avgVol: 'Avg volume (3M)',
    vol: 'Last session volume',
    earnings: 'Next earnings',
    sector: 'Sector',
    about: 'About the company',
    aboutMissing: 'Company details are not available right now.',
    guideSector: (name) => `Guide: ${name} sector`,
    guideIndustry: 'Guide: the industry',
    peersIndustry: 'More stocks in the same industry',
    peersSector: 'More stocks in the same sector',
    stockCta: (sym) => `Want to check whether ${sym} is trading on unusual volume today?`,
    scanBtn: 'Start scanning →',
    pending: 'Data is being updated and will appear here shortly.',
    pendingCta: 'Meanwhile, you can scan the market.',
    tracks: (t) => `Tracks ${t}.`,
    holdings: 'Top holdings',
    holdingsNote: 'Weight as a percent of the fund',
    fundFacts: 'Fund facts',
    family: 'Fund manager',
    expense: 'Expense ratio',
    assets: 'Assets under management',
    yield: 'Dividend yield',
    guideEtf: 'Guide: what an ETF is',
    guideTracked: 'Guide: what the fund tracks',
    etfCta: 'Want to see which sectors are moving today?',
    etfBtn: 'Open sector view →',
  },
};

const prefix = (lang) => (lang === 'en' ? '/en' : '');
const learnHref = (lang, slug) => `${prefix(lang)}/learn/${slug}`;
const stockHref = (lang, symbol) => `${prefix(lang)}/stocks/${slugFor(symbol)}`;
const etfHref = (lang, symbol) => `${prefix(lang)}/etfs/${symbol.toLowerCase()}`;

function cleanName(name) {
  return String(name || '')
    .replace(/\s+Class [A-C]$/i, '')
    .replace(/,?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|plc|PLC|N\.V\.|Ltd\.?|Limited)$/i, '')
    .trim();
}

function displayName(snapshot, lang) {
  if (lang === 'he' && HEBREW_NAMES[snapshot.symbol]) return HEBREW_NAMES[snapshot.symbol];
  return cleanName(snapshot.name) || snapshot.symbol;
}

function money(value) {
  if (value == null) return null;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function big(value, sign = '') {
  if (value == null) return null;
  const abs = Math.abs(value);
  const [div, unit] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const scaled = value / div;
  return `${sign}${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${unit}`;
}

function num(value, digits = 1) {
  return value == null ? null : value.toFixed(digits);
}

function percent(value, digits = 2) {
  return value == null ? null : `${(value * 100).toFixed(digits)}%`;
}

function signedPct(value) {
  if (value == null) return null;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

function stat(t, label, value, href, plain = false) {
  const term = href ? `<a href="${href}">${esc(label)}</a>` : esc(label);
  const body =
    value == null
      ? `<span style="color:var(--muted);font-weight:400">${t.unavailable}</span>`
      : plain
        ? `<span style="font-size:15px">${esc(value)}</span>`
        : `<span class="mono">${esc(value)}</span>`;
  return `<div><dt>${term}</dt><dd>${body}</dd></div>`;
}

function maRows(t, s) {
  const row = (n, average) => {
    if (!average || !s.price)
      return `<div><span>${t.ma(n)}</span><span style="color:var(--muted)">${t.unavailable}</span></div>`;
    const diff = (s.price / average - 1) * 100;
    return `<div><span>${t.ma(n)}</span><span><span class="mono" style="color:var(--muted)">${money(
      average
    )}</span> · <span class="mono ${diff >= 0 ? 'up' : 'down'}">${signedPct(diff)}</span></span></div>`;
  };
  return `<h2 id="ma">${t.maTitle}</h2><div class="ma-rows">${row(20, s.sma20)}${row(50, s.sma50)}${row(150, s.sma150)}</div>`;
}

function rangePanel(t, s, lang) {
  if (!(s.high52 && s.low52 && s.price && s.high52 > s.low52)) return '';
  return `<figure class="panel" style="margin:10px 0 0"><div class="panel-head"><span>${t.range}</span></div>${renderDiagram(
    {
      type: 'range',
      caption: t.rangeCaption,
      positionPct: Math.max(0, Math.min(100, ((s.price - s.low52) / (s.high52 - s.low52)) * 100)),
      low: money(s.low52),
      high: money(s.high52),
      current: money(s.price),
    },
    lang
  )}</figure>`;
}

function insightsBlock(t, s, lang) {
  const lines = insightsFor(s, new Date().toISOString().slice(0, 10), lang);
  if (!lines.length) return '';
  return `<section class="insights" aria-labelledby="insights-t"><h2 id="insights-t">${t.insights}</h2><ol class="points">${lines
    .map(
      (line, i) =>
        `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><div><p style="color:var(--text)">${inline(
          line,
          lang
        )}</p></div></li>`
    )
    .join('')}</ol></section>`;
}

function asOfLine(s, lang) {
  return `<p style="margin:14px 0 0;font-size:12px;color:var(--muted)">${esc(
    S[lang].asOf(formatDate(s.priceDate || s.session, lang))
  )}</p>`;
}

function priceHeader(s, h1Html, lang) {
  const t = S[lang];
  const change =
    s.changePct != null
      ? `<span class="mono ${s.changePct >= 0 ? 'up' : 'down'}">${esc(signedPct(s.changePct))}</span>`
      : '';
  const englishName = lang === 'he' && HEBREW_NAMES[s.symbol] ? `<span class="mono">${esc(s.name)}</span> · ` : '';
  return `<div class="price-row"><h1>${h1Html}</h1><div><span class="mono price">${esc(
    money(s.price) || ''
  )}</span> ${change}</div></div>${topNote(lang)}<p class="lead" style="font-size:15px;color:var(--muted)">${englishName}${esc(t.close)}</p>`;
}

function peersFor(snapshot, all) {
  const pool = [...all.values()].filter((s) => s.kind !== 'etf' && s.symbol !== snapshot.symbol && isIndexable(s));
  let peers = pool.filter((s) => s.industry && s.industry === snapshot.industry);
  if (peers.length < 3) peers = pool.filter((s) => s.sector && s.sector === snapshot.sector);
  return peers.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 8);
}

function aboutSentence(s, lang) {
  const sector = SECTORS[s.sector];
  const indexes = indexesFor(s.symbol);
  const parts = [];
  if (lang === 'en') {
    if (s.industry && sector) parts.push(`Operates in the ${s.industry} industry, in the ${sector.en} sector.`);
    else if (sector) parts.push(`Operates in the ${sector.en} sector.`);
    if (s.city && s.country) parts.push(`Headquartered in ${s.city}, ${s.country}.`);
    if (s.employees) parts.push(`About ${Math.round(s.employees).toLocaleString('en-US')} employees.`);
    if (indexes.length) parts.push(`Included in the ${indexes.join(' and the ')}.`);
    return parts.join(' ');
  }
  if (s.industry && sector) parts.push(`פועלת בענף ${s.industry}, בסקטור ${sector.he}.`);
  else if (sector) parts.push(`פועלת בסקטור ${sector.he}.`);
  const country = COUNTRIES_HE[s.country] || s.country;
  if (s.city && country) parts.push(`המטה ב-${s.city}, ${country}.`);
  if (s.employees) parts.push(`כ-${Math.round(s.employees).toLocaleString('en-US')} עובדים.`);
  const heIndexes = indexes.map((name) => (name === 'Nasdaq-100' ? 'נאסד"ק 100' : name));
  if (heIndexes.length) parts.push(`נכללת ב-${heIndexes.join(' ובמדד ')}.`);
  return parts.join(' ');
}

// Titles and descriptions stay true between crawls: no price or date, since
// Google can show a cached snippet for days and a stale number looks outdated.
function stockLabel(s, lang) {
  return (lang === 'he' && HEBREW_NAMES[s.symbol]) || cleanName(s.name) || s.symbol;
}

function stockTitle(s, lang) {
  return lang === 'en'
    ? `${stockLabel(s, lang)} (${s.symbol}) Stock Price | Capital Flow`
    : `מחיר מניית ${stockLabel(s, lang)} | Capital Flow`;
}

function stockDescription(s, lang) {
  const name = stockLabel(s, lang);
  return lang === 'en'
    ? `${name} stock price, trading volume vs. average, 20, 50 and 150-day moving averages and 52-week range. Updated after every trading session.`
    : `מחיר מניית ${name}, נפח המסחר מול הממוצע, ממוצעים נעים 20, 50 ו-150 וטווח 52 שבועות. מתעדכן אחרי כל יום מסחר.`;
}

function renderStockPage(snapshot, all, lang = 'he') {
  const t = S[lang];
  const sym = snapshot.symbol;
  const path = stockHref(lang, sym);
  const sector = SECTORS[snapshot.sector];
  const industryPage = INDUSTRY_PAGES[snapshot.industry];
  const he = lang === 'he' && HEBREW_NAMES[sym];
  const nameHtml = he ? `מניית ${esc(he)}` : esc(cleanName(snapshot.name));
  const h1 = `${nameHtml} (<span class="mono">${esc(sym)}</span>)`;
  const peers = peersFor(snapshot, all);
  const crumbs = [`<a href="${prefix(lang)}/stocks">${t.stocks}</a>`];
  if (sector) crumbs.push(`<a href="${prefix(lang)}/stocks#${sector.learn}">${esc(sector[lang])}</a>`);
  const guides = [
    sector ? `<a class="chip" href="${learnHref(lang, sector.learn)}">${esc(t.guideSector(sector[lang]))}</a>` : '',
    industryPage && (!sector || industryPage !== sector.learn)
      ? `<a class="chip" href="${learnHref(lang, industryPage)}">${t.guideIndustry}</a>`
      : '',
  ].join('');
  const peersHtml = peers.length
    ? `<h2 id="peers">${peers[0].industry === snapshot.industry ? t.peersIndustry : t.peersSector}</h2><ul class="tickers">${peers
        .map(
          (p) =>
            `<li><a href="${stockHref(lang, p.symbol)}"><b>${esc(p.symbol)}</b><span>${esc(displayName(p, lang))}</span></a></li>`
        )
        .join('')}</ul>`
    : '';

  const main = `<p class="crumb">${crumbs.join('<span>/</span>')}</p>
<article>
${priceHeader(snapshot, h1, lang)}
${insightsBlock(t, snapshot, lang)}
${maRows(t, snapshot)}
${rangePanel(t, snapshot, lang)}
<h2 id="stats">${t.stats}</h2>
<dl class="stat-grid">
${stat(t, t.marketCap, big(snapshot.marketCap, '$'), learnHref(lang, 'market-cap'))}
${stat(t, t.pe, num(snapshot.pe), learnHref(lang, 'pe-ratio'))}
${stat(t, t.forwardPE, num(snapshot.forwardPE), learnHref(lang, 'forward-pe'))}
${stat(t, t.peg, num(snapshot.peg, 2), learnHref(lang, 'peg-ratio'))}
${stat(t, t.de, num(snapshot.debtToEquity, 2), learnHref(lang, 'debt-to-equity'))}
${stat(t, t.growth, snapshot.revenueGrowth5Y == null ? null : `${snapshot.revenueGrowth5Y.toFixed(1)}%`)}
${stat(t, t.float, big(snapshot.floatShares), learnHref(lang, 'float'))}
${stat(t, t.short, percent(snapshot.shortPercent, 1), learnHref(lang, 'short-interest'))}
${stat(t, t.avgVol, big(snapshot.avgVolume3m), learnHref(lang, 'average-volume'))}
${stat(t, t.vol, big(snapshot.volume), learnHref(lang, 'relative-volume-rvol'))}
${stat(
  t,
  t.earnings,
  snapshot.nextEarningsDate && snapshot.nextEarningsDate >= new Date().toISOString().slice(0, 10)
    ? formatDate(snapshot.nextEarningsDate, lang)
    : null,
  learnHref(lang, 'eps')
)}
${stat(t, t.sector, sector ? sector[lang] : null, null, true)}
</dl>
<h2 id="about">${t.about}</h2>
<p style="margin:6px 0 10px">${inline(aboutSentence(snapshot, lang) || t.aboutMissing, lang)}</p>
${guides ? `<p style="margin:0 0 6px">${guides}</p>` : ''}
${peersHtml}
<aside class="cta-box" aria-label="${UI[lang].relevantTool}"><p>${esc(t.stockCta(sym))}</p><a class="btn" href="/scanner">${
    t.scanBtn
  }</a></aside>
${asOfLine(snapshot, lang)}
<p class="note">${esc(UI[lang].note)}</p>
</article>`;

  const title = stockTitle(snapshot, lang);
  const description = stockDescription(snapshot, lang);
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title.replace(' | Capital Flow', ''),
      description,
      inLanguage: lang,
      url: SITE_URL + path,
      about: { '@type': 'Corporation', name: snapshot.name, tickerSymbol: sym },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t.stocks, item: `${SITE_URL}${prefix(lang)}/stocks` },
        { '@type': 'ListItem', position: 2, name: displayName(snapshot, lang), item: SITE_URL + path },
      ],
    },
  ];

  return layout({
    lang,
    title,
    description,
    path,
    main,
    schema,
    type: 'website',
    robots: isIndexable(snapshot) ? undefined : 'noindex, follow',
    alternates: { he: stockHref('he', sym), en: stockHref('en', sym) },
  });
}

function etfTitle(meta, lang) {
  return lang === 'en'
    ? `${meta.en} (${meta.symbol}) Price | Capital Flow`
    : `מחיר ${meta.he} – ${meta.symbol} | Capital Flow`;
}

function etfDescription(meta, lang) {
  return lang === 'en'
    ? `${meta.symbol} price, top holdings and their weights, expense ratio, volume vs. average and moving averages. Updated after every trading session.`
    : `מחיר ${meta.he}, האחזקות הגדולות ומשקלן, דמי ניהול, נפח מול הממוצע וממוצעים נעים. מתעדכן אחרי כל יום מסחר.`;
}

const ETF_STYLE = `<style>.holdings{background:#0f0f0f;border:1px solid var(--line);border-radius:12px;padding:4px 16px;margin:6px 0}
.holdings>div{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(60px,1fr) 56px;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid #1b1b1b;font-size:14px}
.holdings>div:last-child{border-bottom:0}.h-name,.h-name a{display:flex;gap:8px;align-items:baseline;min-width:0}.h-name a{text-decoration:none}.h-name b{font-family:var(--mono)}.h-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.h-name span{color:var(--muted)}
.h-bar{height:6px;background:#1c1c1c;border-radius:3px;overflow:hidden}.h-bar i{display:block;height:100%;background:var(--gold)}.h-w{text-align:end}</style>`;

function holdingsTable(t, s, all, lang) {
  if (!s.holdings || !s.holdings.length) return '';
  const max = Math.max(...s.holdings.map((h) => h.weight));
  const rows = s.holdings
    .map((h) => {
      const linked = h.symbol && STOCK_SET.has(h.symbol);
      const label = h.symbol ? `<b>${esc(h.symbol)}</b>` : '';
      const known = linked && all.get(h.symbol);
      const name = esc(
        known
          ? displayName(known, lang)
          : (lang === 'he' && HEBREW_NAMES[h.symbol]) || cleanName(h.name) || h.symbol || ''
      );
      const cell = linked
        ? `<a href="${stockHref(lang, h.symbol)}">${label}<span>${name}</span></a>`
        : `${label}<span>${name}</span>`;
      const width = Math.max(2, Math.round((h.weight / max) * 100));
      return `<div><span class="h-name">${cell}</span><span class="h-bar"><i style="width:${width}%"></i></span><span class="mono h-w">${(
        h.weight * 100
      ).toFixed(1)}%</span></div>`;
    })
    .join('');
  return `<h2 id="holdings">${t.holdings}</h2><p style="margin:0 0 6px;color:var(--muted);font-size:13px">${t.holdingsNote}</p><div class="holdings">${rows}</div>`;
}

function renderEtfPage(snapshot, all, lang = 'he') {
  const t = S[lang];
  const meta = etfMeta(snapshot.symbol);
  const path = etfHref(lang, meta.symbol);
  const h1 = `<span class="mono">${esc(meta.symbol)}</span> — ${esc(meta[lang])}`;
  const guides = [
    meta.learn ? `<a class="chip" href="${learnHref(lang, meta.learn)}">${t.guideTracked}</a>` : '',
    `<a class="chip" href="${learnHref(lang, 'etf')}">${t.guideEtf}</a>`,
  ].join('');

  const main = `${ETF_STYLE}<p class="crumb"><a href="${prefix(lang)}/etfs">${t.etfs}</a></p>
<article>
${priceHeader(snapshot, h1, lang)}
<p style="margin:-8px 0 14px">${inline(t.tracks(lang === 'en' ? meta.tracksEn : meta.tracksHe), lang)}</p>
${insightsBlock(t, snapshot, lang)}
${holdingsTable(t, snapshot, all, lang)}
${maRows(t, snapshot)}
${rangePanel(t, snapshot, lang)}
<h2 id="facts">${t.fundFacts}</h2>
<dl class="stat-grid">
${stat(t, t.family, snapshot.family, null, true)}
${stat(t, t.expense, percent(snapshot.expenseRatio, 2))}
${stat(t, t.assets, big(snapshot.totalAssets, '$'))}
${stat(t, t.yield, percent(snapshot.yield, 2), learnHref(lang, 'dividend-yield'))}
${stat(t, t.avgVol, big(snapshot.avgVolume3m), learnHref(lang, 'average-volume'))}
${stat(t, t.vol, big(snapshot.volume), learnHref(lang, 'relative-volume-rvol'))}
</dl>
<p style="margin:10px 0 6px">${guides}</p>
<aside class="cta-box" aria-label="${UI[lang].relevantTool}"><p>${esc(t.etfCta)}</p><a class="btn" href="/flow">${
    t.etfBtn
  }</a></aside>
${asOfLine(snapshot, lang)}
<p class="note">${esc(UI[lang].note)}</p>
</article>`;

  const title = etfTitle(meta, lang);
  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title.replace(' | Capital Flow', ''),
      description: etfDescription(meta, lang),
      inLanguage: lang,
      url: SITE_URL + path,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t.etfs, item: `${SITE_URL}${prefix(lang)}/etfs` },
        { '@type': 'ListItem', position: 2, name: `${meta.symbol} — ${meta[lang]}`, item: SITE_URL + path },
      ],
    },
  ];
  return layout({
    lang,
    title,
    description: etfDescription(meta, lang),
    path,
    main,
    schema,
    type: 'website',
    robots: isIndexable(snapshot) ? undefined : 'noindex, follow',
    alternates: { he: etfHref('he', meta.symbol), en: etfHref('en', meta.symbol) },
  });
}

// Shown before the first snapshot exists for a symbol: honest and noindex.
function renderPending(symbol, lang, kind) {
  const t = S[lang];
  const isEtf = kind === 'etf';
  const meta = isEtf ? etfMeta(symbol) : null;
  const href = (l) => (isEtf ? etfHref(l, symbol) : stockHref(l, symbol));
  let name = symbol;
  if (meta) name = `${symbol} — ${meta[lang]}`;
  else if (lang === 'he' && HEBREW_NAMES[symbol]) name = `מניית ${HEBREW_NAMES[symbol]} (${symbol})`;
  const section = isEtf ? 'etfs' : 'stocks';
  const main = `<p class="crumb"><a href="${prefix(lang)}/${section}">${t[section]}</a></p><article><h1>${esc(
    name
  )}</h1>${topNote(lang)}<p class="lead">${t.pending}</p><aside class="cta-box"><p>${
    t.pendingCta
  }</p><a class="btn" href="/scanner">${t.scanBtn}</a></aside><p class="note">${esc(UI[lang].note)}</p></article>`;
  return layout({
    lang,
    title: `${name} | Capital Flow`,
    description: name,
    path: href(lang),
    main,
    schema: [],
    robots: 'noindex, follow',
    alternates: { he: href('he'), en: href('en') },
  });
}

function hubLayout(lang, section, copy, main) {
  return layout({
    lang,
    title: copy.title,
    description: copy.description,
    path: `${prefix(lang)}/${section}`,
    main,
    schema: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: copy.title.replace(' | Capital Flow', ''),
        inLanguage: lang,
        url: `${SITE_URL}${prefix(lang)}/${section}`,
      },
    ],
    type: 'website',
    alternates: { he: `/${section}`, en: `/en/${section}` },
  });
}

function renderStocksHub(all, lang = 'he') {
  const groups = new Map(Object.entries(SECTORS).map(([key, v]) => [key, { label: v[lang], id: v.learn, items: [] }]));
  const other = { label: lang === 'en' ? 'Other stocks' : 'מניות נוספות', id: 'other', items: [] };
  for (const symbol of SYMBOLS) {
    const snapshot = all.get(symbol);
    const item = {
      symbol,
      name: snapshot ? displayName(snapshot, lang) : (lang === 'he' && HEBREW_NAMES[symbol]) || symbol,
      cap: snapshot ? snapshot.marketCap || 0 : 0,
    };
    const group = snapshot && groups.get(snapshot.sector);
    (group || other).items.push(item);
  }
  const sections = [...groups.values(), other]
    .filter((g) => g.items.length)
    .map(
      (g) =>
        `<section class="hub-cat" id="${g.id}" aria-labelledby="${g.id}-t"><h2 id="${g.id}-t">${esc(
          g.label
        )} <span style="color:var(--muted);font-weight:400;font-size:14px">(${g.items.length})</span></h2><ul class="tickers">${g.items
          .sort((a, b) => b.cap - a.cap)
          .map(
            (i) =>
              `<li><a href="${stockHref(lang, i.symbol)}"><b>${esc(i.symbol)}</b><span>${esc(i.name)}</span></a></li>`
          )
          .join('')}</ul></section>`
    )
    .join('');

  const copy =
    lang === 'en'
      ? {
          h1: 'Stocks: S&amp;P 500 and Nasdaq-100',
          lead: 'A page for every stock: price, volume, distance from moving averages, 52-week range and key data. Updated after every session.',
          title: 'S&P 500 and Nasdaq-100 Stocks — Data for Every Stock | Capital Flow',
          description:
            'A page for every S&P 500 and Nasdaq-100 stock: price, trading volume, moving averages, 52-week range and key data, by sector.',
        }
      : {
          h1: 'מניות: S&amp;P 500 ונאסד"ק 100',
          lead: 'עמוד לכל מניה: מחיר, נפח, מרחק מהממוצעים הנעים, טווח 52 שבועות ונתונים פיננסיים. מתעדכן אחרי כל יום מסחר.',
          title: 'מניות S&P 500 ונאסד"ק 100 — נתונים לכל מניה | Capital Flow',
          description:
            'עמוד לכל מניה ב-S&P 500 ובנאסד"ק 100: מחיר, נפח מסחר, ממוצעים נעים, טווח 52 שבועות ונתונים פיננסיים, לפי סקטורים.',
        };
  const main = `<h1>${copy.h1}</h1>\n${topNote(lang)}\n<p class="lead">${copy.lead}</p>\n${sections}\n<p class="note">${esc(
    UI[lang].note
  )}</p>`;
  return hubLayout(lang, 'stocks', copy, main);
}

function renderEtfsHub(lang = 'he') {
  const groups =
    lang === 'en'
      ? [
          ['Index ETFs', ['SPY', 'QQQ', 'DIA', 'IWM']],
          ['Sector ETFs', ['XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLRE', 'XLU', 'XLC']],
          ['Industry ETFs', ['SOXX', 'XOP', 'XTL', 'IGV']],
        ]
      : [
          ['קרנות מדד', ['SPY', 'QQQ', 'DIA', 'IWM']],
          ['קרנות סקטור', ['XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLB', 'XLRE', 'XLU', 'XLC']],
          ['קרנות ענפיות', ['SOXX', 'XOP', 'XTL', 'IGV']],
        ];
  const sections = groups
    .map(
      ([label, symbols]) =>
        `<section class="hub-cat"><h2>${esc(label)}</h2><ul class="tickers">${symbols
          .map(
            (sym) =>
              `<li><a href="${etfHref(lang, sym)}"><b>${esc(sym)}</b><span>${esc(etfMeta(sym)[lang])}</span></a></li>`
          )
          .join('')}</ul></section>`
    )
    .join('');
  const copy =
    lang === 'en'
      ? {
          h1: 'ETFs: index, sector and industry funds',
          lead: 'Top holdings, expense ratio, volume and trend for the main U.S. index funds and every sector fund.',
          title: 'ETFs — SPY, QQQ and Sector ETF Holdings and Data | Capital Flow',
          description:
            'Pages for SPY, QQQ, DIA, IWM and every sector ETF: top holdings and weights, expense ratio, volume, moving averages.',
        }
      : {
          h1: 'קרנות סל: מדדים, סקטורים וענפים',
          lead: 'האחזקות הגדולות, דמי ניהול, נפח ומגמה לקרנות המדד המרכזיות בארה"ב ולכל קרנות הסקטור.',
          title: 'קרנות סל — SPY, QQQ וקרנות הסקטורים | Capital Flow',
          description:
            'עמודים לקרנות SPY, QQQ, DIA, IWM ולכל קרנות הסקטור: אחזקות ומשקלות, דמי ניהול, נפח וממוצעים נעים.',
        };
  const main = `<h1>${copy.h1}</h1>\n${topNote(lang)}\n<p class="lead">${copy.lead}</p>\n${sections}\n<p class="note">${esc(
    UI[lang].note
  )}</p>`;
  return hubLayout(lang, 'etfs', copy, main);
}

module.exports = { renderStockPage, renderEtfPage, renderPending, renderStocksHub, renderEtfsHub };

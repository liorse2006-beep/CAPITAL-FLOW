const { PAGES, CATEGORIES, getPage } = require('./content');
const { renderDiagram } = require('./diagrams');

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

// Copy is trusted product text but is still escaped. Runs of Latin letters,
// digits and symbols are isolated with <bdi> so numbers, tickers and ranges
// keep their order inside right-to-left Hebrew sentences.
// A token never ends in punctuation, and tokens only join across a single
// space, so "10%. RVOL" stays two runs with the period in its Hebrew place.
const TOKEN = String.raw`[A-Za-z0-9$%](?:[A-Za-z0-9$%.,:/+×÷=&'–\-]*[A-Za-z0-9$%×])?`;
const LTR_RUN = new RegExp(`${TOKEN}(?: ${TOKEN})*`, 'g');

function inline(value) {
  const raw = String(value);
  let out = '';
  let last = 0;
  for (const match of raw.matchAll(LTR_RUN)) {
    out += esc(raw.slice(last, match.index));
    out += /[A-Za-z0-9]/.test(match[0]) ? `<bdi>${esc(match[0])}</bdi>` : esc(match[0]);
    last = match.index + match[0].length;
  }
  return out + esc(raw.slice(last));
}

function plain(value) {
  return String(value);
}

function jsonLd(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

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
h1{font-size:clamp(28px,4.4vw,38px);line-height:1.2;font-weight:600;margin:0 0 10px;text-wrap:balance;letter-spacing:-.2px}
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
.foot{border-top:1px solid var(--line);color:var(--muted);font-size:13px}
.foot-in{max-width:1120px;margin:0 auto;padding:20px 22px;display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between}
.foot a{color:var(--muted)}
bdi{unicode-bidi:isolate}
@media (max-width:860px){.wrap{grid-template-columns:minmax(0,1fr);gap:0}.side{position:static;border:0;padding:0;margin-top:30px;border-top:1px solid var(--line);padding-top:18px}.side .toc{display:none}}
@media (max-width:560px){.top nav .wide{display:none}.verdict{grid-template-columns:minmax(0,1fr)}.lead{font-size:17px}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.card{transition:none}}
`;

function layout({ title, description, path, main, side, schema }) {
  const canonical = SITE_URL + path;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0A0A0A">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="he" href="${canonical}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/heebo-hebrew-variable.woff2" as="font" type="font/woff2" crossorigin>
<meta property="og:locale" content="he_IL">
<meta property="og:type" content="article">
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
<a class="skip" href="#content">דלג לתוכן</a>
<header class="top"><div class="top-in">
<a class="brand" href="/"><img src="/icon-192.png" alt="" width="26" height="26">Capital Flow</a>
<nav aria-label="ניווט ראשי">
<a href="/learn">מרכז הידע</a>
<a class="wide" href="/learn#scanners">סורקים</a>
<a class="wide" href="/learn#sectors">סקטורים</a>
<a class="cta" href="/scanner">לסורק</a>
</nav></div></header>
<div class="wrap${side ? '' : ' single'}">
<main id="content">${main}</main>
${side || ''}
</div>
<footer class="foot"><div class="foot-in">
<span>© Capital Flow · כלי חינוכי למחקר מניות</span>
<span><a href="/learn">מרכז הידע</a> · <a href="/policy">תנאי שימוש ופרטיות</a> · <a href="/accessibility">נגישות</a></span>
</div></footer>
</body>
</html>`;
}

const NOTE =
  'תוכן חינוכי בלבד. זה לא ייעוץ השקעות ולא המלצה לקנות או למכור. נתוני שוק יכולים להיות מעוכבים או חלקיים, אז כדאי לאמת לפני כל החלטה.';

function renderPage(page) {
  const category = CATEGORIES[page.category];
  const path = `/learn/${page.slug}`;
  const points = page.points
    .map(
      ([title, body], i) =>
        `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><div><strong>${inline(title)}</strong><p>${inline(
          body
        )}</p></div></li>`
    )
    .join('');
  const faq = page.faq
    .map(([q, a]) => `<details><summary>${inline(q)}</summary><p>${inline(a)}</p></details>`)
    .join('');
  const related = page.related
    .map(getPage)
    .filter(Boolean)
    .map((other) => `<li><a href="/learn/${other.slug}">${esc(other.short || other.h1)}</a></li>`)
    .join('');
  const tool = page.tool;

  const main = `<p class="crumb"><a href="/learn">מרכז הידע</a><span>/</span><a href="/learn#${page.category}">${esc(
    category.title
  )}</a></p>
<article>
<h1>${inline(page.h1)}</h1>
<p class="lead">${inline(page.lead)}</p>
<figure class="panel" style="margin:0"><div class="panel-head"><span>${esc(
    page.diagram.caption
  )}</span><span>המחשה</span></div>${renderDiagram(page.diagram)}</figure>
<h2 id="key-points">מה חשוב לדעת</h2>
<ol class="points">${points}</ol>
<div class="verdict" id="right-wrong"><div class="ok"><b>✓ נכון</b>${inline(page.right)}</div><div class="no"><b>✕ טעות נפוצה</b>${inline(
    page.wrong
  )}</div></div>
<aside class="cta-box" aria-label="כלי רלוונטי"><p>${inline(tool.text)}</p><a class="btn" href="${esc(tool.href)}">${esc(
    tool.label
  )} ←</a></aside>
${faq ? `<section class="faq" aria-labelledby="faq"><h2 id="faq">שאלות נפוצות</h2>${faq}</section>` : ''}
<p class="note">${NOTE}</p>
</article>`;

  const side = `<aside class="side" aria-label="ניווט בעמוד">
<div class="toc"><h3>בעמוד הזה</h3><ul><li><a href="#key-points">מה חשוב לדעת</a></li><li><a href="#right-wrong">נכון / טעות</a></li>${
    faq ? '<li><a href="#faq">שאלות נפוצות</a></li>' : ''
  }</ul></div>
${related ? `<h3>קשור</h3><ul>${related}</ul>` : ''}
</aside>`;

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: plain(page.h1),
      description: page.description,
      inLanguage: 'he',
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
        { '@type': 'ListItem', position: 1, name: 'מרכז הידע', item: `${SITE_URL}/learn` },
        { '@type': 'ListItem', position: 2, name: category.title, item: `${SITE_URL}/learn#${page.category}` },
        { '@type': 'ListItem', position: 3, name: plain(page.h1), item: SITE_URL + path },
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

  return layout({ title: page.title, description: page.description, path, main, side, schema });
}

function renderHub() {
  const groups = Object.entries(CATEGORIES)
    .map(([key, category]) => {
      const cards = PAGES.filter((page) => page.category === key)
        .map(
          (page) =>
            `<li><a class="card" href="/learn/${page.slug}"><strong>${inline(page.short || page.h1)}</strong><span>${inline(
              page.lead
            )}</span></a></li>`
        )
        .join('');
      return `<section class="hub-cat" id="${key}" aria-labelledby="${key}-t"><h2 id="${key}-t">${esc(
        category.title
      )}</h2><p>${esc(category.intro)}</p><ul class="grid">${cards}</ul></section>`;
    })
    .join('');

  const main = `<h1>מרכז הידע של Capital Flow</h1>
<p class="lead">נפח מסחר, ממוצעים נעים, מכפילים וסקטורים. כל מושג מוסבר בקצרה, עם דוגמה ועם הטעות שכדאי להימנע ממנה.</p>
${groups}
<p class="note">${NOTE}</p>`;

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'מרכז הידע של Capital Flow',
      inLanguage: 'he',
      url: `${SITE_URL}/learn`,
      hasPart: PAGES.map((page) => ({
        '@type': 'Article',
        headline: page.h1,
        url: `${SITE_URL}/learn/${page.slug}`,
      })),
    },
  ];

  return layout({
    title: 'מרכז הידע — מדריכים לשוק ההון בעברית | Capital Flow',
    description:
      'מדריכים קצרים בעברית: נפח מסחר חריג, RVOL, ממוצעים נעים, מכפיל רווח, PEG, Short Interest, סקטורים בשוק האמריקאי וסורקי מניות.',
    path: '/learn',
    main,
    schema,
  });
}

module.exports = { renderPage, renderHub, SITE_URL };

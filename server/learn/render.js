const { PAGES, CATEGORIES, getPage } = require('./content');

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

// Page copy is trusted product text, but it is still escaped. Only **bold**
// is supported, applied after escaping so no markup can be injected.
function inline(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function jsonLd(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

const STYLE = `
@font-face{font-family:Heebo;src:url(/fonts/heebo-hebrew-variable.woff2) format("woff2");font-weight:100 900;font-display:swap;unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
@font-face{font-family:Heebo;src:url(/fonts/heebo-latin-variable.woff2) format("woff2");font-weight:100 900;font-display:swap;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{--bg:#0a0a0a;--panel:#141414;--panel-2:#1c1c1c;--line:rgba(255,255,255,.08);--text:#ececef;--muted:#a3a3ad;--gold:#f59e0b;--gold-2:#fbbf24}
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--text);font-family:Heebo,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:17px;line-height:1.75;-webkit-font-smoothing:antialiased}
a{color:var(--gold-2);text-underline-offset:3px}
a:focus-visible,summary:focus-visible{outline:2px solid var(--gold-2);outline-offset:3px;border-radius:4px}
.skip{position:absolute;inset-inline-start:-999px;top:8px;background:var(--gold);color:#111;padding:8px 14px;border-radius:8px;font-weight:700}
.skip:focus{inset-inline-start:12px}
.top{border-bottom:1px solid var(--line);background:rgba(10,10,10,.92)}
.top-in{max-width:1040px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;font-weight:800;letter-spacing:.2px}
.brand img{width:32px;height:32px;border-radius:8px}
.top nav{display:flex;gap:18px;flex-wrap:wrap;font-size:15px}
.top nav a{color:var(--muted);text-decoration:none}
.top nav a:hover{color:var(--text)}
.cta-top{background:var(--gold);color:#111!important;padding:7px 14px;border-radius:999px;font-weight:700}
main{max-width:760px;margin:0 auto;padding:28px 20px 64px}
.wide{max-width:1040px}
.crumbs{font-size:14px;color:var(--muted);margin-bottom:18px}
.crumbs ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.crumbs li+li::before{content:"›";margin-inline-end:6px;color:var(--muted)}
.crumbs a{color:var(--muted)}
.eyebrow{color:var(--gold);font-size:13px;font-weight:700;letter-spacing:.6px;margin:0 0 6px}
h1{font-size:clamp(28px,5vw,40px);line-height:1.2;margin:0 0 14px;text-wrap:balance}
h2{font-size:24px;line-height:1.3;margin:38px 0 10px;text-wrap:balance}
h3{font-size:19px;margin:24px 0 6px}
.lead{font-size:19px;color:#d4d4da;margin:0 0 18px}
.meta{font-size:14px;color:var(--muted);margin-bottom:26px}
p{margin:0 0 14px}
ul,ol{padding-inline-start:22px;margin:0 0 16px}
li{margin-bottom:6px}
.formula{background:var(--panel);border:1px solid var(--line);border-inline-start:3px solid var(--gold);border-radius:10px;padding:14px 18px;margin:16px 0 20px;font-weight:600}
.formula bdi{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-weight:500}
.tool{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:linear-gradient(135deg,rgba(245,158,11,.14),rgba(245,158,11,.04));border:1px solid rgba(245,158,11,.35);border-radius:14px;padding:18px 20px;margin:34px 0}
.tool p{margin:0;font-weight:600}
.tool span{display:block;font-weight:400;color:var(--muted);font-size:15px}
.btn{display:inline-block;background:var(--gold);color:#111;text-decoration:none;font-weight:800;padding:10px 18px;border-radius:999px;white-space:nowrap}
.btn:hover{background:var(--gold-2)}
.faq details{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:10px}
.faq summary{cursor:pointer;font-weight:700}
.faq details p{margin:10px 0 2px;color:#d4d4da}
.related{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;padding:0;list-style:none}
.related a,.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-decoration:none;color:var(--text);height:100%}
.related a:hover,.card:hover{border-color:rgba(245,158,11,.5)}
.card strong{display:block;color:var(--text);font-size:17px;margin-bottom:4px}
.card span{color:var(--muted);font-size:15px;line-height:1.55}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;list-style:none;padding:0;margin:0 0 10px}
.disclaimer{margin-top:40px;font-size:14px;color:var(--muted);border-top:1px solid var(--line);padding-top:16px}
.foot{border-top:1px solid var(--line);color:var(--muted);font-size:14px}
.foot-in{max-width:1040px;margin:0 auto;padding:22px 20px;display:flex;gap:18px;flex-wrap:wrap;justify-content:space-between}
.foot a{color:var(--muted)}
@media (max-width:640px){body{font-size:16px}.top nav .hide-sm{display:none}h2{font-size:21px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
`;

function layout({ title, description, path, body, schema, wide }) {
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
<a class="brand" href="/"><img src="/icon-192.png" alt="" width="32" height="32">Capital Flow</a>
<nav aria-label="ניווט ראשי">
<a href="/learn">מרכז הידע</a>
<a class="hide-sm" href="/learn#scanners">סורקים</a>
<a class="hide-sm" href="/learn#sectors">סקטורים</a>
<a class="cta-top" href="/scanner">לסורק</a>
</nav></div></header>
<main id="content" class="${wide ? 'wide' : ''}">
${body}
</main>
<footer class="foot"><div class="foot-in">
<span>© Capital Flow — כלי חינוכי למחקר מניות</span>
<span><a href="/learn">מרכז הידע</a> · <a href="/policy">תנאי שימוש ופרטיות</a> · <a href="/accessibility">נגישות</a></span>
</div></footer>
</body>
</html>`;
}

function renderBlock(block) {
  if (typeof block === 'string') return `<p>${inline(block)}</p>`;
  if (block.list) return `<ul>${block.list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
  if (block.steps) return `<ol>${block.steps.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`;
  if (block.formula) return `<div class="formula">${inline(block.formula)}</div>`;
  if (block.h3) return `<h3>${inline(block.h3)}</h3>`;
  return '';
}

const DISCLAIMER =
  'התוכן בעמוד זה הוא חינוכי בלבד ואינו ייעוץ השקעות, המלצה לקנות או למכור ניירות ערך, או תחליף לייעוץ מותאם אישית. נתוני שוק עשויים להיות מעוכבים, חלקיים או שגויים — יש לאמת כל מידע באופן עצמאי לפני קבלת החלטה.';

function renderPage(page) {
  const category = CATEGORIES[page.category];
  const path = `/learn/${page.slug}`;
  const sections = page.sections
    .map((section) => `<h2>${inline(section.h)}</h2>${section.body.map(renderBlock).join('')}`)
    .join('');
  const faq = page.faq.length
    ? `<section class="faq" aria-labelledby="faq-title"><h2 id="faq-title">שאלות נפוצות</h2>${page.faq
        .map((item) => `<details><summary>${inline(item.q)}</summary><p>${inline(item.a)}</p></details>`)
        .join('')}</section>`
    : '';
  const related = page.related
    .map(getPage)
    .filter(Boolean)
    .map((other) => `<li><a href="/learn/${other.slug}">${esc(other.h1)}</a></li>`)
    .join('');
  const tool = page.tool
    ? `<aside class="tool" aria-label="כלי רלוונטי"><p>${inline(page.tool.text)}<span>${inline(
        page.tool.sub
      )}</span></p><a class="btn" href="${esc(page.tool.href)}">${esc(page.tool.label)}</a></aside>`
    : '';

  const body = `<nav class="crumbs" aria-label="פירורי לחם"><ol>
<li><a href="/">ראשי</a></li><li><a href="/learn">מרכז הידע</a></li><li><a href="/learn#${page.category}">${esc(
    category.title
  )}</a></li><li aria-current="page">${esc(page.h1)}</li></ol></nav>
<article>
<p class="eyebrow">${esc(category.title)}</p>
<h1>${inline(page.h1)}</h1>
<p class="lead">${inline(page.intro)}</p>
<p class="meta">זמן קריאה: כ-${readingMinutes(page)} דקות · עודכן לאחרונה ${formatDate(PUBLISHED)}</p>
${sections}
${tool}
${faq}
${related ? `<h2>להמשך קריאה</h2><ul class="related">${related}</ul>` : ''}
<p class="disclaimer">${DISCLAIMER}</p>
</article>`;

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.h1.replace(/\*\*/g, ''),
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
        { '@type': 'ListItem', position: 1, name: 'ראשי', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'מרכז הידע', item: `${SITE_URL}/learn` },
        { '@type': 'ListItem', position: 3, name: page.h1.replace(/\*\*/g, ''), item: SITE_URL + path },
      ],
    },
  ];
  if (page.faq.length) {
    schema.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map((item) => ({
        '@type': 'Question',
        name: item.q.replace(/\*\*/g, ''),
        acceptedAnswer: { '@type': 'Answer', text: item.a.replace(/\*\*/g, '') },
      })),
    });
  }

  return layout({ title: page.title, description: page.description, path, body, schema });
}

function renderHub() {
  const groups = Object.entries(CATEGORIES)
    .map(([key, category]) => {
      const cards = PAGES.filter((page) => page.category === key)
        .map(
          (page) =>
            `<li><a class="card" href="/learn/${page.slug}"><strong>${esc(page.h1)}</strong><span>${esc(
              page.description
            )}</span></a></li>`
        )
        .join('');
      return `<section id="${key}" aria-labelledby="${key}-title"><h2 id="${key}-title">${esc(
        category.title
      )}</h2><p>${esc(category.intro)}</p><ul class="cards">${cards}</ul></section>`;
    })
    .join('');

  const body = `<nav class="crumbs" aria-label="פירורי לחם"><ol><li><a href="/">ראשי</a></li><li aria-current="page">מרכז הידע</li></ol></nav>
<p class="eyebrow">מרכז הידע של Capital Flow</p>
<h1>מדריכים לשוק ההון: נפח מסחר, ממוצעים נעים, סקטורים ומדדים פיננסיים</h1>
<p class="lead">הסברים ברורים בעברית למושגים שכל מי שבודק מניות נתקל בהם — מה הם אומרים, איך מחשבים אותם, ואיפה הם עלולים להטעות. כל מדריך מקושר לכלי שמאפשר לבדוק את המושג על נתונים אמיתיים.</p>
${groups}
<p class="disclaimer">${DISCLAIMER}</p>`;

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
      'מדריכים בעברית על נפח מסחר חריג, RVOL, ממוצעים נעים, מכפיל רווח, PEG, Short Interest, סקטורים בשוק האמריקאי ואיך להשתמש בסורקי מניות.',
    path: '/learn',
    body,
    schema,
    wide: true,
  });
}

function readingMinutes(page) {
  const words = JSON.stringify([page.intro, page.sections, page.faq]).split(/\s+/).length;
  return Math.max(2, Math.round(words / 200));
}

function formatDate(iso) {
  const [year, month, day] = iso.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

module.exports = { renderPage, renderHub, SITE_URL };

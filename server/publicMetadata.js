const fs = require('fs');
const SEO_CONTENT = require('../src/data/seoContent.json');

const SITE_URL = 'https://capitalflow.vip';

// Keep route metadata and crawlable route copy in trusted server-side maps.
// Crawlers and link unfurlers may inspect the initial HTML before running the
// client bundle. These values are product copy, never request-controlled input.
const ROUTE_METADATA = Object.freeze({
  '/': {
    title: 'Capital Flow — סורק מניות, נפח מסחר ומגמות',
    description:
      'כלי חינוכי לסריקת מניות לפי נפח מסחר חריג, ממוצעים נעים ופעילות בסקטורים. נתוני שוק עשויים להיות מעוכבים או חלקיים ויש לאמת מידע באופן עצמאי.',
  },
  '/scanner': {
    title: 'סורק נפח מסחר חריג | Capital Flow',
    description:
      'סריקת מניות לפי יחס נפח מסחר, שווי שוק ונפח מינימלי. נתוני שוק עשויים להיות מעוכבים או חלקיים; המידע למטרות לימוד בלבד.',
  },
  '/ma': {
    title: 'סורק ממוצעים נעים | Capital Flow',
    description:
      'סריקת מניות בארה״ב לפי מרחק מממוצעים נעים 9, 20, 50 ו־150, בטווח יומי או שבועי. נתוני השוק עשויים להיות מעוכבים או חלקיים.',
  },
  '/flow': {
    title: 'פעילות בסקטורים | Capital Flow',
    description:
      'סקירת שינויי מחיר ונפח מסחר בסקטורים. נתוני השוק עשויים להיות מעוכבים או חלקיים; יש לאמת מידע באופן עצמאי.',
  },
  '/fundamentals': {
    title: 'נתונים פיננסיים למניות | Capital Flow',
    description:
      'סקירת מכפילי רווח, צמיחה, חוב, מניות סחירות ונתונים פיננסיים זמינים. זמינות הנתונים משתנה בין מניות והמידע עשוי להיות מעוכב או חלקי.',
  },
  '/watchlist': {
    title: 'רשימת מעקב והתראות | Capital Flow',
    description: 'מעקב אחר מניות נבחרות וניהול התראות מחיר או נפח מסחר. נתוני השוק עשויים להיות מעוכבים או חלקיים.',
  },
  '/policy': {
    title: 'תנאי שימוש ומדיניות פרטיות | Capital Flow',
    description: 'תנאי השימוש, פרטיות, תשלומים, החזרים ודרכי יצירת קשר עם Capital Flow.',
  },
  '/accessibility': {
    title: 'הצהרת נגישות | Capital Flow',
    description: 'תכונות הנגישות ב־Capital Flow, מגבלות ידועות ודרכי יצירת קשר.',
  },
});

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  const normalized = String(pathname).replace(/\/+$/, '');
  return normalized || '/';
}

function getPublicMetadata(pathname) {
  return ROUTE_METADATA[normalizePath(pathname)] || null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceContentAttribute(html, selector, value) {
  const expression = new RegExp(`(<${selector}[^>]*content=["'])[^"']*(["'][^>]*>)`, 'i');
  return html.replace(expression, `$1${escapeHtml(value)}$2`);
}

function replaceHrefAttribute(html, selector, value) {
  const expression = new RegExp(`(<${selector}[^>]*href=["'])[^"']*(["'][^>]*>)`, 'i');
  return html.replace(expression, `$1${escapeHtml(value)}$2`);
}

function renderSeoContent(content) {
  if (!content) return '';

  const sections = content.sections
    .map(
      (section) =>
        `<article class="seo-discovery-section"><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></article>`
    )
    .join('');
  const links = content.links
    .map((link) => {
      const href = String(link.href || '');
      if (!href.startsWith('/') || href.startsWith('//')) return '';
      return `<a href="${escapeHtml(href)}">${escapeHtml(link.label)}</a>`;
    })
    .join('');

  return `<h2 id="${escapeHtml(content.id)}-title">${escapeHtml(content.title)}</h2><p class="seo-discovery-intro">${escapeHtml(content.intro)}</p><div class="seo-discovery-sections">${sections}</div><p class="seo-discovery-disclaimer">${escapeHtml(content.disclaimer)}</p><nav class="seo-discovery-links" aria-label="כלי מחקר נוספים"><span>כלים נוספים</span>${links}</nav>`;
}

function renderPublicMetadata(html, pathname) {
  const metadata = getPublicMetadata(pathname);
  if (!metadata) return html;

  const canonical = SITE_URL + normalizePath(pathname);
  let rendered = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  rendered = replaceContentAttribute(rendered, `meta\\s+name=["']description["']`, metadata.description);
  rendered = replaceContentAttribute(rendered, `meta\\s+property=["']og:title["']`, metadata.title);
  rendered = replaceContentAttribute(rendered, `meta\\s+property=["']og:description["']`, metadata.description);
  rendered = replaceContentAttribute(rendered, `meta\\s+property=["']og:url["']`, canonical);
  rendered = replaceContentAttribute(rendered, `meta\\s+name=["']twitter:title["']`, metadata.title);
  rendered = replaceContentAttribute(rendered, `meta\\s+name=["']twitter:description["']`, metadata.description);
  rendered = replaceHrefAttribute(rendered, `link\\s+rel=["']canonical["']`, canonical);
  for (const language of ['he', 'x-default']) {
    rendered = replaceHrefAttribute(
      rendered,
      `link\\s+rel=["']alternate["']\\s+hreflang=["']${language}["']`,
      canonical
    );
  }
  const contentMarkup = renderSeoContent(SEO_CONTENT[normalizePath(pathname)]);
  rendered = rendered.replace(
    /(<section\s+id=["']seo-route-content["'][^>]*>)[\s\S]*?(<\/section>)/i,
    (_match, open, close) => `${open}${contentMarkup}${close}`
  );
  return rendered;
}

function servePublicApp(req, res, serveDir) {
  const indexPath = `${serveDir}/index.html`;
  const isKnownRoute = !!getPublicMetadata(req.path);

  fs.readFile(indexPath, 'utf8', (error, html) => {
    if (error) return res.status(isKnownRoute ? 200 : 404).sendFile(indexPath);
    if (!isKnownRoute) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      const notFoundHtml = html
        .replace(/<title>[\s\S]*?<\/title>/i, '<title>העמוד לא נמצא | Capital Flow</title>')
        .replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>/gi, '')
        .replace(/<link\s+[^>]*rel=["']alternate["'][^>]*>/gi, '')
        .replace(/(<meta\s+name=["']robots["'][^>]*content=["'])[^"']*/i, '$1noindex, nofollow');
      return res.status(404).type('html').send(notFoundHtml);
    }
    res.type('html').send(renderPublicMetadata(html, req.path));
  });
}

module.exports = { getPublicMetadata, renderPublicMetadata, servePublicApp };

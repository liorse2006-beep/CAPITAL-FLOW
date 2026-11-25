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
      'סריקת מניות S&P 500 ונאסד"ק 100 לפי נפח מסחר חריג, עם סינון לפי יחס נפח, שווי שוק ונפח מינימלי. הנתונים עשויים להיות מעוכבים; לצורכי לימוד בלבד.',
  },
  '/ma': {
    title: 'סורק ממוצעים נעים | Capital Flow',
    description:
      'איתור מניות שקרובות לממוצע הנע של 9, 20, 50 או 150 ימים, בגרף יומי או שבועי. הנתונים עשויים להיות מעוכבים או חלקיים.',
  },
  '/flow': {
    title: 'פעילות בסקטורים | Capital Flow',
    description:
      'השוואת תנועות מחיר ונפח בין סקטורי השוק. הנתונים עשויים להיות מעוכבים או חלקיים; כדאי לאמת באופן עצמאי.',
  },
  '/fundamentals': {
    title: 'ניתוח פנדמנטלי למניות | Capital Flow',
    description:
      'מכפיל רווח, מכפיל עתידי, PEG, חוב להון, צמיחה, Float, Short Interest ומועד דוחות לכל מניה. הזמינות משתנה בין מניות.',
  },
  '/watchlist': {
    title: 'רשימת מעקב והתראות | Capital Flow',
    description: 'מעקב אחרי מניות שבחרת, מחירים זמינים והתראות מחיר או נפח. הנתונים עשויים להיות מעוכבים.',
  },
  '/policy': {
    title: 'תנאי שימוש ומדיניות פרטיות | Capital Flow',
    description: 'תנאי השימוש, מדיניות הפרטיות, התשלומים, ההחזרים ופרטי הקשר של Capital Flow.',
  },
  '/accessibility': {
    title: 'הצהרת נגישות | Capital Flow',
    description: 'הצהרת הנגישות של Capital Flow: התאמות זמינות, מגבלות ידועות ופרטי קשר.',
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

function renderSeoContent(content, language = 'en') {
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

  const faq = (content.faq || []).map(([q, a]) => `<h3>${escapeHtml(q)}</h3><p>${escapeHtml(a)}</p>`).join('');
  const heading = content.h1
    ? `<h1>${escapeHtml(content.h1)}</h1><h2 id="${escapeHtml(content.id)}-title">${escapeHtml(content.title)}</h2>`
    : `<h2 id="${escapeHtml(content.id)}-title">${escapeHtml(content.title)}</h2>`;
  const faqBlock = faq ? `<section class="seo-discovery-faq">${faq}</section>` : '';
  const label = language === 'he' ? 'כלי מחקר נוספים' : 'Explore Capital Flow tools';
  const caption = language === 'he' ? 'כלים נוספים' : 'Explore other tools';
  return `${heading}<p class="seo-discovery-intro">${escapeHtml(content.intro)}</p><div class="seo-discovery-sections">${sections}</div>${faqBlock}<p class="seo-discovery-disclaimer">${escapeHtml(content.disclaimer)}</p><nav class="seo-discovery-links" aria-label="${label}"><span>${caption}</span>${links}</nav>`;
}

function renderPublicMetadata(html, pathname) {
  const metadata = getPublicMetadata(pathname);
  if (!metadata) return html;

  const canonical = SITE_URL + normalizePath(pathname);
  // The whole product is Hebrew and right-to-left.
  const language = 'he';
  let rendered = normalizePath(pathname) === '/' ? html : appDocument(html, metadata.description);
  rendered = rendered.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  rendered = replaceContentAttribute(rendered, `meta\\s+name=["']description["']`, metadata.description);
  rendered = replaceContentAttribute(rendered, `meta\\s+property=["']og:title["']`, metadata.title);
  rendered = replaceContentAttribute(rendered, `meta\\s+property=["']og:description["']`, metadata.description);
  rendered = replaceContentAttribute(rendered, `meta\\s+property=["']og:url["']`, canonical);
  rendered = replaceContentAttribute(rendered, `meta\\s+name=["']twitter:title["']`, metadata.title);
  rendered = replaceContentAttribute(rendered, `meta\\s+name=["']twitter:description["']`, metadata.description);
  rendered = replaceHrefAttribute(rendered, `link\\s+rel=["']canonical["']`, canonical);
  for (const alternateLanguage of [language, 'x-default']) {
    rendered = replaceHrefAttribute(
      rendered,
      `link\\s+rel=["']alternate["']\\s+hreflang=["']${alternateLanguage}["']`,
      canonical
    );
  }
  if (normalizePath(pathname) !== '/') return removeAppExplanation(rendered);

  const contentMarkup = renderSeoContent(SEO_CONTENT['/'], language);
  rendered = rendered.replace(
    /(<section\s+id=["']seo-route-content["'][^>]*>)[\s\S]*?(<\/section>)/i,
    (_match, open, close) => `${open}${contentMarkup}${close}`
  );
  return rendered;
}

function removeAppExplanation(html) {
  return html.replace(/<section\s+id=["']seo-route-content["'][^>]*>[\s\S]*?<\/section>/gi, '');
}

function appDocument(
  html,
  description = 'כלי מחקר וסריקת מניות של Capital Flow. נתוני השוק עשויים להיות מעוכבים או חלקיים.'
) {
  return html
    .replace(
      /<html\b([^>]*)>/i,
      (_tag, attrs) => `<html${attrs.replace(/\s+(?:lang|dir)=["'][^"']*["']/gi, '')} lang="he" dir="rtl">`
    )
    .replace(
      /(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
      (all, open, json, close) => {
        try {
          const value = JSON.parse(json);
          if (value['@type'] === 'SoftwareApplication') {
            value.inLanguage = 'he';
            value.description = description;
          }
          return open + JSON.stringify(value) + close;
        } catch {
          return all;
        }
      }
    );
}

function servePublicApp(req, res, serveDir) {
  const indexPath = `${serveDir}/index.html`;
  const isKnownRoute = !!getPublicMetadata(req.path);

  fs.readFile(indexPath, 'utf8', (error, html) => {
    if (error) return res.status(isKnownRoute ? 200 : 404).sendFile(indexPath);
    if (!isKnownRoute) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      const notFoundHtml = appDocument(removeAppExplanation(html))
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

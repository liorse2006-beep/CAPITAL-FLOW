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
    title: 'Unusual Volume Stock Scanner | Capital Flow',
    description:
      'Screen selected stock universes for unusual trading volume with volume-ratio, market-cap and volume filters. Market data may be delayed or incomplete; educational use only.',
  },
  '/ma': {
    title: 'Moving Average Stock Scanner | Capital Flow',
    description:
      'Scan selected U.S. stock universes for proximity to 9, 20, 50 and 150 simple moving averages on daily or weekly timeframes. Market data may be delayed or incomplete.',
  },
  '/flow': {
    title: 'Stock Sector Performance | Capital Flow',
    description:
      'Review price and volume movement across market sectors with Capital Flow. Market data may be delayed or incomplete; verify information independently.',
  },
  '/fundamentals': {
    title: 'Fundamental Stock Analysis | Capital Flow',
    description:
      'Review available P/E, forward P/E, PEG, debt-to-equity, growth, float, short interest, and earnings data. Availability varies by symbol; data may be delayed or incomplete.',
  },
  '/watchlist': {
    title: 'Stock Watchlist & Alerts | Capital Flow',
    description:
      'Track selected stock symbols, review available quote information, and manage supported price or volume alerts. Market data may be delayed or incomplete.',
  },
  '/policy': {
    title: 'מדיניות פרטיות | Capital Flow',
    description: 'מדיניות הפרטיות של Capital Flow — כיצד אנו אוספים, משתמשים ומגנים על המידע שלך.',
  },
  '/accessibility': {
    title: 'Accessibility Statement | Capital Flow',
    description:
      "Read Capital Flow's accessibility statement, available features, known limitations, and contact details.",
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

  return `<h2 id="${escapeHtml(content.id)}-title">${escapeHtml(content.title)}</h2><p class="seo-discovery-intro">${escapeHtml(content.intro)}</p><div class="seo-discovery-sections">${sections}</div><p class="seo-discovery-disclaimer">${escapeHtml(content.disclaimer)}</p><nav class="seo-discovery-links" aria-label="Explore Capital Flow tools"><span>Explore other tools</span>${links}</nav>`;
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
  const contentMarkup = renderSeoContent(SEO_CONTENT[normalizePath(pathname)]);
  rendered = rendered.replace(
    /(<section\s+id=["']seo-route-content["'][^>]*>)[\s\S]*?(<\/section>)/i,
    (_match, open, close) => `${open}${contentMarkup}${close}`
  );
  return rendered;
}

function servePublicApp(req, res, serveDir) {
  const indexPath = `${serveDir}/index.html`;
  if (!getPublicMetadata(req.path)) return res.sendFile(indexPath);

  fs.readFile(indexPath, 'utf8', (error, html) => {
    if (error) return res.sendFile(indexPath);
    res.type('html').send(renderPublicMetadata(html, req.path));
  });
}

module.exports = { getPublicMetadata, renderPublicMetadata, servePublicApp };

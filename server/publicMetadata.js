const fs = require('fs');

const SITE_URL = 'https://capitalflow.vip';

// Keep the public route metadata in one trusted server-side map. Client-side
// useSeo still updates metadata after React mounts, but crawlers and social
// link unfurlers often inspect the initial HTML without running the bundle.
// These values are product copy, never request-controlled input.
const ROUTE_METADATA = Object.freeze({
  '/': {
    title: 'Capital Flow — מה שכל סוחר צריך, במקום אחד',
    description:
      'Capital Flow עוזר לך לסרוק את השוק, למצוא מניות עם תנועה חריגה ולפתוח בדיקה מסודרת — בלי לעבור על עשרות טאבים. מתחילים ב־7 ימים בחינם.',
  },
  '/scanner': {
    title: 'Capital Flow — סורק נפח מסחר בזמן אמת ל-S&P 500 ו-NASDAQ 100',
    description:
      'סרקו את כל שוק המניות בלחיצה אחת, מצאו תנועות נפח חריגות ופוטנציאל פריצה, ופתחו בדיקה מסודרת על כל מניה — בלי לעבור על עשרות טאבים. 7 ימי ניסיון חינם.',
  },
  '/ma': {
    title: 'סורק ממוצעים נעים (Moving Average) למניות | Capital Flow',
    description: 'סרקו מניות לפי חציות ממוצעים נעים ואיתותי מגמה, ומצאו הזדמנויות טכניות בשוק במהירות.',
  },
  '/flow': {
    title: 'מעקב תזרים הון לפי סקטורים בזמן אמת | Capital Flow',
    description:
      'ראו לאן זורם הכסף בשוק המניות: מעקב אחר תזרים כניסות ויציאות לפי סקטור, בזמן אמת, כדי לזהות מגמות לפני כולם.',
  },
  '/fundamentals': {
    title: 'Fundamental Stock Analysis | Capital Flow',
    description:
      'Review P/E, forward P/E, PEG, debt-to-equity, growth, float, short interest, and earnings data for a stock.',
  },
  '/watchlist': {
    title: 'Stock Watchlist | Capital Flow',
    description:
      'Track favorite stock symbols, review current quotes, and manage price alerts in one focused watchlist.',
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

const express = require('express');
const { PAGES, hasEnglish } = require('../learn/content');
const { PUBLISHED } = require('../learn/render');
const { getSnapshots, isIndexable } = require('../stocks/store');
const { SYMBOLS, slugFor } = require('../stocks/universe');
const { ETF_SYMBOLS } = require('../stocks/etfs');

// Generated so the sitemap always matches what is actually indexable: a stock
// page is listed only once its snapshot has core data (pages without it are
// served noindex), and every learning page is listed in each language it has.
const SITE_URL = 'https://capitalflow.vip';
const APP_ROUTES = [
  ['/', 'weekly', '1.0'],
  ['/scanner', 'daily', '0.9'],
  ['/flow', 'daily', '0.7'],
  ['/ma', 'daily', '0.7'],
  ['/fundamentals', 'daily', '0.7'],
  ['/watchlist', 'daily', '0.7'],
  ['/policy', 'yearly', '0.3'],
  ['/accessibility', 'yearly', '0.3'],
];

function entry(path, lastmod, changefreq, priority) {
  return `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`;
}

async function buildSitemap() {
  const snapshots = await getSnapshots();
  let body = '';
  for (const [path, freq, priority] of APP_ROUTES) body += entry(path, PUBLISHED, freq, priority);
  body += entry('/learn', PUBLISHED, 'weekly', '0.8');
  body += entry('/en/learn', PUBLISHED, 'weekly', '0.7');
  for (const page of PAGES) {
    const priority = page.category === 'scanners' ? '0.7' : '0.6';
    body += entry(`/learn/${page.slug}`, PUBLISHED, 'monthly', priority);
    if (hasEnglish(page.slug)) body += entry(`/en/learn/${page.slug}`, PUBLISHED, 'monthly', '0.5');
  }
  const today = new Date().toISOString().slice(0, 10);
  body += entry('/stocks', today, 'daily', '0.8');
  body += entry('/en/stocks', today, 'daily', '0.7');
  body += entry('/etfs', today, 'daily', '0.7');
  body += entry('/en/etfs', today, 'daily', '0.6');
  const lastmodOf = (snapshot) => new Date(snapshot.asOf || Date.now()).toISOString().slice(0, 10);
  for (const symbol of SYMBOLS) {
    const snapshot = snapshots.get(symbol);
    if (!isIndexable(snapshot)) continue;
    body += entry(`/stocks/${slugFor(symbol)}`, lastmodOf(snapshot), 'daily', '0.6');
    body += entry(`/en/stocks/${slugFor(symbol)}`, lastmodOf(snapshot), 'daily', '0.5');
  }
  for (const symbol of ETF_SYMBOLS) {
    const snapshot = snapshots.get(symbol);
    if (!isIndexable(snapshot)) continue;
    body += entry(`/etfs/${symbol.toLowerCase()}`, lastmodOf(snapshot), 'daily', '0.6');
    body += entry(`/en/etfs/${symbol.toLowerCase()}`, lastmodOf(snapshot), 'daily', '0.5');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}</urlset>\n`;
}

const router = express.Router();
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(await buildSitemap());
  } catch (error) {
    next(error);
  }
});

module.exports = { router, buildSitemap };

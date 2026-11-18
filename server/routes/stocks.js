const express = require('express');
const { getSnapshots } = require('../stocks/store');
const { symbolForSlug } = require('../stocks/universe');
const { etfForSlug } = require('../stocks/etfs');
const { renderStockPage, renderEtfPage, renderPending, renderStocksHub, renderEtfsHub } = require('../stocks/render');
const { reportError } = require('../utils/reportError');

// Public, server-rendered stock and ETF pages (Hebrew and English) built only
// from the daily snapshot table. A request never calls a market-data provider.
const router = express.Router();
const SLUG = /^[a-z0-9-]{1,12}$/i;

function send(res, html) {
  res.set('Cache-Control', 'public, max-age=900');
  res.type('html').send(html);
}

for (const lang of ['he', 'en']) {
  const base = lang === 'en' ? '/en' : '';

  router.get(`${base}/stocks`, async (req, res, next) => {
    try {
      send(res, renderStocksHub(await getSnapshots(), lang));
    } catch (error) {
      reportError(error, '[stocks hub]');
      next(error);
    }
  });

  router.get(`${base}/stocks/:slug`, async (req, res, next) => {
    const slug = req.params.slug;
    if (!SLUG.test(slug)) return next();
    const symbol = symbolForSlug(slug);
    if (!symbol) return next();
    if (slug !== slug.toLowerCase()) return res.redirect(301, `${base}/stocks/${slug.toLowerCase()}`);
    try {
      const all = await getSnapshots();
      const snapshot = all.get(symbol);
      send(res, snapshot ? renderStockPage(snapshot, all, lang) : renderPending(symbol, lang, 'stock'));
    } catch (error) {
      reportError(error, '[stock page]');
      next(error);
    }
  });

  router.get(`${base}/etfs`, (req, res, next) => {
    try {
      send(res, renderEtfsHub(lang));
    } catch (error) {
      reportError(error, '[etfs hub]');
      next(error);
    }
  });

  router.get(`${base}/etfs/:slug`, async (req, res, next) => {
    const slug = req.params.slug;
    if (!SLUG.test(slug)) return next();
    const meta = etfForSlug(slug);
    if (!meta) return next();
    if (slug !== slug.toLowerCase()) return res.redirect(301, `${base}/etfs/${slug.toLowerCase()}`);
    try {
      const all = await getSnapshots();
      const snapshot = all.get(meta.symbol);
      send(res, snapshot ? renderEtfPage(snapshot, all, lang) : renderPending(meta.symbol, lang, 'etf'));
    } catch (error) {
      reportError(error, '[etf page]');
      next(error);
    }
  });
}

module.exports = router;

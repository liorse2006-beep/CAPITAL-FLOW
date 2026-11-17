const express = require('express');
const { getSnapshots } = require('../stocks/store');
const { symbolForSlug } = require('../stocks/universe');
const { renderStockPage, renderPendingStock, renderStocksHub } = require('../stocks/render');
const { reportError } = require('../utils/reportError');

// Public, server-rendered stock pages built only from the daily snapshot
// table. A request never calls a market-data provider.
const router = express.Router();
const SLUG = /^[a-z0-9-]{1,12}$/i;

function send(res, html) {
  res.set('Cache-Control', 'public, max-age=900');
  res.type('html').send(html);
}

router.get('/stocks', async (req, res, next) => {
  try {
    send(res, renderStocksHub(await getSnapshots()));
  } catch (error) {
    reportError(error, '[stocks hub]');
    next(error);
  }
});

router.get('/stocks/:slug', async (req, res, next) => {
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return next();
  const symbol = symbolForSlug(slug);
  if (!symbol) return next();
  if (slug !== slug.toLowerCase()) return res.redirect(301, `/stocks/${slug.toLowerCase()}`);
  try {
    const all = await getSnapshots();
    const snapshot = all.get(symbol);
    send(res, snapshot ? renderStockPage(snapshot, all) : renderPendingStock(symbol));
  } catch (error) {
    reportError(error, '[stock page]');
    next(error);
  }
});

module.exports = router;

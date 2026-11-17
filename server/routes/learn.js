const express = require('express');
const { getPage } = require('../learn/content');
const { renderPage, renderHub } = require('../learn/render');

// Server-rendered Hebrew learning pages. They are plain HTML (no client
// bundle) so search engines index the full text on the first request.
const router = express.Router();
const SLUG = /^[a-z0-9-]{1,80}$/;
const cache = new Map();

function send(res, key, render) {
  if (!cache.has(key)) cache.set(key, render());
  res.set('Cache-Control', 'public, max-age=600');
  res.type('html').send(cache.get(key));
}

router.get('/learn', (req, res) => send(res, 'hub', renderHub));

router.get('/learn/:slug', (req, res, next) => {
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return next();
  const page = getPage(slug);
  if (!page) return next();
  send(res, slug, () => renderPage(page));
});

module.exports = router;

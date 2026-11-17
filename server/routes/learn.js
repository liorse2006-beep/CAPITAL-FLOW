const express = require('express');
const { getPage } = require('../learn/content');
const { renderPage, renderHub } = require('../learn/render');

// Server-rendered learning pages (Hebrew at /learn, English at /en/learn).
// They are plain HTML with no client bundle, so search engines index the full
// text on the first request.
const router = express.Router();
const SLUG = /^[a-z0-9-]{1,80}$/;
const cache = new Map();

function send(res, key, render) {
  if (!cache.has(key)) cache.set(key, render());
  res.set('Cache-Control', 'public, max-age=600');
  res.type('html').send(cache.get(key));
}

for (const [prefix, lang] of [
  ['/learn', 'he'],
  ['/en/learn', 'en'],
]) {
  router.get(prefix, (req, res) => send(res, `${lang}:hub`, () => renderHub(lang)));
  router.get(`${prefix}/:slug`, (req, res, next) => {
    const slug = req.params.slug;
    if (!SLUG.test(slug)) return next();
    const page = getPage(slug, lang);
    if (!page) return next();
    send(res, `${lang}:${slug}`, () => renderPage(page, lang));
  });
}

module.exports = router;

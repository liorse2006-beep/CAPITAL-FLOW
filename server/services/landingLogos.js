const LANDING_LOGO_ORIGIN = 'https://assets.parqet.com/logos/symbol/';
const MAX_LOGO_BYTES = 100_000;

async function readImage(upstream) {
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return { status: upstream.status, body: null };
  }
  const contentType = upstream.headers.get('content-type') || '';
  if (!/^image\/(?:svg\+xml|png|jpeg|webp)(?:;|$)/i.test(contentType)) {
    await upstream.body?.cancel();
    return { status: 502, body: null };
  }
  if (Number(upstream.headers.get('content-length')) > MAX_LOGO_BYTES) {
    await upstream.body?.cancel();
    return { status: 502, body: null, oversized: true };
  }
  if (!upstream.body) return { status: 502, body: null };

  const reader = upstream.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_LOGO_BYTES) {
        await reader.cancel();
        return { status: 502, body: null, oversized: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) return { status: 502, body: null };
  return { status: 200, body: Buffer.concat(chunks, total), contentType: contentType.split(';', 1)[0] };
}

// Keep logo requests independent of market-data providers and database state.
function createLandingLogoHandler({ fetchFn = fetch } = {}) {
  const landingLogoCache = new Map();

  return async function landingLogoHandler(req, res) {
    const symbol = String(req.params.symbol || '').toUpperCase();
    if (!/^[A-Z]{1,6}$/.test(symbol)) {
      return res.status(400).type('text/plain').send('Invalid symbol');
    }

    let logoPromise = landingLogoCache.get(symbol);
    if (!logoPromise) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const fetchImage = async (format) =>
        readImage(
          await fetchFn(`${LANDING_LOGO_ORIGIN}${symbol}?format=${format}&size=32`, {
            redirect: 'error',
            signal: controller.signal,
            headers: { Accept: 'image/svg+xml,image/*;q=0.8' },
          })
        );
      logoPromise = (async () => {
        const vector = await fetchImage('svg');
        // Parqet's size parameter resizes raster formats, not SVGs. Preserve
        // normal vectors; an oversized image gets at most one 32px PNG retry
        // on the same origin, within the original shared five-second deadline.
        if (vector.oversized && !controller.signal.aborted) return fetchImage('png');
        return vector;
      })()
        .catch(() => ({ status: 502, body: null }))
        .finally(() => clearTimeout(timeout));

      if (landingLogoCache.size >= 400) {
        landingLogoCache.delete(landingLogoCache.keys().next().value);
      }
      landingLogoCache.set(symbol, logoPromise);
    }

    const logo = await logoPromise;
    if (logo.status !== 200 || !logo.body) {
      if (logo.status >= 500 && landingLogoCache.get(symbol) === logoPromise) {
        setTimeout(() => {
          if (landingLogoCache.get(symbol) === logoPromise) landingLogoCache.delete(symbol);
        }, 15_000).unref?.();
      }
      return res
        .status(logo.status === 404 ? 404 : 502)
        .type('text/plain')
        .send('Logo unavailable');
    }

    res.setHeader('Content-Type', logo.contentType || 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(logo.body);
  };
}

module.exports = { createLandingLogoHandler };

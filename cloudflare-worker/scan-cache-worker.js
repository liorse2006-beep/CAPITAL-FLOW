// Cloudflare Worker — edge cache for /api/scan, gated to holders of a
// validly-signed (not-expired) access token, without ever sending the token
// itself into the cache key or checking anything DB-side at the edge.
//
// WHY THIS EXISTS
// The single Node process behind this domain sits on Render's 0.5 vCPU
// Starter instance — a hard, physical concurrency ceiling (measured: p50
// jumps from ~900ms to ~4.2s between 100 and 300 simultaneous connections).
// Meanwhile /api/scan already computes ONE shared result per ticker universe
// (server/routes/scan.js's joinSharedScan) — every user asking for the same
// universe gets the same underlying market data. This Worker moves the
// "serve that shared data to N concurrent viewers" job from Render's single
// process onto Cloudflare's edge (effectively unbounded concurrency, free),
// leaving Render to do only what's genuinely per-user: authenticate the
// token and check the user's personal remaining-scan quota — a read so
// cheap it survives hundreds of concurrent connections on the same box that
// buckles under real scan computation.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not replace the origin's own auth checks. A structurally valid,
// unexpired JWT is required just to reach the cache — but is_blocked,
// session-revocation (logout / force-logout), and quota enforcement all
// still happen on Render, on every cache MISS (same as today) and via the
// live /api/scan-quota call layered on every cache HIT. The one accepted
// gap: a user blocked in the few seconds between two cache refreshes can
// still read an already-cached, already-public-by-the-time-anyone-else-saw-
// it market snapshot until the entry's TTL expires — not sensitive data,
// and never their own personalized quota (that's always fetched live).
//
// DEPLOY (Cloudflare dashboard, free plan, no cost):
//   1. Workers & Pages → Create → paste this file as the Worker's script.
//   2. Settings → Variables → add secret JWT_SECRET = <same value as the
//      app's JWT_SECRET env var on Render>. Never commit that value here.
//   3. Settings → Variables → add ORIGIN = "https://<your-render-url>"
//      (the Render origin, NOT capitalflow.vip, to avoid the Worker calling
//      back through itself).
//   4. Triggers → Routes → add capitalflow.vip/api/scan (and www. if used).
//   5. Leave every other path alone — this Worker only touches /api/scan.

const CACHE_TTL_SECONDS = 60; // matches how often a shared scan is worth recomputing under load
const QUOTA_PATH = '/api/scan-quota';

async function verifyJwtHS256(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let payload;
  try {
    payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const sig = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  return valid ? payload : null;
}

// Strips the per-user quota fields out of a /api/scan response before it's
// allowed into the shared edge cache — quota must never be shared across
// users. quotaFor() (server/services/scanQuota.js) always includes `tier`.
function stripPersonalFields(body) {
  const { tier, isPremium, premium, free, ...shared } = body;
  return shared;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET') return fetch(request); // pass through non-GET untouched

    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const payload = token ? await verifyJwtHS256(token, env.JWT_SECRET) : null;
    if (!payload) {
      // No structurally valid token — never even reaches the cache or origin.
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const cacheKeyUrl = new URL(url.origin + url.pathname + '?' + new URLSearchParams([...url.searchParams].sort()));
    const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
    const cache = caches.default;

    let sharedBody = await cache.match(cacheKey);
    let sharedJson;

    if (sharedBody) {
      sharedJson = await sharedBody.json();
    } else {
      // Cache miss — full round trip through the real app, with the
      // caller's own token, exactly as if this Worker weren't here.
      const originUrl = env.ORIGIN + url.pathname + url.search;
      const originResp = await fetch(originUrl, { headers: { Authorization: auth } });
      if (!originResp.ok) return originResp; // 401/403/429/500 — pass origin's own answer straight through, uncached

      const fullJson = await originResp.json();
      sharedJson = stripPersonalFields(fullJson);
      ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(JSON.stringify(sharedJson), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
          })
        )
      );
      // This request itself already has real, live quota data from the
      // origin call it just made — no need for the extra hop below.
      return new Response(JSON.stringify(fullJson), { headers: { 'Content-Type': 'application/json' } });
    }

    // Cache hit — the heavy scan never ran for this request. Still fetch the
    // caller's own live quota (cheap; see server/routes/scanQuota.js) so the
    // response is indistinguishable from an uncached one.
    const quotaResp = await fetch(env.ORIGIN + QUOTA_PATH, { headers: { Authorization: auth } });
    const quota = quotaResp.ok ? await quotaResp.json() : {};
    return new Response(JSON.stringify({ ...sharedJson, ...quota, fromCache: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

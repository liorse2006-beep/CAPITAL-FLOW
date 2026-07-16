# Speeding up Capital Flow globally (Cloudflare)

The app is served from a single Render region. For visitors far from that
region (e.g. Israel), the biggest remaining latency is the network round-trip
to the origin. Putting **Cloudflare** (free plan) in front fixes most of this:
static assets are cached at 300+ edge locations worldwide, and TLS is terminated
close to the user.

This is a one-time, DNS-level change — no code changes required. The app already
sends the right cache headers (`Cache-Control: immutable` on hashed `/assets/*`),
so Cloudflare will cache them aggressively out of the box.

## Steps (≈15 minutes, needs access to the domain registrar)

1. Create a free account at https://dash.cloudflare.com and click **Add a site**.
   Enter `capitalflow.vip`.
2. Cloudflare scans the existing DNS records. Confirm the record that points to
   Render is present (a `CNAME` for `capitalflow.vip` / `www` → the Render host).
   Leave it **Proxied** (orange cloud ON) — that is what routes traffic through
   Cloudflare's CDN.
3. Cloudflare gives you **two nameservers** (e.g. `xxx.ns.cloudflare.com`). Log in
   to wherever the domain was bought and replace the current nameservers with
   these two. Propagation takes a few minutes to a few hours.
4. In Cloudflare → **SSL/TLS**, set the mode to **Full (strict)**. Render already
   serves valid HTTPS, so strict is correct and most secure.
5. In **Speed → Optimization**, leave Auto Minify off (the Vite build is already
   minified) but you may enable **Brotli** and **Early Hints**.
6. Done. Static assets now load from the nearest edge; only API calls
   (`/api/*`, which are already `no-store`/dynamic) still reach Render directly.

## Verify it worked

After nameservers switch, run:

```
curl -sI https://capitalflow.vip/assets/  # look for a `cf-cache-status` header
```

A `cf-cache-status: HIT` on a static asset confirms Cloudflare is serving it
from the edge.

## Optional, secondary: move the Render region

Render cannot change a service's region in place — you would create a new service
in **Frankfurt** (closest to Israel), re-add the environment variables, and point
the domain at it. The database (Turso) is already global, so it is unaffected.
This is more disruptive than Cloudflare and only worth doing if API latency
(not asset latency) is still a problem after Cloudflare is in place — most of the
perceived slowness is first-paint asset loading, which Cloudflare already solves.

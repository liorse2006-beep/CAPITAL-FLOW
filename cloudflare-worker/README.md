# Capital Flow scan-cache Worker

This Worker handles only `GET /api/scan`. It validates the signed access token,
keeps shared scan snapshots at the edge, and re-checks the caller's quota on
cache hits. All other paths remain on the application origin.

## Deploy

From this directory, with Wrangler authenticated to the correct Cloudflare account:

```bash
npx wrangler login
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

Set `ORIGIN` in `wrangler.toml` to the real Render service URL. The Worker URL
must then be supplied to the Vite build as `VITE_SCAN_WORKER_URL`, for example:

```text
VITE_SCAN_WORKER_URL=https://capital-flow-scan-cache.<account>.workers.dev
```

After deployment, verify an authenticated scan from the production app and
confirm both cache misses and cache hits still return the caller's own quota
metadata. Do not put `JWT_SECRET` in this repository.

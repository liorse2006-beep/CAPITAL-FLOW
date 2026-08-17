# Capital Flow

Real-time stock volume scanner for the S&P 500 and NASDAQ 100 — finds unusual volume spikes, tracks sector money flow, and surfaces catalyst news, with an AI assistant ("Capi") to explain what a scan result means.

Live at [capitalflow.vip](https://capitalflow.vip).

## Tech stack

- **Frontend:** React 19 + Vite, plain CSS (no framework), `react-router-dom`
- **Backend:** Node.js + Express 5
- **Database:** Turso (libSQL/SQLite) in production, a local SQLite file in dev
- **Auth:** Google OAuth + email/password (JWT), `express-session` for the OAuth handshake
- **Payments:** Whop embedded checkout (cards plus Apple Pay/Google Pay when the buyer's device and wallet are eligible)
- **Data providers:** Finnhub (quotes/fundamentals), Yahoo Finance (sparklines), Massive / MarketAux / NewsData.io (news, fallback chain), Google AI Studio (Gemini, news catalyst tagging and Capi)
- **Deployment:** Render (web service), optional Cloudflare Worker edge cache, auto-deploys on push to `main`; the status service can run as a separate process/service

## Local setup

```bash
npm install
cp .env.example .env   # then fill in the keys you need — see below
npm run dev             # runs the Express API (3001) + Vite dev server (5173) together
```

Open `http://localhost:5173`.

Only `JWT_SECRET` and `SESSION_SECRET` are hard-required (the server refuses to boot without them — generate with the command in `.env.example`). Everything else degrades gracefully: without `FINNHUB_API_KEY` scans won't return data, without `RESEND_API_KEY` emails just don't send, without `TURSO_DB_URL`/`TURSO_AUTH_TOKEN` it falls back to a local SQLite file, etc. Start with just the two secrets and add provider keys as you need the features they unlock.

## Environment variables

Full list with setup instructions for each provider lives in [.env.example](.env.example) (names and comments only — never commit real values). Grouped roughly as:

- **Core:** `PORT`, `JWT_SECRET`, `SESSION_SECRET`
- **Market data:** `FINNHUB_API_KEY` (+ optional `FINNHUB_API_KEY_POOL_1..4` for rotation)
- **News:** `MASSIVE_API_KEY`, `MARKETAUX_API_KEY`, `NEWSDATA_API_KEY`
- **AI (Capi + news):** `GOOGLE_AI_STUDIO_KEY`
- **Email:** `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (transactional), `GMAIL_USER`/`GMAIL_APP_PASSWORD` (daily DB backup only)
- **Auth:** `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL`, `TURNSTILE_SECRET`/`VITE_TURNSTILE_SITE_KEY`
- **Push:** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`
- **Admin panel:** `ADMIN_TOKEN` and/or `ADMIN_EMAIL` (panel is disabled if both are unset)
- **Status monitoring:** `STATUS_TARGET_URL`, `STATUS_PUBLIC_URL`, `STATUS_FULL_ADMIN_URL`, `STATUS_ALERT_RECIPIENTS`, `STATUS_INTERNAL_TOKEN`, `STATUS_ADMIN_TOKEN`, the `STATUS_*` interval/retry/retention settings, and the independent backup settings
- **Payments:** `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_PREMIUM_PLAN_ID`, `WHOP_ELITE_PLAN_ID`
- **Database:** `TURSO_DB_URL`/`TURSO_AUTH_TOKEN`
- **Optional monitoring:** `VITE_SENTRY_DSN`/`SENTRY_DSN`, `VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST`
- **Optional scaling:** `VITE_SCAN_WORKER_URL`, `CLUSTER_WORKERS`

## Project structure

```
server/
  routes/       Express route handlers, one file per feature area
  services/     business logic — scanning, news, email, quote caching, etc.
  middleware/   auth + tier/quota gating
  db/           schema + migrations (libSQL)
src/
  components/   React components, grouped by feature (Scanner, Watchlist, Chart, MoneyFlow, MAScanner, Auth, shared)
  context/      AuthContext (user/session state)
  hooks/        reusable hooks (useModalA11y, useSmoothProgress, useScanQuota, ...)
  pages/        top-level routed pages (onboarding quiz, policy page)
test/           backend tests (node:test)
src/**/*.test.jsx   frontend tests (Vitest)
```

## Testing

```bash
npm test              # backend (node:test)
npm run test:frontend # frontend (Vitest)
npm run test:all      # both
```

## Deployment

Render auto-deploys on every push to `main`, but only after the test, lint, format, audit and build gates pass. Set the same environment variables from `.env.example` in the Render dashboard. Running on a paid Starter instance (not the free tier) — no idle spin-down, the background scanner and scheduled jobs run continuously. The production Cloudflare Worker is deployed at `https://capitalflow.liormenaiot.workers.dev`; keep `VITE_SCAN_WORKER_URL` set to that URL in production builds. Deploy the Worker separately only when creating another environment.

### Status page and monitoring

The public status page is available at `/status`; its private operations console is at `/status/admin` and links to the existing full user-admin page. The monitor records checks every five minutes, stores raw diagnostics privately, confirms failures and recoveries with consecutive checks, deduplicates outage/recovery emails, and keeps aggregated availability history.

For outage resilience, run `status-service.js` (or `npm run start:status`) with `status-service.Dockerfile` as a separate Render/Docker service. Give it its own `STATUS_TURSO_DB_URL`/`STATUS_TURSO_AUTH_TOKEN`, `STATUS_PUBLIC_URL`, `STATUS_TARGET_URL`, `STATUS_INTERNAL_TOKEN`, admin credentials, and Resend credentials. The separate service serves the same sanitized status page and operations APIs while monitoring the main origin, so a main-app process outage does not take the monitoring worker or public status host offline. The repository's default Render hook still deploys the main application; provisioning the second host/DNS record is a hosting-console action and is intentionally not hidden inside an application deploy.

The status worker now has a database-backed lease so two replicas cannot run duplicate cycles, a heartbeat watchdog that exposes stale monitoring as a degraded component, and an external GitHub Actions watchdog in `.github/workflows/keepalive.yml` for the case where the status process itself is unreachable. That external path uses a durable GitHub issue marker so repeated scheduler runs do not send repeated outage emails, then sends one recovery email and closes the marker. Configure the repository secrets `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `STATUS_ALERT_RECIPIENTS` for that external email path. The internal market-data probe fails closed in production when `STATUS_INTERNAL_TOKEN` is missing; it is never a public data endpoint.

The independent status database is backed up as a gzip JSON attachment on the configured schedule. The backup contains only status tables and never application users or credentials. Raw checks are retained for the configured window and rolled into durable daily aggregates before pruning, so long-term availability history does not depend on unbounded logs. Run `node restoreStatusDb.js <backup.json.gz>` for a dry run; add `--confirm` only after verifying the target database and backup source. The status admin console also exposes a guarded “Backup status DB” action.

Two safe verification tools are included:

- `npm run load:500` runs a guarded, read-only 500-concurrent-user test. It refuses non-local targets unless `LOAD_TEST_CONFIRM=staging` is explicitly set, and blocks production targets. The manual `.github/workflows/load-test.yml` workflow runs it against `secrets.STAGING_URL`.
- `npm run wallet:verify -- https://capitalflow.vip` verifies the Apple Pay domain file, origin reachability, and CSP wallet/Whop allowlists. Apple Pay and Google Pay still require a real eligible device/card and a sandbox or low-risk Whop transaction; a static HTTP check cannot honestly authorize a wallet sheet.

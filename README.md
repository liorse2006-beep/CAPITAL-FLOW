# Capital Flow

Real-time stock volume scanner for the S&P 500 and NASDAQ 100 — finds unusual volume spikes, tracks sector money flow, and helps you focus on verified market signals.

Live at [capitalflow.vip](https://capitalflow.vip).

## Tech stack

- **Frontend:** React 19 + Vite, plain CSS (no framework), `react-router-dom`
- **Backend:** Node.js + Express 5
- **Database:** PostgreSQL (Neon Free during the no-cost migration), with a local SQLite file for dev and a legacy Turso fallback during cutover
- **Auth:** Google OAuth + email/password (JWT), `cookie-session` for the OAuth handshake
- **Payments:** Whop embedded checkout (cards plus Apple Pay/Google Pay when the buyer's device and wallet are eligible)
- **Data providers:** Yahoo Finance (live quote baseline), Finnhub (live quote/fundamentals), and Massive (verified delayed daily market-cap/volume metrics fallback). The Massive account is not authorized for live snapshots, so it is never used to fabricate an intraday quote or trigger a live alert.
- **Deployment:** Render (web service), optional Cloudflare Worker edge cache, auto-deploys on push to `main`; the status service can run as a separate process/service

## Local setup

```bash
npm install
cp .env.example .env   # then fill in the keys you need — see below
npm run dev             # runs the Express API (3001) + Vite dev server (5173) together
```

Open `http://localhost:5173`.

For local development, `JWT_SECRET` and `SESSION_SECRET` are the only hard-required secrets (the server refuses to boot without them — generate them with the command in `.env.example`). Optional provider keys simply disable or degrade the feature they power. Production is intentionally stricter: it requires a durable `DATABASE_URL` (PostgreSQL) or the legacy `TURSO_DB_URL`/`TURSO_AUTH_TOKEN` pair, plus `RESEND_API_KEY` and `STATUS_INTERNAL_TOKEN`; it refuses to start rather than falling back to an empty local database or logging authentication codes. Configure Google OAuth, Whop, market-data, push, and monitoring variables for the features you enable.

## Environment variables

Full list with setup instructions for each provider lives in [.env.example](.env.example) (names and comments only — never commit real values). Grouped roughly as:

- **Core:** `PORT`, `JWT_SECRET`, `SESSION_SECRET`
- **Market data:** `FINNHUB_API_KEY` (+ optional `FINNHUB_API_KEY_POOL_1..4` for rotation), `MASSIVE_API_KEY` (optional verified delayed daily metrics fallback)
- **Operations-only provider probes:** `MARKETAUX_API_KEY`, `NEWSDATA_API_KEY`, `GOOGLE_AI_STUDIO_KEY` (not exposed as a user-facing feature)
- **Email:** `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (transactional and backup fallback), `GMAIL_USER`/`GMAIL_APP_PASSWORD` (optional preferred weekly app-DB backup sender)
- **Auth:** `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL`, `TURNSTILE_SECRET`/`VITE_TURNSTILE_SITE_KEY`
- **Push:** `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`
- **Admin panel:** `ADMIN_TOKEN` and/or `ADMIN_EMAIL` (panel is disabled if both are unset)
- **Status monitoring:** `STATUS_TARGET_URL`, `STATUS_PUBLIC_URL`, `STATUS_FULL_ADMIN_URL`, `STATUS_ALERT_RECIPIENTS`, `STATUS_INTERNAL_TOKEN`, `STATUS_ADMIN_TOKEN`, the `STATUS_*` interval/retry/retention settings, and the independent backup settings
- **Payments:** `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_PREMIUM_PLAN_ID`, `WHOP_ELITE_PLAN_ID`
- **Database:** `DATABASE_URL` (PostgreSQL/Neon) and its pool/SSL settings; legacy `TURSO_DB_URL`/`TURSO_AUTH_TOKEN` only during migration
- **Optional monitoring:** `VITE_SENTRY_DSN`/`SENTRY_DSN`, `VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST`
- **Optional scaling:** `VITE_SCAN_WORKER_URL`, `CLUSTER_WORKERS`

## Project structure

```
server/
  routes/       Express route handlers, one file per feature area
  services/     business logic — scanning, news, email, quote caching, etc.
  middleware/   auth + tier/quota gating
  db/           schema + migrations and the SQLite/PostgreSQL compatibility adapter
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

Render auto-deploys on every push to `main`, but only after the test, lint, format, audit and build gates pass. The deploy workflow then polls `/health` and requires its public `releaseCommit` to match the exact Git SHA that passed CI; an accepted Render hook alone is not treated as a completed release. Set the same environment variables from `.env.example` in the Render dashboard. Running on a paid Starter instance (not the free tier) — no idle spin-down, the background scanner and scheduled jobs run continuously. The production Cloudflare Worker is deployed at `https://capitalflow.liormenaiot.workers.dev`; keep `VITE_SCAN_WORKER_URL` set to that URL in production builds. Deploy the Worker separately only when creating another environment.

### Status page and monitoring

The public status page is available at `/status`; its private operations console is at `/status/admin` and links to the existing full user-admin page. The monitor records checks every five minutes, stores raw diagnostics privately, confirms failures and recoveries with consecutive checks, deduplicates outage/recovery emails, and keeps aggregated availability history.

For outage resilience, run `status-service.js` (or `npm run start:status`) with `status-service.Dockerfile` as a separate Render/Docker service. Give it its own `STATUS_DATABASE_URL` (or legacy `STATUS_TURSO_DB_URL`/`STATUS_TURSO_AUTH_TOKEN`), `STATUS_PUBLIC_URL`, `STATUS_TARGET_URL`, `STATUS_INTERNAL_TOKEN`, admin credentials, and Resend credentials. The separate service serves the same sanitized status page and operations APIs while monitoring the main origin, so a main-app process outage does not take the monitoring worker or public status host offline. The repository's default Render hook still deploys the main application; provisioning the second host/DNS record is a hosting-console action and is intentionally not hidden inside an application deploy.

The status worker now has a database-backed lease so two replicas cannot run duplicate cycles, a heartbeat watchdog that exposes stale monitoring as a degraded component, and an external GitHub Actions watchdog in `.github/workflows/keepalive.yml` for the case where the status process itself is unreachable. That external path uses a durable GitHub issue marker so repeated scheduler runs do not send repeated outage emails, then sends one recovery email and closes the marker. Configure the repository secrets `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `STATUS_ALERT_RECIPIENTS` for that external email path. The internal market-data probe fails closed in production when `STATUS_INTERNAL_TOKEN` is missing; it is never a public data endpoint.

The independent status database backup is disabled by default (`STATUS_BACKUP_ENABLED=false`) so it does not create a second email stream. If explicitly enabled, it is a gzip JSON attachment on the configured schedule, containing only status tables and never application users or credentials. Raw checks are retained for the configured window and rolled into durable daily aggregates before pruning, so long-term availability history does not depend on unbounded logs. Run `node restoreStatusDb.js <backup.json.gz>` for a dry run; add `--confirm` only after verifying the target database and backup source. The status admin console also exposes a guarded “Backup status DB” action.

The public sitemap is maintained in `public/sitemap.xml` and mirrors the indexable routes declared in `server/publicMetadata.js`. Authenticated application screens and API routes are not public sitemap entries.

Two safe verification tools are included:

- `npm run load:500` runs a guarded, read-only 500-concurrent-user test. It refuses non-local targets unless `LOAD_TEST_CONFIRM=staging` is explicitly set, and blocks production targets. The manual `.github/workflows/load-test.yml` workflow runs it against `secrets.STAGING_URL`.
- `npm run wallet:verify -- https://capitalflow.vip` verifies the Apple Pay domain file, origin reachability, and CSP wallet/Whop allowlists. Apple Pay and Google Pay still require a real eligible device/card and a sandbox or low-risk Whop transaction; a static HTTP check cannot honestly authorize a wallet sheet.

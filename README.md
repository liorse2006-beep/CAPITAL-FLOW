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
- **Deployment:** Render (web service), optional Cloudflare Worker edge cache, auto-deploys on push to `main`

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

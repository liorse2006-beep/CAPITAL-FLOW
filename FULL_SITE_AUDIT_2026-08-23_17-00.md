# Capital Flow — Full Production Readiness Audit

**Audit file:** `FULL_SITE_AUDIT_2026-08-23_17-00.md`
**Timestamp:** 2026-08-23 17:00:29 +03:00 (Asia/Jerusalem)
**Scope:** repository, application code, tests, build, dependency/security checks, local load testing, live read-only HTTP checks, public CI/watchdog evidence, status monitoring, email path, backup path, authentication, authorization, data/AI paths, UI/UX, accessibility and operations.
**Production mutations:** none. No production database change, migration, destructive action, real payment, legal action, deployment or push was performed. One controlled administrator status-email test was sent through the configured Resend path because the current request authorized email verification; inbox receipt was not independently verified.
**Previous audits:** preserved. This file is new and does not overwrite `FULL_SITE_AUDIT_2026-08-23_15-26.md` or `FULL_SITE_AUDIT_2026-08-17_16-54.md`.

## 0. Executive conclusion

The repository is materially hardened and the automated evidence is strong:

* Backend suite: **319 passed, 0 failed**.
* Frontend suite: **103 passed in 15 files**.
* Cloudflare Worker suite: **8/8 passed**.
* Cluster/SSE integration: **1/1 passed**.
* Production build: **passed**.
* Prettier format check: **passed**.
* Production dependency audit: **0 vulnerabilities**.
* Guarded local 500-request test: **500/500 successful**, 0% errors, p95 **413.91ms**.
* Live main health, status health, public status, status summary and Apple association endpoint all responded successfully during this audit.
* Live public status currently reports **Operational**, a healthy worker heartbeat and nine monitored components.

The honest release state is **CONDITIONALLY READY IN CODE, NOT CERTIFIED AS A COMPLETE PRODUCTION LAUNCH**.

This is not a claim of “100%”, “bug-free”, or multi-year certainty. The remaining gaps are not silently marked as passed:

1. Payment readiness, including real Apple Pay/Google Pay eligibility and transaction lifecycle, remains intentionally excluded.
2. Legal, privacy, licensing and regulatory approval remains intentionally excluded.
3. The current GitHub watchdog has repeated failed runs and an open issue because its external recovery-email step failed. The status host itself is healthy; the remaining action is account/repository Secret and watchdog-state remediation.
4. The current worktree contains uncommitted changes and the live deployment was not changed by this audit; local code and live code are therefore not yet proven identical.
5. Trusted-proxy/origin isolation is a deployment-boundary requirement that cannot be proven from repository code alone.
6. Isolated production backup restoration, rollback, RPO/RTO and disaster-recovery execution were not performed against a real production artifact.
7. Full real-browser mobile, Hebrew/RTL, keyboard, screen-reader, axe/contrast and reduced-motion coverage was not completed.
8. A canonical financial-data/licensing/freshness comparison was not approved or completed.

## 1. Audit rules and evidence vocabulary

This audit followed the requested “inspect first, change only what is authorized” principle. Security checks were non-destructive. No brute force, denial of service, production fault injection, uncontrolled AI/provider usage, real payment or destructive database operation was used.

* **VERIFIED** — executed and observed.
* **PARTIALLY VERIFIED** — supported by code/tests or a limited live observation, but the complete scenario was not executed.
* **UNVERIFIED** — insufficient evidence.
* **BLOCKED** — requires an external account, device, production/staging artifact, legal decision or excluded action.
* **FAILED** — the test executed and failed.
* **POTENTIAL** — a conditional target, not a current score.

## 2. Repository baseline

| Item | Result |
|---|---|
| Repository | `C:\Users\LiorSe\OneDrive\Desktop\VOLUME SCANNER` |
| Branch | `main` |
| Local HEAD | `892bfaa806c58d6e892dd4f9b0fa609f0b180e0f` |
| origin/main observed | `ff0546a5265814acd3d6611b34a67371846ee07d` |
| Tracked files | 295 |
| Tracked source files | 253 JS/JSX/TS/TSX/CSS/HTML/MJS/CJS/JSON files |
| Tracked source lines | approximately 60,422 |
| Worktree | Dirty before and during the audit; existing user changes and design/video/audit artifacts were preserved |
| Previous audit files | Preserved; not overwritten |
| Secrets in Git | No secret-shaped tracked hits in the static scan; real `.env` is not tracked |
| Coolify | No Coolify configuration found in the repository; Coolify-specific claims remain unverified |

The dirty worktree includes prior product/UI work, operational hardening, tests and user-generated media/previews. No reset, checkout, broad deletion or destructive cleanup was performed.

### Largest tracked maintenance surfaces

| File | Approximate size/shape | Finding |
|---|---|---|
| `src/styles/index.css` | approximately 10,647 lines | Global style surface mixes shared tokens and page-specific rules |
| `src/pages/landing/effects.js` | approximately 1,753 lines | Large animation/effects module |
| `server/routes/status.js` | approximately 835 lines | Public status UI, admin UI and API code are co-located |
| `src/pages/landing/landing.scoped.css` | approximately 2,331 lines | Large branded surface; split only with characterization coverage |
| `server/routes/admin.js` | approximately 1,167 lines | Admin HTML, browser code and API operations are co-located |
| `src/App.jsx` | approximately 1,520 lines | Application shell, session/event wiring and page composition are concentrated |
| `src/components/Scanner/ScannerPage.jsx` | approximately 1,264 lines | Complex scanner state/UI surface |
| `server/services/statusMonitor.js` | approximately 932 lines | Monitoring state machine, checks, incidents, rollups and notifications |
| `server/db/index.js` | approximately 630 lines | Schema and database bootstrap surface |

Large files are maintainability risks, not evidence that they are unused or safe to delete.

## 3. Architecture found

### Main application

* React 19 + Vite/Rolldown frontend.
* React Router navigation with Capital Flow, Hot Sectors, MA Scanner, Fundamentals and Watchlist surfaces.
* Express 5 server with Helmet, compression, CORS, cookie-parser, cookie-session, Passport, rate limiters, Sentry integration, SSE and background workers.
* Turso/libSQL intended for production; local SQLite/in-memory configuration used for development/tests.
* Production configuration now fails closed when required durable database, secret, OAuth callback or Resend configuration is missing.
* Authentication uses short-lived access tokens in memory plus an HTTP-only refresh cookie; legacy browser token storage is migrated and removed.

### Independent status system

The repository contains a separate `status-service.js`, status Dockerfile, status-specific database/token configuration, status worker, status routes, status backup path and independent monitoring state. The status bootstrap sets its own database URL/token before loading database modules and does not require application JWT/session secrets merely to start.

The code design is independent. Full production independence of hosting, DNS, proxy, storage, deployment and alert delivery still requires infrastructure-account proof.

### External integrations

* Market data: Yahoo Finance and configured provider/fallback paths.
* News: provider chain including configured Finnhub/Massive/MarketAux/NewsData paths.
* AI: Capi/chat provider with authentication, entitlement, rate limiting and bounded failures.
* Payments: Whop checkout/webhooks; intentionally not completed in this audit.
* Email: Resend plus optional Gmail/Nodemailer path.
* Notifications: database notifications, SSE, Web Push and email.
* Monitoring: independent five-minute worker, heartbeat, incidents, history, status page and external GitHub watchdog.

## 4. User-facing routes and major surfaces

| Surface | Route/entry | Access | Audit result |
|---|---|---|---|
| Main application | `/`, `/scanner` | Public shell; server-side entitlement for actions | Present; live application loaded |
| Hot Sectors | App navigation / flow page | Auth/scan controls | Guest state and refresh flow present |
| Moving Average Scanner | App navigation / `/ma` | Auth/scan controls | Strict filter validation and guest waiting state present |
| Fundamentals | App navigation / `/fundamentals` | Trial/premium gate | Search, recent ticker removal, metric selection, loading and unverified-data states present |
| Watchlist | App navigation / `/watchlist` | Authenticated; tiered alert actions | Ownership, empty/sign-in and ticker actions present |
| Authentication | Modal and auth routes | Public | Signup, OTP, login, refresh, logout, reset and Google OAuth code paths present |
| Main admin | `/admin` | Admin authorization | Shell live; unauthenticated `GET /admin/api/users` returned 401 |
| Public status | `/status`, custom status domain | Public | Live page and summary returned 200; refresh/heartbeat/history present |
| Status operations | `/status/admin` | Admin token/session | Shell live; admin data API returned 401 without credentials |
| Policy/accessibility | Public policy routes | Public | Present in code; legal correctness and actual conformance remain unapproved |

## 5. API and control inventory

| API family | Controls verified |
|---|---|
| Auth/signup/OTP/reset | Bounds, rate limiters, CAPTCHA gate when configured, exact OTP shape, expiry and atomic one-time use |
| Refresh/logout/account | HTTP-only refresh cookie, session revocation, ownership and transactional deletion |
| Scans/sector/MA | Auth/entitlement/quota, per-user rate limiting, strict symbols/filters, concurrency deduplication |
| Fundamentals | Auth/entitlement, symbol validation, unverified-data behavior, no fabricated values |
| News | Auth, symbol validation, lightweight cached provider probe, safe resolved-link behavior |
| Watchlist/alerts | Ownership, symbol/ratio/price/type validation, per-user cap and one-shot alert behavior |
| Chat/AI | Auth/entitlement, history ownership, input bounds, provider failure fallback, cost caps and user-content isolation |
| Notifications/SSE | Ownership, memory-only access tokens, short-lived session-bound SSE tickets, per-account ticket limiter |
| Web Push | HTTPS endpoint requirement, length bounds, private/local endpoint rejection, stale subscription pruning |
| Scheduled scans | Strict time/date validation, ownership, active schedule cap and one-time deactivation |
| Checkout/webhook | Auth, dedicated limiter, mocked idempotency/signature/refund tests; real payment intentionally excluded |
| Admin | Separate limiter and server-side admin authorization for users, tiers, blocks, deletion, coupons, backup, audit and push-test controls |
| Status public API | Sanitized summary/history; no sensitive diagnostics |
| Status private API | Admin token/session authorization; raw diagnostics, check-now, maintenance, incident, recipients and backup controls |
| Health/probes | Public lightweight health plus protected database/market/news probes |

No endpoint was declared secure solely because its frontend button is hidden; reviewed sensitive routes perform server-side checks.

## 6. Changes implemented in this work sequence

### Authentication and SSE

* Access tokens are memory-only in the browser; refresh uses an HTTP-only cookie.
* Google token handoff uses a URL fragment and removes it after reading.
* SSE tickets now bind user ID, active session ID and expiry in the HMAC payload.
* Revoked sessions immediately invalidate the corresponding SSE ticket.
* Invalid SSE authentication now returns an explicit 401/403 before any event stream is flushed.
* SSE rate limiting resolves the ticket to the correct account rather than charging every shared IP bucket.

### Fail-closed configuration and independent status

* Production application startup requires durable database and security/email configuration.
* Independent status startup uses its own database/token configuration.
* Independent status does not attempt to authenticate against the main application database merely to use static status admin access.
* Status code contains public sanitization and private diagnostic separation.

### Input, ownership and abuse resistance

* Password, email, OTP, ticker, price, ratio, date/time, sector, message and push-endpoint bounds were tightened.
* Admin deletion cleans owned rows and invalidates active sessions.
* Watchlist/alert/schedule/notification/chat ownership was verified and tested.
* Provider and AI work has quota, timeout, caching, circuit-breaker or concurrency protections in the reviewed paths.

### Monitoring, backup and email

* Five-minute server-side status monitoring, retry confirmation, recovery confirmation, incident deduplication, flapping state, heartbeat and daily rollups are present.
* Expensive news/AI enrichment is not used as the five-minute core health check.
* Main application DB backup can use Resend when Gmail is not configured; Gmail behavior remains available.
* Status backup and restore are dry-run safe by default.
* One controlled status email was accepted by the configured Resend application path; the recipient address is intentionally not recorded in this report.
* Email error handling preserves incident state and does not crash the monitoring process.

### External watchdog

* The GitHub Actions watchdog was corrected so a recovery incident cannot be closed when recovery email secrets are missing or the recovery email step fails. The close step now requires a successful recovery-email step.

## 7. Automated verification evidence

| Check | Result | Evidence |
|---|---|---|
| Backend/API suite | **PASS** | 319 tests, 319 passed, 0 failed, 0 skipped; approximately 30.97s |
| Frontend suite | **PASS** | 15 files, 103 tests passed |
| Cloudflare Worker tests | **PASS** | 8/8 |
| Cluster/SSE integration | **PASS** | 1/1; broadcast reached all cluster workers |
| Production build | **PASS** | 1,652 modules transformed |
| Format | **PASS** | Prettier check clean, including watchdog YAML |
| Lint | **PASS WITH WARNINGS** | 0 errors, 39 warnings |
| Production dependency audit | **PASS** | 0 vulnerabilities |
| Full dependency audit | **OPEN** | 7 high dev/transitive advisories; no automatic dependency update was applied |
| Production dependency tree | **PASS** | `npm ls --omit=dev --depth=0` clean |
| Static tracked-secret scan | **PASS** | 0 secret-shaped hits; no tracked `.env`, private key or credential file |
| Git whitespace check | **PASS** | `git diff --check` produced no whitespace errors |
| Local 500-request load | **PASS** | Read-only local target; 500/500 success, 0% errors, p95 413.91ms |
| Typecheck | **N/A/BLOCKED** | No typecheck script or TypeScript project contract found |

### Local 500-request load result

The guarded harness ran against `http://localhost:3311` with read-only `/health` and `/` paths. Production domains were blocked by the harness and were not load-tested.

| Metric | Result |
|---|---:|
| Virtual users | 500 |
| Requests | 500 |
| Failures | 0 |
| Error rate | 0% |
| Status counts | 500 × 200 |
| Duration | 476.98ms |
| Throughput | 1,048.26 requests/second |
| p50 | 355.51ms |
| p95 | 413.91ms |
| p99 | 414.93ms |
| Max | 415.09ms |
| Threshold | error rate ≤1%; p95 ≤2,000ms |
| Result | **PASS** |

This is not evidence for 500 authenticated scans, provider saturation, AI cost, database connection exhaustion or long-term traffic.

### Build/performance observations

The build passed but reported large chunks:

* Landing JavaScript approximately 732.26KB before gzip.
* Main JavaScript approximately 427.47KB before gzip.
* Main CSS approximately 162.27KB before gzip.

The project has 39 lint warnings, mainly React hook dependency/set-state-in-effect and fast-refresh export warnings. No automatic broad lint fix was applied because blindly rewriting effects can change behavior.

## 8. Live read-only verification

| URL/check | Result |
|---|---|
| `https://capitalflow.vip/health` | 200 JSON |
| `https://capitalflow.vip/api/auth/me` | 401 without credentials, expected |
| `https://capitalflow.vip/admin` | 200 admin shell |
| `https://capitalflow.vip/admin/api/users` | 401 without credentials |
| `https://capitalflow.vip/.well-known/apple-developer-merchantid-domain-association` | 200 text/plain; static Apple domain association only |
| `https://status.capitalflow.vip/health` | 200 JSON |
| `https://status.capitalflow.vip/status` | 200 HTML |
| `https://status.capitalflow.vip/status/api/summary` | 200 sanitized JSON |
| `https://status.capitalflow.vip/status/admin` | 200 admin shell |
| `https://status.capitalflow.vip/status/api/admin/overview` | 401 without credentials |

### Current public status snapshot

At the time of the live read-only check:

* Overall status: **Operational**.
* Heartbeat: **success**, healthy.
* Monitoring interval: **300,000ms (5 minutes)**.
* Maximum stale-heartbeat age: **600 seconds**.
* Components: 9.
* Current incidents: none.
* Main website, backend, database, authentication, market data, news, DNS and SSL: operational.
* Yahoo dependency: operational at the latest check, but the day history showed 6 failed checks out of 10, giving that dependency a 40% current-day availability history. It is marked non-user-impacting and no incident email is generated solely for that historical dependency flapping.

The status system correctly separates “currently operational” from historical degraded checks and does not claim a current outage when the latest structured check succeeds.

### Live deployment parity

The live status admin HTML still contained the older phrase “stored in this tab”, while the local code contains the revised memory-only wording. This is direct evidence that the current worktree changes are not yet deployed to the live service. No deployment or push was performed in this audit.

## 9. Security and authorization findings

### Verified controls

* Passwords are bcrypt-hashed and bounded before hashing.
* OTP verification is atomic and single-use under concurrency.
* Refresh/logout/reset/delete/admin block paths revoke sessions.
* Admin routes use server-side checks and dedicated rate limiting.
* User-owned resources are scoped to the authenticated owner in reviewed paths.
* SQL values are parameterized in reviewed paths; dynamic admin cleanup table names are fixed internal constants.
* Push endpoints reject non-HTTPS and private/local targets.
* Worker JWT algorithm and claim validation fails closed.
* Helmet/security headers are present; live main/status headers were inspected.
* Tracked secret scan was clean.
* Public status responses are sanitized; private diagnostics are protected.

### Remaining security findings

| ID | Severity | Status | Evidence and impact | Required owner |
|---|---|---|---|---|
| F-SEC-01 | P1 | OPEN/DEPLOYMENT-BOUNDARY | `realIp()` accepts `CF-Connecting-IP`, and Express trusts a proxy hop. The repository does not prove direct Render-origin access is blocked or that only a trusted proxy can supply that header. A direct-origin spoof could weaken IP rate-limit buckets. | Hosting/DevOps |
| F-SEC-02 | P2 | PARTIAL | Production secret presence/rotation and source-map behavior were not independently inspected from the deployment account. | DevOps |
| F-SEC-03 | P2 | PARTIAL | Cookie flags and CSRF-related code exist, but a complete real-browser cross-site mutation matrix was not run against production/staging. | Security/QA |
| F-SEC-04 | P2 | PARTIAL | Status admin supports a dedicated token, with a fallback path for operational compatibility. Dedicated status credentials and rotation must be verified in the deployment environment. | DevOps |

The correct fix for F-SEC-01 is primarily infrastructure: restrict or private-origin the Render service behind the intended proxy, or configure and verify a trusted-proxy source policy. It should not be “fixed” by blindly changing the header behavior and risking incorrect client identity behind Cloudflare.

## 10. Authentication, authorization and business-logic abuse

### Verified

* Login, signup, OTP, reset, refresh, logout and account deletion paths have bounds and tests.
* Maximum active sessions are enforced without invalidating unrelated devices.
* Trial/premium/elite checks are enforced server-side.
* Scan quotas are shared correctly by category where intended and concurrent reservations cannot exceed the cap.
* Alert, watchlist, schedule, notification and chat resources do not cross user ownership in tests.
* Double-submit and concurrent scan behavior is covered.
* Coupon redemptions are bounded and concurrency-safe.
* Webhook event signatures, duplicate deliveries, stuck claims, refunds and missing-user events are covered with mocked provider data.
* The test suite specifically verifies prompt/content isolation for chat and no fabricated provider values in fundamentals/news paths.

### Residual abuse surfaces

* Public coupon validation can still be used for low-rate code enumeration; it is rate limited and is a product/business decision.
* In-memory rate limiting is sufficient for the observed single-instance design but is not a durable global limiter across multiple replicas.
* AI/provider budgets need live cost and concurrency baselines before materially increasing traffic.
* A complete production IDOR/admin test with a disposable account set remains unexecuted.

## 11. Database, data integrity and backups

### Database

* Production Turso/libSQL configuration is explicit and fail-closed.
* Database schema initialization is retried for transient local lock conditions.
* Parameterized queries and ownership scoping were inspected.
* Account deletion performs transactional cleanup across inspected owned tables and revokes sessions.
* Status DB is separate from the application DB by configuration and bootstrap.

### Backup evidence

* Application backup includes operational/user-facing tables and records successful backup metadata.
* Resend fallback is implemented when Gmail is not configured.
* Status backup is independently configured and sanitized.
* Restore tooling is dry-run by default and requires explicit confirmation for a real target.
* Unit tests cover status snapshot restore, partial delivery failure, application backup freshness, oversized attachment handling and admin authorization.

### Remaining DR proof

No production backup artifact was downloaded, no isolated production-equivalent restore was compared with a sentinel/row-count record, and no measured RPO/RTO, migration rollback, DNS recovery or region-loss exercise was run. This is an evidence gap, not proof that backups are unusable.

**Finding F-DR-01 — P1/BLOCKED:** complete an isolated restore and rollback drill before calling disaster recovery production-ready.

## 12. Monitoring, status and notification behavior

### Implemented behavior

* Server-side five-minute checks; no browser tab dependency.
* Website content/status check.
* Backend/API structured-response check.
* Database lightweight query and latency check.
* Authentication availability check without creating users.
* Known-symbol market-data check.
* Lightweight cached news-provider check.
* Separate external Yahoo dependency classification.
* DNS and SSL checks.
* Retries and failure confirmation.
* Multiple successful recovery checks.
* One incident per ongoing outage, incident state and duration.
* Severity/status states: operational, degraded, partial, major and maintenance.
* Response-time thresholds and sanitized public diagnostics.
* Daily availability rollups, retention and component details.
* Worker heartbeat and stale-worker watchdog path.
* Outage/recovery email deduplication and delivery state.

### Email evidence

One controlled administrator status incident email was accepted by the local configured Resend API path. The code preserves incidents when email fails, records delivery failure and does not emit one email every five minutes for the same incident.

The following were not fully proven:

* Inbox receipt and spam-folder behavior.
* Production provider failure/retry behavior.
* External GitHub watchdog recovery delivery.

### External watchdog finding

Public GitHub Actions evidence showed recent `Keep-alive ping` runs on `origin/main` failing. Earlier job-level evidence showed the main and status probes succeeding while the external recovery-email step failed. Public GitHub issue **#1 — Independent status host unreachable** remains open from an earlier incident. The current status host is healthy, so the remaining failure is alert-state/provider configuration, not a current site outage.

**Finding F-OPS-01 — P1 operational:** repair/verify repository Secrets `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `STATUS_ALERT_RECIPIENTS`, then close/reconcile stale issue #1 only after a successful recovery delivery. The workflow was patched locally so a failed/missing recovery email cannot silently close the marker.

## 13. Financial data correctness

### Verified in code/tests

* Fundamentals distinguishes missing/unverified data from zero.
* Provider failures do not become fabricated numbers.
* Float and short interest are sourced from the appropriate quote-summary path in tested cases.
* Technical calculations include DST-aware trading-time tests.
* MA scan validation rejects unknown/unbounded filters.
* News articles without verifiable links are removed rather than presented as verified.
* Provider fallback behavior is tested without inventing articles.

### Not closed

**Finding F-DATA-01 — P1/BLOCKED:** no approved canonical-source comparison was executed for corporate actions, exchange calendars, delayed vs real-time status, currency, timezone, symbol mapping and freshness.
**Finding F-DATA-02 — P2:** provider licensing, caching and redistribution terms were not legally approved.
**Finding F-DATA-03 — P2:** marketing/demo copy such as “LIVE DATA” needs product/compliance confirmation that it cannot be read as a guarantee for a static preview.

## 14. AI safety and grounding

### Verified

* Chat routes require auth and entitlement.
* Daily/provider caps and rate limiting exist.
* User content is explicitly treated as untrusted data in the prompt path.
* Provider failure returns bounded, user-safe fallback text.
* AI enrichment is not required for core five-minute health status.
* News sentiment/source values do not blindly trust invalid model output.
* Article data sent to the model is bounded and labelled as data.

### Not fully verified

* Live prompt-injection and indirect prompt-injection tests.
* Live cost, latency, timeout and retry soak.
* Long-session context growth and retention under production volume.
* Independent factual grounding/citation sampling.
* Provider terms and data-processing review.

## 15. Frontend, UI/UX, mobile, Hebrew/RTL and accessibility

### Desktop/live observations

The live browser session rendered the branded main application, navigation, Capi/Admin/Status links, scanner, Hot Sectors, MA Scanner, Fundamentals and Watchlist surfaces. Loading, guest, sign-in, empty, refresh, upgrade, error and skeleton states are present in code. Fundamentals recent ticker chips include per-ticker remove actions.

The visual system consistently uses the Capital Flow dark/gold language. The main maintainability risk is not a broken control but the concentration of global styling and large page modules.

### Responsive verification

The requested 320, 360, 390, 430, 768, 1024, 1280, 1440, 1920 and 4K matrix was not certified. A local Puppeteer attempt was not reliable because SPA navigation timed out in the available runtime; this is recorded as an evidence limitation rather than a pass. Desktop inspection alone cannot prove no mobile overflow.

**Finding F-UX-01 — P1/BLOCKED:** complete real-browser/device mobile and modal/table/chart overflow verification.

### Hebrew/RTL

Static code contains mixed English/financial terms and some localization work, but no complete visual proof was obtained for:

`AAPL עלתה ב-3.5%`, `$142.35`, `S&P 500`, `Q2 2026`, `Revenue +12.5%`, `EPS -4.2%`, tables, charts, tooltips and modal text under every viewport.

**Finding F-RTL-01 — P1/BLOCKED:** run a real browser BiDi/RTL matrix and confirm `lang`, `dir`, isolation and logical CSS behavior.

### Accessibility

Positive code evidence includes semantic controls, labels, status text in addition to color, live regions and accessible names on reviewed actions. However, there is no complete axe run, keyboard-only run, screen-reader run, reduced-motion run, contrast matrix, focus-trap audit or chart alternative audit.

**Finding F-A11Y-01 — P1/BLOCKED:** complete WCAG-oriented verification before claiming launch-grade accessibility.

## 16. Performance and reliability

### Verified

* Local guarded 500-request read-only test passed.
* Cluster broadcast test passed.
* Provider circuit breaker tests passed.
* Concurrent scan deduplication tests passed.
* Request and response compression are configured.
* Build completes without errors.

### Residual

* Large chunks and global CSS need a measured code-splitting plan.
* Authenticated scans, database pools, AI, provider quotas and long-running memory behavior were not soaked.
* In-memory caches/limiters are not a substitute for shared durable coordination if replicas increase.
* No production resource-limit, queue-depth, CPU/memory or database saturation evidence is available.

**Finding F-PERF-01 — P2:** establish bundle, p95/p99, provider-cost and sustained-load budgets before broad growth.

## 17. DevOps, deployment and supply chain

### Verified repository controls

* Docker/main and independent status concepts exist.
* CI includes installation, tests, worker tests, lint, format, build and dependency checks.
* Load test blocks production domains by default and requires explicit staging confirmation for non-local targets.
* Keepalive/watchdog automation exists.
* Production dependency audit is clean.

### Open deployment items

* No deployment ID or release log was created in this audit.
* Local worktree changes are not live; live status admin text differs from local code.
* Render service settings, private-origin policy, health/restart/resource limits, volumes, TLS/DNS ownership and secret rotation were not available from repository inspection.
* The current GitHub Actions watchdog is failing due the external recovery-email/state problem.
* Seven high advisories remain in development/transitive dependencies: `brace-expansion`, `js-yaml`, `nanoid`, `postcss`, `shell-quote` via `concurrently`, and `undici` via `jsdom`. Production dependencies have 0 vulnerabilities.

**Finding F-DEPS-01 — P2:** upgrade dev/build/test dependencies in a controlled branch and rerun the full suite; no automatic `npm audit fix` was applied.
**Finding F-DEPLOY-01 — P1 operational:** release the reviewed worktree through the approved deployment process and run post-deploy smoke/rollback checks. This is not a payment or legal task, but it requires a deliberate release action and must not be assumed from local code.

## 18. Privacy, licensing and legal boundary

### Technical observations

* No tracked credentials were found.
* Public status output is sanitized.
* Browser storage contains non-secret preferences, recent searches, watchlist/alert UI state and consent data.
* Analytics, Sentry/PostHog, provider data, AI data and backups create retention/processor questions.
* Account deletion does not by itself prove historical backup deletion.

### Intentionally left for the user

* Legal/privacy policy approval.
* Israeli privacy/GDPR/CCPA applicability.
* Data-processing agreements and international transfer review.
* Market-data and news redistribution licenses.
* AI/provider terms.
* Fonts, logos, images and generated asset commercial-use clearance.
* Financial-disclaimer and investment-advice wording approval.

**Finding F-LEGAL-01 — P1/BLOCKED:** legal and compliance approval remains intentionally outside this execution.
**Finding F-PRIV-01 — P2/BLOCKED:** retention/deletion/backup policy needs an approved human decision.

## 19. Payments and wallets — intentionally left

The following were not changed or certified:

* Apple Pay and Google Pay real wallet eligibility on iPhone/Safari and Android/Chrome.
* Desktop wallet eligibility where supported.
* Real Whop sandbox/live checkout.
* Real webhook delivery, pending/failure/refund/chargeback reconciliation.
* Entitlement changes after every payment state.
* Currency, tax and payment disclosures.

The Apple merchant association file returned HTTP 200, which is only a static configuration check. It is not proof that a wallet transaction works.

**Finding F-PAY-01 — P1/BLOCKED:** execute the authorized payment/device matrix separately; no “100% working” claim is made here.

## 20. Failure scenarios

### Executed safely in local tests

* Invalid/oversized auth input.
* Concurrent OTP redemption.
* Session revocation and account deletion cleanup.
* Invalid watchlist/alert/push/schedule/MA inputs.
* User ownership and IDOR-style cross-user checks in tested routes.
* Provider failure, fallback, no-data and malformed-data paths.
* AI provider failure and untrusted content handling.
* Health-monitor transient failure, confirmed outage, recovery and one-email semantics.
* Status structured probe, incident creation, recovery, flapping and retention rollup.
* Status backup dry-run/restore and partial delivery failure.
* SSE ticket tampering, expiry and revoked-session behavior.
* Worker missing variables and JWT algorithm confusion.
* Webhook invalid signature, duplicate/stuck delivery and refund paths using mocks.
* Cluster/SSE broadcast across workers.
* Local 500-request read-only load.

### Not injected into production

* Main website offline/HTTP 500.
* Production database outage.
* Production external API timeout/outage.
* Production monitoring worker stop.
* Production DNS/SSL expiry.
* Production backup restore/rollback.
* Real payments/wallets.
* Legal/compliance approval.

This boundary is deliberate and safe.

## 21. Scores

Scores are evidence-based engineering assessments on a 0–10 scale. They are not warranties, regulatory certification or a promise that future changes cannot introduce defects. “Potential” requires the listed evidence and actions to be completed.

| Category | Current | Potential after closure | Evidence state | Main residual |
|---|---:|---:|---|---|
| Security | 8.6 | 9.6 | PARTIAL | Trusted proxy/origin boundary |
| Authentication | 9.1 | 9.7 | PARTIAL | Full production cookie/OAuth/mailbox matrix |
| Authorization | 9.0 | 9.7 | PARTIAL | Disposable-account production/staging IDOR proof |
| API/input validation | 8.8 | 9.6 | VERIFIED WITH LIMITS | Live abuse/cost soak |
| Business-logic abuse | 8.7 | 9.5 | PARTIAL | Multi-replica/race/cost baselines |
| Database/data integrity | 8.5 | 9.5 | PARTIAL | Production restore and deletion/backup policy |
| Monitoring/status | 8.6 | 9.6 | PARTIAL | Watchdog recovery Secret/state repair and failure drill |
| Email/notifications | 8.5 | 9.5 | PARTIAL | Inbox and external watchdog recovery evidence |
| Backups/DR | 7.8 | 9.6 | BLOCKED | Isolated restore, rollback, RPO/RTO |
| Financial-data correctness | 8.4 | 9.6 | PARTIAL | Canonical/freshness/licensing comparison |
| AI safety/grounding | 8.7 | 9.5 | PARTIAL | Adversarial and live cost/grounding tests |
| Frontend/UI/UX | 8.4 | 9.3 | PARTIAL | Full route/error/long-session matrix |
| Mobile responsiveness | 7.4 | 9.5 | BLOCKED | Required viewports and real devices |
| Hebrew/RTL/localization | 7.0 | 9.5 | BLOCKED | Mixed BiDi visual verification |
| Accessibility | 7.0 | 9.5 | BLOCKED | Axe, keyboard, screen reader, contrast, motion |
| Performance | 8.5 | 9.3 | PARTIAL | Authenticated/provider/AI/database soak |
| CI/CD/infrastructure | 7.5 | 9.5 | BLOCKED | Release parity, origin restriction, watchdog |
| Dependencies/supply chain | 7.5 | 9.2 | PARTIAL | 7 high dev/transitive advisories |
| Code quality/maintainability | 8.0 | 9.2 | VERIFIED WITH DEBT | 39 lint warnings and giant modules |
| Privacy/data lifecycle | 7.2 | 9.5 | BLOCKED | Retention, processors, deletion and backup policy |
| SEO/indexing | 7.8 | 9.2 | PARTIAL | Full crawler/browser metadata matrix |
| Payments/wallets | 5.5 | 9.5 | BLOCKED BY REQUEST | User/device/provider payment validation |
| Legal/compliance/licensing | 5.0 | 9.5 | BLOCKED BY REQUEST | Human legal approval |

**Overall code-readiness assessment:** approximately **8.1/10** with a release gate still blocked. This score is not a launch authorization.

## 22. Required next actions

### User-owned exclusions

1. Execute and approve the Apple Pay/Google Pay + Whop payment matrix.
2. Obtain legal/privacy/licensing/compliance approval.

### Operational actions still required outside payments/legal

1. Repair GitHub repository Resend Secrets and verify one successful external recovery email; reconcile issue #1 only after delivery.
2. Review Render/Cloudflare origin policy and prove the trusted proxy boundary.
3. Release the reviewed worktree through the approved deployment process, then run live smoke and rollback checks.
4. Perform an isolated restore drill with a real backup artifact and record RPO/RTO/sentinel counts.
5. Run the complete mobile, Hebrew/RTL and accessibility matrix on real browsers/devices.
6. Remediate the seven high dev/transitive advisories in a controlled dependency branch.
7. Perform canonical market-data freshness/corporate-action/licensing review.
8. Resolve or explicitly accept the 39 lint warnings and large bundle warnings after characterization tests.

## 23. Runbooks

### Site/API outage

1. Open the independent status origin and check heartbeat before trusting the main site.
2. Compare website, backend, database, authentication, market-data, news, DNS and SSL components.
3. Inspect deployment, logs, database latency, provider quota and recent changes.
4. Confirm one active incident and deduplicated alert state.
5. Roll back only through the approved release process.
6. Require multiple successful checks before resolving and record duration.

### Status worker stopped

1. Check heartbeat age and external watchdog run.
2. Restart/redeploy only the independent status service.
3. Confirm status DB, next cycle and public summary.
4. Verify email delivery state before closing the external marker.

### Data/provider failure

1. Distinguish internal API/database failure from provider failure.
2. Keep raw diagnostics private.
3. Verify response structure, freshness, timeout and provenance.
4. Never convert missing financial data to zero or an unsupported “live” claim.

### Email failure

1. Keep the incident active.
2. Record provider response and retry with bounded policy.
3. Do not close recovery state unless the recovery email step succeeds.
4. Use a secondary operator channel if configured.

## 24. Final statement

The application has a credible and significantly hardened foundation. The automated code evidence is strong and the live application/status endpoints are currently reachable. The correct engineering conclusion is:

**CONDITIONALLY READY IN CODE — NOT YET A COMPLETE LAUNCH ATTESTATION.**

The only product capabilities intentionally not executed are payments/wallets and legal approval. In addition, the report explicitly records external operational and evidence gaps that cannot honestly be called complete without deployment-account, device, production-artifact or infrastructure-owner action.

### Evidence links

* [Main website](https://capitalflow.vip/)
* [Public status page](https://status.capitalflow.vip/status)
* [Status admin shell](https://status.capitalflow.vip/status/admin)
* [Independent status origin](https://status-capital-flow.onrender.com/status)
* [Launch readiness runbook](docs/LAUNCH_READINESS_RUNBOOK.md)
* [Previous full audit — preserved](FULL_SITE_AUDIT_2026-08-17_16-54.md)
* [Previous audit — preserved](FULL_SITE_AUDIT_2026-08-23_15-26.md)

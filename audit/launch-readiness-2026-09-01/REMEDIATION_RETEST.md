# Capital Flow — Launch Readiness Remediation Retest

## 1. Scope and evidence record

This addendum supersedes stale baseline measurements in `LAUNCH_READINESS_REPORT.md` and records the work performed after the initial audit.

| Item | Evidence |
|---|---|
| Application runtime commit | `7d713ffb3b35e5d0b6ebfa5e4f781dbaa6c597f3` — `Clarify checkout callback states` |
| Latest deployed application commit | `7d713ffb3b35e5d0b6ebfa5e4f781dbaa6c597f3` — `Clarify checkout callback states` |
| Public application/runtime release at follow-up verification | `7d713ffb3b35e5d0b6ebfa5e4f781dbaa6c597f3` — exact runtime SHA returned by the production health endpoint |
| Branch | `main` |
| Repository | `https://github.com/liorse2006-beep/CAPITAL-FLOW.git` |
| Audit/retest time | `2026-09-02 10:55:55 +03:00`, Asia/Jerusalem |
| Local environment | Windows PowerShell; Node `v24.15.0`; npm `11.12.1`; Python and Docker unavailable |
| Production URL | `https://capitalflow.vip/` |
| Health URL | `https://capitalflow.vip/health` |
| Status URL | `https://status.capitalflow.vip/status` |
| Production health verification | `GET https://capitalflow.vip/health?audit=7d713ff-report` → `200`, `status=ok`, `releaseCommit=7d713ffb3b35e5d0b6ebfa5e4f781dbaa6c597f3`, `timestamp=2026-09-02T07:56:06.412Z` |
| CI run | `33605582521` (#320) — success for exact `7d713ffb3b35e5d0b6ebfa5e4f781dbaa6c597f3` |
| Deploy run | `33605582518` (#314) — success for exact `7d713ffb3b35e5d0b6ebfa5e4f781dbaa6c597f3` |
| Working tree | Focused release changes committed; unrelated pre-existing untracked workspace artifacts remain un-staged |

No secrets, cookies, tokens, passwords, payment credentials, personal data, or provider keys were included in this addendum.

The following were intentionally not performed: real payment or wallet authorization, real email delivery, destructive migration, production backup restore, brute force, uncontrolled production load, or mutation of another user's production data.

## 2. Remediation completed

### 2.1 Financial data provenance and stale-data handling

The quote cache now exposes `providerFailure`, `usedStaleFallback`, `staleCount`, `staleSymbols`, and `dataAsOf` as non-enumerable metadata on the returned quote map. A stale fallback is bounded to the existing ten-minute maximum and is never silently presented as a fresh scan. Evidence: `server/services/quoteCache.js:76-113,127-178`.

Capital Flow, Moving Average, and Fundamentals paths carry explicit `dataStatus`/`quoteDataStatus` and stale counts. Capital Flow and MA rows identify the affected quote layer as stale; Fundamentals shows a visible warning and data-as-of value. Evidence: `server/services/scanner.js:91-105,166-178,319-347`; `server/services/maScanner.js:119-132,202-211,235-262`; `server/services/fundamentalsScanner.js:73-161`; `src/components/Fundamentals/FundamentalsPage.jsx:246-247,303-304,532-540`; `server/routes/fundamentals.js:33-68`.

Radar now receives unavailable symbols separately for Capital Flow and Moving Average. In `Both` mode a stale layer cannot satisfy a condition or create an event; in `Either` mode only the verified layer can trigger. Evidence: `server/services/radarLogic.js:31-43,101-125,188-200`; `server/services/scheduledScanRunner.js:436-483`; `server/services/radar.js:717-772`.

### 2.2 Backup restore safety

The isolated status-database restore validator rejects empty row objects before constructing invalid SQL. The existing transaction rollback behavior remains covered. Evidence: `server/services/statusDbBackup.js` validation path and `test/statusDbBackup.test.js:80-88`.

This is a local safety improvement, not production restore proof. Production restore remains `UNKNOWN`.

### 2.3 Release hygiene and code quality

`npm run lint` now exits with zero warnings. Intentional external synchronization cases have narrow comments, and the untracked local browser profile patterns are excluded by `.gitignore:25-29`. Pre-existing untracked exploratory/media material was not deleted or staged.

The focused commit contains only reviewed implementation, test, lint, and release-hygiene changes. No untracked Chrome profile, screenshot, video, or exploratory artifact was included in the commit.

### 2.4 Post-report hardening in the checked release

The checked release is a descendant of the earlier data/release-hardening commits and adds the following independently verified safeguards:

- Google OAuth now requests a signed Passport state nonce on both the start and callback paths, while callback session creation remains explicit. Evidence: `server/routes/auth.js:82-87,243-251,627-628`; `test/googleOAuthState.test.js:1-15`.
- Price alerts now use a server-fetched current quote only. Missing, non-positive, stale, or provider-failed data returns `503 DATA_UNAVAILABLE`; client-supplied reference prices cannot create an alert. Evidence: `server/routes/watchlistAlerts.js:42-71`; `test/watchlistAlertsRoute.test.js:71-140`.
- Alert create/remove state is committed server-first and only canonical server data is stored locally. Repeated modal submits are guarded while the request is pending. Evidence: `src/App.jsx:536-600`; `src/components/shared/AlertThresholdModal.jsx:56-116`; `src/components/shared/AlertThresholdModal.test.jsx:1-130`.
- News URL resolution uses the shared timeout helper, preserving the five-second timeout without a manually orphaned timer. Evidence: `server/services/newsService.js:350-363`.
- Capi's result-row description no longer claims News/Capi actions exist on every row. Evidence: `server/services/chatbot.js:72-77`.
- Background scans now retain an in-flight provider Promise after the visible hard timeout, preventing a later scheduler tick from starting a second full-market scan while the first provider call is still settling. Evidence: `server/services/backgroundScan.js:6-16,204-230,282-284`; `test/backgroundScanWatchdog.test.js:41-74`.
- Live watchlist alerts now ignore rows explicitly marked `stale` or `unavailable`, so a provider fallback cannot consume an alert as if it were a verified threshold crossing. Evidence: `server/services/backgroundScan.js:103-110,157`; `test/backgroundScanAlerts.test.js:195-214`.
- The external Keep-alive recovery path now logs a warning and exits successfully when recovery-email secrets are absent; the status probe still fails the watchdog when the status host is unhealthy. Evidence: `.github/workflows/keepalive.yml:40-43,96-107,135-139`.
- Logout now revokes the browser's refresh-cookie session even when the short-lived access token has expired, while remaining idempotent for invalid credentials. A temporary `/api/auth/me` 5xx no longer clears a still-present client session. Evidence: `server/services/auth.js:163-177`; `server/routes/auth.js:525-551`; `src/context/AuthContext.jsx:68-84`; `test/authSessions.test.js:161-182`; `src/context/AuthContext.test.jsx:90-110`.
- Scanner Phase 2 enrichment is now bounded to 20 concurrent match workers rather than launching an unbounded promise for every result, with an order/concurrency regression test. Evidence: `server/services/scanner.js:19-46,221-318,406`; `test/scannerDataStatus.test.js:91-106`.

### 2.6 Checkout confirmation truthfulness and stale-handoff cleanup

- A provider `status=success` is no longer presented as active paid access before the server-side webhook updates the authenticated tier. Until `user.tier` matches the requested tier, the modal shows only a confirmation state and does not expose paid-feature claims or the “Start scanning” action. Evidence: `src/App.jsx:838-870`; `src/components/shared/WelcomeTierModal.jsx:142-164,171-239`.
- The checkout success guard now resets after the status query is removed, so a second purchase in the same mounted App instance is processed instead of being ignored. Evidence: `src/App.jsx:833-849`; regression test: `src/App.test.jsx:91-108`.
- Cancelled/failed checkout and explicit modal close clear the browser-only tier handoff, preventing a later unrelated callback from opening the wrong welcome screen. Escape uses the current close callback even after the modal changes from pricing to checkout. Evidence: `src/App.jsx:842-847`; `src/components/shared/UpgradeModal.jsx:23-35,82-96`; `src/components/shared/WelcomeTierModal.jsx:29-41,95-108`; `src/hooks/useModalA11y.js:8-22`; regression test: `src/components/shared/UpgradeModal.test.jsx:182-203`.
- This is a local/prod code-path truthfulness hardening only. It does not prove Google Pay authorization, provider final amount, webhook delivery, or production entitlement for an actual payment; LR-001 remains `UNKNOWN` by policy.

### 2.5 Public rendering, WebGL fallback, and asset smoke hardening

- Public route metadata is rendered into the initial HTML shell from a trusted server-side route map, so crawlers and social previews do not depend on React mounting. Evidence: `server/publicMetadata.js:9-105`; `server/index.js:22,327`; `test/publicMetadata.test.js`.
- Decorative WebGL components fail closed to their CSS fallback when a context cannot be created, avoiding a production page error on unsupported/headless devices. Evidence: `src/utils/webgl.js:1-24`; `src/components/Topography.jsx:3,176`; `src/components/SpecularButton.jsx:3,130`; `test/webgl.test.jsx`.
- The broken `FRT` marquee asset was replaced with the verified `FSLR` symbol, and the trust-logo set has a regression test for 300 unique valid symbols. Evidence: `src/pages/landing/trustLogos.js:26`; `src/pages/landing/trustLogos.test.jsx:4-9`.

## 3. Post-remediation checks actually run

| Check | Result | Evidence |
|---|---|---|
| Backend suite | `VERIFIED PASS` | `npm run test:all` backend phase: 409/409 tests passed |
| Frontend suite | `VERIFIED PASS` | `npm run test:frontend`: 156/156 tests passed; 23 files |
| Cloudflare Worker suite | `VERIFIED PASS` | 8/8 tests passed |
| Cluster integration | `VERIFIED PASS` | 1/1 broadcast test passed |
| Lint | `VERIFIED PASS` | `npm run lint` exit 0 with no output/warnings |
| Build | `VERIFIED PASS` | `npm run build`; Vite transformed 1,663 modules |
| Scoped formatting | `VERIFIED PASS` | Prettier check passed on changed implementation and test files; full `npm run format:check` also passed |
| Diff whitespace | `VERIFIED PASS` | `git diff --check` passed before commit |
| Production dependency audit | `VERIFIED PASS` | `npm audit --omit=dev --audit-level=high` returned 0 vulnerabilities |
| Targeted regression tests | `VERIFIED PASS` | Checkout confirmation, repeat-purchase, cancel feedback, modal-close, background alert/watchdog, and landing trust-logo tests passed; current full run includes 409 backend, 156 frontend, 8 Worker, and 1 cluster tests |
| GitHub CI | `VERIFIED PASS` | Run `33605582521` (#320), SHA `7d713ff...`, conclusion `success` |
| GitHub Deploy | `VERIFIED PASS` | Run `33605582518` (#314), SHA `7d713ff...`, deploy conclusion `success` |
| Production health | `VERIFIED PASS` | `GET /health?audit=7d713ff-report` → 200; body releaseCommit exactly `7d713ffb3b35e5d0b6ebfa5e4f781dbaa6c597f3` |
| Production asset deployment | `VERIFIED PASS` | Public routes returned `200` after the exact-SHA health check; the Vite asset manifest was served by the deployed origin |
| Public route smoke | `VERIFIED PASS` | Current read-only probe: `/`, `/scanner`, `/ma`, `/flow`, `/fundamentals`, `/watchlist`, `/policy`, `/accessibility`, `/robots.txt`, `/sitemap.xml`, and `https://status.capitalflow.vip/status` all returned `200` |
| Current public metadata | `VERIFIED PASS` | Current route probe returned trusted titles and canonicals for all eight indexable app routes; `/robots.txt` remained `text/plain` and `/sitemap.xml` remained `application/xml` |
| Production security headers | `VERIFIED PASS` | Current health response included CSP, HSTS (`max-age=31536000; includeSubDomains`), X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and X-Frame-Options |
| Anonymous protected API smoke | `VERIFIED PASS` | `2026-09-02` read-only GETs to `/api/auth/me`, `/api/account/summary`, `/api/radars`, `/api/scheduled-scans`, and `/api/chat/history` all returned `401`; no write request was sent |
| Safe coupon endpoint probe | `VERIFIED PASS` | Arbitrary sample POST returned 410 `provider_checkout_required`; no local discount was returned |
| Guest mobile overflow | `VERIFIED PASS` | Headless Puppeteer against the deployed origin: `/scanner` at 320/360/390/430/768 had document/body width equal to viewport and no overflow; all `/scanner`, `/ma`, `/flow`, `/fundamentals`, `/watchlist` checks at 390 had `documentWidth=bodyWidth=390`, no overflow, and Capi hidden |
| Current public browser smoke | `VERIFIED PASS` | Chrome extension smoke after Deploy #314 at `https://capitalflow.vip/?audit=7d713ff-browser`: after SPA and image settle, `innerWidth=1280`, `documentWidth=1265`, `bodyWidth=1265`, no horizontal overflow, `missingImages=[]`, interactive controls `23`, error log `[]`; this is a desktop-width smoke, not a replacement for the authenticated mobile matrix |
| Real payment/wallet | `UNKNOWN` by policy | No transaction or authorization was performed |
| Production backup restore | `UNKNOWN` | Read-only `/admin/api/backup-status` returned HTTP 200 with `lastBackupAt=2026-08-30 00:50:57 +03:00`; this proves recorded backup metadata only, not backup contents or restoreability |
| Authenticated production matrix | `UNKNOWN` | No approved seeded accounts for every tier/ownership case were used |

Note: JSDOM emitted the known `HTMLCanvasElement.getContext()` not-implemented warning during frontend tests; no test failed. This is a test-environment limitation, not evidence that the production charts pass visual or accessibility review.

## 4. Findings retest

### LR-001 — Google Pay end-to-end completion

ID: `LR-001`
Category: Payments / Google Pay
Severity: High
Status: `Unknown`
Title: Google Pay authorization, callback, webhook, and entitlement transition remain unverified
Affected users: Customers using Google Pay or Apple Pay
Affected route/API/file: `src/components/shared/EmbeddedCheckout.jsx:1-60`; checkout provider configuration; webhook path
Evidence: Structural wallet readiness passed previously; post-deploy CSP still includes `https://pay.google.com`; no supported-device/card transaction was run.
Safe reproduction: Use a provider-approved sandbox or low-risk test product on a supported device/browser/card and capture redacted button, authorization, provider completion, webhook, and tier evidence.
Impact: A wallet can be displayed but fail eligibility, or a completed provider payment can fail to update entitlement.
Root cause: Required external device/provider/payment state is not available for a safe repository audit.
Recommendation: Run one controlled wallet transaction and verify final provider amount, webhook idempotency, tier, and promo handling.
Fix status: Structural implementation complete; manual verification pending.
Retest evidence: Production structural checks and public deployment pass; no real transaction.
Residual risk: Wallet availability and provider completion remain unproven.
Confidence: 99%

### LR-002 — Production backup restore

ID: `LR-002`
Category: Backups / disaster recovery
Severity: High
Status: `Unknown`
Title: Production backup restore and RPO/RTO remain unproven
Affected users: All users during primary database loss or corruption
Affected route/API/file: `server/services/dbBackup.js`; status backup service; production backup store
Evidence: Local dump/restore validation and rollback tests pass, including the empty-row guard; no production backup was restored into an isolated recovery database.
Safe reproduction: Restore a production backup into an isolated database, run integrity checks and read-only acceptance queries, and record RPO/RTO without touching primary data.
Impact: Recovery completeness, duration, and backup usability are unknown.
Root cause: Production backup-store and isolated recovery access were not available in this environment.
Recommendation: Schedule and record a non-production restore drill with owner, encryption, off-site copy, RPO, and RTO evidence.
Fix status: Local safety checks complete; operational verification pending.
Retest evidence: `test/statusDbBackup.test.js` passes; no production restore.
Residual risk: Corruption, missing tables, credentials, or excessive recovery time may remain undiscovered.
Confidence: 99%

### LR-003 — Authenticated production entitlement/ownership matrix

ID: `LR-003`
Category: Authentication / authorization / entitlements
Severity: High
Status: `Unknown`
Title: Production tier, direct-API, ownership, and expired-session matrix remains unverified
Affected users: Anonymous, new, trial, expired-trial, Premium, Elite, admin, and unauthorized users
Affected route/API/file: `server/middleware/authMiddleware.js`; gated scanner, Radar, Capi, push, fundamentals, account, notification, and admin routes
Evidence: Local contract tests pass for role gates, sessions, ownership isolation, Radar one-per-user, quota, and webhook cases; no approved production/staging account matrix was run.
Safe reproduction: Use dedicated non-production or explicitly approved test accounts and make only read-only direct API probes plus isolated test mutations.
Impact: A deployment-only access gap could expose a paid feature or another user's data, or deny valid access.
Root cause: Production identities and seeded cross-user data were not available.
Recommendation: Automate a redacted staging entitlement matrix and run it on every release; add approved production smoke accounts if policy permits.
Fix status: Code/test hardening complete; environment verification pending.
Retest evidence: 409 backend tests passed; no production identity test.
Residual risk: Direct-API and cross-user behavior in the deployed database remains unknown.
Confidence: 97%

### LR-004 — Live financial-provider reconciliation

ID: `LR-004`
Category: Financial data correctness
Severity: Medium
Status: `Plausible Risk`
Title: Live provider reconciliation, sessions, corporate actions, units, and mixed timestamps remain incomplete
Affected users: Users relying on price, volume, RVOL, market cap, fundamentals, charts, scans, and Radar
Affected route/API/file: `server/services/quoteCache.js`, `scanner.js`, `maScanner.js`, `fundamentalsScanner.js`, Finnhub/Yahoo services
Evidence: Stale/missing-data metadata and explicit unavailable UI now pass local tests; no live bounded reconciliation report across providers/sessions/corporate actions was produced.
Safe reproduction: Compare a small read-only symbol sample with provider timestamps, session, units, currencies, and symbol mapping recorded.
Impact: Provider drift or timestamp/unit mismatch can change a signal or mislead a user.
Root cause: External provider data is time-sensitive and the full market matrix was not available for a controlled audit.
Recommendation: Add contract fixtures and a monitored reconciliation job with explicit delayed/stale/unavailable states.
Fix status: Defensive handling improved; reconciliation remains open.
Retest evidence: 409 backend tests and stale fallback/Radar tests pass; live reconciliation not performed.
Residual risk: Provider drift, session boundaries, corporate actions, and unit errors.
Confidence: 90%

### LR-005 — Production performance measurement

ID: `LR-005`
Category: Performance / scalability
Severity: Medium
Status: `Plausible Risk`
Title: Production Web Vitals and full-market latency percentiles remain unmeasured
Affected users: All users, especially mobile and large-universe scanner users
Affected route/API/file: Vite bundles, scanner/Capi APIs, provider calls, background jobs
Evidence: Build passes and lazy chunks exist; the latest local build reports main JS approximately `481.37 kB` and main CSS `243.80 kB` (`npm run build`). No production LCP/INP/CLS/TTFB or p95 scan/Capi latency sample was captured.
Safe reproduction: Capture approved guest/auth RUM and run the bounded load harness only in local/staging.
Impact: Peak latency can cause abandonment, duplicate submissions, provider cost, or timeout retries.
Root cause: No production RUM/SLO dataset or approved staging capacity report is attached.
Recommendation: Instrument Web Vitals, API/provider/database percentiles, cancellation, retries, and cost; set release budgets.
Fix status: Lint and build hygiene complete; measurement pending.
Retest evidence: Build, test, and public HTTP smoke pass; performance percentiles unknown.
Residual risk: Peak and cold-start degradation can remain silent.
Confidence: 94%

### LR-006 — Release artifact hygiene

ID: `LR-006`
Category: Frontend quality / release hygiene
Severity: Low
Status: `Plausible Risk`
Title: Lint warnings are closed, but pre-existing untracked exploratory artifacts remain in the workspace
Affected users: Maintainers and future release operators
Affected route/API/file: Repository workspace; `.gitignore`; untracked preview scripts/media/browser state
Evidence: `npm run lint` is now zero-warning and the focused commit excludes untracked artifacts; `git status --short --untracked-files=all` still shows pre-existing non-release files.
Safe reproduction: Inspect the working tree and release packaging inputs; do not delete files without owner approval.
Impact: Accidental staging, noisy audits, and unreliable full-format checks can hide release changes.
Root cause: Exploratory work and release source share a workspace.
Recommendation: Use a clean checkout or a documented release allowlist; quarantine/remove local artifacts in a separate owner-approved cleanup.
Fix status: Lint fixed; workspace isolation remains open.
Retest evidence: Zero-warning lint, focused commit, `.chrome-test-profile-*` ignore rules.
Residual risk: Nonzero local release-hygiene risk; tracked deployment path is clean for this commit.
Confidence: 100%

### LR-007 — Status and operational failover

ID: `LR-007`
Category: Status / operations / disaster recovery
Severity: Medium
Status: `Unknown`
Title: Failover drill, alert delivery, and operator RTO remain unproven
Affected users: All users during a platform or dependency outage
Affected route/API/file: `status-service.js`; `server/routes/status.js`; `.github/workflows/keepalive.yml`
Evidence: Public status and health returned 200, local status monitor/backup/email-policy tests pass, and the latest Keep-alive recovery failure (`run 1114`) was traced to missing recovery-email secrets rather than an unhealthy status host. The workflow now handles that configuration state as a warning; no production failover or real alert-delivery drill was executed.
Safe reproduction: Exercise an isolated status/staging failure and verify incident, recovery, sanitization, and operator notification.
Impact: An outage may remain silent or recovery may exceed expectations.
Root cause: Failure drills require an approved operational window and external monitoring access.
Recommendation: Run quarterly non-destructive game days and document owner/runbook/RTO evidence.
Fix status: Workflow failure mode hardened and deployed; operational failover/real delivery verification pending.
Retest evidence: Public status smoke and local monitor suite pass.
Residual risk: Silent operational failure.
Confidence: 96%

### LR-008 — Licensing and commercial compliance

ID: `LR-008`
Category: Licensing / compliance risk
Severity: Low
Status: `Unknown`
Title: Complete asset, font, logo, and data-provider licensing ledger is not present
Affected users: Business and operations
Affected route/API/file: `public/*`; fonts/logos; Yahoo/Finnhub/Whop/provider terms
Evidence: `npm audit` reports vulnerabilities only; it does not prove commercial license compatibility. No signed license/provenance ledger was supplied.
Safe reproduction: Inventory assets and dependency licenses without changing dependencies.
Impact: Restriction, takedown, cost, or contractual exposure.
Root cause: Legal/commercial source documents were outside the repository audit.
Recommendation: Obtain a reviewed asset/provider license ledger and separate legal review.
Fix status: Open documentation task.
Retest evidence: No new licensing evidence.
Residual risk: Commercial/legal exposure.
Confidence: 95%

### LR-009 — News scope

ID: `LR-009`
Category: Product scope / dead surface
Severity: Low
Status: `Plausible Risk`
Title: News remains a separate signed-in surface after row-action removal
Affected users: Users who interpret removal as global News deletion
Affected route/API/file: `src/components/shared/NewsModal.jsx`; `server/routes/news.js`
Evidence: Scanner and MA result rows no longer expose News/Ask Capi actions; the separate News route/modal remains.
Safe reproduction: Inspect result-row DOM and any separately documented News entry point with an approved test account.
Impact: Copy, entitlement tables, and product scope can disagree.
Root cause: The implemented request removed row actions, not the entire News product surface.
Recommendation: Document the scope or remove the separate surface consistently after an explicit product decision.
Fix status: Row-action removal complete; scope decision pending.
Retest evidence: Existing scanner-row tests plus deployed route smoke.
Residual risk: Product-scope inconsistency.
Confidence: 96%

## 5. Current score and readiness decision

The score below is conservative and evidence-based. Local code/test improvements increased the score from the 72/100 baseline, but the owner-defined launch gates still make the app **NOT READY** because High findings LR-001, LR-002, and LR-003 remain `Unknown`.

| Category | Weight | Current score | Basis |
|---|---:|---:|---|
| Functional/Product correctness | 14 | 12 | Core routes, result completeness, stale handling, Radar semantics, and local contract tests pass; authenticated production workflows remain unknown |
| Financial data correctness | 12 | 9 | Explicit stale/unavailable handling and tests pass; live provider reconciliation remains incomplete |
| Security, authentication, authorization, privacy exposure | 15 | 11 | Strong middleware, ownership, session, headers, and local tests; deployed identity matrix remains unknown |
| Backend, APIs and database | 10 | 8 | API, validation, transactions, backup safety, and tests pass; production restore/query evidence remains incomplete |
| Business logic, abuse and cost control | 6 | 5 | Radar cardinality, quota, idempotency, and duplicate controls pass locally; production replay/cost telemetry remains unknown |
| Frontend, UI and UX | 10 | 8 | Build/lint and requested result-surface changes pass; authenticated visual audit is incomplete |
| Mobile, accessibility, Hebrew, RTL and localization | 9 | 5 | Root RTL and guest overflow/Capi removal pass; authenticated result/a11y matrix remains unknown |
| Performance, scalability and reliability | 8 | 5 | Build/lazy chunks and defensive timeouts pass; production SLO metrics remain unknown |
| Infrastructure, deployment, backups and disaster recovery | 6 | 4 | CI/deploy/health/SHA and public headers pass; restore/failover/rollback remain unknown |
| AI grounding and safety | 4 | 3 | Local auth, prompt-boundary, fallback, and stream tests pass; adversarial production behavior remains unknown |
| QA, tests and release engineering | 3 | 3 | 409 backend, 156 frontend, 8 Worker, 1 cluster, lint, format, and build pass on the checked HEAD |
| SEO, dependencies, licensing and compliance risk | 3 | 2 | Dependency vulnerability and public SEO smoke pass; full licensing/editorial/legal review remains unknown |
| **TOTAL** | **100** | **75** | Conservative current retest score |

### Verdict

- **Launch status:** `NOT READY` for an unconditional technical launch recommendation.
- **Final score:** `75/100`.
- **Confidence:** `88/100` for repository, local test, CI, deploy, public HTTP, headers, and guest-mobile evidence; materially lower for authenticated production, wallet payment, production restore, and live provider reconciliation.
- **Critical findings:** None verified in this retest.
- **High findings:** LR-001, LR-002, LR-003 remain open `Unknown`; under the supplied rules this blocks readiness.

## 6. Top ten remaining remediation items

| Order | Item | Effort | Impact | Risk | Dependency |
|---:|---|---|---|---|---|
| 1 | Controlled Google Pay/Apple Pay provider-approved test with final amount, webhook, idempotency, and tier evidence | Medium | High | Medium | Supported device/card and provider test product |
| 2 | Isolated production-backup restore drill with integrity, RPO, and RTO record | Medium | Critical | Low | Backup-store access and isolated database |
| 3 | Authenticated tier/ownership/direct-API matrix for all user roles | High | Critical | Medium | Dedicated staging or explicitly approved accounts |
| 4 | Authenticated mobile screenshots/overflow checks for scanners, Radar, pricing, profile, notifications, and checkout | Medium | High | Low | Seeded test results and device matrix |
| 5 | Provider contract/reconciliation fixtures for price, volume, RVOL, cap, fundamentals, sessions, units, and corporate actions | High | High | Medium | Stable fixtures/provider samples |
| 6 | RUM and API/provider/database percentile instrumentation with Capi/scan timeout/cost SLOs | Medium | High | Low | Observability destination and SLO definitions |
| 7 | Clean release checkout/allowlist and quarantine of exploratory workspace artifacts | Low/Medium | Medium | Low | Owner cleanup decision |
| 8 | Status/backup/failover game day and operator runbook | Medium | High | Low | Isolated failure controls and owner |
| 9 | WCAG 2.2 AA keyboard, screen-reader, zoom, contrast, touch-target, and Hebrew BiDi suite | High | High | Low | Browser/device test matrix |
| 10 | Asset/font/logo/provider license ledger and separate commercial/legal review | Medium | Medium | Low | Source documents and reviewer |

Recommended order is the order above; items 1–3 are launch gates, 4–6 are release-confidence gates, and 7–10 are operational/product-quality gates.

## 7. Remaining unknowns and non-verifiable areas

1. Real Google Pay/Apple Pay authorization, provider completion, webhook, and final entitlement.
2. Final Whop charged amount after a real provider promo code, with no real transaction performed here.
3. Production backup restore, encryption, off-site copy, RPO, and RTO.
4. Authenticated production tier, direct API, ownership, multi-tab, session-expiry, and admin matrix.
5. Authenticated mobile result surfaces and complete data at all requested widths.
6. Full live financial reconciliation across providers, sessions, holidays, DST, corporate actions, currencies, units, and delayed data.
7. Production Web Vitals, TTFB, API/database/provider p95/p99 latency, memory, cold start, and concurrency.
8. Full WCAG 2.2 AA keyboard/screen-reader/zoom/contrast/touch/reduced-motion matrix.
9. Full Hebrew editorial and mixed BiDi review across every screen.
10. Cloudflare/DNS/TLS/certificate failover and production resource-limit behavior.
11. Production rollback, migration rehearsal, and zero-downtime proof.
12. Status alert delivery, failed cron/dead-letter, overlap, and outage game day.
13. Asset/font/logo/data-provider licensing and commercial-use review.
14. Real customer email deliverability, bounce, and complaint handling; intentionally not sent.
15. Legal/regulatory/privacy/financial-advice/commercial approval; no legal opinion was provided.

## 8. Production-only and silent-failure risks still requiring monitoring

### Production-only risks

- Wallet eligibility, merchant-domain registration, provider checkout configuration, and webhook timing.
- Production secret/provider quota behavior, DNS/TLS/Cloudflare caching, and Render capacity.
- Real database volume, concurrent Radar creation, job overlap, webhook replay, and large result payloads.
- Authenticated mobile layouts with real names, sectors, missing values, and result counts.

### Silent-failure risks

- A stale/partial scan completing without a visible customer-level warning in an untested surface.
- Background SSE disconnecting without a visible state transition.
- Provider payment succeeding while entitlement or promo ledger persistence is delayed.
- Push permission/token failure while the UI appears enabled.
- A backup artifact being produced but not restorable.
- Capi timeout/fallback being interpreted as current financial analysis.
- A malformed provider row being filtered out rather than surfaced as unavailable.

### Unnecessary-cost risks

- Full-market scan/provider/database work without production percentile telemetry.
- Capi retries/reconnects and duplicate submissions.
- Repeated chart/fundamentals/watchlist provider requests outside cache coverage.
- Webhook retries and scheduled-job overlap.
- Large static assets, especially the approximately 8.05 MB tracked `public/logo-text.png`.

### Incorrect-financial-data risks

- Provider/session/timestamp mismatch in quote, volume, RVOL, chart, and Radar paths.
- Unsupported or missing forward P/E/PEG compatibility.
- Corporate actions, splits, exchange mapping, delayed data, and unit/currency conversion.
- Cache values used without the affected stale/unavailable state in an untested caller.

### AI grounding risks

- Capi current-price/news/fundamental claims when provider data is missing or stale.
- Prompt injection through user or retrieved-news content.
- Confident trading language despite informational disclaimers.
- Cross-user history/account context if an authorization boundary fails.

## 9. Release recommendation

The checked application runtime `7d713ff` is successfully deployed and passes the current local, CI, public health, route, header, and browser smoke checks recorded above. The release is **not** eligible for an unconditional launch recommendation under the supplied launch policy because three High evidence gates remain Unknown: wallet completion/promo final amount, production backup restore, and authenticated entitlement/ownership verification. The next safe action is to execute the three controlled environment checks in the recommended order, then rerun this report and recalculate the score. A score of 100 must not be assigned until those evidence gaps and the remaining core unknowns are actually closed.

Commercial/legal/payment/email review remains separate and is not approved by this technical retest.

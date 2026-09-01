# Capital Flow — Launch Readiness Remediation Retest

## 1. Scope and evidence record

This addendum supersedes stale baseline measurements in `LAUNCH_READINESS_REPORT.md` and records the work performed after the initial audit.

| Item | Evidence |
|---|---|
| Checked commit | `346d6789f52ba30c98aa8e3273ee8678ec79c285` — `Harden OAuth, alert persistence, and provider timeouts` |
| Branch | `main` |
| Repository | `https://github.com/liorse2006-beep/CAPITAL-FLOW.git` |
| Audit/retest time | `2026-09-01 16:40:58 +03:00`, Asia/Jerusalem |
| Local environment | Windows PowerShell; Node `v24.15.0`; npm `11.12.1`; Python and Docker unavailable |
| Production URL | `https://capitalflow.vip/` |
| Health URL | `https://capitalflow.vip/health` |
| Status URL | `https://status.capitalflow.vip/status` |
| CI run | `33514056515` — success for the checked SHA |
| Deploy run | `33514056510` — test and deploy jobs success for the checked SHA |
| Production health verification | `GET https://capitalflow.vip/health?deploy=346d6789` → `200`, `status=ok`, `releaseCommit=346d6789f52ba30c98aa8e3273ee8678ec79c285`, `timestamp=2026-09-01T13:41:19.251Z` |
| Working tree | No modified tracked implementation files before this documentation update; unrelated pre-existing untracked workspace artifacts remain un-staged |

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

## 3. Post-remediation checks actually run

| Check | Result | Evidence |
|---|---|---|
| Backend suite | `VERIFIED PASS` | `npm run test`: 401/401 tests passed |
| Frontend suite | `VERIFIED PASS` | `npm run test:frontend`: 147/147 tests passed; 20 files |
| Cloudflare Worker suite | `VERIFIED PASS` | 8/8 tests passed |
| Cluster integration | `VERIFIED PASS` | 1/1 broadcast test passed |
| Lint | `VERIFIED PASS` | `npm run lint` exit 0 with no output/warnings |
| Build | `VERIFIED PASS` | `npm run build`; Vite transformed 1,661 modules |
| Scoped formatting | `VERIFIED PASS` | Prettier check passed on changed implementation and test files |
| Diff whitespace | `VERIFIED PASS` | `git diff --check` passed before commit |
| Production dependency audit | `VERIFIED PASS` | `npm audit --omit=dev --audit-level=high` returned 0 vulnerabilities |
| Targeted auth/alert/provider tests | `VERIFIED PASS` | 24/24 tests passed: news service/routes, watchlist alert fail-closed behavior, and Google OAuth state contract |
| GitHub CI | `VERIFIED PASS` | Run `33514056515`, SHA `346d6789...`, conclusion `success` |
| GitHub Deploy | `VERIFIED PASS` | Run `33514056510`; `test` and `deploy` jobs both `success` |
| Production health | `VERIFIED PASS` | `GET /health?deploy=346d6789` → 200; body releaseCommit exactly `346d6789f52ba30c98aa8e3273ee8678ec79c285` |
| Production asset deployment | `VERIFIED PASS` | HTML `200`; `assets/index-D78Wuowv.js` and `assets/index-B85OEQX-.css` references returned |
| Public route smoke | `VERIFIED PASS` | `/`, `/scanner`, `/ma`, `/flow`, `/fundamentals`, `/watchlist`, `/policy`, `/accessibility`, `/robots.txt`, `/sitemap.xml`, and status URL all returned 200 |
| Production security headers | `VERIFIED PASS` | Current root and health responses included CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and X-Frame-Options |
| Safe coupon endpoint probe | `VERIFIED PASS` | Arbitrary sample POST returned 410 `provider_checkout_required`; no local discount was returned |
| Guest mobile overflow | `VERIFIED PASS` | Headless Puppeteer at 320/360/390/430/768: document/body width equaled viewport; no horizontal overflow; `.chat-widget` not visible |
| Real payment/wallet | `UNKNOWN` by policy | No transaction or authorization was performed |
| Production backup restore | `UNKNOWN` | No approved isolated recovery database was available |
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
Retest evidence: 401 backend tests passed; no production identity test.
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
Retest evidence: 401 backend tests and stale fallback/Radar tests pass; live reconciliation not performed.
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
Evidence: Public status and health returned 200, and local status monitor/backup/email-policy tests pass; no production failover or alert-delivery drill was executed.
Safe reproduction: Exercise an isolated status/staging failure and verify incident, recovery, sanitization, and operator notification.
Impact: An outage may remain silent or recovery may exceed expectations.
Root cause: Failure drills require an approved operational window and external monitoring access.
Recommendation: Run quarterly non-destructive game days and document owner/runbook/RTO evidence.
Fix status: Code/test evidence complete; operational verification pending.
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
| QA, tests and release engineering | 3 | 3 | 401 backend, 147 frontend, 8 Worker, cluster, lint, and build pass |
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

The current `346d6789` release is successfully deployed and passes all local/CI/public smoke checks performed here. It is **not** eligible for an unconditional launch recommendation under the supplied launch policy because three High evidence gates remain Unknown. The next safe action is to execute the three controlled environment checks in the recommended order, then rerun this report and recalculate the score. A score of 100 must not be assigned until those evidence gaps and the remaining core unknowns are actually closed.

Commercial/legal/payment/email review remains separate and is not approved by this technical retest.

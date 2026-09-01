# Capital Flow — Launch Readiness Audit

> This document records the baseline audit. The authoritative post-remediation
> retest for commit `37885eb668b6183b85c3b9b71d3b7ffe97b61152` is in
> [REMEDIATION_RETEST.md](./REMEDIATION_RETEST.md). Where the two documents
> differ, the retest is current.

## 1. Executive summary

**Audit mode:** `AUDIT_AND_FIX` for changes within the repository and deployment workflow that were explicitly authorized by the owner.

**Audit date:** 2026-09-01, 14:37:31 +03:00 (Asia/Jerusalem)

**Implementation commit evaluated:** `eae5db0c413e108b8c0e12284a537adb0ef1a9f3` — `Harden scan results and provider-authoritative checkout`

**Branch:** `main`

**Repository:** `https://github.com/liorse2006-beep/CAPITAL-FLOW.git`

**Public surfaces checked:** [https://capitalflow.vip/](https://capitalflow.vip/), [https://status.capitalflow.vip/status](https://status.capitalflow.vip/status)

**Local environment:** Windows PowerShell; Node `v24.15.0`; npm `11.12.1`; Python executable unavailable; Docker executable unavailable.

**Overall verdict:** `NOT READY` for an unconditional launch recommendation.

**Technical score:** **72/100**.

**Confidence:** **84/100** for repository, build, test, route, and public HTTP evidence; materially lower for authenticated production behavior, real wallet payment completion, production backup restore, and live financial-data reconciliation.

The repository has a successful CI/deploy path and the latest implementation is live at the exact verified release SHA. The requested result-surface corrections are implemented and tested: full result arrays are preserved, result-row News and Ask Capi actions are removed, Capi is hidden on mobile, malformed numerical values render as unavailable rather than `NaN`, and checkout no longer displays a locally invented discount amount. Google Pay wiring is structurally present, but a real Google Pay authorization and completion on a supported device/card were deliberately not performed. The same applies to Apple Pay.

The application remains `NOT READY` because the launch gates require evidence that is not available from this safe environment: authenticated production walkthroughs for every tier, direct-API entitlement checks against production data, real-device wallet completion, production backup restore, authenticated mobile result rendering, and complete live financial-provider reconciliation. No such item is being marked PASS merely because the code appears plausible.

## 2. Safety and evidence rules applied

- No production payment, refund, checkout completion, email delivery, brute force, destructive migration, load test, DDoS, or real user-data mutation was performed.
- No secret, API key, password, cookie, token, personal data, plan ID, promo code, or webhook credential is included in this report.
- Environment inspection was limited to presence/shape/length checks for secrets; values were redacted and never printed.
- Public HTTP checks were read-only except for one safe POST to the deprecated coupon validation endpoint using an arbitrary sample code. It returned the intended fail-closed response and did not create or mutate data.
- Findings use the following states: `Verified Pass`, `Verified Fail`, `Plausible Risk`, `Unknown`, and `Not Applicable`.
- `Unknown` is not counted as a pass.

## 3. Baseline and repository inventory

| Area | Result | Evidence |
|---|---|---|
| Branch | Verified Pass | `git branch --show-current` → `main` |
| HEAD | Verified Pass | `git rev-parse HEAD` → `eae5db0c413e108b8c0e12284a537adb0ef1a9f3` |
| Remote | Verified Pass | `origin` points to the GitHub repository listed above; no credentials were printed |
| Tracked working tree | Verified Pass | `git status --porcelain --untracked-files=no` returned no tracked modifications |
| Untracked working tree | Verified Fail / release hygiene risk | Numerous preview images, videos, Chrome profiles, audit artifacts, and exploratory components remain untracked; they were not staged or deleted |
| Tracked file inventory | Verified Pass | `git ls-files` counted 335 tracked files |
| Non-ignored working inventory | Informational | `rg --files` excluding `node_modules`, `.git`, profiles, cache, and `dist` counted 1,089 files; this includes audit and preview material |
| Build | Verified Pass | `npm run build`; Vite completed, 1,661 modules transformed |
| Build output | Plausible Risk | Main JS `480.27 kB` / gzip `139.10 kB`; main CSS `243.80 kB` / gzip `42.37 kB`; further budget work is recommended |
| Lint | Verified Fail | `npm run lint` exits 0 but reports 36 warnings, including hook dependency, state-in-effect, unused-effect, and exploratory component warnings |
| Formatting | Verified Pass (scoped) | Prettier check passed for changed implementation files; full repository `format:check` was not accepted as a clean release gate because the working tree contains untracked generated/media artifacts |
| Dependency audit | Verified Pass | `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities |
| Lockfile | Verified Pass | `package-lock.json` is tracked and used by npm |
| Environment files | Verified Pass / Unknown values | `.env` exists locally and `.env.example` documents variable names; values were not exposed; production parity was not fully verified |
| Python/Docker | Unknown for deployment parity | Python and Docker executables were unavailable in the audit environment |
| Destructive commands | Verified Pass | No `git reset --hard`, destructive checkout, recursive deletion, destructive migration, or production mutation was used |

### Large, generated, duplicate, or suspicious files

- `public/logo-text.png` is approximately 8.05 MB and is the largest tracked file. This is a material initial-download and repository-size risk for a public web application.
- `public/capital-flow-guest-preview.png`, logos, icons, landing effects, and `src/styles/index.css` are large but not automatically dead. They require asset ownership and licensing review before launch.
- The working tree includes many untracked `capture-*.js`, preview images/videos, Chrome profiles, `.npm-cache`, audit exports, and exploratory visual components. They were preserved because they belong to the existing workspace; they must be excluded from release artifacts or removed by the owner in a separate cleanup task.
- Search found `TODO`/`FIXME`/`HACK`-style review candidates, console logging, and narrowly scoped eslint suppressions. Runtime logs use redacted summaries in sensitive paths, but the warnings and exploratory components should be cleaned or explicitly accepted.
- No file was classified as dead solely from a filename. Dynamic imports, route usage, tests, and build usage were considered where applicable.

## 4. Product and surface map

### Frontend routes and surfaces

| Route/surface | Access intent | UI entry | Server authorization | Loading/empty/error | Mobile | Test/evidence |
|---|---|---:|---:|---:|---:|---|
| `/` | Public landing / redirect behavior | Yes | N/A | Partial static evidence | Guest viewport tested | `src/App.jsx:71,1263`; `index.html:2,42` |
| `/scanner` | Guest preview; signed-in scan; trial/Premium/Elite according to scan quota | Yes | Yes | Yes | Guest overflow tested; authenticated results unknown | `src/App.jsx:1472-1533`; `server/routes/scan.js:91` |
| `/ma` | Guest preview; signed-in MA scan | Yes | Yes | Yes | Guest overflow tested; authenticated results unknown | `src/App.jsx:1397-1413`; `server/routes/maScanner.js` |
| `/flow` | Guest preview; signed-in hot sectors / capital flow | Yes | Yes | Yes | Authenticated mobile unknown | `src/App.jsx:1415-1430`; `src/components/MoneyFlow/MoneyFlow.jsx` |
| `/fundamentals` | Premium or active trial | Yes | Yes | Yes | Manual authenticated mobile unknown | `src/App.jsx:1431-1442`; `server/routes/fundamentals.js:21` |
| `/watchlist` | Signed-in account data | Yes | Yes | Yes | Manual authenticated mobile unknown | `src/App.jsx:1444-1470`; `server/routes/watchlist.js` |
| Capital Flow Radar | Trial/Elite; not Premium | Embedded in scanner | Yes | Yes | Setup and results mobile authenticated unknown | `src/components/Scanner/CapitalFlowRadar.jsx:303`; `server/routes/radar.js:43-112` |
| `/policy` | Public policy page | Yes | N/A | Static | Unknown at all required widths | `src/App.jsx:1538-1545` |
| `/accessibility` | Public accessibility statement | Yes | N/A | Static | Unknown at all required widths | `src/App.jsx:1547-1553` |
| Unknown route | Redirects to `/scanner` | Direct URL | N/A | N/A | Unknown | `src/App.jsx:1555` |

### Modals, drawers, forms, tables, charts, and interactive surfaces

| Surface | Access | Direct/server gate | Evidence |
|---|---|---|---|
| Auth modal: signup/login/OTP/reset/Google | Anonymous | Auth routes and rate limits | `src/components/Auth/AuthModal.jsx:120-369`; `server/routes/auth.js:266-512` |
| Google OAuth callback | Anonymous → signed in | Passport callback and session issuance | `server/routes/auth.js:229-261` |
| Upgrade modal / pricing matrix | Signed-in or trial-ended | Checkout requires auth and provider plan configuration | `src/components/shared/UpgradeModal.jsx`; `server/routes/checkout.js:39-119` |
| Trial-ended modal | Free account after trial | Server tier checks | `src/components/shared/TrialEndedModal.jsx`; `src/App.jsx:446-459` |
| Welcome tier modal | Post-checkout UI | Provider-confirmed account state | `src/components/shared/WelcomeTierModal.jsx`; `src/App.jsx:1329-1336` |
| Account/profile drawer and Account Center | Signed-in | Account routes require auth | `src/components/shared/ProfileModal.jsx`; `server/routes/account.js:35-228` |
| Scan scheduling | Trial/Elite for mutation; signed-in read | `requireEliteOrTrial` for create/edit/delete | `src/components/shared/ScheduleScan.jsx`; `server/routes/scheduledScans.js:43-173` |
| Notification permission and bell panel | Signed-in / entitlement | Push routes use `requireEliteOrTrial` | `src/components/shared/AlertBell.jsx`; `server/routes/push.js:17-59` |
| Scanner results | Signed-in | Scan quota and server route | `src/components/Scanner/ScannerPage.jsx:688-1200`; `server/routes/scan.js` |
| MA results | Signed-in | MA route and server gate | `src/components/MAScanner/MAScannerPage.jsx:642-817`; `server/routes/maScanner.js` |
| Scheduled result modal | Signed-in notification owner | Notification ownership query | `src/components/shared/ScheduledScanResultsModal.jsx:31-135`; `server/routes/notifications.js:21-82` |
| Chart modal | Premium/trial as configured | Chart route gate | `src/components/Chart/ChartModal.jsx:195`; `server/routes/chart.js:47` |
| Fundamentals table | Premium/active trial | `requirePremiumOrTrial` | `src/components/Fundamentals/FundamentalsPage.jsx:229-345`; `server/routes/fundamentals.js:21` |
| Watchlist and alert controls | Signed-in; advanced alert features gated | Ownership and entitlement checks | `src/components/Watchlist/WatchlistPage.jsx`; `server/routes/watchlist.js`, `server/routes/watchlistAlerts.js` |
| News modal | Signed-in route remains | Not imported by scanner rows after the requested removal | `src/components/shared/NewsModal.jsx`; `server/routes/news.js:14-55` |
| Capi chat | Desktop signed-in trial/Elite; hidden on mobile | `requireEliteOrTrial` | `src/components/shared/ChatWidget.jsx:357-460`; `server/routes/chat.js:67-179` |
| Sector picker / filters | Scanner UI | Scanner route gate | `src/components/Scanner/ScannerPage.jsx`; `src/components/Scanner/CapitalFlowRadar.jsx` |
| Status page | Public; admin operations separately gated | Status public routes and admin middleware | `server/routes/status.js:565-835`; `status-service.js:74-94` |
| Admin panel | Admin only | Admin token/session checks | `server/routes/admin.js:76-1182` |

## 5. User workflows

### New user

| Workflow | Result | Evidence / limitation |
|---|---|---|
| Understand first action | Plausible Pass | Landing and scanner navigation are present; no usability study was run |
| Signup/login feedback | Verified Pass at component/test level | `AuthModal` tests and auth route validation/rate-limit code; no fresh live account created |
| Google login | Unknown end-to-end | Code path exists; OAuth provider callback and avatar mapping are present; production account creation was not performed |
| Password reset | Verified Pass at code/test level; production delivery unknown | `server/routes/auth.js:417-477`; real email was not sent |
| Session expiry/refresh/logout | Verified Pass at code/test level; live multi-device behavior unknown | `server/routes/auth.js:479-554`; auth session tests pass |
| Scanner first run | Unknown for authenticated production | Local route/component tests pass; no production test account was used |
| Upgrade and coupon | Partially Verified | Checkout is provider-authoritative; end-to-end Whop amount change was not transacted |
| Radar creation | Verified at code/test level; production tier matrix unknown | `server/services/radar.js:33,479`; `server/routes/radar.js:43-112`; tests cover one active Radar and schedule constraints |

### Power user review

- Result rows now retain all returned results rather than rendering only the first 50 in the affected surfaces. Evidence: `src/components/Scanner/ScannerPage.jsx:904,1035`, `src/components/MAScanner/MAScannerPage.jsx:700,809`, `server/services/backgroundScan.js:220`, `server/services/notifications.js`, and `src/components/shared/ScheduledScanResultsModal.jsx:56-69`.
- News and Ask Capi actions were removed from the scanner result rows. Evidence: `src/components/Scanner/ScannerPage.test.jsx:200-226` and the absence of `NewsModal` import in `ScannerPage.jsx`; Capi remains a separate desktop product surface, not a result-row action.
- Mobile result cards have dedicated identity/action wrappers and no horizontal overflow rules. Evidence: `ScannerPage.jsx:1042-1091`, `MAScannerPage.jsx:714-734`, and `src/styles/index.css:12346-12545,13264-13345`.
- Double submission, duplicate schedules, Radar cardinality, and concurrent creation are covered in local tests, but authenticated production multi-tab confirmation remains `UNKNOWN`.
- Sorting, filters, source timestamps, provider status, and result state are implemented in code, but a full user study and authenticated desktop/mobile visual walkthrough remain `UNKNOWN`.

## 6. Requested result and checkout remediation

### Result completeness and stuck rendering

**Implemented and locally verified:**

1. Removed the old result slicing in Capital Flow and MA Scanner render paths.
2. Background SSE carries the complete result set and `resultCount`.
3. Scheduled notification storage no longer truncates results to 50.
4. Scheduled-result modal maps every stored result.
5. Provider values that are missing/non-numeric render as `—`, not `NaN`, and cannot crash the scan notification path.
6. Default-idle scanner hydration accepts a complete background result set without overwriting a user’s custom filters or in-progress scan.

**Evidence:** `server/services/backgroundScan.js:220`; `server/services/notifications.js`; `server/services/scanner.js`; `server/services/scheduledScanRunner.js:159-228`; `src/App.jsx:1173`; `src/components/Scanner/ScannerPage.jsx:904,1035`; `src/components/MAScanner/MAScannerPage.jsx:700,809`; `src/components/shared/ScheduledScanResultsModal.jsx:56-101`; `src/utils/format.js:69`.

**Regression evidence:** local `npm run test:all` passed 389 backend tests, 145 frontend tests, 8 Worker tests, and the cluster integration test. The 145 local frontend count includes the new untracked scheduled-results regression test; it was not part of the `eae5db0` CI checkout until explicitly committed as part of the audit artifact follow-up.

### News and Capi removal from result rows

- Scanner result rows expose chart, watchlist, and alert controls only.
- `NewsModal` and `/api/news/:symbol` remain available as separate signed-in surfaces; this is intentionally not described as a global News deletion.
- Capi remains a separate desktop widget and server feature; it is hidden on mobile and is not exposed from scanner result rows.
- Evidence: `src/components/Scanner/ScannerPage.jsx:985-1033,1079-1137`; `src/components/MAScanner/MAScannerPage.jsx:202-232,724-734`; `src/App.jsx:1316-1324`; `src/styles/index.css:12539-12544`; `src/components/Scanner/ScannerPage.test.jsx:200-226`.

### Coupon and provider-authoritative price

- The old local coupon validation endpoint returns HTTP 410 with `provider_checkout_required` and no `discountPercent`.
- Checkout validates only the input shape locally, passes a normalized code to Whop metadata/checkout, and does not claim a local final discount.
- The webhook records local usage only after the provider confirms the promo code in the successful payment event.
- Premium upgrade copy is fail-closed when the Elite upgrade plan is absent from configuration.
- Evidence: `server/routes/coupons.js:10-18`; `server/routes/checkout.js:39-119`; `server/routes/webhooks.js:162-214`; `server/routes/auth.js:111`; `src/components/shared/UpgradeModal.jsx`; `src/components/shared/WelcomeTierModal.jsx`.
- Production read-only evidence: `POST https://capitalflow.vip/api/coupons/validate` returned HTTP 410 JSON with `code: provider_checkout_required`; no discount amount was exposed.
- Provider documentation supports embedded checkout with a provider session, responsive iframe, promo-code input/callbacks, and `data.promo_code` in payment events: [Whop embedded checkout](https://docs.whop.com/manage-your-business/payment-processing/embed-checkout), [Whop promo codes](https://docs.whop.com/manage-your-business/growth-marketing/promo-codes), [Whop payment succeeded](https://docs.whop.com/api-reference/payments/payment-succeeded).

### Google Pay

- Structural wiring is present through `WhopExpressCheckoutButton` with `google-pay`, `apple-pay`, and `whop-pay`, and the production CSP allows the required payment origins.
- Production wallet readiness script passed structural checks: Apple association file returned 200 and was non-empty, production origin returned 200, Google Pay CSP/origin checks passed, and scanner route returned 200.
- A real Google Pay button appearance, authorization, success callback, webhook, and final entitlement update were not tested because that would require a supported browser/device/card and a controlled payment transaction. Status remains `UNKNOWN` / High.
- Evidence: `src/components/shared/EmbeddedCheckout.jsx:1-60`; `src/components/shared/UpgradeModal.jsx`; `scripts/verify-wallet-readiness.mjs`; production probe output recorded in the audit working log.

## 7. Findings

### LR-001

ID: `LR-001`  
Category: Payments / Google Pay  
Severity: High  
Status: Unknown  
Title: Google Pay end-to-end completion is not verified  
Affected users: Users attempting Google Pay on a supported device/browser/card  
Affected route/API/file: Checkout modal; `src/components/shared/EmbeddedCheckout.jsx:1-60`; Whop checkout configuration  
Evidence: Express checkout is configured with `methods={['apple-pay', 'google-pay', 'whop-pay']}`; production CSP includes `https://pay.google.com`; wallet readiness script passed structural checks. No successful Google Pay payment, `onComplete`, Whop webhook, or tier transition was observed.  
Safe reproduction: Open checkout on a supported Android/Chrome/device-card combination using a sandbox or low-risk test product and verify button resolution, payment success, webhook receipt, and entitlement transition. Do not use an uncontrolled production charge.  
Impact: A customer may see a wallet option that fails at authorization or may complete payment without a verified entitlement if the provider/webhook configuration is wrong.  
Root cause: Device/card/provider eligibility and payment completion are external state and cannot be proven by static code or CSP inspection.  
Recommendation: Perform a controlled provider-approved wallet transaction and capture redacted checkout, callback, webhook, and account-tier evidence.  
Fix status: Structural implementation complete; manual verification pending.  
Retest evidence: Structural wallet probe passed; manual retest not performed.  
Residual risk: Google Pay may remain unavailable or misconfigured in one or more target environments.  
Confidence: 98%

### LR-002

ID: `LR-002`  
Category: Backups / Disaster recovery  
Severity: High  
Status: Unknown  
Title: Production backup restore has not been proven  
Affected users: All users if the primary database or host is lost/corrupted  
Affected route/API/file: `server/services/dbBackup.js:23-137`; status backup services; deployment environment  
Evidence: Backup tables, scheduler, and status/health monitoring code exist; local code/tests were inspected. No production restore was performed and no independent restored-database acceptance test was available.  
Safe reproduction: Restore an encrypted backup into an isolated non-production database, run schema/integrity checks and representative read-only queries, then record RPO/RTO.  
Impact: Data-loss recovery time and completeness are unproven.  
Root cause: Restore validation requires access to the production backup store and an isolated recovery environment.  
Recommendation: Establish a documented, repeatable restore drill and record the last successful date, RPO, RTO, backup location, encryption, and owner.  
Fix status: Not fixed; operational verification required.  
Retest evidence: None available.  
Residual risk: Silent backup corruption, missing tables, unusable credentials, or excessive recovery time may remain.  
Confidence: 99%

### LR-003

ID: `LR-003`  
Category: Authentication / authorization / entitlements  
Severity: High  
Status: Unknown  
Title: Authenticated production tier and ownership matrix is not fully verified  
Affected users: Trial, Premium, Elite, expired-trial, admin, and unauthorized users  
Affected route/API/file: All gated APIs, especially `server/middleware/authMiddleware.js:234-349`, `server/routes/radar.js`, `scheduledScans.js`, `chat.js`, `push.js`, `chart.js`, and `fundamentals.js`  
Evidence: Server-side middleware and local tests cover trial/Elite semantics, one active Radar, and session behavior. No controlled production accounts for every tier were used to test direct API calls, ID manipulation, expired sessions, concurrent tabs, or cross-user ownership.  
Safe reproduction: Use dedicated non-production or explicitly approved test accounts for anonymous, trial-active, trial-expired, Premium, Elite, admin, and unauthorized cases; verify UI and direct API responses without mutating another user’s data.  
Impact: A deployment-only authorization gap could expose paid features or another user’s data, or deny a valid customer access.  
Root cause: Production identity/database state is not available for this audit.  
Recommendation: Add an automated entitlement contract suite against staging and a redacted production smoke account matrix.  
Fix status: Code hardening and local tests complete; production verification pending.  
Retest evidence: Local `requireElite`/`requireEliteOrTrial` and session tests passed; no production retest.  
Residual risk: Direct API access, role tampering, ownership tampering, and expired-trial edge cases remain unproven in production.  
Confidence: 96%

### LR-004

ID: `LR-004`  
Category: Financial data correctness  
Severity: Medium  
Status: Plausible Risk  
Title: Live provider reconciliation and mixed timestamp semantics are incomplete  
Affected users: Users relying on current price, volume, RVOL, market cap, fundamentals, chart, scan, or Radar values  
Affected route/API/file: `server/services/finnhub.js`, `server/services/yahoo.js`, `server/services/quoteCache.js`, `server/services/scanner.js`, `server/services/fundamentalsScanner.js`, MA and Radar services  
Evidence: Missing/non-finite values are guarded and data-as-of fields are carried in scanner paths; no comprehensive live cross-provider comparison, exchange mapping, holiday/session test, corporate-action test, or stale-data acceptance report was available.  
Safe reproduction: Compare a bounded, read-only sample across providers with timestamp, session, currency, unit, and symbol mapping recorded; do not treat delayed data as live.  
Impact: A stale, mixed, falsely precise, or mismatched value could change a scan result or mislead a customer.  
Root cause: Provider data and credentials are external, time-sensitive, and not all market states were available during the audit.  
Recommendation: Add provider contract fixtures and a reconciliation monitor with explicit stale/unavailable state and no-result behavior.  
Fix status: Defensive formatting and unavailable behavior improved; full reconciliation pending.  
Retest evidence: Local malformed-value tests passed; production cross-provider retest not completed.  
Residual risk: Provider drift, quota behavior, corporate actions, and session boundaries can still cause divergence.  
Confidence: 88%

### LR-005

ID: `LR-005`  
Category: Performance / scalability  
Severity: Medium  
Status: Plausible Risk  
Title: Production Web Vitals and full-market scan latency are not measured  
Affected users: All users, especially mobile and large-universe scanner users  
Affected route/API/file: Main bundle; scanner endpoints; Capi routes; provider calls; background jobs  
Evidence: Build output has a large main JS/CSS payload; lazy chunks exist. No production TTFB/LCP/INP/CLS sample, network waterfall, memory profile, or full-market latency percentile was captured. Production load testing was intentionally not performed.  
Safe reproduction: Capture browser performance for approved guest/auth test flows and run bounded staging load using `scripts/load-test-500.mjs`; never run uncontrolled load on production.  
Impact: Slow first load or long scans can cause abandonment, duplicate submissions, timeout retries, and provider cost.  
Root cause: Performance instrumentation and staging capacity evidence are incomplete.  
Recommendation: Set SLOs, collect RUM/Web Vitals, measure scanner/provider/database percentiles, and add cancellation/idempotency telemetry.  
Fix status: Partial code hygiene complete; measurement and budgets pending.  
Retest evidence: Build passed; no production performance budget result.  
Residual risk: Mobile and peak-market behavior may degrade silently.  
Confidence: 92%

### LR-006

ID: `LR-006`  
Category: Frontend quality / release hygiene  
Severity: Medium  
Status: Verified Fail  
Title: Lint passes with 36 warnings and exploratory artifacts remain in the workspace  
Affected users: Indirectly all users; maintainers and future release changes  
Affected route/API/file: Repository-wide; `src/pages/LandingPage.jsx`, `src/components/MoltenMetal.jsx`, `src/components/ScrollTilesBackground.jsx`, and other warning locations reported by ESLint  
Evidence: `npm run lint` exits 0 with 36 warnings. `git status --short` lists many untracked profiles, media, preview scripts, and exploratory components.  
Safe reproduction: Run `npm run lint`; inspect the warning list and release packaging inputs without modifying them.  
Impact: Warning debt can conceal regressions, increase bundle/repository size, and make release review less reliable.  
Root cause: The release gate treats warnings as non-blocking and the workspace contains exploratory material.  
Recommendation: Reduce warning count to zero or document a reviewed exception list; add a clean artifact/package boundary and CI check for unintended files.  
Fix status: Open.  
Retest evidence: Lint exit code 0; warnings remain.  
Residual risk: Nonzero.  
Confidence: 100%

### LR-007

ID: `LR-007`  
Category: Status / operations / disaster recovery  
Severity: Medium  
Status: Unknown  
Title: Status-service failover, alert delivery, and operator runbooks are not fully proven  
Affected users: All users during a platform or dependency outage  
Affected route/API/file: `status-service.js:64-110`; `server/routes/status.js:565-835`; `.github/workflows/keepalive.yml`  
Evidence: Public status returned 200, health endpoints and external keepalive workflow exist, and public status output is sanitized. No failover drill, alert delivery proof, certificate/DNS incident drill, or operator RTO was performed.  
Safe reproduction: Exercise an isolated status/staging failure and confirm the watchdog, incident creation, recovery, and public sanitized state.  
Impact: An outage can remain silent or recovery can exceed the customer expectation.  
Root cause: Operational verification requires production monitoring permissions and an approved failure window.  
Recommendation: Run quarterly non-destructive game days and publish owner/runbook/RTO evidence.  
Fix status: Open verification gap.  
Retest evidence: Public HTTP smoke only.  
Residual risk: Silent operational failure.  
Confidence: 94%

### LR-008

ID: `LR-008`  
Category: Licensing / compliance risk  
Severity: Low  
Status: Unknown  
Title: Asset, font, logo, and third-party data licensing was not fully verified  
Affected users: Business/operations; indirectly all users if assets are removed or restricted  
Affected route/API/file: `public/*`, font assets, logo assets, Parqet logos, Whop, Finnhub, Yahoo, status dependencies  
Evidence: Assets and font files are present and used; no complete license ledger or commercial-use proof was supplied in the repository.  
Safe reproduction: Build an asset/dependency SBOM and attach license/provenance records without changing dependencies.  
Impact: Unlicensed commercial use or provider terms mismatch can create takedown, cost, or legal exposure.  
Root cause: License documentation is incomplete for this audit.  
Recommendation: Obtain and store a reviewed license inventory; have counsel review terms separately.  
Fix status: Open documentation task.  
Retest evidence: `npm audit` passed security vulnerabilities only; it is not a license audit.  
Residual risk: Commercial/legal review still required.  
Confidence: 91%

### LR-009

ID: `LR-009`  
Category: Product scope / dead surface  
Severity: Low  
Status: Plausible Risk  
Title: News remains as a separate signed-in surface after removal from result rows  
Affected users: Users interpreting “remove News” as a global product removal  
Affected route/API/file: `src/components/shared/NewsModal.jsx`; `server/routes/news.js:14-55`; scanner result rows no longer import it  
Evidence: `NewsModal` is still present and `/api/news/:symbol` remains mounted, while `ScannerPage.jsx` no longer imports or renders it from results.  
Safe reproduction: Inspect result-row DOM and separately navigate through any remaining News entry point using a test account.  
Impact: Product wording or entitlement tables may disagree about whether News is removed globally or only from result rows.  
Root cause: The requested change was scoped to result actions; global News deletion was not authorized by the latest implementation request.  
Recommendation: Confirm product scope; either retain and document the separate News surface or remove it consistently from UI, route, tests, and pricing copy.  
Fix status: Result-row removal complete; product-scope decision pending.  
Retest evidence: Scanner row tests confirm no News action.  
Residual risk: Copy/feature-scope inconsistency.  
Confidence: 95%

## 8. Security, authentication, and privacy review

| Check | Status | Evidence / limitation |
|---|---|---|
| Server-side auth middleware | Verified Pass at code/test level | `server/middleware/authMiddleware.js:234-349`; `test/requireElite.test.js` |
| Trial vs Premium vs Elite checks | Verified Pass at code/test level | `requireEliteOrTrial` tests distinguish Premium from active trial and Elite |
| Session creation and cap | Verified Pass at code/test level | `server/services/auth.js:60-108`; `test/authSessions.test.js` |
| Refresh/logout invalidation | Verified Pass at code/test level; live unknown | `server/routes/auth.js:479-554`; no production account test |
| Google OAuth | Plausible Pass / production Unknown | `server/routes/auth.js:229-261`; provider callback not exercised |
| Password storage/reset | Plausible Pass / email delivery Unknown | Config and route inspection; no real email sent |
| HttpOnly/Secure/SameSite cookies | Plausible Pass / production cookie header Unknown | `server/routes/auth.js:77`; live authenticated cookie inspection was intentionally not performed |
| Rate limiting | Verified Pass at code level | `server/middleware/rateLimiters.js:65-207` and route usage |
| CSRF | Plausible Risk | Same-site cookie/API design was inspected; no full browser CSRF test was performed |
| IDOR/ownership | Unknown in production | SQL ownership clauses exist in account/watchlist/notifications/radar paths; cross-user authenticated test unavailable |
| Admin authorization | Unknown in production | `server/routes/admin.js` and admin access service inspected; no admin account test |
| Security headers | Verified Pass on public `/` | Live CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and Permissions-Policy observed |
| Secrets in client bundle | Verified Pass at static check level | No configured secret value was printed; bundle inspection did not reveal credential values |
| Error leakage | Plausible Pass | Safe error summaries and sanitized public status are used; broad authenticated negative testing unavailable |
| Data deletion/export | Verified Pass at route/code level; production outcome unknown | `server/routes/account.js:144-228`, `server/routes/auth.js:520-554` |

No Critical security finding was verified. This does not replace a dedicated authenticated penetration test.

## 9. Business logic and entitlement review

| Rule | Status | Evidence |
|---|---|---|
| Radar available to active trial and Elite | Verified Pass at code/test level | `server/routes/radar.js:43-112`; `requireEliteOrTrial`; tests |
| Radar unavailable to Premium | Verified Pass at code/test level | `test/requireElite.test.js:135`; Radar route middleware |
| One active Radar per user | Verified Pass at code/test level | `server/services/radar.js:33,479`; `server/routes/radar.js:84-87` |
| Up to two daily Radar slots | Verified Pass at code/test level | `src/components/Scanner/CapitalFlowRadar.jsx:1041,1099`; Radar service/route tests |
| Radar expiry date | Verified at code level; timezone edge cases unknown | Radar schedule fields and runner; DST/holiday production test unavailable |
| Pause/resume/remove/edit | Verified at route/component level; production unknown | `server/routes/radar.js:76-112`; component controls |
| Scheduled scanner remains separate from Radar | Verified at code level | `server/routes/scheduledScans.js`; Radar routes and tables are separate |
| Duplicate schedule protection | Verified at code/test level | `server/routes/scheduledScans.js:79-96,126-149` |
| One alert per new entry | Plausible Pass / production event replay unknown | Radar run state and notifications inspected; no production event replay |
| Direct API feature bypass | Unknown in production | Local middleware tests pass; production tier accounts unavailable |
| Pricing matrix Radar flag | Verified at component/test level; live content unknown | `src/components/shared/UpgradeModal.jsx`; `UpgradeModal.test.jsx` checks Premium X and Elite check |

## 10. Financial-data accuracy review

The audit found defensive handling for missing or malformed values, including `formatPrice`, `formatRatio`, finite MA distance handling, `dataAsOf`, unavailable banners, and no-`NaN` scheduled notifications. This is a meaningful safety improvement but is not equivalent to verifying every live market value.

| Data family | Status | Evidence / remaining check |
|---|---|---|
| Price/change/change percent | Plausible Pass | Formatters and scanner joins inspected; live provider reconciliation unknown |
| Volume/average volume/RVOL | Plausible Pass | Strict finite parsing and safe ratio display; session/stale-data matrix unknown |
| Market cap/units | Unknown | Code paths exist; corporate-action and millions/billions cross-provider checks incomplete |
| Float/short interest | Unknown | Provider availability and units not fully verified |
| P/E/forward P/E/PEG | Unknown | Fundamentals routes/components exist; compatibility/missing-data validation needs provider fixtures and live samples |
| Debt/equity/revenue/EPS/earnings | Unknown | No comprehensive current-data reconciliation report |
| Chart data | Unknown | Chart route and cache inspected; live delayed/realtime semantics not proven |
| Scan results | Plausible Pass | Full-result and unavailable-value regression tests pass; market truth still provider-dependent |
| Radar results | Plausible Pass | Full result persistence and status fields inspected; authenticated production run unknown |
| Timestamp/timezone/session | Plausible Risk | `dataAsOf` is carried; full session, holiday, DST, delayed-data, and mixed-provider matrix not complete |
| Invented values | Verified Pass at tested paths | Malformed-value tests reject `NaN`; AI and all providers still require ongoing guardrails |

## 11. Scanner and Radar review

- **Capital Flow:** universe, RVOL, market cap, price, volume, sector, watchlist, chart, alert, sorting, full-result rendering, and safe unavailable formatting were inspected.
- **Moving Average:** SMA period, distance, direction, timeframe, result sorting, full result rendering, safe MA distance formatting, chart, and alert paths were inspected.
- **Hot Sectors:** sector-flow route and mobile result code exist; a full authenticated production run remains `UNKNOWN`.
- **Scheduled scans:** three scan types are enumerated in `server/routes/scheduledScans.js:6`; background runner and digest tests pass; production job history and provider failure behavior remain partly unknown.
- **Radar:** AND/OR condition selection, Capital Flow + MA combined setup, up to two times, expiry, one active Radar, pause/edit/remove, trial/Elite gate, and result event storage are implemented at code/test level.
- **Result order and deduplication:** sorting and state fields exist; production re-entry and event replay evidence is missing.
- **No invented results:** empty/unavailable paths exist and malformed numeric values render unavailable; provider outage drills remain unknown.
- **User-facing source/time:** `dataAsOf`/last-check fields exist in relevant paths; UI consistency across every result surface remains unverified.

## 12. AI / Capi review

| Area | Status | Evidence / limitation |
|---|---|---|
| Server entitlement | Verified Pass at code/test level | `server/routes/chat.js:67-179` uses `requireEliteOrTrial` and limiter |
| Streaming and timeout/error fallback | Plausible Pass | Stream parser and `CAPI_UNAVAILABLE_REPLY` inspected; live provider outage not exercised |
| Prompt injection/system leakage | Plausible Risk | Untrusted message handling and prompt construction inspected; no full adversarial red-team suite |
| Financial grounding | Unknown | No live source-grounding proof for every current-data claim |
| No fabricated data | Plausible Pass | Unavailable response exists; current-data hallucination scenarios need staging/provider mocks |
| Investment advice boundary | Plausible Pass | Disclaimer present in `ChatWidget.jsx:452`; response policy still requires adversarial evaluation |
| Privacy/storage/ownership | Unknown in production | `chat history` routes and account export exist; cross-user access not tested with production accounts |
| Rate/quota/cost | Plausible Pass | `chatLimiter`, AI usage service, and circuit-breaker patterns exist; real provider cost telemetry unknown |
| Mobile | Verified Pass for hiding launcher in tested guest viewport | Authenticated mobile chat absence not captured in production |
| Hebrew/English/mixed input | Unknown | Component supports text input; language/number/ticker test matrix incomplete |

Capi remains a separate desktop feature. Removing its result-row action does not remove the Capi product surface.

## 13. Notifications, jobs, and email

| Area | Status | Evidence / limitation |
|---|---|---|
| Push permission state | Plausible Pass | `src/App.jsx:1053-1093`; browser permission behavior not fully device-tested |
| Push registration/unsubscribe | Verified at route/code level | `server/routes/push.js:17-59`; production device token lifecycle unknown |
| Duplicate notification prevention | Plausible Pass | Notification/radar state and webhook idempotency ledger inspected; production replay unknown |
| Scheduled scan jobs | Verified at code/test level | `server/services/scheduledScanRunner.js`; scheduled runner tests pass |
| Radar jobs | Verified at code/test level | `server/services/radar.js`; runner status/result count fields inspected |
| Weekly backups | Plausible Pass / restore Unknown | `server/services/dbBackup.js:118-137` |
| Email sending | Not Applicable for live transaction | No real emails were sent; templates/queues/config were inspected only |
| Retry loops/cron overlap | Plausible Risk | Cluster singleton and scheduling code exist; production overlap drill unavailable |
| Dead-letter/failure visibility | Unknown | Failure fields and logs exist; no verified operator drill |
| Timezone/DST | Plausible Risk | Israel-time schedule logic exists; exhaustive DST/holiday acceptance test not run |
| Orphan/stale schedules | Unknown | Cleanup paths exist; production orphan inventory unavailable |

## 14. Infrastructure, deployment, and public production evidence

### Deployment

- GitHub CI run for `eae5db0` completed successfully.
- GitHub Deploy run for `eae5db0` completed successfully, including deploy and public release verification jobs.
- Production `GET https://capitalflow.vip/health` returned HTTP 200 and the exact release commit `eae5db0c413e108b8c0e12284a537adb0ef1a9f3`.
- Production HTML returned HTTP 200 and referenced a new hashed bundle (`index-Dc0cRq3V.js` at the time of verification).
- Public routes `/`, `/scanner`, `/ma`, `/flow`, `/fundamentals`, `/watchlist`, `/policy`, and `/accessibility` returned HTTP 200.
- Public `robots.txt`, `sitemap.xml`, and Apple merchant association file returned HTTP 200.
- `https://status.capitalflow.vip/status` returned HTTP 200.
- Canonical liveness path is `/health`; `/api/health` returned 404. This is a route distinction, not a health failure.

### Headers observed on production `/`

`Content-Security-Policy`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy` were present. CSP includes Whop and Google Pay origins required by the checkout integration. Exact header values were not copied into this report beyond non-sensitive policy names to keep the report concise.

### Infrastructure gaps

- Dockerfile and Compose health checks reference `/health`, but Docker was unavailable locally; image build and container startup were not independently reproduced here.
- No verified Coolify/Nginx configuration was found in the repository inventory. Cloudflare/reverse-proxy behavior beyond observed public headers is `UNKNOWN`.
- Render deployment is verified through GitHub action and public SHA; rollback, zero-downtime behavior, migration ordering, and resource limits remain `UNKNOWN`.
- Production database exposure, Redis exposure, debug ports, certificate renewal, DNS failover, full-disk, memory pressure, and graceful shutdown drills were not performed.

## 15. Database and data lifecycle

- SQLite/database initialization, migrations, indexes, transactions, unique constraints, cleanup, ownership clauses, webhook idempotency, and backup table lists were inspected in `server/db/index.js`, `server/services/backupTables.js`, `server/routes/*`, and related services.
- Radar and scheduled scan state is represented in dedicated tables and includes status/last-run fields.
- Account export includes account-associated data and Radar/schedule fields: `server/routes/account.js:144-228`.
- Auth account deletion removes user-owned scan, Radar, state, and related rows: `server/routes/auth.js:520-554`.
- Parameterized query usage is the dominant pattern in inspected route/service SQL.
- Production query plans, backup restore, corruption recovery, retention enforcement, and long-running full-market query performance are `UNKNOWN`.

## 16. Accessibility, Hebrew, RTL, and localization

| Check | Status | Evidence / limitation |
|---|---|---|
| Document language/direction | Verified Pass | `index.html:2` has `lang="he" dir="rtl"` |
| Nested ticker/English values | Plausible Pass | Financial strings use explicit formatting; full BiDi visual matrix incomplete |
| Logical CSS properties | Plausible Pass | Logical properties exist in updated surfaces; repository-wide hardcoded left/right audit incomplete |
| Form labels/ARIA | Plausible Pass | Many modal/buttons expose labels; no complete screen-reader pass |
| Keyboard/focus/modal trap | Unknown | `useModalA11y` exists; every modal at 200%/400% zoom not tested |
| Contrast/focus visibility | Unknown | CSS reviewed; no complete WCAG 2.2 AA measurement report |
| Tables/charts | Unknown | Semantics and mobile layouts exist; screen-reader and keyboard table traversal not verified |
| Reduced motion | Plausible Pass | Reduced-motion CSS exists in relevant areas; complete animation inventory not measured |
| Hebrew copy quality | Unknown | Some Hebrew content/assets exist; all screens and mixed financial strings need editorial review |
| RTL mobile result rows | Unknown in authenticated production | Guest overflow was tested; real result-card content was not available without authentication |

## 17. Responsive and mobile review

### Evidence obtained

Puppeteer guest smoke checks against `https://capitalflow.vip/scanner` at viewports 320, 360, 390, 430, and 768 pixels reported `innerWidth == document.scrollWidth == body.scrollWidth`, `horizontalOverflow: false`, and `chatVisible: false` for each viewport.

### Remaining mobile unknowns

- Authenticated Capital Flow result cards with real rows.
- Authenticated MA result cards with real rows.
- Hot Sectors, Fundamentals, Watchlist, Radar setup, Radar result history, notification modal, profile drawer, checkout, and upgrade matrix at 320/360/390/430/768/1024 pixels.
- Keyboard, screen reader, landscape, safe-area, short viewport, zoom 200%/400%, browser chrome, and reduced-motion combinations.
- The supplied screenshot’s narrow result surface cannot be treated as fixed solely from a guest route with no result data. The code now has dedicated mobile cards and no result-row News/Capi actions, but authenticated visual proof is still needed.

## 18. Performance and reliability

| Area | Result | Evidence |
|---|---|---|
| Build success | Verified Pass | `npm run build` |
| Code splitting | Plausible Pass | Vite output includes lazy chunks such as `MAScannerPage`, `WelcomeTierModal`, and others |
| Main bundle budget | Plausible Risk | 480.27 kB JS and 243.80 kB CSS before compression |
| Duplicate requests | Unknown | Static effects inspected; no production network waterfall |
| Provider timeout/retry | Plausible Pass | Quote cache/circuit breaker/scan services inspected; percentile behavior unknown |
| Capi latency | Unknown | Stream/fallback code exists; no provider latency sample |
| Scan latency | Unknown | No safe production load test or full-market percentile |
| Memory growth | Unknown | No long-session heap/profile run |
| Background jobs | Plausible Pass | Singleton/cluster and scheduler code exist; failure drill unknown |
| Cold start | Unknown | No cold-start timing report |
| Concurrency | Plausible Pass | Tests cover selected session/schedule cases; production peak behavior unknown |

## 19. Dependency, SBOM, licensing, and SEO review

### Dependencies

- `package-lock.json` is present.
- Production dependency audit passed with 0 high-level vulnerabilities.
- No dependency update was performed during the audit.
- Deprecated/abandoned/transitive provenance and license compatibility were not exhaustively verified; see `LR-008`.

### SEO/public surface

- `index.html` includes title/metadata, `robots` metadata, manifest, and public assets; exact Open Graph/canonical quality needs an editorial crawl.
- Live `/robots.txt` and `/sitemap.xml` returned 200.
- Public auth/private indexing behavior, duplicate content, structured data, 404 semantics, and social-card rendering were not all visually verified.
- Status page returned 200 and public status text is sanitized.

## 20. QA matrix

The full Cartesian matrix requested by the owner is larger than a useful single table. The following compact matrix records what was actually verified; every cell marked `Unknown` requires an explicit test account/device/environment before it can become Pass.

| User state | Happy path | Empty | Loading/slow | Timeout/provider failure | Auth/ownership | Mobile visual |
|---|---:|---:|---:|---:|---:|---:|
| Anonymous | Pass for public HTTP | Pass at public route level | Unknown | Unknown | N/A | Pass for guest overflow smoke |
| New user | Partial local auth pass | Unknown live | Unknown | Unknown | Unknown live | Unknown |
| Active trial | Local entitlement Pass | Local tests | Local tests | Unknown live | Unknown live | Unknown authenticated |
| Trial expired | Local gate Pass | Unknown live | Unknown | Unknown | Unknown live | Unknown |
| Premium | Local gate tests | Unknown live | Unknown | Unknown | Unknown live | Unknown |
| Elite | Local gate tests | Unknown live | Unknown | Unknown | Unknown live | Unknown |
| Admin | Code route inspection | Unknown | Unknown | Unknown | Unknown live | Unknown |
| Unauthorized user | Local middleware tests | N/A | N/A | N/A | Unknown production IDOR | Unknown |

| State/device dimension | Status |
|---|---|
| Malformed, null, empty, negative, huge numeric values | Local defensive tests pass for targeted paths; full API matrix Unknown |
| Stale/missing financial data | Partial defensive handling; live provider matrix Unknown |
| Expired session | Local route/session tests; live browser flow Unknown |
| Multiple tabs / refresh / back / double click / repeated submit | Selected local tests; full workflow Unknown |
| Network loss / partial outage | Unknown; no destructive production fault injection |
| Desktop/tablet/mobile | Guest mobile overflow only; authenticated surfaces Unknown |
| Keyboard-only/screen-reader | Unknown |
| Reduced motion/slow network | Partial CSS/code evidence; live behavioral matrix Unknown |

## 21. Scoring

Scoring is conservative. Points are awarded for evidence, not for plausible code.

| Category | Weight | Score awarded | Basis |
|---|---:|---:|---|
| Functional/Product correctness | 14 | 11 | Core routes and requested result fixes tested; authenticated production workflows incomplete |
| Financial data correctness | 12 | 8 | Defensive missing-data behavior; full live reconciliation unknown |
| Security, authentication, authorization, privacy exposure | 15 | 11 | Strong code/tests/headers; production identity/ownership matrix unknown |
| Backend, APIs and database | 10 | 7 | Routes, middleware, parameterized DB paths and tests; restore/query production evidence incomplete |
| Business logic, abuse and cost control | 6 | 5 | Radar/quota/idempotency protections tested; production replay/cost telemetry unknown |
| Frontend, UI and UX | 10 | 7 | Requested result-surface changes and build pass; full UX/mobile visual audit incomplete |
| Mobile, accessibility, Hebrew, RTL and localization | 9 | 5 | Guest overflow and RTL root verified; authenticated/a11y matrix missing |
| Performance, scalability and reliability | 8 | 5 | Build/lazy chunks and defensive services; no production performance SLO evidence |
| Infrastructure, deployment, backups and disaster recovery | 6 | 4 | Deploy/health/SHA verified; restore/failover/rollback unknown |
| AI grounding and safety | 4 | 3 | Entitlement, disclaimer, fallback and stream code; adversarial grounding tests incomplete |
| QA, tests and release engineering | 3 | 3 | Local suites and CI/deploy pass; lint warnings remain but are reflected elsewhere |
| SEO, dependencies, licensing and compliance risk | 3 | 3 | Security audit/robots/sitemap/public pages pass; complete licensing/editorial audit remains a documented risk |
| **TOTAL** | **100** | **72** | Conservative evidence-based score |

Per the owner’s rules, this score cannot be converted to a launch recommendation because High findings remain Unknown and backup restore/real wallet/authenticated production evidence are not verified.

## 22. Top 10 remediation priorities

| Order | Work item | Effort | Impact | Risk | Dependency |
|---:|---|---|---|---|---|
| 1 | Run controlled Google Pay/Apple Pay checkout verification with provider-approved low-risk test product and webhook/tier evidence | Medium | High | Medium | Whop/provider test environment, supported device/card |
| 2 | Perform isolated production-backup restore drill and document RPO/RTO | Medium | Critical | Low | Backup-store access and isolated DB |
| 3 | Execute authenticated tier/ownership/API matrix for trial, expired trial, Premium, Elite, admin, and unauthorized cases | High | Critical | Medium | Dedicated non-production or approved test accounts |
| 4 | Capture authenticated mobile result screenshots and automated overflow checks at 320–768px for all scanners/Radar | Medium | High | Low | Test accounts with seeded results |
| 5 | Add financial provider contract/reconciliation fixtures for price, volume, RVOL, cap, fundamentals, timestamps, units, sessions, and corporate actions | High | High | Medium | Stable provider fixtures and data contract |
| 6 | Instrument Capi/scanner latency, timeout, cancellation, retry, and provider-cost metrics | Medium | High | Low | Observability destination and SLO definitions |
| 7 | Reduce ESLint warnings to zero or create a reviewed exception policy; separate untracked previews from release inputs | Medium | Medium | Low | Maintainer cleanup window |
| 8 | Run status/backup/failover game day and document operator runbooks | Medium | High | Low | Staging/isolated failure controls |
| 9 | Build complete WCAG 2.2 AA keyboard/screen-reader/zoom/contrast and Hebrew BiDi test suite | High | High | Low | Browser/device test matrix |
| 10 | Create asset/provider/license ledger and review privacy/commercial terms separately | Medium | Medium | Low | Legal/operations review |

## 23. Release plan

### Before launch

- Close or explicitly accept `LR-001`, `LR-002`, and `LR-003` with evidence.
- Complete real-device wallet verification and coupon-price reconciliation.
- Complete authenticated mobile screenshots and no-overflow checks for result tables, Radar, pricing, profile, notifications, and checkout.
- Complete financial data contract/reconciliation review.
- Decide whether News removal is row-scoped or global and make product copy consistent.
- Establish backup restore proof, rollback procedure, and incident runbook.
- Remove or quarantine untracked release artifacts and reduce lint warnings.

### First week

- Monitor scan completion rate, provider failure rate, missing-data rate, duplicate notifications, Capi latency, checkout initiation/complete mismatch, and webhook lag.
- Verify scheduled jobs, Radar runs, status monitors, and notification permission failures daily.
- Review logs for redacted errors only; ensure no credential or personal-data leakage.

### First month

- Run a restore drill, status game day, provider failover test, and authenticated entitlement regression suite.
- Review RUM/Web Vitals, bundle budgets, scanner latency percentiles, and provider cost.
- Complete WCAG/RTL editorial review and asset license ledger.

### Future improvements

- Add complete Playwright/Puppeteer authenticated matrix with seeded deterministic data.
- Add provider contract fixtures, property-based numeric tests, and replay/deduplication tests.
- Add release artifact allowlist, SBOM/license report, database migration rehearsal, and signed deployment evidence.

## 24. Tests and checks actually run

| Check | Result |
|---|---|
| `npm run test` | 389 backend tests passed |
| `npm run test:frontend` | 145 frontend tests passed locally, including the scheduled-results regression file present in the workspace |
| `npm run test:worker` | 8 Worker tests passed |
| `npm run test:cluster` | Cluster integration test passed |
| `npm run test:all` | Passed end-to-end locally |
| Targeted coupon/Whop tests | 39 passed |
| Targeted frontend regression tests | 37 passed |
| `npm run build` | Passed; Vite transformed 1,661 modules |
| `npm run lint` | Exit 0, 36 warnings |
| Scoped Prettier check | Passed for changed implementation files |
| `git diff --check` | Passed before implementation commit |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Wallet structural readiness script | Passed structural checks; manual wallet transaction still required |
| Public HTTP route smoke | Main public routes returned 200 |
| Public header smoke | Required security headers observed |
| Public health/SHA check | 200 and exact implementation SHA verified |
| Guest mobile overflow smoke | 320/360/390/430/768: no horizontal overflow; Capi hidden |
| Real payment | Not run by policy |
| Real email | Not run by policy |
| Authenticated production result visual | Not run; no approved test account/data |
| Production backup restore | Not run; no approved isolated restore environment |

## 25. Unknowns and tests that could not be performed

1. Google Pay and Apple Pay real-device completion, including provider callback/webhook.
2. Coupon final amount as displayed and charged by Whop after provider redemption.
3. Production authenticated matrix for every user tier and direct API ownership/entitlement behavior.
4. Production backup restore, RPO, RTO, encryption, and off-site copy verification.
5. Authenticated mobile result surfaces with real rows and complete data.
6. Full financial provider reconciliation across sessions, holidays, corporate actions, units, currencies, delayed data, and timestamps.
7. Full Web Vitals, TTFB, API/database/provider latency, memory, and concurrency metrics.
8. Full WCAG 2.2 AA keyboard, screen-reader, zoom, contrast, touch-target, and reduced-motion matrix.
9. Complete Hebrew editorial/BiDi review across every mixed English/financial string.
10. Cloudflare/reverse-proxy/DNS/certificate failover and production resource-limit behavior.
11. Production rollback and migration rehearsal.
12. Status alert delivery, backup failure, dead-letter, cron overlap, and outage game days.
13. Asset/font/logo/data-provider licensing and commercial-use review.
14. Real customer email deliverability and bounce/complaint handling; intentionally not sent.
15. Legal, regulatory, privacy-policy, financial-advice, payment terms, and commercial approval; no legal opinion was given.

## 26. Production-only and silent-failure risks

### Likely to appear only in production

- Wallet eligibility, merchant domain registration, provider checkout configuration, and webhook timing.
- Production secrets, provider quota, rate limits, plan configuration, DNS, TLS, Cloudflare caching, and Render resource constraints.
- Real database volume, concurrent Radar creation, scheduled job overlap, webhook replay, and large result payloads.
- Authenticated mobile layouts with real symbols/names/sectors and provider-specific missing values.

### Silent failures to monitor

- Scan runner completes with zero results because provider data is unavailable or stale.
- Background SSE disconnects without updating the client status.
- Webhook is accepted but entitlement or promo ledger update is delayed.
- Push permission is denied or token is stale while UI still implies alerts are enabled.
- Backup job runs but the artifact is incomplete/unrestorable.
- Capi provider timeout returns a generic fallback while a user assumes current data was used.
- A result row is suppressed by malformed provider data rather than shown as unavailable.

### Places that can create unnecessary cost

- Full-market scans and large result payloads without measured provider/database percentiles.
- Capi retries/stream reconnects and duplicate submissions.
- Third-party provider calls for repeated watchlist/chart/fundamentals lookups.
- Webhook retries and scheduled job overlap.
- Oversized static assets, especially `public/logo-text.png` at approximately 8.05 MB.

### Places that can show incorrect financial data

- Provider/session/timestamp mismatch in quote, volume, RVOL, chart, and Radar paths.
- Unsupported or missing forward P/E/PEG values if provider compatibility is not enforced.
- Corporate actions, splits, exchange mapping, delayed data, and unit/currency conversions.
- Cached values presented without a clearly stale/unavailable state.

### Places where AI can produce unsupported claims

- Capi current-price/news/fundamental answers when provider data is missing or stale.
- Prompt injection through user text or retrieved news content.
- Confident trading language despite the informational disclaimer.
- Cross-user history or account context if authorization is bypassed.

## 27. Final launch recommendation

**Technical launch recommendation:** No unconditional recommendation yet. The deployment pipeline and current public release are functioning, but the owner’s own launch policy makes the application `NOT READY` while High findings remain Unknown and backup restore, authenticated entitlement/ownership, real wallet payment, and authenticated mobile result evidence are missing.

**Commercial/legal/payment/email blockers requiring separate review:**

- Google Pay/Apple Pay provider and device completion.
- Whop promo-code configuration and final charged amount.
- Merchant/payment terms and refund behavior.
- Real email deliverability, bounce, and complaint handling.
- Privacy, data-retention, financial-information, and marketing/legal review.

This report intentionally does not provide legal approval or payment approval.

## 28. Version and evidence record

- Code version: `eae5db0c413e108b8c0e12284a537adb0ef1a9f3`
- Branch: `main`
- Audit timestamp: `2026-09-01 14:37:31 +03:00`
- Main URL: `https://capitalflow.vip/`
- Health URL: `https://capitalflow.vip/health`
- Status URL: `https://status.capitalflow.vip/status`
- CI run: GitHub Actions run `33502456340`
- Deploy run: GitHub Actions run `33502456294`
- Public health response verified the exact code SHA above.
- No secrets or personal data are included.

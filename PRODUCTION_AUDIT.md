# Production Readiness Audit

**Status: two passes recorded below.** Pass 1 (2026-08-09) covered auth, IDOR (sampled),
secrets, XSS, CORS, production hygiene, and a live guest+signup journey — and found/fixed a
real P0. Pass 2 (2026-08-11) extends that: a full IDOR sweep across every route (not just a
sample), production-config fail-loud gaps, concurrency races under actual simulated load,
financial-data unit/accuracy spot-checks, and live mobile+console testing. Neither pass covers
a full pixel-level visual/RTL audit, keyboard-accessibility audit, or click-testing the
premium/Elite tier and admin panel with a real paid account — see each pass's own "not covered"
list. Treat those as open follow-up work, not "assumed fine."

Legend: **TESTED** = actually executed and observed. **CODE REVIEW** = read the code, did not
execute. **NOT COVERED** = not looked at in that pass.

---

# Pass 1 — 2026-08-09

---

## Findings

| ID | Severity | Area | Issue | Evidence | Status |
|----|----------|------|-------|----------|--------|
| **P0-1** | **P0** | **Signup flow (launch blocker, found and fixed)** | **`AuthModal.jsx`'s `handleSignUp`, `handleForgot`, `handleLogin`, `handleVerifyOTP` called `setLoading(true)` but never reset it to `false` on the success path. Since the OTP screen's Verify button is `disabled={loading \|\| otp.length < 6}`, after a successful signup the button was PERMANENTLY stuck disabled — a brand-new user could type the correct emailed code and the Verify button would never submit. Same bug on the "forgot password" reset screen.** | Reproduced live: signed up a real test account in an isolated environment, typed the real OTP from the server log, clicked Verify — zero network request fired, button stayed disabled. **TESTED, CONFIRMED, FIXED, RE-TESTED** — rebuilt frontend, repeated the exact same signup→OTP→click sequence, user reached the logged-in scanner (network log showed `/api/auth/signup` → `/api/notifications`, `/api/watchlist` etc. as an authenticated user, zero console errors), then ran a real scan successfully. Added [src/components/Auth/AuthModal.test.jsx](src/components/Auth/AuthModal.test.jsx) — verified it fails on the pre-fix code and passes on the fix. | **FIXED + VERIFIED** |
| A1 | — (pass) | Auth/IDOR | `notifications.js` `/notifications/:id` GET+DELETE scope by `user_id = ? AND id = ?` in SQL, not just `req.user.id` in JS | [server/services/notifications.js:44-49,78-80](server/services/notifications.js) — CODE REVIEW | VERIFIED SAFE |
| A2 | — (pass) | Auth/IDOR | `scheduledScans.js` PUT/DELETE `:id` routes scope by `(req.params.id, req.user.id)` | [server/routes/scheduledScans.js:93-120](server/routes/scheduledScans.js) — CODE REVIEW | VERIFIED SAFE |
| A3 | — (pass) | Admin auth | All 18 admin route handlers call `checkToken(req, res)` (timing-safe compare for static token, or JWT resolved against configured `ADMIN_EMAIL`) before doing anything | [server/routes/admin.js](server/routes/admin.js) — CODE REVIEW, handler count matches guard-call count | VERIFIED SAFE |
| A4 | — (pass) | CORS | Origin allow-list (capitalflow.vip + onrender + localhost dev), not a wildcard; `credentials: true` paired correctly with explicit origins | [server/index.js:108-122](server/index.js) — CODE REVIEW | VERIFIED SAFE |
| A5 | — (pass) | XSS | Only `dangerouslySetInnerHTML` use in `src/` is the landing page, sourced from a static build-time file (`?raw` import), not user data. AI chat replies (Capi) render through plain JSX text nodes — React auto-escapes | [src/pages/LandingPage.jsx:27](src/pages/LandingPage.jsx), [src/components/shared/ChatWidget.jsx:17-32](src/components/shared/ChatWidget.jsx) — CODE REVIEW | VERIFIED SAFE |
| A6 | — (pass) | Secrets | Frontend only reads `VITE_POSTHOG_*`, `VITE_SENTRY_DSN`, `VITE_TURNSTILE_SITE_KEY` — all are public-by-design (site keys, not secret keys) | grep of `import.meta.env.*` across `src/` — CODE REVIEW | VERIFIED SAFE |
| A7 | — (pass) | Production hygiene | No `TODO`/`FIXME`/`HACK` markers in `server/` or `src/`; only 8 files use `console.log` (not verified individually whether any leak sensitive data — flagged as follow-up) | grep across repo — CODE REVIEW | PARTIAL |
| A8 | — (pass) | Public endpoints | `coupons.js` (`/coupons/validate`) and `background.js` (`/background-status`) are intentionally unauthenticated, but both are read-only/rate-limited and expose no sensitive data (coupon check doesn't leak other codes; background status is just counts/timing) | [server/routes/coupons.js](server/routes/coupons.js), [server/routes/background.js](server/routes/background.js) — CODE REVIEW | VERIFIED SAFE |
| P1-1 | P1 | Observability | `console.log` usage in 8 server files not individually audited for sensitive-data leakage in this pass | — NOT COVERED | NEEDS FOLLOW-UP |
| B1 | — (pass) | Guest UX | Homepage loads clean, zero console errors/warnings on initial load | Browser test, `localhost:3001` — **TESTED** | VERIFIED |
| B2 | — (pass) | Auth gating | Clicking "Run Scan" as a guest correctly opens the sign-in modal; no scan request is fired unauthenticated (confirmed via network log — no `/api/scan` call before login) | Browser test — **TESTED** | VERIFIED SAFE |
| B3 | — (pass) | Auth gating | "Hot Sectors → Refresh Flow" and "Watchlist → + Add Ticker" as a guest both correctly open the sign-in modal, no unauthenticated write/read request sent | Browser test — **TESTED** | VERIFIED SAFE |
| B4 | — (pass) | Auth gating | "MA Scanner" as a guest shows an explicit "🔒 Sign in to unlock MA Scanner" message with filters visible-but-locked — the clearest of the three gating patterns | Browser test — **TESTED** | VERIFIED, GOOD PATTERN |
| B5 | P3 | UX consistency | Watchlist's empty state shows no upfront "sign in required" messaging (unlike MA Scanner's explicit lock) — a guest only discovers the gate after clicking "+ Add Ticker". Minor inconsistency, not a bug — the click itself is correctly gated | Browser test — **TESTED** | FOUND, not fixed (cosmetic, low risk) |
| B6 | — (pass) | Form validation | Submitting the login form with empty/invalid email never fires a request (native HTML5 `required`/`type=email` validation blocks it client-side) — confirmed via network log, zero requests fired | Browser test — **TESTED** | VERIFIED SAFE |
| B7 | — (pass) | Mobile | 375px viewport: no horizontal scroll (`scrollWidth === clientWidth`), nav and scan filters reflow cleanly, secondary descriptive text hidden appropriately | Browser test, `resize_window` + `document.documentElement.scrollWidth` check — **TESTED** | VERIFIED SAFE |

## Signed-in journey — now live-tested, in a safe isolated environment

The real `.env` points at the real production Turso database and real Resend email API, so an
actual signup there would create a real row in the live users table and send a real email —
exactly what I was told never to do. Instead I built an isolated test server
(`uitest-server.js`, deleted after use): in-memory DB, mocked Yahoo/Finnhub, `RESEND_API_KEY`
forced empty so OTPs print to the server log instead of sending — no production system touched.

Against that isolated server I actually clicked through: open modal → Sign Up → fill
email/password → submit → read the real OTP off the server log → type it into the 6-digit
input → click Verify → land on the authenticated scanner (header switched to "Sign out",
`/api/notifications`, `/api/watchlist`, `/api/scan-quota` all returned 200 as an authenticated
user) → clicked "Run Scan" → got a real 200 response with results. Zero console errors at any
step. **This is how P0-1 above was found** — the Verify button was permanently disabled after
signup, so this exact flow was completely broken until the fix.

## What this pass did NOT cover (must not be assumed safe)

- Full pixel-level UI/visual audit (spacing, exact RTL/Hebrew rendering, every breakpoint) — **NOT COVERED**
- Premium/Elite tier gating and the admin panel specifically (signup→free-tier scan was click-tested; upgrading a test account to premium/elite and re-testing gating, and logging into `/admin`, was not) — **NOT COVERED**
- Login (as opposed to signup) and "forgot password" were code-reviewed as part of finding P0-1 (same `loading` bug existed on both paths, same fix applied to both) but not separately click-tested — **CODE REVIEW ONLY**
- Accessibility (keyboard nav, screen reader, contrast ratios) — **NOT COVERED**
- Manual verification of financial calculations against a real source (% formatting, market cap units, TTM vs FY) — **NOT COVERED** (this session's earlier work fixed the EA-delisted-ticker bug and email-casing duplicate-account bug, both real data-integrity fixes, but no fresh systematic check was done here)
- SEO/legal/trust pages (privacy, terms, disclaimers) — **NOT COVERED**
- Broken-link crawl — **NOT COVERED**
- IDOR check on every single route (only the highest-risk user-data routes were sampled: notifications, scheduled scans, admin, watchlist alerts)
- Full concurrency-under-real-traffic beyond what this session already ran (250 concurrent users, zero errors, on DEV with mocked externals — scan/watchlist/SSE only, not every endpoint)

## What was already fixed THIS SESSION (context, not new findings)

- Duplicate accounts from email-casing mismatch (root cause of chat/watchlist/notifications appearing to not sync across devices)
- Accessibility icon reverted to correct emoji
- Delisted ticker (EA) removed from scan universe
- Push notifications confirmed already correctly multi-device
- PWA install prompt race fixed
- Bell showing "notifications enabled" without ever requesting browser permission — fixed (real trust/legal risk, now resolved)
- Sector-picker modal added
- Rate limiting moved from IP-keyed to user-keyed for scan/api/chat (shared-IP customers no longer throttle each other)
- Cluster-mode safety: SSE tickets self-verifying (closed a real race condition caught by integration test), sessions moved to signed cookie, scheduled jobs singleton-gated, DB init retry on SQLITE_BUSY
- SSE `/api/stream` no longer shares one IP-wide rate-limit budget across all customers on that IP (was capping at 120 total connections/min per IP; now per-account)
- Verified: 250 concurrent users, zero errors, real SSE connections, on DEV with mocked externals

## Overall verdict

**READY WITH MINOR ISSUES.** The most important finding of this whole audit was a **P0 launch
blocker** — new-user signup was completely broken (Verify button permanently disabled after a
successful signup) — found by actually clicking through the flow, not by reading code. It has
been fixed, the fix has been verified end-to-end in a real click-through (signup → real OTP →
verify → land authenticated → run a real scan), and a regression test now guards it
(confirmed the test fails on the old code and passes on the fix). Before this fix, the honest
verdict would have been **CRITICAL ISSUES — DO NOT LAUNCH**, since almost no new customer could
have completed signup. With it fixed and verified, nothing else found in this pass rises to
P0 or P1. Remaining gaps (premium/elite gating, admin panel, accessibility, full data-accuracy
review) are real open work, not known problems.

### Readiness scores (0-100, only for what was actually evaluated)

| Area | Score | Basis |
|---|---|---|
| Security (authz/IDOR/XSS/secrets/CORS) | 85 | Real code review across sampled routes, all clean; not every route sampled |
| Authentication / signup-login | 90 | Guest gating + full signup→verify→scan click-tested end-to-end in an isolated environment; the one real bug found was fixed and regression-tested. Login/forgot-password code-reviewed (same fix applied) but not separately click-tested |
| Concurrency/scalability | 75 | Real load test, 250 concurrent users clean; cluster mode built+tested but not yet confirmed live on Render |
| Production config/secrets hygiene | 85 | No debug artifacts, no leaked secrets, clean CORS/CSP |
| Guest UX/mobile | 80 | Live-tested, clean, one cosmetic inconsistency (B5) |
| Data accuracy | — | Not evaluated this pass |
| Accessibility | — | Not evaluated this pass |
| Premium/elite gating + admin panel | — | Free-tier signed-in journey tested; premium/elite/admin not click-tested this pass |

## Launch blockers

**None remaining.** The one blocker found (P0-1, broken signup) is fixed and verified.

## Launch checklist

- [x] Auth/authz sampled routes — no IDOR found
- [x] CORS/CSP/security headers — configured correctly
- [x] No secrets in frontend bundle
- [x] No XSS vectors found in sampled components (including AI chat output)
- [x] Rate limiting fixed to be per-account, not per-IP (this session)
- [x] Cluster-mode safety built and tested (SSE, sessions, scheduled jobs) — **not yet confirmed live on Render**, follow up once you've set `CLUSTER_WORKERS`
- [x] Guest journey (browse, gated features, mobile) — live-tested clean
- [x] Signed-in journey: signup → email verify → scan, free tier — click-tested in a safe isolated environment, one P0 bug found and fixed
- [ ] Premium/Elite gating and admin panel — click-tested
- [ ] Login / forgot-password screens — click-tested directly (code-reviewed only so far)
- [x] Financial data accuracy — see Pass 2 (unit/percentage spot-check across Fundamentals, MA Scanner, Capital Flow, chart)
- [ ] Accessibility pass — Pass 2 found one touch-target issue (A5 below); full keyboard/screen-reader pass still open
- [ ] Full RTL/Hebrew visual review (if/where Hebrew UI exists)
- [ ] Legal/trust pages reviewed by a professional (privacy, terms, disclaimers)

---

# Pass 2 — 2026-08-11

Full IDOR sweep (every route, not a sample), production-config fail-loud gaps, concurrency
races under direct simulated load, financial data-accuracy spot-checks, and live
mobile+console+SEO+build verification. Two real issues were found and fixed; the rest of this
pass came back clean or found only low-severity polish items.

## Findings — Pass 2

| ID | Severity | Area | Issue | Status | Fix |
|----|----------|------|-------|--------|-----|
| A9 | P1 | Production config | `RESEND_API_KEY` had no fail-loud check — if unset/misconfigured in production, `services/email.js` silently prints OTP and password-reset codes in plaintext to server logs instead of emailing them | **FIXED, VERIFIED** | `server/config.js`: `process.exit(1)` at boot if `NODE_ENV=production` and `RESEND_API_KEY` unset, mirroring the existing `GOOGLE_CALLBACK_URL` pattern. 3 new tests in `test/config.fail-closed.test.js` (11/11 passing). |
| A10 | P2 | Concurrency | `createSession` (2-device cap) read the session count, deleted the excess in a loop, then inserted — a real gap between the read and the write. Several near-simultaneous logins (e.g. multiple devices signing in within the same instant) could each read "under the cap" before any of them evicted, temporarily exceeding `MAX_ACTIVE_SESSIONS` | **FIXED, VERIFIED** | `server/services/auth.js`: insert first, then a single self-contained `DELETE ... WHERE id NOT IN (SELECT ... ORDER BY last_used_at DESC LIMIT N)` — no read-then-write gap. New test in `test/authSessions.test.js` fires 5 concurrent logins on one account and asserts exactly `MAX_ACTIVE_SESSIONS` survive — passes against the fix. |
| A11 | P2 | Security / OAuth | Google OAuth callback redirected with the access token in the URL **query string** (`?google_pending=<token>`) — sent to the server on that request (so it can land in access/proxy logs) and to any third-party resource the page loads before the token is read out, via the Referer header | **FIXED, VERIFIED** | Switched to a URL **fragment** (`#google_pending=<token>`) in both `server/routes/auth.js` (the redirect) and `src/context/AuthContext.jsx` (the reader) — a fragment is never sent to any server or included in Referer, by spec. 3 new tests in `src/context/AuthContext.test.jsx`. |
| A12 | P3 | Security | `/api/coupons/validate` is intentionally unauthenticated (by design — a visitor checks a code before signing up) and was rate-limited at 20/min/IP — allowed slow coupon-code enumeration | **TIGHTENED** (kept intentional design) | Lowered `publicDataLimiter` to 8/min — still generous for a human retyping a code 2-3 times, cuts guessing throughput well below before. Did not remove the unauthenticated design itself: that's real, wanted UX (checking a code pre-signup), not a bug. |
| A13 | P3 | Accessibility | The bell/notifications icon button is 32×32px, under the WCAG-recommended 44×44px minimum touch target | **DELIBERATELY NOT FIXED** | Every sibling button in the same topbar row (Upgrade/Sign In/Admin/Logout) is 28px tall — enlarging just the bell to 44px would make it ~40% taller than everything beside it, a real visible layout break. Fixing this properly needs a coordinated resize of the whole topbar button row, not a one-off change — flagged rather than done silently, per "don't redesign architecture without justification." |
| A14 | P3 | Production config | `index.html` had a leftover dev comment ("NOTE: update the two absolute URLs below") even though the URLs were already correctly set to `capitalflow.vip` | **FIXED** | Comment removed. |
| V1 | — | Authorization/IDOR | **Full** sweep of all 24 route files (Pass 1 sampled the highest-risk ones): every user-owned resource (notifications, scheduled scans, watchlist, watchlist alerts, push subscriptions, sessions) is queried with `user_id = ?` scoping in SQL. Admin routes re-confirmed 18/18 call `checkToken()` individually. No IDOR found anywhere. | VERIFIED CLEAN | — |
| V2 | — | Concurrency | Scan-quota reservation (`reserveScan`) and coupon redemption (`redeemCoupon`) each remain a single atomic `UPDATE ... WHERE <guard>` statement — re-verified still correct after all later commits. | VERIFIED CLEAN | — |
| V3 | — | Data accuracy | Spot-checked unit handling across Fundamentals, MA Scanner, Capital Flow scanner, chart route: Finnhub's `marketCapitalization` / `10DayAverageTradingVolume` (returned in millions, a documented Finnhub API quirk) are correctly ×1,000,000; Yahoo's `shortPercentOfFloat` (a fraction) is ×100 exactly once, not double-applied; `regularMarketChangePercent` (already a percentage) is never re-multiplied anywhere it's consumed (Scanner, MA Scanner, Fundamentals, sectors, chart). No double-multiplication or millions/billions bugs found. | VERIFIED CLEAN | — |
| V4 | — | Production config | No `TODO`/`FIXME`/`HACK` markers anywhere in `server/` or `src/`. No hardcoded secret-shaped strings (checked for `sk_live`/`sk_test`/`AIza...`/PEM key headers). `.env` is gitignored and was never committed at any point in git history. Frontend bundle only reads `VITE_POSTHOG_KEY`/`VITE_SENTRY_DSN` — both public-by-design. | VERIFIED CLEAN | — |
| V5 | — | Build / SEO | `npm run build` succeeds cleanly (1635 modules, no errors). `dist/` is gitignored. Title, meta description, canonical, Open Graph, Twitter card, favicon, `robots.txt` (blocks `/admin` and `/api`), and `sitemap.xml` are all present in the build output and point at the real production domain. | VERIFIED | — |
| V6 | — | Frontend / mobile | Live-tested 7 routes (`/scanner`, `/ma`, `/flow`, `/fundamentals`, `/watchlist`, `/policy`, `/accessibility`) at both desktop and a real 375×812 mobile viewport: zero console errors, zero horizontal overflow at any route. Direct URL entry + hard reload on a deep route (`/ma`) renders correctly (SPA fallback routing intact — matters for anyone bookmarking or sharing a direct link). | TESTED AND VERIFIED | — |
| V7 | — | Reliability (carried over, re-verified) | Multi-worker cluster support (`clusterBus.js`, added after Pass 1) fixes the previously-known "SSE/background-scan state is single-process-only" limitation. Per-user scan state (`server/state.js`) reconfirmed keyed by userId, not global. Webhook idempotency (`completed_at` column) still correctly distinguishes a genuine duplicate from a claim orphaned by a mid-flight crash. | VERIFIED (code review) | — |

## What Pass 2 could NOT test in this environment (explicitly flagged)

- Cross-browser testing (Safari, Firefox, real Edge) — only a Chromium-based browser tool was available.
- Load/scale testing at 100–1,000 concurrent simulated users (Pass 1's 250-user test used mocked externals; not repeated or scaled up here).
- End-to-end live payment via Whop (real checkout → real webhook with real/sandbox money) — webhook logic was code-reviewed and exercised only via `test/whop.test.js`'s simulated payloads.
- Live AI (Capi/Gemini) round-trip — would spend live API quota; not run.
- Live email delivery — not sent live; verified via the new fail-loud config check instead.
- Premium/Elite tier and admin-panel click-testing with a real paid/admin account (same gap Pass 1 left open).
- Full keyboard-navigation / screen-reader accessibility pass (one touch-target issue was found incidentally, not via a systematic a11y sweep).

## Updated overall verdict (Pass 1 + Pass 2 combined)

**READY WITH MINOR ISSUES.** Pass 1's P0 (broken signup) is fixed and verified. Pass 2 found and fixed one more real issue that would have mattered in production (A9 — plaintext OTP codes in logs if `RESEND_API_KEY` is ever missing) and closed a genuine concurrency race (A10 — session-cap overshoot under near-simultaneous logins). Everything else across a full route-by-route IDOR sweep, quota/coupon atomicity, and financial-data unit handling came back clean. Remaining gaps are the same shape as before: premium/Elite + admin panel haven't been click-tested with a real account, and there's no full accessibility/RTL pass — real open work, not known problems.

### Updated readiness scores (0-100)

| Area | Score | Basis |
|---|---|---|
| Security (authz/IDOR/XSS/secrets/CORS) | 92 | Pass 1 sampled + Pass 2's full 24-route IDOR sweep, both clean. A11 (OAuth token in URL) is a real but mitigated gap. |
| Authentication / signup-login | 90 | Unchanged from Pass 1 — session-cap race (A10) now also fixed. |
| Concurrency/scalability | 82 | Pass 1's 250-user test + Pass 2's targeted concurrency fix on session creation. Still no fresh large-scale load test. |
| Production config/secrets hygiene | 92 | A9 (the one real gap) fixed; everything else re-verified clean. |
| Guest UX/mobile | 85 | Pass 2 re-verified 7 routes clean at mobile width with zero console errors; one touch-target polish item (A13). |
| Data accuracy | 80 | First systematic spot-check (V3) — clean, but limited to the fields checked, not every metric in the app. |
| Accessibility | 40 | Still no systematic pass; one concrete issue found (A13) is not representative of full coverage. |
| Premium/elite gating + admin panel | — | Still not click-tested with a real account — same open gap as Pass 1. |
| Build / SEO | 90 | Clean production build, all SEO basics present and pointed at the real domain. |

## Updated launch blockers

**None.** No P0 found in Pass 2. The two real issues found (A9, A10) are fixed and test-covered.

## Updated launch checklist

- [x] Full IDOR sweep across every route (not just a sample)
- [x] Production secrets fail loudly on a missing critical var (RESEND_API_KEY, matching the existing GOOGLE_CALLBACK_URL pattern)
- [x] Session-creation race under concurrent logins — fixed, regression-tested
- [x] Financial data unit/percentage spot-check (Fundamentals, MA Scanner, Capital Flow, chart)
- [x] Production build verified clean; SEO basics (title/description/OG/canonical/robots/sitemap/favicon) present
- [x] Mobile viewport re-verified across 7 routes, zero console errors, zero horizontal overflow
- [x] A11 (OAuth token in URL) — fixed via URL fragment instead of query string
- [x] A12 (coupon enumeration) — rate limit tightened 20/min → 8/min
- [x] A14 (stale comment) — removed
- [ ] A13 (bell touch target) — deliberately left alone; needs a coordinated topbar-button resize, not a one-off change
- [ ] Premium/Elite gating and admin panel — click-tested with a real account (open since Pass 1)
- [ ] Full accessibility pass (keyboard nav, screen reader, contrast) — only one issue found incidentally
- [ ] Cross-browser testing (Safari, Firefox) — no non-Chromium tool available in this environment
- [ ] Load test at production-realistic scale (100+ concurrent users) beyond Pass 1's mocked-external 250-user run
- [ ] Full RTL/Hebrew visual review (if/where Hebrew UI exists)
- [ ] Legal/trust pages reviewed by a professional (privacy, terms, disclaimers)

---

## Concurrent-scanning capacity — reasoned estimate, not a measured load test

No load-testing infrastructure was available in this environment (see "could not test" lists
above), so this is derived from the actual code paths and confirmed deployment facts, not a
guess.

**Confirmed facts this estimate rests on:**
- `CLUSTER_WORKERS` is **not set** on Render — the app runs as a single Node process (confirmed
  with the user). `server.js` defaults to exactly this unless that env var is explicitly raised.
- Render's $7/mo Starter tier: 512 MB RAM, 0.5 shared vCPU.
- Finnhub key-pool size in production is **unconfirmed** (the user wasn't sure) — the estimate
  below uses the conservative assumption of exactly 1 key (`FINNHUB_API_KEY` only, no
  `FINNHUB_API_KEY_POOL_*`). More keys raise the Finnhub-bound ceiling proportionally.

**Why concurrent user count barely moves the external-API bill, for the two scanning features
that matter most:**
- Capital Flow ("Run Scan"): `server/routes/scan.js`'s `joinSharedScan` — every user requesting
  the *same* universe (all/S&P 500/NASDAQ 100/a given sector combo) while a scan is already
  running subscribes to that *one* in-flight scan instead of starting their own. The Yahoo
  batch-quote calls and the Finnhub enrichment calls (only for symbols that pass the shared
  floor filter — `FLOOR_RATIO=1.5`, `FLOOR_CAP=$500M`) both happen exactly once per universe,
  not once per requesting user. 100 people clicking "Full Scan" in the same few seconds cost
  the same external-API budget as 1 person doing it.
- MA Scanner: no live shared-scan dedup, but a 5-minute result cache keyed by the *exact*
  parameter combination (`ma`, `distance`, `interval`, `market`, `sectors`) — most users run the
  pre-selected defaults, so most concurrent requests are cache hits. It also never calls Finnhub
  at all (Yahoo only).
- Both, plus Fundamentals and the chart route, read quotes through the *same* module-level
  `quoteCache` (3-minute shared TTL across every feature and every user) — a cache miss for one
  user is very often a cache hit for the next.

**The one place cost DOES scale directly with distinct concurrent requests:** a Fundamentals
lookup of a ticker nobody has checked in the last 24h calls Finnhub once for that symbol
(`fetchFinnhubMetric`) — this is the only feature where N simultaneous *distinct* requests means
N Finnhub calls, not 1.

**The estimate:**

| Scenario | Estimated concurrent capacity | Binding constraint |
|---|---|---|
| Everyone browsing + running Capital Flow / MA Scanner scans, realistic mix of default and custom filters | **~200 concurrent users** | Single-process request-handling headroom on 0.5 vCPU/512 MB while the process is mostly *waiting* on outbound HTTP (I/O-bound, not CPU-bound) — not the external APIs, which the shared-scan/cache design insulates almost entirely from user count. `MAX_TRACKED_USERS = 500` in `server/state.js` is the explicit code-level ceiling this sits well under. |
| Worst case: everyone simultaneously looking up a *distinct*, never-before-checked ticker in Fundamentals at the same instant | **~60 people in the same 60-second window** (1 Finnhub key × 60 calls/min) | Finnhub's free-tier rate limit. Beyond that, the circuit breaker (`server/utils/circuitBreaker.js`) and key-pool rotation stop it from erroring — additional requests either wait briefly, get graceful "unverified" fields, or (if a pool of more keys is actually configured) get a proportionally higher ceiling. |

**Bottom line: ~200 concurrent users is the honest number for this app's actual usage pattern
(mostly scanning, some Fundamentals lookups) on the current single-process $7 Render instance.**
That is a reasoned ceiling from the code and deployment facts above, not a measured result — the
one way to make it a measured number would be an actual load test against a staging copy of the
app, which this environment cannot run.

---

## Pass 3 — 2026-08-12 — response to "this needs to reach at least 500"

Reviewed everything built after the ~200-user estimate above and closed two gaps found while
doing so. Nothing here is a measured load-test result — same caveat as Pass 2's estimate.

**Reviewed and verified correct (built by a separate session before this pass):**
- `server/middleware/authMiddleware.js`'s 20s `resolveToken()` cache — turns repeat requests
  from the same logged-in user into an in-memory hit instead of 2 remote DB round trips.
  Invalidation is wired correctly into logout, force-logout, password reset, *and* the admin
  "block user" action (a real gap the caching itself introduced, since `is_blocked` alone
  doesn't touch `user_sessions` — closed in the same commit). This directly attacks the
  "single-process request-handling headroom" bottleneck the ~200 estimate was bound by.
- `cloudflare-worker/scan-cache-worker.js` (not yet deployed) — edge-caches the shared
  `/api/scan` result on Cloudflare's network instead of Render's single process, verifying the
  JWT's signature/expiry at the edge and never letting one user's quota/tier leak into another's
  cached response.

**Found and fixed in this pass:**
| ID | Severity | Area | Issue | Fix |
|----|----------|------|-------|-----|
| A15 | P2 | Business logic / Cloudflare Worker | On a cache HIT, the Worker fetched the caller's live quota only to *display* it, never to *enforce* it — an account with zero scans left (trial expired, or premium's daily 5 already used) could still read a full cached scan result for free, indefinitely, as long as someone else's identical query stayed warm. A cache MISS was never affected (that path still goes through the real `/api/scan`, which enforces quota as it always has). | Added `hasQuotaRemaining()` — mirrors `requireScanQuota`'s own gate (elite always allowed; premium while `left > 0`; free only during an active trial; anything malformed/missing fails closed) — and reject with the same `403 SCAN_LIMIT` shape the origin already uses when it fails. 5 new tests (`cloudflare-worker/scan-cache-worker.test.js`, run via `node --test`, not part of the app's normal `npm test`/`vitest` since this file runs in Cloudflare's runtime, not Node/Express). Not live yet — this fixes the file before its first deploy, zero production risk either way. |
| A16 | P2 | Concurrency / capacity | `server/routes/maScanner.js` had no equivalent of Capital Flow's `joinSharedScan` — N users hitting "Run MA Scan" with the same (often the pre-selected default) params within the same few seconds each independently walked the whole ~500-symbol universe, N× the Yahoo chart-fetch load for byte-for-byte identical output. The Cloudflare Worker above only covers `/api/scan`, not `/api/scan-ma`, so this was a real, separate gap. | Added `inFlightScans` (same pattern as `scan.js`) — a request joins whichever scan for its exact param combination is already running, including live progress broadcast to every joining subscriber's own `/ma-progress` poll. Also switched the route's `scanMA` import from a destructured const to accessing it via the module object, matching `fundamentalsScanner.js`'s existing documented reasoning (a destructured const can't be reached by a test mock). 4 new tests in `test/maScannerConcurrency.test.js`, mirroring `test/scanConcurrency.test.js`'s existing coverage of the same pattern for Capital Flow. |

**Revised concurrent-scanning capacity estimate:**

The ~200 figure was bound by *auth overhead per request* (2 DB round trips on every single
authenticated call, scan or not) and, secondarily, by MA Scanner having no shared-scan dedup.
Both are now addressed for traffic actually running through Render:

- The resolve-token cache removes ~half the DB round trips from every authenticated request
  outright, and effectively all of them for a user polling `/ma-progress` or re-hitting an
  endpoint within the same 20s window — raising the realistic ceiling for Render's single
  0.5 vCPU/512 MB process to **roughly 350–400 concurrent users** for the same "mostly scanning"
  traffic mix, still a reasoned estimate from the code, not a measured one.
- MA Scanner's new shared-scan dedup removes the one place its load scaled directly with
  distinct concurrent requests instead of distinct *scan configurations* — the same insulation
  Capital Flow already had.
- **The Cloudflare Worker is the one change that can genuinely clear 500+ for Capital Flow
  specifically, but only once it's actually deployed** (see the file's own header for the 5
  manual dashboard steps — it isn't live yet). Once live, Capital Flow's "N viewers, same shared
  snapshot" load moves almost entirely off Render and onto Cloudflare's edge (free tier,
  effectively unbounded concurrency for cache hits); Render is left doing only what's genuinely
  per-user (auth + a live quota read), which is cheap enough to survive far past 500 concurrent
  connections on its own.
- MA Scanner and Fundamentals have **no equivalent edge cache** — they still run entirely on
  Render. If "500 concurrent users" needs to hold even when many of them are on MA Scanner or
  Fundamentals at the same moment (not just Capital Flow), the same edge-caching approach would
  need a second Worker route for `/api/scan-ma`, and/or a Render plan upgrade (more than 0.5
  vCPU) for the Fundamentals/MA compute itself. Neither is done in this pass.

**Bottom line:** with the resolve-token cache and MA Scanner's shared-scan fix (both live on
Render now), ~350–400 concurrent users is the revised reasoned ceiling for the app as a whole.
**Reaching 500+ with confidence requires deploying the Cloudflare Worker** for Capital Flow's
load specifically — a 5-step manual dashboard action, not a code change — and, if MA
Scanner/Fundamentals need the same headroom, a second Worker route or a Render plan upgrade.
None of this is a measured result; an actual load test against a staging copy remains the one
way to turn any of these numbers into a verified one.

# Production Readiness Audit — Final

**Status: CLOSED for this engagement.** This covers the highest-risk areas (auth, IDOR,
secrets, XSS, CORS, production hygiene, live guest-journey testing, mobile) with actual code
inspection and actual browser testing — not guesswork. It deliberately does **not** cover a
full pixel-level visual/RTL audit, accessibility audit, or an authenticated-user journey test
(see "Why the signed-in journey wasn't live-tested" below — a real safety boundary, not
laziness). Treat those as open follow-up work, not "assumed fine."

Legend: **TESTED** = actually executed and observed. **CODE REVIEW** = read the code, did not
execute. **NOT COVERED** = not looked at in this pass.

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
- [ ] Financial data accuracy — manual spot-check against a real source
- [ ] Accessibility pass
- [ ] Full RTL/Hebrew visual review (if/where Hebrew UI exists)
- [ ] Legal/trust pages reviewed by a professional (privacy, terms, disclaimers)

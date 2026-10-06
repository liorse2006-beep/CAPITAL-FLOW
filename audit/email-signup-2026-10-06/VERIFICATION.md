# Email/password authentication fix — 2026-10-06

## Scope

Only email/password authentication. Launch-readiness work remains paused.
Base: `2579b2a61e646141fe26c9a9817cf0f81834e40b`, the observed production/main commit.
No production database, account, secret, billing, Google OAuth, or infrastructure change was made during local verification.

## Changes

- Explicit Turnstile rendering with bounded script loading, error/expiry handling, cleanup and retry.
- A failed signup resets the consumed verification challenge; unverified forms cannot be submitted.
- No dummy site-key fallback in production, and no missing-secret CAPTCHA bypass in production.
- Bounded authentication requests and customer-safe error messages instead of raw provider/proxy responses.
- Structured unverified-account handling, accessible field labels, and resend-timer cleanup.

## Measured local verification

Windows; Node v22.23.3; isolated worktree, temporary test databases and mocked mail/verification providers.

| Check | Actual result |
| --- | --- |
| Full backend suite before adding the missing-secret regression | 488 passed, 0 failed, 0 skipped |
| Additional production missing-secret regression | 1 passed, 0 failed |
| Full frontend suite after final source changes | 28 files, 173 passed, 0 failed |
| Cloudflare Worker regression suite | 9 passed, 0 failed |
| Changed JavaScript files: ESLint | Exit 0, no errors or warnings |
| Changed source files: Prettier | Exit 0, all matched files formatted |
| Production frontend build | Exit 0, 1682 modules transformed |

The route round-trip test covers signup, OTP generation via a mocked mail transport, OTP verification, password login, HttpOnly refresh cookie and session refresh. Other tests cover malformed/reused challenges, provider outage, invalid provider JSON, mail failure followed by retry without duplicate accounts, script-load failure, expiry and widget cleanup.

## Live observations and limitations

- Public landing page and deployed authentication bundle returned HTTP 200 in read-only checks.
- The deployed bundle contains a real-looking configured public site key, not the dummy fallback; its validity against the Cloudflare account is UNKNOWN.
- The observed live CSP permits the Cloudflare challenge origin in script, frame and connection policies.
- Chrome inspection could not run: the browser connector failed to load its request-header policy. No live CAPTCHA was completed.
- The exact cause/error code of the screenshot's Cloudflare failure is UNKNOWN. The lifecycle fixes address confirmed code defects but do not prove account/domain configuration is correct.
- Delivery of a real verification email to an inbox is UNKNOWN. Mocked mail acceptance is not inbox-delivery evidence.
- Local build success is not proof of Render deployment or live authentication success.

## Remaining release gates

1. Publish this isolated auth patch using a Git identity with repository write access.
2. Run its CI and verify the exact deployed commit through `/health`.
3. Verify the real Cloudflare challenge on supported desktop/mobile browsers and inspect the domain/key configuration if it still fails.
4. Verify signup, email receipt, OTP verification, logout/login and refresh with an isolated approved test account.

Verdict: LOCAL CHECKS PASSED; LIVE FIX NOT YET VERIFIED. Do not describe the site as fixed or READY on this evidence alone.

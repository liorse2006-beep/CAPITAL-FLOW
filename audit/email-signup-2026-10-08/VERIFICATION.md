# Email signup recovery — 2026-10-08

Baseline: f42f71605bcb56e7d7d56e8542f3a045db112996. Broad launch audit remains paused.

## Scope

- New signup UI uses self-hosted ALTCHA 3.3.0 / altcha-lib 2.6.0 instead of the failing external Turnstile widget. No new cost, service, secret or migration.
- Existing Google sign-in, password hashing, OTP verification, sessions and throttles remain unchanged. Old Turnstile tokens remain server-validated during rollout; no production bypass.
- Single-use browser-bound proofs expire after ten minutes. The per-boot signing keys reject pre-restart proofs. Bounded store: 2,000 entries; generation concurrency: four; challenge throttle: 20/minute/IP.
- One HTTP worker/instance is required. Horizontal scaling requires a shared proof store first; production already refuses CLUSTER_WORKERS > 1.

## Evidence

- Node 22 backend: 502/502 PASS, zero skipped, 78.626 s.
- Frontend: 178/178 PASS, 29 files. Auth suites after the browser-discovered initialization fix: 9/9 PASS.
- Cloudflare Worker: 9/9 PASS. Cluster relay integration: 1/1 PASS.
- Build: PASS, same-origin PBKDF2 worker 3.20 KB.
- Dependency audit: zero vulnerabilities after patching existing vulnerable transitive overrides. Changed-file lint and Prettier: PASS; full lint has two unchanged warnings outside signup.
- Real browser, built SPA and exact production CSP: signup opens; automatic proof reaches Verified; Create Account is enabled.
- Mobile viewport 375 x 812: usable width 360; dialog x=12, width=336; submit x=33, width=294. No horizontal overflow.
- Production-mode isolated routes: real signed proof -> account -> mock SMTP OTP -> verification -> password login -> refresh. Malformed, expired, mismatched-browser and replayed proofs rejected. Mail failure/retry creates no duplicate account.
- Browser testing reproduced an early SDK `.configure()` crash, which unit mocks did not catch. Fixed by passing initial configuration as attributes; no call to SDK methods before asynchronous load.

## Live deployment evidence

- Released commit: 8b462e2222e875486338a91b7cbe2522b8a4fab1. Fast-forward push to main confirmed; no force push.
- GitHub CI run 37729424692: success. Deploy run 37729424682: success, including Render deployment and exact public release commit verification.
- Render deploy dep-db3i3a5g1s2s73ai9kig: live at 2026-10-08T04:54:32.887927Z, exact released commit above. Existing Starter service and instance count retained; no billing changes or new resources.
- Public /health: HTTP 200 with exact released commit. Public signup challenge: HTTP 200, PBKDF2/SHA-256, no-store, Secure/HttpOnly cookie; CSP worker-src includes self.
- Live guest browser: automatic verification reaches Verified; Create Account enabled; no captured warning/error logs. No credentials entered and no signup submitted.
- Live 375 x 812 responsive viewport: no horizontal overflow; dialog x=12, width=336; submit button enabled. This is responsive emulation, not a physical iPhone test.
- Render error logs from 04:54:32Z to 04:57:07.045Z: no error records returned. Instance-count metric: one. This short observation does not establish long-term availability.
- Empty signup-form screenshot: C:/Users/LiorSe/OneDrive/Desktop/VOLUME SCANNER/audit/signup-verification-live-2026-10-08.jpg. Temporary viewport override reset after testing.

## Actual inbox and production account evidence

- Created private synthetic test inboxes using the free [Mail.tm API](https://docs.mail.tm/); no personal/customer addresses, payment or notification subscriptions used. Inbox and app passwords are different, randomly generated and kept only in process memory. OTPs, tokens and cookies were not logged or written to files.
- First isolated live account: signup, real inbox delivery, OTP verification and password login PASS. Delivery observed at 2026-10-08T05:05:01.327Z, 9,666 ms after signup submission. Test harness then incorrectly joined an expired host-only refresh cookie before the replacement domain cookie, causing a test-only HTTP 401. Corrected the harness cookie handling; application code was not changed for this.
- Second isolated live account, fingerprint 76e04a93d4294ac5: PASS_LIVE_ONE_ISOLATED_ACCOUNT. Started 2026-10-08T05:06:10.823Z, completed 2026-10-08T05:06:28.502Z. Real OTP email was received at 05:06:22.492Z, 10,205 ms after submission. Verification, password login, refresh, authenticated profile and logout all PASS. Returned account was verified, free, non-admin, with no password hash exposed.
- Two synthetic production test accounts were created through normal signup APIs; no existing customer record was modified or deleted. The successful run explicitly logged out. No test inbox was connected to the application as a dependency or mail provider.
- These are actual delivery observations, not an SMTP mock or provider-acceptance-only result. They prove this controlled flow, not guaranteed delivery to every recipient or browser.
- The live signup widget and responsive layout were verified separately in the browser. Final account/OTP API testing used synthetic in-memory credentials; no human password was entered by the agent in the UI.
- Email signup verification is complete for the tested flow. Broad launch audit can now resume as requested.

## Limits

- No physical iPhone end-to-end test was performed. No human Gmail inbox was accessed.
- These results do not establish 100% availability or production capacity.

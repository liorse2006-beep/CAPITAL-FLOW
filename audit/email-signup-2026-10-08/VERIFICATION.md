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

## Still to verify

- Deployment, exact public release, post-deploy health, live signup browser.
- Real approved inbox receipt: UNKNOWN. Mock SMTP is not evidence of real delivery. No production account or real email created by these isolated tests.
- These results do not establish 100% availability or production capacity.

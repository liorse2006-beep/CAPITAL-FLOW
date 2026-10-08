# Realtime recovery — 2026-10-08

## Scope

Based on deployed signup repair `8b462e2222e875486338a91b7cbe2522b8a4fab1`. The frozen launch/security candidate was read only and was not overwritten onto production. No paid infrastructure, database replacement, schema migration, real customer account, payment or customer notification was used.

## Reproduced failures and remediation

- Guest-to-Elite App login initially created no EventSource: `eliteAccess` was evaluated as an effect dependency before its `var` assignment. Ticket acquisition now follows entitlement derivation.
- Isolated device-session regression initially failed: the oldest DB session was deleted, but a cached free-user bearer still resolved. Pruning now returns actually deleted IDs and publishes device-specific revocation. Equal-second ordering is deterministic; the tie case passed before the fix and is hardening, not a separately reproduced failure.
- The live-line server lacked the frozen candidate's bounded stream queues, permission rechecks, revocation listeners and graceful stream shutdown. These protections were integrated separately, preserving signup, checkout and pilot-account behavior.

## Measured local verification

| Check | Actual result |
| --- | --- |
| Node 22 backend | 514/514 passed; 0 failed/skipped; 86,203.8799 ms |
| Frontend | 192/192 passed; 30 files; 10.88 s |
| Stream/session HTTP group | 21/21 passed; 1,412.7783 ms |
| Cloudflare Worker | 9/9 passed |
| Two-worker relay and user isolation | 1/1 passed; 1,419.3751 ms |
| Production build | Passed; same-origin PBKDF2 worker preserved (3.20 KB) |
| Lint | 0 errors; 2 pre-existing warnings |
| Changed-file formatting and whitespace | Passed |

Stream tests cover device eviction without sibling logout, cross-user event isolation, logout, downgrade, block, trial expiry, external session deletion, connection admission, oversized delivery and graceful restart. Ticket tests cover HTTP 503/429, Retry-After, one cookie refresh after 401, no 403 bypass, network/malformed-payload retry, expiry, timeout cancellation, account-switch cleanup and online-event deduplication.

The old cluster harness attempted 30 connections on one session and failed against the new two-connection budget. The corrected harness uses two independent sockets within the real limit, checks admission explicitly, tests a separate user's private event and retries only unobserved worker distribution, never a delivery/authorization failure. A sandbox write restriction on replacing an earlier generated build was resolved by allowing the normal build to write its own isolated output directory.

Lint warnings remain App's existing checkout `location.hash` dependency and WelcomeTierModal's synchronous effect-state update. These are not new reported failures.

## Read-only Render observations — not an uptime guarantee

Window: 2026-10-07T05:00:00Z through 2026-10-08T05:30:19Z. Render reported 12 HTTP 502 responses in three five-minute buckets: October 7 at 10:55Z, 11:10Z and 17:05Z (4 each). Request logs were unavailable. Bounded application-log windows showed background-scan summaries but no corresponding crash/cause. Historical root cause remains **UNKNOWN**.

Five-minute memory measurements stayed below the configured 512-MiB limit: old instance maximum 132,276,220 bytes; then-current signup instance maximum 90,025,980 bytes. This does not rule out a short spike, dependency outage or future failure.

## Pending live verification and remaining audit

The new commit must pass CI/deployment and be observed at the public health endpoint; live signup must remain usable. Local fixture throughput and the 200-stream per-worker protection are not production concurrent-user capacity. Full launch/security review remains partial. Its independent baseline worker returned an account-usage-limit error without certified coverage; no paid upgrade was requested or performed.

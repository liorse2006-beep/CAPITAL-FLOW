# Bounded Web Push delivery — 2026-10-08

## Scope

Separate live-line integration based on `6793c8b3aa283e1a1ded38148a980d1ada6d683b`, then fast-forwarded over the concurrent SEO-only descendants through `445168f7511cf3a5f841f695b82883c29fe0392f`. Their sector copy and sitemap edits were retained unchanged; frontend tests and build were repeated after the fast-forward. Deployed signup and realtime recovery were preserved. The immutable security candidate was not edited. No infrastructure, provider, database URL, secrets, billing or schema was changed. Fixtures used isolated temporary databases, generated test keys, mocked DNS and mocked push transport. No customer push, market-provider request or payment was sent.

## Changes

- HTTPS-only destinations reject credentials, fragments, nonstandard ports, local/reserved/embedded IPs and DNS answers containing private addresses. Public addresses are pinned in TLS; no second DNS resolution or redirect is followed. Certificate verification stays enabled.
- A 15-second total transport deadline and 64-KiB response ceiling close interrupted, incomplete, trickling or oversized responses without retaining their raw body.
- Shared push concurrency is bounded to 8 with bounded waiting work; each account can register 10 notification devices. Capacity checks lock the owner row, and ownership is enforced in the atomic upsert as well as the preliminary read.
- After queue/DNS delay, current device ownership and keys are checked before sending. A browser switching accounts does not receive the previous owner's queued private payload. Expired-device cleanup is owner-scoped.
- Local SQLite asynchronous callback transactions and ordinary queries are serialized with a bounded queue. PostgreSQL retains its existing transaction connections/owner-row locks. No database replacement or schema migration.
- Alert copy is unchanged: any nonempty result list uses the normal signal notice; only an empty list uses the unverified-signal notice.

## Actual checks

| Check | Measured result |
| --- | --- |
| Final backend, Node 22 | 528/528 passed; 0 failed/cancelled/skipped; 87,899.83 ms |
| Push/transport/transaction group | 21/21 passed; 1,720.0164 ms |
| Frontend | 192/192 passed; 30 files; 10.33 s |
| Worker | 9/9 passed; 102.3527 ms |
| Two-worker relay/user isolation fixture | 1/1 passed; 1,570.0273 ms |
| Production build | Passed; 1,687 modules; same-origin PBKDF2 worker preserved |
| Lint | 0 errors; 2 unchanged pre-existing warnings |
| Changed-file formatting and whitespace | Passed |

The atomic-race test initially failed because its mock incorrectly returned an existing subscription during the preliminary lookup. Correcting the mock reached the intended conditional-write boundary; final tests passed. Formatting initially encountered sandbox EPERM; normal formatting was then permitted for the exact isolated changed files.

## Limits and remaining work

Push-provider acceptance does not prove a physical device displayed a notification. This change does not claim exactly-once remote delivery, completed durable-outbox integration, production-user capacity, complete security coverage or guaranteed future uptime. The wider launch review remains partial. The older direct-send crash/restart gap needs separate transaction/outbox integration and tests. No customer payload or real push endpoint was used to validate these protections.

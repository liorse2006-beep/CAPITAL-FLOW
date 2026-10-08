# Capital Flow — isolated launch retest, 2026-10-08

This is an evidence checkpoint, **not a public-launch READY certificate**. No load was sent to Production, no customer data was used, and no real payment, customer email or customer push was initiated. Existing Render Starter billing was not changed.

## Implemented / verified scope

- Durable scheduled-scan/digest occurrence ledgers, atomic result/notification/outbox persistence, bounded delivery retries and per-device acceptance receipts.
- Fresh entitlement and recipe checks before deferred actions; an old worker cannot overwrite a newer claim. Notification detail stays owner-scoped, including after a client account switch.
- Shutdown stops timer admission and drains already-admitted background jobs before closing the database. Forced termination still requires recovery; remote push acceptance followed by a crash before receipt storage is inherently ambiguous, so physical exactly-once delivery is **not** claimed.
- Provider symbol/numeric/timestamp validation, no request-time replacement for a missing observation time, regular-session timestamp fidelity, and single-probe circuit recovery.
- Any saved result row uses the normal notification copy. Only an empty table uses `We couldn't verify a market signal this time.` Partial/unknown/stale status remains available in saved-result details and logs; it is not disguised as complete data.
- Load-tool production-host, path, redirect and maximum-user guards. No new paid infrastructure or replacement database was introduced.
- CI/deploy changed-file formatting now uses an argument-safe Node script and fetched commit history. The old double-escaped shell expression and ignored missing-base error could silently skip this gate; three dedicated gate regressions passed.

## Measured local capacity

Actual run: `2026-10-08T11:21:10.406Z` to `2026-10-08T11:21:20.591Z`, using `scripts/isolated-capacity-audit.cjs`, a file-backed isolated database, synthetic signed sessions and warmed synthetic scan data. Each virtual user made four route requests per cycle for three cycles. Latency includes response-body transfer.

| Concurrent test users | Requests | Failures | p50 ms | p95 ms | p99 ms  | Max ms  | RSS MiB |
| --------------------- | -------- | -------- | ------ | ------ | ------- | ------- | ------- |
| 1                     | 12       | 0        | 2.55   | 39.39  | 39.39   | 39.39   | 129.46  |
| 5                     | 60       | 0        | 7.88   | 12.72  | 13.85   | 13.85   | 120.30  |
| 25                    | 300      | 0        | 30.06  | 42.65  | 49.41   | 51.00   | 131.21  |
| 50                    | 600      | 0        | 54.51  | 73.13  | 79.92   | 80.69   | 149.30  |
| 100                   | 1200     | 0        | 96.88  | 135.32 | 153.82  | 154.66  | 153.84  |
| 200                   | 2400     | 0        | 192.24 | 266.77 | 279.72  | 290.75  | 189.02  |
| 500                   | 6000     | 9        | 422.66 | 512.92 | 1095.99 | 1405.16 | 304.93  |

All identity/result-mismatch counters were zero. Provider network operations were zero. At 500 users, 5991 requests returned HTTP 200 and nine failed with `ECONNREFUSED`; that stage failed the zero-error assertion. The connection-failure root cause is **UNKNOWN**, not proven to be a database or Render limit. This short warmed local test excludes real upstream limits, sustained load, mobile radio conditions and SSE. **Production safe capacity and public-launch limit remain UNKNOWN.** Two hundred is an observed local passing stage, not a promise that Render supports two hundred customers.

## Provider continuity — actual fault-injection run

`test/providerContinuity.integration.test.js` ran the real quote cache, quick-scan adapter and owner-scoped notification persistence against mocked upstream responses. Provider calls: four; no external network allowed. Observation time: `2026-10-08T15:07:18.000Z` where data existed. Times below are local mock-cycle duration, not actual provider outage or recovery SLA.

| Scan cycle | Requested symbols | Verified symbols | Coverage | Timestamp                | Results | Provider status | Errors                    | Verdict |
| ---------- | ----------------- | ---------------- | -------- | ------------------------ | ------- | --------------- | ------------------------- | ------- |
| 1          | 2                 | 0                | 0%       | null                     | 0       | unavailable     | Synthetic provider outage | PASS    |
| 2          | 2                 | 1                | 50%      | 2026-10-08T15:07:18.000Z | 1       | partial         | One missing symbol        | PASS    |
| 3          | 2                 | 2                | 100%     | 2026-10-08T15:07:18.000Z | 2       | complete        | None                      | PASS    |

| Scenario                          | Expected behavior                                       | Actual behavior                                                                                                       | Data status    | Alert created                                     | Recovery time                                                            | Verdict      |
| --------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | ------------ |
| Total provider failure            | Distinguish outage from normal empty success            | Zero rows, null timestamp, neutral no-verified-signal copy                                                            | unavailable    | One saved completion notice; not a trading signal | Detection/mock cycle 1.408 ms; live UNKNOWN                              | PASS locally |
| One available result              | Normal concise signal copy, preserve partial detail     | One saved row and normal copy                                                                                         | partial        | One saved notice                                  | Mock cycle 2.470 ms; live UNKNOWN                                        | PASS locally |
| Restored provider                 | Complete real fixture rows, no duplicates               | Two distinct saved rows                                                                                               | complete       | One saved notice                                  | Mock restored cycle 0.919 ms; live UNKNOWN                               | PASS locally |
| Cross-user notification lookup    | Deny another owner's record                             | Undefined detail                                                                                                      | Not applicable | None                                              | Not applicable                                                           | PASS locally |
| Killed delivery worker            | Keep one notification, retry only unacknowledged device | Four real child processes; first device acceptance receipt survived; only second retried; final replay did not resend | Durable outbox | One notification                                  | Test 2316.9153 ms; the 120-second lease expiry was simulated, not waited | PASS locally |
| Delivery reaches a physical phone | Confirm actual device display                           | Not performed in this retest                                                                                          | UNKNOWN        | UNKNOWN                                           | UNKNOWN                                                                  | UNKNOWN      |

Provider failures are identified and stored by the tested paths. Scheduled empty push wording is deliberately neutral; quality detail is not inferred from notification copy. An unverified individual row does not consume an armed watchlist alert; one verified row from an otherwise partial scan can. Live failure-detection/recovery duration, silent failures elsewhere, and quota exhaustion over a real billing window remain UNKNOWN. A calibrated numerical confidence score has not been measured and is not invented.

## Test and UI evidence

- Full backend: **565/565**, zero failed/skipped, duration 88128.1933 ms.
- Final full frontend including the account-switch regression: **207/207**, 31 files, duration 7.94 seconds.
- Cloudflare Worker: **9/9**, duration 88.3365 ms.
- Two-worker SSE integration: **1/1**, duration 1548.6804 ms; checks cross-worker delivery and cross-user isolation.
- npm production dependency audit: **0** reported vulnerabilities of every severity. This is not a full source-security certificate.
- Responsive real-source modal fixture: 120 synthetic rows; desktop 1440×900, mobile 390×844 and 320×568; measured no horizontal page overflow and modal fully inside each viewport. Close target 44×44 after repair. Empty-table copy and close action confirmed through the isolated browser. Physical iOS push behavior is not claimed from viewport emulation.
- Lint: zero errors; one pre-existing `WelcomeTierModal` effect warning remains. Changed-source formatting passed; a whole-worktree format check flags Windows CRLF in unchanged baseline files. CI checks changed source files on Linux.

## Remaining audit coverage / launch gate

The native immutable Standard source audit remains **46/389 fully reviewed files**, with one validated legacy-target finding and 65 effective-resource relationships still requiring complete architecture reconciliation. The legacy warm-session finding has a separately tested current-branch fix; that does not close the unreviewed files. This checkpoint must not be used to label items 1–6 globally complete or all security states PASS.

Prior live release `554cb56def6f1285613ee41771b70e2dace54531` was verified in Render and `/health`. Deployment and live verification of this new patch must be recorded separately after the CI gates succeed. No claim is made here that an uncommitted or merely pushed change is already live.

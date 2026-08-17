# Capital Flow launch-readiness runbook

This runbook is the operational handoff for the nine launch-readiness gaps addressed in the current implementation. It intentionally separates code-level evidence from checks that require an external account, device, or hosting console.

## Independent status topology

Run the status service as a separate Render service with a separate status database:

```text
main app + main DB  ── monitored by ──>  independent status service + status DB
                                          │
                                          ├─ public /status
                                          ├─ private /status/admin
                                          ├─ five-minute checks
                                          ├─ heartbeat watchdog
                                          └─ status backup email

GitHub Actions keep-alive ───────────────> /health of the independent host
```

The status service must have its own `STATUS_TURSO_DB_URL` and `STATUS_TURSO_AUTH_TOKEN`. Never point those variables at the application database. `STATUS_TARGET_URL` is the main public origin. `STATUS_INTERNAL_TOKEN` is shared only by the main app's protected market-data probe and the independent checker; if it is absent in production, that probe returns 503 instead of becoming an unauthenticated data endpoint.

## Detection and recovery policy

- Checks run server-side every five minutes; the page being open is not required.
- A failed check is retried after `STATUS_RETRY_DELAY_MS` and both attempts are stored.
- An incident is created only after `STATUS_FAILURE_CONFIRMATIONS` consecutive final failures.
- A recovery requires `STATUS_RECOVERY_CONFIRMATIONS` consecutive operational checks.
- One active incident is maintained per component; duplicate outage emails are deduplicated in `status_notification_deliveries`.
- External dependencies such as Yahoo Finance are visible on the status page but are suppressed from administrator outage email unless an application-facing component is also affected.
- Latency thresholds and component criticality determine degraded versus outage status.

## Worker heartbeat

Every successful cycle writes `last_cycle_at`, `last_cycle_status`, duration, and the next expected cycle to `status_meta`. The watchdog reads those values and creates a `monitoring-worker` incident when the heartbeat becomes stale. `status_worker_leases` prevents duplicate cycle/watchdog work when more than one instance is accidentally running. The GitHub Actions watchdog is the second boundary: it detects a completely unreachable status process, which an in-process watchdog cannot detect by definition.

## Independent status backup and restore

Backups include only status components, checks, incidents, incident updates, notification delivery state, alert recipients, maintenance, daily availability rollups, and status metadata. Raw checks are retained for the configured window and converted into idempotent daily rollups before deletion, so useful history remains bounded and durable. Backups are gzip-compressed and sent to `STATUS_BACKUP_RECIPIENTS`, `STATUS_ALERT_RECIPIENTS`, and `ADMIN_EMAIL` where valid.

```bash
node restoreStatusDb.js capital-flow-status-backup-YYYY-MM-DD.json.gz
node restoreStatusDb.js capital-flow-status-backup-YYYY-MM-DD.json.gz --confirm
```

The first command is always a dry run. Restore only to a verified status database target and retain the original before a confirmed restore.

## Verification commands

```bash
npm run test:all
npm run lint
npm run format:check
npm audit --omit=dev --audit-level=high
npm run build
npm run load:500                 # requires a local/staging target variable
npm run wallet:verify -- https://capitalflow.vip
```

The load test is read-only and refuses production targets. The wallet tool verifies the domain file and security policy only. Complete the final wallet authorization on a supported Apple device/browser and Chrome/Android device with eligible test cards, then verify the Whop `payment_succeeded` webhook upgrades the test account exactly once.

## Failure-simulation checklist

Run these against staging or a disposable status database, never against a live paying-user outage:

1. Return HTTP 500 from the homepage and confirm a single major incident, one outage email, public status, and a resolved email after recovery.
2. Delay an API response beyond its timeout and confirm the endpoint is degraded/failed with response-time evidence.
3. Make the database probe fail while the frontend remains reachable and confirm the email names the database layer without exposing credentials.
4. Make only Yahoo Finance fail and confirm the status page shows the external dependency while administrator email remains quiet when the product fallback still works.
5. Stop the worker timer or seed an old `last_cycle_at` and confirm the monitoring-worker incident/health failure.
6. Reject Resend calls and confirm the incident remains stored with a failed delivery record and the monitor continues running.
7. Alternate a component up/down for at least six final checks and confirm flapping is marked degraded without creating a new incident every cycle.
8. Restore a known status backup in dry-run mode, mutate a disposable status database, then confirm-restore and compare row counts and sentinel values.

The repository tests cover the deterministic parts of these cases. Staging failure simulations and real wallet authorization remain deployment/account checks and must be recorded with their observed timestamps and provider response IDs.

// Keep the backup and restore surfaces on the exact same allowlist.
// Identifiers from a backup file must never be interpolated into SQL unless
// they have been checked against this list (and the live table schema).
const BACKUP_TABLES = Object.freeze([
  'users',
  'watchlist',
  'watchlist_alerts',
  'pilot_allowlist',
  'push_subscriptions',
  'feedback',
  'coupons',
  'scheduled_scans',
  'capital_flow_radars',
  'radar_states',
  'radar_events',
  'radar_schedule_runs',
  'radar_run_snapshots',
  'chat_messages',
  'notifications',
  'admin_audit_log',
  'processed_webhook_events',
  'ai_usage',
  'scan_reservations',
  'site_visits',
  'app_meta',
]);

module.exports = { BACKUP_TABLES };

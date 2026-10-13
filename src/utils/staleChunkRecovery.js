// A tab opened before a deployment can reference a deleted lazy chunk.
// Recover once per entry-bundle version, without storing any account/form data.
export const RECOVERY_KEY = 'cf_stale_chunk_recovery';
const STALE_IMPORT =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/;

export function hasCriticalFlow(documentTarget = document) {
  return Boolean(
    documentTarget.querySelector(
      '[role="dialog"], [aria-modal="true"], input[type="password"], input[autocomplete="one-time-code"]'
    )
  );
}

export function installStaleChunkRecovery({
  target = window,
  storage,
  version = new URL(import.meta.url).pathname.split('/').pop(),
  canReload = () => !hasCriticalFlow(),
  isOnline = () => navigator.onLine !== false,
  reload = () => window.location.reload(),
} = {}) {
  const handler = (event) => {
    if (!STALE_IMPORT.test(event.payload?.message || '') || !isOnline() || !canReload()) return;
    // Unknown/unavailable storage must not turn an outage into a reload loop.
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(version || '')) return;
    let previous;
    let activeStorage;
    try {
      activeStorage = storage === undefined ? window.sessionStorage : storage;
      previous = activeStorage.getItem(RECOVERY_KEY);
      if (previous === version) return;
      activeStorage.setItem(RECOVERY_KEY, version);
      reload();
      event.preventDefault();
    } catch {
      try {
        if (activeStorage?.getItem(RECOVERY_KEY) === version) {
          if (previous === null) activeStorage.removeItem(RECOVERY_KEY);
          else if (typeof previous === 'string') activeStorage.setItem(RECOVERY_KEY, previous);
        }
      } catch {
        /* The ordinary error boundary remains available. */
      }
    }
  };
  target.addEventListener('vite:preloadError', handler);
  return () => target.removeEventListener('vite:preloadError', handler);
}

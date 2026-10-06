export const TURNSTILE_LOAD_TIMEOUT_MS = 15000;

export function getTurnstileSiteKey() {
  const configured = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
  // Test keys are a local-development convenience, never a production fallback.
  return configured || (import.meta.env.PROD ? '' : '1x00000000000000000000AA');
}

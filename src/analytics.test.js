import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sdk;
let releaseSdk;
let sdkRequested;
let analyticsModule;
let failSdkLoad;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubEnv('VITE_POSTHOG_KEY', 'synthetic-public-test-key');
  sdk = {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  };
  sdkRequested = vi.fn();
  analyticsModule = null;
  failSdkLoad = false;
  const barrier = new Promise((resolve) => {
    releaseSdk = resolve;
  });
  vi.doMock('posthog-js', async () => {
    sdkRequested();
    await barrier;
    if (failSdkLoad) throw new Error('synthetic unavailable bundle');
    return { default: sdk };
  });
});

afterEach(async () => {
  releaseSdk();
  await new Promise((resolve) => setTimeout(resolve, 10));
  analyticsModule?.revokeConsent();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
});

async function settle() {
  releaseSdk();
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function loadAnalytics() {
  analyticsModule = await import('./analytics');
  return analyticsModule;
}

describe('optional analytics consent and identity lifecycle', () => {
  it('does not load the collector just to clear identity without consent', async () => {
    const analytics = await loadAnalytics();
    analytics.reset();
    await settle();
    expect(sdkRequested).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('does not initialize or send queued events after consent is withdrawn during loading', async () => {
    const analytics = await loadAnalytics();
    analytics.giveConsent();
    analytics.track('synthetic-event');
    analytics.identify('synthetic-account');
    await vi.waitFor(() => expect(sdkRequested).toHaveBeenCalledOnce());
    analytics.revokeConsent();
    await settle();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
    expect(sdk.identify).not.toHaveBeenCalled();
  });

  it('opts out and clears an already initialized collector on revocation', async () => {
    const analytics = await loadAnalytics();
    analytics.giveConsent();
    await settle();
    expect(sdk.init).toHaveBeenCalledOnce();
    analytics.revokeConsent();
    expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
    expect(sdk.reset).toHaveBeenCalledOnce();
    analytics.track('must-not-send');
    analytics.identify('must-not-identify');
    await settle();
    expect(sdk.capture).not.toHaveBeenCalled();
    expect(sdk.identify).not.toHaveBeenCalled();
  });

  it('stops the collector when preferences are reset, before showing a new consent choice', async () => {
    const analytics = await loadAnalytics();
    analytics.giveConsent();
    await settle();
    analytics.resetConsent();
    expect(analytics.hasAnswered()).toBe(false);
    expect(analytics.hasConsented()).toBe(false);
    expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
    expect(sdk.reset).toHaveBeenCalledOnce();
  });

  it('discards an old account identity queued before logout', async () => {
    const analytics = await loadAnalytics();
    analytics.giveConsent();
    analytics.identify('old-synthetic-account');
    analytics.track('old-account-event');
    analytics.reset();
    await settle();
    expect(sdk.identify).not.toHaveBeenCalled();
    expect(sdk.capture).not.toHaveBeenCalled();
    analytics.identify('new-synthetic-account');
    await settle();
    expect(sdk.identify).toHaveBeenCalledExactlyOnceWith('new-synthetic-account', undefined);
  });

  it('fails closed without crashing when browser consent storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('synthetic denied storage');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('synthetic denied storage');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('synthetic denied storage');
    });
    const analytics = await loadAnalytics();
    expect(() => analytics.giveConsent()).not.toThrow();
    expect(() => analytics.revokeConsent()).not.toThrow();
    expect(() => analytics.resetConsent()).not.toThrow();
    expect(analytics.hasConsented()).toBe(false);
    analytics.track('must-not-send');
    await settle();
    expect(sdk.init).not.toHaveBeenCalled();
  });

  it('re-enables the same initialized collector only after a new explicit consent', async () => {
    const analytics = await loadAnalytics();
    analytics.giveConsent();
    await settle();
    analytics.revokeConsent();
    analytics.giveConsent();
    analytics.track('new-consented-event');
    await settle();
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.opt_in_capturing).toHaveBeenCalledTimes(2);
    expect(sdk.capture).toHaveBeenCalledExactlyOnceWith('new-consented-event', undefined);
  });

  it('stops SDK automatic capture when another browser tab revokes consent', async () => {
    const analytics = await loadAnalytics();
    analytics.giveConsent();
    await settle();
    localStorage.setItem('cf_analytics_consent', 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: 'cf_analytics_consent', newValue: 'false' }));
    expect(sdk.opt_out_capturing).toHaveBeenCalledOnce();
    expect(sdk.reset).toHaveBeenCalledOnce();
  });

  it('does not load a collector when it is not configured, even with consent', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const analytics = await loadAnalytics();
    analytics.giveConsent();
    analytics.track('synthetic-event');
    analytics.identify('synthetic-account');
    await settle();
    expect(sdkRequested).not.toHaveBeenCalled();
  });

  it('contains an optional bundle-load failure without an unhandled rejection', async () => {
    failSdkLoad = true;
    const analytics = await loadAnalytics();
    expect(() => analytics.giveConsent()).not.toThrow();
    analytics.track('synthetic-event');
    analytics.identify('synthetic-account');
    await settle();
    expect(sdk.init).not.toHaveBeenCalled();
  });
});

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UiLanguageContext } from '../../context/UiLanguageContext';
import TierComparisonMatrix from './TierComparisonMatrix';
import CookieConsent from './CookieConsent';
import AccessibilityWidget from './AccessibilityWidget';
import ErrorBoundary from './ErrorBoundary';
import InstallPrompt from './InstallPrompt';
import useInstallPrompt from '../../hooks/useInstallPrompt';
import { BILLING_COUNTRIES } from '../../utils/billingCountries';

vi.mock('../../hooks/useInstallPrompt', () => ({ default: vi.fn() }));

function renderChrome(language) {
  return render(
    <MemoryRouter>
      <UiLanguageContext.Provider value={language}>
        <TierComparisonMatrix userTier="free" onCheckout={vi.fn()} />
        <CookieConsent />
        <AccessibilityWidget />
      </UiLanguageContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('a11y-high-contrast');
  window.history.replaceState(null, '', '/');
});

describe('Hebrew application chrome', () => {
  it.each([
    ['en', false, 'Add Capital Flow to your home screen'],
    ['en', true, 'Add Capital Flow to your Home Screen for notifications'],
    ['he', false, 'הוספת Capital Flow למסך הבית'],
    ['he', true, 'לקבלת התראות באייפון, הוסף את Capital Flow למסך הבית'],
  ])('keeps the install prompt in %s (iOS=%s)', (language, isIOS, title) => {
    vi.useFakeTimers();
    vi.mocked(useInstallPrompt).mockReturnValue({ canShow: true, isIOS, triggerInstall: vi.fn(), dismiss: vi.fn() });
    const view = render(
      <UiLanguageContext.Provider value={language}>
        <InstallPrompt />
      </UiLanguageContext.Provider>
    );
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveAttribute('lang', language);
    expect(screen.getByRole('banner')).toHaveAttribute('dir', language === 'he' ? 'rtl' : 'ltr');
    if (language === 'en') expect(view.container.textContent).not.toMatch(/[\u0590-\u05ff]/);
    else expect(screen.getByRole('button', { name: 'סגירה' })).toBeInTheDocument();
  });

  it.each(['/scanner', '/'])('shows the outer error fallback in Hebrew on %s', (path) => {
    window.history.replaceState(null, '', path);
    const boundary = new ErrorBoundary({});
    boundary.state = { hasError: true };
    const view = render(boundary.render());
    expect(view.container.firstChild).toHaveAttribute('lang', 'he');
    expect(view.container.firstChild).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'לא הצלחנו להציג את המסך' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'טעינה מחדש' })).toBeInTheDocument();
  });

  it('preserves the existing Hebrew landing pricing, privacy and accessibility', () => {
    const view = renderChrome('he');
    expect(screen.getByRole('button', { name: 'בחירת Premium' })).toBeInTheDocument();
    expect(screen.getAllByText('סריקות שוק')).toHaveLength(2);
    expect(screen.getByRole('dialog', { name: 'העדפות פרטיות' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'ללא אנליטיקה' })).toBeInTheDocument();
    expect(view.container.querySelector('.tier-matrix-scroll')).toHaveAttribute('lang', 'he');
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת תפריט נגישות' }));
    expect(screen.getByRole('dialog', { name: 'נגישות' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'ניגודיות גבוהה' })).toBeInTheDocument();
  });

  it('uses Hebrew billing-country names with unchanged ISO codes', () => {
    expect(BILLING_COUNTRIES.find((country) => country.code === 'US')?.name).toBe('ארצות הברית');
    expect(BILLING_COUNTRIES.find((country) => country.code === 'IL')?.name).toBe('ישראל');
    expect(BILLING_COUNTRIES).toHaveLength(249);
    expect(BILLING_COUNTRIES.every((country) => /^[A-Z]{2}$/.test(country.code))).toBe(true);
  });
});

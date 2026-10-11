import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CookieConsent from './CookieConsent';
import { hasAnswered, hasConsented } from '../../analytics';

describe('first-visit cookie consent', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('is visible for a new guest and leaves analytics off until explicit acceptance', () => {
    render(<CookieConsent />);
    expect(screen.getByRole('dialog', { name: 'העדפות פרטיות' })).toHaveAttribute('dir', 'rtl');
    expect(hasConsented()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'ללא אנליטיקה' }));
    expect(hasAnswered()).toBe(true);
    expect(hasConsented()).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not treat a corrupt or historical storage value as a consent choice', () => {
    localStorage.setItem('cf_analytics_consent', 'undefined');
    render(<CookieConsent />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(hasConsented()).toBe(false);
  });

  it('remembers a refusal on a subsequent mount without enabling analytics', () => {
    localStorage.setItem('cf_analytics_consent', 'false');
    render(<CookieConsent />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hasConsented()).toBe(false);
  });
});

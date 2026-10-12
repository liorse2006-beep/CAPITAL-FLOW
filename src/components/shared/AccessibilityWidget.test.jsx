import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AccessibilityWidget from './AccessibilityWidget';

describe('guest accessibility controls', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.classList.remove('a11y-high-contrast', 'a11y-highlight-links');
    document.documentElement.style.zoom = '';
    document.documentElement.removeAttribute('data-theme');
  });

  const mount = () =>
    render(
      <MemoryRouter>
        <AccessibilityWidget />
      </MemoryRouter>
    );

  it('offers a real high-contrast option, saves it and restores it after remount', () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open accessibility menu' }));
    const contrastRow = screen.getByText('High contrast').closest('.a11y-row');
    fireEvent.click(within(contrastRow).getByRole('button', { name: 'High contrast' }));
    expect(document.documentElement).toHaveClass('a11y-high-contrast');
    expect(within(contrastRow).getByRole('button', { name: 'High contrast' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('vs_a11y_settings')).highContrast).toBe(true);
    view.unmount();
    mount();
    expect(document.documentElement).toHaveClass('a11y-high-contrast');
  });

  it('closes with Escape and returns keyboard focus to the accessibility opener', () => {
    mount();
    const opener = screen.getByRole('button', { name: 'Open accessibility menu' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Accessibility' })).toHaveAttribute('dir', 'ltr');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('resets text size, theme, contrast and highlighted links without signing in', () => {
    localStorage.setItem(
      'vs_a11y_settings',
      JSON.stringify({ fontStep: 3, highContrast: true, highlightLinks: true, theme: 'light' })
    );
    mount();
    expect(document.documentElement.style.zoom).toBe('1.4');
    fireEvent.click(screen.getByRole('button', { name: 'Open accessibility menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset settings' }));
    expect(document.documentElement.style.zoom).toBe('1');
    expect(document.documentElement).not.toHaveClass('a11y-high-contrast', 'a11y-highlight-links');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicLegalPage from './PublicLegalPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('public legal pages without a session', () => {
  it.each([
    ['/policy', 'Terms of Service & Privacy Policy'],
    ['/accessibility', 'Accessibility Statement'],
  ])('renders %s immediately without authentication, data requests or a paywall', (path, title) => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <PublicLegalPage path={path} />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('link', { name: 'Capital Flow — back to the app' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

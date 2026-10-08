import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import DeleteAccountModal from './DeleteAccountModal';

function pending() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('account deletion request lifecycle', () => {
  it('does not sign out a replacement account after the original screen unmounts', async () => {
    const request = pending();
    const fetchMock = vi.fn(() => request.promise);
    vi.stubGlobal('fetch', fetchMock);
    const onDeleted = vi.fn();
    const view = render(
      <DeleteAccountModal getToken={() => 'synthetic-old-token'} onDeleted={onDeleted} onClose={vi.fn()} />
    );
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Permanently Delete My Account' }));
    view.unmount();
    await act(async () => request.resolve({ ok: true }));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('ignores completion after the signed-in token changes without remounting', async () => {
    const request = pending();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => request.promise)
    );
    let token = 'synthetic-old-token';
    const onDeleted = vi.fn();
    render(<DeleteAccountModal getToken={() => token} onDeleted={onDeleted} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Permanently Delete My Account' }));
    token = 'synthetic-replacement-token';
    await act(async () => request.resolve({ ok: true }));
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('still requires explicit confirmation and calls the success callback once', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const onDeleted = vi.fn();
    render(<DeleteAccountModal getToken={() => 'synthetic-token'} onDeleted={onDeleted} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Permanently Delete My Account' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Type DELETE to confirm/), { target: { value: 'DELETE' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Permanently Delete My Account' })));
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-token');
  });
});

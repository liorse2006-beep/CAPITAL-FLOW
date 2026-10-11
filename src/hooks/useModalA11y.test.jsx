import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import useModalA11y from './useModalA11y';

function PreferencesModal({ onClose }) {
  const panelRef = useModalA11y(onClose);
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1}>
      <h2 id="modal-title">Preferences</h2>
      <button type="button">First action</button>
      <button type="button">Last action</button>
    </div>
  );
}

function ModalHarness() {
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open preferences
      </button>
      {open && (
        <PreferencesModal
          onClose={() => {
            setOpen(false);
            setClosed(true);
          }}
        />
      )}
      {closed && <p>Closed</p>}
    </>
  );
}

function ConditionalModal({ enabled, onClose, name = 'Conditional dialog' }) {
  const panelRef = useModalA11y(onClose, enabled);
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1}>
      <button type="button">{name} action</button>
    </div>
  );
}

describe('useModalA11y', () => {
  it('exposes a screen-reader dialog boundary and traps forward/backward Tab focus', () => {
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open preferences' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Preferences' });
    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and restores focus to the opener', () => {
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open preferences' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not capture keyboard input or lock the page while disabled', () => {
    const onClose = vi.fn();
    const originalOverflow = document.body.style.overflow;
    const view = render(<ConditionalModal enabled={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe(originalOverflow);

    view.rerender(<ConditionalModal enabled onClose={onClose} />);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.body.style.overflow).toBe(originalOverflow);
  });

  it('only closes the topmost confirmation instead of its parent dialog', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <>
        <ConditionalModal enabled onClose={outerClose} name="Outer dialog" />
        <ConditionalModal enabled onClose={innerClose} name="Inner dialog" />
      </>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
    const innerAction = screen.getByRole('button', { name: 'Inner dialog action' });
    innerAction.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(innerAction);
  });
});

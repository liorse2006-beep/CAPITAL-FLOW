import { useEffect, useRef } from 'react';

// Shared modal accessibility behavior: Escape closes, focus stays inside the
// modal while it is open, and focus returns to the element that opened it.
// Returns a ref to attach to the modal's outer panel element (not the overlay
// backdrop). The panel itself must expose role="dialog" or role="alertdialog"
// and aria-modal="true" so assistive technology gets the same boundary.
export default function useModalA11y(onClose) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef(null);

  // Modal contents can change while the same panel stays mounted (for
  // example, pricing -> checkout). Keep Escape wired to the latest close
  // behavior without re-running the focus/scroll-lock lifecycle.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    function getFocusableElements(panel) {
      return Array.from(
        panel.querySelectorAll(
          'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
    }

    function handleKeyDown(e) {
      const panel = panelRef.current;
      if (!panel) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    document.addEventListener('keydown', handleKeyDown);

    const toFocus = panelRef.current;
    if (toFocus) {
      const firstField = toFocus.querySelector('input, textarea, select, button:not([aria-label="Close"])');
      (firstField || toFocus).focus({ preventScroll: true });
    }

    // Without this, a modal taller than the viewport (e.g. the checkout
    // embed) can't scroll itself — the page behind it scrolls instead since
    // the body underneath the fixed overlay is still the scrollable element.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const returnFocus = returnFocusRef.current;
      if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return panelRef;
}

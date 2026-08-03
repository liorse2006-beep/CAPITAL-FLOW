import { useEffect, useRef } from 'react';

// Shared modal accessibility behavior: Escape closes, and focus moves onto
// the modal panel itself on open so keyboard/screen-reader users don't stay
// stranded on whatever was focused before the modal opened. Returns a ref to
// attach to the modal's outer panel element (not the overlay backdrop).
export default function useModalA11y(onClose) {
  const panelRef = useRef(null);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on mount/unmount, not every onClose identity change
  }, []);

  return panelRef;
}

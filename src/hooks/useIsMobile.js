import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 768px)';

function matchesMobileQuery() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY).matches
    : false;
}

/**
 * Keep behavior decisions in sync with the responsive breakpoint used by the
 * app stylesheet. This is intentionally JS-backed as well as CSS-backed so
 * mobile-only features are not merely invisible: they are not mounted or
 * callable at phone widths.
 */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(matchesMobileQuery);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(media.matches);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, []);

  return isMobile;
}

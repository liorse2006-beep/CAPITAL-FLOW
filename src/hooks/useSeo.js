import { useEffect } from 'react';

const SITE_URL = 'https://capitalflow.vip';
const DEFAULT_OG_IMAGE = SITE_URL + '/og-image.png';

// Sets one meta/link tag's attribute and returns whatever value it had
// before, so callers can restore it on cleanup.
function setAttr(selector, attr, value) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const previous = el.getAttribute(attr);
  if (value != null) el.setAttribute(attr, value);
  return previous;
}

// Keeps <title>, the meta description, the canonical link, and the
// Open Graph / Twitter tags in sync with whichever route is actually
// mounted. Before this hook existed every route inherited the same static
// tags from index.html, including a canonical that always pointed at "/",
// which told Google every other route was a duplicate of the homepage and
// kept /flow, /ma and /policy from ranking on their own. Call this once
// near the top of a page-level component with that page's real
// title/description/path; values are restored on unmount so navigating
// away never leaves stale tags behind.
export default function useSeo({ title, description, path, ogImage }) {
  useEffect(() => {
    const url = SITE_URL + (path || '/');
    const previousTitle = document.title;
    if (title) document.title = title;

            const previousDescription = setAttr('meta[name="description"]', 'content', description);
    const previousOgTitle = setAttr('meta[property="og:title"]', 'content', title);
    const previousOgDescription = setAttr('meta[property="og:description"]', 'content', description);
    const previousOgUrl = setAttr('meta[property="og:url"]', 'content', url);
    const previousOgImage = setAttr('meta[property="og:image"]', 'content', ogImage || DEFAULT_OG_IMAGE);
    const previousTwitterTitle = setAttr('meta[name="twitter:title"]', 'content', title);
    const previousTwitterDescription = setAttr('meta[name="twitter:description"]', 'content', description);
    const previousCanonical = setAttr('link[rel="canonical"]', 'href', url);

            return () => {
              document.title = previousTitle;
              setAttr('meta[name="description"]', 'content', previousDescription);
              setAttr('meta[property="og:title"]', 'content', previousOgTitle);
              setAttr('meta[property="og:description"]', 'content', previousOgDescription);
              setAttr('meta[property="og:url"]', 'content', previousOgUrl);
              setAttr('meta[property="og:image"]', 'content', previousOgImage);
              setAttr('meta[name="twitter:title"]', 'content', previousTwitterTitle);
              setAttr('meta[name="twitter:description"]', 'content', previousTwitterDescription);
              setAttr('link[rel="canonical"]', 'href', previousCanonical);
            };
  }, [title, description, path, ogImage]);
}

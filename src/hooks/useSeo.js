import { useEffect } from 'react';
import SEO_CONTENT from '../data/seoContent.json';
import '../components/shared/SeoDiscoveryContent.css';

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSeoContent(content) {
  if (!content) return '';

  const sections = content.sections
    .map(
      (section) =>
        `<article class="seo-discovery-section"><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></article>`
    )
    .join('');
  const links = content.links
    .map((link) => {
      const href = String(link.href || '');
      if (!href.startsWith('/') || href.startsWith('//')) return '';
      return `<a href="${escapeHtml(href)}">${escapeHtml(link.label)}</a>`;
    })
    .join('');

  return `<h2 id="${escapeHtml(content.id)}-title">${escapeHtml(content.title)}</h2><p class="seo-discovery-intro">${escapeHtml(content.intro)}</p><div class="seo-discovery-sections">${sections}</div><p class="seo-discovery-disclaimer">${escapeHtml(content.disclaimer)}</p><nav class="seo-discovery-links" aria-label="Explore Capital Flow tools"><span>Explore other tools</span>${links}</nav>`;
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
    const seoContentMount = document.querySelector('#seo-route-content');
    if (seoContentMount) {
      seoContentMount.innerHTML = renderSeoContent(SEO_CONTENT[path || '/']);
    }
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
      if (seoContentMount) seoContentMount.innerHTML = '';
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

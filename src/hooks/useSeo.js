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

function managedTag(selector, tag, attributes) {
  let element = document.querySelector(selector);
  const created = !element;
  if (!element) {
    element = document.createElement(tag);
    document.head.appendChild(element);
  }
  const previous = Object.fromEntries(Object.keys(attributes).map((key) => [key, element.getAttribute(key)]));
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return () => {
    if (created) element.remove();
    else
      for (const [key, value] of Object.entries(previous)) {
        if (value === null) element.removeAttribute(key);
        else element.setAttribute(key, value);
      }
  };
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

  return `<h2 id="${escapeHtml(content.id)}-title">${escapeHtml(content.title)}</h2><p class="seo-discovery-intro">${escapeHtml(content.intro)}</p><div class="seo-discovery-sections">${sections}</div><p class="seo-discovery-disclaimer">${escapeHtml(content.disclaimer)}</p><nav class="seo-discovery-links" aria-label="כלי מחקר נוספים"><span>כלים נוספים</span>${links}</nav>`;
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
export default function useSeo({ title, description, path, ogImage, noIndex = false }) {
  useEffect(() => {
    const url = SITE_URL + (path || '/');
    const seoContentMount = document.querySelector('#seo-route-content');
    if (seoContentMount) {
      // The marketing page already has its own research description and
      // disclaimer. Do not append a duplicate SEO footer below it.
      seoContentMount.innerHTML = noIndex || path === '/' ? '' : renderSeoContent(SEO_CONTENT[path || '/']);
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
    const cleanups = [
      managedTag('meta[property="og:locale"]', 'meta', { property: 'og:locale', content: 'he_IL' }),
      managedTag('meta[name="robots"]', 'meta', {
        name: 'robots',
        content: noIndex ? 'noindex, nofollow' : 'index, follow',
      }),
    ];
    if (noIndex) {
      for (const element of document.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang]')) {
        element.remove();
        cleanups.push(() => document.head.appendChild(element));
      }
    } else {
      cleanups.push(managedTag('link[rel="canonical"]', 'link', { rel: 'canonical', href: url }));
      for (const language of ['he', 'x-default']) {
        cleanups.push(
          managedTag(`link[rel="alternate"][hreflang="${language}"]`, 'link', {
            rel: 'alternate',
            hreflang: language,
            href: url,
          })
        );
      }
    }

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
      cleanups.reverse().forEach((cleanup) => cleanup());
    };
  }, [title, description, path, ogImage, noIndex]);
}

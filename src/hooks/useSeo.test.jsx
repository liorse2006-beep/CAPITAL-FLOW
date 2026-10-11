import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSeo from './useSeo';

const ORIGINAL_TITLE = 'Capital Flow';
const ORIGINAL_DESCRIPTION = 'Original description';
const ORIGINAL_CANONICAL = 'https://capitalflow.vip/';

function seedHead() {
  document.body.innerHTML = '<div id="root"></div><section id="seo-route-content"></section>';
  document.head.innerHTML = `
    <title>${ORIGINAL_TITLE}</title>
    <meta name="description" content="${ORIGINAL_DESCRIPTION}" />
    <meta property="og:title" content="Original OG title" />
    <meta property="og:description" content="Original OG description" />
    <meta property="og:url" content="${ORIGINAL_CANONICAL}" />
    <meta property="og:image" content="https://capitalflow.vip/original.png" />
    <meta name="twitter:title" content="Original Twitter title" />
    <meta name="twitter:description" content="Original Twitter description" />
    <link rel="canonical" href="${ORIGINAL_CANONICAL}" />
  `;
}

describe('useSeo', () => {
  beforeEach(() => {
    seedHead();
  });

  it('updates route metadata and restores the previous document on unmount', () => {
    const { unmount } = renderHook(() =>
      useSeo({
        title: 'Moving Average Scanner | Capital Flow',
        description: 'Scan moving averages.',
        path: '/ma',
        ogImage: 'https://capitalflow.vip/ma.png',
      })
    );

    expect(document.title).toBe('Moving Average Scanner | Capital Flow');
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', 'Scan moving averages.');
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute(
      'content',
      'Moving Average Scanner | Capital Flow'
    );
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute('content', 'https://capitalflow.vip/ma');
    expect(document.querySelector('meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://capitalflow.vip/ma.png'
    );
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://capitalflow.vip/ma');

    unmount();

    expect(document.title).toBe(ORIGINAL_TITLE);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', ORIGINAL_DESCRIPTION);
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute('content', ORIGINAL_CANONICAL);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', ORIGINAL_CANONICAL);
  });

  it('applies new route metadata when the mounted page changes path', () => {
    const { rerender, unmount } = renderHook((props) => useSeo(props), {
      initialProps: { title: 'Scanner', description: 'Scanner description', path: '/scanner' },
    });

    rerender({ title: 'Policy', description: 'Policy description', path: '/policy' });

    expect(document.title).toBe('Policy');
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', 'Policy description');
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://capitalflow.vip/policy');

    unmount();
    expect(document.title).toBe(ORIGINAL_TITLE);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', ORIGINAL_CANONICAL);
  });

  it('updates crawl copy on client navigation and clears it when the route unmounts', () => {
    const { rerender, unmount } = renderHook((props) => useSeo(props), {
      initialProps: { title: 'Scanner', description: 'Scanner description', path: '/scanner' },
    });
    const content = document.querySelector('#seo-route-content');

    expect(content.textContent).toContain('סורק נפח מסחר חריג');
    expect(content.querySelector('a[href="/ma"]')).not.toBeNull();

    rerender({ title: 'Moving Average', description: 'MA description', path: '/ma' });
    expect(content.textContent).toContain('סורק ממוצעים נעים');
    expect(content.textContent).not.toContain('סורק נפח מסחר חריג');

    unmount();
    expect(content.innerHTML).toBe('');
  });
  it('adds Hebrew locale and language alternatives without inventing an English route', () => {
    const { unmount } = renderHook(() => useSeo({ title: 'סורק', path: '/scanner' }));
    expect(document.querySelector('meta[property="og:locale"]')).toHaveAttribute('content', 'he_IL');
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    for (const language of ['he', 'x-default']) {
      expect(document.querySelector(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute(
        'href',
        'https://capitalflow.vip/scanner'
      );
    }
    expect(document.querySelector('link[hreflang="en"]')).toBeNull();
    unmount();
    expect(document.querySelector('meta[property="og:locale"]')).toBeNull();
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    expect(document.querySelector('link[rel="alternate"]')).toBeNull();
  });

  it('does not index a missing route or present it as the home page', () => {
    const alternate = document.createElement('link');
    alternate.rel = 'alternate';
    alternate.hreflang = 'he';
    alternate.href = ORIGINAL_CANONICAL;
    document.head.appendChild(alternate);
    const { unmount } = renderHook(() => useSeo({ title: 'העמוד לא נמצא', path: '/missing', noIndex: true }));
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('link[rel="alternate"]')).toBeNull();
    expect(document.querySelector('#seo-route-content')).toBeEmptyDOMElement();
    unmount();
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', ORIGINAL_CANONICAL);
    expect(document.querySelector('link[rel="alternate"]')).toBe(alternate);
  });

  it('creates a canonical when head metadata is missing and cleans it up', () => {
    document.querySelector('link[rel="canonical"]').remove();
    const { unmount } = renderHook(() => useSeo({ title: 'סריקה', path: '/scanner' }));
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://capitalflow.vip/scanner');
    unmount();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('does not duplicate the landing-page research footer and disclaimer', () => {
    document.querySelector('#seo-route-content').innerHTML = '<p>Server-rendered research copy</p>';
    renderHook(() => useSeo({ title: ORIGINAL_TITLE, path: '/' }));
    expect(document.querySelector('#seo-route-content')).toBeEmptyDOMElement();
  });
});

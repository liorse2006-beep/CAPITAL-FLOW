import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import useSeo from './useSeo';

const ORIGINAL_TITLE = 'Capital Flow';
const ORIGINAL_DESCRIPTION = 'Original description';
const ORIGINAL_CANONICAL = 'https://capitalflow.vip/';

function seedHead() {
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
});

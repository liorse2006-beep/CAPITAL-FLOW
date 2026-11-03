import { expect, it } from 'vitest';
import { createScanResultsPdf } from './scanResultsPdf';

const linkPattern = /\/Subtype \/Link\s+\/Rect \[([^\]]+)\]\s+\/Border \[0 0 0\] \/A <<\/S \/URI \/URI \(([^)]+)\)/g;

it.each([
  ['capitalFlow', 'scanner', 60],
  ['movingAverage', 'ma', 1],
  ['sectorMoving', 'flow', 1],
])('exports a large HTTPS link on every %s PDF page', async (type, route, count) => {
  const file = createScanResultsPdf({
    type,
    title: 'Capital Flow scan results',
    scanTime: '2026-11-03T18:00:00Z',
    rows: Array.from({ length: count }, (_, index) => ({ symbol: `T${index}`, name: 'Example', price: 10 })),
  });
  const pdf = await file.text();
  const pageCount = (pdf.match(/\/Type \/Page\s/g) || []).length;
  const links = [...pdf.matchAll(linkPattern)];
  expect(pageCount).toBeGreaterThan(count > 1 ? 1 : 0);
  expect(links).toHaveLength(pageCount);
  for (const [, coordinates, destination] of links) {
    expect(destination).toBe(`https://capitalflow.vip/${route}`);
    const [left, bottom, right, top] = coordinates.trim().split(/\s+/).map(Number);
    expect(left).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    expect(right - left).toBe(204);
    expect(top - bottom).toBe(64);
  }
});

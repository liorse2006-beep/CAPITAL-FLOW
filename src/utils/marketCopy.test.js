import { describe, expect, it } from 'vitest';
import { flowLabel, sectorName } from './marketCopy';

describe('localized display labels', () => {
  it('translates sector names without replacing canonical request values', () => {
    const request = { sector: 'Technology', direction: 'inflow' };
    expect(sectorName(request.sector)).toBe('Technology');
    expect(flowLabel(request.direction)).toBe('Positive activity');
    expect(request).toEqual({ sector: 'Technology', direction: 'inflow' });
    expect(sectorName('Unknown sector')).toBe('Unknown sector');
    expect(sectorName(null)).toBe('—');
  });
  it('does not turn negative or unknown flow into a positive signal', () => {
    expect(flowLabel('outflow')).toBe('Negative activity');
    expect(flowLabel('neutral')).toBe('No notable change');
    expect(flowLabel('unavailable')).toBe('—');
  });
});

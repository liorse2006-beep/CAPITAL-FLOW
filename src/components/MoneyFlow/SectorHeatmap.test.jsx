import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SectorHeatmap from './SectorHeatmap';

describe('SectorHeatmap data freshness', () => {
  const sector = { symbol: 'XLK', price: 100, change: 1, volume: 1000, avgVolume: 500, volRatio: 2, flow: 'neutral' };

  it('describes a prior-session fallback without claiming the market is currently closed', () => {
    render(<SectorHeatmap flowData={[{ ...sector, lastSession: true }]} />);
    expect(screen.getByText('Showing last available session data')).toBeInTheDocument();
    expect(screen.queryByText(/MARKET CLOSED/i)).not.toBeInTheDocument();
  });

  it('does not show the fallback notice for current-session rows', () => {
    render(<SectorHeatmap flowData={[{ ...sector, lastSession: false }]} />);
    expect(screen.queryByText('Showing last available session data')).not.toBeInTheDocument();
  });
});

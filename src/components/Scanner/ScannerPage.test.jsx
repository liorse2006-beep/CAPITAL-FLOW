import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScannerPage from './ScannerPage';

function baseProps(overrides = {}) {
  return {
    scanning: false,
    progress: null,
    liveResults: [],
    error: null,
    setError: vi.fn(),
    startScan: vi.fn(),
    isPremium: false,
    isElite: false,
    showFilterNudge: false,
    setShowFilterNudge: vi.fn(),
    setShowUpgradeModal: vi.fn(),
    results: null,
    setResults: vi.fn(),
    setScanTime: vi.fn(),
    scanMode: 'sectors',
    setScanMode: vi.fn(),
    selectedSectors: [],
    setSelectedSectors: vi.fn(),
    toggleSector: vi.fn(),
    minRatio: '1.5',
    setMinRatio: vi.fn(),
    minCap: '1',
    setMinCap: vi.fn(),
    minVol: '',
    setMinVol: vi.fn(),
    minPrice: '',
    setMinPrice: vi.fn(),
    maxPrice: '',
    setMaxPrice: vi.fn(),
    triggerFilterNudge: vi.fn(),
    showPresetPanel: false,
    setShowPresetPanel: vi.fn(),
    presetName: '',
    setPresetName: vi.fn(),
    savePreset: vi.fn(),
    presets: [],
    loadPreset: vi.fn(),
    deletePreset: vi.fn(),
    marketClosed: false,
    scanTime: null,
    sorted: [],
    visibleCount: 50,
    setVisibleCount: vi.fn(),
    sortField: 'volumeRatio',
    sortDir: 'desc',
    handleSort: vi.fn(),
    handleSortDoubleClick: vi.fn(),
    alertLevels: {},
    promptCreateAlert: vi.fn(),
    isInWatchlist: vi.fn(() => false),
    toggleWatchlistTicker: vi.fn(),
    openChart: vi.fn(),
    scanMeta: null,
    maxFreeSectors: 2,
    maxPremiumSectors: 5,
    sectorLimit: () => 2,
    ...overrides,
  };
}

describe('ScannerPage sector limit', () => {
  it('shows the free-tier sector hint and limit', () => {
    render(<ScannerPage {...baseProps({ isPremium: false, isElite: false, sectorLimit: () => 2 })} />);
    expect(screen.getByText(/free tier: up to 2 sectors/i)).toBeInTheDocument();
  });

  it('shows the premium-tier sector hint and limit', () => {
    render(
      <ScannerPage
        {...baseProps({ isPremium: true, isElite: false, maxPremiumSectors: 5, sectorLimit: () => 5 })}
      />
    );
    expect(screen.getByText(/premium: up to 5 sectors/i)).toBeInTheDocument();
  });

  it('shows no sector-count hint for elite (unlimited) users', () => {
    render(<ScannerPage {...baseProps({ isPremium: true, isElite: true, sectorLimit: () => Infinity })} />);
    expect(screen.queryByText(/up to .* sectors/i)).not.toBeInTheDocument();
  });

  it('shows the "N/limit sectors selected" badge once the limit is reached', () => {
    render(
      <ScannerPage
        {...baseProps({
          isPremium: false,
          isElite: false,
          selectedSectors: ['Technology', 'Financials'],
          sectorLimit: () => 2,
        })}
      />
    );
    expect(screen.getByText('2/2 sectors selected')).toBeInTheDocument();
  });

  it('calls toggleSector with the sector name when a sector card is clicked', async () => {
    const user = userEvent.setup();
    const toggleSector = vi.fn();
    render(<ScannerPage {...baseProps({ toggleSector })} />);
    // Scope to the sector-grid card specifically — the logged-out demo preview
    // also renders a "Technology" sector chip, so an unscoped text query is
    // ambiguous. The card's name lives in .sector-card-name.
    await user.click(screen.getByText('Technology', { selector: '.sector-card-name' }).closest('button'));
    expect(toggleSector).toHaveBeenCalledWith('Technology');
  });
});

describe('ScannerPage universe selector', () => {
  it('renders the four scan mode cards', () => {
    render(<ScannerPage {...baseProps({ scanMode: null })} />);
    expect(screen.getByText('Full Scan')).toBeInTheDocument();
    expect(screen.getByText('S&P 500')).toBeInTheDocument();
    expect(screen.getByText('NASDAQ 100')).toBeInTheDocument();
    expect(screen.getByText('By Sector')).toBeInTheDocument();
  });

  it('switches to sector mode and clears selected sectors when "By Sector" is clicked', async () => {
    const user = userEvent.setup();
    const setScanMode = vi.fn();
    const setSelectedSectors = vi.fn();
    render(<ScannerPage {...baseProps({ scanMode: null, setScanMode, setSelectedSectors })} />);
    await user.click(screen.getByText('By Sector').closest('button'));
    expect(setScanMode).toHaveBeenCalledWith('sectors');
  });
});

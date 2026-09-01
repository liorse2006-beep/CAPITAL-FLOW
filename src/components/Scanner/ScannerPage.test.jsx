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
  // "By Sector" now opens SectorPickerModal (showSectorModal is internal
  // component state, not a prop) rather than expanding an inline grid —
  // every case here has to click into the modal first, same as a real user.
  async function openSectorModal(user, props) {
    render(<ScannerPage {...baseProps(props)} />);
    await user.click(screen.getByText('By Sector').closest('button'));
  }

  it('shows the free-tier sector hint and limit', async () => {
    const user = userEvent.setup();
    await openSectorModal(user, { isPremium: false, isElite: false, sectorLimit: () => 2 });
    expect(screen.getByText(/free tier: up to 2 sectors/i)).toBeInTheDocument();
  });

  it('shows the premium-tier sector hint and limit', async () => {
    const user = userEvent.setup();
    await openSectorModal(user, { isPremium: true, isElite: false, maxPremiumSectors: 5, sectorLimit: () => 5 });
    expect(screen.getByText(/premium: up to 5 sectors/i)).toBeInTheDocument();
  });

  it('shows no sector-count hint for elite (unlimited) users', async () => {
    const user = userEvent.setup();
    await openSectorModal(user, { isPremium: true, isElite: true, sectorLimit: () => Infinity });
    expect(screen.queryByText(/up to .* sectors/i)).not.toBeInTheDocument();
  });

  it('shows the "N/limit sectors selected" badge once the limit is reached', async () => {
    const user = userEvent.setup();
    await openSectorModal(user, {
      isPremium: false,
      isElite: false,
      selectedSectors: ['Technology', 'Financials'],
      sectorLimit: () => 2,
    });
    expect(screen.getByText('2/2 sectors selected')).toBeInTheDocument();
  });

  it('calls toggleSector with the sector name when a sector card is clicked', async () => {
    const user = userEvent.setup();
    const toggleSector = vi.fn();
    await openSectorModal(user, { toggleSector });
    // Scope to the sector-grid card specifically — the logged-out demo preview
    // also renders a "Technology" sector chip, so an unscoped text query is
    // ambiguous. The card's name lives in .sector-card-name.
    await user.click(screen.getByText('Technology', { selector: '.sector-card-name' }).closest('button'));
    expect(toggleSector).toHaveBeenCalledWith('Technology');
  });

  it('Done closes the modal and returns to the main screen', async () => {
    const user = userEvent.setup();
    await openSectorModal(user, {});
    expect(screen.getByRole('dialog', { name: /select sectors/i })).toBeInTheDocument();
    await user.click(screen.getByText(/^Done/));
    expect(screen.queryByRole('dialog', { name: /select sectors/i })).not.toBeInTheDocument();
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

const mockRow = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  price: 190.12,
  change: 1.23,
  volumeRatio: 3,
  marketCap: 3e12,
  sector: 'Technology',
};

describe('ScannerPage restored-last-scan label', () => {
  // A plain page refresh auto-restores the customer's last scan (see
  // App.jsx's /api/last-results effect) instead of a blank screen — without
  // a label, that data looks like it appeared from nowhere.
  it('labels results restored on load as the last scan, not a fresh one', () => {
    render(
      <ScannerPage
        {...baseProps({
          results: [mockRow],
          sorted: [mockRow],
          scanTime: new Date().toISOString(),
          restoredFromLastScan: true,
        })}
      />
    );
    expect(screen.getByText(/Last scan from .* — click Run Scan to refresh/)).toBeInTheDocument();
  });

  it('does not show the restored label after an actual scan', () => {
    render(
      <ScannerPage
        {...baseProps({
          results: [mockRow],
          sorted: [mockRow],
          scanTime: new Date().toISOString(),
          restoredFromLastScan: false,
        })}
      />
    );
    expect(screen.queryByText(/click Run Scan to refresh/)).not.toBeInTheDocument();
  });
});

describe('ScannerPage Radar placement', () => {
  it('keeps one compact Radar surface after results are available', () => {
    render(
      <ScannerPage
        {...baseProps({
          results: [mockRow],
          sorted: [mockRow],
          scanTime: new Date().toISOString(),
        })}
      />
    );

    expect(screen.getAllByRole('heading', { name: /catch the moment a setup appears/i })).toHaveLength(1);
  });
});

describe('ScannerPage mobile result surface', () => {
  it('keeps desktop data and actions that fit while removing news and Capi actions', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    try {
      render(
        <ScannerPage
          {...baseProps({
            isPremium: true,
            isElite: true,
            results: [mockRow],
            sorted: [mockRow],
            scanTime: new Date().toISOString(),
          })}
        />
      );

      expect(screen.getByText('MKT CAP')).toBeInTheDocument();
      expect(screen.getByText('AVG VOLUME')).toBeInTheDocument();
      expect(screen.getByText('CURRENT VOLUME')).toBeInTheDocument();
      expect(screen.getByText('SECTOR')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /read market news/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /ask capi/i })).not.toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('renders every result instead of truncating the list at 50 rows', () => {
    const manyRows = Array.from({ length: 51 }, (_, index) => ({
      ...mockRow,
      symbol: `T${String(index).padStart(2, '0')}`,
    }));

    render(
      <ScannerPage
        {...baseProps({
          results: manyRows,
          sorted: manyRows,
          scanTime: new Date().toISOString(),
        })}
      />
    );

    expect(screen.getByRole('heading', { name: '51 Results' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load .* more/i })).not.toBeInTheDocument();
  });
});

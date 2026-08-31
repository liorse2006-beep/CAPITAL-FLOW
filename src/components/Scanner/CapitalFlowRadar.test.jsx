import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CapitalFlowRadar from './CapitalFlowRadar';

function baseProps() {
  return {
    user: { id: 1, email: 'elite@example.com' },
    getToken: () => 'test-token',
    isElite: true,
    trialActive: false,
    onUpgrade: vi.fn(),
    onSignIn: vi.fn(),
    scanMode: 'all',
    selectedSectors: [],
    minRatio: '1.5',
    minCap: '1',
    minVol: '',
    radarEvent: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CapitalFlowRadar schedule picker', () => {
  it('offers two non-typing time selectors from 11:00 AM through 11:00 PM', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ radars: [] }) }))
    );
    const user = userEvent.setup();
    render(<CapitalFlowRadar {...baseProps()} />);

    await user.click(await screen.findByRole('button', { name: /activate this scan as radar/i }));

    const first = screen.getByRole('combobox', { name: /first daily radar scan time/i });
    const second = screen.getByRole('combobox', { name: /second daily radar scan time/i });
    const expectedValues = Array.from({ length: 25 }, (_, index) => {
      const totalMinutes = 11 * 60 + index * 30;
      const hour = Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    });

    expect(first).toBeRequired();
    expect([...first.options].slice(1).map((option) => option.value)).toEqual(expectedValues);
    expect([...second.options].slice(1).map((option) => option.value)).toEqual(expectedValues);
    expect(first.options).toHaveLength(26);
    expect(second.options).toHaveLength(26);
    expect(first).toHaveTextContent('11:00 AM');
    expect(first).toHaveTextContent('11:00 PM');
    expect(document.querySelector('input[type="time"]')).not.toBeInTheDocument();
  });

  it('makes the one-or-both condition rule explicit before the scan filters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ radars: [] }) }))
    );
    const user = userEvent.setup();
    render(<CapitalFlowRadar {...baseProps()} />);

    await user.click(await screen.findByRole('button', { name: /activate this scan as radar/i }));

    const both = screen.getByRole('radio', { name: /both conditions/i });
    const either = screen.getByRole('radio', { name: /either condition/i });
    expect(both).toBeChecked();
    expect(either).not.toBeChecked();
    expect(both.closest('label')).toHaveClass('active');
    expect(either.closest('label')).not.toHaveClass('active');
    expect(screen.getByText(/^ALERT LOGIC$/)).toBeInTheDocument();
    expect(
      screen.queryByText(/capital flow and moving average must both match before an alert/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText(/only a match from both layers sends an alert/i)).toBeInTheDocument();

    await user.click(either);
    expect(either).toBeChecked();
    expect(both).not.toBeChecked();
    expect(either.closest('label')).toHaveClass('active');
    expect(both.closest('label')).not.toHaveClass('active');
    expect(screen.getByText(/one match sends an alert/i)).toBeInTheDocument();
    expect(screen.queryByText(/^OR$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^AND$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^01$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^02$/)).not.toBeInTheDocument();
    expect(document.querySelector('.cfr-radar-logic-flow')).not.toBeInTheDocument();
  });

  it('marks the selected moving-average option in every group', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ radars: [] }) }))
    );
    const user = userEvent.setup();
    render(<CapitalFlowRadar {...baseProps()} />);

    await user.click(await screen.findByRole('button', { name: /activate this scan as radar/i }));

    expect(screen.getByRole('button', { name: '20', exact: true })).toHaveClass('active');
    expect(screen.getByRole('button', { name: '9', exact: true })).not.toHaveClass('active');
    expect(screen.getByRole('button', { name: '±2%', exact: true })).toHaveClass('active');
    expect(screen.getByRole('button', { name: '±1%', exact: true })).not.toHaveClass('active');
    expect(screen.getByRole('button', { name: 'All', exact: true })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Above', exact: true })).not.toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Daily', exact: true })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Weekly', exact: true })).not.toHaveClass('active');
  });

  it('keeps optional Capital Flow filters collapsed until the customer opens them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ radars: [] }) }))
    );
    const user = userEvent.setup();
    render(<CapitalFlowRadar {...baseProps()} />);

    await user.click(await screen.findByRole('button', { name: /activate this scan as radar/i }));

    const moreFilters = screen.getByRole('button', { name: /more filters/i });
    expect(moreFilters).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Minimum trading volume')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Minimum price')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Maximum price')).not.toBeInTheDocument();

    await user.click(moreFilters);
    expect(moreFilters).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Minimum trading volume')).toBeInTheDocument();
    expect(screen.getByLabelText('Minimum price')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximum price')).toBeInTheDocument();
  });

  it('shows the concise waiting state and removes the extra Radar marketing copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            radars: [
              {
                id: 1,
                name: 'Capital Flow Radar',
                mode: 'all',
                selectedSectors: [],
                minVolumeRatio: 1.5,
                minMarketCap: 1_000_000_000,
                maPeriod: 20,
                maDistance: 2,
                conditionMode: 'both',
                scheduleTime1: '11:00',
                scheduleTime2: null,
                expiresOn: '2026-12-31',
                active: true,
                dataStatus: 'waiting',
                statusMessage: 'Waiting for the first completed market scan.',
                events: [],
              },
            ],
          }),
        })
      )
    );

    render(<CapitalFlowRadar {...baseProps()} />);

    expect(await screen.findByText('WAITING FOR A SIGNAL')).toBeInTheDocument();
    expect(screen.queryByText(/choose up to two daily check times/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/one alert per new entry/i)).not.toBeInTheDocument();
  });

  it('renders Radar entries as condition-first signal cards without invented metrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            radars: [
              {
                id: 1,
                name: 'Capital Flow Radar',
                mode: 'all',
                selectedSectors: [],
                minVolumeRatio: 1.5,
                minMarketCap: 1_000_000_000,
                maPeriod: 20,
                maDistance: 2,
                maInterval: '1d',
                conditionMode: 'both',
                scheduleTime1: '11:00',
                scheduleTime2: null,
                expiresOn: '2026-12-31',
                active: true,
                dataStatus: 'ready',
                lastCheckAt: '2026-08-30T09:32:00.000Z',
                events: [
                  {
                    id: 8,
                    symbol: 'LEN',
                    scanTime: '2026-08-30T09:32:00.000Z',
                    data: {
                      symbol: 'LEN',
                      exchange: 'NYSE',
                      sector: 'Building Products',
                      price: 84.21,
                      change: 2.14,
                      volumeRatio: 2.48,
                      maPeriod: 20,
                      maDistance: 1.34,
                      matchedConditions: ['Capital Flow', 'Moving Average'],
                    },
                  },
                ],
              },
            ],
          }),
        })
      )
    );

    render(<CapitalFlowRadar {...baseProps()} />);

    expect(await screen.findByText('WHY RADAR SURFACED THIS')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'LEN Radar entry' })).toBeInTheDocument();
    expect(screen.getByText('RVOL 2.48x ≥ 1.5x minimum')).toBeInTheDocument();
    expect(screen.getByText('Price 1.34% above SMA20 · limit ±2%')).toBeInTheDocument();
    expect(screen.getByText('$84.21')).toBeInTheDocument();
    expect(screen.getByText('+2.14%')).toBeInTheDocument();
    expect(screen.getByText('2.48x')).toBeInTheDocument();
    expect(screen.queryByText(/undefined|NaN/)).not.toBeInTheDocument();
  });

  it('renders unavailable Radar metrics as dashes instead of fabricated zeroes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            radars: [
              {
                id: 3,
                name: 'Unavailable metrics',
                mode: 'all',
                selectedSectors: [],
                minVolumeRatio: 1.5,
                minMarketCap: 1_000_000_000,
                maPeriod: 20,
                maDistance: 2,
                conditionMode: 'both',
                dataStatus: 'ready',
                events: [
                  {
                    id: 9,
                    symbol: 'MISSING',
                    data: { symbol: 'MISSING', price: null, change: null, volumeRatio: null },
                  },
                ],
              },
            ],
          }),
        })
      )
    );

    render(<CapitalFlowRadar {...baseProps()} />);

    const card = await screen.findByRole('article', { name: 'MISSING Radar entry' });
    expect(within(card).getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(within(card).queryByText('0.00x')).not.toBeInTheDocument();
    expect(within(card).queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('does not offer a second Radar while one saved scan exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            radars: [
              {
                id: 2,
                name: 'Existing Radar',
                mode: 'all',
                selectedSectors: [],
                minVolumeRatio: 1.5,
                minMarketCap: 1_000_000_000,
                maPeriod: 20,
                maDistance: 2,
                conditionMode: 'both',
                scheduleTime1: '11:00',
                scheduleTime2: null,
                expiresOn: '2026-12-31',
                active: true,
                dataStatus: 'ready',
                events: [],
              },
            ],
          }),
        })
      )
    );

    render(<CapitalFlowRadar {...baseProps()} />);

    expect(await screen.findByText('Existing Radar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /activate this scan as radar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save another radar/i })).not.toBeInTheDocument();
  });

  it('uses an in-app confirmation dialog before removing a saved Radar', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          radars: [
            {
              id: 2,
              name: 'Existing Radar',
              mode: 'all',
              selectedSectors: [],
              minVolumeRatio: 1.5,
              minMarketCap: 1_000_000_000,
              maPeriod: 20,
              maDistance: 2,
              conditionMode: 'both',
              scheduleTime1: '11:00',
              scheduleTime2: null,
              expiresOn: '2026-12-31',
              active: true,
              dataStatus: 'ready',
              events: [],
            },
          ],
        }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<CapitalFlowRadar {...baseProps()} />);

    await user.click(await screen.findByRole('button', { name: 'Remove', exact: true }));

    const dialog = screen.getByRole('alertdialog', { name: /remove this radar/i });
    expect(dialog).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole('button', { name: 'Keep Radar', exact: true }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Remove', exact: true }));
    const secondDialog = screen.getByRole('alertdialog', { name: /remove this radar/i });
    await user.click(within(secondDialog).getByRole('button', { name: 'Remove Radar', exact: true }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/radars/2', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(screen.queryByText('Existing Radar')).not.toBeInTheDocument();
  });
});

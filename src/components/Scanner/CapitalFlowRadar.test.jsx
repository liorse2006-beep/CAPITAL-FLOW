import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

    await user.click(screen.getByRole('button', { name: /activate this scan as radar/i }));

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

    await user.click(screen.getByRole('button', { name: /activate this scan as radar/i }));

    const both = screen.getByRole('radio', { name: /both conditions/i });
    const either = screen.getByRole('radio', { name: /either condition/i });
    expect(both).toBeChecked();
    expect(either).not.toBeChecked();
    expect(screen.getByText(/only a match from both layers sends an alert/i)).toBeInTheDocument();

    await user.click(either);
    expect(either).toBeChecked();
    expect(both).not.toBeChecked();
    expect(screen.getByText(/one match sends an alert/i)).toBeInTheDocument();
    expect(screen.queryByText(/^OR$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^AND$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^01$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^02$/)).not.toBeInTheDocument();
  });
});

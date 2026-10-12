// Display labels only. Canonical sector and signal keys stay unchanged in
// requests, saved filters and financial calculations.
const SECTORS = {
  Technology: 'Technology',
  Financials: 'Financials',
  'Health Care': 'Health Care',
  'Consumer Discretionary': 'Consumer Discretionary',
  'Consumer Staples': 'Consumer Staples',
  Energy: 'Energy',
  Industrials: 'Industrials',
  Materials: 'Materials',
  'Real Estate': 'Real Estate',
  Utilities: 'Utilities',
  'Communication Services': 'Communication Services',
  Semiconductors: 'Semiconductors',
};
export function sectorName(value) {
  return SECTORS[value] || value || '—';
}
export function flowLabel(value) {
  return { inflow: 'Positive activity', outflow: 'Negative activity', neutral: 'No notable change' }[value] || '—';
}

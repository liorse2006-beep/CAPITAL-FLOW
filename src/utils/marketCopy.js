// Display labels only. Canonical sector and signal keys stay unchanged in
// requests, saved filters and financial calculations.
const SECTORS = {
  Technology: 'טכנולוגיה',
  Financials: 'פיננסים',
  'Health Care': 'בריאות',
  'Consumer Discretionary': 'צריכה מחזורית',
  'Consumer Staples': 'צריכה בסיסית',
  Energy: 'אנרגיה',
  Industrials: 'תעשייה',
  Materials: 'חומרי גלם',
  'Real Estate': 'נדל״ן',
  Utilities: 'תשתיות',
  'Communication Services': 'תקשורת',
  Semiconductors: 'שבבים',
};
export function sectorName(value) {
  return SECTORS[value] || value || '—';
}
export function flowLabel(value) {
  return { inflow: 'פעילות חיובית', outflow: 'פעילות שלילית', neutral: 'ללא שינוי בולט' }[value] || '—';
}

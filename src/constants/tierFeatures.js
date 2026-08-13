// Single source of truth for what each tier includes — shared by the
// Free/Premium/Elite comparison table (UpgradeModal) and the post-purchase
// welcome screen (WelcomeTierModal), so the two can never drift apart.
// Feature rows in display order — Price is last, right above the CTA row.
export const TIER_ROWS = [
  { label: 'Scans', free: 'Unlimited · 7-day trial', premium: '5 / 24h', elite: 'Unlimited' },
  // Free receives the complete product for seven days. The server gates
  // Fundamentals with requirePremiumOrTrial and Elite-only features with
  // requireEliteOrTrial, so the table must show the trial rather than a dash.
  { label: 'Fundamentals lookups', free: 'Unlimited · 7-day trial', premium: 'Unlimited', elite: 'Unlimited' },
  { label: 'Advanced filters & presets', free: '7-day trial', premium: 'Included', elite: 'Included' },
  { label: 'Charts', free: '7-day trial', premium: 'Included', elite: 'Included' },
  { label: 'AI-summarized news', free: 'Any signed-in user', premium: 'Included', elite: 'Included' },
  { label: 'Capi — your AI market mentor', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Push notifications', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Daily scheduled scan', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Custom watchlist alerts', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Price', free: 'Free', premium: '$14.90', elite: '$29.90', isPrice: true },
];

// Every feature other than the two quota rows above, tagged with both its
// display value and inclusion state. A string means included (possibly for
// the trial or for all signed-in users); false is the only excluded value.
export function tierFeatureChecklist(tierKey) {
  return TIER_ROWS.filter(function (row) {
    return !row.isPrice && row.label !== 'Scans' && row.label !== 'Fundamentals lookups';
  }).map(function (row) {
    var value = row[tierKey];
    return { label: row.label, value: value, included: value !== false };
  });
}

// Single source of truth for what each tier includes — shared by the
// Free/Premium/Elite comparison table (UpgradeModal) and the post-purchase
// welcome screen (WelcomeTierModal), so the two can never drift apart.
// Feature rows in display order — Price is last, right above the CTA row.
export const TIER_ROWS = [
  { label: 'Scans', free: 'Unlimited for 7 days', premium: '5 / 24h', elite: 'Unlimited' },
  { label: 'Advanced filters & presets', free: false, premium: true, elite: true },
  { label: 'Float & short interest data', free: false, premium: true, elite: true },
  { label: 'Ticker notes & charts', free: false, premium: true, elite: true },
  { label: 'AI-summarized news', free: true, premium: true, elite: true },
  { label: 'Capi — your AI market mentor', free: false, premium: false, elite: true },
  { label: 'Push notifications', free: false, premium: false, elite: true },
  { label: 'Daily scheduled scan', free: false, premium: false, elite: true },
  { label: 'Custom watchlist alerts', free: false, premium: false, elite: true },
  { label: 'Price', free: 'Free', premium: '$14.90', elite: '$29.90', isPrice: true },
]

// Every paid-tier feature (i.e. not free-for-everyone, like News), tagged
// with whether the given tier actually includes it. Used on the welcome
// screen so a Premium buyer sees the full feature universe — checkmarks for
// what they just got, and a plain "not included" mark for the Elite-only
// items they don't have. Since Elite includes everything, running this for
// 'elite' naturally comes back all-included with no extra branching needed.
export function tierFeatureChecklist(tierKey) {
  return TIER_ROWS.filter(function (row) {
    return !row.isPrice && row.label !== 'Scans' && !row.free
  }).map(function (row) {
    return { label: row.label, included: row[tierKey] === true }
  })
}

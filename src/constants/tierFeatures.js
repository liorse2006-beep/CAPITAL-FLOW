// Single source of truth for the current in-app Free/Premium/Elite entitlements.
// Every comparison surface must render these rows instead of maintaining its
// own partial feature list. Values are intentionally explicit: a checkmark
// means the capability is available and the adjacent value explains the
// current quota or access window.
export const TIER_ROWS = [
  {
    label: 'Full market scans',
    free: 'Unlimited · 7-day trial',
    premium: '5 scans / 24h (shared)',
    elite: 'Unlimited',
  },
  {
    label: 'Sector scan breadth',
    free: 'Unlimited · 7-day trial',
    premium: 'Up to 5 sectors',
    elite: 'Unlimited',
  },
  { label: 'Fundamentals lookups', free: 'Unlimited · 7-day trial', premium: 'Unlimited', elite: 'Unlimited' },
  { label: 'Advanced filters & sorting', free: '7-day trial', premium: 'Included', elite: 'Included' },
  { label: 'Price charts', free: '7-day trial', premium: 'Included', elite: 'Included' },
  {
    label: 'News & AI summaries',
    free: 'Signed-in access',
    premium: 'Signed-in access',
    elite: 'Signed-in access',
  },
  {
    label: 'Watchlist tracking & quotes',
    free: 'Signed-in access',
    premium: 'Signed-in access',
    elite: 'Signed-in access',
  },
  {
    label: 'Historical volume context',
    free: 'Signed-in access',
    premium: 'Signed-in access',
    elite: 'Signed-in access',
  },
  { label: 'Capi — your AI market mentor', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Push notifications', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Real-time alert stream', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Daily scheduled scan', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Custom watchlist alerts', free: '7-day trial', premium: false, elite: 'Included' },
  { label: 'Capital Flow Radar', free: '7-day trial', premium: false, elite: 'Included' },
];

// Header data belongs next to the feature matrix so price copy cannot drift
// between plan cards and the comparison table. Prices are the current product
// prices in the app; do not add an old-price/discount claim without a verified
// active offer from the checkout configuration.
export const TIER_COLUMNS = [
  {
    key: 'free',
    label: 'Free',
    price: '$0',
    details: '7-day trial · No card required',
  },
  {
    key: 'premium',
    label: 'Premium',
    price: '$14.90',
    details: 'One-time purchase · Lifetime access',
  },
  {
    key: 'elite',
    label: 'Elite',
    price: '$29.90',
    details: 'One-time purchase · Lifetime access',
    featured: true,
  },
];

// The welcome modal intentionally keeps a concise post-purchase checklist;
// the comparison matrix above is the complete source used for plan selection.
// A string means included (possibly for the trial or for all signed-in users);
// false is the only excluded value.
export function tierFeatureChecklist(tierKey) {
  return TIER_ROWS.filter(function (row) {
    return row.label !== 'Fundamentals lookups' && row.label !== 'Full market scans';
  }).map(function (row) {
    var value = row[tierKey];
    return { label: row.label, value: value, included: value !== false };
  });
}

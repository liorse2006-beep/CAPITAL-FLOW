// Reads the shape returned by GET /api/scan-quota (see
// server/services/scanQuota.js `quotaFor()`) and boils it down to what each
// scan page actually needs to render: is this category exhausted, and what
// short label explains why.
export function categoryQuota(scanMeta, category) {
  if (!scanMeta) return { exhausted: false, label: '' }

  if (scanMeta.tier === 'elite') {
    return { exhausted: false, label: 'Unlimited' }
  }

  if (scanMeta.tier === 'premium') {
    const p = scanMeta.premium || { used: 0, left: 5, limit: 5 }
    return {
      exhausted: p.left === 0,
      label: `${p.used} / ${p.limit} scans used today`,
      used: p.used,
      limit: p.limit,
      left: p.left,
      resetsAt: p.resetsAt,
    }
  }

  const used = !!(scanMeta.free && scanMeta.free[category])
  return {
    exhausted: used,
    label: used ? 'Free trial used for this scan type' : 'Free trial available',
    used: used ? 1 : 0,
    limit: 1,
    left: used ? 0 : 1,
  }
}

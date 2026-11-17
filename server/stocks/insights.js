// Plain-Hebrew observations derived from one stock's snapshot. Each sentence
// states a measured fact (position vs. an average, place in the yearly range,
// volume vs. normal, valuation gap, upcoming report). None of them is a
// forecast or a recommendation, and a missing input produces no sentence.

function pct(value, digits = 0) {
  return `${Math.abs(value).toFixed(digits)}%`;
}

function ratio(value) {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

function trendSentence(s) {
  if (!s.price || !s.sma150) return null;
  const diff = (s.price / s.sma150 - 1) * 100;
  const side = diff >= 0 ? 'מעל ' : 'מתחת ל';
  let slope = '';
  if (s.sma150Prev20) {
    const change = (s.sma150 / s.sma150Prev20 - 1) * 100;
    slope = change > 0.5 ? ', והממוצע עצמו עולה' : change < -0.5 ? ', והממוצע עצמו יורד' : ', והממוצע עצמו כמעט שטוח';
  }
  if (Math.abs(diff) < 1) return `המחיר צמוד לממוצע 150 יום${slope}.`;
  return `המחיר ${pct(diff)} ${side}ממוצע 150 יום${slope}.`;
}

function rangeSentence(s) {
  if (!s.price || !s.high52 || !s.low52 || s.high52 <= s.low52) return null;
  const fromHigh = (1 - s.price / s.high52) * 100;
  const fromLow = (s.price / s.low52 - 1) * 100;
  if (fromHigh <= 3) return `המחיר קרוב לשיא של השנה האחרונה: ${pct(fromHigh, 1)} מתחתיו.`;
  if (fromLow <= 5) return `המחיר קרוב לשפל של השנה האחרונה: ${pct(fromLow, 1)} מעליו.`;
  return `המחיר ${pct(fromHigh)} מתחת לשיא של השנה האחרונה.`;
}

function volumeSentence(s) {
  if (!s.volume || !s.avgVolume3m) return null;
  const r = s.volume / s.avgVolume3m;
  if (r >= 1.5) return `ביום המסחר האחרון נסחר נפח של פי ${ratio(r)} מהממוצע לשלושה חודשים.`;
  if (r <= 0.6) return `הנפח ביום המסחר האחרון היה נמוך מהרגיל: פי ${ratio(r)} מהממוצע.`;
  return `הנפח ביום המסחר האחרון היה קרוב לרגיל (פי ${ratio(r)} מהממוצע).`;
}

function valuationSentence(s) {
  if (!(s.pe > 0) || !(s.forwardPE > 0)) return null;
  const r = s.forwardPE / s.pe;
  const a = s.forwardPE.toFixed(1);
  const b = s.pe.toFixed(1);
  if (r < 0.85) return `המכפיל העתידי (${a}) נמוך מהמכפיל הנוכחי (${b}): התחזיות מניחות עלייה ברווחים.`;
  if (r > 1.15) return `המכפיל העתידי (${a}) גבוה מהמכפיל הנוכחי (${b}): התחזיות מניחות ירידה ברווחים.`;
  return `המכפיל העתידי (${a}) והמכפיל הנוכחי (${b}) קרובים.`;
}

function earningsSentence(s, today) {
  if (!s.nextEarningsDate || !today) return null;
  const days = daysBetween(today, s.nextEarningsDate);
  if (days < 0 || days > 21) return null;
  if (days === 0) return `דוח רבעוני צפוי היום, ${formatDate(s.nextEarningsDate)}.`;
  return `דוח רבעוני צפוי ב-${formatDate(s.nextEarningsDate)}, בעוד ${days} ימים.`;
}

function shortSentence(s) {
  if (!(s.shortPercent >= 0.1)) return null;
  return `שיעור ה-Short גבוה: ${pct(s.shortPercent * 100, 1)} מה-Float.`;
}

function insightsFor(snapshot, today = new Date().toISOString().slice(0, 10)) {
  const earnings = earningsSentence(snapshot, today);
  return [
    trendSentence(snapshot),
    rangeSentence(snapshot),
    volumeSentence(snapshot),
    earnings || valuationSentence(snapshot),
    shortSentence(snapshot),
  ].filter(Boolean);
}

module.exports = { insightsFor, formatDate };

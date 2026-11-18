// Plain-language observations derived from one stock or ETF snapshot. Each
// sentence states a measured fact (position vs. an average, place in the
// yearly range, volume vs. normal, valuation gap, upcoming report). None is a
// forecast or a recommendation, and a missing input produces no sentence.

function pct(value, digits = 0) {
  return `${Math.abs(value).toFixed(digits)}%`;
}

function ratio(value) {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function formatDate(iso, lang = 'he') {
  const [y, m, d] = iso.split('-');
  if (lang === 'en') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[Number(m) - 1]} ${Number(d)}, ${y}`;
  }
  return `${Number(d)}.${Number(m)}.${y}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

const TEXT = {
  he: {
    slopeUp: ', והממוצע עצמו עולה',
    slopeDown: ', והממוצע עצמו יורד',
    slopeFlat: ', והממוצע עצמו כמעט שטוח',
    hugging: (slope) => `המחיר צמוד לממוצע 150 יום${slope}.`,
    trend: (diff, above, slope) => `המחיר ${pct(diff)} ${above ? 'מעל ' : 'מתחת ל'}ממוצע 150 יום${slope}.`,
    nearHigh: (d) => `המחיר קרוב לשיא של השנה האחרונה: ${pct(d, 1)} מתחתיו.`,
    nearLow: (d) => `המחיר קרוב לשפל של השנה האחרונה: ${pct(d, 1)} מעליו.`,
    belowHigh: (d) => `המחיר ${pct(d)} מתחת לשיא של השנה האחרונה.`,
    volHigh: (r) => `ביום המסחר האחרון נסחר נפח של פי ${ratio(r)} מהממוצע לשלושה חודשים.`,
    volLow: (r) => `הנפח ביום המסחר האחרון היה נמוך מהרגיל: פי ${ratio(r)} מהממוצע.`,
    volNormal: (r) => `הנפח ביום המסחר האחרון היה קרוב לרגיל (פי ${ratio(r)} מהממוצע).`,
    pegLow: (a, b) => `המכפיל העתידי (${a}) נמוך מהמכפיל הנוכחי (${b}): התחזיות מניחות עלייה ברווחים.`,
    pegHigh: (a, b) => `המכפיל העתידי (${a}) גבוה מהמכפיל הנוכחי (${b}): התחזיות מניחות ירידה ברווחים.`,
    pegSame: (a, b) => `המכפיל העתידי (${a}) והמכפיל הנוכחי (${b}) קרובים.`,
    earningsToday: (d) => `דוח רבעוני צפוי היום, ${d}.`,
    earningsSoon: (d, n) => `דוח רבעוני צפוי ב-${d}, בעוד ${n} ימים.`,
    shortHigh: (p) => `שיעור ה-Short גבוה: ${p} מה-Float.`,
    concentration: (n, p) => `${n} האחזקות הגדולות מהוות ${p} מהקרן.`,
  },
  en: {
    slopeUp: ', and the average itself is rising',
    slopeDown: ', and the average itself is falling',
    slopeFlat: ', and the average itself is nearly flat',
    hugging: (slope) => `Price is right at its 150-day average${slope}.`,
    trend: (diff, above, slope) => `Price is ${pct(diff)} ${above ? 'above' : 'below'} its 150-day average${slope}.`,
    nearHigh: (d) => `Price is near its 52-week high: ${pct(d, 1)} below it.`,
    nearLow: (d) => `Price is near its 52-week low: ${pct(d, 1)} above it.`,
    belowHigh: (d) => `Price is ${pct(d)} below its 52-week high.`,
    volHigh: (r) => `Volume in the last session was ${ratio(r)}x the 3-month average.`,
    volLow: (r) => `Volume in the last session was below normal: ${ratio(r)}x the average.`,
    volNormal: (r) => `Volume in the last session was close to normal (${ratio(r)}x the average).`,
    pegLow: (a, b) => `The forward P/E (${a}) is below the current P/E (${b}): forecasts assume earnings growth.`,
    pegHigh: (a, b) => `The forward P/E (${a}) is above the current P/E (${b}): forecasts assume lower earnings.`,
    pegSame: (a, b) => `The forward P/E (${a}) and current P/E (${b}) are close.`,
    earningsToday: (d) => `Quarterly earnings are expected today, ${d}.`,
    earningsSoon: (d, n) => `Quarterly earnings are expected on ${d}, in ${n} days.`,
    shortHigh: (p) => `Short interest is high: ${p} of the float.`,
    concentration: (n, p) => `The top ${n} holdings make up ${p} of the fund.`,
  },
};

function trendSentence(s, t) {
  if (!s.price || !s.sma150) return null;
  const diff = (s.price / s.sma150 - 1) * 100;
  let slope = '';
  if (s.sma150Prev20) {
    const change = (s.sma150 / s.sma150Prev20 - 1) * 100;
    slope = change > 0.5 ? t.slopeUp : change < -0.5 ? t.slopeDown : t.slopeFlat;
  }
  if (Math.abs(diff) < 1) return t.hugging(slope);
  return t.trend(diff, diff >= 0, slope);
}

function rangeSentence(s, t) {
  if (!s.price || !s.high52 || !s.low52 || s.high52 <= s.low52) return null;
  const fromHigh = (1 - s.price / s.high52) * 100;
  const fromLow = (s.price / s.low52 - 1) * 100;
  if (fromHigh <= 3) return t.nearHigh(fromHigh);
  if (fromLow <= 5) return t.nearLow(fromLow);
  return t.belowHigh(fromHigh);
}

function volumeSentence(s, t) {
  if (!s.volume || !s.avgVolume3m) return null;
  const r = s.volume / s.avgVolume3m;
  if (r >= 1.5) return t.volHigh(r);
  if (r <= 0.6) return t.volLow(r);
  return t.volNormal(r);
}

function valuationSentence(s, t) {
  if (!(s.pe > 0) || !(s.forwardPE > 0)) return null;
  const r = s.forwardPE / s.pe;
  const a = s.forwardPE.toFixed(1);
  const b = s.pe.toFixed(1);
  if (r < 0.85) return t.pegLow(a, b);
  if (r > 1.15) return t.pegHigh(a, b);
  return t.pegSame(a, b);
}

function earningsSentence(s, today, t, lang) {
  if (!s.nextEarningsDate || !today) return null;
  const days = daysBetween(today, s.nextEarningsDate);
  if (days < 0 || days > 21) return null;
  const date = formatDate(s.nextEarningsDate, lang);
  return days === 0 ? t.earningsToday(date) : t.earningsSoon(date, days);
}

function shortSentence(s, t) {
  if (!(s.shortPercent >= 0.1)) return null;
  return t.shortHigh(pct(s.shortPercent * 100, 1));
}

function concentrationSentence(s, t) {
  const weights = (s.holdings || []).map((h) => h.weight).filter((w) => w > 0);
  if (weights.length < 3) return null;
  const total = weights.reduce((sum, w) => sum + w, 0) * 100;
  return t.concentration(weights.length, pct(total));
}

function insightsFor(snapshot, today = new Date().toISOString().slice(0, 10), lang = 'he') {
  const t = TEXT[lang] || TEXT.he;
  if (snapshot.kind === 'etf') {
    return [
      trendSentence(snapshot, t),
      rangeSentence(snapshot, t),
      volumeSentence(snapshot, t),
      concentrationSentence(snapshot, t),
    ].filter(Boolean);
  }
  const earnings = earningsSentence(snapshot, today, t, lang);
  return [
    trendSentence(snapshot, t),
    rangeSentence(snapshot, t),
    volumeSentence(snapshot, t),
    earnings || valuationSentence(snapshot, t),
    shortSentence(snapshot, t),
  ].filter(Boolean);
}

module.exports = { insightsFor, formatDate };

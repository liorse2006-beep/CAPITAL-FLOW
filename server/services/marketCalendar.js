// US equities session calendar used by every scheduled market scan.
//
// This is intentionally dependency-free so a calendar package outage cannot
// stop the scheduler. It covers the recurring NYSE/Nasdaq full-day holidays;
// exceptional exchange closures and early closes can be supplied through the
// explicit environment overrides when announced by the exchange.

const NEW_YORK = 'America/New_York';

function newYorkParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday,
    minutes: Number(map.hour) * 60 + Number(map.minute),
  };
}

function dateUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function observedMonday(year, month, day) {
  const date = dateUtc(year, month, day);
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function nthWeekday(year, month, weekday, occurrence) {
  const date = dateUtc(year, month, 1);
  const offset = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + offset + (occurrence - 1) * 7);
  return date;
}

function lastWeekday(year, month, weekday) {
  const date = dateUtc(year, month + 1, 0);
  const offset = (date.getUTCDay() - weekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date;
}

// Anonymous Gregorian computus. Good Friday is a full-day US equities
// closure and is not a federal holiday, so it needs to be calculated here.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateUtc(year, month, day);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function configuredClosedDates() {
  return new Set(
    String(process.env.MARKET_CLOSED_DATES || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  );
}

function configuredEarlyCloseMinutes() {
  const closes = new Map();
  String(process.env.MARKET_EARLY_CLOSES || '')
    .split(',')
    .map((value) => value.trim())
    .forEach((entry) => {
      const match = /^(\d{4}-\d{2}-\d{2})=(\d{1,2}):(\d{2})$/.exec(entry);
      if (!match) return;
      const minutes = Number(match[2]) * 60 + Number(match[3]);
      if (minutes >= 570 && minutes <= 960) closes.set(match[1], minutes);
    });
  return closes;
}

function holidayDates(year) {
  const dates = new Set();
  const add = (date) => dates.add(isoDate(date));

  add(observedMonday(year, 1, 1)); // New Year's Day
  add(nthWeekday(year, 1, 1, 3)); // Martin Luther King Jr. Day
  add(nthWeekday(year, 2, 1, 3)); // Washington's Birthday / Presidents' Day

  // Juneteenth became an exchange holiday in 2022.
  if (year >= 2022) add(observedMonday(year, 6, 19));

  const easter = easterSunday(year);
  easter.setUTCDate(easter.getUTCDate() - 2); // Good Friday
  add(easter);

  add(lastWeekday(year, 5, 1)); // Memorial Day
  add(observedMonday(year, 7, 4)); // Independence Day
  add(nthWeekday(year, 9, 1, 1)); // Labor Day
  add(nthWeekday(year, 11, 4, 4)); // Thanksgiving
  add(observedMonday(year, 12, 25)); // Christmas Day

  return dates;
}

function isFullDayHoliday(now = new Date()) {
  const parts = newYorkParts(now);
  const date = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return holidayDates(parts.year).has(date) || configuredClosedDates().has(date);
}

function isMarketOpen(now = new Date()) {
  const parts = newYorkParts(now);
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun' || isFullDayHoliday(now)) return false;
  const date = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const closeMinutes = configuredEarlyCloseMinutes().get(date) || 960;
  return parts.minutes >= 570 && parts.minutes < closeMinutes;
}

function isPreMarket(now = new Date()) {
  const parts = newYorkParts(now);
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun' || isFullDayHoliday(now)) return false;
  return parts.minutes >= 240 && parts.minutes < 570;
}

module.exports = {
  NEW_YORK,
  newYorkParts,
  holidayDates,
  configuredClosedDates,
  configuredEarlyCloseMinutes,
  isFullDayHoliday,
  isMarketOpen,
  isPreMarket,
};

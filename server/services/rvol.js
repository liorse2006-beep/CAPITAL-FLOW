function getETMinutes() {
  var now = new Date();
  var etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  var et = new Date(etStr);
  return et.getHours() * 60 + et.getMinutes();
}

function getTimeOfDayCumPct(etMinutes) {
  if (etMinutes <= 570) return 0;
  if (etMinutes >= 960) return 1;
  var breakpoints = [
    [570, 0.00],
    [600, 0.17],
    [660, 0.30],
    [720, 0.40],
    [780, 0.48],
    [840, 0.55],
    [900, 0.62],
    [930, 0.70],
    [960, 1.00],
  ];
  for (var i = 1; i < breakpoints.length; i++) {
    var t0 = breakpoints[i - 1][0];
    var p0 = breakpoints[i - 1][1];
    var t1 = breakpoints[i][0];
    var p1 = breakpoints[i][1];
    if (etMinutes <= t1) {
      var frac = (etMinutes - t0) / (t1 - t0);
      return p0 + frac * (p1 - p0);
    }
  }
  return 1;
}

function calculateRVOL(currentVolume, avgDailyVolume, etMinutes) {
  var now = new Date();
  var etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  var et = new Date(etStr);
  var day = et.getDay();
  if (day === 0 || day === 6) return null;
  var cumPct = getTimeOfDayCumPct(etMinutes);
  if (cumPct <= 0 || avgDailyVolume <= 0) return null;
  var expectedVolume = avgDailyVolume * cumPct;
  return Math.round((currentVolume / expectedVolume) * 100) / 100;
}

module.exports = { getETMinutes, getTimeOfDayCumPct, calculateRVOL };

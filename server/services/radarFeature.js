// The Capital Flow Radar was retired from the product (no screen, no plan
// row). Its routes and scheduled runs stay off unless explicitly re-enabled,
// so no saved radar keeps scanning or notifying in the background. The tables
// are kept untouched for history.
function radarEnabled() {
  return process.env.RADAR_ENABLED === 'true';
}

module.exports = { radarEnabled };

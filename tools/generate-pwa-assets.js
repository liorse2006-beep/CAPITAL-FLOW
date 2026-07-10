// Generates PWA install icons (192/512 PNG) and the social-share og:image
// from the same brand mark already used in public/favicon.svg and the
// in-app .logo-mark, rendered via Puppeteer (already a devDependency) so no
// new image tooling is needed. Re-run this any time the brand mark changes.
const puppeteer = require('puppeteer');
const path = require('path');

const BG = '#0A0A0A';
const AMBER = '#F59E0B';

// Same 3-bar mark as public/favicon.svg / .logo-mark in Topbar.jsx, drawn at
// higher fidelity for large sizes. rx on the outer square gives the
// "squircle" look iOS applies to home-screen icons anyway.
function iconHtml(size) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; }
body { width:${size}px; height:${size}px; }
</style></head>
<body>
<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="6" fill="${BG}"/>
  <rect x="8" y="14" width="4" height="12" rx="1" fill="${AMBER}"/>
  <rect x="14" y="6" width="4" height="20" rx="1" fill="${AMBER}"/>
  <rect x="20" y="18" width="4" height="8" rx="1" fill="${AMBER}"/>
</svg>
</body></html>`;
}

function ogHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1200px; height:630px; background:${BG};
  display:flex; align-items:center; justify-content:center;
  font-family: -apple-system, 'Segoe UI', Arial, sans-serif;
}
.wrap { display:flex; align-items:center; gap:36px; }
.bars { display:flex; align-items:flex-end; gap:10px; }
.bar { width:22px; border-radius:6px; background:${AMBER}; }
.text h1 { color:#fff; font-size:64px; font-weight:800; margin:0; letter-spacing:-0.02em; }
.text h1 span { color:${AMBER}; }
.text p { color:#A0A0A8; font-size:26px; margin-top:14px; font-weight:500; }
</style></head>
<body>
<div class="wrap">
  <div class="bars">
    <div class="bar" style="height:70px"></div>
    <div class="bar" style="height:130px"></div>
    <div class="bar" style="height:50px"></div>
  </div>
  <div class="text">
    <h1><span>Capital</span> Flow</h1>
    <p>Real-time volume scanner for S&amp;P 500 &amp; NASDAQ 100</p>
  </div>
</div>
</body></html>`;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  for (const size of [192, 512]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(iconHtml(size), { waitUntil: 'domcontentloaded' });
    const out = path.join(__dirname, '..', 'public', `icon-${size}.png`);
    await page.screenshot({ path: out, type: 'png' });
    console.log('✓ public/icon-' + size + '.png');
  }

  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(ogHtml(), { waitUntil: 'domcontentloaded' });
  const ogOut = path.join(__dirname, '..', 'public', 'og-image.png');
  await page.screenshot({ path: ogOut, type: 'png' });
  console.log('✓ public/og-image.png');

  await browser.close();
})();

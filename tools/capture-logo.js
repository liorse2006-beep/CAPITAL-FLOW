const puppeteer = require('puppeteer');
const path = require('path');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
* { margin:0; padding:0; }
body { width:1080px; height:1080px; background:#0A0A0A; display:flex; align-items:center; justify-content:center; }
</style></head>
<body>
<svg viewBox="0 0 500 500" width="900" height="900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ic">
      <circle cx="250" cy="250" r="190"/>
    </clipPath>
  </defs>

  <!-- Amber ring -->
  <circle cx="250" cy="250" r="198" fill="none" stroke="#F59E0B" stroke-width="11"/>

  <!-- Chart (clipped inside ring) -->
  <g clip-path="url(#ic)">
    <!-- White rising line -->
    <path d="M 55,300 C 95,305 148,345 190,330 S 268,272 318,215 S 365,158 385,140"
          stroke="#FFFFFF" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Single amber dot at end -->
    <circle cx="385" cy="140" r="12" fill="#F59E0B"/>
  </g>
</svg>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 500));
  const out = path.join(__dirname, 'CapitalFlow-logo.png');
  await page.screenshot({ path: out, type: 'png' });
  console.log('✓ CapitalFlow-logo.png נשמר');
  await browser.close();
})();

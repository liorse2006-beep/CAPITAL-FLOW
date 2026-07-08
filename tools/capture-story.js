const puppeteer = require('puppeteer');
const path = require('path');

const AMBER = '#F59E0B';
const BG    = '#060606';
const WHITE = '#FFFFFF';
const MUTED = '#6B7280';

const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1080px; height:1920px; overflow:hidden;
    background:${BG}; font-family:'Heebo',sans-serif;
    direction:rtl; display:flex; flex-direction:column;
  }
  .topbar { height:18px; background:${AMBER}; flex-shrink:0; }
  .botbar { height:14px; background:${AMBER}; flex-shrink:0; }
  .wrap {
    flex:1; display:flex; flex-direction:column;
    padding:80px 88px; justify-content:space-between;
  }
  .brand { text-align:center; }
  .brand-label { font-size:28px; font-weight:700; color:${MUTED}; margin-bottom:16px; }
  .brand-name { font-size:108px; font-weight:900; color:${AMBER}; line-height:1; }
  .divider { height:5px; width:88px; background:${AMBER}; margin:0 auto; border-radius:3px; }
  .statement {
    font-size:44px; font-weight:900; color:${WHITE};
    line-height:1.4; text-align:center;
  }
  .amber { color:${AMBER}; }
  .benefits { display:flex; flex-direction:column; gap:22px; }
  .benefit {
    display:flex; align-items:center; gap:24px;
    background:#111111; border-radius:18px; padding:28px 36px;
    border-right:5px solid ${AMBER};
  }
  .check { font-size:32px; color:${AMBER}; font-weight:900; flex-shrink:0; }
  .benefit-text { font-size:30px; font-weight:700; color:${WHITE}; line-height:1.3; }
  .tagline { text-align:center; }
  .tagline p { font-size:36px; font-weight:900; color:${WHITE}; line-height:1.6; }
  .tagline .amber-line { color:${AMBER}; }
</style>
</head>
<body>
<div class="topbar"></div>
<div class="wrap">

  <div class="brand">
    <p class="brand-label">ברוכים הבאים</p>
    <div class="brand-name">CapitalFlow</div>
  </div>

  <div class="divider"></div>

  <p class="statement">
    בנינו כלי שסורק את שוק המניות<br>
    ומזהה לאן הכסף הגדול זורם —<br>
    <span class="amber">לפני שהמחיר מגיב.</span>
  </p>

  <div class="benefits">
    <div class="benefit">
      <span class="check">✓</span>
      <span class="benefit-text">מעקב אחרי נפח מוסדי בזמן אמת</span>
    </div>
    <div class="benefit">
      <span class="check">✓</span>
      <span class="benefit-text">איתותים על תזוזות חריגות</span>
    </div>
    <div class="benefit">
      <span class="check">✓</span>
      <span class="benefit-text">מראים לך בדרך הקצרה והמקצועית ביותר לאן הכסף בשוק זורם</span>
    </div>
  </div>

  <div class="tagline">
    <p>הכסף החכם תמיד משאיר עקבות.</p>
    <p class="amber-line">אנחנו עוזרים לך לקרוא אותם.</p>
  </div>

</div>
<div class="botbar"></div>
</body>
</html>`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  const out = path.join(__dirname, 'CapitalFlow-story-1.png');
  await page.screenshot({ path: out, type: 'png' });
  console.log('✓ CapitalFlow-story-1.png נשמר');
  await browser.close();
})();

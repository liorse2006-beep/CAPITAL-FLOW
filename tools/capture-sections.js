const puppeteer = require('puppeteer');
const path = require('path');

const AMBER = '#F59E0B';
const BG    = '#060606';
const WHITE = '#FFFFFF';
const MUTED = '#6B7280';

const brandHeader = `<div style="font-size:52px; font-weight:900; color:${AMBER}; font-family:'Heebo',sans-serif; text-align:center; letter-spacing:-1px;">CapitalFlow</div>`;

const sections = [
  {
    filename: 'CapitalFlow-section-1.png',
    html: `<!DOCTYPE html>
<html dir="rtl" lang="he"><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1920px;overflow:hidden;background:${BG};font-family:'Heebo',sans-serif;direction:rtl;display:flex;flex-direction:column;}
  .topbar{height:18px;background:${AMBER};flex-shrink:0;}
  .botbar{height:14px;background:${AMBER};flex-shrink:0;}
  .wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:60px;padding:80px 100px;}
</style>
</head><body>
<div class="topbar"></div>
<div class="wrap">
  <div style="text-align:center;">
    <p style="font-size:32px;font-weight:700;color:${MUTED};margin-bottom:24px;">ברוכים הבאים</p>
    <div style="font-size:116px;font-weight:900;color:${AMBER};line-height:1;">CapitalFlow</div>
  </div>
  <div style="height:6px;width:110px;background:${AMBER};border-radius:3px;"></div>
  <p style="font-size:52px;font-weight:900;color:${WHITE};line-height:1.4;text-align:center;">
    בנינו כלי שסורק את שוק המניות<br>
    ומזהה לאן הכסף הגדול זורם —<br>
    <span style="color:${AMBER};">לפני שהמחיר מגיב.</span>
  </p>
</div>
<div class="botbar"></div>
</body></html>`
  },
  {
    filename: 'CapitalFlow-section-2.png',
    html: `<!DOCTYPE html>
<html dir="rtl" lang="he"><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1920px;overflow:hidden;background:${BG};font-family:'Heebo',sans-serif;direction:rtl;display:flex;flex-direction:column;}
  .topbar{height:18px;background:${AMBER};flex-shrink:0;}
  .botbar{height:14px;background:${AMBER};flex-shrink:0;}
  .wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:80px 90px;}
</style>
</head><body>
<div class="topbar"></div>
<div class="wrap">
  ${brandHeader}
  <div style="display:flex;flex-direction:column;gap:36px;width:100%;">
    <div style="display:flex;align-items:center;gap:30px;background:#111111;border-radius:22px;padding:48px 52px;border-right:7px solid ${AMBER};">
      <span style="font-size:44px;color:${AMBER};font-weight:900;flex-shrink:0;">✓</span>
      <span style="font-size:40px;font-weight:700;color:${WHITE};line-height:1.3;">מעקב אחרי נפח מוסדי בזמן אמת</span>
    </div>
    <div style="display:flex;align-items:center;gap:30px;background:#111111;border-radius:22px;padding:48px 52px;border-right:7px solid ${AMBER};">
      <span style="font-size:44px;color:${AMBER};font-weight:900;flex-shrink:0;">✓</span>
      <span style="font-size:40px;font-weight:700;color:${WHITE};line-height:1.3;">איתותים על תזוזות חריגות</span>
    </div>
    <div style="display:flex;align-items:center;gap:30px;background:#111111;border-radius:22px;padding:48px 52px;border-right:7px solid ${AMBER};">
      <span style="font-size:44px;color:${AMBER};font-weight:900;flex-shrink:0;">✓</span>
      <span style="font-size:40px;font-weight:700;color:${WHITE};line-height:1.3;">מראים לך בדרך הקצרה והמקצועית ביותר לאן הכסף בשוק זורם</span>
    </div>
  </div>
  <div style="height:6px;width:110px;background:${AMBER};border-radius:3px;opacity:0.4;"></div>
</div>
<div class="botbar"></div>
</body></html>`
  },
  {
    filename: 'CapitalFlow-section-3.png',
    html: `<!DOCTYPE html>
<html dir="rtl" lang="he"><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1920px;overflow:hidden;background:${BG};font-family:'Heebo',sans-serif;direction:rtl;display:flex;flex-direction:column;}
  .topbar{height:18px;background:${AMBER};flex-shrink:0;}
  .botbar{height:14px;background:${AMBER};flex-shrink:0;}
  .wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:80px 90px;}
</style>
</head><body>
<div class="topbar"></div>
<div class="wrap">
  ${brandHeader}
  <div style="text-align:center;">
    <div style="height:6px;width:110px;background:${AMBER};border-radius:3px;margin:0 auto 80px;"></div>
    <p style="font-size:58px;font-weight:900;color:${WHITE};line-height:1.6;">הכסף החכם תמיד משאיר עקבות.</p>
    <p style="font-size:58px;font-weight:900;color:${AMBER};line-height:1.6;margin-top:16px;">אנחנו עוזרים לך לקרוא אותם.</p>
  </div>
  <div style="height:6px;width:110px;background:${AMBER};border-radius:3px;opacity:0.4;"></div>
</div>
<div class="botbar"></div>
</body></html>`
  }
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  for (const s of sections) {
    await page.setContent(s.html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    const out = path.join(__dirname, s.filename);
    await page.screenshot({ path: out, type: 'png' });
    console.log(`✓ ${s.filename}`);
  }

  await browser.close();
  console.log('\nכל הסקשנים נשמרו');
})();

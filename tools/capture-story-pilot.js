const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const tmpHtml = path.join(__dirname, '_pilot_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#060606;}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#060606;overflow:hidden;font-family:Heebo,Arial,sans-serif;">

  <div style="position:absolute;top:0;width:100%;height:18px;background:#F59E0B;z-index:10;"></div>
  <div style="position:absolute;bottom:0;width:100%;height:14px;background:#F59E0B;z-index:10;"></div>

  <div style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding:60px 80px 50px;box-sizing:border-box;direction:rtl;text-align:center;">

    <!-- logo + badge -->
    <div style="display:flex;align-items:center;justify-content:space-between;width:100%;margin-bottom:64px;">
      <span style="font-weight:900;font-size:44px;color:#F59E0B;letter-spacing:1px;">CapitalFlow</span>
      <span style="border:2px solid #F59E0B;border-radius:100px;padding:10px 40px;font-size:28px;color:#F59E0B;letter-spacing:4px;font-weight:700;">BETA PILOT</span>
    </div>

    <!-- hero number -->
    <div style="font-weight:900;font-size:320px;color:#F59E0B;line-height:0.85;margin-bottom:20px;">10</div>
    <div style="font-weight:900;font-size:68px;color:#fff;margin-bottom:16px;">מקומות בלבד</div>
    <div style="font-size:46px;color:#9CA3AF;margin-bottom:60px;">לשבוע ניסיון מלא &middot; חינם לגמרי</div>

    <div style="width:100%;height:1px;background:#1a1a1a;margin-bottom:56px;"></div>

    <!-- what they get -->
    <div style="width:100%;margin-bottom:56px;text-align:right;">
      <div style="font-size:30px;color:#555;letter-spacing:3px;margin-bottom:32px;">מה תקבל</div>
      <div style="display:flex;flex-direction:column;gap:28px;">
        <div style="display:flex;align-items:center;gap:24px;font-size:50px;color:#fff;">
          <span style="color:#F59E0B;font-size:44px;">&#10003;</span>
          <span>גישה מלאה לאפליקציה</span>
        </div>
        <div style="display:flex;align-items:center;gap:24px;font-size:50px;color:#fff;">
          <span style="color:#F59E0B;font-size:44px;">&#10003;</span>
          <span>סקאנר נפח מוסדי חי</span>
        </div>
        <div style="display:flex;align-items:center;gap:24px;font-size:50px;color:#fff;">
          <span style="color:#F59E0B;font-size:44px;">&#10003;</span>
          <span>התראות בזמן אמת</span>
        </div>
      </div>
    </div>

    <div style="width:100%;height:1px;background:#1a1a1a;margin-bottom:52px;"></div>

    <!-- ask -->
    <div style="width:100%;margin-bottom:60px;text-align:right;">
      <div style="font-size:30px;color:#555;letter-spacing:3px;margin-bottom:32px;">בתמורה, בתום השבוע</div>
      <div style="display:flex;flex-direction:column;gap:22px;">
        <div style="display:flex;align-items:center;gap:24px;font-size:48px;color:#9CA3AF;">
          <span style="color:#F59E0B;">&#x2192;</span>
          <span>מה עבד עבורך?</span>
        </div>
        <div style="display:flex;align-items:center;gap:24px;font-size:48px;color:#9CA3AF;">
          <span style="color:#F59E0B;">&#x2192;</span>
          <span>מה צריך שיפור?</span>
        </div>
      </div>
    </div>

    <!-- CTA box -->
    <div style="width:100%;border:2px solid #F59E0B;border-radius:16px;padding:44px 50px;background:#080808;">
      <div style="font-weight:900;font-size:54px;color:#fff;margin-bottom:14px;">כתבו לי <span style="color:#F59E0B;">&ldquo;PILOT&rdquo;</span> בפרטי</div>
      <div style="font-size:38px;color:#555;">השמות הראשונים נכנסים &middot; המקומות מוגבלים</div>
    </div>

  </div>
</div>
</body></html>
`, 'utf8');

const pngPath = path.join(__dirname, 'CapitalFlow-story-pilot.png');

(async () => {
  console.log('\n══════════════════════════════════════════');
  console.log('  CapitalFlow — Pilot Story Screenshot');
  console.log('══════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  console.log('טוען עמוד + פונטים...');
  await page.goto('file:///' + tmpHtml.replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 30000 });

  await new Promise(r => setTimeout(r, 500));

  console.log('מצלם...');
  await page.screenshot({ path: pngPath, fullPage: false });

  await browser.close();
  fs.unlinkSync(tmpHtml);

  console.log('\n✓ נשמר: CapitalFlow-story-pilot.png');
  console.log('  נתיב: ' + pngPath + '\n');
})();

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר — הרץ: npm install ffmpeg-static --save-dev'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_breaking_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#060606;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes livepulse{0%,100%{opacity:1}50%{opacity:0.25}}
@keyframes flashin{0%{opacity:0;transform:scaleX(0)}60%{opacity:1;transform:scaleX(1.03)}100%{opacity:1;transform:scaleX(1)}}
@keyframes slidein{0%{opacity:0;transform:translateY(28px)}100%{opacity:1;transform:translateY(0)}}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#060606;overflow:hidden;">

  <!-- amber top bar -->
  <div style="position:absolute;top:0;width:100%;height:18px;background:#F59E0B;z-index:10;display:flex;align-items:center;justify-content:flex-end;padding:0 24px;box-sizing:border-box;">
    <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:12px;color:#060606;letter-spacing:1px;">CapitalFlow</span>
  </div>

  <!-- RED BREAKING BANNER -->
  <div id="banner" style="position:absolute;top:18px;width:100%;height:90px;background:#b91c1c;z-index:9;display:flex;align-items:center;justify-content:space-between;padding:0 50px;box-sizing:border-box;opacity:0;transform-origin:left center;">
    <div style="display:flex;align-items:center;gap:20px;">
      <span style="font-family:Arial,sans-serif;font-weight:900;font-size:48px;color:#fff;letter-spacing:6px;">&#x26A0; BREAKING</span>
      <span style="font-family:Arial,sans-serif;font-size:36px;color:#ffcccc;letter-spacing:3px;">NEWS</span>
    </div>
    <div id="livebadge" style="display:flex;align-items:center;gap:14px;opacity:0;transition:opacity 0.3s;">
      <span style="width:22px;height:22px;border-radius:50%;background:#fff;display:inline-block;animation:livepulse 1.2s ease-in-out infinite;"></span>
      <span style="font-family:Arial,sans-serif;font-weight:900;font-size:36px;color:#fff;letter-spacing:3px;">LIVE</span>
    </div>
  </div>

  <!-- main content area: top=108px, bottom=104px (ticker 90px + bottom bar 14px) -->
  <div style="position:absolute;top:108px;bottom:104px;left:0;right:0;display:flex;flex-direction:column;padding:50px 60px 36px;box-sizing:border-box;direction:rtl;overflow:hidden;">

    <!-- timestamp row -->
    <div id="ts" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:36px;opacity:0;transition:opacity 0.4s;flex-shrink:0;">
      <span style="font-family:'Courier New',monospace;font-size:28px;color:#555;">14.03.2025 &middot; 09:47:23</span>
      <span style="font-family:'Courier New',monospace;font-size:28px;color:#b91c1c;">סקנר נפח מוסדי</span>
    </div>

    <!-- headline -->
    <div id="hl" style="margin-bottom:44px;opacity:0;transition:opacity 0.45s;flex-shrink:0;">
      <div style="color:#b91c1c;font-family:'Courier New',monospace;font-size:32px;letter-spacing:2px;margin-bottom:14px;">&#x26A0; ALERT:</div>
      <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:76px;color:#fff;line-height:1.15;direction:rtl;">זוהתה תנועת<br>נפח חריגה</div>
    </div>

    <!-- data card -->
    <div id="card" style="background:#0f0f0f;border-right:6px solid #F59E0B;border-radius:12px;padding:36px 44px;margin-bottom:44px;opacity:0;transition:opacity 0.4s;flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 0;border-bottom:1px solid #1a1a1a;font-size:50px;font-family:'Courier New',monospace;">
        <span style="color:#555;">מניה</span>
        <span id="ticker-val" style="color:#2d2d2d;direction:ltr;">&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 0;border-bottom:1px solid #1a1a1a;font-size:50px;font-family:'Courier New',monospace;">
        <span style="color:#555;">נפח</span>
        <span style="color:#F59E0B;direction:ltr;">+847% מהממוצע</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 0;font-size:50px;font-family:'Courier New',monospace;">
        <span style="color:#555;">שינוי מחיר</span>
        <span style="color:#fff;direction:ltr;">+14.2% / 6 דקות</span>
      </div>
    </div>

    <!-- CTA (pushed to bottom) -->
    <div id="cta" style="margin-top:auto;opacity:0;transition:opacity 0.45s;flex-shrink:0;">
      <div style="height:2px;background:#1e1e1e;margin-bottom:36px;"></div>
      <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:64px;color:#F59E0B;direction:rtl;margin-bottom:28px;">CapitalFlow מזהה את זה לפניך.</div>
      <div style="font-family:'Courier New',monospace;font-size:50px;color:#9CA3AF;direction:rtl;">כנס להייליטס בעמוד.</div>
    </div>
  </div>

  <!-- ticker tape: bottom=14px, height=90px -->
  <div style="position:absolute;bottom:14px;left:0;right:0;height:90px;background:#0a0a0a;border-top:2px solid #F59E0B;overflow:hidden;display:flex;align-items:center;">
    <div id="ticker-inner" style="white-space:nowrap;font-family:'Courier New',monospace;font-size:32px;color:#F59E0B;letter-spacing:1px;will-change:transform;display:inline-block;">XYZ &middot; מוסד פיננסי A &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; נפח +847% מהממוצע &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; מחיר +14.2% ב-6 דקות &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; CapitalFlow מזהה בזמן אמת &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; 09:47:23 &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; כנס להייליטס בעמוד &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;XYZ &middot; מוסד פיננסי A &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; נפח +847% מהממוצע &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; מחיר +14.2% ב-6 דקות &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; CapitalFlow מזהה בזמן אמת &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; 09:47:23 &nbsp;&nbsp;&#x25C6;&nbsp;&nbsp; כנס להייליטס בעמוד &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
  </div>

  <!-- amber bottom bar -->
  <div style="position:absolute;bottom:0;width:100%;height:14px;background:#F59E0B;z-index:10;"></div>

  <!-- flash overlay -->
  <div id="flash" style="position:absolute;inset:0;background:#b91c1c;opacity:0;pointer-events:none;z-index:20;transition:opacity 0.08s;"></div>
</div>

<script>
var AMBER = '#F59E0B';
var WHITE = '#FFFFFF';
var GRAY  = '#9CA3AF';

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function flash(col, intensity) {
  var f = document.getElementById('flash');
  f.style.background = col || '#b91c1c';
  f.style.opacity = String(intensity || 0.22);
  setTimeout(function() { f.style.opacity = '0'; }, 100);
}


async function run() {
  console.log('RUN_START');

  // Start scrolling ticker immediately
  var tickerInner = document.getElementById('ticker-inner');
  await wait(120);
  var tickerHalfW = tickerInner.offsetWidth / 2;
  var tickerPos = 0;
  setInterval(function() {
    tickerPos -= 2;
    if (tickerPos <= -tickerHalfW) tickerPos = 0;
    tickerInner.style.transform = 'translateX(' + tickerPos + 'px)';
  }, 16);

  await wait(300);

  // Banner flash-in
  flash('#b91c1c', 0.3);
  var banner = document.getElementById('banner');
  banner.style.opacity   = '1';
  banner.style.animation = 'flashin 0.5s ease-out';
  await wait(550);

  // LIVE badge
  document.getElementById('livebadge').style.opacity = '1';
  await wait(300);

  // Timestamp
  document.getElementById('ts').style.opacity = '1';
  await wait(450);

  // Headline
  flash('#1a0000', 0.2);
  document.getElementById('hl').style.opacity = '1';
  await wait(1100);

  // Data card
  document.getElementById('card').style.opacity = '1';
  await wait(700);

  // Reveal ticker value (redacted → name)
  var tv = document.getElementById('ticker-val');
  tv.style.transition = 'opacity 0.28s, color 0.28s';
  tv.style.opacity = '0';
  await wait(320);
  tv.textContent = 'מוסד פיננסי A · XYZ';
  tv.style.color  = '#fff';
  tv.style.opacity = '1';
  await wait(700);

  // CTA
  flash('#F59E0B', 0.1);
  document.getElementById('cta').style.opacity = '1';
  await wait(2800);

  console.log('ANIM_DONE');
}

// run() triggered externally by Node.js via addScriptTag
</script>
</body></html>
`, 'utf8');

// ─── Capture ───────────────────────────────────────────────────────────────────

const webmPath = path.join(__dirname, '_breaking_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-breaking.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Breaking News Reel Capture');
  console.log('═══════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  let animDone = false;
  page.on('console', msg => {
    const text = msg.text();
    if (text === 'RUN_START')   console.log('  [page] run() התחיל');
    if (text === 'ANIM_DONE')   { console.log('  [page] אנימציה הסתיימה'); animDone = true; }
    if (msg.type() === 'error') console.log('  [page ERROR]', text);
  });
  page.on('pageerror', err => console.log('  [PAGE CRASH]', err.message));

  console.log('טוען עמוד + פונטים...');
  await page.goto('file:///' + tmpHtml.replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 30000 });

  console.log('מתחיל הקלטה...');
  const recorder = await page.screencast({ path: webmPath });
  await new Promise(r => setTimeout(r, 200));

  console.log('מפעיל אנימציה...');
  await page.addScriptTag({ content: 'run().catch(function(e){ console.error("ERR:"+e.message); });' });

  console.log('ממתין לסיום האנימציה...');
  const deadline = Date.now() + 35000;
  while (!animDone && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300));
  }

  if (!animDone) {
    console.warn('אזהרה: timeout — שומר את מה שהוקלט עד כה');
  }

  await new Promise(r => setTimeout(r, 600));
  await recorder.stop();
  await browser.close();
  console.log('✓ WebM הוקלט');

  console.log('ממיר ל-MP4...');
  const cmd = '"' + ffmpegPath + '" -y -i "' + webmPath + '" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "' + mp4Path + '"';
  execSync(cmd, { stdio: 'inherit' });

  fs.unlinkSync(webmPath);
  fs.unlinkSync(tmpHtml);

  console.log('\n✓ נשמר: CapitalFlow-reel-breaking.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

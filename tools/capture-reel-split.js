const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר — הרץ: npm install ffmpeg-static --save-dev'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_split_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#060606;}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#060606;overflow:hidden;font-family:'Courier New',monospace;">

  <!-- amber top bar -->
  <div style="position:absolute;top:0;width:100%;height:18px;background:#F59E0B;z-index:10;display:flex;align-items:center;justify-content:flex-end;padding:0 24px;box-sizing:border-box;">
    <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:13px;color:#060606;letter-spacing:1px;">CapitalFlow</span>
  </div>

  <!-- amber bottom bar -->
  <div style="position:absolute;bottom:0;width:100%;height:14px;background:#F59E0B;z-index:10;"></div>

  <!-- main flex column -->
  <div style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:flex;flex-direction:column;padding:44px 54px 36px;box-sizing:border-box;direction:rtl;">

    <!-- PROOF header -->
    <div id="ph" style="opacity:0;transition:opacity 0.4s;flex-shrink:0;margin-bottom:26px;display:flex;align-items:center;gap:22px;">
      <span style="color:#b91c1c;font-size:32px;letter-spacing:4px;">&#x26A0; PROOF FILE</span>
      <span style="color:#333;font-size:28px;">#CF-2025-03-14</span>
    </div>

    <!-- Headline -->
    <div id="hl" style="opacity:0;transition:opacity 0.45s;flex-shrink:0;margin-bottom:48px;">
      <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:80px;color:#fff;line-height:1.1;direction:rtl;">זוהתה תנועת<br>נפח חריגה</div>
    </div>

    <!-- Split panels -->
    <div style="display:flex;gap:24px;align-items:stretch;flex-shrink:0;margin-bottom:44px;">

      <!-- LEFT: BEFORE -->
      <div id="lp" style="flex:1;background:#0a0a0a;border:2px solid #222;border-radius:14px;padding:36px 36px 30px;display:flex;flex-direction:column;opacity:0;transition:opacity 0.4s;">
        <div style="font-size:26px;color:#555;letter-spacing:3px;margin-bottom:8px;">BEFORE</div>
        <div style="font-size:36px;color:#444;margin-bottom:24px;direction:ltr;">09:40</div>
        <div style="font-size:66px;font-weight:700;color:#555;direction:ltr;line-height:1;">2,340</div>
        <div style="font-size:30px;color:#333;margin-bottom:30px;direction:rtl;">מניות &middot; נפח ממוצע</div>
        <div style="height:280px;display:flex;align-items:flex-end;padding:0 20px;">
          <div id="lbar" style="width:100%;height:0;background:#2a2a2a;border-radius:6px 6px 0 0;"></div>
        </div>
        <div style="font-size:28px;color:#2a2a2a;text-align:center;margin-top:14px;letter-spacing:2px;">—</div>
      </div>

      <!-- VS divider -->
      <div id="vs" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;opacity:0;transition:opacity 0.3s;flex-shrink:0;width:48px;">
        <div style="width:2px;flex:1;background:#1a1a1a;"></div>
        <div style="font-size:26px;color:#333;letter-spacing:2px;writing-mode:vertical-lr;transform:rotate(180deg);">VS</div>
        <div style="width:2px;flex:1;background:#1a1a1a;"></div>
      </div>

      <!-- RIGHT: AFTER -->
      <div id="rp" style="flex:1;background:#080808;border:2px solid #F59E0B;border-radius:14px;padding:36px 36px 30px;display:flex;flex-direction:column;opacity:0;transition:opacity 0.4s;">
        <div style="font-size:26px;color:#F59E0B;letter-spacing:3px;margin-bottom:8px;">AFTER &#x26A0;</div>
        <div style="font-size:36px;color:#F59E0B;margin-bottom:24px;direction:ltr;">09:47</div>
        <div style="font-size:66px;font-weight:700;color:#fff;direction:ltr;line-height:1;">21,820</div>
        <div style="font-size:30px;color:#666;margin-bottom:30px;direction:rtl;">מניות &middot; נפח מוסדי</div>
        <div style="height:280px;display:flex;align-items:flex-end;padding:0 20px;">
          <div id="rbar" style="width:100%;height:0;background:#F59E0B;border-radius:6px 6px 0 0;"></div>
        </div>
        <div id="pct" style="font-size:44px;color:#F59E0B;font-weight:900;text-align:center;margin-top:14px;letter-spacing:2px;opacity:0;transition:opacity 0.35s;">+847%</div>
      </div>
    </div>

    <!-- Stats -->
    <div id="stats" style="opacity:0;transition:opacity 0.4s;flex-shrink:0;margin-bottom:36px;">
      <div style="height:2px;background:#111;margin-bottom:36px;"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:48px;padding:16px 0;border-bottom:1px solid #111;">
        <span style="color:#555;">מניה</span>
        <span id="tkval" style="color:#2d2d2d;direction:ltr;">&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;&#x2588;</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:48px;padding:16px 0;">
        <span style="color:#555;">שינוי ב-6 דקות</span>
        <span style="color:#fff;direction:ltr;">+14.2%</span>
      </div>
    </div>

    <!-- CTA -->
    <div id="cta" style="margin-top:auto;opacity:0;transition:opacity 0.45s;flex-shrink:0;">
      <div style="height:2px;background:#111;margin-bottom:34px;"></div>
      <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:64px;color:#F59E0B;direction:rtl;margin-bottom:20px;">CapitalFlow מזהה את זה לפניך.</div>
      <div style="font-size:48px;color:#9CA3AF;direction:rtl;">כנס להייליטס בעמוד.</div>
    </div>
  </div>

  <!-- flash overlay -->
  <div id="flash" style="position:absolute;inset:0;background:#F59E0B;opacity:0;pointer-events:none;z-index:20;transition:opacity 0.08s;"></div>
</div>

<script>
function wait(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

function flash(col, v) {
  var f = document.getElementById('flash');
  f.style.background = col || '#F59E0B';
  f.style.opacity = String(v || 0.15);
  setTimeout(function(){ f.style.opacity = '0'; }, 100);
}

function animBar(id, targetPx, duration) {
  var el = document.getElementById(id);
  el.style.transition = 'height ' + duration + 'ms cubic-bezier(0.22,1,0.36,1)';
  el.style.height = targetPx + 'px';
}

async function run() {
  console.log('RUN_START');

  await wait(200);
  flash('#b91c1c', 0.2);
  document.getElementById('ph').style.opacity = '1';

  await wait(500);
  document.getElementById('hl').style.opacity = '1';

  await wait(900);
  document.getElementById('lp').style.opacity = '1';
  await wait(100);
  animBar('lbar', 34, 900);

  await wait(400);
  document.getElementById('vs').style.opacity = '1';

  await wait(400);
  flash('#F59E0B', 0.18);
  document.getElementById('rp').style.opacity = '1';
  await wait(80);
  animBar('rbar', 280, 900);

  await wait(1000);
  document.getElementById('pct').style.opacity = '1';

  await wait(800);
  flash('#F59E0B', 0.1);
  document.getElementById('stats').style.opacity = '1';

  await wait(800);
  var tv = document.getElementById('tkval');
  tv.style.transition = 'opacity 0.28s, color 0.28s';
  tv.style.opacity = '0';
  await wait(320);
  tv.textContent = 'מוסד פיננסי A · XYZ';
  tv.style.color  = '#fff';
  tv.style.opacity = '1';

  await wait(1200);
  flash('#F59E0B', 0.08);
  document.getElementById('cta').style.opacity = '1';

  await wait(2800);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

// ─── Capture ───────────────────────────────────────────────────────────────────

const webmPath = path.join(__dirname, '_split_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-split.mp4');

(async () => {
  console.log('\n══════════════════════════════════════════');
  console.log('  CapitalFlow — Split Proof Reel Capture');
  console.log('══════════════════════════════════════════\n');

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
  if (!animDone) console.warn('אזהרה: timeout');

  await new Promise(r => setTimeout(r, 600));
  await recorder.stop();
  await browser.close();
  console.log('✓ WebM הוקלט');

  console.log('ממיר ל-MP4...');
  const cmd = '"' + ffmpegPath + '" -y -i "' + webmPath + '" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "' + mp4Path + '"';
  execSync(cmd, { stdio: 'inherit' });

  fs.unlinkSync(webmPath);
  fs.unlinkSync(tmpHtml);

  console.log('\n✓ נשמר: CapitalFlow-reel-split.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

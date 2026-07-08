const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_bignumber_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#060606;}
.fr{position:absolute;top:18px;bottom:14px;left:0;right:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.35s;}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#060606;overflow:hidden;">

  <div style="position:absolute;top:0;width:100%;height:18px;background:#F59E0B;z-index:10;display:flex;align-items:center;justify-content:flex-end;padding:0 24px;box-sizing:border-box;">
    <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:13px;color:#060606;">CapitalFlow</span>
  </div>
  <div style="position:absolute;bottom:0;width:100%;height:14px;background:#F59E0B;z-index:10;"></div>

  <!-- Frame 0: 17:03 -->
  <div id="f0" class="fr">
    <div style="display:flex;flex-direction:column;align-items:center;gap:20px;text-align:center;">
      <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:400px;color:#fff;line-height:0.85;direction:ltr;">17:03</span>
      <span style="font-family:'Courier New',monospace;font-size:56px;color:#222;">&#x2014;</span>
    </div>
  </div>

  <!-- Frame 1: 17:24 -->
  <div id="f1" class="fr">
    <div style="display:flex;flex-direction:column;align-items:center;gap:40px;text-align:center;">
      <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:340px;color:#9CA3AF;line-height:0.85;direction:ltr;">17:24</span>
      <span style="font-family:'Courier New',monospace;font-size:68px;color:#555;direction:rtl;">הידיעה יוצאת.</span>
      <span style="font-family:'Courier New',monospace;font-size:60px;color:#444;direction:rtl;">כולם קונים עכשיו.</span>
    </div>
  </div>

  <!-- Frame 2: אתה כבר שם + +14.2% -->
  <div id="f2" class="fr">
    <div style="display:flex;flex-direction:column;align-items:center;gap:50px;text-align:center;">
      <span style="font-family:'Courier New',monospace;font-size:96px;color:#fff;direction:rtl;">אתה כבר שם.</span>
      <div style="width:500px;height:2px;background:#1a1a1a;"></div>
      <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:300px;color:#F59E0B;direction:ltr;line-height:0.9;">+14.2%</span>
    </div>
  </div>

  <!-- Frame 3: CapitalFlow -->
  <div id="f3" class="fr">
    <div style="display:flex;flex-direction:column;align-items:center;gap:60px;text-align:center;">
      <span style="font-family:'Courier New',monospace;font-size:62px;color:#555;direction:rtl;letter-spacing:4px;">זיהוי נפח מוסדי.</span>
      <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:180px;color:#F59E0B;">CapitalFlow.</span>
    </div>
  </div>

  <div id="ovl" style="position:absolute;inset:0;background:#F59E0B;opacity:0;pointer-events:none;z-index:5;transition:opacity 0.06s;"></div>
</div>

<script>
function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

function show(id){ document.getElementById(id).style.opacity='1'; }
function hide(id){ document.getElementById(id).style.opacity='0'; }
function flash(v){
  var o=document.getElementById('ovl');
  o.style.opacity=String(v);
  setTimeout(function(){ o.style.opacity='0'; },100);
}

async function run(){
  console.log('RUN_START');

  await wait(200);
  show('f0');

  await wait(2200);
  hide('f0');
  await wait(350);
  flash(0.12);
  show('f1');

  await wait(2250);
  hide('f1');
  await wait(350);
  flash(0.2);
  show('f2');

  await wait(3200);
  hide('f2');
  await wait(350);
  show('f3');

  await wait(3000);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_bignumber_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-bignumber.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Big Number Reel Capture');
  console.log('═══════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  let animDone = false;
  page.on('console', msg => {
    const t = msg.text();
    if (t === 'RUN_START')   console.log('  [page] run() התחיל');
    if (t === 'ANIM_DONE') { console.log('  [page] אנימציה הסתיימה'); animDone = true; }
    if (msg.type() === 'error') console.log('  [page ERROR]', t);
  });
  page.on('pageerror', err => console.log('  [PAGE CRASH]', err.message));

  console.log('טוען עמוד + פונטים...');
  await page.goto('file:///' + tmpHtml.replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 30000 });

  console.log('מתחיל הקלטה...');
  const recorder = await page.screencast({ path: webmPath });
  await new Promise(r => setTimeout(r, 200));

  console.log('מפעיל אנימציה...');
  await page.addScriptTag({ content: 'run().catch(function(e){ console.error("ERR:"+e.message); });' });

  console.log('ממתין לסיום...');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-bignumber.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

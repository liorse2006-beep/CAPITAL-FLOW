const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_notification_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#000;}
@keyframes notifDrop {
  0%   { transform:translateY(-180px); opacity:0; }
  60%  { transform:translateY(10px); opacity:1; }
  80%  { transform:translateY(-4px); }
  100% { transform:translateY(0px); opacity:1; }
}
@keyframes shake {
  0%,100% { transform:translateX(0); }
  20% { transform:translateX(-6px); }
  45% { transform:translateX(6px); }
  65% { transform:translateX(-4px); }
  82% { transform:translateX(3px); }
}
@keyframes fadeUp {
  0%   { opacity:0; transform:translateY(24px); }
  100% { opacity:1; transform:translateY(0); }
}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#000;overflow:hidden;">

  <div style="position:absolute;top:0;width:100%;height:18px;background:#F59E0B;z-index:20;"></div>
  <div style="position:absolute;bottom:0;width:100%;height:14px;background:#F59E0B;z-index:20;"></div>

  <div id="shaker" style="position:absolute;inset:0;">

    <div id="notif" style="position:absolute;top:60px;left:60px;right:60px;opacity:0;z-index:15;">
      <div style="background:rgba(28,28,30,0.97);border-radius:28px;padding:36px 44px;display:flex;align-items:center;gap:36px;border:1px solid rgba(255,255,255,0.08);">
        <div style="width:100px;height:100px;background:#F59E0B;border-radius:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:38px;color:#000;">CF</span>
        </div>
        <div style="flex:1;direction:rtl;text-align:right;">
          <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:40px;color:#fff;margin-bottom:10px;">CapitalFlow</div>
          <div style="font-family:'Courier New',monospace;font-size:34px;color:#9CA3AF;">&#x05E0;&#x05E4;&#x05D7; &#x05D7;&#x05E8;&#x05D9;&#x05D2; &#x05D6;&#x05D5;&#x05D4;&#x05D4; &middot; AAPL</div>
        </div>
      </div>
    </div>

    <div id="chartzone" style="position:absolute;top:320px;left:60px;right:60px;bottom:300px;opacity:0;transition:opacity 0.35s;">
      <svg viewBox="0 0 960 900" width="960" height="900" style="overflow:visible;">
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#22c55e" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
          </linearGradient>
          <clipPath id="cp"><rect id="cliprect" x="0" y="0" width="0" height="900"/></clipPath>
        </defs>
        <path d="M0,860 C120,840 200,820 300,790 S450,730 560,660 S700,520 800,360 S900,180 960,80 L960,900 L0,900 Z"
          fill="url(#lg)" clip-path="url(#cp)"/>
        <path id="priceline"
          d="M0,860 C120,840 200,820 300,790 S450,730 560,660 S700,520 800,360 S900,180 960,80"
          stroke="#22c55e" stroke-width="12" fill="none" stroke-linecap="round"
          stroke-dasharray="2200" stroke-dashoffset="2200"/>
        <circle cx="960" cy="80" r="20" fill="#22c55e" id="enddot" opacity="0" style="transition:opacity 0.25s;"/>
      </svg>
    </div>

    <div id="pct" style="position:absolute;bottom:340px;left:0;right:0;text-align:center;opacity:0;">
      <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:260px;color:#22c55e;line-height:1;direction:ltr;">+32%</div>
    </div>

    <div id="outro" style="position:absolute;bottom:80px;left:0;right:0;text-align:center;opacity:0;transition:opacity 0.5s;">
      <div style="height:2px;background:#111;margin:0 100px 40px;"></div>
      <div style="font-family:'Courier New',monospace;font-size:48px;color:#3a3a3a;direction:rtl;letter-spacing:3px;margin-bottom:20px;">&#x05D6;&#x05D9;&#x05D4;&#x05D5;&#x05D9; &#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</div>
      <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:160px;color:#F59E0B;line-height:1;">CapitalFlow</div>
    </div>

  </div>

  <div id="fl" style="position:absolute;inset:0;opacity:0;pointer-events:none;z-index:19;background:#F59E0B;transition:opacity 0.06s;"></div>
</div>

<script>
function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

function flash(v){
  var f=document.getElementById('fl');
  f.style.opacity=String(v);
  setTimeout(function(){ f.style.opacity='0'; },80);
}

function animClip(ms){
  var r=document.getElementById('cliprect'), start=Date.now();
  function step(){
    var p=Math.min((Date.now()-start)/ms,1), ep=1-Math.pow(1-p,3);
    r.setAttribute('width',String(ep*960));
    if(p<1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function run(){
  console.log('RUN_START');

  await wait(300);
  document.getElementById('notif').style.animation='notifDrop 0.4s cubic-bezier(0.22,1,0.36,1) forwards';

  await wait(350);
  document.getElementById('shaker').style.animation='shake 0.28s ease-out';
  flash(0.07);

  await wait(750);
  document.getElementById('chartzone').style.opacity='1';
  animClip(1400);
  await wait(20);
  var line=document.getElementById('priceline');
  line.style.transition='stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)';
  line.style.strokeDashoffset='0';

  await wait(1460);
  document.getElementById('enddot').style.opacity='1';
  flash(0.2);
  document.getElementById('pct').style.animation='fadeUp 0.4s ease-out forwards';

  await wait(1200);
  document.getElementById('outro').style.opacity='1';

  await wait(2500);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_notification_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-notification.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Notification Reel Capture');
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
  const deadline = Date.now() + 30000;
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

  console.log('\n✓ נשמר: CapitalFlow-reel-notification.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

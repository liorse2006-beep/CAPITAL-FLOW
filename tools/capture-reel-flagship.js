const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_flagship_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#08090b;}
@keyframes fadeUp { 0% { opacity:0; transform:translateY(24px); } 100% { opacity:1; transform:translateY(0); } }
@keyframes fadeOutUp { 0% { opacity:1; transform:translateY(0); } 100% { opacity:0; transform:translateY(-24px); } }
@keyframes btnPress { 0%,100% { transform:scale(1); } 50% { transform:scale(0.96); } }
@keyframes pctPop {
  0%   { opacity:0; transform:translateY(20px) scale(0.4); }
  60%  { opacity:1; transform:translateY(0) scale(1.15); }
  100% { opacity:1; transform:translateY(0) scale(1); }
}
* { font-family: Heebo, Arial, sans-serif; }
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#08090b;overflow:hidden;font-family:Heebo,Arial,sans-serif;">

  <div style="position:absolute;top:0;left:0;right:0;height:18px;background:#F59E0B;z-index:30;"></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:14px;background:#F59E0B;z-index:30;"></div>

  <div id="step1" style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px;">
    <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:100px;color:#fff;line-height:1.3;direction:rtl;">CapitalFlow &#x05DE;&#x05D6;&#x05D4;&#x05D4;<br><span style="color:#F59E0B;">&#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</span><br>&#x05DC;&#x05E4;&#x05E0;&#x05D9; &#x05D4;&#x05E4;&#x05E8;&#x05D9;&#x05E6;&#x05D4; &#x05E9;&#x05DC; &#x05D4;&#x05DE;&#x05E0;&#x05D9;&#x05D4;.</div>
  </div>

  <div id="step2" style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px;direction:rtl;">

    <svg viewBox="0 0 900 420" width="900" height="420" style="overflow:visible;margin-bottom:50px;">
      <defs>
        <linearGradient id="lgp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#22c55e" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#22c55e" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M0,340 C120,330 200,310 300,280 S460,200 580,120 S760,40 900,15 L900,420 L0,420 Z" fill="url(#lgp)"/>
      <path id="pline" d="M0,340 C120,330 200,310 300,280 S460,200 580,120 S760,40 900,15"
        stroke="#22c55e" stroke-width="10" fill="none" stroke-linecap="round"
        stroke-dasharray="1300" stroke-dashoffset="1300"/>
      <circle id="alertDot" cx="300" cy="280" r="16" fill="#F59E0B" opacity="0"/>
    </svg>

    <div style="font-family:Heebo,Arial,sans-serif;font-size:38px;color:#9CA3AF;line-height:1.6;">&#x05DB;&#x05D0;&#x05DF; CapitalFlow &#x05D4;&#x05EA;&#x05E8;&#x05D9;&#x05E2;.<br>6 &#x05E9;&#x05E2;&#x05D5;&#x05EA; &#x05D0;&#x05D7;&#x05E8; &#x05DB;&#x05DA;:</div>
    <div id="bigPct" style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:150px;color:#22c55e;direction:ltr;opacity:0;margin-top:20px;">+22.7%</div>
  </div>

  <div id="step3" style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px;direction:rtl;">
    <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:72px;color:#fff;line-height:1.3;margin-bottom:60px;">&#x05D0;&#x05EA;&#x05D4; &#x05D9;&#x05DB;&#x05D5;&#x05DC; &#x05DC;&#x05D3;&#x05E2;&#x05EA;<br>&#x05DC;&#x05E4;&#x05E0;&#x05D9; &#x05DB;&#x05D5;&#x05DC;&#x05DD;.</div>
    <div id="ctaBtn" style="font-family:Heebo,Arial,sans-serif;background:#F59E0B;color:#000;font-weight:900;font-size:44px;padding:34px 70px;border-radius:100px;">&#x05E0;&#x05E1;&#x05D4; &#x05D1;&#x05D7;&#x05D9;&#x05E0;&#x05DD; &middot; 3 &#x05E1;&#x05E8;&#x05D9;&#x05E7;&#x05D5;&#x05EA;</div>
  </div>

  <div id="outro" style="position:absolute;inset:0;background:#08090b;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity 0.6s;z-index:40;">
    <div style="font-family:'Roboto Mono',monospace;font-size:46px;color:#4a4a4a;direction:rtl;letter-spacing:3px;margin-bottom:24px;">&#x05D6;&#x05D9;&#x05D4;&#x05D5;&#x05D9; &#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</div>
    <div style="font-weight:900;font-size:160px;color:#F59E0B;line-height:1;">CapitalFlow</div>
  </div>

</div>

<script>
function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

async function run(){
  console.log('RUN_START');

  if(document.fonts && document.fonts.ready){
    await Promise.all([
      document.fonts.load('900 100px Heebo'),
      document.fonts.load('400 38px Heebo')
    ]);
    await document.fonts.ready;
  }

  var step1=document.getElementById('step1');
  var step2=document.getElementById('step2');
  var step3=document.getElementById('step3');
  var pline=document.getElementById('pline');
  var alertDot=document.getElementById('alertDot');
  var bigPct=document.getElementById('bigPct');
  var ctaBtn=document.getElementById('ctaBtn');
  var outro=document.getElementById('outro');

  await wait(300);
  step1.style.display='flex';
  step1.style.animation='fadeUp 0.5s ease-out forwards';

  await wait(2300);
  step1.style.animation='fadeOutUp 0.4s ease-in forwards';

  await wait(400);
  step1.style.display='none';

  await wait(100);
  step2.style.display='flex';
  step2.style.animation='fadeUp 0.5s ease-out forwards';

  await wait(600);
  pline.style.transition='stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)';
  pline.style.strokeDashoffset='700';

  await wait(1400);
  alertDot.style.opacity='1';

  await wait(500);
  pline.style.transition='stroke-dashoffset 1.1s cubic-bezier(0.4,0,0.2,1)';
  pline.style.strokeDashoffset='0';

  await wait(1100);
  bigPct.style.animation='pctPop 0.6s cubic-bezier(0.22,1.6,0.36,1) forwards';

  await wait(1900);
  step2.style.animation='fadeOutUp 0.4s ease-in forwards';

  await wait(400);
  step2.style.display='none';

  await wait(100);
  step3.style.display='flex';
  step3.style.animation='fadeUp 0.5s ease-out forwards';

  await wait(600);
  ctaBtn.style.animation='btnPress 1.3s ease-in-out infinite';

  await wait(2000);
  outro.style.opacity='1';

  await wait(2500);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_flagship_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-flagship.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Flagship Explainer Reel Capture');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-flagship.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

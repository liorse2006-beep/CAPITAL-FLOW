const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_smokefire_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
* { font-family: Heebo, Arial, sans-serif; }
body{width:1080px;height:1920px;overflow:hidden;background:#0a0606;}
@keyframes fadeUp { 0% { opacity:0; transform:translateY(24px); } 100% { opacity:1; transform:translateY(0); } }
@keyframes fadeOutUp { 0% { opacity:1; transform:translateY(0); } 100% { opacity:0; transform:translateY(-24px); } }
@keyframes flicker {
  0%,100% { opacity:1; } 45% { opacity:0.75; } 70% { opacity:0.9; }
}
@keyframes riseUp {
  0% { transform:translateY(0) scale(1); opacity:0.9; }
  100% { transform:translateY(-30px) scale(1.15); opacity:0; }
}
@keyframes btnPress { 0%,100% { transform:scale(1); } 50% { transform:scale(0.96); } }
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#0a0606;overflow:hidden;">

  <div style="position:absolute;top:0;left:0;right:0;height:18px;background:#F59E0B;z-index:30;"></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:14px;background:#F59E0B;z-index:30;"></div>

  <div id="step1" style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px;">
    <div style="font-weight:900;font-size:88px;color:#fff;line-height:1.35;direction:rtl;">&#x05E8;&#x05D5;&#x05D1; &#x05D4;&#x05E1;&#x05D5;&#x05D7;&#x05E8;&#x05D9;&#x05DD;<br>&#x05E8;&#x05D5;&#x05D0;&#x05D9;&#x05DD; &#x05D0;&#x05EA; &#x05D6;&#x05D4;<br><span style="color:#b91c1c;">&#x05DE;&#x05D0;&#x05D5;&#x05D7;&#x05E8; &#x05DE;&#x05D3;&#x05D9;.</span></div>
  </div>

  <div id="step2" style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px;direction:rtl;">

    <div style="display:flex;align-items:center;justify-content:center;gap:50px;margin-bottom:60px;">
      <div id="smokeIcon" style="position:relative;width:160px;height:160px;">
        <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);font-size:100px;">&#x1F525;</div>
        <div class="puff" style="position:absolute;bottom:90px;left:35%;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.5);"></div>
        <div class="puff" style="position:absolute;bottom:100px;left:55%;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.4);animation-delay:0.4s;"></div>
      </div>
      <div style="font-size:60px;color:#555;">&#8596;</div>
      <div style="font-size:100px;">&#x1F4C8;</div>
    </div>

    <div style="font-size:56px;color:#fff;line-height:1.7;">
      &#x05DC;&#x05E4;&#x05E0;&#x05D9; &#x05E9;&#x05E8;&#x05D5;&#x05D0;&#x05D9;&#x05DD; &#x05E2;&#x05E9;&#x05DF; &mdash; <span style="color:#F59E0B;font-weight:900;">&#x05D9;&#x05E9; &#x05D0;&#x05E9;.</span><br>
      &#x05DC;&#x05E4;&#x05E0;&#x05D9; &#x05E9;&#x05D4;&#x05DE;&#x05E0;&#x05D9;&#x05D4; &#x05D6;&#x05D6;&#x05D4; &mdash; <span style="color:#F59E0B;font-weight:900;">&#x05D9;&#x05E9; &#x05E0;&#x05E4;&#x05D7;.</span>
    </div>
  </div>

  <div id="step3" style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px;direction:rtl;background:#0a0605;">
    <div style="font-weight:900;font-size:90px;color:#fff;line-height:1.35;">
      <span style="color:#F59E0B;">CapitalFlow</span> &#x05E8;&#x05D5;&#x05D0;&#x05D4;<br>&#x05D0;&#x05EA; &#x05D4;&#x05D0;&#x05E9;.<br>
      <span style="font-size:56px;color:#9CA3AF;font-weight:400;">&#x05DC;&#x05D0; &#x05DE;&#x05D7;&#x05DB;&#x05D4; &#x05DC;&#x05E2;&#x05E9;&#x05DF;.</span>
    </div>
  </div>

  <div id="step4" style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px;direction:rtl;">
    <div style="font-weight:900;font-size:66px;color:#fff;line-height:1.3;margin-bottom:56px;">&#x05EA;&#x05E8;&#x05D0;&#x05D4; &#x05D0;&#x05EA; &#x05D6;&#x05D4;<br>&#x05DC;&#x05E4;&#x05E0;&#x05D9; &#x05E9;&#x05DB;&#x05D5;&#x05DC;&#x05DD; &#x05E8;&#x05D5;&#x05D0;&#x05D9;&#x05DD;.</div>
    <div id="ctaBtn" style="background:#F59E0B;color:#000;font-weight:900;font-size:42px;padding:32px 66px;border-radius:100px;">&#x05E0;&#x05E1;&#x05D4; &#x05D1;&#x05D7;&#x05D9;&#x05E0;&#x05DD;</div>
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
      document.fonts.load('900 88px Heebo'),
      document.fonts.load('400 56px Heebo')
    ]);
    await document.fonts.ready;
  }

  var step1=document.getElementById('step1');
  var step2=document.getElementById('step2');
  var step3=document.getElementById('step3');
  var step4=document.getElementById('step4');
  var ctaBtn=document.getElementById('ctaBtn');
  var outro=document.getElementById('outro');

  await wait(250);
  step1.style.display='flex';
  step1.style.animation='fadeUp 0.4s ease-out forwards';

  await wait(1350);
  step1.style.animation='fadeOutUp 0.3s ease-in forwards';

  await wait(300);
  step1.style.display='none';

  await wait(100);
  step2.style.display='flex';
  step2.style.animation='fadeUp 0.4s ease-out forwards';
  document.getElementById('smokeIcon').style.animation='flicker 1.2s ease-in-out infinite';
  var puffs=document.querySelectorAll('.puff');
  puffs.forEach(function(p,i){
    p.style.animation='riseUp 1.3s ease-out '+(i*0.4)+'s infinite';
  });

  await wait(2400);
  step2.style.animation='fadeOutUp 0.3s ease-in forwards';

  await wait(300);
  step2.style.display='none';

  await wait(100);
  step3.style.display='flex';
  step3.style.animation='fadeUp 0.4s ease-out forwards';

  await wait(1700);
  step3.style.animation='fadeOutUp 0.3s ease-in forwards';

  await wait(300);
  step3.style.display='none';

  await wait(100);
  step4.style.display='flex';
  step4.style.animation='fadeUp 0.4s ease-out forwards';

  await wait(500);
  ctaBtn.style.animation='btnPress 1.3s ease-in-out infinite';

  await wait(1500);
  outro.style.opacity='1';

  await wait(2500);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_smokefire_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-smokefire.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Smoke & Fire Reel Capture');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-smokefire.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

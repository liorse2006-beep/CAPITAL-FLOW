const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_quiz_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#060606;}
@keyframes popIn { 0% { opacity:0; transform:scale(0.7); } 100% { opacity:1; transform:scale(1); } }
@keyframes fadeUp { 0% { opacity:0; transform:translateY(20px); } 100% { opacity:1; transform:translateY(0); } }
@keyframes ringPulse {
  0%,100% { box-shadow:0 0 0 0 rgba(34,197,94,0.5); }
  50% { box-shadow:0 0 0 20px rgba(34,197,94,0); }
}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#060606;overflow:hidden;">

  <div style="position:absolute;top:0;left:0;right:0;height:18px;background:#F59E0B;z-index:30;"></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:14px;background:#F59E0B;z-index:30;"></div>

  <div id="question" style="position:absolute;top:220px;left:70px;right:70px;text-align:center;display:none;direction:rtl;">
    <div style="font-weight:900;font-size:66px;color:#fff;line-height:1.3;">&#x05D0;&#x05D9;&#x05D6;&#x05D5; &#x05DE;&#x05E9;&#x05EA;&#x05D9; &#x05D4;&#x05DE;&#x05E0;&#x05D9;&#x05D5;&#x05EA;<br>&#x05E2;&#x05DC;&#x05EA;&#x05D4; 20% &#x05D4;&#x05D9;&#x05D5;&#x05DD;?</div>
  </div>

  <div id="cards" style="position:absolute;top:520px;left:70px;right:70px;display:none;gap:36px;">
    <div id="cardA" style="flex:1;background:#131315;border:3px solid #2a2a2e;border-radius:24px;padding:50px 30px;text-align:center;transition:opacity 0.4s,transform 0.4s,border-color 0.4s;position:relative;">
      <div style="font-weight:900;font-size:64px;color:#fff;margin-bottom:20px;">A</div>
      <div style="font-family:'Courier New',monospace;font-size:34px;color:#666;">&#x05DE;&#x05E0;&#x05D9;&#x05D4; 1</div>
    </div>
    <div id="cardB" style="flex:1;background:#131315;border:3px solid #2a2a2e;border-radius:24px;padding:50px 30px;text-align:center;transition:border-color 0.4s;position:relative;">
      <div style="font-weight:900;font-size:64px;color:#fff;margin-bottom:20px;">B</div>
      <div style="font-family:'Courier New',monospace;font-size:34px;color:#666;">&#x05DE;&#x05E0;&#x05D9;&#x05D4; 2</div>
      <div id="winBadge" style="position:absolute;top:-30px;left:-20px;display:none;background:#22c55e;color:#000;font-weight:900;font-size:40px;padding:10px 26px;border-radius:100px;direction:ltr;">+20%</div>
    </div>
  </div>

  <div id="countdown" style="position:absolute;top:900px;left:0;right:0;text-align:center;display:none;">
    <div id="cdNum" style="width:200px;height:200px;border-radius:50%;border:6px solid #F59E0B;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:100px;color:#F59E0B;margin:0 auto;">3</div>
  </div>

  <div id="payoff" style="position:absolute;top:1200px;left:0;right:0;text-align:center;display:none;direction:rtl;">
    <div style="font-family:'Courier New',monospace;font-size:52px;color:#22c55e;">CapitalFlow &#x05D4;&#x05EA;&#x05E8;&#x05D9;&#x05E2; &#x05D1;&#x05D6;&#x05DE;&#x05DF;.</div>
  </div>

  <div id="outro" style="position:absolute;inset:0;background:#060606;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity 0.6s;z-index:40;">
    <div style="font-family:'Courier New',monospace;font-size:50px;color:#4a4a4a;direction:rtl;letter-spacing:3px;margin-bottom:24px;">&#x05D6;&#x05D9;&#x05D4;&#x05D5;&#x05D9; &#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</div>
    <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:160px;color:#F59E0B;line-height:1;">CapitalFlow</div>
  </div>

</div>

<script>
function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

async function run(){
  console.log('RUN_START');

  var question=document.getElementById('question');
  var cards=document.getElementById('cards');
  var cardA=document.getElementById('cardA');
  var cardB=document.getElementById('cardB');
  var countdown=document.getElementById('countdown');
  var cdNum=document.getElementById('cdNum');
  var winBadge=document.getElementById('winBadge');
  var payoff=document.getElementById('payoff');
  var outro=document.getElementById('outro');

  await wait(300);
  question.style.display='block';
  question.style.animation='fadeUp 0.5s ease-out forwards';

  await wait(500);
  cards.style.display='flex';
  cards.style.animation='fadeUp 0.5s ease-out forwards';

  await wait(700);
  countdown.style.display='block'; cdNum.textContent='3';

  await wait(800);
  cdNum.textContent='2';

  await wait(800);
  cdNum.textContent='1';

  await wait(800);
  countdown.style.display='none';

  await wait(300);
  cardA.style.opacity='0.35';
  cardA.style.transform='scale(0.94)';
  cardB.style.borderColor='#22c55e';
  cardB.style.animation='ringPulse 1.2s ease-out infinite';
  winBadge.style.display='block';
  winBadge.style.animation='popIn 0.4s cubic-bezier(0.22,1,0.36,1) forwards';

  await wait(1100);
  payoff.style.display='block';
  payoff.style.animation='fadeUp 0.5s ease-out forwards';

  await wait(2000);
  outro.style.opacity='1';

  await wait(2500);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_quiz_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-quiz.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Quiz Reel Capture');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-quiz.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

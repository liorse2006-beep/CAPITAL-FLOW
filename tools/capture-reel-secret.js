const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_secret_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#060606;}
@keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
@keyframes flicker {
  0%,100% { opacity:0.9; } 30% { opacity:0.6; } 60% { opacity:1; } 80% { opacity:0.7; }
}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#060606;overflow:hidden;">

  <div style="position:absolute;top:0;left:0;right:0;height:18px;background:#F59E0B;z-index:30;"></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:14px;background:#F59E0B;z-index:30;"></div>

  <div id="paper" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-1.5deg);width:820px;min-height:640px;background:#efe6d2;border-radius:6px;box-shadow:0 30px 80px rgba(0,0,0,0.6);padding:80px 70px;box-sizing:border-box;direction:rtl;">
    <div id="noteText" style="font-family:Heebo,Arial,sans-serif;font-weight:700;font-size:58px;color:#2a2620;line-height:1.6;transform:skewX(-2deg);"></div>
    <span id="cursor" style="display:inline-block;width:6px;height:60px;background:#2a2620;animation:blink 0.8s steps(1) infinite;vertical-align:middle;"></span>
  </div>

  <div id="burn" style="position:absolute;inset:0;background:radial-gradient(circle at 50% 50%, #F59E0B 0%, #b91c1c 35%, #060606 70%);opacity:0;z-index:25;"></div>

  <div id="outro" style="position:absolute;inset:0;background:#060606;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity 0.6s;z-index:30;">
    <div style="font-family:'Courier New',monospace;font-size:50px;color:#4a4a4a;direction:rtl;letter-spacing:3px;margin-bottom:24px;">&#x05D6;&#x05D9;&#x05D4;&#x05D5;&#x05D9; &#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</div>
    <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:160px;color:#F59E0B;line-height:1;">CapitalFlow</div>
  </div>

</div>

<script>
var FULL_TEXT = "&#x05D9;&#x05E9; &#x05D3;&#x05D1;&#x05E8; &#x05D0;&#x05D7;&#x05D3;\\n&#x05E9;&#x05D4;&#x05DD; &#x05DC;&#x05D0; &#x05E8;&#x05D5;&#x05E6;&#x05D9;&#x05DD;\\n&#x05E9;&#x05EA;&#x05D3;&#x05E2;.";

function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

async function typeText(el, cursorEl, text, charDelay){
  var i=0;
  while(i<=text.length){
    var shown = text.slice(0, i);
    el.innerHTML = shown.split('\\n').join('<br>');
    el.appendChild(cursorEl);
    i++;
    await wait(charDelay);
  }
}

async function run(){
  console.log('RUN_START');

  var noteText=document.getElementById('noteText');
  var cursor=document.getElementById('cursor');
  var burn=document.getElementById('burn');
  var paper=document.getElementById('paper');
  var outro=document.getElementById('outro');

  await wait(500);
  await typeText(noteText, cursor, FULL_TEXT, 55);

  await wait(900);
  burn.style.animation='flicker 0.5s ease-in-out';
  burn.style.opacity='1';
  paper.style.transition='opacity 0.4s';
  paper.style.opacity='0';

  await wait(600);
  burn.style.opacity='0';
  outro.style.opacity='1';

  await wait(2500);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_secret_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-secret.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Secret Note Reel Capture');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-secret.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

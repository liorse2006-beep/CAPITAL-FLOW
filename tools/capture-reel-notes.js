const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_notes_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#000;}
@keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#000;overflow:hidden;">

  <div style="position:absolute;top:0;left:0;right:0;height:18px;background:#F59E0B;z-index:30;"></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:14px;background:#F59E0B;z-index:30;"></div>

  <div style="position:absolute;top:70px;left:0;right:0;padding:0 60px;direction:rtl;display:flex;align-items:center;gap:20px;font-family:Heebo,Arial,sans-serif;">
    <div style="width:50px;height:50px;background:#2a2a2e;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:26px;">&#128221;</div>
    <div style="font-size:32px;color:#666;">&#x05D8;&#x05D9;&#x05D5;&#x05D8;&#x05D4;</div>
  </div>
  <div style="position:absolute;top:150px;left:60px;right:60px;height:1px;background:#1e1e21;"></div>

  <div id="noteText" style="position:absolute;top:210px;left:70px;right:70px;bottom:400px;direction:rtl;font-family:Heebo,Arial,sans-serif;font-size:52px;color:#e5e5e5;line-height:1.75;font-weight:400;overflow:hidden;"></div>

  <div id="outro" style="position:absolute;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity 0.6s;z-index:40;font-family:Heebo,Arial,sans-serif;">
    <div style="font-family:'Courier New',monospace;font-size:50px;color:#4a4a4a;direction:rtl;letter-spacing:3px;margin-bottom:24px;">&#x05D6;&#x05D9;&#x05D4;&#x05D5;&#x05D9; &#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</div>
    <div style="font-weight:900;font-size:160px;color:#F59E0B;line-height:1;">CapitalFlow</div>
  </div>

</div>

<script>
var FULL_TEXT = "אני כותב את זה כדי לזכור.\\n\\nמכרתי מוקדם מדי. שוב.\\n\\nבפעם הבאה אני רוצה לדעת\\nלפני שכולם יודעים.\\n\\nמצאתי את זה:\\nCapitalFlow.";

function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

async function typeText(el, text, charDelay){
  var i=0;
  while(i<=text.length){
    var shown = text.slice(0, i);
    var cursorSpan = '<span style="display:inline-block;width:5px;height:44px;background:#F59E0B;animation:blink 0.8s steps(1) infinite;vertical-align:middle;margin-right:4px;"></span>';
    el.innerHTML = shown.split('\\n').join('<br>') + cursorSpan;
    i++;
    await wait(charDelay);
  }
}

async function run(){
  console.log('RUN_START');

  var noteText=document.getElementById('noteText');
  var outro=document.getElementById('outro');

  await wait(500);
  await typeText(noteText, FULL_TEXT, 42);

  await wait(500);
  var html = noteText.innerHTML;
  var idx = html.lastIndexOf('CapitalFlow.');
  if(idx>=0){
    noteText.innerHTML = html.slice(0,idx) + '<span style="color:#F59E0B;font-weight:900;">CapitalFlow.</span>';
  }

  await wait(2200);
  outro.style.opacity='1';

  await wait(2500);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_notes_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-notes.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Notes Reel Capture');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-notes.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

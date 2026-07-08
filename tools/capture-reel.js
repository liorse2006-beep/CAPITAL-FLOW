const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר — הרץ: npm install ffmpeg-static --save-dev'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

// ─── Write animation HTML to a temp file (avoids template-literal escaping issues) ───

const tmpHtml = path.join(__dirname, '_reel_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#060606;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
@keyframes livepulse{0%,100%{opacity:1}50%{opacity:0.25}}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#060606;overflow:hidden;">
  <div style="position:absolute;top:0;width:100%;height:18px;background:#F59E0B;z-index:5;"></div>
  <div style="position:absolute;bottom:0;width:100%;height:14px;background:#F59E0B;z-index:5;"></div>
  <div style="position:absolute;top:18px;bottom:14px;left:0;right:0;display:flex;flex-direction:column;align-items:center;padding:48px 60px;box-sizing:border-box;">

    <div id="badge" style="opacity:0;transition:opacity 0.5s;background:#120000;border:2px solid #dc2626;border-radius:10px;padding:20px 50px;margin-bottom:38px;text-align:center;width:920px;flex-shrink:0;">
      <div style="color:#dc2626;font-family:'Courier New',monospace;font-size:40px;font-weight:bold;letter-spacing:5px;">&#x26A0; RESTRICTED ACCESS</div>
      <div style="color:#555;font-family:'Courier New',monospace;font-size:26px;margin-top:8px;letter-spacing:2px;">FILE #: CF-2025-03-14-091</div>
    </div>

    <div style="width:920px;border:2px solid #F59E0B;border-radius:14px;background:#080808;flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;">
      <div style="padding:22px 44px;border-bottom:1px solid #1a1a1a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <span style="color:#444;font-family:'Courier New',monospace;font-size:28px;">14.03.2025 &middot; 09:47:23</span>
        <span id="live" style="color:#F59E0B;font-family:'Courier New',monospace;font-size:28px;opacity:0;">&#x2B24; LIVE</span>
      </div>
      <div id="content" style="padding:34px 44px;flex:1;overflow:hidden;direction:rtl;"></div>
    </div>
  </div>
</div>

<script>
var AMBER = '#F59E0B';
var WHITE = '#FFFFFF';
var GRAY  = '#9CA3AF';
var content = document.getElementById('content');

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function typeLine(text, color, size, speed) {
  var d = document.createElement('div');
  d.style.fontFamily = '"Courier New", monospace';
  d.style.fontSize   = size;
  d.style.color      = color;
  d.style.direction  = 'rtl';
  d.style.lineHeight = '1.55';
  var s   = document.createElement('span');
  var cur = document.createElement('span');
  cur.textContent = '◊';
  cur.style.color     = AMBER;
  cur.style.animation = 'blink 0.5s step-end infinite';
  d.appendChild(s);
  d.appendChild(cur);
  content.appendChild(d);
  for (var i = 0; i <= text.length; i++) {
    s.textContent = text.substring(0, i);
    await wait(speed);
  }
  cur.remove();
}

async function addRow(label, value, vc) {
  var d = document.createElement('div');
  d.style.display       = 'flex';
  d.style.justifyContent = 'space-between';
  d.style.alignItems    = 'center';
  d.style.direction     = 'rtl';
  d.style.padding       = '16px 0';
  d.style.borderBottom  = '1px solid #111';
  d.style.fontFamily    = '"Courier New", monospace';
  d.style.fontSize      = '52px';
  d.style.opacity       = '0';
  d.style.transition    = 'opacity 0.22s';
  var lbl = document.createElement('span');
  lbl.style.color = '#555';
  lbl.textContent = label;
  var val = document.createElement('span');
  val.style.color     = vc;
  val.style.direction = 'ltr';
  val.textContent = value;
  d.appendChild(lbl);
  d.appendChild(val);
  content.appendChild(d);
  await wait(40);
  d.style.opacity = '1';
  return d;
}

async function revealRow(row, newVal, newColor) {
  var sp = row.querySelector('span:last-child');
  sp.style.transition = 'opacity 0.22s';
  sp.style.opacity    = '0';
  await wait(260);
  sp.textContent = newVal;
  sp.style.color = newColor;
  sp.style.opacity = '1';
}

function gap(h) {
  var d = document.createElement('div');
  d.style.height = h + 'px';
  content.appendChild(d);
}

function divider() {
  var d = document.createElement('div');
  d.style.height     = '1px';
  d.style.background = '#1e1e1e';
  d.style.margin     = '18px 0';
  content.appendChild(d);
}

async function flashLine(innerHTML, fontSize) {
  var d = document.createElement('div');
  d.style.fontSize   = fontSize;
  d.style.direction  = 'rtl';
  d.style.lineHeight = '1.55';
  d.style.opacity    = '0';
  d.style.transition = 'opacity 0.3s';
  d.innerHTML = innerHTML;
  content.appendChild(d);
  await wait(60);
  d.style.opacity = '1';
}

async function run() {
  console.log('RUN_START');

  await wait(500);
  document.getElementById('badge').style.opacity = '1';
  await wait(900);

  var live = document.getElementById('live');
  live.style.animation = 'livepulse 1.2s ease-in-out infinite';
  live.style.opacity   = '1';

  await typeLine('זוהתה תנועת נפח חריגה', AMBER, '62px', 40);
  gap(20);

  var r1 = await addRow('מניה', '████████████', '#2d2d2d');
  await wait(650);
  await revealRow(r1, 'מוסד פיננסי A · XYZ', WHITE);

  await addRow('נפח', '+847% מהממוצע', AMBER);
  await addRow('09:47 — 09:53', '+14.2%', WHITE);
  gap(28);

  await typeLine('המחיר הגיב תוך 6 דקות.', WHITE, '60px', 42);
  await typeLine('זה קורה כל יום.', WHITE, '60px', 42);
  await typeLine('לא ידעת על זה.', GRAY, '56px', 42);
  gap(22);
  divider();
  gap(14);

  await flashLine(
    '<span style="color:#F59E0B;font-size:66px;font-family:Heebo,sans-serif;font-weight:900;">CapitalFlow</span>' +
    '<span style="color:#FFFFFF;font-size:60px;font-family:monospace;"> מזהה את זה לפניך.</span>',
    '60px'
  );
  await wait(500);

  await typeLine('כנס להייליטס בעמוד.', GRAY, '54px', 40);
  gap(24);

  var pill = document.createElement('div');
  pill.style.display        = 'flex';
  pill.style.justifyContent = 'center';
  var pillSpan = document.createElement('span');
  pillSpan.textContent      = 'HIGHLIGHTS';
  pillSpan.style.display    = 'inline-block';
  pillSpan.style.border     = '5px solid #F59E0B';
  pillSpan.style.borderRadius = '100px';
  pillSpan.style.padding    = '22px 80px';
  pillSpan.style.color      = '#F59E0B';
  pillSpan.style.fontSize   = '60px';
  pillSpan.style.letterSpacing = '6px';
  pillSpan.style.fontFamily = 'Heebo, Arial, sans-serif';
  pillSpan.style.fontWeight = '900';
  pillSpan.style.direction  = 'ltr';
  pillSpan.style.opacity    = '0';
  pillSpan.style.transition = 'opacity 0.4s';
  pill.appendChild(pillSpan);
  content.appendChild(pill);
  await wait(80);
  pillSpan.style.opacity = '1';

  await wait(2000);
  console.log('ANIM_DONE');
}

// run() is triggered externally by Node.js via addScriptTag after recording starts
</script>
</body></html>
`, 'utf8');

// ─── Capture ───────────────────────────────────────────────────────────────────

const webmPath = path.join(__dirname, '_reel_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel.mp4');

(async () => {
  console.log('\n═══════════════════════════════════');
  console.log('  CapitalFlow Reel — Capture Script');
  console.log('═══════════════════════════════════\n');

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
  const deadline = Date.now() + 28000;
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

  console.log('\n✓ נשמר: CapitalFlow-reel.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_newspaper_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:ital,wght@0,400;0,700;0,900;1,400&family=Heebo:wght@700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#ece5d3;}
@keyframes inkFocus {
  0%   { opacity:0; filter:blur(14px); }
  100% { opacity:1; filter:blur(0); }
}
@keyframes fadeUp {
  0% { opacity:0; transform:translateY(16px); } 100% { opacity:1; transform:translateY(0); }
}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#ece5d3;overflow:hidden;font-family:'Frank Ruhl Libre',serif;">

  <div style="position:absolute;top:0;left:0;right:0;height:18px;background:#F59E0B;z-index:30;"></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:14px;background:#F59E0B;z-index:30;"></div>

  <div style="position:absolute;top:70px;left:0;right:0;text-align:center;direction:rtl;padding:0 70px;">
    <div style="font-weight:900;font-size:82px;color:#111;letter-spacing:2px;">CAPITAL TIMES</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;border-top:3px solid #111;border-bottom:1px solid #111;padding:12px 0;">
      <div style="font-size:24px;color:#555;">&#x05DB;&#x05DC;&#x05DB;&#x05DC;&#x05D4; &middot; &#x05E9;&#x05D5;&#x05E7; &#x05D4;&#x05D4;&#x05D5;&#x05DF;</div>
      <div style="font-size:24px;color:#555;">&#x05D2;&#x05D9;&#x05DC;&#x05D9;&#x05D5;&#x05DF; 1847</div>
      <div style="font-size:24px;color:#555;">&#x05DE;&#x05D7;&#x05D9;&#x05E8;: &#x05D7;&#x05D9;&#x05E0;&#x05DD;</div>
    </div>
  </div>

  <div id="headline" style="position:absolute;top:290px;left:60px;right:60px;text-align:center;direction:rtl;opacity:0;">
    <div style="font-weight:900;font-size:112px;color:#111;line-height:1.15;">&#x05DE;&#x05E0;&#x05D9;&#x05D9;&#x05EA; ONDS &#x05E7;&#x05D5;&#x05E4;&#x05E6;&#x05EA;<br>20% &#x05EA;&#x05D5;&#x05DA; &#x05E9;&#x05E2;&#x05D5;&#x05EA;</div>
  </div>

  <div id="deck" style="position:absolute;top:660px;left:90px;right:90px;text-align:center;direction:rtl;opacity:0;">
    <div style="font-style:italic;font-size:38px;color:#333;line-height:1.5;">&#x05D4;&#x05D0;&#x05E0;&#x05DC;&#x05D9;&#x05E1;&#x05D8;&#x05D9;&#x05DD; &#x05D1;&#x05D4;&#x05DC;&#x05DD;. &#x05D4;&#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;&#x05D9;&#x05DD; &#x05DB;&#x05D1;&#x05E8; &#x05D9;&#x05D3;&#x05E2;&#x05D5;.</div>
  </div>

  <div id="bylineRow" style="position:absolute;top:770px;left:90px;right:90px;display:flex;justify-content:space-between;direction:rtl;opacity:0;border-top:1px solid #999;border-bottom:1px solid #999;padding:10px 0;">
    <div style="font-size:24px;color:#555;">&#x05DE;&#x05D0;&#x05EA; &#x05DB;&#x05EA;&#x05D1; &#x05D4;&#x05DB;&#x05DC;&#x05DB;&#x05DC;&#x05D4;</div>
    <div style="font-size:24px;color:#b91c1c;font-weight:700;">&#x05D3;&#x05D9;&#x05D5;&#x05D5;&#x05D7; &#x05D1;&#x05DC;&#x05E2;&#x05D3;&#x05D9;</div>
  </div>

  <div id="body" style="position:absolute;top:850px;left:90px;right:90px;opacity:0;direction:rtl;column-count:2;column-gap:50px;font-size:29px;line-height:1.65;color:#222;text-align:justify;">
    &#x05EA;&#x05E0;&#x05D5;&#x05E2;&#x05EA; &#x05E0;&#x05E4;&#x05D7; &#x05D7;&#x05E8;&#x05D9;&#x05D2;&#x05D4; &#x05D6;&#x05D5;&#x05D4;&#x05EA;&#x05D4; &#x05E9;&#x05E2;&#x05D5;&#x05EA; &#x05DC;&#x05E4;&#x05E0;&#x05D9; &#x05E9;&#x05D4;&#x05DE;&#x05D7;&#x05D9;&#x05E8; &#x05D4;&#x05D7;&#x05DC; &#x05DC;&#x05D6;&#x05D5;&#x05D6;. &quot;&#x05D6;&#x05D4; &#x05DC;&#x05D0; &#x05E0;&#x05E8;&#x05D0;&#x05D4; &#x05DB;&#x05DE;&#x05D5; &#x05DE;&#x05E1;&#x05D7;&#x05E8; &#x05E8;&#x05D2;&#x05D9;&#x05DC;&quot;, &#x05D0;&#x05DE;&#x05E8; &#x05E1;&#x05D5;&#x05D7;&#x05E8; &#x05E9;&#x05D1;&#x05D9;&#x05E7;&#x05E9; &#x05DC;&#x05D4;&#x05D9;&#x05E9;&#x05D0;&#x05E8; &#x05D1;&#x05E2;&#x05D9;&#x05DC;&#x05D5;&#x05DD; &#x05E9;&#x05DD;.
  </div>

  <div id="creditBox" style="position:absolute;top:1250px;left:90px;right:90px;opacity:0;border:2px solid #F59E0B;border-radius:4px;padding:24px 30px;text-align:center;direction:rtl;background:rgba(245,158,11,0.06);">
    <div style="font-family:Heebo,Arial,sans-serif;font-size:32px;color:#F59E0B;font-weight:900;">&#x05D3;&#x05D5;&#x05D5;&#x05D7; &#x05DC;&#x05E8;&#x05D0;&#x05E9;&#x05D5;&#x05E0;&#x05D4; &#x05E2;&#x05DC; &#x05D9;&#x05D3;&#x05D9; CapitalFlow</div>
    <div style="font-family:Heebo,Arial,sans-serif;font-size:24px;color:#555;margin-top:6px;">&#x05D4;&#x05D9;&#x05D5;&#x05DD;. &#x05DC;&#x05D0; &#x05DE;&#x05D7;&#x05E8;.</div>
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

  var headline=document.getElementById('headline');
  var deck=document.getElementById('deck');
  var bylineRow=document.getElementById('bylineRow');
  var body=document.getElementById('body');
  var creditBox=document.getElementById('creditBox');
  var outro=document.getElementById('outro');

  await wait(500);
  headline.style.animation='inkFocus 0.9s ease-out forwards';

  await wait(1200);
  deck.style.animation='fadeUp 0.45s ease-out forwards';

  await wait(700);
  bylineRow.style.animation='fadeUp 0.4s ease-out forwards';

  await wait(600);
  body.style.animation='fadeUp 0.5s ease-out forwards';

  await wait(1100);
  creditBox.style.animation='fadeUp 0.5s ease-out forwards';

  await wait(2200);
  outro.style.opacity='1';

  await wait(2500);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_newspaper_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-newspaper.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Newspaper Reel Capture');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-newspaper.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

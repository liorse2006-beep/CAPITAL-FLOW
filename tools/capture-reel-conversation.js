const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_conversation_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#0b0b0d;}
@keyframes bubbleIn {
  0%   { opacity:0; transform:translateY(16px) scale(0.85); }
  100% { opacity:1; transform:translateY(0) scale(1); }
}
@keyframes dotPulse {
  0%,60%,100% { opacity:0.3; transform:translateY(0); }
  30% { opacity:1; transform:translateY(-6px); }
}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#0b0b0d;overflow:hidden;">

  <div style="position:absolute;top:0;width:100%;height:18px;background:#F59E0B;z-index:20;"></div>
  <div style="position:absolute;bottom:0;width:100%;height:14px;background:#F59E0B;z-index:20;"></div>

  <div style="position:absolute;top:18px;left:0;right:0;height:130px;background:#161618;border-bottom:1px solid #232326;display:flex;align-items:center;padding:0 50px;direction:rtl;">
    <div style="width:76px;height:76px;border-radius:50%;background:#F59E0B;display:flex;align-items:center;justify-content:center;font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:30px;color:#000;margin-left:26px;">&#x05DE;</div>
    <div>
      <div style="font-family:Heebo,Arial,sans-serif;font-weight:700;font-size:38px;color:#fff;">&#x05DE;&#x05EA;&#x05DF;</div>
      <div style="font-family:Heebo,Arial,sans-serif;font-size:24px;color:#22c55e;">Online</div>
    </div>
  </div>

  <div id="chat" style="position:absolute;top:148px;bottom:14px;left:0;right:0;padding:50px 46px;box-sizing:border-box;direction:rtl;display:flex;flex-direction:column;gap:28px;overflow:hidden;"></div>

  <div id="outro" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;background:#0b0b0d;transition:opacity 0.6s;z-index:30;">
    <div style="font-family:'Courier New',monospace;font-size:50px;color:#4a4a4a;direction:rtl;letter-spacing:3px;margin-bottom:24px;">&#x05D6;&#x05D9;&#x05D4;&#x05D5;&#x05D9; &#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</div>
    <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:160px;color:#F59E0B;line-height:1;">CapitalFlow</div>
  </div>

</div>

<script>
function bubble(text, mine){
  var wrap=document.createElement('div');
  wrap.style.display='flex';
  wrap.style.justifyContent = mine ? 'flex-start' : 'flex-end';
  wrap.style.opacity='0';
  var b=document.createElement('div');
  b.style.maxWidth='640px';
  b.style.padding='26px 34px';
  b.style.borderRadius='34px';
  b.style.fontFamily='Heebo, Arial, sans-serif';
  b.style.fontSize='38px';
  b.style.lineHeight='1.4';
  if(mine){
    b.style.background='#F59E0B';
    b.style.color='#000';
    b.style.borderBottomLeftRadius='8px';
  } else {
    b.style.background='#26262a';
    b.style.color='#fff';
    b.style.borderBottomRightRadius='8px';
  }
  b.innerHTML = text;
  wrap.appendChild(b);
  return wrap;
}

function cardBubble(){
  var wrap=document.createElement('div');
  wrap.style.display='flex';
  wrap.style.justifyContent='flex-end';
  wrap.style.opacity='0';

  var card=document.createElement('div');
  card.style.background='#141416';
  card.style.border='2px solid #F59E0B';
  card.style.borderRadius='24px';
  card.style.padding='32px 36px';
  card.style.maxWidth='680px';

  var row=document.createElement('div');
  row.style.display='flex';
  row.style.alignItems='center';
  row.style.gap='20px';
  row.style.marginBottom='18px';

  var logo=document.createElement('div');
  logo.style.width='64px';
  logo.style.height='64px';
  logo.style.background='#F59E0B';
  logo.style.borderRadius='14px';
  logo.style.display='flex';
  logo.style.alignItems='center';
  logo.style.justifyContent='center';
  logo.style.fontFamily='Heebo, Arial, sans-serif';
  logo.style.fontWeight='900';
  logo.style.fontSize='26px';
  logo.style.color='#000';
  logo.textContent='CF';

  var brand=document.createElement('div');
  brand.style.fontFamily='Heebo, Arial, sans-serif';
  brand.style.fontWeight='900';
  brand.style.fontSize='32px';
  brand.style.color='#fff';
  brand.textContent='CapitalFlow';

  row.appendChild(logo);
  row.appendChild(brand);

  var line1=document.createElement('div');
  line1.style.fontFamily="'Courier New', monospace";
  line1.style.fontSize='30px';
  line1.style.color='#F59E0B';
  line1.style.marginBottom='8px';
  line1.textContent='נפח חריג זוהה · NVDA';

  var line2=document.createElement('div');
  line2.style.fontFamily="'Courier New', monospace";
  line2.style.fontSize='26px';
  line2.style.color='#666';
  line2.textContent='3 שעות לפני הקפיצה';

  card.appendChild(row);
  card.appendChild(line1);
  card.appendChild(line2);
  wrap.appendChild(card);
  return wrap;
}

function typingIndicator(){
  var wrap=document.createElement('div');
  wrap.id='typingBubble';
  wrap.style.display='flex';
  wrap.style.justifyContent='flex-end';
  wrap.style.opacity='0';
  var b=document.createElement('div');
  b.style.background='#26262a';
  b.style.borderRadius='34px';
  b.style.borderBottomLeftRadius='8px';
  b.style.padding='26px 38px';
  b.style.display='flex';
  b.style.gap='10px';
  for(var i=0;i<3;i++){
    var d=document.createElement('div');
    d.style.width='16px';
    d.style.height='16px';
    d.style.borderRadius='50%';
    d.style.background='#888';
    d.style.animation='dotPulse 1.1s ease-in-out ' + (i*0.15) + 's infinite';
    b.appendChild(d);
  }
  wrap.appendChild(b);
  return wrap;
}

function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

function addBubbleNow(el){
  document.getElementById('chat').appendChild(el);
  requestAnimationFrame(function(){
    el.style.animation='bubbleIn 0.35s cubic-bezier(0.22,1,0.36,1) forwards';
  });
}

async function run(){
  console.log('RUN_START');

  await wait(300);
  addBubbleNow(bubble('ראית מה קרה ל-NVDA היום?? 😳', false));

  await wait(1300);
  addBubbleNow(bubble('לא, מה קרה', true));

  await wait(1300);
  addBubbleNow(bubble('עלה 19.5% תוך כמה שעות.<br>היה אפשר לדעת מראש.', false));

  await wait(1700);
  var t=typingIndicator();
  document.getElementById('chat').appendChild(t);
  requestAnimationFrame(function(){ t.style.opacity='1'; });

  await wait(1400);
  t.remove();
  addBubbleNow(bubble('איך???', true));

  await wait(1350);
  addBubbleNow(cardBubble());

  await wait(1500);
  addBubbleNow(bubble('הם ידעו לפני כולם.', false));

  await wait(1700);
  document.getElementById('outro').style.opacity='1';

  await wait(2500);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_conversation_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-conversation.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Conversation Reel Capture');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-conversation.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_xray_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#060606;}
@keyframes floatup {
  0%   { opacity:0; transform:translateY(40px) scale(0.6); }
  25%  { opacity:1; transform:translateY(0px) scale(1.1); }
  60%  { opacity:1; transform:translateY(-8px) scale(1); }
  100% { opacity:1; transform:translateY(-8px) scale(1); }
}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#060606;overflow:hidden;">

  <div style="position:absolute;top:0;width:100%;height:18px;background:#F59E0B;z-index:20;display:flex;align-items:center;justify-content:flex-end;padding:0 28px;box-sizing:border-box;">
    <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:13px;color:#060606;">CapitalFlow</span>
  </div>
  <div style="position:absolute;bottom:0;width:100%;height:14px;background:#F59E0B;z-index:20;"></div>

  <div id="barcont" style="position:absolute;left:80px;right:80px;top:380px;height:740px;"></div>

  <div id="spikelbl" style="position:absolute;top:220px;left:0;right:0;text-align:center;opacity:0;z-index:12;pointer-events:none;">
    <span style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:150px;color:#22c55e;line-height:1;display:inline-block;">&#xD7;5.5</span>
  </div>

  <div id="scanline" style="position:absolute;top:18px;bottom:14px;width:6px;left:-10px;z-index:15;opacity:0;background:linear-gradient(to bottom,transparent,rgba(245,158,11,0.25) 20%,#F59E0B 50%,rgba(245,158,11,0.25) 80%,transparent);box-shadow:0 0 50px rgba(245,158,11,0.6);"></div>

  <div id="outro" style="position:absolute;top:1200px;left:0;right:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity 0.7s;padding:0 80px;box-sizing:border-box;">
    <div style="width:100%;height:2px;background:#1a1a1a;margin-bottom:60px;"></div>
    <div style="font-family:'Courier New',monospace;font-size:54px;color:#4a4a4a;direction:rtl;letter-spacing:3px;margin-bottom:28px;">&#x05D6;&#x05D9;&#x05D4;&#x05D5;&#x05D9; &#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</div>
    <div style="font-family:Heebo,Arial,sans-serif;font-weight:900;font-size:180px;color:#F59E0B;line-height:1;">CapitalFlow</div>
  </div>

  <div id="fl" style="position:absolute;inset:0;opacity:0;pointer-events:none;z-index:19;transition:opacity 0.07s;"></div>
</div>

<script>
var bars=[
  {h:55,  col:'#ef4444', glow:'rgba(239,68,68,0.5)'},
  {h:90,  col:'#22c55e', glow:'rgba(34,197,94,0.5)'},
  {h:70,  col:'#ef4444', glow:'rgba(239,68,68,0.5)'},
  {h:45,  col:'#ef4444', glow:'rgba(239,68,68,0.5)'},
  {h:720, col:'#22c55e', glow:'rgba(34,197,94,0.7)', spike:true},
  {h:60,  col:'rgba(245,158,11,0.2)', glow:'none'},
  {h:42,  col:'rgba(245,158,11,0.2)', glow:'none'},
  {h:58,  col:'rgba(245,158,11,0.2)', glow:'none'},
  {h:38,  col:'rgba(245,158,11,0.2)', glow:'none'},
];
var SPIKE_IDX=4;

function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

function flash(col,v){
  var f=document.getElementById('fl');
  f.style.background=col||'#22c55e'; f.style.opacity=String(v||0.2);
  setTimeout(function(){ f.style.opacity='0'; },110);
}

function buildBars(){
  var c=document.getElementById('barcont');
  c.innerHTML='';
  var W=920, n=bars.length, bw=76, gap=Math.floor((W-n*bw)/(n-1));
  bars.forEach(function(b,i){
    var el=document.createElement('div');
    el.id='b'+i;
    var shadow=b.glow!=='none'
      ? '0 0 60px '+b.glow+',0 0 160px '+b.glow.replace('0.5','0.2').replace('0.7','0.3')
      : 'none';
    el.style.cssText='position:absolute;bottom:0;left:'+(i*(bw+gap))+'px;width:'+bw+'px;height:0;border-radius:8px 8px 0 0;opacity:0;'
      +'transition:height 0.5s cubic-bezier(0.22,1,0.36,1),opacity 0.2s;'
      +'background:'+b.col+';'
      +(shadow!=='none'?'box-shadow:'+shadow+';':'');
    c.appendChild(el);
  });
}

function revealBar(i){
  var el=document.getElementById('b'+i);
  if(!el) return;
  el.style.opacity='1';
  el.style.height=bars[i].h+'px';
  if(bars[i].spike){
    flash('#22c55e',0.45);
    setTimeout(function(){ flash('#22c55e',0.2); },200);
    setTimeout(function(){ flash('#22c55e',0.08); },400);
    setTimeout(function(){
      var lbl=document.getElementById('spikelbl');
      lbl.style.animation='floatup 0.65s cubic-bezier(0.22,1,0.36,1) forwards';
    }, 520);
  }
}

async function run(){
  console.log('RUN_START');
  buildBars();

  await wait(500);

  var sl=document.getElementById('scanline');
  sl.style.opacity='1';

  var bw=76, n=bars.length;
  var gap=Math.floor((920-n*bw)/(n-1));
  var centers=bars.map(function(_,i){ return 80+i*(bw+gap)+bw/2; });
  var revealed=new Array(n).fill(false);
  var x=0, speed=160, paused=false, pauseUntil=0, last=null;

  setInterval(function(){
    var now=Date.now();
    if(!last){last=now;return;}
    var dt=(now-last)/1000;
    if(paused && now<pauseUntil){last=now;return;}
    if(paused){paused=false;speed=160;}
    x+=speed*dt;
    sl.style.left=x+'px';
    bars.forEach(function(_,i){
      if(!revealed[i] && x>=centers[i]){
        revealed[i]=true;
        revealBar(i);
        if(i===SPIKE_IDX){speed=0;paused=true;pauseUntil=now+1400;}
      }
    });
    if(x>1100){ sl.style.opacity='0'; }
    last=now;
  },16);

  await wait(4500);
  document.getElementById('outro').style.opacity='1';
  await wait(3000);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_xray_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-xray.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — X-Ray Reel Capture');
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
  const deadline = Date.now() + 40000;
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

  console.log('\n✓ נשמר: CapitalFlow-reel-xray.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

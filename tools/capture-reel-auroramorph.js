const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let ffmpegPath;
try { ffmpegPath = require('ffmpeg-static'); }
catch(e) { console.error('ffmpeg-static חסר'); process.exit(1); }

process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');

const tmpHtml = path.join(__dirname, '_auroramorph_tmp.html');

fs.writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1920px;overflow:hidden;background:#05050a;}
@keyframes auroraMove {
  0%   { transform:translate(-10%,-10%) rotate(0deg) scale(1); }
  50%  { transform:translate(10%,5%) rotate(180deg) scale(1.2); }
  100% { transform:translate(-10%,-10%) rotate(360deg) scale(1); }
}
@keyframes cardIn {
  0%   { opacity:0; transform:perspective(1200px) rotateY(-35deg) rotateX(8deg) translateY(60px) scale(0.85); }
  100% { opacity:1; transform:perspective(1200px) rotateY(0deg) rotateX(0deg) translateY(0) scale(1); }
}
@keyframes glowPulse {
  0%,100% { box-shadow:0 0 60px rgba(245,158,11,0.25); }
  50% { box-shadow:0 0 100px rgba(245,158,11,0.5); }
}
@keyframes badgePop {
  0% { opacity:0; transform:scale(0.3) rotate(-15deg); }
  60% { opacity:1; transform:scale(1.15) rotate(4deg); }
  100% { opacity:1; transform:scale(1) rotate(0deg); }
}
</style>
</head><body>
<div style="position:relative;width:1080px;height:1920px;background:#05050a;overflow:hidden;font-family:Heebo,Arial,sans-serif;">

  <div style="position:absolute;inset:-200px;filter:blur(80px);opacity:0.55;">
    <div style="position:absolute;width:900px;height:900px;left:100px;top:200px;background:radial-gradient(circle,#F59E0B,transparent 70%);animation:auroraMove 14s ease-in-out infinite;"></div>
    <div style="position:absolute;width:800px;height:800px;right:50px;top:900px;background:radial-gradient(circle,#22c55e,transparent 70%);animation:auroraMove 18s ease-in-out infinite reverse;"></div>
    <div style="position:absolute;width:700px;height:700px;left:250px;bottom:100px;background:radial-gradient(circle,#7c3aed,transparent 70%);animation:auroraMove 16s ease-in-out infinite;"></div>
  </div>

  <div style="position:absolute;top:0;left:0;right:0;height:18px;background:#F59E0B;z-index:30;"></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:14px;background:#F59E0B;z-index:30;"></div>

  <canvas id="particles" width="1080" height="1920" style="position:absolute;inset:0;z-index:15;pointer-events:none;"></canvas>

  <div id="glassCard" style="position:absolute;top:480px;left:100px;right:100px;opacity:0;background:rgba(255,255,255,0.06);backdrop-filter:blur(30px);border:1px solid rgba(255,255,255,0.15);border-radius:36px;padding:70px 60px;text-align:center;z-index:20;">

    <div style="font-family:'Courier New',monospace;font-size:32px;color:#9CA3AF;letter-spacing:3px;margin-bottom:30px;direction:rtl;">&#x05E0;&#x05E4;&#x05D7; &#x05D7;&#x05E8;&#x05D9;&#x05D2; &#x05D6;&#x05D5;&#x05D4;&#x05D4;</div>

    <div id="tickerNum" style="font-weight:900;font-size:110px;color:#fff;margin-bottom:30px;direction:ltr;">ONDS</div>

    <div id="morphStage" style="position:relative;height:220px;display:flex;align-items:center;justify-content:center;">
      <div id="morphBar" style="width:80%;height:36px;background:linear-gradient(90deg,#7c3aed,#F59E0B);border-radius:100px;"></div>
      <div id="badge" style="position:absolute;opacity:0;font-weight:900;font-size:130px;color:#F59E0B;direction:ltr;">+22.7%</div>
    </div>

  </div>

  <div id="outro" style="position:absolute;inset:0;background:#05050a;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity 0.7s;z-index:40;">
    <div style="font-family:'Courier New',monospace;font-size:50px;color:#4a4a4a;direction:rtl;letter-spacing:3px;margin-bottom:24px;">&#x05D6;&#x05D9;&#x05D4;&#x05D5;&#x05D9; &#x05E0;&#x05E4;&#x05D7; &#x05DE;&#x05D5;&#x05E1;&#x05D3;&#x05D9;</div>
    <div style="font-weight:900;font-size:160px;color:#F59E0B;line-height:1;">CapitalFlow</div>
  </div>

</div>

<script>
function wait(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

var canvas=document.getElementById('particles');
var ctx=canvas.getContext('2d');
var particles=[];
var particleRAF=null;

function spawnBurst(x,y,count,colors){
  for(var i=0;i<count;i++){
    var angle=Math.random()*Math.PI*2;
    var speed=4+Math.random()*14;
    particles.push({
      x:x,y:y,
      vx:Math.cos(angle)*speed,
      vy:Math.sin(angle)*speed - 4,
      life:1,
      decay:0.008+Math.random()*0.012,
      size:6+Math.random()*10,
      color:colors[Math.floor(Math.random()*colors.length)]
    });
  }
}

function tickParticles(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(var i=particles.length-1;i>=0;i--){
    var p=particles[i];
    p.x+=p.vx; p.y+=p.vy;
    p.vy+=0.35;
    p.vx*=0.98;
    p.life-=p.decay;
    if(p.life<=0){ particles.splice(i,1); continue; }
    ctx.globalAlpha=Math.max(p.life,0);
    ctx.fillStyle=p.color;
    ctx.beginPath();
    ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha=1;
  particleRAF=requestAnimationFrame(tickParticles);
}

async function run(){
  console.log('RUN_START');

  var glassCard=document.getElementById('glassCard');
  var morphBar=document.getElementById('morphBar');
  var badge=document.getElementById('badge');
  var outro=document.getElementById('outro');

  particleRAF=requestAnimationFrame(tickParticles);

  await wait(300);
  glassCard.style.animation='cardIn 0.8s cubic-bezier(0.16,1,0.3,1) forwards, glowPulse 3s ease-in-out 0.8s infinite';

  await wait(1100);
  spawnBurst(540, 900, 40, ['#F59E0B','#22c55e','#7c3aed','#fff']);

  await wait(700);
  morphBar.style.transition='transform 0.5s cubic-bezier(0.55,0,1,0.45), opacity 0.3s';
  morphBar.style.transform='scaleX(0)';
  morphBar.style.opacity='0';

  await wait(500);
  badge.style.animation='badgePop 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards';
  spawnBurst(540, 900, 70, ['#F59E0B','#fff','#22c55e']);

  await wait(2600);
  outro.style.opacity='1';

  await wait(2500);
  cancelAnimationFrame(particleRAF);
  console.log('ANIM_DONE');
}
</script>
</body></html>
`, 'utf8');

const webmPath = path.join(__dirname, '_auroramorph_tmp.webm');
const mp4Path  = path.join(__dirname, 'CapitalFlow-reel-auroramorph.mp4');

(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('  CapitalFlow — Aurora Morph Reel Capture');
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

  console.log('\n✓ נשמר: CapitalFlow-reel-auroramorph.mp4');
  console.log('  נתיב: ' + mp4Path + '\n');
})();

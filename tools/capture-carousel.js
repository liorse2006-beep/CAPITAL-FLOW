const puppeteer = require('puppeteer');
const path = require('path');

const AMBER = '#F59E0B';
const BG = '#060606';
const WHITE = '#FFFFFF';
const GRAY = '#D1D5DB';
const MUTED = '#6B7280';
const DARK_GRAY = '#374151';

const baseStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1080px; height: 1080px; overflow: hidden;
    background: ${BG}; direction: rtl; font-family: 'Heebo', sans-serif;
    display: flex; flex-direction: column;
  }
  .topbar { height: 10px; background: ${AMBER}; width: 100%; flex-shrink: 0; }
  .inner { flex: 1; display: flex; flex-direction: column; padding: 60px 70px; justify-content: space-between; }
  .counter { font-size: 22px; color: ${AMBER}; font-weight: 700; direction: ltr; }
  .pre { font-size: 26px; color: ${MUTED}; font-weight: 700; }
  .h1 { font-size: 72px; font-weight: 900; color: ${WHITE}; line-height: 1.2; }
  .amber { color: ${AMBER}; }
  .divider { height: 6px; background: ${AMBER}; width: 96px; }
  .body { font-size: 32px; color: ${GRAY}; font-weight: 700; line-height: 1.65; }
  .swipe { font-size: 28px; color: ${AMBER}; font-weight: 700; text-align: center; }
  .content { display: flex; flex-direction: column; gap: 30px; }
`;

const slides = [
  {
    filename: 'VSS-carousel-1.png',
    html: `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><style>${baseStyle}</style></head><body>
      <div class="topbar"></div>
      <div class="inner">
        <div class="counter">1 / 5</div>
        <div class="content">
          <p class="pre">רוב הטריידרים לא מדברים על זה.</p>
          <h1 class="h1">ראית מניה עולה<br><span class="amber">12%.</span><br>ולא נכנסת. שוב.</h1>
          <div class="divider"></div>
          <p class="body">זה לא חוסר ידע.<br>זה שאתה לא רואה את מה שהם רואים.</p>
        </div>
        <div class="swipe">← החלק</div>
      </div>
    </body></html>`
  },
  {
    filename: 'VSS-carousel-2.png',
    html: `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><style>${baseStyle}</style></head><body>
      <div class="topbar"></div>
      <div class="inner">
        <div class="counter">2 / 5</div>
        <div class="content">
          <p class="pre">תפסיק להאשים את עצמך.</p>
          <h1 class="h1">זה לא מזל.<br>זה לא <span class="amber">ניתוח טוב יותר.</span></h1>
          <div class="divider"></div>
          <p class="body">יש דבר אחד שהטריידרים הרווחיים רואים —<br>שאתה מפספס כל פעם.</p>
        </div>
        <div class="swipe">← החלק</div>
      </div>
    </body></html>`
  },
  {
    filename: 'VSS-carousel-3.png',
    html: `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><style>${baseStyle}</style></head><body>
      <div class="topbar"></div>
      <div class="inner">
        <div class="counter">3 / 5</div>
        <div class="content">
          <p class="pre">הסוד שלא לימדו אותך.</p>
          <h1 class="h1">לפני שמניה זינקה —<br><span class="amber">הנפח כבר ידע.</span><br>תמיד.</h1>
          <div class="divider"></div>
          <p class="body">כשמוסדות נכנסים לפוזיציה —<br>הם לא יכולים להסתיר את עצמם.<br>הנפח בוגד בהם.</p>
        </div>
        <div class="swipe">← החלק</div>
      </div>
    </body></html>`
  },
  {
    filename: 'VSS-carousel-4.png',
    html: `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><style>${baseStyle}</style></head><body>
      <div class="topbar"></div>
      <div class="inner">
        <div class="counter">4 / 5</div>
        <div class="content">
          <p class="pre">אתה יכול לעשות את זה.</p>
          <h1 class="h1" style="font-size:66px;">אתה יכול <span class="amber">לראות את זה.</span><br>אתה לא צריך להיות<br>24/7 על הגרפים.</h1>
          <div class="divider"></div>
          <p class="body">אתה רק צריך לדעת לאן להסתכל.</p>
        </div>
        <div class="swipe">← החלק</div>
      </div>
    </body></html>`
  },
  {
    filename: 'VSS-carousel-5.png',
    html: `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><style>
      ${baseStyle}
      .hl-pill {
        border: 4px solid ${AMBER}; border-radius: 100px;
        padding: 24px 72px; display: inline-block; text-align: center;
      }
    </style></head><body>
      <div class="topbar"></div>
      <div class="inner" style="padding: 64px 80px; align-items: center; text-align: center; justify-content: center; gap: 56px;">
        <div class="counter" style="position: absolute; top: 60px; left: 70px;">5 / 5</div>
        <h1 style="font-family:'Heebo',sans-serif; font-size:68px; font-weight:900; color:${WHITE}; line-height:1.3;">
          רוצה לסרוק את השוק<br>ולדעת <span style="color:${AMBER};">לאן הכסף זורם?</span>
        </h1>
        <div style="display:flex; flex-direction:column; align-items:center; gap:28px;">
          <p style="font-family:'Heebo',sans-serif; font-size:32px; font-weight:700; color:${GRAY};">
            כנס להיילייטס בעמוד
          </p>
          <div class="hl-pill">
            <span style="font-family:'Heebo',sans-serif; font-size:32px; font-weight:900; color:${AMBER}; letter-spacing:5px; direction:ltr;">HIGHLIGHTS</span>
          </div>
        </div>
      </div>
    </body></html>`
  }
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

  for (const slide of slides) {
    await page.setContent(slide.html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    const out = path.join(__dirname, slide.filename);
    await page.screenshot({ path: out, type: 'png' });
    console.log(`✓ ${slide.filename}`);
  }

  await browser.close();
  console.log('\nכל הסליידים נשמרו בתיקיית VOLUME SCANNER');
})();

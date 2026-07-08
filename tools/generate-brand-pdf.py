from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm

BG      = HexColor('#0A0A0A')
AMBER   = HexColor('#F59E0B')
WHITE   = HexColor('#FFFFFF')
GRAY    = HexColor('#D1D5DB')
MUTED   = HexColor('#6B7280')
DARK    = HexColor('#374151')
SECTION = HexColor('#141414')
GREEN   = HexColor('#22C55E')
RED     = HexColor('#EF4444')

W, H = A4
OUT  = r'C:\Users\LiorSe\OneDrive\Desktop\VOLUME SCANNER\VSS-Brand-DNA.pdf'

c = canvas.Canvas(OUT, pagesize=A4)

# ── helpers ──────────────────────────────────────────────────────────────────

def bg(color=BG):
    c.setFillColor(color); c.rect(0, 0, W, H, fill=1, stroke=0)

def topbar(h=8):
    c.setFillColor(AMBER); c.rect(0, H - h, W, h, fill=1, stroke=0)

def footer(label, num):
    c.setStrokeColor(HexColor('#1E1E1E')); c.setLineWidth(0.4)
    c.line(20*mm, 20, W - 20*mm, 20)
    c.setFillColor(MUTED); c.setFont('Helvetica', 7)
    c.drawString(20*mm, 10, f'VSS Brand DNA Document  |  {label}')
    c.drawRightString(W - 20*mm, 10, str(num))

def section_tag(text, y=H - 25*mm):
    c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 8)
    c.drawString(20*mm, y, text)

def page_title(line1, line2=None, y=H - 42*mm):
    c.setFillColor(WHITE); c.setFont('Helvetica-Bold', 30)
    c.drawString(20*mm, y, line1)
    if line2:
        c.drawString(20*mm, y - 14*mm, line2); y -= 14*mm
    c.setStrokeColor(AMBER); c.setLineWidth(3)
    c.line(20*mm, y - 5*mm, 65*mm, y - 5*mm)
    return y - 14*mm

def box(x, y, w, h, color=SECTION):
    c.setFillColor(color); c.rect(x, y, w, h, fill=1, stroke=0)

def amber_heading(text, y):
    c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 9)
    c.drawString(20*mm, y, text)
    c.setStrokeColor(HexColor('#222222')); c.setLineWidth(0.4)
    c.line(20*mm, y - 2.5*mm, W - 20*mm, y - 2.5*mm)
    return y - 9*mm

def wrap(text, x, y, max_mm, font='Helvetica', size=8, color=GRAY, lh=5.5*mm):
    words = text.split()
    line  = ''
    c.setFillColor(color); c.setFont(font, size)
    for word in words:
        test = (line + ' ' + word).strip()
        if c.stringWidth(test, font, size) <= max_mm * mm:
            line = test
        else:
            c.drawString(x, y, line); y -= lh; line = word
    if line: c.drawString(x, y, line); y -= lh
    return y

def bullet(x, y, text, sym='>', col=AMBER, tcol=GRAY, font='Helvetica', size=8):
    c.setFillColor(col);  c.setFont('Helvetica-Bold', size); c.drawString(x, y, sym)
    c.setFillColor(tcol); c.setFont(font, size);             c.drawString(x + 5*mm, y, text)


# ── PAGE 1 — COVER ───────────────────────────────────────────────────────────
bg(); topbar(12)
c.setFillColor(AMBER); c.rect(0, 0, W, 6, fill=1, stroke=0)

c.setFillColor(WHITE);  c.setFont('Helvetica-Bold', 72); c.drawCentredString(W/2, H/2 + 55, 'VSS')
c.setFillColor(AMBER);  c.setFont('Helvetica-Bold', 16); c.drawCentredString(W/2, H/2 + 26, 'VOLUME STOCK SCANNER')
c.setStrokeColor(AMBER); c.setLineWidth(1.5); c.line(W/2 - 36*mm, H/2 + 14, W/2 + 36*mm, H/2 + 14)
c.setFillColor(GRAY);   c.setFont('Helvetica', 14);      c.drawCentredString(W/2, H/2, 'Brand DNA Document')
c.setFillColor(MUTED);  c.setFont('Helvetica', 9);       c.drawCentredString(W/2, H/2 - 16, 'Confidential  ·  Internal Use Only')
c.setFillColor(DARK);   c.setFont('Helvetica', 8);       c.drawCentredString(W/2, 22, 'VSS — Volume Stock Scanner  |  2024')
c.showPage()


# ── PAGE 2 — TABLE OF CONTENTS ───────────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — OVERVIEW')
y = page_title('Table of', 'Contents')
y -= 6*mm

toc = [
    ('01', 'Mission & Vision',        'Core purpose, value proposition, and direction'),
    ('02', 'Target Audience',          'Who we serve — pain points, desires, profile'),
    ('03', 'Brand Colors',             'Full palette with hex codes and usage rules'),
    ('04', 'Typography',               'Fonts, weights, and size hierarchy'),
    ('05', 'Brand Voice & Tone',       'How we speak and what we never say'),
    ('06', 'Content Strategy',         'Instagram carousel structure and visual rules'),
    ('07', 'Logo & Visual Identity',   'Logo anatomy, technical specs, usage rules'),
    ('08', 'Key Messaging & Bio',      'Core copy, bio, and CTA language'),
]

for num, title, desc in toc:
    c.setFillColor(AMBER);  c.setFont('Helvetica-Bold', 20); c.drawString(20*mm, y, num)
    c.setFillColor(WHITE);  c.setFont('Helvetica-Bold', 11); c.drawString(38*mm, y + 3*mm, title)
    c.setFillColor(MUTED);  c.setFont('Helvetica', 8);       c.drawString(38*mm, y - 3.5*mm, desc)
    c.setStrokeColor(HexColor('#1E1E1E')); c.setLineWidth(0.4)
    c.line(20*mm, y - 8*mm, W - 20*mm, y - 8*mm)
    y -= 22*mm

footer('Table of Contents', 'TOC')
c.showPage()


# ── PAGE 3 — MISSION & VISION ─────────────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — 01')
y = page_title('Mission &', 'Vision')

box(20*mm, y - 35*mm, W - 40*mm, 33*mm)
c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 8); c.drawString(25*mm, y - 5*mm, 'MISSION')
c.setFillColor(WHITE);  c.setFont('Helvetica-Bold', 12)
c.drawString(25*mm, y - 14*mm, 'To track institutional money flow and help retail traders understand')
c.drawString(25*mm, y - 22*mm, 'where big money is moving — before the move happens.')

y -= 43*mm
box(20*mm, y - 35*mm, W - 40*mm, 33*mm)
c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 8); c.drawString(25*mm, y - 5*mm, 'VISION')
c.setFillColor(WHITE);  c.setFont('Helvetica-Bold', 12)
c.drawString(25*mm, y - 14*mm, 'A world where every retail trader sees what institutional money sees —')
c.drawString(25*mm, y - 22*mm, 'in real time, before the breakout happens.')

y -= 47*mm
y = amber_heading('CORE VALUE PROPOSITIONS', y)
y -= 2*mm

props = [
    ('01  Volume before price',      'We detect institutional accumulation via abnormal volume spikes — before price reacts.'),
    ('02  Smart money trails',       'Big institutions cannot hide. Every large entry betrays itself through volume.'),
    ('03  Accessible intelligence',  'We translate complex volume data into clear, actionable signals anyone can follow.'),
    ('04  Retail empowerment',       'We give retail traders the edge that was previously available only to institutions.'),
]
for title, desc in props:
    c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 9); c.drawString(22*mm, y, title)
    y -= 6*mm
    y = wrap(desc, 22*mm, y, 162, size=8); y -= 5*mm

footer('Mission & Vision', 1)
c.showPage()


# ── PAGE 4 — TARGET AUDIENCE ──────────────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — 02')
y = page_title('Target', 'Audience')

y = amber_heading('WHO THEY ARE', y); y -= 2*mm
for item in [
    'Hebrew-speaking retail traders — Israel and global Hebrew community',
    'Active stock market participants, beginners to intermediate level',
    'People who trade but consistently feel "late to the move"',
    'Ages 22–45, mobile-first, active on Instagram and social media',
    'Frustrated by missed breakouts and unexplained price explosions',
]:
    bullet(22*mm, y, item); y -= 7.5*mm

y -= 4*mm
y = amber_heading('PAIN POINTS', y); y -= 2*mm
for item in [
    'They see a stock up 15% — they arrived after the move. Again.',
    'They follow analysts but the alert comes after the entry point is gone.',
    'They feel institutions have an unfair information advantage.',
    'They spend hours on charts but keep missing the real signal: volume.',
    'They sense "something is off" but don\'t know exactly where to look.',
]:
    bullet(22*mm, y, item, sym='-', col=RED); y -= 7.5*mm

y -= 4*mm
y = amber_heading('WHAT THEY WANT', y); y -= 2*mm
for item in [
    'To know where institutional money is moving — before it moves.',
    'A clear, simple signal they can act on without a finance degree.',
    'To feel on the right side of the trade for once.',
    'Community and validation from people who see what they see.',
    'To stop being reactive and start being ahead of the market.',
]:
    bullet(22*mm, y, item, sym='+', col=GREEN); y -= 7.5*mm

footer('Target Audience', 2)
c.showPage()


# ── PAGE 5 — BRAND COLORS ─────────────────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — 03')
y = page_title('Brand Colors')
y -= 4*mm

colors_data = [
    ('#0A0A0A', 'Primary Background',    'Main app bg, all slides, every dark canvas', True),
    ('#F59E0B', 'Amber — Primary Accent','Logo, CTA buttons, highlights, key text, top bar, dividers', False),
    ('#FFFFFF', 'White',                 'Primary text and all headings on dark background', False),
    ('#D1D5DB', 'Light Gray',            'Secondary body text, supporting copy', False),
    ('#6B7280', 'Muted Gray',            'Counter labels, pre-text, subtle info lines', False),
    ('#374151', 'Dark Gray',             'Footer text, tertiary branding information', False),
]

for hex_col, name, desc, border in colors_data:
    c.setFillColor(HexColor(hex_col)); c.rect(20*mm, y - 14*mm, 30*mm, 12*mm, fill=1, stroke=0)
    if border:
        c.setStrokeColor(HexColor('#2A2A2A')); c.setLineWidth(0.5)
        c.rect(20*mm, y - 14*mm, 30*mm, 12*mm, fill=0, stroke=1)
    c.setFillColor(WHITE);  c.setFont('Helvetica-Bold', 10); c.drawString(54*mm, y - 3*mm, name)
    c.setFillColor(AMBER);  c.setFont('Helvetica-Bold', 8);  c.drawString(54*mm, y - 8*mm, hex_col)
    c.setFillColor(MUTED);  c.setFont('Helvetica', 7);       c.drawString(54*mm, y - 13*mm, desc)
    c.setStrokeColor(HexColor('#1A1A1A')); c.setLineWidth(0.3)
    c.line(20*mm, y - 16*mm, W - 20*mm, y - 16*mm)
    y -= 22*mm

y -= 4*mm
y = amber_heading('COLOR USAGE RULES', y); y -= 2*mm
for rule in [
    'Always use dark background (#0A0A0A). Never white, cream, or light gray.',
    'Amber (#F59E0B) is the single brand accent. Use it for everything that must stand out.',
    'Do not introduce new colors without explicit brand approval.',
    'Text on amber: use #0A0A0A (black) only. Never white text directly on amber.',
    'No gradients, no shadows, no glow effects. Always flat and clean.',
]:
    bullet(22*mm, y, rule, sym='·'); y -= 7.5*mm

footer('Brand Colors', 3)
c.showPage()


# ── PAGE 6 — TYPOGRAPHY ───────────────────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — 04')
y = page_title('Typography')
y -= 4*mm

y = amber_heading('PRIMARY FONT — HEBREW CONTENT', y); y -= 2*mm
box(20*mm, y - 24*mm, W - 40*mm, 22*mm)
c.setFillColor(WHITE); c.setFont('Helvetica-Bold', 18); c.drawString(25*mm, y - 8*mm, 'Heebo')
c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 7);  c.drawString(53*mm, y - 6*mm, 'by Google Fonts — free, open source')
c.setFillColor(GRAY);  c.setFont('Helvetica', 8)
c.drawString(25*mm, y - 15*mm, 'Weights: 700 (Bold) and 900 (Black)  |  Direction: RTL')
c.drawString(25*mm, y - 21*mm, 'Used across all Hebrew Instagram content — headlines, body, CTAs')
y -= 32*mm

y = amber_heading('SECONDARY FONT — ENGLISH & LABELS', y); y -= 2*mm
box(20*mm, y - 24*mm, W - 40*mm, 22*mm)
c.setFillColor(WHITE); c.setFont('Helvetica-Bold', 18); c.drawString(25*mm, y - 8*mm, 'Helvetica / System')
c.setFillColor(GRAY);  c.setFont('Helvetica', 8)
c.drawString(25*mm, y - 15*mm, 'Used for: English labels, HIGHLIGHTS text, counters, branding')
c.drawString(25*mm, y - 21*mm, 'Letter-spacing: +4-5px for uppercase labels (HIGHLIGHTS, CTAs)')
y -= 32*mm

y = amber_heading('TYPE SCALE  (1080 x 1080px Instagram Canvas)', y); y -= 4*mm

cols = [22*mm, 66*mm, 96*mm, 130*mm]
c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 8)
for i, h in enumerate(['Style', 'Size', 'Weight', 'Usage']):
    c.drawString(cols[i], y, h)
y -= 3*mm
c.setStrokeColor(HexColor('#2A2A2A')); c.setLineWidth(0.4); c.line(20*mm, y, W - 20*mm, y)
y -= 7*mm

rows = [
    ('Hero Brand Name',  '90–110px', '900 Black', 'VSS / brand word, maximum impact'),
    ('Section Headline', '66–74px',  '900 Black', 'Primary slide headline'),
    ('Sub-headline',     '38–42px',  '900 Black', 'Secondary heading, supporting title'),
    ('Body Copy',        '30–34px',  '700 Bold',  'Body paragraphs, explanations'),
    ('Pre-text / Label', '24–28px',  '700 Bold',  'Intro line, counter, muted context'),
    ('CTA / Button',     '28–32px',  '900 Black', 'HIGHLIGHTS, pill buttons'),
    ('Footer / Branding','18–22px',  '700 Bold',  'Brand name, slide number, footer'),
]
for style, size, weight, usage in rows:
    c.setFillColor(WHITE); c.setFont('Helvetica-Bold', 8); c.drawString(cols[0], y, style)
    c.setFillColor(AMBER); c.setFont('Helvetica', 8);       c.drawString(cols[1], y, size)
    c.setFillColor(GRAY);                                    c.drawString(cols[2], y, weight)
    c.setFillColor(MUTED); c.setFont('Helvetica', 7);       c.drawString(cols[3], y, usage)
    y -= 7*mm
    c.setStrokeColor(HexColor('#1A1A1A')); c.setLineWidth(0.3); c.line(20*mm, y + 1*mm, W - 20*mm, y + 1*mm)

footer('Typography', 4)
c.showPage()


# ── PAGE 7 — VOICE & TONE ─────────────────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — 05')
y = page_title('Brand Voice', '& Tone')
y -= 2*mm

box(20*mm, y - 27*mm, W - 40*mm, 25*mm, HexColor('#1A1A0A'))
c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 8);  c.drawString(25*mm, y - 5*mm,  'CORE TONE DEFINITION')
c.setFillColor(WHITE);  c.setFont('Helvetica-Bold', 13); c.drawString(25*mm, y - 14*mm, '"Confrontational truth — but empowering."')
c.setFillColor(GRAY);   c.setFont('Helvetica', 8);       c.drawString(25*mm, y - 21*mm, 'Like a tough-love mirror. We tell the hard truth so they can actually succeed.')
y -= 35*mm

y = amber_heading('THE 4 TONE PILLARS', y); y -= 2*mm
for num, (pillar, desc) in enumerate([
    ('DIRECT',      'No fluff. Every word earns its place. Short sentences. Hard truths first.'),
    ('EMPOWERING',  'We challenge the reader but believe in their potential. Pain is the setup for the solution.'),
    ('EXCLUSIVE',   'We communicate like we know something others don\'t — because we do.'),
    ('URGENT',      'The market moves. Time matters. Every post creates the feeling that missing = losing.'),
], 1):
    c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 9); c.drawString(22*mm, y, f'{num}.  {pillar}')
    y -= 6*mm
    y = wrap(desc, 28*mm, y, 155); y -= 6*mm

y -= 2*mm
y = amber_heading('DO vs. DO NOT', y); y -= 2*mm

lx, rx = 22*mm, W/2 + 4*mm
c.setFillColor(GREEN); c.setFont('Helvetica-Bold', 8); c.drawString(lx, y, 'DO — Write like this:')
c.setFillColor(RED);   c.setFont('Helvetica-Bold', 8); c.drawString(rx, y, "DON'T — Never like this:")
y -= 8*mm

pairs = [
    ('The volume knew. You didn\'t.',       'Our advanced algorithm detects institutional flow...'),
    ('Where is big money going right now?', 'We provide comprehensive market analysis tools...'),
    ('You were there. After the move. Again.','Check out our useful trading resources today!'),
    ('Stop guessing. Start tracking.',      'Our platform has many exciting features for you...'),
]
for do, dont in pairs:
    c.setFillColor(GREEN); c.setFont('Helvetica', 7); c.drawString(lx, y, f'+ {do}')
    c.setFillColor(RED);                               c.drawString(rx, y, f'- {dont}')
    y -= 8*mm

footer('Brand Voice & Tone', 5)
c.showPage()


# ── PAGE 8 — CONTENT STRATEGY ─────────────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — 06')
y = page_title('Content Strategy')
y -= 2*mm

y = amber_heading('INSTAGRAM CAROUSEL STRUCTURE  (3–5 slides per post)', y); y -= 2*mm
carousel = [
    ('Slide 1', 'HOOK',     'Pain point or missed moment. Must stop the scroll. No warm-up. Max impact, first line.'),
    ('Slide 2', 'PROBLEM',  'Deepen the pain. Why does this keep happening? Not their fault — they are missing one thing.'),
    ('Slide 3', 'REVEAL',   'The secret is volume. How smart money works. The mechanism they have been missing all along.'),
    ('Slide 4', 'SOLUTION', 'They do not need to be a full-time trader. They just need the right signal — volume.'),
    ('Slide 5', 'CTA',      'One question. One button. Direct to HIGHLIGHTS. No extra info, no friction, nothing else.'),
]
for slide, stype, desc in carousel:
    box(20*mm, y - 16*mm, W - 40*mm, 14*mm)
    c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 9); c.drawString(24*mm, y - 4*mm, slide)
    c.setFillColor(WHITE);  c.setFont('Helvetica-Bold', 9); c.drawString(38*mm, y - 4*mm, stype)
    c.setFillColor(GRAY);   c.setFont('Helvetica', 7);      c.drawString(24*mm, y - 11*mm, desc[:100])
    y -= 20*mm

y -= 4*mm
y = amber_heading('SLIDE VISUAL RULES', y); y -= 2*mm
for rule in [
    'Canvas: 1080 x 1080px — Instagram standard square format',
    'Background: Always #0A0A0A. Never white, light gray, or any light surface.',
    'Top bar: 10px amber (#F59E0B) across full width on every slide — brand mark',
    'Slide counter: "X / 5" in amber, top-right corner — always shows progression',
    'Font: Heebo 900 Black for all headlines, 700 Bold for body — direction RTL',
    'Swipe arrow: slides 1–4 have swipe prompt. Slide 5 (CTA) has none.',
    'CTA slide only: one question + amber HIGHLIGHTS pill. Nothing else on the slide.',
]:
    bullet(22*mm, y, rule, sym='·'); y -= 7.5*mm

footer('Content Strategy', 6)
c.showPage()


# ── PAGE 9 — LOGO & VISUAL IDENTITY ──────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — 07')
y = page_title('Logo &', 'Visual Identity')
y -= 2*mm

y = amber_heading('LOGO ANATOMY', y); y -= 2*mm
for part, col, desc in [
    ('Circle Ring',    '#F59E0B  Amber',
     'Radius 255px on 1080px canvas, stroke-width 18px. Represents the market cycle, completeness, and the scanning concept.'),
    ('Rising Chart Line', '#FFFFFF  White',
     'Smooth S-curve with gentle wave. Starts at 8:30 position on ring (lower-left), rises to upper-right. Represents upward trend and momentum.'),
    ('Endpoint Dot',   '#F59E0B  Amber',
     'Single filled circle at the tip of the chart line, radius 15px. Represents the signal — the exact moment of discovery.'),
    ('Background',     '#0A0A0A  Near-Black',
     'Pure dark canvas. No gradients, textures, or shadows. Flat and intentional.'),
]:
    c.setFillColor(WHITE); c.setFont('Helvetica-Bold', 9); c.drawString(22*mm, y, part)
    c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 8); c.drawString(22*mm, y - 5.5*mm, col)
    y -= 7*mm
    y = wrap(desc, 22*mm, y, 163); y -= 5*mm

y -= 2*mm
y = amber_heading('LOGO USAGE RULES', y); y -= 2*mm
for rule in [
    'Always on dark background (#0A0A0A). Never on white or any light surface.',
    'Logo stands alone — no text attached. The ring + line is the complete mark.',
    'Minimum digital size: 200px diameter. Never scale below legibility.',
    'Do not rotate, stretch, recolor, or apply effects to the logo.',
    'Maintain clear space: minimum 20% of logo diameter on all four sides.',
    'Output: PNG on black for posts. PNG transparent bg for overlays.',
]:
    bullet(22*mm, y, rule, sym='·'); y -= 7.5*mm

y -= 2*mm
y = amber_heading('TECHNICAL SPECS', y); y -= 2*mm
for line in [
    'File: CapitalFlow-logo.png  |  Canvas: 1080 x 1080px  |  Format: PNG',
    'SVG: viewBox 0 0 500 500  |  Ring: cx=250 cy=250 r=255 stroke=#F59E0B stroke-width=18',
    'Clip circle: r=246  |  Chart line: white stroke-width=10  |  Dot: r=15 fill=#F59E0B',
    'Tech: Node.js + Puppeteer SVG-to-PNG  |  Location: /VOLUME SCANNER/',
]:
    c.setFillColor(GRAY); c.setFont('Helvetica', 7.5); c.drawString(22*mm, y, line); y -= 6*mm

footer('Logo & Visual Identity', 7)
c.showPage()


# ── PAGE 10 — KEY MESSAGING ───────────────────────────────────────────────────
bg(); topbar()
section_tag('BRAND DNA — 08')
y = page_title('Key Messaging', '& Bio Copy')
y -= 4*mm

y = amber_heading('INSTAGRAM BIO', y); y -= 2*mm

box(20*mm, y - 44*mm, W - 40*mm, 42*mm)
c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 8);  c.drawString(25*mm, y - 5*mm, 'ENGLISH (Primary)')
c.setFillColor(WHITE);  c.setFont('Helvetica-Bold', 12); c.drawString(25*mm, y - 14*mm, 'Smart money leaves trails')
c.setFont('Helvetica-Bold', 12);                          c.drawString(25*mm, y - 23*mm, 'We follow them.')
c.setFillColor(AMBER);  c.setFont('Helvetica-Bold', 11); c.drawString(25*mm, y - 32*mm, '> Everything in HIGHLIGHTS')
c.setFillColor(MUTED);  c.setFont('Helvetica', 7)
c.drawString(25*mm, y - 39*mm, '~55 characters  |  Clean, mysterious, pulls directly to HIGHLIGHTS')
y -= 52*mm

y = amber_heading('CORE MESSAGES — USE ACROSS ALL CONTENT', y); y -= 2*mm
messages = [
    ('"The volume knew. You didn\'t."',              'Hook slides — creates instant recognition and scroll-stop.'),
    ('"Smart money leaves trails."',                 'Bio, captions, brand signature. Our core belief.'),
    ('"Before the breakout — we\'re already there."','Positioning and differentiator. Reveal slides.'),
    ('"Stop guessing. Start tracking."',             'CTA energy. Close of slides and captions.'),
    ('"Not luck. Not analysis. Volume."',            'The mechanism reveal. Short, punchy, undeniable.'),
    ('"You don\'t need to be on charts 24/7."',      'Objection removal — relatable. Slide 4 (Solution).'),
]
for msg, context in messages:
    c.setFillColor(WHITE); c.setFont('Helvetica-Bold', 9); c.drawString(22*mm, y, msg)
    c.setFillColor(MUTED); c.setFont('Helvetica', 7);      c.drawString(22*mm, y - 5.5*mm, context)
    y -= 14*mm

y -= 2*mm
y = amber_heading('CTA LANGUAGE', y); y -= 2*mm
for label, cta in [
    ('End of carousel:',  'Want to scan the market and know where money flows? Go to HIGHLIGHTS.'),
    ('Stories:',          'Swipe up to see where big money is going right now.'),
    ('Captions:',         'Everything you need is in our HIGHLIGHTS. Link in bio.'),
]:
    c.setFillColor(AMBER); c.setFont('Helvetica-Bold', 8); c.drawString(22*mm, y, label)
    c.setFillColor(GRAY);  c.setFont('Helvetica', 8);      c.drawString(22*mm, y - 6*mm, cta)
    y -= 15*mm

footer('Key Messaging & Bio Copy', 8)
c.showPage()


# ── SAVE ──────────────────────────────────────────────────────────────────────
c.save()
print(f'Done: {OUT}')

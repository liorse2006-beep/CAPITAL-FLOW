// Vanilla-DOM visual effects for the landing page, ported from the original
// static-HTML prototype (inline <script type="module"> for the WebGL
// scanner background + inline <script> for gsap entrance, FAQ, tilt,
// ElectricBorder, DepthText, EchoText). Kept as plain DOM code rather than
// rewritten as React components because it's all imperative rAF/canvas/GL
// work with no state React needs to know about — the only React-specific
// requirement is that everything started here must be torn down cleanly
// when the route unmounts (React Router keeps the SPA alive, unlike the
// original static page which only ever loaded once).
//
// initLandingEffects(rootEl) runs every effect scoped under rootEl and
// returns a cleanup() that cancels every rAF loop, removes every listener,
// disconnects every observer, and kills every ScrollTrigger it created.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Renderer, Program, Mesh, Triangle } from 'ogl';

gsap.registerPlugin(ScrollTrigger);

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
function directionToFloat(dir) {
  return dir === 'horizontal' ? 1.0 : dir === 'diagonal' ? 2.0 : 0.0;
}

const scannerVertex = '#version 300 es\nin vec2 position;\nvoid main() { gl_Position = vec4(position, 0.0, 1.0); }';

const scannerFragment = [
  '#version 300 es', 'precision highp float;',
  'uniform vec2 iResolution; uniform float iTime;',
  'uniform float uSpeed; uniform float uSweepSpeed; uniform float uSweepWidth; uniform float uSweepFalloff;',
  'uniform float uScale; uniform float uFrequency; uniform float uRipple; uniform float uBandDensity;',
  'uniform float uLineSharpness; uniform float uGlow; uniform float uColorSpread; uniform float uBrightness;',
  'uniform float uContrast; uniform float uSoftness; uniform float uVignette; uniform float uOpacity;',
  'uniform float uScanline; uniform float uGrain; uniform float uGrainIntensity; uniform float uDirection;',
  'uniform vec2 uMouse; uniform float uMouseEnabled; uniform float uMouseRadius; uniform float uMouseStrength; uniform float uMouseActive;',
  'uniform vec3 uColor1; uniform vec3 uColor2; uniform vec3 uColor3;',
  'out vec4 fragColor;',
  'const float TAU = 6.2831853;',
  'float signalField(vec2 p, float t) {',
  '  float w = sin(p.x * 1.3 + t * 0.7);',
  '  w += sin(p.y * 1.7 - t * 0.52) * 0.8;',
  '  w += sin((p.x + p.y) * 0.9 + t * 0.91) * 0.6;',
  '  w += sin((p.x - p.y) * 1.53 - t * 0.63) * 0.42;',
  '  return w * 0.35;',
  '}',
  'vec3 palette(float f) {',
  '  f = clamp(f, 0.0, 1.0);',
  '  f = pow(f, uContrast);',
  '  vec3 c = mix(uColor1, uColor2, smoothstep(0.08, 0.6, f));',
  '  return mix(c, uColor3, smoothstep(0.68, 1.0, f));',
  '}',
  'float scanBand(float x, float aa, float sharp) {',
  '  float v = mix(0.5, 0.5 + 0.5 * cos(x * TAU), aa);',
  '  return pow(v, sharp);',
  '}',
  'void main() {',
  '  float aspect = iResolution.x / iResolution.y;',
  '  vec2 uv0 = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;',
  '  vec2 p = uv0 / max(uScale, 0.001);',
  '  float t = iTime * uSpeed;',
  '  float mouseBoost = 0.0;',
  '  if (uMouseEnabled > 0.5) {',
  '    vec2 mUv = vec2((uMouse.x * 2.0 - 1.0) * aspect, uMouse.y * 2.0 - 1.0);',
  '    vec2 md = uv0 - mUv;',
  '    float r = max(uMouseRadius, 0.001);',
  '    mouseBoost = exp(-dot(md, md) / (r * r)) * uMouseStrength * uMouseActive;',
  '  }',
  '  float axis;',
  '  if (uDirection < 0.5) axis = p.y;',
  '  else if (uDirection < 1.5) axis = p.x;',
  '  else axis = (p.x + p.y) * 0.70710678;',
  '  float sig = signalField(p * uFrequency, t);',
  '  float coord = axis + sig * uRipple;',
  '  float phase = coord / max(uSweepWidth, 0.05) - t * uSweepSpeed;',
  '  float sweep = pow(0.5 + 0.5 * cos(phase * TAU), max(uSweepFalloff, 0.1));',
  '  float lc = coord * uBandDensity;',
  '  float aa = 1.0 / (1.0 + uSoftness * fwidth(lc) * 3.0);',
  '  aa = clamp(aa * (1.0 + mouseBoost * 0.6), 0.0, 1.0);',
  '  float bodyBase = clamp(0.5 + 0.5 * sig, 0.0, 1.0);',
  '  float body = bodyBase * bodyBase * uGlow * sweep;',
  '  float sharp = max(uLineSharpness, 0.1);',
  '  float split = uColorSpread * 0.16;',
  '  float fr = clamp(scanBand(lc + split, aa, sharp) * sweep + body, 0.0, 1.0);',
  '  float fg = clamp(scanBand(lc, aa, sharp) * sweep + body, 0.0, 1.0);',
  '  float fb = clamp(scanBand(lc - split, aa, sharp) * sweep + body, 0.0, 1.0);',
  '  vec3 col = vec3(palette(fr).r, palette(fg).g, palette(fb).b);',
  '  float inten = (fr + fg + fb) * 0.3333333 * uBrightness;',
  '  inten *= 1.0 + mouseBoost * 0.9;',
  '  if (uScanline > 0.5) { inten *= 1.0 - 0.18 * (0.5 + 0.5 * cos(gl_FragCoord.y * 1.7)); }',
  '  if (uGrain > 0.5) {',
  '    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453);',
  '    inten += (g - 0.5) * uGrainIntensity;',
  '  }',
  '  inten *= clamp(1.0 - uVignette * smoothstep(0.55, 1.65, length(uv0)), 0.0, 1.0);',
  '  inten = clamp(inten, 0.0, 1.0);',
  '  float a = clamp(inten * uOpacity, 0.0, 1.0);',
  '  fragColor = vec4(clamp(col, 0.0, 1.0) * a, a);',
  '}',
].join('\n');

function mountScanner(container, opts, cleanupFns) {
  const o = Object.assign(
    {
      color1: '#5227FF', color2: '#FF9FFC', color3: '#FFFFFF',
      speed: 0.5, sweepSpeed: 0.25, sweepWidth: 1.6, sweepFalloff: 6,
      scale: 1.5, frequency: 2, ripple: 0.22, bandDensity: 11, lineSharpness: 5.5,
      glow: 0.22, scanDirection: 'vertical', colorSpread: 0.7, brightness: 1.0,
      contrast: 1.15, softness: 1.4, vignette: 0.45, scanline: true, grain: true,
      grainIntensity: 0.05, opacity: 1.0, mouseInteraction: true, mouseRadius: 0.5, mouseStrength: 0.5,
    },
    opts || {}
  );

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new Renderer({ webgl: 2, alpha: true, premultipliedAlpha: true, antialias: false, dpr: Math.min(window.devicePixelRatio || 1, 2) });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);
  const canvas = gl.canvas;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const geometry = new Triangle(gl);
  const program = new Program(gl, {
    vertex: scannerVertex, fragment: scannerFragment,
    uniforms: {
      iTime: { value: 0 }, iResolution: { value: new Float32Array([1, 1]) },
      uSpeed: { value: o.speed }, uSweepSpeed: { value: o.sweepSpeed }, uSweepWidth: { value: o.sweepWidth },
      uSweepFalloff: { value: o.sweepFalloff }, uScale: { value: o.scale }, uFrequency: { value: o.frequency },
      uRipple: { value: o.ripple }, uBandDensity: { value: o.bandDensity }, uLineSharpness: { value: o.lineSharpness },
      uGlow: { value: o.glow }, uColorSpread: { value: o.colorSpread }, uBrightness: { value: o.brightness },
      uContrast: { value: o.contrast }, uSoftness: { value: o.softness }, uVignette: { value: o.vignette },
      uOpacity: { value: o.opacity }, uScanline: { value: o.scanline ? 1 : 0 },
      uGrain: { value: o.grain ? 1 : 0 }, uGrainIntensity: { value: o.grainIntensity },
      uDirection: { value: directionToFloat(o.scanDirection) },
      uMouse: { value: new Float32Array([0.5, 0.5]) }, uMouseEnabled: { value: o.mouseInteraction ? 1 : 0 },
      uMouseRadius: { value: o.mouseRadius }, uMouseStrength: { value: o.mouseStrength }, uMouseActive: { value: 0 },
      uColor1: { value: new Float32Array(hexToRgb(o.color1)) },
      uColor2: { value: new Float32Array(hexToRgb(o.color2)) },
      uColor3: { value: new Float32Array(hexToRgb(o.color3)) },
    },
  });
  const mesh = new Mesh(gl, { geometry, program });

  // setSize renders a frame itself (matching the React Bits reference
  // implementation) rather than only resizing — the loop below refuses to
  // start at all until the container is both intersecting the viewport AND
  // the document is visible, and this environment routinely loads pages
  // into a backgrounded/occluded tab. Without an unconditional render
  // here, that combination left the canvas fully blank (alpha:0 clear
  // color, never painted once) instead of showing at least a static first
  // frame until the animation loop gets to start.
  function setSize() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h);
    program.uniforms.iResolution.value[0] = gl.drawingBufferWidth;
    program.uniforms.iResolution.value[1] = gl.drawingBufferHeight;
    renderer.render({ scene: mesh });
  }
  const ro = new ResizeObserver(setSize);
  ro.observe(container);
  setSize();

  const mouseTarget = [0.5, 0.5];
  const mouseCurrent = [0.5, 0.5];
  let mouseActive = 0;
  let mouseActiveTarget = 0;

  function onMouseMove(e) {
    const r = container.getBoundingClientRect();
    mouseTarget[0] = (e.clientX - r.left) / r.width;
    mouseTarget[1] = 1.0 - (e.clientY - r.top) / r.height;
    mouseActiveTarget = 1;
  }
  function onMouseLeave() {
    mouseActiveTarget = 0;
  }
  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('mouseleave', onMouseLeave);

  const t0 = performance.now();
  let rafId = 0;
  function loop(t) {
    program.uniforms.iTime.value = (t - t0) * 0.001;
    mouseCurrent[0] += 0.05 * (mouseTarget[0] - mouseCurrent[0]);
    mouseCurrent[1] += 0.05 * (mouseTarget[1] - mouseCurrent[1]);
    program.uniforms.uMouse.value[0] = mouseCurrent[0];
    program.uniforms.uMouse.value[1] = mouseCurrent[1];
    mouseActive += 0.05 * (mouseActiveTarget - mouseActive);
    program.uniforms.uMouseActive.value = mouseActive;
    renderer.render({ scene: mesh });
    rafId = requestAnimationFrame(loop);
  }

  // Only actually animate while both intersecting the viewport and the
  // tab/window is visible — and, critically, resume automatically via
  // visibilitychange when it becomes visible again, instead of staying
  // parked forever the way a plain "if hidden, skip rAF" check would.
  let isIntersecting = true;
  let isPageVisible = !document.hidden;
  function tryStart() {
    if (reduceMotion) return;
    if (isIntersecting && isPageVisible && !rafId) rafId = requestAnimationFrame(loop);
  }
  function tryStop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }
  const io = new IntersectionObserver(([entry]) => {
    isIntersecting = entry.isIntersecting;
    isIntersecting ? tryStart() : tryStop();
  });
  io.observe(container);
  function onVisibilityChange() {
    isPageVisible = !document.hidden;
    isPageVisible ? tryStart() : tryStop();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  tryStart();

  cleanupFns.push(() => {
    tryStop();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    container.removeEventListener('mousemove', onMouseMove);
    container.removeEventListener('mouseleave', onMouseLeave);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  });
}

function setupProofTableSort(root, cleanupFns) {
  const body = root.querySelector('#cfProofBody');
  const header = root.querySelector('#cfProofHeader');
  if (!body || !header) return;
  const buttons = header.querySelectorAll('button[data-sort]');
  const handlers = [];
  buttons.forEach((btn) => {
    function onClick() {
      const key = btn.getAttribute('data-sort');
      const currentDir = btn.getAttribute('data-sort-dir');
      const nextDir = currentDir === 'desc' ? 'asc' : 'desc';
      buttons.forEach((b) => {
        b.removeAttribute('data-sort-dir');
        b.querySelector('.cf-sort-arrow').textContent = '';
      });
      btn.setAttribute('data-sort-dir', nextDir);
      btn.querySelector('.cf-sort-arrow').textContent = nextDir === 'desc' ? '▾' : '▴';

      const rows = Array.prototype.slice.call(body.querySelectorAll('.cf-proof-row'));
      rows.sort((a, b) => {
        const av = parseFloat(a.getAttribute('data-' + key));
        const bv = parseFloat(b.getAttribute('data-' + key));
        return nextDir === 'desc' ? bv - av : av - bv;
      });
      rows.forEach((r) => { r.style.opacity = '0'; });
      setTimeout(() => {
        rows.forEach((r) => body.appendChild(r));
        requestAnimationFrame(() => {
          rows.forEach((r) => { r.style.opacity = '1'; });
        });
      }, 160);
    }
    btn.addEventListener('click', onClick);
    handlers.push([btn, onClick]);
  });
  cleanupFns.push(() => handlers.forEach(([btn, fn]) => btn.removeEventListener('click', fn)));
}

function setupFaqAccordion(root, cleanupFns) {
  const handlers = [];
  root.querySelectorAll('.cf-faq-item').forEach((item) => {
    const btn = item.querySelector('.cf-faq-q');
    function onClick() {
      const isOpen = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    btn.addEventListener('click', onClick);
    handlers.push([btn, onClick]);
  });
  cleanupFns.push(() => handlers.forEach(([btn, fn]) => btn.removeEventListener('click', fn)));
}

function setupTiltCards(root, cleanupFns) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!window.matchMedia('(pointer: fine)').matches || reduceMotion) return;

  const ROTATE_AMPLITUDE = 12;
  const SCALE_ON_HOVER = 1.05;
  const SPRING = { stiffness: 100, damping: 30, mass: 2 };
  const cfXform = new WeakMap();

  function cfState(el) {
    let s = cfXform.get(el);
    if (!s) {
      s = { rx: 0, ry: 0, hoverScale: 1, stackY: 0, stackScale: 1, rotation: 0 };
      cfXform.set(el, s);
    }
    return s;
  }
  function cfApply(el) {
    const s = cfState(el);
    el.style.transform =
      'translate3d(0,' + s.stackY.toFixed(1) + 'px,0) rotate(' + s.rotation.toFixed(2) + 'deg) ' +
      'scale(' + (s.stackScale * s.hoverScale).toFixed(3) + ') ' +
      'perspective(1000px) rotateX(' + s.rx.toFixed(2) + 'deg) rotateY(' + s.ry.toFixed(2) + 'deg)';
  }
  function makeSpring(initial) {
    let pos = initial;
    let vel = 0;
    let target = initial;
    return {
      set(t) { target = t; },
      step(dt) {
        const accel = (-SPRING.stiffness * (pos - target) - SPRING.damping * vel) / SPRING.mass;
        vel += accel * dt;
        pos += vel * dt;
        return pos;
      },
      settled() { return Math.abs(pos - target) < 0.001 && Math.abs(vel) < 0.001; },
    };
  }

  const tiltCards = [];
  const listeners = [];
  root.querySelectorAll('.cf-tool, .cf-proof, .cf-faq-item, .cf-compare-row').forEach((card) => {
    const entry = { el: card, rx: makeSpring(0), ry: makeSpring(0), scale: makeSpring(1) };
    tiltCards.push(entry);
    function onMove(e) {
      const r = card.getBoundingClientRect();
      const offsetX = e.clientX - r.left - r.width / 2;
      const offsetY = e.clientY - r.top - r.height / 2;
      entry.rx.set((offsetY / (r.height / 2)) * -ROTATE_AMPLITUDE);
      entry.ry.set((offsetX / (r.width / 2)) * ROTATE_AMPLITUDE);
      wakeTilt();
    }
    function onEnter() { entry.scale.set(SCALE_ON_HOVER); wakeTilt(); }
    function onLeave() { entry.rx.set(0); entry.ry.set(0); entry.scale.set(1); wakeTilt(); }
    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseenter', onEnter);
    card.addEventListener('mouseleave', onLeave);
    listeners.push([card, 'mousemove', onMove], [card, 'mouseenter', onEnter], [card, 'mouseleave', onLeave]);
  });

  let tiltRaf = 0;
  let tiltLast = 0;
  let stopped = false;
  function wakeTilt() {
    if (tiltRaf || stopped) return;
    tiltLast = performance.now();
    tiltRaf = requestAnimationFrame(tiltLoop);
  }
  function tiltLoop(now) {
    if (stopped) return;
    const dt = Math.min((now - tiltLast) / 1000, 0.05);
    tiltLast = now;
    let stillMoving = false;
    tiltCards.forEach((c) => {
      const rx = c.rx.step(dt);
      const ry = c.ry.step(dt);
      const sc = c.scale.step(dt);
      if (!c.rx.settled() || !c.ry.settled() || !c.scale.settled()) stillMoving = true;
      const s = cfState(c.el);
      s.rx = rx; s.ry = ry; s.hoverScale = sc;
      cfApply(c.el);
    });
    tiltRaf = stillMoving ? requestAnimationFrame(tiltLoop) : 0;
  }

  cleanupFns.push(() => {
    stopped = true;
    if (tiltRaf) cancelAnimationFrame(tiltRaf);
    listeners.forEach(([el, type, fn]) => el.removeEventListener(type, fn));
  });
}

const GB_CURVES = {
  linear: (p) => p,
  bezier: (p) => p * p * (3 - 2 * p),
  'ease-in': (p) => p * p,
  'ease-out': (p) => 1 - Math.pow(1 - p, 2),
  'ease-in-out': (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
};
function gbDirection(pos) {
  return { top: 'to top', bottom: 'to bottom', left: 'to left', right: 'to right' }[pos] || 'to bottom';
}

function mountGradualBlur(parentEl, opts) {
  const o = Object.assign({ position: 'bottom', strength: 2, height: '6rem', divCount: 5, exponential: false, curve: 'linear', opacity: 1, zIndex: 2 }, opts || {});
  if (getComputedStyle(parentEl).position === 'static') parentEl.style.position = 'relative';

  const container = document.createElement('div');
  container.className = 'gradual-blur';
  const vertical = o.position === 'top' || o.position === 'bottom';
  container.style.position = 'absolute';
  container.style.zIndex = String(o.zIndex);
  if (vertical) {
    container.style.height = o.height; container.style.width = '100%';
    container.style.left = '0'; container.style.right = '0'; container.style[o.position] = '0';
  } else {
    container.style.width = o.height; container.style.height = '100%';
    container.style.top = '0'; container.style.bottom = '0'; container.style[o.position] = '0';
  }

  const inner = document.createElement('div');
  inner.className = 'gradual-blur-inner';
  const curveFn = GB_CURVES[o.curve] || GB_CURVES.linear;
  const increment = 100 / o.divCount;
  const direction = gbDirection(o.position);

  for (let i = 1; i <= o.divCount; i++) {
    const progress = curveFn(i / o.divCount);
    const blurValue = o.exponential ? Math.pow(2, progress * 4) * 0.0625 * o.strength : 0.0625 * (progress * o.divCount + 1) * o.strength;
    const p1 = Math.round((increment * i - increment) * 10) / 10;
    const p2 = Math.round(increment * i * 10) / 10;
    const p3 = Math.round((increment * i + increment) * 10) / 10;
    const p4 = Math.round((increment * i + increment * 2) * 10) / 10;
    let gradient = 'transparent ' + p1 + '%, black ' + p2 + '%';
    if (p3 <= 100) gradient += ', black ' + p3 + '%';
    if (p4 <= 100) gradient += ', transparent ' + p4 + '%';

    const div = document.createElement('div');
    div.style.position = 'absolute';
    div.style.inset = '0';
    div.style.maskImage = 'linear-gradient(' + direction + ', ' + gradient + ')';
    div.style.webkitMaskImage = div.style.maskImage;
    div.style.backdropFilter = 'blur(' + blurValue.toFixed(3) + 'rem)';
    div.style.webkitBackdropFilter = div.style.backdropFilter;
    div.style.opacity = String(o.opacity);
    inner.appendChild(div);
  }
  container.appendChild(inner);
  parentEl.appendChild(container);
  return container;
}

function setupGradualBlur(root, cleanupFns) {
  const mounted = [];
  root.querySelectorAll('.cf-stack-card:not(.cf-compact)').forEach((card) => {
    mounted.push(mountGradualBlur(card, { position: 'bottom', height: '6rem', strength: 2, divCount: 5, curve: 'bezier', exponential: true, opacity: 1 }));
  });
  cleanupFns.push(() => mounted.forEach((el) => el.parentNode && el.parentNode.removeChild(el)));
}

function ebRandom(x) { return (Math.sin(x * 12.9898) * 43758.5453) % 1; }
function ebNoise2D(x, y) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const a = ebRandom(i + j * 57);
  const b = ebRandom(i + 1 + j * 57);
  const c = ebRandom(i + (j + 1) * 57);
  const d = ebRandom(i + 1 + (j + 1) * 57);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}
function ebOctavedNoise(x, octaves, lacunarity, gain, baseAmplitude, baseFrequency, time, seed, baseFlatness) {
  let y = 0;
  let amplitude = baseAmplitude;
  let frequency = baseFrequency;
  for (let i = 0; i < octaves; i++) {
    let oa = amplitude;
    if (i === 0) oa *= baseFlatness;
    y += oa * ebNoise2D(frequency * x + seed * 100, time * frequency * 0.3);
    frequency *= lacunarity; amplitude *= gain;
  }
  return y;
}
function ebCornerPoint(cx, cy, r, startAngle, arcLength, progress) {
  const angle = startAngle + progress * arcLength;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}
function ebRoundedRectPoint(t, left, top, width, height, radius) {
  const straightWidth = width - 2 * radius;
  const straightHeight = height - 2 * radius;
  const cornerArc = (Math.PI * radius) / 2;
  const totalPerimeter = 2 * straightWidth + 2 * straightHeight + 4 * cornerArc;
  const distance = t * totalPerimeter;
  let accumulated = 0;
  let p;
  if (distance <= accumulated + straightWidth) { p = (distance - accumulated) / straightWidth; return { x: left + radius + p * straightWidth, y: top }; }
  accumulated += straightWidth;
  if (distance <= accumulated + cornerArc) { p = (distance - accumulated) / cornerArc; return ebCornerPoint(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2, p); }
  accumulated += cornerArc;
  if (distance <= accumulated + straightHeight) { p = (distance - accumulated) / straightHeight; return { x: left + width, y: top + radius + p * straightHeight }; }
  accumulated += straightHeight;
  if (distance <= accumulated + cornerArc) { p = (distance - accumulated) / cornerArc; return ebCornerPoint(left + width - radius, top + height - radius, radius, 0, Math.PI / 2, p); }
  accumulated += cornerArc;
  if (distance <= accumulated + straightWidth) { p = (distance - accumulated) / straightWidth; return { x: left + width - radius - p * straightWidth, y: top + height }; }
  accumulated += straightWidth;
  if (distance <= accumulated + cornerArc) { p = (distance - accumulated) / cornerArc; return ebCornerPoint(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI / 2, p); }
  accumulated += cornerArc;
  if (distance <= accumulated + straightHeight) { p = (distance - accumulated) / straightHeight; return { x: left, y: top + height - radius - p * straightHeight }; }
  accumulated += straightHeight;
  p = (distance - accumulated) / cornerArc;
  return ebCornerPoint(left + radius, top + radius, radius, Math.PI, Math.PI / 2, p);
}

function mountElectricBorder(el, opts, ebInstances) {
  const o = Object.assign({ color: '#ffd17d', speed: 1, chaos: 0.12, borderRadius: 24, thickness: 1 }, opts || {});
  el.classList.add('electric-border');
  el.style.setProperty('--electric-border-color', o.color);

  Array.prototype.forEach.call(el.children, (child) => {
    if (getComputedStyle(child).position === 'static') child.style.position = 'relative';
    if (!child.style.zIndex) child.style.zIndex = '1';
  });

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'eb-canvas-container';
  const canvas = document.createElement('canvas');
  canvas.className = 'eb-canvas';
  canvasContainer.appendChild(canvas);

  const layers = document.createElement('div');
  layers.className = 'eb-layers';
  const glow1 = document.createElement('div'); glow1.className = 'eb-glow-1';
  const glow2 = document.createElement('div'); glow2.className = 'eb-glow-2';
  const bgGlow = document.createElement('div'); bgGlow.className = 'eb-background-glow';
  layers.appendChild(glow1); layers.appendChild(glow2); layers.appendChild(bgGlow);

  el.appendChild(layers);
  el.appendChild(canvasContainer);

  const ctx = canvas.getContext('2d');
  const octaves = 10;
  const lacunarity = 1.6;
  const gain = 0.7;
  const amplitude = o.chaos;
  const frequency = 10;
  const baseFlatness = 0;
  const displacement = 60;
  const borderOffset = 60;
  let time = 0;
  let lastFrame = 0;
  let width = 0;
  let height = 0;

  function updateSize() {
    const rect = el.getBoundingClientRect();
    width = rect.width + borderOffset * 2;
    height = rect.height + borderOffset * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
  }
  updateSize();

  function draw(now) {
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    time += dt * o.speed;
    lastFrame = now;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.thickness;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const left = borderOffset;
    const top = borderOffset;
    const bw = width - 2 * borderOffset;
    const bh = height - 2 * borderOffset;
    const radiusFromCss = parseFloat(getComputedStyle(el).borderTopLeftRadius) || o.borderRadius;
    const maxRadius = Math.min(bw, bh) / 2;
    const radius = Math.min(radiusFromCss, maxRadius);
    const perimeter = 2 * (bw + bh) + 2 * Math.PI * radius;
    const sampleCount = Math.max(8, Math.floor(perimeter / 2));

    ctx.beginPath();
    for (let i = 0; i <= sampleCount; i++) {
      const progress = i / sampleCount;
      const pt = ebRoundedRectPoint(progress, left, top, bw, bh, radius);
      const xN = ebOctavedNoise(progress * 8, octaves, lacunarity, gain, amplitude, frequency, time, 0, baseFlatness);
      const yN = ebOctavedNoise(progress * 8, octaves, lacunarity, gain, amplitude, frequency, time, 1, baseFlatness);
      const dx = pt.x + xN * displacement;
      const dy = pt.y + yN * displacement;
      if (i === 0) ctx.moveTo(dx, dy); else ctx.lineTo(dx, dy);
    }
    ctx.closePath();
    ctx.stroke();
  }

  const ro = new ResizeObserver(updateSize);
  ro.observe(el);
  ebInstances.push(draw);
  return { layers, canvasContainer, ro };
}

// ── ScrollFloat (React Bits) — reveals text once, the first time it
// scrolls into view, via IntersectionObserver + a one-shot gsap tween
// (not a continuous scrub tied to scroll position — see the comment above
// the IntersectionObserver below for why).
// Split by WORD, not by individual character like the source component:
// this page is Hebrew (RTL), and character-level splitting broke it two
// different ways —
//   1. each character became its own inline-block "atom" for the
//      browser's bidi algorithm, which visually reordered them instead of
//      keeping the natural right-to-left reading order.
//   2. Hebrew has five letters that take a different final/"sofit" shape
//      at the end of a word (ך ם ן ף ץ) — that shape is chosen by the
//      font's text-shaping engine based on word position, which requires
//      the letters to still be part of one text run. Splitting into
//      single-letter spans handed the shaper isolated one-letter runs, so
//      final letters could render in the wrong form.
// Whole words are never split apart internally, so both problems disappear
// while the stagger reveal still reads essentially the same for headline-
// length text. ──
function mountScrollFloat(el, opts, cleanupFns) {
  const o = Object.assign({ duration: 1, ease: 'back.out(1.7)', stagger: 0.05 }, opts || {});
  const text = el.textContent;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  el.classList.add('scroll-float');
  el.textContent = '';
  const words = text.split(' ');
  const wordEls = [];
  words.forEach((word, i) => {
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = word;
    el.appendChild(span);
    wordEls.push(span);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
  });

  // Restores `el` to plain text on cleanup — see mountEchoText's identical
  // comment for why (React 18 StrictMode's dev-only double-effect-invoke
  // on the same DOM node).
  cleanupFns.push(() => {
    el.classList.remove('scroll-float');
    el.textContent = text;
  });

  if (reducedMotion) return;

  gsap.set(wordEls, { willChange: 'opacity, transform', opacity: 0, yPercent: 120, scaleY: 1.6, scaleX: 0.85, transformOrigin: '50% 100%' });

  // Plays once, triggered by IntersectionObserver rather than scrubbed to
  // scroll position via gsap's ScrollTrigger. A continuous scrub tween only
  // advances via gsap's rAF-driven ticker, which this codebase has
  // repeatedly found unreliable for revealing content (see
  // setupHeroEntrance / mountEchoText); an IntersectionObserver callback is
  // compositor-driven, same as the nav dock's, and doesn't depend on a
  // scroll-position recalculation firing every frame, so the reveal can't
  // get stuck at opacity:0 mid-scroll the way the scrub version did.
  let played = false;
  const io = new IntersectionObserver(
    (entries) => {
      if (played || !entries[0].isIntersecting) return;
      played = true;
      gsap.to(wordEls, { duration: o.duration, ease: o.ease, opacity: 1, yPercent: 0, scaleY: 1, scaleX: 1, stagger: o.stagger });
      io.disconnect();
    },
    { threshold: 0.2, rootMargin: '0px 0px -10% 0px' }
  );
  io.observe(el);
  cleanupFns.push(() => io.disconnect());
}

function setupScrollFloat(root, cleanupFns) {
  // Deliberately excludes .cf-tool h3: those titles mix in an English brand
  // name ("MA Scanner", "Capital Flow", "Hot Sectors") — an LTR run inside
  // this RTL page. Splitting it into per-word inline-block spans hits the
  // same bidi-reordering problem as the character-level attempt did, just
  // one level up: the browser's bidi algorithm reorders the two isolated
  // "atoms" according to the RTL container instead of preserving their
  // LTR order, so "MA Scanner" rendered as "Scanner MA". The section
  // headings below are pure Hebrew, where the reading-order direction and
  // the container direction agree, so word-splitting them is safe.
  root.querySelectorAll('.cf-how-title, #tools h2, #faq h2, .cf-final h2').forEach((el) => {
    mountScrollFloat(el, {}, cleanupFns);
  });
}

function setupElectricBorders(root, cleanupFns) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  const ebInstances = [];
  const mounted = [];
  root.querySelectorAll('.cf-tool, .cf-faq-item, .cf-compare-row, .cf-proof, .cf-stack-card').forEach((el) => {
    mounted.push(mountElectricBorder(el, { color: '#ffd17d', speed: 1.5, chaos: 0.01, thickness: 2, borderRadius: 16 }, ebInstances));
  });

  let rafId = 0;
  let stopped = false;
  function ebLoop(now) {
    if (stopped) return;
    ebInstances.forEach((draw) => draw(now));
    rafId = requestAnimationFrame(ebLoop);
  }
  rafId = requestAnimationFrame(ebLoop);

  cleanupFns.push(() => {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    mounted.forEach(({ layers, canvasContainer, ro }) => {
      ro.disconnect();
      if (layers.parentNode) layers.parentNode.removeChild(layers);
      if (canvasContainer.parentNode) canvasContainer.parentNode.removeChild(canvasContainer);
    });
  });
}

// implementation stepped every echo's position by wall-clock delta each
// frame and only stopped once its own "stillMoving" heuristic went false —
// which meant a single skipped/delayed frame (a backgrounded tab, a
// throttled window, a slow first paint) could leave it parked mid-entrance
// forever, since nothing forced it toward its resting state independent of
// the loop actually running. Real users hit exactly that: the trailing
// echoes stuck fully spread out, well past the entrance's own duration.
// CSS transitions don't have that failure mode — the browser guarantees a
// transition completes (resuming correctly even across a visibility
// change) without any hand-written frame budget to get wrong, so the
// entrance is expressed as one from/to state change instead of a per-frame
// simulation.
function mountEchoText(el, opts, cleanupFns) {
  const o = Object.assign({ echoes: 12, offset: 36, direction: 'right', fade: 0.72, blur: 3, tint: '#fcda7d', duration: 900, color: '#e2a545' }, opts || {});
  const text = el.textContent;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const echoCount = reducedMotion ? 0 : Math.min(Math.max(Math.round(o.echoes), 0), 24);

  el.classList.add('echo-text');
  el.style.color = o.color;
  el.textContent = '';

  // The front copy is appended (and measured) before any of the absolutely
  // positioned echoes exist, and the container's width is then pinned to
  // that measurement. Chromium's shrink-to-fit width algorithm for an
  // auto-sized inline-block, when it ALSO contains position:absolute
  // children with no explicit width, factors those children's own text
  // into the "preferred width" pass — with `echoes` extra copies of the
  // same string, that inflates the container to N times the real width
  // (visually: the glow smear no longer overlaps, it tiles sideways off
  // the edge of the viewport). Locking the width to the one real, in-flow
  // copy before adding the rest sidesteps the browser's sizing pass
  // entirely rather than depending on out-of-flow positioning to opt out
  // of it correctly.
  const front = document.createElement('span');
  front.className = 'echo-text__echo echo-text__echo--front';
  front.textContent = text;
  el.appendChild(front);
  el.style.width = front.getBoundingClientRect().width + 'px';

  // Restores `el` to exactly what it looked like before this function
  // touched it. React 18 StrictMode's dev-only double-effect-invoke runs
  // this on the same DOM node twice; without this, a second real mount
  // call would read
  // `el.textContent` after it already held this run's echoes concatenated
  // together).
  cleanupFns.push(() => {
    el.classList.remove('echo-text');
    el.style.color = '';
    el.style.width = '';
    el.textContent = text;
  });

  if (reducedMotion || echoCount === 0) return;

  const DIRS = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, diagonal: { x: 0.72, y: 0.72 } };
  const vector = DIRS[o.direction] || DIRS.right;

  const echoes = [];
  for (let i = echoCount; i >= 1; i--) {
    const echo = document.createElement('span');
    echo.className = 'echo-text__echo';
    echo.setAttribute('aria-hidden', 'true');
    echo.style.color = o.tint ? ('color-mix(in srgb, ' + o.tint + ' ' + Math.min(72, 18 + i * 5) + '%, ' + o.color + ')') : o.color;
    echo.textContent = text;
    const depth = i / echoCount;
    echo.style.filter = o.blur > 0 ? ('blur(' + (o.blur * depth).toFixed(2) + 'px)') : 'none';
    // Starting (spread) pose, painted before any transition is attached —
    // this is the very first frame the visitor sees, matching what the
    // old entrance looked like at t=0.
    const amt = o.offset * (i + 0.35);
    echo.style.transform = 'translate3d(' + (vector.x * amt).toFixed(2) + 'px,' + (vector.y * amt).toFixed(2) + 'px,0)';
    echo.style.opacity = '0';
    el.appendChild(echo);
    echoes.push(echo);
  }

  // Forces the spread starting pose above to commit to a real paint before
  // the transition (and its target values) are applied, the same way
  // setupHeroEntrance does — a double-rAF achieves the same ordering in a
  // normal foreground tab, but rAF never fires at all while the document
  // is hidden, which this environment routinely delivers pages in. Reading
  // offsetHeight forces that flush synchronously instead, so this can't
  // get stuck at its starting (fully spread, invisible) pose forever.
  void el.offsetHeight;
  {
    echoes.forEach((echo, idx) => {
      echo.style.transition = 'transform ' + o.duration + 'ms cubic-bezier(0.16,1,0.3,1), opacity ' + o.duration + 'ms ease-out';
      echo.style.transform = 'translate3d(0,0,0)';
      echo.style.opacity = String(Math.pow(o.fade, echoCount - idx));
    });
  }
  cleanupFns.push(() => cancelAnimationFrame(raf1));
}

// Rewritten off gsap for the entrance itself (kept only for the
// scroll-linked background dim, which is scoped to a decorative dim, never
// blocks real content). gsap.timeline()'s playback is driven by its own
// rAF ticker same as every other hand-rolled loop in this file — this
// environment routinely delivers a page that starts backgrounded, and a
// ticker that never gets its first tick leaves elements parked at whatever
// gsap.set() put them at, which was opacity:0, i.e. an invisible hero.
// CSS transitions don't have that failure mode: the compositor owns them,
// they always reach their end state (resuming correctly across a
// visibility change) without a JS ticker needing to run at all.
function setupHeroEntrance(root, cleanupFns) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bgEl = root.querySelector('.cf-bg');
  if (!bgEl) return;

  if (!reduceMotion) {
    const bgTween = gsap.to(bgEl, {
      opacity: 0.3, ease: 'none',
      scrollTrigger: { trigger: root.querySelector('.cf-hero'), start: 'top top', end: 'bottom top', scrub: true },
    });
    cleanupFns.push(() => {
      bgTween.scrollTrigger && bgTween.scrollTrigger.kill();
      bgTween.kill();
    });
  }

  if (reduceMotion) return;

  const targets = [
    { el: root.querySelector('.cf-hero-eyebrow'), delay: 100, y: 22 },
    { el: root.querySelector('.cf-hero h1'), delay: 220, y: 22 },
    { el: root.querySelector('.cf-proof-wrap'), delay: 350, y: 34, x: 18 },
    { el: root.querySelector('.cf-cta-row'), delay: 500, y: 22 },
  ].filter((t) => t.el);

  targets.forEach((t) => {
    t.el.style.opacity = '0';
    t.el.style.transform = 'translate3d(' + (t.x || 0) + 'px,' + t.y + 'px,0)';
  });

  // requestAnimationFrame never fires at all while the document is hidden
  // (this is exactly the state a freshly opened tab is routinely in here),
  // so the double-rAF trigger this used originally — reliable in a normal
  // foreground tab — left the hero permanently at its opacity:0 starting
  // state just like the gsap version it replaced. Forcing a synchronous
  // layout read between setting the start state and the end state achieves
  // the same "commit the first frame, then animate" effect without waiting
  // on any callback: reading offsetHeight flushes pending style changes to
  // the render tree immediately, so the transition still has something to
  // transition *from* once these elements are actually painted, whenever
  // that ends up being.
  void root.offsetHeight;
  targets.forEach((t) => {
    t.el.style.transition = 'opacity 0.7s ' + t.delay + 'ms cubic-bezier(0.16,1,0.3,1), transform 0.7s ' + t.delay + 'ms cubic-bezier(0.16,1,0.3,1)';
    t.el.style.opacity = '1';
    t.el.style.transform = 'translate3d(0,0,0)';
  });
}

// CTAs are plain .cf-btn buttons in the static markup (no href to a real
// checkout — the original page never had auth). One delegated listener
// routes every click to the caller's onGetStarted, matching the historical
// LandingPage.jsx pattern of opening the sign-in modal for any CTA.
// There is no top nav any more — the page has only this floating bottom
// dock, hidden until the visitor scrolls at all, then shown for the rest
// of the page (hidden again if they scroll back up to the very top).
// Tracked via IntersectionObserver on a 1px sentinel pinned to the top of
// .cf-root, not a scroll-position/rAF calculation — its callback is driven
// by the browser's own layout/compositor, not a JS ticker, so (unlike
// several other effects in this file) it can't get stuck mid-transition if
// the tab starts backgrounded.
function setupDock(root, cleanupFns) {
  const dock = root.querySelector('#cfDock');
  const sentinel = root.querySelector('#cfTopSentinel');
  if (!dock || !sentinel) return;
  const io = new IntersectionObserver(([entry]) => {
    dock.classList.toggle('cf-dock-visible', !entry.isIntersecting);
  });
  io.observe(sentinel);
  cleanupFns.push(() => io.disconnect());
}

function setupScrollCta(root, cleanupFns) {
  const btn = root.querySelector('#cfScrollCta');
  const target = root.querySelector('#how-tools');
  if (!btn || !target) return;
  function onClick() {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  btn.addEventListener('click', onClick);
  cleanupFns.push(() => btn.removeEventListener('click', onClick));
}

function setupCtaDelegation(root, onGetStarted, cleanupFns) {
  function onClick(e) {
    const btn = e.target.closest('.cf-btn');
    if (btn && root.contains(btn)) {
      e.preventDefault();
      onGetStarted();
    }
  }
  root.addEventListener('click', onClick);
  cleanupFns.push(() => root.removeEventListener('click', onClick));
}

// The original static page relied on `html { scroll-behavior: smooth;
// scroll-padding-top: 78px }` for its nav's #anchor links. Scoping the
// landing CSS under .cf-landing-page (so it can't leak into the rest of the
// SPA) moved that rule off the real <html> element, so it's restored here
// as a temporary global while this route is mounted, and reverted on
// unmount rather than left as a permanent app-wide behavior change.
function setupSmoothAnchorScroll(cleanupFns) {
  const html = document.documentElement;
  const prevBehavior = html.style.scrollBehavior;
  const prevPadding = html.style.scrollPaddingTop;
  html.style.scrollBehavior = 'smooth';
  html.style.scrollPaddingTop = '78px';
  cleanupFns.push(() => {
    html.style.scrollBehavior = prevBehavior;
    html.style.scrollPaddingTop = prevPadding;
  });
}

// Each effect is a nice-to-have on top of the page's real content (markup +
// CTA + FAQ), never a requirement for it. A rare-browser gap (no
// ResizeObserver, no WebGL2) or a one-off DOM edge case in any single decorative
// effect must not take down the other effects or, via the app's top-level
// ErrorBoundary, the entire marketing page and its "Start free" CTAs.
function runSafely(name, fn) {
  try {
    fn();
  } catch (err) {
    if (typeof console !== 'undefined') console.error('[landing] ' + name + ' failed to mount:', err);
  }
}

export function initLandingEffects(rootEl, onGetStarted) {
  // React 18 StrictMode (dev only) runs an effect, its cleanup, then the
  // effect again — on the SAME dangerouslySetInnerHTML DOM node, not a
  // fresh one. An earlier version of this file worked around that with a
  // one-time marker that made the second StrictMode pass a no-op — but
  // that also skipped the FIRST pass's cleanup from ever being followed by
  // a real remount, so anything whose cleanup actually tears down real DOM
  // (mountScanner's WebGL canvas, in particular) stayed torn down forever:
  // cleanup1 removes the canvas, the marker blocks effect2 from ever
  // recreating it. The real fix is for every mount function's cleanup to
  // fully restore what it changed (see mountEchoText's own comment —
  // it restores el.textContent, which is what the
  // el.textContent-compounding bug actually needed), so the ordinary
  // effect → cleanup → effect cycle is safe to just let run twice, the
  // same as any other React effect.
  const cleanupFns = [];

  // These two are the page's actual function (navigation + FAQ + the CTA
  // that gets someone to sign in) — allowed to throw so a real bug here is
  // loud, not silently swallowed like the decorative effects below.
  setupCtaDelegation(rootEl, onGetStarted, cleanupFns);
  runSafely('setupScrollCta', () => setupScrollCta(rootEl, cleanupFns));
  runSafely('setupDock', () => setupDock(rootEl, cleanupFns));
  setupFaqAccordion(rootEl, cleanupFns);

  runSafely('setupSmoothAnchorScroll', () => setupSmoothAnchorScroll(cleanupFns));
  runSafely('setupProofTableSort', () => setupProofTableSort(rootEl, cleanupFns));
  runSafely('setupHeroEntrance', () => setupHeroEntrance(rootEl, cleanupFns));
  runSafely('setupTiltCards', () => setupTiltCards(rootEl, cleanupFns));
  runSafely('setupGradualBlur', () => setupGradualBlur(rootEl, cleanupFns));
  runSafely('setupElectricBorders', () => setupElectricBorders(rootEl, cleanupFns));
  runSafely('setupScrollFloat', () => setupScrollFloat(rootEl, cleanupFns));

  runSafely('mountEchoText', () => {
    const heroEcho = rootEl.querySelector('#cfHeroEcho');
    if (heroEcho) {
      mountEchoText(heroEcho, { echoes: 12, offset: 20, direction: 'right', fade: 0.72, blur: 3, tint: '#fcda7d', duration: 900, color: '#e2a545' }, cleanupFns);
    }
  });

  runSafely('mountScanner', () => {
    const bgEl = rootEl.querySelector('.cf-bg');
    if (bgEl) {
      mountScanner(bgEl, {
        color1: '#ff9400', color2: '#ffe29f', color3: '#ffffff',
        speed: 0.5, sweepSpeed: 0.25, sweepWidth: 1.6, sweepFalloff: 6,
        scale: 1.5, frequency: 2, ripple: 0.22, bandDensity: 11, lineSharpness: 5.5,
        glow: 0.22, scanDirection: 'vertical', colorSpread: 0.7, brightness: 1.0,
        contrast: 1.15, softness: 1.4, vignette: 0.45, scanline: true, grain: true,
        grainIntensity: 0.05, opacity: 1.0, mouseInteraction: true, mouseRadius: 0.5, mouseStrength: 0.5,
      }, cleanupFns);
    }
  });

  return function cleanup() {
    cleanupFns.forEach((fn) => {
      try { fn(); } catch (e) { /* best-effort teardown */ }
    });
  };
}

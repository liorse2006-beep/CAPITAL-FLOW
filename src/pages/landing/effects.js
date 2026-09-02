// Vanilla-DOM visual effects for the landing page, ported from the original
// static-HTML prototype (inline <script type="module"> for the WebGL
// inline <script> for gsap entrance, FAQ, tilt, ElectricBorder, DepthText,
// EchoText). Kept as plain DOM code rather than
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
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Renderer, Program, Mesh, Triangle } from 'ogl';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import LandingCtaPortals from '../../components/LandingCtaPortals';
import { TRUST_LOGO_SYMBOLS } from './trustLogos';

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
  '#version 300 es',
  'precision highp float;',
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

function _mountScanner(container, opts, cleanupFns) {
  const o = Object.assign(
    {
      color1: '#5227FF',
      color2: '#FF9FFC',
      color3: '#FFFFFF',
      speed: 0.5,
      sweepSpeed: 0.25,
      sweepWidth: 1.6,
      sweepFalloff: 6,
      scale: 1.5,
      frequency: 2,
      ripple: 0.22,
      bandDensity: 11,
      lineSharpness: 5.5,
      glow: 0.22,
      scanDirection: 'vertical',
      colorSpread: 0.7,
      brightness: 1.0,
      contrast: 1.15,
      softness: 1.4,
      vignette: 0.45,
      scanline: true,
      grain: true,
      grainIntensity: 0.05,
      opacity: 1.0,
      mouseInteraction: true,
      mouseRadius: 0.5,
      mouseStrength: 0.5,
    },
    opts || {}
  );

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new Renderer({
    webgl: 2,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);
  const canvas = gl.canvas;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const geometry = new Triangle(gl);
  const program = new Program(gl, {
    vertex: scannerVertex,
    fragment: scannerFragment,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: new Float32Array([1, 1]) },
      uSpeed: { value: o.speed },
      uSweepSpeed: { value: o.sweepSpeed },
      uSweepWidth: { value: o.sweepWidth },
      uSweepFalloff: { value: o.sweepFalloff },
      uScale: { value: o.scale },
      uFrequency: { value: o.frequency },
      uRipple: { value: o.ripple },
      uBandDensity: { value: o.bandDensity },
      uLineSharpness: { value: o.lineSharpness },
      uGlow: { value: o.glow },
      uColorSpread: { value: o.colorSpread },
      uBrightness: { value: o.brightness },
      uContrast: { value: o.contrast },
      uSoftness: { value: o.softness },
      uVignette: { value: o.vignette },
      uOpacity: { value: o.opacity },
      uScanline: { value: o.scanline ? 1 : 0 },
      uGrain: { value: o.grain ? 1 : 0 },
      uGrainIntensity: { value: o.grainIntensity },
      uDirection: { value: directionToFloat(o.scanDirection) },
      uMouse: { value: new Float32Array([0.5, 0.5]) },
      uMouseEnabled: { value: o.mouseInteraction ? 1 : 0 },
      uMouseRadius: { value: o.mouseRadius },
      uMouseStrength: { value: o.mouseStrength },
      uMouseActive: { value: 0 },
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

// ── Cinematic camera journey ────────────────────────────────────────────
// A short glass-candlestick "track" the camera moves along as the visitor
// scrolls through hero → why → proof, arriving at a laptop+phone mockup of
// the product itself for the final stretch into "tools" — a literal
// "works everywhere" reveal instead of an abstract shape. The camera's
// *position* is never computed by a hand-rolled scroll-listener + rAF loop
// — GSAP's own ScrollTrigger `scrub` owns the progress value (see the
// lag/jump-bug history on setupCategoryTransitions for why); this function
// only ever *reads* that progress inside a rAF loop.
//
// Two earlier versions of this scene got real, specific feedback. v1
// (dozens of random boxes + flat panels) read as an unstyled Three.js
// tutorial — object count doesn't read as effort, restraint does. v2 (a
// single molten-gold orb) went nearly pure black over half its surface,
// because Three.js's physically-correct lighting needs intensities scaled
// for real inverse-square falloff, and a highly metallic PBR material has
// almost no visible response without a real environment to reflect. Both
// lessons are applied here: few, deliberately placed objects; a synthetic
// RoomEnvironment (via PMREMGenerator) so the glass candlesticks have
// something believable to refract; and light intensities sized for this
// scene's actual distances, not carried over from the orb version.

function buildCandlestick(height, seed) {
  const group = new THREE.Group();
  const bodyGeo = new RoundedBoxGeometry(1.15, height, 1.15, 3, 0.14);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xf0c986,
    transmission: 0.88,
    thickness: 1.4,
    roughness: 0.1,
    ior: 1.45,
    metalness: 0,
    emissive: 0x3a2408,
    emissiveIntensity: 0.3,
    clearcoat: 0.4,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // The glowing rim in the reference image isn't the glass material
  // itself — it's a separate bright outline traced along the body's
  // edges, layered on top. Built from a plain BoxGeometry, not
  // bodyGeo's own rounded/beveled geometry: EdgesGeometry on a rounded
  // box's many small bevel facets treated each tiny facet boundary as
  // its own "hard edge" (they're all just under the 1° default
  // threshold apart), so the rim came out as a broken, dashed-looking
  // scatter of short segments instead of one clean line — confirmed by
  // actually rendering and viewing a captured frame, not assumed. A
  // sharp-edged box has exactly 12 real edges and no such fragmentation;
  // being marginally less rounded than the glass body underneath it
  // isn't visible at this scale.
  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.15, height, 1.15)),
    new THREE.LineBasicMaterial({ color: 0xffe1a3, transparent: true, opacity: 0.85 })
  );
  group.add(rim);

  const wickHeight = height * 1.55;
  const wickGeo = new THREE.CylinderGeometry(0.055, 0.055, wickHeight, 8);
  const wickMat = new THREE.MeshPhysicalMaterial({ color: 0xd8d0c0, transmission: 0.55, roughness: 0.25, metalness: 0.05 });
  group.add(new THREE.Mesh(wickGeo, wickMat));

  group.userData.seed = seed;
  return group;
}

function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

function buildJourneyScene(renderer, isMobile) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0d0906, 0.035);

  const disposables = [];
  function track(objOrArray) {
    (Array.isArray(objOrArray) ? objOrArray : [objOrArray]).forEach((o) => disposables.push(o));
    return objOrArray;
  }

  // A synthetic "room" the transmissive candlestick glass can reflect —
  // without this, `transmission` materials render nearly flat/invisible
  // (there's nothing for them to refract). Generated once; the resulting
  // texture is static, not re-rendered per frame.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  pmrem.dispose();
  track({ dispose: () => envTexture.dispose() });

  scene.add(new THREE.HemisphereLight(0xffdfa0, 0x140d05, 2.2));
  scene.add(new THREE.AmbientLight(0x3a2c17, 1.3));
  // Dedicated key light for the opening beat — it's the first thing a
  // visitor sees, on-screen for the least scroll distance, and needs to
  // read clearly immediately; the general track lighting below left it
  // too dim in the actual captured frame.
  const introLight = new THREE.PointLight(0xfff2d0, 420, 30, 2);
  introLight.position.set(2, 3, 12);
  scene.add(introLight);
  const keyLight = new THREE.PointLight(0xf0c46a, 260, 45, 2);
  keyLight.position.set(5, 6, 4);
  scene.add(keyLight);
  const trackLight = new THREE.PointLight(0xffe6b0, 240, 65, 2);
  trackLight.position.set(-4, 5, -24);
  scene.add(trackLight);
  const trackLight2 = new THREE.PointLight(0xffe6b0, 220, 65, 2);
  trackLight2.position.set(6, 6, -42);
  scene.add(trackLight2);

  // The glowing floor grid beneath the whole track, softened by the same
  // fog as everything else so it fades rather than hard-cuts at a distance.
  const grid = track(new THREE.GridHelper(120, isMobile ? 24 : 48, 0xe2a545, 0x3a2c17));
  grid.position.set(0, -2.4, -18);
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  scene.add(grid);

  // Nine candlesticks along the track, heights loosely trending upward —
  // reads as "the trend is up" without spelling it out, closing on the
  // tallest candle as the final beat. Evenly spaced (-8 per candle in Z) to
  // match the camera's three-segment zigzag in mountCinematicJourney,
  // which crosses to a different side every 3 candles — spacing them any
  // other way would throw that off.
  const heights = [2.6, 3.4, 2.2, 4.6, 3.8, 5.6, 4.4, 5.2, 6.4];
  const candles = new THREE.Group();
  heights.forEach((h, i) => {
    const c = buildCandlestick(h, i);
    c.position.set(Math.sin(i * 1.7) * 1.2, -2.4 + h / 2, -6 - i * 8);
    candles.add(c);
  });
  scene.add(candles);

  return { scene, disposables, candles };
}

function _mountCinematicJourney(root, container, cleanupFns) {
  const zoneStart = root.querySelector('#top');
  const zoneEnd = root.querySelector('#why-tools');
  if (!zoneStart || !zoneEnd) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.matchMedia('(max-width: 800px)').matches;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !isMobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  container.appendChild(canvas);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  const { scene, disposables, candles } = buildJourneyScene(renderer, isMobile);

  // Depth of field is real postprocessing (BokehPass), not a CSS blur
  // trick — it's central to the reference look this scene is matching
  // (one sharp focal object, everything else soft). Desktop only: it's a
  // second full-screen render pass, real GPU cost not worth spending on
  // typically weaker mobile GPUs, and reduced-motion visitors get a
  // static frame anyway, where it wouldn't be noticed regardless.
  let composer = null;
  let bokehPass = null;
  if (!isMobile && !reduceMotion) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bokehPass = new BokehPass(scene, camera, { focus: 10, aperture: 0.00045, maxblur: 0.008 });
      composer.addPass(bokehPass);
    } catch (e) {
      composer = null;
      bokehPass = null;
    }
  }

  function setSize() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, h);
    (composer || renderer).render(scene, camera);
  }
  const ro = new ResizeObserver(setSize);
  ro.observe(container);

  // Camera path: Z and Y are each one smooth continuous curve across the
  // whole 0–1 progress range — no seams there. The lateral offset (X) is
  // deliberately restrained: three short, overlapping camera drifts rather
  // than a visible zig-zag. Each segment uses a full smoothstep, so the
  // camera naturally eases into the end of one drift, pauses for a beat, and
  // eases into the next direction. The visitor should feel a change in
  // perspective, not notice a camera command being executed.
  //
  // The look-at target's X stays FIXED throughout — it does NOT track the
  // zigzag. An earlier version mirrored it in step with the lateral move,
  // which read as the camera spinning/reversing direction rather than a
  // gentle continuation, reported directly by the person testing it (not
  // something a numeric continuity check alone would have caught, since
  // that earlier version WAS seamless mathematically, just not
  // seamless-*looking*). Keeping it fixed avoids that regardless of how
  // many times X changes direction.
  const zStart = 11;
  const zEnd = -70; // Z of the 9th candle (i=8)
  const xTargets = [0, 4.8, 1.8, 4.2]; // restrained start + one target per 3-candle segment
  let progress = 0;
  let focusPoint = new THREE.Vector3(-1, 0.5, zStart);
  const lookAtTarget = new THREE.Vector3(0, 0, 0);
  function applyProgress(p) {
    progress = Math.min(1, Math.max(0, p));
    const z = zStart - progress * (zStart - zEnd);
    const offsetY = 1.2 + progress * 4.8;

    const segF = progress * 3;
    const segIndex = Math.min(2, Math.floor(segF));
    const segmentT = Math.min(1, Math.max(0, segF - segIndex));
    const easedT = segmentT * segmentT * (3 - 2 * segmentT);
    const offsetX = xTargets[segIndex] + (xTargets[segIndex + 1] - xTargets[segIndex]) * easedT;

    camera.position.set(offsetX, offsetY, z);
    lookAtTarget.set(-1, 0.5, z - 9);
    focusPoint.set(-1, 0.5, z);
    camera.lookAt(lookAtTarget);
  }
  applyProgress(0);
  setSize();

  let trigger = null;
  if (!reduceMotion) {
    trigger = ScrollTrigger.create({
      trigger: zoneStart,
      endTrigger: zoneEnd,
      // "top top" would only start once #top's top edge is scrolled all
      // the way to the viewport's top edge — but #top naturally sits ~72px
      // down the page (nav spacing), so at rest (scrollY 0, page just
      // loaded) that condition isn't met yet and the whole layer stayed
      // hidden until the visitor scrolled ~72px first. "top bottom" starts
      // as soon as #top's top has entered from the viewport's *bottom*
      // edge — for a hero sitting near the very start of the document,
      // that point is at or before scrollY 0, so the trigger (and the
      // camera journey) is already active on load, exactly like the rest
      // of the hero content.
      start: 'top bottom',
      end: 'bottom bottom',
      scrub: 0.8,
      onUpdate: (self) => applyProgress(self.progress),
      onToggle: (self) => container.classList.toggle('cf-journey-visible', self.isActive),
    });
  } else {
    // Static: camera parked at the hero waypoint, journey layer always
    // visible behind that section only (no scroll-linked motion at all).
    container.classList.add('cf-journey-visible');
  }

  const t0 = performance.now();
  let rafId = 0;
  function loop(t) {
    const elapsed = (t - t0) * 0.001;
    candles.children.forEach((c, i) => {
      c.rotation.y = Math.sin(elapsed * 0.15 + i) * 0.04;
    });

    // Focus tracks whatever the scene is actually showing — not a fixed
    // "look ahead" point, which is what put the nearest candle outside the
    // sharp zone in an early captured frame even though the camera was
    // right next to it.
    if (bokehPass) {
      bokehPass.uniforms.focus.value = camera.position.distanceTo(focusPoint);
    }
    (composer || renderer).render(scene, camera);
    rafId = requestAnimationFrame(loop);
  }

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
    trigger && trigger.kill();
    container.classList.remove('cf-journey-visible');
    disposeObject3D(candles);
    disposables.forEach((d) => {
      if (d && typeof d.dispose === 'function') d.dispose();
    });
    if (composer) composer.dispose();
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  });
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
      'translate3d(0,' +
      s.stackY.toFixed(1) +
      'px,0) rotate(' +
      s.rotation.toFixed(2) +
      'deg) ' +
      'scale(' +
      (s.stackScale * s.hoverScale).toFixed(3) +
      ') ' +
      'perspective(1000px) rotateX(' +
      s.rx.toFixed(2) +
      'deg) rotateY(' +
      s.ry.toFixed(2) +
      'deg)';
  }
  function makeSpring(initial) {
    let pos = initial;
    let vel = 0;
    let target = initial;
    return {
      set(t) {
        target = t;
      },
      step(dt) {
        const accel = (-SPRING.stiffness * (pos - target) - SPRING.damping * vel) / SPRING.mass;
        vel += accel * dt;
        pos += vel * dt;
        return pos;
      },
      settled() {
        return Math.abs(pos - target) < 0.001 && Math.abs(vel) < 0.001;
      },
    };
  }

  const tiltCards = [];
  const listeners = [];
  root.querySelectorAll('.cf-feat, .cf-hero-devices, .cf-faq-item').forEach((card) => {
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
    function onEnter() {
      entry.scale.set(SCALE_ON_HOVER);
      wakeTilt();
    }
    function onLeave() {
      entry.rx.set(0);
      entry.ry.set(0);
      entry.scale.set(1);
      wakeTilt();
    }
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
      s.rx = rx;
      s.ry = ry;
      s.hoverScale = sc;
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
  const o = Object.assign(
    {
      position: 'bottom',
      strength: 2,
      height: '6rem',
      divCount: 5,
      exponential: false,
      curve: 'linear',
      opacity: 1,
      zIndex: 2,
    },
    opts || {}
  );
  if (getComputedStyle(parentEl).position === 'static') parentEl.style.position = 'relative';

  const container = document.createElement('div');
  container.className = 'gradual-blur';
  const vertical = o.position === 'top' || o.position === 'bottom';
  container.style.position = 'absolute';
  container.style.zIndex = String(o.zIndex);
  if (vertical) {
    container.style.height = o.height;
    container.style.width = '100%';
    container.style.left = '0';
    container.style.right = '0';
    container.style[o.position] = '0';
  } else {
    container.style.width = o.height;
    container.style.height = '100%';
    container.style.top = '0';
    container.style.bottom = '0';
    container.style[o.position] = '0';
  }

  const inner = document.createElement('div');
  inner.className = 'gradual-blur-inner';
  const curveFn = GB_CURVES[o.curve] || GB_CURVES.linear;
  const increment = 100 / o.divCount;
  const direction = gbDirection(o.position);

  for (let i = 1; i <= o.divCount; i++) {
    const progress = curveFn(i / o.divCount);
    const blurValue = o.exponential
      ? Math.pow(2, progress * 4) * 0.0625 * o.strength
      : 0.0625 * (progress * o.divCount + 1) * o.strength;
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
    mounted.push(
      mountGradualBlur(card, {
        position: 'bottom',
        height: '6rem',
        strength: 2,
        divCount: 5,
        curve: 'bezier',
        exponential: true,
        opacity: 1,
      })
    );
  });
  cleanupFns.push(() => mounted.forEach((el) => el.parentNode && el.parentNode.removeChild(el)));
}

function ebRandom(x) {
  return (Math.sin(x * 12.9898) * 43758.5453) % 1;
}
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
    frequency *= lacunarity;
    amplitude *= gain;
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
  if (distance <= accumulated + straightWidth) {
    p = (distance - accumulated) / straightWidth;
    return { x: left + radius + p * straightWidth, y: top };
  }
  accumulated += straightWidth;
  if (distance <= accumulated + cornerArc) {
    p = (distance - accumulated) / cornerArc;
    return ebCornerPoint(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2, p);
  }
  accumulated += cornerArc;
  if (distance <= accumulated + straightHeight) {
    p = (distance - accumulated) / straightHeight;
    return { x: left + width, y: top + radius + p * straightHeight };
  }
  accumulated += straightHeight;
  if (distance <= accumulated + cornerArc) {
    p = (distance - accumulated) / cornerArc;
    return ebCornerPoint(left + width - radius, top + height - radius, radius, 0, Math.PI / 2, p);
  }
  accumulated += cornerArc;
  if (distance <= accumulated + straightWidth) {
    p = (distance - accumulated) / straightWidth;
    return { x: left + width - radius - p * straightWidth, y: top + height };
  }
  accumulated += straightWidth;
  if (distance <= accumulated + cornerArc) {
    p = (distance - accumulated) / cornerArc;
    return ebCornerPoint(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI / 2, p);
  }
  accumulated += cornerArc;
  if (distance <= accumulated + straightHeight) {
    p = (distance - accumulated) / straightHeight;
    return { x: left, y: top + height - radius - p * straightHeight };
  }
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
  const glow1 = document.createElement('div');
  glow1.className = 'eb-glow-1';
  const glow2 = document.createElement('div');
  glow2.className = 'eb-glow-2';
  const bgGlow = document.createElement('div');
  bgGlow.className = 'eb-background-glow';
  layers.appendChild(glow1);
  layers.appendChild(glow2);
  layers.appendChild(bgGlow);

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
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
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
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

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
      if (i === 0) ctx.moveTo(dx, dy);
      else ctx.lineTo(dx, dy);
    }
    ctx.closePath();
    ctx.stroke();
  }

  const ro = new ResizeObserver(updateSize);
  ro.observe(el);
  ebInstances.push(draw);
  return { layers, canvasContainer, ro };
}

// ── ScrollFloat (React Bits) — reveals a heading once, the first time it
// scrolls into view. The reveal is observer-driven rather than scrubbed
// against every scroll event, so the browser keeps native scrolling smooth.
// Keep the element's text nodes intact: splitting Hebrew headings into
// animated inline atoms can change bidi spacing and glyph shaping. The
// heading-level reveal is cleaner, more reliable, and still gives the copy a
// noticeable entrance. ──
function mountScrollFloat(el, cleanupFns) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  el.classList.add('scroll-float');
  el.style.setProperty('--cf-scroll-float-duration', '520ms');
  cleanupFns.push(() => {
    el.classList.remove('scroll-float');
    el.classList.remove('is-scroll-float-visible');
    el.style.removeProperty('--cf-scroll-float-duration');
  });

  const reveal = () => {
    el.classList.add('is-scroll-float-visible');
  };

  if (reducedMotion || typeof IntersectionObserver !== 'function') {
    reveal();
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      reveal();
      observer.unobserve(el);
    },
    { rootMargin: '0px 0px -18% 0px', threshold: 0.12 }
  );
  observer.observe(el);
  cleanupFns.push(() => observer.disconnect());
}

function setupScrollFloat(root, cleanupFns) {
  root.querySelectorAll('#why h2, #proof h2, #why-tools h2, #faq h2, #start h2, #plans h2').forEach((el) => {
    mountScrollFloat(el, cleanupFns);
  });
}

// Scroll reveals for the copy and feature rows that support the section
// headlines. These are intentionally one-shot observer reveals: the visitor
// gets a clear sense of sequence while reading, but the page never replays a
// heavy animation every time the scroll position changes direction.
function setupScrollReveals(root, cleanupFns) {
  const groups = [
    { selector: '#why .cf-vs-card', variant: 'card', stagger: 72 },
    { selector: '#proof .cf-signal-intro > p', variant: 'text', stagger: 0 },
    { selector: '#proof .cf-signal-step', variant: 'step', stagger: 76 },
    { selector: '#proof .cf-signal-visual', variant: 'visual', stagger: 0 },
    { selector: '#why-tools .cf-feat', variant: 'feature', stagger: 58 },
    { selector: '#faq .cf-faq-item', variant: 'card', stagger: 64 },
    { selector: '#start .cf-final-card > .cf-specular-cta-mount', variant: 'visual', stagger: 0 },
    { selector: '#plans .cf-pricing-matrix-mount', variant: 'visual', stagger: 0 },
  ];
  const targets = [];
  const seen = new Set();

  groups.forEach(({ selector, variant, stagger }) => {
    root.querySelectorAll(selector).forEach((el, index) => {
      if (seen.has(el)) return;
      seen.add(el);
      el.classList.add('cf-scroll-reveal-ready', 'cf-scroll-reveal--' + variant);
      el.style.setProperty('--cf-scroll-reveal-delay', `${index * stagger}ms`);
      // Alternate the lateral drift on repeated content so a column does not
      // feel like a stack of identical cards entering from one rail.
      if (variant === 'card' || variant === 'feature' || variant === 'step') {
        el.style.setProperty('--cf-scroll-reveal-x', index % 2 === 0 ? '10px' : '-10px');
      }
      targets.push(el);
    });
  });

  if (!targets.length) return;

  const clearTargets = () => {
    targets.forEach((el) => {
      el.classList.remove('cf-scroll-reveal-ready', 'cf-scroll-revealed');
      el.style.removeProperty('--cf-scroll-reveal-delay');
      el.style.removeProperty('--cf-scroll-reveal-x');
    });
  };

  const revealAll = () => targets.forEach((el) => el.classList.add('cf-scroll-revealed'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || typeof IntersectionObserver !== 'function') {
    revealAll();
    cleanupFns.push(clearTargets);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('cf-scroll-revealed');
        observer.unobserve(entry.target);
      });
    },
    // A slightly delayed trigger gives the eye a moment to register the
    // section before the content begins its entrance.
    { rootMargin: '0px 0px -18% 0px', threshold: 0.12 }
  );
  targets.forEach((el) => observer.observe(el));

  cleanupFns.push(() => {
    observer.disconnect();
    clearTargets();
  });
}

// Category transitions reveal complete landing sections as one unit. Nothing
// inside a section is promoted to its own scroll step: a category arrives with
// one restrained depth reveal, then stays completely still while the visitor
// reads it. The scroll listener below is passive and only runs one short
// rAF after a scroll event; it never cancels or replaces the browser's native
// scrolling.
function setupCategoryTransitions(root, cleanupFns) {
  const sections = Array.from(root.querySelectorAll('.cf-category-section'));
  if (!sections.length) return;

  root.classList.add('has-category-transitions');
  root.classList.remove('has-category-scroll-stack');

  const layers = sections.map((section) => {
    const atmosphere = document.createElement('span');
    atmosphere.className = 'cf-category-atmosphere';
    atmosphere.setAttribute('aria-hidden', 'true');
    section.prepend(atmosphere);
    return { atmosphere };
  });

  sections.forEach((section) => section.classList.remove('is-category-active'));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || typeof IntersectionObserver !== 'function') {
    sections.forEach((section) => section.classList.add('is-category-active'));
    cleanupFns.push(() => {
      layers.forEach(({ atmosphere }) => {
        atmosphere.remove();
      });
    });
    return;
  }

  let stopped = false;
  let revealFrame = 0;
  const revealSection = (section) => {
    if (!stopped) section.classList.add('is-category-active');
  };

  const revealVisibleSections = () => {
    revealFrame = 0;
    if (stopped) return;

    // Let the category settle into the viewport before starting its entrance
    // treatment, so the motion is noticed as part of the experience instead
    // of firing while the section is still barely visible at the bottom.
    const viewportTop = window.innerHeight * 0.12;
    const viewportBottom = window.innerHeight * 0.64;
    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      if (rect.bottom >= viewportTop && rect.top <= viewportBottom) revealSection(section);
    });
  };
  const scheduleReveal = () => {
    if (!revealFrame) revealFrame = requestAnimationFrame(revealVisibleSections);
  };
  window.addEventListener('scroll', scheduleReveal, { passive: true });
  window.addEventListener('resize', scheduleReveal, { passive: true });
  revealVisibleSections();

  cleanupFns.push(() => {
    stopped = true;
    window.removeEventListener('scroll', scheduleReveal);
    window.removeEventListener('resize', scheduleReveal);
    if (revealFrame) cancelAnimationFrame(revealFrame);
    layers.forEach(({ atmosphere }) => {
      atmosphere.remove();
    });
  });
}

function _setupElectricBorders(root, cleanupFns) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  const ebInstances = [];
  const mounted = [];
  root.querySelectorAll('.cf-faq-item').forEach((el) => {
    mounted.push(
      mountElectricBorder(
        el,
        { color: '#ffd17d', speed: 1.5, chaos: 0.01, thickness: 2, borderRadius: 16 },
        ebInstances
      )
    );
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
  const o = Object.assign(
    { echoes: 12, offset: 36, direction: 'right', blur: 3, tint: '#fcda7d', duration: 900, color: '#e2a545' },
    opts || {}
  );
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

  const DIRS = {
    right: { x: 1, y: 0 },
    left: { x: -1, y: 0 },
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    diagonal: { x: 0.72, y: 0.72 },
  };
  const vector = DIRS[o.direction] || DIRS.right;

  const echoes = [];
  for (let i = echoCount; i >= 1; i--) {
    const echo = document.createElement('span');
    echo.className = 'echo-text__echo';
    echo.setAttribute('aria-hidden', 'true');
    echo.style.color = o.tint
      ? 'color-mix(in srgb, ' + o.tint + ' ' + Math.min(72, 18 + i * 5) + '%, ' + o.color + ')'
      : o.color;
    echo.textContent = text;
    const depth = i / echoCount;
    echo.style.filter = o.blur > 0 ? 'blur(' + (o.blur * depth).toFixed(2) + 'px)' : 'none';
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
    echoes.forEach((echo) => {
      echo.style.transition =
        'transform ' + o.duration + 'ms cubic-bezier(0.16,1,0.3,1), opacity ' + o.duration + 'ms ease-out';
      echo.style.transform = 'translate3d(0,0,0)';
      // Fades all the way to 0, not just decayed toward it (the old target
      // was Math.pow(o.fade, echoCount - idx), which never actually reaches
      // 0) — every echo converges on the exact same position as the front
      // copy, so leaving them at any nonzero opacity meant the headline
      // stayed permanently smeared/blurred behind a stack of tinted
      // duplicates instead of settling to clean text once the entrance
      // finishes.
      echo.style.opacity = '0';
    });
  }
}

// The entrance uses compositor-owned CSS transitions rather than a JS ticker.
// That keeps the hero reliable in backgrounded tabs and avoids coupling the
// fixed animated background to scroll position.
function setupHeroEntrance(root) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    t.el.style.transition =
      'opacity 0.7s ' +
      t.delay +
      'ms cubic-bezier(0.16,1,0.3,1), transform 0.7s ' +
      t.delay +
      'ms cubic-bezier(0.16,1,0.3,1)';
    t.el.style.opacity = '1';
    t.el.style.transform = 'translate3d(0,0,0)';
  });
}

// Paints the landing-page proof chart as a lightweight, deterministic canvas
// visualization. It mirrors the product story in the static labels: price
// action turns up, the moving averages cross, and volume expands at the same
// signal point. Canvas keeps the chart crisp at every responsive width without
// introducing another charting dependency into the landing page.
function mountSignalChart(root, cleanupFns) {
  const chart = root.querySelector('.cf-signal-chart');
  const canvas = chart?.querySelector('.cf-signal-canvas');
  if (!chart || !canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const closes = Array.from({ length: 72 }, (_, index) => {
    const phase = index < 34 ? index / 34 : (index - 34) / 38;
    const base = index < 34 ? 1 - phase * 0.34 : 0.66 + phase * 0.68;
    const wave = Math.sin(index * 1.55) * 0.018 + Math.sin(index * 0.47) * 0.014;
    return base + wave;
  });
  // Keep the highlighted signal aligned with the volume callout. The spike
  // below is intentionally deterministic so the bar the callout points to is
  // always the tallest one, at every canvas size.
  const signalIndex = 40;
  let resizeObserver;

  const movingAverage = (windowSize) =>
    closes.map((_, index) => {
      const start = Math.max(0, index - windowSize + 1);
      const slice = closes.slice(start, index + 1);
      return slice.reduce((sum, value) => sum + value, 0) / slice.length;
    });

  const shortAverage = movingAverage(7);
  const longAverage = movingAverage(19);

  function draw() {
    const rect = chart.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const left = 20;
    const right = width - 46;
    const top = 22;
    const plotBottom = Math.floor(height * 0.67);
    const volumeTop = Math.floor(height * 0.74);
    const volumeBottom = height - 34;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, plotBottom - top);
    const minValue = Math.min(...closes) - 0.08;
    const maxValue = Math.max(...closes) + 0.08;
    const xAt = (index) => left + (index / (closes.length - 1)) * plotWidth;
    const yAt = (value) => plotBottom - ((value - minValue) / (maxValue - minValue)) * plotHeight;

    ctx.fillStyle = '#090705';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(226, 165, 69, 0.10)';
    ctx.lineWidth = 1;
    for (let row = 0; row <= 4; row += 1) {
      const y = top + (plotHeight / 4) * row;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    for (let column = 0; column <= 7; column += 1) {
      const x = left + (plotWidth / 7) * column;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, volumeBottom);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(226, 165, 69, 0.24)';
    ctx.beginPath();
    ctx.moveTo(left, volumeTop - 12);
    ctx.lineTo(right, volumeTop - 12);
    ctx.stroke();

    const drawLine = (values, color, lineWidth) => {
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = xAt(index);
        const y = yAt(value);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    };

    drawLine(longAverage, 'rgba(181, 165, 137, 0.78)', 1.35);
    drawLine(shortAverage, '#e2a545', 1.7);

    const candleWidth = Math.max(2.2, (plotWidth / closes.length) * 0.56);
    closes.forEach((close, index) => {
      const previous = index === 0 ? close : closes[index - 1];
      const open = previous + Math.sin(index * 2.1) * 0.012;
      const high = Math.max(open, close) + 0.025 + Math.abs(Math.sin(index * 1.7)) * 0.012;
      const low = Math.min(open, close) - 0.025 - Math.abs(Math.cos(index * 1.35)) * 0.012;
      const x = xAt(index);
      const bodyTop = yAt(Math.max(open, close));
      const bodyBottom = yAt(Math.min(open, close));
      ctx.strokeStyle = close >= open ? 'rgba(76, 191, 138, 0.62)' : 'rgba(194, 108, 76, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yAt(high));
      ctx.lineTo(x, yAt(low));
      ctx.stroke();
      ctx.fillStyle = close >= open ? 'rgba(76, 191, 138, 0.60)' : 'rgba(194, 108, 76, 0.48)';
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, Math.max(1.5, bodyBottom - bodyTop));
    });

    closes.forEach((_, index) => {
      const distance = Math.abs(index - signalIndex);
      const baseline = 0.16 + Math.abs(Math.sin(index * 0.83)) * 0.2;
      const volume =
        distance === 0
          ? 1.08
          : Math.min(0.78, baseline + (distance === 1 ? 0.35 : distance === 2 ? 0.18 : 0));
      const barWidth = Math.max(2, (plotWidth / closes.length) * 0.64);
      const x = xAt(index);
      const y = volumeBottom - volume * (volumeBottom - volumeTop);
      ctx.fillStyle =
        distance === 0
          ? 'rgba(226, 165, 69, 0.98)'
          : distance <= 2
            ? 'rgba(226, 165, 69, 0.78)'
            : 'rgba(107, 83, 43, 0.56)';
      ctx.fillRect(x - barWidth / 2, y, barWidth, volumeBottom - y);
    });

    const signalX = xAt(signalIndex);
    const signalY = yAt(closes[signalIndex]);
    const gradient = ctx.createLinearGradient(signalX - 34, 0, signalX + 34, 0);
    gradient.addColorStop(0, 'rgba(226, 165, 69, 0)');
    gradient.addColorStop(0.5, 'rgba(226, 165, 69, 0.17)');
    gradient.addColorStop(1, 'rgba(226, 165, 69, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(signalX - 34, top, 68, volumeBottom - top);
    ctx.strokeStyle = 'rgba(226, 165, 69, 0.70)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(signalX, top);
    ctx.lineTo(signalX, volumeBottom);
    ctx.stroke();

    ctx.fillStyle = '#e2a545';
    ctx.beginPath();
    ctx.arc(signalX, signalY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 165, 69, 0.24)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(signalX, signalY, 9, 0, Math.PI * 2);
    ctx.stroke();

    const calloutLines = [
      [width * 0.30, height * 0.40],
      [width * 0.52, height * 0.44],
      [width * 0.55, height * 0.79],
    ];
    calloutLines.forEach(([targetX, targetY]) => {
      ctx.strokeStyle = 'rgba(226, 165, 69, 0.42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(signalX, signalY);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();
    });

    const arrowTargetX = xAt(63);
    const arrowTargetY = Math.max(top + 24, yAt(closes[63]) - 12);
    ctx.strokeStyle = 'rgba(226, 165, 69, 0.92)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(signalX + 8, signalY - 4);
    ctx.lineTo(arrowTargetX, arrowTargetY);
    ctx.stroke();
    const arrowAngle = Math.atan2(arrowTargetY - signalY + 4, arrowTargetX - signalX - 8);
    const arrowSize = 10;
    ctx.fillStyle = 'rgba(226, 165, 69, 0.92)';
    ctx.beginPath();
    ctx.moveTo(arrowTargetX, arrowTargetY);
    ctx.lineTo(
      arrowTargetX - arrowSize * Math.cos(arrowAngle - Math.PI / 6),
      arrowTargetY - arrowSize * Math.sin(arrowAngle - Math.PI / 6)
    );
    ctx.lineTo(
      arrowTargetX - arrowSize * Math.cos(arrowAngle + Math.PI / 6),
      arrowTargetY - arrowSize * Math.sin(arrowAngle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();

    const fontFamily = getComputedStyle(chart).fontFamily || 'sans-serif';
    ctx.fillStyle = 'rgba(181, 165, 137, 0.68)';
    ctx.font = '10px ' + fontFamily;
    ctx.textAlign = 'center';
    ['09:30', '11:00', '12:30', '14:00', '16:00'].forEach((label, index, labels) => {
      const x = left + (plotWidth / (labels.length - 1)) * index;
      ctx.fillText(label, x, height - 12);
    });
    ctx.textAlign = 'left';
    ['1,240', '1,180', '1,120', '1,060', '1,000'].forEach((label, index, labels) => {
      const y = top + (plotHeight / (labels.length - 1)) * index + 3;
      ctx.fillText(label, right + 8, y);
    });
    ['20M', '10M', '0'].forEach((label, index, labels) => {
      const y = volumeTop + ((volumeBottom - volumeTop) / (labels.length - 1)) * index + 3;
      ctx.fillText(label, right + 8, y);
    });
  }

  resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(chart);
  draw();
  cleanupFns.push(() => resizeObserver?.disconnect());
}

// CTAs are buttons marked with data-cta-location in the static markup (no href to a real
// checkout — the original page never had auth). The visual button itself is
// mounted with the React Bits SpecularButton, while one delegated listener
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
// Builds the trust strip's moving marquee: two identical copies of the
// logo set placed side by side, translated -50% on a CSS loop (see
// .cf-marq's @keyframes in landing.scoped.css) — the standard seamless-
// marquee trick already used for the top ticker banner earlier in this
// project, and for the same reason: a plain CSS animation starts the
// instant the stylesheet parses (no JS-timing gap before content shows
// up) and runs on the compositor, so it can't stutter from main-thread
// contention with the WebGL scanner background or ElectricBorder's rAF
// loops. Built via JS rather than hand-duplicated in the static markup
// purely to avoid maintaining two copies of the same logo list by hand.
function setupSpecularCtas(root, onGetStarted, cleanupFns) {
  const targets = Array.from(root.querySelectorAll('.cf-specular-cta-mount'));
  const pricingTarget = root.querySelector('.cf-pricing-matrix-mount');
  if (!targets.length && !pricingTarget) return;

  const fallbacks = targets
    .map((target) => target.querySelector('.cf-specular-cta-fallback'))
    .filter(Boolean)
    .map((element) => ({ element, hidden: element.hidden }));

  // Hide the static copy before React commits the portal so there can never be
  // two visible CTAs during the hand-off. It is restored only if mounting the
  // real component fails.
  fallbacks.forEach(({ element }) => {
    element.hidden = true;
  });

  const host = document.createElement('div');
  host.className = 'cf-specular-cta-react-host';
  host.setAttribute('aria-hidden', 'true');
  host.style.display = 'none';
  root.appendChild(host);

  let reactRoot;
  try {
    reactRoot = createRoot(host);
    reactRoot.render(createElement(LandingCtaPortals, { targets, pricingTarget, onGetStarted }));
  } catch (error) {
    host.remove();
    fallbacks.forEach(({ element, hidden }) => {
      element.hidden = hidden;
    });
    if (typeof console !== 'undefined') console.error('[landing] specular CTAs failed to mount:', error);
    return;
  }

  cleanupFns.push(() => {
    reactRoot.unmount();
    fallbacks.forEach(({ element, hidden }) => {
      element.hidden = hidden;
    });
    host.remove();
  });
}

function mountTrustMarquee(el, assets, cleanupFns) {
  const pendingLogos = [];

  function buildSegment() {
    const seg = document.createElement('div');
    seg.className = 'cf-marq-seg';
    // With 300 unique logos, one copy per segment is already much wider than
    // any realistic viewport. Smaller future sets still get extra copies so
    // the track never runs out of content mid-loop.
    const segmentCopies = assets.length >= 100 ? 1 : 6;
    for (let rep = 0; rep < segmentCopies; rep++) {
      assets.forEach((asset) => {
        const item = document.createElement('span');
        item.className = 'cf-marq-item cf-marq-logo-item';

        const frame = document.createElement('span');
        frame.className = 'cf-marq-logo-frame';

        const logo = document.createElement('img');
        logo.className = 'cf-marq-logo';
        logo.dataset.src = 'https://assets.parqet.com/logos/symbol/' + asset.symbol + '?format=svg&size=32';
        logo.alt = '';
        logo.decoding = 'async';
        // The marquee has two copies of the maintained logo set. Lazy loading
        // keeps the browser from firing hundreds of cross-origin requests at
        // once, which can trigger CDN throttling on slower devices.
        logo.loading = 'lazy';

        const fallback = document.createElement('span');
        fallback.className = 'cf-marq-logo-fallback';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.innerHTML = '<i></i><i></i><i></i>';
        logo.hidden = true;

        logo.addEventListener(
          'load',
          () => {
            frame.classList.add('has-logo');
            logo.hidden = false;
            fallback.hidden = true;
          },
          { once: true }
        );
        logo.addEventListener(
          'error',
          () => {
            frame.classList.add('has-logo');
            logo.hidden = true;
            fallback.hidden = false;
          },
          { once: true }
        );

        pendingLogos.push(logo);
        frame.append(logo, fallback);
        item.appendChild(frame);
        seg.appendChild(item);
      });
    }
    return seg;
  }
  el.appendChild(buildSegment());
  el.appendChild(buildSegment());

  const loadLogo = (logo) => {
    if (!logo.dataset.src || logo.getAttribute('src')) return;
    logo.src = logo.dataset.src;
    delete logo.dataset.src;
  };

  let logoObserver = null;
  let fallbackTimer = 0;
  if (typeof IntersectionObserver === 'function') {
    logoObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          loadLogo(entry.target);
          logoObserver.unobserve(entry.target);
        });
      },
      { root: null, rootMargin: '120px 260px', threshold: 0.01 }
    );
    pendingLogos.forEach((logo) => logoObserver.observe(logo));
  } else {
    // Older browsers still avoid a request burst by loading a small batch at
    // a time instead of assigning all 600 cross-origin URLs immediately.
    let cursor = 0;
    const loadBatch = () => {
      pendingLogos.slice(cursor, cursor + 12).forEach(loadLogo);
      cursor += 12;
      if (cursor < pendingLogos.length) fallbackTimer = window.setTimeout(loadBatch, 500);
    };
    loadBatch();
  }

  el.style.setProperty('--cf-marq-duration', Math.max(26, assets.length * 0.48) + 's');
  cleanupFns.push(() => {
    logoObserver?.disconnect();
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    el.textContent = '';
    el.style.removeProperty('--cf-marq-duration');
  });
}

function setupScrollCta(root, cleanupFns) {
  const btn = root.querySelector('#cfScrollCta');
  const target = root.querySelector('#why');
  if (!btn || !target) return;
  function onClick() {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  btn.addEventListener('click', onClick);
  cleanupFns.push(() => btn.removeEventListener('click', onClick));
}

function setupCtaDelegation(root, onGetStarted, cleanupFns) {
  function onClick(e) {
    const btn = e.target.closest('[data-cta-location]');
    if (btn && root.contains(btn)) {
      e.preventDefault();
      if (btn.getAttribute('data-cta-location') === 'pre-pricing') {
        const plans = root.querySelector('#plans');
        if (plans) {
          const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          plans.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
          window.history.replaceState(null, '', '#plans');
        }
        return;
      }
      onGetStarted();
    }
  }
  root.addEventListener('click', onClick);
  cleanupFns.push(() => root.removeEventListener('click', onClick));
}

// Keep the document's native scrolling path untouched. Anchor buttons that
// explicitly request smooth behavior still animate themselves, while wheel,
// touch, and keyboard scrolling stay immediate and compositor-friendly.
function setupSmoothAnchorScroll(root, cleanupFns) {
  const html = document.documentElement;
  const prevPadding = html.style.scrollPaddingTop;
  html.style.scrollPaddingTop = '78px';

  const links = Array.from(root.querySelectorAll('.cf-nav-links a[href^="#"], .cf-nav-logo[href^="#"]'));
  const handlers = links.map((link) => {
    const onClick = (event) => {
      const href = link.getAttribute('href');
      const target = href ? document.getElementById(href.slice(1)) : null;
      if (!target) return;

      event.preventDefault();
      const nav = root.querySelector('.cf-nav-in');
      const navHeight = nav ? nav.getBoundingClientRect().height : 52;
      const targetTop = target.getBoundingClientRect().top + window.scrollY - navHeight - 26;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: reducedMotion ? 'auto' : 'smooth',
      });

      // Update the bookmark without firing a router navigation or replacing
      // the landing DOM while the smooth scroll is in progress.
      window.history.replaceState(null, '', href);
    };

    link.addEventListener('click', onClick);
    return { link, onClick };
  });

  cleanupFns.push(() => {
    handlers.forEach(({ link, onClick }) => link.removeEventListener('click', onClick));
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
  setupSpecularCtas(rootEl, onGetStarted, cleanupFns);
  setupCtaDelegation(rootEl, onGetStarted, cleanupFns);
  runSafely('setupScrollCta', () => setupScrollCta(rootEl, cleanupFns));
  setupFaqAccordion(rootEl, cleanupFns);

  runSafely('mountTrustMarquee', () => {
    const marqEl = rootEl.querySelector('#cfMarq');
    if (marqEl) {
      mountTrustMarquee(
        marqEl,
        TRUST_LOGO_SYMBOLS.map((symbol) => ({ symbol })),
        cleanupFns
      );
    }
  });

  runSafely('setupSmoothAnchorScroll', () => setupSmoothAnchorScroll(rootEl, cleanupFns));
  runSafely('setupHeroEntrance', () => setupHeroEntrance(rootEl));
  runSafely('mountSignalChart', () => mountSignalChart(rootEl, cleanupFns));
  runSafely('setupTiltCards', () => setupTiltCards(rootEl, cleanupFns));
  runSafely('setupGradualBlur', () => setupGradualBlur(rootEl, cleanupFns));
  runSafely('setupScrollFloat', () => setupScrollFloat(rootEl, cleanupFns));
  runSafely('setupScrollReveals', () => setupScrollReveals(rootEl, cleanupFns));
  runSafely('setupCategoryTransitions', () => setupCategoryTransitions(rootEl, cleanupFns));

  runSafely('mountEchoText', () => {
    const heroEcho = rootEl.querySelector('#cfHeroEcho');
    if (heroEcho) {
      mountEchoText(
        heroEcho,
        { echoes: 12, offset: 20, direction: 'right', blur: 3, tint: '#fcda7d', duration: 900, color: '#e2a545' },
        cleanupFns
      );
    }
  });

  return function cleanup() {
    cleanupFns.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        /* best-effort teardown */
      }
    });
  };
}

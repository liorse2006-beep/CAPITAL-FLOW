import { useEffect, useRef } from 'react';
import { Mesh, Program, Renderer, Triangle } from 'ogl';
import { hasWebGL2 } from '../utils/webgl';
import './Topography.css';

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255];
};

const colorModeToFloat = (mode) => {
  if (mode === 'uniform') return 1.0;
  if (mode === 'alternating') return 2.0;
  return 0.0;
};

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uMorphAmount;
uniform float uBands;
uniform float uThickness;
uniform float uScale;
uniform float uPixelSize;
uniform float uGlow;
uniform float uColorMode;
uniform float uContrast;
uniform float uBrightness;
uniform float uFillBands;
uniform float uOpacity;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec2 uMouse;
uniform float uMouseEnabled;
uniform float uMouseRadius;
uniform float uMouseStrength;
uniform float uMouseActive;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec4 uCtrlA;
uniform vec4 uCtrlB;
uniform vec4 uCtrlC;
uniform vec4 uCtrlD;
out vec4 fragColor;

float bez(float t, vec4 c) {
  float w = 6.2831853 * t;
  return 0.5 * (c.x * sin(w) + c.y * cos(w) + c.z * sin(2.0 * w) + c.w * cos(2.0 * w));
}

float field(vec2 uv) {
  vec2 a = vec2(bez(uv.x, uCtrlA), bez(uv.x, uCtrlB));
  vec2 b = vec2(bez(uv.y, uCtrlC), bez(uv.y, uCtrlD));
  return distance(a, b);
}

vec3 elevationColor(float e) {
  vec3 c = mix(uLow, uMid, smoothstep(0.0, 0.5, e));
  return mix(c, uHigh, smoothstep(0.5, 1.0, e));
}

void main() {
  vec2 res = iResolution.xy;
  vec2 uv = gl_FragCoord.xy / res;
  vec2 suv = (uv - 0.5) / max(uScale, 0.001) + 0.5;
  vec2 sampleUv = suv;
  if (uPixelSize > 1.0) {
    vec2 px = res / uPixelSize;
    sampleUv = (floor(suv * px) + 0.5) / px;
  }

  float fv = field(sampleUv);
  if (uMouseEnabled > 0.5) {
    vec2 d = uv - uMouse;
    d.x *= res.x / max(res.y, 1.0);
    float r = max(uMouseRadius, 0.001);
    fv += exp(-dot(d, d) / (r * r)) * uMouseStrength * uMouseActive;
  }

  float f = fv * uBands;
  float frac = fract(f);
  float lineDist = min(frac, 1.0 - frac);
  float aa = fwidth(f) + 0.0001;
  float mask = 1.0 - smoothstep(uThickness - aa, uThickness + aa, lineDist);
  float glowR = uThickness + uGlow * 0.5 + aa;
  float glow = (1.0 - smoothstep(uThickness, glowR, lineDist)) * step(0.0001, uGlow);
  float elev = clamp(fv / (uMorphAmount * 2.5 + 0.001), 0.0, 1.0);

  vec3 lineCol;
  if (uColorMode < 0.5) {
    lineCol = elevationColor(elev);
  } else if (uColorMode < 1.5) {
    lineCol = uMid;
  } else {
    lineCol = mix(uMid, uHigh, mod(floor(f), 2.0));
  }

  float coverage = clamp(mask + glow * 0.55, 0.0, 1.0);
  coverage = pow(coverage, max(uContrast, 0.001));
  vec3 outColor = lineCol;
  float outAlpha = coverage;

  if (uFillBands > 0.5) {
    vec3 fillCol = elevationColor(elev);
    outColor = mix(fillCol, lineCol, coverage);
    outAlpha = clamp(coverage + 0.1 * elev, 0.0, 1.0);
  }
  if (uGrain > 0.5) {
    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453);
    outAlpha += (g - 0.5) * uGrainIntensity;
  }

  outColor = clamp(outColor * uBrightness, 0.0, 1.0);
  float a = clamp(outAlpha, 0.0, 1.0) * uOpacity;
  fragColor = vec4(outColor * a, a);
}
`;

const CTRL_INDICES = [
  [1, -2, 3, -4],
  [9, -8, 7, -6],
  [5, 2, 5, -5],
  [-1, -3, 8, 9],
];

const Topography = ({
  lowColor = '#5227FF',
  midColor = '#FF9FFC',
  highColor = '#FFFFFF',
  speed = 0.35,
  morphAmount = 3.0,
  morphSpeed = 0.05,
  bands = 2.0,
  thickness = 0.01,
  scale = 1.0,
  pixelSize = 1.0,
  glow = 0.5,
  colorMode = 'elevation',
  contrast = 3.0,
  brightness = 1.0,
  fillBands = false,
  opacity = 1.0,
  grain = true,
  grainIntensity = 0.05,
  mouseInteraction = true,
  mouseRadius = 0.3,
  mouseStrength = 0.4,
  paused = false,
  className = '',
}) => {
  const containerRef = useRef(null);
  const propsRef = useRef({ paused, speed, morphSpeed });
  useEffect(() => {
    propsRef.current = { paused, speed, morphSpeed };
  }, [paused, speed, morphSpeed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // This layer is decorative. Some privacy modes, embedded browsers, and
    // low-power devices expose the WebGL API but refuse to create a context.
    // Do not let that take down the landing page or its CTAs; the scoped CSS
    // background remains the intentional fallback.
    if (!hasWebGL2()) return undefined;

    let renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, 1.5),
      });
    } catch {
      return undefined;
    }
    const gl = renderer.gl;
    if (!gl) return undefined;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uMorphAmount: { value: 3.0 },
        uBands: { value: 2.0 },
        uThickness: { value: 0.01 },
        uScale: { value: 1.0 },
        uPixelSize: { value: 1.0 },
        uGlow: { value: 0.5 },
        uColorMode: { value: 0.0 },
        uContrast: { value: 3.0 },
        uBrightness: { value: 1.0 },
        uFillBands: { value: 0.0 },
        uOpacity: { value: 1.0 },
        uGrain: { value: 1.0 },
        uGrainIntensity: { value: 0.05 },
        uLow: { value: new Float32Array([1, 1, 1]) },
        uMid: { value: new Float32Array([1, 1, 1]) },
        uHigh: { value: new Float32Array([1, 1, 1]) },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseEnabled: { value: 1.0 },
        uMouseRadius: { value: 0.3 },
        uMouseStrength: { value: 0.4 },
        uMouseActive: { value: 0.0 },
        uCtrlA: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlB: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlC: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlD: { value: new Float32Array([0, 0, 0, 0]) },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });
    canvas.__topographyContext = { program };
    const shaderReady = Boolean(program.uniformLocations);
    if (!shaderReady) {
      console.error(
        '[landing] Topography shader failed:',
        gl.getShaderInfoLog(program.vertexShader),
        gl.getShaderInfoLog(program.fragmentShader),
        gl.getProgramInfoLog(program.program)
      );
    }

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height);
      const resolution = program.uniforms.iResolution.value;
      resolution[0] = gl.drawingBufferWidth;
      resolution[1] = gl.drawingBufferHeight;
      if (shaderReady) renderer.render({ scene: mesh });
    };
    const resizeObserver = new ResizeObserver(setSize);
    resizeObserver.observe(container);
    setSize();

    const currentMouse = [0.5, 0.5];
    const targetMouse = [0.5, 0.5];
    let mouseActive = 0;
    let mouseActiveTarget = 0;
    const onMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      targetMouse[0] = (event.clientX - rect.left) / Math.max(rect.width, 1);
      targetMouse[1] = 1.0 - (event.clientY - rect.top) / Math.max(rect.height, 1);
      mouseActiveTarget = 1;
    };
    const onMouseLeave = () => {
      mouseActiveTarget = 0;
    };
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    const ctrlArrays = [
      program.uniforms.uCtrlA.value,
      program.uniforms.uCtrlB.value,
      program.uniforms.uCtrlC.value,
      program.uniforms.uCtrlD.value,
    ];
    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    let isScrolling = false;
    let scrollResumeTimer = 0;
    const t0 = performance.now();
    const loop = (time) => {
      const elapsed = (time - t0) * 0.001;
      const uniforms = program.uniforms;
      uniforms.iTime.value = elapsed;
      const morph = uniforms.uMorphAmount.value;
      for (let group = 0; group < 4; group += 1) {
        const values = ctrlArrays[group];
        const indices = CTRL_INDICES[group];
        for (let j = 0; j < 4; j += 1) {
          const index = indices[j];
          values[j] =
            morph * Math.sin(elapsed * propsRef.current.speed * Math.sin(index * propsRef.current.morphSpeed) + index);
        }
      }

      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
      uniforms.uMouse.value[0] = currentMouse[0];
      uniforms.uMouse.value[1] = currentMouse[1];
      mouseActive += 0.05 * (mouseActiveTarget - mouseActive);
      uniforms.uMouseActive.value = mouseActive;
      if (shaderReady && !propsRef.current.paused) renderer.render({ scene: mesh });
      raf = requestAnimationFrame(loop);
    };

    const tryStart = () => {
      if (reduceMotion || isScrolling) return;
      if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
    };
    const tryStop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    // Give native wheel/touch scrolling a clean frame budget. The canvas is
    // decorative, so stop its entire loop while the user is actively moving
    // through the page and resume as soon as the gesture settles.
    const onScroll = () => {
      isScrolling = true;
      tryStop();
      if (scrollResumeTimer) window.clearTimeout(scrollResumeTimer);
      scrollResumeTimer = window.setTimeout(() => {
        isScrolling = false;
        scrollResumeTimer = 0;
        tryStart();
      }, 140);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      isVisible ? tryStart() : tryStop();
    });
    intersectionObserver.observe(container);
    const onVisibility = () => {
      isPageVisible = !document.hidden;
      isPageVisible ? tryStart() : tryStop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    tryStart();

    return () => {
      tryStop();
      if (scrollResumeTimer) window.clearTimeout(scrollResumeTimer);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('scroll', onScroll);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      delete canvas.__topographyContext;
      if (canvas.parentNode === container) container.removeChild(canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = container?.querySelector('canvas');
    const context = canvas?.__topographyContext;
    if (!context) return;
    const uniforms = context.program.uniforms;
    uniforms.uMorphAmount.value = morphAmount;
    uniforms.uBands.value = bands;
    uniforms.uThickness.value = thickness;
    uniforms.uScale.value = scale;
    uniforms.uPixelSize.value = pixelSize;
    uniforms.uGlow.value = glow;
    uniforms.uColorMode.value = colorModeToFloat(colorMode);
    uniforms.uContrast.value = contrast;
    uniforms.uBrightness.value = brightness;
    uniforms.uFillBands.value = fillBands ? 1.0 : 0.0;
    uniforms.uOpacity.value = opacity;
    uniforms.uGrain.value = grain ? 1.0 : 0.0;
    uniforms.uGrainIntensity.value = grainIntensity;
    uniforms.uLow.value = new Float32Array(hexToRgb(lowColor));
    uniforms.uMid.value = new Float32Array(hexToRgb(midColor));
    uniforms.uHigh.value = new Float32Array(hexToRgb(highColor));
    uniforms.uMouseEnabled.value = mouseInteraction ? 1.0 : 0.0;
    uniforms.uMouseRadius.value = mouseRadius;
    uniforms.uMouseStrength.value = mouseStrength;
  }, [
    lowColor,
    midColor,
    highColor,
    morphAmount,
    bands,
    thickness,
    scale,
    pixelSize,
    glow,
    colorMode,
    contrast,
    brightness,
    fillBands,
    opacity,
    grain,
    grainIntensity,
    mouseInteraction,
    mouseRadius,
    mouseStrength,
  ]);

  return <div ref={containerRef} className={`topography-container ${className}`.trim()} />;
};

export default Topography;

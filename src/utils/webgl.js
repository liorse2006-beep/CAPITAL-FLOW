function canCreateContext(type) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (type === 'webgl2' && typeof window.WebGL2RenderingContext === 'undefined') return false;
  if (type === 'webgl' && typeof window.WebGLRenderingContext === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext(type);
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

export function hasWebGL2() {
  return canCreateContext('webgl2');
}

export function hasWebGL() {
  return canCreateContext('webgl2') || canCreateContext('webgl');
}

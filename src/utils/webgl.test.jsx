import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasWebGL, hasWebGL2 } from './webgl';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WebGL feature detection', () => {
  it('fails closed when the browser does not expose WebGL constructors', () => {
    vi.stubGlobal('window', {});

    expect(hasWebGL2()).toBe(false);
    expect(hasWebGL()).toBe(false);
  });

  it('fails closed when context creation throws', () => {
    vi.stubGlobal('window', {
      WebGL2RenderingContext: function WebGL2RenderingContext() {},
      WebGLRenderingContext: function WebGLRenderingContext() {},
    });
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('context creation blocked');
    });

    expect(hasWebGL2()).toBe(false);
    expect(hasWebGL()).toBe(false);
  });
});

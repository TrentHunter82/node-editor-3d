import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import type { MatcapName } from '../utils/matcap';

// Mock canvas 2D context since jsdom doesn't fully support it
const mockCtx = {
  createRadialGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  fillRect: vi.fn(),
  fillStyle: '',
  globalCompositeOperation: 'source-over',
};

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Because useMatcap relies on a module-scoped `textureCache` Map that persists
 * across tests, we use dynamic import with `vi.resetModules()` where isolation
 * is needed. For the caching tests we deliberately let the cache persist within
 * a single test to verify referential equality.
 */
describe('useMatcap', () => {
  it('returns a THREE.CanvasTexture instance', async () => {
    vi.resetModules();
    const { useMatcap } = await import('./useMatcap');

    const { result } = renderHook(() => useMatcap('plastic-coral'));

    expect(result.current).toBeInstanceOf(THREE.CanvasTexture);
  });

  it('returns the same cached texture for the same name (referential equality)', async () => {
    vi.resetModules();
    const { useMatcap } = await import('./useMatcap');

    const { result: result1 } = renderHook(() => useMatcap('plastic-teal'));
    const { result: result2 } = renderHook(() => useMatcap('plastic-teal'));

    expect(result1.current).toBe(result2.current);
  });

  it('returns different textures for different names', async () => {
    vi.resetModules();
    const { useMatcap } = await import('./useMatcap');

    const { result: result1 } = renderHook(() => useMatcap('plastic-coral'));
    const { result: result2 } = renderHook(() => useMatcap('chrome-bright'));

    expect(result1.current).not.toBe(result2.current);
  });

  it('works without error for all 5 matcap names', async () => {
    vi.resetModules();
    const { useMatcap } = await import('./useMatcap');

    const names = [
      'plastic-coral',
      'plastic-teal',
      'plastic-orange',
      'chrome-bright',
      'chrome-dark',
    ] as const;

    for (const name of names) {
      const { result } = renderHook(() => useMatcap(name));
      expect(result.current).toBeInstanceOf(THREE.CanvasTexture);
    }
  });

  it('cache prevents duplicate calls to createMatcapTexture', async () => {
    vi.resetModules();

    // Spy on the createMatcapTexture function from the matcap utility module
    const matcapUtils = await import('../utils/matcap');
    const createSpy = vi.spyOn(matcapUtils, 'createMatcapTexture');

    // Re-import useMatcap so it picks up the spied module
    vi.resetModules();
    // Re-spy after module reset
    const matcapUtils2 = await import('../utils/matcap');
    const createSpy2 = vi.spyOn(matcapUtils2, 'createMatcapTexture');
    const { useMatcap } = await import('./useMatcap');

    // First render for 'chrome-dark' -- should call createMatcapTexture
    renderHook(() => useMatcap('chrome-dark'));
    const callCountAfterFirst = createSpy2.mock.calls.length;
    expect(callCountAfterFirst).toBe(1);

    // Second render for the same name -- should NOT call createMatcapTexture again
    renderHook(() => useMatcap('chrome-dark'));
    expect(createSpy2).toHaveBeenCalledTimes(callCountAfterFirst);

    createSpy.mockRestore();
    createSpy2.mockRestore();
  });

  it('returns a texture whose image has expected dimensions', async () => {
    vi.resetModules();
    const { useMatcap } = await import('./useMatcap');

    const { result } = renderHook(() => useMatcap('plastic-orange'));
    const texture = result.current;

    // createMatcapTexture defaults to 512x512
    expect(texture.image).toBeDefined();
    expect(texture.image.width).toBe(512);
    expect(texture.image.height).toBe(512);
  });

  it('returns a stable reference across re-renders with the same name', async () => {
    vi.resetModules();
    const { useMatcap } = await import('./useMatcap');

    const { result, rerender } = renderHook(
      ({ name }) => useMatcap(name),
      { initialProps: { name: 'plastic-coral' as const } },
    );

    const first = result.current;
    rerender({ name: 'plastic-coral' as const });
    expect(result.current).toBe(first);
  });

  it('returns a different texture when name prop changes', async () => {
    vi.resetModules();
    const { useMatcap } = await import('./useMatcap');

    const { result, rerender } = renderHook(
      ({ name }) => useMatcap(name),
      { initialProps: { name: 'plastic-coral' as MatcapName } },
    );

    const first = result.current;
    rerender({ name: 'chrome-dark' as MatcapName });
    expect(result.current).not.toBe(first);
  });
});

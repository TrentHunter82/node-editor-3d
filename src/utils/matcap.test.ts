import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MATCAP_CONFIGS } from './matcap';
import type { MatcapName } from './matcap';

// Mock canvas 2D context since jsdom doesn't support it
const mockCtx = {
  createRadialGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  fillRect: vi.fn(),
  fillStyle: '',
  globalCompositeOperation: 'source-over',
};

// Patch HTMLCanvasElement.prototype.getContext to return our mock
beforeEach(() => {
   
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
});

describe('Matcap Utility', () => {
  describe('createMatcapTexture', () => {
    it('returns a CanvasTexture with correct size', async () => {
      const { createMatcapTexture } = await import('./matcap');
      const texture = createMatcapTexture('#E8453C', '#FFD5D0', 256);
      expect(texture).toBeDefined();
      expect(texture.image).toBeDefined();
      expect(texture.image.width).toBe(256);
      expect(texture.image.height).toBe(256);
    });

    it('defaults to 512 size', async () => {
      const { createMatcapTexture } = await import('./matcap');
      const texture = createMatcapTexture('#E8453C');
      expect(texture.image.width).toBe(512);
      expect(texture.image.height).toBe(512);
    });

    it('uses white as default highlight color without throwing', async () => {
      const { createMatcapTexture } = await import('./matcap');
      const texture = createMatcapTexture('#C0C0C0');
      expect(texture).toBeDefined();
    });

    it('creates distinct textures for different base colors', async () => {
      const { createMatcapTexture } = await import('./matcap');
      const t1 = createMatcapTexture('#FF0000', '#FFFFFF', 64);
      const t2 = createMatcapTexture('#0000FF', '#FFFFFF', 64);
      expect(t1).not.toBe(t2);
    });

    it('calls createRadialGradient for gradients', async () => {
      const { createMatcapTexture } = await import('./matcap');
      mockCtx.createRadialGradient.mockClear();
      createMatcapTexture('#E8453C', '#FFD5D0', 64);
      // Should create 4 gradients: base, specular, secondary, rim + edge
      expect(mockCtx.createRadialGradient).toHaveBeenCalled();
      expect(mockCtx.createRadialGradient.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('sets composite operations for layered rendering', async () => {
      const { createMatcapTexture } = await import('./matcap');
      createMatcapTexture('#E8453C', '#FFD5D0', 64);
      // After all operations, should reset to 'source-over'
      expect(mockCtx.globalCompositeOperation).toBe('source-over');
    });
  });

  describe('MATCAP_CONFIGS', () => {
    it('has all expected config entries', () => {
      const expected: MatcapName[] = [
        'plastic-coral', 'plastic-teal', 'plastic-orange',
        'chrome-bright', 'chrome-dark',
      ];
      for (const name of expected) {
        expect(MATCAP_CONFIGS[name]).toBeDefined();
        expect(MATCAP_CONFIGS[name].base).toBeTruthy();
        expect(MATCAP_CONFIGS[name].highlight).toBeTruthy();
      }
    });

    it('all configs have valid hex colors', () => {
      const hexRegex = /^#[0-9A-Fa-f]{6}$/;
      for (const [, config] of Object.entries(MATCAP_CONFIGS)) {
        expect(config.base).toMatch(hexRegex);
        expect(config.highlight).toMatch(hexRegex);
      }
    });

    it('can create textures from all configs without error', async () => {
      const { createMatcapTexture } = await import('./matcap');
      for (const [, config] of Object.entries(MATCAP_CONFIGS)) {
        const texture = createMatcapTexture(config.base, config.highlight, 32);
        expect(texture).toBeDefined();
        expect(texture.image.width).toBe(32);
      }
    });
  });
});

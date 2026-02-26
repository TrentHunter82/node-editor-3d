import * as THREE from 'three';

/**
 * Generate a matcap texture procedurally using Canvas 2D.
 * Produces a sphere-like shading with specular highlight and rim light.
 */
export function createMatcapTexture(
  baseColor: string,
  highlightColor: string = '#ffffff',
  size: number = 512
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  // Base sphere gradient (lit from upper-left)
  const baseGrad = ctx.createRadialGradient(
    cx * 0.7, cy * 0.65, 0,
    cx, cy, r
  );
  baseGrad.addColorStop(0, highlightColor);
  baseGrad.addColorStop(0.3, lighten(baseColor, 30));
  baseGrad.addColorStop(0.7, baseColor);
  baseGrad.addColorStop(1, darken(baseColor, 50));

  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, size, size);

  // Specular highlight (sharp, upper-left)
  ctx.globalCompositeOperation = 'screen';
  const specGrad = ctx.createRadialGradient(
    cx * 0.55, cy * 0.45, 0,
    cx * 0.55, cy * 0.45, r * 0.35
  );
  specGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
  specGrad.addColorStop(0.3, 'rgba(255,255,255,0.3)');
  specGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = specGrad;
  ctx.fillRect(0, 0, size, size);

  // Secondary softer highlight
  const spec2 = ctx.createRadialGradient(
    cx * 0.65, cy * 0.55, 0,
    cx * 0.65, cy * 0.55, r * 0.5
  );
  spec2.addColorStop(0, 'rgba(255,255,255,0.4)');
  spec2.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  spec2.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec2;
  ctx.fillRect(0, 0, size, size);

  // Rim light (edge glow)
  ctx.globalCompositeOperation = 'screen';
  const rimGrad = ctx.createRadialGradient(
    cx, cy, r * 0.75,
    cx, cy, r
  );
  rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
  rimGrad.addColorStop(0.7, 'rgba(255,255,255,0)');
  rimGrad.addColorStop(0.9, 'rgba(255,255,255,0.15)');
  rimGrad.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = rimGrad;
  ctx.fillRect(0, 0, size, size);

  // Darken edges for sphere falloff
  ctx.globalCompositeOperation = 'multiply';
  const edgeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  edgeGrad.addColorStop(0, '#ffffff');
  edgeGrad.addColorStop(0.6, '#ffffff');
  edgeGrad.addColorStop(0.85, '#cccccc');
  edgeGrad.addColorStop(1, '#666666');
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function lighten(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const amt = Math.round(2.55 * percent);
  return rgbToHex(
    Math.min(255, r + amt),
    Math.min(255, g + amt),
    Math.min(255, b + amt)
  );
}

function darken(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const factor = 1 - percent / 100;
  return rgbToHex(
    Math.round(r * factor),
    Math.round(g * factor),
    Math.round(b * factor)
  );
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Pre-defined matcap configs
export const MATCAP_CONFIGS = {
  'plastic-coral': { base: '#E8453C', highlight: '#FFD5D0' },
  'plastic-teal': { base: '#2EC4B6', highlight: '#D0FFF8' },
  'plastic-orange': { base: '#FF6B35', highlight: '#FFE0C8' },
  'chrome-bright': { base: '#C0C0C0', highlight: '#FFFFFF' },
  'chrome-dark': { base: '#505050', highlight: '#B0B0B0' },
} as const;

export type MatcapName = keyof typeof MATCAP_CONFIGS;

/**
 * Pre-baked label textures — text rendering at scale.
 *
 * troika `<Text>` (drei) costs an SDF shader, async layout, and a draw call
 * per label; at the 1000-node target that dominates frame time. Instead we
 * bake each unique (text, color) pair once into a canvas texture and share
 * the resulting material across every node that shows that label (node
 * titles repeat heavily — "Math", "Display", …).
 *
 * Entries are reference-counted: acquire in a component, release on unmount.
 * When the cache exceeds MAX_ENTRIES, unreferenced entries are evicted and
 * their GPU resources disposed.
 */
import * as THREE from 'three';

export interface LabelHandle {
  material: THREE.MeshBasicMaterial;
  /** texture width / height — multiply by world height to get world width */
  aspect: number;
}

interface LabelEntry extends LabelHandle {
  texture: THREE.Texture | null;
  refs: number;
}

const FONT = "600 48px 'JetBrains Mono', monospace";
const CANVAS_HEIGHT = 64; // px; text baseline-centered with padding
const PAD_X = 12;
const MAX_ENTRIES = 1024;

const cache = new Map<string, LabelEntry>();

/** Estimate aspect when canvas 2D is unavailable (jsdom/tests) */
function estimateAspect(text: string): number {
  // JetBrains Mono advance width ≈ 0.6em
  const width = Math.max(1, text.length) * 48 * 0.6 + PAD_X * 2;
  return width / CANVAS_HEIGHT;
}

function bake(text: string, color: string): { texture: THREE.Texture | null; aspect: number } {
  if (typeof document === 'undefined') {
    return { texture: null, aspect: estimateAspect(text) };
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // jsdom / headless: no 2D context — material renders as a plain quad in
    // tests, which never assert pixels.
    return { texture: null, aspect: estimateAspect(text) };
  }
  ctx.font = FONT;
  const metrics = ctx.measureText(text);
  const width = Math.max(2, Math.ceil(metrics.width) + PAD_X * 2);
  canvas.width = width;
  canvas.height = CANVAS_HEIGHT;
  // Setting canvas size resets context state — set font again
  const ctx2 = canvas.getContext('2d')!;
  ctx2.font = FONT;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.fillStyle = color;
  ctx2.fillText(text, width / 2, CANVAS_HEIGHT / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { texture, aspect: width / CANVAS_HEIGHT };
}

function evictUnreferenced(): void {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (entry.refs <= 0) {
      entry.texture?.dispose();
      entry.material.dispose();
      cache.delete(key);
      if (cache.size <= MAX_ENTRIES) break;
    }
  }
}

/** Get (or bake) the shared material for a label. Pair with releaseLabel. */
export function acquireLabel(text: string, color: string): LabelHandle {
  const key = `${color}|${text}`;
  let entry = cache.get(key);
  if (!entry) {
    const { texture, aspect } = bake(text, color);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      ...(texture ? { map: texture } : { color, opacity: 0 }),
    });
    entry = { material, texture, aspect, refs: 0 };
    cache.set(key, entry);
    evictUnreferenced();
  }
  entry.refs++;
  return entry;
}

/** Release a label acquired with acquireLabel. */
export function releaseLabel(text: string, color: string): void {
  const entry = cache.get(`${color}|${text}`);
  if (entry) entry.refs = Math.max(0, entry.refs - 1);
}

/** Current number of cached labels (tests/diagnostics). */
export function _labelCacheSize(): number {
  return cache.size;
}

/** Refs for a given label (tests). */
export function _labelRefs(text: string, color: string): number {
  return cache.get(`${color}|${text}`)?.refs ?? -1;
}

/** Dispose everything (tests). */
export function _resetLabelCache(): void {
  for (const entry of cache.values()) {
    entry.texture?.dispose();
    entry.material.dispose();
  }
  cache.clear();
}

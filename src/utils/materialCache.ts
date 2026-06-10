/**
 * materialCache.ts — Shared material and geometry instance caching.
 *
 * Eliminates duplicate THREE.MeshBasicMaterial and RoundedBoxGeometry creation
 * across 100+ node instances by returning the same object for identical props.
 *
 * Materials keyed by: color|opacity|transparent|depthWrite
 * Geometries keyed by: width|height|depth|segments|radius
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';

// ---------------------------------------------------------------------------
// Material cache
// ---------------------------------------------------------------------------

const materialCache = new Map<string, THREE.MeshBasicMaterial>();

/**
 * Returns a shared MeshBasicMaterial instance for the given property combination.
 * Callers must NOT mutate the returned material (color, opacity, etc.).
 */
export function getCachedBasicMaterial(
  color: string,
  opacity = 1,
  transparent = false,
  depthWrite = true,
): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}|${transparent ? 1 : 0}|${depthWrite ? 1 : 0}`;
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, opacity, transparent, depthWrite });
    materialCache.set(key, mat);
  }
  return mat;
}

// ---------------------------------------------------------------------------
// RoundedBox geometry cache
// ---------------------------------------------------------------------------

const geoCache = new Map<string, RoundedBoxGeometry>();

/**
 * Quantization step for cached geometry dimensions. Without this, a live
 * resize drag mints a unique RoundedBoxGeometry for every float dimension it
 * passes through (hundreds per drag, cached forever → VRAM bloat). 0.05 world
 * units is imperceptible next to port positions computed from exact dims
 * (max visual delta 0.025).
 */
const GEO_DIM_STEP = 0.05;

function quantizeDim(v: number): number {
  return Math.max(GEO_DIM_STEP, Math.round(v / GEO_DIM_STEP) * GEO_DIM_STEP);
}

/**
 * Returns a shared RoundedBoxGeometry instance for the given dimensions
 * (quantized to GEO_DIM_STEP). Callers must NOT dispose the returned geometry.
 */
export function getCachedRoundedBoxGeo(
  w: number,
  h: number,
  d: number,
  segments: number,
  radius: number,
): RoundedBoxGeometry {
  const qw = quantizeDim(w);
  const qh = quantizeDim(h);
  const qd = quantizeDim(d);
  const key = `${qw}|${qh}|${qd}|${segments}|${radius}`;
  let geo = geoCache.get(key);
  if (!geo) {
    geo = new RoundedBoxGeometry(qw, qh, qd, segments, radius);
    geoCache.set(key, geo);
  }
  return geo;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Clear all cached materials and geometries (for tests). */
export function _resetMaterialCache(): void {
  for (const mat of materialCache.values()) mat.dispose();
  materialCache.clear();
  for (const geo of geoCache.values()) geo.dispose();
  geoCache.clear();
}

/** Return the current cache sizes (for tests). */
export function _getCacheSizes(): { materials: number; geometries: number } {
  return { materials: materialCache.size, geometries: geoCache.size };
}

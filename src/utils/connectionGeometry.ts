/**
 * Connection curve geometry — shared between the interactive `Pipe`
 * component and the instanced far-LOD line renderer, so both agree on the
 * exact curve shape for every connection style.
 */
import type { ConnectionStyle } from '../store/settingsStore';

export type Vec3 = [number, number, number];

export interface ControlPoints {
  midA: Vec3;
  midB: Vec3;
}

/** Compute cubic-bezier control points for a connection style. */
export function computeControlPoints(start: Vec3, end: Vec3, style: ConnectionStyle): ControlPoints {
  if (style === 'straight') {
    // Straight line: control points = start/end (linear bezier)
    return { midA: [...start] as Vec3, midB: [...end] as Vec3 };
  }
  if (style === 'right-angle') {
    // Right-angle routing: go halfway horizontally, then turn
    const midX = (start[0] + end[0]) / 2;
    const lift = 0.05;
    return {
      midA: [midX, start[1] + lift, start[2]],
      midB: [midX, end[1] + lift, end[2]],
    };
  }
  if (style === 'organic') {
    // Organic: spline-like with perpendicular offsets for a natural, flowing feel
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const spread = Math.max(0.3, dist * 0.3);
    // Offset control points perpendicular to the connection direction
    const perpX = dist > 0.001 ? -dz / dist : 0;
    const perpZ = dist > 0.001 ? dx / dist : 1;
    const offset = spread * 0.4;
    return {
      midA: [start[0] + dx * 0.3 + perpX * offset, start[1] + dy * 0.3 + 0.15, start[2] + dz * 0.3 + perpZ * offset],
      midB: [start[0] + dx * 0.7 - perpX * offset, start[1] + dy * 0.7 + 0.15, start[2] + dz * 0.7 - perpZ * offset],
    };
  }
  // Default: bezier with horizontal spread
  const dx = Math.abs(end[0] - start[0]) * 0.4;
  return {
    midA: [start[0] + dx, start[1] + 0.15, start[2]],
    midB: [end[0] - dx, end[1] + 0.15, end[2]],
  };
}

/**
 * Sample a cubic bezier into line-segment vertex pairs.
 *
 * Writes `segments` segments (2 vertices each, xyz floats) into `out`
 * starting at float index `offset`. Returns the next free float index.
 * Allocation-free — used inside useFrame for the instanced renderer.
 */
export function writeBezierSegments(
  out: Float32Array,
  offset: number,
  start: Vec3,
  midA: Vec3,
  midB: Vec3,
  end: Vec3,
  segments: number,
): number {
  let prevX = start[0], prevY = start[1], prevZ = start[2];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const a = uu * u;        // (1-t)^3
    const b = 3 * uu * t;    // 3(1-t)^2 t
    const c = 3 * u * tt;    // 3(1-t) t^2
    const d = tt * t;        // t^3
    const x = a * start[0] + b * midA[0] + c * midB[0] + d * end[0];
    const y = a * start[1] + b * midA[1] + c * midB[1] + d * end[1];
    const z = a * start[2] + b * midA[2] + c * midB[2] + d * end[2];
    out[offset++] = prevX; out[offset++] = prevY; out[offset++] = prevZ;
    out[offset++] = x; out[offset++] = y; out[offset++] = z;
    prevX = x; prevY = y; prevZ = z;
  }
  return offset;
}

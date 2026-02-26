import { describe, it, expect } from 'vitest';

type Vec3 = [number, number, number];
type ConnectionStyle = 'bezier' | 'straight' | 'right-angle' | 'organic';

/**
 * Pure function that replicates the control-point computation from Pipe.tsx.
 * This is extracted for testability; the actual computation lives in a useMemo inside Pipe.
 */
function computeControlPoints(
  start: Vec3,
  end: Vec3,
  style: ConnectionStyle,
): { midA: Vec3; midB: Vec3 } {
  if (style === 'straight') {
    return { midA: [...start] as Vec3, midB: [...end] as Vec3 };
  }
  if (style === 'right-angle') {
    const midX = (start[0] + end[0]) / 2;
    const lift = 0.05;
    return {
      midA: [midX, start[1] + lift, start[2]],
      midB: [midX, end[1] + lift, end[2]],
    };
  }
  if (style === 'organic') {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const spread = Math.max(0.3, dist * 0.3);
    const perpX = dist > 0.001 ? -dz / dist : 0;
    const perpZ = dist > 0.001 ? dx / dist : 1;
    const offset = spread * 0.4;
    return {
      midA: [start[0] + dx * 0.3 + perpX * offset, start[1] + dy * 0.3 + 0.15, start[2] + dz * 0.3 + perpZ * offset],
      midB: [start[0] + dx * 0.7 - perpX * offset, start[1] + dy * 0.7 + 0.15, start[2] + dz * 0.7 - perpZ * offset],
    };
  }
  // Default: bezier
  const dx = Math.abs(end[0] - start[0]) * 0.4;
  return {
    midA: [start[0] + dx, start[1] + 0.15, start[2]],
    midB: [end[0] - dx, end[1] + 0.15, end[2]],
  };
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/** Assert all three components are finite numbers. */
function expectFinite(v: Vec3, label: string) {
  expect(Number.isFinite(v[0]), `${label}[0] should be finite`).toBe(true);
  expect(Number.isFinite(v[1]), `${label}[1] should be finite`).toBe(true);
  expect(Number.isFinite(v[2]), `${label}[2] should be finite`).toBe(true);
}

// ===========================================================================
// 1. Bezier style
// ===========================================================================

describe('bezier style (default)', () => {
  const style: ConnectionStyle = 'bezier';

  it('horizontal connection (same Z) produces correct control points', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [4, 0, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    const dx = Math.abs(end[0] - start[0]) * 0.4; // 1.6
    expect(midA[0]).toBeCloseTo(start[0] + dx); // 1.6
    expect(midA[1]).toBeCloseTo(start[1] + 0.15);
    expect(midA[2]).toBeCloseTo(start[2]);

    expect(midB[0]).toBeCloseTo(end[0] - dx); // 2.4
    expect(midB[1]).toBeCloseTo(end[1] + 0.15);
    expect(midB[2]).toBeCloseTo(end[2]);
  });

  it('diagonal connection produces offset control points', () => {
    const start: Vec3 = [1, 2, 3];
    const end: Vec3 = [5, 4, 7];
    const { midA, midB } = computeControlPoints(start, end, style);

    // dx = Math.abs(end[0] - start[0]) * 0.4 = 1.6
    expect(midA[0]).toBeCloseTo(1 + 1.6);
    expect(midA[1]).toBeCloseTo(2 + 0.15);
    expect(midA[2]).toBeCloseTo(3);

    expect(midB[0]).toBeCloseTo(5 - 1.6);
    expect(midB[1]).toBeCloseTo(4 + 0.15);
    expect(midB[2]).toBeCloseTo(7);
  });

  it('overlapping nodes (start == end) does not crash, dx is zero', () => {
    const start: Vec3 = [3, 1, 2];
    const end: Vec3 = [3, 1, 2];
    const { midA, midB } = computeControlPoints(start, end, style);

    // dx = 0 when positions match
    expect(midA[0]).toBeCloseTo(3);
    expect(midA[1]).toBeCloseTo(1.15);
    expect(midA[2]).toBeCloseTo(2);

    expect(midB[0]).toBeCloseTo(3);
    expect(midB[1]).toBeCloseTo(1.15);
    expect(midB[2]).toBeCloseTo(2);

    expectFinite(midA, 'midA');
    expectFinite(midB, 'midB');
  });

  it('very long connection scales dx spread with distance', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [100, 0, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    // dx = 100 * 0.4 = 40
    expect(midA[0]).toBeCloseTo(40);
    expect(midB[0]).toBeCloseTo(60);
    // The spread (40) scales linearly with distance
    expect(midA[0] - start[0]).toBeCloseTo(40);
    expect(end[0] - midB[0]).toBeCloseTo(40);
  });

  it('reversed direction (end.x < start.x) produces valid control points', () => {
    const start: Vec3 = [5, 0, 0];
    const end: Vec3 = [1, 0, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    // dx = Math.abs(1 - 5) * 0.4 = 1.6
    // midA is to the right of start, midB is to the left of end
    expect(midA[0]).toBeCloseTo(5 + 1.6); // 6.6
    expect(midB[0]).toBeCloseTo(1 - 1.6); // -0.6
    // Both are finite
    expectFinite(midA, 'midA');
    expectFinite(midB, 'midB');
  });

  it('Y lift is always 0.15 regardless of positions', () => {
    const cases: [Vec3, Vec3][] = [
      [[0, 0, 0], [1, 0, 0]],
      [[0, 5, 0], [10, -3, 0]],
      [[-5, -5, -5], [5, 5, 5]],
    ];
    for (const [start, end] of cases) {
      const { midA, midB } = computeControlPoints(start, end, style);
      expect(midA[1]).toBeCloseTo(start[1] + 0.15);
      expect(midB[1]).toBeCloseTo(end[1] + 0.15);
    }
  });
});

// ===========================================================================
// 2. Straight style
// ===========================================================================

describe('straight style', () => {
  const style: ConnectionStyle = 'straight';

  it('control points equal start and end (linear bezier)', () => {
    const start: Vec3 = [1, 2, 3];
    const end: Vec3 = [4, 5, 6];
    const { midA, midB } = computeControlPoints(start, end, style);

    expect(midA[0]).toBe(start[0]);
    expect(midA[1]).toBe(start[1]);
    expect(midA[2]).toBe(start[2]);

    expect(midB[0]).toBe(end[0]);
    expect(midB[1]).toBe(end[1]);
    expect(midB[2]).toBe(end[2]);
  });

  it('works with overlapping positions', () => {
    const start: Vec3 = [2, 2, 2];
    const end: Vec3 = [2, 2, 2];
    const { midA, midB } = computeControlPoints(start, end, style);

    expect(midA).toEqual([2, 2, 2]);
    expect(midB).toEqual([2, 2, 2]);
  });

  it('vertical connection (only Z differs)', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [0, 0, 10];
    const { midA, midB } = computeControlPoints(start, end, style);

    expect(midA).toEqual([0, 0, 0]);
    expect(midB).toEqual([0, 0, 10]);
  });

  it('control points are copies, not references to original arrays', () => {
    const start: Vec3 = [1, 2, 3];
    const end: Vec3 = [4, 5, 6];
    const { midA, midB } = computeControlPoints(start, end, style);

    // Mutate the returned arrays — should not affect originals
    midA[0] = 999;
    midB[0] = 888;
    expect(start[0]).toBe(1);
    expect(end[0]).toBe(4);

    // Also check the other direction: mutating originals should not affect returned values
    const { midA: midA2 } = computeControlPoints(start, end, style);
    start[0] = 777;
    expect(midA2[0]).toBe(1);
    // Restore
    start[0] = 1;
  });

  it('handles negative coordinates', () => {
    const start: Vec3 = [-10, -20, -30];
    const end: Vec3 = [-5, -15, -25];
    const { midA, midB } = computeControlPoints(start, end, style);

    expect(midA).toEqual([-10, -20, -30]);
    expect(midB).toEqual([-5, -15, -25]);
  });
});

// ===========================================================================
// 3. Right-angle style
// ===========================================================================

describe('right-angle style', () => {
  const style: ConnectionStyle = 'right-angle';

  it('midpoint X is average of start/end X', () => {
    const start: Vec3 = [2, 0, 0];
    const end: Vec3 = [8, 0, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    const expectedMidX = (2 + 8) / 2; // 5
    expect(midA[0]).toBeCloseTo(expectedMidX);
    expect(midB[0]).toBeCloseTo(expectedMidX);
  });

  it('lift of 0.05 is applied to Y for both control points', () => {
    const start: Vec3 = [0, 1, 0];
    const end: Vec3 = [6, 3, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    expect(midA[1]).toBeCloseTo(1 + 0.05);
    expect(midB[1]).toBeCloseTo(3 + 0.05);
  });

  it('preserves Z from respective endpoints', () => {
    const start: Vec3 = [0, 0, 5];
    const end: Vec3 = [10, 0, 15];
    const { midA, midB } = computeControlPoints(start, end, style);

    expect(midA[2]).toBeCloseTo(5);
    expect(midB[2]).toBeCloseTo(15);
  });

  it('overlapping nodes (midX = start.x = end.x)', () => {
    const start: Vec3 = [3, 1, 2];
    const end: Vec3 = [3, 4, 2];
    const { midA, midB } = computeControlPoints(start, end, style);

    expect(midA[0]).toBeCloseTo(3);
    expect(midB[0]).toBeCloseTo(3);
    expect(midA[1]).toBeCloseTo(1.05);
    expect(midB[1]).toBeCloseTo(4.05);
    expectFinite(midA, 'midA');
    expectFinite(midB, 'midB');
  });

  it('reversed direction (end.x < start.x) still averages correctly', () => {
    const start: Vec3 = [10, 0, 0];
    const end: Vec3 = [2, 0, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    const expectedMidX = (10 + 2) / 2; // 6
    expect(midA[0]).toBeCloseTo(expectedMidX);
    expect(midB[0]).toBeCloseTo(expectedMidX);
  });
});

// ===========================================================================
// 4. Organic style
// ===========================================================================

describe('organic style', () => {
  const style: ConnectionStyle = 'organic';

  it('horizontal connection: perpendicular offset is in Z direction', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [4, 0, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    // For horizontal connection: dx=4, dz=0, dist=4
    // perpX = -0/4 = 0, perpZ = 4/4 = 1
    // spread = max(0.3, 4*0.3) = 1.2, offset = 1.2 * 0.4 = 0.48
    const dist = 4;
    const spread = Math.max(0.3, dist * 0.3);
    const offset = spread * 0.4;

    // midA: [0 + 4*0.3 + 0*offset, 0 + 0*0.3 + 0.15, 0 + 0*0.3 + 1*offset]
    expect(midA[0]).toBeCloseTo(1.2);
    expect(midA[1]).toBeCloseTo(0.15);
    expect(midA[2]).toBeCloseTo(offset); // 0.48 — perpendicular offset in Z

    // midB: [0 + 4*0.7 - 0*offset, 0 + 0*0.7 + 0.15, 0 + 0*0.7 - 1*offset]
    expect(midB[0]).toBeCloseTo(2.8);
    expect(midB[1]).toBeCloseTo(0.15);
    expect(midB[2]).toBeCloseTo(-offset); // -0.48 — opposite Z offset
  });

  it('diagonal connection: offsets are perpendicular to direction', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [3, 0, 4];
    const { midA, midB } = computeControlPoints(start, end, style);

    const dx = 3, dz = 4;
    const dist = Math.sqrt(9 + 16); // 5
    const spread = Math.max(0.3, dist * 0.3); // 1.5
    const perpX = -dz / dist; // -0.8
    const perpZ = dx / dist;  // 0.6
    const offset = spread * 0.4; // 0.6

    expect(midA[0]).toBeCloseTo(0 + 3 * 0.3 + perpX * offset);
    expect(midA[1]).toBeCloseTo(0.15);
    expect(midA[2]).toBeCloseTo(0 + 4 * 0.3 + perpZ * offset);

    expect(midB[0]).toBeCloseTo(0 + 3 * 0.7 - perpX * offset);
    expect(midB[1]).toBeCloseTo(0.15);
    expect(midB[2]).toBeCloseTo(0 + 4 * 0.7 - perpZ * offset);

    // Verify perpendicular: dot product of direction and perpendicular should be 0
    // direction = (dx, dz) = (3, 4), perpendicular = (perpX, perpZ) = (-0.8, 0.6)
    const dotProduct = dx * perpX + dz * perpZ;
    expect(dotProduct).toBeCloseTo(0);
  });

  it('very short connection (dist < 0.001) uses fallback perpendicular', () => {
    // Both at same X and Z but different Y — dist in XZ plane is 0
    const start: Vec3 = [5, 0, 3];
    const end: Vec3 = [5, 2, 3];
    const { midA, midB } = computeControlPoints(start, end, style);

    // dist = 0, so perpX = 0, perpZ = 1 (fallback)
    // spread = max(0.3, 0*0.3) = 0.3, offset = 0.3 * 0.4 = 0.12
    const offset = 0.3 * 0.4; // 0.12

    // midA: [5 + 0*0.3 + 0*offset, 0 + 2*0.3 + 0.15, 3 + 0*0.3 + 1*offset]
    expect(midA[0]).toBeCloseTo(5);
    expect(midA[1]).toBeCloseTo(0.6 + 0.15);
    expect(midA[2]).toBeCloseTo(3 + offset);

    // midB: [5 + 0*0.7 - 0*offset, 0 + 2*0.7 + 0.15, 3 + 0*0.7 - 1*offset]
    expect(midB[0]).toBeCloseTo(5);
    expect(midB[1]).toBeCloseTo(1.4 + 0.15);
    expect(midB[2]).toBeCloseTo(3 - offset);

    expectFinite(midA, 'midA');
    expectFinite(midB, 'midB');
  });

  it('very long connection: spread scales with distance', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [100, 0, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    const dist = 100;
    const spread = Math.max(0.3, dist * 0.3); // 30
    const offset = spread * 0.4; // 12

    // For horizontal: perpX=0, perpZ=1
    expect(midA[2]).toBeCloseTo(offset);  // 12 (large Z offset)
    expect(midB[2]).toBeCloseTo(-offset); // -12

    // Compare with short connection
    const { midA: shortMidA } = computeControlPoints([0, 0, 0], [1, 0, 0], style);
    const shortDist = 1;
    const shortSpread = Math.max(0.3, shortDist * 0.3); // 0.3
    const shortOffset = shortSpread * 0.4; // 0.12
    expect(shortMidA[2]).toBeCloseTo(shortOffset);

    // Long connection has much larger perpendicular offset
    expect(Math.abs(midA[2])).toBeGreaterThan(Math.abs(shortMidA[2]) * 10);
  });

  it('control points are between start and end for reasonable inputs', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [10, 0, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    // X coordinates of control points should be between start and end
    // midA at 30% along, midB at 70% along (with perpendicular offsets)
    expect(midA[0]).toBeGreaterThan(start[0]);
    expect(midA[0]).toBeLessThan(end[0]);
    expect(midB[0]).toBeGreaterThan(start[0]);
    expect(midB[0]).toBeLessThan(end[0]);

    // midA should be closer to start, midB closer to end
    expect(midA[0]).toBeLessThan(midB[0]);
  });

  it('Y component accounts for both interpolation and lift', () => {
    const start: Vec3 = [0, 1, 0];
    const end: Vec3 = [4, 3, 0];
    const { midA, midB } = computeControlPoints(start, end, style);

    const dy = 3 - 1; // 2
    // midA.y = start.y + dy*0.3 + 0.15 = 1 + 0.6 + 0.15 = 1.75
    expect(midA[1]).toBeCloseTo(1 + dy * 0.3 + 0.15);
    // midB.y = start.y + dy*0.7 + 0.15 = 1 + 1.4 + 0.15 = 2.55
    expect(midB[1]).toBeCloseTo(1 + dy * 0.7 + 0.15);
  });
});

// ===========================================================================
// 5. Edge cases (all styles)
// ===========================================================================

describe('edge cases (all styles)', () => {
  const styles: ConnectionStyle[] = ['bezier', 'straight', 'right-angle', 'organic'];

  it('all styles produce valid (finite) numbers for zero-length connection', () => {
    const pos: Vec3 = [0, 0, 0];
    for (const style of styles) {
      const { midA, midB } = computeControlPoints(pos, pos, style);
      expectFinite(midA, `${style} midA`);
      expectFinite(midB, `${style} midB`);
    }
  });

  it('all styles produce valid numbers for negative coordinates', () => {
    const start: Vec3 = [-10, -20, -30];
    const end: Vec3 = [-5, -15, -25];
    for (const style of styles) {
      const { midA, midB } = computeControlPoints(start, end, style);
      expectFinite(midA, `${style} midA`);
      expectFinite(midB, `${style} midB`);
    }
  });

  it('all styles: midA and midB are different from each other for non-zero-length connections', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [5, 3, 2];
    for (const style of styles) {
      const { midA, midB } = computeControlPoints(start, end, style);
      const areDifferent =
        midA[0] !== midB[0] || midA[1] !== midB[1] || midA[2] !== midB[2];
      expect(areDifferent, `${style}: midA and midB should differ for non-zero-length connection`).toBe(true);
    }
  });

  it('all styles produce valid numbers for very large coordinates', () => {
    const start: Vec3 = [1e6, 1e6, 1e6];
    const end: Vec3 = [1e6 + 5, 1e6 + 3, 1e6 + 2];
    for (const style of styles) {
      const { midA, midB } = computeControlPoints(start, end, style);
      expectFinite(midA, `${style} midA (large coords)`);
      expectFinite(midB, `${style} midB (large coords)`);
    }
  });

  it('all styles handle connections along pure Z axis', () => {
    const start: Vec3 = [0, 0, 0];
    const end: Vec3 = [0, 0, 10];
    for (const style of styles) {
      const { midA, midB } = computeControlPoints(start, end, style);
      expectFinite(midA, `${style} midA (pure Z)`);
      expectFinite(midB, `${style} midB (pure Z)`);
    }
  });
});

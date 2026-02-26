/**
 * NodeScreen Scaling & Node Dimension Integration Tests
 *
 * Tests the mathematical relationships between node dimensions and
 * derived visual properties:
 * 1. Screen width scaling: 185 * nodeW / DEFAULT_NODE_WIDTH (185px baseline with gap for resize handles)
 * 2. Screen maxHeight: nodeD * 110 (maps depth world units to CSS px at scale=0.3)
 * 3. 3D text maxWidth: nodeW - 0.12
 * 4. Port position spread: (nodeD - 0.2) range
 * 5. Dimension fallback pattern: width ?? DEFAULT_NODE_WIDTH
 * 6. hexToRgba color conversion
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  MAX_NODE_HEIGHT,
} from '../store/slices/nodeSlice';
import { getPortWorldPos } from '../utils/portPositions';
import { hexToRgba, ACCENT_HEX } from '../components/nodes/NodeScreen';

// ---------------------------------------------------------------------------
// Helper: replicate the screen width scaling formula from NodeScreen.tsx:597
// scaledWidth = nodeW != null ? Math.round(185 * nodeW / DEFAULT_NODE_WIDTH) : 185
// Uses 185px baseline (not 210) to leave a gap at corners for resize handles.
// ---------------------------------------------------------------------------
function computeScaledWidth(nodeW: number | null | undefined): number {
  return nodeW != null ? Math.round(185 * nodeW / DEFAULT_NODE_WIDTH) : 185;
}

// ---------------------------------------------------------------------------
// Helper: replicate the maxHeight formula from NodeScreen.tsx:600
// maxScreenH = nodeD != null ? Math.round(nodeD * 110) : Math.round(DEFAULT_NODE_HEIGHT * 110)
// Factor 110 keeps the screen within the node depth with gap for resize handles.
// ---------------------------------------------------------------------------
function computeMaxScreenH(nodeD: number | null | undefined): number {
  return nodeD != null ? Math.round(nodeD * 110) : Math.round(DEFAULT_NODE_HEIGHT * 110);
}

// ---------------------------------------------------------------------------
// Helper: replicate the 3D text maxWidth from NodeModule.tsx:375
// maxWidth = nodeW - 0.12
// ---------------------------------------------------------------------------
function computeTextMaxWidth(nodeW: number): number {
  return nodeW - 0.12;
}

// ---------------------------------------------------------------------------
// Helper: replicate port Z spread from NodeModule.tsx:168
// z = portCount <= 1 ? 0 : (portIndex / (portCount - 1) - 0.5) * (nodeD - 0.2)
// ---------------------------------------------------------------------------
function computePortZ(portIndex: number, portCount: number, nodeD: number): number {
  if (portCount <= 1) return 0;
  return (portIndex / (portCount - 1) - 0.5) * (nodeD - 0.2);
}

// ============================================================================
// 0. hexToRgba color conversion
// ============================================================================
describe('hexToRgba', () => {
  it('converts standard hex to rgba', () => {
    expect(hexToRgba('#2EC4B6', 1)).toBe('rgba(46, 196, 182, 1)');
  });

  it('applies alpha correctly', () => {
    expect(hexToRgba('#FF6B35', 0.5)).toBe('rgba(255, 107, 53, 0.5)');
  });

  it('handles zero alpha', () => {
    expect(hexToRgba('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
  });

  it('handles white', () => {
    expect(hexToRgba('#FFFFFF', 1)).toBe('rgba(255, 255, 255, 1)');
  });

  it('handles all accent colors in ACCENT_HEX map', () => {
    for (const [_key, hex] of Object.entries(ACCENT_HEX)) {
      const result = hexToRgba(hex, 0.4);
      expect(result).toMatch(/^rgba\(\d+, \d+, \d+, 0\.4\)$/);
    }
  });
});

// ============================================================================
// 1. Screen width scaling formula (185px baseline with resize handle gap)
// ============================================================================
describe('NodeScreen scaledWidth formula', () => {
  it('returns 185px for default node width (1.6)', () => {
    expect(computeScaledWidth(DEFAULT_NODE_WIDTH)).toBe(185);
  });

  it('returns 185px baseline when nodeW is null', () => {
    expect(computeScaledWidth(null)).toBe(185);
  });

  it('returns 185px baseline when nodeW is undefined', () => {
    expect(computeScaledWidth(undefined)).toBe(185);
  });

  it('scales linearly with node width', () => {
    // At width 3.2 (2x default), screen should be ~370px
    expect(computeScaledWidth(3.2)).toBe(370);
  });

  it('scales down for narrow nodes', () => {
    // MIN_NODE_WIDTH = 1.0
    const narrow = computeScaledWidth(MIN_NODE_WIDTH);
    expect(narrow).toBe(Math.round(185 * 1.0 / 1.6)); // 116
    expect(narrow).toBeLessThan(185);
  });

  it('scales up for wide nodes', () => {
    // MAX_NODE_WIDTH = 6.0
    const wide = computeScaledWidth(MAX_NODE_WIDTH);
    expect(wide).toBe(Math.round(185 * 6.0 / 1.6)); // 694
    expect(wide).toBeGreaterThan(185);
  });

  it('returns correct values for common node widths', () => {
    const cases: [number, number][] = [
      [1.0, Math.round(185 * 1.0 / 1.6)],
      [1.6, 185],
      [2.0, Math.round(185 * 2.0 / 1.6)],
      [3.0, Math.round(185 * 3.0 / 1.6)],
      [4.0, Math.round(185 * 4.0 / 1.6)],
      [6.0, Math.round(185 * 6.0 / 1.6)],
    ];
    for (const [nodeW, expected] of cases) {
      expect(computeScaledWidth(nodeW)).toBe(expected);
    }
  });

  it('always returns a positive integer', () => {
    for (let w = MIN_NODE_WIDTH; w <= MAX_NODE_WIDTH; w += 0.1) {
      const result = computeScaledWidth(w);
      expect(result).toBeGreaterThan(0);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it('is monotonically increasing with node width', () => {
    let prev = 0;
    for (let w = MIN_NODE_WIDTH; w <= MAX_NODE_WIDTH; w += 0.2) {
      const result = computeScaledWidth(w);
      expect(result).toBeGreaterThanOrEqual(prev);
      prev = result;
    }
  });
});

// ============================================================================
// 1b. Screen maxHeight formula (nodeD * 110)
// ============================================================================
describe('NodeScreen maxScreenH formula', () => {
  it('uses default height when nodeD is null', () => {
    expect(computeMaxScreenH(null)).toBe(Math.round(DEFAULT_NODE_HEIGHT * 110));
    // DEFAULT_NODE_HEIGHT = 0.8 → 0.8 * 110 = 88
    expect(computeMaxScreenH(null)).toBe(88);
  });

  it('uses default height when nodeD is undefined', () => {
    expect(computeMaxScreenH(undefined)).toBe(88);
  });

  it('computes correctly at default node depth (0.8)', () => {
    expect(computeMaxScreenH(DEFAULT_NODE_HEIGHT)).toBe(88);
  });

  it('scales linearly with node depth', () => {
    expect(computeMaxScreenH(1.6)).toBe(Math.round(1.6 * 110)); // 176
    expect(computeMaxScreenH(2.0)).toBe(220);
  });

  it('scales correctly at MIN_NODE_HEIGHT', () => {
    const expected = Math.round(MIN_NODE_HEIGHT * 110);
    expect(computeMaxScreenH(MIN_NODE_HEIGHT)).toBe(expected);
    // MIN_NODE_HEIGHT = 0.6 → 0.6 * 110 = 66
    expect(expected).toBe(66);
  });

  it('scales correctly at MAX_NODE_HEIGHT', () => {
    const expected = Math.round(MAX_NODE_HEIGHT * 110);
    expect(computeMaxScreenH(MAX_NODE_HEIGHT)).toBe(expected);
    // MAX_NODE_HEIGHT = 4.0 → 4.0 * 110 = 440
    expect(expected).toBe(440);
  });

  it('produces integer pixel values for all standard depths', () => {
    const depths = [MIN_NODE_HEIGHT, 0.8, 1.0, 1.5, 2.0, 3.0, MAX_NODE_HEIGHT];
    for (const d of depths) {
      const result = computeMaxScreenH(d);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it('increases monotonically with node depth', () => {
    let prev = computeMaxScreenH(MIN_NODE_HEIGHT);
    for (let d = MIN_NODE_HEIGHT + 0.2; d <= MAX_NODE_HEIGHT; d += 0.2) {
      const current = computeMaxScreenH(d);
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });

  it('small nodeD produces small maxHeight', () => {
    expect(computeMaxScreenH(MIN_NODE_HEIGHT)).toBeLessThan(computeMaxScreenH(DEFAULT_NODE_HEIGHT));
    expect(computeMaxScreenH(MIN_NODE_HEIGHT)).toBeGreaterThan(0);
  });
});

// ============================================================================
// 2. 3D text maxWidth calculation
// ============================================================================
describe('3D Text maxWidth calculation', () => {
  it('leaves 0.12 margin at default width', () => {
    const maxW = computeTextMaxWidth(DEFAULT_NODE_WIDTH);
    expect(maxW).toBeCloseTo(DEFAULT_NODE_WIDTH - 0.12, 5);
    expect(maxW).toBeCloseTo(1.48, 5);
  });

  it('scales with node width', () => {
    expect(computeTextMaxWidth(3.0)).toBeCloseTo(2.88, 5);
    expect(computeTextMaxWidth(6.0)).toBeCloseTo(5.88, 5);
  });

  it('is always positive for valid node widths', () => {
    // Even at MIN_NODE_WIDTH (1.0), maxWidth should be 0.88 > 0
    expect(computeTextMaxWidth(MIN_NODE_WIDTH)).toBeCloseTo(0.88, 5);
    expect(computeTextMaxWidth(MIN_NODE_WIDTH)).toBeGreaterThan(0);
  });

  it('is always less than node width (margin preserved)', () => {
    for (let w = MIN_NODE_WIDTH; w <= MAX_NODE_WIDTH; w += 0.5) {
      expect(computeTextMaxWidth(w)).toBeLessThan(w);
    }
  });

  it('margin is consistent (always 0.12 regardless of width)', () => {
    for (let w = MIN_NODE_WIDTH; w <= MAX_NODE_WIDTH; w += 0.5) {
      expect(w - computeTextMaxWidth(w)).toBeCloseTo(0.12, 5);
    }
  });
});

// ============================================================================
// 3. Port position spread with custom depths
// ============================================================================
describe('Port Z position spread with custom node depth', () => {
  it('single port is always centered (z=0) regardless of depth', () => {
    expect(computePortZ(0, 1, 0.8)).toBe(0);
    expect(computePortZ(0, 1, 2.0)).toBe(0);
    expect(computePortZ(0, 1, 4.0)).toBe(0);
  });

  it('two ports are symmetrically placed around center', () => {
    const nodeD = 2.0;
    const z0 = computePortZ(0, 2, nodeD);
    const z1 = computePortZ(1, 2, nodeD);
    expect(z0).toBeCloseTo(-z1, 5); // symmetric
    expect(z0).toBeLessThan(0); // first port is negative
    expect(z1).toBeGreaterThan(0); // second port is positive
  });

  it('spread increases with node depth', () => {
    const small = Math.abs(computePortZ(0, 2, DEFAULT_NODE_HEIGHT));
    const large = Math.abs(computePortZ(0, 2, 3.0));
    expect(large).toBeGreaterThan(small);
  });

  it('spread range is (nodeD - 0.2)', () => {
    const nodeD = 2.0;
    const z0 = computePortZ(0, 2, nodeD);
    const z1 = computePortZ(1, 2, nodeD);
    const range = z1 - z0;
    expect(range).toBeCloseTo(nodeD - 0.2, 5);
  });

  it('three ports: first at -half spread, middle at 0, last at +half spread', () => {
    const nodeD = 2.0;
    const spread = nodeD - 0.2;
    expect(computePortZ(0, 3, nodeD)).toBeCloseTo(-spread / 2, 5);
    expect(computePortZ(1, 3, nodeD)).toBeCloseTo(0, 5);
    expect(computePortZ(2, 3, nodeD)).toBeCloseTo(spread / 2, 5);
  });

  it('ports are evenly spaced', () => {
    const nodeD = 2.0;
    const z0 = computePortZ(0, 4, nodeD);
    const z1 = computePortZ(1, 4, nodeD);
    const z2 = computePortZ(2, 4, nodeD);
    const z3 = computePortZ(3, 4, nodeD);
    const gap01 = z1 - z0;
    const gap12 = z2 - z1;
    const gap23 = z3 - z2;
    expect(gap01).toBeCloseTo(gap12, 5);
    expect(gap12).toBeCloseTo(gap23, 5);
  });

  it('matches getPortWorldPos output for Z coordinate', () => {
    const nodePos: [number, number, number] = [5, 0, 3];
    const nodeD = 2.5;
    for (let i = 0; i < 3; i++) {
      const worldPos = getPortWorldPos(nodePos, 'input', i, 3, undefined, nodeD);
      const expectedZ = nodePos[2] + computePortZ(i, 3, nodeD);
      expect(worldPos[2]).toBeCloseTo(expectedZ, 5);
    }
  });
});

// ============================================================================
// 4. Port X position with custom widths
// ============================================================================
describe('Port X position with custom node width', () => {
  const nodePos: [number, number, number] = [0, 0, 0];

  it('output port X = nodePos.x + nodeW/2 + 0.05', () => {
    const nodeW = 3.0;
    const pos = getPortWorldPos(nodePos, 'output', 0, 1, nodeW);
    expect(pos[0]).toBeCloseTo(nodeW / 2 + 0.05, 5);
  });

  it('input port X = nodePos.x - nodeW/2 - 0.05', () => {
    const nodeW = 3.0;
    const pos = getPortWorldPos(nodePos, 'input', 0, 1, nodeW);
    expect(pos[0]).toBeCloseTo(-nodeW / 2 - 0.05, 5);
  });

  it('port protrusion (0.05) is constant regardless of width', () => {
    for (const w of [1.0, 2.0, 4.0, 6.0]) {
      const outPos = getPortWorldPos(nodePos, 'output', 0, 1, w);
      expect(outPos[0] - w / 2).toBeCloseTo(0.05, 5);

      const inPos = getPortWorldPos(nodePos, 'input', 0, 1, w);
      expect(Math.abs(inPos[0]) - w / 2).toBeCloseTo(0.05, 5);
    }
  });

  it('wider nodes have ports further apart', () => {
    const narrowOut = getPortWorldPos(nodePos, 'output', 0, 1, 1.0);
    const wideOut = getPortWorldPos(nodePos, 'output', 0, 1, 4.0);
    expect(wideOut[0]).toBeGreaterThan(narrowOut[0]);
  });

  it('default width produces same result as explicit DEFAULT_NODE_WIDTH', () => {
    const defaultPos = getPortWorldPos(nodePos, 'output', 0, 1);
    const explicitPos = getPortWorldPos(nodePos, 'output', 0, 1, DEFAULT_NODE_WIDTH);
    expect(defaultPos[0]).toBeCloseTo(explicitPos[0], 5);
    expect(defaultPos[1]).toBeCloseTo(explicitPos[1], 5);
    expect(defaultPos[2]).toBeCloseTo(explicitPos[2], 5);
  });
});

// ============================================================================
// 5. Dimension fallback pattern
// ============================================================================
describe('Dimension fallback pattern', () => {
  it('undefined width falls back to DEFAULT_NODE_WIDTH', () => {
    const nodeWidth: number | undefined = undefined;
    expect(nodeWidth ?? DEFAULT_NODE_WIDTH).toBe(DEFAULT_NODE_WIDTH);
    expect(nodeWidth ?? DEFAULT_NODE_WIDTH).toBe(1.6);
  });

  it('undefined height falls back to DEFAULT_NODE_HEIGHT', () => {
    const nodeHeight: number | undefined = undefined;
    expect(nodeHeight ?? DEFAULT_NODE_HEIGHT).toBe(DEFAULT_NODE_HEIGHT);
    expect(nodeHeight ?? DEFAULT_NODE_HEIGHT).toBe(0.8);
  });

  it('explicit width overrides default', () => {
    const nodeWidth: number | undefined = 3.0;
    expect(nodeWidth ?? DEFAULT_NODE_WIDTH).toBe(3.0);
  });

  it('explicit height overrides default', () => {
    const nodeHeight: number | undefined = 2.0;
    expect(nodeHeight ?? DEFAULT_NODE_HEIGHT).toBe(2.0);
  });

  it('zero width does NOT fall back (0 is not nullish)', () => {
    // This is a subtle JS behavior test — 0 ?? default = 0 (not default)
    // In practice MIN_NODE_WIDTH prevents 0 from being set, but the pattern is correct
    const nodeWidth: number | undefined = 0;
    expect(nodeWidth ?? DEFAULT_NODE_WIDTH).toBe(0);
  });

  it('NaN width does NOT fall back (NaN is not nullish)', () => {
    // NaN ?? default = NaN — clamping guards against this in resizeNode
    const nodeWidth: number | undefined = NaN;
    expect(nodeWidth ?? DEFAULT_NODE_WIDTH).toBe(NaN);
  });
});

// ============================================================================
// 6. Constants relationship integrity
// ============================================================================
describe('Node dimension constants integrity', () => {
  it('screen base width (185px) at default node width produces readable text', () => {
    // At default 1.6 width, screen is 185px — wide enough for ~23 monospace chars at 8px
    const charsPerLine = Math.floor(185 / 8);
    expect(charsPerLine).toBeGreaterThanOrEqual(20);
  });

  it('minimum node width still produces usable screen width', () => {
    const minScreenWidth = computeScaledWidth(MIN_NODE_WIDTH);
    // Should be at least 100px to be readable
    expect(minScreenWidth).toBeGreaterThanOrEqual(100);
  });

  it('maximum node width does not produce excessively wide screen', () => {
    const maxScreenWidth = computeScaledWidth(MAX_NODE_WIDTH);
    // Should be under 1000px (reasonable for a node in 3D space)
    expect(maxScreenWidth).toBeLessThanOrEqual(1000);
  });

  it('minimum node depth produces viable maxHeight', () => {
    const minScreenH = computeMaxScreenH(MIN_NODE_HEIGHT);
    // Should be at least 50px to show at least one field row
    expect(minScreenH).toBeGreaterThanOrEqual(50);
  });

  it('maximum node depth does not produce excessively tall screen', () => {
    const maxScreenH = computeMaxScreenH(MAX_NODE_HEIGHT);
    // Should be under 500px (reasonable)
    expect(maxScreenH).toBeLessThanOrEqual(500);
  });

  it('text maxWidth is always positive for valid widths', () => {
    expect(computeTextMaxWidth(MIN_NODE_WIDTH)).toBeGreaterThan(0);
  });

  it('port spread is non-negative for valid heights', () => {
    // Even at MIN_NODE_HEIGHT (0.6), spread = 0.6 - 0.2 = 0.4 > 0
    const minSpread = MIN_NODE_HEIGHT - 0.2;
    expect(minSpread).toBeGreaterThan(0);
  });
});

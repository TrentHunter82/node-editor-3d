import { describe, it, expect } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { executeGraph } from '../utils/execution';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection, NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: NodeType,
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {},
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((p, i) => ({ id: `${id}-in-${i}`, label: p.label, portType: p.portType })),
    outputs: config.outputs.map((p, i) => ({ id: `${id}-out-${i}`, label: p.label, portType: p.portType })),
    ...overrides,
  };
}

function makeConn(
  id: string,
  src: string,
  srcPort: number,
  tgt: string,
  tgtPort: number,
): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

function exec(nodes: Record<string, EditorNode>, connections: Record<string, Connection> = {}) {
  return executeGraph(nodes, connections);
}

/**
 * Execute a single node with optional connected inputs fed via source nodes.
 * Returns the NodeResult for the target node.
 */
function execSingle(type: NodeType, data: Record<string, unknown>, inputs?: Record<number, unknown>) {
  const node = makeNode('n', type, data);
  const nodes: Record<string, EditorNode> = { n: node };
  const connections: Record<string, Connection> = {};

  if (inputs) {
    for (const [portIdx, value] of Object.entries(inputs)) {
      const srcId = `src-${portIdx}`;
      const srcNode = makeNode(srcId, 'source', { value });
      nodes[srcId] = srcNode;
      connections[`c-${portIdx}`] = makeConn(`c-${portIdx}`, srcId, 0, 'n', Number(portIdx));
    }
  }

  const result = exec(nodes, connections);
  return result.results.get('n');
}

// ===========================================================================
// Live Data & Color Node Processor Tests
// ===========================================================================

describe('color-picker processor', () => {
  it('defaults to #000000 and r=0, g=0, b=0 when no color is set', () => {
    const r = execSingle('color-picker', {});
    expect(r).toBeDefined();
    expect(r!.outputs[0]).toBe('#000000');
    expect(r!.outputs[1]).toBe(0);
    expect(r!.outputs[2]).toBe(0);
    expect(r!.outputs[3]).toBe(0);
  });

  it('parses red #ff0000 correctly', () => {
    const r = execSingle('color-picker', { color: '#ff0000' });
    expect(r!.outputs[0]).toBe('#ff0000');
    expect(r!.outputs[1]).toBe(255);
    expect(r!.outputs[2]).toBe(0);
    expect(r!.outputs[3]).toBe(0);
  });

  it('parses green #00ff00 correctly', () => {
    const r = execSingle('color-picker', { color: '#00ff00' });
    expect(r!.outputs[0]).toBe('#00ff00');
    expect(r!.outputs[1]).toBe(0);
    expect(r!.outputs[2]).toBe(255);
    expect(r!.outputs[3]).toBe(0);
  });

  it('parses blue #0000ff correctly', () => {
    const r = execSingle('color-picker', { color: '#0000ff' });
    expect(r!.outputs[0]).toBe('#0000ff');
    expect(r!.outputs[1]).toBe(0);
    expect(r!.outputs[2]).toBe(0);
    expect(r!.outputs[3]).toBe(255);
  });

  it('parses white #ffffff correctly', () => {
    const r = execSingle('color-picker', { color: '#ffffff' });
    expect(r!.outputs[0]).toBe('#ffffff');
    expect(r!.outputs[1]).toBe(255);
    expect(r!.outputs[2]).toBe(255);
    expect(r!.outputs[3]).toBe(255);
  });

  it('expands 3-char shorthand hex #f00 to correct RGB', () => {
    const r = execSingle('color-picker', { color: '#f00' });
    // Output 0 is the original hex string, not expanded
    expect(r!.outputs[0]).toBe('#f00');
    // But RGB values should be parsed from the expanded form
    expect(r!.outputs[1]).toBe(255);
    expect(r!.outputs[2]).toBe(0);
    expect(r!.outputs[3]).toBe(0);
  });

  it('defaults to 0,0,0 for invalid hex string', () => {
    const r = execSingle('color-picker', { color: 'notahex' });
    expect(r!.outputs[1]).toBe(0);
    expect(r!.outputs[2]).toBe(0);
    expect(r!.outputs[3]).toBe(0);
  });
});

describe('color-mix processor', () => {
  it('mixes black and white at t=0.5 to approximately gray #808080', () => {
    const r = execSingle('color-mix', {}, { 0: '#000000', 1: '#ffffff', 2: 0.5 });
    const hex = (r!.outputs[0] as string).toLowerCase();
    // Math.round(0 + 255 * 0.5) = 128 = 0x80
    expect(hex).toBe('#808080');
  });

  it('returns first color at t=0', () => {
    const r = execSingle('color-mix', {}, { 0: '#ff0000', 1: '#0000ff', 2: 0 });
    const hex = (r!.outputs[0] as string).toLowerCase();
    expect(hex).toBe('#ff0000');
  });

  it('returns second color at t=1', () => {
    const r = execSingle('color-mix', {}, { 0: '#ff0000', 1: '#0000ff', 2: 1 });
    const hex = (r!.outputs[0] as string).toLowerCase();
    expect(hex).toBe('#0000ff');
  });

  it('clamps t values: t>1 treated as 1, t<0 treated as 0', () => {
    const rOver = execSingle('color-mix', {}, { 0: '#ff0000', 1: '#0000ff', 2: 5 });
    expect((rOver!.outputs[0] as string).toLowerCase()).toBe('#0000ff');

    const rUnder = execSingle('color-mix', {}, { 0: '#ff0000', 1: '#0000ff', 2: -3 });
    expect((rUnder!.outputs[0] as string).toLowerCase()).toBe('#ff0000');
  });

  it('uses default colors when inputs are missing (black + white at t=0.5)', () => {
    // No color inputs connected — defaults to '#000000' and '#ffffff'
    const r = execSingle('color-mix', {});
    // With no connected inputs, color1 defaults to '#000000', color2 to '#ffffff',
    // and t defaults to 0.5 (from defaultValue in config)
    const hex = (r!.outputs[0] as string).toLowerCase();
    expect(hex).toBe('#808080');
  });

  it('handles shorthand hex inputs', () => {
    const r = execSingle('color-mix', {}, { 0: '#f00', 1: '#00f', 2: 0 });
    const hex = (r!.outputs[0] as string).toLowerCase();
    expect(hex).toBe('#ff0000');
  });
});

describe('hsl-to-rgb processor', () => {
  it('converts pure red: h=0, s=100, l=50', () => {
    const r = execSingle('hsl-to-rgb', {}, { 0: 0, 1: 100, 2: 50 });
    expect(r!.outputs[1]).toBe(255); // r
    expect(r!.outputs[2]).toBe(0);   // g
    expect(r!.outputs[3]).toBe(0);   // b
  });

  it('converts pure green: h=120, s=100, l=50', () => {
    const r = execSingle('hsl-to-rgb', {}, { 0: 120, 1: 100, 2: 50 });
    expect(r!.outputs[1]).toBe(0);   // r
    expect(r!.outputs[2]).toBe(255); // g
    expect(r!.outputs[3]).toBe(0);   // b
  });

  it('converts pure blue: h=240, s=100, l=50', () => {
    const r = execSingle('hsl-to-rgb', {}, { 0: 240, 1: 100, 2: 50 });
    expect(r!.outputs[1]).toBe(0);   // r
    expect(r!.outputs[2]).toBe(0);   // g
    expect(r!.outputs[3]).toBe(255); // b
  });

  it('converts white: h=0, s=0, l=100', () => {
    const r = execSingle('hsl-to-rgb', {}, { 0: 0, 1: 0, 2: 100 });
    expect(r!.outputs[1]).toBe(255); // r
    expect(r!.outputs[2]).toBe(255); // g
    expect(r!.outputs[3]).toBe(255); // b
  });

  it('converts black: h=0, s=0, l=0', () => {
    const r = execSingle('hsl-to-rgb', {}, { 0: 0, 1: 0, 2: 0 });
    expect(r!.outputs[1]).toBe(0);
    expect(r!.outputs[2]).toBe(0);
    expect(r!.outputs[3]).toBe(0);
  });

  it('wraps hue values: h=720 produces same result as h=0', () => {
    const r0 = execSingle('hsl-to-rgb', {}, { 0: 0, 1: 100, 2: 50 });
    const r720 = execSingle('hsl-to-rgb', {}, { 0: 720, 1: 100, 2: 50 });
    expect(r720!.outputs[1]).toBe(r0!.outputs[1]);
    expect(r720!.outputs[2]).toBe(r0!.outputs[2]);
    expect(r720!.outputs[3]).toBe(r0!.outputs[3]);
  });

  it('returns a hex string output with default inputs (h=0, s=100, l=50 → red)', () => {
    const r = execSingle('hsl-to-rgb', {}, { 0: 0, 1: 100, 2: 50 });
    const hex = (r!.outputs[0] as string).toLowerCase();
    expect(hex).toBe('#ff0000');
    expect(typeof hex).toBe('string');
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('rgb-to-hsl processor', () => {
  it('converts pure red: r=255, g=0, b=0 → h=0, s=100, l=50', () => {
    const r = execSingle('rgb-to-hsl', {}, { 0: 255, 1: 0, 2: 0 });
    expect(r!.outputs[0]).toBe(0);   // h
    expect(r!.outputs[1]).toBe(100); // s
    expect(r!.outputs[2]).toBe(50);  // l
  });

  it('converts pure green: r=0, g=255, b=0 → h=120, s=100, l=50', () => {
    const r = execSingle('rgb-to-hsl', {}, { 0: 0, 1: 255, 2: 0 });
    expect(r!.outputs[0]).toBe(120); // h
    expect(r!.outputs[1]).toBe(100); // s
    expect(r!.outputs[2]).toBe(50);  // l
  });

  it('converts pure blue: r=0, g=0, b=255 → h=240, s=100, l=50', () => {
    const r = execSingle('rgb-to-hsl', {}, { 0: 0, 1: 0, 2: 255 });
    expect(r!.outputs[0]).toBe(240); // h
    expect(r!.outputs[1]).toBe(100); // s
    expect(r!.outputs[2]).toBe(50);  // l
  });

  it('converts white: r=255, g=255, b=255 → h=0, s=0, l=100', () => {
    const r = execSingle('rgb-to-hsl', {}, { 0: 255, 1: 255, 2: 255 });
    expect(r!.outputs[0]).toBe(0);   // h
    expect(r!.outputs[1]).toBe(0);   // s
    expect(r!.outputs[2]).toBe(100); // l
  });

  it('converts gray: r=128, g=128, b=128 → h=0, s=0, l≈50', () => {
    const r = execSingle('rgb-to-hsl', {}, { 0: 128, 1: 128, 2: 128 });
    expect(r!.outputs[0]).toBe(0); // h (achromatic)
    expect(r!.outputs[1]).toBe(0); // s (achromatic)
    // 128/255 ≈ 0.502, Math.round(50.2) = 50
    expect(r!.outputs[2]).toBeCloseTo(50, 0);
  });

  it('clamps input values: >255 treated as 255, <0 treated as 0', () => {
    // r=300 → clamped to 255, g=-10 → clamped to 0, b=0 → stays 0
    // Effectively (255, 0, 0) → pure red
    const r = execSingle('rgb-to-hsl', {}, { 0: 300, 1: -10, 2: 0 });
    expect(r!.outputs[0]).toBe(0);   // h
    expect(r!.outputs[1]).toBe(100); // s
    expect(r!.outputs[2]).toBe(50);  // l
  });
});

describe('HSL ↔ RGB roundtrip', () => {
  it('red roundtrip: rgb→hsl→rgb returns (255, 0, 0)', () => {
    // Step 1: RGB → HSL
    const hslResult = execSingle('rgb-to-hsl', {}, { 0: 255, 1: 0, 2: 0 });
    const h = hslResult!.outputs[0] as number;
    const s = hslResult!.outputs[1] as number;
    const l = hslResult!.outputs[2] as number;

    // Step 2: HSL → RGB
    const rgbResult = execSingle('hsl-to-rgb', {}, { 0: h, 1: s, 2: l });
    expect(rgbResult!.outputs[1]).toBe(255); // r
    expect(rgbResult!.outputs[2]).toBe(0);   // g
    expect(rgbResult!.outputs[3]).toBe(0);   // b
  });

  it('pure green roundtrip: rgb→hsl→rgb returns (0, 255, 0)', () => {
    const hslResult = execSingle('rgb-to-hsl', {}, { 0: 0, 1: 255, 2: 0 });
    const h = hslResult!.outputs[0] as number;
    const s = hslResult!.outputs[1] as number;
    const l = hslResult!.outputs[2] as number;

    const rgbResult = execSingle('hsl-to-rgb', {}, { 0: h, 1: s, 2: l });
    expect(rgbResult!.outputs[1]).toBe(0);   // r
    expect(rgbResult!.outputs[2]).toBe(255); // g
    expect(rgbResult!.outputs[3]).toBe(0);   // b
  });

  it('arbitrary color roundtrip: rgb(100,150,200)→hsl→rgb ≈ (100,150,200)', () => {
    const hslResult = execSingle('rgb-to-hsl', {}, { 0: 100, 1: 150, 2: 200 });
    const h = hslResult!.outputs[0] as number;
    const s = hslResult!.outputs[1] as number;
    const l = hslResult!.outputs[2] as number;

    const rgbResult = execSingle('hsl-to-rgb', {}, { 0: h, 1: s, 2: l });
    // Allow ±1 tolerance for rounding through two integer conversions
    const rOut = rgbResult!.outputs[1] as number;
    const gOut = rgbResult!.outputs[2] as number;
    const bOut = rgbResult!.outputs[3] as number;
    expect(Math.abs(rOut - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(gOut - 150)).toBeLessThanOrEqual(1);
    expect(Math.abs(bOut - 200)).toBeLessThanOrEqual(1);
  });
});

describe('timer processor', () => {
  it('output is within range [0, 1000) with default intervalMs=1000', () => {
    const r = execSingle('timer', {});
    const tick = r!.outputs[0] as number;
    expect(tick).toBeGreaterThanOrEqual(0);
    expect(tick).toBeLessThan(1000);
  });

  it('output is within range [0, 100) with custom intervalMs=100', () => {
    const r = execSingle('timer', { intervalMs: 100 });
    const tick = r!.outputs[0] as number;
    expect(tick).toBeGreaterThanOrEqual(0);
    expect(tick).toBeLessThan(100);
  });

  it('defaults to intervalMs=1000 when value is missing or invalid', () => {
    // Missing
    const r1 = execSingle('timer', {});
    const tick1 = r1!.outputs[0] as number;
    expect(tick1).toBeGreaterThanOrEqual(0);
    expect(tick1).toBeLessThan(1000);

    // Invalid (string)
    const r2 = execSingle('timer', { intervalMs: 'bad' });
    const tick2 = r2!.outputs[0] as number;
    expect(tick2).toBeGreaterThanOrEqual(0);
    expect(tick2).toBeLessThan(1000);

    // Invalid (zero → clamped to 1)
    const r3 = execSingle('timer', { intervalMs: 0 });
    const tick3 = r3!.outputs[0] as number;
    expect(tick3).toBeGreaterThanOrEqual(0);
    expect(tick3).toBeLessThan(1); // intervalMs clamped to 1, so Date.now() % 1 is always 0
  });
});

describe('http-fetch processor', () => {
  it('returns cached data when _fetchResult, _fetchStatus, _fetchError are set', () => {
    const r = execSingle('http-fetch', {
      _fetchResult: { message: 'hello' },
      _fetchStatus: 200,
      _fetchError: '',
    }, { 0: 'https://example.com', 1: true });

    expect(r!.outputs[0]).toEqual({ message: 'hello' });
    expect(r!.outputs[1]).toBe(200);
    expect(r!.outputs[2]).toBe('');
  });

  it('returns empty state when URL is missing (not stale cache)', () => {
    const r = execSingle('http-fetch', {
      _fetchResult: { cached: true },
      _fetchStatus: 200,
      _fetchError: '',
    });
    // No URL input → returns empty state, not stale cache from a previous URL
    expect(r!.outputs[0]).toBeNull();
    expect(r!.outputs[1]).toBe(0);
    expect(r!.outputs[2]).toBe('');
  });

  it('returns cached data when trigger is missing', () => {
    const r = execSingle('http-fetch', {
      _fetchResult: 'data',
      _fetchStatus: 200,
      _fetchError: '',
    }, { 0: 'https://example.com' });
    // URL provided but no trigger → returns cached data
    expect(r!.outputs[0]).toBe('data');
    expect(r!.outputs[1]).toBe(200);
  });

  it('still returns cached data even when URL and trigger are both provided', () => {
    // The processor always returns cached data; actual fetch is handled externally
    const r = execSingle('http-fetch', {
      _fetchResult: 'cached-response',
      _fetchStatus: 201,
      _fetchError: '',
    }, { 0: 'https://api.example.com/data', 1: 1 });

    expect(r!.outputs[0]).toBe('cached-response');
    expect(r!.outputs[1]).toBe(201);
    expect(r!.outputs[2]).toBe('');
  });

  it('returns defaults (null, 0, empty string) when no cached data exists', () => {
    const r = execSingle('http-fetch', {});
    expect(r!.outputs[0]).toBeNull();
    expect(r!.outputs[1]).toBe(0);
    expect(r!.outputs[2]).toBe('');
  });

  it('ignores non-string url input and returns cached data', () => {
    const r = execSingle('http-fetch', {
      _fetchResult: null,
      _fetchStatus: 0,
      _fetchError: '',
    }, { 0: 12345, 1: true });
    // url is not a string → treated as empty → returns cached defaults
    expect(r!.outputs[0]).toBeNull();
    expect(r!.outputs[1]).toBe(0);
    expect(r!.outputs[2]).toBe('');
  });
});

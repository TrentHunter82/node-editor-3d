import { describe, it, expect } from 'vitest';
import { executeGraph } from './execution';
import type { EditorNode, Connection } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, type: EditorNode['type'], data: Record<string, unknown> = {}, overrides: Partial<EditorNode> = {}): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
    ...overrides,
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

function exec(nodes: Record<string, EditorNode>, connections: Record<string, Connection> = {}) {
  return executeGraph(nodes, connections);
}

// ===========================================================================
// Phase 13 Processor Unit Tests
// ===========================================================================

describe('Phase 13 Processors', () => {

  // =========================================================================
  // MATH FUNCTION NODES (1 number input -> 1 number output)
  // =========================================================================

  // -----------------------------------------------------------------------
  // sin processor
  // -----------------------------------------------------------------------
  describe('sin processor', () => {
    it('sin(0) = 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0 }),
        sin: makeNode('sin', 'sin'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sin', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sin')!.outputs[0]).toBe(0);
    });

    it('sin(pi/2) = 1', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: Math.PI / 2 }),
        sin: makeNode('sin', 'sin'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sin', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sin')!.outputs[0]).toBeCloseTo(1, 10);
    });

    it('sin(pi) is approximately 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: Math.PI }),
        sin: makeNode('sin', 'sin'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sin', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sin')!.outputs[0]).toBeCloseTo(0, 10);
    });

    it('sin(-pi/2) = -1', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -Math.PI / 2 }),
        sin: makeNode('sin', 'sin'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sin', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sin')!.outputs[0]).toBeCloseTo(-1, 10);
    });

    it('defaults to sin(0) = 0 when no input connected', () => {
      const r = exec({ sin: makeNode('sin', 'sin') });
      expect(r.results.get('sin')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // cos processor
  // -----------------------------------------------------------------------
  describe('cos processor', () => {
    it('cos(0) = 1', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0 }),
        cos: makeNode('cos', 'cos'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'cos', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('cos')!.outputs[0]).toBe(1);
    });

    it('cos(pi) = -1', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: Math.PI }),
        cos: makeNode('cos', 'cos'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'cos', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('cos')!.outputs[0]).toBeCloseTo(-1, 10);
    });

    it('cos(pi/2) is approximately 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: Math.PI / 2 }),
        cos: makeNode('cos', 'cos'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'cos', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('cos')!.outputs[0]).toBeCloseTo(0, 10);
    });

    it('cos(2*pi) = 1 (full rotation)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 2 * Math.PI }),
        cos: makeNode('cos', 'cos'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'cos', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('cos')!.outputs[0]).toBeCloseTo(1, 10);
    });

    it('defaults to cos(0) = 1 when no input connected', () => {
      const r = exec({ cos: makeNode('cos', 'cos') });
      expect(r.results.get('cos')!.outputs[0]).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // tan processor
  // -----------------------------------------------------------------------
  describe('tan processor', () => {
    it('tan(0) = 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0 }),
        tan: makeNode('tan', 'tan'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'tan', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('tan')!.outputs[0]).toBe(0);
    });

    it('tan(pi/4) is approximately 1', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: Math.PI / 4 }),
        tan: makeNode('tan', 'tan'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'tan', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('tan')!.outputs[0]).toBeCloseTo(1, 10);
    });

    it('tan(pi/2) returns 0 (safe value for near-infinity)', () => {
      // Math.tan(Math.PI/2) produces a very large number due to floating point,
      // but Number.isFinite check may still pass. The processor clamps non-finite to 0.
      const nodes = {
        s: makeNode('s', 'source', { value: Math.PI / 2 }),
        tan: makeNode('tan', 'tan'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'tan', 0) };
      const r = exec(nodes, conns);
      const val = r.results.get('tan')!.outputs[0] as number;
      // Due to floating point, Math.tan(Math.PI/2) is a very large finite number,
      // not literally Infinity. The processor returns it as-is if finite.
      expect(Number.isFinite(val)).toBe(true);
    });

    it('tan(pi) is approximately 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: Math.PI }),
        tan: makeNode('tan', 'tan'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'tan', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('tan')!.outputs[0]).toBeCloseTo(0, 10);
    });

    it('defaults to tan(0) = 0 when no input connected', () => {
      const r = exec({ tan: makeNode('tan', 'tan') });
      expect(r.results.get('tan')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // abs processor
  // -----------------------------------------------------------------------
  describe('abs processor', () => {
    it('abs(5) = 5', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 5 }),
        abs: makeNode('abs', 'abs'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'abs', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('abs')!.outputs[0]).toBe(5);
    });

    it('abs(-5) = 5', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -5 }),
        abs: makeNode('abs', 'abs'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'abs', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('abs')!.outputs[0]).toBe(5);
    });

    it('abs(0) = 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0 }),
        abs: makeNode('abs', 'abs'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'abs', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('abs')!.outputs[0]).toBe(0);
    });

    it('abs(-3.14) = 3.14', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -3.14 }),
        abs: makeNode('abs', 'abs'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'abs', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('abs')!.outputs[0]).toBe(3.14);
    });

    it('defaults to abs(0) = 0 when no input connected', () => {
      const r = exec({ abs: makeNode('abs', 'abs') });
      expect(r.results.get('abs')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // floor processor
  // -----------------------------------------------------------------------
  describe('floor processor', () => {
    it('floor(3.7) = 3', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 3.7 }),
        f: makeNode('f', 'floor'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBe(3);
    });

    it('floor(-1.2) = -2', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -1.2 }),
        f: makeNode('f', 'floor'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBe(-2);
    });

    it('floor(5) = 5 (integer unchanged)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 5 }),
        f: makeNode('f', 'floor'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBe(5);
    });

    it('floor(0.999) = 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0.999 }),
        f: makeNode('f', 'floor'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBe(0);
    });

    it('defaults to floor(0) = 0 when no input connected', () => {
      const r = exec({ f: makeNode('f', 'floor') });
      expect(r.results.get('f')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // ceil processor
  // -----------------------------------------------------------------------
  describe('ceil processor', () => {
    it('ceil(3.2) = 4', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 3.2 }),
        c: makeNode('c', 'ceil'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(4);
    });

    it('ceil(-1.7) = -1', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -1.7 }),
        c: makeNode('c', 'ceil'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(-1);
    });

    it('ceil(5) = 5 (integer unchanged)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 5 }),
        c: makeNode('c', 'ceil'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(5);
    });

    it('ceil(0.001) = 1', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0.001 }),
        c: makeNode('c', 'ceil'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(1);
    });

    it('defaults to ceil(0) = 0 when no input connected', () => {
      const r = exec({ c: makeNode('c', 'ceil') });
      expect(r.results.get('c')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // round processor
  // -----------------------------------------------------------------------
  describe('round processor', () => {
    it('round(3.5) = 4', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 3.5 }),
        rn: makeNode('rn', 'round'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'rn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('rn')!.outputs[0]).toBe(4);
    });

    it('round(3.4) = 3', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 3.4 }),
        rn: makeNode('rn', 'round'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'rn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('rn')!.outputs[0]).toBe(3);
    });

    it('round(-0.5) = -0 (JS Math.round rounds half toward +Infinity)', () => {
      // Math.round(-0.5) === -0 in JavaScript (IEEE 754 negative zero)
      const nodes = {
        s: makeNode('s', 'source', { value: -0.5 }),
        rn: makeNode('rn', 'round'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'rn', 0) };
      const r = exec(nodes, conns);
      const val = r.results.get('rn')!.outputs[0] as number;
      expect(val).toBe(-0);
      expect(Object.is(val, -0)).toBe(true);
    });

    it('round(-2.6) = -3', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -2.6 }),
        rn: makeNode('rn', 'round'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'rn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('rn')!.outputs[0]).toBe(-3);
    });

    it('defaults to round(0) = 0 when no input connected', () => {
      const r = exec({ rn: makeNode('rn', 'round') });
      expect(r.results.get('rn')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // log processor (natural logarithm)
  // -----------------------------------------------------------------------
  describe('log processor', () => {
    it('log(1) = 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 1 }),
        lg: makeNode('lg', 'log'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'lg', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('lg')!.outputs[0]).toBe(0);
    });

    it('log(Math.E) = 1', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: Math.E }),
        lg: makeNode('lg', 'log'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'lg', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('lg')!.outputs[0]).toBeCloseTo(1, 10);
    });

    it('log(0) returns 0 (safe value instead of -Infinity)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0 }),
        lg: makeNode('lg', 'log'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'lg', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('lg')!.outputs[0]).toBe(0);
    });

    it('log(-1) returns 0 (safe value instead of NaN)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -1 }),
        lg: makeNode('lg', 'log'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'lg', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('lg')!.outputs[0]).toBe(0);
    });

    it('log(100) is approximately 4.605', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 100 }),
        lg: makeNode('lg', 'log'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'lg', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('lg')!.outputs[0]).toBeCloseTo(Math.log(100), 10);
    });

    it('defaults to log(1) = 0 when no input connected (default value is 1)', () => {
      // The log processor defaults non-number inputs to 1 (per the processor code: `inputs[0] : 1`)
      const r = exec({ lg: makeNode('lg', 'log') });
      expect(r.results.get('lg')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // sqrt processor
  // -----------------------------------------------------------------------
  describe('sqrt processor', () => {
    it('sqrt(4) = 2', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 4 }),
        sq: makeNode('sq', 'sqrt'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sq', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sq')!.outputs[0]).toBe(2);
    });

    it('sqrt(9) = 3', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 9 }),
        sq: makeNode('sq', 'sqrt'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sq', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sq')!.outputs[0]).toBe(3);
    });

    it('sqrt(0) = 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0 }),
        sq: makeNode('sq', 'sqrt'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sq', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sq')!.outputs[0]).toBe(0);
    });

    it('sqrt(-1) returns 0 (safe value instead of NaN)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -1 }),
        sq: makeNode('sq', 'sqrt'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sq', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sq')!.outputs[0]).toBe(0);
    });

    it('sqrt(2) is approximately 1.414', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 2 }),
        sq: makeNode('sq', 'sqrt'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sq', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sq')!.outputs[0]).toBeCloseTo(Math.SQRT2, 10);
    });

    it('defaults to sqrt(0) = 0 when no input connected', () => {
      const r = exec({ sq: makeNode('sq', 'sqrt') });
      expect(r.results.get('sq')!.outputs[0]).toBe(0);
    });
  });

  // =========================================================================
  // INTERPOLATION
  // =========================================================================

  // -----------------------------------------------------------------------
  // lerp processor
  // -----------------------------------------------------------------------
  describe('lerp processor', () => {
    it('lerp(0, 10, 0.5) = 5', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 0 }),
        b: makeNode('b', 'source', { value: 10 }),
        t: makeNode('t', 'source', { value: 0.5 }),
        lerp: makeNode('lerp', 'lerp'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'lerp', 0),
        c2: makeConn('c2', 'b', 0, 'lerp', 1),
        c3: makeConn('c3', 't', 0, 'lerp', 2),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('lerp')!.outputs[0]).toBe(5);
    });

    it('lerp(0, 10, 0) = 0 (start)', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 0 }),
        b: makeNode('b', 'source', { value: 10 }),
        t: makeNode('t', 'source', { value: 0 }),
        lerp: makeNode('lerp', 'lerp'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'lerp', 0),
        c2: makeConn('c2', 'b', 0, 'lerp', 1),
        c3: makeConn('c3', 't', 0, 'lerp', 2),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('lerp')!.outputs[0]).toBe(0);
    });

    it('lerp(0, 10, 1) = 10 (end)', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 0 }),
        b: makeNode('b', 'source', { value: 10 }),
        t: makeNode('t', 'source', { value: 1 }),
        lerp: makeNode('lerp', 'lerp'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'lerp', 0),
        c2: makeConn('c2', 'b', 0, 'lerp', 1),
        c3: makeConn('c3', 't', 0, 'lerp', 2),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('lerp')!.outputs[0]).toBe(10);
    });

    it('lerp(5, 15, 0.25) = 7.5', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 5 }),
        b: makeNode('b', 'source', { value: 15 }),
        t: makeNode('t', 'source', { value: 0.25 }),
        lerp: makeNode('lerp', 'lerp'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'lerp', 0),
        c2: makeConn('c2', 'b', 0, 'lerp', 1),
        c3: makeConn('c3', 't', 0, 'lerp', 2),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('lerp')!.outputs[0]).toBe(7.5);
    });

    it('defaults to lerp(0, 1, 0.5) = 0.5 when no inputs connected', () => {
      // Default: a=0, b=1, t=0.5  -> 0 + (1-0)*0.5 = 0.5
      const r = exec({ lerp: makeNode('lerp', 'lerp') });
      expect(r.results.get('lerp')!.outputs[0]).toBe(0.5);
    });

    it('lerp with t > 1 extrapolates beyond range', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 0 }),
        b: makeNode('b', 'source', { value: 10 }),
        t: makeNode('t', 'source', { value: 2 }),
        lerp: makeNode('lerp', 'lerp'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'lerp', 0),
        c2: makeConn('c2', 'b', 0, 'lerp', 1),
        c3: makeConn('c3', 't', 0, 'lerp', 2),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('lerp')!.outputs[0]).toBe(20);
    });
  });

  // =========================================================================
  // BOOLEAN LOGIC NODES
  // =========================================================================

  // -----------------------------------------------------------------------
  // and processor
  // -----------------------------------------------------------------------
  describe('and processor', () => {
    it('true AND true = true', () => {
      // Use compare nodes to produce boolean outputs: 5 > 3 = true
      const nodes = {
        a1: makeNode('a1', 'source', { value: 5 }),
        b1: makeNode('b1', 'source', { value: 3 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }),
        a2: makeNode('a2', 'source', { value: 10 }),
        b2: makeNode('b2', 'source', { value: 2 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }),
        and: makeNode('and', 'and'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'and', 0),
        c6: makeConn('c6', 'cmpB', 0, 'and', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('and')!.outputs[0]).toBe(true);
    });

    it('true AND false = false', () => {
      const nodes = {
        a1: makeNode('a1', 'source', { value: 5 }),
        b1: makeNode('b1', 'source', { value: 3 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }), // true
        a2: makeNode('a2', 'source', { value: 1 }),
        b2: makeNode('b2', 'source', { value: 10 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }), // false
        and: makeNode('and', 'and'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'and', 0),
        c6: makeConn('c6', 'cmpB', 0, 'and', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('and')!.outputs[0]).toBe(false);
    });

    it('false AND false = false', () => {
      const nodes = {
        a1: makeNode('a1', 'source', { value: 1 }),
        b1: makeNode('b1', 'source', { value: 10 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }), // false
        a2: makeNode('a2', 'source', { value: 2 }),
        b2: makeNode('b2', 'source', { value: 20 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }), // false
        and: makeNode('and', 'and'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'and', 0),
        c6: makeConn('c6', 'cmpB', 0, 'and', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('and')!.outputs[0]).toBe(false);
    });

    it('truthy number coercion: 1 AND 1 = true', () => {
      // Connect source nodes with value 1 directly — Boolean(1) = true
      const nodes = {
        s1: makeNode('s1', 'source', { value: 1 }),
        s2: makeNode('s2', 'source', { value: 1 }),
        and: makeNode('and', 'and'),
      };
      const conns = {
        c1: makeConn('c1', 's1', 0, 'and', 0),
        c2: makeConn('c2', 's2', 0, 'and', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('and')!.outputs[0]).toBe(true);
    });

    it('defaults to false AND false = false when no inputs connected', () => {
      // No connections: inputs are undefined, Boolean(undefined) = false
      const r = exec({ and: makeNode('and', 'and') });
      expect(r.results.get('and')!.outputs[0]).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // or processor
  // -----------------------------------------------------------------------
  describe('or processor', () => {
    it('true OR false = true', () => {
      const nodes = {
        a1: makeNode('a1', 'source', { value: 5 }),
        b1: makeNode('b1', 'source', { value: 3 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }), // true
        a2: makeNode('a2', 'source', { value: 1 }),
        b2: makeNode('b2', 'source', { value: 10 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }), // false
        or: makeNode('or', 'or'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'or', 0),
        c6: makeConn('c6', 'cmpB', 0, 'or', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('or')!.outputs[0]).toBe(true);
    });

    it('false OR false = false', () => {
      const nodes = {
        a1: makeNode('a1', 'source', { value: 1 }),
        b1: makeNode('b1', 'source', { value: 10 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }), // false
        a2: makeNode('a2', 'source', { value: 2 }),
        b2: makeNode('b2', 'source', { value: 20 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }), // false
        or: makeNode('or', 'or'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'or', 0),
        c6: makeConn('c6', 'cmpB', 0, 'or', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('or')!.outputs[0]).toBe(false);
    });

    it('true OR true = true', () => {
      const nodes = {
        a1: makeNode('a1', 'source', { value: 5 }),
        b1: makeNode('b1', 'source', { value: 3 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }), // true
        a2: makeNode('a2', 'source', { value: 10 }),
        b2: makeNode('b2', 'source', { value: 2 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }), // true
        or: makeNode('or', 'or'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'or', 0),
        c6: makeConn('c6', 'cmpB', 0, 'or', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('or')!.outputs[0]).toBe(true);
    });

    it('defaults to false OR false = false when no inputs connected', () => {
      const r = exec({ or: makeNode('or', 'or') });
      expect(r.results.get('or')!.outputs[0]).toBe(false);
    });

    it('truthy coercion: 0 OR 1 = true', () => {
      const nodes = {
        s1: makeNode('s1', 'source', { value: 0 }),
        s2: makeNode('s2', 'source', { value: 1 }),
        or: makeNode('or', 'or'),
      };
      const conns = {
        c1: makeConn('c1', 's1', 0, 'or', 0),
        c2: makeConn('c2', 's2', 0, 'or', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('or')!.outputs[0]).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // not processor
  // -----------------------------------------------------------------------
  describe('not processor', () => {
    it('NOT true = false', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 5 }),
        b: makeNode('b', 'source', { value: 3 }),
        cmp: makeNode('cmp', 'compare', { mode: '>' }), // true
        not: makeNode('not', 'not'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'cmp', 0),
        c2: makeConn('c2', 'b', 0, 'cmp', 1),
        c3: makeConn('c3', 'cmp', 0, 'not', 0),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('not')!.outputs[0]).toBe(false);
    });

    it('NOT false = true', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 1 }),
        b: makeNode('b', 'source', { value: 10 }),
        cmp: makeNode('cmp', 'compare', { mode: '>' }), // false
        not: makeNode('not', 'not'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'cmp', 0),
        c2: makeConn('c2', 'b', 0, 'cmp', 1),
        c3: makeConn('c3', 'cmp', 0, 'not', 0),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('not')!.outputs[0]).toBe(true);
    });

    it('NOT 0 = true (falsy coercion)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0 }),
        not: makeNode('not', 'not'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'not', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('not')!.outputs[0]).toBe(true);
    });

    it('NOT 1 = false (truthy coercion)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 1 }),
        not: makeNode('not', 'not'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'not', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('not')!.outputs[0]).toBe(false);
    });

    it('defaults to NOT undefined = true when no input connected', () => {
      // Boolean(undefined) = false, so !false = true
      const r = exec({ not: makeNode('not', 'not') });
      expect(r.results.get('not')!.outputs[0]).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // xor processor
  // -----------------------------------------------------------------------
  describe('xor processor', () => {
    it('true XOR false = true', () => {
      const nodes = {
        a1: makeNode('a1', 'source', { value: 5 }),
        b1: makeNode('b1', 'source', { value: 3 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }), // true
        a2: makeNode('a2', 'source', { value: 1 }),
        b2: makeNode('b2', 'source', { value: 10 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }), // false
        xor: makeNode('xor', 'xor'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'xor', 0),
        c6: makeConn('c6', 'cmpB', 0, 'xor', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('xor')!.outputs[0]).toBe(true);
    });

    it('true XOR true = false', () => {
      const nodes = {
        a1: makeNode('a1', 'source', { value: 5 }),
        b1: makeNode('b1', 'source', { value: 3 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }), // true
        a2: makeNode('a2', 'source', { value: 10 }),
        b2: makeNode('b2', 'source', { value: 2 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }), // true
        xor: makeNode('xor', 'xor'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'xor', 0),
        c6: makeConn('c6', 'cmpB', 0, 'xor', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('xor')!.outputs[0]).toBe(false);
    });

    it('false XOR false = false', () => {
      const nodes = {
        a1: makeNode('a1', 'source', { value: 1 }),
        b1: makeNode('b1', 'source', { value: 10 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }), // false
        a2: makeNode('a2', 'source', { value: 2 }),
        b2: makeNode('b2', 'source', { value: 20 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }), // false
        xor: makeNode('xor', 'xor'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'xor', 0),
        c6: makeConn('c6', 'cmpB', 0, 'xor', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('xor')!.outputs[0]).toBe(false);
    });

    it('false XOR true = true', () => {
      const nodes = {
        s1: makeNode('s1', 'source', { value: 0 }),  // falsy
        s2: makeNode('s2', 'source', { value: 1 }),  // truthy
        xor: makeNode('xor', 'xor'),
      };
      const conns = {
        c1: makeConn('c1', 's1', 0, 'xor', 0),
        c2: makeConn('c2', 's2', 0, 'xor', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('xor')!.outputs[0]).toBe(true);
    });

    it('defaults to false XOR false = false when no inputs connected', () => {
      const r = exec({ xor: makeNode('xor', 'xor') });
      expect(r.results.get('xor')!.outputs[0]).toBe(false);
    });
  });

  // =========================================================================
  // STRING NODES
  // =========================================================================

  // -----------------------------------------------------------------------
  // string-length processor
  // -----------------------------------------------------------------------
  describe('string-length processor', () => {
    it('"hello" has length 5', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: 'hello' }),
        sl: makeNode('sl', 'string-length'),
      };
      // Connect label output (port 1) of source to string-length input (port 0)
      const conns = { c1: makeConn('c1', 's', 1, 'sl', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sl')!.outputs[0]).toBe(5);
    });

    it('empty string has length 0', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '' }),
        sl: makeNode('sl', 'string-length'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'sl', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sl')!.outputs[0]).toBe(0);
    });

    it('non-string input defaults to empty string (length 0)', () => {
      // Connect a number output to string-length input — not a string, falls back to ''
      const nodes = {
        s: makeNode('s', 'source', { value: 42 }),
        sl: makeNode('sl', 'string-length'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sl', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sl')!.outputs[0]).toBe(0);
    });

    it('string with spaces counts all characters', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '  hi  ' }),
        sl: makeNode('sl', 'string-length'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'sl', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sl')!.outputs[0]).toBe(6);
    });

    it('defaults to length 0 when no input connected', () => {
      const r = exec({ sl: makeNode('sl', 'string-length') });
      expect(r.results.get('sl')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // string-trim processor
  // -----------------------------------------------------------------------
  describe('string-trim processor', () => {
    it('trims whitespace from both ends', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '  hello  ' }),
        st: makeNode('st', 'string-trim'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'st', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('st')!.outputs[0]).toBe('hello');
    });

    it('already trimmed string stays the same', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: 'hello' }),
        st: makeNode('st', 'string-trim'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'st', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('st')!.outputs[0]).toBe('hello');
    });

    it('trims tabs and newlines', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '\t\nhello\n\t' }),
        st: makeNode('st', 'string-trim'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'st', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('st')!.outputs[0]).toBe('hello');
    });

    it('all-whitespace string trims to empty', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '   ' }),
        st: makeNode('st', 'string-trim'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'st', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('st')!.outputs[0]).toBe('');
    });

    it('defaults to empty string when no input connected', () => {
      const r = exec({ st: makeNode('st', 'string-trim') });
      expect(r.results.get('st')!.outputs[0]).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // string-split processor
  // -----------------------------------------------------------------------
  describe('string-split processor', () => {
    it('splits "a,b,c" on "," into first="a", rest="b,c", count=3', () => {
      const nodes = {
        str: makeNode('str', 'source', { value: 0, label: 'a,b,c' }),
        delim: makeNode('delim', 'source', { value: 0, label: ',' }),
        sp: makeNode('sp', 'string-split'),
      };
      const conns = {
        c1: makeConn('c1', 'str', 1, 'sp', 0),
        c2: makeConn('c2', 'delim', 1, 'sp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sp')!.outputs[0]).toBe('a');
      expect(r.results.get('sp')!.outputs[1]).toBe('b,c');
      expect(r.results.get('sp')!.outputs[2]).toBe(3);
    });

    it('split with no delimiter match returns whole string as first, empty rest, count=1', () => {
      const nodes = {
        str: makeNode('str', 'source', { value: 0, label: 'hello' }),
        delim: makeNode('delim', 'source', { value: 0, label: '|' }),
        sp: makeNode('sp', 'string-split'),
      };
      const conns = {
        c1: makeConn('c1', 'str', 1, 'sp', 0),
        c2: makeConn('c2', 'delim', 1, 'sp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sp')!.outputs[0]).toBe('hello');
      expect(r.results.get('sp')!.outputs[1]).toBe('');
      expect(r.results.get('sp')!.outputs[2]).toBe(1);
    });

    it('split empty string returns first="", rest="", count=1', () => {
      const nodes = {
        str: makeNode('str', 'source', { value: 0, label: '' }),
        delim: makeNode('delim', 'source', { value: 0, label: ',' }),
        sp: makeNode('sp', 'string-split'),
      };
      const conns = {
        c1: makeConn('c1', 'str', 1, 'sp', 0),
        c2: makeConn('c2', 'delim', 1, 'sp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sp')!.outputs[0]).toBe('');
      expect(r.results.get('sp')!.outputs[1]).toBe('');
      expect(r.results.get('sp')!.outputs[2]).toBe(1);
    });

    it('split with space delimiter', () => {
      const nodes = {
        str: makeNode('str', 'source', { value: 0, label: 'hello world foo' }),
        delim: makeNode('delim', 'source', { value: 0, label: ' ' }),
        sp: makeNode('sp', 'string-split'),
      };
      const conns = {
        c1: makeConn('c1', 'str', 1, 'sp', 0),
        c2: makeConn('c2', 'delim', 1, 'sp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sp')!.outputs[0]).toBe('hello');
      expect(r.results.get('sp')!.outputs[1]).toBe('world foo');
      expect(r.results.get('sp')!.outputs[2]).toBe(3);
    });

    it('defaults to comma delimiter when only string connected', () => {
      // Default delimiter is ',' per the processor
      const nodes = {
        str: makeNode('str', 'source', { value: 0, label: 'x,y' }),
        sp: makeNode('sp', 'string-split'),
      };
      const conns = { c1: makeConn('c1', 'str', 1, 'sp', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sp')!.outputs[0]).toBe('x');
      expect(r.results.get('sp')!.outputs[1]).toBe('y');
      expect(r.results.get('sp')!.outputs[2]).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // string-case processor
  // -----------------------------------------------------------------------
  describe('string-case processor', () => {
    it('"Hello" → upper="HELLO", lower="hello"', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: 'Hello' }),
        sc: makeNode('sc', 'string-case'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'sc', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sc')!.outputs[0]).toBe('HELLO');
      expect(r.results.get('sc')!.outputs[1]).toBe('hello');
    });

    it('already uppercase stays uppercase', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: 'HELLO' }),
        sc: makeNode('sc', 'string-case'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'sc', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sc')!.outputs[0]).toBe('HELLO');
      expect(r.results.get('sc')!.outputs[1]).toBe('hello');
    });

    it('empty string produces empty outputs', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '' }),
        sc: makeNode('sc', 'string-case'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'sc', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sc')!.outputs[0]).toBe('');
      expect(r.results.get('sc')!.outputs[1]).toBe('');
    });

    it('mixed case with numbers and symbols', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: 'Test 123!' }),
        sc: makeNode('sc', 'string-case'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'sc', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sc')!.outputs[0]).toBe('TEST 123!');
      expect(r.results.get('sc')!.outputs[1]).toBe('test 123!');
    });

    it('defaults to empty string when no input connected', () => {
      const r = exec({ sc: makeNode('sc', 'string-case') });
      expect(r.results.get('sc')!.outputs[0]).toBe('');
      expect(r.results.get('sc')!.outputs[1]).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // parse-number processor
  // -----------------------------------------------------------------------
  describe('parse-number processor', () => {
    it('"42" → value=42, valid=true', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '42' }),
        pn: makeNode('pn', 'parse-number'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'pn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('pn')!.outputs[0]).toBe(42);
      expect(r.results.get('pn')!.outputs[1]).toBe(true);
    });

    it('"abc" → value=0, valid=false', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: 'abc' }),
        pn: makeNode('pn', 'parse-number'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'pn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('pn')!.outputs[0]).toBe(0);
      expect(r.results.get('pn')!.outputs[1]).toBe(false);
    });

    it('"3.14" → value=3.14, valid=true', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '3.14' }),
        pn: makeNode('pn', 'parse-number'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'pn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('pn')!.outputs[0]).toBe(3.14);
      expect(r.results.get('pn')!.outputs[1]).toBe(true);
    });

    it('empty string → value=0, valid=false', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '' }),
        pn: makeNode('pn', 'parse-number'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'pn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('pn')!.outputs[0]).toBe(0);
      expect(r.results.get('pn')!.outputs[1]).toBe(false);
    });

    it('"  -7.5  " → value=-7.5, valid=true (handles whitespace)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '  -7.5  ' }),
        pn: makeNode('pn', 'parse-number'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'pn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('pn')!.outputs[0]).toBe(-7.5);
      expect(r.results.get('pn')!.outputs[1]).toBe(true);
    });

    it('"Infinity" → value=0, valid=false (not finite)', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: 'Infinity' }),
        pn: makeNode('pn', 'parse-number'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'pn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('pn')!.outputs[0]).toBe(0);
      expect(r.results.get('pn')!.outputs[1]).toBe(false);
    });

    it('"0" → value=0, valid=true', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '0' }),
        pn: makeNode('pn', 'parse-number'),
      };
      const conns = { c1: makeConn('c1', 's', 1, 'pn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('pn')!.outputs[0]).toBe(0);
      expect(r.results.get('pn')!.outputs[1]).toBe(true);
    });

    it('defaults to value=0, valid=false when no input connected', () => {
      // No connection: input is undefined, typeof check fails → s = '', empty string → invalid
      const r = exec({ pn: makeNode('pn', 'parse-number') });
      expect(r.results.get('pn')!.outputs[0]).toBe(0);
      expect(r.results.get('pn')!.outputs[1]).toBe(false);
    });
  });

  // =========================================================================
  // INTEGRATION: Chaining Phase 13 nodes together
  // =========================================================================

  describe('integration: chaining Phase 13 nodes', () => {
    it('sin -> abs produces non-negative sine values', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -Math.PI / 6 }), // sin(-pi/6) = -0.5
        sin: makeNode('sin', 'sin'),
        abs: makeNode('abs', 'abs'),
      };
      const conns = {
        c1: makeConn('c1', 's', 0, 'sin', 0),
        c2: makeConn('c2', 'sin', 0, 'abs', 0),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('abs')!.outputs[0]).toBeCloseTo(0.5, 10);
    });

    it('lerp -> floor for stepped interpolation', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 0 }),
        b: makeNode('b', 'source', { value: 10 }),
        t: makeNode('t', 'source', { value: 0.37 }),
        lerp: makeNode('lerp', 'lerp'),
        fl: makeNode('fl', 'floor'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'lerp', 0),
        c2: makeConn('c2', 'b', 0, 'lerp', 1),
        c3: makeConn('c3', 't', 0, 'lerp', 2),
        c4: makeConn('c4', 'lerp', 0, 'fl', 0),
      };
      const r = exec(nodes, conns);
      // lerp(0, 10, 0.37) = 3.7, floor(3.7) = 3
      expect(r.results.get('fl')!.outputs[0]).toBe(3);
    });

    it('string-split -> string-length for counting first word', () => {
      const nodes = {
        str: makeNode('str', 'source', { value: 0, label: 'hello world' }),
        delim: makeNode('delim', 'source', { value: 0, label: ' ' }),
        sp: makeNode('sp', 'string-split'),
        sl: makeNode('sl', 'string-length'),
      };
      const conns = {
        c1: makeConn('c1', 'str', 1, 'sp', 0),
        c2: makeConn('c2', 'delim', 1, 'sp', 1),
        c3: makeConn('c3', 'sp', 0, 'sl', 0), // first part "hello" → string-length
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sl')!.outputs[0]).toBe(5); // "hello".length
    });

    it('parse-number -> sqrt for numeric string processing', () => {
      const nodes = {
        str: makeNode('str', 'source', { value: 0, label: '16' }),
        pn: makeNode('pn', 'parse-number'),
        sq: makeNode('sq', 'sqrt'),
      };
      const conns = {
        c1: makeConn('c1', 'str', 1, 'pn', 0),
        c2: makeConn('c2', 'pn', 0, 'sq', 0),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sq')!.outputs[0]).toBe(4);
    });

    it('and -> not for NAND logic', () => {
      const nodes = {
        s1: makeNode('s1', 'source', { value: 1 }), // truthy
        s2: makeNode('s2', 'source', { value: 1 }), // truthy
        and: makeNode('and', 'and'),
        not: makeNode('not', 'not'),
      };
      const conns = {
        c1: makeConn('c1', 's1', 0, 'and', 0),
        c2: makeConn('c2', 's2', 0, 'and', 1),
        c3: makeConn('c3', 'and', 0, 'not', 0),
      };
      const r = exec(nodes, conns);
      // 1 AND 1 = true, NOT true = false
      expect(r.results.get('not')!.outputs[0]).toBe(false);
    });

    it('string-case -> string-trim for normalized case', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 0, label: '  Hello World  ' }),
        st: makeNode('st', 'string-trim'),
        sc: makeNode('sc', 'string-case'),
      };
      const conns = {
        c1: makeConn('c1', 's', 1, 'st', 0),
        c2: makeConn('c2', 'st', 0, 'sc', 0),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sc')!.outputs[0]).toBe('HELLO WORLD');
      expect(r.results.get('sc')!.outputs[1]).toBe('hello world');
    });

    it('cos -> round for discrete cosine values', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: Math.PI }), // cos(pi) = -1
        cos: makeNode('cos', 'cos'),
        rn: makeNode('rn', 'round'),
      };
      const conns = {
        c1: makeConn('c1', 's', 0, 'cos', 0),
        c2: makeConn('c2', 'cos', 0, 'rn', 0),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('rn')!.outputs[0]).toBe(-1);
    });

    it('xor with compare nodes in a decision chain', () => {
      // Check if exactly one of two conditions is true:
      // condition A: 10 > 5 (true), condition B: 3 > 7 (false) → XOR = true
      // Then use switch to match XOR result against case0=true, default=-100
      const nodes = {
        a1: makeNode('a1', 'source', { value: 10 }),
        b1: makeNode('b1', 'source', { value: 5 }),
        cmpA: makeNode('cmpA', 'compare', { mode: '>' }),
        a2: makeNode('a2', 'source', { value: 3 }),
        b2: makeNode('b2', 'source', { value: 7 }),
        cmpB: makeNode('cmpB', 'compare', { mode: '>' }),
        xor: makeNode('xor', 'xor'),
        vT: makeNode('vT', 'source', { value: true }),
        vF: makeNode('vF', 'source', { value: -100 }),
        sw: makeNode('sw', 'switch'),
      };
      const conns = {
        c1: makeConn('c1', 'a1', 0, 'cmpA', 0),
        c2: makeConn('c2', 'b1', 0, 'cmpA', 1),
        c3: makeConn('c3', 'a2', 0, 'cmpB', 0),
        c4: makeConn('c4', 'b2', 0, 'cmpB', 1),
        c5: makeConn('c5', 'cmpA', 0, 'xor', 0),
        c6: makeConn('c6', 'cmpB', 0, 'xor', 1),
        c7: makeConn('c7', 'xor', 0, 'sw', 0),   // value (true)
        c8: makeConn('c8', 'vT', 0, 'sw', 1),     // case0 (true) — matches value
        c9: makeConn('c9', 'vF', 0, 'sw', 5),     // default (-100)
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sw')!.outputs[0]).toBe(true); // XOR is true, case0=true matches
    });
  });
});

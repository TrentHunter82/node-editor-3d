import { describe, it, expect } from 'vitest';
import { executeGraph, topologicalSort, invalidateDownstream } from './execution';
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
// Processor Unit Tests — Covering Edge Cases
// ===========================================================================

describe('Execution Processors - Edge Cases', () => {

  // -----------------------------------------------------------------------
  // source processor
  // -----------------------------------------------------------------------
  describe('source processor', () => {
    it('returns configured value and label', () => {
      const r = exec({ s: makeNode('s', 'source', { value: 42, label: 'test' }) });
      expect(r.results.get('s')!.outputs[0]).toBe(42);
      expect(r.results.get('s')!.outputs[1]).toBe('test');
    });

    it('defaults to 0 and node title when data is empty', () => {
      const r = exec({ s: makeNode('s', 'source', {}, { title: 'MySource' }) });
      expect(r.results.get('s')!.outputs[0]).toBe(0);
      expect(r.results.get('s')!.outputs[1]).toBe('MySource');
    });
  });

  // -----------------------------------------------------------------------
  // transform processor
  // -----------------------------------------------------------------------
  describe('transform processor', () => {
    it('applies multiplier and offset', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 5 }),
        t: makeNode('t', 'transform', { multiplier: 3, offset: 2 }),
      };
      const conns = { c1: makeConn('c1', 's', 0, 't', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('t')!.outputs[0]).toBe(17); // 5*3+2
    });

    it('defaults multiplier=1, offset=0 when missing', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 7 }),
        t: makeNode('t', 'transform', {}),
      };
      const conns = { c1: makeConn('c1', 's', 0, 't', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('t')!.outputs[0]).toBe(7);
    });

    it('produces debug string output', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 3 }),
        t: makeNode('t', 'transform', { multiplier: 2, offset: 1 }),
      };
      const conns = { c1: makeConn('c1', 's', 0, 't', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('t')!.outputs[1]).toBe('3×2+1=7');
    });
  });

  // -----------------------------------------------------------------------
  // filter processor
  // -----------------------------------------------------------------------
  describe('filter processor', () => {
    it('greater mode passes values above threshold', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 10 }),
        f: makeNode('f', 'filter', { threshold: 5, mode: 'greater' }),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBe(10);
    });

    it('less mode passes values below threshold', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 3 }),
        f: makeNode('f', 'filter', { threshold: 5, mode: 'less' }),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBe(3);
    });

    it('equal mode passes values equal to threshold', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 5 }),
        f: makeNode('f', 'filter', { threshold: 5, mode: 'equal' }),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBe(5);
    });

    it('equal mode nulls values not equal to threshold', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 6 }),
        f: makeNode('f', 'filter', { threshold: 5, mode: 'equal' }),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBeNull();
    });

    it('default/unknown mode falls back to greater', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 10 }),
        f: makeNode('f', 'filter', { threshold: 5, mode: 'unknown-mode' }),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'f', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('f')!.outputs[0]).toBe(10); // 10 > 5
    });

    it('non-numeric input defaults to 0 for comparison', () => {
      // No connections: inputs[0] is undefined, numValue = 0, 0 > -1 = true
      // passes = true, so returns inputValue = undefined
      const r = exec({ f: makeNode('f', 'filter', { threshold: -1, mode: 'greater' }) });
      expect(r.results.get('f')!.outputs[0]).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // math processor - all operations
  // -----------------------------------------------------------------------
  describe('math processor', () => {
    it('add', () => {
      const r = exec({ m: makeNode('m', 'math', { operation: 'add' }) });
      expect(r.results.get('m')!.outputs[0]).toBe(0); // 0+0
    });

    it('subtract', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 10 }),
        b: makeNode('b', 'source', { value: 3 }),
        m: makeNode('m', 'math', { operation: 'subtract' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(7);
    });

    it('multiply', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 4 }),
        b: makeNode('b', 'source', { value: 5 }),
        m: makeNode('m', 'math', { operation: 'multiply' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(20);
    });

    it('divide', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 10 }),
        b: makeNode('b', 'source', { value: 4 }),
        m: makeNode('m', 'math', { operation: 'divide' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(2.5);
    });

    it('divide by zero returns 0', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 10 }),
        b: makeNode('b', 'source', { value: 0 }),
        m: makeNode('m', 'math', { operation: 'divide' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(0);
    });

    it('power', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 2 }),
        b: makeNode('b', 'source', { value: 8 }),
        m: makeNode('m', 'math', { operation: 'power' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(256);
    });

    it('power returns 0 for Infinity results (e.g. 0^-1)', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 0 }),
        b: makeNode('b', 'source', { value: -1 }),
        m: makeNode('m', 'math', { operation: 'power' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(0);
    });

    it('power returns 0 for NaN results (e.g. (-2)^0.5)', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: -2 }),
        b: makeNode('b', 'source', { value: 0.5 }),
        m: makeNode('m', 'math', { operation: 'power' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(0);
    });

    it('modulo', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 17 }),
        b: makeNode('b', 'source', { value: 5 }),
        m: makeNode('m', 'math', { operation: 'modulo' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(2);
    });

    it('modulo by zero returns 0', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 10 }),
        b: makeNode('b', 'source', { value: 0 }),
        m: makeNode('m', 'math', { operation: 'modulo' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(0);
    });

    it('unknown operation defaults to add', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 3 }),
        b: makeNode('b', 'source', { value: 7 }),
        m: makeNode('m', 'math', { operation: 'bogus' }),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('m')!.outputs[0]).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // clamp processor
  // -----------------------------------------------------------------------
  describe('clamp processor', () => {
    it('clamps value within range', () => {
      const nodes = {
        v: makeNode('v', 'source', { value: 15 }),
        lo: makeNode('lo', 'source', { value: 0 }),
        hi: makeNode('hi', 'source', { value: 10 }),
        c: makeNode('c', 'clamp'),
      };
      const conns = {
        c1: makeConn('c1', 'v', 0, 'c', 0),
        c2: makeConn('c2', 'lo', 0, 'c', 1),
        c3: makeConn('c3', 'hi', 0, 'c', 2),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(10);
    });

    it('passes through value already within range', () => {
      const nodes = {
        v: makeNode('v', 'source', { value: 5 }),
        lo: makeNode('lo', 'source', { value: 0 }),
        hi: makeNode('hi', 'source', { value: 10 }),
        c: makeNode('c', 'clamp'),
      };
      const conns = {
        c1: makeConn('c1', 'v', 0, 'c', 0),
        c2: makeConn('c2', 'lo', 0, 'c', 1),
        c3: makeConn('c3', 'hi', 0, 'c', 2),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(5);
    });

    it('defaults: value=0, min=0, max=1', () => {
      const r = exec({ c: makeNode('c', 'clamp') });
      expect(r.results.get('c')!.outputs[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // remap processor
  // -----------------------------------------------------------------------
  describe('remap processor', () => {
    it('remaps value from one range to another', () => {
      // v=5, inMin=0, inMax=10, outMin=0, outMax=100 → expect 50
      // We'll connect value and use default ranges (0,1,0,1)
      // Actually we need to supply all 5 inputs. Let's use the default (no connections).
      const r = exec({ c: makeNode('c', 'remap') });
      // defaults: value=0, inMin=0, inMax=1, outMin=0, outMax=1 → t=0, result=0
      expect(r.results.get('c')!.outputs[0]).toBe(0);
    });

    it('zero range (inMax === inMin) returns outMin', () => {
      // Use node data to set all inputs since they come via connections
      // For standalone remap node without connections, all inputs default to 0 except inMax=1, outMax=1
      // We need to build a chain to test zero-range properly
      const nodes = {
        val: makeNode('val', 'source', { value: 5 }),
        inMin: makeNode('inMin', 'source', { value: 5 }),
        inMax: makeNode('inMax', 'source', { value: 5 }), // same as inMin → zero range
        outMin: makeNode('outMin', 'source', { value: 10 }),
        outMax: makeNode('outMax', 'source', { value: 20 }),
        r: makeNode('r', 'remap'),
      };
      const conns = {
        c1: makeConn('c1', 'val', 0, 'r', 0),
        c2: makeConn('c2', 'inMin', 0, 'r', 1),
        c3: makeConn('c3', 'inMax', 0, 'r', 2),
        c4: makeConn('c4', 'outMin', 0, 'r', 3),
        c5: makeConn('c5', 'outMax', 0, 'r', 4),
      };
      const r = exec(nodes, conns);
      // range=0, t=0, result = outMin + 0 * (outMax - outMin) = 10
      expect(r.results.get('r')!.outputs[0]).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // concat processor
  // -----------------------------------------------------------------------
  describe('concat processor', () => {
    it('concatenates two strings', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 0, label: 'hello' }),
        b: makeNode('b', 'source', { value: 0, label: ' world' }),
        c: makeNode('c', 'concat'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 1, 'c', 0),
        c2: makeConn('c2', 'b', 1, 'c', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe('hello world');
    });

    it('handles null inputs as empty strings', () => {
      const r = exec({ c: makeNode('c', 'concat') });
      expect(r.results.get('c')!.outputs[0]).toBe('');
    });

    it('converts numbers to strings', () => {
      const nodes = {
        a: makeNode('a', 'source', { value: 42 }),
        c: makeNode('c', 'concat'),
      };
      const conns = { c1: makeConn('c1', 'a', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe('42');
    });
  });

  // -----------------------------------------------------------------------
  // template processor
  // -----------------------------------------------------------------------
  describe('template processor', () => {
    it('replaces {value} placeholder', () => {
      const nodes = {
        tpl: makeNode('tpl', 'source', { value: 0, label: 'Result: {value}' }),
        val: makeNode('val', 'source', { value: 42 }),
        t: makeNode('t', 'template'),
      };
      const conns = {
        c1: makeConn('c1', 'tpl', 1, 't', 0),
        c2: makeConn('c2', 'val', 0, 't', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('t')!.outputs[0]).toBe('Result: 42');
    });

    it('replaces multiple {value} occurrences', () => {
      const nodes = {
        tpl: makeNode('tpl', 'source', { value: 0, label: '{value} and {value}' }),
        val: makeNode('val', 'source', { value: 7 }),
        t: makeNode('t', 'template'),
      };
      const conns = {
        c1: makeConn('c1', 'tpl', 1, 't', 0),
        c2: makeConn('c2', 'val', 0, 't', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('t')!.outputs[0]).toBe('7 and 7');
    });

    it('uses default template when input is not string', () => {
      const r = exec({ t: makeNode('t', 'template') });
      // template defaults to '{value}', value defaults to null → replaced with ''
      expect(r.results.get('t')!.outputs[0]).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // compare processor - all modes
  // -----------------------------------------------------------------------
  describe('compare processor', () => {
    const modes = [
      { mode: '>', a: 5, b: 3, expected: true },
      { mode: '>', a: 3, b: 5, expected: false },
      { mode: '<', a: 3, b: 5, expected: true },
      { mode: '<', a: 5, b: 3, expected: false },
      { mode: '==', a: 5, b: 5, expected: true },
      { mode: '==', a: 5, b: 3, expected: false },
      { mode: '!=', a: 5, b: 3, expected: true },
      { mode: '!=', a: 5, b: 5, expected: false },
      { mode: '>=', a: 5, b: 5, expected: true },
      { mode: '>=', a: 5, b: 6, expected: false },
      { mode: '<=', a: 5, b: 5, expected: true },
      { mode: '<=', a: 6, b: 5, expected: false },
    ];

    for (const { mode, a, b, expected } of modes) {
      it(`compare ${a} ${mode} ${b} = ${expected}`, () => {
        const nodes = {
          sa: makeNode('sa', 'source', { value: a }),
          sb: makeNode('sb', 'source', { value: b }),
          c: makeNode('c', 'compare', { mode }),
        };
        const conns = {
          c1: makeConn('c1', 'sa', 0, 'c', 0),
          c2: makeConn('c2', 'sb', 0, 'c', 1),
        };
        const r = exec(nodes, conns);
        expect(r.results.get('c')!.outputs[0]).toBe(expected);
      });
    }

    it('unknown mode defaults to >', () => {
      const nodes = {
        sa: makeNode('sa', 'source', { value: 10 }),
        sb: makeNode('sb', 'source', { value: 3 }),
        c: makeNode('c', 'compare', { mode: 'bogus' }),
      };
      const conns = {
        c1: makeConn('c1', 'sa', 0, 'c', 0),
        c2: makeConn('c2', 'sb', 0, 'c', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(true); // 10 > 3
    });
  });

  // -----------------------------------------------------------------------
  // switch processor
  // -----------------------------------------------------------------------
  describe('switch processor', () => {
    it('returns matching case value when a case matches', () => {
      const nodes = {
        val: makeNode('val', 'source', { value: 10 }),
        c0: makeNode('c0', 'source', { value: 10 }),
        c1: makeNode('c1', 'source', { value: 20 }),
        def: makeNode('def', 'source', { value: 99 }),
        sw: makeNode('sw', 'switch'),
      };
      const conns = {
        c1: makeConn('c1', 'val', 0, 'sw', 0),  // value
        c2: makeConn('c2', 'c0', 0, 'sw', 1),    // case0
        c3: makeConn('c3', 'c1', 0, 'sw', 2),    // case1
        c4: makeConn('c4', 'def', 0, 'sw', 5),   // default
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sw')!.outputs[0]).toBe(10);
    });

    it('returns default when no case matches', () => {
      const nodes = {
        val: makeNode('val', 'source', { value: 50 }),
        c0: makeNode('c0', 'source', { value: 10 }),
        c1: makeNode('c1', 'source', { value: 20 }),
        def: makeNode('def', 'source', { value: 99 }),
        sw: makeNode('sw', 'switch'),
      };
      const conns = {
        c1: makeConn('c1', 'val', 0, 'sw', 0),  // value
        c2: makeConn('c2', 'c0', 0, 'sw', 1),    // case0
        c3: makeConn('c3', 'c1', 0, 'sw', 2),    // case1
        c4: makeConn('c4', 'def', 0, 'sw', 5),   // default
      };
      const r = exec(nodes, conns);
      expect(r.results.get('sw')!.outputs[0]).toBe(99);
    });
  });

  // -----------------------------------------------------------------------
  // compose-vec3 / decompose-vec3 processors
  // -----------------------------------------------------------------------
  describe('compose-vec3 processor', () => {
    it('composes x, y, z into array', () => {
      const nodes = {
        x: makeNode('x', 'source', { value: 1 }),
        y: makeNode('y', 'source', { value: 2 }),
        z: makeNode('z', 'source', { value: 3 }),
        c: makeNode('c', 'compose-vec3'),
      };
      const conns = {
        c1: makeConn('c1', 'x', 0, 'c', 0),
        c2: makeConn('c2', 'y', 0, 'c', 1),
        c3: makeConn('c3', 'z', 0, 'c', 2),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toEqual([1, 2, 3]);
    });

    it('defaults to [0,0,0] with no inputs', () => {
      const r = exec({ c: makeNode('c', 'compose-vec3') });
      expect(r.results.get('c')!.outputs[0]).toEqual([0, 0, 0]);
    });
  });

  describe('decompose-vec3 processor', () => {
    it('decomposes array into x, y, z', () => {
      const nodes = {
        c: makeNode('c', 'compose-vec3'),
        x: makeNode('x', 'source', { value: 10 }),
        y: makeNode('y', 'source', { value: 20 }),
        z: makeNode('z', 'source', { value: 30 }),
        d: makeNode('d', 'decompose-vec3'),
      };
      const conns = {
        c1: makeConn('c1', 'x', 0, 'c', 0),
        c2: makeConn('c2', 'y', 0, 'c', 1),
        c3: makeConn('c3', 'z', 0, 'c', 2),
        c4: makeConn('c4', 'c', 0, 'd', 0),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('d')!.outputs[0]).toBe(10);
      expect(r.results.get('d')!.outputs[1]).toBe(20);
      expect(r.results.get('d')!.outputs[2]).toBe(30);
    });

    it('defaults to [0,0,0] for non-array input', () => {
      const r = exec({ d: makeNode('d', 'decompose-vec3') });
      expect(r.results.get('d')!.outputs[0]).toBe(0);
      expect(r.results.get('d')!.outputs[1]).toBe(0);
      expect(r.results.get('d')!.outputs[2]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // note, reroute, display processors
  // -----------------------------------------------------------------------
  describe('utility processors', () => {
    it('note returns empty outputs', () => {
      const r = exec({ n: makeNode('n', 'note') });
      expect(r.results.get('n')!.outputs).toEqual({});
    });

    it('reroute passes through input', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 42 }),
        r: makeNode('r', 'reroute'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'r', 0) };
      const result = exec(nodes, conns);
      expect(result.results.get('r')!.outputs[0]).toBe(42);
    });

    it('display returns empty outputs', () => {
      const r = exec({ d: makeNode('d', 'display') });
      expect(r.results.get('d')!.outputs).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // random processor
  // -----------------------------------------------------------------------
  describe('random processor', () => {
    it('seeded random produces deterministic value', () => {
      const r1 = exec({ r: makeNode('r', 'random', { seed: 42, min: 0, max: 1 }) });
      const r2 = exec({ r: makeNode('r', 'random', { seed: 42, min: 0, max: 1 }) });
      expect(r1.results.get('r')!.outputs[0]).toBe(r2.results.get('r')!.outputs[0]);
    });

    it('seeded random respects min/max range', () => {
      const r = exec({ r: makeNode('r', 'random', { seed: 42, min: 10, max: 20 }) });
      const val = r.results.get('r')!.outputs[0] as number;
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(20);
    });

    it('unseeded random returns value in range', () => {
      const r = exec({ r: makeNode('r', 'random', { min: 0, max: 1 }) });
      const val = r.results.get('r')!.outputs[0] as number;
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    });

    it('different seeds produce different values', () => {
      const r1 = exec({ r: makeNode('r', 'random', { seed: 1, min: 0, max: 1 }) });
      const r2 = exec({ r: makeNode('r', 'random', { seed: 2, min: 0, max: 1 }) });
      expect(r1.results.get('r')!.outputs[0]).not.toBe(r2.results.get('r')!.outputs[0]);
    });
  });

  // -----------------------------------------------------------------------
  // subgraph processors
  // -----------------------------------------------------------------------
  describe('subgraph processors', () => {
    it('subgraph passes through first input', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 42 }),
        sg: makeNode('sg', 'subgraph'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'sg', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('sg')!.outputs[0]).toBe(42);
    });

    it('subgraph-input passes through input', () => {
      const r = exec({ si: makeNode('si', 'subgraph-input') });
      expect(r.results.get('si')!.outputs[0]).toBeNull();
    });

    it('subgraph-output passes through input', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 7 }),
        so: makeNode('so', 'subgraph-output'),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'so', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('so')!.outputs[0]).toBe(7);
    });
  });

  // -----------------------------------------------------------------------
  // custom processor
  // -----------------------------------------------------------------------
  describe('custom processor', () => {
    function makeCustomNode(id: string, expression: string, inputCount: number, outputCount: number): EditorNode {
      return {
        id,
        type: 'custom',
        position: [0, 0, 0],
        title: 'Custom',
        data: { expression, inputCount, outputCount },
        inputs: Array.from({ length: inputCount }, (_, i) => ({
          id: `in-${i}`, label: `in${i}`, portType: 'any' as const,
        })),
        outputs: Array.from({ length: outputCount }, (_, i) => ({
          id: `out-${i}`, label: `out${i}`, portType: 'any' as const,
        })),
      };
    }

    it('evaluates simple expression', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 5 }),
        c: makeCustomNode('c', 'in0 * 2', 1, 1),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(10);
    });

    it('supports inputs[] array syntax', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 7 }),
        c: makeCustomNode('c', 'inputs[0] + 3', 1, 1),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(10);
    });

    it('supports Math functions', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: -5 }),
        c: makeCustomNode('c', 'Math.abs(in0)', 1, 1),
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(5);
    });

    it('multi-output with array result spreads across outputs', () => {
      const c = makeCustomNode('c', '[in0, in0 * 2, in0 * 3]', 1, 3);
      const nodes = {
        s: makeNode('s', 'source', { value: 4 }),
        c,
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(4);
      expect(r.results.get('c')!.outputs[1]).toBe(8);
      expect(r.results.get('c')!.outputs[2]).toBe(12);
    });

    it('multi-output with non-array result puts value on output 0, null on rest', () => {
      const c = makeCustomNode('c', 'in0 * 10', 1, 3);
      const nodes = {
        s: makeNode('s', 'source', { value: 5 }),
        c,
      };
      const conns = { c1: makeConn('c1', 's', 0, 'c', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(50);
      expect(r.results.get('c')!.outputs[1]).toBeNull();
      expect(r.results.get('c')!.outputs[2]).toBeNull();
    });

    it('expression error is captured in errors map', () => {
      const c = makeCustomNode('c', 'undefined_var_xyz', 1, 1);
      const r = exec({ c });
      expect(r.errors.has('c')).toBe(true);
      expect(r.errors.get('c')).toContain('undefined_var_xyz');
    });

    it('defaults in0 to 0 when not connected', () => {
      const c = makeCustomNode('c', 'in0', 1, 1);
      const r = exec({ c });
      expect(r.results.get('c')!.outputs[0]).toBe(0);
    });

    it('multiple inputs with named variables', () => {
      const c = makeCustomNode('c', 'in0 + in1', 2, 1);
      const nodes = {
        a: makeNode('a', 'source', { value: 3 }),
        b: makeNode('b', 'source', { value: 7 }),
        c,
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'c', 0),
        c2: makeConn('c2', 'b', 0, 'c', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('c')!.outputs[0]).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // Execution caching
  // -----------------------------------------------------------------------
  describe('execution caching', () => {
    it('reuses cached results when inputs have not changed', () => {
      const nodes = {
        s: makeNode('s', 'source', { value: 5 }),
        t: makeNode('t', 'transform', { multiplier: 2 }),
      };
      const conns = { c1: makeConn('c1', 's', 0, 't', 0) };
      const r1 = exec(nodes, conns);
      // Execute again with same cache
      const r2 = executeGraph(nodes, conns, r1.results);
      // Results should be identical (cached)
      expect(r2.results.get('t')!.outputs[0]).toBe(10);
    });

    it('invalidateDownstream removes correct cache entries', () => {
      const cache = new Map<string, { outputs: Record<number, unknown>; inputHash: string }>();
      cache.set('a', { outputs: { 0: 1 }, inputHash: '1' });
      cache.set('b', { outputs: { 0: 2 }, inputHash: '2' });
      cache.set('c', { outputs: { 0: 3 }, inputHash: '3' });

      const conns = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'c', 0),
      };

      invalidateDownstream('a', conns, cache);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(false);
    });

    it('invalidateDownstream only affects downstream nodes', () => {
      const cache = new Map<string, { outputs: Record<number, unknown>; inputHash: string }>();
      cache.set('a', { outputs: { 0: 1 }, inputHash: '1' });
      cache.set('b', { outputs: { 0: 2 }, inputHash: '2' });
      cache.set('c', { outputs: { 0: 3 }, inputHash: '3' });

      const conns = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
      };

      invalidateDownstream('b', conns, cache);
      expect(cache.has('a')).toBe(true);  // upstream, not affected
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);  // not downstream of b
    });
  });

  // -----------------------------------------------------------------------
  // topologicalSort
  // -----------------------------------------------------------------------
  describe('topologicalSort', () => {
    it('returns empty for empty graph', () => {
      expect(topologicalSort({}, {})).toEqual([]);
    });

    it('single node in one wave', () => {
      const nodes = { s: makeNode('s', 'source') };
      const waves = topologicalSort(nodes, {});
      expect(waves).toEqual([['s']]);
    });

    it('linear chain produces correct wave order', () => {
      const nodes = {
        a: makeNode('a', 'source'),
        b: makeNode('b', 'transform'),
        c: makeNode('c', 'output'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'c', 0),
      };
      const waves = topologicalSort(nodes, conns);
      expect(waves.length).toBe(3);
      expect(waves[0]).toContain('a');
      expect(waves[1]).toContain('b');
      expect(waves[2]).toContain('c');
    });

    it('parallel paths produce correct waves', () => {
      const nodes = {
        s1: makeNode('s1', 'source'),
        s2: makeNode('s2', 'source'),
        o: makeNode('o', 'output'),
      };
      const conns = {
        c1: makeConn('c1', 's1', 0, 'o', 0),
        c2: makeConn('c2', 's2', 0, 'o', 1),
      };
      const waves = topologicalSort(nodes, conns);
      // s1 and s2 in wave 0, o in wave 1
      expect(waves[0]).toContain('s1');
      expect(waves[0]).toContain('s2');
      expect(waves[1]).toContain('o');
    });

    it('detects cycle and throws', () => {
      const nodes = {
        a: makeNode('a', 'transform'),
        b: makeNode('b', 'transform'),
      };
      const conns = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'a', 0),
      };
      expect(() => topologicalSort(nodes, conns)).toThrow('cycle');
    });

    it('diamond graph: node with multiple parents is not duplicated', () => {
      const nodes = {
        s: makeNode('s', 'source'),
        a: makeNode('a', 'transform'),
        b: makeNode('b', 'transform'),
        d: makeNode('d', 'math', { operation: 'add' }),
      };
      const conns = {
        c1: makeConn('c1', 's', 0, 'a', 0),
        c2: makeConn('c2', 's', 0, 'b', 0),
        c3: makeConn('c3', 'a', 0, 'd', 0),
        c4: makeConn('c4', 'b', 0, 'd', 1),
      };
      const waves = topologicalSort(nodes, conns);
      const allNodes = waves.flat();
      // No duplicates
      expect(allNodes.length).toBe(new Set(allNodes).size);
      expect(allNodes).toContain('d');
    });
  });
});

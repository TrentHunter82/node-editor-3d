/**
 * Switch node processor tests + array-reduce placeholders.
 *
 * The switch processor matches a value against up to 4 cases (strict ===)
 * and returns the first matching case value, or the default.
 *
 * Processor:
 *   switch: (_node, inputs) => {
 *     const value = inputs[0];
 *     for (let i = 1; i <= 4; i++) {
 *       if (inputs[i] !== undefined && inputs[i] === value) {
 *         return { 0: inputs[i] };
 *       }
 *     }
 *     return { 0: inputs[5] ?? null };
 *   }
 */
import { describe, it, expect } from 'vitest';
import { executeGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// --- Helpers ---

function makeNode(
  id: string,
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {}
): EditorNode {
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

function out(r: ReturnType<typeof exec>, nodeId: string, port = 0): unknown {
  return r.results.get(nodeId)?.outputs[port];
}

// ============================================================
// switch processor
// ============================================================
describe('switch processor', () => {
  // --- Basic matching ---

  it('matches value against case0 and returns it', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 42 }),
      c0: makeNode('c0', 'source', { value: 42 }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
    };
    expect(out(exec(nodes, conns), 'sw')).toBe(42);
  });

  it('returns default when no case matches', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 99 }),
      c0: makeNode('c0', 'source', { value: 1 }),
      c1: makeNode('c1', 'source', { value: 2 }),
      def: makeNode('def', 'source', { value: 'fallback' }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
      k5: makeConn('k5', 'def', 0, 'sw', 5),
    };
    expect(out(exec(nodes, conns), 'sw')).toBe('fallback');
  });

  it('matches string value against a string case', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 'hello' }),
      c0: makeNode('c0', 'source', { value: 'world' }),
      c1: makeNode('c1', 'source', { value: 'hello' }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
    };
    expect(out(exec(nodes, conns), 'sw')).toBe('hello');
  });

  it('returns null when no cases connected and no default', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 5 }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
    };
    expect(out(exec(nodes, conns), 'sw')).toBeNull();
  });

  it('uses strict equality - number 1 does not match string "1"', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 1 }),
      c0: makeNode('c0', 'source', { value: '1' }),
      def: makeNode('def', 'source', { value: 'default' }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k5: makeConn('k5', 'def', 0, 'sw', 5),
    };
    // Strict equality: 1 !== '1', so default is returned
    expect(out(exec(nodes, conns), 'sw')).toBe('default');
  });

  it('matches first case when multiple cases have same value', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 10 }),
      c0: makeNode('c0', 'source', { value: 10 }),
      c1: makeNode('c1', 'source', { value: 10 }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
    };
    // Both case0 and case1 are 10; processor iterates 1..4, so case0 (port 1) wins
    expect(out(exec(nodes, conns), 'sw')).toBe(10);
  });

  it('matches boolean true value against boolean true case', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: true }),
      c0: makeNode('c0', 'source', { value: false }),
      c1: makeNode('c1', 'source', { value: true }),
      def: makeNode('def', 'source', { value: 'miss' }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
      k5: makeConn('k5', 'def', 0, 'sw', 5),
    };
    expect(out(exec(nodes, conns), 'sw')).toBe(true);
  });

  it('matches boolean false value against boolean false case', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: false }),
      c0: makeNode('c0', 'source', { value: true }),
      c1: makeNode('c1', 'source', { value: false }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
    };
    expect(out(exec(nodes, conns), 'sw')).toBe(false);
  });

  it('matches zero value against zero case', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 0 }),
      c0: makeNode('c0', 'source', { value: 1 }),
      c1: makeNode('c1', 'source', { value: 0 }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
    };
    expect(out(exec(nodes, conns), 'sw')).toBe(0);
  });

  it('matches empty string against empty string case', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: '' }),
      c0: makeNode('c0', 'source', { value: 'nonempty' }),
      c1: makeNode('c1', 'source', { value: '' }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
    };
    expect(out(exec(nodes, conns), 'sw')).toBe('');
  });

  it('skips disconnected case ports (undefined) and checks later cases', () => {
    // case0 (port 1) disconnected, case1 (port 2) connected with matching value
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 7 }),
      c1: makeNode('c1', 'source', { value: 7 }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      // port 1 (case0) not connected
      k2: makeConn('k2', 'c1', 0, 'sw', 2),  // port 2 = case1
    };
    expect(out(exec(nodes, conns), 'sw')).toBe(7);
  });

  it('uses all 4 case ports and matches on case3', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 'd' }),
      c0: makeNode('c0', 'source', { value: 'a' }),
      c1: makeNode('c1', 'source', { value: 'b' }),
      c2: makeNode('c2', 'source', { value: 'c' }),
      c3: makeNode('c3', 'source', { value: 'd' }),
      def: makeNode('def', 'source', { value: 'none' }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
      k3: makeConn('k3', 'c2', 0, 'sw', 3),
      k4: makeConn('k4', 'c3', 0, 'sw', 4),
      k5: makeConn('k5', 'def', 0, 'sw', 5),
    };
    expect(out(exec(nodes, conns), 'sw')).toBe('d');
  });
});

// ============================================================
// switch + other flow control integration
// ============================================================
describe('switch + flow control integration', () => {
  it('switch output feeds into math (add) node', () => {
    // switch matches 10 -> output 10, then math adds 5
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 10 }),
      c0: makeNode('c0', 'source', { value: 10 }),
      sw: makeNode('sw', 'switch'),
      five: makeNode('five', 'source', { value: 5 }),
      add: makeNode('add', 'math', { operation: 'add' }),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'sw', 0, 'add', 0),
      k3: makeConn('k3', 'five', 0, 'add', 1),
    };
    expect(out(exec(nodes, conns), 'add')).toBe(15);
  });

  it('if-gate and switch produce equivalent result for matching boolean scenario', () => {
    // if-gate: condition=true -> returns 'yes'
    // switch: value=true, case0=true -> returns true (the matched value)
    // They have different semantics but both select a path
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: true }),
      yes: makeNode('yes', 'source', { value: 'yes' }),
      no: makeNode('no', 'source', { value: 'no' }),
      gate: makeNode('gate', 'if-gate'),
      // For switch: match true against case0=true, default='no'
      swCond: makeNode('swCond', 'source', { value: true }),
      swCase: makeNode('swCase', 'source', { value: true }),
      swDef: makeNode('swDef', 'source', { value: 'no' }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      // if-gate wiring
      g0: makeConn('g0', 'cond', 0, 'gate', 0),
      g1: makeConn('g1', 'yes', 0, 'gate', 1),
      g2: makeConn('g2', 'no', 0, 'gate', 2),
      // switch wiring
      s0: makeConn('s0', 'swCond', 0, 'sw', 0),
      s1: makeConn('s1', 'swCase', 0, 'sw', 1),
      s5: makeConn('s5', 'swDef', 0, 'sw', 5),
    };
    const r = exec(nodes, conns);
    // if-gate returns 'yes' (the ifTrue branch value)
    expect(out(r, 'gate')).toBe('yes');
    // switch returns true (the matched case value itself)
    expect(out(r, 'sw')).toBe(true);
  });

  it('select uses switch output as index', () => {
    // switch matches 2 -> outputs 2, which feeds into select as index
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 2 }),
      c0: makeNode('c0', 'source', { value: 2 }),
      sw: makeNode('sw', 'switch'),
      v0: makeNode('v0', 'source', { value: 'alpha' }),
      v1: makeNode('v1', 'source', { value: 'beta' }),
      v2: makeNode('v2', 'source', { value: 'gamma' }),
      sel: makeNode('sel', 'select'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'sw', 0, 'sel', 0),   // switch output -> select index
      k3: makeConn('k3', 'v0', 0, 'sel', 1),
      k4: makeConn('k4', 'v1', 0, 'sel', 2),
      k5: makeConn('k5', 'v2', 0, 'sel', 3),
    };
    // switch outputs 2, select picks value at index 2 = 'gamma'
    expect(out(exec(nodes, conns), 'sel')).toBe('gamma');
  });

  it('switch default returns array value when no case matches', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 'nomatch' }),
      c0: makeNode('c0', 'source', { value: 'x' }),
      // Build default array via create-array
      e0: makeNode('e0', 'source', { value: 1 }),
      e1: makeNode('e1', 'source', { value: 2 }),
      e2: makeNode('e2', 'source', { value: 3 }),
      arr: makeNode('arr', 'create-array'),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      // Wire array into switch default (port 5)
      a0: makeConn('a0', 'e0', 0, 'arr', 0),
      a1: makeConn('a1', 'e1', 0, 'arr', 1),
      a2: makeConn('a2', 'e2', 0, 'arr', 2),
      k5: makeConn('k5', 'arr', 0, 'sw', 5),
    };
    expect(out(exec(nodes, conns), 'sw')).toEqual([1, 2, 3]);
  });

  it('chained switches: first switch output feeds second switch as value', () => {
    // First switch: value=5, case0=5 -> outputs 5
    // Second switch: value=5, case0=3, case1=5 -> outputs 5
    const nodes: Record<string, EditorNode> = {
      val1: makeNode('val1', 'source', { value: 5 }),
      c1_0: makeNode('c1_0', 'source', { value: 5 }),
      sw1: makeNode('sw1', 'switch'),

      c2_0: makeNode('c2_0', 'source', { value: 3 }),
      c2_1: makeNode('c2_1', 'source', { value: 5 }),
      def2: makeNode('def2', 'source', { value: 'miss' }),
      sw2: makeNode('sw2', 'switch'),
    };
    const conns: Record<string, Connection> = {
      // First switch
      a0: makeConn('a0', 'val1', 0, 'sw1', 0),
      a1: makeConn('a1', 'c1_0', 0, 'sw1', 1),
      // Chain: sw1 output -> sw2 value
      b0: makeConn('b0', 'sw1', 0, 'sw2', 0),
      b1: makeConn('b1', 'c2_0', 0, 'sw2', 1),
      b2: makeConn('b2', 'c2_1', 0, 'sw2', 2),
      b5: makeConn('b5', 'def2', 0, 'sw2', 5),
    };
    const r = exec(nodes, conns);
    expect(out(r, 'sw1')).toBe(5);
    expect(out(r, 'sw2')).toBe(5);
  });
});

// ============================================================
// array-reduce
// ============================================================
describe('array-reduce processor', () => {
  it('reduces array with sum expression (default)', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      s2: makeNode('s2', 'source', { value: 3 }),
      arr: makeNode('arr', 'create-array'),
      red: makeNode('red', 'array-reduce', { expression: 'acc + x' }),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      a1: makeConn('a1', 's1', 0, 'arr', 1),
      a2: makeConn('a2', 's2', 0, 'arr', 2),
      r0: makeConn('r0', 'arr', 0, 'red', 0),
    };
    // 0 + 1 + 2 + 3 = 6 (default initial = 0)
    expect(out(exec(nodes, conns), 'red')).toBe(6);
  });

  it('reduces array with initial value', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 10 }),
      s1: makeNode('s1', 'source', { value: 20 }),
      arr: makeNode('arr', 'create-array'),
      init: makeNode('init', 'source', { value: 100 }),
      red: makeNode('red', 'array-reduce', { expression: 'acc + x' }),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      a1: makeConn('a1', 's1', 0, 'arr', 1),
      r0: makeConn('r0', 'arr', 0, 'red', 0),
      r1: makeConn('r1', 'init', 0, 'red', 1),
    };
    // 100 + 10 + 20 = 130
    expect(out(exec(nodes, conns), 'red')).toBe(130);
  });

  it('handles empty array with initial value', () => {
    const nodes: Record<string, EditorNode> = {
      init: makeNode('init', 'source', { value: 42 }),
      red: makeNode('red', 'array-reduce', { expression: 'acc + x' }),
    };
    const conns: Record<string, Connection> = {
      r1: makeConn('r1', 'init', 0, 'red', 1),
    };
    // Empty array → returns initial value
    expect(out(exec(nodes, conns), 'red')).toBe(42);
  });

  it('reduces with product expression', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 2 }),
      s1: makeNode('s1', 'source', { value: 3 }),
      s2: makeNode('s2', 'source', { value: 4 }),
      arr: makeNode('arr', 'create-array'),
      init: makeNode('init', 'source', { value: 1 }),
      red: makeNode('red', 'array-reduce', { expression: 'acc * x' }),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      a1: makeConn('a1', 's1', 0, 'arr', 1),
      a2: makeConn('a2', 's2', 0, 'arr', 2),
      r0: makeConn('r0', 'arr', 0, 'red', 0),
      r1: makeConn('r1', 'init', 0, 'red', 1),
    };
    // 1 * 2 * 3 * 4 = 24
    expect(out(exec(nodes, conns), 'red')).toBe(24);
  });

  it('can access index parameter i', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 'a' }),
      s1: makeNode('s1', 'source', { value: 'b' }),
      s2: makeNode('s2', 'source', { value: 'c' }),
      arr: makeNode('arr', 'create-array'),
      red: makeNode('red', 'array-reduce', { expression: 'acc + i' }),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      a1: makeConn('a1', 's1', 0, 'arr', 1),
      a2: makeConn('a2', 's2', 0, 'arr', 2),
      r0: makeConn('r0', 'arr', 0, 'red', 0),
    };
    // 0 + 0 + 1 + 2 = 3
    expect(out(exec(nodes, conns), 'red')).toBe(3);
  });

  it('string accumulation', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 'a' }),
      s1: makeNode('s1', 'source', { value: 'b' }),
      s2: makeNode('s2', 'source', { value: 'c' }),
      arr: makeNode('arr', 'create-array'),
      init: makeNode('init', 'source', { value: '' }),
      red: makeNode('red', 'array-reduce', { expression: 'acc + x' }),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      a1: makeConn('a1', 's1', 0, 'arr', 1),
      a2: makeConn('a2', 's2', 0, 'arr', 2),
      r0: makeConn('r0', 'arr', 0, 'red', 0),
      r1: makeConn('r1', 'init', 0, 'red', 1),
    };
    expect(out(exec(nodes, conns), 'red')).toBe('abc');
  });

  it('throws on invalid expression', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      arr: makeNode('arr', 'create-array'),
      red: makeNode('red', 'array-reduce', { expression: 'if while' }),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      r0: makeConn('r0', 'arr', 0, 'red', 0),
    };
    const r = exec(nodes, conns);
    // Execution should produce an error for the reduce node
    expect(r.errors.size).toBeGreaterThan(0);
  });

  it('handles non-array input as empty array', () => {
    const nodes: Record<string, EditorNode> = {
      num: makeNode('num', 'source', { value: 42 }),
      init: makeNode('init', 'source', { value: 99 }),
      red: makeNode('red', 'array-reduce', { expression: 'acc + x' }),
    };
    const conns: Record<string, Connection> = {
      r0: makeConn('r0', 'num', 0, 'red', 0),
      r1: makeConn('r1', 'init', 0, 'red', 1),
    };
    // Non-array input → treated as [] → returns initial value
    expect(out(exec(nodes, conns), 'red')).toBe(99);
  });
});

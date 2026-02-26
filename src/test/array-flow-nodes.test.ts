/**
 * Array manipulation & flow control node processor tests
 * Tests all 9 processors: create-array, get-element, set-element, array-length,
 * array-push, array-filter, array-map, if-gate, select
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

function makeConn(
  id: string,
  src: string,
  srcPort: number,
  tgt: string,
  tgtPort: number
): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

function exec(nodes: Record<string, EditorNode>, connections: Record<string, Connection> = {}) {
  return executeGraph(nodes, connections);
}

function out(r: ReturnType<typeof exec>, nodeId: string, port = 0): unknown {
  return r.results.get(nodeId)?.outputs[port];
}

// ============================================================
// create-array
// ============================================================
describe('create-array processor', () => {
  it('creates array from 4 connected source values', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 10 }),
      s1: makeNode('s1', 'source', { value: 20 }),
      s2: makeNode('s2', 'source', { value: 30 }),
      s3: makeNode('s3', 'source', { value: 40 }),
      arr: makeNode('arr', 'create-array'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
      c3: makeConn('c3', 's3', 0, 'arr', 3),
    };
    expect(out(exec(nodes, conns), 'arr')).toEqual([10, 20, 30, 40]);
  });

  it('creates array from partial inputs (skips undefined)', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 'a' }),
      s2: makeNode('s2', 'source', { value: 'c' }),
      arr: makeNode('arr', 'create-array'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
    };
    // item0='a', item1=undefined (skipped), item2='c', item3=undefined (skipped)
    expect(out(exec(nodes, conns), 'arr')).toEqual(['a', 'c']);
  });

  it('creates empty array when no inputs connected', () => {
    const r = exec({ arr: makeNode('arr', 'create-array') });
    expect(out(r, 'arr')).toEqual([]);
  });

  it('includes falsy values like 0 and empty string', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 0 }),
      s1: makeNode('s1', 'source', { value: '' }),
      s2: makeNode('s2', 'source', { value: false }),
      arr: makeNode('arr', 'create-array'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
    };
    expect(out(exec(nodes, conns), 'arr')).toEqual([0, '', false]);
  });
});

// ============================================================
// get-element
// ============================================================
describe('get-element processor', () => {
  it('gets element at index 0', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 42 }),
      arr: makeNode('arr', 'create-array'),
      get: makeNode('get', 'get-element'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 's', 0, 'arr', 0),
      c2: makeConn('c2', 'arr', 0, 'get', 0),
    };
    expect(out(exec(nodes, conns), 'get')).toBe(42);
  });

  it('gets element at specified index', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 'a' }),
      s1: makeNode('s1', 'source', { value: 'b' }),
      s2: makeNode('s2', 'source', { value: 'c' }),
      arr: makeNode('arr', 'create-array'),
      idx: makeNode('idx', 'source', { value: 2 }),
      get: makeNode('get', 'get-element'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
      c3: makeConn('c3', 'arr', 0, 'get', 0),
      c4: makeConn('c4', 'idx', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBe('c');
  });

  it('returns null for out-of-bounds index', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 10 }),
      arr: makeNode('arr', 'create-array'),
      idx: makeNode('idx', 'source', { value: 99 }),
      get: makeNode('get', 'get-element'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'get', 0),
      c2: makeConn('c2', 'idx', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBeNull();
  });

  it('floors fractional index', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 'first' }),
      s1: makeNode('s1', 'source', { value: 'second' }),
      arr: makeNode('arr', 'create-array'),
      idx: makeNode('idx', 'source', { value: 1.9 }),
      get: makeNode('get', 'get-element'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 'arr', 0, 'get', 0),
      c3: makeConn('c3', 'idx', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBe('second');
  });

  it('treats non-array input as empty array', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'not an array' }),
      get: makeNode('get', 'get-element'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 's', 0, 'get', 0),
    };
    expect(out(exec(nodes, conns), 'get')).toBeNull();
  });
});

// ============================================================
// set-element
// ============================================================
describe('set-element processor', () => {
  it('sets element at given index', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 'a' }),
      s1: makeNode('s1', 'source', { value: 'b' }),
      arr: makeNode('arr', 'create-array'),
      idx: makeNode('idx', 'source', { value: 1 }),
      val: makeNode('val', 'source', { value: 'X' }),
      set: makeNode('set', 'set-element'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 'arr', 0, 'set', 0),
      c3: makeConn('c3', 'idx', 0, 'set', 1),
      c4: makeConn('c4', 'val', 0, 'set', 2),
    };
    expect(out(exec(nodes, conns), 'set')).toEqual(['a', 'X']);
  });

  it('extends array when index is beyond length', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'only' }),
      arr: makeNode('arr', 'create-array'),
      idx: makeNode('idx', 'source', { value: 3 }),
      val: makeNode('val', 'source', { value: 'extended' }),
      set: makeNode('set', 'set-element'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'set', 0),
      c2: makeConn('c2', 'idx', 0, 'set', 1),
      c3: makeConn('c3', 'val', 0, 'set', 2),
    };
    expect(out(exec(nodes, conns), 'set')).toEqual(['only', null, null, 'extended']);
  });

  it('does not mutate original array (returns copy)', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 1 }),
      arr: makeNode('arr', 'create-array'),
      idx: makeNode('idx', 'source', { value: 0 }),
      val: makeNode('val', 'source', { value: 99 }),
      set: makeNode('set', 'set-element'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'set', 0),
      c2: makeConn('c2', 'idx', 0, 'set', 1),
      c3: makeConn('c3', 'val', 0, 'set', 2),
    };
    const r = exec(nodes, conns);
    expect(out(r, 'arr')).toEqual([1]); // original unchanged
    expect(out(r, 'set')).toEqual([99]); // set has modified copy
  });

  it('treats non-array input as empty array', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'not array' }),
      idx: makeNode('idx', 'source', { value: 0 }),
      val: makeNode('val', 'source', { value: 'hello' }),
      set: makeNode('set', 'set-element'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'set', 0),
      c1: makeConn('c1', 'idx', 0, 'set', 1),
      c2: makeConn('c2', 'val', 0, 'set', 2),
    };
    expect(out(exec(nodes, conns), 'set')).toEqual(['hello']);
  });
});

// ============================================================
// array-length
// ============================================================
describe('array-length processor', () => {
  it('returns length of array', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      s2: makeNode('s2', 'source', { value: 3 }),
      arr: makeNode('arr', 'create-array'),
      len: makeNode('len', 'array-length'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
      c3: makeConn('c3', 'arr', 0, 'len', 0),
    };
    expect(out(exec(nodes, conns), 'len')).toBe(3);
  });

  it('returns 0 for empty array', () => {
    const nodes: Record<string, EditorNode> = {
      arr: makeNode('arr', 'create-array'),
      len: makeNode('len', 'array-length'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'arr', 0, 'len', 0),
    };
    expect(out(exec(nodes, conns), 'len')).toBe(0);
  });

  it('returns 0 for non-array input', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 42 }),
      len: makeNode('len', 'array-length'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 's', 0, 'len', 0),
    };
    expect(out(exec(nodes, conns), 'len')).toBe(0);
  });
});

// ============================================================
// array-push
// ============================================================
describe('array-push processor', () => {
  it('pushes value onto array', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 1 }),
      arr: makeNode('arr', 'create-array'),
      val: makeNode('val', 'source', { value: 99 }),
      push: makeNode('push', 'array-push'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'push', 0),
      c2: makeConn('c2', 'val', 0, 'push', 1),
    };
    expect(out(exec(nodes, conns), 'push')).toEqual([1, 99]);
  });

  it('pushes null when value input is undefined', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'a' }),
      arr: makeNode('arr', 'create-array'),
      push: makeNode('push', 'array-push'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'push', 0),
    };
    expect(out(exec(nodes, conns), 'push')).toEqual(['a', null]);
  });

  it('does not mutate original array', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 1 }),
      arr: makeNode('arr', 'create-array'),
      val: makeNode('val', 'source', { value: 2 }),
      push: makeNode('push', 'array-push'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'push', 0),
      c2: makeConn('c2', 'val', 0, 'push', 1),
    };
    const r = exec(nodes, conns);
    expect(out(r, 'arr')).toEqual([1]);
    expect(out(r, 'push')).toEqual([1, 2]);
  });

  it('creates new array from non-array input', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'not array' }),
      val: makeNode('val', 'source', { value: 'hello' }),
      push: makeNode('push', 'array-push'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'push', 0),
      c1: makeConn('c1', 'val', 0, 'push', 1),
    };
    expect(out(exec(nodes, conns), 'push')).toEqual(['hello']);
  });
});

// ============================================================
// array-filter
// ============================================================
describe('array-filter processor', () => {
  it('filters with default expression (x !== null)', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      arr: makeNode('arr', 'create-array'),
      filt: makeNode('filt', 'array-filter'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 'arr', 0, 'filt', 0),
    };
    expect(out(exec(nodes, conns), 'filt')).toEqual([1, 2]);
  });

  it('filters with custom expression', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 5 }),
      s2: makeNode('s2', 'source', { value: 3 }),
      s3: makeNode('s3', 'source', { value: 10 }),
      arr: makeNode('arr', 'create-array'),
      filt: makeNode('filt', 'array-filter', { expression: 'x > 3' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
      c3: makeConn('c3', 's3', 0, 'arr', 3),
      c4: makeConn('c4', 'arr', 0, 'filt', 0),
    };
    expect(out(exec(nodes, conns), 'filt')).toEqual([5, 10]);
  });

  it('provides index parameter (i) in expression', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 'a' }),
      s1: makeNode('s1', 'source', { value: 'b' }),
      s2: makeNode('s2', 'source', { value: 'c' }),
      arr: makeNode('arr', 'create-array'),
      filt: makeNode('filt', 'array-filter', { expression: 'i % 2 === 0' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
      c3: makeConn('c3', 'arr', 0, 'filt', 0),
    };
    expect(out(exec(nodes, conns), 'filt')).toEqual(['a', 'c']);
  });

  it('propagates expression error to error map', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      arr: makeNode('arr', 'create-array'),
      filt: makeNode('filt', 'array-filter', { expression: '###invalid###' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 'arr', 0, 'filt', 0),
    };
    const result = exec(nodes, conns);
    expect(result.errors.has('filt')).toBe(true);
    expect(result.errors.get('filt')).toContain('Array filter compile error');
  });

  it('handles empty array', () => {
    const nodes: Record<string, EditorNode> = {
      arr: makeNode('arr', 'create-array'),
      filt: makeNode('filt', 'array-filter', { expression: 'x > 0' }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'arr', 0, 'filt', 0),
    };
    expect(out(exec(nodes, conns), 'filt')).toEqual([]);
  });
});

// ============================================================
// array-map
// ============================================================
describe('array-map processor', () => {
  it('maps with default expression (identity)', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      arr: makeNode('arr', 'create-array'),
      map: makeNode('map', 'array-map'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 'arr', 0, 'map', 0),
    };
    expect(out(exec(nodes, conns), 'map')).toEqual([1, 2]);
  });

  it('maps with arithmetic expression', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 2 }),
      s1: makeNode('s1', 'source', { value: 5 }),
      s2: makeNode('s2', 'source', { value: 10 }),
      arr: makeNode('arr', 'create-array'),
      map: makeNode('map', 'array-map', { expression: 'x * 3' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
      c3: makeConn('c3', 'arr', 0, 'map', 0),
    };
    expect(out(exec(nodes, conns), 'map')).toEqual([6, 15, 30]);
  });

  it('provides index parameter (i) in expression', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 'a' }),
      s1: makeNode('s1', 'source', { value: 'b' }),
      arr: makeNode('arr', 'create-array'),
      map: makeNode('map', 'array-map', { expression: 'x + i' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 'arr', 0, 'map', 0),
    };
    expect(out(exec(nodes, conns), 'map')).toEqual(['a0', 'b1']);
  });

  it('propagates expression error to error map', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 5 }),
      arr: makeNode('arr', 'create-array'),
      map: makeNode('map', 'array-map', { expression: 'throw new Error()' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'map', 0),
    };
    const result = exec(nodes, conns);
    expect(result.errors.has('map')).toBe(true);
    expect(result.errors.get('map')).toContain('Array map compile error');
  });

  it('handles empty array', () => {
    const nodes: Record<string, EditorNode> = {
      arr: makeNode('arr', 'create-array'),
      map: makeNode('map', 'array-map', { expression: 'x + 1' }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'arr', 0, 'map', 0),
    };
    expect(out(exec(nodes, conns), 'map')).toEqual([]);
  });
});

// ============================================================
// if-gate
// ============================================================
describe('if-gate processor', () => {
  it('returns true-branch when condition is truthy', () => {
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: 1 }),
      t: makeNode('t', 'source', { value: 'yes' }),
      f: makeNode('f', 'source', { value: 'no' }),
      gate: makeNode('gate', 'if-gate'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'cond', 0, 'gate', 0),
      c1: makeConn('c1', 't', 0, 'gate', 1),
      c2: makeConn('c2', 'f', 0, 'gate', 2),
    };
    expect(out(exec(nodes, conns), 'gate')).toBe('yes');
  });

  it('returns false-branch when condition is falsy', () => {
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: 0 }),
      t: makeNode('t', 'source', { value: 'yes' }),
      f: makeNode('f', 'source', { value: 'no' }),
      gate: makeNode('gate', 'if-gate'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'cond', 0, 'gate', 0),
      c1: makeConn('c1', 't', 0, 'gate', 1),
      c2: makeConn('c2', 'f', 0, 'gate', 2),
    };
    expect(out(exec(nodes, conns), 'gate')).toBe('no');
  });

  it('handles boolean true condition', () => {
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: true }),
      t: makeNode('t', 'source', { value: 100 }),
      f: makeNode('f', 'source', { value: -1 }),
      gate: makeNode('gate', 'if-gate'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'cond', 0, 'gate', 0),
      c1: makeConn('c1', 't', 0, 'gate', 1),
      c2: makeConn('c2', 'f', 0, 'gate', 2),
    };
    expect(out(exec(nodes, conns), 'gate')).toBe(100);
  });

  it('treats empty string as falsy', () => {
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: '' }),
      t: makeNode('t', 'source', { value: 'A' }),
      f: makeNode('f', 'source', { value: 'B' }),
      gate: makeNode('gate', 'if-gate'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'cond', 0, 'gate', 0),
      c1: makeConn('c1', 't', 0, 'gate', 1),
      c2: makeConn('c2', 'f', 0, 'gate', 2),
    };
    expect(out(exec(nodes, conns), 'gate')).toBe('B');
  });

  it('treats non-empty string as truthy', () => {
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: 'hello' }),
      t: makeNode('t', 'source', { value: 'A' }),
      f: makeNode('f', 'source', { value: 'B' }),
      gate: makeNode('gate', 'if-gate'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'cond', 0, 'gate', 0),
      c1: makeConn('c1', 't', 0, 'gate', 1),
      c2: makeConn('c2', 'f', 0, 'gate', 2),
    };
    expect(out(exec(nodes, conns), 'gate')).toBe('A');
  });

  it('returns undefined branches when not connected', () => {
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: true }),
      gate: makeNode('gate', 'if-gate'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'cond', 0, 'gate', 0),
    };
    expect(out(exec(nodes, conns), 'gate')).toBeUndefined();
  });
});

// ============================================================
// select
// ============================================================
describe('select processor', () => {
  it('selects value at index 0', () => {
    const nodes: Record<string, EditorNode> = {
      idx: makeNode('idx', 'source', { value: 0 }),
      v0: makeNode('v0', 'source', { value: 'A' }),
      v1: makeNode('v1', 'source', { value: 'B' }),
      v2: makeNode('v2', 'source', { value: 'C' }),
      v3: makeNode('v3', 'source', { value: 'D' }),
      sel: makeNode('sel', 'select'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'idx', 0, 'sel', 0),
      c1: makeConn('c1', 'v0', 0, 'sel', 1),
      c2: makeConn('c2', 'v1', 0, 'sel', 2),
      c3: makeConn('c3', 'v2', 0, 'sel', 3),
      c4: makeConn('c4', 'v3', 0, 'sel', 4),
    };
    expect(out(exec(nodes, conns), 'sel')).toBe('A');
  });

  it('selects value at index 3', () => {
    const nodes: Record<string, EditorNode> = {
      idx: makeNode('idx', 'source', { value: 3 }),
      v0: makeNode('v0', 'source', { value: 'A' }),
      v3: makeNode('v3', 'source', { value: 'D' }),
      sel: makeNode('sel', 'select'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'idx', 0, 'sel', 0),
      c1: makeConn('c1', 'v0', 0, 'sel', 1),
      c4: makeConn('c4', 'v3', 0, 'sel', 4),
    };
    expect(out(exec(nodes, conns), 'sel')).toBe('D');
  });

  it('clamps negative index to 0', () => {
    const nodes: Record<string, EditorNode> = {
      idx: makeNode('idx', 'source', { value: -5 }),
      v0: makeNode('v0', 'source', { value: 'first' }),
      sel: makeNode('sel', 'select'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'idx', 0, 'sel', 0),
      c1: makeConn('c1', 'v0', 0, 'sel', 1),
    };
    expect(out(exec(nodes, conns), 'sel')).toBe('first');
  });

  it('clamps high index to 3', () => {
    const nodes: Record<string, EditorNode> = {
      idx: makeNode('idx', 'source', { value: 100 }),
      v3: makeNode('v3', 'source', { value: 'last' }),
      sel: makeNode('sel', 'select'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'idx', 0, 'sel', 0),
      c4: makeConn('c4', 'v3', 0, 'sel', 4),
    };
    expect(out(exec(nodes, conns), 'sel')).toBe('last');
  });

  it('floors fractional index', () => {
    const nodes: Record<string, EditorNode> = {
      idx: makeNode('idx', 'source', { value: 1.7 }),
      v0: makeNode('v0', 'source', { value: 'A' }),
      v1: makeNode('v1', 'source', { value: 'B' }),
      sel: makeNode('sel', 'select'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'idx', 0, 'sel', 0),
      c1: makeConn('c1', 'v0', 0, 'sel', 1),
      c2: makeConn('c2', 'v1', 0, 'sel', 2),
    };
    expect(out(exec(nodes, conns), 'sel')).toBe('B');
  });

  it('returns null when selected slot is not connected', () => {
    const nodes: Record<string, EditorNode> = {
      idx: makeNode('idx', 'source', { value: 2 }),
      sel: makeNode('sel', 'select'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'idx', 0, 'sel', 0),
    };
    expect(out(exec(nodes, conns), 'sel')).toBeNull();
  });

  it('defaults to index 0 for non-number input', () => {
    const nodes: Record<string, EditorNode> = {
      idx: makeNode('idx', 'source', { value: 'not a number' }),
      v0: makeNode('v0', 'source', { value: 'first' }),
      sel: makeNode('sel', 'select'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'idx', 0, 'sel', 0),
      c1: makeConn('c1', 'v0', 0, 'sel', 1),
    };
    expect(out(exec(nodes, conns), 'sel')).toBe('first');
  });
});

// ============================================================
// Integration: chained array operations
// ============================================================
describe('array pipeline integration', () => {
  it('create → push → get-element chain', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 10 }),
      arr: makeNode('arr', 'create-array'),
      val: makeNode('val', 'source', { value: 20 }),
      push: makeNode('push', 'array-push'),
      idx: makeNode('idx', 'source', { value: 1 }),
      get: makeNode('get', 'get-element'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'push', 0),
      c2: makeConn('c2', 'val', 0, 'push', 1),
      c3: makeConn('c3', 'push', 0, 'get', 0),
      c4: makeConn('c4', 'idx', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBe(20);
  });

  it('create → map → filter → length chain', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      s2: makeNode('s2', 'source', { value: 3 }),
      s3: makeNode('s3', 'source', { value: 4 }),
      arr: makeNode('arr', 'create-array'),
      map: makeNode('map', 'array-map', { expression: 'x * 2' }),
      filt: makeNode('filt', 'array-filter', { expression: 'x > 5' }),
      len: makeNode('len', 'array-length'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's0', 0, 'arr', 0),
      c1: makeConn('c1', 's1', 0, 'arr', 1),
      c2: makeConn('c2', 's2', 0, 'arr', 2),
      c3: makeConn('c3', 's3', 0, 'arr', 3),
      c4: makeConn('c4', 'arr', 0, 'map', 0),
      c5: makeConn('c5', 'map', 0, 'filt', 0),
      c6: makeConn('c6', 'filt', 0, 'len', 0),
    };
    // [1,2,3,4] → map(*2) → [2,4,6,8] → filter(>5) → [6,8] → length → 2
    expect(out(exec(nodes, conns), 'len')).toBe(2);
  });

  it('if-gate selects between two array operations', () => {
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: true }),
      s: makeNode('s', 'source', { value: 5 }),
      arr: makeNode('arr', 'create-array'),
      len: makeNode('len', 'array-length'),
      val: makeNode('val', 'source', { value: 'other' }),
      gate: makeNode('gate', 'if-gate'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 's', 0, 'arr', 0),
      c1: makeConn('c1', 'arr', 0, 'len', 0),
      c2: makeConn('c2', 'cond', 0, 'gate', 0),
      c3: makeConn('c3', 'len', 0, 'gate', 1),
      c4: makeConn('c4', 'val', 0, 'gate', 2),
    };
    expect(out(exec(nodes, conns), 'gate')).toBe(1);
  });
});

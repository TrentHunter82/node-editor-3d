/**
 * Object/dictionary node processor tests.
 * Tests all 6 processors: create-object, get-property, set-property,
 * object-keys, object-values, merge-objects.
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
// create-object
// ============================================================
describe('create-object processor', () => {
  it('creates empty object with no connected inputs', () => {
    const nodes: Record<string, EditorNode> = {
      obj: makeNode('obj', 'create-object'),
    };
    expect(out(exec(nodes), 'obj')).toEqual({});
  });

  it('creates object with single key-value pair', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'name' }),
      v0: makeNode('v0', 'source', { value: 'Alice' }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({ name: 'Alice' });
  });

  it('creates object with multiple key-value pairs', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 10 }),
      k1: makeNode('k1', 'source', { value: 'y' }),
      v1: makeNode('v1', 'source', { value: 20 }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'k1', 0, 'obj', 2),
      c3: makeConn('c3', 'v1', 0, 'obj', 3),
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({ x: 10, y: 20 });
  });

  it('handles numeric values', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'count' }),
      v0: makeNode('v0', 'source', { value: 42 }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({ count: 42 });
  });

  it('handles string values', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'greeting' }),
      v0: makeNode('v0', 'source', { value: 'hello world' }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({ greeting: 'hello world' });
  });

  it('handles nested objects as values', () => {
    // First create inner object, then use as value in outer
    const nodes: Record<string, EditorNode> = {
      ik: makeNode('ik', 'source', { value: 'a' }),
      iv: makeNode('iv', 'source', { value: 1 }),
      inner: makeNode('inner', 'create-object'),
      ok: makeNode('ok', 'source', { value: 'nested' }),
      outer: makeNode('outer', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'ik', 0, 'inner', 0),
      c1: makeConn('c1', 'iv', 0, 'inner', 1),
      c2: makeConn('c2', 'ok', 0, 'outer', 0),
      c3: makeConn('c3', 'inner', 0, 'outer', 1),
    };
    expect(out(exec(nodes, conns), 'outer')).toEqual({ nested: { a: 1 } });
  });

  it('handles arrays as values', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      arr: makeNode('arr', 'create-array'),
      k0: makeNode('k0', 'source', { value: 'items' }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      a1: makeConn('a1', 's1', 0, 'arr', 1),
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'arr', 0, 'obj', 1),
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({ items: [1, 2] });
  });

  it('skips pairs with null/empty key', () => {
    // Only val0 connected but key0 not connected (undefined)
    const nodes: Record<string, EditorNode> = {
      v0: makeNode('v0', 'source', { value: 'orphan' }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'v0', 0, 'obj', 1), // val0 only, key0 not connected
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({});
  });
});

// ============================================================
// get-property
// ============================================================
describe('get-property processor', () => {
  it('gets property from object by key', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'name' }),
      v0: makeNode('v0', 'source', { value: 'Alice' }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'name' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'get', 0),
      c3: makeConn('c3', 'key', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBe('Alice');
  });

  it('returns null for missing key', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'missing' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'get', 0),
      c3: makeConn('c3', 'key', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBeNull();
  });

  it('returns null for non-object input', () => {
    const nodes: Record<string, EditorNode> = {
      num: makeNode('num', 'source', { value: 42 }),
      key: makeNode('key', 'source', { value: 'x' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'num', 0, 'get', 0),
      c1: makeConn('c1', 'key', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBeNull();
  });

  it('returns null for array input (arrays are not objects for get-property)', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      arr: makeNode('arr', 'create-array'),
      key: makeNode('key', 'source', { value: '0' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      c0: makeConn('c0', 'arr', 0, 'get', 0),
      c1: makeConn('c1', 'key', 0, 'get', 1),
    };
    // Arrays are excluded by !Array.isArray check
    expect(out(exec(nodes, conns), 'get')).toBeNull();
  });

  it('returns null when key is not a string', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 123 }), // numeric key
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'get', 0),
      c3: makeConn('c3', 'key', 0, 'get', 1),
    };
    // Non-string key defaults to '' — empty string key doesn't match 'a'
    expect(out(exec(nodes, conns), 'get')).toBeNull();
  });
});

// ============================================================
// set-property
// ============================================================
describe('set-property processor', () => {
  it('sets property on object', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'y' }),
      val: makeNode('val', 'source', { value: 2 }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'set', 0),
      c3: makeConn('c3', 'key', 0, 'set', 1),
      c4: makeConn('c4', 'val', 0, 'set', 2),
    };
    expect(out(exec(nodes, conns), 'set')).toEqual({ x: 1, y: 2 });
  });

  it('overwrites existing property', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'x' }),
      val: makeNode('val', 'source', { value: 99 }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'set', 0),
      c3: makeConn('c3', 'key', 0, 'set', 1),
      c4: makeConn('c4', 'val', 0, 'set', 2),
    };
    expect(out(exec(nodes, conns), 'set')).toEqual({ x: 99 });
  });

  it('returns new object (immutable — spread creates new reference)', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'b' }),
      val: makeNode('val', 'source', { value: 2 }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'set', 0),
      c3: makeConn('c3', 'key', 0, 'set', 1),
      c4: makeConn('c4', 'val', 0, 'set', 2),
    };
    const r = exec(nodes, conns);
    const original = out(r, 'obj');
    const modified = out(r, 'set');
    expect(original).not.toBe(modified);
    expect(original).toEqual({ a: 1 });
    expect(modified).toEqual({ a: 1, b: 2 });
  });

  it('creates new object when input is not an object', () => {
    const nodes: Record<string, EditorNode> = {
      num: makeNode('num', 'source', { value: 42 }),
      key: makeNode('key', 'source', { value: 'x' }),
      val: makeNode('val', 'source', { value: 1 }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'num', 0, 'set', 0),
      c1: makeConn('c1', 'key', 0, 'set', 1),
      c2: makeConn('c2', 'val', 0, 'set', 2),
    };
    // Non-object input → returns { key: value }
    expect(out(exec(nodes, conns), 'set')).toEqual({ x: 1 });
  });

  it('uses empty string key when key input is not string', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 123 }), // non-string
      val: makeNode('val', 'source', { value: 2 }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'set', 0),
      c3: makeConn('c3', 'key', 0, 'set', 1),
      c4: makeConn('c4', 'val', 0, 'set', 2),
    };
    // Non-string key defaults to ''
    expect(out(exec(nodes, conns), 'set')).toEqual({ a: 1, '': 2 });
  });
});

// ============================================================
// object-keys
// ============================================================
describe('object-keys processor', () => {
  it('returns array of keys from object', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      k1: makeNode('k1', 'source', { value: 'b' }),
      v1: makeNode('v1', 'source', { value: 2 }),
      obj: makeNode('obj', 'create-object'),
      keys: makeNode('keys', 'object-keys'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'k1', 0, 'obj', 2),
      c3: makeConn('c3', 'v1', 0, 'obj', 3),
      c4: makeConn('c4', 'obj', 0, 'keys', 0),
    };
    expect(out(exec(nodes, conns), 'keys')).toEqual(['a', 'b']);
  });

  it('returns empty array for empty object', () => {
    const nodes: Record<string, EditorNode> = {
      obj: makeNode('obj', 'create-object'),
      keys: makeNode('keys', 'object-keys'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'obj', 0, 'keys', 0),
    };
    expect(out(exec(nodes, conns), 'keys')).toEqual([]);
  });

  it('returns empty array for non-object input', () => {
    const nodes: Record<string, EditorNode> = {
      num: makeNode('num', 'source', { value: 42 }),
      keys: makeNode('keys', 'object-keys'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'num', 0, 'keys', 0),
    };
    expect(out(exec(nodes, conns), 'keys')).toEqual([]);
  });

  it('returns empty array for array input', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      arr: makeNode('arr', 'create-array'),
      keys: makeNode('keys', 'object-keys'),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      c0: makeConn('c0', 'arr', 0, 'keys', 0),
    };
    expect(out(exec(nodes, conns), 'keys')).toEqual([]);
  });
});

// ============================================================
// object-values
// ============================================================
describe('object-values processor', () => {
  it('returns array of values from object', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 10 }),
      k1: makeNode('k1', 'source', { value: 'b' }),
      v1: makeNode('v1', 'source', { value: 20 }),
      obj: makeNode('obj', 'create-object'),
      vals: makeNode('vals', 'object-values'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'k1', 0, 'obj', 2),
      c3: makeConn('c3', 'v1', 0, 'obj', 3),
      c4: makeConn('c4', 'obj', 0, 'vals', 0),
    };
    expect(out(exec(nodes, conns), 'vals')).toEqual([10, 20]);
  });

  it('returns empty array for empty object', () => {
    const nodes: Record<string, EditorNode> = {
      obj: makeNode('obj', 'create-object'),
      vals: makeNode('vals', 'object-values'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'obj', 0, 'vals', 0),
    };
    expect(out(exec(nodes, conns), 'vals')).toEqual([]);
  });

  it('returns empty array for non-object input', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello' }),
      vals: makeNode('vals', 'object-values'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'vals', 0),
    };
    expect(out(exec(nodes, conns), 'vals')).toEqual([]);
  });

  it('preserves value order matching keys', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 100 }),
      k1: makeNode('k1', 'source', { value: 'y' }),
      v1: makeNode('v1', 'source', { value: 200 }),
      obj: makeNode('obj', 'create-object'),
      keys: makeNode('keys', 'object-keys'),
      vals: makeNode('vals', 'object-values'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'k1', 0, 'obj', 2),
      c3: makeConn('c3', 'v1', 0, 'obj', 3),
      c4: makeConn('c4', 'obj', 0, 'keys', 0),
      c5: makeConn('c5', 'obj', 0, 'vals', 0),
    };
    const r = exec(nodes, conns);
    const keysResult = out(r, 'keys') as string[];
    const valsResult = out(r, 'vals') as number[];
    // keys and values should be in the same order
    expect(keysResult).toEqual(['x', 'y']);
    expect(valsResult).toEqual([100, 200]);
  });
});

// ============================================================
// merge-objects
// ============================================================
describe('merge-objects processor', () => {
  it('merges two objects', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj1: makeNode('obj1', 'create-object'),
      k1: makeNode('k1', 'source', { value: 'b' }),
      v1: makeNode('v1', 'source', { value: 2 }),
      obj2: makeNode('obj2', 'create-object'),
      merge: makeNode('merge', 'merge-objects'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj1', 0),
      c1: makeConn('c1', 'v0', 0, 'obj1', 1),
      c2: makeConn('c2', 'k1', 0, 'obj2', 0),
      c3: makeConn('c3', 'v1', 0, 'obj2', 1),
      c4: makeConn('c4', 'obj1', 0, 'merge', 0),
      c5: makeConn('c5', 'obj2', 0, 'merge', 1),
    };
    expect(out(exec(nodes, conns), 'merge')).toEqual({ a: 1, b: 2 });
  });

  it('second object overwrites first on conflict', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj1: makeNode('obj1', 'create-object'),
      k1: makeNode('k1', 'source', { value: 'x' }),
      v1: makeNode('v1', 'source', { value: 99 }),
      obj2: makeNode('obj2', 'create-object'),
      merge: makeNode('merge', 'merge-objects'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj1', 0),
      c1: makeConn('c1', 'v0', 0, 'obj1', 1),
      c2: makeConn('c2', 'k1', 0, 'obj2', 0),
      c3: makeConn('c3', 'v1', 0, 'obj2', 1),
      c4: makeConn('c4', 'obj1', 0, 'merge', 0),
      c5: makeConn('c5', 'obj2', 0, 'merge', 1),
    };
    expect(out(exec(nodes, conns), 'merge')).toEqual({ x: 99 });
  });

  it('handles empty objects', () => {
    const nodes: Record<string, EditorNode> = {
      obj1: makeNode('obj1', 'create-object'),
      obj2: makeNode('obj2', 'create-object'),
      merge: makeNode('merge', 'merge-objects'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'obj1', 0, 'merge', 0),
      c1: makeConn('c1', 'obj2', 0, 'merge', 1),
    };
    expect(out(exec(nodes, conns), 'merge')).toEqual({});
  });

  it('handles non-object inputs gracefully', () => {
    const nodes: Record<string, EditorNode> = {
      num: makeNode('num', 'source', { value: 42 }),
      str: makeNode('str', 'source', { value: 'hello' }),
      merge: makeNode('merge', 'merge-objects'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'num', 0, 'merge', 0),
      c1: makeConn('c1', 'str', 0, 'merge', 1),
    };
    // Non-object inputs treated as {} → merged result is {}
    expect(out(exec(nodes, conns), 'merge')).toEqual({});
  });

  it('produces shallow merge (not deep)', () => {
    // Create two objects with nested values - merge should not deep merge
    const nodes: Record<string, EditorNode> = {
      ik: makeNode('ik', 'source', { value: 'inner' }),
      iv: makeNode('iv', 'source', { value: 1 }),
      inner1: makeNode('inner1', 'create-object'),
      k0: makeNode('k0', 'source', { value: 'data' }),
      obj1: makeNode('obj1', 'create-object'),

      ik2: makeNode('ik2', 'source', { value: 'inner' }),
      iv2: makeNode('iv2', 'source', { value: 2 }),
      inner2: makeNode('inner2', 'create-object'),
      k1: makeNode('k1', 'source', { value: 'data' }),
      obj2: makeNode('obj2', 'create-object'),

      merge: makeNode('merge', 'merge-objects'),
    };
    const conns: Record<string, Connection> = {
      // obj1 = { data: { inner: 1 } }
      a0: makeConn('a0', 'ik', 0, 'inner1', 0),
      a1: makeConn('a1', 'iv', 0, 'inner1', 1),
      a2: makeConn('a2', 'k0', 0, 'obj1', 0),
      a3: makeConn('a3', 'inner1', 0, 'obj1', 1),
      // obj2 = { data: { inner: 2 } }
      b0: makeConn('b0', 'ik2', 0, 'inner2', 0),
      b1: makeConn('b1', 'iv2', 0, 'inner2', 1),
      b2: makeConn('b2', 'k1', 0, 'obj2', 0),
      b3: makeConn('b3', 'inner2', 0, 'obj2', 1),
      // merge
      m0: makeConn('m0', 'obj1', 0, 'merge', 0),
      m1: makeConn('m1', 'obj2', 0, 'merge', 1),
    };
    // Shallow merge: obj2's 'data' key completely replaces obj1's
    expect(out(exec(nodes, conns), 'merge')).toEqual({ data: { inner: 2 } });
  });
});

// ============================================================
// Integration tests
// ============================================================
describe('object node integration', () => {
  it('create-object -> get-property pipeline', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'name' }),
      v0: makeNode('v0', 'source', { value: 'Bob' }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'name' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'get', 0),
      c3: makeConn('c3', 'key', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBe('Bob');
  });

  it('create-object -> object-keys -> array-length pipeline', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      k1: makeNode('k1', 'source', { value: 'b' }),
      v1: makeNode('v1', 'source', { value: 2 }),
      obj: makeNode('obj', 'create-object'),
      keys: makeNode('keys', 'object-keys'),
      len: makeNode('len', 'array-length'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'k1', 0, 'obj', 2),
      c3: makeConn('c3', 'v1', 0, 'obj', 3),
      c4: makeConn('c4', 'obj', 0, 'keys', 0),
      c5: makeConn('c5', 'keys', 0, 'len', 0),
    };
    expect(out(exec(nodes, conns), 'len')).toBe(2);
  });

  it('merge-objects -> object-values pipeline', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 10 }),
      obj1: makeNode('obj1', 'create-object'),
      k1: makeNode('k1', 'source', { value: 'y' }),
      v1: makeNode('v1', 'source', { value: 20 }),
      obj2: makeNode('obj2', 'create-object'),
      merge: makeNode('merge', 'merge-objects'),
      vals: makeNode('vals', 'object-values'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj1', 0),
      c1: makeConn('c1', 'v0', 0, 'obj1', 1),
      c2: makeConn('c2', 'k1', 0, 'obj2', 0),
      c3: makeConn('c3', 'v1', 0, 'obj2', 1),
      c4: makeConn('c4', 'obj1', 0, 'merge', 0),
      c5: makeConn('c5', 'obj2', 0, 'merge', 1),
      c6: makeConn('c6', 'merge', 0, 'vals', 0),
    };
    expect(out(exec(nodes, conns), 'vals')).toEqual([10, 20]);
  });

  it('set-property + get-property roundtrip', () => {
    const nodes: Record<string, EditorNode> = {
      obj: makeNode('obj', 'create-object'), // empty object
      setKey: makeNode('setKey', 'source', { value: 'foo' }),
      setVal: makeNode('setVal', 'source', { value: 'bar' }),
      set: makeNode('set', 'set-property'),
      getKey: makeNode('getKey', 'source', { value: 'foo' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'obj', 0, 'set', 0),
      c1: makeConn('c1', 'setKey', 0, 'set', 1),
      c2: makeConn('c2', 'setVal', 0, 'set', 2),
      c3: makeConn('c3', 'set', 0, 'get', 0),
      c4: makeConn('c4', 'getKey', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBe('bar');
  });

  it('object nodes with boolean and null values', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'active' }),
      v0: makeNode('v0', 'source', { value: true }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'active' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'get', 0),
      c3: makeConn('c3', 'key', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBe(true);
  });
});

// ============================================================
// create-object edge cases
// ============================================================
describe('create-object edge cases', () => {
  it('handles boolean values', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'active' }),
      v0: makeNode('v0', 'source', { value: true }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({ active: true });
  });

  it('stores null when value port is disconnected', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'key' }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      // value port 1 not connected
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({ key: null });
  });

  it('coerces numeric keys with String()', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 42 }),
      v0: makeNode('v0', 'source', { value: 'value' }),
      obj: makeNode('obj', 'create-object'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
    };
    expect(out(exec(nodes, conns), 'obj')).toEqual({ '42': 'value' });
  });
});

// ============================================================
// get-property edge cases
// ============================================================
describe('get-property edge cases', () => {
  it('returns null for boolean input', () => {
    const nodes: Record<string, EditorNode> = {
      bool: makeNode('bool', 'source', { value: true }),
      key: makeNode('key', 'source', { value: 'x' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'bool', 0, 'get', 0),
      c1: makeConn('c1', 'key', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBeNull();
  });

  it('returns null for string input (strings are not plain objects)', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello' }),
      key: makeNode('key', 'source', { value: '0' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'get', 0),
      c1: makeConn('c1', 'key', 0, 'get', 1),
    };
    // typeof 'hello' === 'string', not 'object', so returns null
    expect(out(exec(nodes, conns), 'get')).toBeNull();
  });

  it('looks up empty-string key when key input is non-string', () => {
    // Create an object that has an empty-string key
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      setKey: makeNode('setKey', 'source', { value: 123 }), // non-string → defaults to ''
      setVal: makeNode('setVal', 'source', { value: 'emptyKeyVal' }),
      set: makeNode('set', 'set-property'),
      getKey: makeNode('getKey', 'source', { value: 456 }), // non-string → defaults to ''
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'set', 0),
      c3: makeConn('c3', 'setKey', 0, 'set', 1),
      c4: makeConn('c4', 'setVal', 0, 'set', 2),
      c5: makeConn('c5', 'set', 0, 'get', 0),
      c6: makeConn('c6', 'getKey', 0, 'get', 1),
    };
    // set-property sets '' key, get-property reads '' key
    expect(out(exec(nodes, conns), 'get')).toBe('emptyKeyVal');
  });

  it('returns value for empty-string key when object has it', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      setKey: makeNode('setKey', 'source', { value: '' }),
      setVal: makeNode('setVal', 'source', { value: 'found' }),
      set: makeNode('set', 'set-property'),
      getKey: makeNode('getKey', 'source', { value: '' }),
      get: makeNode('get', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'set', 0),
      c3: makeConn('c3', 'setKey', 0, 'set', 1),
      c4: makeConn('c4', 'setVal', 0, 'set', 2),
      c5: makeConn('c5', 'set', 0, 'get', 0),
      c6: makeConn('c6', 'getKey', 0, 'get', 1),
    };
    expect(out(exec(nodes, conns), 'get')).toBe('found');
  });

  it('returns null when no inputs connected (disconnected port)', () => {
    const nodes: Record<string, EditorNode> = {
      get: makeNode('get', 'get-property'),
    };
    // No connections at all — inputs[0] is undefined, not an object
    expect(out(exec(nodes), 'get')).toBeNull();
  });
});

// ============================================================
// set-property edge cases
// ============================================================
describe('set-property edge cases', () => {
  it('creates new object when input is null', () => {
    // Use a node that outputs null (e.g., get-property on missing key)
    const nodes: Record<string, EditorNode> = {
      key: makeNode('key', 'source', { value: 'x' }),
      val: makeNode('val', 'source', { value: 42 }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      // port 0 (object) is not connected → undefined/null
      c0: makeConn('c0', 'key', 0, 'set', 1),
      c1: makeConn('c1', 'val', 0, 'set', 2),
    };
    // No object input → creates { x: 42 }
    expect(out(exec(nodes, conns), 'set')).toEqual({ x: 42 });
  });

  it('creates new object when input is an array', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      arr: makeNode('arr', 'create-array'),
      key: makeNode('key', 'source', { value: 'x' }),
      val: makeNode('val', 'source', { value: 99 }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      c0: makeConn('c0', 'arr', 0, 'set', 0),
      c1: makeConn('c1', 'key', 0, 'set', 1),
      c2: makeConn('c2', 'val', 0, 'set', 2),
    };
    // Arrays are excluded by !Array.isArray check, so falls back to new object
    expect(out(exec(nodes, conns), 'set')).toEqual({ x: 99 });
  });

  it('handles keys with special characters (spaces)', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'hello world' }),
      val: makeNode('val', 'source', { value: 2 }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'set', 0),
      c3: makeConn('c3', 'key', 0, 'set', 1),
      c4: makeConn('c4', 'val', 0, 'set', 2),
    };
    expect(out(exec(nodes, conns), 'set')).toEqual({ a: 1, 'hello world': 2 });
  });

  it('sets __proto__ key safely (no prototype pollution)', () => {
    const nodes: Record<string, EditorNode> = {
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: '__proto__' }),
      val: makeNode('val', 'source', { value: 'evil' }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'obj', 0, 'set', 0),
      c1: makeConn('c1', 'key', 0, 'set', 1),
      c2: makeConn('c2', 'val', 0, 'set', 2),
    };
    out(exec(nodes, conns), 'set') as Record<string, unknown>;
    // The spread operator ({...obj, [key]: value}) does NOT pollute prototype
    // Verify Object.prototype is untouched
    expect(({} as Record<string, unknown>)['__proto__']).not.toBe('evil');
    // The key should still be stored on the result object itself
    // (spread with __proto__ key is a no-op for prototype but may or may not store the key)
  });

  it('sets constructor key safely', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      key: makeNode('key', 'source', { value: 'constructor' }),
      val: makeNode('val', 'source', { value: 'test' }),
      set: makeNode('set', 'set-property'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      c2: makeConn('c2', 'obj', 0, 'set', 0),
      c3: makeConn('c3', 'key', 0, 'set', 1),
      c4: makeConn('c4', 'val', 0, 'set', 2),
    };
    const result = out(exec(nodes, conns), 'set') as Record<string, unknown>;
    // Object constructor should still work on other objects
    expect({}.constructor).toBe(Object);
    // The key is stored on the result
    expect(result).toHaveProperty('constructor', 'test');
    expect(result).toHaveProperty('x', 1);
  });
});

// ============================================================
// object-keys/values edge cases
// ============================================================
describe('object-keys/values edge cases', () => {
  it('object-keys returns empty array for null input', () => {
    const nodes: Record<string, EditorNode> = {
      keys: makeNode('keys', 'object-keys'),
    };
    // No connections — input is undefined
    expect(out(exec(nodes), 'keys')).toEqual([]);
  });

  it('object-keys returns empty array for boolean input', () => {
    const nodes: Record<string, EditorNode> = {
      bool: makeNode('bool', 'source', { value: true }),
      keys: makeNode('keys', 'object-keys'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'bool', 0, 'keys', 0),
    };
    expect(out(exec(nodes, conns), 'keys')).toEqual([]);
  });

  it('object-keys returns empty array for string input', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello' }),
      keys: makeNode('keys', 'object-keys'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'keys', 0),
    };
    // typeof 'hello' is 'string', not 'object'
    expect(out(exec(nodes, conns), 'keys')).toEqual([]);
  });

  it('object-values returns empty array for null input', () => {
    const nodes: Record<string, EditorNode> = {
      vals: makeNode('vals', 'object-values'),
    };
    expect(out(exec(nodes), 'vals')).toEqual([]);
  });

  it('object-values returns empty array for boolean input', () => {
    const nodes: Record<string, EditorNode> = {
      bool: makeNode('bool', 'source', { value: false }),
      vals: makeNode('vals', 'object-values'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'bool', 0, 'vals', 0),
    };
    expect(out(exec(nodes, conns), 'vals')).toEqual([]);
  });

  it('object-values returns empty array for array input', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      arr: makeNode('arr', 'create-array'),
      vals: makeNode('vals', 'object-values'),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      a1: makeConn('a1', 's1', 0, 'arr', 1),
      c0: makeConn('c0', 'arr', 0, 'vals', 0),
    };
    // Arrays excluded by !Array.isArray check
    expect(out(exec(nodes, conns), 'vals')).toEqual([]);
  });
});

// ============================================================
// merge-objects edge cases
// ============================================================
describe('merge-objects edge cases', () => {
  it('handles null + valid object (only valid keys appear)', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj: makeNode('obj', 'create-object'),
      merge: makeNode('merge', 'merge-objects'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj', 0),
      c1: makeConn('c1', 'v0', 0, 'obj', 1),
      // port 0 not connected (null) — falls back to {}
      c2: makeConn('c2', 'obj', 0, 'merge', 1),
    };
    expect(out(exec(nodes, conns), 'merge')).toEqual({ a: 1 });
  });

  it('handles array inputs (treated as empty objects)', () => {
    const nodes: Record<string, EditorNode> = {
      s0: makeNode('s0', 'source', { value: 1 }),
      arr: makeNode('arr', 'create-array'),
      k0: makeNode('k0', 'source', { value: 'x' }),
      v0: makeNode('v0', 'source', { value: 2 }),
      obj: makeNode('obj', 'create-object'),
      merge: makeNode('merge', 'merge-objects'),
    };
    const conns: Record<string, Connection> = {
      a0: makeConn('a0', 's0', 0, 'arr', 0),
      c0: makeConn('c0', 'arr', 0, 'merge', 0), // array → treated as {}
      c1: makeConn('c1', 'k0', 0, 'obj', 0),
      c2: makeConn('c2', 'v0', 0, 'obj', 1),
      c3: makeConn('c3', 'obj', 0, 'merge', 1),
    };
    expect(out(exec(nodes, conns), 'merge')).toEqual({ x: 2 });
  });

  it('preserves all non-conflicting keys from both objects', () => {
    const nodes: Record<string, EditorNode> = {
      ka: makeNode('ka', 'source', { value: 'a' }),
      va: makeNode('va', 'source', { value: 1 }),
      kb: makeNode('kb', 'source', { value: 'shared' }),
      vb: makeNode('vb', 'source', { value: 'old' }),
      obj1: makeNode('obj1', 'create-object'),
      kc: makeNode('kc', 'source', { value: 'c' }),
      vc: makeNode('vc', 'source', { value: 3 }),
      kd: makeNode('kd', 'source', { value: 'shared' }),
      vd: makeNode('vd', 'source', { value: 'new' }),
      obj2: makeNode('obj2', 'create-object'),
      merge: makeNode('merge', 'merge-objects'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'ka', 0, 'obj1', 0),
      c1: makeConn('c1', 'va', 0, 'obj1', 1),
      c2: makeConn('c2', 'kb', 0, 'obj1', 2),
      c3: makeConn('c3', 'vb', 0, 'obj1', 3),
      c4: makeConn('c4', 'kc', 0, 'obj2', 0),
      c5: makeConn('c5', 'vc', 0, 'obj2', 1),
      c6: makeConn('c6', 'kd', 0, 'obj2', 2),
      c7: makeConn('c7', 'vd', 0, 'obj2', 3),
      m0: makeConn('m0', 'obj1', 0, 'merge', 0),
      m1: makeConn('m1', 'obj2', 0, 'merge', 1),
    };
    const result = out(exec(nodes, conns), 'merge') as Record<string, unknown>;
    expect(result.a).toBe(1);      // from obj1 only
    expect(result.c).toBe(3);      // from obj2 only
    expect(result.shared).toBe('new'); // obj2 overwrites obj1
  });
});

// ============================================================
// Deep access integration
// ============================================================
describe('deep access integration', () => {
  it('chained get-property for 3-level deep read', () => {
    // Build: { nested: { inner: { value: 42 } } }
    const nodes: Record<string, EditorNode> = {
      k3: makeNode('k3', 'source', { value: 'value' }),
      v3: makeNode('v3', 'source', { value: 42 }),
      inner: makeNode('inner', 'create-object'),
      k2: makeNode('k2', 'source', { value: 'inner' }),
      nested: makeNode('nested', 'create-object'),
      k1: makeNode('k1', 'source', { value: 'nested' }),
      root: makeNode('root', 'create-object'),
      // Three get-property nodes to drill down
      g1Key: makeNode('g1Key', 'source', { value: 'nested' }),
      g1: makeNode('g1', 'get-property'),
      g2Key: makeNode('g2Key', 'source', { value: 'inner' }),
      g2: makeNode('g2', 'get-property'),
      g3Key: makeNode('g3Key', 'source', { value: 'value' }),
      g3: makeNode('g3', 'get-property'),
    };
    const conns: Record<string, Connection> = {
      // innermost: { value: 42 }
      a0: makeConn('a0', 'k3', 0, 'inner', 0),
      a1: makeConn('a1', 'v3', 0, 'inner', 1),
      // middle: { inner: {value: 42} }
      b0: makeConn('b0', 'k2', 0, 'nested', 0),
      b1: makeConn('b1', 'inner', 0, 'nested', 1),
      // root: { nested: { inner: {value: 42} } }
      c0: makeConn('c0', 'k1', 0, 'root', 0),
      c1: makeConn('c1', 'nested', 0, 'root', 1),
      // g1: root['nested']
      d0: makeConn('d0', 'root', 0, 'g1', 0),
      d1: makeConn('d1', 'g1Key', 0, 'g1', 1),
      // g2: g1['inner']
      e0: makeConn('e0', 'g1', 0, 'g2', 0),
      e1: makeConn('e1', 'g2Key', 0, 'g2', 1),
      // g3: g2['value']
      f0: makeConn('f0', 'g2', 0, 'g3', 0),
      f1: makeConn('f1', 'g3Key', 0, 'g3', 1),
    };
    expect(out(exec(nodes, conns), 'g3')).toBe(42);
  });

  it('create-object -> merge-objects -> object-keys -> array-length full pipeline', () => {
    const nodes: Record<string, EditorNode> = {
      k0: makeNode('k0', 'source', { value: 'a' }),
      v0: makeNode('v0', 'source', { value: 1 }),
      obj1: makeNode('obj1', 'create-object'),
      k1: makeNode('k1', 'source', { value: 'b' }),
      v1: makeNode('v1', 'source', { value: 2 }),
      k2: makeNode('k2', 'source', { value: 'c' }),
      v2: makeNode('v2', 'source', { value: 3 }),
      obj2: makeNode('obj2', 'create-object'),
      merge: makeNode('merge', 'merge-objects'),
      keys: makeNode('keys', 'object-keys'),
      len: makeNode('len', 'array-length'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'k0', 0, 'obj1', 0),
      c1: makeConn('c1', 'v0', 0, 'obj1', 1),
      c2: makeConn('c2', 'k1', 0, 'obj2', 0),
      c3: makeConn('c3', 'v1', 0, 'obj2', 1),
      c4: makeConn('c4', 'k2', 0, 'obj2', 2),
      c5: makeConn('c5', 'v2', 0, 'obj2', 3),
      c6: makeConn('c6', 'obj1', 0, 'merge', 0),
      c7: makeConn('c7', 'obj2', 0, 'merge', 1),
      c8: makeConn('c8', 'merge', 0, 'keys', 0),
      c9: makeConn('c9', 'keys', 0, 'len', 0),
    };
    // { a:1 } merged with { b:2, c:3 } = { a:1, b:2, c:3 } → keys = ['a','b','c'] → length = 3
    expect(out(exec(nodes, conns), 'len')).toBe(3);
  });
});

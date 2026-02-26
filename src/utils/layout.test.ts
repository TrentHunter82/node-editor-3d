import { describe, it, expect } from 'vitest';
import { layeredLayout, alignNodes } from './layout';
import type { EditorNode, Connection } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, type: EditorNode['type'], pos: [number, number, number] = [0, 0, 0]): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id, type, position: pos, title: type, data: {},
    inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ============================================================================
// layeredLayout
// ============================================================================

describe('layeredLayout', () => {
  it('returns empty for empty graph', () => {
    expect(layeredLayout({}, {})).toEqual({});
  });

  it('single node centered at origin', () => {
    const nodes = { a: makeNode('a', 'source') };
    const pos = layeredLayout(nodes, {});
    expect(pos.a).toBeDefined();
    // Single node = single layer, centered → X=0, Z=0
    expect(pos.a[0]).toBe(0);
    expect(pos.a[2]).toBe(0);
  });

  it('linear chain: 3 nodes in 3 layers', () => {
    const nodes = {
      s: makeNode('s', 'source'),
      t: makeNode('t', 'transform'),
      o: makeNode('o', 'output'),
    };
    const conns = {
      c1: makeConn('c1', 's', 0, 't', 0),
      c2: makeConn('c2', 't', 0, 'o', 0),
    };
    const pos = layeredLayout(nodes, conns);
    // Source should be in first layer, transform in second, output in third
    expect(pos.s[0]).toBeLessThan(pos.t[0]);
    expect(pos.t[0]).toBeLessThan(pos.o[0]);
  });

  it('parallel nodes same layer', () => {
    const nodes = {
      s1: makeNode('s1', 'source'),
      s2: makeNode('s2', 'source'),
      o: makeNode('o', 'output'),
    };
    const conns = {
      c1: makeConn('c1', 's1', 0, 'o', 0),
      c2: makeConn('c2', 's2', 0, 'o', 0),
    };
    const pos = layeredLayout(nodes, conns);
    // Both sources should be in the same X layer
    expect(pos.s1[0]).toBe(pos.s2[0]);
    // Output should be in a later layer
    expect(pos.o[0]).toBeGreaterThan(pos.s1[0]);
  });

  it('preserves Y coordinate', () => {
    const nodes = { a: makeNode('a', 'source', [0, 5, 0]) };
    const pos = layeredLayout(nodes, {});
    expect(pos.a[1]).toBe(5);
  });

  it('disconnected subgraphs', () => {
    const nodes = {
      a: makeNode('a', 'source'),
      b: makeNode('b', 'source'),
    };
    const pos = layeredLayout(nodes, {});
    // Both nodes exist in output
    expect(pos.a).toBeDefined();
    expect(pos.b).toBeDefined();
  });

  it('handles many nodes', () => {
    const nodes: Record<string, EditorNode> = {};
    const conns: Record<string, Connection> = {};
    for (let i = 0; i < 20; i++) {
      nodes[`n${i}`] = makeNode(`n${i}`, 'source');
    }
    // Chain them: n0 -> n1 -> n2 -> ...
    for (let i = 0; i < 19; i++) {
      conns[`c${i}`] = makeConn(`c${i}`, `n${i}`, 0, `n${i + 1}`, 0);
    }
    const pos = layeredLayout(nodes, conns);
    // All nodes should have positions
    for (let i = 0; i < 20; i++) {
      expect(pos[`n${i}`]).toBeDefined();
    }
    // Should be monotonically increasing in X
    for (let i = 0; i < 19; i++) {
      expect(pos[`n${i}`][0]).toBeLessThan(pos[`n${i + 1}`][0]);
    }
  });

  it('diamond graph', () => {
    const nodes = {
      s: makeNode('s', 'source'),
      a: makeNode('a', 'transform'),
      b: makeNode('b', 'transform'),
      m: makeNode('m', 'math'),
    };
    const conns = {
      c1: makeConn('c1', 's', 0, 'a', 0),
      c2: makeConn('c2', 's', 0, 'b', 0),
      c3: makeConn('c3', 'a', 0, 'm', 0),
      c4: makeConn('c4', 'b', 0, 'm', 1),
    };
    const pos = layeredLayout(nodes, conns);
    // Source first, then a/b (same layer), then m
    expect(pos.s[0]).toBeLessThan(pos.a[0]);
    expect(pos.a[0]).toBe(pos.b[0]);
    expect(pos.a[0]).toBeLessThan(pos.m[0]);
  });
});

// ============================================================================
// alignNodes
// ============================================================================

describe('alignNodes', () => {
  const nodes: Record<string, EditorNode> = {
    a: makeNode('a', 'source', [0, 0, 0]),
    b: makeNode('b', 'source', [5, 1, 3]),
    c: makeNode('c', 'source', [10, 2, 6]),
  };

  it('returns empty for fewer than 2 nodes', () => {
    expect(alignNodes(['a'], nodes, 'left')).toEqual({});
    expect(alignNodes([], nodes, 'left')).toEqual({});
  });

  it('left alignment', () => {
    const pos = alignNodes(['a', 'b', 'c'], nodes, 'left');
    expect(pos.a[0]).toBe(0);
    expect(pos.b[0]).toBe(0);
    expect(pos.c[0]).toBe(0);
    // Y and Z preserved
    expect(pos.a[1]).toBe(0);
    expect(pos.b[1]).toBe(1);
    expect(pos.c[1]).toBe(2);
    expect(pos.a[2]).toBe(0);
    expect(pos.b[2]).toBe(3);
  });

  it('right alignment', () => {
    const pos = alignNodes(['a', 'b', 'c'], nodes, 'right');
    expect(pos.a[0]).toBe(10);
    expect(pos.b[0]).toBe(10);
    expect(pos.c[0]).toBe(10);
  });

  it('top alignment (min Z)', () => {
    const pos = alignNodes(['a', 'b', 'c'], nodes, 'top');
    expect(pos.a[2]).toBe(0);
    expect(pos.b[2]).toBe(0);
    expect(pos.c[2]).toBe(0);
    // X preserved
    expect(pos.a[0]).toBe(0);
    expect(pos.b[0]).toBe(5);
  });

  it('bottom alignment (max Z)', () => {
    const pos = alignNodes(['a', 'b', 'c'], nodes, 'bottom');
    expect(pos.a[2]).toBe(6);
    expect(pos.b[2]).toBe(6);
    expect(pos.c[2]).toBe(6);
  });

  it('center-x alignment', () => {
    const pos = alignNodes(['a', 'b', 'c'], nodes, 'center-x');
    const avgX = (0 + 5 + 10) / 3;
    expect(pos.a[0]).toBe(avgX);
    expect(pos.b[0]).toBe(avgX);
    expect(pos.c[0]).toBe(avgX);
  });

  it('center-z alignment', () => {
    const pos = alignNodes(['a', 'b', 'c'], nodes, 'center-z');
    const avgZ = (0 + 3 + 6) / 3;
    expect(pos.a[2]).toBe(avgZ);
    expect(pos.b[2]).toBe(avgZ);
    expect(pos.c[2]).toBe(avgZ);
  });

  it('skips non-existent node ids', () => {
    const pos = alignNodes(['a', 'fake', 'c'], nodes, 'left');
    // Only a and c should be aligned (2 valid nodes)
    expect(pos.a[0]).toBe(0);
    expect(pos.c[0]).toBe(0);
    expect(pos.fake).toBeUndefined();
  });

  it('preserves Y for all directions', () => {
    for (const dir of ['left', 'right', 'top', 'bottom', 'center-x', 'center-z'] as const) {
      const pos = alignNodes(['a', 'b', 'c'], nodes, dir);
      expect(pos.a[1]).toBe(0);
      expect(pos.b[1]).toBe(1);
      expect(pos.c[1]).toBe(2);
    }
  });
});

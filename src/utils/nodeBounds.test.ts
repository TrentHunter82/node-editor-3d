/**
 * Unit tests for nodeBounds.ts — AABB computation, port position caching,
 * overlap detection, point-in-AABB, segment-AABB intersection, and
 * findConnectionsInRect.
 */
import { describe, it, expect } from 'vitest';
import {
  buildNodeAABBs,
  buildPortPositionCache,
  aabbsOverlap,
  pointInAABB,
  getNodeAABB,
  findConnectionsInRect,
  type NodeAABB,
} from './nodeBounds';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../store/slices/nodeSlice';
import type { EditorNode, Connection } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, pos: [number, number, number], opts?: {
  width?: number;
  height?: number;
  inputs?: number;
  outputs?: number;
}): EditorNode {
  const inputCount = opts?.inputs ?? 1;
  const outputCount = opts?.outputs ?? 1;
  return {
    id,
    type: 'source',
    position: pos,
    title: id,
    data: {},
    inputs: Array.from({ length: inputCount }, (_, i) => ({
      id: `${id}-in-${i}`,
      label: `In ${i}`,
      portType: 'number' as const,
    })),
    outputs: Array.from({ length: outputCount }, (_, i) => ({
      id: `${id}-out-${i}`,
      label: `Out ${i}`,
      portType: 'number' as const,
    })),
    ...(opts?.width !== undefined ? { width: opts.width } : {}),
    ...(opts?.height !== undefined ? { height: opts.height } : {}),
  };
}

function makeConnection(
  id: string,
  srcId: string, srcPort: number,
  tgtId: string, tgtPort: number,
): Connection {
  return { id, sourceNodeId: srcId, sourcePortIndex: srcPort, targetNodeId: tgtId, targetPortIndex: tgtPort };
}

// ---------------------------------------------------------------------------
// buildNodeAABBs
// ---------------------------------------------------------------------------

describe('buildNodeAABBs', () => {
  it('returns empty map for empty nodes', () => {
    const aabbs = buildNodeAABBs({});
    expect(aabbs.size).toBe(0);
  });

  it('computes AABB with default dimensions when width/height not set', () => {
    const node = makeNode('n1', [4, 0, 6]);
    const aabbs = buildNodeAABBs({ n1: node });
    const aabb = aabbs.get('n1')!;

    expect(aabb.nodeId).toBe('n1');
    expect(aabb.centerX).toBe(4);
    expect(aabb.centerZ).toBe(6);
    expect(aabb.width).toBe(DEFAULT_NODE_WIDTH);
    expect(aabb.depth).toBe(DEFAULT_NODE_HEIGHT);
    expect(aabb.minX).toBeCloseTo(4 - DEFAULT_NODE_WIDTH / 2);
    expect(aabb.maxX).toBeCloseTo(4 + DEFAULT_NODE_WIDTH / 2);
    expect(aabb.minZ).toBeCloseTo(6 - DEFAULT_NODE_HEIGHT / 2);
    expect(aabb.maxZ).toBeCloseTo(6 + DEFAULT_NODE_HEIGHT / 2);
  });

  it('uses custom width and height when set', () => {
    const node = makeNode('n1', [0, 0, 0], { width: 4.0, height: 3.0 });
    const aabbs = buildNodeAABBs({ n1: node });
    const aabb = aabbs.get('n1')!;

    expect(aabb.width).toBe(4.0);
    expect(aabb.depth).toBe(3.0);
    expect(aabb.minX).toBe(-2.0);
    expect(aabb.maxX).toBe(2.0);
    expect(aabb.minZ).toBe(-1.5);
    expect(aabb.maxZ).toBe(1.5);
  });

  it('handles multiple nodes', () => {
    const nodes = {
      a: makeNode('a', [-5, 0, -5]),
      b: makeNode('b', [5, 0, 5]),
      c: makeNode('c', [0, 0, 0], { width: 2.0, height: 1.0 }),
    };
    const aabbs = buildNodeAABBs(nodes);
    expect(aabbs.size).toBe(3);
    expect(aabbs.get('a')!.centerX).toBe(-5);
    expect(aabbs.get('b')!.centerZ).toBe(5);
    expect(aabbs.get('c')!.width).toBe(2.0);
  });

  it('handles node at origin with default size', () => {
    const node = makeNode('origin', [0, 0, 0]);
    const aabb = buildNodeAABBs({ origin: node }).get('origin')!;
    expect(aabb.centerX).toBe(0);
    expect(aabb.centerZ).toBe(0);
    expect(aabb.minX).toBe(-DEFAULT_NODE_WIDTH / 2);
    expect(aabb.maxX).toBe(DEFAULT_NODE_WIDTH / 2);
  });
});

// ---------------------------------------------------------------------------
// getNodeAABB (single node, no cache)
// ---------------------------------------------------------------------------

describe('getNodeAABB', () => {
  it('matches buildNodeAABBs output for same node', () => {
    const node = makeNode('n1', [3, 0, -2], { width: 2.5, height: 1.5 });
    const fromBuild = buildNodeAABBs({ n1: node }).get('n1')!;
    const direct = getNodeAABB(node);

    expect(direct.nodeId).toBe(fromBuild.nodeId);
    expect(direct.minX).toBe(fromBuild.minX);
    expect(direct.maxX).toBe(fromBuild.maxX);
    expect(direct.minZ).toBe(fromBuild.minZ);
    expect(direct.maxZ).toBe(fromBuild.maxZ);
    expect(direct.width).toBe(fromBuild.width);
    expect(direct.depth).toBe(fromBuild.depth);
  });

  it('uses defaults when width/height not set', () => {
    const node = makeNode('n1', [0, 0, 0]);
    const aabb = getNodeAABB(node);
    expect(aabb.width).toBe(DEFAULT_NODE_WIDTH);
    expect(aabb.depth).toBe(DEFAULT_NODE_HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// aabbsOverlap
// ---------------------------------------------------------------------------

describe('aabbsOverlap', () => {
  function makeAABB(cx: number, cz: number, w: number, d: number): NodeAABB {
    return {
      nodeId: 'test',
      minX: cx - w / 2, maxX: cx + w / 2,
      minZ: cz - d / 2, maxZ: cz + d / 2,
      centerX: cx, centerZ: cz,
      width: w, depth: d,
    };
  }

  it('detects overlap when boxes intersect', () => {
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(1, 1, 2, 2);
    expect(aabbsOverlap(a, b)).toBe(true);
  });

  it('returns false when boxes are separated', () => {
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(10, 10, 2, 2);
    expect(aabbsOverlap(a, b)).toBe(false);
  });

  it('detects overlap when one box contains another', () => {
    const outer = makeAABB(0, 0, 10, 10);
    const inner = makeAABB(0, 0, 2, 2);
    expect(aabbsOverlap(outer, inner)).toBe(true);
  });

  it('returns false for edge-touching boxes (strict inequality)', () => {
    // a: minX=-1, maxX=1; b: minX=1, maxX=3 → touching at x=1
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(2, 0, 2, 2);
    // Implementation uses strict < not <=, so edge-touching is NOT overlap
    expect(aabbsOverlap(a, b)).toBe(false);
  });

  it('applies margin to expand overlap detection', () => {
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(5, 0, 2, 2); // Separated by 2 units
    expect(aabbsOverlap(a, b, 0)).toBe(false);
    expect(aabbsOverlap(a, b, 2)).toBe(true); // Margin closes the gap
  });

  it('is commutative', () => {
    const a = makeAABB(0, 0, 3, 3);
    const b = makeAABB(4, 4, 2, 2);
    expect(aabbsOverlap(a, b)).toBe(aabbsOverlap(b, a));
  });
});

// ---------------------------------------------------------------------------
// pointInAABB
// ---------------------------------------------------------------------------

describe('pointInAABB', () => {
  const aabb: NodeAABB = {
    nodeId: 'test',
    minX: -1, maxX: 1, minZ: -1, maxZ: 1,
    centerX: 0, centerZ: 0, width: 2, depth: 2,
  };

  it('returns true for center point', () => {
    expect(pointInAABB(0, 0, aabb)).toBe(true);
  });

  it('returns true for edge points', () => {
    expect(pointInAABB(-1, 0, aabb)).toBe(true);
    expect(pointInAABB(1, 0, aabb)).toBe(true);
    expect(pointInAABB(0, -1, aabb)).toBe(true);
    expect(pointInAABB(0, 1, aabb)).toBe(true);
  });

  it('returns true for corner points', () => {
    expect(pointInAABB(-1, -1, aabb)).toBe(true);
    expect(pointInAABB(1, 1, aabb)).toBe(true);
  });

  it('returns false for points outside', () => {
    expect(pointInAABB(2, 0, aabb)).toBe(false);
    expect(pointInAABB(0, 2, aabb)).toBe(false);
    expect(pointInAABB(-2, -2, aabb)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildPortPositionCache
// ---------------------------------------------------------------------------

describe('buildPortPositionCache', () => {
  it('returns empty cache for empty nodes', () => {
    const cache = buildPortPositionCache({});
    expect(cache.size).toBe(0);
  });

  it('caches input and output positions for a node', () => {
    const node = makeNode('n1', [0, 0, 0], { inputs: 2, outputs: 3 });
    const cache = buildPortPositionCache({ n1: node });

    // Should have 2 inputs + 3 outputs = 5 entries
    expect(cache.size).toBe(5);

    // All positions should be defined
    expect(cache.get('n1', 'input', 0)).toBeDefined();
    expect(cache.get('n1', 'input', 1)).toBeDefined();
    expect(cache.get('n1', 'output', 0)).toBeDefined();
    expect(cache.get('n1', 'output', 1)).toBeDefined();
    expect(cache.get('n1', 'output', 2)).toBeDefined();
  });

  it('returns undefined for non-existent ports', () => {
    const node = makeNode('n1', [0, 0, 0], { inputs: 1, outputs: 1 });
    const cache = buildPortPositionCache({ n1: node });
    expect(cache.get('n1', 'input', 5)).toBeUndefined();
    expect(cache.get('nonexistent', 'input', 0)).toBeUndefined();
  });

  it('returns [x, y, z] tuples', () => {
    const node = makeNode('n1', [5, 0, 3], { inputs: 1 });
    const cache = buildPortPositionCache({ n1: node });
    const pos = cache.get('n1', 'input', 0)!;
    expect(pos).toHaveLength(3);
    expect(typeof pos[0]).toBe('number');
    expect(typeof pos[1]).toBe('number');
    expect(typeof pos[2]).toBe('number');
  });

  it('respects custom width and height', () => {
    const defaultNode = makeNode('d', [0, 0, 0], { inputs: 1, outputs: 1 });
    const wideNode = makeNode('w', [0, 0, 0], { inputs: 1, outputs: 1, width: 4.0, height: 2.0 });

    const defaultCache = buildPortPositionCache({ d: defaultNode });
    const wideCache = buildPortPositionCache({ w: wideNode });

    const defaultOutPos = defaultCache.get('d', 'output', 0)!;
    const wideOutPos = wideCache.get('w', 'output', 0)!;

    // Wider node should have output port at different X position
    expect(wideOutPos[0]).not.toBeCloseTo(defaultOutPos[0], 1);
  });
});

// ---------------------------------------------------------------------------
// findConnectionsInRect
// ---------------------------------------------------------------------------

describe('findConnectionsInRect', () => {
  it('returns empty array when no connections', () => {
    const nodes = { n1: makeNode('n1', [0, 0, 0]) };
    const result = findConnectionsInRect({}, nodes, -10, -10, 10, 10);
    expect(result).toEqual([]);
  });

  it('finds connection with endpoint inside rect', () => {
    const nodes = {
      src: makeNode('src', [0, 0, 0], { outputs: 1 }),
      tgt: makeNode('tgt', [5, 0, 0], { inputs: 1 }),
    };
    const connections = {
      c1: makeConnection('c1', 'src', 0, 'tgt', 0),
    };

    // Large rect covering everything
    const result = findConnectionsInRect(connections, nodes, -20, -20, 20, 20);
    expect(result).toContain('c1');
  });

  it('excludes connection with both endpoints outside rect', () => {
    const nodes = {
      src: makeNode('src', [-50, 0, 0], { outputs: 1 }),
      tgt: makeNode('tgt', [50, 0, 0], { inputs: 1 }),
    };
    const connections = {
      c1: makeConnection('c1', 'src', 0, 'tgt', 0),
    };

    // Small rect in middle, but the connection segment might cross it
    // For this test, use a rect far from the connecting line
    const result = findConnectionsInRect(connections, nodes, -1, 20, 1, 22);
    expect(result).not.toContain('c1');
  });

  it('finds connection whose segment crosses rect (Liang-Barsky)', () => {
    // Two nodes far apart horizontally, connection crosses through a rect in the middle
    const nodes = {
      src: makeNode('src', [-20, 0, 0], { outputs: 1 }),
      tgt: makeNode('tgt', [20, 0, 0], { inputs: 1 }),
    };
    const connections = {
      c1: makeConnection('c1', 'src', 0, 'tgt', 0),
    };

    // Port positions are near the node, so the line goes through the middle
    // Rect centered at origin covering a thin horizontal strip
    const result = findConnectionsInRect(connections, nodes, -2, -2, 2, 2);
    expect(result).toContain('c1');
  });

  it('skips connections with missing nodes', () => {
    const nodes = { src: makeNode('src', [0, 0, 0], { outputs: 1 }) };
    const connections = {
      c1: makeConnection('c1', 'src', 0, 'missing', 0),
    };

    const result = findConnectionsInRect(connections, nodes, -100, -100, 100, 100);
    expect(result).toEqual([]);
  });

  it('handles multiple connections with mixed results', () => {
    const nodes = {
      a: makeNode('a', [0, 0, 0], { outputs: 1 }),
      b: makeNode('b', [3, 0, 0], { inputs: 1, outputs: 1 }),
      c: makeNode('c', [100, 0, 100], { inputs: 1 }),
    };
    const connections = {
      ab: makeConnection('ab', 'a', 0, 'b', 0),
      bc: makeConnection('bc', 'b', 0, 'c', 0),
    };

    // Rect only covers a and b area
    const result = findConnectionsInRect(connections, nodes, -5, -5, 10, 5);
    expect(result).toContain('ab');
    // bc goes from (3,0) to (100,100), rect is [-5,-5] to [10,5] - might not intersect
  });
});

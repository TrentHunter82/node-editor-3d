/**
 * Force layout performance tests (~15 tests).
 * Tests O(n^2) behavior for large node counts, convergence for various graph shapes,
 * deterministic output verification, and edge cases.
 */
import { describe, it, expect } from 'vitest';
import { forceDirectedLayout } from '../utils/layout';
import type { EditorNode, Connection } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeNode(id: string, pos: [number, number, number] = [0, 0, 0]): EditorNode {
  return { id, type: 'source', position: pos, title: id, data: {}, inputs: [], outputs: [] };
}

function makeConn(id: string, src: string, tgt: string): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: 0, targetNodeId: tgt, targetPortIndex: 0 };
}

function makeChain(n: number): { nodes: Record<string, EditorNode>; connections: Record<string, Connection> } {
  const nodes: Record<string, EditorNode> = {};
  const connections: Record<string, Connection> = {};
  for (let i = 0; i < n; i++) {
    nodes[`n${i}`] = makeNode(`n${i}`);
    if (i > 0) {
      connections[`c${i}`] = makeConn(`c${i}`, `n${i - 1}`, `n${i}`);
    }
  }
  return { nodes, connections };
}

function makeDisconnected(n: number): { nodes: Record<string, EditorNode>; connections: Record<string, Connection> } {
  const nodes: Record<string, EditorNode> = {};
  for (let i = 0; i < n; i++) {
    nodes[`n${i}`] = makeNode(`n${i}`);
  }
  return { nodes, connections: {} };
}

function makeStar(n: number): { nodes: Record<string, EditorNode>; connections: Record<string, Connection> } {
  const nodes: Record<string, EditorNode> = { hub: makeNode('hub') };
  const connections: Record<string, Connection> = {};
  for (let i = 0; i < n; i++) {
    nodes[`leaf${i}`] = makeNode(`leaf${i}`);
    connections[`c${i}`] = makeConn(`c${i}`, 'hub', `leaf${i}`);
  }
  return { nodes, connections };
}

function dist2d(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2);
}

// ============================================================================
// Force layout O(n^2) performance characteristics
// ============================================================================
describe('force layout performance — O(n^2) guard', () => {
  it('completes for 50 nodes in < 500ms', () => {
    const { nodes, connections } = makeChain(50);
    const t0 = performance.now();
    const result = forceDirectedLayout(nodes, connections);
    const elapsed = performance.now() - t0;
    expect(Object.keys(result)).toHaveLength(50);
    expect(elapsed).toBeLessThan(500);
  });

  it('completes for 100 nodes in < 2000ms', () => {
    const { nodes, connections } = makeChain(100);
    const t0 = performance.now();
    const result = forceDirectedLayout(nodes, connections);
    const elapsed = performance.now() - t0;
    expect(Object.keys(result)).toHaveLength(100);
    expect(elapsed).toBeLessThan(2000);
  });

  it('completes for 150 disconnected nodes in < 3000ms', () => {
    const { nodes, connections } = makeDisconnected(150);
    const t0 = performance.now();
    const result = forceDirectedLayout(nodes, connections);
    const elapsed = performance.now() - t0;
    expect(Object.keys(result)).toHaveLength(150);
    expect(elapsed).toBeLessThan(3000);
  });

  it('timing scales roughly quadratically (50 vs 100 nodes)', () => {
    const { nodes: n50, connections: c50 } = makeDisconnected(50);
    const { nodes: n100, connections: c100 } = makeDisconnected(100);

    const t0a = performance.now();
    forceDirectedLayout(n50, c50);
    const t50 = performance.now() - t0a;

    const t0b = performance.now();
    forceDirectedLayout(n100, c100);
    const t100 = performance.now() - t0b;

    // t100 should be ~4x t50 (quadratic), allow generous margin
    // At minimum, both must be positive
    expect(t50).toBeGreaterThan(0);
    expect(t100).toBeGreaterThan(0);
    // Ratio should be between 1.5x and 15x (generous for JIT variance)
    const ratio = t100 / Math.max(t50, 0.01);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(15);
  });
});

// ============================================================================
// Force layout convergence verification
// ============================================================================
describe('force layout convergence', () => {
  it('connected nodes end up closer than unconnected pairs in a star', () => {
    const { nodes, connections } = makeStar(6);
    const positions = forceDirectedLayout(nodes, connections);

    // Hub to leaf distance should be less than leaf-to-leaf average distance
    const hubPos = positions['hub'];
    const leafDists = Array.from({ length: 6 }, (_, i) =>
      dist2d(hubPos, positions[`leaf${i}`])
    );
    const avgHubToLeaf = leafDists.reduce((s, d) => s + d, 0) / leafDists.length;

    let leafToLeafSum = 0;
    let leafToLeafCount = 0;
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        leafToLeafSum += dist2d(positions[`leaf${i}`], positions[`leaf${j}`]);
        leafToLeafCount++;
      }
    }
    const avgLeafToLeaf = leafToLeafSum / leafToLeafCount;

    // Hub should be closer to leaves than leaves are to each other
    expect(avgHubToLeaf).toBeLessThan(avgLeafToLeaf);
  });

  it('all disconnected nodes repel each other (minimum spacing)', () => {
    const { nodes, connections } = makeDisconnected(10);
    const positions = forceDirectedLayout(nodes, connections);
    const ids = Object.keys(positions);

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const d = dist2d(positions[ids[i]], positions[ids[j]]);
        expect(d).toBeGreaterThan(0.3); // should not be stacked
      }
    }
  });

  it('chain nodes spread out roughly linearly', () => {
    const { nodes, connections } = makeChain(8);
    const positions = forceDirectedLayout(nodes, connections);

    // Adjacent nodes should be relatively close
    for (let i = 0; i < 7; i++) {
      const d = dist2d(positions[`n${i}`], positions[`n${i + 1}`]);
      expect(d).toBeGreaterThan(0); // they are not on top of each other
      expect(d).toBeLessThan(50); // not absurdly far
    }
  });
});

// ============================================================================
// Force layout determinism
// ============================================================================
describe('force layout determinism', () => {
  it('same input produces same output (deterministic)', () => {
    const { nodes, connections } = makeChain(10);
    const result1 = forceDirectedLayout(nodes, connections);
    const result2 = forceDirectedLayout(nodes, connections);

    for (const id of Object.keys(result1)) {
      expect(result1[id][0]).toBeCloseTo(result2[id][0], 10);
      expect(result1[id][2]).toBeCloseTo(result2[id][2], 10);
    }
  });

  it('positions are snapped to 0.5 grid', () => {
    const { nodes, connections } = makeChain(15);
    const positions = forceDirectedLayout(nodes, connections);

    for (const pos of Object.values(positions)) {
      // X and Z should be multiples of 0.5
      expect(pos[0] * 2).toBeCloseTo(Math.round(pos[0] * 2), 10);
      expect(pos[2] * 2).toBeCloseTo(Math.round(pos[2] * 2), 10);
    }
  });
});

// ============================================================================
// Force layout edge cases
// ============================================================================
describe('force layout edge cases', () => {
  it('empty graph returns empty object', () => {
    expect(forceDirectedLayout({}, {})).toEqual({});
  });

  it('single node placed at origin with Y preserved', () => {
    const nodes = { only: makeNode('only', [5, 3, 7]) };
    const result = forceDirectedLayout(nodes, {});
    expect(result['only'][0]).toBe(0);
    expect(result['only'][1]).toBe(3); // Y preserved
    expect(result['only'][2]).toBe(0);
  });

  it('connections with dangling refs are filtered out', () => {
    const nodes = { a: makeNode('a'), b: makeNode('b') };
    const connections = {
      c1: makeConn('c1', 'a', 'b'),
      c2: makeConn('c2', 'a', 'missing'), // dangling
    };
    const result = forceDirectedLayout(nodes, connections);
    expect(Object.keys(result)).toHaveLength(2);
    // Should not throw
  });

  it('Y coordinate preserved for all nodes', () => {
    const nodes: Record<string, EditorNode> = {};
    for (let i = 0; i < 5; i++) {
      nodes[`n${i}`] = makeNode(`n${i}`, [0, i * 2.5, 0]);
    }
    const result = forceDirectedLayout(nodes, {});
    for (let i = 0; i < 5; i++) {
      expect(result[`n${i}`][1]).toBe(i * 2.5);
    }
  });
});

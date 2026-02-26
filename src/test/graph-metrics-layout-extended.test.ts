/**
 * Extended tests for graph metrics (getGraphComplexity) and layout utilities
 * (forceDirectedLayout, distributeNodes) + exportExecutionResults format.
 * ~25 tests total.
 */
import { describe, it, expect } from 'vitest';
import { getGraphComplexity } from '../utils/graphMetrics';
import { forceDirectedLayout, distributeNodes } from '../utils/layout';
import { exportExecutionResults } from '../store/slices/executionSlice';
import type { EditorNode, Connection } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeNode(id: string, pos: [number, number, number] = [0, 0, 0]): EditorNode {
  return { id, type: 'source', position: pos, title: id, data: {}, inputs: [], outputs: [] };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ============================================================================
// getGraphComplexity — extended topologies
// ============================================================================
describe('getGraphComplexity — extended topologies', () => {
  it('star topology: central hub with N leaves', () => {
    const nodes: Record<string, EditorNode> = { hub: makeNode('hub') };
    const conns: Record<string, Connection> = {};
    for (let i = 0; i < 8; i++) {
      nodes[`leaf${i}`] = makeNode(`leaf${i}`);
      conns[`c${i}`] = makeConn(`c${i}`, 'hub', 0, `leaf${i}`, 0);
    }
    const c = getGraphComplexity(nodes, conns);
    expect(c.nodeCount).toBe(9);
    expect(c.connectionCount).toBe(8);
    expect(c.maxFanOut).toBe(8);
    expect(c.maxFanIn).toBe(1);
    expect(c.connectedComponents).toBe(1);
    expect(c.isolatedNodes).toBe(0);
    expect(c.longestPath).toBe(2); // hub → leaf
  });

  it('binary tree topology', () => {
    // Root → L, R; L → LL, LR; R → RL, RR
    const nodes: Record<string, EditorNode> = {
      root: makeNode('root'),
      L: makeNode('L'), R: makeNode('R'),
      LL: makeNode('LL'), LR: makeNode('LR'),
      RL: makeNode('RL'), RR: makeNode('RR'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'root', 0, 'L', 0),
      c2: makeConn('c2', 'root', 0, 'R', 0),
      c3: makeConn('c3', 'L', 0, 'LL', 0),
      c4: makeConn('c4', 'L', 0, 'LR', 0),
      c5: makeConn('c5', 'R', 0, 'RL', 0),
      c6: makeConn('c6', 'R', 0, 'RR', 0),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.nodeCount).toBe(7);
    expect(c.connectionCount).toBe(6);
    expect(c.maxFanOut).toBe(2);
    expect(c.longestPath).toBe(3); // root → L → LL
    expect(c.connectedComponents).toBe(1);
    expect(c.isolatedNodes).toBe(0);
  });

  it('wide parallel chains', () => {
    // 3 independent chains: a1→a2→a3, b1→b2→b3, c1→c2
    const nodes: Record<string, EditorNode> = {};
    const conns: Record<string, Connection> = {};
    for (const prefix of ['a', 'b']) {
      for (let i = 1; i <= 3; i++) nodes[`${prefix}${i}`] = makeNode(`${prefix}${i}`);
      conns[`${prefix}12`] = makeConn(`${prefix}12`, `${prefix}1`, 0, `${prefix}2`, 0);
      conns[`${prefix}23`] = makeConn(`${prefix}23`, `${prefix}2`, 0, `${prefix}3`, 0);
    }
    nodes.c1 = makeNode('c1');
    nodes.c2 = makeNode('c2');
    conns.c12 = makeConn('c12', 'c1', 0, 'c2', 0);

    const c = getGraphComplexity(nodes, conns);
    expect(c.nodeCount).toBe(8);
    expect(c.connectionCount).toBe(5);
    expect(c.connectedComponents).toBe(3);
    expect(c.longestPath).toBe(3); // a1→a2→a3 or b1→b2→b3
    expect(c.isolatedNodes).toBe(0);
  });

  it('fully connected pair', () => {
    // a ↔ b (two edges in same direction = fan-in/out of 2/2 for a→b, a→b)
    // Actually just a→b and b→a would be a cycle, but since topSort won't
    // handle it properly, let's test a→b with 2 connections (from different ports)
    const nodes: Record<string, EditorNode> = { a: makeNode('a'), b: makeNode('b') };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 1, 'b', 1),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.maxFanOut).toBe(2); // a has 2 out
    expect(c.maxFanIn).toBe(2);  // b has 2 in
    expect(c.avgConnectivity).toBe(2); // total degree 4 / 2 nodes
  });

  it('avgConnectivity precision is rounded to 2 decimals', () => {
    // 3 nodes, 1 edge → total degree 2, avg = 2/3 = 0.666... → 0.67
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c') };
    const conns = { c1: makeConn('c1', 'a', 0, 'b', 0) };
    const c = getGraphComplexity(nodes, conns);
    expect(c.avgConnectivity).toBe(0.67);
  });

  it('cyclomaticComplexity for 2 independent edges', () => {
    // 4 nodes, 2 edges, 2 components: E - N + 2P = 2 - 4 + 4 = 2 → max(1, 2) = 2
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c'), d: makeNode('d') };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'c', 0, 'd', 0),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.cyclomaticComplexity).toBe(2);
  });
});

// ============================================================================
// forceDirectedLayout
// ============================================================================
describe('forceDirectedLayout', () => {
  it('returns empty for empty graph', () => {
    expect(forceDirectedLayout({}, {})).toEqual({});
  });

  it('single node placed at origin', () => {
    const nodes = { a: makeNode('a', [5, 3, 7]) };
    const pos = forceDirectedLayout(nodes, {});
    expect(pos.a).toBeDefined();
    expect(pos.a[0]).toBe(0);   // centered
    expect(pos.a[1]).toBe(3);   // Y preserved
    expect(pos.a[2]).toBe(0);   // centered
  });

  it('two connected nodes are closer than two unconnected nodes', () => {
    // Connected pair
    const nodesConn = { a: makeNode('a'), b: makeNode('b') };
    const conns = { c1: makeConn('c1', 'a', 0, 'b', 0) };
    const posConn = forceDirectedLayout(nodesConn, conns);

    // Unconnected pair
    const nodesDisc = { a: makeNode('a'), b: makeNode('b') };
    const posDisc = forceDirectedLayout(nodesDisc, {});

    const distConn = Math.sqrt(
      (posConn.a[0] - posConn.b[0]) ** 2 + (posConn.a[2] - posConn.b[2]) ** 2
    );
    const distDisc = Math.sqrt(
      (posDisc.a[0] - posDisc.b[0]) ** 2 + (posDisc.a[2] - posDisc.b[2]) ** 2
    );
    expect(distConn).toBeLessThan(distDisc);
  });

  it('preserves Y coordinate', () => {
    const nodes = { a: makeNode('a', [0, 5, 0]), b: makeNode('b', [0, 10, 0]) };
    const pos = forceDirectedLayout(nodes, {});
    expect(pos.a[1]).toBe(5);
    expect(pos.b[1]).toBe(10);
  });

  it('all nodes get positions', () => {
    const nodes: Record<string, EditorNode> = {};
    for (let i = 0; i < 10; i++) nodes[`n${i}`] = makeNode(`n${i}`);
    const pos = forceDirectedLayout(nodes, {});
    for (let i = 0; i < 10; i++) {
      expect(pos[`n${i}`]).toBeDefined();
      expect(pos[`n${i}`].length).toBe(3);
    }
  });

  it('positions are snapped to 0.5 grid', () => {
    const nodes: Record<string, EditorNode> = {};
    const conns: Record<string, Connection> = {};
    for (let i = 0; i < 5; i++) nodes[`n${i}`] = makeNode(`n${i}`);
    for (let i = 0; i < 4; i++) conns[`c${i}`] = makeConn(`c${i}`, `n${i}`, 0, `n${i + 1}`, 0);
    const pos = forceDirectedLayout(nodes, conns);
    for (const id of Object.keys(pos)) {
      // X and Z should be multiples of 0.5
      expect(pos[id][0] * 2).toBe(Math.round(pos[id][0] * 2));
      expect(pos[id][2] * 2).toBe(Math.round(pos[id][2] * 2));
    }
  });
});

// ============================================================================
// distributeNodes
// ============================================================================
describe('distributeNodes', () => {
  const nodes: Record<string, EditorNode> = {
    a: makeNode('a', [0, 0, 0]),
    b: makeNode('b', [10, 1, 5]),
    c: makeNode('c', [20, 2, 10]),
    d: makeNode('d', [5, 3, 3]),
  };

  it('returns empty for fewer than 3 nodes', () => {
    expect(distributeNodes(['a', 'b'], nodes, 'horizontal')).toEqual({});
    expect(distributeNodes(['a'], nodes, 'vertical')).toEqual({});
    expect(distributeNodes([], nodes, 'horizontal')).toEqual({});
  });

  it('distributes horizontally (along X)', () => {
    const pos = distributeNodes(['a', 'b', 'c'], nodes, 'horizontal');
    // Sorted by X: a(0), b(10), c(20) → evenly spaced: 0, 10, 20
    expect(pos.a[0]).toBe(0);
    expect(pos.b[0]).toBe(10);
    expect(pos.c[0]).toBe(20);
  });

  it('distributes vertically (along Z)', () => {
    const pos = distributeNodes(['a', 'b', 'c'], nodes, 'vertical');
    // Sorted by Z: a(0), b(5), c(10) → evenly spaced: 0, 5, 10
    expect(pos.a[2]).toBe(0);
    expect(pos.b[2]).toBe(5);
    expect(pos.c[2]).toBe(10);
  });

  it('preserves Y coordinate', () => {
    const pos = distributeNodes(['a', 'b', 'c', 'd'], nodes, 'horizontal');
    expect(pos.a[1]).toBe(0);
    expect(pos.b[1]).toBe(1);
    expect(pos.c[1]).toBe(2);
    expect(pos.d[1]).toBe(3);
  });

  it('evenly spaces 4 nodes horizontally', () => {
    const pos = distributeNodes(['a', 'd', 'b', 'c'], nodes, 'horizontal');
    // Sorted by X: a(0), d(5), b(10), c(20) → step = 20/3 ≈ 6.667
    expect(pos.a[0]).toBeCloseTo(0, 5);
    // d, b are redistributed between a(0) and c(20)
    // Second node at step, third at 2*step
    // Sorted order: a, d, b, c
    expect(pos.c[0]).toBeCloseTo(20, 5);
  });

  it('skips non-existent node ids', () => {
    const pos = distributeNodes(['a', 'fake', 'b', 'c'], nodes, 'horizontal');
    // Only 3 valid nodes, so distribution happens
    expect(pos.a).toBeDefined();
    expect(pos.b).toBeDefined();
    expect(pos.c).toBeDefined();
    expect(pos.fake).toBeUndefined();
  });
});

// ============================================================================
// exportExecutionResults format
// ============================================================================
describe('exportExecutionResults', () => {
  it('returns null when no execution results exist', () => {
    const state = {
      nodeOutputs: {},
      executionMetrics: {},
      executionErrors: {},
      executionTotalDuration: 0,
      nodes: { a: makeNode('a') },
    };
    expect(exportExecutionResults(state as any)).toBeNull();
  });

  it('generates valid JSON and CSV for single node', () => {
    const state = {
      nodeOutputs: { a: { 0: 42 } },
      executionMetrics: { a: { duration: 1.5, cacheHit: false } },
      executionErrors: {},
      executionTotalDuration: 1.5,
      nodes: { a: makeNode('a') },
    };
    const result = exportExecutionResults(state as any);
    expect(result).not.toBeNull();

    // JSON validation
    const parsed = JSON.parse(result!.json);
    expect(parsed.timestamp).toBeTruthy();
    expect(parsed.totalDuration).toBe(1.5);
    expect(parsed.nodeCount).toBe(1);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].nodeId).toBe('a');
    expect(parsed.results[0].outputs).toEqual({ 0: 42 });

    // CSV validation
    const lines = result!.csv.split('\n');
    expect(lines[0]).toBe('nodeId,nodeType,nodeTitle,output0,output1,output2,durationMs,cacheHit,error');
    expect(lines.length).toBe(2); // header + 1 row
    expect(lines[1]).toContain('a');
    expect(lines[1]).toContain('source');
    expect(lines[1]).toContain('42');
    expect(lines[1]).toContain('false');
  });

  it('includes error messages in export', () => {
    const state = {
      nodeOutputs: { a: { 0: null } },
      executionMetrics: {},
      executionErrors: { a: 'Division by zero' },
      executionTotalDuration: 0,
      nodes: { a: makeNode('a') },
    };
    const result = exportExecutionResults(state as any);
    expect(result).not.toBeNull();

    const parsed = JSON.parse(result!.json);
    expect(parsed.results[0].error).toBe('Division by zero');

    expect(result!.csv).toContain('Division by zero');
  });

  it('handles multiple nodes with varying outputs', () => {
    const state = {
      nodeOutputs: {
        a: { 0: 10, 1: 'hello' },
        b: { 0: [1, 2, 3] },
      },
      executionMetrics: {
        a: { duration: 1, cacheHit: true },
        b: { duration: 2, cacheHit: false },
      },
      executionErrors: {},
      executionTotalDuration: 3,
      nodes: {
        a: makeNode('a'),
        b: makeNode('b'),
      },
    };
    const result = exportExecutionResults(state as any);
    expect(result).not.toBeNull();

    const parsed = JSON.parse(result!.json);
    expect(parsed.nodeCount).toBe(2);
    expect(parsed.totalDuration).toBe(3);

    const lines = result!.csv.split('\n');
    expect(lines.length).toBe(3); // header + 2 rows
  });

  it('skips nodes not present in the nodes record', () => {
    const state = {
      nodeOutputs: { a: { 0: 1 }, ghost: { 0: 2 } },
      executionMetrics: {},
      executionErrors: {},
      executionTotalDuration: 0,
      nodes: { a: makeNode('a') }, // ghost not in nodes
    };
    const result = exportExecutionResults(state as any);
    expect(result).not.toBeNull();

    const parsed = JSON.parse(result!.json);
    expect(parsed.nodeCount).toBe(1);
    expect(parsed.results[0].nodeId).toBe('a');
  });
});

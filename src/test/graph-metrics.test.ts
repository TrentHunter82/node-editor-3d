/**
 * Tests for getGraphComplexity (src/utils/graphMetrics.ts)
 *
 * Covers: nodeCount, connectionCount, maxFanIn, maxFanOut, avgConnectivity,
 * longestPath, cyclomaticComplexity, connectedComponents, isolatedNodes
 */
import { describe, it, expect } from 'vitest';
import { getGraphComplexity } from '../utils/graphMetrics';
import type { EditorNode, Connection } from '../types';

function makeNode(id: string): EditorNode {
  return { id, type: 'source', position: [0, 0, 0], title: id, data: {}, inputs: [], outputs: [] };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

describe('getGraphComplexity', () => {
  it('returns zeros for empty graph', () => {
    const c = getGraphComplexity({}, {});
    expect(c.nodeCount).toBe(0);
    expect(c.connectionCount).toBe(0);
    expect(c.maxFanIn).toBe(0);
    expect(c.maxFanOut).toBe(0);
    expect(c.avgConnectivity).toBe(0);
    expect(c.longestPath).toBe(0);
    expect(c.cyclomaticComplexity).toBe(0);
    expect(c.connectedComponents).toBe(0);
    expect(c.isolatedNodes).toBe(0);
  });

  it('counts isolated nodes correctly', () => {
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c') };
    const c = getGraphComplexity(nodes, {});
    expect(c.nodeCount).toBe(3);
    expect(c.connectionCount).toBe(0);
    expect(c.isolatedNodes).toBe(3);
    expect(c.connectedComponents).toBe(3);
    expect(c.maxFanIn).toBe(0);
    expect(c.maxFanOut).toBe(0);
    expect(c.avgConnectivity).toBe(0);
    expect(c.longestPath).toBe(1); // single node = path length 1
  });

  it('computes linear chain correctly', () => {
    // a → b → c → d
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c'), d: makeNode('d') };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
      c3: makeConn('c3', 'c', 0, 'd', 0),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.nodeCount).toBe(4);
    expect(c.connectionCount).toBe(3);
    expect(c.maxFanIn).toBe(1);
    expect(c.maxFanOut).toBe(1);
    expect(c.longestPath).toBe(4);
    expect(c.connectedComponents).toBe(1);
    expect(c.isolatedNodes).toBe(0);
  });

  it('detects fan-out correctly', () => {
    // a → b, a → c, a → d (fan-out 3)
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c'), d: makeNode('d') };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 0, 'c', 0),
      c3: makeConn('c3', 'a', 0, 'd', 0),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.maxFanOut).toBe(3);
    expect(c.maxFanIn).toBe(1);
  });

  it('detects fan-in correctly', () => {
    // a → d, b → d, c → d (fan-in 3)
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c'), d: makeNode('d') };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'd', 0),
      c2: makeConn('c2', 'b', 0, 'd', 0),
      c3: makeConn('c3', 'c', 0, 'd', 0),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.maxFanIn).toBe(3);
    expect(c.maxFanOut).toBe(1);
  });

  it('computes average connectivity', () => {
    // a → b, a → c (a: out=2, b: in=1, c: in=1) → total degree = 4, avg = 4/3
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c') };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 0, 'c', 0),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.avgConnectivity).toBeCloseTo(4 / 3, 1);
  });

  it('detects multiple connected components', () => {
    // Component 1: a → b; Component 2: c → d; Isolated: e
    const nodes = {
      a: makeNode('a'), b: makeNode('b'),
      c: makeNode('c'), d: makeNode('d'),
      e: makeNode('e'),
    };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'c', 0, 'd', 0),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.connectedComponents).toBe(3); // 2 connected + 1 isolated
    expect(c.isolatedNodes).toBe(1);
  });

  it('computes diamond DAG longest path', () => {
    //   a
    //  / \
    // b   c
    //  \ /
    //   d
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c'), d: makeNode('d') };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 0, 'c', 0),
      c3: makeConn('c3', 'b', 0, 'd', 0),
      c4: makeConn('c4', 'c', 0, 'd', 0),
    };
    const c = getGraphComplexity(nodes, conns);
    expect(c.longestPath).toBe(3); // a → b → d (or a → c → d)
    expect(c.maxFanIn).toBe(2); // d
    expect(c.maxFanOut).toBe(2); // a
    expect(c.connectedComponents).toBe(1);
  });

  it('cyclomatic complexity is at least 1', () => {
    const nodes = { a: makeNode('a') };
    const c = getGraphComplexity(nodes, {});
    expect(c.cyclomaticComplexity).toBeGreaterThanOrEqual(1);
  });

  it('cyclomatic complexity grows with connections', () => {
    // E - N + 2P formula
    // Chain: 3 edges - 4 nodes + 2*1 = 1
    const nodesChain = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c'), d: makeNode('d') };
    const connsChain = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
      c3: makeConn('c3', 'c', 0, 'd', 0),
    };
    const cc1 = getGraphComplexity(nodesChain, connsChain);

    // Diamond: 4 edges - 4 nodes + 2*1 = 2
    const nodesDiamond = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c'), d: makeNode('d') };
    const connsDiamond = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 0, 'c', 0),
      c3: makeConn('c3', 'b', 0, 'd', 0),
      c4: makeConn('c4', 'c', 0, 'd', 0),
    };
    const cc2 = getGraphComplexity(nodesDiamond, connsDiamond);

    expect(cc2.cyclomaticComplexity).toBeGreaterThan(cc1.cyclomaticComplexity);
  });

  it('skips connections with dangling endpoints', () => {
    const nodes = { a: makeNode('a'), b: makeNode('b') };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 0, 'nonexistent', 0), // dangling
    };
    const c = getGraphComplexity(nodes, conns);
    // Only c1 should be counted in fan-out/fan-in
    expect(c.maxFanOut).toBe(1);
    expect(c.connectedComponents).toBe(1);
  });

  it('handles single node graph', () => {
    const c = getGraphComplexity({ a: makeNode('a') }, {});
    expect(c.nodeCount).toBe(1);
    expect(c.connectedComponents).toBe(1);
    expect(c.isolatedNodes).toBe(1);
    expect(c.longestPath).toBe(1);
  });

  it('handles large fan-in and fan-out simultaneously', () => {
    // Hub node: 5 inputs, 5 outputs
    const nodes: Record<string, EditorNode> = { hub: makeNode('hub') };
    const conns: Record<string, Connection> = {};
    for (let i = 0; i < 5; i++) {
      const inId = `in${i}`;
      const outId = `out${i}`;
      nodes[inId] = makeNode(inId);
      nodes[outId] = makeNode(outId);
      conns[`ci${i}`] = makeConn(`ci${i}`, inId, 0, 'hub', 0);
      conns[`co${i}`] = makeConn(`co${i}`, 'hub', 0, outId, 0);
    }
    const c = getGraphComplexity(nodes, conns);
    expect(c.maxFanIn).toBe(5);
    expect(c.maxFanOut).toBe(5);
    expect(c.nodeCount).toBe(11);
    expect(c.connectedComponents).toBe(1);
    expect(c.longestPath).toBe(3); // in → hub → out
  });
});

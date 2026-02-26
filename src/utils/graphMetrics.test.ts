import { describe, it, expect } from 'vitest';
import type { EditorNode, Connection, NodeType } from '../types';
import { getGraphComplexity } from './graphMetrics';

// --- Helpers ---

function makeNode(id: string): EditorNode {
  return {
    id,
    type: 'source' as NodeType,
    position: [0, 0, 0] as [number, number, number],
    title: `Node ${id}`,
    data: {},
    inputs: [{ id: 'in0', label: 'in', portType: 'number' as const }],
    outputs: [{ id: 'out0', label: 'out', portType: 'number' as const }],
  };
}

function makeConn(id: string, src: string, tgt: string): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: 0,
    targetNodeId: tgt,
    targetPortIndex: 0,
  };
}

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  const rec: Record<string, T> = {};
  for (const item of items) rec[item.id] = item;
  return rec;
}

// --- Tests ---

describe('getGraphComplexity', () => {
  // ── 1. Empty graph ────────────────────────────────────────────────
  it('returns all zeros for an empty graph', () => {
    const result = getGraphComplexity({}, {});
    expect(result).toEqual({
      nodeCount: 0,
      connectionCount: 0,
      maxFanIn: 0,
      maxFanOut: 0,
      avgConnectivity: 0,
      longestPath: 0,
      cyclomaticComplexity: 0,
      connectedComponents: 0,
      isolatedNodes: 0,
    });
  });

  // ── 2. Single isolated node ───────────────────────────────────────
  it('handles a single isolated node', () => {
    const nodes = toRecord([makeNode('A')]);
    const result = getGraphComplexity(nodes, {});
    expect(result.nodeCount).toBe(1);
    expect(result.connectionCount).toBe(0);
    expect(result.isolatedNodes).toBe(1);
    expect(result.connectedComponents).toBe(1);
    expect(result.cyclomaticComplexity).toBe(1);
    expect(result.longestPath).toBe(1);
    expect(result.maxFanIn).toBe(0);
    expect(result.maxFanOut).toBe(0);
    expect(result.avgConnectivity).toBe(0);
  });

  // ── 3. Two connected nodes ────────────────────────────────────────
  it('handles two connected nodes (A -> B)', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B')]);
    const conns = toRecord([makeConn('c1', 'A', 'B')]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.nodeCount).toBe(2);
    expect(result.connectionCount).toBe(1);
    expect(result.longestPath).toBe(2);
    expect(result.connectedComponents).toBe(1);
    expect(result.isolatedNodes).toBe(0);
    expect(result.maxFanIn).toBe(1);
    expect(result.maxFanOut).toBe(1);
  });

  // ── 4. Linear chain A -> B -> C -> D ──────────────────────────────
  it('computes longestPath for a linear chain A->B->C->D', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'B', 'C'),
      makeConn('c3', 'C', 'D'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.longestPath).toBe(4);
    expect(result.maxFanIn).toBe(1);
    expect(result.maxFanOut).toBe(1);
    expect(result.connectedComponents).toBe(1);
    expect(result.isolatedNodes).toBe(0);
  });

  // ── 5. Fan-out: A -> B, A -> C, A -> D ───────────────────────────
  it('computes maxFanOut for a fan-out pattern', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
      makeConn('c3', 'A', 'D'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.maxFanOut).toBe(3);
    expect(result.maxFanIn).toBe(1);
    expect(result.longestPath).toBe(2);
    expect(result.connectedComponents).toBe(1);
  });

  // ── 6. Fan-in: A -> D, B -> D, C -> D ────────────────────────────
  it('computes maxFanIn for a fan-in pattern', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'D'),
      makeConn('c2', 'B', 'D'),
      makeConn('c3', 'C', 'D'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.maxFanIn).toBe(3);
    expect(result.maxFanOut).toBe(1);
    expect(result.longestPath).toBe(2);
    expect(result.connectedComponents).toBe(1);
  });

  // ── 7. Diamond: A->B, A->C, B->D, C->D ───────────────────────────
  it('computes longestPath for a diamond graph', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
      makeConn('c3', 'B', 'D'),
      makeConn('c4', 'C', 'D'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.longestPath).toBe(3);
    expect(result.maxFanIn).toBe(2);
    expect(result.maxFanOut).toBe(2);
    expect(result.connectedComponents).toBe(1);
  });

  // ── 8. Disconnected components ────────────────────────────────────
  it('counts disconnected connected components', () => {
    const nodes = toRecord([
      makeNode('A'), makeNode('B'),
      makeNode('C'), makeNode('D'),
    ]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'C', 'D'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.connectedComponents).toBe(2);
    expect(result.isolatedNodes).toBe(0);
  });

  // ── 9. Mixed isolated + connected ─────────────────────────────────
  it('counts isolated nodes among connected ones', () => {
    const nodes = toRecord([
      makeNode('A'), makeNode('B'), makeNode('C'),
      makeNode('X'), makeNode('Y'),
    ]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'B', 'C'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.connectedComponents).toBe(3); // {A,B,C}, {X}, {Y}
    expect(result.isolatedNodes).toBe(2);
  });

  // ── 10. Cyclic graph: A -> B -> C -> A ─────────────────────────────
  it('handles a cyclic graph (A->B->C->A)', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'B', 'C'),
      makeConn('c3', 'C', 'A'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    // E - N + 2P = 3 - 3 + 2*1 = 2
    expect(result.cyclomaticComplexity).toBe(2);
    expect(result.connectedComponents).toBe(1);
    // All nodes are in the cycle, none processed by topo sort (all have inDeg > 0)
    // longestPath from acyclic portion: tempInDeg checked — all still > 0, so longestPath = 0
    expect(result.longestPath).toBe(0);
  });

  // ── 11. Dangling connections (non-existent nodes) ─────────────────
  it('ignores connections referencing non-existent nodes', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'GHOST'),   // target missing
      makeConn('c3', 'GHOST', 'B'),   // source missing
    ]);
    const result = getGraphComplexity(nodes, conns);
    // connectionCount reflects ALL passed connections (including dangling)
    expect(result.connectionCount).toBe(3);
    // But metrics should only reflect the single valid connection
    expect(result.maxFanIn).toBe(1);
    expect(result.maxFanOut).toBe(1);
    expect(result.longestPath).toBe(2);
    expect(result.connectedComponents).toBe(1);
    expect(result.isolatedNodes).toBe(0);
  });

  // ── 12. avgConnectivity formula verification ──────────────────────
  it('computes avgConnectivity correctly', () => {
    // A->B, A->C: degrees: A(0in + 2out = 2), B(1in + 0out = 1), C(1in + 0out = 1)
    // total = 4, avg = 4/3 = 1.333... rounded to 1.33
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.avgConnectivity).toBe(1.33);
  });

  // ── 13. Large fan-out (10 connections) ────────────────────────────
  it('handles large fan-out (10 targets)', () => {
    const targets = Array.from({ length: 10 }, (_, i) => makeNode(`T${i}`));
    const hub = makeNode('HUB');
    const nodes = toRecord([hub, ...targets]);
    const conns = toRecord(
      targets.map((t, i) => makeConn(`c${i}`, 'HUB', t.id)),
    );
    const result = getGraphComplexity(nodes, conns);
    expect(result.maxFanOut).toBe(10);
    expect(result.maxFanIn).toBe(1);
    expect(result.connectedComponents).toBe(1);
    expect(result.longestPath).toBe(2);
  });

  // ── 14. Large fan-in (10 sources into one) ────────────────────────
  it('handles large fan-in (10 sources)', () => {
    const sources = Array.from({ length: 10 }, (_, i) => makeNode(`S${i}`));
    const sink = makeNode('SINK');
    const nodes = toRecord([sink, ...sources]);
    const conns = toRecord(
      sources.map((s, i) => makeConn(`c${i}`, s.id, 'SINK')),
    );
    const result = getGraphComplexity(nodes, conns);
    expect(result.maxFanIn).toBe(10);
    expect(result.maxFanOut).toBe(1);
    expect(result.longestPath).toBe(2);
  });

  // ── 15. cyclomaticComplexity minimum is 1 ─────────────────────────
  it('clamps cyclomaticComplexity to minimum 1', () => {
    // Single node: E - N + 2P = 0 - 1 + 2 = 1 (already 1)
    const result1 = getGraphComplexity(toRecord([makeNode('A')]), {});
    expect(result1.cyclomaticComplexity).toBe(1);

    // Two isolated nodes: E - N + 2P = 0 - 2 + 2*2 = 2
    const result2 = getGraphComplexity(toRecord([makeNode('A'), makeNode('B')]), {});
    expect(result2.cyclomaticComplexity).toBe(2);
  });

  // ── 16. cyclomaticComplexity formula: E - N + 2P ──────────────────
  it('computes cyclomaticComplexity as E - N + 2P', () => {
    // Diamond: 4 edges, 4 nodes, 1 component => 4 - 4 + 2 = 2
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
      makeConn('c3', 'B', 'D'),
      makeConn('c4', 'C', 'D'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.cyclomaticComplexity).toBe(2);
  });

  // ── 17. Multiple isolated nodes ───────────────────────────────────
  it('counts all nodes as isolated when there are no connections', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C')]);
    const result = getGraphComplexity(nodes, {});
    expect(result.isolatedNodes).toBe(3);
    expect(result.connectedComponents).toBe(3);
    expect(result.longestPath).toBe(1);
  });

  // ── 18. Cycle with a tail: D -> A -> B -> C -> A ──────────────────
  it('handles a cycle with an acyclic tail (D->A->B->C->A)', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D')]);
    const conns = toRecord([
      makeConn('c1', 'D', 'A'),
      makeConn('c2', 'A', 'B'),
      makeConn('c3', 'B', 'C'),
      makeConn('c4', 'C', 'A'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    // D has inDeg=0, gets processed. D's dist = 1.
    // D -> A: A gets dist = 2, inDeg goes 2 -> 1 (still > 0, since C->A).
    // A, B, C are stuck in cycle. processedCount = 1, not = nodeCount.
    // Acyclic portion: only D with tempInDeg=0, dist=1. A/B/C have tempInDeg > 0.
    expect(result.longestPath).toBe(1);
    expect(result.connectedComponents).toBe(1);
    // E - N + 2P = 4 - 4 + 2 = 2
    expect(result.cyclomaticComplexity).toBe(2);
  });

  // ── 19. Self-loop ─────────────────────────────────────────────────
  it('handles a self-loop (A->A)', () => {
    const nodes = toRecord([makeNode('A')]);
    const conns = toRecord([makeConn('c1', 'A', 'A')]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.nodeCount).toBe(1);
    expect(result.connectionCount).toBe(1);
    expect(result.maxFanIn).toBe(1);
    expect(result.maxFanOut).toBe(1);
    // A has inDeg=1, so never dequeued in topo sort. processedCount=0, longestPath=0
    expect(result.longestPath).toBe(0);
    // E - N + 2P = 1 - 1 + 2*1 = 2
    expect(result.cyclomaticComplexity).toBe(2);
    // Self-loop creates an undirected edge A<->A, so A has a neighbor (itself)
    // That means A is NOT isolated
    expect(result.isolatedNodes).toBe(0);
    expect(result.connectedComponents).toBe(1);
  });

  // ── 20. Three disconnected pairs ──────────────────────────────────
  it('counts components for three disconnected pairs', () => {
    const nodes = toRecord([
      makeNode('A'), makeNode('B'),
      makeNode('C'), makeNode('D'),
      makeNode('E'), makeNode('F'),
    ]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'C', 'D'),
      makeConn('c3', 'E', 'F'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.connectedComponents).toBe(3);
    expect(result.isolatedNodes).toBe(0);
    expect(result.longestPath).toBe(2);
  });

  // ── 21. avgConnectivity with mixed degrees ────────────────────────
  it('avgConnectivity rounds to two decimal places', () => {
    // A->B, B->C: A(out=1), B(in=1, out=1), C(in=1) => total=4, avg=4/3=1.33
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'B', 'C'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.avgConnectivity).toBe(1.33);
  });

  // ── 22. Parallel edges between the same pair ──────────────────────
  it('handles multiple parallel connections between the same nodes', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B')]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'B'),
      makeConn('c3', 'A', 'B'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.connectionCount).toBe(3);
    expect(result.maxFanOut).toBe(3);
    expect(result.maxFanIn).toBe(3);
    // avgConnectivity: A(out=3) + B(in=3) = 6 / 2 = 3
    expect(result.avgConnectivity).toBe(3);
    // longestPath: A has inDeg=0, dist=1. A->B updates dist(B) three times, all to 2.
    // B dequeued once inDeg drops to 0. longestPath=2
    expect(result.longestPath).toBe(2);
  });

  // ── 23. Complex DAG with multiple paths ───────────────────────────
  it('finds the correct longest path in a complex DAG', () => {
    // A -> B -> D -> E
    //  \-> C ------/
    // Longest: A->B->D->E = 4
    const nodes = toRecord([
      makeNode('A'), makeNode('B'), makeNode('C'),
      makeNode('D'), makeNode('E'),
    ]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
      makeConn('c3', 'B', 'D'),
      makeConn('c4', 'D', 'E'),
      makeConn('c5', 'C', 'E'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.longestPath).toBe(4);
    expect(result.connectedComponents).toBe(1);
  });

  // ── 24. Only dangling connections, no valid edges ─────────────────
  it('treats graph as fully isolated when all connections are dangling', () => {
    const nodes = toRecord([makeNode('A'), makeNode('B')]);
    const conns = toRecord([
      makeConn('c1', 'GHOST1', 'GHOST2'),
      makeConn('c2', 'GHOST3', 'A'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.connectionCount).toBe(2);
    expect(result.maxFanIn).toBe(0);
    expect(result.maxFanOut).toBe(0);
    expect(result.isolatedNodes).toBe(2);
    expect(result.connectedComponents).toBe(2);
    expect(result.longestPath).toBe(1);
  });

  // ── 25. Binary tree shape ─────────────────────────────────────────
  it('computes metrics for a binary tree structure', () => {
    //       A
    //      / \
    //     B   C
    //    / \   \
    //   D   E   F
    const nodes = toRecord([
      makeNode('A'), makeNode('B'), makeNode('C'),
      makeNode('D'), makeNode('E'), makeNode('F'),
    ]);
    const conns = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
      makeConn('c3', 'B', 'D'),
      makeConn('c4', 'B', 'E'),
      makeConn('c5', 'C', 'F'),
    ]);
    const result = getGraphComplexity(nodes, conns);
    expect(result.nodeCount).toBe(6);
    expect(result.connectionCount).toBe(5);
    expect(result.maxFanOut).toBe(2);
    expect(result.maxFanIn).toBe(1);
    expect(result.longestPath).toBe(3);
    expect(result.connectedComponents).toBe(1);
    expect(result.isolatedNodes).toBe(0);
    // E - N + 2P = 5 - 6 + 2 = 1
    expect(result.cyclomaticComplexity).toBe(1);
  });
});

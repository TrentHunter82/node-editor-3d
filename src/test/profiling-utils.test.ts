import { describe, it, expect } from 'vitest';
import {
  getCriticalPath,
  detectBottlenecks,
  getNodeCountByType,
  getConnectionDensity,
  getGraphAnalytics,
} from '../utils/profiling';
import type { EditorNode, Connection, NodeExecutionMetric, NodeType } from '../types';

// --- Helpers ---

function mkNode(id: string, type: NodeType = 'transform', inputs = 1, outputs = 1): EditorNode {
  return {
    id,
    type,
    position: [0, 0, 0],
    title: id,
    data: {},
    inputs: Array.from({ length: inputs }, (_, i) => ({
      id: `${id}-in${i}`,
      label: `in${i}`,
      portType: 'number' as const,
    })),
    outputs: Array.from({ length: outputs }, (_, i) => ({
      id: `${id}-out${i}`,
      label: `out${i}`,
      portType: 'number' as const,
    })),
  };
}

function mkConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  const rec: Record<string, T> = {};
  for (const item of items) rec[item.id] = item;
  return rec;
}

// --- getCriticalPath ---

describe('getCriticalPath', () => {
  it('returns length 0 and empty path for an empty graph', () => {
    const result = getCriticalPath({}, {});
    expect(result).toEqual({ length: 0, path: [] });
  });

  it('returns length 1 and single node for a graph with one node (no metrics)', () => {
    const nodes = toRecord([mkNode('A')]);
    const result = getCriticalPath(nodes, {});
    expect(result).toEqual({ length: 1, path: ['A'] });
  });

  it('returns the full linear chain A->B->C with length 3 (no metrics, weight=1 each)', () => {
    const nodes = toRecord([mkNode('A'), mkNode('B'), mkNode('C')]);
    const conns = toRecord([
      mkConn('c1', 'A', 0, 'B', 0),
      mkConn('c2', 'B', 0, 'C', 0),
    ]);
    const result = getCriticalPath(nodes, conns);
    expect(result).toEqual({ length: 3, path: ['A', 'B', 'C'] });
  });

  it('uses metric durations as weights and treats cache hits as weight 0', () => {
    // A(10ms) -> B(cached,0) -> C(5ms)
    const nodes = toRecord([mkNode('A'), mkNode('B'), mkNode('C')]);
    const conns = toRecord([
      mkConn('c1', 'A', 0, 'B', 0),
      mkConn('c2', 'B', 0, 'C', 0),
    ]);
    const metrics: Record<string, NodeExecutionMetric> = {
      A: { duration: 10, cacheHit: false, timestamp: 0 },
      B: { duration: 3, cacheHit: true, timestamp: 10 },
      C: { duration: 5, cacheHit: false, timestamp: 13 },
    };
    const result = getCriticalPath(nodes, conns, metrics);
    // A=10, B=0 (cache hit), C=5 => total 15
    expect(result.length).toBe(15);
    expect(result.path).toEqual(['A', 'B', 'C']);
  });

  it('picks the longer path in a diamond graph (A->B->D, A->C->D)', () => {
    const nodes = toRecord([mkNode('A'), mkNode('B'), mkNode('C'), mkNode('D')]);
    const conns = toRecord([
      mkConn('c1', 'A', 0, 'B', 0),
      mkConn('c2', 'A', 0, 'C', 0),
      mkConn('c3', 'B', 0, 'D', 0),
      mkConn('c4', 'C', 0, 'D', 0),
    ]);
    // With metrics: A=1, B=10, C=2, D=1
    const metrics: Record<string, NodeExecutionMetric> = {
      A: { duration: 1, cacheHit: false, timestamp: 0 },
      B: { duration: 10, cacheHit: false, timestamp: 1 },
      C: { duration: 2, cacheHit: false, timestamp: 1 },
      D: { duration: 1, cacheHit: false, timestamp: 11 },
    };
    const result = getCriticalPath(nodes, conns, metrics);
    // Path A->B->D = 1+10+1 = 12, Path A->C->D = 1+2+1 = 4
    expect(result.length).toBe(12);
    expect(result.path).toEqual(['A', 'B', 'D']);
  });
});

// --- detectBottlenecks ---

describe('detectBottlenecks', () => {
  it('returns empty array for an empty graph', () => {
    const result = detectBottlenecks({}, {});
    expect(result).toEqual([]);
  });

  it('returns empty array when no node has fan-in >= 2', () => {
    const nodes = toRecord([mkNode('A'), mkNode('B')]);
    const conns = toRecord([mkConn('c1', 'A', 0, 'B', 0)]);
    const result = detectBottlenecks(nodes, conns);
    expect(result).toEqual([]);
  });

  it('detects a node with fan-in 3', () => {
    const nodes = toRecord([mkNode('A'), mkNode('B'), mkNode('C'), mkNode('D', 'transform', 3)]);
    const conns = toRecord([
      mkConn('c1', 'A', 0, 'D', 0),
      mkConn('c2', 'B', 0, 'D', 1),
      mkConn('c3', 'C', 0, 'D', 2),
    ]);
    const result = detectBottlenecks(nodes, conns);
    expect(result).toHaveLength(1);
    expect(result[0].nodeId).toBe('D');
    expect(result[0].fanIn).toBe(3);
    expect(result[0].fanOut).toBe(0);
  });

  it('respects custom minFanIn threshold and sorts by fan-in descending', () => {
    // E has fan-in 4, F has fan-in 3
    const nodes = toRecord([
      mkNode('A'), mkNode('B'), mkNode('C'), mkNode('D'),
      mkNode('E', 'transform', 4), mkNode('F', 'transform', 3),
    ]);
    const conns = toRecord([
      mkConn('c1', 'A', 0, 'E', 0),
      mkConn('c2', 'B', 0, 'E', 1),
      mkConn('c3', 'C', 0, 'E', 2),
      mkConn('c4', 'D', 0, 'E', 3),
      mkConn('c5', 'A', 0, 'F', 0),
      mkConn('c6', 'B', 0, 'F', 1),
      mkConn('c7', 'C', 0, 'F', 2),
    ]);
    // With minFanIn=3, both E (4) and F (3) qualify; with minFanIn=4 only E
    const result3 = detectBottlenecks(nodes, conns, 3);
    expect(result3).toHaveLength(2);
    expect(result3[0].nodeId).toBe('E');
    expect(result3[0].fanIn).toBe(4);
    expect(result3[1].nodeId).toBe('F');
    expect(result3[1].fanIn).toBe(3);

    const result4 = detectBottlenecks(nodes, conns, 4);
    expect(result4).toHaveLength(1);
    expect(result4[0].nodeId).toBe('E');
  });
});

// --- getNodeCountByType ---

describe('getNodeCountByType', () => {
  it('returns empty object for an empty graph', () => {
    expect(getNodeCountByType({})).toEqual({});
  });

  it('counts nodes correctly by type', () => {
    const nodes = toRecord([
      mkNode('A', 'source'),
      mkNode('B', 'transform'),
      mkNode('C', 'source'),
      mkNode('D', 'output'),
      mkNode('E', 'transform'),
      mkNode('F', 'transform'),
    ]);
    const result = getNodeCountByType(nodes);
    expect(result).toEqual({ source: 2, transform: 3, output: 1 });
  });
});

// --- getConnectionDensity ---

describe('getConnectionDensity', () => {
  it('returns 0 when there are no ports (denominator is 0)', () => {
    // Nodes with 0 inputs and 0 outputs
    const nodes = toRecord([mkNode('A', 'transform', 0, 0)]);
    const result = getConnectionDensity(nodes, {});
    expect(result).toBe(0);
  });

  it('calculates density as actual / (totalOutputs * totalInputs)', () => {
    // A has 1 output, B has 1 input, C has 1 input
    // Total outputs = 1+1+1 = 3, total inputs = 1+1+1 = 3
    // Max = 3*3 = 9, actual = 2
    const nodes = toRecord([mkNode('A'), mkNode('B'), mkNode('C')]);
    const conns = toRecord([
      mkConn('c1', 'A', 0, 'B', 0),
      mkConn('c2', 'A', 0, 'C', 0),
    ]);
    const result = getConnectionDensity(nodes, conns);
    expect(result).toBeCloseTo(2 / 9);
  });
});

// --- getGraphAnalytics ---

describe('getGraphAnalytics', () => {
  it('returns zeroed analytics for an empty graph', () => {
    const result = getGraphAnalytics({}, {});
    expect(result).toEqual({
      nodeCount: 0,
      connectionCount: 0,
      nodeCountByType: {},
      connectionDensity: 0,
      criticalPathLength: 0,
      criticalPath: [],
    });
  });

  it('returns correct composite analytics for a populated graph', () => {
    const nodes = toRecord([
      mkNode('A', 'source'),
      mkNode('B', 'transform'),
      mkNode('C', 'output'),
    ]);
    const conns = toRecord([
      mkConn('c1', 'A', 0, 'B', 0),
      mkConn('c2', 'B', 0, 'C', 0),
    ]);
    const metrics: Record<string, NodeExecutionMetric> = {
      A: { duration: 5, cacheHit: false, timestamp: 0 },
      B: { duration: 10, cacheHit: false, timestamp: 5 },
      C: { duration: 3, cacheHit: false, timestamp: 15 },
    };
    const result = getGraphAnalytics(nodes, conns, metrics);

    expect(result.nodeCount).toBe(3);
    expect(result.connectionCount).toBe(2);
    expect(result.nodeCountByType).toEqual({ source: 1, transform: 1, output: 1 });
    expect(result.connectionDensity).toBeCloseTo(2 / 9);
    expect(result.criticalPathLength).toBe(18); // 5 + 10 + 3
    expect(result.criticalPath).toEqual(['A', 'B', 'C']);
  });
});

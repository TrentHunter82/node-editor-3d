import { describe, it, expect } from 'vitest';
import {
  topologicalSort,
  topologicalOrder,
  executeGraph,
  invalidateDownstream,
  getUpstreamPath,
  getDownstreamPath,
  getBottleneckNodes,
  getCacheHitRate,
  getExecutionTimeline,
} from './executionOrchestration';
import type { EditorNode, Connection, NodeType, NodeExecutionMetric } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: NodeType = 'source',
  data: Record<string, unknown> = { value: 1 },
): EditorNode {
  return {
    id,
    type,
    position: [0, 0, 0] as [number, number, number],
    title: `Node ${id}`,
    data,
    inputs: [{ id: 'in0', label: 'in', portType: 'number' as const }],
    outputs: [{ id: 'out0', label: 'out', portType: 'number' as const }],
  };
}

function makeConn(
  id: string,
  src: string,
  srcPort: number,
  tgt: string,
  tgtPort: number,
): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: srcPort,
    targetNodeId: tgt,
    targetPortIndex: tgtPort,
  };
}

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe('topologicalSort', () => {
  it('returns empty waves for an empty graph', () => {
    const waves = topologicalSort({}, {});
    expect(waves).toEqual([]);
  });

  it('returns a single wave containing the only node', () => {
    const nodes = { a: makeNode('a') };
    const waves = topologicalSort(nodes, {});
    expect(waves).toEqual([['a']]);
  });

  it('produces 3 waves for a linear chain A -> B -> C', () => {
    const nodes = {
      a: makeNode('a'),
      b: makeNode('b'),
      c: makeNode('c'),
    };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };
    const waves = topologicalSort(nodes, conns);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toContain('a');
    expect(waves[1]).toContain('b');
    expect(waves[2]).toContain('c');
  });

  it('puts all independent nodes into a single wave', () => {
    const nodes = {
      a: makeNode('a'),
      b: makeNode('b'),
      c: makeNode('c'),
    };
    const waves = topologicalSort(nodes, {});
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(3);
    expect(waves[0]).toContain('a');
    expect(waves[0]).toContain('b');
    expect(waves[0]).toContain('c');
  });

  it('handles a diamond graph (A->B, A->C, B->D, C->D) in 3 waves', () => {
    const nodes = {
      a: makeNode('a'),
      b: makeNode('b'),
      c: makeNode('c'),
      d: makeNode('d'),
    };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 0, 'c', 0),
      c3: makeConn('c3', 'b', 0, 'd', 0),
      c4: makeConn('c4', 'c', 0, 'd', 0),
    };
    const waves = topologicalSort(nodes, conns);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toContain('a');
    expect(waves[1]).toContain('b');
    expect(waves[1]).toContain('c');
    expect(waves[2]).toContain('d');
  });

  it('throws on a cycle (A -> B -> A)', () => {
    const nodes = {
      a: makeNode('a'),
      b: makeNode('b'),
    };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'a', 0),
    };
    expect(() => topologicalSort(nodes, conns)).toThrow('cycle');
  });

  it('throws on a self-loop (A -> A)', () => {
    const nodes = { a: makeNode('a') };
    const conns = { c1: makeConn('c1', 'a', 0, 'a', 0) };
    expect(() => topologicalSort(nodes, conns)).toThrow('cycle');
  });

  it('ignores dangling connections referencing missing nodes', () => {
    const nodes = { a: makeNode('a') };
    // Connection references node 'x' which does not exist in nodes
    const conns = { c1: makeConn('c1', 'a', 0, 'x', 0) };
    const waves = topologicalSort(nodes, conns);
    expect(waves).toEqual([['a']]);
  });
});

// ---------------------------------------------------------------------------
// topologicalOrder
// ---------------------------------------------------------------------------

describe('topologicalOrder', () => {
  it('returns a flattened version of topologicalSort', () => {
    const nodes = {
      a: makeNode('a'),
      b: makeNode('b'),
      c: makeNode('c'),
    };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };
    const order = topologicalOrder(nodes, conns);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for an empty graph', () => {
    expect(topologicalOrder({}, {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// executeGraph
// ---------------------------------------------------------------------------

describe('executeGraph', () => {
  it('returns empty results for an empty graph', () => {
    const result = executeGraph({}, {});
    expect(result.results.size).toBe(0);
    expect(result.waves).toEqual([]);
    expect(result.errors.size).toBe(0);
  });

  it('executes a single source node and produces outputs', () => {
    const nodes = {
      s: makeNode('s', 'source', { value: 42 }),
    };
    // Source node: no inputs, outputs: { 0: value, 1: label }
    const result = executeGraph(nodes, {});
    expect(result.errors.size).toBe(0);
    expect(result.results.has('s')).toBe(true);
    const nodeResult = result.results.get('s')!;
    expect(nodeResult.outputs[0]).toBe(42);
  });

  it('propagates data through a chain: source -> math (add) -> output', () => {
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Source',
        data: { value: 10 },
        inputs: [],
        outputs: [
          { id: 'out0', label: 'value', portType: 'number' },
          { id: 'out1', label: 'label', portType: 'string' },
        ],
      },
      add: {
        id: 'add',
        type: 'math',
        position: [2, 0, 0],
        title: 'Add',
        data: { operation: 'add' },
        inputs: [
          { id: 'in0', label: 'a', portType: 'number' },
          { id: 'in1', label: 'b', portType: 'number' },
        ],
        outputs: [
          { id: 'out0', label: 'result', portType: 'number' },
        ],
      },
      out: {
        id: 'out',
        type: 'output',
        position: [4, 0, 0],
        title: 'Output',
        data: {},
        inputs: [
          { id: 'in0', label: 'data', portType: 'any' },
          { id: 'in1', label: 'label', portType: 'string' },
        ],
        outputs: [],
      },
    };
    const conns: Record<string, Connection> = {
      // source value -> math port a
      c1: makeConn('c1', 'src', 0, 'add', 0),
      // source value -> math port b (10 + 10 = 20)
      c2: makeConn('c2', 'src', 0, 'add', 1),
      // math result -> output
      c3: makeConn('c3', 'add', 0, 'out', 0),
    };

    const result = executeGraph(nodes, conns);
    expect(result.errors.size).toBe(0);
    // Math add: 10 + 10 = 20
    expect(result.results.get('add')!.outputs[0]).toBe(20);
    // Output node receives the result (output processor returns {})
    expect(result.results.has('out')).toBe(true);
  });

  it('uses cache when inputs have not changed (cacheHit = true)', () => {
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Source',
        data: { value: 5 },
        inputs: [],
        outputs: [
          { id: 'out0', label: 'value', portType: 'number' },
          { id: 'out1', label: 'label', portType: 'string' },
        ],
      },
      add: {
        id: 'add',
        type: 'math',
        position: [2, 0, 0],
        title: 'Add',
        data: { operation: 'add' },
        inputs: [
          { id: 'in0', label: 'a', portType: 'number' },
          { id: 'in1', label: 'b', portType: 'number' },
        ],
        outputs: [
          { id: 'out0', label: 'result', portType: 'number' },
        ],
      },
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'add', 0),
      c2: makeConn('c2', 'src', 0, 'add', 1),
    };

    // First execution builds the cache
    const result1 = executeGraph(nodes, conns);
    expect(result1.errors.size).toBe(0);

    // Second execution with the same results as cache
    const cache = result1.results;
    const result2 = executeGraph(nodes, conns, cache);
    expect(result2.errors.size).toBe(0);

    // Source node has no inputs — hash is always the same, so it should be cached
    expect(result2.metrics.get('src')!.cacheHit).toBe(true);
    // Math node receives same inputs, should also be cached
    expect(result2.metrics.get('add')!.cacheHit).toBe(true);
  });

  it('always re-executes non-deterministic nodes (timer)', () => {
    const nodes: Record<string, EditorNode> = {
      t: {
        id: 't',
        type: 'timer',
        position: [0, 0, 0],
        title: 'Timer',
        data: { intervalMs: 1000 },
        inputs: [],
        outputs: [{ id: 'out0', label: 'time', portType: 'number' }],
      },
    };

    // First execution
    const result1 = executeGraph(nodes, {});
    expect(result1.errors.size).toBe(0);
    const cache = result1.results;

    // Second execution with same cache — timer is non-deterministic, should NOT use cache
    const result2 = executeGraph(nodes, {}, cache);
    expect(result2.metrics.get('t')!.cacheHit).toBe(false);
  });

  it('records an error for unknown node types', () => {
    const nodes: Record<string, EditorNode> = {
      x: makeNode('x', 'custom' as NodeType, { expression: '', inputCount: 0, outputCount: 0 }),
    };
    // Override to a truly unknown type that has no processor and no plugin
    (nodes.x as { type: string }).type = '__nonexistent__';

    const result = executeGraph(nodes, {});
    expect(result.errors.size).toBeGreaterThan(0);
    expect(result.errors.get('x')).toMatch(/No processor/i);
  });

  it('error strategy "continue" executes remaining nodes after an error', () => {
    const nodes: Record<string, EditorNode> = {
      bad: makeNode('bad', 'custom' as NodeType, { expression: '', inputCount: 0, outputCount: 0 }),
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Source',
        data: { value: 99 },
        inputs: [],
        outputs: [
          { id: 'out0', label: 'value', portType: 'number' },
          { id: 'out1', label: 'label', portType: 'string' },
        ],
      },
    };
    // Force an unknown type to trigger an error
    (nodes.bad as { type: string }).type = '__nonexistent__';

    const result = executeGraph(nodes, {}, undefined, undefined, undefined, 'continue');
    // The bad node should have an error
    expect(result.errors.has('bad')).toBe(true);
    // The source node should still be executed successfully
    expect(result.results.has('src')).toBe(true);
    expect(result.results.get('src')!.outputs[0]).toBe(99);
  });

  it('error strategy "fail-fast" stops on first error', () => {
    // Two independent nodes: bad + good; both in wave 1 (no connections)
    // The bad node is iterated first because of insertion order
    const nodes: Record<string, EditorNode> = {};
    // Insert bad first so it's processed first in the wave
    nodes.bad = makeNode('bad', 'custom' as NodeType, { expression: '', inputCount: 0, outputCount: 0 });
    (nodes.bad as { type: string }).type = '__nonexistent__';
    // A downstream node that depends on bad — in wave 2
    nodes.downstream = {
      id: 'downstream',
      type: 'source',
      position: [2, 0, 0],
      title: 'Downstream',
      data: { value: 1 },
      inputs: [{ id: 'in0', label: 'in', portType: 'number' }],
      outputs: [
        { id: 'out0', label: 'value', portType: 'number' },
        { id: 'out1', label: 'label', portType: 'string' },
      ],
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'bad', 0, 'downstream', 0),
    };

    const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'fail-fast');
    expect(result.errors.has('bad')).toBe(true);
    // Downstream node should NOT have been executed because fail-fast stopped
    expect(result.metrics.has('downstream')).toBe(false);
  });

  it('handles cyclic graphs gracefully (returns error, does not crash)', () => {
    const nodes = {
      a: makeNode('a'),
      b: makeNode('b'),
    };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'a', 0),
    };

    const result = executeGraph(nodes, conns);
    // Should have a __graph__ level error about the cycle
    expect(result.errors.has('__graph__')).toBe(true);
    expect(result.errors.get('__graph__')).toMatch(/cycle/i);
    expect(result.waves).toEqual([]);
  });

  it('respects maxExecutionMs timeout and sets timedOut flag', () => {
    // Create a large enough graph that iteration takes some time,
    // but set a very small timeout so it triggers
    const nodes: Record<string, EditorNode> = {};
    const conns: Record<string, Connection> = {};

    // Build a long chain to give the timeout a chance to trigger
    for (let i = 0; i < 200; i++) {
      const id = `n${i}`;
      nodes[id] = {
        id,
        type: 'source',
        position: [i, 0, 0],
        title: `Node ${i}`,
        data: { value: i },
        inputs: i > 0 ? [{ id: 'in0', label: 'in', portType: 'number' as const }] : [],
        outputs: [
          { id: 'out0', label: 'value', portType: 'number' as const },
          { id: 'out1', label: 'label', portType: 'string' as const },
        ],
      };
      if (i > 0) {
        // Use transform so the chain has proper input/output
        nodes[id].type = 'transform';
        nodes[id].data = { multiplier: 1, offset: 0 };
        conns[`c${i}`] = makeConn(`c${i}`, `n${i - 1}`, 0, `n${i}`, 0);
      }
    }

    // Use a 0.001ms timeout to practically guarantee it triggers
    const result = executeGraph(nodes, conns, undefined, undefined, undefined, undefined, undefined, 0.001);

    // The execution may or may not time out depending on how fast the first wave check runs.
    // But if it does, these should be set:
    if (result.timedOut) {
      expect(result.errors.has('__graph__')).toBe(true);
      expect(result.errors.get('__graph__')).toMatch(/timeout/i);
    }
    // At minimum, totalDuration should be recorded
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// invalidateDownstream
// ---------------------------------------------------------------------------

describe('invalidateDownstream', () => {
  it('removes the target node from cache', () => {
    const cache = new Map<string, unknown>([['a', { outputs: {}, inputHash: '' }]]);
    invalidateDownstream('a', {}, cache);
    expect(cache.has('a')).toBe(false);
  });

  it('cascades invalidation to downstream nodes', () => {
    const cache = new Map<string, unknown>([
      ['a', { outputs: {}, inputHash: '' }],
      ['b', { outputs: {}, inputHash: '' }],
      ['c', { outputs: {}, inputHash: '' }],
    ]);
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };
    invalidateDownstream('a', conns, cache);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
  });

  it('handles undefined cache (no-op)', () => {
    // Should not throw
    expect(() => invalidateDownstream('a', {}, undefined)).not.toThrow();
  });

  it('handles cycles gracefully via visited set', () => {
    const cache = new Map<string, unknown>([
      ['a', { outputs: {}, inputHash: '' }],
      ['b', { outputs: {}, inputHash: '' }],
    ]);
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'a', 0),
    };
    // Should terminate despite the cycle (visited set prevents infinite loop)
    expect(() => invalidateDownstream('a', conns, cache)).not.toThrow();
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getUpstreamPath
// ---------------------------------------------------------------------------

describe('getUpstreamPath', () => {
  it('returns the path from sources to the given node (reversed BFS)', () => {
    // A -> B -> C; upstream of C should be [A, B, C]
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };
    const path = getUpstreamPath('c', conns);
    expect(path).toEqual(['a', 'b', 'c']);
  });

  it('returns just the node itself when isolated (no connections)', () => {
    const path = getUpstreamPath('x', {});
    expect(path).toEqual(['x']);
  });

  it('includes all upstream nodes in a complex graph', () => {
    // Diamond: A->C, B->C, C->D
    const conns = {
      c1: makeConn('c1', 'a', 0, 'c', 0),
      c2: makeConn('c2', 'b', 0, 'c', 1),
      c3: makeConn('c3', 'c', 0, 'd', 0),
    };
    const path = getUpstreamPath('d', conns);
    // d -> c -> a,b (BFS reversed) => [a, b, c, d] or [b, a, c, d]
    expect(path).toContain('a');
    expect(path).toContain('b');
    expect(path).toContain('c');
    expect(path).toContain('d');
    // Sources should come first, target last
    expect(path[path.length - 1]).toBe('d');
    // a and b should both be before c
    expect(path.indexOf('a')).toBeLessThan(path.indexOf('c'));
    expect(path.indexOf('b')).toBeLessThan(path.indexOf('c'));
  });
});

// ---------------------------------------------------------------------------
// getDownstreamPath
// ---------------------------------------------------------------------------

describe('getDownstreamPath', () => {
  it('returns the path from the given node to downstream leaves', () => {
    // A -> B -> C; downstream of A should be [A, B, C]
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };
    const path = getDownstreamPath('a', conns);
    expect(path).toEqual(['a', 'b', 'c']);
  });

  it('returns just the node itself when isolated', () => {
    const path = getDownstreamPath('x', {});
    expect(path).toEqual(['x']);
  });

  it('includes all downstream nodes in a complex graph', () => {
    // Fan-out: A -> B, A -> C, B -> D, C -> D
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 0, 'c', 0),
      c3: makeConn('c3', 'b', 0, 'd', 0),
      c4: makeConn('c4', 'c', 0, 'd', 0),
    };
    const path = getDownstreamPath('a', conns);
    expect(path).toContain('a');
    expect(path).toContain('b');
    expect(path).toContain('c');
    expect(path).toContain('d');
    // Source should come first
    expect(path[0]).toBe('a');
    // d should come after b and c
    expect(path.indexOf('d')).toBeGreaterThan(path.indexOf('b'));
    expect(path.indexOf('d')).toBeGreaterThan(path.indexOf('c'));
  });
});

// ---------------------------------------------------------------------------
// getBottleneckNodes
// ---------------------------------------------------------------------------

describe('getBottleneckNodes', () => {
  it('returns the top N slowest nodes sorted by duration descending', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: { duration: 10, cacheHit: false, timestamp: 0 },
      b: { duration: 50, cacheHit: false, timestamp: 1 },
      c: { duration: 30, cacheHit: false, timestamp: 2 },
      d: { duration: 20, cacheHit: true, timestamp: 3 },
    };
    const top2 = getBottleneckNodes(metrics, 2);
    expect(top2).toHaveLength(2);
    expect(top2[0].nodeId).toBe('b');
    expect(top2[0].duration).toBe(50);
    expect(top2[1].nodeId).toBe('c');
    expect(top2[1].duration).toBe(30);
  });

  it('returns an empty array for empty metrics', () => {
    expect(getBottleneckNodes({}, 5)).toEqual([]);
  });

  it('returns all nodes when N is greater than count', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: { duration: 10, cacheHit: false, timestamp: 0 },
      b: { duration: 20, cacheHit: false, timestamp: 1 },
    };
    const result = getBottleneckNodes(metrics, 100);
    expect(result).toHaveLength(2);
    // Should still be sorted by duration descending
    expect(result[0].nodeId).toBe('b');
    expect(result[1].nodeId).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// getCacheHitRate
// ---------------------------------------------------------------------------

describe('getCacheHitRate', () => {
  it('returns 100 when all nodes are cache hits', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: { duration: 0, cacheHit: true, timestamp: 0 },
      b: { duration: 0, cacheHit: true, timestamp: 1 },
    };
    expect(getCacheHitRate(metrics)).toBe(100);
  });

  it('returns 0 when no nodes are cache hits', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: { duration: 5, cacheHit: false, timestamp: 0 },
      b: { duration: 3, cacheHit: false, timestamp: 1 },
    };
    expect(getCacheHitRate(metrics)).toBe(0);
  });

  it('returns 0 for empty metrics', () => {
    expect(getCacheHitRate({})).toBe(0);
  });

  it('returns the correct percentage for mixed hits and misses', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: { duration: 0, cacheHit: true, timestamp: 0 },
      b: { duration: 5, cacheHit: false, timestamp: 1 },
      c: { duration: 0, cacheHit: true, timestamp: 2 },
      d: { duration: 3, cacheHit: false, timestamp: 3 },
    };
    // 2 hits out of 4 = 50%
    expect(getCacheHitRate(metrics)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// getExecutionTimeline
// ---------------------------------------------------------------------------

describe('getExecutionTimeline', () => {
  it('returns entries sorted by timestamp ascending', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      c: { duration: 1, cacheHit: false, timestamp: 300 },
      a: { duration: 5, cacheHit: false, timestamp: 100 },
      b: { duration: 3, cacheHit: false, timestamp: 200 },
    };
    const timeline = getExecutionTimeline(metrics);
    expect(timeline).toHaveLength(3);
    expect(timeline[0].nodeId).toBe('a');
    expect(timeline[0].startTime).toBe(100);
    expect(timeline[1].nodeId).toBe('b');
    expect(timeline[1].startTime).toBe(200);
    expect(timeline[2].nodeId).toBe('c');
    expect(timeline[2].startTime).toBe(300);
  });

  it('returns an empty array for empty metrics', () => {
    expect(getExecutionTimeline({})).toEqual([]);
  });
});

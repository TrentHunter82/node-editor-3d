import { describe, it, expect } from 'vitest';
import { executeGraph, invalidateDownstream } from './execution';
import type { SubgraphContext, NodeResult } from './execution';
import type { EditorNode, Connection, SubgraphNodeDef, GraphData } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {},
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
  tgtPort: number,
): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

/**
 * Build a subgraph node with explicit ports (subgraph type has empty port config
 * in NODE_TYPE_CONFIG, so we specify ports manually).
 */
function makeSubgraphNode(
  id: string,
  defId: string,
  innerGraphId: string,
  inputCount = 1,
  outputCount = 1,
): EditorNode {
  return {
    id,
    type: 'subgraph',
    position: [0, 0, 0],
    title: 'TestSubgraph',
    data: { subgraphDefId: defId, innerGraphId },
    inputs: Array.from({ length: inputCount }, (_, i) => ({
      id: `in-${i}`,
      label: `In ${i}`,
      portType: 'any' as const,
    })),
    outputs: Array.from({ length: outputCount }, (_, i) => ({
      id: `out-${i}`,
      label: `Out ${i}`,
      portType: 'any' as const,
    })),
  };
}

/**
 * Create a custom node that will throw when executed.
 */
function makeErrorNode(
  id: string,
  expression = 'undefined.toString()',
  inputCount = 1,
  outputCount = 1,
): EditorNode {
  return {
    id,
    type: 'custom',
    position: [0, 0, 0],
    title: 'Error Node',
    data: { expression, inputCount, outputCount },
    inputs: Array.from({ length: inputCount }, (_, i) => ({
      id: `in-${i}`,
      label: `in ${i}`,
      portType: 'any' as const,
    })),
    outputs: Array.from({ length: outputCount }, (_, i) => ({
      id: `out-${i}`,
      label: `out ${i}`,
      portType: 'any' as const,
    })),
  };
}

/**
 * Create a simple inner graph: subgraph-input -> subgraph-output
 * Optionally insert a transform node in between.
 */
function makeSimpleInnerGraph(opts?: {
  withTransform?: boolean;
  transformData?: Record<string, unknown>;
  inputData?: Record<string, unknown>;
}): GraphData {
  const inputNode = makeNode('inner-input', 'subgraph-input', opts?.inputData ?? {});
  const outputNode = makeNode('inner-output', 'subgraph-output', {});

  if (opts?.withTransform) {
    const transformNode = makeNode('inner-transform', 'transform', opts.transformData ?? { multiplier: 2, offset: 0 });
    return {
      nodes: {
        'inner-input': inputNode,
        'inner-transform': transformNode,
        'inner-output': outputNode,
      },
      connections: {
        'ic1': makeConn('ic1', 'inner-input', 0, 'inner-transform', 0),
        'ic2': makeConn('ic2', 'inner-transform', 0, 'inner-output', 0),
      },
      groups: {},
      customNodeDefs: {},
    };
  }

  return {
    nodes: {
      'inner-input': inputNode,
      'inner-output': outputNode,
    },
    connections: {
      'ic1': makeConn('ic1', 'inner-input', 0, 'inner-output', 0),
    },
    groups: {},
    customNodeDefs: {},
  };
}

function makeSimpleSubgraphDef(id: string, innerGraphId: string): SubgraphNodeDef {
  return {
    id,
    name: 'TestSubgraph',
    innerGraphId,
    exposedInputs: [{ portIndex: 0, innerNodeId: 'inner-input' }],
    exposedOutputs: [{ portIndex: 0, innerNodeId: 'inner-output' }],
  };
}

// ===========================================================================
// Subgraph Processor Mutation Safety
// ===========================================================================

describe('Subgraph Processor Mutation Safety', () => {

  // -------------------------------------------------------------------------
  // 1. Inner graph data not mutated
  // -------------------------------------------------------------------------
  it('inner graph nodes and connections are NOT mutated by subgraph execution', () => {
    const innerGraph = makeSimpleInnerGraph({ withTransform: true, transformData: { multiplier: 3, offset: 1 } });

    // Deep copy the original inner graph BEFORE execution to compare afterward
    const originalNodes = structuredClone(innerGraph.nodes);
    const originalConnections = structuredClone(innerGraph.connections);

    const sgNode = makeSubgraphNode('sg', 'sg-def', 'inner1');
    const sourceNode = makeNode('src', 'source', { value: 10 });

    const nodes: Record<string, EditorNode> = {
      src: sourceNode,
      sg: sgNode,
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const subgraphDef = makeSimpleSubgraphDef('sg-def', 'inner1');
    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': subgraphDef },
      getInnerGraph: (graphId: string) => graphId === 'inner1' ? innerGraph : undefined,
    };

    const result = executeGraph(nodes, connections, undefined, context);

    // Execution should succeed
    expect(result.errors.size).toBe(0);

    // The original inner graph nodes must be IDENTICAL to the preserved copy
    // (no _injectedValue or other mutations should appear)
    expect(innerGraph.nodes).toEqual(originalNodes);
    expect(innerGraph.connections).toEqual(originalConnections);

    // Specifically verify node count and structure are unchanged
    expect(Object.keys(innerGraph.nodes).length).toBe(Object.keys(originalNodes).length);
    for (const nodeId of Object.keys(originalNodes)) {
      expect(innerGraph.nodes[nodeId]).toEqual(originalNodes[nodeId]);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Injected values don't persist
  // -------------------------------------------------------------------------
  it('_injectedValue does NOT appear in the original inner graph node data after execution', () => {
    const innerGraph = makeSimpleInnerGraph();

    const sgNode = makeSubgraphNode('sg', 'sg-def', 'inner1');
    const sourceNode = makeNode('src', 'source', { value: 42 });

    const nodes: Record<string, EditorNode> = {
      src: sourceNode,
      sg: sgNode,
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const subgraphDef = makeSimpleSubgraphDef('sg-def', 'inner1');
    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': subgraphDef },
      getInnerGraph: (graphId: string) => graphId === 'inner1' ? innerGraph : undefined,
    };

    executeGraph(nodes, connections, undefined, context);

    // The inner graph's subgraph-input node must NOT have _injectedValue in its data
    const inputNode = innerGraph.nodes['inner-input'];
    expect(inputNode).toBeDefined();
    expect('_injectedValue' in inputNode.data).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Nested subgraph execution (2-level deep)
  // -------------------------------------------------------------------------
  it('nested subgraph (2-level deep) executes correctly and propagates outputs', () => {
    // Level 2 (innermost): subgraph-input -> transform(×2) -> subgraph-output
    const level2InnerGraph = makeSimpleInnerGraph({ withTransform: true, transformData: { multiplier: 2, offset: 0 } });

    // Level 2 subgraph def
    const level2Def: SubgraphNodeDef = {
      id: 'level2-def',
      name: 'Level2Subgraph',
      innerGraphId: 'level2-graph',
      exposedInputs: [{ portIndex: 0, innerNodeId: 'inner-input' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'inner-output' }],
    };

    // Level 1 inner graph: subgraph-input -> subgraph(level2) -> subgraph-output
    const level1SubgraphNode = makeSubgraphNode('level1-sg', 'level2-def', 'level2-graph');
    const level1InnerGraph: GraphData = {
      nodes: {
        'inner-input': makeNode('inner-input', 'subgraph-input', {}),
        'level1-sg': level1SubgraphNode,
        'inner-output': makeNode('inner-output', 'subgraph-output', {}),
      },
      connections: {
        'l1c1': makeConn('l1c1', 'inner-input', 0, 'level1-sg', 0),
        'l1c2': makeConn('l1c2', 'level1-sg', 0, 'inner-output', 0),
      },
      groups: {},
      customNodeDefs: {},
    };

    // Level 1 subgraph def
    const level1Def: SubgraphNodeDef = {
      id: 'level1-def',
      name: 'Level1Subgraph',
      innerGraphId: 'level1-graph',
      exposedInputs: [{ portIndex: 0, innerNodeId: 'inner-input' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'inner-output' }],
    };

    // Outer graph: source(5) -> subgraph(level1) -> output
    const outerNodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 5 }),
      sg: makeSubgraphNode('sg', 'level1-def', 'level1-graph'),
      out: makeNode('out', 'output'),
    };
    const outerConnections: Record<string, Connection> = {
      oc1: makeConn('oc1', 'src', 0, 'sg', 0),
      oc2: makeConn('oc2', 'sg', 0, 'out', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: {
        'level1-def': level1Def,
        'level2-def': level2Def,
      },
      getInnerGraph: (graphId: string) => {
        if (graphId === 'level1-graph') return level1InnerGraph;
        if (graphId === 'level2-graph') return level2InnerGraph;
        return undefined;
      },
    };

    const result = executeGraph(outerNodes, outerConnections, undefined, context);

    expect(result.errors.size).toBe(0);

    // source(5) -> level1(level2(×2)) -> output
    // Level 2 transform: 5 × 2 + 0 = 10
    // The subgraph output should be 10
    const sgResult = result.results.get('sg');
    expect(sgResult).toBeDefined();
    expect(sgResult!.outputs[0]).toBe(10);
  });

  // -------------------------------------------------------------------------
  // 4. Depth limit enforcement
  // -------------------------------------------------------------------------
  it('enforces MAX_SUBGRAPH_DEPTH (10) when depth is already at the limit', () => {
    // When executeGraph is called with depth=10 and encounters a subgraph node,
    // executeSubgraphNode checks `depth >= 10` and throws immediately.
    // This error is caught by executeGraph and recorded in the errors map.

    const innerGraph = makeSimpleInnerGraph();
    const subgraphDef = makeSimpleSubgraphDef('sg-def', 'inner1');

    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 1 }),
      sg: makeSubgraphNode('sg', 'sg-def', 'inner1'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': subgraphDef },
      getInnerGraph: (gid) => gid === 'inner1' ? innerGraph : undefined,
    };

    // Pass depth=10 (at the limit): subgraph node should trigger the depth guard
    const result = executeGraph(nodes, conns, undefined, context, 10);

    expect(result.errors.size).toBeGreaterThan(0);
    const sgError = result.errors.get('sg');
    expect(sgError).toBeDefined();
    expect(sgError).toContain('recursion depth exceeded');
  });

  it('depth 9 still executes but depth 10 inside it triggers the limit', () => {
    // At depth 9, executeSubgraphNode passes (9 < 10).
    // It calls executeGraph(depth=10) for the inner graph.
    // If the inner graph itself contains a subgraph node, that will trigger depth=10 check.
    // But a simple inner graph (no nested subgraph) at depth 10 executes fine.

    const innerGraph = makeSimpleInnerGraph();
    const subgraphDef = makeSimpleSubgraphDef('sg-def', 'inner1');

    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 7 }),
      sg: makeSubgraphNode('sg', 'sg-def', 'inner1'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': subgraphDef },
      getInnerGraph: (gid) => gid === 'inner1' ? innerGraph : undefined,
    };

    // Depth 9: just under the limit — should succeed
    const result = executeGraph(nodes, conns, undefined, context, 9);
    expect(result.errors.size).toBe(0);
    expect(result.results.get('sg')!.outputs[0]).toBe(7);
  });

  it('deeply nested subgraph chain (11 levels) produces null output due to depth limit', () => {
    // Create a chain of subgraph defs: level 0 -> 1 -> ... -> 10 -> 11.
    // The depth limit fires at level 10, causing inner executeGraph to record an error.
    // Intermediate levels swallow the error and return null outputs.
    // The outer graph's subgraph node gets null (not an error at the outer level).

    const subgraphDefs: Record<string, SubgraphNodeDef> = {};
    const innerGraphs: Record<string, GraphData> = {};

    for (let i = 0; i <= 11; i++) {
      const defId = `def-${i}`;
      const graphId = `graph-${i}`;

      subgraphDefs[defId] = {
        id: defId,
        name: `Level${i}`,
        innerGraphId: graphId,
        exposedInputs: [{ portIndex: 0, innerNodeId: 'inner-input' }],
        exposedOutputs: [{ portIndex: 0, innerNodeId: 'inner-output' }],
      };

      if (i < 11) {
        const nextDefId = `def-${i + 1}`;
        const nextGraphId = `graph-${i + 1}`;
        const sgNode = makeSubgraphNode('nested-sg', nextDefId, nextGraphId);

        innerGraphs[graphId] = {
          nodes: {
            'inner-input': makeNode('inner-input', 'subgraph-input', {}),
            'nested-sg': sgNode,
            'inner-output': makeNode('inner-output', 'subgraph-output', {}),
          },
          connections: {
            'ic1': makeConn('ic1', 'inner-input', 0, 'nested-sg', 0),
            'ic2': makeConn('ic2', 'nested-sg', 0, 'inner-output', 0),
          },
          groups: {},
          customNodeDefs: {},
        };
      } else {
        innerGraphs[graphId] = makeSimpleInnerGraph();
      }
    }

    const outerNodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 42 }),
      sg: makeSubgraphNode('sg', 'def-0', 'graph-0'),
    };
    const outerConns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs,
      getInnerGraph: (graphId: string) => innerGraphs[graphId],
    };

    const result = executeGraph(outerNodes, outerConns, undefined, context);

    // The depth limit fires deep inside the chain. Intermediate levels catch the error
    // and return null outputs. The outer subgraph node succeeds but with null output.
    expect(result.results.get('sg')).toBeDefined();
    expect(result.results.get('sg')!.outputs[0]).toBe(null);
  });

  // -------------------------------------------------------------------------
  // 5. Missing subgraph def error
  // -------------------------------------------------------------------------
  it('records error when subgraphDef is missing', () => {
    const sgNode = makeSubgraphNode('sg', 'nonexistent-def', 'inner1');
    const sourceNode = makeNode('src', 'source', { value: 5 });

    const nodes: Record<string, EditorNode> = {
      src: sourceNode,
      sg: sgNode,
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: {}, // empty — no def for 'nonexistent-def'
      getInnerGraph: () => undefined,
    };

    const result = executeGraph(nodes, connections, undefined, context);

    expect(result.errors.size).toBe(1);
    expect(result.errors.has('sg')).toBe(true);
    expect(result.errors.get('sg')).toContain('Subgraph definition not found');
  });

  // -------------------------------------------------------------------------
  // 6. Missing inner graph error
  // -------------------------------------------------------------------------
  it('records error when inner graph data is missing', () => {
    const sgNode = makeSubgraphNode('sg', 'sg-def', 'missing-graph');
    const sourceNode = makeNode('src', 'source', { value: 5 });

    const nodes: Record<string, EditorNode> = {
      src: sourceNode,
      sg: sgNode,
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const subgraphDef: SubgraphNodeDef = {
      id: 'sg-def',
      name: 'TestSubgraph',
      innerGraphId: 'missing-graph',
      exposedInputs: [{ portIndex: 0, innerNodeId: 'inner-input' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'inner-output' }],
    };

    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': subgraphDef },
      getInnerGraph: () => undefined, // always returns undefined
    };

    const result = executeGraph(nodes, connections, undefined, context);

    expect(result.errors.size).toBe(1);
    expect(result.errors.has('sg')).toBe(true);
    expect(result.errors.get('sg')).toContain('Inner graph not found');
  });
});

// ===========================================================================
// Concurrent Execution Safety
// ===========================================================================

describe('Concurrent Execution Safety', () => {

  // -------------------------------------------------------------------------
  // 7. isExecuting prevents re-entry (utility-level behavior)
  // -------------------------------------------------------------------------
  // Note: isExecuting is a store-level guard in executionSlice.ts, not in the
  // utility function itself. executeGraph (utility) is a pure function.
  // This test verifies the contract: if the store checks isExecuting before
  // calling executeGraph, a second call to the utility is effectively blocked.
  // We test the utility behavior: two sequential calls both return valid results
  // (the utility itself does not have re-entry guards — that's the store's job).
  it('executeGraph (utility) is re-entrant safe: sequential calls produce independent results', () => {
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 10 }),
      t1: makeNode('t1', 'transform', { multiplier: 2, offset: 0 }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 's1', 0, 't1', 0),
    };

    const result1 = executeGraph(nodes, connections);
    const result2 = executeGraph(nodes, connections);

    // Both calls produce correct, independent results
    expect(result1.results.get('t1')!.outputs[0]).toBe(20);
    expect(result2.results.get('t1')!.outputs[0]).toBe(20);
    expect(result1.errors.size).toBe(0);
    expect(result2.errors.size).toBe(0);

    // Results are separate Map instances
    expect(result1.results).not.toBe(result2.results);
  });

  // -------------------------------------------------------------------------
  // 8. Execution cache isolation per graph
  // -------------------------------------------------------------------------
  it('execution cache is isolated per invocation (different cache maps)', () => {
    const nodesA: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 100 }),
    };
    const nodesB: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 200 }),
    };

    const cacheA = new Map<string, NodeResult>();
    const cacheB = new Map<string, NodeResult>();

    const resultA = executeGraph(nodesA, {}, cacheA);
    const resultB = executeGraph(nodesB, {}, cacheB);

    // Each result has its own data
    expect(resultA.results.get('s')!.outputs[0]).toBe(100);
    expect(resultB.results.get('s')!.outputs[0]).toBe(200);

    // Caches don't interfere (cache is passed by reference; results are stored into the returned map)
    // The returned results map contains the cached data
    expect(resultA.results).not.toBe(resultB.results);
  });

  // -------------------------------------------------------------------------
  // 9. Transient state cleared on undo (utility-level verification)
  // -------------------------------------------------------------------------
  // Note: Transient state clearing on undo is a store-level concern.
  // At the utility level, we verify that executeGraph does not carry state
  // between invocations when no cache is provided.
  it('executeGraph produces fresh results when cache is not provided', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 5 }),
      t: makeNode('t', 'transform', { multiplier: 3, offset: 0 }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 's', 0, 't', 0),
    };

    // First execution
    const result1 = executeGraph(nodes, conns);
    expect(result1.results.get('t')!.outputs[0]).toBe(15);

    // Modify node data to simulate an undo scenario (data changed, cache cleared)
    const modifiedNodes = structuredClone(nodes);
    modifiedNodes.s.data.value = 10;

    // Second execution without cache: should use new data
    const result2 = executeGraph(modifiedNodes, conns);
    expect(result2.results.get('t')!.outputs[0]).toBe(30);
  });

  // -------------------------------------------------------------------------
  // 10. Execution cache invalidation via invalidateDownstream
  // -------------------------------------------------------------------------
  it('invalidateDownstream removes target node and all downstream entries from cache', () => {
    // Graph: A -> B -> C
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };

    const cache = new Map<string, NodeResult>([
      ['a', { outputs: { 0: 1 }, inputHash: '{}' }],
      ['b', { outputs: { 0: 2 }, inputHash: '{"0":1}' }],
      ['c', { outputs: { 0: 3 }, inputHash: '{"0":2}' }],
    ]);

    // Invalidate node B — should remove B and its downstream (C)
    invalidateDownstream('b', connections, cache);

    expect(cache.has('a')).toBe(true);  // upstream is preserved
    expect(cache.has('b')).toBe(false); // invalidated
    expect(cache.has('c')).toBe(false); // downstream of B, also invalidated
  });

  it('invalidateDownstream on source invalidates entire chain', () => {
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };

    const cache = new Map<string, NodeResult>([
      ['a', { outputs: { 0: 10 }, inputHash: '{}' }],
      ['b', { outputs: { 0: 20 }, inputHash: '{"0":10}' }],
      ['c', { outputs: { 0: 30 }, inputHash: '{"0":20}' }],
    ]);

    invalidateDownstream('a', connections, cache);

    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
  });

  it('re-execution after invalidation recomputes stale nodes', () => {
    // A(source=5) -> B(transform ×2) -> C(transform ×3)
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 5 }),
      b: makeNode('b', 'transform', { multiplier: 2, offset: 0 }),
      c: makeNode('c', 'transform', { multiplier: 3, offset: 0 }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };

    // First execution populates cache
    const result1 = executeGraph(nodes, conns);
    const cache = result1.results;

    expect(cache.get('c')!.outputs[0]).toBe(30); // 5 * 2 * 3

    // Simulate updateNodeData: change source value and invalidate downstream
    nodes.a = makeNode('a', 'source', { value: 10 });
    invalidateDownstream('a', conns, cache);

    // Re-execute with the (now partially invalidated) cache
    const result2 = executeGraph(nodes, conns, cache);

    // Should recompute: 10 * 2 * 3 = 60
    expect(result2.results.get('c')!.outputs[0]).toBe(60);
  });

  // -------------------------------------------------------------------------
  // 11. Non-deterministic nodes bypass cache
  // -------------------------------------------------------------------------
  it('random nodes without seed are always re-executed (bypass cache)', () => {
    const nodes: Record<string, EditorNode> = {
      r: makeNode('r', 'random', { min: 0, max: 1 }), // no seed = non-deterministic
    };

    // First execution
    const result1 = executeGraph(nodes, {});
    const value1 = result1.results.get('r')!.outputs[0] as number;
    expect(typeof value1).toBe('number');

    // Use result1's results as cache for second execution
    const cache = result1.results;
    const result2 = executeGraph(nodes, {}, cache);

    // Even though cache has a valid entry, random without seed should re-execute.
    // The metrics should show cacheHit: false
    expect(result2.metrics.get('r')!.cacheHit).toBe(false);
  });

  it('random nodes WITH seed use cache when inputs match', () => {
    const nodes: Record<string, EditorNode> = {
      r: makeNode('r', 'random', { min: 0, max: 1, seed: 42 }), // seeded = deterministic
    };

    // First execution
    const result1 = executeGraph(nodes, {});
    const value1 = result1.results.get('r')!.outputs[0] as number;

    // Use result1's results as cache
    const cache = result1.results;
    const result2 = executeGraph(nodes, {}, cache);

    // Seeded random node should hit cache (same input hash, deterministic)
    expect(result2.metrics.get('r')!.cacheHit).toBe(true);
    expect(result2.results.get('r')!.outputs[0]).toBe(value1);
  });
});

// ===========================================================================
// Error Strategy Tests
// ===========================================================================

describe('Error Strategy with Subgraphs', () => {

  // -------------------------------------------------------------------------
  // 12. fail-fast stops on first error (custom node with error)
  // -------------------------------------------------------------------------
  it('fail-fast stops entire graph on first custom node error', () => {
    // A(source=5) -> B(error custom) -> C(transform)
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 5 }),
      b: makeErrorNode('b'),
      c: makeNode('c', 'transform', { multiplier: 2 }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };

    const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'fail-fast');

    // A (wave 1) should have executed
    expect(result.results.get('a')).toBeDefined();
    expect(result.results.get('a')!.outputs[0]).toBe(5);

    // B has an error
    expect(result.errors.size).toBe(1);
    expect(result.errors.has('b')).toBe(true);
    expect(result.errors.get('b')).toContain('Custom expression error');

    // C should NOT have been reached (fail-fast returns early)
    expect(result.results.has('c')).toBe(false);
  });

  it('fail-fast stops on subgraph error', () => {
    // source -> subgraph(missing def) -> transform
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 5 }),
      sg: makeSubgraphNode('sg', 'missing-def', 'missing-graph'),
      t: makeNode('t', 'transform', { multiplier: 2 }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
      c2: makeConn('c2', 'sg', 0, 't', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: {},
      getInnerGraph: () => undefined,
    };

    const result = executeGraph(nodes, conns, undefined, context, undefined, 'fail-fast');

    // Source executed
    expect(result.results.get('src')!.outputs[0]).toBe(5);

    // Subgraph error
    expect(result.errors.has('sg')).toBe(true);
    expect(result.errors.get('sg')).toContain('Subgraph definition not found');

    // Transform not reached
    expect(result.results.has('t')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 13. continue strategy skips errored nodes, downstream gets null/default
  // -------------------------------------------------------------------------
  it('continue strategy skips error nodes and downstream receives null/default inputs', () => {
    // A(source=100) -> B(error custom) -> C(custom: in0)
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 100 }),
      b: makeErrorNode('b'),
      c: {
        id: 'c',
        type: 'custom',
        position: [0, 0, 0],
        title: 'PassThrough',
        data: { expression: 'in0', inputCount: 1, outputCount: 1 },
        inputs: [{ id: 'in-0', label: 'in 0', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out 0', portType: 'any' }],
      },
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };

    const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'continue');

    // A executed successfully
    expect(result.results.get('a')!.outputs[0]).toBe(100);

    // B errored
    expect(result.errors.has('b')).toBe(true);
    expect(result.results.get('b')!.outputs).toEqual({});

    // C still executed — B's empty outputs mean C gets undefined input,
    // custom processor defaults undefined to 0 for in0
    expect(result.results.has('c')).toBe(true);
    expect(result.results.get('c')!.outputs[0]).toBe(0);

    // Total nodes with results = 3 (all processed)
    expect(result.results.size).toBe(3);
  });

  it('continue strategy with subgraph error: downstream nodes still execute', () => {
    // source -> subgraph(missing def) -> transform
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 5 }),
      sg: makeSubgraphNode('sg', 'missing-def', 'missing-graph'),
      t: makeNode('t', 'transform', { multiplier: 2 }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
      c2: makeConn('c2', 'sg', 0, 't', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: {},
      getInnerGraph: () => undefined,
    };

    const result = executeGraph(nodes, conns, undefined, context, undefined, 'continue');

    // Source executed
    expect(result.results.get('src')!.outputs[0]).toBe(5);

    // Subgraph errored
    expect(result.errors.has('sg')).toBe(true);

    // Transform still executed (with default inputs since subgraph output is empty)
    expect(result.results.has('t')).toBe(true);
    // Transform receives undefined from sg's empty outputs, treats as 0: 0*2+0=0
    expect(result.results.get('t')!.outputs[0]).toBe(0);
  });
});

// ===========================================================================
// Additional Edge Cases
// ===========================================================================

describe('Subgraph Execution Edge Cases', () => {

  it('subgraph pass-through: input passes directly to output', () => {
    const innerGraph = makeSimpleInnerGraph();

    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 42 }),
      sg: makeSubgraphNode('sg', 'sg-def', 'inner1'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': makeSimpleSubgraphDef('sg-def', 'inner1') },
      getInnerGraph: (gid) => gid === 'inner1' ? innerGraph : undefined,
    };

    const result = executeGraph(nodes, conns, undefined, context);

    expect(result.errors.size).toBe(0);
    // Pass-through: source(42) -> subgraph-input -> subgraph-output -> subgraph output
    expect(result.results.get('sg')!.outputs[0]).toBe(42);
  });

  it('subgraph with transform: input is processed by inner graph', () => {
    const innerGraph = makeSimpleInnerGraph({
      withTransform: true,
      transformData: { multiplier: 5, offset: 3 },
    });

    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 4 }),
      sg: makeSubgraphNode('sg', 'sg-def', 'inner1'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': makeSimpleSubgraphDef('sg-def', 'inner1') },
      getInnerGraph: (gid) => gid === 'inner1' ? innerGraph : undefined,
    };

    const result = executeGraph(nodes, conns, undefined, context);

    expect(result.errors.size).toBe(0);
    // 4 * 5 + 3 = 23
    expect(result.results.get('sg')!.outputs[0]).toBe(23);
  });

  it('multiple subgraph executions of the same def do not share state', () => {
    const innerGraph = makeSimpleInnerGraph({
      withTransform: true,
      transformData: { multiplier: 10, offset: 0 },
    });

    // Two source nodes feeding into two separate subgraph nodes with the same def
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 3 }),
      s2: makeNode('s2', 'source', { value: 7 }),
      sg1: makeSubgraphNode('sg1', 'sg-def', 'inner1'),
      sg2: makeSubgraphNode('sg2', 'sg-def', 'inner1'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 's1', 0, 'sg1', 0),
      c2: makeConn('c2', 's2', 0, 'sg2', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': makeSimpleSubgraphDef('sg-def', 'inner1') },
      getInnerGraph: (gid) => gid === 'inner1' ? innerGraph : undefined,
    };

    const result = executeGraph(nodes, conns, undefined, context);

    expect(result.errors.size).toBe(0);

    // sg1: 3 * 10 = 30
    expect(result.results.get('sg1')!.outputs[0]).toBe(30);
    // sg2: 7 * 10 = 70
    expect(result.results.get('sg2')!.outputs[0]).toBe(70);

    // Inner graph must remain unmodified (no cross-contamination from sg1 to sg2)
    expect('_injectedValue' in innerGraph.nodes['inner-input'].data).toBe(false);
  });

  it('subgraph without context falls back to pass-through processor', () => {
    // When no subgraphContext is provided, the default subgraph processor returns inputs[0]
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 99 }),
      sg: makeSubgraphNode('sg', 'sg-def', 'inner1'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    // No context provided — subgraph processor should just pass through
    const result = executeGraph(nodes, conns);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('sg')!.outputs[0]).toBe(99);
  });

  it('execution metrics are collected for subgraph nodes', () => {
    const innerGraph = makeSimpleInnerGraph();

    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 1 }),
      sg: makeSubgraphNode('sg', 'sg-def', 'inner1'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const context: SubgraphContext = {
      subgraphDefs: { 'sg-def': makeSimpleSubgraphDef('sg-def', 'inner1') },
      getInnerGraph: (gid) => gid === 'inner1' ? innerGraph : undefined,
    };

    const result = executeGraph(nodes, conns, undefined, context);

    // Both source and subgraph should have metrics
    expect(result.metrics.has('src')).toBe(true);
    expect(result.metrics.has('sg')).toBe(true);
    expect(result.metrics.get('sg')!.cacheHit).toBe(false);
    expect(result.metrics.get('sg')!.duration).toBeGreaterThanOrEqual(0);
  });
});

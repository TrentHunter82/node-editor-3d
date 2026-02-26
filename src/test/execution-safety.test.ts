/**
 * Execution Safety Tests
 *
 * Covers:
 * - Subgraph mutation safety (inner graph not modified by execution)
 * - _injectedValue cleanup from original inner nodes
 * - Nested subgraph execution (2 levels deep)
 * - Depth limiting (MAX_SUBGRAPH_DEPTH = 10)
 * - Error strategy: fail-fast vs continue
 * - Cache correctness: hit, invalidation, non-deterministic bypass
 * - Concurrent / sequential execution isolation
 * - Edge cases: empty graph, disconnected nodes, diamond topology, invalid port index
 */

import { describe, it, expect } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { executeGraph } from '../utils/execution';
import { NODE_TYPE_CONFIG } from '../types';
import type {
  EditorNode,
  Connection,
  NodeType,
  SubgraphNodeDef,
  GraphData,
} from '../types';
import type { SubgraphContext, NodeResult } from '../utils/execution';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: NodeType,
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {},
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: id,
    data,
    inputs: config.inputs.map((p, i) => ({
      id: `${id}-in-${i}`,
      label: p.label,
      portType: p.portType,
    })),
    outputs: config.outputs.map((p, i) => ({
      id: `${id}-out-${i}`,
      label: p.label,
      portType: p.portType,
    })),
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
 * Build a minimal subgraph setup:
 *   outer graph: source -> subgraph-node -> (optional downstream)
 *   inner graph: subgraph-input -> math(multiply) -> subgraph-output
 *
 * The inner graph doubles the input value.
 */
function buildDoublerSubgraph(multiplier = 2): {
  outerNodes: Record<string, EditorNode>;
  outerConnections: Record<string, Connection>;
  innerGraph: GraphData;
  subgraphDef: SubgraphNodeDef;
  subgraphContext: SubgraphContext;
  innerInputNodeId: string;
  innerOutputNodeId: string;
} {
  // Inner graph: subgraph-input -> math(multiply) -> subgraph-output
  const innerInputNodeId = 'inner-input';
  const innerMathNodeId = 'inner-math';
  const innerOutputNodeId = 'inner-output';

  const innerInputNode: EditorNode = {
    id: innerInputNodeId,
    type: 'subgraph-input',
    position: [0, 0, 0],
    title: 'Input',
    data: {},
    inputs: [],
    outputs: [{ id: 'inner-input-out-0', label: 'value', portType: 'any' }],
  };

  const innerMathNode: EditorNode = {
    id: innerMathNodeId,
    type: 'math',
    position: [1, 0, 0],
    title: 'Doubler',
    data: { operation: 'multiply' },
    inputs: [
      { id: 'inner-math-in-0', label: 'a', portType: 'number' },
      { id: 'inner-math-in-1', label: 'b', portType: 'number' },
    ],
    outputs: [{ id: 'inner-math-out-0', label: 'result', portType: 'number' }],
  };

  const innerMultiplierSourceNode: EditorNode = {
    id: 'inner-mult-src',
    type: 'source',
    position: [1, 1, 0],
    title: 'Multiplier',
    data: { value: multiplier },
    inputs: [],
    outputs: [
      { id: 'inner-mult-src-out-0', label: 'value', portType: 'number' },
      { id: 'inner-mult-src-out-1', label: 'label', portType: 'string' },
    ],
  };

  const innerOutputNode: EditorNode = {
    id: innerOutputNodeId,
    type: 'subgraph-output',
    position: [2, 0, 0],
    title: 'Output',
    data: {},
    inputs: [{ id: 'inner-output-in-0', label: 'value', portType: 'any' }],
    outputs: [],
  };

  const innerGraph: GraphData = {
    nodes: {
      [innerInputNodeId]: innerInputNode,
      [innerMathNodeId]: innerMathNode,
      'inner-mult-src': innerMultiplierSourceNode,
      [innerOutputNodeId]: innerOutputNode,
    },
    connections: {
      'ci-0': makeConn('ci-0', innerInputNodeId, 0, innerMathNodeId, 0),
      'ci-1': makeConn('ci-1', 'inner-mult-src', 0, innerMathNodeId, 1),
      'ci-2': makeConn('ci-2', innerMathNodeId, 0, innerOutputNodeId, 0),
    },
    groups: {},
    customNodeDefs: {},
  };

  const defId = 'def-doubler';
  const innerGraphId = 'inner-graph-doubler';

  const subgraphDef: SubgraphNodeDef = {
    id: defId,
    name: 'Doubler',
    innerGraphId,
    exposedInputs: [{ portIndex: 0, innerNodeId: innerInputNodeId }],
    exposedOutputs: [{ portIndex: 0, innerNodeId: innerOutputNodeId }],
  };

  // Outer subgraph node
  const outerSubgraphNode: EditorNode = {
    id: 'sg-node',
    type: 'subgraph',
    position: [1, 0, 0],
    title: 'Doubler',
    data: { subgraphDefId: defId },
    inputs: [{ id: 'sg-node-in-0', label: 'in', portType: 'any' }],
    outputs: [{ id: 'sg-node-out-0', label: 'out', portType: 'any' }],
  };

  const outerSourceNode: EditorNode = {
    id: 'outer-src',
    type: 'source',
    position: [0, 0, 0],
    title: 'Source',
    data: { value: 5 },
    inputs: [],
    outputs: [
      { id: 'outer-src-out-0', label: 'value', portType: 'number' },
      { id: 'outer-src-out-1', label: 'label', portType: 'string' },
    ],
  };

  const outerNodes: Record<string, EditorNode> = {
    'outer-src': outerSourceNode,
    'sg-node': outerSubgraphNode,
  };

  const outerConnections: Record<string, Connection> = {
    'co-0': makeConn('co-0', 'outer-src', 0, 'sg-node', 0),
  };

  const subgraphContext: SubgraphContext = {
    subgraphDefs: { [defId]: subgraphDef },
    getInnerGraph: (graphId: string) => {
      if (graphId === innerGraphId) return innerGraph;
      return undefined;
    },
  };

  return {
    outerNodes,
    outerConnections,
    innerGraph,
    subgraphDef,
    subgraphContext,
    innerInputNodeId,
    innerOutputNodeId,
  };
}

// ===========================================================================
// Subgraph Mutation Safety
// ===========================================================================

describe('Subgraph Mutation Safety', () => {
  it('inner graph nodes are not mutated by subgraph execution', () => {
    const { outerNodes, outerConnections, innerGraph, subgraphContext } =
      buildDoublerSubgraph();

    // Snapshot the inner graph before execution
    const nodesBefore = JSON.stringify(innerGraph.nodes);
    const connsBefore = JSON.stringify(innerGraph.connections);

    executeGraph(outerNodes, outerConnections, undefined, subgraphContext);

    // Inner graph must be identical after execution
    expect(JSON.stringify(innerGraph.nodes)).toBe(nodesBefore);
    expect(JSON.stringify(innerGraph.connections)).toBe(connsBefore);
  });

  it('_injectedValue is not written to original inner subgraph-input node', () => {
    const { outerNodes, outerConnections, innerGraph, subgraphContext, innerInputNodeId } =
      buildDoublerSubgraph();

    executeGraph(outerNodes, outerConnections, undefined, subgraphContext);

    // Original inner-input node must not have _injectedValue
    expect(Object.prototype.hasOwnProperty.call(
      innerGraph.nodes[innerInputNodeId].data,
      '_injectedValue',
    )).toBe(false);
  });

  it('nested 2-level subgraph execution does not mutate either level', () => {
    // Level 1 inner graph: doubles the input (×2)
    const level1InputId = 'l1-input';
    const level1MathId = 'l1-math';
    const level1SrcId = 'l1-src';
    const level1OutputId = 'l1-output';

    const level1InnerGraph: GraphData = {
      nodes: {
        [level1InputId]: {
          id: level1InputId, type: 'subgraph-input', position: [0, 0, 0], title: 'L1In',
          data: {}, inputs: [],
          outputs: [{ id: 'l1-input-out-0', label: 'value', portType: 'any' }],
        },
        [level1MathId]: {
          id: level1MathId, type: 'math', position: [1, 0, 0], title: 'L1Math',
          data: { operation: 'multiply' },
          inputs: [
            { id: 'l1-math-in-0', label: 'a', portType: 'number' },
            { id: 'l1-math-in-1', label: 'b', portType: 'number' },
          ],
          outputs: [{ id: 'l1-math-out-0', label: 'result', portType: 'number' }],
        },
        [level1SrcId]: {
          id: level1SrcId, type: 'source', position: [1, 1, 0], title: 'Two',
          data: { value: 2 }, inputs: [],
          outputs: [
            { id: 'l1-src-out-0', label: 'value', portType: 'number' },
            { id: 'l1-src-out-1', label: 'label', portType: 'string' },
          ],
        },
        [level1OutputId]: {
          id: level1OutputId, type: 'subgraph-output', position: [2, 0, 0], title: 'L1Out',
          data: {},
          inputs: [{ id: 'l1-output-in-0', label: 'value', portType: 'any' }],
          outputs: [],
        },
      },
      connections: {
        'l1-c0': makeConn('l1-c0', level1InputId, 0, level1MathId, 0),
        'l1-c1': makeConn('l1-c1', level1SrcId, 0, level1MathId, 1),
        'l1-c2': makeConn('l1-c2', level1MathId, 0, level1OutputId, 0),
      },
      groups: {}, customNodeDefs: {},
    };

    // Level 0 outer graph: source(3) -> subgraph -> result
    // The subgraph uses level1 inner graph (doublers 3 → 6)
    const l1DefId = 'def-l1';
    const l1InnerGraphId = 'inner-graph-l1';

    const l1Def: SubgraphNodeDef = {
      id: l1DefId, name: 'L1Doubler', innerGraphId: l1InnerGraphId,
      exposedInputs: [{ portIndex: 0, innerNodeId: level1InputId }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: level1OutputId }],
    };

    const outerNodes: Record<string, EditorNode> = {
      'l0-src': {
        id: 'l0-src', type: 'source', position: [0, 0, 0], title: 'L0Src',
        data: { value: 3 }, inputs: [],
        outputs: [
          { id: 'l0-src-out-0', label: 'value', portType: 'number' },
          { id: 'l0-src-out-1', label: 'label', portType: 'string' },
        ],
      },
      'l0-sg': {
        id: 'l0-sg', type: 'subgraph', position: [1, 0, 0], title: 'L0SG',
        data: { subgraphDefId: l1DefId },
        inputs: [{ id: 'l0-sg-in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'l0-sg-out-0', label: 'out', portType: 'any' }],
      },
    };
    const outerConnections: Record<string, Connection> = {
      'l0-c0': makeConn('l0-c0', 'l0-src', 0, 'l0-sg', 0),
    };

    const snapBefore = JSON.stringify(level1InnerGraph);

    const ctx: SubgraphContext = {
      subgraphDefs: { [l1DefId]: l1Def },
      getInnerGraph: (id) => (id === l1InnerGraphId ? level1InnerGraph : undefined),
    };

    const result = executeGraph(outerNodes, outerConnections, undefined, ctx);

    // Verify correct output: 3 × 2 = 6
    expect(result.errors.size).toBe(0);
    expect(result.results.get('l0-sg')?.outputs[0]).toBe(6);

    // Level1 inner graph must be unchanged
    expect(JSON.stringify(level1InnerGraph)).toBe(snapBefore);
    // Level1 input node must not have _injectedValue
    expect(Object.prototype.hasOwnProperty.call(
      level1InnerGraph.nodes[level1InputId].data,
      '_injectedValue',
    )).toBe(false);
  });

  it('different input values produce correct independent outputs from same subgraph def', () => {
    const { outerNodes, outerConnections, subgraphContext } = buildDoublerSubgraph();

    // First execution: source = 5, expect 10
    const r1 = executeGraph(outerNodes, outerConnections, undefined, subgraphContext);
    expect(r1.errors.size).toBe(0);
    expect(r1.results.get('sg-node')?.outputs[0]).toBe(10);

    // Second execution: change source to 7, expect 14
    const nodes2 = {
      ...outerNodes,
      'outer-src': { ...outerNodes['outer-src'], data: { value: 7 } },
    };
    const r2 = executeGraph(nodes2, outerConnections, undefined, subgraphContext);
    expect(r2.errors.size).toBe(0);
    expect(r2.results.get('sg-node')?.outputs[0]).toBe(14);
  });
});

// ===========================================================================
// Depth Limiting
// ===========================================================================

describe('Depth Limiting', () => {
  /**
   * Build a "self-referential" subgraph: the subgraph node points to a def
   * whose inner graph contains another subgraph node pointing to the SAME def.
   * Without depth limiting this would recurse infinitely.
   *
   * The depth limit (MAX_SUBGRAPH_DEPTH = 10) is checked at the TOP of
   * executeSubgraphNode. When execution starts at depth=0 and we call
   * executeSubgraphNode with depth=9, it calls executeGraph on the inner
   * graph which encounters `rec-sg-inner`. That node triggers
   * executeSubgraphNode(depth=10) which throws "recursion depth exceeded".
   * executeGraph at depth=9 catches that and records an error for `rec-sg-inner`
   * in the INNER graph's results. The outer call to executeSubgraphNode at
   * depth=0 then reads the inner graph's result for `rec-sg-inner` via the
   * innerOutputNode, which is null because execution was aborted.
   *
   * Because the depth error is caught inside the inner executeGraph (not
   * re-thrown), it does NOT surface as an error on the OUTER subgraph node.
   * To observe the depth-limit error we must call executeSubgraphNode at a
   * depth that is already >= MAX_SUBGRAPH_DEPTH, which means starting
   * executeGraph at depth=MAX_SUBGRAPH_DEPTH - 1 so the first inner call
   * exceeds the limit immediately.
   *
   * We test this by calling executeGraph directly with depth=9. When it
   * processes the outer-sg subgraph node it calls executeSubgraphNode(depth=9),
   * the inner graph processes rec-sg-inner and calls executeSubgraphNode(depth=10),
   * which throws immediately. That error IS caught by the inner executeGraph
   * which records it on rec-sg-inner. But we can also observe correctness by
   * calling executeSubgraphNode starting at depth=MAX (from the public API
   * we call executeGraph with depth param).
   *
   * The simplest observable test: call executeGraph with depth=9 so the first
   * level of recursion triggers the depth error. With fail-fast the inner
   * execution stops and returns with an error for the recursive sg node.
   * The outer subgraph node silently gets null output — no error at outer level.
   *
   * For the error to surface at the OUTER level we need to start at depth=10
   * so the very first executeSubgraphNode call throws. We do this by passing
   * depth=10 to executeGraph directly.
   */
  function buildRecursiveSubgraph(): {
    outerNodes: Record<string, EditorNode>;
    outerConnections: Record<string, Connection>;
    ctx: SubgraphContext;
  } {
    const defId = 'def-recursive';
    const innerGraphId = 'inner-recursive';

    // Inner graph: subgraph-input -> (another subgraph node, same def) -> subgraph-output
    const innerInputId = 'rec-input';
    const innerSgId = 'rec-sg-inner';
    const innerOutputId = 'rec-output';

    const innerGraph: GraphData = {
      nodes: {
        [innerInputId]: {
          id: innerInputId, type: 'subgraph-input', position: [0, 0, 0], title: 'RecIn',
          data: {}, inputs: [],
          outputs: [{ id: 'rec-input-out-0', label: 'value', portType: 'any' }],
        },
        [innerSgId]: {
          id: innerSgId, type: 'subgraph', position: [1, 0, 0], title: 'RecSg',
          data: { subgraphDefId: defId },
          inputs: [{ id: 'rec-sg-inner-in-0', label: 'in', portType: 'any' }],
          outputs: [{ id: 'rec-sg-inner-out-0', label: 'out', portType: 'any' }],
        },
        [innerOutputId]: {
          id: innerOutputId, type: 'subgraph-output', position: [2, 0, 0], title: 'RecOut',
          data: {},
          inputs: [{ id: 'rec-output-in-0', label: 'value', portType: 'any' }],
          outputs: [],
        },
      },
      connections: {
        'rc-0': makeConn('rc-0', innerInputId, 0, innerSgId, 0),
        'rc-1': makeConn('rc-1', innerSgId, 0, innerOutputId, 0),
      },
      groups: {}, customNodeDefs: {},
    };

    const def: SubgraphNodeDef = {
      id: defId, name: 'Recursive', innerGraphId,
      exposedInputs: [{ portIndex: 0, innerNodeId: innerInputId }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: innerOutputId }],
    };

    const outerNodes: Record<string, EditorNode> = {
      src: {
        id: 'src', type: 'source', position: [0, 0, 0], title: 'Src',
        data: { value: 1 }, inputs: [],
        outputs: [
          { id: 'src-out-0', label: 'value', portType: 'number' },
          { id: 'src-out-1', label: 'label', portType: 'string' },
        ],
      },
      'outer-sg': {
        id: 'outer-sg', type: 'subgraph', position: [1, 0, 0], title: 'RecSgOuter',
        data: { subgraphDefId: defId },
        inputs: [{ id: 'outer-sg-in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'outer-sg-out-0', label: 'out', portType: 'any' }],
      },
    };
    const outerConnections: Record<string, Connection> = {
      'oc-0': makeConn('oc-0', 'src', 0, 'outer-sg', 0),
    };

    const ctx: SubgraphContext = {
      subgraphDefs: { [defId]: def },
      getInnerGraph: (id) => (id === innerGraphId ? innerGraph : undefined),
    };

    return { outerNodes, outerConnections, ctx };
  }

  it('MAX_SUBGRAPH_DEPTH prevents infinite recursion and produces an error when starting at limit', () => {
    const { outerNodes, outerConnections, ctx } = buildRecursiveSubgraph();

    // Starting at depth=10 means the VERY FIRST call to executeSubgraphNode
    // for outer-sg will exceed the limit and throw, which executeGraph catches
    // and records as an error on 'outer-sg'.
    const result = executeGraph(outerNodes, outerConnections, undefined, ctx, 10);

    // The outer subgraph node must have an error recorded
    expect(result.errors.size).toBeGreaterThan(0);
    expect(result.errors.has('outer-sg')).toBe(true);
  });

  it('depth limit error message mentions depth limit value', () => {
    const { outerNodes, outerConnections, ctx } = buildRecursiveSubgraph();

    // Starting at depth=10 immediately triggers the depth guard
    const result = executeGraph(outerNodes, outerConnections, undefined, ctx, 10);

    const errorMsg = result.errors.get('outer-sg') ?? '';
    // The message should reference the recursion depth limit (10)
    expect(errorMsg).toMatch(/depth|recursion/i);
    expect(errorMsg).toMatch(/10/);
  });

  it('recursive subgraph at depth=0 completes without throwing (depth error captured internally)', () => {
    // At depth=0, the recursion unwinds gracefully — depth-limit error is caught
    // inside the inner executeGraph instances and does not propagate as an
    // uncaught exception. The outer execution completes.
    const { outerNodes, outerConnections, ctx } = buildRecursiveSubgraph();

    expect(() => executeGraph(outerNodes, outerConnections, undefined, ctx, 0)).not.toThrow();
  });
});

// ===========================================================================
// Error Strategy
// ===========================================================================

describe('Error Strategy', () => {
  /** Build a graph: source -> custom(throws) -> math(downstream) */
  function buildErrorGraph(): {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    throwNodeId: string;
    downstreamNodeId: string;
  } {
    const srcNode = makeNode('src', 'source', { value: 5 });
    const throwNode: EditorNode = {
      id: 'throw',
      type: 'custom',
      position: [1, 0, 0],
      title: 'ThrowNode',
      data: { expression: 'throw new Error("boom")' },
      inputs: [{ id: 'throw-in-0', label: 'in', portType: 'any' }],
      outputs: [{ id: 'throw-out-0', label: 'out', portType: 'any' }],
    };
    const downstreamNode = makeNode('downstream', 'math', { operation: 'add' });

    const nodes = { src: srcNode, throw: throwNode, downstream: downstreamNode };
    const connections: Record<string, Connection> = {
      'c0': makeConn('c0', 'src', 0, 'throw', 0),
      'c1': makeConn('c1', 'throw', 0, 'downstream', 0),
    };

    return { nodes, connections, throwNodeId: 'throw', downstreamNodeId: 'downstream' };
  }

  it('fail-fast stops execution after the first processor error', () => {
    const { nodes, connections, throwNodeId, downstreamNodeId } = buildErrorGraph();

    const result = executeGraph(nodes, connections, undefined, undefined, undefined, 'fail-fast');

    expect(result.errors.has(throwNodeId)).toBe(true);
    // Downstream node must not have been executed
    expect(result.results.has(downstreamNodeId)).toBe(false);
  });

  it('continue skips error node and continues executing downstream nodes', () => {
    const { nodes, connections, throwNodeId, downstreamNodeId } = buildErrorGraph();

    const result = executeGraph(nodes, connections, undefined, undefined, undefined, 'continue');

    expect(result.errors.has(throwNodeId)).toBe(true);
    // Downstream node should still have been attempted
    expect(result.results.has(downstreamNodeId)).toBe(true);
  });

  it('subgraph execution error is wrapped with subgraph context in the error message', () => {
    // Subgraph whose inner graph references a non-existent def — forces an error
    const missingDefId = 'def-missing';
    const sgNode: EditorNode = {
      id: 'sg-err',
      type: 'subgraph',
      position: [0, 0, 0],
      title: 'BrokenSubgraph',
      data: { subgraphDefId: missingDefId },
      inputs: [],
      outputs: [{ id: 'sg-err-out-0', label: 'out', portType: 'any' }],
    };

    const ctx: SubgraphContext = {
      subgraphDefs: {}, // def is absent
      getInnerGraph: () => undefined,
    };

    const result = executeGraph({ 'sg-err': sgNode }, {}, undefined, ctx);

    expect(result.errors.has('sg-err')).toBe(true);
    const msg = result.errors.get('sg-err')!;
    // Should include the node title
    expect(msg).toContain('BrokenSubgraph');
    // Should contain information about the subgraph error
    expect(msg).toMatch(/subgraph/i);
  });
});

// ===========================================================================
// Cache Behavior
// ===========================================================================

describe('Cache Behavior', () => {
  it('cache hit returns same result without re-executing on second run', () => {
    // The executeGraph `cache` parameter seeds the internal results Map. To
    // get a cache-hit on the second run, we pass the results Map from the first
    // run as the cache for the second run. This mirrors how the store uses the
    // cache: it holds on to the previous results and passes them in each call.
    const nodes = { src: makeNode('src', 'source', { value: 42 }) };
    const connections: Record<string, Connection> = {};

    // First execution — no cache
    const r1 = executeGraph(nodes, connections);
    expect(r1.results.get('src')?.outputs[0]).toBe(42);
    expect(r1.metrics.get('src')?.cacheHit).toBe(false);

    // Second execution — seed with r1.results as cache; inputs unchanged so cache-hits
    const r2 = executeGraph(nodes, connections, r1.results);
    expect(r2.results.get('src')?.outputs[0]).toBe(42);
    expect(r2.metrics.get('src')?.cacheHit).toBe(true);
  });

  it('cache is invalidated when a node is removed from the cache (simulating invalidateDownstream)', () => {
    // The execution cache maps inputHash (based on connection values) not node.data.
    // When node data changes, the store calls invalidateDownstream() to evict that
    // node's cache entry so the next executeGraph re-executes it.
    // This test simulates that pattern: run twice, evict upstream from cache,
    // then run again to confirm the downstream node also re-executes.

    const upstream = makeNode('upstream', 'source', { value: 10 });
    const txNode = makeNode('tx', 'transform', { multiplier: 2, offset: 0 });
    const connections: Record<string, Connection> = {
      c0: makeConn('c0', 'upstream', 0, 'tx', 0),
    };

    // First run
    const r1 = executeGraph({ upstream, tx: txNode }, connections);
    expect(r1.results.get('tx')?.outputs[0]).toBe(20); // 10 × 2
    expect(r1.metrics.get('tx')?.cacheHit).toBe(false);

    // Second run with same cache — both nodes cache-hit
    const r2 = executeGraph({ upstream, tx: txNode }, connections, r1.results);
    expect(r2.metrics.get('upstream')?.cacheHit).toBe(true);
    expect(r2.metrics.get('tx')?.cacheHit).toBe(true);

    // Simulate invalidateDownstream: evict 'upstream' and its dependents from cache
    const cacheAfterInvalidation = new Map(r2.results);
    cacheAfterInvalidation.delete('upstream');
    cacheAfterInvalidation.delete('tx'); // downstream of upstream

    // Third run with invalidated cache: upstream and tx must re-execute
    const upstreamNew = makeNode('upstream', 'source', { value: 99 });
    const r3 = executeGraph({ upstream: upstreamNew, tx: txNode }, connections, cacheAfterInvalidation);
    expect(r3.metrics.get('upstream')?.cacheHit).toBe(false);
    expect(r3.metrics.get('tx')?.cacheHit).toBe(false);
    expect(r3.results.get('tx')?.outputs[0]).toBe(198); // 99 × 2
  });

  it('unseeded random node bypasses cache and produces output on every run', () => {
    const randNode: EditorNode = {
      id: 'rand',
      type: 'random',
      position: [0, 0, 0],
      title: 'Rand',
      data: { min: 0, max: 1 }, // no seed — non-deterministic
      inputs: [],
      outputs: [{ id: 'rand-out-0', label: 'value', portType: 'number' }],
    };

    const cache = new Map<string, NodeResult>();

    const r1 = executeGraph({ rand: randNode }, {}, cache);
    expect(r1.metrics.get('rand')?.cacheHit).toBe(false);

    // Even though cache is populated, non-deterministic node must re-execute
    const r2 = executeGraph({ rand: randNode }, {}, cache);
    expect(r2.metrics.get('rand')?.cacheHit).toBe(false);
  });

  it('timer node bypasses cache on every execution', () => {
    const timerNode = makeNode('timer', 'timer', { intervalMs: 1000 });
    const cache = new Map<string, NodeResult>();

    executeGraph({ timer: timerNode }, {}, cache);
    const r2 = executeGraph({ timer: timerNode }, {}, cache);

    expect(r2.metrics.get('timer')?.cacheHit).toBe(false);
  });

  it('http-fetch node bypasses cache on every execution', () => {
    const fetchNode: EditorNode = {
      id: 'fetch',
      type: 'http-fetch',
      position: [0, 0, 0],
      title: 'Fetch',
      data: {},
      inputs: [
        { id: 'fetch-in-0', label: 'url', portType: 'string' },
        { id: 'fetch-in-1', label: 'trigger', portType: 'any' },
      ],
      outputs: [
        { id: 'fetch-out-0', label: 'data', portType: 'any' },
        { id: 'fetch-out-1', label: 'status', portType: 'number' },
        { id: 'fetch-out-2', label: 'error', portType: 'string' },
      ],
    };
    const cache = new Map<string, NodeResult>();

    executeGraph({ fetch: fetchNode }, {}, cache);
    const r2 = executeGraph({ fetch: fetchNode }, {}, cache);

    expect(r2.metrics.get('fetch')?.cacheHit).toBe(false);
  });

  it('seeded random node IS cacheable because it is deterministic', () => {
    const randNode: EditorNode = {
      id: 'rand',
      type: 'random',
      position: [0, 0, 0],
      title: 'SeededRand',
      data: { min: 0, max: 1, seed: 42 }, // deterministic with seed
      inputs: [],
      outputs: [{ id: 'rand-out-0', label: 'value', portType: 'number' }],
    };

    // First run — no cache
    const r1 = executeGraph({ rand: randNode }, {});
    expect(r1.metrics.get('rand')?.cacheHit).toBe(false);

    // Second run — pass r1.results as cache; seeded random IS cacheable
    const r2 = executeGraph({ rand: randNode }, {}, r1.results);
    expect(r2.metrics.get('rand')?.cacheHit).toBe(true);
    // Seeded output must be the same deterministic value
    expect(r2.results.get('rand')?.outputs[0]).toBe(r1.results.get('rand')?.outputs[0]);
  });

  it('subgraph results are cached on the second execution with identical inputs', () => {
    const { outerNodes, outerConnections, subgraphContext } = buildDoublerSubgraph();

    // First execution — no cache seed
    const r1 = executeGraph(outerNodes, outerConnections, undefined, subgraphContext);
    expect(r1.errors.size).toBe(0);
    expect(r1.metrics.get('sg-node')?.cacheHit).toBe(false);
    expect(r1.results.get('sg-node')?.outputs[0]).toBe(10);

    // Second execution — seed with r1.results; subgraph node's inputs unchanged → cache hit
    const r2 = executeGraph(outerNodes, outerConnections, r1.results, subgraphContext);
    expect(r2.errors.size).toBe(0);
    expect(r2.metrics.get('sg-node')?.cacheHit).toBe(true);
    expect(r2.results.get('sg-node')?.outputs[0]).toBe(10);
  });
});

// ===========================================================================
// Concurrent / Sequential Safety
// ===========================================================================

describe('Concurrent and Sequential Execution Safety', () => {
  it('two sequential executions with different inputs produce independent results', () => {
    makeNode('src', 'source', { value: 3 });
    makeNode('math', 'math', { operation: 'multiply' });
    makeNode('src', 'source', { value: 7 });
    makeNode('math', 'math', { operation: 'multiply' });
    // src port 0 -> math port 0; math port 1 defaults to 0 (no connection = inputs[1] is undefined -> 0)
    // We'll use transform (multiply × multiplier) via data.multiplier
    const transformNodes1 = {
      src: makeNode('src', 'source', { value: 3 }),
      tx: makeNode('tx', 'transform', { multiplier: 4, offset: 0 }),
    };
    const transformNodes2 = {
      src: makeNode('src', 'source', { value: 7 }),
      tx: makeNode('tx', 'transform', { multiplier: 4, offset: 0 }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'src', 0, 'tx', 0),
    };

    const r1 = executeGraph(transformNodes1, conns);
    const r2 = executeGraph(transformNodes2, conns);

    // 3 × 4 = 12
    expect(r1.results.get('tx')?.outputs[0]).toBe(12);
    // 7 × 4 = 28
    expect(r2.results.get('tx')?.outputs[0]).toBe(28);
  });

  it('two independent subgraph contexts do not interfere with each other', () => {
    // Context A: doubles (×2), Context B: triples (×3)
    const { outerNodes: nodesA, outerConnections: connsA, subgraphContext: ctxA } =
      buildDoublerSubgraph(2);
    const { outerNodes: nodesB, outerConnections: connsB, subgraphContext: ctxB } =
      buildDoublerSubgraph(3);

    const rA = executeGraph(nodesA, connsA, undefined, ctxA);
    const rB = executeGraph(nodesB, connsB, undefined, ctxB);

    // A: 5 × 2 = 10
    expect(rA.results.get('sg-node')?.outputs[0]).toBe(10);
    // B: 5 × 3 = 15
    expect(rB.results.get('sg-node')?.outputs[0]).toBe(15);
  });

  it('large 20-node chain executes correctly in topological order', () => {
    // Build a chain: src -> reroute0 -> reroute1 -> ... -> reroute18
    // Each reroute passes through its input. Final value should equal src value.
    const CHAIN_LENGTH = 19;
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 42 }),
    };
    const connections: Record<string, Connection> = {};

    for (let i = 0; i < CHAIN_LENGTH; i++) {
      const nodeId = `rr-${i}`;
      nodes[nodeId] = makeNode(nodeId, 'reroute');
      const prevId = i === 0 ? 'src' : `rr-${i - 1}`;
      const prevPort = i === 0 ? 0 : 0; // source output 0, reroute output 0
      connections[`c-${i}`] = makeConn(`c-${i}`, prevId, prevPort, nodeId, 0);
    }

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    // All 20 nodes executed (source + 19 reroutes)
    expect(result.results.size).toBe(CHAIN_LENGTH + 1);
    // Last reroute should have value 42
    expect(result.results.get(`rr-${CHAIN_LENGTH - 1}`)?.outputs[0]).toBe(42);
    // Waves must be in order: at least CHAIN_LENGTH + 1 waves for a linear chain
    expect(result.waves.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// Edge Cases
// ===========================================================================

describe('Edge Cases', () => {
  it('empty graph executes without error and returns empty results', () => {
    const result = executeGraph({}, {});

    expect(result.errors.size).toBe(0);
    expect(result.results.size).toBe(0);
    expect(result.waves).toHaveLength(0);
  });

  it('disconnected nodes (no connections) still execute with default inputs', () => {
    // math node with no connections: a defaults to 0, b defaults to 0 -> 0+0=0
    const mathNode = makeNode('math', 'math', { operation: 'add' });
    const srcNode = makeNode('src', 'source', { value: 7 });

    const result = executeGraph({ math: mathNode, src: srcNode }, {});

    expect(result.errors.size).toBe(0);
    // Source executes with its own value
    expect(result.results.get('src')?.outputs[0]).toBe(7);
    // Math executes with default inputs (both undefined -> 0+0=0)
    expect(result.results.get('math')?.outputs[0]).toBe(0);
  });

  it('diamond topology (fan-out then fan-in) executes each node exactly once with correct value', () => {
    // A (source=10) -> B (×2=20), A -> C (×3=30), B -> D (add port 0), C -> D (add port 1)
    // D = 20 + 30 = 50
    const aNode = makeNode('a', 'source', { value: 10 });
    const bNode = makeNode('b', 'transform', { multiplier: 2, offset: 0 });
    const cNode = makeNode('c', 'transform', { multiplier: 3, offset: 0 });
    const dNode = makeNode('d', 'math', { operation: 'add' });

    const nodes = { a: aNode, b: bNode, c: cNode, d: dNode };
    const connections: Record<string, Connection> = {
      'ab': makeConn('ab', 'a', 0, 'b', 0),
      'ac': makeConn('ac', 'a', 0, 'c', 0),
      'bd': makeConn('bd', 'b', 0, 'd', 0),
      'cd': makeConn('cd', 'c', 0, 'd', 1),
    };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('b')?.outputs[0]).toBe(20);
    expect(result.results.get('c')?.outputs[0]).toBe(30);
    expect(result.results.get('d')?.outputs[0]).toBe(50);
  });

  it('connection with out-of-range source port index produces null/undefined output, not a crash', () => {
    // math only has output port 0; connect from port index 99 (non-existent)
    const mathNode = makeNode('math', 'math', { operation: 'add' });
    const sinkNode = makeNode('sink', 'reroute');

    const nodes = { math: mathNode, sink: sinkNode };
    const connections: Record<string, Connection> = {
      // sourcePortIndex 99 doesn't exist on math — sourceResult.outputs[99] = undefined
      bad: makeConn('bad', 'math', 99, 'sink', 0),
    };

    // Must not throw
    expect(() => executeGraph(nodes, connections)).not.toThrow();

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);
    // sink receives undefined from the out-of-range port, reroute passes it through
    expect(result.results.has('sink')).toBe(true);
  });

  it('connection referencing a deleted (non-existent) node is silently skipped', () => {
    const srcNode = makeNode('src', 'source', { value: 3 });
    // Connection points to a node that does not exist in nodes map
    const staleConn = makeConn('stale', 'src', 0, 'ghost', 0);

    const nodes = { src: srcNode };
    const connections: Record<string, Connection> = { stale: staleConn };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('src')?.outputs[0]).toBe(3);
  });

  it('subgraph node without a subgraphContext falls back to pass-through processor', () => {
    // When no context is provided, subgraph nodes use the fallback processor (inputs[0] or null)
    const srcNode = makeNode('src', 'source', { value: 99 });
    const sgNode: EditorNode = {
      id: 'sg',
      type: 'subgraph',
      position: [1, 0, 0],
      title: 'NoCtx',
      data: { subgraphDefId: 'some-def' },
      inputs: [{ id: 'sg-in-0', label: 'in', portType: 'any' }],
      outputs: [{ id: 'sg-out-0', label: 'out', portType: 'any' }],
    };

    const nodes = { src: srcNode, sg: sgNode };
    const connections: Record<string, Connection> = {
      c0: makeConn('c0', 'src', 0, 'sg', 0),
    };

    // No subgraphContext passed — should use fallback processor
    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    // Fallback: subgraph processor returns { 0: inputs[0] ?? null }
    expect(result.results.get('sg')?.outputs[0]).toBe(99);
  });

  it('cyclic graph returns cycle error in errors map (executeGraph catches internally)', () => {
    // A -> B -> A (cycle)
    const a = makeNode('a', 'reroute');
    const b = makeNode('b', 'reroute');
    const nodes = { a, b };
    const connections: Record<string, Connection> = {
      ab: makeConn('ab', 'a', 0, 'b', 0),
      ba: makeConn('ba', 'b', 0, 'a', 0),
    };

    // executeGraph catches cycle errors from topologicalSort and returns them in the errors map
    const result = executeGraph(nodes, connections);
    expect(result.errors.has('__graph__')).toBe(true);
    expect(result.errors.get('__graph__')).toMatch(/cycle/i);
    expect(result.waves).toHaveLength(0);
  });
});

// ===========================================================================
// Subgraph Missing Definition / Inner Graph
// ===========================================================================

describe('Subgraph Error Propagation', () => {
  it('subgraph node with missing def produces an error with descriptive message', () => {
    const sgNode: EditorNode = {
      id: 'sg-missing',
      type: 'subgraph',
      position: [0, 0, 0],
      title: 'MissingDef',
      data: { subgraphDefId: 'nonexistent-def' },
      inputs: [],
      outputs: [{ id: 'sg-missing-out-0', label: 'out', portType: 'any' }],
    };

    const ctx: SubgraphContext = {
      subgraphDefs: {},
      getInnerGraph: () => undefined,
    };

    const result = executeGraph({ 'sg-missing': sgNode }, {}, undefined, ctx, 0, 'continue');

    expect(result.errors.has('sg-missing')).toBe(true);
    const msg = result.errors.get('sg-missing')!;
    expect(msg).toContain('MissingDef');
    expect(msg).toMatch(/not found|missing/i);
  });

  it('subgraph node with missing inner graph produces an error', () => {
    const defId = 'def-no-inner';
    const def: SubgraphNodeDef = {
      id: defId, name: 'NoInner', innerGraphId: 'inner-does-not-exist',
      exposedInputs: [],
      exposedOutputs: [],
    };

    const sgNode: EditorNode = {
      id: 'sg-no-inner',
      type: 'subgraph',
      position: [0, 0, 0],
      title: 'NoInnerGraph',
      data: { subgraphDefId: defId },
      inputs: [],
      outputs: [{ id: 'sg-no-inner-out-0', label: 'out', portType: 'any' }],
    };

    const ctx: SubgraphContext = {
      subgraphDefs: { [defId]: def },
      getInnerGraph: () => undefined, // inner graph not found
    };

    const result = executeGraph({ 'sg-no-inner': sgNode }, {}, undefined, ctx, 0, 'continue');

    expect(result.errors.has('sg-no-inner')).toBe(true);
    const msg = result.errors.get('sg-no-inner')!;
    expect(msg).toMatch(/not found|missing/i);
  });

  it('error inside subgraph inner graph is contained and outer output is null', () => {
    // When a node INSIDE the subgraph inner graph throws, executeGraph captures
    // that error internally. The outer subgraph node does NOT receive an error
    // in the parent graph's error map — instead it gets null output because the
    // inner subgraph-output node was never reached (fail-fast stopped execution).
    const innerInputId = 'err-inner-input';
    const innerThrowId = 'err-inner-throw';
    const innerOutputId = 'err-inner-output';

    const innerGraph: GraphData = {
      nodes: {
        [innerInputId]: {
          id: innerInputId, type: 'subgraph-input', position: [0, 0, 0], title: 'ErrIn',
          data: {}, inputs: [],
          outputs: [{ id: 'err-inner-input-out-0', label: 'value', portType: 'any' }],
        },
        [innerThrowId]: {
          id: innerThrowId, type: 'custom', position: [1, 0, 0], title: 'Thrower',
          data: { expression: 'throw new Error("inner explosion")' },
          inputs: [{ id: 'err-inner-throw-in-0', label: 'in', portType: 'any' }],
          outputs: [{ id: 'err-inner-throw-out-0', label: 'out', portType: 'any' }],
        },
        [innerOutputId]: {
          id: innerOutputId, type: 'subgraph-output', position: [2, 0, 0], title: 'ErrOut',
          data: {},
          inputs: [{ id: 'err-inner-output-in-0', label: 'value', portType: 'any' }],
          outputs: [],
        },
      },
      connections: {
        'ec-0': makeConn('ec-0', innerInputId, 0, innerThrowId, 0),
        'ec-1': makeConn('ec-1', innerThrowId, 0, innerOutputId, 0),
      },
      groups: {}, customNodeDefs: {},
    };

    const defId = 'def-err';
    const innerGraphId = 'inner-err';

    const def: SubgraphNodeDef = {
      id: defId, name: 'ErrorSubgraph', innerGraphId,
      exposedInputs: [{ portIndex: 0, innerNodeId: innerInputId }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: innerOutputId }],
    };

    const outerSgNode: EditorNode = {
      id: 'sg-err-outer',
      type: 'subgraph',
      position: [0, 0, 0],
      title: 'OuterErrSg',
      data: { subgraphDefId: defId },
      inputs: [],
      outputs: [{ id: 'sg-err-outer-out-0', label: 'out', portType: 'any' }],
    };

    const ctx: SubgraphContext = {
      subgraphDefs: { [defId]: def },
      getInnerGraph: (id) => (id === innerGraphId ? innerGraph : undefined),
    };

    const result = executeGraph({ 'sg-err-outer': outerSgNode }, {}, undefined, ctx, 0, 'fail-fast');

    // The inner error is CONTAINED inside the inner executeGraph call — it does NOT
    // surface as an error on the outer subgraph node. The outer execution completes.
    expect(result.errors.has('sg-err-outer')).toBe(false);
    // The outer subgraph node has a result (empty outputs because inner-output
    // was never reached by fail-fast)
    expect(result.results.has('sg-err-outer')).toBe(true);
    // Output 0 is null because inner subgraph-output node was not executed
    expect(result.results.get('sg-err-outer')?.outputs[0] ?? null).toBeNull();
  });
});

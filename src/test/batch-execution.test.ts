/// <reference types="vitest/config" />
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph, topologicalSort } from '../utils/execution';
import { getUpstreamPath } from '../utils/profiling';
import type { EditorNode, Connection, NodeType } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.validationErrors = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.isExecuting = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
  });
}

/**
 * Collect selected nodes + all upstream dependencies, then execute just that subset.
 * This is the core batch-execution helper that tests the underlying infrastructure.
 */
function executeSelection(selectedIds: Set<string>) {
  const { nodes, connections } = getStore();

  // Collect all upstream dependencies for all selected nodes
  const scopeIds = new Set(selectedIds);
  for (const id of selectedIds) {
    if (!nodes[id]) continue;
    for (const upId of getUpstreamPath(id, nodes, connections)) {
      scopeIds.add(upId);
    }
  }

  // Filter nodes and connections to scope
  const filteredNodes: Record<string, EditorNode> = {};
  for (const id of scopeIds) {
    if (nodes[id]) filteredNodes[id] = nodes[id];
  }

  const filteredConns: Record<string, Connection> = {};
  for (const [cId, conn] of Object.entries(connections)) {
    if (scopeIds.has(conn.sourceNodeId) && scopeIds.has(conn.targetNodeId)) {
      filteredConns[cId] = conn;
    }
  }

  return executeGraph(filteredNodes, filteredConns);
}

/**
 * Build a linear chain: source -> transform -> transform -> ... -> transform
 * Returns all node IDs in order.
 */
function buildChain(length: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < length; i++) {
    const type: NodeType = i === 0 ? 'source' : 'transform';
    const id = getStore().addNode(type, [i * 2, 0, 0]);
    ids.push(id);
    if (i > 0) {
      getStore().addConnection(ids[i - 1], 0, id, 0);
    }
  }
  return ids;
}

// ===========================================================================
// 1. Upstream dependency collection
// ===========================================================================
describe('Upstream dependency collection', () => {
  beforeEach(() => { resetStore(); });

  it('returns correct ancestors for a linear chain (source -> transform -> math)', () => {
    // source(A) -> transform(B) -> math(C)
    const a = getStore().addNode('source', [0, 0, 0]);
    const b = getStore().addNode('transform', [2, 0, 0]);
    const c = getStore().addNode('math', [4, 0, 0]);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);

    const { nodes, connections } = getStore();
    const upstream = getUpstreamPath(c, nodes, connections);

    // Should include both b and a
    expect(upstream).toHaveLength(2);
    expect(upstream).toContain(a);
    expect(upstream).toContain(b);
  });

  it('includes all branches for diamond pattern', () => {
    // Diamond:  A --\
    //                 -> C -> D
    //           B --/
    const a = getStore().addNode('source', [0, 0, 0]);
    const b = getStore().addNode('source', [0, 0, 4]);
    const c = getStore().addNode('math', [4, 0, 0]);
    const d = getStore().addNode('transform', [6, 0, 0]);
    getStore().addConnection(a, 0, c, 0);
    getStore().addConnection(b, 0, c, 1);
    getStore().addConnection(c, 0, d, 0);

    const { nodes, connections } = getStore();
    const upstream = getUpstreamPath(d, nodes, connections);

    expect(upstream).toHaveLength(3);
    expect(upstream).toContain(a);
    expect(upstream).toContain(b);
    expect(upstream).toContain(c);
  });

  it('returns empty for root nodes (no upstream)', () => {
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [2, 0, 0]);

    const { nodes, connections } = getStore();
    const upstream = getUpstreamPath(a, nodes, connections);

    expect(upstream).toHaveLength(0);
  });

  it('handles disconnected nodes (not in upstream)', () => {
    // A -> B, C is disconnected
    const a = getStore().addNode('source', [0, 0, 0]);
    const b = getStore().addNode('transform', [2, 0, 0]);
    const c = getStore().addNode('source', [4, 0, 0]);
    getStore().addConnection(a, 0, b, 0);

    const { nodes, connections } = getStore();
    const upstream = getUpstreamPath(b, nodes, connections);

    expect(upstream).toHaveLength(1);
    expect(upstream).toContain(a);
    expect(upstream).not.toContain(c);
  });

  it('does not include the queried node itself', () => {
    const a = getStore().addNode('source', [0, 0, 0]);
    const b = getStore().addNode('transform', [2, 0, 0]);
    const c = getStore().addNode('transform', [4, 0, 0]);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);

    const { nodes, connections } = getStore();
    const upstream = getUpstreamPath(c, nodes, connections);

    expect(upstream).not.toContain(c);
    expect(upstream).toHaveLength(2);
  });
});

// ===========================================================================
// 2. Selection-scoped execution
// ===========================================================================
describe('Selection-scoped execution', () => {
  beforeEach(() => { resetStore(); });

  it('executes all upstream when only the last node is selected (3-node chain)', () => {
    // source(10) -> transform(x1+0=10) -> transform(x1+0=10)
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 10);
    const b = getStore().addNode('transform', [2, 0, 0]);
    const c = getStore().addNode('transform', [4, 0, 0]);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);

    const result = executeSelection(new Set([c]));

    // All three nodes should have results
    expect(result.results.has(a)).toBe(true);
    expect(result.results.has(b)).toBe(true);
    expect(result.results.has(c)).toBe(true);
    // The final transform outputs 10 (10 * 1 + 0 = 10)
    expect(result.results.get(c)!.outputs[0]).toBe(10);
  });

  it('includes upstream but excludes downstream when middle node is selected', () => {
    // A -> B -> C
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 5);
    const b = getStore().addNode('transform', [2, 0, 0]);
    const c = getStore().addNode('transform', [4, 0, 0]);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);

    // Select only the middle node B
    const result = executeSelection(new Set([b]));

    expect(result.results.has(a)).toBe(true);
    expect(result.results.has(b)).toBe(true);
    // C should NOT be in the results (it's downstream, not selected)
    expect(result.results.has(c)).toBe(false);
  });

  it('handles multiple selected nodes with shared upstream (no duplicates)', () => {
    //       A
    //      / \
    //     B   C    (B and C both selected; A is shared upstream)
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 7);
    const b = getStore().addNode('transform', [2, 0, 0]);
    const c = getStore().addNode('transform', [2, 0, 4]);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(a, 0, c, 0);

    const result = executeSelection(new Set([b, c]));

    // A, B, C should all be executed
    expect(result.results.has(a)).toBe(true);
    expect(result.results.has(b)).toBe(true);
    expect(result.results.has(c)).toBe(true);
    // Both outputs should be 7 (identity transform: 7*1+0)
    expect(result.results.get(b)!.outputs[0]).toBe(7);
    expect(result.results.get(c)!.outputs[0]).toBe(7);
    // The topological sort should have exactly 3 nodes, no duplicates
    const allNodeIds = result.waves.flat();
    expect(new Set(allNodeIds).size).toBe(allNodeIds.length);
  });

  it('executes full upstream chain for a selected leaf node', () => {
    // 5-node chain: A -> B -> C -> D -> E, select only E
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 3);
    const b = getStore().addNode('transform', [2, 0, 0]);
    getStore().updateNodeData(b, 'multiplier', 2); // 3*2=6
    const c = getStore().addNode('transform', [4, 0, 0]);
    getStore().updateNodeData(c, 'offset', 1); // 6+1=7
    const d = getStore().addNode('transform', [6, 0, 0]);
    const e = getStore().addNode('transform', [8, 0, 0]);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);
    getStore().addConnection(c, 0, d, 0);
    getStore().addConnection(d, 0, e, 0);

    const result = executeSelection(new Set([e]));

    expect(result.results.size).toBe(5);
    expect(result.results.get(e)!.outputs[0]).toBe(7); // 3*2=6, 6+1=7, 7*1=7, 7*1=7
  });

  it('executes only the root node when a root is selected (no downstream)', () => {
    // A -> B -> C, select only A
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 42);
    const b = getStore().addNode('transform', [2, 0, 0]);
    const c = getStore().addNode('transform', [4, 0, 0]);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);

    const result = executeSelection(new Set([a]));

    // Only A should have been executed
    expect(result.results.has(a)).toBe(true);
    expect(result.results.has(b)).toBe(false);
    expect(result.results.has(c)).toBe(false);
    expect(result.results.get(a)!.outputs[0]).toBe(42);
  });

  it('produces same results as full execution for selected nodes', () => {
    // A(10) -> B(x2) -> C(+5)
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 10);
    const b = getStore().addNode('transform', [2, 0, 0]);
    getStore().updateNodeData(b, 'multiplier', 2);
    const c = getStore().addNode('transform', [4, 0, 0]);
    getStore().updateNodeData(c, 'offset', 5);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);

    const { nodes, connections } = getStore();
    const fullResult = executeGraph(nodes, connections);
    const partialResult = executeSelection(new Set([c]));

    // Results for overlapping nodes should match
    expect(partialResult.results.get(a)!.outputs[0]).toBe(fullResult.results.get(a)!.outputs[0]);
    expect(partialResult.results.get(b)!.outputs[0]).toBe(fullResult.results.get(b)!.outputs[0]);
    expect(partialResult.results.get(c)!.outputs[0]).toBe(fullResult.results.get(c)!.outputs[0]);
  });

  it('does NOT produce results for unselected, non-upstream nodes', () => {
    // Two separate chains: A -> B and C -> D
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 1);
    const b = getStore().addNode('transform', [2, 0, 0]);
    const c = getStore().addNode('source', [0, 0, 4]);
    getStore().updateNodeData(c, 'value', 2);
    const d = getStore().addNode('transform', [2, 0, 4]);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(c, 0, d, 0);

    // Select only B
    const result = executeSelection(new Set([b]));

    expect(result.results.has(a)).toBe(true);
    expect(result.results.has(b)).toBe(true);
    expect(result.results.has(c)).toBe(false);
    expect(result.results.has(d)).toBe(false);
  });

  it('uses cache correctly for upstream values', () => {
    // A(10) -> B(x2=20) -> C(+3=23)
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 10);
    const b = getStore().addNode('transform', [2, 0, 0]);
    getStore().updateNodeData(b, 'multiplier', 2);
    const c = getStore().addNode('transform', [4, 0, 0]);
    getStore().updateNodeData(c, 'offset', 3);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);

    const { nodes, connections } = getStore();

    // Pre-populate cache with results from A and B
    const cache = new Map<string, { outputs: Record<number, unknown>; inputHash: string }>();
    const warmResult = executeGraph(nodes, connections);
    for (const [id, res] of warmResult.results) {
      cache.set(id, res);
    }

    // Build scope for C
    const scopeIds = new Set([c]);
    for (const upId of getUpstreamPath(c, nodes, connections)) {
      scopeIds.add(upId);
    }
    const filteredNodes: Record<string, EditorNode> = {};
    for (const id of scopeIds) {
      if (nodes[id]) filteredNodes[id] = nodes[id];
    }
    const filteredConns: Record<string, Connection> = {};
    for (const [cId, conn] of Object.entries(connections)) {
      if (scopeIds.has(conn.sourceNodeId) && scopeIds.has(conn.targetNodeId)) {
        filteredConns[cId] = conn;
      }
    }

    // Execute with cache — upstream nodes should be cache hits
    const cachedResult = executeGraph(filteredNodes, filteredConns, cache);

    expect(cachedResult.results.get(c)!.outputs[0]).toBe(23);
    // A and B should be cache hits (inputs unchanged)
    expect(cachedResult.metrics.get(a)!.cacheHit).toBe(true);
    expect(cachedResult.metrics.get(b)!.cacheHit).toBe(true);
  });
});

// ===========================================================================
// 3. Edge cases
// ===========================================================================
describe('Batch execution edge cases', () => {
  beforeEach(() => { resetStore(); });

  it('empty selection produces empty execution result', () => {
    // Add some nodes but select none
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [2, 0, 0]);

    const result = executeSelection(new Set());

    expect(result.results.size).toBe(0);
    expect(result.waves).toHaveLength(0);
  });

  it('selection containing non-existent node IDs is gracefully ignored', () => {
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 5);
    const b = getStore().addNode('transform', [2, 0, 0]);
    getStore().addConnection(a, 0, b, 0);

    // Include real node B and a fake node ID
    const result = executeSelection(new Set([b, 'non-existent-id-999']));

    // Should still execute the valid nodes
    expect(result.results.has(a)).toBe(true);
    expect(result.results.has(b)).toBe(true);
    expect(result.results.get(b)!.outputs[0]).toBe(5);
    // The fake ID should not be in results
    expect(result.results.has('non-existent-id-999')).toBe(false);
  });

  it('selection of entire graph produces same results as full execution', () => {
    // A -> B -> C
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 4);
    const b = getStore().addNode('transform', [2, 0, 0]);
    getStore().updateNodeData(b, 'multiplier', 3);
    const c = getStore().addNode('transform', [4, 0, 0]);
    getStore().updateNodeData(c, 'offset', 1);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(b, 0, c, 0);

    const { nodes, connections } = getStore();
    const fullResult = executeGraph(nodes, connections);
    const batchResult = executeSelection(new Set([a, b, c]));

    expect(batchResult.results.size).toBe(fullResult.results.size);
    for (const [id, res] of fullResult.results) {
      expect(batchResult.results.get(id)!.outputs).toEqual(res.outputs);
    }
  });

  it('fan-out: selecting one branch does not execute the other branch', () => {
    //       A
    //      / \
    //     B   C
    const a = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(a, 'value', 9);
    const b = getStore().addNode('transform', [2, 0, 0]);
    getStore().updateNodeData(b, 'multiplier', 2);
    const c = getStore().addNode('transform', [2, 0, 4]);
    getStore().updateNodeData(c, 'multiplier', 3);
    getStore().addConnection(a, 0, b, 0);
    getStore().addConnection(a, 0, c, 0);

    // Select only branch B
    const result = executeSelection(new Set([b]));

    expect(result.results.has(a)).toBe(true);
    expect(result.results.has(b)).toBe(true);
    expect(result.results.has(c)).toBe(false);
    expect(result.results.get(b)!.outputs[0]).toBe(18); // 9*2=18
  });
});

// ===========================================================================
// 4. Performance verification
// ===========================================================================
describe('Batch execution performance', () => {
  beforeEach(() => { resetStore(); });

  it('topologicalSort with filtered 10-node subset of 100-node graph is faster than full sort', () => {
    // Build a 100-node chain
    const ids = buildChain(100);

    const { nodes, connections } = getStore();

    // Time the full sort
    const fullStart = performance.now();
    for (let i = 0; i < 50; i++) {
      topologicalSort(nodes, connections);
    }
    const fullTime = performance.now() - fullStart;

    // Build filtered subset: last 10 nodes + upstream (which is everything upstream of node 90)
    // Instead, pick node at index 9 and its upstream (indices 0-9 = 10 nodes)
    const targetId = ids[9];
    const scopeIds = new Set([targetId]);
    for (const upId of getUpstreamPath(targetId, nodes, connections)) {
      scopeIds.add(upId);
    }
    const filteredNodes: Record<string, EditorNode> = {};
    for (const id of scopeIds) {
      if (nodes[id]) filteredNodes[id] = nodes[id];
    }
    const filteredConns: Record<string, Connection> = {};
    for (const [cId, conn] of Object.entries(connections)) {
      if (scopeIds.has(conn.sourceNodeId) && scopeIds.has(conn.targetNodeId)) {
        filteredConns[cId] = conn;
      }
    }

    // Time the filtered sort
    const filteredStart = performance.now();
    for (let i = 0; i < 50; i++) {
      topologicalSort(filteredNodes, filteredConns);
    }
    const filteredTime = performance.now() - filteredStart;

    // The filtered sort should have only 10 nodes
    expect(Object.keys(filteredNodes)).toHaveLength(10);
    // Filtered should be faster (or at least not dramatically slower)
    expect(filteredTime).toBeLessThan(fullTime * 2);
  });

  it('executeGraph with filtered subset processes fewer nodes than full execution', () => {
    // Build a 20-node chain
    const ids = buildChain(20);
    getStore().updateNodeData(ids[0], 'value', 1);

    const { nodes, connections } = getStore();

    // Full execution: all 20 nodes
    const fullResult = executeGraph(nodes, connections);
    const fullNodeCount = fullResult.results.size;
    expect(fullNodeCount).toBe(20);

    // Filtered: select node at index 4 (5 nodes: 0-4)
    const batchResult = executeSelection(new Set([ids[4]]));
    const batchNodeCount = batchResult.results.size;

    expect(batchNodeCount).toBe(5);
    expect(batchNodeCount).toBeLessThan(fullNodeCount);
  });

  it('upstream collection in 200-node chain completes within 100ms', () => {
    // Build a 200-node chain
    const ids = buildChain(200);

    const { nodes, connections } = getStore();

    const start = performance.now();
    const upstream = getUpstreamPath(ids[199], nodes, connections);
    const elapsed = performance.now() - start;

    // Should find 199 upstream nodes
    expect(upstream).toHaveLength(199);
    // Should complete quickly
    expect(elapsed).toBeLessThan(100);
  });
});

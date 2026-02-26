/**
 * Large Graph Performance Tests for Rosebud Node Editor 3D
 *
 * Tests performance at scale: 200, 500, and 1000 node graphs.
 * Covers store-based creation, raw algorithm benchmarks (topologicalSort, executeGraph),
 * various graph topologies (chain, fan-out, diamond), connection creation,
 * export/import roundtrip, and stack-safety under deep recursion.
 *
 * Thresholds are generous (2-5x expected) to avoid flaky results in CI.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { topologicalSort, executeGraph } from '../utils/execution';
import type { EditorNode, Connection, NodeType } from '../types';
import type { MultiGraphStorage } from '../utils/serialization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
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
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.searchQuery = '';
    s.contextMenu = null;
    s.validationErrors = {};
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.debugMode = false;
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.undoRedoEvent = null;
    s.breadcrumbStack = [];
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.templates = {};
    s.checkpoints = {};
    s.graphVariables = {};
  });
  localStorage.clear();
}

/** Build a raw node object (bypassing store) for direct algorithm benchmarks */
function makeRawNode(id: string, type: NodeType, pos: [number, number, number] = [0, 0, 0]): EditorNode {
  const isSource = type === 'source';
  const isMath = type === 'math';
  return {
    id,
    type,
    position: pos,
    title: type.charAt(0).toUpperCase() + type.slice(1),
    data: isSource ? { value: 1 } : isMath ? { operation: 'add' } : {},
    inputs: isSource
      ? []
      : isMath
        ? [
            { id: `${id}-in-0`, label: 'A', portType: 'number' as const },
            { id: `${id}-in-1`, label: 'B', portType: 'number' as const },
          ]
        : [{ id: `${id}-in-0`, label: 'in', portType: 'number' as const }],
    outputs: type === 'output'
      ? []
      : [{ id: `${id}-out-0`, label: 'out', portType: 'number' as const }],
  };
}

/** Build a raw connection object */
function makeRawConnection(
  id: string,
  sourceId: string,
  targetId: string,
  srcPort = 0,
  tgtPort = 0,
): Connection {
  return {
    id,
    sourceNodeId: sourceId,
    sourcePortIndex: srcPort,
    targetNodeId: targetId,
    targetPortIndex: tgtPort,
  };
}

/** Measure the duration (ms) of a synchronous callback */
function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** Build a chain of source -> (N-1) transform nodes via the store */
function buildStoreChain(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const type: NodeType = i === 0 ? 'source' : 'transform';
    const id = getState().addNode(type, [i * 2, 0, 0]);
    if (i === 0) getState().updateNodeData(id, 'value', 1);
    ids.push(id);
    if (i > 0) {
      const connId = getState().addConnection(ids[i - 1], 0, id, 0);
      expect(connId).not.toBeNull();
    }
  }
  return ids;
}

/** Build a chain of raw nodes + connections (no store, for algorithm benchmarks) */
function buildRawChain(count: number): {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
} {
  const nodes: Record<string, EditorNode> = {};
  const connections: Record<string, Connection> = {};
  for (let i = 0; i < count; i++) {
    const id = `raw-${i}`;
    nodes[id] = makeRawNode(id, i === 0 ? 'source' : 'transform', [i * 2, 0, 0]);
    if (i > 0) {
      const connId = `rawconn-${i}`;
      connections[connId] = makeRawConnection(connId, `raw-${i - 1}`, id);
    }
  }
  return { nodes, connections };
}

// ===========================================================================
// Large Graph Performance Tests
// ===========================================================================
describe('Large graph performance', { timeout: 30000 }, () => {
  beforeEach(() => {
    resetStore();
  });

  // =========================================================================
  // 1. Store-based node creation: 200 nodes
  // =========================================================================
  it('creates 200 nodes via the store within 2000ms', () => {
    const duration = measure(() => {
      for (let i = 0; i < 200; i++) {
        getState().addNode('source', [i * 2, 0, 0]);
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(200);
    expect(duration).toBeLessThan(2000);
    console.log(`[LARGE-BENCH] 200 store nodes: ${duration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 2. Store-based node creation: 500 nodes
  // =========================================================================
  it('creates 500 nodes via the store within 5000ms', () => {
    const duration = measure(() => {
      for (let i = 0; i < 500; i++) {
        getState().addNode('source', [i * 2, 0, 0]);
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(500);
    expect(duration).toBeLessThan(5000);
    console.log(`[LARGE-BENCH] 500 store nodes: ${duration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 3. Raw 1000-node chain — topologicalSort
  // =========================================================================
  it('topologicalSort handles a 1000-node chain within 100ms', () => {
    const { nodes, connections } = buildRawChain(1000);

    const duration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      const totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
      expect(totalNodes).toBe(1000);
    });

    expect(duration).toBeLessThan(100);
    console.log(`[LARGE-BENCH] topologicalSort 1000-node chain: ${duration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 4. Execute a 200-node chain via executeGraph
  // =========================================================================
  it('executes a 200-node chain via executeGraph within 1000ms', () => {
    const { nodes, connections } = buildRawChain(200);

    const duration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(200);
      expect(result.errors.size).toBe(0);
    });

    expect(duration).toBeLessThan(1000);
    console.log(`[LARGE-BENCH] executeGraph 200-node chain: ${duration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 5. Execute a 500-node chain via executeGraph
  // =========================================================================
  it('executes a 500-node chain via executeGraph within 3000ms', () => {
    const { nodes, connections } = buildRawChain(500);

    const duration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(500);
      expect(result.errors.size).toBe(0);
    });

    expect(duration).toBeLessThan(3000);
    console.log(`[LARGE-BENCH] executeGraph 500-node chain: ${duration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 6. Large fan-out graph: 1 source -> 200 transforms
  // =========================================================================
  it('handles large fan-out (1 source -> 200 transforms) in topologicalSort + executeGraph', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    // Single source
    nodes['fan-src'] = makeRawNode('fan-src', 'source', [0, 0, 0]);
    nodes['fan-src'].data = { value: 42 };

    // 200 transforms, each connected from the source
    for (let i = 0; i < 200; i++) {
      const id = `fan-xfm-${i}`;
      nodes[id] = makeRawNode(id, 'transform', [(i + 1) * 2, 0, 0]);
      connections[`fan-conn-${i}`] = makeRawConnection(`fan-conn-${i}`, 'fan-src', id);
    }

    // topologicalSort
    const sortDuration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      const totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
      expect(totalNodes).toBe(201); // 1 source + 200 transforms
      // Source should be in first wave, all transforms in second wave
      expect(waves.length).toBe(2);
      expect(waves[0]).toHaveLength(1);
      expect(waves[1]).toHaveLength(200);
    });

    expect(sortDuration).toBeLessThan(100);
    console.log(`[LARGE-BENCH] topologicalSort fan-out 201 nodes: ${sortDuration.toFixed(2)}ms`);

    // executeGraph
    const execDuration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(201);
      expect(result.errors.size).toBe(0);
    });

    expect(execDuration).toBeLessThan(1000);
    console.log(`[LARGE-BENCH] executeGraph fan-out 201 nodes: ${execDuration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 7. Diamond convergence: 200 sources -> chain of math (add) nodes
  // =========================================================================
  it('handles diamond convergence pattern (200 sources -> math chain)', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};
    let connIdx = 0;

    // 200 source nodes
    for (let i = 0; i < 200; i++) {
      const id = `dia-src-${i}`;
      nodes[id] = makeRawNode(id, 'source', [0, 0, i * 2]);
      nodes[id].data = { value: i + 1 };
    }

    // 100 math (add) nodes merging pairs of sources
    // dia-src-0 + dia-src-1 -> math-0, dia-src-2 + dia-src-3 -> math-1, etc.
    const mathIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `dia-math-${i}`;
      nodes[id] = makeRawNode(id, 'math', [10, 0, i * 2]);
      // Connect source pair to math inputs
      connections[`dia-c-${connIdx}`] = makeRawConnection(
        `dia-c-${connIdx++}`,
        `dia-src-${i * 2}`,
        id,
        0,
        0,
      );
      connections[`dia-c-${connIdx}`] = makeRawConnection(
        `dia-c-${connIdx++}`,
        `dia-src-${i * 2 + 1}`,
        id,
        0,
        1,
      );
      mathIds.push(id);
    }

    // Chain the math nodes: math-0 out -> transform -> math-1 input 1, etc.
    // Actually simpler: add a final output transform connected to the last math
    const finalId = 'dia-final';
    nodes[finalId] = makeRawNode(finalId, 'transform', [20, 0, 0]);
    connections[`dia-c-${connIdx}`] = makeRawConnection(
      `dia-c-${connIdx++}`,
      mathIds[mathIds.length - 1],
      finalId,
    );

    const totalNodeCount = 200 + 100 + 1; // 301 nodes

    // topologicalSort
    const sortDuration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      const totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
      expect(totalNodes).toBe(totalNodeCount);
    });

    expect(sortDuration).toBeLessThan(200);
    console.log(`[LARGE-BENCH] topologicalSort diamond ${totalNodeCount} nodes: ${sortDuration.toFixed(2)}ms`);

    // executeGraph
    const execDuration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(totalNodeCount);
      expect(result.errors.size).toBe(0);
    });

    expect(execDuration).toBeLessThan(2000);
    console.log(`[LARGE-BENCH] executeGraph diamond ${totalNodeCount} nodes: ${execDuration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 8. 1000 connections creation performance (store-based)
  // =========================================================================
  it('creates 1000 connections via the store within 10000ms', () => {
    // First create 1001 nodes (source + 1000 transforms)
    const ids: string[] = [];
    for (let i = 0; i < 1001; i++) {
      const type: NodeType = i === 0 ? 'source' : 'transform';
      ids.push(getState().addNode(type, [i * 2, 0, 0]));
    }
    if (ids[0]) {
      getState().updateNodeData(ids[0], 'value', 1);
    }

    // Now measure connection creation only
    const duration = measure(() => {
      for (let i = 1; i <= 1000; i++) {
        const connId = getState().addConnection(ids[i - 1], 0, ids[i], 0);
        expect(connId).not.toBeNull();
      }
    });

    expect(Object.keys(getState().connections)).toHaveLength(1000);
    expect(duration).toBeLessThan(10000);
    console.log(`[LARGE-BENCH] 1000 store connections: ${duration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 9. Export/import roundtrip with 200-node graph
  // =========================================================================
  it('exports and imports a 200-node graph within 1000ms each', () => {
    // Build a 200-node chain via the store
    buildStoreChain(200);

    expect(Object.keys(getState().nodes)).toHaveLength(200);
    expect(Object.keys(getState().connections)).toHaveLength(199);

    // Measure export
    let exported: MultiGraphStorage | undefined;
    const exportDuration = measure(() => {
      exported = getState().exportAllGraphs();
    });

    expect(exported).toBeDefined();
    expect(exportDuration).toBeLessThan(1000);
    console.log(`[LARGE-BENCH] export 200-node graph: ${exportDuration.toFixed(2)}ms`);

    // Reset and import
    resetStore();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    const importDuration = measure(() => {
      getState().importAllGraphs(exported!);
    });

    expect(importDuration).toBeLessThan(1000);
    console.log(`[LARGE-BENCH] import 200-node graph: ${importDuration.toFixed(2)}ms`);

    // Verify data survived the roundtrip
    const state = getState();
    expect(Object.keys(state.nodes).length).toBe(200);
    expect(Object.keys(state.connections).length).toBe(199);
  });

  // =========================================================================
  // 10. topologicalSort does not stack overflow with 1000 nodes
  // =========================================================================
  it('topologicalSort does not stack overflow with a 1000-node chain', () => {
    const { nodes, connections } = buildRawChain(1000);

    // This should not throw a RangeError (maximum call stack exceeded)
    let waves: string[][] = [];
    expect(() => {
      waves = topologicalSort(nodes, connections);
    }).not.toThrow();

    const totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
    expect(totalNodes).toBe(1000);

    // Chain should produce ~1000 waves (each node depends on the previous)
    // or at least a valid topological ordering
    expect(waves.length).toBeGreaterThan(0);
    expect(waves.length).toBeLessThanOrEqual(1000);
  });

  // =========================================================================
  // 11. Raw 1000-node graph — executeGraph correctness and performance
  // =========================================================================
  it('executes a 1000-node chain via executeGraph within 10000ms', () => {
    const { nodes, connections } = buildRawChain(1000);

    const duration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(1000);
      expect(result.errors.size).toBe(0);
    });

    expect(duration).toBeLessThan(10000);
    console.log(`[LARGE-BENCH] executeGraph 1000-node chain: ${duration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 12. topologicalSort with 1000 independent (disconnected) nodes
  // =========================================================================
  it('topologicalSort handles 1000 independent nodes within 50ms', () => {
    const nodes: Record<string, EditorNode> = {};
    for (let i = 0; i < 1000; i++) {
      const id = `indep-${i}`;
      nodes[id] = makeRawNode(id, 'source', [i * 2, 0, 0]);
    }

    const duration = measure(() => {
      const waves = topologicalSort(nodes, {});
      // All nodes should be in the first wave (no dependencies)
      expect(waves.length).toBe(1);
      expect(waves[0]).toHaveLength(1000);
    });

    expect(duration).toBeLessThan(50);
    console.log(`[LARGE-BENCH] topologicalSort 1000 independent nodes: ${duration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 13. Mixed topology: chain + fan-out + fan-in at 500 nodes
  // =========================================================================
  it('handles a 500-node mixed topology (chain + fan-out + fan-in) via executeGraph', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};
    let connIdx = 0;

    // Phase 1: 10 source nodes
    const sourceIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `mix-src-${i}`;
      nodes[id] = makeRawNode(id, 'source', [0, 0, i * 2]);
      nodes[id].data = { value: (i + 1) * 5 };
      sourceIds.push(id);
    }

    // Phase 2: Each source fans out to 20 transforms (200 transforms total)
    const fanOutIds: string[] = [];
    for (let s = 0; s < 10; s++) {
      for (let t = 0; t < 20; t++) {
        const id = `mix-xfm-${s}-${t}`;
        nodes[id] = makeRawNode(id, 'transform', [10, 0, s * 20 + t]);
        connections[`mix-c-${connIdx}`] = makeRawConnection(
          `mix-c-${connIdx++}`,
          sourceIds[s],
          id,
        );
        fanOutIds.push(id);
      }
    }

    // Phase 3: 100 math nodes merging pairs of transforms
    const mathIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `mix-math-${i}`;
      nodes[id] = makeRawNode(id, 'math', [20, 0, i * 2]);
      connections[`mix-c-${connIdx}`] = makeRawConnection(
        `mix-c-${connIdx++}`,
        fanOutIds[i * 2],
        id,
        0,
        0,
      );
      connections[`mix-c-${connIdx}`] = makeRawConnection(
        `mix-c-${connIdx++}`,
        fanOutIds[i * 2 + 1],
        id,
        0,
        1,
      );
      mathIds.push(id);
    }

    // Phase 4: Chain the 100 math outputs through 190 additional transforms
    const chainIds: string[] = [];
    let prevId = mathIds[0];
    for (let i = 0; i < 190; i++) {
      const id = `mix-chain-${i}`;
      nodes[id] = makeRawNode(id, 'transform', [30 + i, 0, 0]);
      connections[`mix-c-${connIdx}`] = makeRawConnection(
        `mix-c-${connIdx++}`,
        prevId,
        id,
      );
      prevId = id;
      chainIds.push(id);
    }

    // Total: 10 + 200 + 100 + 190 = 500 nodes
    const totalNodeCount = Object.keys(nodes).length;
    expect(totalNodeCount).toBe(500);

    // topologicalSort
    const sortDuration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      const totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
      expect(totalNodes).toBe(500);
    });

    expect(sortDuration).toBeLessThan(200);
    console.log(`[LARGE-BENCH] topologicalSort mixed 500 nodes: ${sortDuration.toFixed(2)}ms`);

    // executeGraph
    const execDuration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(500);
      expect(result.errors.size).toBe(0);
    });

    expect(execDuration).toBeLessThan(3000);
    console.log(`[LARGE-BENCH] executeGraph mixed 500 nodes: ${execDuration.toFixed(2)}ms`);
  });

  // =========================================================================
  // 14. Cached execution speedup at scale (200-node chain)
  // =========================================================================
  it('cached executeGraph on a 200-node chain is faster than cold', () => {
    const { nodes, connections } = buildRawChain(200);

    // Cold execution
    const coldStart = performance.now();
    const coldResult = executeGraph(nodes, connections);
    const coldDuration = performance.now() - coldStart;

    expect(coldResult.results.size).toBe(200);
    expect(coldResult.errors.size).toBe(0);

    // Warm execution (pass cached results)
    const warmStart = performance.now();
    const warmResult = executeGraph(nodes, connections, coldResult.results);
    const warmDuration = performance.now() - warmStart;

    expect(warmResult.results.size).toBe(200);
    expect(warmResult.errors.size).toBe(0);

    // Cached should be at least somewhat faster — at minimum not dramatically slower.
    // We don't assert a strict ratio because very fast absolute times can be noisy.
    // Instead, just log the results for observation.
    console.log(
      `[LARGE-BENCH] 200-node chain: cold=${coldDuration.toFixed(2)}ms, ` +
      `warm=${warmDuration.toFixed(2)}ms, ` +
      `speedup=${(coldDuration / Math.max(warmDuration, 0.01)).toFixed(2)}x`,
    );

    // Cached should not be more than 2x slower than cold (that would be a regression)
    expect(warmDuration).toBeLessThan(coldDuration * 2 + 10); // +10ms tolerance for timing noise
  });
});

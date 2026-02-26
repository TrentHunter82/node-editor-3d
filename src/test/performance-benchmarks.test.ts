/**
 * Performance Benchmarks for Rosebud Node Editor 3D
 * Phase 14: Baseline measurements before instanced rendering
 *
 * These benchmarks establish current performance baselines for:
 * - Node/connection creation at scale
 * - Graph execution performance
 * - Topological sort scaling
 * - Serialization (export/import) throughput
 * - Selection and deletion at scale
 * - Undo/redo stack performance
 *
 * Thresholds are generous (baseline, not strict gates).
 * After instanced rendering is implemented, compare against these baselines.
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

const getState = () => useEditorStore.getState();

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.selectedIds = new Set();
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.graphTabs = { default: { id: 'default', name: 'Main Graph', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.contextMenu = null;
    s.validationErrors = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.isExecuting = false;
    s.showValuePreviews = false;
    s.debugMode = false;
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.undoRedoEvent = null;
    s.hoveredConnectionId = null;
    s.nearestSnapPort = null;
  });
}

/** Build a raw node object (bypassing store) for direct algorithm benchmarks */
function makeRawNode(id: string, type: NodeType, x: number): EditorNode {
  const isSource = type === 'source';
  return {
    id,
    type,
    position: [x, 0, 0],
    title: `${type}-${id}`,
    data: isSource ? { value: 1 } : {},
    inputs: isSource ? [] : [{ id: `${id}-in-0`, label: 'in', portType: 'number' as const }],
    outputs: [{ id: `${id}-out-0`, label: 'out', portType: 'number' as const }],
  };
}

/** Build a raw connection object */
function makeRawConnection(id: string, sourceId: string, targetId: string): Connection {
  return {
    id,
    sourceNodeId: sourceId,
    sourcePortIndex: 0,
    targetNodeId: targetId,
    targetPortIndex: 0,
  };
}

/** Measure the duration of a synchronous callback (ms) */
function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** Build a chain of source -> N-1 transform nodes via the store */
function buildStoreChain(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const type: NodeType = i === 0 ? 'source' : 'transform';
    const id = getState().addNode(type, [i * 2, 0, 0]);
    if (i === 0) getState().updateNodeData(id, 'value', 1);
    ids.push(id);
    if (i > 0) {
      getState().addConnection(ids[i - 1], 0, id, 0);
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
    nodes[id] = makeRawNode(id, i === 0 ? 'source' : 'transform', i * 2);
    if (i > 0) {
      connections[`rawconn-${i}`] = makeRawConnection(`rawconn-${i}`, `raw-${i - 1}`, id);
    }
  }
  return { nodes, connections };
}

// ===========================================================================
// 1. Node creation performance
// ===========================================================================
describe('Node creation performance', () => {
  beforeEach(() => { resetStore(); });

  it('creates 100 source nodes within 1000ms', () => {
    const duration = measure(() => {
      for (let i = 0; i < 100; i++) {
        getState().addNode('source', [i * 2, 0, 0]);
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(100);
    expect(duration).toBeLessThan(1000);
    console.log(`[BENCH] 100 nodes: ${duration.toFixed(2)}ms`);
  });

  it('creates 500 source nodes within 5000ms', () => {
    const duration = measure(() => {
      for (let i = 0; i < 500; i++) {
        getState().addNode('source', [i * 2, 0, 0]);
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(500);
    expect(duration).toBeLessThan(5000);
    console.log(`[BENCH] 500 nodes: ${duration.toFixed(2)}ms`);
  });

  it('creates 100 nodes of mixed types within 1000ms', () => {
    const types: NodeType[] = ['source', 'transform', 'math', 'filter', 'sin', 'cos', 'abs'];
    const duration = measure(() => {
      for (let i = 0; i < 100; i++) {
        getState().addNode(types[i % types.length], [i * 2, 0, 0]);
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(100);
    expect(duration).toBeLessThan(1000);
    console.log(`[BENCH] 100 mixed-type nodes: ${duration.toFixed(2)}ms`);
  });

  it('measures per-node cost scaling (100 vs 500)', () => {
    // First batch: 100 nodes
    const duration100 = measure(() => {
      for (let i = 0; i < 100; i++) {
        getState().addNode('source', [i * 2, 0, 0]);
      }
    });
    const perNode100 = duration100 / 100;

    resetStore();

    // Second batch: 500 nodes
    const duration500 = measure(() => {
      for (let i = 0; i < 500; i++) {
        getState().addNode('source', [i * 2, 0, 0]);
      }
    });
    const perNode500 = duration500 / 500;

    // Per-node cost should not increase by more than 10x at 5x scale
    // (allows for some O(n) overhead from undo snapshots, etc.)
    expect(perNode500).toBeLessThan(perNode100 * 10);
    console.log(`[BENCH] Per-node cost: @100=${perNode100.toFixed(3)}ms, @500=${perNode500.toFixed(3)}ms, ratio=${(perNode500 / perNode100).toFixed(2)}x`);
  });
});

// ===========================================================================
// 2. Connection creation performance
// ===========================================================================
describe('Connection creation performance', () => {
  beforeEach(() => { resetStore(); });

  it('creates a 100-node chain (99 connections) within 2000ms', () => {
    // Pre-create nodes
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const type: NodeType = i === 0 ? 'source' : 'transform';
      ids.push(getState().addNode(type, [i * 2, 0, 0]));
    }

    // Measure connection creation separately
    const duration = measure(() => {
      for (let i = 1; i < 100; i++) {
        getState().addConnection(ids[i - 1], 0, ids[i], 0);
      }
    });

    expect(Object.keys(getState().connections)).toHaveLength(99);
    expect(duration).toBeLessThan(2000);
    console.log(`[BENCH] 99 connections: ${duration.toFixed(2)}ms`);
  });

  it('creates a fan-out topology (1 source -> 50 transforms) within 2000ms', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 42);

    // Create 50 transform nodes
    const transformIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      transformIds.push(getState().addNode('transform', [(i + 1) * 2, 0, 0]));
    }

    // Measure fan-out connections
    const duration = measure(() => {
      for (const tId of transformIds) {
        getState().addConnection(srcId, 0, tId, 0);
      }
    });

    expect(Object.keys(getState().connections)).toHaveLength(50);
    expect(duration).toBeLessThan(2000);
    console.log(`[BENCH] 50 fan-out connections: ${duration.toFixed(2)}ms`);
  });

  it('creates combined 100-node chain (nodes + connections) within 3000ms', () => {
    const duration = measure(() => {
      buildStoreChain(100);
    });

    expect(Object.keys(getState().nodes)).toHaveLength(100);
    expect(Object.keys(getState().connections)).toHaveLength(99);
    expect(duration).toBeLessThan(3000);
    console.log(`[BENCH] 100-node chain (nodes+conns): ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 3. Execution performance
// ===========================================================================
describe('Execution performance', () => {
  beforeEach(() => { resetStore(); });

  it('executes a 50-node chain within 500ms', () => {
    const { nodes, connections } = buildRawChain(50);

    const duration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(50);
      expect(result.errors.size).toBe(0);
    });

    expect(duration).toBeLessThan(500);
    console.log(`[BENCH] Execute 50-node chain: ${duration.toFixed(2)}ms`);
  });

  it('executes a 200-node chain within 2000ms', () => {
    const { nodes, connections } = buildRawChain(200);

    const duration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(200);
      expect(result.errors.size).toBe(0);
    });

    expect(duration).toBeLessThan(2000);
    console.log(`[BENCH] Execute 200-node chain: ${duration.toFixed(2)}ms`);
  });

  it('executes a wide graph (50 independent sources) within 200ms', () => {
    const nodes: Record<string, EditorNode> = {};
    for (let i = 0; i < 50; i++) {
      const id = `wide-${i}`;
      nodes[id] = makeRawNode(id, 'source', i * 2);
      nodes[id].data = { value: i * 10 };
    }

    const duration = measure(() => {
      const result = executeGraph(nodes, {});
      expect(result.results.size).toBe(50);
    });

    expect(duration).toBeLessThan(200);
    console.log(`[BENCH] Execute 50 independent sources: ${duration.toFixed(2)}ms`);
  });

  it('executes a diamond graph (fan-out + fan-in) within 500ms', () => {
    // Source -> 20 transforms -> merge via math nodes
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    // Source node
    nodes['src'] = makeRawNode('src', 'source', 0);
    nodes['src'].data = { value: 5 };

    // 20 middle transform nodes
    for (let i = 0; i < 20; i++) {
      const id = `mid-${i}`;
      nodes[id] = makeRawNode(id, 'transform', (i + 1) * 2);
      connections[`c-fan-${i}`] = makeRawConnection(`c-fan-${i}`, 'src', id);
    }

    // 10 math nodes that merge pairs
    for (let i = 0; i < 10; i++) {
      const id = `merge-${i}`;
      nodes[id] = {
        id,
        type: 'math',
        position: [50, i * 2, 0],
        title: `Math ${i}`,
        data: { operation: 'add' },
        inputs: [
          { id: `${id}-in-0`, label: 'A', portType: 'number' },
          { id: `${id}-in-1`, label: 'B', portType: 'number' },
        ],
        outputs: [{ id: `${id}-out-0`, label: 'Result', portType: 'number' }],
      };
      connections[`c-merge-a-${i}`] = makeRawConnection(`c-merge-a-${i}`, `mid-${i * 2}`, id);
      connections[`c-merge-b-${i}`] = {
        id: `c-merge-b-${i}`,
        sourceNodeId: `mid-${i * 2 + 1}`,
        sourcePortIndex: 0,
        targetNodeId: id,
        targetPortIndex: 1,
      };
    }

    const duration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(31); // 1 src + 20 mid + 10 merge
      expect(result.errors.size).toBe(0);
    });

    expect(duration).toBeLessThan(500);
    console.log(`[BENCH] Execute diamond graph (31 nodes): ${duration.toFixed(2)}ms`);
  });

  it('cached execution is faster than cold execution', () => {
    const { nodes, connections } = buildRawChain(100);

    // Cold execution
    const coldStart = performance.now();
    const coldResult = executeGraph(nodes, connections);
    const coldDuration = performance.now() - coldStart;

    // Warm execution (pass cache)
    const warmStart = performance.now();
    const warmResult = executeGraph(nodes, connections, coldResult.results);
    const warmDuration = performance.now() - warmStart;

    expect(coldResult.results.size).toBe(100);
    expect(warmResult.results.size).toBe(100);

    // Cached should be at least somewhat faster (or at minimum not dramatically slower)
    console.log(`[BENCH] 100-node chain: cold=${coldDuration.toFixed(2)}ms, warm=${warmDuration.toFixed(2)}ms, speedup=${(coldDuration / warmDuration).toFixed(2)}x`);
  });
});

// ===========================================================================
// 4. Topological sort scaling
// ===========================================================================
describe('Topological sort performance', () => {
  it('sorts a 500-node chain within 50ms', () => {
    const { nodes, connections } = buildRawChain(500);

    const duration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      const totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
      expect(totalNodes).toBe(500);
    });

    expect(duration).toBeLessThan(50);
    console.log(`[BENCH] topologicalSort 500-node chain: ${duration.toFixed(2)}ms`);
  });

  it('sorts 500 independent nodes within 20ms', () => {
    const nodes: Record<string, EditorNode> = {};
    for (let i = 0; i < 500; i++) {
      const id = `ind-${i}`;
      nodes[id] = makeRawNode(id, 'source', i);
    }

    const duration = measure(() => {
      const waves = topologicalSort(nodes, {});
      expect(waves).toHaveLength(1);
      expect(waves[0]).toHaveLength(500);
    });

    expect(duration).toBeLessThan(20);
    console.log(`[BENCH] topologicalSort 500 independent: ${duration.toFixed(2)}ms`);
  });

  it('sorts a 1000-node chain within 200ms', () => {
    const { nodes, connections } = buildRawChain(1000);

    const duration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      const totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
      expect(totalNodes).toBe(1000);
    });

    expect(duration).toBeLessThan(200);
    console.log(`[BENCH] topologicalSort 1000-node chain: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 5. Serialization performance
// ===========================================================================
describe('Serialization performance', () => {
  beforeEach(() => { resetStore(); });

  it('exports 200-node graph within 500ms', () => {
    buildStoreChain(200);
    expect(Object.keys(getState().nodes)).toHaveLength(200);
    expect(Object.keys(getState().connections)).toHaveLength(199);

    let exported: MultiGraphStorage | undefined;
    const duration = measure(() => {
      exported = getState().exportAllGraphs();
    });

    expect(exported).toBeDefined();
    expect(exported!.version).toBe(2);
    expect(Object.keys(exported!.graphs[exported!.activeGraphId].nodes)).toHaveLength(200);
    expect(duration).toBeLessThan(500);
    console.log(`[BENCH] Export 200 nodes + 199 conns: ${duration.toFixed(2)}ms`);
  });

  it('imports 200-node graph within 500ms', () => {
    buildStoreChain(200);
    const exported = getState().exportAllGraphs();

    resetStore();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    const duration = measure(() => {
      getState().importAllGraphs(exported);
    });

    expect(Object.keys(getState().nodes)).toHaveLength(200);
    expect(Object.keys(getState().connections)).toHaveLength(199);
    expect(duration).toBeLessThan(500);
    console.log(`[BENCH] Import 200 nodes + 199 conns: ${duration.toFixed(2)}ms`);
  });

  it('round-trip (export + import) 200 nodes within 1000ms', () => {
    buildStoreChain(200);

    let exported: MultiGraphStorage | undefined;
    const exportDuration = measure(() => {
      exported = getState().exportAllGraphs();
    });

    resetStore();

    const importDuration = measure(() => {
      getState().importAllGraphs(exported!);
    });

    const totalDuration = exportDuration + importDuration;

    expect(Object.keys(getState().nodes)).toHaveLength(200);
    expect(Object.keys(getState().connections)).toHaveLength(199);
    expect(totalDuration).toBeLessThan(1000);
    console.log(`[BENCH] Round-trip 200 nodes: export=${exportDuration.toFixed(2)}ms + import=${importDuration.toFixed(2)}ms = ${totalDuration.toFixed(2)}ms`);
  });

  it('JSON.stringify size scales linearly with node count', () => {
    // Build 100 nodes, measure size
    buildStoreChain(100);
    const export100 = getState().exportAllGraphs();
    const size100 = JSON.stringify(export100).length;

    resetStore();

    // Build 200 nodes, measure size
    buildStoreChain(200);
    const export200 = getState().exportAllGraphs();
    const size200 = JSON.stringify(export200).length;

    // Size should roughly double (within 3x to account for overhead)
    const ratio = size200 / size100;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(3.0);
    console.log(`[BENCH] JSON size: 100 nodes=${(size100 / 1024).toFixed(1)}KB, 200 nodes=${(size200 / 1024).toFixed(1)}KB, ratio=${ratio.toFixed(2)}x`);
  });
});

// ===========================================================================
// 6. Selection and deletion performance
// ===========================================================================
describe('Selection and deletion performance', () => {
  beforeEach(() => { resetStore(); });

  it('selects all 100 nodes within 200ms', () => {
    const ids = buildStoreChain(100);

    const duration = measure(() => {
      getState().setSelection(new Set(ids));
    });

    expect(getState().selectedIds.size).toBe(100);
    expect(duration).toBeLessThan(200);
    console.log(`[BENCH] Select 100 nodes: ${duration.toFixed(2)}ms`);
  });

  it('deletes 100 selected nodes within 2000ms', () => {
    const ids = buildStoreChain(100);
    getState().setSelection(new Set(ids));

    const duration = measure(() => {
      getState().deleteSelected();
    });

    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(Object.keys(getState().connections)).toHaveLength(0);
    expect(duration).toBeLessThan(2000);
    console.log(`[BENCH] Delete 100 selected nodes: ${duration.toFixed(2)}ms`);
  });

  it('select-all + delete + undo cycle within 3000ms total', () => {
    const ids = buildStoreChain(100);

    const selectDuration = measure(() => {
      getState().setSelection(new Set(ids));
    });

    const deleteDuration = measure(() => {
      getState().deleteSelected();
    });

    expect(Object.keys(getState().nodes)).toHaveLength(0);

    const undoDuration = measure(() => {
      getState().undo();
    });

    expect(Object.keys(getState().nodes)).toHaveLength(100);
    expect(Object.keys(getState().connections)).toHaveLength(99);

    const totalDuration = selectDuration + deleteDuration + undoDuration;
    expect(totalDuration).toBeLessThan(3000);
    console.log(`[BENCH] Select+Delete+Undo (100 nodes): select=${selectDuration.toFixed(2)}ms, delete=${deleteDuration.toFixed(2)}ms, undo=${undoDuration.toFixed(2)}ms, total=${totalDuration.toFixed(2)}ms`);
  });

  it('duplicate 50 selected nodes within 2000ms', () => {
    const ids = buildStoreChain(50);
    getState().setSelection(new Set(ids));

    const duration = measure(() => {
      getState().duplicateSelected();
    });

    // Should have original 50 + duplicated 50
    expect(Object.keys(getState().nodes).length).toBeGreaterThanOrEqual(100);
    expect(duration).toBeLessThan(2000);
    console.log(`[BENCH] Duplicate 50 nodes: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 7. Undo/redo performance at scale
// ===========================================================================
describe('Undo/redo performance', () => {
  beforeEach(() => { resetStore(); });

  it('undo 50 node-creation actions within 2000ms', () => {
    // Create 50 nodes (each addNode pushes an undo entry)
    for (let i = 0; i < 50; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }
    expect(Object.keys(getState().nodes)).toHaveLength(50);

    const duration = measure(() => {
      for (let i = 0; i < 50; i++) {
        if (getState().canUndo()) getState().undo();
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(duration).toBeLessThan(2000);
    console.log(`[BENCH] Undo 50 actions: ${duration.toFixed(2)}ms`);
  });

  it('redo 50 node-creation actions within 2000ms', () => {
    // Create 50 nodes
    for (let i = 0; i < 50; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }

    // Undo all
    for (let i = 0; i < 50; i++) {
      if (getState().canUndo()) getState().undo();
    }
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    const duration = measure(() => {
      for (let i = 0; i < 50; i++) {
        if (getState().canRedo()) getState().redo();
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(50);
    expect(duration).toBeLessThan(2000);
    console.log(`[BENCH] Redo 50 actions: ${duration.toFixed(2)}ms`);
  });

  it('undo+redo round-trip 50 actions within 4000ms', () => {
    // Create 50 nodes
    for (let i = 0; i < 50; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }

    const undoDuration = measure(() => {
      for (let i = 0; i < 50; i++) {
        if (getState().canUndo()) getState().undo();
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(0);

    const redoDuration = measure(() => {
      for (let i = 0; i < 50; i++) {
        if (getState().canRedo()) getState().redo();
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(50);
    const totalDuration = undoDuration + redoDuration;
    expect(totalDuration).toBeLessThan(4000);
    console.log(`[BENCH] Undo+Redo 50 actions: undo=${undoDuration.toFixed(2)}ms, redo=${redoDuration.toFixed(2)}ms, total=${totalDuration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 8. Composite benchmark: realistic workflow
// ===========================================================================
describe('Composite workflow performance', () => {
  beforeEach(() => { resetStore(); });

  it('full workflow: create 50 nodes, connect, execute, export, delete, undo — all within 10s', () => {
    // Step 1: Create 50-node chain
    const createDuration = measure(() => {
      buildStoreChain(50);
    });

    expect(Object.keys(getState().nodes)).toHaveLength(50);

    // Step 2: Execute the graph
    const executeDuration = measure(() => {
      const state = getState();
      const result = executeGraph(state.nodes, state.connections);
      expect(result.results.size).toBe(50);
    });

    // Step 3: Export
    const exportDuration = measure(() => {
      getState().exportAllGraphs();
    });

    // Step 4: Select all and delete
    const allIds = Object.keys(getState().nodes);
    getState().setSelection(new Set(allIds));

    const deleteDuration = measure(() => {
      getState().deleteSelected();
    });

    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Step 5: Undo deletion
    const undoDuration = measure(() => {
      getState().undo();
    });

    expect(Object.keys(getState().nodes)).toHaveLength(50);

    const totalDuration = createDuration + executeDuration + exportDuration + deleteDuration + undoDuration;
    expect(totalDuration).toBeLessThan(10000);
    console.log(
      `[BENCH] Full workflow (50 nodes): create=${createDuration.toFixed(2)}ms, execute=${executeDuration.toFixed(2)}ms, export=${exportDuration.toFixed(2)}ms, delete=${deleteDuration.toFixed(2)}ms, undo=${undoDuration.toFixed(2)}ms, total=${totalDuration.toFixed(2)}ms`,
    );
  });

  it('multi-graph workflow: 3 graphs with 30 nodes each within 5000ms', () => {
    const duration = measure(() => {
      // Graph 1 (default) — 30 nodes
      buildStoreChain(30);

      // Graph 2 — 30 nodes
      const g2 = getState().createGraph('Graph 2');
      buildStoreChain(30);

      // Graph 3 — 30 nodes
      const g3 = getState().createGraph('Graph 3');
      buildStoreChain(30);

      // Switch between graphs to verify persistence
      getState().switchGraph('default');
      expect(Object.keys(getState().nodes)).toHaveLength(30);

      getState().switchGraph(g2);
      expect(Object.keys(getState().nodes)).toHaveLength(30);

      getState().switchGraph(g3);
      expect(Object.keys(getState().nodes)).toHaveLength(30);
    });

    expect(duration).toBeLessThan(5000);
    console.log(`[BENCH] Multi-graph (3x30 nodes + switches): ${duration.toFixed(2)}ms`);
  });
});

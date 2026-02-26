/**
 * Phase 29 Performance Regression Suite
 *
 * Automated benchmarks with strict regression gates that FAIL if performance
 * degrades beyond established baselines. Covers execution time, memory-like
 * metrics (node/connection count scaling), and critical path operations.
 *
 * These tests use conservative thresholds to avoid flaky failures while
 * still catching genuine performance regressions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { topologicalSort, executeGraph } from '../utils/execution';
import type { EditorNode, Connection, NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() { return useEditorStore.getState(); }

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.validationErrors = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.debugMode = false;
    s.isExecuting = false;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

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

function makeRawConnection(id: string, srcId: string, tgtId: string): Connection {
  return {
    id,
    sourceNodeId: srcId,
    sourcePortIndex: 0,
    targetNodeId: tgtId,
    targetPortIndex: 0,
  };
}

function buildRawChain(count: number) {
  const nodes: Record<string, EditorNode> = {};
  const connections: Record<string, Connection> = {};
  for (let i = 0; i < count; i++) {
    const id = `n${i}`;
    nodes[id] = makeRawNode(id, i === 0 ? 'source' : 'transform', i * 2);
    if (i > 0) {
      connections[`c${i}`] = makeRawConnection(`c${i}`, `n${i - 1}`, id);
    }
  }
  return { nodes, connections };
}

function buildRawFanout(sourceCount: number, fanout: number) {
  const nodes: Record<string, EditorNode> = {};
  const connections: Record<string, Connection> = {};
  let connIdx = 0;

  for (let s = 0; s < sourceCount; s++) {
    const srcId = `src${s}`;
    nodes[srcId] = makeRawNode(srcId, 'source', s * 5);
    for (let f = 0; f < fanout; f++) {
      const tgtId = `tf${s}_${f}`;
      nodes[tgtId] = makeRawNode(tgtId, 'transform', s * 5 + f + 1);
      connections[`c${connIdx++}`] = makeRawConnection(`c${connIdx}`, srcId, tgtId);
    }
  }
  return { nodes, connections };
}

// ===========================================================================
// Regression Baselines (update these when intentional perf changes occur)
// ===========================================================================

const BASELINES = {
  // Topological sort
  topoSort100: 50,     // ms, 100-node chain
  topoSort500: 500,    // ms, 500-node chain
  topoSort1000: 2000,  // ms, 1000-node chain

  // Execution (graph evaluation)
  exec100: 200,    // ms, 100-node chain
  exec500: 2000,   // ms, 500-node chain

  // Store operations
  addNode100: 1000,      // ms, 100 addNode calls
  addConnection100: 500, // ms, 100 addConnection calls
  undoRedo100: 2000,     // ms, 100 undo+redo cycles

  // Serialization
  serialize500: 500,     // ms, JSON.stringify 500 nodes + connections

  // Selection
  selectAll500: 200,     // ms, select 500 nodes
  deleteSelected100: 500, // ms, delete 100 selected nodes
};

// ===========================================================================
// 1. Topological Sort Regression (3 tests)
// ===========================================================================

describe('Topological sort regression gates', () => {
  it(`100-node chain sorts within ${BASELINES.topoSort100}ms`, () => {
    const { nodes, connections } = buildRawChain(100);
    const duration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      expect(waves.length).toBe(100);
    });
    expect(duration).toBeLessThan(BASELINES.topoSort100);
    console.log(`[REGRESSION] topoSort 100: ${duration.toFixed(2)}ms (limit: ${BASELINES.topoSort100}ms)`);
  });

  it(`500-node chain sorts within ${BASELINES.topoSort500}ms`, () => {
    const { nodes, connections } = buildRawChain(500);
    const duration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      expect(waves.length).toBe(500);
    });
    expect(duration).toBeLessThan(BASELINES.topoSort500);
    console.log(`[REGRESSION] topoSort 500: ${duration.toFixed(2)}ms (limit: ${BASELINES.topoSort500}ms)`);
  });

  it(`1000-node chain sorts within ${BASELINES.topoSort1000}ms`, () => {
    const { nodes, connections } = buildRawChain(1000);
    const duration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      expect(waves.length).toBe(1000);
    });
    expect(duration).toBeLessThan(BASELINES.topoSort1000);
    console.log(`[REGRESSION] topoSort 1000: ${duration.toFixed(2)}ms (limit: ${BASELINES.topoSort1000}ms)`);
  });
});

// ===========================================================================
// 2. Execution Engine Regression (3 tests)
// ===========================================================================

describe('Execution engine regression gates', () => {
  it(`100-node chain executes within ${BASELINES.exec100}ms`, () => {
    const { nodes, connections } = buildRawChain(100);
    let results: ReturnType<typeof executeGraph> | undefined;
    const duration = measure(() => {
      results = executeGraph(nodes, connections);
    });
    expect(results!.results.size).toBe(100);
    expect(duration).toBeLessThan(BASELINES.exec100);
    console.log(`[REGRESSION] exec 100: ${duration.toFixed(2)}ms (limit: ${BASELINES.exec100}ms)`);
  });

  it(`500-node chain executes within ${BASELINES.exec500}ms`, () => {
    const { nodes, connections } = buildRawChain(500);
    let results: ReturnType<typeof executeGraph> | undefined;
    const duration = measure(() => {
      results = executeGraph(nodes, connections);
    });
    expect(results!.results.size).toBe(500);
    expect(duration).toBeLessThan(BASELINES.exec500);
    console.log(`[REGRESSION] exec 500: ${duration.toFixed(2)}ms (limit: ${BASELINES.exec500}ms)`);
  });

  it('fan-out graph (20 sources x 10 transforms = 220 nodes) executes correctly', () => {
    const { nodes, connections } = buildRawFanout(20, 10);
    let results: ReturnType<typeof executeGraph> | undefined;
    const duration = measure(() => {
      results = executeGraph(nodes, connections);
    });
    expect(results!.results.size).toBe(220);
    expect(duration).toBeLessThan(1000);
    console.log(`[REGRESSION] exec fan-out 220: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 3. Store Operation Regression (4 tests)
// ===========================================================================

describe('Store operation regression gates', () => {
  beforeEach(() => { resetStore(); });

  it(`100 addNode calls within ${BASELINES.addNode100}ms`, () => {
    const duration = measure(() => {
      for (let i = 0; i < 100; i++) {
        getState().addNode('source', [i * 2, 0, 0]);
      }
    });
    expect(Object.keys(getState().nodes)).toHaveLength(100);
    expect(duration).toBeLessThan(BASELINES.addNode100);
    console.log(`[REGRESSION] addNode 100: ${duration.toFixed(2)}ms (limit: ${BASELINES.addNode100}ms)`);
  });

  it(`100 addConnection calls within ${BASELINES.addConnection100}ms`, () => {
    // Create 101 nodes first
    const nodeIds: string[] = [];
    for (let i = 0; i < 101; i++) {
      nodeIds.push(getState().addNode(i === 0 ? 'source' : 'transform', [i * 2, 0, 0]));
      if (i === 0) getState().updateNodeData(nodeIds[0], 'value', 1);
    }

    const duration = measure(() => {
      for (let i = 1; i < 101; i++) {
        getState().addConnection(nodeIds[i - 1], 0, nodeIds[i], 0);
      }
    });
    expect(Object.keys(getState().connections)).toHaveLength(100);
    expect(duration).toBeLessThan(BASELINES.addConnection100);
    console.log(`[REGRESSION] addConnection 100: ${duration.toFixed(2)}ms (limit: ${BASELINES.addConnection100}ms)`);
  });

  it(`100 undo+redo cycles within ${BASELINES.undoRedo100}ms`, () => {
    // Build up 50 undo entries
    for (let i = 0; i < 50; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }

    const duration = measure(() => {
      for (let i = 0; i < 50; i++) {
        getState().undo();
      }
      for (let i = 0; i < 50; i++) {
        getState().redo();
      }
    });
    expect(Object.keys(getState().nodes)).toHaveLength(50);
    expect(duration).toBeLessThan(BASELINES.undoRedo100);
    console.log(`[REGRESSION] undo+redo 100: ${duration.toFixed(2)}ms (limit: ${BASELINES.undoRedo100}ms)`);
  });

  it(`delete 100 selected nodes within ${BASELINES.deleteSelected100}ms`, () => {
    for (let i = 0; i < 100; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }
    const allIds = new Set(Object.keys(getState().nodes));
    getState().setSelection(allIds);

    const duration = measure(() => {
      getState().deleteSelected();
    });
    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(duration).toBeLessThan(BASELINES.deleteSelected100);
    console.log(`[REGRESSION] deleteSelected 100: ${duration.toFixed(2)}ms (limit: ${BASELINES.deleteSelected100}ms)`);
  });
});

// ===========================================================================
// 4. Serialization Regression (2 tests)
// ===========================================================================

describe('Serialization regression gates', () => {
  it(`JSON.stringify 500 nodes within ${BASELINES.serialize500}ms`, () => {
    const { nodes, connections } = buildRawChain(500);
    let json: string = '';
    const duration = measure(() => {
      json = JSON.stringify({ nodes, connections });
    });
    expect(json.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(BASELINES.serialize500);
    console.log(`[REGRESSION] serialize 500: ${duration.toFixed(2)}ms, size: ${(json.length / 1024).toFixed(1)}KB`);
  });

  it('JSON.parse + structuredClone 500 nodes within 500ms', () => {
    const { nodes, connections } = buildRawChain(500);
    const json = JSON.stringify({ nodes, connections });

    const duration = measure(() => {
      const parsed = JSON.parse(json);
      structuredClone(parsed);
    });
    expect(duration).toBeLessThan(500);
    console.log(`[REGRESSION] deserialize+clone 500: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 5. Scaling Linearity Checks (3 tests)
// ===========================================================================

describe('Scaling linearity checks', () => {
  it('topological sort scales sub-quadratically (100 vs 400 nodes)', () => {
    const chain100 = buildRawChain(100);
    const chain400 = buildRawChain(400);

    const dur100 = measure(() => { topologicalSort(chain100.nodes, chain100.connections); });
    const dur400 = measure(() => { topologicalSort(chain400.nodes, chain400.connections); });

    // If O(N), 4x input should be ~4x time. Allow up to 10x (sub-quadratic).
    // If O(N²), 4x input would be 16x time.
    const ratio = dur400 / Math.max(dur100, 0.01);
    expect(ratio).toBeLessThan(10); // Sub-quadratic
    console.log(`[SCALING] topoSort: 100=${dur100.toFixed(2)}ms, 400=${dur400.toFixed(2)}ms, ratio=${ratio.toFixed(1)}x`);
  });

  it('execution scales sub-quadratically (50 vs 200 nodes)', () => {
    const chain50 = buildRawChain(50);
    const chain200 = buildRawChain(200);

    const dur50 = measure(() => { executeGraph(chain50.nodes, chain50.connections); });
    const dur200 = measure(() => { executeGraph(chain200.nodes, chain200.connections); });

    const ratio = dur200 / Math.max(dur50, 0.01);
    // Allow up to 12x for 4x size increase (sub-quadratic: 4^2=16 would be quadratic)
    expect(ratio).toBeLessThan(12);
    console.log(`[SCALING] exec: 50=${dur50.toFixed(2)}ms, 200=${dur200.toFixed(2)}ms, ratio=${ratio.toFixed(1)}x`);
  });

  it('executionMaxNodeDuration is O(1) selector (no N-dependent overhead)', () => {
    resetStore();
    // Build graph and execute
    for (let i = 0; i < 50; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }
    getState().executeGraph();

    // Reading executionMaxNodeDuration should be instant (O(1))
    const iterations = 10000;
    const duration = measure(() => {
      for (let i = 0; i < iterations; i++) {
        void getState().executionMaxNodeDuration;
      }
    });

    // 10,000 O(1) reads should complete in under 50ms
    expect(duration).toBeLessThan(50);
    console.log(`[SCALING] executionMaxNodeDuration 10K reads: ${duration.toFixed(2)}ms`);
  });
});

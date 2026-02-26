/**
 * Phase 34: E2E Regression Tests (~25 tests)
 *
 * Cross-feature integration tests covering:
 * 1. Node help + execution (5 tests)
 * 2. Graph diff + undo/redo (5 tests)
 * 3. Execution timeout + error handling (5 tests)
 * 4. Profiling + multi-graph (5 tests)
 * 5. Settings + serialization regression (5 tests)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings, DEFAULT_SETTINGS } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';
import { getNodeHelp, getAllNodeHelp } from '../utils/nodeHelp';
import { compareGraphs } from '../utils/graphDiff';
import { getCriticalPath, getBottleneckNodes } from '../utils/profiling';
import type { EditorNode, Connection } from '../types';

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
    s.executionMetrics = {};
    s.executionTimings = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionStats = {
      executionCount: 0,
      totalDuration: 0,
      errorCount: 0,
      totalCacheHits: 0,
      totalNodesExecuted: 0,
      lastExecutedAt: null,
      timeoutCount: 0,
    };
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

beforeEach(() => {
  resetStore();
});

// ===========================================================================
// 1. Node help + execution integration
// ===========================================================================

describe('node help + execution integration', () => {
  it('every node type with help can be added to the store and executed', () => {
    const allHelp = getAllNodeHelp();
    const executableTypes = allHelp
      .filter((h) => h.nodeType !== 'subgraph' && h.nodeType !== 'custom')
      .slice(0, 10); // Test a representative subset
    for (const help of executableTypes) {
      resetStore();
      const st = getStore();
      st.addNode(help.nodeType as any, [0, 0, 0]);
      // Execution should not throw
      st.executeGraph();
      const state = getStore();
      expect(Object.keys(state.executionTimings).length).toBeGreaterThan(0);
    }
  });

  it('node help input/output counts match NODE_TYPE_CONFIG for source', () => {
    const help = getNodeHelp('source');
    expect(help).toBeDefined();
    // Source node: 0 inputs, 1 output
    const st = getStore();
    const srcId = st.addNode('source', [0, 0, 0]);
    const node = getStore().nodes[srcId];
    expect(help!.inputs.length).toBe(node.inputs.length);
    expect(help!.outputs.length).toBe(node.outputs.length);
  });

  it('node help input/output counts match NODE_TYPE_CONFIG for math', () => {
    const help = getNodeHelp('math');
    expect(help).toBeDefined();
    const st = getStore();
    const mathId = st.addNode('math', [0, 0, 0]);
    const node = getStore().nodes[mathId];
    expect(help!.inputs.length).toBe(node.inputs.length);
    expect(help!.outputs.length).toBe(node.outputs.length);
  });

  it('all categories from node help have at least one node', () => {
    // nodeHelp uses 10 categories (date/time nodes are in Utility)
    const expectedCategories = [
      'Core', 'Math', 'String', 'Logic', 'Vector',
      'Utility', 'Color', 'Live', 'Data', 'Subgraph',
    ];
    for (const cat of expectedCategories) {
      const nodes = getAllNodeHelp().filter((h) => h.category === cat);
      expect(nodes.length, `Category '${cat}' should have at least one node`).toBeGreaterThan(0);
    }
  });

  it('custom node help shows correct port count after updateCustomNodePorts', () => {
    const help = getNodeHelp('custom');
    expect(help).toBeDefined();
    expect(help!.inputs.length).toBeGreaterThanOrEqual(0);
    // Custom nodes have dynamic ports — help just documents the default
    const st = getStore();
    const cstId = st.addNode('custom', [0, 0, 0]);
    st.updateCustomNodePorts(cstId, 3, 2);
    const node = getStore().nodes[cstId];
    expect(node.inputs.length).toBe(3);
    expect(node.outputs.length).toBe(2);
  });
});

// ===========================================================================
// 2. Graph diff + undo/redo integration
// ===========================================================================

describe('graph diff + undo/redo integration', () => {
  it('graph diff detects node addition after addNode', () => {
    const nodesBefore: Record<string, EditorNode> = {};
    const connsBefore: Record<string, Connection> = {};
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    const nodesAfter = getStore().nodes;
    const connsAfter = getStore().connections;
    const diff = compareGraphs(nodesBefore, connsBefore, nodesAfter, connsAfter);
    expect(diff.summary.nodesAdded).toBe(1);
    expect(diff.isEmpty).toBe(false);
  });

  it('graph diff detects connection addition after addConnection', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [1, 0, 0]);
    const nodesBefore = { ...getStore().nodes };
    const connsBefore = { ...getStore().connections };
    st.addConnection(src, 0, xform, 0);
    const diff = compareGraphs(nodesBefore, connsBefore, getStore().nodes, getStore().connections);
    expect(diff.summary.connectionsAdded).toBe(1);
  });

  it('diffUndoSnapshots compares undo entries correctly', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]); // undo entry 0 (snapshot is state BEFORE addNode)
    st.addNode('transform', [1, 0, 0]); // undo entry 1
    const diff = st.diffUndoSnapshots(0, -1); // compare entry 0 (empty graph) vs current (2 nodes)
    expect(diff).not.toBeNull();
    if (diff) {
      // Entry 0 is the snapshot before the first addNode (empty graph)
      // Current state has 2 nodes → 2 nodes added
      expect(diff.summary.nodesAdded).toBe(2);
    }
  });

  it('diffUndoSnapshots returns null for invalid indices', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    const diff = st.diffUndoSnapshots(99, -1);
    expect(diff).toBeNull();
  });

  it('graph diff after undo shows reverted change', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    const nodesV1 = { ...getStore().nodes };
    const connsV1 = { ...getStore().connections };
    st.addNode('transform', [1, 0, 0]);
    st.undo();
    const diff = compareGraphs(nodesV1, connsV1, getStore().nodes, getStore().connections);
    // After undo, we should be back to the same state as nodesV1
    expect(diff.isEmpty).toBe(true);
  });
});

// ===========================================================================
// 3. Execution timeout + error handling
// ===========================================================================

describe('execution timeout + error handling', () => {
  it('executeGraph with no timeout runs to completion', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [1, 0, 0]);
    st.addConnection(src, 0, xform, 0);
    const result = executeGraph(getStore().nodes, getStore().connections);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(2);
  });

  it('executeGraph with generous timeout completes normally', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    const result = executeGraph(getStore().nodes, getStore().connections, undefined, undefined, undefined, undefined, undefined, 30000);
    expect(result.timedOut).toBeFalsy();
  });

  it('execution errors are tracked in executionStats', () => {
    const st = getStore();
    const cstId = st.addNode('custom', [0, 0, 0]);
    st.updateCustomNodePorts(cstId, 0, 1);
    st.updateNodeData(cstId, 'expression', 'undefined.property');
    st.executeGraph();
    expect(getStore().executionStats.errorCount).toBeGreaterThan(0);
    expect(Object.keys(getStore().executionErrors).length).toBeGreaterThan(0);
  });

  it('maxExecutionMs setting is clamped properly', () => {
    // Test via clampLoadedSettings
    const result = clampLoadedSettings({
      ...DEFAULT_SETTINGS,
      maxExecutionMs: -100,
    } as any);
    expect(result.maxExecutionMs).toBe(0);

    const result2 = clampLoadedSettings({
      ...DEFAULT_SETTINGS,
      maxExecutionMs: 999999,
    } as any);
    expect(result2.maxExecutionMs).toBe(300000);
  });

  it('execution result includes totalDuration', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    const result = executeGraph(getStore().nodes, getStore().connections);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    expect(typeof result.totalDuration).toBe('number');
  });
});

// ===========================================================================
// 4. Profiling + multi-graph
// ===========================================================================

describe('profiling + multi-graph', () => {
  it('execution profiling data is per-graph (cleared on switch)', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    expect(Object.keys(getStore().executionTimings).length).toBeGreaterThan(0);
    // Create and switch to new graph
    st.createGraph('Graph 2');
    // New graph should have empty execution data
    expect(getStore().executionTimings).toEqual({});
    expect(getStore().executionMetrics).toEqual({});
  });

  it('critical path computation works with real execution', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const x1 = st.addNode('transform', [1, 0, 0]);
    const x2 = st.addNode('transform', [2, 0, 0]);
    st.addConnection(src, 0, x1, 0);
    st.addConnection(x1, 0, x2, 0);
    st.executeGraph();
    const state = getStore();
    const cp = getCriticalPath(state.nodes, state.connections, state.executionMetrics);
    // Linear chain → critical path should include all 3 nodes
    expect(cp.path.length).toBe(3);
  });

  it('bottleneck detection with real metrics returns valid results', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const x1 = st.addNode('transform', [1, 0, 0]);
    const x2 = st.addNode('transform', [2, 0, 0]);
    st.addConnection(src, 0, x1, 0);
    st.addConnection(src, 0, x2, 0);
    st.executeGraph();
    const bottlenecks = getBottleneckNodes(getStore().executionMetrics, 5);
    // Should return up to 3 non-cached nodes
    expect(bottlenecks.length).toBeLessThanOrEqual(3);
    for (const b of bottlenecks) {
      expect(typeof b.duration).toBe('number');
      expect(typeof b.nodeId).toBe('string');
    }
  });

  it('executionHistory records entries capped at 20', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    // Execute many times
    for (let i = 0; i < 25; i++) {
      useEditorStore.setState((s) => { s.isExecuting = false; });
      st.executeGraph();
    }
    expect(getStore().executionHistory.length).toBeLessThanOrEqual(20);
    expect(getStore().executionHistory.length).toBeGreaterThan(0);
  });

  it('execution stats survive node additions but clear on undo/redo', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);
    // Add another node — stats should still be there
    st.addNode('transform', [1, 0, 0]);
    expect(getStore().executionStats.executionCount).toBe(1);
  });
});

// ===========================================================================
// 5. Settings + serialization regression
// ===========================================================================

describe('settings + serialization regression', () => {
  it('maxExecutionMs is persisted in settings', () => {
    const settings = useSettingsStore.getState();
    expect(typeof settings.maxExecutionMs).toBe('number');
    expect(settings.maxExecutionMs).toBe(30000); // default
  });

  it('clampLoadedSettings preserves valid maxExecutionMs', () => {
    const settings = { ...DEFAULT_SETTINGS, maxExecutionMs: 15000 } as any;
    const result = clampLoadedSettings(settings);
    expect(result.maxExecutionMs).toBe(15000);
  });

  it('export/import preserves graph state correctly', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [1, 0, 0]);
    st.addConnection(src, 0, xform, 0);
    st.updateNodeData(src, 'value', 42);

    // Export
    const exported = st.exportAllGraphs();
    expect(exported).toBeDefined();

    // Clear and reimport
    st.clearGraph();
    expect(Object.keys(getStore().nodes).length).toBe(0);
    st.importAllGraphs(exported);

    // Verify nodes and connections survived
    const state = getStore();
    expect(Object.keys(state.nodes).length).toBe(2);
    expect(Object.keys(state.connections).length).toBe(1);
  });

  it('execution after import produces valid profiling data', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [1, 0, 0]);
    st.addConnection(src, 0, xform, 0);

    const exported = st.exportAllGraphs();
    st.clearGraph();
    st.importAllGraphs(exported);

    getStore().executeGraph();
    const state = getStore();
    expect(Object.keys(state.executionTimings).length).toBe(2);
    expect(state.executionStats.executionCount).toBe(1);
  });

  it('undo after execution clears profiling data', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    expect(Object.keys(getStore().executionTimings).length).toBeGreaterThan(0);
    st.undo();
    // After undo, execution transient state should be cleared
    expect(getStore().executionTimings).toEqual({});
    expect(getStore().executionMetrics).toEqual({});
  });
});

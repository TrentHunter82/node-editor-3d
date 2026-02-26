/**
 * Phase 36: E2E Regression Tests (~25 tests)
 *
 * Cross-feature integration tests covering:
 * 1. Worker watchdog timeout configuration (5 tests)
 * 2. Transform processor factor port fix (5 tests)
 * 3. Value formatter integration (5 tests)
 * 4. Snapshot comparison enhancements (5 tests)
 * 5. Reroute node processor (5 tests)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings, DEFAULT_SETTINGS } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';
import { compareGraphs } from '../utils/graphDiff';
import { formatCompact, formatArrayCompact, isHexColor, formatForTooltip } from '../utils/valueFormat';
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
    s.executionTimedOut = false;
    s.executionStats = {
      executionCount: 0, totalDuration: 0, errorCount: 0,
      totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null,
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
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.traceNodeId = null;
  });
}

// ===========================================================================
// 1. Worker watchdog timeout configuration
// ===========================================================================

describe('worker watchdog timeout configuration', () => {
  beforeEach(() => resetStore());

  it('DEFAULT_SETTINGS.maxExecutionMs is 30000', () => {
    expect(DEFAULT_SETTINGS.maxExecutionMs).toBe(30000);
  });

  it('clampLoadedSettings clamps negative maxExecutionMs to 0', () => {
    const result = clampLoadedSettings({ maxExecutionMs: -1000 } as Record<string, unknown>);
    expect(result.maxExecutionMs).toBe(0);
  });

  it('clampLoadedSettings clamps values above 300000 to 300000', () => {
    const result = clampLoadedSettings({ maxExecutionMs: 500000 } as Record<string, unknown>);
    expect(result.maxExecutionMs).toBe(300000);
  });

  it('setMaxExecutionMs persists clamped value in settings store', () => {
    const settings = useSettingsStore.getState();
    settings.setMaxExecutionMs(45000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(45000);

    // Update again to verify persistence
    settings.setMaxExecutionMs(10000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(10000);
  });

  it('setMaxExecutionMs rejects out-of-range values by clamping', () => {
    const settings = useSettingsStore.getState();

    // Negative clamped to 0
    settings.setMaxExecutionMs(-500);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(0);

    // Over max clamped to 300000
    settings.setMaxExecutionMs(999999);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(300000);

    // Boundary values preserved exactly
    settings.setMaxExecutionMs(0);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(0);
    settings.setMaxExecutionMs(300000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(300000);
  });
});

// ===========================================================================
// 2. Transform processor factor port fix
// ===========================================================================

describe('transform processor factor port fix', () => {
  beforeEach(() => resetStore());

  it('transform with connected factor input uses that value', () => {
    const st = getStore();
    // Create source (value=5) connected to transform input 0
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'value', 5);
    const xform = st.addNode('transform', [2, 0, 0]);
    st.addConnection(src, 0, xform, 0);

    // Create second source (value=3) connected to transform factor input (port 1)
    const factorSrc = st.addNode('source', [0, 0, 2]);
    st.updateNodeData(factorSrc, 'value', 3);
    st.addConnection(factorSrc, 0, xform, 1);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 5 * 3 + 0 = 15
    expect(xformResult!.outputs[0]).toBe(15);
  });

  it('transform with disconnected factor falls back to node.data.multiplier', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'value', 4);
    const xform = st.addNode('transform', [2, 0, 0]);
    st.updateNodeData(xform, 'multiplier', 10);
    st.addConnection(src, 0, xform, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 4 * 10 + 0 = 40
    expect(xformResult!.outputs[0]).toBe(40);
  });

  it('transform with no multiplier data defaults factor to 1', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'value', 7);
    const xform = st.addNode('transform', [2, 0, 0]);
    // No multiplier set on xform data, no connection to factor port
    st.addConnection(src, 0, xform, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 7 * 1 + 0 = 7
    expect(xformResult!.outputs[0]).toBe(7);
  });

  it('transform factor + offset combination', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'value', 6);
    const xform = st.addNode('transform', [2, 0, 0]);
    st.updateNodeData(xform, 'multiplier', 2);
    st.updateNodeData(xform, 'offset', 10);
    st.addConnection(src, 0, xform, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 6 * 2 + 10 = 22
    expect(xformResult!.outputs[0]).toBe(22);
  });

  it('transform debug output format shows calculation string', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'value', 3);
    const xform = st.addNode('transform', [2, 0, 0]);
    st.updateNodeData(xform, 'multiplier', 5);
    st.updateNodeData(xform, 'offset', 2);
    st.addConnection(src, 0, xform, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // Debug output (port 1) should be: "3×5+2=17"
    const debug = xformResult!.outputs[1] as string;
    expect(debug).toContain('3');
    expect(debug).toContain('5');
    expect(debug).toContain('2');
    expect(debug).toContain('17');
    // The exact format is "inputValue×multiplier+offset=result"
    expect(debug).toBe('3×5+2=17');
  });
});

// ===========================================================================
// 3. Value formatter integration
// ===========================================================================

describe('value formatter integration', () => {
  beforeEach(() => resetStore());

  it('formatCompact formats execution result numbers correctly', () => {
    // Small numbers get 2 decimal places
    expect(formatCompact(42.567)).toBe('42.57');
    expect(formatCompact(0)).toBe('0.00');
    // Null/undefined produce em dash
    expect(formatCompact(null)).toBe('\u2014');
    expect(formatCompact(undefined)).toBe('\u2014');
    // Boolean values
    expect(formatCompact(true)).toBe('true');
    expect(formatCompact(false)).toBe('false');
  });

  it('formatArrayCompact formats array node outputs', () => {
    // Empty array
    expect(formatArrayCompact([])).toBe('[]');
    // Small arrays show items
    expect(formatArrayCompact([1, 2, 3])).toBe('[1.0, 2.0, 3.0]');
    // Larger arrays show item count
    expect(formatArrayCompact([1, 2, 3, 4])).toBe('[4 items]');
    expect(formatArrayCompact([10, 20, 30, 40, 50])).toBe('[5 items]');
  });

  it('isHexColor correctly identifies hex color strings', () => {
    // Valid hex colors
    expect(isHexColor('#fff')).toBe(true);
    expect(isHexColor('#FF0000')).toBe(true);
    expect(isHexColor('#00ff00ff')).toBe(true);  // 8-char with alpha
    // Invalid hex colors
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#gg0000')).toBe(false);
    expect(isHexColor('FF0000')).toBe(false);  // Missing #
    expect(isHexColor('#12345')).toBe(false);  // Wrong length
  });

  it('formatCompact uses exponential notation for large numbers', () => {
    // Numbers >= 1000 use exponential
    expect(formatCompact(1000)).toBe('1.0e+3');
    expect(formatCompact(1234567)).toBe('1.2e+6');
    expect(formatCompact(-5000)).toBe('-5.0e+3');
    // NaN and Infinity
    expect(formatCompact(NaN)).toBe('NaN');
    expect(formatCompact(Infinity)).toBe('\u221E');      // Infinity symbol
    expect(formatCompact(-Infinity)).toBe('-\u221E');     // -Infinity symbol
  });

  it('formatForTooltip provides detailed display for various types', () => {
    // Numbers show full precision
    expect(formatForTooltip(3.14159)).toBe('3.14159');
    // Null/undefined
    expect(formatForTooltip(null)).toBe('null');
    expect(formatForTooltip(undefined)).toBe('null');
    // Boolean
    expect(formatForTooltip(true)).toBe('true');
    // Short string returned as-is
    expect(formatForTooltip('hello')).toBe('hello');
    // Small arrays are JSON stringified
    expect(formatForTooltip([1, 2, 3])).toBe('[1,2,3]');
    // Large arrays show count
    expect(formatForTooltip([1, 2, 3, 4, 5, 6])).toBe('Array(6)');
  });
});

// ===========================================================================
// 4. Snapshot comparison enhancements
// ===========================================================================

describe('snapshot comparison enhancements', () => {
  beforeEach(() => resetStore());

  it('compareGraphs detects node additions', () => {
    const st = getStore();
    const emptyNodes: Record<string, EditorNode> = {};
    const emptyConns: Record<string, Connection> = {};

    const nodeId = st.addNode('source', [0, 0, 0]);
    const nodesAfter = getStore().nodes;
    const connsAfter = getStore().connections;

    const diff = compareGraphs(emptyNodes, emptyConns, nodesAfter, connsAfter);
    expect(diff.isEmpty).toBe(false);
    expect(diff.summary.nodesAdded).toBe(1);
    expect(diff.summary.nodesRemoved).toBe(0);
    expect(diff.summary.nodesModified).toBe(0);
    const added = diff.nodeChanges.find((c) => c.type === 'added' && c.nodeId === nodeId);
    expect(added).toBeDefined();
  });

  it('compareGraphs detects node removals', () => {
    const st = getStore();
    const nodeId = st.addNode('source', [0, 0, 0]);
    const nodesBefore: Record<string, EditorNode> = JSON.parse(JSON.stringify(getStore().nodes));
    const connsBefore: Record<string, Connection> = JSON.parse(JSON.stringify(getStore().connections));

    st.removeNode(nodeId);
    const nodesAfter = getStore().nodes;
    const connsAfter = getStore().connections;

    const diff = compareGraphs(nodesBefore, connsBefore, nodesAfter, connsAfter);
    expect(diff.isEmpty).toBe(false);
    expect(diff.summary.nodesRemoved).toBe(1);
    expect(diff.summary.nodesAdded).toBe(0);
    const removed = diff.nodeChanges.find((c) => c.type === 'removed' && c.nodeId === nodeId);
    expect(removed).toBeDefined();
  });

  it('compareGraphs detects node modifications (data, position, title)', () => {
    const st = getStore();
    const nodeId = st.addNode('source', [0, 0, 0]);
    const nodesBefore: Record<string, EditorNode> = JSON.parse(JSON.stringify(getStore().nodes));
    const connsBefore: Record<string, Connection> = JSON.parse(JSON.stringify(getStore().connections));

    // Modify data, position, and title
    st.updateNodeData(nodeId, 'value', 42);
    st.updateNodePosition(nodeId, [5, 0, 5]);
    st.updateNodeTitle(nodeId, 'Renamed Source');

    const nodesAfter = getStore().nodes;
    const connsAfter = getStore().connections;

    const diff = compareGraphs(nodesBefore, connsBefore, nodesAfter, connsAfter);
    expect(diff.isEmpty).toBe(false);
    expect(diff.summary.nodesModified).toBe(1);
    const modified = diff.nodeChanges.find((c) => c.type === 'modified' && c.nodeId === nodeId);
    expect(modified).toBeDefined();
    expect(modified!.changedFields).toContain('data');
    expect(modified!.changedFields).toContain('position');
    expect(modified!.changedFields).toContain('title');
  });

  it('compareGraphs detects connection additions and removals', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [2, 0, 0]);
    const nodesBefore: Record<string, EditorNode> = JSON.parse(JSON.stringify(getStore().nodes));
    const connsBefore: Record<string, Connection> = JSON.parse(JSON.stringify(getStore().connections));

    // Add a connection
    const connId = st.addConnection(src, 0, xform, 0);
    expect(connId).not.toBeNull();

    const nodesAfterAdd = getStore().nodes;
    const connsAfterAdd = getStore().connections;

    // Detect addition
    const diffAdd = compareGraphs(nodesBefore, connsBefore, nodesAfterAdd, connsAfterAdd);
    expect(diffAdd.summary.connectionsAdded).toBe(1);
    expect(diffAdd.summary.connectionsRemoved).toBe(0);

    // Now test removal
    const connsBeforeRemove: Record<string, Connection> = JSON.parse(JSON.stringify(connsAfterAdd));
    st.removeConnection(connId!);
    const connsAfterRemove = getStore().connections;

    const diffRemove = compareGraphs(nodesAfterAdd, connsBeforeRemove, nodesAfterAdd, connsAfterRemove);
    expect(diffRemove.summary.connectionsRemoved).toBe(1);
    expect(diffRemove.summary.connectionsAdded).toBe(0);
  });

  it('compareGraphs returns isEmpty for identical graphs', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    st.addNode('transform', [2, 0, 0]);
    const nodes = getStore().nodes;
    const conns = getStore().connections;

    const diff = compareGraphs(nodes, conns, nodes, conns);
    expect(diff.isEmpty).toBe(true);
    expect(diff.nodeChanges.length).toBe(0);
    expect(diff.connectionChanges.length).toBe(0);
    expect(diff.summary.nodesAdded).toBe(0);
    expect(diff.summary.nodesRemoved).toBe(0);
    expect(diff.summary.nodesModified).toBe(0);
    expect(diff.summary.connectionsAdded).toBe(0);
    expect(diff.summary.connectionsRemoved).toBe(0);
    expect(diff.summary.connectionsModified).toBe(0);
  });
});

// ===========================================================================
// 5. Reroute node processor
// ===========================================================================

describe('reroute node processor', () => {
  beforeEach(() => resetStore());

  it('reroute passes through number', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'value', 42);
    const reroute = st.addNode('reroute', [1, 0, 0]);
    st.addConnection(src, 0, reroute, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const rerouteResult = result.results.get(reroute);
    expect(rerouteResult).toBeDefined();
    expect(rerouteResult!.outputs[0]).toBe(42);
  });

  it('reroute passes through string', () => {
    const st = getStore();
    // Use a source node and set its label output (port 1 is string 'label')
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'label', 'hello-world');
    const reroute = st.addNode('reroute', [1, 0, 0]);
    // Connect source label output (port 1) to reroute input (port 0)
    st.addConnection(src, 1, reroute, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const rerouteResult = result.results.get(reroute);
    expect(rerouteResult).toBeDefined();
    expect(rerouteResult!.outputs[0]).toBe('hello-world');
  });

  it('reroute passes through array', () => {
    const st = getStore();
    // Create a create-array node that outputs an array
    const arrNode = st.addNode('create-array', [0, 0, 0]);
    const reroute = st.addNode('reroute', [1, 0, 0]);
    st.addConnection(arrNode, 0, reroute, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const arrResult = result.results.get(arrNode);
    const rerouteResult = result.results.get(reroute);
    expect(arrResult).toBeDefined();
    expect(rerouteResult).toBeDefined();
    // Reroute output should be the same as array-create output
    expect(rerouteResult!.outputs[0]).toEqual(arrResult!.outputs[0]);
  });

  it('reroute in chain: source -> reroute -> transform', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'value', 8);
    const reroute = st.addNode('reroute', [1, 0, 0]);
    const xform = st.addNode('transform', [2, 0, 0]);
    st.updateNodeData(xform, 'multiplier', 3);

    // source(0) -> reroute(0), reroute(0) -> transform(0)
    st.addConnection(src, 0, reroute, 0);
    st.addConnection(reroute, 0, xform, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 8 * 3 + 0 = 24
    expect(xformResult!.outputs[0]).toBe(24);
  });

  it('reroute with undefined input returns undefined', () => {
    const st = getStore();
    // Reroute with no incoming connection — input is undefined
    const reroute = st.addNode('reroute', [0, 0, 0]);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const rerouteResult = result.results.get(reroute);
    expect(rerouteResult).toBeDefined();
    expect(rerouteResult!.outputs[0]).toBeUndefined();
  });
});

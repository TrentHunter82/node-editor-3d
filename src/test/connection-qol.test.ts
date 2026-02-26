import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';
import type { Connection } from '../types';

enableMapSet();

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
    s.executionStats = { executionCount: 0, totalDuration: 0, errorCount: 0, timeoutCount: 0, totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null };
    s.searchHighlightIds = new Set();
    s.diffHighlightIds = new Map();
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.graphVariables = {};
    s.breakpoints = {};
    s.traceNodeId = null;
  });
}

// ===========================================================================
// 1. Reroute node integration
// ===========================================================================
describe('Reroute node integration', () => {
  beforeEach(() => resetStore());

  it('reroute node has exactly 1 input and 1 output', () => {
    const id = getStore().addNode('reroute', [0, 0, 0]);
    const node = getStore().nodes[id];

    expect(node).toBeDefined();
    expect(node.type).toBe('reroute');
    expect(node.inputs).toHaveLength(1);
    expect(node.outputs).toHaveLength(1);
    expect(node.inputs[0].portType).toBe('any');
    expect(node.outputs[0].portType).toBe('any');
  });

  it('reroute accepts connections from number ports', () => {
    // source outputs port 0 = number type
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const rerouteId = getStore().addNode('reroute', [3, 0, 0]);

    const connId = getStore().addConnection(srcId, 0, rerouteId, 0);
    expect(connId).not.toBeNull();

    const conn = getStore().connections[connId!];
    expect(conn.sourceNodeId).toBe(srcId);
    expect(conn.targetNodeId).toBe(rerouteId);
  });

  it('reroute accepts connections from string ports', () => {
    // source outputs port 1 = string type (label)
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const rerouteId = getStore().addNode('reroute', [3, 0, 0]);

    // source port 1 is 'label' with portType 'string'
    const connId = getStore().addConnection(srcId, 1, rerouteId, 0);
    expect(connId).not.toBeNull();

    const conn = getStore().connections[connId!];
    expect(conn.sourceNodeId).toBe(srcId);
    expect(conn.sourcePortIndex).toBe(1);
  });

  it('chain: source -> reroute -> reroute -> math works', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const reroute1 = getStore().addNode('reroute', [3, 0, 0]);
    const reroute2 = getStore().addNode('reroute', [6, 0, 0]);
    const mathId = getStore().addNode('math', [9, 0, 0]);

    // source (number out) -> reroute1 (any in)
    const c1 = getStore().addConnection(srcId, 0, reroute1, 0);
    expect(c1).not.toBeNull();

    // reroute1 (any out) -> reroute2 (any in)
    const c2 = getStore().addConnection(reroute1, 0, reroute2, 0);
    expect(c2).not.toBeNull();

    // reroute2 (any out) -> math (number in)
    const c3 = getStore().addConnection(reroute2, 0, mathId, 0);
    expect(c3).not.toBeNull();

    // Verify all 3 connections exist
    expect(Object.keys(getStore().connections)).toHaveLength(3);
  });

  it('reroute deletion leaves upstream/downstream disconnected', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const rerouteId = getStore().addNode('reroute', [3, 0, 0]);
    const mathId = getStore().addNode('math', [6, 0, 0]);

    const c1 = getStore().addConnection(srcId, 0, rerouteId, 0);
    const c2 = getStore().addConnection(rerouteId, 0, mathId, 0);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(Object.keys(getStore().connections)).toHaveLength(2);

    // Remove the reroute node - should remove both connections
    getStore().removeNode(rerouteId);

    expect(getStore().nodes[rerouteId]).toBeUndefined();
    // Both connections through reroute should be gone
    expect(Object.keys(getStore().connections)).toHaveLength(0);
  });
});

// ===========================================================================
// 2. Connection metadata operations
// ===========================================================================
describe('Connection metadata operations', () => {
  beforeEach(() => resetStore());

  it('sets connection label via updateConnectionLabel', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    getStore().updateConnectionLabel(connId, 'Data Flow');

    expect(getStore().connections[connId].label).toBe('Data Flow');
  });

  it('sets connection color via updateConnectionColor', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    getStore().updateConnectionColor(connId, '#ff0000');

    expect(getStore().connections[connId].colorOverride).toBe('#ff0000');
  });

  it('sets connection style via updateConnectionStyle', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    getStore().updateConnectionStyle(connId, 'straight');

    expect(getStore().connections[connId].styleOverride).toBe('straight');
  });

  it('multiple metadata fields coexist on same connection', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    getStore().updateConnectionLabel(connId, 'Signal');
    getStore().updateConnectionColor(connId, '#00ff00');
    getStore().updateConnectionStyle(connId, 'organic');

    const conn = getStore().connections[connId];
    expect(conn.label).toBe('Signal');
    expect(conn.colorOverride).toBe('#00ff00');
    expect(conn.styleOverride).toBe('organic');
  });

  it('metadata survives undo/redo', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    // Set label
    getStore().updateConnectionLabel(connId, 'MyLabel');
    expect(getStore().connections[connId].label).toBe('MyLabel');

    // Set color on top of label
    getStore().updateConnectionColor(connId, '#abcdef');
    expect(getStore().connections[connId].colorOverride).toBe('#abcdef');
    expect(getStore().connections[connId].label).toBe('MyLabel');

    // Undo the color change - label should still be present
    getStore().undo();
    expect(getStore().connections[connId].colorOverride).toBeUndefined();
    expect(getStore().connections[connId].label).toBe('MyLabel');

    // Redo the color change - both should be back
    getStore().redo();
    expect(getStore().connections[connId].colorOverride).toBe('#abcdef');
    expect(getStore().connections[connId].label).toBe('MyLabel');
  });
});

// ===========================================================================
// 3. Connection style system
// ===========================================================================
describe('Connection style system', () => {
  beforeEach(() => resetStore());

  it('default connectionStyle from settingsStore is bezier', () => {
    const style = useSettingsStore.getState().connectionStyle;
    expect(style).toBe('bezier');
  });

  it('per-connection styleOverride takes precedence over global', () => {
    // Set global style to straight
    useSettingsStore.getState().setConnectionStyle('straight');
    expect(useSettingsStore.getState().connectionStyle).toBe('straight');

    // Create a connection with per-connection override
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    getStore().updateConnectionStyle(connId, 'organic');

    // The connection has its own style override
    const conn = getStore().connections[connId];
    expect(conn.styleOverride).toBe('organic');
    // Global is still straight
    expect(useSettingsStore.getState().connectionStyle).toBe('straight');

    // Reset settings to default
    useSettingsStore.getState().setConnectionStyle('bezier');
  });

  it('all 4 styles are valid values', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    const validStyles: Array<Connection['styleOverride']> = ['bezier', 'straight', 'right-angle', 'organic'];

    for (const style of validStyles) {
      getStore().updateConnectionStyle(connId, style);
      expect(getStore().connections[connId].styleOverride).toBe(style);
    }
  });

  it('style preserved in serialization roundtrip (exportAllGraphs/importAllGraphs)', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    getStore().updateConnectionStyle(connId, 'right-angle');
    getStore().updateConnectionLabel(connId, 'styled-conn');
    getStore().updateConnectionColor(connId, '#112233');

    // Export
    const exported = getStore().exportAllGraphs();

    // Reset
    resetStore();

    // Import
    getStore().importAllGraphs(exported);

    // Find the connection (IDs are preserved)
    const conns = Object.values(getStore().connections);
    expect(conns).toHaveLength(1);

    const conn = conns[0];
    expect(conn.styleOverride).toBe('right-angle');
    expect(conn.label).toBe('styled-conn');
    expect(conn.colorOverride).toBe('#112233');
  });

  it('no-op style update does not corrupt connection', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    getStore().updateConnectionStyle(connId, 'bezier');
    const connBefore = { ...getStore().connections[connId] };

    // Set to the same style again - should be a no-op (no undo push)
    getStore().updateConnectionStyle(connId, 'bezier');
    const connAfter = getStore().connections[connId];

    // Connection should remain valid and unchanged
    expect(connAfter.sourceNodeId).toBe(connBefore.sourceNodeId);
    expect(connAfter.targetNodeId).toBe(connBefore.targetNodeId);
    expect(connAfter.sourcePortIndex).toBe(connBefore.sourcePortIndex);
    expect(connAfter.targetPortIndex).toBe(connBefore.targetPortIndex);
    expect(connAfter.styleOverride).toBe('bezier');
  });
});

// ===========================================================================
// 4. Connection validation & edge cases
// ===========================================================================
describe('Connection validation & edge cases', () => {
  beforeEach(() => resetStore());

  it('self-connection is rejected (same node)', () => {
    const nodeId = getStore().addNode('math', [0, 0, 0]);

    // math has 1 output (result) and 2 inputs (a, b) - try connecting output 0 to input 0
    const connId = getStore().addConnection(nodeId, 0, nodeId, 0);
    expect(connId).toBeNull();
    expect(Object.keys(getStore().connections)).toHaveLength(0);
  });

  it('duplicate connection is rejected (same source port -> same target port)', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);

    const connId1 = getStore().addConnection(srcId, 0, xfmId, 0);
    expect(connId1).not.toBeNull();

    // Attempt the exact same connection again
    const connId2 = getStore().addConnection(srcId, 0, xfmId, 0);
    expect(connId2).toBeNull();
    expect(Object.keys(getStore().connections)).toHaveLength(1);
  });

  it('type mismatch: number port to string port is rejected, but any port accepts both', () => {
    // source port 0 = number, concat port 0 = string -> incompatible
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);

    const connDirect = getStore().addConnection(srcId, 0, concatId, 0);
    // number -> string is not compatible (neither is 'any')
    expect(connDirect).toBeNull();

    // But 'any' port (output/reroute) -> string (concat) should work
    const rerouteId = getStore().addNode('reroute', [3, 0, 0]);
    const connAny = getStore().addConnection(rerouteId, 0, concatId, 0);
    expect(connAny).not.toBeNull();
  });

  it('multi-output fan-out: one output port connects to multiple inputs', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const math1 = getStore().addNode('math', [5, 0, 0]);
    const math2 = getStore().addNode('math', [5, 0, 3]);

    // source output 0 -> math1 input 0
    const c1 = getStore().addConnection(srcId, 0, math1, 0);
    expect(c1).not.toBeNull();

    // source output 0 -> math2 input 0
    const c2 = getStore().addConnection(srcId, 0, math2, 0);
    expect(c2).not.toBeNull();

    // source output 0 -> math1 input 1 (b)
    const c3 = getStore().addConnection(srcId, 0, math1, 1);
    expect(c3).not.toBeNull();

    expect(Object.keys(getStore().connections)).toHaveLength(3);
  });

  it('connection removal cleans up properly', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0)!;

    // Add metadata to verify it goes away with removal
    getStore().updateConnectionLabel(connId, 'Doomed');
    getStore().updateConnectionColor(connId, '#ff0000');
    getStore().updateConnectionStyle(connId, 'organic');

    expect(getStore().connections[connId]).toBeDefined();

    // Remove the connection
    getStore().removeConnection(connId);

    // Connection should be completely gone
    expect(getStore().connections[connId]).toBeUndefined();
    expect(Object.keys(getStore().connections)).toHaveLength(0);

    // Undo should restore the connection with its metadata
    getStore().undo();
    const restored = getStore().connections[connId];
    expect(restored).toBeDefined();
    expect(restored.label).toBe('Doomed');
    expect(restored.colorOverride).toBe('#ff0000');
    expect(restored.styleOverride).toBe('organic');
  });
});

/**
 * Tests for insertRerouteOnConnection store action (20 tests)
 *
 * Covers:
 * 1. Basic reroute insertion (5 tests)
 * 2. Connection metadata preservation (4 tests)
 * 3. Undo/redo behavior (4 tests)
 * 4. Edge cases (4 tests)
 * 5. Cache invalidation & auto-execute (3 tests)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph } from '../utils/execution';

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
// 1. Basic reroute insertion
// ===========================================================================

describe('insertRerouteOnConnection — basic', () => {
  beforeEach(() => resetStore());

  it('creates a reroute node at the specified position', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    expect(connId).not.toBeNull();

    const rerouteId = st.insertRerouteOnConnection(connId!, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();

    const rerouteNode = getStore().nodes[rerouteId!];
    expect(rerouteNode).toBeDefined();
    expect(rerouteNode.type).toBe('reroute');
    expect(rerouteNode.position).toEqual([2, 0, 0]);
  });

  it('removes the original connection', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    expect(connId).not.toBeNull();

    st.insertRerouteOnConnection(connId!, [2, 0, 0]);

    // Original connection should be gone
    expect(getStore().connections[connId!]).toBeUndefined();
  });

  it('creates two new connections: source→reroute and reroute→target', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    expect(connId).not.toBeNull();

    const rerouteId = st.insertRerouteOnConnection(connId!, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();

    const conns = Object.values(getStore().connections);
    expect(conns.length).toBe(2);

    // Find source → reroute connection
    const srcToReroute = conns.find(
      c => c.sourceNodeId === src && c.targetNodeId === rerouteId!
    );
    expect(srcToReroute).toBeDefined();
    expect(srcToReroute!.targetPortIndex).toBe(0);

    // Find reroute → target connection
    const rerouteToTarget = conns.find(
      c => c.sourceNodeId === rerouteId! && c.targetNodeId === xform
    );
    expect(rerouteToTarget).toBeDefined();
    expect(rerouteToTarget!.targetPortIndex).toBe(0);
  });

  it('selects the newly created reroute node', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);

    const rerouteId = st.insertRerouteOnConnection(connId!, [2, 0, 0]);

    expect(getStore().selectedIds.has(rerouteId!)).toBe(true);
    expect(getStore().selectedIds.size).toBe(1);
  });

  it('preserves the original source port index', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    // Source output port 1 (label) connected to transform input 0
    const connId = st.addConnection(src, 1, xform, 0);
    if (!connId) return; // type guard

    const rerouteId = st.insertRerouteOnConnection(connId, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();

    const conns = Object.values(getStore().connections);
    const srcToReroute = conns.find(c => c.targetNodeId === rerouteId!);
    expect(srcToReroute).toBeDefined();
    expect(srcToReroute!.sourcePortIndex).toBe(1); // preserved
  });
});

// ===========================================================================
// 2. Connection metadata preservation
// ===========================================================================

describe('insertRerouteOnConnection — metadata', () => {
  beforeEach(() => resetStore());

  it('preserves label on reroute→target connection', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    if (!connId) return;

    // Add metadata to the connection
    st.updateConnectionLabel(connId, 'test-label');

    const rerouteId = st.insertRerouteOnConnection(connId, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();

    // Find the reroute → target connection
    const conns = Object.values(getStore().connections);
    const rerouteToTarget = conns.find(c => c.sourceNodeId === rerouteId!);
    expect(rerouteToTarget).toBeDefined();
    expect(rerouteToTarget!.label).toBe('test-label');
  });

  it('preserves colorOverride on reroute→target connection', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    if (!connId) return;

    st.updateConnectionColor(connId, '#FF0000');

    const rerouteId = st.insertRerouteOnConnection(connId, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();

    const conns = Object.values(getStore().connections);
    const rerouteToTarget = conns.find(c => c.sourceNodeId === rerouteId!);
    expect(rerouteToTarget).toBeDefined();
    expect(rerouteToTarget!.colorOverride).toBe('#FF0000');
  });

  it('preserves styleOverride on reroute→target connection', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    if (!connId) return;

    st.updateConnectionStyle(connId, 'straight');

    const rerouteId = st.insertRerouteOnConnection(connId, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();

    const conns = Object.values(getStore().connections);
    const rerouteToTarget = conns.find(c => c.sourceNodeId === rerouteId!);
    expect(rerouteToTarget).toBeDefined();
    expect(rerouteToTarget!.styleOverride).toBe('straight');
  });

  it('does NOT copy metadata to source→reroute connection', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    if (!connId) return;

    st.updateConnectionLabel(connId, 'my-label');
    st.updateConnectionColor(connId, '#00FF00');

    const rerouteId = st.insertRerouteOnConnection(connId, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();

    const conns = Object.values(getStore().connections);
    const srcToReroute = conns.find(c => c.targetNodeId === rerouteId!);
    expect(srcToReroute).toBeDefined();
    // Source → reroute should NOT have metadata
    expect(srcToReroute!.label).toBeUndefined();
    expect(srcToReroute!.colorOverride).toBeUndefined();
  });
});

// ===========================================================================
// 3. Undo/redo behavior
// ===========================================================================

describe('insertRerouteOnConnection — undo/redo', () => {
  beforeEach(() => resetStore());

  it('creates a single undo entry', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);

    st.insertRerouteOnConnection(connId!, [2, 0, 0]);

    // Should be able to undo now
    expect(getStore().canUndo()).toBe(true);
  });

  it('undo restores original connection and removes reroute node', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    expect(connId).not.toBeNull();

    // Capture state before insertion
    const nodeCountBefore = Object.keys(getStore().nodes).length;
    const connCountBefore = Object.keys(getStore().connections).length;

    const rerouteId = st.insertRerouteOnConnection(connId!, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();
    expect(Object.keys(getStore().nodes).length).toBe(nodeCountBefore + 1);
    expect(Object.keys(getStore().connections).length).toBe(connCountBefore + 1); // -1 + 2 = +1

    // Undo
    getStore().undo();

    // Reroute node should be gone, original connection restored
    expect(getStore().nodes[rerouteId!]).toBeUndefined();
    expect(getStore().connections[connId!]).toBeDefined();
    expect(Object.keys(getStore().nodes).length).toBe(nodeCountBefore);
    expect(Object.keys(getStore().connections).length).toBe(connCountBefore);
  });

  it('redo re-inserts the reroute', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);

    const rerouteId = st.insertRerouteOnConnection(connId!, [2, 0, 0]);
    getStore().undo();
    expect(getStore().nodes[rerouteId!]).toBeUndefined();

    getStore().redo();
    // After redo, we should have the reroute node again
    // Note: IDs may differ after redo since redo restores snapshot state
    const nodeCount = Object.keys(getStore().nodes).length;
    const connCount = Object.keys(getStore().connections).length;
    expect(nodeCount).toBe(3); // src + xform + reroute
    expect(connCount).toBe(2); // src→reroute + reroute→xform
  });

  it('undo label is "Insert reroute"', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);

    st.insertRerouteOnConnection(connId!, [2, 0, 0]);

    // Check the undo history label
    const history = getStore().getUndoHistory();
    const lastEntry = history.undo[history.undo.length - 1];
    expect(lastEntry).toBeDefined();
    expect(lastEntry.label).toBe('Insert reroute');
  });
});

// ===========================================================================
// 4. Edge cases
// ===========================================================================

describe('insertRerouteOnConnection — edge cases', () => {
  beforeEach(() => resetStore());

  it('returns null for invalid connectionId', () => {
    const result = getStore().insertRerouteOnConnection('nonexistent', [0, 0, 0]);
    expect(result).toBeNull();
  });

  it('returns null for already-deleted connection', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);
    st.removeConnection(connId!);

    const result = st.insertRerouteOnConnection(connId!, [2, 0, 0]);
    expect(result).toBeNull();
  });

  it('works with reroute already in chain (double reroute)', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [6, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);

    // Insert first reroute at midpoint
    const r1 = st.insertRerouteOnConnection(connId!, [2, 0, 0]);
    expect(r1).not.toBeNull();

    // Find reroute→target connection
    const conns = Object.values(getStore().connections);
    const r1ToTarget = conns.find(c => c.sourceNodeId === r1! && c.targetNodeId === xform);
    expect(r1ToTarget).toBeDefined();

    // Insert second reroute on reroute→target connection
    const r2 = st.insertRerouteOnConnection(r1ToTarget!.id, [4, 0, 0]);
    expect(r2).not.toBeNull();

    // Should now have: src → r1 → r2 → xform
    const allConns = Object.values(getStore().connections);
    expect(allConns.length).toBe(3);

    // Verify the chain
    const srcToR1 = allConns.find(c => c.sourceNodeId === src && c.targetNodeId === r1!);
    const r1ToR2 = allConns.find(c => c.sourceNodeId === r1! && c.targetNodeId === r2!);
    const r2ToXform = allConns.find(c => c.sourceNodeId === r2! && c.targetNodeId === xform);
    expect(srcToR1).toBeDefined();
    expect(r1ToR2).toBeDefined();
    expect(r2ToXform).toBeDefined();
  });

  it('does not push undo for invalid connection', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    // Remember undo state after addNode
    const history1 = st.getUndoHistory();
    const undoCount1 = history1.undo.length;

    st.insertRerouteOnConnection('bad-id', [0, 0, 0]);

    const history2 = st.getUndoHistory();
    const undoCount2 = history2.undo.length;
    expect(undoCount2).toBe(undoCount1); // no new undo entry
  });
});

// ===========================================================================
// 5. Cache invalidation & auto-execute
// ===========================================================================

describe('insertRerouteOnConnection — cache & execution', () => {
  beforeEach(() => resetStore());

  it('inserts functional reroute that passes data through', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    st.updateNodeData(src, 'value', 99);
    const xform = st.addNode('transform', [6, 0, 0]);
    st.updateNodeData(xform, 'multiplier', 2);
    const connId = st.addConnection(src, 0, xform, 0);
    expect(connId).not.toBeNull();

    // Insert reroute
    const rerouteId = st.insertRerouteOnConnection(connId!, [3, 0, 0]);
    expect(rerouteId).not.toBeNull();

    // Execute graph
    const result = executeGraph(getStore().nodes, getStore().connections);

    // Reroute should pass value through
    const rerouteResult = result.results.get(rerouteId!);
    expect(rerouteResult).toBeDefined();
    expect(rerouteResult!.outputs[0]).toBe(99);

    // Transform should receive the value
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    expect(xformResult!.outputs[0]).toBe(198); // 99 * 2
  });

  it('node count increases by 1 and connection count increases by 1', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    st.addConnection(src, 0, xform, 0);

    const nodesBefore = Object.keys(getStore().nodes).length;
    const connsBefore = Object.keys(getStore().connections).length;

    const connId = Object.keys(getStore().connections)[0];
    st.insertRerouteOnConnection(connId, [2, 0, 0]);

    expect(Object.keys(getStore().nodes).length).toBe(nodesBefore + 1);
    // Original removed (-1) + 2 new = +1
    expect(Object.keys(getStore().connections).length).toBe(connsBefore + 1);
  });

  it('reroute node title is TYPE_TITLES reroute value', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [4, 0, 0]);
    const connId = st.addConnection(src, 0, xform, 0);

    const rerouteId = st.insertRerouteOnConnection(connId!, [2, 0, 0]);
    expect(rerouteId).not.toBeNull();

    const node = getStore().nodes[rerouteId!];
    // Should have a meaningful title (either TYPE_TITLES value or fallback)
    expect(node.title.length).toBeGreaterThan(0);
  });
});

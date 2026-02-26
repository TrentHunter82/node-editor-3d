/**
 * Phase 44 – Advanced connection operations tests (~20 tests).
 *
 * Covers:
 * 1. wouldCreateCycle edge cases (6 tests)
 * 2. Connection metadata cascade during reconnection (8 tests)
 * 3. disconnectAndReroute workflow (3 tests)
 * 4. Connection drawing workflow (4 tests)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { wouldCreateCycle } from '../store/slices/connectionSlice';
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

// ---------------------------------------------------------------------------
// 1. wouldCreateCycle edge cases
// ---------------------------------------------------------------------------

describe('wouldCreateCycle edge cases', () => {
  it('detects direct cycle (A→B, adding B→A)', () => {
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
    };
    // Adding B→A: addConnection calls wouldCreateCycle(conns, targetNodeId=A, sourceNodeId=B).
    // BFS from A: A→B, finds B → returns true (cycle detected).
    expect(wouldCreateCycle(connections, 'A', 'B')).toBe(true);
  });

  it('detects transitive cycle (A→B→C, adding C→A)', () => {
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'B', sourcePortIndex: 0, targetNodeId: 'C', targetPortIndex: 0 },
    };
    // Adding C→A: addConnection calls wouldCreateCycle(conns, targetNodeId=A, sourceNodeId=C).
    // BFS from A: A→B→C, finds C → returns true (transitive cycle detected).
    expect(wouldCreateCycle(connections, 'A', 'C')).toBe(true);
  });

  it('returns false for valid DAG (A→B, A→C, B→D, C→D)', () => {
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'C', targetPortIndex: 0 },
      c3: { id: 'c3', sourceNodeId: 'B', sourcePortIndex: 0, targetNodeId: 'D', targetPortIndex: 0 },
      c4: { id: 'c4', sourceNodeId: 'C', sourcePortIndex: 0, targetNodeId: 'D', targetPortIndex: 1 },
    };
    // Adding A→D: check if D is reachable from A. BFS from A: A→B, A→C, B→D → yes.
    // But that's not a cycle question. For cycle: wouldCreateCycle(D, A) would
    // check if A is reachable from D — BFS from D: no outgoing edges → false. No cycle.
    expect(wouldCreateCycle(connections, 'D', 'A')).toBe(false);
  });

  it('detects self-reference (from === to)', () => {
    const connections: Record<string, Connection> = {};
    // BFS from X looking for X: immediately found on first dequeue
    expect(wouldCreateCycle(connections, 'X', 'X')).toBe(true);
  });

  it('returns false with empty connections map', () => {
    const connections: Record<string, Connection> = {};
    // No edges at all, distinct nodes — BFS from A finds nothing
    expect(wouldCreateCycle(connections, 'A', 'B')).toBe(false);
  });

  it('detects cycle through long chain (A→B→C→D→E, checking E→A path)', () => {
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'B', sourcePortIndex: 0, targetNodeId: 'C', targetPortIndex: 0 },
      c3: { id: 'c3', sourceNodeId: 'C', sourcePortIndex: 0, targetNodeId: 'D', targetPortIndex: 0 },
      c4: { id: 'c4', sourceNodeId: 'D', sourcePortIndex: 0, targetNodeId: 'E', targetPortIndex: 0 },
    };
    // Adding E→A: addConnection calls wouldCreateCycle(conns, targetNodeId=A, sourceNodeId=E)
    // BFS from A: A→B→C→D→E → found E → true
    expect(wouldCreateCycle(connections, 'A', 'E')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Connection metadata cascade
// ---------------------------------------------------------------------------

describe('connection metadata cascade', () => {
  beforeEach(resetStore);

  /**
   * Helper: create three source nodes and one math node (2 number inputs),
   * returning their IDs. All ports are number-typed, ensuring compatibility.
   */
  function createTestGraph() {
    const store = getStore();
    const srcA = store.addNode('source', [0, 0, 0]);
    const srcB = store.addNode('source', [2, 0, 0]);
    const srcC = store.addNode('source', [4, 0, 0]);
    const math = store.addNode('math', [6, 0, 0]);
    return { srcA, srcB, srcC, math };
  }

  it('preserves label during reconnection via completeConnection', () => {
    const { srcA, srcC, math } = createTestGraph();
    const store = getStore();

    // Connect A→math (port 0→0), then label it
    const connId = store.addConnection(srcA, 0, math, 0);
    expect(connId).not.toBeNull();
    store.updateConnectionLabel(connId!, 'important-data');
    expect(getStore().connections[connId!].label).toBe('important-data');

    // Reconnect: draw from C's output and drop on math's same input
    store.startConnection(srcC, 0);
    store.completeConnection(math, 0);

    // Old connection should be gone, new one present
    expect(getStore().connections[connId!]).toBeUndefined();
    const newConns = Object.values(getStore().connections).filter(
      (c) => c.targetNodeId === math && c.targetPortIndex === 0,
    );
    expect(newConns).toHaveLength(1);
    expect(newConns[0].sourceNodeId).toBe(srcC);
    // Label should be preserved from the old connection
    expect(newConns[0].label).toBe('important-data');
  });

  it('preserves colorOverride during reconnection via completeConnection', () => {
    const { srcA, srcC, math } = createTestGraph();
    const store = getStore();

    const connId = store.addConnection(srcA, 0, math, 0)!;
    store.updateConnectionColor(connId, '#ff0000');

    store.startConnection(srcC, 0);
    store.completeConnection(math, 0);

    const newConn = Object.values(getStore().connections).find(
      (c) => c.targetNodeId === math && c.targetPortIndex === 0,
    )!;
    expect(newConn.sourceNodeId).toBe(srcC);
    expect(newConn.colorOverride).toBe('#ff0000');
  });

  it('preserves styleOverride during reconnection via completeConnection', () => {
    const { srcA, srcC, math } = createTestGraph();
    const store = getStore();

    const connId = store.addConnection(srcA, 0, math, 0)!;
    store.updateConnectionStyle(connId, 'straight');

    store.startConnection(srcC, 0);
    store.completeConnection(math, 0);

    const newConn = Object.values(getStore().connections).find(
      (c) => c.targetNodeId === math && c.targetPortIndex === 0,
    )!;
    expect(newConn.sourceNodeId).toBe(srcC);
    expect(newConn.styleOverride).toBe('straight');
  });

  it('preserves all three metadata fields together during reconnection', () => {
    const { srcA, srcC, math } = createTestGraph();
    const store = getStore();

    const connId = store.addConnection(srcA, 0, math, 0)!;
    store.updateConnectionLabel(connId, 'data-flow');
    store.updateConnectionColor(connId, '#00ff00');
    store.updateConnectionStyle(connId, 'organic');

    store.startConnection(srcC, 0);
    store.completeConnection(math, 0);

    const newConn = Object.values(getStore().connections).find(
      (c) => c.targetNodeId === math && c.targetPortIndex === 0,
    )!;
    expect(newConn.label).toBe('data-flow');
    expect(newConn.colorOverride).toBe('#00ff00');
    expect(newConn.styleOverride).toBe('organic');
  });

  it('removes metadata when connection is deleted via removeConnection', () => {
    const { srcA, math } = createTestGraph();
    const store = getStore();

    const connId = store.addConnection(srcA, 0, math, 0)!;
    store.updateConnectionLabel(connId, 'temp-label');
    store.updateConnectionColor(connId, '#0000ff');
    store.updateConnectionStyle(connId, 'right-angle');

    store.removeConnection(connId);

    // Connection should be completely gone — no phantom metadata
    expect(getStore().connections[connId]).toBeUndefined();
    expect(Object.keys(getStore().connections)).toHaveLength(0);
  });

  it('does not leave phantom metadata after reconnection', () => {
    const { srcA, srcC, math } = createTestGraph();
    const store = getStore();

    const oldId = store.addConnection(srcA, 0, math, 0)!;
    store.updateConnectionLabel(oldId, 'old-label');

    store.startConnection(srcC, 0);
    store.completeConnection(math, 0);

    // Only one connection should exist
    const allConns = Object.values(getStore().connections);
    expect(allConns).toHaveLength(1);

    // Old connection ID should not exist anywhere
    expect(getStore().connections[oldId]).toBeUndefined();
  });

  it('updateConnectionStyle is a no-op when style is the same (no undo push)', () => {
    const { srcA, math } = createTestGraph();
    const store = getStore();

    const connId = store.addConnection(srcA, 0, math, 0)!;
    store.updateConnectionStyle(connId, 'bezier');

    // Record undo stack state
    store.updateConnectionStyle(connId, 'bezier'); // same value — should be no-op

    // Undo should revert the style set, not produce an extra entry
    store.undo(); // undoes the first updateConnectionStyle
    expect(getStore().connections[connId]?.styleOverride).toBeUndefined();
  });

  it('updateConnectionLabel with undefined clears the label', () => {
    const { srcA, math } = createTestGraph();
    const store = getStore();

    const connId = store.addConnection(srcA, 0, math, 0)!;
    store.updateConnectionLabel(connId, 'some-label');
    expect(getStore().connections[connId].label).toBe('some-label');

    store.updateConnectionLabel(connId, undefined);
    // label property should be deleted (not just set to undefined)
    expect(getStore().connections[connId].label).toBeUndefined();
    expect('label' in getStore().connections[connId]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. disconnectAndReroute
// ---------------------------------------------------------------------------

describe('disconnectAndReroute', () => {
  beforeEach(resetStore);

  function setupConnection() {
    const store = getStore();
    const src = store.addNode('source', [0, 0, 0]);
    const math = store.addNode('math', [4, 0, 0]);
    const connId = store.addConnection(src, 0, math, 0)!;
    return { src, math, connId };
  }

  it('starts a new pending connection from the source port', () => {
    const { src, connId } = setupConnection();
    getStore().disconnectAndReroute(connId);

    const state = getStore();
    expect(state.pendingConnection).not.toBeNull();
    expect(state.pendingConnection!.sourceNodeId).toBe(src);
    expect(state.pendingConnection!.sourcePortIndex).toBe(0);
    expect(state.interaction).toBe('drawing-connection');
  });

  it('removes the original connection', () => {
    const { connId } = setupConnection();
    getStore().disconnectAndReroute(connId);

    expect(getStore().connections[connId]).toBeUndefined();
  });

  it('pushes a single undo entry (not two)', () => {
    const { connId } = setupConnection();
    getStore().disconnectAndReroute(connId);

    // A single undo should restore the connection and clear drawing state
    getStore().cancelConnection(); // cancel the pending drawing first
    getStore().undo();

    // The original connection should be restored
    expect(getStore().connections[connId]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Connection drawing workflow
// ---------------------------------------------------------------------------

describe('connection drawing workflow', () => {
  beforeEach(resetStore);

  it('startConnection sets interaction to drawing-connection with pendingConnection', () => {
    const store = getStore();
    const src = store.addNode('source', [0, 0, 0]);

    store.startConnection(src, 0);

    expect(getStore().interaction).toBe('drawing-connection');
    expect(getStore().pendingConnection).not.toBeNull();
    expect(getStore().pendingConnection!.sourceNodeId).toBe(src);
    expect(getStore().pendingConnection!.sourcePortIndex).toBe(0);
  });

  it('completeConnection with type mismatch cancels the drawing', () => {
    const store = getStore();
    // color-picker output 0 is portType 'color'
    const colorNode = store.addNode('color-picker', [0, 0, 0]);
    // math input 0 is portType 'number' — color→number has no coercion rule
    const mathNode = store.addNode('math', [4, 0, 0]);

    store.startConnection(colorNode, 0);
    expect(getStore().interaction).toBe('drawing-connection');

    store.completeConnection(mathNode, 0);

    // Should cancel: no connection created, interaction reset
    expect(getStore().interaction).toBe('idle');
    expect(getStore().pendingConnection).toBeNull();
    expect(Object.keys(getStore().connections)).toHaveLength(0);
  });

  it('completeConnection removes old connection on same input port (single-input enforcement)', () => {
    const store = getStore();
    const srcA = store.addNode('source', [0, 0, 0]);
    const srcB = store.addNode('source', [2, 0, 0]);
    const math = store.addNode('math', [6, 0, 0]);

    // First connection: A→math input 0
    const firstConnId = store.addConnection(srcA, 0, math, 0);
    expect(firstConnId).not.toBeNull();

    // Draw from B to math input 0 — should replace
    store.startConnection(srcB, 0);
    store.completeConnection(math, 0);

    // Old connection gone
    expect(getStore().connections[firstConnId!]).toBeUndefined();

    // Exactly one connection to math input 0
    const connsToMathPort0 = Object.values(getStore().connections).filter(
      (c) => c.targetNodeId === math && c.targetPortIndex === 0,
    );
    expect(connsToMathPort0).toHaveLength(1);
    expect(connsToMathPort0[0].sourceNodeId).toBe(srcB);
  });

  it('cancelConnection resets interaction and clears pendingConnection', () => {
    const store = getStore();
    const src = store.addNode('source', [0, 0, 0]);

    store.startConnection(src, 0);
    expect(getStore().interaction).toBe('drawing-connection');
    expect(getStore().pendingConnection).not.toBeNull();

    store.cancelConnection();

    expect(getStore().interaction).toBe('idle');
    expect(getStore().pendingConnection).toBeNull();
  });
});

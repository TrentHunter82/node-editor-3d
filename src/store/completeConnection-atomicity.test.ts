/**
 * Tests for completeConnection atomicity fix.
 *
 * Key invariant: when reconnecting an input port that already has a connection,
 * - If the NEW connection is VALID: old connection removed + new connection added
 *   in a SINGLE atomic set() call.
 * - If the NEW connection is INVALID (type mismatch, cycle, self-connection, duplicate):
 *   the OLD connection is PRESERVED (never deleted).
 *
 * Implementation lives in connectionSlice.ts — completeConnection validates
 * BEFORE mutating and uses a single set() call for the atomic mutation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.contextMenu = null;
    s.customNodeDefs = {};
    s.searchQuery = '';
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.templates = {};
    s.breadcrumbStack = [];
    s.subgraphDefs = {};
    s.errorStrategy = 'fail-fast';
    s.validationErrors = {};
    s.executionMetrics = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

function connectionCount(): number {
  return Object.keys(getState().connections).length;
}

function connectionValues() {
  return Object.values(getState().connections);
}

// ===========================================================================
// completeConnection atomicity
// ===========================================================================

describe('completeConnection — atomicity', () => {
  beforeEach(() => { resetStore(); });

  // -----------------------------------------------------------------------
  // 1. Valid reconnection: old connection replaced atomically
  // -----------------------------------------------------------------------
  describe('valid reconnection replaces old connection atomically', () => {
    it('removes old connection and adds new one in a single operation', () => {
      // Create source1 -> transform on input 0
      const src1 = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const oldConnId = getState().addConnection(src1, 0, xfm, 0);
      expect(oldConnId).not.toBeNull();
      expect(connectionCount()).toBe(1);

      // Create a second source node
      const src2 = getState().addNode('source', [0, 0, 5]);

      // Start drawing from src2 output 0 (number), complete on transform input 0
      getState().startConnection(src2, 0);
      expect(getState().interaction).toBe('drawing-connection');

      getState().completeConnection(xfm, 0);

      // Old connection gone, new connection exists, exactly 1 total
      expect(connectionCount()).toBe(1);
      const conns = connectionValues();
      expect(conns[0].sourceNodeId).toBe(src2);
      expect(conns[0].sourcePortIndex).toBe(0);
      expect(conns[0].targetNodeId).toBe(xfm);
      expect(conns[0].targetPortIndex).toBe(0);
      // The old connection ID should no longer exist
      expect(getState().connections[oldConnId!]).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Invalid reconnection (type mismatch): old connection preserved
  // -----------------------------------------------------------------------
  describe('invalid reconnection (type mismatch) preserves old connection', () => {
    it('keeps existing number connection when incompatible color source is attempted', () => {
      // Create source1 -> transform on input 0 (number -> number: valid)
      const src1 = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const origConnId = getState().addConnection(src1, 0, xfm, 0);
      expect(origConnId).not.toBeNull();
      expect(connectionCount()).toBe(1);

      // Create a color-mix node — its output 0 is color type (no coercion rule for color→number)
      const colorNode = getState().addNode('color-mix', [0, 0, 5]);

      // Start drawing from color-mix output 0 (color), try to complete on transform input 0 (number)
      getState().startConnection(colorNode, 0);
      expect(getState().interaction).toBe('drawing-connection');

      getState().completeConnection(xfm, 0);

      // Old connection must be preserved (no coercion available for color→number)
      expect(connectionCount()).toBe(1);
      expect(getState().connections[origConnId!]).toBeDefined();
      expect(getState().connections[origConnId!].sourceNodeId).toBe(src1);
    });

    it('preserves old connection when color source targets number input', () => {
      const src1 = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const origConnId = getState().addConnection(src1, 0, xfm, 0);
      expect(origConnId).not.toBeNull();

      // hsl-to-rgb output 0 is color type (no coercion rule for color→number)
      const hslNode = getState().addNode('hsl-to-rgb', [0, 0, 5]);

      getState().startConnection(hslNode, 0); // color output
      getState().completeConnection(xfm, 0); // number input

      // Original connection preserved (no coercion available for color→number)
      expect(connectionCount()).toBe(1);
      expect(getState().connections[origConnId!]).toBeDefined();
      expect(getState().connections[origConnId!].sourceNodeId).toBe(src1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Invalid reconnection (would create cycle): old connection preserved
  // -----------------------------------------------------------------------
  describe('invalid reconnection (cycle) preserves old connection', () => {
    it('preserves connections when reconnection would create a cycle', () => {
      // Build chain: A -> B -> C
      const nodeA = getState().addNode('source', [0, 0, 0]);
      const nodeB = getState().addNode('transform', [5, 0, 0]);
      const nodeC = getState().addNode('transform', [10, 0, 0]);

      const connAB = getState().addConnection(nodeA, 0, nodeB, 0);
      const connBC = getState().addConnection(nodeB, 0, nodeC, 0);
      expect(connAB).not.toBeNull();
      expect(connBC).not.toBeNull();
      expect(connectionCount()).toBe(2);

      // Try to connect C output -> B input 1 (would create cycle: C -> B -> C)
      getState().startConnection(nodeC, 0);
      getState().completeConnection(nodeB, 1);

      // All original connections preserved, no new connection added
      expect(connectionCount()).toBe(2);
      expect(getState().connections[connAB!]).toBeDefined();
      expect(getState().connections[connBC!]).toBeDefined();
    });

    it('preserves existing connection on input when cycle is detected through replacement', () => {
      // Build: A -> B (on input 0), B -> C
      // Existing connection on B input 0 is A->B
      // Try to reconnect B input 0 from C output (would create cycle B->C->B)
      const nodeA = getState().addNode('source', [0, 0, 0]);
      const nodeB = getState().addNode('transform', [5, 0, 0]);
      const nodeC = getState().addNode('transform', [10, 0, 0]);

      const connAB = getState().addConnection(nodeA, 0, nodeB, 0);
      const connBC = getState().addConnection(nodeB, 0, nodeC, 0);
      expect(connAB).not.toBeNull();
      expect(connBC).not.toBeNull();

      // Start from C output, try to complete on B input 0 (replacing A->B)
      // This would create cycle: C -> B -> C
      getState().startConnection(nodeC, 0);
      getState().completeConnection(nodeB, 0);

      // Original A->B connection must be preserved
      expect(connectionCount()).toBe(2);
      expect(getState().connections[connAB!]).toBeDefined();
      expect(getState().connections[connAB!].sourceNodeId).toBe(nodeA);
      expect(getState().connections[connAB!].targetNodeId).toBe(nodeB);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Self-connection rejected: old connection preserved
  // -----------------------------------------------------------------------
  describe('self-connection rejected, old connection preserved', () => {
    it('does not allow connecting a node to itself, keeps existing connection', () => {
      // Create source -> transform
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const origConnId = getState().addConnection(src, 0, xfm, 0);
      expect(origConnId).not.toBeNull();
      expect(connectionCount()).toBe(1);

      // Try self-connection: transform output -> transform input 0
      getState().startConnection(xfm, 0);
      getState().completeConnection(xfm, 0);

      // Original connection preserved, no self-connection added
      expect(connectionCount()).toBe(1);
      expect(getState().connections[origConnId!]).toBeDefined();
      expect(getState().connections[origConnId!].sourceNodeId).toBe(src);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Valid reconnection creates exactly one undo entry
  // -----------------------------------------------------------------------
  describe('valid reconnection creates exactly one undo entry', () => {
    it('undo reverts to old connection, redo restores new connection', () => {
      // Create src1 -> transform
      const src1 = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const oldConnId = getState().addConnection(src1, 0, xfm, 0);
      expect(oldConnId).not.toBeNull();

      // Note: addNode and addConnection each push undo

      // Create src2 and reconnect
      const src2 = getState().addNode('source', [0, 0, 5]);

      getState().startConnection(src2, 0);
      getState().completeConnection(xfm, 0);

      // New connection should be from src2
      expect(connectionCount()).toBe(1);
      const newConn = connectionValues()[0];
      expect(newConn.sourceNodeId).toBe(src2);

      // Undo once -> should revert to old connection (src1 -> xfm)
      getState().undo();
      expect(connectionCount()).toBe(1);
      const restoredConn = connectionValues()[0];
      expect(restoredConn.sourceNodeId).toBe(src1);
      expect(restoredConn.targetNodeId).toBe(xfm);
      expect(restoredConn.targetPortIndex).toBe(0);

      // Redo -> should restore new connection (src2 -> xfm)
      getState().redo();
      expect(connectionCount()).toBe(1);
      const redoneConn = connectionValues()[0];
      expect(redoneConn.sourceNodeId).toBe(src2);
      expect(redoneConn.targetNodeId).toBe(xfm);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Drawing state reset on both success and failure
  // -----------------------------------------------------------------------
  describe('drawing state reset on both success and failure', () => {
    it('resets interaction and pendingConnection after successful reconnection', () => {
      const src1 = getState().addNode('source', [0, 0, 0]);
      const src2 = getState().addNode('source', [0, 0, 5]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src1, 0, xfm, 0);

      getState().startConnection(src2, 0);
      expect(getState().interaction).toBe('drawing-connection');
      expect(getState().pendingConnection).not.toBeNull();

      getState().completeConnection(xfm, 0);

      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();
    });

    it('resets interaction and pendingConnection after failed reconnection (type mismatch)', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      // concat output is string, transform input 0 is number → type mismatch
      const concatNode = getState().addNode('concat', [0, 0, 5]);
      getState().startConnection(concatNode, 0);
      expect(getState().interaction).toBe('drawing-connection');
      expect(getState().pendingConnection).not.toBeNull();

      getState().completeConnection(xfm, 0);

      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();
    });

    it('resets interaction and pendingConnection after failed reconnection (self-connection)', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().startConnection(xfm, 0);
      expect(getState().interaction).toBe('drawing-connection');

      getState().completeConnection(xfm, 0);

      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();
    });

    it('resets interaction and pendingConnection after failed reconnection (cycle)', () => {
      const nodeA = getState().addNode('source', [0, 0, 0]);
      const nodeB = getState().addNode('transform', [5, 0, 0]);
      const nodeC = getState().addNode('transform', [10, 0, 0]);
      getState().addConnection(nodeA, 0, nodeB, 0);
      getState().addConnection(nodeB, 0, nodeC, 0);

      getState().startConnection(nodeC, 0);
      expect(getState().interaction).toBe('drawing-connection');

      getState().completeConnection(nodeB, 1); // would create cycle

      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Duplicate connection rejected
  // -----------------------------------------------------------------------
  describe('duplicate connection rejected', () => {
    it('does not create a second identical connection via completeConnection', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const connId = getState().addConnection(src, 0, xfm, 0);
      expect(connId).not.toBeNull();
      expect(connectionCount()).toBe(1);

      // Try to create the exact same connection via the drawing workflow
      getState().startConnection(src, 0);
      getState().completeConnection(xfm, 0);

      // Still only 1 connection
      expect(connectionCount()).toBe(1);
      expect(getState().connections[connId!]).toBeDefined();
    });

    it('does not create a duplicate via addConnection either', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const connId1 = getState().addConnection(src, 0, xfm, 0);
      expect(connId1).not.toBeNull();

      const connId2 = getState().addConnection(src, 0, xfm, 0);
      expect(connId2).toBeNull();
      expect(connectionCount()).toBe(1);
    });
  });
});

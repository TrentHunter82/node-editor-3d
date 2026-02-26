import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';
import { saveGraph } from '../utils/serialization';
import { GRID_SNAP_SIZE, snapToGrid } from './editorStore';

// Helper to reset the store between tests
function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
  });
}

// Drain undo/redo stacks to ensure test isolation
function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  while (getState().canRedo()) getState().redo();
  // Now drain the redo stack via undo
  while (getState().canUndo()) getState().undo();
}

function getState() {
  return useEditorStore.getState();
}

describe('editorStore', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
    localStorage.clear();
  });

  // ─── Node Management ──────────────────────────────────────────────

  describe('addNode', () => {
    it('creates a source node with correct defaults', () => {
      const id = getState().addNode('source');
      const node = getState().nodes[id];

      expect(node).toBeDefined();
      expect(node.type).toBe('source');
      expect(node.title).toBe('Source');
      expect(node.inputs).toHaveLength(0);  // source has 0 inputs
      expect(node.outputs).toHaveLength(2); // source has 2 outputs
    });

    it('creates a transform node with correct ports', () => {
      const id = getState().addNode('transform');
      const node = getState().nodes[id];

      expect(node.type).toBe('transform');
      expect(node.title).toBe('Transform');
      expect(node.inputs).toHaveLength(2);
      expect(node.outputs).toHaveLength(2);
    });

    it('creates a filter node with correct ports', () => {
      const id = getState().addNode('filter');
      const node = getState().nodes[id];

      expect(node.type).toBe('filter');
      expect(node.inputs).toHaveLength(1);
      expect(node.outputs).toHaveLength(1);
    });

    it('creates an output node with correct ports', () => {
      const id = getState().addNode('output');
      const node = getState().nodes[id];

      expect(node.type).toBe('output');
      expect(node.inputs).toHaveLength(2);
      expect(node.outputs).toHaveLength(0);
    });

    it('uses custom position when provided', () => {
      const pos: [number, number, number] = [5, 0, 10];
      const id = getState().addNode('source', pos);
      expect(getState().nodes[id].position).toEqual(pos);
    });

    it('generates random position when not provided', () => {
      const id = getState().addNode('source');
      const pos = getState().nodes[id].position;
      expect(pos).toHaveLength(3);
      expect(typeof pos[0]).toBe('number');
    });

    it('returns unique IDs for each node', () => {
      const id1 = getState().addNode('source');
      const id2 = getState().addNode('source');
      expect(id1).not.toBe(id2);
    });
  });

  describe('removeNode', () => {
    it('removes the node from the store', () => {
      const id = getState().addNode('source');
      expect(getState().nodes[id]).toBeDefined();

      getState().removeNode(id);
      expect(getState().nodes[id]).toBeUndefined();
    });

    it('removes connections attached to the deleted node', () => {
      const src = getState().addNode('source');
      const tgt = getState().addNode('transform');
      const connId = getState().addConnection(src, 0, tgt, 0);

      getState().removeNode(src);
      expect(getState().connections[connId!]).toBeUndefined();
    });

    it('removes the node from selectedIds', () => {
      const id = getState().addNode('source');
      getState().setSelection(new Set([id]));
      expect(getState().selectedIds.has(id)).toBe(true);

      getState().removeNode(id);
      expect(getState().selectedIds.has(id)).toBe(false);
    });
  });

  describe('updateNodePosition', () => {
    it('updates position of an existing node', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      const newPos: [number, number, number] = [10, 0, 5];
      getState().updateNodePosition(id, newPos);
      expect(getState().nodes[id].position).toEqual(newPos);
    });

    it('does nothing for a non-existent node', () => {
      getState().updateNodePosition('nonexistent', [1, 2, 3]);
      // Should not throw
      expect(Object.keys(getState().nodes)).toHaveLength(0);
    });
  });

  describe('updateNodeTitle', () => {
    it('changes the title of an existing node', () => {
      const id = getState().addNode('source');
      getState().updateNodeTitle(id, 'My Source');
      expect(getState().nodes[id].title).toBe('My Source');
    });

    it('does nothing for a non-existent node', () => {
      getState().updateNodeTitle('nonexistent', 'test');
      expect(Object.keys(getState().nodes)).toHaveLength(0);
    });
  });

  // ─── Connection Management ────────────────────────────────────────

  describe('addConnection', () => {
    it('creates a connection between two nodes', () => {
      const src = getState().addNode('source');
      const tgt = getState().addNode('transform');
      const connId = getState().addConnection(src, 0, tgt, 0);

      expect(connId).toBeTruthy();
      const conn = getState().connections[connId!];
      expect(conn.sourceNodeId).toBe(src);
      expect(conn.sourcePortIndex).toBe(0);
      expect(conn.targetNodeId).toBe(tgt);
      expect(conn.targetPortIndex).toBe(0);
    });

    it('prevents duplicate connections', () => {
      const src = getState().addNode('source');
      const tgt = getState().addNode('transform');
      getState().addConnection(src, 0, tgt, 0);
      const dupe = getState().addConnection(src, 0, tgt, 0);
      expect(dupe).toBeNull();
    });

    it('prevents self-connections', () => {
      const id = getState().addNode('transform');
      const result = getState().addConnection(id, 0, id, 0);
      expect(result).toBeNull();
    });

    it('allows multiple connections from different ports', () => {
      // source output 0 = number, output 1 = string
      // filter input 0 = any (accepts both)
      const src = getState().addNode('source');
      const tgt1 = getState().addNode('filter');
      const tgt2 = getState().addNode('filter');
      const c1 = getState().addConnection(src, 0, tgt1, 0);
      const c2 = getState().addConnection(src, 1, tgt2, 0);
      expect(c1).toBeTruthy();
      expect(c2).toBeTruthy();
      expect(c1).not.toBe(c2);
    });
  });

  describe('removeConnection', () => {
    it('removes a connection and clears it from selection', () => {
      const src = getState().addNode('source');
      const tgt = getState().addNode('transform');
      const connId = getState().addConnection(src, 0, tgt, 0)!;
      getState().setSelection(new Set([connId]));

      getState().removeConnection(connId);
      expect(getState().connections[connId]).toBeUndefined();
      expect(getState().selectedIds.has(connId)).toBe(false);
    });
  });

  // ─── Selection ────────────────────────────────────────────────────

  describe('setSelection', () => {
    it('replaces the entire selection', () => {
      const id1 = getState().addNode('source');
      const id2 = getState().addNode('source');
      getState().setSelection(new Set([id1, id2]));
      expect(getState().selectedIds.size).toBe(2);
      expect(getState().selectedIds.has(id1)).toBe(true);
      expect(getState().selectedIds.has(id2)).toBe(true);
    });
  });

  describe('toggleSelection', () => {
    it('adds an unselected item', () => {
      const id = getState().addNode('source');
      getState().toggleSelection(id);
      expect(getState().selectedIds.has(id)).toBe(true);
    });

    it('removes an already-selected item', () => {
      const id = getState().addNode('source');
      getState().setSelection(new Set([id]));
      getState().toggleSelection(id);
      expect(getState().selectedIds.has(id)).toBe(false);
    });
  });

  // ─── Connection Drawing Lifecycle ─────────────────────────────────

  describe('connection drawing workflow', () => {
    it('starts, updates cursor, and completes a connection', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const tgt = getState().addNode('transform', [5, 0, 0]);

      // Start drawing
      getState().startConnection(src, 0);
      expect(getState().interaction).toBe('drawing-connection');
      expect(getState().pendingConnection).not.toBeNull();
      expect(getState().pendingConnection!.sourceNodeId).toBe(src);

      // Move cursor
      getState().updatePendingCursor([2.5, 0, 0]);
      expect(getState().pendingConnection!.cursorPos).toEqual([2.5, 0, 0]);

      // Complete
      getState().completeConnection(tgt, 0);
      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();
      expect(Object.keys(getState().connections)).toHaveLength(1);
    });

    it('cancels a pending connection', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().startConnection(src, 0);

      getState().cancelConnection();
      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();
    });

    it('does not start a connection from a non-existent node', () => {
      getState().startConnection('nonexistent', 0);
      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();
    });

    it('enforces single-input: replaces existing connection to same input port', () => {
      const src1 = getState().addNode('source', [0, 0, 0]);
      const src2 = getState().addNode('source', [0, 0, 5]);
      const tgt = getState().addNode('transform', [5, 0, 0]);

      // First connection to tgt port 0
      getState().addConnection(src1, 0, tgt, 0);
      expect(Object.keys(getState().connections)).toHaveLength(1);

      // Draw a second connection to the same target port via the workflow
      getState().startConnection(src2, 0);
      getState().completeConnection(tgt, 0);

      // Should still be 1 connection (old one replaced)
      const conns = Object.values(getState().connections);
      expect(conns).toHaveLength(1);
      expect(conns[0].sourceNodeId).toBe(src2);
    });
  });

  // ─── Interaction State ────────────────────────────────────────────

  describe('setInteraction', () => {
    it('changes interaction mode', () => {
      getState().setInteraction('dragging-node');
      expect(getState().interaction).toBe('dragging-node');
    });
  });

  describe('setNearestSnapPort', () => {
    it('sets and clears snap port', () => {
      getState().setNearestSnapPort({ nodeId: 'n1', portIndex: 0 });
      expect(getState().nearestSnapPort).toEqual({ nodeId: 'n1', portIndex: 0 });

      getState().setNearestSnapPort(null);
      expect(getState().nearestSnapPort).toBeNull();
    });
  });

  describe('setHoveredConnection', () => {
    it('sets and clears hovered connection', () => {
      getState().setHoveredConnection('conn-1');
      expect(getState().hoveredConnectionId).toBe('conn-1');

      getState().setHoveredConnection(null);
      expect(getState().hoveredConnectionId).toBeNull();
    });
  });

  // ─── disconnectAndReroute ─────────────────────────────────────────

  describe('disconnectAndReroute', () => {
    it('removes connection and starts a new one from the same source', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const tgt = getState().addNode('transform', [5, 0, 0]);
      const connId = getState().addConnection(src, 0, tgt, 0)!;

      getState().disconnectAndReroute(connId);

      // Connection should be removed
      expect(getState().connections[connId]).toBeUndefined();
      // Should be in drawing-connection mode from the original source
      expect(getState().interaction).toBe('drawing-connection');
      expect(getState().pendingConnection!.sourceNodeId).toBe(src);
      expect(getState().pendingConnection!.sourcePortIndex).toBe(0);
    });

    it('does nothing for a non-existent connection', () => {
      getState().disconnectAndReroute('nonexistent');
      expect(getState().interaction).toBe('idle');
    });
  });

  // ─── Persistence ──────────────────────────────────────────────────

  describe('loadFromStorage', () => {
    it('returns false when nothing is saved', () => {
      expect(getState().loadFromStorage()).toBe(false);
    });

    it('loads saved graph data', () => {
      // Add nodes and connections, then manually save
      const src = getState().addNode('source', [0, 0, 0]);
      const tgt = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, tgt, 0);

      // Manually trigger save (the auto-save is debounced)
      const { nodes, connections } = getState();
      saveGraph(nodes, connections);

      // Reset store
      resetStore();
      expect(Object.keys(getState().nodes)).toHaveLength(0);

      // Load from storage
      const loaded = getState().loadFromStorage();
      expect(loaded).toBe(true);
      expect(Object.keys(getState().nodes)).toHaveLength(2);
      expect(Object.keys(getState().connections)).toHaveLength(1);
    });
  });

  // ─── Undo/Redo ───────────────────────────────────────────────────

  describe('undo/redo', () => {
    it('canUndo is false on fresh state', () => {
      expect(getState().canUndo()).toBe(false);
    });

    it('canRedo is false on fresh state', () => {
      expect(getState().canRedo()).toBe(false);
    });

    it('canUndo becomes true after a mutation', () => {
      getState().addNode('source', [0, 0, 0]);
      expect(getState().canUndo()).toBe(true);
    });

    it('undo reverts addNode', () => {
      getState().addNode('source', [0, 0, 0]);
      expect(Object.keys(getState().nodes)).toHaveLength(1);

      getState().undo();
      expect(Object.keys(getState().nodes)).toHaveLength(0);
      expect(getState().canUndo()).toBe(false);
    });

    it('redo restores undone addNode', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().undo();
      expect(Object.keys(getState().nodes)).toHaveLength(0);

      getState().redo();
      expect(Object.keys(getState().nodes)).toHaveLength(1);
      // Node should be restored (may have same or different reference)
      expect(getState().nodes[id]).toBeDefined();
    });

    it('canRedo becomes true after undo', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().undo();
      expect(getState().canRedo()).toBe(true);
    });

    it('redo stack is cleared on new action after undo', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().undo();
      expect(getState().canRedo()).toBe(true);

      // New action should clear redo stack
      getState().addNode('transform', [5, 0, 0]);
      expect(getState().canRedo()).toBe(false);
    });

    it('undo reverts removeNode', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().removeNode(id);
      expect(getState().nodes[id]).toBeUndefined();

      getState().undo();
      // After undoing removeNode, we should have at least 1 node
      // (The undo restores the state before removeNode, which has 1 node)
      expect(Object.keys(getState().nodes)).toHaveLength(1);
    });

    it('multiple undo/redo steps work correctly', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().addNode('transform', [5, 0, 0]);
      expect(Object.keys(getState().nodes)).toHaveLength(2);

      getState().undo(); // Remove transform
      expect(Object.keys(getState().nodes)).toHaveLength(1);

      getState().undo(); // Remove source
      expect(Object.keys(getState().nodes)).toHaveLength(0);

      getState().redo(); // Re-add source
      expect(Object.keys(getState().nodes)).toHaveLength(1);

      getState().redo(); // Re-add transform
      expect(Object.keys(getState().nodes)).toHaveLength(2);
    });

    it('undo does nothing when stack is empty', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().undo();
      // Stack empty now
      const stateBeforeExtra = { ...getState().nodes };
      getState().undo(); // should be no-op
      expect(getState().nodes).toEqual(stateBeforeExtra);
    });

    it('redo does nothing when stack is empty', () => {
      getState().addNode('source', [0, 0, 0]);
      const stateBeforeRedo = Object.keys(getState().nodes).length;
      getState().redo(); // no redo available
      expect(Object.keys(getState().nodes)).toHaveLength(stateBeforeRedo);
    });

    it('undo clears selectedIds', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      expect(getState().selectedIds.size).toBe(1);

      getState().undo();
      expect(getState().selectedIds.size).toBe(0);
    });

    it('loadFromStorage clears undo/redo stacks', () => {
      getState().addNode('source', [0, 0, 0]);
      expect(getState().canUndo()).toBe(true);

      saveGraph(getState().nodes, getState().connections);
      getState().loadFromStorage();

      expect(getState().canUndo()).toBe(false);
      expect(getState().canRedo()).toBe(false);
    });

    it('pushUndoSnapshot creates an undo entry without mutation', () => {
      getState().addNode('source', [0, 0, 0]);
      drainUndoRedo();
      resetStore();
      // Re-add a node
      getState().addNode('source', [0, 0, 0]);
      drainUndoRedo();
      resetStore();

      getState().addNode('source', [0, 0, 0]);
      // Drain undo from addNode
      drainUndoRedo();
      resetStore();

      // Start fresh
      getState().addNode('source', [0, 0, 0]);
      // addNode pushes undo, so canUndo is true
      expect(getState().canUndo()).toBe(true);

      // Push another snapshot manually
      getState().pushUndoSnapshot();
      // Undo the pushUndoSnapshot (restores same state)
      getState().undo();
      // Undo the addNode
      getState().undo();
      expect(Object.keys(getState().nodes)).toHaveLength(0);
    });
  });

  // ─── Copy/Paste ──────────────────────────────────────────────────

  describe('copy/paste', () => {
    it('canPaste is false initially', () => {
      expect(getState().canPaste()).toBe(false);
    });

    it('copySelected makes canPaste true', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().copySelected();
      expect(getState().canPaste()).toBe(true);
    });

    it('copySelected with no selection does not update clipboard', () => {
      // First copy something
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().copySelected();
      expect(getState().canPaste()).toBe(true);

      // Now select nothing and copy
      getState().setSelection(new Set());
      getState().copySelected();
      // Clipboard should still be from first copy (since empty selection is no-op)
      expect(getState().canPaste()).toBe(true);
    });

    it('paste creates new nodes with offset positions', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().copySelected();
      getState().paste();

      const nodeIds = Object.keys(getState().nodes);
      expect(nodeIds).toHaveLength(2);

      // Find the pasted node (not the original)
      const pastedNode = Object.values(getState().nodes).find(n => n.id !== id)!;
      expect(pastedNode).toBeDefined();
      expect(pastedNode.type).toBe('source');
      expect(pastedNode.position[0]).toBe(1.5); // 0 + 1.5
      expect(pastedNode.position[2]).toBe(1);   // 0 + 1
    });

    it('paste selects only the pasted nodes', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().copySelected();
      getState().paste();

      // Selection should contain only the new pasted node
      expect(getState().selectedIds.size).toBe(1);
      expect(getState().selectedIds.has(id)).toBe(false);
    });

    it('paste preserves internal connections', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const tgt = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, tgt, 0);

      // Select both nodes and copy
      getState().setSelection(new Set([src, tgt]));
      getState().copySelected();
      getState().paste();

      // Should have 4 nodes and 2 connections
      expect(Object.keys(getState().nodes)).toHaveLength(4);
      expect(Object.keys(getState().connections)).toHaveLength(2);

      // The pasted connection should connect the pasted nodes (not the originals)
      const pastedNodeIds = [...getState().selectedIds];
      const allConns = Object.values(getState().connections);
      const pastedConn = allConns.find(
        c => pastedNodeIds.includes(c.sourceNodeId) && pastedNodeIds.includes(c.targetNodeId)
      );
      expect(pastedConn).toBeDefined();
    });

    it('paste does not copy external connections', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const mid = getState().addNode('transform', [5, 0, 0]);
      const out = getState().addNode('output', [10, 0, 0]);
      getState().addConnection(src, 0, mid, 0);
      getState().addConnection(mid, 0, out, 0);

      // Only select the middle node
      getState().setSelection(new Set([mid]));
      getState().copySelected();
      getState().paste();

      // Should have 4 nodes but still only 2 connections (original ones)
      expect(Object.keys(getState().nodes)).toHaveLength(4);
      expect(Object.keys(getState().connections)).toHaveLength(2);
    });

    it('multiple pastes create nodes with unique IDs', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().copySelected();

      getState().paste();
      getState().paste();

      // Original + 2 pastes = 3 nodes
      expect(Object.keys(getState().nodes)).toHaveLength(3);
      // All 3 should have unique IDs
      const ids = Object.keys(getState().nodes);
      expect(new Set(ids).size).toBe(3);
    });

    it('paste is undoable', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().copySelected();
      getState().paste();
      expect(Object.keys(getState().nodes)).toHaveLength(2);

      getState().undo();
      expect(Object.keys(getState().nodes)).toHaveLength(1);
    });
  });

  // ─── Box Selection ───────────────────────────────────────────────

  describe('boxSelect', () => {
    it('selects nodes within the rectangle', () => {
      const n1 = getState().addNode('source', [2, 0, 2]);
      const n2 = getState().addNode('transform', [4, 0, 4]);
      getState().addNode('filter', [10, 0, 10]); // Outside

      getState().boxSelect(0, 0, 5, 5, false);
      expect(getState().selectedIds.size).toBe(2);
      expect(getState().selectedIds.has(n1)).toBe(true);
      expect(getState().selectedIds.has(n2)).toBe(true);
    });

    it('deselects nodes outside the rectangle', () => {
      const n1 = getState().addNode('source', [2, 0, 2]);
      const n2 = getState().addNode('transform', [10, 0, 10]);

      getState().setSelection(new Set([n1, n2])); // Both selected
      getState().boxSelect(0, 0, 5, 5, false);
      expect(getState().selectedIds.size).toBe(1);
      expect(getState().selectedIds.has(n1)).toBe(true);
      expect(getState().selectedIds.has(n2)).toBe(false);
    });

    it('additive mode preserves existing selection', () => {
      const n1 = getState().addNode('source', [2, 0, 2]);
      const n2 = getState().addNode('transform', [10, 0, 10]);

      getState().setSelection(new Set([n2])); // Select n2
      getState().boxSelect(0, 0, 5, 5, true); // Additive box around n1

      expect(getState().selectedIds.size).toBe(2);
      expect(getState().selectedIds.has(n1)).toBe(true);
      expect(getState().selectedIds.has(n2)).toBe(true);
    });

    it('selects nothing when no nodes are in the rectangle', () => {
      getState().addNode('source', [10, 0, 10]);
      getState().boxSelect(0, 0, 5, 5, false);
      expect(getState().selectedIds.size).toBe(0);
    });

    it('selects nodes on the boundary', () => {
      const n1 = getState().addNode('source', [0, 0, 0]); // On min boundary
      const n2 = getState().addNode('transform', [5, 0, 5]); // On max boundary

      getState().boxSelect(0, 0, 5, 5, false);
      expect(getState().selectedIds.size).toBe(2);
      expect(getState().selectedIds.has(n1)).toBe(true);
      expect(getState().selectedIds.has(n2)).toBe(true);
    });

    it('ignores Y coordinate (only checks XZ)', () => {
      const n1 = getState().addNode('source', [2, 100, 2]); // High Y
      getState().boxSelect(0, 0, 5, 5, false);
      expect(getState().selectedIds.has(n1)).toBe(true);
    });
  });

  // ─── Delete Selected ─────────────────────────────────────────────

  describe('deleteSelected', () => {
    it('deletes selected nodes', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1]));

      getState().deleteSelected();
      expect(getState().nodes[n1]).toBeUndefined();
      expect(getState().nodes[n2]).toBeDefined();
    });

    it('cascade deletes connections when node is deleted', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const tgt = getState().addNode('transform', [5, 0, 0]);
      const connId = getState().addConnection(src, 0, tgt, 0)!;

      getState().setSelection(new Set([src]));
      getState().deleteSelected();

      expect(getState().connections[connId]).toBeUndefined();
    });

    it('deletes selected connections', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const tgt = getState().addNode('transform', [5, 0, 0]);
      const connId = getState().addConnection(src, 0, tgt, 0)!;

      getState().setSelection(new Set([connId]));
      getState().deleteSelected();

      expect(getState().connections[connId]).toBeUndefined();
      // Nodes should still exist
      expect(getState().nodes[src]).toBeDefined();
      expect(getState().nodes[tgt]).toBeDefined();
    });

    it('clears selection after delete', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([n1]));
      getState().deleteSelected();
      expect(getState().selectedIds.size).toBe(0);
    });

    it('does nothing when nothing is selected', () => {
      getState().addNode('source', [0, 0, 0]);
      const countBefore = Object.keys(getState().nodes).length;
      getState().deleteSelected();
      expect(Object.keys(getState().nodes)).toHaveLength(countBefore);
    });

    it('is undoable as a single operation', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(n1, 0, n2, 0);

      getState().setSelection(new Set([n1, n2]));
      getState().deleteSelected();
      expect(Object.keys(getState().nodes)).toHaveLength(0);
      expect(Object.keys(getState().connections)).toHaveLength(0);

      // Single undo should restore both nodes and connection
      getState().undo();
      expect(Object.keys(getState().nodes)).toHaveLength(2);
      expect(Object.keys(getState().connections)).toHaveLength(1);
    });

    it('handles mixed node and connection selection', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      const n3 = getState().addNode('output', [10, 0, 0]);
      getState().addConnection(n1, 0, n2, 0);
      const conn2 = getState().addConnection(n2, 0, n3, 0)!;

      // Select n1 (node) and conn2 (connection)
      getState().setSelection(new Set([n1, conn2]));
      getState().deleteSelected();

      // n1 deleted, conn2 deleted, n2 and n3 remain
      expect(getState().nodes[n1]).toBeUndefined();
      expect(getState().nodes[n2]).toBeDefined();
      expect(getState().nodes[n3]).toBeDefined();
      expect(getState().connections[conn2]).toBeUndefined();
      // conn from n1->n2 should also be cascade-deleted
      expect(Object.keys(getState().connections)).toHaveLength(0);
    });
  });

  // ─── Toggle Snap ─────────────────────────────────────────────────

  describe('toggleSnap', () => {
    it('defaults to snap enabled', () => {
      expect(getState().snapEnabled).toBe(true);
    });

    it('toggles snap off', () => {
      getState().toggleSnap();
      expect(getState().snapEnabled).toBe(false);
    });

    it('toggles snap back on', () => {
      getState().toggleSnap();
      getState().toggleSnap();
      expect(getState().snapEnabled).toBe(true);
    });
  });

  // ─── snapToGrid utility ──────────────────────────────────────────

  describe('snapToGrid', () => {
    it('snaps to nearest grid increment', () => {
      expect(snapToGrid(0.3)).toBe(0.5);
      expect(snapToGrid(0.1)).toBe(0);
      expect(snapToGrid(0.25)).toBe(0.5);
      expect(snapToGrid(0.75)).toBe(1);
    });

    it('leaves exact grid values unchanged', () => {
      expect(snapToGrid(0)).toBe(0);
      expect(snapToGrid(0.5)).toBe(0.5);
      expect(snapToGrid(1)).toBe(1);
      expect(snapToGrid(-1.5)).toBe(-1.5);
    });

    it('handles negative values', () => {
      expect(snapToGrid(-0.3)).toBe(-0.5);
      expect(snapToGrid(-0.1)).toBeCloseTo(0); // Math.round(-0.2) === -0
      expect(snapToGrid(-0.7)).toBe(-0.5);
      expect(snapToGrid(-1.3)).toBe(-1.5);
    });

    it('GRID_SNAP_SIZE is 0.5', () => {
      expect(GRID_SNAP_SIZE).toBe(0.5);
    });
  });

  // ─── Duplicate Selected ──────────────────────────────────────────

  describe('duplicateSelected', () => {
    it('duplicates a selected node with offset', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().duplicateSelected();

      expect(Object.keys(getState().nodes)).toHaveLength(2);
      const duped = Object.values(getState().nodes).find(n => n.id !== id)!;
      expect(duped.type).toBe('source');
      expect(duped.title).toBe('Source Copy');
      expect(duped.position[0]).toBe(1.5);
      expect(duped.position[2]).toBe(1);
    });

    it('selects only the duplicated nodes', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().duplicateSelected();

      expect(getState().selectedIds.size).toBe(1);
      expect(getState().selectedIds.has(id)).toBe(false);
    });

    it('does nothing with no selection', () => {
      getState().addNode('source', [0, 0, 0]);
      const count = Object.keys(getState().nodes).length;
      getState().duplicateSelected();
      expect(Object.keys(getState().nodes)).toHaveLength(count);
    });

    it('is undoable as a single operation', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().duplicateSelected();
      expect(Object.keys(getState().nodes)).toHaveLength(2);

      getState().undo();
      expect(Object.keys(getState().nodes)).toHaveLength(1);
    });
  });

  // ─── Grouping ───────────────────────────────────────────────────

  describe('createGroup', () => {
    it('creates a group from selected nodes', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));

      const groupId = getState().createGroup('My Group');
      expect(groupId).toBeTruthy();
      expect(getState().groups[groupId!]).toBeDefined();
      expect(getState().groups[groupId!].label).toBe('My Group');
      expect(getState().groups[groupId!].collapsed).toBe(false);
      expect(getState().nodes[n1].groupId).toBe(groupId);
      expect(getState().nodes[n2].groupId).toBe(groupId);
    });

    it('requires at least 2 nodes to create a group', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([n1]));

      const groupId = getState().createGroup();
      expect(groupId).toBeNull();
      expect(Object.keys(getState().groups)).toHaveLength(0);
    });

    it('returns null when no nodes are selected', () => {
      getState().addNode('source', [0, 0, 0]);
      const groupId = getState().createGroup();
      expect(groupId).toBeNull();
    });

    it('uses default label when none provided', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));

      const groupId = getState().createGroup();
      expect(getState().groups[groupId!].label).toBe('Group');
    });

    it('returns null if all selected nodes are already in the same group', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));

      const groupId = getState().createGroup('First');
      expect(groupId).toBeTruthy();

      // Try to group them again
      getState().setSelection(new Set([n1, n2]));
      const groupId2 = getState().createGroup('Second');
      expect(groupId2).toBeNull();
    });

    it('is undoable', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));

      const groupId = getState().createGroup('Test');
      expect(Object.keys(getState().groups)).toHaveLength(1);
      expect(getState().nodes[n1].groupId).toBe(groupId);

      getState().undo();
      expect(Object.keys(getState().groups)).toHaveLength(0);
      expect(getState().nodes[n1]?.groupId).toBeUndefined();
    });

    it('ignores selected connections (only groups nodes)', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      const connId = getState().addConnection(n1, 0, n2, 0)!;
      // Select both nodes AND the connection
      getState().setSelection(new Set([n1, n2, connId]));

      const groupId = getState().createGroup();
      expect(groupId).toBeTruthy();
      expect(getState().nodes[n1].groupId).toBe(groupId);
      expect(getState().nodes[n2].groupId).toBe(groupId);
    });
  });

  describe('ungroupNodes', () => {
    it('removes group and clears groupId from member nodes', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('Test')!;

      getState().ungroupNodes(groupId);
      expect(getState().groups[groupId]).toBeUndefined();
      expect(getState().nodes[n1].groupId).toBeUndefined();
      expect(getState().nodes[n2].groupId).toBeUndefined();
    });

    it('does nothing for non-existent group', () => {
      getState().ungroupNodes('nonexistent');
      // Should not throw
      expect(Object.keys(getState().groups)).toHaveLength(0);
    });

    it('is undoable', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('Test')!;

      getState().ungroupNodes(groupId);
      expect(getState().groups[groupId]).toBeUndefined();

      getState().undo();
      expect(getState().groups[groupId]).toBeDefined();
      expect(getState().nodes[n1]?.groupId).toBe(groupId);
    });
  });

  describe('toggleGroupCollapse', () => {
    it('toggles collapsed state', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup()!;

      expect(getState().groups[groupId].collapsed).toBe(false);
      getState().toggleGroupCollapse(groupId);
      expect(getState().groups[groupId].collapsed).toBe(true);
      getState().toggleGroupCollapse(groupId);
      expect(getState().groups[groupId].collapsed).toBe(false);
    });

    it('does nothing for non-existent group', () => {
      getState().toggleGroupCollapse('nonexistent');
      // Should not throw
    });

    it('does not push undo (view-state, not content mutation)', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup()!;

      getState().toggleGroupCollapse(groupId);
      expect(getState().groups[groupId].collapsed).toBe(true);

      // Undo should revert createGroup, not the collapse toggle
      getState().undo();
      expect(getState().groups[groupId]).toBeUndefined();
    });
  });

  describe('renameGroup', () => {
    it('renames a group', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('Old Name')!;

      getState().renameGroup(groupId, 'New Name');
      expect(getState().groups[groupId].label).toBe('New Name');
    });

    it('does nothing for non-existent group', () => {
      getState().renameGroup('nonexistent', 'test');
      // Should not throw
    });
  });

  describe('group cleanup on node deletion', () => {
    it('removes group when all members are deleted via deleteSelected', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup()!;

      // Delete both nodes
      getState().setSelection(new Set([n1, n2]));
      getState().deleteSelected();
      expect(getState().groups[groupId]).toBeUndefined();
    });

    it('keeps group when some members remain after deleteSelected', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup()!;

      // Delete only one node
      getState().setSelection(new Set([n1]));
      getState().deleteSelected();
      expect(getState().groups[groupId]).toBeDefined();
      expect(getState().nodes[n2].groupId).toBe(groupId);
    });

    it('removes group when last member is deleted via removeNode', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup()!;

      getState().removeNode(n1);
      expect(getState().groups[groupId]).toBeDefined(); // Still has n2

      getState().removeNode(n2);
      expect(getState().groups[groupId]).toBeUndefined(); // Empty, cleaned up
    });
  });

  // ─── Clear Graph ────────────────────────────────────────────────

  describe('clearGraph', () => {
    it('removes all nodes, connections, and groups', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(n1, 0, n2, 0);
      getState().setSelection(new Set([n1, n2]));
      getState().createGroup('Test');

      getState().clearGraph();
      expect(Object.keys(getState().nodes)).toHaveLength(0);
      expect(Object.keys(getState().connections)).toHaveLength(0);
      expect(Object.keys(getState().groups)).toHaveLength(0);
    });

    it('clears selection and resets interaction', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([n1]));

      getState().clearGraph();
      expect(getState().selectedIds.size).toBe(0);
      expect(getState().interaction).toBe('idle');
    });

    it('does nothing when graph is already empty', () => {
      // Should not throw or push empty undo
      getState().clearGraph();
      expect(getState().canUndo()).toBe(false);
    });

    it('is undoable', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(n1, 0, n2, 0);

      getState().clearGraph();
      expect(Object.keys(getState().nodes)).toHaveLength(0);

      getState().undo();
      expect(Object.keys(getState().nodes)).toHaveLength(2);
      expect(Object.keys(getState().connections)).toHaveLength(1);
    });

    it('clears groups when undone and redone', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      getState().createGroup('Test');

      getState().clearGraph();
      expect(Object.keys(getState().groups)).toHaveLength(0);

      getState().undo();
      expect(Object.keys(getState().groups)).toHaveLength(1);
    });
  });
});

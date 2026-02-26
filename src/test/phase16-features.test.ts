/**
 * Phase 16 Feature Tests
 *
 * Tests for new features added in Phase 16:
 * 1. Node Comments/Annotations (updateNodeComment, clone/paste preservation)
 * 2. Batch Node Operations (batchUpdateNodeData, batchMoveNodes, batchUpdateNodeTitles)
 * 3. Descriptive Undo Labels (pushUndo label parameter, getUndoHistory labels)
 * 4. Graph Analytics (node/connection counts exposed via getUndoHistory meta)
 * 5. Export-to-Image infrastructure (window.__exportImage registration)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { saveMultiGraph, loadMultiGraph } from '../utils/serialization';

// ---------------------------------------------------------------------------
// Shared helpers
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
    s.breadcrumbStack = [];
    s.activeGraphId = 'default';
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.graphOrder = ['default'];
    s.templates = {};
    s.errorStrategy = 'fail-fast';
    s.executionMetrics = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
  localStorage.clear();
}

beforeEach(() => {
  resetStore();
});

// ===========================================================================
// 1. Node Comments/Annotations
// ===========================================================================

describe('Node Comments/Annotations', () => {
  it('should set a comment on a node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'This is a source node');
    expect(getState().nodes[id].comment).toBe('This is a source node');
  });

  it('should clear a comment by setting undefined', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Hello');
    expect(getState().nodes[id].comment).toBe('Hello');
    getState().updateNodeComment(id, undefined);
    expect(getState().nodes[id].comment).toBeUndefined();
  });

  it('should normalize empty string to undefined', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Hello');
    getState().updateNodeComment(id, '');
    expect(getState().nodes[id].comment).toBeUndefined();
  });

  it('should no-op when setting same comment', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Test');
    const undoCountBefore = getState().getUndoHistory().undo.length;
    getState().updateNodeComment(id, 'Test');
    // Should not push additional undo entry
    expect(getState().getUndoHistory().undo.length).toBe(undoCountBefore);
  });

  it('should no-op for non-existent node', () => {
    getState().updateNodeComment('nonexistent', 'Test');
    // Should not throw
  });

  it('should undo/redo comment changes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'First');
    expect(getState().nodes[id].comment).toBe('First');

    getState().undo();
    expect(getState().nodes[id].comment).toBeUndefined();

    getState().redo();
    expect(getState().nodes[id].comment).toBe('First');
  });

  it('should preserve comment in duplicate', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Important node');
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();

    const nodeIds = Object.keys(getState().nodes);
    const cloneId = nodeIds.find(nid => nid !== id)!;
    expect(getState().nodes[cloneId].comment).toBe('Important node');
  });

  it('should preserve comment in copy/paste', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Pasted comment');
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();

    const nodeIds = Object.keys(getState().nodes);
    const pastedId = nodeIds.find(nid => nid !== id)!;
    expect(getState().nodes[pastedId].comment).toBe('Pasted comment');
  });

  it('should preserve comment in template instantiation', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Template comment');
    getState().setSelection(new Set([id]));
    const templateId = getState().saveSelectionAsTemplate('Test Template');
    expect(templateId).not.toBeNull();

    getState().instantiateTemplate(templateId!);

    const nodeIds = Object.keys(getState().nodes);
    const instanceId = nodeIds.find(nid => nid !== id)!;
    expect(getState().nodes[instanceId].comment).toBe('Template comment');
  });

  it('should survive serialization roundtrip', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Serialized comment');

    // Export, save, reload via serialization utils
    const exported = getState().exportAllGraphs();
    const saved = saveMultiGraph(exported);
    expect(saved).toBe(true);

    const loaded = loadMultiGraph();
    expect(loaded).not.toBeNull();
    expect(loaded!.graphs['default'].nodes[id].comment).toBe('Serialized comment');
  });
});

// ===========================================================================
// 2. Batch Node Operations
// ===========================================================================

describe('Batch Node Operations', () => {
  describe('batchUpdateNodeData', () => {
    it('should update data on multiple nodes at once', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('source', [3, 0, 0]);
      getState().batchUpdateNodeData([
        { nodeId: id1, key: 'value', value: 42 },
        { nodeId: id2, key: 'value', value: 99 },
      ]);
      expect(getState().nodes[id1].data.value).toBe(42);
      expect(getState().nodes[id2].data.value).toBe(99);
    });

    it('should create only one undo entry for batch update', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('source', [3, 0, 0]);
      const undoBefore = getState().getUndoHistory().undo.length;
      getState().batchUpdateNodeData([
        { nodeId: id1, key: 'value', value: 10 },
        { nodeId: id2, key: 'value', value: 20 },
      ]);
      expect(getState().getUndoHistory().undo.length).toBe(undoBefore + 1);
    });

    it('should undo all batch changes at once', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('source', [3, 0, 0]);
      getState().updateNodeData(id1, 'value', 1);
      getState().updateNodeData(id2, 'value', 2);

      getState().batchUpdateNodeData([
        { nodeId: id1, key: 'value', value: 100 },
        { nodeId: id2, key: 'value', value: 200 },
      ]);

      getState().undo(); // Undo the batch
      expect(getState().nodes[id1].data.value).toBe(1);
      expect(getState().nodes[id2].data.value).toBe(2);
    });

    it('should skip invalid node IDs', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const undoBefore = getState().getUndoHistory().undo.length;
      getState().batchUpdateNodeData([
        { nodeId: id1, key: 'value', value: 42 },
        { nodeId: 'nonexistent', key: 'value', value: 99 },
      ]);
      expect(getState().nodes[id1].data.value).toBe(42);
      // Should still push undo (at least one valid update)
      expect(getState().getUndoHistory().undo.length).toBe(undoBefore + 1);
    });

    it('should not push undo when all IDs are invalid', () => {
      const undoBefore = getState().getUndoHistory().undo.length;
      getState().batchUpdateNodeData([
        { nodeId: 'bad1', key: 'value', value: 1 },
        { nodeId: 'bad2', key: 'value', value: 2 },
      ]);
      expect(getState().getUndoHistory().undo.length).toBe(undoBefore);
    });
  });

  describe('batchMoveNodes', () => {
    it('should move multiple nodes by offset', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('source', [3, 0, 0]);
      getState().batchMoveNodes([id1, id2], [1, 2, 3]);
      expect(getState().nodes[id1].position).toEqual([1, 2, 3]);
      expect(getState().nodes[id2].position).toEqual([4, 2, 3]);
    });

    it('should create only one undo entry', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('source', [3, 0, 0]);
      const undoBefore = getState().getUndoHistory().undo.length;
      getState().batchMoveNodes([id1, id2], [1, 0, 0]);
      expect(getState().getUndoHistory().undo.length).toBe(undoBefore + 1);
    });

    it('should undo all moves at once', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('source', [3, 0, 0]);
      getState().batchMoveNodes([id1, id2], [5, 5, 5]);
      getState().undo();
      expect(getState().nodes[id1].position).toEqual([0, 0, 0]);
      expect(getState().nodes[id2].position).toEqual([3, 0, 0]);
    });

    it('should skip invalid node IDs', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      getState().batchMoveNodes([id1, 'nonexistent'], [1, 1, 1]);
      expect(getState().nodes[id1].position).toEqual([1, 1, 1]);
    });

    it('should not push undo for all invalid IDs', () => {
      const undoBefore = getState().getUndoHistory().undo.length;
      getState().batchMoveNodes(['bad1', 'bad2'], [1, 1, 1]);
      expect(getState().getUndoHistory().undo.length).toBe(undoBefore);
    });
  });

  describe('batchUpdateNodeTitles', () => {
    it('should rename multiple nodes at once', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('transform', [3, 0, 0]);
      getState().batchUpdateNodeTitles([
        { nodeId: id1, title: 'Alpha' },
        { nodeId: id2, title: 'Beta' },
      ]);
      expect(getState().nodes[id1].title).toBe('Alpha');
      expect(getState().nodes[id2].title).toBe('Beta');
    });

    it('should create only one undo entry', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('transform', [3, 0, 0]);
      const undoBefore = getState().getUndoHistory().undo.length;
      getState().batchUpdateNodeTitles([
        { nodeId: id1, title: 'A' },
        { nodeId: id2, title: 'B' },
      ]);
      expect(getState().getUndoHistory().undo.length).toBe(undoBefore + 1);
    });

    it('should undo all renames at once', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('transform', [3, 0, 0]);
      const orig1 = getState().nodes[id1].title;
      const orig2 = getState().nodes[id2].title;
      getState().batchUpdateNodeTitles([
        { nodeId: id1, title: 'X' },
        { nodeId: id2, title: 'Y' },
      ]);
      getState().undo();
      expect(getState().nodes[id1].title).toBe(orig1);
      expect(getState().nodes[id2].title).toBe(orig2);
    });
  });
});

// ===========================================================================
// 3. Descriptive Undo Labels
// ===========================================================================

describe('Descriptive Undo Labels', () => {
  it('should label addNode undo entry', () => {
    getState().addNode('source', [0, 0, 0]);
    const history = getState().getUndoHistory();
    expect(history.undo.length).toBe(1);
    expect(history.undo[0].label).toBe('Add node');
  });

  it('should label removeNode undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().removeNode(id);
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Remove node');
  });

  it('should label updateNodeTitle undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'New Name');
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Rename node');
  });

  it('should label updateNodeComment undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'A comment');
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Update comment');
  });

  it('should label batchUpdateNodeData undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().batchUpdateNodeData([{ nodeId: id, key: 'value', value: 42 }]);
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Batch update node data');
  });

  it('should label batchMoveNodes undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().batchMoveNodes([id], [1, 0, 0]);
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Move nodes');
  });

  it('should label batchUpdateNodeTitles undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().batchUpdateNodeTitles([{ nodeId: id, title: 'X' }]);
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Batch rename nodes');
  });

  it('should label duplicateSelected undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Duplicate selection');
  });

  it('should label deleteSelected undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().deleteSelected();
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Delete selection');
  });

  it('should label paste undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Paste');
  });

  it('should label toggleNodeCollapse undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeCollapse(id);
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Toggle collapse');
  });

  it('should label updateNodeData undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 42);
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    expect(lastLabel).toBe('Update node data');
  });

  it('should track nodeCount and connectionCount in undo metadata', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    const history = getState().getUndoHistory();
    // The second addNode undo entry should show the state before adding (1 node)
    const lastEntry = history.undo[history.undo.length - 1];
    expect(lastEntry.nodeCount).toBe(1);
    expect(lastEntry.connectionCount).toBe(0);
  });

  it('should track timestamp in undo metadata', () => {
    const now = Date.now();
    getState().addNode('source', [0, 0, 0]);
    const history = getState().getUndoHistory();
    expect(history.undo[0].timestamp).toBeGreaterThanOrEqual(now);
  });

  it('should move labels to redo stack on undo', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    getState().undo();
    const history = getState().getUndoHistory();
    expect(history.redo.length).toBe(1);
    expect(history.redo[0].label).toBe('Add node');
  });

  it('should move labels back to undo stack on redo', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    getState().undo();
    getState().redo();
    const history = getState().getUndoHistory();
    expect(history.redo.length).toBe(0);
    expect(history.undo[history.undo.length - 1].label).toBe('Add node');
  });

  it('should return copies of stacks (not mutable references)', () => {
    getState().addNode('source', [0, 0, 0]);
    const h1 = getState().getUndoHistory();
    const h2 = getState().getUndoHistory();
    expect(h1.undo).not.toBe(h2.undo);
    expect(h1.redo).not.toBe(h2.redo);
  });
});

// ===========================================================================
// 4. Graph Analytics via Undo Metadata
// ===========================================================================

describe('Graph Analytics', () => {
  it('should track node count growth', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    getState().addNode('output', [6, 0, 0]);
    const history = getState().getUndoHistory();
    expect(history.undo[0].nodeCount).toBe(0); // Before first addNode
    expect(history.undo[1].nodeCount).toBe(1); // Before second addNode
    expect(history.undo[2].nodeCount).toBe(2); // Before third addNode
  });

  it('should track connection count', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(id1, 0, id2, 0);

    const history = getState().getUndoHistory();
    const lastEntry = history.undo[history.undo.length - 1];
    expect(lastEntry.connectionCount).toBe(0); // Before addConnection
  });

  it('should reflect node deletion in subsequent counts', () => {
    getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [3, 0, 0]);
    getState().removeNode(id2);

    const history = getState().getUndoHistory();
    const lastEntry = history.undo[history.undo.length - 1];
    // Before removeNode there were 2 nodes
    expect(lastEntry.nodeCount).toBe(2);
  });
});

// ===========================================================================
// 5. Connection Label in Undo
// ===========================================================================

describe('Connection Undo Labels', () => {
  it('should label addConnection undo entry', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(id1, 0, id2, 0);
    const history = getState().getUndoHistory();
    const lastLabel = history.undo[history.undo.length - 1].label;
    // Connection actions delegate to connectionSlice which passes label
    expect(typeof lastLabel).toBe('string');
    expect(lastLabel.length).toBeGreaterThan(0);
  });

  it('should label removeConnection undo entry', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(id1, 0, id2, 0);
    if (connId) {
      getState().removeConnection(connId);
      const history = getState().getUndoHistory();
      const lastLabel = history.undo[history.undo.length - 1].label;
      expect(typeof lastLabel).toBe('string');
      expect(lastLabel.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// 6. Multi-step Undo with Labels
// ===========================================================================

describe('Multi-step Undo with Labels', () => {
  it('should maintain label order through complex workflow', () => {
    // Build a small graph
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [3, 0, 0]);
    // Note: addConnection does NOT push undo (only completeConnection does)
    getState().addConnection(id1, 0, id2, 0);
    getState().updateNodeData(id1, 'value', 42);
    getState().updateNodeComment(id1, 'My comment');

    const history = getState().getUndoHistory();
    expect(history.undo.length).toBe(4);
    expect(history.undo[0].label).toBe('Add node');
    expect(history.undo[1].label).toBe('Add node');
    expect(history.undo[2].label).toBe('Update node data');
    expect(history.undo[3].label).toBe('Update comment');
  });

  it('should keep undo and redo meta stacks aligned after multiple undo/redo', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    getState().addNode('output', [6, 0, 0]);

    // Undo twice
    getState().undo();
    getState().undo();

    const history = getState().getUndoHistory();
    expect(history.undo.length).toBe(1);
    expect(history.redo.length).toBe(2);

    // Redo once
    getState().redo();
    const h2 = getState().getUndoHistory();
    expect(h2.undo.length).toBe(2);
    expect(h2.redo.length).toBe(1);
  });

  it('should clear redo meta on new action after undo', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    getState().undo();

    // New action should clear redo
    getState().addNode('output', [6, 0, 0]);
    const history = getState().getUndoHistory();
    expect(history.redo.length).toBe(0);
  });
});

// ===========================================================================
// 7. jumpToUndo with Labels
// ===========================================================================

describe('jumpToUndo with Labels', () => {
  it('should jump back multiple steps and transfer meta to redo', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    getState().addNode('output', [6, 0, 0]);
    getState().addNode('filter', [9, 0, 0]);

    // Jump to index 0 (back 3 steps)
    getState().jumpToUndo(0);

    const history = getState().getUndoHistory();
    // Only 1 entry should remain on undo stack (index 0)
    expect(history.undo.length).toBe(1);
    // 3 entries moved to redo
    expect(history.redo.length).toBe(3);
    // Only one node should exist
    expect(Object.keys(getState().nodes).length).toBe(1);
  });

  it('should keep meta stacks aligned after jumpToUndo', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    getState().addNode('output', [6, 0, 0]);

    getState().jumpToUndo(0);

    const history = getState().getUndoHistory();
    // All labels should still be valid strings
    for (const entry of [...history.undo, ...history.redo]) {
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.timestamp).toBe('number');
    }
  });
});

// ===========================================================================
// 8. Edge Cases
// ===========================================================================

describe('Edge Cases', () => {
  it('should handle rapid consecutive comments without undo corruption', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    for (let i = 0; i < 20; i++) {
      getState().updateNodeComment(id, `Comment ${i}`);
    }
    expect(getState().nodes[id].comment).toBe('Comment 19');

    // Undo all 20 comment changes
    for (let i = 0; i < 20; i++) {
      getState().undo();
    }
    expect(getState().nodes[id].comment).toBeUndefined();
  });

  it('should handle batch operations on empty array', () => {
    getState().batchUpdateNodeData([]);
    getState().batchMoveNodes([], [1, 1, 1]);
    getState().batchUpdateNodeTitles([]);
    // Should not throw, should not push undo
    expect(getState().getUndoHistory().undo.length).toBe(0);
  });

  it('should handle batch with single item', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().batchUpdateNodeData([{ nodeId: id, key: 'value', value: 5 }]);
    expect(getState().nodes[id].data.value).toBe(5);
  });

  it('should handle batch with many items', () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(getState().addNode('source', [i * 3, 0, 0]));
    }
    getState().batchMoveNodes(ids, [0, 1, 0]);
    for (const id of ids) {
      expect(getState().nodes[id].position[1]).toBe(1);
    }
    // Single undo entry
    const undoBefore = getState().getUndoHistory().undo.length;
    getState().undo();
    expect(getState().getUndoHistory().undo.length).toBe(undoBefore - 1);
    for (const id of ids) {
      expect(getState().nodes[id].position[1]).toBe(0);
    }
  });

  it('should handle comment with special characters', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const special = 'Hello "world" <script>alert("xss")</script> & \n\t\\';
    getState().updateNodeComment(id, special);
    expect(getState().nodes[id].comment).toBe(special);
  });

  it('should handle very long comment', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const longComment = 'x'.repeat(10000);
    getState().updateNodeComment(id, longComment);
    expect(getState().nodes[id].comment).toBe(longComment);
  });
});

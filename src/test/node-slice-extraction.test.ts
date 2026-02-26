/**
 * Node Slice Extraction Tests (~15 tests).
 *
 * Verifies that all node CRUD actions work correctly after extraction to nodeSlice.ts:
 * - addNode / removeNode lifecycle
 * - updateNodePosition / setNodePositions (hot-drag, no undo)
 * - updateNodeTitle / updateNodeComment / batchUpdateNodeTitles
 * - updateNodeData / batchUpdateNodeData (data mutation + cache invalidation)
 * - batchMoveNodes (nudge with undo)
 * - toggleNodeLock / batchToggleNodeLock / toggleNodeCollapse
 * - Locked node guards across all relevant actions
 * - Undo/redo preservation through node slice actions
 * - Batch operation atomicity
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

enableMapSet();

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionTimings = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

// ---------------------------------------------------------------------------
// 1. addNode / removeNode lifecycle
// ---------------------------------------------------------------------------

describe('Node slice: addNode / removeNode lifecycle', () => {
  beforeEach(resetStore);

  it('addNode creates node with correct type, title, and ports', () => {
    const id = getState().addNode('source', [1, 0, 2]);
    const node = getState().nodes[id];
    expect(node).toBeDefined();
    expect(node.type).toBe('source');
    expect(node.position).toEqual([1, 0, 2]);
    expect(node.inputs.length).toBeGreaterThanOrEqual(0);
    expect(node.outputs.length).toBeGreaterThan(0);
  });

  it('removeNode deletes node and cascades connection cleanup', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(a, 0, b, 0);
    expect(connId).toBeTruthy();
    expect(Object.keys(getState().connections)).toHaveLength(1);

    getState().removeNode(a);
    expect(getState().nodes[a]).toBeUndefined();
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('removeNode does not delete subgraph boundary nodes', () => {
    const id = getState().addNode('subgraph-input', [0, 0, 0]);
    getState().removeNode(id);
    // subgraph-input cannot be deleted
    expect(getState().nodes[id]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Position updates (no undo)
// ---------------------------------------------------------------------------

describe('Node slice: position updates', () => {
  beforeEach(resetStore);

  it('updateNodePosition updates position without pushing undo', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Clear the undo from addNode
    getState().undo();
    // Re-add so we have a node but clear undo state
    _resetModuleState();
    useEditorStore.setState(s => {
      s.nodes = {
        [id]: { id, type: 'source' as any, position: [0, 0, 0], title: 'Src', data: {}, inputs: [], outputs: [] },
      };
    });

    getState().updateNodePosition(id, [5, 0, 10]);
    expect(getState().nodes[id].position).toEqual([5, 0, 10]);
    expect(getState().canUndo()).toBe(false);
  });

  it('setNodePositions batch-updates multiple nodes in one call', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [1, 0, 1]);

    getState().setNodePositions({
      [a]: [10, 0, 10],
      [b]: [20, 0, 20],
    });

    expect(getState().nodes[a].position).toEqual([10, 0, 10]);
    expect(getState().nodes[b].position).toEqual([20, 0, 20]);
  });
});

// ---------------------------------------------------------------------------
// 3. Locked node guards
// ---------------------------------------------------------------------------

describe('Node slice: locked node guards', () => {
  beforeEach(resetStore);

  it('updateNodePosition skips locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);

    getState().updateNodePosition(id, [99, 0, 99]);
    expect(getState().nodes[id].position).toEqual([0, 0, 0]);
  });

  it('setNodePositions skips locked nodes in batch', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [1, 0, 1]);
    getState().toggleNodeLock(a);

    getState().setNodePositions({
      [a]: [99, 0, 99],
      [b]: [20, 0, 20],
    });

    expect(getState().nodes[a].position).toEqual([0, 0, 0]); // locked, not moved
    expect(getState().nodes[b].position).toEqual([20, 0, 20]); // unlocked, moved
  });

  it('removeNode is blocked for locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);

    getState().removeNode(id);
    expect(getState().nodes[id]).toBeDefined(); // still exists
  });

  it('updateNodeData is blocked for locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 42);
    getState().toggleNodeLock(id);

    getState().updateNodeData(id, 'value', 999);
    expect(getState().nodes[id].data.value).toBe(42); // unchanged
  });

  it('batchMoveNodes filters out locked nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 5]);
    getState().toggleNodeLock(a);

    getState().batchMoveNodes([a, b], [10, 0, 10]);

    expect(getState().nodes[a].position).toEqual([0, 0, 0]); // locked
    expect(getState().nodes[b].position).toEqual([15, 0, 15]); // moved
  });

  it('batchUpdateNodeTitles filters out locked nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [1, 0, 1]);
    getState().toggleNodeLock(a);

    getState().batchUpdateNodeTitles([
      { nodeId: a, title: 'Locked Title' },
      { nodeId: b, title: 'New Title' },
    ]);

    expect(getState().nodes[a].title).not.toBe('Locked Title');
    expect(getState().nodes[b].title).toBe('New Title');
  });
});

// ---------------------------------------------------------------------------
// 4. Undo/redo preservation
// ---------------------------------------------------------------------------

describe('Node slice: undo/redo preservation', () => {
  beforeEach(resetStore);

  it('addNode is undoable and redo restores it', () => {
    const id = getState().addNode('source', [3, 0, 3]);
    expect(getState().nodes[id]).toBeDefined();

    getState().undo();
    expect(getState().nodes[id]).toBeUndefined();

    getState().redo();
    expect(getState().nodes[id]).toBeDefined();
    expect(getState().nodes[id].position).toEqual([3, 0, 3]);
  });

  it('updateNodeData is undoable', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 100);
    expect(getState().nodes[id].data.value).toBe(100);

    getState().undo(); // undo updateNodeData
    expect(getState().nodes[id].data.value).toBeUndefined();
  });

  it('toggleNodeLock is undoable', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].locked).toBeFalsy();

    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);

    getState().undo();
    expect(getState().nodes[id].locked).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 5. Batch operation atomicity
// ---------------------------------------------------------------------------

describe('Node slice: batch operation atomicity', () => {
  beforeEach(resetStore);

  it('batchUpdateNodeData creates single undo entry for multiple updates', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [1, 0, 1]);

    getState().batchUpdateNodeData([
      { nodeId: a, key: 'value', value: 10 },
      { nodeId: b, key: 'value', value: 20 },
    ]);

    expect(getState().nodes[a].data.value).toBe(10);
    expect(getState().nodes[b].data.value).toBe(20);

    // Single undo should revert both
    getState().undo();
    expect(getState().nodes[a].data.value).toBeUndefined();
    expect(getState().nodes[b].data.value).toBeUndefined();
  });

  it('batchMoveNodes is atomic: single undo reverts all moved nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 5]);

    getState().batchMoveNodes([a, b], [1, 0, 1]);
    expect(getState().nodes[a].position).toEqual([1, 0, 1]);
    expect(getState().nodes[b].position).toEqual([6, 0, 6]);

    getState().undo(); // single undo reverts both
    expect(getState().nodes[a].position).toEqual([0, 0, 0]);
    expect(getState().nodes[b].position).toEqual([5, 0, 5]);
  });

  it('batchUpdateNodeData with all locked nodes is a no-op (no undo pushed)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(a);

    // Record undo history length
    const historyBefore = getState().getUndoHistory();
    const undoCountBefore = historyBefore.undo.length;

    getState().batchUpdateNodeData([{ nodeId: a, key: 'value', value: 999 }]);

    const historyAfter = getState().getUndoHistory();
    expect(historyAfter.undo.length).toBe(undoCountBefore); // no new undo entry
    expect(getState().nodes[a].data.value).toBeUndefined(); // unchanged
  });
});

// ---------------------------------------------------------------------------
// 6. toggleNodeCollapse and batchToggleNodeLock
// ---------------------------------------------------------------------------

describe('Node slice: collapse and batch lock', () => {
  beforeEach(resetStore);

  it('toggleNodeCollapse toggles collapsed flag', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].collapsed).toBeFalsy();

    getState().toggleNodeCollapse(id);
    expect(getState().nodes[id].collapsed).toBe(true);

    getState().toggleNodeCollapse(id);
    expect(getState().nodes[id].collapsed).toBeFalsy();
  });

  it('batchToggleNodeLock: locks all when any unlocked', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [1, 0, 1]);
    getState().toggleNodeLock(a); // a=locked, b=unlocked

    getState().batchToggleNodeLock([a, b]);
    // Any unlocked → lock all
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBe(true);
  });

  it('batchToggleNodeLock: unlocks all when all already locked', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [1, 0, 1]);
    getState().toggleNodeLock(a);
    getState().toggleNodeLock(b);
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBe(true);

    getState().batchToggleNodeLock([a, b]);
    // All locked → unlock all
    expect(getState().nodes[a].locked).toBeFalsy();
    expect(getState().nodes[b].locked).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// 7. updateNodeComment edge cases
// ---------------------------------------------------------------------------

describe('Node slice: updateNodeComment', () => {
  beforeEach(resetStore);

  it('sets and clears comment', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Hello world');
    expect(getState().nodes[id].comment).toBe('Hello world');

    getState().updateNodeComment(id, undefined);
    expect(getState().nodes[id].comment).toBeUndefined();
  });

  it('no-op guard: duplicate comment does not push undo', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'Same');

    const histBefore = getState().getUndoHistory().undo.length;
    getState().updateNodeComment(id, 'Same'); // same value
    const histAfter = getState().getUndoHistory().undo.length;
    expect(histAfter).toBe(histBefore);
  });

  it('blocked on locked node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);

    getState().updateNodeComment(id, 'Should not set');
    expect(getState().nodes[id].comment).toBeUndefined();
  });
});

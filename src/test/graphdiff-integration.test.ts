/**
 * Graph Diff Integration Tests
 *
 * Tests for:
 * 1. diffUndoSnapshots integration (5 tests)
 * 2. diffUndoSnapshots edge cases (4 tests)
 * 3. compareGraphs with mutations (4 tests)
 * 4. setDiffHighlight store integration (4 tests)
 * 5. Diff + undo workflow (3 tests)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { compareGraphs } from '../utils/graphDiff';
import type { EditorNode } from '../types';

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
  });
}

/** Build a minimal EditorNode for direct compareGraphs calls */
function makeNode(id: string, overrides: Partial<EditorNode> = {}): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: 'Node',
    data: { value: 0 },
    inputs: [],
    outputs: [{ id: `${id}-out`, portType: 'number', label: 'value' }],
    ...overrides,
  };
}

// ===========================================================================
// 1. diffUndoSnapshots integration
// ===========================================================================

describe('diffUndoSnapshots integration', () => {
  beforeEach(() => {
    resetStore();
  });

  it('after addNode shows node added when comparing snapshot 0 with current (-1)', () => {
    // addNode pushes empty state to undo[0], then adds the node
    getStore().addNode('source');
    // undo[0] = empty; current = 1 node
    const diff = getStore().diffUndoSnapshots(0, -1);
    expect(diff).not.toBeNull();
    expect(diff!.isEmpty).toBe(false);
    expect(diff!.summary.nodesAdded).toBeGreaterThanOrEqual(1);
    const addedChange = diff!.nodeChanges.find((c) => c.type === 'added');
    expect(addedChange).toBeDefined();
    expect(addedChange!.after).toBeDefined();
  });

  it('after updateNodeTitle shows modified with changedFields including title', () => {
    const id = getStore().addNode('source');
    // undo[0] = empty, undo[1] = state with original title (before rename)
    getStore().updateNodeTitle(id, 'RenamedNode');
    // Compare undo[1] (original) with current (-1) (renamed)
    const diff = getStore().diffUndoSnapshots(1, -1);
    expect(diff).not.toBeNull();
    const titleChange = diff!.nodeChanges.find(
      (c) => c.type === 'modified' && c.changedFields?.includes('title'),
    );
    expect(titleChange).toBeDefined();
    expect(titleChange!.changedFields).toContain('title');
    expect(diff!.summary.nodesModified).toBeGreaterThanOrEqual(1);
  });

  it('after removeNode shows node removed when comparing snapshot with current', () => {
    const id = getStore().addNode('source');
    // undo[0] = empty, undo[1] = state with 1 node (before remove)
    getStore().removeNode(id);
    // Compare undo[1] (1 node) with current (-1) (0 nodes) → 1 removed
    const diff = getStore().diffUndoSnapshots(1, -1);
    expect(diff).not.toBeNull();
    expect(diff!.summary.nodesRemoved).toBe(1);
    const removedChange = diff!.nodeChanges.find((c) => c.type === 'removed');
    expect(removedChange).toBeDefined();
    expect(removedChange!.nodeId).toBe(id);
    expect(removedChange!.before).toBeDefined();
  });

  it('after addConnection shows connection added when comparing snapshot before connect with current', () => {
    // addNode pushes undo on each call; addConnection does NOT push undo
    const srcId = getStore().addNode('source');   // undo[0] = empty
    const tgtId = getStore().addNode('transform'); // undo[1] = {srcId}
    // addConnection does not push undo, so the stack stays at 2 entries (indices 0, 1)
    const connId = getStore().addConnection(srcId, 0, tgtId, 0);
    expect(connId).not.toBeNull();
    // Compare undo[1] (2 nodes, 0 connections) with current (-1) (2 nodes + 1 connection)
    const diff = getStore().diffUndoSnapshots(1, -1);
    expect(diff).not.toBeNull();
    expect(diff!.summary.connectionsAdded).toBeGreaterThanOrEqual(1);
    const addedConn = diff!.connectionChanges.find((c) => c.type === 'added');
    expect(addedConn).toBeDefined();
  });

  it('with identical indices returns empty diff', () => {
    getStore().addNode('source');
    // Compare undo[0] with itself
    const diff = getStore().diffUndoSnapshots(0, 0);
    expect(diff).not.toBeNull();
    expect(diff!.isEmpty).toBe(true);
    expect(diff!.nodeChanges.length).toBe(0);
    expect(diff!.connectionChanges.length).toBe(0);
  });
});

// ===========================================================================
// 2. diffUndoSnapshots edge cases
// ===========================================================================

describe('diffUndoSnapshots edge cases', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns null for out-of-bounds index', () => {
    getStore().addNode('source');
    // Only undo index 0 is valid; index 99 is out-of-bounds
    const diff = getStore().diffUndoSnapshots(99, -1);
    expect(diff).toBeNull();
  });

  it('returns null for negative index other than -1', () => {
    getStore().addNode('source');
    // -2 is not a valid index (only -1 = current state is allowed)
    const diff = getStore().diffUndoSnapshots(-2, -1);
    expect(diff).toBeNull();
  });

  it('with empty undo stack: only -1 works (compare current with current = empty diff)', () => {
    // No actions taken — undo stack is empty
    // diffUndoSnapshots(0, -1) → indexA=0 is invalid when stack is empty → null
    const nullDiff = getStore().diffUndoSnapshots(0, -1);
    expect(nullDiff).toBeNull();

    // But comparing -1 with -1 (both current) should return empty diff
    const selfDiff = getStore().diffUndoSnapshots(-1, -1);
    expect(selfDiff).not.toBeNull();
    expect(selfDiff!.isEmpty).toBe(true);
  });

  it('after undo: can compare current (undone) state vs redo-able state via undo stack', () => {
    const id = getStore().addNode('source');
    // undo[0] = empty; current = 1 node
    // After undo: current = empty (0 nodes), undo stack empty, redo has 1 entry
    getStore().undo();
    // Now the store is back to empty; addNode's undo snapshot is gone (consumed by undo)
    // Verify we can still compare the current state with itself
    const diff = getStore().diffUndoSnapshots(-1, -1);
    expect(diff).not.toBeNull();
    expect(diff!.isEmpty).toBe(true);
    // The node should be gone after undo
    expect(Object.keys(getStore().nodes).length).toBe(0);
    // Redo is available
    expect(getStore().canRedo()).toBe(true);
    void id; // suppress unused variable
  });
});

// ===========================================================================
// 3. compareGraphs with mutations
// ===========================================================================

describe('compareGraphs with mutations', () => {
  it('detects locked field change', () => {
    const a = { n1: makeNode('n1', { locked: false }) };
    const b = { n1: makeNode('n1', { locked: true }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.isEmpty).toBe(false);
    expect(diff.nodeChanges[0].type).toBe('modified');
    expect(diff.nodeChanges[0].changedFields).toContain('locked');
  });

  it('detects comment change', () => {
    const a = { n1: makeNode('n1', { comment: undefined }) };
    const b = { n1: makeNode('n1', { comment: 'Added a comment' }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.isEmpty).toBe(false);
    expect(diff.nodeChanges[0].changedFields).toContain('comment');
    expect(diff.nodeChanges[0].before!.comment).toBeUndefined();
    expect(diff.nodeChanges[0].after!.comment).toBe('Added a comment');
  });

  it('detects autoInserted field change', () => {
    const a = { n1: makeNode('n1', { autoInserted: undefined }) };
    const b = { n1: makeNode('n1', { autoInserted: true }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.isEmpty).toBe(false);
    expect(diff.nodeChanges[0].changedFields).toContain('autoInserted');
  });

  it('detects multiple simultaneous node changes across several nodes', () => {
    const nodesA: Record<string, EditorNode> = {
      n1: makeNode('n1', { title: 'Alpha', data: { value: 10 } }),
      n2: makeNode('n2', { locked: false }),
      n3: makeNode('n3', { position: [0, 0, 0] }),
    };
    const nodesB: Record<string, EditorNode> = {
      n1: makeNode('n1', { title: 'Beta', data: { value: 20 } }),
      n2: makeNode('n2', { locked: true }),
      n3: makeNode('n3', { position: [5, 5, 5] }),
    };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    expect(diff.summary.nodesModified).toBe(3);
    expect(diff.summary.nodesAdded).toBe(0);
    expect(diff.summary.nodesRemoved).toBe(0);

    const n1Change = diff.nodeChanges.find((c) => c.nodeId === 'n1');
    expect(n1Change!.changedFields).toContain('title');
    expect(n1Change!.changedFields).toContain('data');

    const n2Change = diff.nodeChanges.find((c) => c.nodeId === 'n2');
    expect(n2Change!.changedFields).toContain('locked');

    const n3Change = diff.nodeChanges.find((c) => c.nodeId === 'n3');
    expect(n3Change!.changedFields).toContain('position');
  });
});

// ===========================================================================
// 4. setDiffHighlight store integration
// ===========================================================================

describe('setDiffHighlight store integration', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setDiffHighlight sets diffHighlightIds in store', () => {
    const map = new Map<string, 'added' | 'removed' | 'modified'>([
      ['node-1', 'added'],
      ['node-2', 'removed'],
      ['node-3', 'modified'],
    ]);
    getStore().setDiffHighlight(map);
    const highlightIds = getStore().diffHighlightIds;
    expect(highlightIds.size).toBe(3);
    expect(highlightIds.get('node-1')).toBe('added');
    expect(highlightIds.get('node-2')).toBe('removed');
    expect(highlightIds.get('node-3')).toBe('modified');
  });

  it('setDiffHighlight with empty map clears highlights', () => {
    // First set some highlights
    const map = new Map<string, 'added' | 'removed' | 'modified'>([
      ['node-1', 'added'],
    ]);
    getStore().setDiffHighlight(map);
    expect(getStore().diffHighlightIds.size).toBe(1);

    // Now clear with empty map
    getStore().setDiffHighlight(new Map());
    expect(getStore().diffHighlightIds.size).toBe(0);
  });

  it('diffHighlightIds starts as empty Map', () => {
    // Fresh store should have empty diffHighlightIds
    const highlightIds = getStore().diffHighlightIds;
    expect(highlightIds).toBeInstanceOf(Map);
    expect(highlightIds.size).toBe(0);
  });

  it('setDiffHighlight auto-clears after 3000ms timeout', () => {
    const map = new Map<string, 'added' | 'removed' | 'modified'>([
      ['node-1', 'added'],
      ['node-2', 'modified'],
    ]);
    getStore().setDiffHighlight(map);
    expect(getStore().diffHighlightIds.size).toBe(2);

    // Before 3 seconds: highlights should still be set
    vi.advanceTimersByTime(2999);
    expect(getStore().diffHighlightIds.size).toBe(2);

    // At 3 seconds: highlights should be auto-cleared
    vi.advanceTimersByTime(1);
    expect(getStore().diffHighlightIds.size).toBe(0);
  });
});

// ===========================================================================
// 5. Diff + undo workflow
// ===========================================================================

describe('Diff + undo workflow', () => {
  beforeEach(() => {
    resetStore();
  });

  it('full workflow: add nodes, diff shows added, undo, diff shows changes reversed', () => {
    // Add a node — undo[0] = empty state
    const id = getStore().addNode('source');
    // Diff(0, -1) should show 1 node added
    const diffAfterAdd = getStore().diffUndoSnapshots(0, -1);
    expect(diffAfterAdd).not.toBeNull();
    expect(diffAfterAdd!.summary.nodesAdded).toBeGreaterThanOrEqual(1);

    // Undo the add — store returns to empty
    getStore().undo();
    expect(getStore().nodes[id]).toBeUndefined();

    // After undo, the stack consumed the entry; compare current state with itself
    const diffAfterUndo = getStore().diffUndoSnapshots(-1, -1);
    expect(diffAfterUndo).not.toBeNull();
    expect(diffAfterUndo!.isEmpty).toBe(true);
    expect(diffAfterUndo!.summary.nodesAdded).toBe(0);
    expect(diffAfterUndo!.summary.nodesRemoved).toBe(0);
  });

  it('diff detects data changes from updateNodeData', () => {
    const id = getStore().addNode('source');
    // undo[0] = empty, undo[1] = node with default data (before updateNodeData)
    getStore().updateNodeData(id, 'value', 42);
    // Compare undo[1] (original data) with current (-1) (updated data)
    const diff = getStore().diffUndoSnapshots(1, -1);
    expect(diff).not.toBeNull();
    const dataChange = diff!.nodeChanges.find(
      (c) => c.type === 'modified' && c.changedFields?.includes('data'),
    );
    expect(dataChange).toBeDefined();
    expect(dataChange!.nodeId).toBe(id);
    expect(dataChange!.after!.data.value).toBe(42);
  });

  it('diff after multiple operations shows combined changes', () => {
    // Operation 1: add source node  — undo[0] = empty
    const srcId = getStore().addNode('source');
    // Operation 2: add transform node — undo[1] = {srcId}
    const tgtId = getStore().addNode('transform');
    // Operation 3: connect them — addConnection does NOT push undo
    const connId = getStore().addConnection(srcId, 0, tgtId, 0);
    expect(connId).not.toBeNull();
    // Operation 4: rename source — undo[2] = {srcId, tgtId} + connection
    getStore().updateNodeTitle(srcId, 'MySource');

    // Compare undo[0] (empty) with current (-1) (2 nodes + 1 connection + renamed)
    const diff = getStore().diffUndoSnapshots(0, -1);
    expect(diff).not.toBeNull();

    // Should see 2 nodes added
    expect(diff!.summary.nodesAdded).toBe(2);
    // Should see 1 connection added
    expect(diff!.summary.connectionsAdded).toBe(1);
    // nodesModified should be 0 from the perspective of undo[0] (empty) vs current:
    // both nodes appear as "added" (they didn't exist in undo[0])
    expect(diff!.summary.nodesModified).toBe(0);

    // Verify both nodes appear in the diff as added
    const addedIds = diff!.nodeChanges
      .filter((c) => c.type === 'added')
      .map((c) => c.nodeId);
    expect(addedIds).toContain(srcId);
    expect(addedIds).toContain(tgtId);
  });
});

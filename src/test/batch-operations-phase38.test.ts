/**
 * Batch operation tests (~20 tests).
 * Tests batchMoveNodes single/multi node, undo/redo atomicity, locked node handling,
 * batchUpdateNodeData, batchUpdateNodeTitles, and edge cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import type { EditorNode } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------
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
  });
}

function addTestNode(type: EditorNode['type'] = 'source', pos: [number, number, number] = [0, 0, 0], locked = false): string {
  useEditorStore.getState().addNode(type, pos);
  const allIds = Object.keys(useEditorStore.getState().nodes);
  const nodeId = allIds[allIds.length - 1];
  if (locked) {
    useEditorStore.getState().toggleNodeLock(nodeId);
  }
  return nodeId;
}

// ============================================================================
// batchMoveNodes
// ============================================================================
describe('batchMoveNodes', () => {
  beforeEach(() => resetStore());

  it('moves a single node by offset', () => {
    const id = addTestNode('source', [1, 0, 2]);
    useEditorStore.getState().batchMoveNodes([id], [3, 0, -1]);
    const pos = useEditorStore.getState().nodes[id].position;
    expect(pos[0]).toBe(4);
    expect(pos[1]).toBe(0);
    expect(pos[2]).toBe(1);
  });

  it('moves multiple nodes by same offset', () => {
    const id1 = addTestNode('source', [0, 0, 0]);
    const id2 = addTestNode('source', [5, 0, 5]);
    useEditorStore.getState().batchMoveNodes([id1, id2], [2, 1, 3]);

    const p1 = useEditorStore.getState().nodes[id1].position;
    const p2 = useEditorStore.getState().nodes[id2].position;
    expect(p1[0]).toBe(2);
    expect(p1[1]).toBe(1);
    expect(p1[2]).toBe(3);
    expect(p2[0]).toBe(7);
    expect(p2[1]).toBe(1);
    expect(p2[2]).toBe(8);
  });

  it('creates a single undo entry for batch move', () => {
    const id1 = addTestNode('source', [0, 0, 0]);
    const id2 = addTestNode('source', [5, 0, 5]);

    useEditorStore.getState().batchMoveNodes([id1, id2], [1, 0, 1]);

    // Should be able to undo
    expect(useEditorStore.getState().canUndo()).toBe(true);

    // Single undo should restore both nodes
    useEditorStore.getState().undo();
    const p1 = useEditorStore.getState().nodes[id1].position;
    const p2 = useEditorStore.getState().nodes[id2].position;
    expect(p1[0]).toBe(0);
    expect(p2[0]).toBe(5);
  });

  it('skips locked nodes', () => {
    const id1 = addTestNode('source', [0, 0, 0]);
    const idLocked = addTestNode('source', [5, 0, 5], true);

    useEditorStore.getState().batchMoveNodes([id1, idLocked], [10, 0, 10]);

    const p1 = useEditorStore.getState().nodes[id1].position;
    const pLocked = useEditorStore.getState().nodes[idLocked].position;
    expect(p1[0]).toBe(10);
    expect(pLocked[0]).toBe(5); // unchanged
  });

  it('no-op when all nodes are locked', () => {
    const id = addTestNode('source', [0, 0, 0], true);

    useEditorStore.getState().batchMoveNodes([id], [10, 0, 10]);

    const pos = useEditorStore.getState().nodes[id].position;
    expect(pos[0]).toBe(0); // unchanged
  });

  it('no-op for empty node list', () => {
    useEditorStore.getState().batchMoveNodes([], [10, 0, 10]);
    // Should not throw
  });

  it('no-op for nonexistent node IDs', () => {
    useEditorStore.getState().batchMoveNodes(['fake1', 'fake2'], [10, 0, 10]);
    // Should not throw
  });

  it('handles negative offsets', () => {
    const id = addTestNode('source', [5, 2, 5]);
    useEditorStore.getState().batchMoveNodes([id], [-3, -1, -2]);
    const pos = useEditorStore.getState().nodes[id].position;
    expect(pos[0]).toBe(2);
    expect(pos[1]).toBe(1);
    expect(pos[2]).toBe(3);
  });

  it('undo/redo round-trips correctly', () => {
    const id = addTestNode('source', [0, 0, 0]);
    useEditorStore.getState().batchMoveNodes([id], [5, 0, 5]);

    expect(useEditorStore.getState().nodes[id].position[0]).toBe(5);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().nodes[id].position[0]).toBe(0);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().nodes[id].position[0]).toBe(5);
  });
});

// ============================================================================
// batchUpdateNodeData
// ============================================================================
describe('batchUpdateNodeData', () => {
  beforeEach(() => resetStore());

  it('updates data on multiple nodes in one call', () => {
    const id1 = addTestNode('source');
    const id2 = addTestNode('source');

    useEditorStore.getState().batchUpdateNodeData(
      [{ nodeId: id1, key: 'value', value: 42 }, { nodeId: id2, key: 'value', value: 99 }]
    );

    expect(useEditorStore.getState().nodes[id1].data.value).toBe(42);
    expect(useEditorStore.getState().nodes[id2].data.value).toBe(99);
  });

  it('creates single undo entry for batch data update', () => {
    const id1 = addTestNode('source');
    const id2 = addTestNode('source');

    useEditorStore.getState().batchUpdateNodeData(
      [{ nodeId: id1, key: 'value', value: 42 }, { nodeId: id2, key: 'value', value: 99 }]
    );

    useEditorStore.getState().undo();

    // Both should be reverted
    expect(useEditorStore.getState().nodes[id1].data.value).toBeUndefined();
    expect(useEditorStore.getState().nodes[id2].data.value).toBeUndefined();
  });

  it('skips locked nodes', () => {
    const id1 = addTestNode('source');
    const idLocked = addTestNode('source', [0, 0, 0], true);

    useEditorStore.getState().batchUpdateNodeData(
      [{ nodeId: id1, key: 'value', value: 42 }, { nodeId: idLocked, key: 'value', value: 99 }]
    );

    expect(useEditorStore.getState().nodes[id1].data.value).toBe(42);
    expect(useEditorStore.getState().nodes[idLocked].data.value).toBeUndefined();
  });
});

// ============================================================================
// batchUpdateNodeTitles
// ============================================================================
describe('batchUpdateNodeTitles', () => {
  beforeEach(() => resetStore());

  it('renames multiple nodes in one call', () => {
    const id1 = addTestNode('source');
    const id2 = addTestNode('source');

    useEditorStore.getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'Alpha' },
      { nodeId: id2, title: 'Beta' },
    ]);

    expect(useEditorStore.getState().nodes[id1].title).toBe('Alpha');
    expect(useEditorStore.getState().nodes[id2].title).toBe('Beta');
  });

  it('creates single undo entry', () => {
    const id1 = addTestNode('source');
    const id2 = addTestNode('source');
    const orig1 = useEditorStore.getState().nodes[id1].title;
    const orig2 = useEditorStore.getState().nodes[id2].title;

    useEditorStore.getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'New1' },
      { nodeId: id2, title: 'New2' },
    ]);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().nodes[id1].title).toBe(orig1);
    expect(useEditorStore.getState().nodes[id2].title).toBe(orig2);
  });

  it('skips locked nodes', () => {
    const id1 = addTestNode('source');
    const idLocked = addTestNode('source', [0, 0, 0], true);

    useEditorStore.getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'Renamed' },
      { nodeId: idLocked, title: 'ShouldNotChange' },
    ]);

    expect(useEditorStore.getState().nodes[id1].title).toBe('Renamed');
    expect(useEditorStore.getState().nodes[idLocked].title).not.toBe('ShouldNotChange');
  });
});

// ============================================================================
// Mixed locked/unlocked selection operations
// ============================================================================
describe('batch operations with mixed locked/unlocked', () => {
  beforeEach(() => resetStore());

  it('batchMoveNodes moves only unlocked nodes in mixed selection', () => {
    const id1 = addTestNode('source', [0, 0, 0]);
    const id2 = addTestNode('source', [10, 0, 10], true);
    const id3 = addTestNode('source', [20, 0, 20]);

    useEditorStore.getState().batchMoveNodes([id1, id2, id3], [1, 0, 1]);

    expect(useEditorStore.getState().nodes[id1].position[0]).toBe(1);
    expect(useEditorStore.getState().nodes[id2].position[0]).toBe(10); // locked, unchanged
    expect(useEditorStore.getState().nodes[id3].position[0]).toBe(21);
  });
});

/**
 * Phase 34: Comprehensive graph diff tests
 *
 * Tests the graphDiff.ts utility for all node/connection field comparisons,
 * edge cases, and integration with the store's diffUndoSnapshots action.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { compareGraphs } from '../utils/graphDiff';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import type { EditorNode, Connection } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeConn(id: string, src: string, tgt: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: 0,
    targetNodeId: tgt,
    targetPortIndex: 0,
    ...overrides,
  };
}

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
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
  });
}

// ===========================================================================
// 1. Node field change detection
// ===========================================================================

describe('graph diff — node field detection', () => {
  it('detects type change', () => {
    const a = { n1: makeNode('n1', { type: 'source' }) };
    const b = { n1: makeNode('n1', { type: 'transform' }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('type');
  });

  it('detects title change', () => {
    const a = { n1: makeNode('n1', { title: 'Old' }) };
    const b = { n1: makeNode('n1', { title: 'New' }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('title');
  });

  it('detects position X change', () => {
    const a = { n1: makeNode('n1', { position: [0, 0, 0] }) };
    const b = { n1: makeNode('n1', { position: [5, 0, 0] }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('position');
  });

  it('detects position Y change', () => {
    const a = { n1: makeNode('n1', { position: [0, 0, 0] }) };
    const b = { n1: makeNode('n1', { position: [0, 3, 0] }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('position');
  });

  it('detects position Z change', () => {
    const a = { n1: makeNode('n1', { position: [0, 0, 0] }) };
    const b = { n1: makeNode('n1', { position: [0, 0, 7] }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('position');
  });

  it('detects data change', () => {
    const a = { n1: makeNode('n1', { data: { value: 1 } }) };
    const b = { n1: makeNode('n1', { data: { value: 2 } }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('data');
  });

  it('detects comment change', () => {
    const a = { n1: makeNode('n1', { comment: undefined }) };
    const b = { n1: makeNode('n1', { comment: 'a note' }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('comment');
  });

  it('detects locked change', () => {
    const a = { n1: makeNode('n1', { locked: false }) };
    const b = { n1: makeNode('n1', { locked: true }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('locked');
  });

  it('detects collapsed change', () => {
    const a = { n1: makeNode('n1', { collapsed: undefined }) };
    const b = { n1: makeNode('n1', { collapsed: true }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('collapsed');
  });

  it('detects groupId change', () => {
    const a = { n1: makeNode('n1', { groupId: undefined }) };
    const b = { n1: makeNode('n1', { groupId: 'g1' }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('groupId');
  });

  it('no changes when node is identical', () => {
    const node = makeNode('n1', { title: 'Test', position: [1, 2, 3], data: { value: 42 } });
    const diff = compareGraphs({ n1: node }, {}, { n1: node }, {});
    expect(diff.isEmpty).toBe(true);
  });

  it('reports multiple changed fields at once', () => {
    const a = { n1: makeNode('n1', { title: 'A', position: [0, 0, 0], data: { value: 1 } }) };
    const b = { n1: makeNode('n1', { title: 'B', position: [1, 1, 1], data: { value: 2 } }) };
    const diff = compareGraphs(a, {}, b, {});
    const fields = diff.nodeChanges[0].changedFields!;
    expect(fields).toContain('title');
    expect(fields).toContain('position');
    expect(fields).toContain('data');
    expect(fields).not.toContain('type'); // same type
  });
});

// ===========================================================================
// 2. Connection field change detection
// ===========================================================================

describe('graph diff — connection field detection', () => {
  it('detects label change', () => {
    const a = { c1: makeConn('c1', 'n1', 'n2') };
    const b = { c1: makeConn('c1', 'n1', 'n2', { label: 'data' }) };
    const diff = compareGraphs({}, a, {}, b);
    expect(diff.connectionChanges[0].changedFields).toContain('label');
  });

  it('detects colorOverride change', () => {
    const a = { c1: makeConn('c1', 'n1', 'n2') };
    const b = { c1: makeConn('c1', 'n1', 'n2', { colorOverride: '#ff0000' }) };
    const diff = compareGraphs({}, a, {}, b);
    expect(diff.connectionChanges[0].changedFields).toContain('colorOverride');
  });

  it('detects styleOverride change', () => {
    const a = { c1: makeConn('c1', 'n1', 'n2') };
    const b = { c1: makeConn('c1', 'n1', 'n2', { styleOverride: 'dashed' as any }) };
    const diff = compareGraphs({}, a, {}, b);
    expect(diff.connectionChanges[0].changedFields).toContain('styleOverride');
  });

  it('detects sourceNodeId change', () => {
    const a = { c1: makeConn('c1', 'n1', 'n3') };
    const b = { c1: makeConn('c1', 'n2', 'n3') };
    const diff = compareGraphs({}, a, {}, b);
    expect(diff.connectionChanges[0].changedFields).toContain('sourceNodeId');
  });

  it('detects targetNodeId change', () => {
    const a = { c1: makeConn('c1', 'n1', 'n2') };
    const b = { c1: makeConn('c1', 'n1', 'n3') };
    const diff = compareGraphs({}, a, {}, b);
    expect(diff.connectionChanges[0].changedFields).toContain('targetNodeId');
  });

  it('detects sourcePortIndex change', () => {
    const a = { c1: makeConn('c1', 'n1', 'n2', { sourcePortIndex: 0 }) };
    const b = { c1: makeConn('c1', 'n1', 'n2', { sourcePortIndex: 1 }) };
    const diff = compareGraphs({}, a, {}, b);
    expect(diff.connectionChanges[0].changedFields).toContain('sourcePortIndex');
  });

  it('detects targetPortIndex change', () => {
    const a = { c1: makeConn('c1', 'n1', 'n2', { targetPortIndex: 0 }) };
    const b = { c1: makeConn('c1', 'n1', 'n2', { targetPortIndex: 1 }) };
    const diff = compareGraphs({}, a, {}, b);
    expect(diff.connectionChanges[0].changedFields).toContain('targetPortIndex');
  });

  it('no changes when connection is identical', () => {
    const conn = makeConn('c1', 'n1', 'n2', { label: 'x', colorOverride: '#000' });
    const diff = compareGraphs({}, { c1: conn }, {}, { c1: conn });
    expect(diff.connectionChanges.length).toBe(0);
  });
});

// ===========================================================================
// 3. Add/remove detection
// ===========================================================================

describe('graph diff — add/remove', () => {
  it('detects single node addition', () => {
    const diff = compareGraphs({}, {}, { n1: makeNode('n1') }, {});
    expect(diff.summary.nodesAdded).toBe(1);
    expect(diff.nodeChanges[0].type).toBe('added');
    expect(diff.nodeChanges[0].after).toBeDefined();
    expect(diff.nodeChanges[0].before).toBeUndefined();
  });

  it('detects single node removal', () => {
    const diff = compareGraphs({ n1: makeNode('n1') }, {}, {}, {});
    expect(diff.summary.nodesRemoved).toBe(1);
    expect(diff.nodeChanges[0].type).toBe('removed');
    expect(diff.nodeChanges[0].before).toBeDefined();
    expect(diff.nodeChanges[0].after).toBeUndefined();
  });

  it('detects multiple additions and removals simultaneously', () => {
    const nodesA = { n1: makeNode('n1'), n2: makeNode('n2') };
    const nodesB = { n3: makeNode('n3'), n4: makeNode('n4'), n5: makeNode('n5') };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    expect(diff.summary.nodesRemoved).toBe(2); // n1, n2
    expect(diff.summary.nodesAdded).toBe(3);   // n3, n4, n5
  });

  it('detects connection addition', () => {
    const diff = compareGraphs({}, {}, {}, { c1: makeConn('c1', 'n1', 'n2') });
    expect(diff.summary.connectionsAdded).toBe(1);
  });

  it('detects connection removal', () => {
    const diff = compareGraphs({}, { c1: makeConn('c1', 'n1', 'n2') }, {}, {});
    expect(diff.summary.connectionsRemoved).toBe(1);
  });
});

// ===========================================================================
// 4. Edge cases
// ===========================================================================

describe('graph diff — edge cases', () => {
  it('empty A and empty B produce empty diff', () => {
    const diff = compareGraphs({}, {}, {}, {});
    expect(diff.isEmpty).toBe(true);
    expect(diff.summary.nodesAdded).toBe(0);
    expect(diff.summary.connectionsAdded).toBe(0);
  });

  it('comparing same object reference produces empty diff', () => {
    const nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    const conns = { c1: makeConn('c1', 'n1', 'n2') };
    const diff = compareGraphs(nodes, conns, nodes, conns);
    expect(diff.isEmpty).toBe(true);
  });

  it('large graph diff with 100 nodes', () => {
    const nodesA: Record<string, EditorNode> = {};
    const nodesB: Record<string, EditorNode> = {};
    for (let i = 0; i < 100; i++) {
      nodesA[`n${i}`] = makeNode(`n${i}`);
      nodesB[`n${i}`] = makeNode(`n${i}`, { title: `Modified ${i}` });
    }
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    expect(diff.summary.nodesModified).toBe(100);
    expect(diff.summary.nodesAdded).toBe(0);
    expect(diff.summary.nodesRemoved).toBe(0);
  });

  it('node with nested data objects', () => {
    const a = { n1: makeNode('n1', { data: { nested: { deep: { value: 1 } } } }) };
    const b = { n1: makeNode('n1', { data: { nested: { deep: { value: 2 } } } }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('data');
  });

  it('data with arrays detects changes', () => {
    const a = { n1: makeNode('n1', { data: { items: [1, 2, 3] } }) };
    const b = { n1: makeNode('n1', { data: { items: [1, 2, 4] } }) };
    const diff = compareGraphs(a, {}, b, {});
    expect(diff.nodeChanges[0].changedFields).toContain('data');
  });

  it('unchanged node among changed nodes is not reported', () => {
    const nodesA = {
      n1: makeNode('n1', { title: 'Unchanged' }),
      n2: makeNode('n2', { title: 'Old' }),
    };
    const nodesB = {
      n1: makeNode('n1', { title: 'Unchanged' }),
      n2: makeNode('n2', { title: 'New' }),
    };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    expect(diff.nodeChanges.length).toBe(1);
    expect(diff.nodeChanges[0].nodeId).toBe('n2');
  });

  it('before and after references are correct', () => {
    const a = { n1: makeNode('n1', { title: 'Before' }) };
    const b = { n1: makeNode('n1', { title: 'After' }) };
    const diff = compareGraphs(a, {}, b, {});
    const change = diff.nodeChanges[0];
    expect(change.before!.title).toBe('Before');
    expect(change.after!.title).toBe('After');
  });
});

// ===========================================================================
// 5. diffUndoSnapshots store integration
// ===========================================================================

describe('diffUndoSnapshots integration', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns null for invalid index when stack is empty', () => {
    expect(getStore().diffUndoSnapshots(0, -1)).toBeNull();
  });

  it('returns null for out-of-bounds index', () => {
    getStore().addNode('source');
    // Only 1 undo entry at index 0
    expect(getStore().diffUndoSnapshots(99, -1)).toBeNull();
  });

  it('compares undo snapshot with current state', () => {
    getStore().addNode('source');
    // undo[0] = empty state; current = 1 node
    const diff = getStore().diffUndoSnapshots(0, -1);
    expect(diff).not.toBeNull();
    expect(diff!.summary.nodesAdded).toBeGreaterThanOrEqual(1);
  });

  it('detects node deletion between snapshots', () => {
    const id = getStore().addNode('source');
    getStore().addNode('source');
    // undo stack: [0]=empty, [1]=1 node
    getStore().removeNode(id);
    // undo stack: [0]=empty, [1]=1 node, [2]=2 nodes
    // Compare undo[2] (2 nodes) with current (1 node) — 1 removed
    const diff = getStore().diffUndoSnapshots(2, -1);
    expect(diff).not.toBeNull();
    expect(diff!.summary.nodesRemoved).toBe(1);
  });

  it('detects title change between snapshots', () => {
    const id = getStore().addNode('source');
    // undo[0] = empty; now rename (pushes undo[1] = state with original title)
    getStore().updateNodeTitle(id, 'Moved');
    // Compare undo[1] (original title) with current (-1) (renamed)
    const diff = getStore().diffUndoSnapshots(1, -1);
    expect(diff).not.toBeNull();
    const titleChange = diff!.nodeChanges.find(
      c => c.type === 'modified' && c.changedFields?.includes('title'),
    );
    expect(titleChange).toBeDefined();
  });

  it('comparing same index returns empty diff', () => {
    getStore().addNode('source');
    const diff = getStore().diffUndoSnapshots(0, 0);
    expect(diff).not.toBeNull();
    expect(diff!.isEmpty).toBe(true);
  });

  it('works with multiple undo entries', () => {
    getStore().addNode('source');  // undo[0] = empty
    getStore().addNode('source');  // undo[1] = 1 node
    getStore().addNode('source');  // undo[2] = 2 nodes
    // Compare empty (0) with 2-node (2)
    const diff = getStore().diffUndoSnapshots(0, 2);
    expect(diff).not.toBeNull();
    expect(diff!.summary.nodesAdded).toBe(2);
  });
});

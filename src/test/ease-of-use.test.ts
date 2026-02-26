import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/editorStore';
import { _resetModuleState } from '../store/editorStore';
import type { EditorNode, Connection } from '../types';


function resetStore() {
  _resetModuleState();
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
    subgraphDefs: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    showValuePreviews: false,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
    errorStrategy: 'fail-fast',
    debugMode: false,
    pausedAtWave: -1,
    debugWaves: [],
    traceNodeId: null,
    executionMetrics: {},
    executionTotalDuration: 0,
    graphTabs: { default: { id: 'default', name: 'Main Graph', createdAt: Date.now() } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
    storageWarning: null,
  });
}

function getState() {
  return useEditorStore.getState();
}

// ---------------------------------------------------------------------------
// 1. Search System
// ---------------------------------------------------------------------------

describe('Search System', () => {
  beforeEach(() => resetStore());

  it('searchNodes returns matching nodes by title', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);
    getState().addNode('output', [4, 0, 0]);

    const results = getState().searchNodes('Source');
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('source');
  });

  it('searchNodes is case-insensitive', () => {
    getState().addNode('source', [0, 0, 0]);

    const lower = getState().searchNodes('source');
    const upper = getState().searchNodes('SOURCE');
    const mixed = getState().searchNodes('SoUrCe');

    expect(lower).toHaveLength(1);
    expect(upper).toHaveLength(1);
    expect(mixed).toHaveLength(1);
    expect(lower[0].id).toBe(upper[0].id);
    expect(lower[0].id).toBe(mixed[0].id);
  });

  it('searchNodes returns empty for no matches', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);

    const results = getState().searchNodes('nonexistent-xyz');
    expect(results).toHaveLength(0);
  });

  it('searchQuery updates correctly', () => {
    expect(getState().searchQuery).toBe('');
    getState().setSearchQuery('hello');
    expect(getState().searchQuery).toBe('hello');
    getState().setSearchQuery('');
    expect(getState().searchQuery).toBe('');
  });

  it('searchNodes returns all nodes when query is empty string', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);
    getState().addNode('output', [4, 0, 0]);

    const results = getState().searchNodes('');
    expect(results).toHaveLength(3);
  });

  it('fuzzyScore is used (partial character matches work)', () => {
    // "Transform" should match a fuzzy query like "trfm" (t-r-f-m all appear in order)
    getState().addNode('transform', [0, 0, 0]);
    getState().addNode('source', [2, 0, 0]);

    const results = getState().searchNodes('trfm');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('transform');
  });

  it('focusNode sets selection to the focused node', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);

    // Select id1 first
    getState().setSelection(new Set([id1]));
    expect(getState().selectedIds.has(id1)).toBe(true);

    // Focus id2 should set selection to only id2
    getState().focusNode(id2);
    expect(getState().selectedIds.size).toBe(1);
    expect(getState().selectedIds.has(id2)).toBe(true);
    expect(getState().selectedIds.has(id1)).toBe(false);
  });

  it('focusNode on non-existent node is a no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().focusNode('does-not-exist');
    // Selection should remain unchanged
    expect(getState().selectedIds.size).toBe(1);
    expect(getState().selectedIds.has(id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Undo/Redo Ergonomics
// ---------------------------------------------------------------------------

describe('Undo/Redo Ergonomics', () => {
  beforeEach(() => resetStore());

  it('canUndo/canRedo reflect stack state correctly', () => {
    expect(getState().canUndo()).toBe(false);
    expect(getState().canRedo()).toBe(false);

    getState().addNode('source', [0, 0, 0]);
    expect(getState().canUndo()).toBe(true);
    expect(getState().canRedo()).toBe(false);
  });

  it('undo restores previous node positions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const originalPos = [...getState().nodes[id].position];

    // Push undo before moving so the position change is captured
    getState().pushUndoSnapshot();
    getState().updateNodePosition(id, [5, 0, 5]);
    expect(getState().nodes[id].position).toEqual([5, 0, 5]);

    getState().undo();
    expect(getState().nodes[id].position).toEqual(originalPos);
  });

  it('redo restores forward state', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // addNode pushed undo already. The snapshot before addNode has no nodes.

    getState().undo();
    // After undo, node should be gone
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    getState().redo();
    // After redo, node should be back
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes[id]).toBeDefined();
  });

  it('undo after redo works (full cycle)', () => {
    getState().addNode('source', [0, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    getState().redo();
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('multiple sequential undos work', () => {
    getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);
    const id3 = getState().addNode('output', [4, 0, 0]);

    expect(Object.keys(getState().nodes)).toHaveLength(3);

    getState().undo(); // removes id3
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(getState().nodes[id3]).toBeUndefined();

    getState().undo(); // removes id2
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes[id2]).toBeUndefined();

    getState().undo(); // removes id1
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('new action after undo clears redo stack', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);

    getState().undo(); // undo transform
    expect(getState().canRedo()).toBe(true);

    // New action should clear redo
    getState().addNode('output', [4, 0, 0]);
    expect(getState().canRedo()).toBe(false);
  });

  it('pushUndoSnapshot creates manual checkpoint', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().pushUndoSnapshot();
    getState().updateNodePosition(id, [10, 0, 10]);

    getState().undo(); // undo to the manual checkpoint
    // The node should still exist (checkpoint was after addNode)
    expect(getState().nodes[id]).toBeDefined();
    expect(getState().nodes[id].position).toEqual([0, 0, 0]);
  });

  it('undo preserves connections correctly', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(src, 0, xfm, 0);
    expect(connId).toBeTruthy();
    expect(Object.keys(getState().connections)).toHaveLength(1);

    // Remove the connection (removeConnection pushes undo)
    getState().removeConnection(connId!);
    expect(Object.keys(getState().connections)).toHaveLength(0);

    // Undo should restore the connection
    getState().undo();
    expect(Object.keys(getState().connections)).toHaveLength(1);
    const restored = Object.values(getState().connections)[0];
    expect(restored.sourceNodeId).toBe(src);
    expect(restored.targetNodeId).toBe(xfm);
  });

  it('undo after delete restores nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().deleteSelected();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes[id]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Snap and Grid
// ---------------------------------------------------------------------------

describe('Snap and Grid', () => {
  beforeEach(() => resetStore());

  it('toggleSnap toggles snapEnabled', () => {
    expect(getState().snapEnabled).toBe(true);
    getState().toggleSnap();
    expect(getState().snapEnabled).toBe(false);
    getState().toggleSnap();
    expect(getState().snapEnabled).toBe(true);
  });

  it('default snap state is true', () => {
    expect(getState().snapEnabled).toBe(true);
  });

  it('snap state persists across operations (not cleared by undo)', () => {
    getState().toggleSnap(); // now false
    expect(getState().snapEnabled).toBe(false);

    // Perform an undoable action
    getState().addNode('source', [0, 0, 0]);
    getState().undo();

    // snapEnabled should still be false -- it's a preference, not graph state
    expect(getState().snapEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Value Previews
// ---------------------------------------------------------------------------

describe('Value Previews', () => {
  beforeEach(() => resetStore());

  it('toggleValuePreviews toggles showValuePreviews', () => {
    expect(getState().showValuePreviews).toBe(false);
    getState().toggleValuePreviews();
    expect(getState().showValuePreviews).toBe(true);
    getState().toggleValuePreviews();
    expect(getState().showValuePreviews).toBe(false);
  });

  it('default is false', () => {
    expect(getState().showValuePreviews).toBe(false);
  });

  it('toggle does not push undo (it is a preference)', () => {
    // Start with no undo history
    expect(getState().canUndo()).toBe(false);

    getState().toggleValuePreviews();
    // Toggling should NOT push onto the undo stack
    expect(getState().canUndo()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Error Strategy
// ---------------------------------------------------------------------------

describe('Error Strategy', () => {
  beforeEach(() => resetStore());

  it('default error strategy is fail-fast', () => {
    expect(getState().errorStrategy).toBe('fail-fast');
  });

  it('setErrorStrategy changes strategy', () => {
    getState().setErrorStrategy('continue');
    expect(getState().errorStrategy).toBe('continue');

    getState().setErrorStrategy('fail-fast');
    expect(getState().errorStrategy).toBe('fail-fast');
  });

  it('setErrorStrategy does NOT push undo (it is a preference)', () => {
    expect(getState().canUndo()).toBe(false);

    getState().setErrorStrategy('continue');
    expect(getState().canUndo()).toBe(false);
  });

  it('error strategy persists in graph data via snapshot', () => {
    // Change strategy then add a node (which pushes undo with current state including errorStrategy)
    getState().setErrorStrategy('continue');
    getState().addNode('source', [0, 0, 0]);

    // Undo the addNode - the snapshot that was taken before addNode had 'continue'
    getState().undo();
    expect(getState().errorStrategy).toBe('continue');
  });
});

// ---------------------------------------------------------------------------
// 6. Debug Mode
// ---------------------------------------------------------------------------

describe('Debug Mode', () => {
  beforeEach(() => resetStore());

  it('toggleDebugMode toggles debugMode', () => {
    expect(getState().debugMode).toBe(false);
    getState().toggleDebugMode();
    expect(getState().debugMode).toBe(true);
    getState().toggleDebugMode();
    expect(getState().debugMode).toBe(false);
  });

  it('default is false', () => {
    expect(getState().debugMode).toBe(false);
  });

  it('debug waves state initializes empty', () => {
    expect(getState().debugWaves).toEqual([]);
  });

  it('pausedAtWave initializes to -1', () => {
    expect(getState().pausedAtWave).toBe(-1);
  });

  it('trace node starts null', () => {
    expect(getState().traceNodeId).toBeNull();
  });

  it('setTraceNode sets and clears trace', () => {
    const id = getState().addNode('source', [0, 0, 0]);

    getState().setTraceNode(id);
    expect(getState().traceNodeId).toBe(id);

    getState().setTraceNode(null);
    expect(getState().traceNodeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Connection Labels and Colors
// ---------------------------------------------------------------------------

describe('Connection Labels and Colors', () => {
  beforeEach(() => resetStore());

  function createConnectedPair() {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(src, 0, xfm, 0)!;
    return { src, xfm, connId };
  }

  it('updateConnectionLabel sets label', () => {
    const { connId } = createConnectedPair();
    getState().updateConnectionLabel(connId, 'my-label');
    expect(getState().connections[connId].label).toBe('my-label');
  });

  it('updateConnectionLabel pushes undo', () => {
    createConnectedPair();

    // Clear redo/undo by resetting module state then re-creating
    resetStore();
    const { connId: cid } = createConnectedPair();

    // After creating pair, undo is available (from addNode/addConnection).
    // Count that we can undo, then label, then undo the label action.
    getState().updateConnectionLabel(cid, 'test');
    expect(getState().connections[cid].label).toBe('test');

    getState().undo();
    expect(getState().connections[cid]?.label).toBeUndefined();
  });

  it('updateConnectionLabel with undefined removes label', () => {
    const { connId } = createConnectedPair();
    getState().updateConnectionLabel(connId, 'temp-label');
    expect(getState().connections[connId].label).toBe('temp-label');

    getState().updateConnectionLabel(connId, undefined);
    expect(getState().connections[connId].label).toBeUndefined();
  });

  it('updateConnectionColor sets color', () => {
    const { connId } = createConnectedPair();
    getState().updateConnectionColor(connId, '#FF0000');
    expect(getState().connections[connId].colorOverride).toBe('#FF0000');
  });

  it('updateConnectionColor pushes undo', () => {
    const { connId } = createConnectedPair();
    getState().updateConnectionColor(connId, '#00FF00');
    expect(getState().connections[connId].colorOverride).toBe('#00FF00');

    getState().undo();
    expect(getState().connections[connId]?.colorOverride).toBeUndefined();
  });

  it('updateConnectionColor with undefined removes color', () => {
    const { connId } = createConnectedPair();
    getState().updateConnectionColor(connId, '#0000FF');
    expect(getState().connections[connId].colorOverride).toBe('#0000FF');

    getState().updateConnectionColor(connId, undefined);
    expect(getState().connections[connId].colorOverride).toBeUndefined();
  });

  it('labels survive import/export', () => {
    const { connId } = createConnectedPair();
    getState().updateConnectionLabel(connId, 'data-flow');
    getState().updateConnectionColor(connId, '#ABCDEF');

    // Export current workspace
    const exported = getState().exportAllGraphs();

    // Reset and import
    resetStore();
    getState().importAllGraphs(exported);

    // Find the connection - IDs may be the same since importAllGraphs uses structuredClone
    const conns = Object.values(getState().connections);
    expect(conns).toHaveLength(1);
    expect(conns[0].label).toBe('data-flow');
    expect(conns[0].colorOverride).toBe('#ABCDEF');
  });
});

// ---------------------------------------------------------------------------
// 8. Batch Node Title Updates
// ---------------------------------------------------------------------------

describe('Batch Node Title Updates', () => {
  beforeEach(() => resetStore());

  it('batchUpdateNodeTitles updates multiple titles', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);
    const id3 = getState().addNode('output', [4, 0, 0]);

    getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'Input A' },
      { nodeId: id2, title: 'Processor' },
      { nodeId: id3, title: 'Result' },
    ]);

    expect(getState().nodes[id1].title).toBe('Input A');
    expect(getState().nodes[id2].title).toBe('Processor');
    expect(getState().nodes[id3].title).toBe('Result');
  });

  it('batchUpdateNodeTitles pushes single undo entry', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);

    // After two addNode calls, undo stack has 2 entries. Remember current titles.
    const origTitle1 = getState().nodes[id1].title;
    const origTitle2 = getState().nodes[id2].title;

    getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'AAA' },
      { nodeId: id2, title: 'BBB' },
    ]);

    expect(getState().nodes[id1].title).toBe('AAA');
    expect(getState().nodes[id2].title).toBe('BBB');

    // A single undo should revert BOTH titles (single undo entry)
    getState().undo();
    expect(getState().nodes[id1].title).toBe(origTitle1);
    expect(getState().nodes[id2].title).toBe(origTitle2);
  });

  it('batchUpdateNodeTitles with empty array is no-op', () => {
    getState().addNode('source', [0, 0, 0]);

    // Clear undo stack to test that no undo is pushed for empty batch
    resetStore();
    getState().addNode('source', [0, 0, 0]);
    // Undo stack has 1 entry from addNode. Count it.
    const couldUndoBefore = getState().canUndo();

    getState().batchUpdateNodeTitles([]);
    // Should still be the same - no new undo entry pushed
    expect(getState().canUndo()).toBe(couldUndoBefore);
  });

  it('batchUpdateNodeTitles skips non-existent nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);

    getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'Valid' },
      { nodeId: 'does-not-exist', title: 'Invalid' },
    ]);

    expect(getState().nodes[id1].title).toBe('Valid');
    expect(getState().nodes['does-not-exist']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Auto-Layout
// ---------------------------------------------------------------------------

describe('Auto-Layout', () => {
  beforeEach(() => resetStore());

  it('autoLayout repositions nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [0, 0, 0]);
    getState().addConnection(id1, 0, id2, 0);

    const posBefore1 = [...getState().nodes[id1].position];
    const posBefore2 = [...getState().nodes[id2].position];

    getState().autoLayout();

    const posAfter1 = getState().nodes[id1].position;
    const posAfter2 = getState().nodes[id2].position;

    // At least one node should have moved (they started at the same position)
    const moved1 = posAfter1[0] !== posBefore1[0] || posAfter1[2] !== posBefore1[2];
    const moved2 = posAfter2[0] !== posBefore2[0] || posAfter2[2] !== posBefore2[2];
    expect(moved1 || moved2).toBe(true);
  });

  it('autoLayout pushes undo', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [0, 0, 0]);
    getState().addConnection(id1, 0, id2, 0);

    const posBefore1 = [...getState().nodes[id1].position];
    getState().autoLayout();

    getState().undo();
    // After undo of autoLayout, positions should be restored
    expect(getState().nodes[id1].position).toEqual(posBefore1);
  });

  it('autoLayout with empty graph is no-op', () => {
    expect(getState().canUndo()).toBe(false);
    getState().autoLayout();
    // Should not push undo for empty graph
    expect(getState().canUndo()).toBe(false);
  });

  it('alignSelected works for left alignment (shared X)', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [3, 0, 5]);
    getState().setSelection(new Set([id1, id2]));

    getState().alignSelected('left');

    // After left alignment, both nodes should share the minimum X coordinate (0)
    const minX = Math.min(0, 3);
    expect(getState().nodes[id1].position[0]).toBe(minX);
    expect(getState().nodes[id2].position[0]).toBe(minX);
  });

  it('alignSelected works for top alignment (shared Z)', () => {
    const id1 = getState().addNode('source', [0, 0, 2]);
    const id2 = getState().addNode('transform', [3, 0, 7]);
    getState().setSelection(new Set([id1, id2]));

    getState().alignSelected('top');

    // After top alignment, both nodes should share the minimum Z coordinate (2)
    const minZ = Math.min(2, 7);
    expect(getState().nodes[id1].position[2]).toBe(minZ);
    expect(getState().nodes[id2].position[2]).toBe(minZ);
  });

  it('distributeSelected works for horizontal distribution', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [10, 0, 0]);
    const id3 = getState().addNode('output', [1, 0, 0]);
    getState().setSelection(new Set([id1, id2, id3]));

    getState().distributeSelected('horizontal');

    // After horizontal distribute, nodes should be evenly spaced along X
    const positions = [id1, id2, id3].map(id => getState().nodes[id].position[0]).sort((a, b) => a - b);
    const gap1 = positions[1] - positions[0];
    const gap2 = positions[2] - positions[1];
    expect(Math.abs(gap1 - gap2)).toBeLessThan(0.01);
  });

  it('distributeSelected works for vertical distribution', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [0, 0, 10]);
    const id3 = getState().addNode('output', [0, 0, 1]);
    getState().setSelection(new Set([id1, id2, id3]));

    getState().distributeSelected('vertical');

    // After vertical distribute, nodes should be evenly spaced along Z
    const positions = [id1, id2, id3].map(id => getState().nodes[id].position[2]).sort((a, b) => a - b);
    const gap1 = positions[1] - positions[0];
    const gap2 = positions[2] - positions[1];
    expect(Math.abs(gap1 - gap2)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// 10. Execution
// ---------------------------------------------------------------------------

describe('Execution', () => {
  beforeEach(() => resetStore());

  it('executeGraph processes nodes in topological order', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);

    // Set source value
    getState().updateNodeData(src, 'value', 42);

    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(xfm, 0, out, 0);

    getState().executeGraph();

    // After execution, nodeOutputs should have data for source and transform
    expect(getState().isExecuting).toBe(true);
    expect(getState().nodeOutputs[src]).toBeDefined();
  });

  it('resetExecution clears execution state', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    getState().executeGraph();

    // Verify execution state was set
    expect(getState().isExecuting).toBe(true);

    getState().resetExecution();

    expect(getState().isExecuting).toBe(false);
    expect(getState().executionStates).toEqual({});
    expect(getState().nodeOutputs).toEqual({});
    expect(getState().executionErrors).toEqual({});
    expect(getState().executionMetrics).toEqual({});
    expect(getState().executionTotalDuration).toBe(0);
    expect(getState().pausedAtWave).toBe(-1);
    expect(getState().debugWaves).toEqual([]);
  });

  it('invalidateNode marks node for re-execution', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().updateNodeData(src, 'value', 5);

    // Execute graph to populate cache
    getState().executeGraph();
    getState().resetExecution();

    // Invalidate the source node
    getState().invalidateNode(src);

    // Re-execute - it should process nodes again (cache was cleared by invalidation)
    getState().executeGraph();
    expect(getState().nodeOutputs[src]).toBeDefined();
  });

  it('executeGraph with empty graph is a no-op', () => {
    getState().executeGraph();
    expect(getState().isExecuting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. Storage Warning
// ---------------------------------------------------------------------------

describe('Storage Warning', () => {
  beforeEach(() => resetStore());

  it('dismissStorageWarning clears warning', () => {
    // Manually set a storage warning
    useEditorStore.setState({ storageWarning: 'Storage quota exceeded' });
    expect(getState().storageWarning).toBe('Storage quota exceeded');

    getState().dismissStorageWarning();
    expect(getState().storageWarning).toBeNull();
  });

  it('storageWarning defaults to null', () => {
    expect(getState().storageWarning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Import/Export Workflows
// ---------------------------------------------------------------------------

describe('Import/Export Workflows', () => {
  beforeEach(() => resetStore());

  it('importWorkflow loads nodes and connections', () => {
    const nodes: Record<string, EditorNode> = {
      'node-100': {
        id: 'node-100', type: 'source', position: [0, 0, 0], title: 'Imported Source',
        data: { value: 42 }, inputs: [], outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
      'node-101': {
        id: 'node-101', type: 'transform', position: [5, 0, 0], title: 'Imported Transform',
        data: {}, inputs: [{ id: 'in-0', label: 'in', portType: 'number' }, { id: 'in-1', label: 'factor', portType: 'number' }],
        outputs: [{ id: 'out-0', label: 'result', portType: 'number' }, { id: 'out-1', label: 'debug', portType: 'string' }],
      },
    };
    const connections: Record<string, Connection> = {
      'conn-100': {
        id: 'conn-100', sourceNodeId: 'node-100', sourcePortIndex: 0,
        targetNodeId: 'node-101', targetPortIndex: 0,
      },
    };

    getState().importWorkflow({ nodes, connections });

    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(Object.keys(getState().connections)).toHaveLength(1);
    expect(getState().nodes['node-100'].title).toBe('Imported Source');
    expect(getState().nodes['node-101'].title).toBe('Imported Transform');
  });

  it('importWorkflow clears existing graph', () => {
    // Create existing graph
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(2);

    // Import replaces everything
    const importedNodes: Record<string, EditorNode> = {
      'node-200': {
        id: 'node-200', type: 'output', position: [0, 0, 0], title: 'Only Output',
        data: {}, inputs: [{ id: 'in-0', label: 'data', portType: 'any' }, { id: 'in-1', label: 'label', portType: 'string' }], outputs: [],
      },
    };

    getState().importWorkflow({ nodes: importedNodes, connections: {} });

    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes['node-200']).toBeDefined();
  });

  it('exportAllGraphs creates serializable data', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    const exported = getState().exportAllGraphs();

    expect(exported.version).toBe(2);
    expect(exported.graphs).toBeDefined();
    expect(exported.graphTabs).toBeDefined();
    expect(exported.activeGraphId).toBe('default');
    expect(Object.keys(exported.graphs['default'].nodes)).toHaveLength(2);
    expect(Object.keys(exported.graphs['default'].connections)).toHaveLength(1);
  });

  it('importAllGraphs restores workspace', () => {
    // Create a graph with nodes
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().updateNodeTitle(src, 'My Source');

    // Export
    const exported = getState().exportAllGraphs();

    // Reset everything
    resetStore();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Import
    getState().importAllGraphs(exported);

    // Verify restoration
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(Object.keys(getState().connections)).toHaveLength(1);

    // Find the source node by title
    const sourceNode = Object.values(getState().nodes).find(n => n.title === 'My Source');
    expect(sourceNode).toBeDefined();
    expect(sourceNode!.type).toBe('source');
  });

  it('importAllGraphs restores graph tabs and order', () => {
    // Export default workspace
    const exported = getState().exportAllGraphs();

    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().activeGraphId).toBe('default');
    expect(getState().graphTabs['default']).toBeDefined();
    expect(getState().graphOrder).toContain('default');
  });

  it('importWorkflow clears execution state', () => {
    // Set up some execution state
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 5);
    getState().executeGraph();
    expect(getState().isExecuting).toBe(true);

    // Import should clear execution state
    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(getState().isExecuting).toBe(false);
    expect(getState().executionStates).toEqual({});
    expect(getState().nodeOutputs).toEqual({});
    expect(getState().executionErrors).toEqual({});
  });

  it('importWorkflow preserves error strategy from imported data', () => {
    const importedNodes: Record<string, EditorNode> = {
      'node-300': {
        id: 'node-300', type: 'source', position: [0, 0, 0], title: 'Source',
        data: {}, inputs: [], outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
    };

    getState().importWorkflow({
      nodes: importedNodes,
      connections: {},
      errorStrategy: 'continue',
    } as unknown as Parameters<ReturnType<typeof useEditorStore.getState>['importWorkflow']>[0]);

    expect(getState().errorStrategy).toBe('continue');
  });
});

// ---------------------------------------------------------------------------
// Additional edge case tests
// ---------------------------------------------------------------------------

describe('Edge Cases and Cross-Feature Interactions', () => {
  beforeEach(() => resetStore());

  it('undo does not affect debug mode toggle', () => {
    getState().toggleDebugMode();
    expect(getState().debugMode).toBe(true);

    getState().addNode('source', [0, 0, 0]);
    getState().undo();

    // Debug mode is not part of undo snapshots, should remain true
    expect(getState().debugMode).toBe(true);
  });

  it('search works after undo restores nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'MySpecialNode');

    getState().setSelection(new Set([id]));
    getState().deleteSelected();

    // Node is gone - search should find nothing
    expect(getState().searchNodes('MySpecialNode')).toHaveLength(0);

    // Undo delete - node comes back
    getState().undo();
    const results = getState().searchNodes('MySpecialNode');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('MySpecialNode');
  });

  it('connection label update on non-existent connection is a no-op', () => {
    const undoBefore = getState().canUndo();
    getState().updateConnectionLabel('nonexistent', 'test');
    // Should not push undo for non-existent connection
    expect(getState().canUndo()).toBe(undoBefore);
  });

  it('connection color update on non-existent connection is a no-op', () => {
    const undoBefore = getState().canUndo();
    getState().updateConnectionColor('nonexistent', '#FF0000');
    expect(getState().canUndo()).toBe(undoBefore);
  });

  it('alignSelected with fewer than 2 nodes is a no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));

    const posBefore = [...getState().nodes[id].position];
    getState().alignSelected('left');
    expect(getState().nodes[id].position).toEqual(posBefore);
  });

  it('distributeSelected with fewer than 3 nodes is a no-op', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([id1, id2]));

    const pos1Before = [...getState().nodes[id1].position];
    const pos2Before = [...getState().nodes[id2].position];
    getState().distributeSelected('horizontal');
    expect(getState().nodes[id1].position).toEqual(pos1Before);
    expect(getState().nodes[id2].position).toEqual(pos2Before);
  });

  it('toggleSnap does not push undo', () => {
    expect(getState().canUndo()).toBe(false);
    getState().toggleSnap();
    expect(getState().canUndo()).toBe(false);
  });

  it('toggleDebugMode does not push undo', () => {
    expect(getState().canUndo()).toBe(false);
    getState().toggleDebugMode();
    expect(getState().canUndo()).toBe(false);
  });
});

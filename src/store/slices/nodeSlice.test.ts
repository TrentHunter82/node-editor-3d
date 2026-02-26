/**
 * Unit tests for nodeSlice — node CRUD, resize, batch operations, locking.
 * Tests use the full Zustand store to validate slice integration.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../editorStore';
import {
  MIN_NODE_WIDTH, MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT, MAX_NODE_HEIGHT,
} from './nodeSlice';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
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
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.searchHighlightIds = new Set();
    s.traceNodeId = null;
  });
}

function getState() { return useEditorStore.getState(); }

// ---------------------------------------------------------------------------
// addNode
// ---------------------------------------------------------------------------

describe('nodeSlice: addNode', () => {
  beforeEach(resetStore);

  it('creates a node with correct type and position', () => {
    const id = getState().addNode('source', [1, 0, 2]);
    const node = getState().nodes[id];
    expect(node).toBeDefined();
    expect(node.type).toBe('source');
    expect(node.position).toEqual([1, 0, 2]);
  });

  it('generates unique IDs', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [1, 0, 0]);
    expect(id1).not.toBe(id2);
  });

  it('creates node with correct ports based on NODE_TYPE_CONFIG', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.inputs.length).toBeGreaterThanOrEqual(0);
    expect(node.outputs.length).toBeGreaterThanOrEqual(1);
  });

  it('uses default position if not provided', () => {
    const id = getState().addNode('source');
    const node = getState().nodes[id];
    expect(node.position).toBeDefined();
    expect(node.position).toHaveLength(3);
  });

  it('pushes undo', () => {
    getState().addNode('source', [0, 0, 0]);
    expect(getState().canUndo()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeNode
// ---------------------------------------------------------------------------

describe('nodeSlice: removeNode', () => {
  beforeEach(resetStore);

  it('removes an existing node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id]).toBeDefined();
    getState().removeNode(id);
    expect(getState().nodes[id]).toBeUndefined();
  });

  it('removes connections attached to the node', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('output', [4, 0, 0]);
    getState().addConnection(src, 0, tgt, 0);
    expect(Object.keys(getState().connections).length).toBe(1);

    getState().removeNode(src);
    expect(Object.keys(getState().connections).length).toBe(0);
  });

  it('removes node from selectedIds', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    expect(getState().selectedIds.has(id)).toBe(true);

    getState().removeNode(id);
    expect(getState().selectedIds.has(id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resizeNode
// ---------------------------------------------------------------------------

describe('nodeSlice: resizeNode', () => {
  beforeEach(resetStore);

  it('sets width and height on the node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.0, 2.0);
    const node = getState().nodes[id];
    expect(node.width).toBe(3.0);
    expect(node.height).toBe(2.0);
  });

  it('clamps width to [MIN_NODE_WIDTH, MAX_NODE_WIDTH]', () => {
    const id = getState().addNode('source', [0, 0, 0]);

    getState().resizeNode(id, 0.1, 1.0); // below min
    expect(getState().nodes[id].width).toBe(MIN_NODE_WIDTH);

    getState().resizeNode(id, 100, 1.0); // above max
    expect(getState().nodes[id].width).toBe(MAX_NODE_WIDTH);
  });

  it('clamps height to [MIN_NODE_HEIGHT, MAX_NODE_HEIGHT]', () => {
    const id = getState().addNode('source', [0, 0, 0]);

    getState().resizeNode(id, 2.0, 0.1); // below min
    expect(getState().nodes[id].height).toBe(MIN_NODE_HEIGHT);

    getState().resizeNode(id, 2.0, 100); // above max
    expect(getState().nodes[id].height).toBe(MAX_NODE_HEIGHT);
  });

  it('pushes undo', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Clear undo from addNode
    _resetModuleState();

    getState().resizeNode(id, 3.0, 2.0);
    expect(getState().canUndo()).toBe(true);
  });

  it('is a no-op when size is unchanged', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // First resize to a specific size
    getState().resizeNode(id, 3.0, 2.0);
    _resetModuleState(); // clear undo stack

    // Resize to same size — should be no-op
    getState().resizeNode(id, 3.0, 2.0);
    expect(getState().canUndo()).toBe(false);
  });

  it('does not resize locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);

    getState().resizeNode(id, 5.0, 3.0);
    // Width/height should remain at default (undefined)
    expect(getState().nodes[id].width).toBeUndefined();
  });

  it('is undoable', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 2.5);
    expect(getState().nodes[id].width).toBe(4.0);

    getState().undo(); // undo resize
    expect(getState().nodes[id].width).toBeUndefined(); // back to default
  });
});

// ---------------------------------------------------------------------------
// setNodeSizes (batch, no undo)
// ---------------------------------------------------------------------------

describe('nodeSlice: setNodeSizes', () => {
  beforeEach(resetStore);

  it('sets sizes for multiple nodes in one call', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('math', [4, 0, 0]);

    getState().setNodeSizes({
      [a]: { width: 2.5, height: 1.5 },
      [b]: { width: 3.0, height: 2.0 },
    });

    expect(getState().nodes[a].width).toBe(2.5);
    expect(getState().nodes[a].height).toBe(1.5);
    expect(getState().nodes[b].width).toBe(3.0);
    expect(getState().nodes[b].height).toBe(2.0);
  });

  it('clamps values to valid range', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setNodeSizes({
      [id]: { width: 0.1, height: 100 },
    });
    expect(getState().nodes[id].width).toBe(MIN_NODE_WIDTH);
    expect(getState().nodes[id].height).toBe(MAX_NODE_HEIGHT);
  });

  it('does not resize locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);

    getState().setNodeSizes({
      [id]: { width: 4.0, height: 2.0 },
    });
    // Should remain at default
    expect(getState().nodes[id].width).toBeUndefined();
  });

  it('skips non-existent node IDs silently', () => {
    getState().setNodeSizes({
      'nonexistent': { width: 3.0, height: 2.0 },
    });
    // Should not throw
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateNodeTitle / batchUpdateNodeTitles
// ---------------------------------------------------------------------------

describe('nodeSlice: title operations', () => {
  beforeEach(resetStore);

  it('updateNodeTitle changes the node title', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'My Source');
    expect(getState().nodes[id].title).toBe('My Source');
  });

  it('updateNodeTitle pushes undo', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    _resetModuleState();
    getState().updateNodeTitle(id, 'New Title');
    expect(getState().canUndo()).toBe(true);
  });

  it('updateNodeTitle does not modify locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const origTitle = getState().nodes[id].title;
    getState().toggleNodeLock(id);
    getState().updateNodeTitle(id, 'Locked Title');
    expect(getState().nodes[id].title).toBe(origTitle);
  });

  it('batchUpdateNodeTitles updates multiple nodes at once', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('math', [4, 0, 0]);
    getState().batchUpdateNodeTitles([
      { nodeId: a, title: 'Source A' },
      { nodeId: b, title: 'Math B' },
    ]);
    expect(getState().nodes[a].title).toBe('Source A');
    expect(getState().nodes[b].title).toBe('Math B');
  });
});

// ---------------------------------------------------------------------------
// updateNodeData
// ---------------------------------------------------------------------------

describe('nodeSlice: updateNodeData', () => {
  beforeEach(resetStore);

  it('sets a key-value pair on node.data', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 42);
    expect(getState().nodes[id].data.value).toBe(42);
  });

  it('pushes undo', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    _resetModuleState();
    getState().updateNodeData(id, 'value', 10);
    expect(getState().canUndo()).toBe(true);
  });

  it('does not modify locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 5);
    getState().toggleNodeLock(id);
    getState().updateNodeData(id, 'value', 99);
    expect(getState().nodes[id].data.value).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// toggleNodeCollapse / toggleNodeLock
// ---------------------------------------------------------------------------

describe('nodeSlice: toggles', () => {
  beforeEach(resetStore);

  it('toggleNodeCollapse flips collapsed state', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].collapsed).toBeFalsy();

    getState().toggleNodeCollapse(id);
    expect(getState().nodes[id].collapsed).toBe(true);

    getState().toggleNodeCollapse(id);
    expect(getState().nodes[id].collapsed).toBe(false);
  });

  it('toggleNodeLock flips locked state', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].locked).toBeFalsy();

    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);

    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(false);
  });

  it('batchToggleNodeLock locks all specified nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('math', [4, 0, 0]);
    getState().batchToggleNodeLock([a, b]);
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateNodePosition / setNodePositions / batchMoveNodes
// ---------------------------------------------------------------------------

describe('nodeSlice: position operations', () => {
  beforeEach(resetStore);

  it('updateNodePosition moves a node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodePosition(id, [5, 0, 3]);
    expect(getState().nodes[id].position).toEqual([5, 0, 3]);
  });

  it('setNodePositions moves multiple nodes in one call', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('math', [1, 0, 0]);
    getState().setNodePositions({
      [a]: [10, 0, 10],
      [b]: [20, 0, 20],
    });
    expect(getState().nodes[a].position).toEqual([10, 0, 10]);
    expect(getState().nodes[b].position).toEqual([20, 0, 20]);
  });

  it('batchMoveNodes applies offset to multiple nodes', () => {
    const a = getState().addNode('source', [1, 0, 2]);
    const b = getState().addNode('math', [5, 0, 6]);
    getState().batchMoveNodes([a, b], [10, 0, 10]);
    expect(getState().nodes[a].position).toEqual([11, 0, 12]);
    expect(getState().nodes[b].position).toEqual([15, 0, 16]);
  });
});

// ---------------------------------------------------------------------------
// updateNodeComment
// ---------------------------------------------------------------------------

describe('nodeSlice: updateNodeComment', () => {
  beforeEach(resetStore);

  it('sets a comment on a node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'This is a comment');
    expect(getState().nodes[id].comment).toBe('This is a comment');
  });

  it('clears a comment with undefined', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeComment(id, 'A comment');
    getState().updateNodeComment(id, undefined);
    expect(getState().nodes[id].comment).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
  });
}

function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  while (getState().canRedo()) getState().redo();
  while (getState().canUndo()) getState().undo();
}

function getState() {
  return useEditorStore.getState();
}

beforeEach(() => {
  resetStore();
  drainUndoRedo();
});

// ===========================================================================
// clearGraph clears transient execution state
// ===========================================================================
describe('clearGraph clears transient state', () => {
  it('clears executionStates, nodeOutputs, executionErrors, isExecuting', () => {
    // Setup: add nodes and fake execution state
    const id = getState().addNode('source');
    useEditorStore.setState({
      executionStates: { [id]: 'running' },
      nodeOutputs: { [id]: { 0: 42 } },
      executionErrors: { [id]: 'some error' },
      isExecuting: true,
    });

    getState().clearGraph();

    const s = getState();
    expect(s.executionStates).toEqual({});
    expect(s.nodeOutputs).toEqual({});
    expect(s.executionErrors).toEqual({});
    expect(s.isExecuting).toBe(false);
    expect(Object.keys(s.nodes)).toHaveLength(0);
  });

  it('clears contextMenu on clearGraph', () => {
    getState().addNode('source');
    useEditorStore.setState({
      contextMenu: { x: 100, y: 200, target: { kind: 'canvas' } },
    });

    getState().clearGraph();
    expect(getState().contextMenu).toBeNull();
  });
});

// ===========================================================================
// importWorkflow clears transient execution state
// ===========================================================================
describe('importWorkflow clears transient state', () => {
  it('clears executionStates, nodeOutputs, executionErrors on import', () => {
    const id = getState().addNode('source');
    useEditorStore.setState({
      executionStates: { [id]: 'complete' },
      nodeOutputs: { [id]: { 0: 99 } },
      executionErrors: { [id]: 'old error' },
      isExecuting: true,
    });

    // Import a fresh workflow
    getState().importWorkflow({
      nodes: {
        'n1': { id: 'n1', type: 'source', position: [0, 0, 0], title: 'New', data: {}, inputs: [], outputs: [{ id: 'o0', label: 'v', portType: 'number' }] },
      },
      connections: {},
    });

    const s = getState();
    expect(s.executionStates).toEqual({});
    expect(s.nodeOutputs).toEqual({});
    expect(s.executionErrors).toEqual({});
    expect(s.isExecuting).toBe(false);
    expect(Object.keys(s.nodes)).toHaveLength(1);
    expect(s.nodes['n1']).toBeDefined();
  });

  it('clears contextMenu on importWorkflow', () => {
    getState().addNode('source');
    useEditorStore.setState({
      contextMenu: { x: 50, y: 50, target: { kind: 'canvas' } },
    });

    getState().importWorkflow({
      nodes: { 'n1': { id: 'n1', type: 'math', position: [0, 0, 0], title: 'M', data: {}, inputs: [{ id: 'i0', label: 'a', portType: 'number' }, { id: 'i1', label: 'b', portType: 'number' }], outputs: [{ id: 'o0', label: 'r', portType: 'number' }] } },
      connections: {},
    });

    expect(getState().contextMenu).toBeNull();
  });
});

// ===========================================================================
// undo/redo clears contextMenu and pendingConnection
// ===========================================================================
describe('undo/redo clears UI state', () => {
  it('undo clears contextMenu', () => {
    getState().addNode('source'); // pushes undo
    useEditorStore.setState({
      contextMenu: { x: 10, y: 20, target: { kind: 'canvas' } },
    });

    getState().undo();
    expect(getState().contextMenu).toBeNull();
  });

  it('undo clears pendingConnection', () => {
    getState().addNode('source');
    useEditorStore.setState({
      pendingConnection: { sourceNodeId: 'test', sourcePortIndex: 0, cursorPos: [0, 0, 0] },
    });

    getState().undo();
    expect(getState().pendingConnection).toBeNull();
  });

  it('undo resets interaction to idle', () => {
    getState().addNode('source');
    useEditorStore.setState({ interaction: 'drawing-connection' });

    getState().undo();
    expect(getState().interaction).toBe('idle');
  });

  it('redo clears contextMenu', () => {
    getState().addNode('source');
    getState().undo();
    useEditorStore.setState({
      contextMenu: { x: 10, y: 20, target: { kind: 'canvas' } },
    });

    getState().redo();
    expect(getState().contextMenu).toBeNull();
  });

  it('redo clears pendingConnection', () => {
    getState().addNode('source');
    getState().undo();
    useEditorStore.setState({
      pendingConnection: { sourceNodeId: 'test', sourcePortIndex: 0, cursorPos: [0, 0, 0] },
    });

    getState().redo();
    expect(getState().pendingConnection).toBeNull();
  });

  it('redo resets interaction to idle', () => {
    getState().addNode('source');
    getState().undo();
    useEditorStore.setState({ interaction: 'box-selecting' });

    getState().redo();
    expect(getState().interaction).toBe('idle');
  });
});

// ===========================================================================
// updateNodeData invalidates execution cache
// ===========================================================================
describe('updateNodeData invalidates cache', () => {
  it('re-executing after data change produces updated results', () => {
    // Create source → transform chain
    const srcId = getState().addNode('source', [0, 0, 0]);
    const txId = getState().addNode('transform', [3, 0, 0]);

    // Set source value
    getState().updateNodeData(srcId, 'value', 10);
    getState().updateNodeData(txId, 'multiplier', 2);

    // Connect source output 0 → transform input 0
    getState().addConnection(srcId, 0, txId, 0);

    // First execution
    getState().executeGraph();
    const output1 = getState().nodeOutputs[txId]?.[0];

    // Change multiplier - this should invalidate cache
    getState().updateNodeData(txId, 'multiplier', 5);

    // Re-execute
    getState().resetExecution();
    getState().executeGraph();
    const output2 = getState().nodeOutputs[txId]?.[0];

    // Results should differ because cache was invalidated
    // First: 10 * 2 = 20, Second: 10 * 5 = 50
    expect(output1).toBe(20);
    expect(output2).toBe(50);
  });
});

// ===========================================================================
// selectConnected
// ===========================================================================
describe('selectConnected', () => {
  // Helper to create a chain: A → B → C → D
  function createChain() {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('filter', [6, 0, 0]);
    const d = getState().addNode('output', [9, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);
    getState().addConnection(c, 0, d, 0);
    return { a, b, c, d };
  }

  it('selects downstream nodes from selected node', () => {
    const { a, b, c, d } = createChain();
    getState().setSelection(new Set([b]));

    getState().selectConnected('downstream');

    const sel = getState().selectedIds;
    expect(sel.has(b)).toBe(true);
    expect(sel.has(c)).toBe(true);
    expect(sel.has(d)).toBe(true);
    expect(sel.has(a)).toBe(false); // upstream not selected
  });

  it('selects upstream nodes from selected node', () => {
    const { a, b, c, d } = createChain();
    getState().setSelection(new Set([c]));

    getState().selectConnected('upstream');

    const sel = getState().selectedIds;
    expect(sel.has(a)).toBe(true);
    expect(sel.has(b)).toBe(true);
    expect(sel.has(c)).toBe(true);
    expect(sel.has(d)).toBe(false); // downstream not selected
  });

  it('selects both upstream and downstream with "both"', () => {
    const { a, b, c, d } = createChain();
    getState().setSelection(new Set([b]));

    getState().selectConnected('both');

    const sel = getState().selectedIds;
    expect(sel.has(a)).toBe(true);
    expect(sel.has(b)).toBe(true);
    expect(sel.has(c)).toBe(true);
    expect(sel.has(d)).toBe(true);
  });

  it('does nothing when no nodes are selected', () => {
    createChain();
    getState().setSelection(new Set());

    getState().selectConnected('downstream');
    expect(getState().selectedIds.size).toBe(0);
  });

  it('preserves existing selection (connections)', () => {
    const { a, b } = createChain();
    // Select a connection ID as well
    const connIds = Object.keys(getState().connections);
    getState().setSelection(new Set([a, connIds[0]]));

    getState().selectConnected('downstream');

    const sel = getState().selectedIds;
    expect(sel.has(connIds[0])).toBe(true); // connection preserved
    expect(sel.has(a)).toBe(true);
    expect(sel.has(b)).toBe(true);
  });

  it('handles disconnected nodes gracefully', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]); // no connection to a
    getState().setSelection(new Set([a]));

    getState().selectConnected('downstream');

    const sel = getState().selectedIds;
    expect(sel.has(a)).toBe(true);
    expect(sel.has(b)).toBe(false);
  });

  it('handles diamond graph (A → B, A → C, B → D, C → D)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, -2]);
    const c = getState().addNode('transform', [3, 0, 2]);
    const d = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(a, 0, c, 0);
    getState().addConnection(b, 0, d, 0);
    getState().addConnection(c, 0, d, 0);

    getState().setSelection(new Set([a]));
    getState().selectConnected('downstream');

    const sel = getState().selectedIds;
    expect(sel.has(a)).toBe(true);
    expect(sel.has(b)).toBe(true);
    expect(sel.has(c)).toBe(true);
    expect(sel.has(d)).toBe(true);
  });
});

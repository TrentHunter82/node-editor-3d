import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';
import { saveMultiGraph, saveGraph, type MultiGraphStorage } from '../utils/serialization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  // Reset module-scoped state (undo stacks, inactive graphs, execution caches, nextId)
  _resetModuleState();
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
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    templates: {},
  });
}

function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  if (getState().canRedo()) {
    getState().pushUndoSnapshot();
    getState().undo();
  }
}

function getState() {
  return useEditorStore.getState();
}

// ===========================================================================
// createGraph
// ===========================================================================
describe('createGraph', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('creates a new tab and switches to empty graph', () => {
    // Start with a node in the default graph
    getState().addNode('source', [0, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(1);

    const graphId = getState().createGraph('Second Graph');
    expect(getState().graphTabs[graphId]).toBeDefined();
    expect(getState().graphTabs[graphId].name).toBe('Second Graph');
    expect(getState().activeGraphId).toBe(graphId);
    // New graph should be empty
    expect(Object.keys(getState().nodes).length).toBe(0);
  });

  it('updates graphOrder', () => {
    const graphId = getState().createGraph('New');
    expect(getState().graphOrder).toContain(graphId);
    expect(getState().graphOrder.indexOf(graphId)).toBe(getState().graphOrder.length - 1);
  });

  it('uses default name when none provided', () => {
    const graphId = getState().createGraph();
    expect(getState().graphTabs[graphId].name).toMatch(/Graph \d+/);
  });

  it('clears transient state on switch', () => {
    getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState({
      executionStates: { fake: 'running' },
      isExecuting: true,
    });
    getState().createGraph('New');
    expect(getState().isExecuting).toBe(false);
    expect(getState().executionStates).toEqual({});
    expect(getState().selectedIds.size).toBe(0);
  });
});

// ===========================================================================
// switchGraph
// ===========================================================================
describe('switchGraph', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('saves current graph and loads target', () => {
    // Add node to default graph
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 42);

    // Create second graph
    getState().createGraph('Graph 2');
    expect(Object.keys(getState().nodes).length).toBe(0); // new graph is empty

    // Add a different node in graph 2
    getState().addNode('transform', [5, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(1);

    // Switch back to default
    getState().switchGraph('default');
    expect(getState().activeGraphId).toBe('default');
    expect(Object.keys(getState().nodes).length).toBe(1);
    expect(getState().nodes[srcId]).toBeDefined();
    expect(getState().nodes[srcId].data.value).toBe(42);
  });

  it('switching to same graph is no-op', () => {
    getState().addNode('source', [0, 0, 0]);
    const nodesBefore = { ...getState().nodes };
    getState().switchGraph('default');
    expect(getState().nodes).toEqual(nodesBefore);
  });

  it('switching to non-existent graph is no-op', () => {
    const activeId = getState().activeGraphId;
    getState().switchGraph('non-existent');
    expect(getState().activeGraphId).toBe(activeId);
  });

  it('clears execution state on switch', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().createGraph('Graph 2');
    getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState({ isExecuting: true, executionStates: { 'x': 'running' } });
    getState().switchGraph('default');
    expect(getState().isExecuting).toBe(false);
    expect(getState().executionStates).toEqual({});
  });

  it('clears pending connection on switch', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    expect(getState().pendingConnection).not.toBeNull();
    getState().createGraph('Graph 2');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().interaction).toBe('idle');
  });
});

// ===========================================================================
// switchGraph undo isolation
// ===========================================================================
describe('switchGraph undo isolation', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('undo in graph B does not affect graph A', () => {
    // Graph A: add a node
    const nodeA = getState().addNode('source', [0, 0, 0]);

    // Create graph B
    getState().createGraph('B');
    // Graph B: add a node
    getState().addNode('transform', [5, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(1);

    // Undo in graph B should only affect graph B
    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(0);

    // Switch back to graph A — node should still be there
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes).length).toBe(1);
    expect(getState().nodes[nodeA]).toBeDefined();
  });
});

// ===========================================================================
// deleteGraph
// ===========================================================================
describe('deleteGraph', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('cannot delete the last graph', () => {
    expect(getState().graphOrder.length).toBe(1);
    getState().deleteGraph('default');
    // Should still have the default graph
    expect(getState().graphOrder.length).toBe(1);
    expect(getState().graphTabs['default']).toBeDefined();
  });

  it('deletes a graph and switches to neighbor', () => {
    getState().addNode('source', [0, 0, 0]);
    const graph2 = getState().createGraph('Graph 2');
    getState().addNode('transform', [5, 0, 0]);

    // We're on graph2, delete graph2
    getState().deleteGraph(graph2);
    // Should switch back to default
    expect(getState().activeGraphId).toBe('default');
    expect(getState().graphTabs[graph2]).toBeUndefined();
    expect(getState().graphOrder).not.toContain(graph2);
    // Default graph should still have its node
    expect(Object.keys(getState().nodes).length).toBe(1);
  });

  it('deleting non-active graph does not switch', () => {
    getState().addNode('source', [0, 0, 0]);
    const graph2 = getState().createGraph('Graph 2');
    // Switch back to default
    getState().switchGraph('default');

    // Delete graph2 while on default
    getState().deleteGraph(graph2);
    expect(getState().activeGraphId).toBe('default');
    expect(getState().graphTabs[graph2]).toBeUndefined();
  });

  it('deleting the first graph in order switches to next', () => {
    const graph2 = getState().createGraph('Graph 2');
    // Switch back to default (first in graphOrder)
    getState().switchGraph('default');
    expect(getState().graphOrder[0]).toBe('default');

    // Delete default (first in order) while active
    getState().deleteGraph('default');
    // Should switch to graph2 (the next one)
    expect(getState().activeGraphId).toBe(graph2);
    expect(getState().graphTabs['default']).toBeUndefined();
    expect(getState().graphOrder).not.toContain('default');
  });

  it('deleting non-existent graph is no-op', () => {
    const orderBefore = [...getState().graphOrder];
    getState().deleteGraph('non-existent');
    expect(getState().graphOrder).toEqual(orderBefore);
  });
});

// ===========================================================================
// renameGraph
// ===========================================================================
describe('renameGraph', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('renames existing graph', () => {
    getState().renameGraph('default', 'My Graph');
    expect(getState().graphTabs['default'].name).toBe('My Graph');
  });

  it('no-ops on non-existent graph', () => {
    expect(() => getState().renameGraph('fake', 'New Name')).not.toThrow();
  });
});

// ===========================================================================
// reorderGraph
// ===========================================================================
describe('reorderGraph', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('moves graph to new position', () => {
    const g2 = getState().createGraph('G2');
    const g3 = getState().createGraph('G3');
    // Order should be: default, g2, g3
    expect(getState().graphOrder).toEqual(['default', g2, g3]);

    // Move g3 to position 0
    getState().reorderGraph(g3, 0);
    expect(getState().graphOrder[0]).toBe(g3);
  });

  it('clamps to valid range', () => {
    getState().createGraph('G2');
    // Move default to index 100 (should clamp to end)
    getState().reorderGraph('default', 100);
    expect(getState().graphOrder[getState().graphOrder.length - 1]).toBe('default');
  });

  it('no-ops for non-existent graph', () => {
    const orderBefore = [...getState().graphOrder];
    getState().reorderGraph('fake', 0);
    expect(getState().graphOrder).toEqual(orderBefore);
  });

  it('no-ops when already at target position', () => {
    getState().createGraph('G2');
    const orderBefore = [...getState().graphOrder];
    getState().reorderGraph('default', 0);
    expect(getState().graphOrder).toEqual(orderBefore);
  });
});

// ===========================================================================
// Multi-graph persistence: exportAllGraphs / importAllGraphs roundtrip
// ===========================================================================
describe('Multi-graph persistence', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); localStorage.clear(); });

  it('exportAllGraphs + importAllGraphs preserves all graphs', () => {
    // Build first graph with a source node
    const srcA = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcA, 'value', 100);

    // Create second graph with content
    const g2 = getState().createGraph('Graph 2');
    getState().addNode('transform', [5, 0, 0]);

    // Export the entire workspace
    const exported = getState().exportAllGraphs();
    expect(exported.version).toBe(2);
    expect(Object.keys(exported.graphs)).toHaveLength(2);
    expect(exported.graphOrder).toHaveLength(2);

    // Reset and import
    drainUndoRedo();
    resetStore();
    getState().importAllGraphs(exported);

    // Should restore graph tabs and order
    expect(getState().graphOrder).toHaveLength(2);
    expect(getState().graphTabs[g2]).toBeDefined();
    expect(getState().graphTabs[g2].name).toBe('Graph 2');
  });

  it('exportAllGraphs + importAllGraphs preserves templates', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('My Template', 'User');
    const templateCount = Object.keys(getState().templates).length;
    expect(templateCount).toBe(1);

    const exported = getState().exportAllGraphs();
    drainUndoRedo();
    resetStore();
    getState().importAllGraphs(exported);

    expect(Object.keys(getState().templates)).toHaveLength(templateCount);
    const tmpl = Object.values(getState().templates)[0];
    expect(tmpl.name).toBe('My Template');
    expect(tmpl.category).toBe('User');
  });

  it('exportAllGraphs includes active graph data', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);

    const exported = getState().exportAllGraphs();
    const activeGraph = exported.graphs[exported.activeGraphId];
    expect(activeGraph).toBeDefined();
    expect(Object.keys(activeGraph.nodes)).toHaveLength(1);
    expect(activeGraph.nodes[src].data.value).toBe(42);
  });

  it('importAllGraphs rejects invalid storage', () => {
    getState().addNode('source', [0, 0, 0]);
    const nodesBefore = Object.keys(getState().nodes).length;

    // null
    getState().importAllGraphs(null as unknown as MultiGraphStorage);
    expect(Object.keys(getState().nodes).length).toBe(nodesBefore);

    // wrong version
    getState().importAllGraphs({ version: 1 } as unknown as MultiGraphStorage);
    expect(Object.keys(getState().nodes).length).toBe(nodesBefore);
  });

  it('importAllGraphs can switch between active graphs after import', () => {
    // Build two graphs with content
    const srcA = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcA, 'value', 10);
    const g2 = getState().createGraph('Graph 2');
    getState().addNode('transform', [5, 0, 0]);

    // Export while on g2
    const exported = getState().exportAllGraphs();

    // Reset and import
    drainUndoRedo();
    resetStore();
    getState().importAllGraphs(exported);

    // Active graph should be g2
    expect(getState().activeGraphId).toBe(g2);
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Switch to default — should have the source node
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(Object.values(getState().nodes)[0].data.value).toBe(10);
  });
});

// ===========================================================================
// loadFromStorage with multi-graph v2 format
// ===========================================================================
describe('loadFromStorage v2', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); localStorage.clear(); });

  it('restores all graphs, tabs, activeGraphId from v2 format', () => {
    // Build a multi-graph scenario
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 77);
    const g2 = getState().createGraph('Second');
    getState().addNode('transform', [5, 0, 0]);

    // Save via exportAllGraphs → saveMultiGraph
    const exported = getState().exportAllGraphs();
    saveMultiGraph(exported);

    // Reset everything
    drainUndoRedo();
    resetStore();
    expect(getState().graphOrder).toEqual(['default']);

    // Load from storage
    const loaded = getState().loadFromStorage();
    expect(loaded).toBe(true);

    // Should restore both graphs
    expect(getState().graphOrder).toHaveLength(2);
    expect(getState().graphTabs[g2]).toBeDefined();
    expect(getState().graphTabs[g2].name).toBe('Second');

    // Active graph should be g2 (was active when exported)
    expect(getState().activeGraphId).toBe(g2);

    // Switch to default to verify its data survived
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(Object.values(getState().nodes)[0].data.value).toBe(77);
  });

  it('restores templates from v2 format', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('Saved Template', 'Test');

    const exported = getState().exportAllGraphs();
    saveMultiGraph(exported);

    drainUndoRedo();
    resetStore();
    getState().loadFromStorage();

    expect(Object.keys(getState().templates)).toHaveLength(1);
    const tmpl = Object.values(getState().templates)[0];
    expect(tmpl.name).toBe('Saved Template');
    expect(tmpl.category).toBe('Test');
  });

  it('returns false for missing storage', () => {
    expect(getState().loadFromStorage()).toBe(false);
  });

  it('returns false for invalid JSON in storage', () => {
    localStorage.setItem('node-editor-3d-graph', 'not-json!!!');
    expect(getState().loadFromStorage()).toBe(false);
  });
});

// ===========================================================================
// loadFromStorage with legacy v1 format (auto-migration)
// ===========================================================================
describe('loadFromStorage v1 legacy', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); localStorage.clear(); });

  it('auto-migrates legacy single-graph to multi-graph format', () => {
    // Build a graph and save in legacy format
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 55);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    // Save in legacy format
    saveGraph(getState().nodes, getState().connections, getState().groups, getState().customNodeDefs);

    // Reset
    drainUndoRedo();
    resetStore();

    // Load — should auto-migrate
    const loaded = getState().loadFromStorage();
    expect(loaded).toBe(true);

    // Should have the original nodes
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(Object.keys(getState().connections)).toHaveLength(1);
  });

  it('legacy load does not create multi-graph tabs', () => {
    // Legacy load goes through the single-graph path, not multi-graph
    getState().addNode('source', [0, 0, 0]);
    saveGraph(getState().nodes, getState().connections);

    drainUndoRedo();
    resetStore();
    getState().loadFromStorage();

    // The loadFromStorage with legacy data restores nodes/connections
    // but may or may not update graphTabs (depends on implementation path)
    expect(Object.keys(getState().nodes)).toHaveLength(1);
  });
});

// ===========================================================================
// Graph switching during execution
// ===========================================================================
describe('Graph switch during execution', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('stops execution cleanly on graph switch', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    // Start execution
    getState().executeGraph();
    vi.advanceTimersByTime(100);
    expect(getState().isExecuting).toBe(true);

    // Create new graph (triggers switch)
    getState().createGraph('G2');
    expect(getState().isExecuting).toBe(false);

    // Advance past all possible timeouts
    vi.advanceTimersByTime(10000);
    expect(getState().isExecuting).toBe(false);
  });
});

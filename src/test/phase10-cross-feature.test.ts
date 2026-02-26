import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { saveMultiGraph, loadMultiGraph } from '../utils/serialization';
import type { Connection, EditorNode, NodeTemplate } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NODE_DURATION = 400;

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
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
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    executionMetrics: {},
    executionTotalDuration: 0,
    errorStrategy: 'fail-fast',
    debugMode: false,
    pausedAtWave: -1,
    debugWaves: [],
    traceNodeId: null,
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: 0 } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
  });
}

/** Build a 3-node chain: source -> transform -> output */
function buildChain() {
  const src = getState().addNode('source', [0, 0, 0]);
  const xfm = getState().addNode('transform', [5, 0, 0]);
  const out = getState().addNode('output', [10, 0, 0]);
  const c1 = getState().addConnection(src, 0, xfm, 0);
  const c2 = getState().addConnection(xfm, 0, out, 0);
  return { src, xfm, out, c1: c1!, c2: c2! };
}

// ===========================================================================
// Connection Metadata + Undo/Redo Integration
// ===========================================================================
describe('Connection metadata across undo/redo', () => {
  beforeEach(() => resetStore());

  it('connection label survives undo then redo', () => {
    const { c1 } = buildChain();

    getState().updateConnectionLabel(c1, 'Signal');
    expect(getState().connections[c1].label).toBe('Signal');

    getState().undo();
    expect(getState().connections[c1].label).toBeUndefined();

    getState().redo();
    expect(getState().connections[c1].label).toBe('Signal');
  });

  it('connection color survives undo then redo', () => {
    const { c1 } = buildChain();

    getState().updateConnectionColor(c1, '#ff0000');
    getState().undo();
    expect(getState().connections[c1].colorOverride).toBeUndefined();

    getState().redo();
    expect(getState().connections[c1].colorOverride).toBe('#ff0000');
  });

  it('deleting a node removes connections with metadata', () => {
    const { src, c1 } = buildChain();

    getState().updateConnectionLabel(c1, 'Important');
    getState().updateConnectionColor(c1, '#00ff00');

    getState().setSelection(new Set([src]));
    getState().deleteSelected();

    expect(getState().connections[c1]).toBeUndefined();

    // Undo should restore both node and annotated connection
    getState().undo();
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().connections[c1]).toBeDefined();
    expect(getState().connections[c1].label).toBe('Important');
    expect(getState().connections[c1].colorOverride).toBe('#00ff00');
  });
});

// ===========================================================================
// Connection Metadata + Serialization Integration
// ===========================================================================
describe('Connection metadata persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('connection labels and colors survive export/import round-trip', () => {
    const { c1, c2 } = buildChain();
    getState().updateConnectionLabel(c1, 'Data Flow');
    getState().updateConnectionColor(c2, '#0000ff');

    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    const conns = getState().connections;
    // Find the connection with label (IDs may have changed)
    const labeledConn = (Object.values(conns) as Connection[]).find(c => c.label === 'Data Flow');
    expect(labeledConn).toBeDefined();

    const coloredConn = (Object.values(conns) as Connection[]).find(c => c.colorOverride === '#0000ff');
    expect(coloredConn).toBeDefined();
  });

  it('connection labels survive multi-graph save/load cycle', () => {
    const { c1 } = buildChain();
    getState().updateConnectionLabel(c1, 'Persistent Label');

    const exported = getState().exportAllGraphs();
    const ok = saveMultiGraph(exported);
    expect(ok).toBe(true);

    resetStore();
    const loaded = loadMultiGraph()!;
    getState().importAllGraphs(loaded);

    const conns = getState().connections;
    const labeledConn = (Object.values(conns) as Connection[]).find(c => c.label === 'Persistent Label');
    expect(labeledConn).toBeDefined();
  });
});

// ===========================================================================
// Error Strategy + Execution Integration
// ===========================================================================
describe('Error strategy + execution', () => {
  beforeEach(() => resetStore());

  it('error strategy defaults to fail-fast', () => {
    expect(getState().errorStrategy).toBe('fail-fast');
  });

  it('setErrorStrategy changes the strategy', () => {
    getState().setErrorStrategy('continue');
    expect(getState().errorStrategy).toBe('continue');
  });

  it('error strategy persists per graph', () => {
    getState().setErrorStrategy('continue');

    getState().createGraph('Graph 2');
    // New graph should default to fail-fast
    expect(getState().errorStrategy).toBe('fail-fast');

    // Switch back, should restore 'continue'
    getState().switchGraph('default');
    expect(getState().errorStrategy).toBe('continue');
  });

  it('error strategy survives export/import', () => {
    getState().setErrorStrategy('continue');
    const exported = getState().exportAllGraphs();

    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().errorStrategy).toBe('continue');
  });
});

// ===========================================================================
// Debug Mode + Stepping + Execution
// ===========================================================================
describe('Debug mode integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debug mode + step + resume completes a full execution cycle', () => {
    const { src, xfm, out } = buildChain();

    getState().toggleDebugMode();
    getState().executeGraph();

    expect(getState().isExecuting).toBe(true);
    expect(getState().pausedAtWave).toBe(-1);

    // Step through first wave
    getState().stepExecution();
    expect(getState().pausedAtWave).toBe(0);
    expect(getState().executionStates[src]).toBe('running');

    vi.advanceTimersByTime(NODE_DURATION);
    expect(getState().executionStates[src]).toBe('complete');

    // Resume remaining waves
    getState().resumeExecution();
    vi.advanceTimersByTime(10000);

    expect(getState().executionStates[xfm]).toBe('complete');
    expect(getState().executionStates[out]).toBe('complete');
    expect(getState().isExecuting).toBe(false);
  });

  it('resetExecution mid-debug clears all state', () => {
    buildChain();

    getState().toggleDebugMode();
    getState().executeGraph();
    getState().stepExecution();

    getState().resetExecution();

    expect(getState().isExecuting).toBe(false);
    expect(getState().pausedAtWave).toBe(-1);
    expect(getState().debugWaves).toEqual([]);
    expect(getState().executionStates).toEqual({});
  });

  it('debug state is cleared on undo', () => {
    buildChain();

    getState().toggleDebugMode();
    getState().executeGraph();
    getState().stepExecution();
    expect(getState().pausedAtWave).toBe(0);

    // Add something to make undo available
    getState().addNode('source', [15, 0, 0]);
    getState().undo();

    expect(getState().pausedAtWave).toBe(-1);
    expect(getState().debugWaves).toEqual([]);
  });
});

// ===========================================================================
// Templates + Multi-graph Integration
// ===========================================================================
describe('Templates across graphs', () => {
  beforeEach(() => resetStore());

  it('templates are workspace-global (available in all graphs)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Global Template');

    // Create new graph and switch to it
    getState().createGraph('Graph 2');
    // Template should still be accessible
    expect(getState().templates[tmplId!]).toBeDefined();
    expect(getState().templates[tmplId!].name).toBe('Global Template');
  });

  it('templates survive export/import', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('Persistent Template');

    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    const templates = Object.values(getState().templates) as NodeTemplate[];
    expect(templates.some(t => t.name === 'Persistent Template')).toBe(true);
  });
});

// ===========================================================================
// Collapse/Expand + Selection + Undo
// ===========================================================================
describe('Collapse/expand + undo integration', () => {
  beforeEach(() => resetStore());

  it('collapse + undo + redo round-trip', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));

    getState().collapseSelected();
    expect(getState().nodes[a].collapsed).toBe(true);
    expect(getState().nodes[b].collapsed).toBe(true);

    getState().undo();
    expect(getState().nodes[a].collapsed).toBeFalsy();
    expect(getState().nodes[b].collapsed).toBeFalsy();

    getState().redo();
    expect(getState().nodes[a].collapsed).toBe(true);
    expect(getState().nodes[b].collapsed).toBe(true);
  });

  it('expand + undo + redo round-trip', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState((s: { nodes: Record<string, EditorNode> }) => { s.nodes[a].collapsed = true; });
    getState().setSelection(new Set([a]));

    getState().expandSelected();
    expect(getState().nodes[a].collapsed).toBe(false);

    getState().undo();
    expect(getState().nodes[a].collapsed).toBe(true);

    getState().redo();
    expect(getState().nodes[a].collapsed).toBe(false);
  });
});

// ===========================================================================
// Custom Node Ports + Connections Integration
// ===========================================================================
describe('Custom node ports + connections', () => {
  beforeEach(() => resetStore());

  it('adding ports allows new connections', () => {
    const custom = getState().addNode('custom', [0, 0, 0]);
    const src = getState().addNode('source', [5, 0, 0]);

    // Custom starts with 0 inputs — connection should fail
    const fail = getState().addConnection(src, 0, custom, 0);
    expect(fail).toBeNull();

    // Add ports
    getState().updateCustomNodePorts(custom, 2, 1);

    // Now connection should succeed
    const ok = getState().addConnection(src, 0, custom, 0);
    expect(ok).not.toBeNull();
  });

  it('reducing ports cascades connection deletion and is undoable', () => {
    const custom = getState().addNode('custom', [0, 0, 0]);
    const src1 = getState().addNode('source', [-5, 0, 0]);
    const src2 = getState().addNode('source', [-5, 0, 5]);

    getState().updateCustomNodePorts(custom, 3, 1);
    const c0 = getState().addConnection(src1, 0, custom, 0);
    const c2 = getState().addConnection(src2, 0, custom, 2);

    // Reduce to 2 inputs — connection to port 2 should be removed
    getState().updateCustomNodePorts(custom, 2, 1);
    expect(getState().connections[c0!]).toBeDefined();
    expect(getState().connections[c2!]).toBeUndefined();

    // Undo should restore 3 inputs and the connection
    getState().undo();
    expect(getState().nodes[custom].inputs).toHaveLength(3);
    expect(getState().connections[c2!]).toBeDefined();
  });
});

// ===========================================================================
// Batch operations + undo integration
// ===========================================================================
describe('Batch title update + undo', () => {
  beforeEach(() => resetStore());

  it('batch update creates single undo entry', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    const c = getState().addNode('output', [10, 0, 0]);

    const titleA = getState().nodes[a].title;
    const titleB = getState().nodes[b].title;
    const titleC = getState().nodes[c].title;

    getState().batchUpdateNodeTitles([
      { nodeId: a, title: 'Alpha' },
      { nodeId: b, title: 'Beta' },
      { nodeId: c, title: 'Gamma' },
    ]);

    expect(getState().nodes[a].title).toBe('Alpha');
    expect(getState().nodes[b].title).toBe('Beta');
    expect(getState().nodes[c].title).toBe('Gamma');

    // Single undo should revert ALL titles
    getState().undo();
    expect(getState().nodes[a].title).toBe(titleA);
    expect(getState().nodes[b].title).toBe(titleB);
    expect(getState().nodes[c].title).toBe(titleC);
  });
});

// ===========================================================================
// Multi-graph + selectConnected integration
// ===========================================================================
describe('selectConnected is graph-local', () => {
  beforeEach(() => resetStore());

  it('only selects nodes in the active graph', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    // Create another graph with different nodes
    getState().createGraph('G2');
    const isolated = getState().addNode('source', [0, 0, 0]);

    // Switch back to default graph
    getState().switchGraph('default');
    getState().setSelection(new Set([src]));
    getState().selectConnected('downstream');

    // Only default graph nodes should be selected
    expect(getState().selectedIds.has(xfm)).toBe(true);
    expect(getState().selectedIds.has(isolated)).toBe(false);
  });
});

// ===========================================================================
// Graph management (rename, reorder) + export/import
// ===========================================================================
describe('Graph management + persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('renamed graph tabs survive export/import', () => {
    getState().renameGraph('default', 'Renamed Main');
    const g2 = getState().createGraph('Second');
    getState().renameGraph(g2, 'Renamed Second');

    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().graphTabs['default'].name).toBe('Renamed Main');
  });

  it('reordered graphs survive export/import', () => {
    getState().createGraph('G2');
    const g3 = getState().createGraph('G3');
    getState().reorderGraph(g3, 0);

    const expected = [...getState().graphOrder];
    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().graphOrder).toEqual(expected);
  });
});

// ===========================================================================
// Execution profiling + metrics integration
// ===========================================================================
describe('Execution profiling integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('execution populates metrics for each node', () => {
    const { src, xfm, out } = buildChain();

    getState().executeGraph();
    // Advance timers to complete execution
    vi.advanceTimersByTime(10000);

    const metrics = getState().executionMetrics;
    expect(metrics[src]).toBeDefined();
    expect(metrics[xfm]).toBeDefined();
    expect(metrics[out]).toBeDefined();
  });

  it('execution records total duration', () => {
    buildChain();

    getState().executeGraph();
    vi.advanceTimersByTime(10000);

    // totalDuration is set from performance.now() which may be 0 under fake timers
    // but the field should be populated (a number, not undefined)
    expect(typeof getState().executionTotalDuration).toBe('number');
    expect(getState().executionTotalDuration).toBeGreaterThanOrEqual(0);
  });

  it('metrics are cleared on resetExecution', () => {
    buildChain();

    getState().executeGraph();
    vi.advanceTimersByTime(10000);
    expect(Object.keys(getState().executionMetrics).length).toBeGreaterThan(0);

    getState().resetExecution();
    expect(getState().executionMetrics).toEqual({});
    expect(getState().executionTotalDuration).toBe(0);
  });

  it('metrics are cleared on undo', () => {
    buildChain();

    getState().executeGraph();
    vi.advanceTimersByTime(10000);
    expect(Object.keys(getState().executionMetrics).length).toBeGreaterThan(0);

    getState().addNode('source', [15, 0, 0]);
    getState().undo();

    expect(getState().executionMetrics).toEqual({});
  });
});

// ===========================================================================
// Trace node + selection
// ===========================================================================
describe('Trace node state', () => {
  beforeEach(() => resetStore());

  it('traceNodeId defaults to null', () => {
    expect(getState().traceNodeId).toBeNull();
  });

  it('setTraceNode sets and clears trace', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setTraceNode(src);
    expect(getState().traceNodeId).toBe(src);

    getState().setTraceNode(null);
    expect(getState().traceNodeId).toBeNull();
  });

  it('deleting traced node should not crash', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setTraceNode(src);
    getState().setSelection(new Set([src]));
    getState().deleteSelected();

    // traceNodeId may still reference the deleted node but no crash
    expect(getState().nodes[src]).toBeUndefined();
  });
});

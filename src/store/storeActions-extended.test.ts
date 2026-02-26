import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    customNodeDefs: {},
    subgraphDefs: {},
    contextMenu: null,
    validationErrors: {},
    showValuePreviews: false,
  });
}

/** Drain all undo entries so canUndo() === false — call after setup that uses addNode etc. */
function drainUndo() {
  _resetModuleState();
}

// ===========================================================================
// collapseSelected / expandSelected
// ===========================================================================
describe('collapseSelected', () => {
  beforeEach(() => resetStore());

  it('collapses all selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));

    getState().collapseSelected();

    expect(getState().nodes[a].collapsed).toBe(true);
    expect(getState().nodes[b].collapsed).toBe(true);
  });

  it('skips nodes already collapsed', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    // Manually collapse a first
    useEditorStore.setState(s => { s.nodes[a].collapsed = true; });
    getState().setSelection(new Set([a, b]));

    getState().collapseSelected();

    expect(getState().nodes[a].collapsed).toBe(true);
    expect(getState().nodes[b].collapsed).toBe(true);
  });

  it('no-ops when nothing is selected', () => {
    getState().addNode('source', [0, 0, 0]);
    // Empty selection
    getState().setSelection(new Set());
    drainUndo(); // addNode pushes undo — drain before testing no-op

    getState().collapseSelected();
    // Should not push undo
    expect(getState().canUndo()).toBe(false);
  });

  it('no-ops when all selected nodes are already collapsed', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState(s => { s.nodes[a].collapsed = true; });
    getState().setSelection(new Set([a]));
    drainUndo(); // addNode pushes undo — drain before testing no-op

    getState().collapseSelected();
    // Should not push undo since no actual change
    expect(getState().canUndo()).toBe(false);
  });

  it('pushes undo when collapsing', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));

    getState().collapseSelected();
    expect(getState().canUndo()).toBe(true);

    getState().undo();
    expect(getState().nodes[a].collapsed).toBeFalsy();
  });

  it('ignores invalid IDs in selection', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a, 'nonexistent-99']));

    getState().collapseSelected();
    expect(getState().nodes[a].collapsed).toBe(true);
  });
});

describe('expandSelected', () => {
  beforeEach(() => resetStore());

  it('expands all selected collapsed nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    useEditorStore.setState(s => {
      s.nodes[a].collapsed = true;
      s.nodes[b].collapsed = true;
    });
    getState().setSelection(new Set([a, b]));

    getState().expandSelected();

    expect(getState().nodes[a].collapsed).toBe(false);
    expect(getState().nodes[b].collapsed).toBe(false);
  });

  it('no-ops when no selected nodes are collapsed', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));

    // Node is not collapsed, so expandSelected should be a no-op
    getState().expandSelected();
    expect(getState().nodes[a].collapsed).toBeFalsy();
  });

  it('no-ops when nothing is selected', () => {
    getState().setSelection(new Set());
    getState().expandSelected();
    expect(getState().canUndo()).toBe(false);
  });

  it('pushes undo when expanding', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState(s => { s.nodes[a].collapsed = true; });
    getState().setSelection(new Set([a]));

    getState().expandSelected();
    expect(getState().canUndo()).toBe(true);

    getState().undo();
    expect(getState().nodes[a].collapsed).toBe(true);
  });
});

// ===========================================================================
// selectConnected
// ===========================================================================
describe('selectConnected', () => {
  beforeEach(() => resetStore());

  it('selects downstream nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(xfm, 0, out, 0);

    getState().setSelection(new Set([src]));
    getState().selectConnected('downstream');

    const sel = getState().selectedIds;
    expect(sel.has(src)).toBe(true);
    expect(sel.has(xfm)).toBe(true);
    expect(sel.has(out)).toBe(true);
  });

  it('selects upstream nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(xfm, 0, out, 0);

    getState().setSelection(new Set([out]));
    getState().selectConnected('upstream');

    const sel = getState().selectedIds;
    expect(sel.has(src)).toBe(true);
    expect(sel.has(xfm)).toBe(true);
    expect(sel.has(out)).toBe(true);
  });

  it('selects both directions', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(xfm, 0, out, 0);

    getState().setSelection(new Set([xfm]));
    getState().selectConnected('both');

    const sel = getState().selectedIds;
    expect(sel.has(src)).toBe(true);
    expect(sel.has(xfm)).toBe(true);
    expect(sel.has(out)).toBe(true);
  });

  it('does not select unconnected nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const isolated = getState().addNode('source', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    getState().setSelection(new Set([src]));
    getState().selectConnected('downstream');

    expect(getState().selectedIds.has(xfm)).toBe(true);
    expect(getState().selectedIds.has(isolated)).toBe(false);
  });

  it('no-ops when selection is empty', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set());

    getState().selectConnected('downstream');
    expect(getState().selectedIds.size).toBe(0);
  });

  it('preserves existing selection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const isolated = getState().addNode('source', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    // Select both src and isolated, then select connected downstream
    getState().setSelection(new Set([src, isolated]));
    getState().selectConnected('downstream');

    const sel = getState().selectedIds;
    expect(sel.has(src)).toBe(true);
    expect(sel.has(xfm)).toBe(true);
    // isolated should remain in selection since it was already selected
    expect(sel.has(isolated)).toBe(true);
  });

  it('handles diamond graph correctly', () => {
    // Diamond: src → xfm1 → merge, src → xfm2 → merge
    // math node has 2 number inputs — perfect for diamond convergence
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm1 = getState().addNode('transform', [5, 0, 0]);
    const xfm2 = getState().addNode('transform', [5, 0, 5]);
    const merge = getState().addNode('math', [10, 0, 0]);
    expect(getState().addConnection(src, 0, xfm1, 0)).not.toBeNull();
    expect(getState().addConnection(src, 0, xfm2, 0)).not.toBeNull();
    expect(getState().addConnection(xfm1, 0, merge, 0)).not.toBeNull();
    expect(getState().addConnection(xfm2, 0, merge, 1)).not.toBeNull();

    getState().setSelection(new Set([src]));
    getState().selectConnected('downstream');

    const sel = getState().selectedIds;
    expect(sel.has(xfm1)).toBe(true);
    expect(sel.has(xfm2)).toBe(true);
    expect(sel.has(merge)).toBe(true);
  });
});

// ===========================================================================
// renameGraph
// ===========================================================================
describe('renameGraph', () => {
  beforeEach(() => resetStore());

  it('renames the default graph', () => {
    getState().renameGraph('default', 'My Graph');
    expect(getState().graphTabs['default'].name).toBe('My Graph');
  });

  it('no-ops for nonexistent graphId', () => {
    const tabsBefore = { ...getState().graphTabs };
    getState().renameGraph('nonexistent', 'Ghost');
    expect(getState().graphTabs).toEqual(tabsBefore);
  });

  it('renames a non-default graph', () => {
    const newId = getState().createGraph('Temp');
    getState().renameGraph(newId, 'Renamed');
    expect(getState().graphTabs[newId].name).toBe('Renamed');
  });

  it('allows empty name', () => {
    getState().renameGraph('default', '');
    expect(getState().graphTabs['default'].name).toBe('');
  });
});

// ===========================================================================
// reorderGraph
// ===========================================================================
describe('reorderGraph', () => {
  beforeEach(() => resetStore());

  it('reorders a graph to a new position', () => {
    const g1 = getState().createGraph('G1');
    const g2 = getState().createGraph('G2');
    // graphOrder should be ['default', g1, g2]
    expect(getState().graphOrder).toEqual(['default', g1, g2]);

    // Move g2 to index 0
    getState().reorderGraph(g2, 0);
    expect(getState().graphOrder).toEqual([g2, 'default', g1]);
  });

  it('no-ops for nonexistent graphId', () => {
    const before = [...getState().graphOrder];
    getState().reorderGraph('nonexistent', 0);
    expect(getState().graphOrder).toEqual(before);
  });

  it('no-ops when graph is already at target index', () => {
    getState().createGraph('G1');
    const before = [...getState().graphOrder];
    getState().reorderGraph('default', 0);
    expect(getState().graphOrder).toEqual(before);
  });

  it('clamps newIndex to valid range', () => {
    const g1 = getState().createGraph('G1');
    // graphOrder: ['default', g1]
    getState().reorderGraph('default', 100);
    expect(getState().graphOrder).toEqual([g1, 'default']);
  });

  it('clamps negative newIndex to 0', () => {
    const g1 = getState().createGraph('G1');
    // graphOrder: ['default', g1]
    getState().reorderGraph(g1, -5);
    expect(getState().graphOrder).toEqual([g1, 'default']);
  });
});

// ===========================================================================
// batchUpdateNodeTitles
// ===========================================================================
describe('batchUpdateNodeTitles', () => {
  beforeEach(() => resetStore());

  it('updates multiple node titles in one operation', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);

    getState().batchUpdateNodeTitles([
      { nodeId: a, title: 'Alpha' },
      { nodeId: b, title: 'Beta' },
    ]);

    expect(getState().nodes[a].title).toBe('Alpha');
    expect(getState().nodes[b].title).toBe('Beta');
  });

  it('pushes only one undo entry for batch', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);

    getState().batchUpdateNodeTitles([
      { nodeId: a, title: 'Alpha' },
      { nodeId: b, title: 'Beta' },
    ]);

    expect(getState().canUndo()).toBe(true);
    getState().undo();

    // Both titles should revert
    expect(getState().nodes[a].title).not.toBe('Alpha');
    expect(getState().nodes[b].title).not.toBe('Beta');
  });

  it('skips invalid nodeIds gracefully', () => {
    const a = getState().addNode('source', [0, 0, 0]);

    getState().batchUpdateNodeTitles([
      { nodeId: a, title: 'Valid' },
      { nodeId: 'nonexistent-99', title: 'Ghost' },
    ]);

    expect(getState().nodes[a].title).toBe('Valid');
  });

  it('no-ops when all nodeIds are invalid', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const titleBefore = getState().nodes[a].title;

    getState().batchUpdateNodeTitles([
      { nodeId: 'ghost-1', title: 'A' },
      { nodeId: 'ghost-2', title: 'B' },
    ]);

    // No node titles should change
    expect(getState().nodes[a].title).toBe(titleBefore);
  });

  it('no-ops for empty updates array', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const titleBefore = getState().nodes[a].title;
    getState().batchUpdateNodeTitles([]);
    // No node titles should change
    expect(getState().nodes[a].title).toBe(titleBefore);
  });
});

// ===========================================================================
// startConnection
// ===========================================================================
describe('startConnection', () => {
  beforeEach(() => resetStore());

  it('sets interaction to drawing-connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);

    getState().startConnection(src, 0);

    expect(getState().interaction).toBe('drawing-connection');
  });

  it('creates pendingConnection with correct source info', () => {
    const src = getState().addNode('source', [0, 0, 0]);

    getState().startConnection(src, 0);

    const pc = getState().pendingConnection;
    expect(pc).not.toBeNull();
    expect(pc!.sourceNodeId).toBe(src);
    expect(pc!.sourcePortIndex).toBe(0);
  });

  it('initializes cursor position to source node position', () => {
    const src = getState().addNode('source', [3, 1, 4]);

    getState().startConnection(src, 0);

    expect(getState().pendingConnection!.cursorPos).toEqual([3, 1, 4]);
  });

  it('no-ops for nonexistent node', () => {
    getState().startConnection('nonexistent', 0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('no-ops for out-of-bounds port index', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    // Source has 2 outputs (index 0, 1), so index 5 is out of bounds
    getState().startConnection(src, 5);
    expect(getState().interaction).toBe('idle');
  });

  it('no-ops for negative port index', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, -1);
    expect(getState().interaction).toBe('idle');
  });
});

// ===========================================================================
// updateCustomNodePorts
// ===========================================================================
describe('updateCustomNodePorts', () => {
  beforeEach(() => resetStore());

  it('sets port counts on a custom node', () => {
    const id = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(id, 2, 3);

    const node = getState().nodes[id];
    expect(node.inputs).toHaveLength(2);
    expect(node.outputs).toHaveLength(3);
    expect(node.data.inputCount).toBe(2);
    expect(node.data.outputCount).toBe(3);
  });

  it('generates correct port labels', () => {
    const id = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(id, 2, 2);

    const node = getState().nodes[id];
    expect(node.inputs[0].label).toBe('in0');
    expect(node.inputs[1].label).toBe('in1');
    expect(node.outputs[0].label).toBe('out0');
    expect(node.outputs[1].label).toBe('out1');
  });

  it('clamps input count to 0-8', () => {
    const id = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(id, 20, 1);
    expect(getState().nodes[id].inputs).toHaveLength(8);

    getState().updateCustomNodePorts(id, -5, 1);
    expect(getState().nodes[id].inputs).toHaveLength(0);
  });

  it('clamps output count to 1-8', () => {
    const id = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(id, 1, 20);
    expect(getState().nodes[id].outputs).toHaveLength(8);

    getState().updateCustomNodePorts(id, 1, 0);
    // Output minimum is 1
    expect(getState().nodes[id].outputs).toHaveLength(1);
  });

  it('removes connections to deleted ports', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const custom = getState().addNode('custom', [5, 0, 0]);
    getState().updateCustomNodePorts(custom, 3, 1);

    // Connect to input port 2
    const connId = getState().addConnection(src, 0, custom, 2);
    expect(connId).not.toBeNull();

    // Reduce inputs to 2 — port index 2 no longer exists
    getState().updateCustomNodePorts(custom, 2, 1);

    expect(getState().connections[connId!]).toBeUndefined();
  });

  it('preserves connections to surviving ports', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const custom = getState().addNode('custom', [5, 0, 0]);
    getState().updateCustomNodePorts(custom, 3, 1);

    const connId = getState().addConnection(src, 0, custom, 0);
    expect(connId).not.toBeNull();

    // Reduce inputs to 2 — port 0 still exists
    getState().updateCustomNodePorts(custom, 2, 1);
    expect(getState().connections[connId!]).toBeDefined();
  });

  it('no-ops for non-custom node types', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const inputsBefore = getState().nodes[src].inputs.length;
    const outputsBefore = getState().nodes[src].outputs.length;

    getState().updateCustomNodePorts(src, 5, 5);

    expect(getState().nodes[src].inputs).toHaveLength(inputsBefore);
    expect(getState().nodes[src].outputs).toHaveLength(outputsBefore);
  });

  it('no-ops for nonexistent node', () => {
    getState().updateCustomNodePorts('nonexistent', 3, 3);
    // Should not throw
  });

  it('pushes undo', () => {
    const id = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(id, 3, 2);
    expect(getState().canUndo()).toBe(true);

    getState().undo();
    // Back to original state (custom nodes start with 0 inputs, 1 output)
    expect(getState().nodes[id].data.inputCount).not.toBe(3);
  });
});

// ===========================================================================
// saveSelectionAsTemplate
// ===========================================================================
describe('saveSelectionAsTemplate', () => {
  beforeEach(() => resetStore());

  it('creates a template from selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().setSelection(new Set([a, b]));

    const tmplId = getState().saveSelectionAsTemplate('My Template');
    expect(tmplId).not.toBeNull();

    const tmpl = getState().templates[tmplId!];
    expect(tmpl).toBeDefined();
    expect(tmpl.name).toBe('My Template');
    expect(tmpl.nodes).toHaveLength(2);
    expect(tmpl.connections).toHaveLength(1);
  });

  it('uses default category "User"', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));

    const tmplId = getState().saveSelectionAsTemplate('Test');
    expect(getState().templates[tmplId!].category).toBe('User');
  });

  it('uses custom category when provided', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));

    const tmplId = getState().saveSelectionAsTemplate('Test', 'Math');
    expect(getState().templates[tmplId!].category).toBe('Math');
  });

  it('returns null when nothing is selected', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set());

    const result = getState().saveSelectionAsTemplate('Empty');
    expect(result).toBeNull();
  });

  it('only includes connections between selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    const c = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);

    // Only select a and b — the b->c connection should be excluded
    getState().setSelection(new Set([a, b]));
    const tmplId = getState().saveSelectionAsTemplate('Partial');
    const tmpl = getState().templates[tmplId!];

    expect(tmpl.nodes).toHaveLength(2);
    expect(tmpl.connections).toHaveLength(1);
  });

  it('deep-clones node data', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(a, 'value', 42);
    getState().setSelection(new Set([a]));

    const tmplId = getState().saveSelectionAsTemplate('DataTest');
    const tmpl = getState().templates[tmplId!];

    // Modify original node data
    getState().updateNodeData(a, 'value', 99);

    // Template should not be affected
    expect(tmpl.nodes[0].data.value).toBe(42);
  });

  it('records createdAt timestamp', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));

    const before = Date.now();
    const tmplId = getState().saveSelectionAsTemplate('Timestamped');
    const after = Date.now();

    const createdAt = getState().templates[tmplId!].createdAt;
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
  });
});

// ===========================================================================
// importTemplates
// ===========================================================================
describe('importTemplates', () => {
  beforeEach(() => resetStore());

  it('merges templates into store', () => {
    const templates = {
      't1': {
        id: 't1',
        name: 'Imported',
        category: 'External',
        nodes: [],
        connections: [],
        createdAt: 0,
      },
    };

    getState().importTemplates(templates);
    expect(getState().templates['t1']).toBeDefined();
    expect(getState().templates['t1'].name).toBe('Imported');
  });

  it('overwrites existing template with same id', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));
    const tmplId = getState().saveSelectionAsTemplate('Original');

    getState().importTemplates({
      [tmplId!]: {
        id: tmplId!,
        name: 'Overwritten',
        category: 'Test',
        nodes: [],
        connections: [],
        createdAt: 0,
      },
    });

    expect(getState().templates[tmplId!].name).toBe('Overwritten');
  });

  it('preserves existing templates not in import', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));
    const existingId = getState().saveSelectionAsTemplate('Existing');

    getState().importTemplates({
      'new-tmpl': {
        id: 'new-tmpl',
        name: 'New',
        category: 'Test',
        nodes: [],
        connections: [],
        createdAt: 0,
      },
    });

    expect(getState().templates[existingId!]).toBeDefined();
    expect(getState().templates['new-tmpl']).toBeDefined();
  });
});

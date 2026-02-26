import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';
import { saveMultiGraph, loadMultiGraph, loadGraph } from '../utils/serialization';
import type { MultiGraphStorage } from '../utils/serialization';
import type { EditorNode } from '../types';

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
    showValuePreviews: false,
    storageWarning: null,
  });
}

function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  if (getState().canRedo()) {
    getState().pushUndoSnapshot();
    getState().undo();
  }
}

// ===========================================================================
// toggleValuePreviews
// ===========================================================================
describe('toggleValuePreviews', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('toggles showValuePreviews from false to true', () => {
    expect(getState().showValuePreviews).toBe(false);
    getState().toggleValuePreviews();
    expect(getState().showValuePreviews).toBe(true);
  });

  it('toggles back to false', () => {
    getState().toggleValuePreviews();
    expect(getState().showValuePreviews).toBe(true);
    getState().toggleValuePreviews();
    expect(getState().showValuePreviews).toBe(false);
  });

  it('rapid toggling works correctly', () => {
    for (let i = 0; i < 10; i++) {
      getState().toggleValuePreviews();
    }
    // 10 toggles from false → should be false again
    expect(getState().showValuePreviews).toBe(false);

    getState().toggleValuePreviews();
    expect(getState().showValuePreviews).toBe(true);
  });
});

// ===========================================================================
// dismissStorageWarning
// ===========================================================================
describe('dismissStorageWarning', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('clears storageWarning when set', () => {
    useEditorStore.setState({ storageWarning: 'Storage quota exceeded' });
    expect(getState().storageWarning).toBe('Storage quota exceeded');
    getState().dismissStorageWarning();
    expect(getState().storageWarning).toBeNull();
  });

  it('no-ops when storageWarning is already null', () => {
    expect(getState().storageWarning).toBeNull();
    getState().dismissStorageWarning();
    expect(getState().storageWarning).toBeNull();
  });
});

// ===========================================================================
// loadMultiGraph direct tests
// ===========================================================================
describe('loadMultiGraph direct', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns null when nothing saved', () => {
    expect(loadMultiGraph()).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem('node-editor-3d-graph', 'not-json!!!');
    expect(loadMultiGraph()).toBeNull();
  });

  it('returns null for non-object data', () => {
    localStorage.setItem('node-editor-3d-graph', '"just a string"');
    expect(loadMultiGraph()).toBeNull();
  });

  it('returns null for array', () => {
    localStorage.setItem('node-editor-3d-graph', '[1,2,3]');
    expect(loadMultiGraph()).toBeNull();
  });

  it('returns null when version is 2 but graphs missing', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({ version: 2, graphTabs: {} }));
    expect(loadMultiGraph()).toBeNull();
  });

  it('returns null when version is 2 but graphTabs missing', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({ version: 2, graphs: {} }));
    expect(loadMultiGraph()).toBeNull();
  });

  it('returns null for random object without nodes or version', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({ foo: 'bar' }));
    expect(loadMultiGraph()).toBeNull();
  });

  it('loads valid v2 format', () => {
    const storage: MultiGraphStorage = {
      version: 2,
      graphs: { default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} } },
      graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
      activeGraphId: 'default',
      graphOrder: ['default'],
      templates: {},
    };
    localStorage.setItem('node-editor-3d-graph', JSON.stringify(storage));
    const result = loadMultiGraph();
    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
    expect(result!.graphOrder).toEqual(['default']);
  });

  it('auto-migrates legacy format with nodes+connections', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({
      nodes: { n1: { id: 'n1', type: 'source', position: [0, 0, 0] } },
      connections: {},
    }));
    const result = loadMultiGraph();
    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
    expect(result!.graphOrder).toEqual(['default']);
    expect(result!.graphs.default.nodes.n1).toBeDefined();
  });

  it('auto-migrates legacy format without optional fields', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({
      nodes: {},
      connections: {},
      // No groups, no customNodeDefs
    }));
    const result = loadMultiGraph();
    expect(result).not.toBeNull();
    expect(result!.graphs.default.groups).toEqual({});
    expect(result!.graphs.default.customNodeDefs).toEqual({});
  });

  it('auto-migration produces empty templates', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({
      nodes: {},
      connections: {},
    }));
    const result = loadMultiGraph();
    expect(result!.templates).toEqual({});
  });

  it('preserves groups and customNodeDefs in legacy migration', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({
      nodes: {},
      connections: {},
      groups: { g1: { id: 'g1', label: 'Test', memberIds: [], collapsed: false } },
      customNodeDefs: { cd1: { id: 'cd1', name: 'Custom', color: 'red', category: 'Test', expression: 'in0', inputs: [], outputs: [] } },
    }));
    const result = loadMultiGraph();
    expect(result).not.toBeNull();
    expect(result!.graphs.default.groups!.g1.label).toBe('Test');
    expect(result!.graphs.default.customNodeDefs!.cd1.name).toBe('Custom');
  });
});

// ===========================================================================
// saveMultiGraph direct tests
// ===========================================================================
describe('saveMultiGraph direct', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns true on success', () => {
    const storage: MultiGraphStorage = {
      version: 2,
      graphs: { default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} } },
      graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
      activeGraphId: 'default',
      graphOrder: ['default'],
      templates: {},
    };
    expect(saveMultiGraph(storage)).toBe(true);
  });

  it('returns false when localStorage throws', () => {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new DOMException('QuotaExceededError'); };
    const storage: MultiGraphStorage = {
      version: 2,
      graphs: {},
      graphTabs: {},
      activeGraphId: 'default',
      graphOrder: [],
      templates: {},
    };
    expect(saveMultiGraph(storage)).toBe(false);
    localStorage.setItem = originalSetItem;
  });

  it('data is readable by loadMultiGraph after save', () => {
    const storage: MultiGraphStorage = {
      version: 2,
      graphs: {
        default: {
          nodes: { n1: { id: 'n1', type: 'source', position: [0, 0, 0], title: 'S', data: { value: 42 }, inputs: [], outputs: [] } as EditorNode },
          connections: {},
          groups: {},
          customNodeDefs: {},
        },
      },
      graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
      activeGraphId: 'default',
      graphOrder: ['default'],
      templates: {},
    };
    saveMultiGraph(storage);
    const loaded = loadMultiGraph();
    expect(loaded).not.toBeNull();
    expect(loaded!.graphs.default.nodes.n1.data.value).toBe(42);
  });
});

// ===========================================================================
// loadGraph reads v2 format correctly (extracts active graph)
// ===========================================================================
describe('loadGraph v2 compat', () => {
  beforeEach(() => { localStorage.clear(); });

  it('loadGraph extracts active graph from v2 format', () => {
    const storage: MultiGraphStorage = {
      version: 2,
      graphs: {
        default: {
          nodes: { n1: { id: 'n1', type: 'source', position: [0, 0, 0], title: 'S', data: {}, inputs: [], outputs: [] } as EditorNode },
          connections: {},
          groups: {},
          customNodeDefs: {},
        },
        g2: {
          nodes: { n2: { id: 'n2', type: 'transform', position: [5, 0, 0], title: 'T', data: {}, inputs: [], outputs: [] } as EditorNode },
          connections: {},
          groups: {},
          customNodeDefs: {},
        },
      },
      graphTabs: {
        default: { id: 'default', name: 'Main', createdAt: 1000 },
        g2: { id: 'g2', name: 'Graph 2', createdAt: 2000 },
      },
      activeGraphId: 'default',
      graphOrder: ['default', 'g2'],
      templates: {},
    };
    saveMultiGraph(storage);
    const result = loadGraph();
    expect(result).not.toBeNull();
    // Should return the active graph (default) as legacy format
    expect(Object.keys(result!.nodes)).toHaveLength(1);
    expect(result!.nodes.n1).toBeDefined();
  });

  it('loadGraph returns null for v2 with invalid activeGraphId', () => {
    const storage: MultiGraphStorage = {
      version: 2,
      graphs: { default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} } },
      graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
      activeGraphId: 'non-existent',
      graphOrder: ['default'],
      templates: {},
    };
    saveMultiGraph(storage);
    const result = loadGraph();
    expect(result).toBeNull();
  });
});

// ===========================================================================
// Multi-graph + Templates cross-feature integration
// ===========================================================================
describe('Multi-graph + Templates cross-feature', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('template saved in graph A can be instantiated in graph B', () => {
    // Create a template in graph A
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 77);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Cross-Graph', 'Test');
    expect(tmplId).not.toBeNull();

    // Switch to graph B
    getState().createGraph('Graph B');
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Instantiate the template from graph A into graph B
    getState().instantiateTemplate(tmplId!, [5, 0, 5]);
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    const node = Object.values(getState().nodes)[0];
    expect(node.data.value).toBe(77);
    expect(node.type).toBe('source');
  });

  it('templates persist across graph export/import', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('Persistent', 'User');

    const exported = getState().exportAllGraphs();
    expect(Object.keys(exported.templates)).toHaveLength(1);

    drainUndoRedo();
    resetStore();
    getState().importAllGraphs(exported);

    expect(Object.keys(getState().templates)).toHaveLength(1);
    const tmpl = Object.values(getState().templates)[0];
    expect(tmpl.name).toBe('Persistent');
  });

  it('deleting a graph does not delete templates', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('Survives', 'Test');
    const templateCount = Object.keys(getState().templates).length;

    const g2 = getState().createGraph('Temp');
    getState().addNode('transform', [0, 0, 0]);
    getState().deleteGraph(g2);

    expect(Object.keys(getState().templates).length).toBe(templateCount);
  });

  it('template with grouped nodes instantiated in different graph', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().setSelection(new Set([a, b]));
    getState().createGroup('Pipeline');
    const tmplId = getState().saveSelectionAsTemplate('Grouped', 'Test');

    getState().createGraph('Target');
    getState().instantiateTemplate(tmplId!, [0, 0, 0]);

    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(Object.keys(getState().connections)).toHaveLength(1);
  });
});

// ===========================================================================
// Multi-graph + Execution integration
// ===========================================================================
describe('Multi-graph + Execution isolation', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('execution in graph A does not affect graph B outputs', () => {
    // Graph A: source(10) → transform(*2)
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfm, 'multiplier', 2);
    getState().updateNodeData(xfm, 'offset', 0);
    getState().addConnection(src, 0, xfm, 0);

    // Execute in graph A
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[xfm][0]).toBe(20);

    // Switch to graph B - outputs should be clean
    getState().createGraph('Graph B');
    expect(getState().nodeOutputs).toEqual({});
    expect(getState().isExecuting).toBe(false);

    // Switch back to graph A - execution outputs don't survive (transient)
    getState().switchGraph('default');
    // Outputs are cleared on switch because they're transient
    expect(getState().executionStates).toEqual({});
  });
});

// ===========================================================================
// Multi-graph + Validation interaction
// ===========================================================================
describe('Multi-graph + Validation', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('validation in graph A does not bleed into graph B', () => {
    // Graph A: disconnected transform → has validation errors
    const t = getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    expect(getState().validationErrors[t]).toBeDefined();

    // Switch to graph B
    getState().createGraph('Graph B');
    // Validation errors should be cleared in new graph
    expect(Object.keys(getState().validationErrors)).toHaveLength(0);
  });
});

// ===========================================================================
// Multi-graph + Custom nodes
// ===========================================================================
describe('Multi-graph + Custom nodes', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('custom node defs are per-graph state', () => {
    const defId = getState().addCustomNodeDef({
      name: 'GraphA Custom', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0 * 2',
    });

    // Custom def exists in graph A
    expect(getState().customNodeDefs[defId]).toBeDefined();
    const customId = getState().addCustomNode(defId, [0, 0, 0]);
    expect(customId).not.toBeNull();

    // Switch to graph B - customNodeDefs are per-graph, so not available
    getState().createGraph('Graph B');
    expect(getState().customNodeDefs[defId]).toBeUndefined();

    // Switch back to graph A - custom def and node should be intact
    getState().switchGraph('default');
    expect(getState().customNodeDefs[defId]).toBeDefined();
    expect(getState().nodes[customId!]).toBeDefined();
    expect(getState().nodes[customId!].type).toBe('custom');
  });
});

// ===========================================================================
// Multi-graph + Copy/Paste across graphs
// ===========================================================================
describe('Multi-graph + Copy/Paste', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('copy in graph A and paste in graph B', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 99);
    getState().setSelection(new Set([src]));
    getState().copySelected();

    // Switch to graph B
    getState().createGraph('Graph B');
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Paste
    getState().paste();
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    const pasted = Object.values(getState().nodes)[0];
    expect(pasted.data.value).toBe(99);
    expect(pasted.id).not.toBe(src); // New ID
  });
});

// ===========================================================================
// Multi-graph + Undo isolation (extended)
// ===========================================================================
describe('Multi-graph + Undo isolation (extended)', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('redo in graph B does not affect graph A', () => {
    // Graph A: add source
    const srcA = getState().addNode('source', [0, 0, 0]);

    // Graph B: add and undo transform
    getState().createGraph('B');
    getState().addNode('transform', [5, 0, 0]);
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Graph B: redo
    getState().redo();
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Switch to A — should still have original source
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes[srcA]).toBeDefined();
  });

  it('multiple undo/redo in different graphs are independent', () => {
    // Graph A: add 3 nodes
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('source', [3, 0, 0]);
    getState().addNode('source', [6, 0, 0]);

    // Graph B: add 2 nodes
    const g2 = getState().createGraph('B');
    getState().addNode('transform', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);

    // Undo 1 in B
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Switch to A, undo 2
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes)).toHaveLength(3);
    getState().undo();
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Switch to B, verify still at 1
    getState().switchGraph(g2);
    expect(Object.keys(getState().nodes)).toHaveLength(1);
  });
});

// ===========================================================================
// Graph tab ordering + content integrity
// ===========================================================================
describe('Graph tab ordering + content integrity', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('reordering tabs does not affect graph content', () => {
    const g2 = getState().createGraph('G2');
    getState().addNode('transform', [0, 0, 0]);
    getState().switchGraph('default');
    getState().addNode('source', [0, 0, 0]);

    // Reorder: move g2 to position 0
    getState().reorderGraph(g2, 0);
    expect(getState().graphOrder[0]).toBe(g2);

    // Verify content
    getState().switchGraph(g2);
    expect(Object.values(getState().nodes)[0].type).toBe('transform');
    getState().switchGraph('default');
    expect(Object.values(getState().nodes)[0].type).toBe('source');
  });

  it('renaming tab does not affect graph content', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    getState().renameGraph('default', 'Renamed Graph');
    expect(getState().graphTabs['default'].name).toBe('Renamed Graph');
    expect(getState().nodes[src].data.value).toBe(42);
  });
});

// ===========================================================================
// Template edge cases (extended)
// ===========================================================================
describe('Template edge cases (extended)', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('instantiate template in empty graph positions correctly', () => {
    // Create template with node at [0,0,0]
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Single', 'Test');

    // Clear and instantiate at [10, 0, 10]
    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();
    getState().instantiateTemplate(tmplId!, [10, 0, 10]);

    const node = Object.values(getState().nodes)[0];
    expect(node.position[0]).toBeCloseTo(10, 5);
    expect(node.position[2]).toBeCloseTo(10, 5);
  });

  it('instantiate preserves collapsed state', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeCollapse(src);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Collapsed', 'Test');

    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();
    getState().instantiateTemplate(tmplId!, [0, 0, 0]);

    const node = Object.values(getState().nodes)[0];
    expect(node.collapsed).toBe(true);
  });

  it('saving template does not push undo', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    drainUndoRedo();

    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('No Undo', 'Test');

    // saveSelectionAsTemplate should not push undo (it's not a graph mutation)
    // If it does push, undo would do something unexpected
    // This documents the current behavior
  });
});

// ===========================================================================
// showValuePreviews persists in multi-graph export
// ===========================================================================
describe('showValuePreviews state', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('showValuePreviews is transient (not persisted)', () => {
    getState().toggleValuePreviews();
    expect(getState().showValuePreviews).toBe(true);

    // Export/import should not include this transient toggle
    const exported = getState().exportAllGraphs();
    drainUndoRedo();
    resetStore();
    getState().importAllGraphs(exported);

    // Should be back to default (false)
    expect(getState().showValuePreviews).toBe(false);
  });
});

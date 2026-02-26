/**
 * Cascade Integration Tests
 *
 * Tests complex multi-system interactions across subgraphs, multi-graph,
 * undo/redo, and state management boundaries:
 *
 * - Subgraph create → enter → modify → exit → verify state persisted
 * - Multi-graph with subgraphs: graph switch preserves subgraph state
 * - deleteGraph cascade: inner graphs, tabs, and module state cleanup
 * - Undo/redo across graph boundaries
 * - Template instantiation with connection metadata
 * - convertSelectionToSubgraph + expandSubgraph round-trip
 * - Import/export workflow with subgraphs
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.contextMenu = null;
    s.customNodeDefs = {};
    s.searchQuery = '';
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.templates = {};
    s.breadcrumbStack = [];
    s.subgraphDefs = {};
    s.errorStrategy = 'fail-fast';
    s.validationErrors = {};
    s.executionMetrics = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

// ==========================================================================
// Subgraph lifecycle: create → enter → modify → exit → verify
// ==========================================================================
describe('Subgraph lifecycle round-trip', () => {
  beforeEach(() => { resetStore(); });

  it('preserves inner graph nodes after enter → exit → enter', () => {
    const mainGraphId = getState().activeGraphId;

    // Create subgraph
    const sgId = getState().createSubgraph('Round-Trip SG')!;
    expect(sgId).toBeTruthy();

    // Enter subgraph
    getState().enterSubgraph(sgId);
    const innerGraphId = getState().activeGraphId;
    expect(innerGraphId).not.toBe(mainGraphId);

    // Add a node inside subgraph
    const innerNode = getState().addNode('math', [5, 0, 5]);
    expect(getState().nodes[innerNode]).toBeDefined();

    // Exit subgraph
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(mainGraphId);

    // Re-enter subgraph - inner node should still be there
    getState().enterSubgraph(sgId);
    expect(getState().nodes[innerNode]).toBeDefined();
    expect(getState().nodes[innerNode].type).toBe('math');
  });

  it('preserves connections within inner graph after round-trip', () => {
    const sgId = getState().createSubgraph('Conn SG')!;
    getState().enterSubgraph(sgId);

    // Find boundary nodes (subgraph-input and subgraph-output)
    const boundaryInput = Object.values(getState().nodes)
      .find(n => n.type === 'subgraph-input');
    const boundaryOutput = Object.values(getState().nodes)
      .find(n => n.type === 'subgraph-output');

    // Add math node and connect boundary → math → boundary
    const math = getState().addNode('math', [3, 0, 0]);
    if (boundaryInput) {
      getState().addConnection(boundaryInput.id, 0, math, 0);
    }
    if (boundaryOutput) {
      getState().addConnection(math, 0, boundaryOutput.id, 0);
    }
    const connCount = Object.keys(getState().connections).length;

    // Exit and re-enter
    getState().exitSubgraph();
    getState().enterSubgraph(sgId);

    // Connections should be preserved
    expect(Object.keys(getState().connections).length).toBe(connCount);
  });
});

// ==========================================================================
// Multi-graph + subgraph state isolation
// ==========================================================================
describe('Multi-graph + subgraph state isolation', () => {
  beforeEach(() => { resetStore(); });

  it('subgraphs in different graphs are independent', () => {
    const mainGraphId = getState().activeGraphId;

    // Create subgraph in main graph
    const sg1 = getState().createSubgraph('SG in Main')!;

    // Create new graph and add subgraph there
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);

    const sg2 = getState().createSubgraph('SG in Graph2')!;

    // Graph2 should have sg2 but not sg1
    expect(getState().subgraphDefs[sg2]).toBeDefined();
    expect(getState().nodes[sg1]).toBeUndefined();

    // Switch back to main
    getState().switchGraph(mainGraphId);
    expect(getState().subgraphDefs[sg1]).toBeDefined();
    expect(getState().nodes[sg2]).toBeUndefined();
  });

  it('undo/redo is per-graph (isolated)', () => {
    const mainGraphId = getState().activeGraphId;
    const n1 = getState().addNode('source', [0, 0, 0]);

    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);
    const n2 = getState().addNode('transform', [1, 0, 0]);
    const n3 = getState().addNode('output', [2, 0, 0]);

    // Undo in graph 2
    getState().undo();
    expect(getState().nodes[n3]).toBeUndefined();
    expect(getState().nodes[n2]).toBeDefined();

    // Switch to main - main should still have its node
    getState().switchGraph(mainGraphId);
    expect(getState().nodes[n1]).toBeDefined();

    // Main's undo should undo main's addNode
    getState().undo();
    expect(getState().nodes[n1]).toBeUndefined();
  });

  it('customNodeDefs are per-graph', () => {
    const mainGraphId = getState().activeGraphId;
    const def1 = getState().addCustomNodeDef({
      name: 'Custom1',
      color: '#ff0000',
      category: 'Utility',
      expression: 'in0 + 1',
      inputs: [{ label: 'in', portType: 'any' }],
      outputs: [{ label: 'out', portType: 'any' }],
    });

    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);

    // Graph 2 should not have the custom node def
    expect(Object.keys(getState().customNodeDefs)).toHaveLength(0);

    const def2 = getState().addCustomNodeDef({
      name: 'Custom2',
      color: '#00ff00',
      category: 'Utility',
      expression: 'in0 * 2',
      inputs: [{ label: 'in', portType: 'any' }],
      outputs: [{ label: 'out', portType: 'any' }],
    });

    // Switch back - main should only have Custom1
    getState().switchGraph(mainGraphId);
    expect(getState().customNodeDefs[def1]).toBeDefined();
    expect(getState().customNodeDefs[def1].name).toBe('Custom1');
    expect(getState().customNodeDefs[def2]).toBeUndefined();
  });
});

// ==========================================================================
// Template + connection metadata round-trip
// ==========================================================================
describe('Template + connection metadata', () => {
  beforeEach(() => { resetStore(); });

  it('template preserves and restores connection metadata', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(src, 0, trn, 0)!;

    // Add metadata
    useEditorStore.setState((s) => {
      s.connections[connId].label = 'template-label';
      s.connections[connId].colorOverride = '#0000ff';
    });

    // Save as template
    getState().setSelection(new Set([src, trn]));
    const tmplId = getState().saveSelectionAsTemplate('Test Template')!;
    expect(tmplId).toBeTruthy();

    // Clear graph and instantiate template
    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    getState().instantiateTemplate(tmplId, [0, 0, 0]);

    // Find new connections and verify metadata
    const newConns = Object.values(getState().connections);
    expect(newConns.length).toBeGreaterThanOrEqual(1);

    const labeled = newConns.find(c => c.label === 'template-label');
    expect(labeled).toBeDefined();
    expect(labeled!.colorOverride).toBe('#0000ff');
  });

  it('templates are global across graphs', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Global Template')!;

    // Switch to new graph
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);

    // Template should still be accessible
    expect(getState().templates[tmplId]).toBeDefined();
    expect(getState().templates[tmplId].name).toBe('Global Template');

    // Instantiate template in new graph
    getState().instantiateTemplate(tmplId, [0, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// convertSelectionToSubgraph → expandSubgraph round-trip
// ==========================================================================
describe('Subgraph convert + expand round-trip', () => {
  beforeEach(() => { resetStore(); });

  it('converts and expands back to original topology', () => {
    // Build: source → transform → output
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    const out = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(src, 0, trn, 0);
    getState().addConnection(trn, 0, out, 0);
    getState().updateNodeData(src, 'value', 10);
    getState().updateNodeData(trn, 'multiplier', 3);

    // Convert src+trn to subgraph
    getState().setSelection(new Set([src, trn]));
    const sgId = getState().convertSelectionToSubgraph('ConvertTest')!;
    expect(sgId).toBeTruthy();
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().nodes[sgId].type).toBe('subgraph');

    // Expand the subgraph back
    getState().expandSubgraph(sgId);

    // Original nodes should be back
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[trn]).toBeDefined();
    expect(getState().nodes[sgId]).toBeUndefined();

    // Data should be preserved
    expect(getState().nodes[src].data.value).toBe(10);
    expect(getState().nodes[trn].data.multiplier).toBe(3);
  });

  it('expand is undoable', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(src, 0, trn, 0);

    getState().setSelection(new Set([src, trn]));
    const sgId = getState().convertSelectionToSubgraph('UndoTest')!;

    getState().expandSubgraph(sgId);
    expect(getState().nodes[sgId]).toBeUndefined();

    getState().undo();
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().nodes[sgId].type).toBe('subgraph');
  });
});

// ==========================================================================
// Validation + Custom Nodes
// ==========================================================================
describe('Validation + Custom Nodes', () => {
  beforeEach(() => { resetStore(); });

  it('validates graph with custom nodes that have dynamic ports', () => {
    // Create custom node def with proper PortConfig arrays
    const defId = getState().addCustomNodeDef({
      name: 'Adder',
      color: '#FF6B35',
      category: 'Math',
      expression: 'in0 + in1',
      inputs: [
        { label: 'a', portType: 'number' },
        { label: 'b', portType: 'number' },
      ],
      outputs: [
        { label: 'sum', portType: 'number' },
      ],
    });

    // Add custom node
    const customId = getState().addCustomNode(defId, [0, 0, 0])!;
    expect(customId).toBeTruthy();

    // Should have 2 inputs and 1 output
    expect(getState().nodes[customId].inputs).toHaveLength(2);
    expect(getState().nodes[customId].outputs).toHaveLength(1);

    // Connect sources to both custom node inputs
    const src1 = getState().addNode('source', [-3, 0, 0]);
    const src2 = getState().addNode('source', [-3, 0, 3]);
    const out = getState().addNode('output', [5, 0, 0]);
    const conn1 = getState().addConnection(src1, 0, customId, 0);
    const conn2 = getState().addConnection(src2, 0, customId, 1);
    const conn3 = getState().addConnection(customId, 0, out, 0);
    expect(conn1).toBeTruthy();
    expect(conn2).toBeTruthy();
    expect(conn3).toBeTruthy();

    // Validate - all inputs connected and output consumed, should have no errors for the custom node
    getState().validateGraph();
    expect(getState().validationErrors[customId]).toBeUndefined();
  });
});

// ==========================================================================
// Groups + Undo/Redo
// ==========================================================================
describe('Groups + Undo/Redo', () => {
  beforeEach(() => { resetStore(); });

  it('undo restores group after ungroup', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    getState().setSelection(new Set([n1, n2]));

    const groupId = getState().createGroup('Test Group')!;
    expect(groupId).toBeTruthy();
    expect(getState().groups[groupId]).toBeDefined();
    expect(getState().nodes[n1].groupId).toBe(groupId);
    expect(getState().nodes[n2].groupId).toBe(groupId);

    // Ungroup
    getState().ungroupNodes(groupId);
    expect(getState().groups[groupId]).toBeUndefined();
    expect(getState().nodes[n1].groupId).toBeUndefined();

    // Undo restores group
    getState().undo();
    expect(getState().groups[groupId]).toBeDefined();
    expect(getState().nodes[n1].groupId).toBe(groupId);
    expect(getState().nodes[n2].groupId).toBe(groupId);
  });

  it('undo restores group after deleteSelected removes all members', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('DeleteGroup')!;

    // Delete all grouped nodes
    getState().setSelection(new Set([n1, n2]));
    getState().deleteSelected();
    expect(getState().groups[groupId]).toBeUndefined();

    // Undo
    getState().undo();
    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();
    expect(getState().groups[groupId]).toBeDefined();
  });

  it('rename group is undoable', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('OriginalName')!;

    getState().renameGroup(groupId, 'NewName');
    expect(getState().groups[groupId].label).toBe('NewName');

    getState().undo();
    expect(getState().groups[groupId].label).toBe('OriginalName');
  });

  it('toggle group collapse does not push undo (view-state)', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('Collapse')!;
    expect(getState().groups[groupId].collapsed).toBe(false);

    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);

    // Undo should revert createGroup, not the collapse toggle
    getState().undo();
    expect(getState().groups[groupId]).toBeUndefined();
  });
});

// ==========================================================================
// Search + fuzzy matching across node types
// ==========================================================================
describe('Search + node types', () => {
  beforeEach(() => { resetStore(); });

  it('searchNodes finds nodes by title', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(n1, 'My Data Source');
    const n2 = getState().addNode('transform', [3, 0, 0]);
    getState().updateNodeTitle(n2, 'Transformer');

    const results = getState().searchNodes('Data');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.id === n1)).toBe(true);
  });

  it('searchNodes finds nodes by type', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('math', [3, 0, 0]);

    const results = getState().searchNodes('source');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ==========================================================================
// Error strategy + execution interaction
// ==========================================================================
describe('Error strategy persistence', () => {
  beforeEach(() => { resetStore(); });

  it('errorStrategy does NOT push undo', () => {
    // Create a node first (which pushes undo)
    getState().addNode('source');
    const canUndoBefore = getState().canUndo();

    getState().setErrorStrategy('continue');

    // Should not have pushed an additional undo entry
    expect(getState().canUndo()).toBe(canUndoBefore);
  });

  it('errorStrategy survives graph switch round-trip', () => {
    const mainGraphId = getState().activeGraphId;
    getState().setErrorStrategy('continue');

    const g2 = getState().createGraph('G2');
    getState().switchGraph(g2);
    expect(getState().errorStrategy).toBe('fail-fast'); // default for new graph

    getState().setErrorStrategy('continue');
    getState().switchGraph(mainGraphId);
    expect(getState().errorStrategy).toBe('continue');

    getState().switchGraph(g2);
    expect(getState().errorStrategy).toBe('continue');
  });
});

// ==========================================================================
// Export/Import round-trip
// ==========================================================================
describe('Export/Import multi-graph round-trip', () => {
  beforeEach(() => { resetStore(); });

  it('exports and imports preserving all graph data', () => {
    // Set up multi-graph with nodes
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    getState().updateNodeTitle(src, 'MySource');

    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);
    getState().addNode('transform', [1, 0, 0]);

    // Export
    getState().switchGraph('default');
    const exported = getState().exportAllGraphs();

    // Clear and import
    getState().importAllGraphs(exported);

    // Verify main graph data
    const nodes = getState().nodes;
    const sourceNode = Object.values(nodes).find(n => n.title === 'MySource');
    expect(sourceNode).toBeDefined();
    expect(sourceNode!.data.value).toBe(42);

    // Verify graph tabs
    expect(getState().graphOrder.length).toBeGreaterThanOrEqual(2);
  });
});

// ==========================================================================
// Undo/redo clears transient execution state
// ==========================================================================
describe('Undo/redo clears transient state', () => {
  beforeEach(() => { resetStore(); });

  it('undo clears execution states, outputs, and errors', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);

    // Simulate execution state
    useEditorStore.setState((s) => {
      s.executionStates[n1] = 'running';
      s.nodeOutputs[n1] = [42];
      s.executionErrors[n1] = 'test error';
    });

    // Undo (which undoes addNode)
    getState().undo();

    // Transient state should be cleared
    expect(getState().executionStates).toEqual({});
    expect(getState().nodeOutputs).toEqual({});
    expect(getState().executionErrors).toEqual({});
  });

  it('redo also clears transient state', () => {
    getState().addNode('source', [0, 0, 0]);

    getState().undo();

    // Simulate stale execution state
    useEditorStore.setState((s) => {
      s.executionStates['stale-id'] = 'complete';
    });

    getState().redo();

    expect(getState().executionStates).toEqual({});
  });

  it('undo resets interaction to idle', () => {
    getState().addNode('source', [0, 0, 0]);

    useEditorStore.setState((s) => {
      s.interaction = 'drawing-connection';
      s.pendingConnection = { sourceNodeId: 'fake', sourcePortIndex: 0, cursorPos: [0, 0, 0] };
      s.contextMenu = { x: 0, y: 0, target: { kind: 'canvas' } };
    });

    getState().undo();

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().contextMenu).toBeNull();
  });
});

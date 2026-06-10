/**
 * Modularity Tests
 *
 * Comprehensive tests for the modularity features of the Rosebud Node Editor:
 * 1. Node Groups (create, ungroup, collapse, rename, undo/redo)
 * 2. Custom Node Definitions (add, remove, instantiate, ports, per-graph)
 * 3. Templates (save, instantiate, delete, import/export, workspace-global)
 * 4. Multi-Graph Tabs (create, switch, delete, rename, reorder, isolation)
 * 5. Subgraphs (create, convert, enter/exit, expand, delete cascade)
 * 6. Node Collapse (toggle, batch, undo/redo, duplicate)
 * 7. Import/Export Workspace (round-trip, templates, multi-graph)
 * 8. Node Type Diversity (all 22 types, port counts, port types)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/editorStore';
import { _resetModuleState } from '../store/editorStore';
import type { NodeType, EditorNode, SubgraphNodeDef } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// 1. Node Groups
// ---------------------------------------------------------------------------

describe('Node Groups', () => {
  beforeEach(resetStore);

  it('createGroup requires 2+ selected nodes', () => {
    const { addNode, setSelection, createGroup } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('TestGroup');
    expect(groupId).not.toBeNull();
    expect(getState().groups[groupId!]).toBeDefined();
  });

  it('createGroup returns group ID', () => {
    const { addNode, setSelection, createGroup } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('MyGroup');
    expect(typeof groupId).toBe('string');
    expect(groupId!.length).toBeGreaterThan(0);
  });

  it('createGroup with fewer than 2 nodes returns null', () => {
    const { addNode, setSelection, createGroup } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    setSelection(new Set([n1]));
    const groupId = createGroup('Solo');
    expect(groupId).toBeNull();
  });

  it('createGroup with zero selected nodes returns null', () => {
    const { createGroup } = getState();
    const groupId = createGroup('Empty');
    expect(groupId).toBeNull();
  });

  it('createGroup assigns groupId to selected nodes', () => {
    const { addNode, setSelection, createGroup } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('MyGroup');
    const state = getState();
    expect(state.nodes[n1].groupId).toBe(groupId);
    expect(state.nodes[n2].groupId).toBe(groupId);
  });

  it('ungroupNodes removes groupId from nodes', () => {
    const { addNode, setSelection, createGroup, ungroupNodes } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('MyGroup')!;
    ungroupNodes(groupId);
    const state = getState();
    expect(state.nodes[n1].groupId).toBeUndefined();
    expect(state.nodes[n2].groupId).toBeUndefined();
  });

  it('ungroupNodes deletes the group', () => {
    const { addNode, setSelection, createGroup, ungroupNodes } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('MyGroup')!;
    ungroupNodes(groupId);
    expect(getState().groups[groupId]).toBeUndefined();
  });

  it('toggleGroupCollapse toggles collapsed state', () => {
    const { addNode, setSelection, createGroup, toggleGroupCollapse } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('MyGroup')!;
    expect(getState().groups[groupId].collapsed).toBe(false);
    toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);
    toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(false);
  });

  it('renameGroup changes label', () => {
    const { addNode, setSelection, createGroup, renameGroup } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('OldName')!;
    renameGroup(groupId, 'NewName');
    expect(getState().groups[groupId].label).toBe('NewName');
  });

  it('renameGroup pushes undo', () => {
    const { addNode, setSelection, createGroup, renameGroup, undo } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('OldName')!;
    renameGroup(groupId, 'NewName');
    expect(getState().groups[groupId].label).toBe('NewName');
    undo();
    expect(getState().groups[groupId].label).toBe('OldName');
  });

  it('group survives undo/redo', () => {
    const { addNode, setSelection, createGroup, undo, redo } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('UndoGroup')!;
    expect(getState().groups[groupId]).toBeDefined();
    // Undo the createGroup
    undo();
    expect(getState().groups[groupId]).toBeUndefined();
    // Redo brings it back
    redo();
    expect(getState().groups[groupId]).toBeDefined();
    expect(getState().groups[groupId].label).toBe('UndoGroup');
  });
});

// ---------------------------------------------------------------------------
// 2. Custom Node Definitions
// ---------------------------------------------------------------------------

describe('Custom Node Definitions', () => {
  beforeEach(resetStore);

  it('addCustomNodeDef creates a definition', () => {
    const { addCustomNodeDef } = getState();
    const defId = addCustomNodeDef({
      name: 'MyCustom',
      color: 'red',
      category: 'Test',
      inputs: [{ label: 'a', portType: 'number' }],
      outputs: [{ label: 'result', portType: 'number' }],
      expression: 'inputs[0] * 2',
    });
    expect(getState().customNodeDefs[defId]).toBeDefined();
    expect(getState().customNodeDefs[defId].name).toBe('MyCustom');
  });

  it('addCustomNodeDef returns the generated ID (not passed-in ID)', () => {
    const { addCustomNodeDef } = getState();
    // The function signature takes Omit<CustomNodeDef, 'id'>, so no ID field.
    // The returned ID is generated internally and starts with 'customdef-'.
    const defId = addCustomNodeDef({
      name: 'GenId',
      color: 'blue',
      category: 'Test',
      inputs: [],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: '42',
    });
    expect(defId).toMatch(/^customdef-/);
    expect(getState().customNodeDefs[defId].id).toBe(defId);
  });

  it('removeCustomNodeDef removes it', () => {
    const { addCustomNodeDef, removeCustomNodeDef } = getState();
    const defId = addCustomNodeDef({
      name: 'ToRemove',
      color: 'green',
      category: 'Test',
      inputs: [],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: '0',
    });
    expect(getState().customNodeDefs[defId]).toBeDefined();
    removeCustomNodeDef(defId);
    expect(getState().customNodeDefs[defId]).toBeUndefined();
  });

  it('addCustomNode creates a node from definition', () => {
    const { addCustomNodeDef, addCustomNode } = getState();
    const defId = addCustomNodeDef({
      name: 'Doubler',
      color: 'purple',
      category: 'Test',
      inputs: [{ label: 'val', portType: 'number' }],
      outputs: [{ label: 'doubled', portType: 'number' }],
      expression: 'inputs[0] * 2',
    });
    const nodeId = addCustomNode(defId, [1, 0, 1]);
    expect(nodeId).not.toBeNull();
    const node = getState().nodes[nodeId!];
    expect(node.type).toBe('custom');
    expect(node.title).toBe('Doubler');
    expect(node.data.customDefId).toBe(defId);
    expect(node.inputs.length).toBe(1);
    expect(node.outputs.length).toBe(1);
  });

  it('addCustomNode returns null for nonexistent def', () => {
    const { addCustomNode } = getState();
    const result = addCustomNode('nonexistent-def-id');
    expect(result).toBeNull();
  });

  it('custom node port configuration via updateCustomNodePorts', () => {
    const { addCustomNodeDef, addCustomNode, updateCustomNodePorts } = getState();
    const defId = addCustomNodeDef({
      name: 'Flexible',
      color: 'orange',
      category: 'Test',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });
    const nodeId = addCustomNode(defId, [0, 0, 0])!;
    // Custom node starts with ports from the def (0 inputs, 1 output)
    expect(getState().nodes[nodeId].inputs.length).toBe(0);
    expect(getState().nodes[nodeId].outputs.length).toBe(1);

    // Update to have 3 inputs and 2 outputs
    updateCustomNodePorts(nodeId, 3, 2);
    expect(getState().nodes[nodeId].inputs.length).toBe(3);
    expect(getState().nodes[nodeId].outputs.length).toBe(2);
  });

  it('custom node with dynamic ports can be connected', () => {
    const { addCustomNodeDef, addCustomNode, updateCustomNodePorts, addNode, addConnection } = getState();
    const defId = addCustomNodeDef({
      name: 'Connectable',
      color: 'teal',
      category: 'Test',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });
    const customId = addCustomNode(defId, [0, 0, 0])!;
    updateCustomNodePorts(customId, 2, 1);

    const sourceId = addNode('source', [-2, 0, 0]);
    // source has 2 outputs: 'value' (number) and 'label' (string)
    // custom node inputs are portType 'any' after updateCustomNodePorts
    const connId = addConnection(sourceId, 0, customId, 0);
    expect(connId).not.toBeNull();
    expect(Object.keys(getState().connections).length).toBe(1);
  });

  it('custom node data (expression) can be updated', () => {
    const { addCustomNodeDef, addCustomNode, updateNodeData } = getState();
    const defId = addCustomNodeDef({
      name: 'ExprNode',
      color: 'pink',
      category: 'Test',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'y', portType: 'number' }],
      expression: 'inputs[0] + 1',
    });
    const nodeId = addCustomNode(defId, [0, 0, 0])!;
    expect(getState().nodes[nodeId].data.expression).toBe('inputs[0] + 1');
    // updateNodeData takes (id, key, value)
    updateNodeData(nodeId, 'expression', 'inputs[0] * 10');
    expect(getState().nodes[nodeId].data.expression).toBe('inputs[0] * 10');
  });

  it('customNodeDefs are per-graph (different in each graph)', () => {
    const { addCustomNodeDef, createGraph, switchGraph } = getState();
    // Add a custom def in the default graph
    const defId1 = addCustomNodeDef({
      name: 'GraphOneDef',
      color: 'red',
      category: 'Test',
      inputs: [],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: '1',
    });

    // Create a new graph and switch to it
    const graph2Id = createGraph('Graph 2');
    // New graph should not have the custom def
    expect(getState().customNodeDefs[defId1]).toBeUndefined();

    // Add a different def in graph 2
    const defId2 = getState().addCustomNodeDef({
      name: 'GraphTwoDef',
      color: 'blue',
      category: 'Test',
      inputs: [],
      outputs: [{ label: 'out', portType: 'string' }],
      expression: '"hello"',
    });

    // Switch back to default graph
    switchGraph('default');
    expect(getState().customNodeDefs[defId1]).toBeDefined();
    expect(getState().customNodeDefs[defId2]).toBeUndefined();

    // Switch back to graph 2
    switchGraph(graph2Id);
    expect(getState().customNodeDefs[defId1]).toBeUndefined();
    expect(getState().customNodeDefs[defId2]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Templates
// ---------------------------------------------------------------------------

describe('Templates', () => {
  beforeEach(resetStore);

  it('saveSelectionAsTemplate with selected nodes', () => {
    const { addNode, setSelection, saveSelectionAsTemplate } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const templateId = saveSelectionAsTemplate('MyTemplate');
    expect(templateId).not.toBeNull();
    const tmpl = getState().templates[templateId!];
    expect(tmpl).toBeDefined();
    expect(tmpl.name).toBe('MyTemplate');
    expect(tmpl.nodes.length).toBe(2);
  });

  it('saveSelectionAsTemplate preserves connections between selected nodes', () => {
    const { addNode, addConnection, setSelection, saveSelectionAsTemplate } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    // source output 0 (number) -> transform input 0 (number)
    const connId = addConnection(n1, 0, n2, 0);
    expect(connId).not.toBeNull();
    setSelection(new Set([n1, n2]));
    const templateId = saveSelectionAsTemplate('ConnectedTemplate')!;
    const tmpl = getState().templates[templateId];
    expect(tmpl.connections.length).toBe(1);
    expect(tmpl.connections[0].sourceNodeId).toBe(n1);
    expect(tmpl.connections[0].targetNodeId).toBe(n2);
  });

  it('saveSelectionAsTemplate returns null with empty selection', () => {
    const { saveSelectionAsTemplate } = getState();
    const result = saveSelectionAsTemplate('Empty');
    expect(result).toBeNull();
  });

  it('instantiateTemplate creates copies of template nodes', () => {
    const { addNode, setSelection, saveSelectionAsTemplate, instantiateTemplate } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('math', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const templateId = saveSelectionAsTemplate('InstTemplate')!;
    const nodeBefore = Object.keys(getState().nodes).length;

    instantiateTemplate(templateId, [5, 0, 5]);
    const nodeAfter = Object.keys(getState().nodes).length;
    expect(nodeAfter).toBe(nodeBefore + 2);
  });

  it('instantiateTemplate preserves internal connections', () => {
    const { addNode, addConnection, setSelection, saveSelectionAsTemplate, instantiateTemplate } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    addConnection(n1, 0, n2, 0);
    setSelection(new Set([n1, n2]));
    const templateId = saveSelectionAsTemplate('ConnTemplate')!;
    const connsBefore = Object.keys(getState().connections).length;

    instantiateTemplate(templateId, [5, 0, 5]);
    const connsAfter = Object.keys(getState().connections).length;
    // Should have one more connection from the instantiated template
    expect(connsAfter).toBe(connsBefore + 1);
  });

  it('instantiateTemplate deep-copies node data', () => {
    const { addNode, updateNodeData, setSelection, saveSelectionAsTemplate, instantiateTemplate } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    updateNodeData(n1, 'value', 42);
    setSelection(new Set([n1]));
    const templateId = saveSelectionAsTemplate('DataTemplate')!;
    instantiateTemplate(templateId, [5, 0, 5]);

    // Find the instantiated node (the newly selected one)
    const selectedIds = [...getState().selectedIds];
    expect(selectedIds.length).toBe(1);
    const newNode = getState().nodes[selectedIds[0]];
    expect(newNode.data.value).toBe(42);

    // Mutating the original should not affect the copy
    getState().updateNodeData(n1, 'value', 999);
    expect(getState().nodes[selectedIds[0]].data.value).toBe(42);
  });

  it('instantiateTemplate does NOT preserve groupId', () => {
    const { addNode, setSelection, createGroup, saveSelectionAsTemplate, instantiateTemplate } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('GroupForTemplate')!;
    expect(getState().nodes[n1].groupId).toBe(groupId);

    // Save as template with grouped nodes
    setSelection(new Set([n1, n2]));
    const templateId = saveSelectionAsTemplate('GroupedTemplate')!;
    instantiateTemplate(templateId, [5, 0, 5]);

    // Instantiated nodes should not have groupId
    const selectedIds = [...getState().selectedIds];
    for (const id of selectedIds) {
      expect(getState().nodes[id].groupId).toBeUndefined();
    }
  });

  it('deleteTemplate removes it', () => {
    const { addNode, setSelection, saveSelectionAsTemplate, deleteTemplate } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    setSelection(new Set([n1]));
    const templateId = saveSelectionAsTemplate('ToDelete')!;
    expect(getState().templates[templateId]).toBeDefined();
    deleteTemplate(templateId);
    expect(getState().templates[templateId]).toBeUndefined();
  });

  it('importTemplates / exportTemplates round-trip', () => {
    const { addNode, setSelection, saveSelectionAsTemplate, exportTemplates, importTemplates } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1]));
    saveSelectionAsTemplate('Template1');
    setSelection(new Set([n2]));
    saveSelectionAsTemplate('Template2');

    const exported = exportTemplates();
    expect(Object.keys(exported).length).toBe(2);

    // Clear templates
    const templateIds = Object.keys(getState().templates);
    for (const id of templateIds) {
      getState().deleteTemplate(id);
    }
    expect(Object.keys(getState().templates).length).toBe(0);

    // Re-import
    importTemplates(exported);
    expect(Object.keys(getState().templates).length).toBe(2);
  });

  it('templates are workspace-global (survive graph switching)', () => {
    const { addNode, setSelection, saveSelectionAsTemplate, createGraph, switchGraph } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    setSelection(new Set([n1]));
    const templateId = saveSelectionAsTemplate('GlobalTemplate')!;

    // Create and switch to a new graph
    const graph2Id = createGraph('Graph 2');
    // Template should still be there
    expect(getState().templates[templateId]).toBeDefined();

    // Switch back
    switchGraph('default');
    expect(getState().templates[templateId]).toBeDefined();

    // Switch to graph 2 again
    switchGraph(graph2Id);
    expect(getState().templates[templateId]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Multi-Graph Tabs
// ---------------------------------------------------------------------------

describe('Multi-Graph Tabs', () => {
  beforeEach(resetStore);

  it('createGraph adds a new graph tab', () => {
    const { createGraph } = getState();
    const tabsBefore = Object.keys(getState().graphTabs).length;
    createGraph('New Graph');
    expect(Object.keys(getState().graphTabs).length).toBe(tabsBefore + 1);
  });

  it('createGraph switches to new graph', () => {
    const { createGraph } = getState();
    const graphId = createGraph('New Graph');
    expect(getState().activeGraphId).toBe(graphId);
  });

  it('switchGraph preserves and restores graph state', () => {
    const { addNode, createGraph, switchGraph } = getState();
    // Add nodes to default graph
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(2);

    // Create and switch to a new graph
    const graph2Id = createGraph('Graph 2');
    expect(Object.keys(getState().nodes).length).toBe(0);

    // Add a node to graph 2
    const n3 = getState().addNode('math', [1, 0, 1]);
    expect(Object.keys(getState().nodes).length).toBe(1);

    // Switch back to default
    switchGraph('default');
    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();

    // Switch to graph 2 again
    switchGraph(graph2Id);
    expect(Object.keys(getState().nodes).length).toBe(1);
    expect(getState().nodes[n3]).toBeDefined();
  });

  it('deleteGraph removes tab and cleans up', () => {
    const { createGraph, deleteGraph } = getState();
    const graph2Id = createGraph('ToDelete');
    expect(getState().graphTabs[graph2Id]).toBeDefined();
    deleteGraph(graph2Id);
    expect(getState().graphTabs[graph2Id]).toBeUndefined();
    expect(getState().graphOrder).not.toContain(graph2Id);
  });

  it('deleteGraph cannot delete last graph', () => {
    const { deleteGraph } = getState();
    expect(getState().graphOrder.length).toBe(1);
    deleteGraph('default');
    expect(getState().graphTabs['default']).toBeDefined();
    expect(getState().graphOrder.length).toBe(1);
  });

  it('renameGraph changes tab name', () => {
    const { renameGraph } = getState();
    renameGraph('default', 'Renamed Graph');
    expect(getState().graphTabs['default'].name).toBe('Renamed Graph');
  });

  it('reorderGraph moves tab position', () => {
    const { createGraph, reorderGraph } = getState();
    const graph2Id = createGraph('G2');
    getState().createGraph('G3');
    // Order should be: default, graph2, graph3
    expect(getState().graphOrder[0]).toBe('default');

    // Move default to end
    reorderGraph('default', 2);
    expect(getState().graphOrder[2]).toBe('default');
    expect(getState().graphOrder[0]).toBe(graph2Id);
  });

  it('each graph has independent nodes/connections/groups', () => {
    const { addNode, addConnection, setSelection, createGroup, createGraph, switchGraph } = getState();
    // Set up default graph
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    addConnection(n1, 0, n2, 0);
    setSelection(new Set([n1, n2]));
    createGroup('DefaultGroup');

    const defaultNodes = Object.keys(getState().nodes).length;
    const defaultConns = Object.keys(getState().connections).length;
    const defaultGroups = Object.keys(getState().groups).length;

    // Create graph 2
    createGraph('G2');
    expect(Object.keys(getState().nodes).length).toBe(0);
    expect(Object.keys(getState().connections).length).toBe(0);
    expect(Object.keys(getState().groups).length).toBe(0);

    // Add different content to graph 2
    getState().addNode('math', [0, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(1);

    // Switch back and verify default graph is intact
    switchGraph('default');
    expect(Object.keys(getState().nodes).length).toBe(defaultNodes);
    expect(Object.keys(getState().connections).length).toBe(defaultConns);
    expect(Object.keys(getState().groups).length).toBe(defaultGroups);
  });

  it('graph switching preserves customNodeDefs per graph', () => {
    const { addCustomNodeDef, createGraph, switchGraph } = getState();
    addCustomNodeDef({
      name: 'DefA',
      color: 'red',
      category: 'Test',
      inputs: [],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: '1',
    });
    expect(Object.keys(getState().customNodeDefs).length).toBe(1);

    createGraph('G2');
    expect(Object.keys(getState().customNodeDefs).length).toBe(0);

    switchGraph('default');
    expect(Object.keys(getState().customNodeDefs).length).toBe(1);
  });

  it('graph switching preserves subgraphDefs per graph', () => {
    const { createSubgraph, createGraph, switchGraph } = getState();
    const subId = createSubgraph('MySub');
    expect(subId).not.toBeNull();
    expect(Object.keys(getState().subgraphDefs).length).toBe(1);

    createGraph('G2');
    expect(Object.keys(getState().subgraphDefs).length).toBe(0);

    switchGraph('default');
    expect(Object.keys(getState().subgraphDefs).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Subgraphs
// ---------------------------------------------------------------------------

describe('Subgraphs', () => {
  beforeEach(resetStore);

  it('createSubgraph creates a subgraph node with input/output inside', () => {
    const { createSubgraph } = getState();
    const subId = createSubgraph('TestSub')!;
    expect(subId).not.toBeNull();

    const node = getState().nodes[subId];
    expect(node.type).toBe('subgraph');
    expect(node.title).toBe('TestSub');
    expect(node.data.innerGraphId).toBeDefined();

    // SubgraphDef should exist
    expect(getState().subgraphDefs[subId]).toBeDefined();
    const def = getState().subgraphDefs[subId];
    expect(def.innerGraphId).toBe(node.data.innerGraphId);
    expect(def.exposedInputs.length).toBe(1);
    expect(def.exposedOutputs.length).toBe(1);

    // Inner graph tab should exist
    const innerGraphId = node.data.innerGraphId as string;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();
  });

  it('convertSelectionToSubgraph wraps selected nodes', () => {
    const { addNode, addConnection, setSelection, convertSelectionToSubgraph } = getState();
    const src = addNode('source', [0, 0, 0]);
    const tfm = addNode('transform', [2, 0, 0]);
    const out = addNode('output', [4, 0, 0]);
    addConnection(src, 0, tfm, 0);
    addConnection(tfm, 0, out, 0);

    // Select the transform node (middle of chain)
    setSelection(new Set([tfm]));
    const subId = convertSelectionToSubgraph('WrappedTfm')!;
    expect(subId).not.toBeNull();

    // Original transform node should be gone, replaced by subgraph node
    expect(getState().nodes[tfm]).toBeUndefined();
    expect(getState().nodes[subId]).toBeDefined();
    expect(getState().nodes[subId].type).toBe('subgraph');
    // Source and output should still exist
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[out]).toBeDefined();
  });

  it('enterSubgraph changes active graph', () => {
    const { createSubgraph, enterSubgraph } = getState();
    const subId = createSubgraph('EnterMe')!;
    const innerGraphId = getState().nodes[subId].data.innerGraphId as string;
    const parentGraphId = getState().activeGraphId;

    enterSubgraph(subId);
    expect(getState().activeGraphId).toBe(innerGraphId);
    expect(getState().activeGraphId).not.toBe(parentGraphId);
  });

  it('enterSubgraph pushes to breadcrumb stack', () => {
    const { createSubgraph, enterSubgraph } = getState();
    const subId = createSubgraph('BreadcrumbSub')!;
    expect(getState().breadcrumbStack.length).toBe(0);

    enterSubgraph(subId);
    expect(getState().breadcrumbStack.length).toBe(1);
    expect(getState().breadcrumbStack[0].subgraphNodeId).toBe(subId);
  });

  it('exitSubgraph returns to parent graph', () => {
    const { createSubgraph, enterSubgraph, exitSubgraph } = getState();
    const parentGraphId = getState().activeGraphId;
    const subId = createSubgraph('ExitMe')!;

    enterSubgraph(subId);
    expect(getState().activeGraphId).not.toBe(parentGraphId);

    exitSubgraph();
    expect(getState().activeGraphId).toBe(parentGraphId);
  });

  it('exitSubgraph pops breadcrumb stack', () => {
    const { createSubgraph, enterSubgraph, exitSubgraph } = getState();
    const subId = createSubgraph('PopSub')!;

    enterSubgraph(subId);
    expect(getState().breadcrumbStack.length).toBe(1);

    exitSubgraph();
    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('subgraph node deletion cascades (inner graph, tabs, defs)', () => {
    const { createSubgraph, deleteSubgraphNode } = getState();
    const subId = createSubgraph('CascadeDelete')!;
    const innerGraphId = getState().nodes[subId].data.innerGraphId as string;

    // Verify everything exists before deletion
    expect(getState().nodes[subId]).toBeDefined();
    expect(getState().subgraphDefs[subId]).toBeDefined();
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    deleteSubgraphNode(subId);

    // Everything should be cleaned up
    expect(getState().nodes[subId]).toBeUndefined();
    expect(getState().subgraphDefs[subId]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('expandSubgraph inlines inner nodes back', () => {
    const { addNode, addConnection, setSelection, convertSelectionToSubgraph, expandSubgraph } = getState();
    const src = addNode('source', [0, 0, 0]);
    const tfm = addNode('transform', [2, 0, 0]);
    const out = addNode('output', [4, 0, 0]);
    addConnection(src, 0, tfm, 0);
    addConnection(tfm, 0, out, 0);

    // Convert transform to subgraph
    setSelection(new Set([tfm]));
    const subId = convertSelectionToSubgraph('ExpandMe')!;

    // Expand the subgraph back
    expandSubgraph(subId);

    // Subgraph node should be gone
    expect(getState().nodes[subId]).toBeUndefined();

    // Should have source, the re-inlined transform, and output
    const nodeTypes = (Object.values(getState().nodes) as EditorNode[]).map(n => n.type);
    expect(nodeTypes).toContain('source');
    expect(nodeTypes).toContain('transform');
    expect(nodeTypes).toContain('output');
    // No subgraph-input or subgraph-output should remain in the parent
    expect(nodeTypes).not.toContain('subgraph-input');
    expect(nodeTypes).not.toContain('subgraph-output');
  });

  it('subgraph defs persist per-graph', () => {
    const { createSubgraph, createGraph, switchGraph } = getState();
    createSubgraph('PerGraphSub');
    expect(Object.keys(getState().subgraphDefs).length).toBe(1);

    createGraph('G2');
    expect(Object.keys(getState().subgraphDefs).length).toBe(0);

    // Add a subgraph in graph 2
    getState().createSubgraph('G2Sub');
    expect(Object.keys(getState().subgraphDefs).length).toBe(1);

    // Switch back: default graph should have its own subgraphDefs
    switchGraph('default');
    expect(Object.keys(getState().subgraphDefs).length).toBe(1);
    // The def names differ
    const defNames = (Object.values(getState().subgraphDefs) as SubgraphNodeDef[]).map(d => d.name);
    expect(defNames).toContain('PerGraphSub');
  });
});

// ---------------------------------------------------------------------------
// 6. Node Collapse
// ---------------------------------------------------------------------------

describe('Node Collapse', () => {
  beforeEach(resetStore);

  it('toggleNodeCollapse toggles node collapsed state', () => {
    const { addNode, toggleNodeCollapse } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    expect(getState().nodes[n1].collapsed).toBeFalsy();
    toggleNodeCollapse(n1);
    expect(getState().nodes[n1].collapsed).toBe(true);
    toggleNodeCollapse(n1);
    expect(getState().nodes[n1].collapsed).toBe(false);
  });

  it('collapseSelected collapses all selected', () => {
    const { addNode, setSelection, collapseSelected } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    const n3 = addNode('math', [4, 0, 0]);
    setSelection(new Set([n1, n2, n3]));
    collapseSelected();
    expect(getState().nodes[n1].collapsed).toBe(true);
    expect(getState().nodes[n2].collapsed).toBe(true);
    expect(getState().nodes[n3].collapsed).toBe(true);
  });

  it('expandSelected expands all selected', () => {
    const { addNode, toggleNodeCollapse, setSelection, expandSelected } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    toggleNodeCollapse(n1);
    toggleNodeCollapse(n2);
    expect(getState().nodes[n1].collapsed).toBe(true);
    expect(getState().nodes[n2].collapsed).toBe(true);

    setSelection(new Set([n1, n2]));
    expandSelected();
    expect(getState().nodes[n1].collapsed).toBe(false);
    expect(getState().nodes[n2].collapsed).toBe(false);
  });

  it('collapse state survives undo/redo', () => {
    const { addNode, toggleNodeCollapse, undo, redo } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    toggleNodeCollapse(n1);
    expect(getState().nodes[n1].collapsed).toBe(true);

    undo();
    expect(getState().nodes[n1].collapsed).toBeFalsy();

    redo();
    expect(getState().nodes[n1].collapsed).toBe(true);
  });

  it('collapsed state is preserved in duplicate', () => {
    const { addNode, toggleNodeCollapse, setSelection, duplicateSelected } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    toggleNodeCollapse(n1);
    expect(getState().nodes[n1].collapsed).toBe(true);

    setSelection(new Set([n1]));
    duplicateSelected();

    // The new node (selected after duplicate) should have collapsed state preserved
    const selectedIds = [...getState().selectedIds];
    expect(selectedIds.length).toBe(1);
    const dupNode = getState().nodes[selectedIds[0]];
    expect(dupNode.collapsed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Import/Export Workspace
// ---------------------------------------------------------------------------

describe('Import/Export Workspace', () => {
  beforeEach(resetStore);

  it('exportAllGraphs captures all graphs', () => {
    const { addNode, createGraph } = getState();
    addNode('source', [0, 0, 0]);
    const graph2Id = createGraph('G2');
    getState().addNode('math', [1, 0, 1]);

    const exported = getState().exportAllGraphs();
    expect(exported.version).toBe(2);
    expect(Object.keys(exported.graphs).length).toBe(2);
    expect(exported.graphs['default']).toBeDefined();
    expect(exported.graphs[graph2Id]).toBeDefined();
  });

  it('importAllGraphs restores complete workspace', () => {
    const { addNode, createGraph } = getState();
    addNode('source', [0, 0, 0]);
    addNode('transform', [2, 0, 0]);
    createGraph('G2');
    getState().addNode('math', [1, 0, 1]);

    const exported = getState().exportAllGraphs();

    // Reset and reimport
    resetStore();
    getState().importAllGraphs(exported);

    // Should restore graph tabs
    expect(Object.keys(getState().graphTabs).length).toBe(2);
    expect(getState().graphOrder.length).toBe(2);
  });

  it('import includes templates', () => {
    const { addNode, setSelection, saveSelectionAsTemplate } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    setSelection(new Set([n1]));
    saveSelectionAsTemplate('ExportedTemplate');

    const exported = getState().exportAllGraphs();
    expect(Object.keys(exported.templates).length).toBe(1);

    resetStore();
    getState().importAllGraphs(exported);
    expect(Object.keys(getState().templates).length).toBe(1);
  });

  it('import preserves multi-graph structure', () => {
    const { addNode, createGraph } = getState();
    addNode('source', [0, 0, 0]);
    const graph2Id = createGraph('SecondGraph');
    getState().addNode('math', [0, 0, 0]);
    getState().addNode('compare', [2, 0, 0]);

    const exported = getState().exportAllGraphs();

    resetStore();
    getState().importAllGraphs(exported);

    // Active graph should match
    expect(getState().activeGraphId).toBe(exported.activeGraphId);
    // Both graphs should be accessible
    expect(getState().graphTabs[graph2Id]).toBeDefined();
    expect(getState().graphTabs['default']).toBeDefined();
  });

  it('import clears existing state', () => {
    const { addNode } = getState();
    // Set up some state
    addNode('source', [0, 0, 0]);
    addNode('transform', [2, 0, 0]);
    addNode('output', [4, 0, 0]);

    // Create a minimal export from a clean state
    resetStore();
    getState().addNode('math', [0, 0, 0]);
    const exported = getState().exportAllGraphs();

    // Now add more nodes
    getState().addNode('source', [1, 0, 1]);
    getState().addNode('source', [2, 0, 2]);
    expect(Object.keys(getState().nodes).length).toBe(3);

    // Import should clear existing nodes
    getState().importAllGraphs(exported);
    expect(Object.keys(getState().nodes).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Node Type Diversity
// ---------------------------------------------------------------------------

describe('Node Type Diversity', () => {
  beforeEach(resetStore);

  const allNodeTypes: NodeType[] = [
    'source', 'transform', 'filter', 'output',
    'math', 'clamp', 'remap',
    'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt',
    'lerp',
    'concat', 'template',
    'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number',
    'compare', 'switch',
    'and', 'or', 'not', 'xor',
    'compose-vec3', 'decompose-vec3',
    'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length',
    'mean', 'median', 'stddev', 'min-array', 'max-array',
    'note', 'reroute', 'random', 'display',
    'timer', 'color-picker', 'color-mix', 'hsl-to-rgb', 'rgb-to-hsl', 'http-fetch',
    'create-array', 'get-element', 'set-element', 'array-length', 'array-push', 'array-filter', 'array-map',
    'array-reduce',
    'create-object', 'get-property', 'set-property', 'object-keys', 'object-values', 'merge-objects',
    'string-concat', 'string-replace', 'string-includes', 'string-template',
    'if-gate', 'select',
    'get-var', 'set-var',
    'json-parse', 'json-stringify', 'base64-encode', 'base64-decode', 'uri-encode', 'uri-decode',
    'array-slice', 'array-find', 'array-sort', 'array-reverse', 'array-flatten', 'array-zip', 'array-unique',
    'get-timestamp', 'format-date', 'parse-date',
    'custom',
    'subgraph', 'subgraph-input', 'subgraph-output',
  ];

  it('can create all 93 node types', () => {
    const { addNode } = getState();
    expect(allNodeTypes.length).toBe(93);
    for (const nodeType of allNodeTypes) {
      const nodeId = addNode(nodeType, [0, 0, 0]);
      expect(getState().nodes[nodeId]).toBeDefined();
      expect(getState().nodes[nodeId].type).toBe(nodeType);
    }
    expect(Object.keys(getState().nodes).length).toBe(93);
  });

  it('each node type has correct port count', () => {
    const { addNode } = getState();
    const expectedPorts: Record<NodeType, { inputs: number; outputs: number }> = {
      source: { inputs: 0, outputs: 2 },
      transform: { inputs: 2, outputs: 2 },
      filter: { inputs: 1, outputs: 1 },
      output: { inputs: 2, outputs: 0 },
      math: { inputs: 2, outputs: 1 },
      clamp: { inputs: 3, outputs: 1 },
      remap: { inputs: 5, outputs: 1 },
      concat: { inputs: 2, outputs: 1 },
      template: { inputs: 2, outputs: 1 },
      compare: { inputs: 2, outputs: 1 },
      switch: { inputs: 6, outputs: 1 },
      'compose-vec3': { inputs: 3, outputs: 1 },
      'decompose-vec3': { inputs: 1, outputs: 3 },
      note: { inputs: 0, outputs: 0 },
      reroute: { inputs: 1, outputs: 1 },
      random: { inputs: 0, outputs: 1 },
      display: { inputs: 1, outputs: 0 },
      'image-preview': { inputs: 1, outputs: 1 },
      custom: { inputs: 0, outputs: 0 },   // Empty by default; set via definition
      subgraph: { inputs: 0, outputs: 0 }, // Empty by default; set via definition
      'subgraph-input': { inputs: 0, outputs: 1 },
      'subgraph-output': { inputs: 1, outputs: 0 },
      sin: { inputs: 1, outputs: 1 },
      cos: { inputs: 1, outputs: 1 },
      tan: { inputs: 1, outputs: 1 },
      abs: { inputs: 1, outputs: 1 },
      floor: { inputs: 1, outputs: 1 },
      ceil: { inputs: 1, outputs: 1 },
      round: { inputs: 1, outputs: 1 },
      log: { inputs: 1, outputs: 1 },
      sqrt: { inputs: 1, outputs: 1 },
      lerp: { inputs: 3, outputs: 1 },
      and: { inputs: 2, outputs: 1 },
      or: { inputs: 2, outputs: 1 },
      not: { inputs: 1, outputs: 1 },
      xor: { inputs: 2, outputs: 1 },
      'string-length': { inputs: 1, outputs: 1 },
      'string-trim': { inputs: 1, outputs: 1 },
      'string-split': { inputs: 2, outputs: 3 },
      'string-case': { inputs: 1, outputs: 2 },
      'parse-number': { inputs: 1, outputs: 2 },
      'dot-product': { inputs: 2, outputs: 1 },
      'cross-product': { inputs: 2, outputs: 1 },
      'normalize-vec3': { inputs: 1, outputs: 1 },
      'vec3-length': { inputs: 1, outputs: 1 },
      mean: { inputs: 1, outputs: 1 },
      median: { inputs: 1, outputs: 1 },
      stddev: { inputs: 1, outputs: 1 },
      'min-array': { inputs: 1, outputs: 1 },
      'max-array': { inputs: 1, outputs: 1 },
      timer: { inputs: 0, outputs: 1 },
      'color-picker': { inputs: 0, outputs: 4 },
      'color-mix': { inputs: 3, outputs: 1 },
      'hsl-to-rgb': { inputs: 3, outputs: 4 },
      'rgb-to-hsl': { inputs: 3, outputs: 3 },
      'http-fetch': { inputs: 2, outputs: 3 },
      'create-array': { inputs: 4, outputs: 1 },
      'get-element': { inputs: 2, outputs: 1 },
      'set-element': { inputs: 3, outputs: 1 },
      'array-length': { inputs: 1, outputs: 1 },
      'array-push': { inputs: 2, outputs: 1 },
      'array-filter': { inputs: 1, outputs: 1 },
      'array-map': { inputs: 1, outputs: 1 },
      'if-gate': { inputs: 3, outputs: 1 },
      select: { inputs: 5, outputs: 1 },
      'get-var': { inputs: 0, outputs: 1 },
      'set-var': { inputs: 1, outputs: 1 },
      'array-reduce': { inputs: 2, outputs: 1 },
      'create-object': { inputs: 4, outputs: 1 },
      'get-property': { inputs: 2, outputs: 1 },
      'set-property': { inputs: 3, outputs: 1 },
      'object-keys': { inputs: 1, outputs: 1 },
      'object-values': { inputs: 1, outputs: 1 },
      'merge-objects': { inputs: 2, outputs: 1 },
      'string-concat': { inputs: 2, outputs: 1 },
      'string-replace': { inputs: 3, outputs: 1 },
      'string-includes': { inputs: 2, outputs: 1 },
      'string-template': { inputs: 5, outputs: 1 },
      'json-parse': { inputs: 1, outputs: 1 },
      'json-stringify': { inputs: 2, outputs: 1 },
      'base64-encode': { inputs: 1, outputs: 1 },
      'base64-decode': { inputs: 1, outputs: 1 },
      'uri-encode': { inputs: 1, outputs: 1 },
      'uri-decode': { inputs: 1, outputs: 1 },
      'array-slice': { inputs: 3, outputs: 1 },
      'array-find': { inputs: 2, outputs: 2 },
      'array-sort': { inputs: 1, outputs: 1 },
      'array-reverse': { inputs: 1, outputs: 1 },
      'array-flatten': { inputs: 2, outputs: 1 },
      'array-zip': { inputs: 2, outputs: 1 },
      'array-unique': { inputs: 1, outputs: 2 },
      'get-timestamp': { inputs: 0, outputs: 1 },
      'format-date': { inputs: 1, outputs: 3 },
      'parse-date': { inputs: 1, outputs: 2 },
    };

    for (const nodeType of allNodeTypes) {
      const nodeId = addNode(nodeType, [0, 0, 0]);
      const node = getState().nodes[nodeId];
      const expected = expectedPorts[nodeType];
      expect(node.inputs.length).toBe(expected.inputs);
      expect(node.outputs.length).toBe(expected.outputs);
    }
  });

  it('port types match expected types', () => {
    const { addNode } = getState();

    // Verify a sample of port types
    const srcId = addNode('source', [0, 0, 0]);
    expect(getState().nodes[srcId].outputs[0].portType).toBe('number');
    expect(getState().nodes[srcId].outputs[1].portType).toBe('string');

    const mathId = addNode('math', [2, 0, 0]);
    expect(getState().nodes[mathId].inputs[0].portType).toBe('number');
    expect(getState().nodes[mathId].inputs[1].portType).toBe('number');
    expect(getState().nodes[mathId].outputs[0].portType).toBe('number');

    const compId = addNode('compare', [4, 0, 0]);
    expect(getState().nodes[compId].outputs[0].portType).toBe('boolean');

    const swId = addNode('switch', [6, 0, 0]);
    expect(getState().nodes[swId].inputs[0].portType).toBe('any');
    expect(getState().nodes[swId].inputs[1].portType).toBe('any');
    expect(getState().nodes[swId].outputs[0].portType).toBe('any');

    const cv3Id = addNode('compose-vec3', [8, 0, 0]);
    expect(getState().nodes[cv3Id].outputs[0].portType).toBe('vector3');

    const dv3Id = addNode('decompose-vec3', [10, 0, 0]);
    expect(getState().nodes[dv3Id].inputs[0].portType).toBe('vector3');

    const filterNode = addNode('filter', [12, 0, 0]);
    expect(getState().nodes[filterNode].inputs[0].portType).toBe('any');
    expect(getState().nodes[filterNode].outputs[0].portType).toBe('any');

    const rerouteId = addNode('reroute', [14, 0, 0]);
    expect(getState().nodes[rerouteId].inputs[0].portType).toBe('any');
    expect(getState().nodes[rerouteId].outputs[0].portType).toBe('any');

    const subInId = addNode('subgraph-input', [16, 0, 0]);
    expect(getState().nodes[subInId].outputs[0].portType).toBe('any');

    const subOutId = addNode('subgraph-output', [18, 0, 0]);
    expect(getState().nodes[subOutId].inputs[0].portType).toBe('any');
  });
});

// ---------------------------------------------------------------------------
// Additional edge-case and integration tests
// ---------------------------------------------------------------------------

describe('Cross-feature modularity', () => {
  beforeEach(resetStore);

  it('group creation with already-grouped nodes returns null', () => {
    const { addNode, setSelection, createGroup } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('First')!;
    expect(groupId).not.toBeNull();

    // Attempt to group the same nodes again
    setSelection(new Set([n1, n2]));
    const groupId2 = createGroup('Second');
    expect(groupId2).toBeNull();
  });

  it('deleteGraph with active graph switches to another', () => {
    const { createGraph, deleteGraph } = getState();
    const graph2Id = createGraph('G2');
    expect(getState().activeGraphId).toBe(graph2Id);

    deleteGraph(graph2Id);
    // Should have switched to the remaining graph (default)
    expect(getState().activeGraphId).toBe('default');
  });

  it('removeNode cleans up empty groups', () => {
    const { addNode, setSelection, createGroup, removeNode } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const n2 = addNode('transform', [2, 0, 0]);
    setSelection(new Set([n1, n2]));
    const groupId = createGroup('Cleanup')!;
    expect(getState().groups[groupId]).toBeDefined();

    removeNode(n1);
    removeNode(n2);
    // Group should be removed since no members remain
    expect(getState().groups[groupId]).toBeUndefined();
  });

  it('custom node updateCustomNodePorts removes out-of-range connections', () => {
    const { addCustomNodeDef, addCustomNode, updateCustomNodePorts, addNode, addConnection } = getState();
    const defId = addCustomNodeDef({
      name: 'ShrinkPorts',
      color: 'red',
      category: 'Test',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });
    const customId = addCustomNode(defId, [0, 0, 0])!;
    updateCustomNodePorts(customId, 3, 2);

    const srcId = addNode('source', [-2, 0, 0]);
    // Connect to input port index 2
    const connId = addConnection(srcId, 0, customId, 2);
    expect(connId).not.toBeNull();

    // Shrink to only 1 input — port 2 no longer exists
    updateCustomNodePorts(customId, 1, 1);
    // Connection referencing port 2 should be removed
    expect(getState().connections[connId!]).toBeUndefined();
  });

  it('convertSelectionToSubgraph with no selection returns null', () => {
    const { convertSelectionToSubgraph } = getState();
    const result = convertSelectionToSubgraph('Empty');
    expect(result).toBeNull();
  });

  it('exitSubgraph with empty breadcrumb stack does nothing', () => {
    const { exitSubgraph } = getState();
    const graphBefore = getState().activeGraphId;
    exitSubgraph();
    expect(getState().activeGraphId).toBe(graphBefore);
  });

  it('nested enter/exit subgraph maintains breadcrumb correctly', () => {
    const { createSubgraph, enterSubgraph } = getState();
    // Create subgraph in default graph
    const sub1 = createSubgraph('Outer')!;
    enterSubgraph(sub1);
    expect(getState().breadcrumbStack.length).toBe(1);

    // Create another subgraph inside
    const sub2 = getState().createSubgraph('Inner')!;
    getState().enterSubgraph(sub2);
    expect(getState().breadcrumbStack.length).toBe(2);

    // Exit inner
    getState().exitSubgraph();
    expect(getState().breadcrumbStack.length).toBe(1);

    // Exit outer
    getState().exitSubgraph();
    expect(getState().breadcrumbStack.length).toBe(0);
    expect(getState().activeGraphId).toBe('default');
  });

  it('template instantiation works across graphs', () => {
    const { addNode, setSelection, saveSelectionAsTemplate, createGraph, instantiateTemplate } = getState();
    // Create template in default graph
    const n1 = addNode('source', [0, 0, 0]);
    setSelection(new Set([n1]));
    const templateId = saveSelectionAsTemplate('CrossGraph')!;

    // Switch to a new graph
    createGraph('G2');
    // Template should be accessible and instantiable
    expect(getState().templates[templateId]).toBeDefined();
    instantiateTemplate(templateId, [1, 0, 1]);
    expect(Object.keys(getState().nodes).length).toBe(1);
    const newNode = (Object.values(getState().nodes) as EditorNode[])[0];
    expect(newNode.type).toBe('source');
  });

  it('deleteGraph cascades inner subgraph graphs', () => {
    const { createGraph, switchGraph, deleteGraph } = getState();
    // Create a second graph with a subgraph inside
    const graph2Id = createGraph('GraphWithSub');
    const subId = getState().createSubgraph('CascadeSub')!;
    const innerGraphId = getState().nodes[subId].data.innerGraphId as string;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Switch away so we can delete graph2
    switchGraph('default');
    deleteGraph(graph2Id);

    // Both graph2 tab and inner graph tab should be gone
    expect(getState().graphTabs[graph2Id]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('ungroupNodes on nonexistent group does nothing', () => {
    const { ungroupNodes } = getState();
    // Should not throw
    ungroupNodes('nonexistent-group-id');
    expect(Object.keys(getState().groups).length).toBe(0);
  });

  it('toggleGroupCollapse on nonexistent group does nothing', () => {
    const { toggleGroupCollapse } = getState();
    // Should not throw
    toggleGroupCollapse('nonexistent-group-id');
  });

  it('renameGroup on nonexistent group does nothing', () => {
    const { renameGroup } = getState();
    // Should not throw
    renameGroup('nonexistent-group-id', 'Phantom');
  });

  it('collapseSelected does nothing when no nodes are selected', () => {
    const { addNode, collapseSelected } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    collapseSelected();
    expect(getState().nodes[n1].collapsed).toBeFalsy();
  });

  it('expandSelected does nothing when no nodes are selected', () => {
    const { addNode, toggleNodeCollapse, expandSelected } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    toggleNodeCollapse(n1);
    expandSelected();
    expect(getState().nodes[n1].collapsed).toBe(true);
  });

  it('switchGraph to same graph is a no-op', () => {
    const { addNode, switchGraph } = getState();
    const n1 = addNode('source', [0, 0, 0]);
    const nodesBefore = Object.keys(getState().nodes).length;
    switchGraph('default');
    expect(Object.keys(getState().nodes).length).toBe(nodesBefore);
    expect(getState().nodes[n1]).toBeDefined();
  });

  it('switchGraph to nonexistent graph is a no-op', () => {
    const { switchGraph } = getState();
    const activeGraphBefore = getState().activeGraphId;
    switchGraph('does-not-exist');
    expect(getState().activeGraphId).toBe(activeGraphBefore);
  });

  it('port type compatibility enforced in connections', () => {
    const { addNode, addConnection } = getState();
    // compose-vec3 outputs vector3, math inputs number — incompatible
    const vecId = addNode('compose-vec3', [0, 0, 0]);
    const mathId = addNode('math', [2, 0, 0]);
    const connId = addConnection(vecId, 0, mathId, 0);
    expect(connId).toBeNull();
  });

  it('any port type connects with any other type', () => {
    const { addNode, addConnection } = getState();
    // reroute has 'any' input, source outputs 'number'
    const srcId = addNode('source', [0, 0, 0]);
    const rerouteId = addNode('reroute', [2, 0, 0]);
    const connId = addConnection(srcId, 0, rerouteId, 0);
    expect(connId).not.toBeNull();
  });
});

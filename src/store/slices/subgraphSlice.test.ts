import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../editorStore';

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
    breadcrumbStack: [],
    activeGraphId: 'default',
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    graphOrder: ['default'],
    templates: {},
    storageWarning: null,
  });
}

function getState() {
  return useEditorStore.getState();
}

// ===========================================================================
// createSubgraph
// ===========================================================================
describe('createSubgraph', () => {
  beforeEach(() => { resetStore(); });

  it('creates a subgraph node of type "subgraph"', () => {
    const sgId = getState().createSubgraph('TestSG');
    expect(sgId).not.toBeNull();
    const node = getState().nodes[sgId!];
    expect(node).toBeDefined();
    expect(node.type).toBe('subgraph');
  });

  it('creates a subgraphDef with innerGraphId, exposedInputs, exposedOutputs', () => {
    const sgId = getState().createSubgraph('DefTest')!;
    const def = getState().subgraphDefs[sgId];
    expect(def).toBeDefined();
    expect(def.name).toBe('DefTest');
    expect(def.innerGraphId).toBeTruthy();
    expect(Array.isArray(def.exposedInputs)).toBe(true);
    expect(def.exposedInputs.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(def.exposedOutputs)).toBe(true);
    expect(def.exposedOutputs.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a graph tab for the inner graph', () => {
    const sgId = getState().createSubgraph('TabTest')!;
    const def = getState().subgraphDefs[sgId];
    const tab = getState().graphTabs[def.innerGraphId];
    expect(tab).toBeDefined();
    expect(tab.name).toBe('TabTest');
  });

  it('defaults name to "Subgraph" when omitted', () => {
    const sgId = getState().createSubgraph()!;
    expect(getState().nodes[sgId].title).toBe('Subgraph');
    expect(getState().subgraphDefs[sgId].name).toBe('Subgraph');
  });

  it('selects the new subgraph node', () => {
    const sgId = getState().createSubgraph()!;
    expect(getState().selectedIds.has(sgId)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('is undoable (undo removes node, def, tab; redo restores them)', () => {
    const sgId = getState().createSubgraph('UndoTest')!;
    const innerGraphId = getState().subgraphDefs[sgId].innerGraphId;

    // Verify created
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().subgraphDefs[sgId]).toBeDefined();
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Undo
    getState().undo();
    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();

    // Redo
    getState().redo();
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().subgraphDefs[sgId]).toBeDefined();
  });

  it('subgraph node has input and output ports', () => {
    const sgId = getState().createSubgraph()!;
    const node = getState().nodes[sgId];
    expect(node.inputs.length).toBeGreaterThan(0);
    expect(node.outputs.length).toBeGreaterThan(0);
  });

  it('stores innerGraphId in node data', () => {
    const sgId = getState().createSubgraph('DataTest')!;
    const node = getState().nodes[sgId];
    const def = getState().subgraphDefs[sgId];
    expect(node.data.innerGraphId).toBe(def.innerGraphId);
    expect(node.data.subgraphDefId).toBe(sgId);
  });
});

// ===========================================================================
// convertSelectionToSubgraph
// ===========================================================================
describe('convertSelectionToSubgraph', () => {
  beforeEach(() => { resetStore(); });

  it('returns null when nothing is selected', () => {
    const result = getState().convertSelectionToSubgraph('Empty');
    expect(result).toBeNull();
  });

  it('converts a single node into a subgraph', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const sgId = getState().convertSelectionToSubgraph('Single')!;

    expect(sgId).not.toBeNull();
    // Original node should be gone from parent graph
    expect(getState().nodes[src]).toBeUndefined();
    // Subgraph node should exist
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().nodes[sgId].type).toBe('subgraph');
  });

  it('converts multi-node selection with internal connections', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(a, 0, b, 0);

    getState().setSelection(new Set([a, b]));
    const sgId = getState().convertSelectionToSubgraph('Chain')!;

    // Both original nodes removed from parent
    expect(getState().nodes[a]).toBeUndefined();
    expect(getState().nodes[b]).toBeUndefined();
    // Subgraph node exists
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().nodes[sgId].type).toBe('subgraph');
  });

  it('preserves external connections via subgraph ports', () => {
    const ext1 = getState().addNode('source', [-3, 0, 0]);
    const inner = getState().addNode('transform', [0, 0, 0]);
    const ext2 = getState().addNode('output', [3, 0, 0]);

    getState().addConnection(ext1, 0, inner, 0);
    getState().addConnection(inner, 0, ext2, 0);

    getState().setSelection(new Set([inner]));
    const sgId = getState().convertSelectionToSubgraph('Middle')!;

    // External nodes still exist
    expect(getState().nodes[ext1]).toBeDefined();
    expect(getState().nodes[ext2]).toBeDefined();

    // Check connections: ext1 -> subgraph -> ext2
    const conns = Object.values(getState().connections);
    const toSubgraph = conns.filter(c => c.targetNodeId === sgId);
    const fromSubgraph = conns.filter(c => c.sourceNodeId === sgId);
    expect(toSubgraph.length).toBeGreaterThan(0);
    expect(fromSubgraph.length).toBeGreaterThan(0);
  });

  it('places subgraph node at center of selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [10, 0, 10]);
    getState().addConnection(a, 0, b, 0);

    getState().setSelection(new Set([a, b]));
    const sgId = getState().convertSelectionToSubgraph('Center')!;

    expect(getState().nodes[sgId].position[0]).toBe(5); // avg of 0 and 10
    expect(getState().nodes[sgId].position[2]).toBe(5);
  });

  it('refuses to convert subgraph-input or subgraph-output nodes', () => {
    // Create a subgraph and enter it so boundary nodes are available
    const sgId = getState().createSubgraph('Test')!;
    getState().enterSubgraph(sgId);

    // Find the subgraph-input node inside
    const inputNodes = Object.values(getState().nodes).filter(n => n.type === 'subgraph-input');
    expect(inputNodes.length).toBeGreaterThan(0);

    getState().setSelection(new Set([inputNodes[0].id]));
    const result = getState().convertSelectionToSubgraph('Nested');
    expect(result).toBeNull();

    getState().exitSubgraph();
  });

  it('is undoable (undo restores original nodes and connections)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(a, 0, b, 0);

    getState().setSelection(new Set([a, b]));
    getState().convertSelectionToSubgraph('UndoTest');

    // Undo should restore original nodes
    getState().undo();
    expect(getState().nodes[a]).toBeDefined();
    expect(getState().nodes[b]).toBeDefined();
    expect(getState().nodes[a].type).toBe('source');
    expect(getState().nodes[b].type).toBe('transform');
    // Connection should be restored
    const conns = Object.values(getState().connections);
    expect(conns.some(c => c.sourceNodeId === a && c.targetNodeId === b)).toBe(true);
  });

  it('handles selection with only non-node IDs gracefully', () => {
    // Select IDs that don't correspond to any nodes
    getState().setSelection(new Set(['non-existent-1', 'non-existent-2']));
    const result = getState().convertSelectionToSubgraph('Ghost');
    expect(result).toBeNull();
  });

  it('removes original nodes from parent graph', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);

    // Only select a and b
    getState().setSelection(new Set([a, b]));
    const sgId = getState().convertSelectionToSubgraph('Remove')!;

    // a and b should be gone
    expect(getState().nodes[a]).toBeUndefined();
    expect(getState().nodes[b]).toBeUndefined();
    // c should still be there
    expect(getState().nodes[c]).toBeDefined();
    // sgId should exist
    expect(getState().nodes[sgId]).toBeDefined();
  });

  it('creates subgraphDef with correct port mappings for external connections', () => {
    const ext = getState().addNode('source', [-3, 0, 0]);
    const inner = getState().addNode('transform', [0, 0, 0]);
    getState().addConnection(ext, 0, inner, 0);

    getState().setSelection(new Set([inner]));
    const sgId = getState().convertSelectionToSubgraph('Ports')!;

    const def = getState().subgraphDefs[sgId];
    expect(def).toBeDefined();
    // Should have at least one exposed input (from ext -> inner)
    expect(def.exposedInputs.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// enterSubgraph / exitSubgraph
// ===========================================================================
describe('enterSubgraph / exitSubgraph', () => {
  beforeEach(() => { resetStore(); });

  it('enterSubgraph switches to inner graph (activeGraphId changes)', () => {
    const sgId = getState().createSubgraph('Nav')!;
    const outerGraphId = getState().activeGraphId;

    getState().enterSubgraph(sgId);

    expect(getState().activeGraphId).not.toBe(outerGraphId);
  });

  it('enterSubgraph creates subgraph-input and subgraph-output nodes in inner graph', () => {
    const sgId = getState().createSubgraph('Inner')!;
    getState().enterSubgraph(sgId);

    const nodeTypes = Object.values(getState().nodes).map(n => n.type);
    expect(nodeTypes).toContain('subgraph-input');
    expect(nodeTypes).toContain('subgraph-output');
  });

  it('enterSubgraph updates breadcrumb stack', () => {
    const sgId = getState().createSubgraph('Bread')!;
    expect(getState().breadcrumbStack.length).toBe(0);

    getState().enterSubgraph(sgId);
    expect(getState().breadcrumbStack.length).toBe(1);
    expect(getState().breadcrumbStack[0].subgraphNodeId).toBe(sgId);
  });

  it('enterSubgraph clears transient state (executionStates, contextMenu, interaction)', () => {
    const sgId = getState().createSubgraph('Clear')!;
    useEditorStore.setState({
      executionStates: { fake: 'running' as const },
      contextMenu: { x: 0, y: 0, target: { kind: 'canvas' as const } },
      interaction: 'box-selecting' as const,
    });

    getState().enterSubgraph(sgId);

    expect(getState().executionStates).toEqual({});
    expect(getState().contextMenu).toBeNull();
    expect(getState().interaction).toBe('idle');
  });

  it('exitSubgraph returns to parent graph', () => {
    const sgId = getState().createSubgraph('Exit')!;
    const outerGraphId = getState().activeGraphId;

    getState().enterSubgraph(sgId);
    expect(getState().activeGraphId).not.toBe(outerGraphId);

    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(outerGraphId);
    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('exitSubgraph selects the subgraph node on return', () => {
    const sgId = getState().createSubgraph('SelectOnExit')!;
    getState().enterSubgraph(sgId);
    getState().exitSubgraph();
    expect(getState().selectedIds.has(sgId)).toBe(true);
  });

  it('exitSubgraph is a no-op at top level', () => {
    const outerGraphId = getState().activeGraphId;
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(outerGraphId);
    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('enterSubgraph on non-subgraph node is a no-op', () => {
    const src = getState().addNode('source');
    const beforeGraphId = getState().activeGraphId;
    getState().enterSubgraph(src);
    expect(getState().activeGraphId).toBe(beforeGraphId);
    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('nested subgraph navigation: enter -> enter -> exit -> exit', () => {
    // Level 1 subgraph in main graph
    const sg1 = getState().createSubgraph('Level 1')!;
    const mainGraphId = getState().activeGraphId;

    // Enter level 1
    getState().enterSubgraph(sg1);
    const level1GraphId = getState().activeGraphId;
    expect(getState().breadcrumbStack.length).toBe(1);

    // Create level 2 subgraph inside level 1
    const sg2 = getState().createSubgraph('Level 2')!;

    // Enter level 2
    getState().enterSubgraph(sg2);
    expect(getState().breadcrumbStack.length).toBe(2);
    expect(getState().activeGraphId).not.toBe(level1GraphId);

    // Exit level 2 -> back to level 1
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(level1GraphId);
    expect(getState().breadcrumbStack.length).toBe(1);

    // Exit level 1 -> back to main
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(mainGraphId);
    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('enter/exit preserves nodes added inside subgraph', () => {
    const sgId = getState().createSubgraph('Persist')!;

    getState().enterSubgraph(sgId);
    // Add a node inside
    const innerNode = getState().addNode('source', [0, 0, 2]);
    expect(getState().nodes[innerNode]).toBeDefined();

    // Exit
    getState().exitSubgraph();

    // Re-enter - the added node should still be there
    getState().enterSubgraph(sgId);
    expect(getState().nodes[innerNode]).toBeDefined();

    getState().exitSubgraph();
  });

  it('enterSubgraph clears selectedIds in inner graph', () => {
    const sgId = getState().createSubgraph('ClearSel')!;
    // Select some node before entering
    const src = getState().addNode('source');
    getState().setSelection(new Set([src, sgId]));

    getState().enterSubgraph(sgId);
    expect(getState().selectedIds.size).toBe(0);
  });

  it('enterSubgraph on nonexistent node is a no-op', () => {
    const graphBefore = getState().activeGraphId;
    getState().enterSubgraph('nonexistent-id-999');
    expect(getState().activeGraphId).toBe(graphBefore);
  });
});

// ===========================================================================
// deleteSubgraphNode
// ===========================================================================
describe('deleteSubgraphNode', () => {
  beforeEach(() => { resetStore(); });

  it('deletes subgraph node and its def', () => {
    const sgId = getState().createSubgraph('DelTest')!;
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().subgraphDefs[sgId]).toBeDefined();

    getState().deleteSubgraphNode(sgId);

    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();
  });

  it('removes connections to/from the subgraph node', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const sgId = getState().createSubgraph('ConnTest')!;
    const out = getState().addNode('output', [6, 0, 0]);

    getState().addConnection(src, 0, sgId, 0);
    getState().addConnection(sgId, 0, out, 0);

    const connsBefore = Object.values(getState().connections)
      .filter(c => c.sourceNodeId === sgId || c.targetNodeId === sgId);
    expect(connsBefore.length).toBeGreaterThan(0);

    getState().deleteSubgraphNode(sgId);

    const connsAfter = Object.values(getState().connections)
      .filter(c => c.sourceNodeId === sgId || c.targetNodeId === sgId);
    expect(connsAfter.length).toBe(0);
  });

  it('removes inner graph tab', () => {
    const sgId = getState().createSubgraph('TabDel')!;
    const def = getState().subgraphDefs[sgId];
    const innerGraphId = def.innerGraphId;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    getState().deleteSubgraphNode(sgId);

    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('is undoable', () => {
    const sgId = getState().createSubgraph('UndoDel')!;
    getState().deleteSubgraphNode(sgId);
    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();

    getState().undo();
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().subgraphDefs[sgId]).toBeDefined();
  });

  it('ignores non-subgraph nodes (source node is not deleted)', () => {
    const src = getState().addNode('source');
    getState().deleteSubgraphNode(src);
    // Source node should still exist
    expect(getState().nodes[src]).toBeDefined();
  });

  it('removes subgraph node from selectedIds', () => {
    const sgId = getState().createSubgraph('SelDel')!;
    // createSubgraph auto-selects
    expect(getState().selectedIds.has(sgId)).toBe(true);

    getState().deleteSubgraphNode(sgId);
    expect(getState().selectedIds.has(sgId)).toBe(false);
  });

  it('does not affect other nodes in the graph', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const sgId = getState().createSubgraph('Other')!;
    const trn = getState().addNode('transform', [6, 0, 0]);

    getState().deleteSubgraphNode(sgId);

    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[trn]).toBeDefined();
  });
});

// ===========================================================================
// expandSubgraph
// ===========================================================================
describe('expandSubgraph', () => {
  beforeEach(() => { resetStore(); });

  it('inner nodes appear in parent graph after expand', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(src, 0, trn, 0);

    getState().setSelection(new Set([src, trn]));
    const sgId = getState().convertSelectionToSubgraph('Expand')!;

    // Expand
    getState().expandSubgraph(sgId);

    // Subgraph node should be gone
    expect(getState().nodes[sgId]).toBeUndefined();
    // Original nodes should be restored
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[trn]).toBeDefined();
  });

  it('restores external connections after expand', () => {
    const ext1 = getState().addNode('source', [-3, 0, 0]);
    const inner = getState().addNode('transform', [0, 0, 0]);
    const ext2 = getState().addNode('output', [3, 0, 0]);

    getState().addConnection(ext1, 0, inner, 0);
    getState().addConnection(inner, 0, ext2, 0);

    getState().setSelection(new Set([inner]));
    const sgId = getState().convertSelectionToSubgraph('ExtConn')!;
    getState().expandSubgraph(sgId);

    // ext1 -> inner -> ext2 connections should be restored
    const conns = Object.values(getState().connections);
    const ext1ToInner = conns.find(c => c.sourceNodeId === ext1 && c.targetNodeId === inner);
    const innerToExt2 = conns.find(c => c.sourceNodeId === inner && c.targetNodeId === ext2);
    expect(ext1ToInner).toBeDefined();
    expect(innerToExt2).toBeDefined();
  });

  it('removes subgraphDef and inner graph tab on expand', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const sgId = getState().convertSelectionToSubgraph('RemoveDef')!;
    const def = getState().subgraphDefs[sgId];
    const innerGraphId = def.innerGraphId;

    getState().expandSubgraph(sgId);

    expect(getState().subgraphDefs[sgId]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('is undoable', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const sgId = getState().convertSelectionToSubgraph('UndoExpand')!;
    getState().expandSubgraph(sgId);

    // Undo expand -> subgraph node should be back
    getState().undo();
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().nodes[sgId].type).toBe('subgraph');
  });

  it('selects expanded nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().setSelection(new Set([a, b]));
    const sgId = getState().convertSelectionToSubgraph('SelExpand')!;

    getState().expandSubgraph(sgId);

    // Expanded nodes should be selected
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
  });

  it('ignores non-subgraph nodes', () => {
    const src = getState().addNode('source');
    const nodeCountBefore = Object.keys(getState().nodes).length;
    getState().expandSubgraph(src);
    expect(Object.keys(getState().nodes).length).toBe(nodeCountBefore);
  });

  it('does not expand a subgraph with no content nodes', () => {
    // createSubgraph makes an inner graph with only subgraph-input/subgraph-output
    const sgId = getState().createSubgraph('Empty')!;
    const nodeCountBefore = Object.keys(getState().nodes).length;

    getState().expandSubgraph(sgId);

    // Nothing should change (guard: hasContentNodes is false)
    expect(getState().nodes[sgId]).toBeDefined();
    expect(Object.keys(getState().nodes).length).toBe(nodeCountBefore);
  });

  it('subgraph node is removed from connections after expand', () => {
    const ext = getState().addNode('source', [-3, 0, 0]);
    const inner = getState().addNode('transform', [0, 0, 0]);
    getState().addConnection(ext, 0, inner, 0);

    getState().setSelection(new Set([inner]));
    const sgId = getState().convertSelectionToSubgraph('ConnClean')!;

    // Verify connection to subgraph exists
    const connsBefore = Object.values(getState().connections)
      .filter(c => c.sourceNodeId === sgId || c.targetNodeId === sgId);
    expect(connsBefore.length).toBeGreaterThan(0);

    getState().expandSubgraph(sgId);

    // No connections should reference the old subgraph node
    const connsAfter = Object.values(getState().connections)
      .filter(c => c.sourceNodeId === sgId || c.targetNodeId === sgId);
    expect(connsAfter.length).toBe(0);
  });
});

// ===========================================================================
// Cross-cutting: round-trip and edge cases
// ===========================================================================
describe('subgraph round-trip and edge cases', () => {
  beforeEach(() => { resetStore(); });

  it('create -> enter -> add node -> exit -> re-enter round-trip', () => {
    const sgId = getState().createSubgraph('RoundTrip')!;

    // Enter
    getState().enterSubgraph(sgId);
    const innerGraphId = getState().activeGraphId;

    // Add a node inside
    const innerSrc = getState().addNode('source', [1, 0, 1]);
    expect(getState().nodes[innerSrc]).toBeDefined();

    // Exit
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe('default');
    expect(getState().nodes[sgId]).toBeDefined();

    // Re-enter
    getState().enterSubgraph(sgId);
    expect(getState().activeGraphId).toBe(innerGraphId);
    expect(getState().nodes[innerSrc]).toBeDefined();

    getState().exitSubgraph();
  });

  it('convert -> expand is identity (nodes restored with same IDs)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(a, 0, b, 0);

    getState().setSelection(new Set([a, b]));
    const sgId = getState().convertSelectionToSubgraph('Identity')!;
    getState().expandSubgraph(sgId);

    // Nodes are back with original IDs
    expect(getState().nodes[a]).toBeDefined();
    expect(getState().nodes[a].type).toBe('source');
    expect(getState().nodes[b]).toBeDefined();
    expect(getState().nodes[b].type).toBe('transform');
    // Subgraph node is gone
    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();
  });

  it('subgraphDefs persist across enter/exit cycle', () => {
    const sgId = getState().createSubgraph('Persist')!;
    const defBefore = getState().subgraphDefs[sgId];
    expect(defBefore).toBeDefined();

    getState().enterSubgraph(sgId);
    getState().exitSubgraph();

    const defAfter = getState().subgraphDefs[sgId];
    expect(defAfter).toBeDefined();
    expect(defAfter.name).toBe('Persist');
    expect(defAfter.innerGraphId).toBe(defBefore.innerGraphId);
  });

  it('deleteSubgraphNode while not viewing it does not crash', () => {
    const sgId = getState().createSubgraph('SafeDel')!;

    // We are at top level, not inside the subgraph
    expect(getState().activeGraphId).toBe('default');

    // Delete should work cleanly
    getState().deleteSubgraphNode(sgId);
    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();
  });

  it('multiple subgraphs can coexist in the same graph', () => {
    const sg1 = getState().createSubgraph('First')!;
    const sg2 = getState().createSubgraph('Second')!;
    const sg3 = getState().createSubgraph('Third')!;

    expect(getState().nodes[sg1]).toBeDefined();
    expect(getState().nodes[sg2]).toBeDefined();
    expect(getState().nodes[sg3]).toBeDefined();
    expect(Object.keys(getState().subgraphDefs).length).toBe(3);

    // Deleting one does not affect others
    getState().deleteSubgraphNode(sg2);
    expect(getState().nodes[sg1]).toBeDefined();
    expect(getState().subgraphDefs[sg1]).toBeDefined();
    expect(getState().nodes[sg3]).toBeDefined();
    expect(getState().subgraphDefs[sg3]).toBeDefined();
    expect(getState().nodes[sg2]).toBeUndefined();
  });

  it('breadcrumb records correct graphId and subgraphNodeId', () => {
    const sgId = getState().createSubgraph('Breadcrumb')!;
    const mainGraphId = getState().activeGraphId;

    getState().enterSubgraph(sgId);

    const crumb = getState().breadcrumbStack[0];
    expect(crumb.graphId).toBe(mainGraphId);
    expect(crumb.subgraphNodeId).toBe(sgId);
  });

  it('undo after entering subgraph only affects inner graph', () => {
    const sgId = getState().createSubgraph('UndoInner')!;
    getState().enterSubgraph(sgId);

    // Add a node inside
    const innerNode = getState().addNode('source', [0, 0, 2]);
    expect(getState().nodes[innerNode]).toBeDefined();

    // Undo the add
    getState().undo();
    expect(getState().nodes[innerNode]).toBeUndefined();

    // Exit back to parent -- parent should be unaffected
    getState().exitSubgraph();
    expect(getState().nodes[sgId]).toBeDefined();
  });

  it('convertSelectionToSubgraph selects the new subgraph node', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const sgId = getState().convertSelectionToSubgraph('SelConvert')!;

    expect(getState().selectedIds.has(sgId)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('inner graph tab is not added to graphOrder (not a user tab)', () => {
    const sgId = getState().createSubgraph('NoTab')!;
    const def = getState().subgraphDefs[sgId];
    const innerGraphId = def.innerGraphId;

    // graphOrder should not include the inner graph
    expect(getState().graphOrder).not.toContain(innerGraphId);
    // But graphTabs should have it
    expect(getState().graphTabs[innerGraphId]).toBeDefined();
  });
});

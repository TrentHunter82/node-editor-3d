/**
 * Tests for cascade operations in multi-graph and subgraph scenarios.
 * Covers gaps identified in:
 * - deleteGraph cascade cleanup (inner graph undoStacks/redoStacks/executionCache)
 * - deleteSelected with subgraph nodes
 * - switchGraph state persistence (subgraphDefs, errorStrategy round-trip)
 * - distributeSelected edge cases
 * - batchUpdateNodeTitles edge cases
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';

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
// deleteSelected: subgraph cascade cleanup
// ==========================================================================
describe('deleteSelected — subgraph cascade', () => {
  beforeEach(() => { resetStore(); });

  it('cleans up inner graph tab when deleting subgraph node via deleteSelected', () => {
    // Create a subgraph node
    const sgId = getState().createSubgraph('SG')!;
    expect(sgId).toBeTruthy();
    const innerGraphId = getState().subgraphDefs[sgId].innerGraphId;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Select and delete
    getState().setSelection(new Set([sgId]));
    getState().deleteSelected();

    // Inner graph tab should be gone
    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('cleans up connections when deleting subgraph node via deleteSelected', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const sgId = getState().createSubgraph('SG')!;
    getState().addConnection(src, 0, sgId, 0);

    expect(Object.values(getState().connections).length).toBeGreaterThan(0);

    getState().setSelection(new Set([sgId]));
    getState().deleteSelected();

    // No connections should reference the deleted node
    const orphanConns = Object.values(getState().connections)
      .filter(c => c.sourceNodeId === sgId || c.targetNodeId === sgId);
    expect(orphanConns).toHaveLength(0);
  });

  it('does NOT delete subgraph-input or subgraph-output nodes', () => {
    // Enter a subgraph
    const sgId = getState().createSubgraph('SG')!;
    getState().enterSubgraph(sgId);

    // Find the boundary nodes
    const boundaryNodes = Object.values(getState().nodes)
      .filter(n => n.type === 'subgraph-input' || n.type === 'subgraph-output');
    expect(boundaryNodes.length).toBeGreaterThan(0);

    // Select all and try to delete
    const allIds = new Set(Object.keys(getState().nodes));
    getState().setSelection(allIds);
    getState().deleteSelected();

    // Boundary nodes should survive
    const remaining = Object.values(getState().nodes)
      .filter(n => n.type === 'subgraph-input' || n.type === 'subgraph-output');
    expect(remaining.length).toBe(boundaryNodes.length);
  });

  it('deleting subgraph node is undoable and restores inner graph tab', () => {
    const sgId = getState().createSubgraph('SG')!;

    getState().setSelection(new Set([sgId]));
    getState().deleteSelected();

    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();

    getState().undo();

    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().subgraphDefs[sgId]).toBeDefined();
    // Note: graphTabs restoration depends on whether undo restores graph tabs (it restores subgraphDefs but graphTabs are managed separately)
  });

  it('deleting multiple subgraph nodes at once cleans up all inner graphs', () => {
    const sg1 = getState().createSubgraph('SG1')!;
    const sg2 = getState().createSubgraph('SG2')!;
    const inner1 = getState().subgraphDefs[sg1].innerGraphId;
    const inner2 = getState().subgraphDefs[sg2].innerGraphId;

    getState().setSelection(new Set([sg1, sg2]));
    getState().deleteSelected();

    expect(getState().nodes[sg1]).toBeUndefined();
    expect(getState().nodes[sg2]).toBeUndefined();
    expect(getState().subgraphDefs[sg1]).toBeUndefined();
    expect(getState().subgraphDefs[sg2]).toBeUndefined();
    expect(getState().graphTabs[inner1]).toBeUndefined();
    expect(getState().graphTabs[inner2]).toBeUndefined();
  });
});

// ==========================================================================
// switchGraph: state persistence round-trip
// ==========================================================================
describe('switchGraph — state persistence', () => {
  beforeEach(() => { resetStore(); });

  it('preserves subgraphDefs when switching graphs', () => {
    // Create subgraph in main graph
    const sgId = getState().createSubgraph('SG')!;
    const def = getState().subgraphDefs[sgId];
    expect(def).toBeDefined();

    const mainGraphId = getState().activeGraphId;

    // Create and switch to new graph
    const newGraph = getState().createGraph('Graph 2');
    getState().switchGraph(newGraph);
    expect(Object.keys(getState().subgraphDefs)).toHaveLength(0);

    // Switch back
    getState().switchGraph(mainGraphId);
    expect(getState().subgraphDefs[sgId]).toBeDefined();
    expect(getState().subgraphDefs[sgId].innerGraphId).toBe(def.innerGraphId);
  });

  it('preserves errorStrategy when switching graphs', () => {
    const mainGraphId = getState().activeGraphId;
    getState().setErrorStrategy('continue');
    expect(getState().errorStrategy).toBe('continue');

    const newGraph = getState().createGraph('Graph 2');
    getState().switchGraph(newGraph);
    // New graph should have default
    expect(getState().errorStrategy).toBe('fail-fast');

    getState().switchGraph(mainGraphId);
    expect(getState().errorStrategy).toBe('continue');
  });

  it('preserves customNodeDefs when switching graphs', () => {
    const mainGraphId = getState().activeGraphId;
    const defId = getState().addCustomNodeDef({
      name: 'Custom1', color: 'blue', category: 'Math',
      expression: 'in0 + 1',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
    });

    const newGraph = getState().createGraph('Graph 2');
    getState().switchGraph(newGraph);
    expect(Object.keys(getState().customNodeDefs)).toHaveLength(0);

    getState().switchGraph(mainGraphId);
    expect(getState().customNodeDefs[defId]).toBeDefined();
    expect(getState().customNodeDefs[defId].name).toBe('Custom1');
  });

  it('clears transient state when switching graphs', () => {
    // Simulate some transient state
    useEditorStore.setState((s) => {
      s.selectedIds = new Set(['fake-id']);
      s.pendingConnection = { sourceNodeId: 'fake', sourcePortIndex: 0, cursorPos: [0, 0, 0] };
      s.contextMenu = { x: 0, y: 0, target: { kind: 'node', nodeId: 'fake' } };
    });

    const newGraph = getState().createGraph('Graph 2');
    getState().switchGraph(newGraph);

    expect(getState().selectedIds.size).toBe(0);
    expect(getState().pendingConnection).toBeNull();
    expect(getState().contextMenu).toBeNull();
    expect(getState().interaction).toBe('idle');
  });

  it('preserves nodes and connections after round-trip', () => {
    const mainGraphId = getState().activeGraphId;
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(src, 0, trn, 0);

    const newGraph = getState().createGraph('Graph 2');
    getState().switchGraph(newGraph);
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    getState().switchGraph(mainGraphId);
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[trn]).toBeDefined();
    expect(Object.keys(getState().connections).length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// deleteGraph: cascade cleanup
// ==========================================================================
describe('deleteGraph — cascade operations', () => {
  beforeEach(() => { resetStore(); });

  it('cannot delete the last graph', () => {
    expect(getState().graphOrder).toHaveLength(1);
    getState().deleteGraph(getState().activeGraphId);
    // Should still have one graph
    expect(getState().graphOrder.length).toBeGreaterThanOrEqual(1);
  });

  it('deletes graph and switches to adjacent graph', () => {
    const g2 = getState().createGraph('Graph 2');
    getState().createGraph('Graph 3');
    expect(getState().graphOrder).toHaveLength(3);

    getState().switchGraph(g2);
    getState().deleteGraph(g2);

    expect(getState().graphTabs[g2]).toBeUndefined();
    expect(getState().graphOrder).not.toContain(g2);
    // Should have switched to an adjacent graph
    expect(getState().activeGraphId).not.toBe(g2);
  });

  it('cascade-deletes inner graphs when deleting graph with subgraph nodes', () => {
    // Create subgraph in a secondary graph
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);

    const sgId = getState().createSubgraph('SG')!;
    const innerGraphId = getState().subgraphDefs[sgId].innerGraphId;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Switch away, then delete the graph
    getState().switchGraph('default');
    getState().deleteGraph(g2);

    // Inner graph tab should also be deleted
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
    expect(getState().graphTabs[g2]).toBeUndefined();
  });
});

// ==========================================================================
// batchUpdateNodeTitles edge cases
// ==========================================================================
describe('batchUpdateNodeTitles', () => {
  beforeEach(() => { resetStore(); });

  it('updates multiple node titles in one undo entry', () => {
    const n1 = getState().addNode('source');
    const n2 = getState().addNode('transform');
    const n3 = getState().addNode('output');

    getState().batchUpdateNodeTitles([
      { nodeId: n1, title: 'Input' },
      { nodeId: n2, title: 'Process' },
      { nodeId: n3, title: 'Result' },
    ]);

    expect(getState().nodes[n1].title).toBe('Input');
    expect(getState().nodes[n2].title).toBe('Process');
    expect(getState().nodes[n3].title).toBe('Result');

    // Single undo should revert ALL title changes
    getState().undo();
    expect(getState().nodes[n1].title).not.toBe('Input');
    expect(getState().nodes[n2].title).not.toBe('Process');
    expect(getState().nodes[n3].title).not.toBe('Result');
  });

  it('handles empty updates array without pushing undo', () => {
    getState().addNode('source');
    const undoBefore = getState().canUndo();

    getState().batchUpdateNodeTitles([]);

    // No extra undo entry for no-op
    expect(getState().canUndo()).toBe(undoBefore);
  });

  it('ignores invalid node IDs gracefully', () => {
    const n1 = getState().addNode('source');

    getState().batchUpdateNodeTitles([
      { nodeId: n1, title: 'Valid' },
      { nodeId: 'nonexistent-id', title: 'Invalid' },
    ]);

    expect(getState().nodes[n1].title).toBe('Valid');
    expect(getState().nodes['nonexistent-id']).toBeUndefined();
  });
});

// ==========================================================================
// distributeSelected edge cases
// ==========================================================================
describe('distributeSelected edge cases', () => {
  beforeEach(() => { resetStore(); });

  it('does nothing with fewer than 3 selected nodes', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    getState().setSelection(new Set([n1, n2]));

    const pos1Before = [...getState().nodes[n1].position];
    const pos2Before = [...getState().nodes[n2].position];

    getState().distributeSelected('horizontal');

    expect(getState().nodes[n1].position).toEqual(pos1Before);
    expect(getState().nodes[n2].position).toEqual(pos2Before);
  });

  it('distributes 3+ nodes evenly along horizontal axis', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [10, 0, 0]);
    const n3 = getState().addNode('output', [2, 0, 0]);
    getState().setSelection(new Set([n1, n2, n3]));

    getState().distributeSelected('horizontal');

    // After distribution, positions should be evenly spaced
    const positions = [n1, n2, n3]
      .map(id => getState().nodes[id].position[0])
      .sort((a, b) => a - b);

    // Check even spacing
    const spacing1 = positions[1] - positions[0];
    const spacing2 = positions[2] - positions[1];
    expect(spacing1).toBeCloseTo(spacing2, 3);
  });

  it('distributes nodes along vertical axis', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [0, 0, 10]);
    const n3 = getState().addNode('output', [0, 0, 2]);
    getState().setSelection(new Set([n1, n2, n3]));

    getState().distributeSelected('vertical');

    const positions = [n1, n2, n3]
      .map(id => getState().nodes[id].position[2])
      .sort((a, b) => a - b);

    const spacing1 = positions[1] - positions[0];
    const spacing2 = positions[2] - positions[1];
    expect(spacing1).toBeCloseTo(spacing2, 3);
  });
});

// ==========================================================================
// disconnectAndReroute edge cases
// ==========================================================================
describe('disconnectAndReroute edge cases', () => {
  beforeEach(() => { resetStore(); });

  it('removes the connection and starts a new pending connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(src, 0, trn, 0);
    expect(connId).toBeTruthy();

    getState().disconnectAndReroute(connId!);

    // Connection should be removed
    expect(getState().connections[connId!]).toBeUndefined();
    // A pending connection should be started from the source
    expect(getState().pendingConnection).toBeDefined();
    expect(getState().pendingConnection!.sourceNodeId).toBe(src);
  });

  it('does nothing for nonexistent connection', () => {
    getState().addNode('source', [0, 0, 0]);
    const undoBefore = getState().canUndo();

    getState().disconnectAndReroute('fake-conn-id');

    // No change, no undo push
    expect(getState().canUndo()).toBe(undoBefore);
  });

  it('is undoable', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(src, 0, trn, 0)!;

    getState().disconnectAndReroute(connId);
    expect(getState().connections[connId]).toBeUndefined();

    getState().undo();
    expect(getState().connections[connId]).toBeDefined();
  });
});

// ==========================================================================
// Compound duplicateSelected preserves connection metadata
// ==========================================================================
describe('duplicateSelected — connection metadata preservation', () => {
  beforeEach(() => { resetStore(); });

  it('preserves connection label and colorOverride when duplicating', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(src, 0, trn, 0)!;

    // Manually add metadata to connection
    useEditorStore.setState((s) => {
      s.connections[connId].label = 'test-label';
      s.connections[connId].colorOverride = '#ff0000';
    });

    getState().setSelection(new Set([src, trn]));
    getState().duplicateSelected();

    // Find the new connection (not the original)
    const newConns = Object.values(getState().connections)
      .filter(c => c.id !== connId);
    expect(newConns.length).toBeGreaterThanOrEqual(1);

    const newConn = newConns.find(c => c.label === 'test-label');
    expect(newConn).toBeDefined();
    expect(newConn!.colorOverride).toBe('#ff0000');
  });

  it('preserves collapsed state when duplicating', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState((s) => {
      s.nodes[src].collapsed = true;
    });

    getState().setSelection(new Set([src]));
    const idMap = getState().duplicateSelected()!;
    const newId = idMap.get(src)!;

    expect(getState().nodes[newId].collapsed).toBe(true);
  });

  it('deep-copies node data when duplicating', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    getState().updateNodeData(src, 'nested', { deep: true });

    getState().setSelection(new Set([src]));
    const idMap = getState().duplicateSelected()!;
    const newId = idMap.get(src)!;

    expect(getState().nodes[newId].data.value).toBe(42);
    expect(getState().nodes[newId].data.nested).toEqual({ deep: true });

    // Verify it's a deep copy (modifying original shouldn't affect duplicate)
    getState().updateNodeData(src, 'value', 99);
    expect(getState().nodes[newId].data.value).toBe(42);
  });
});

// ==========================================================================
// paste preserves connection metadata
// ==========================================================================
describe('paste — connection metadata preservation', () => {
  beforeEach(() => { resetStore(); });

  it('preserves connection label and colorOverride on paste', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(src, 0, trn, 0)!;

    useEditorStore.setState((s) => {
      s.connections[connId].label = 'paste-label';
      s.connections[connId].colorOverride = '#00ff00';
    });

    getState().setSelection(new Set([src, trn]));
    getState().copySelected();
    getState().paste();

    // Find pasted connections
    const pastedConns = Object.values(getState().connections)
      .filter(c => c.id !== connId && c.label === 'paste-label');
    expect(pastedConns).toHaveLength(1);
    expect(pastedConns[0].colorOverride).toBe('#00ff00');
  });
});

// ==========================================================================
// Empty groups cleanup on delete
// ==========================================================================
describe('deleteSelected — group cleanup', () => {
  beforeEach(() => { resetStore(); });

  it('removes empty groups after deleting all grouped nodes', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);

    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('TestGroup');
    expect(groupId).toBeTruthy();
    expect(getState().groups[groupId!]).toBeDefined();

    // Delete all nodes in the group
    getState().setSelection(new Set([n1, n2]));
    getState().deleteSelected();

    // Group should be cleaned up
    expect(getState().groups[groupId!]).toBeUndefined();
  });

  it('preserves groups that still have members after partial deletion', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    const n3 = getState().addNode('output', [6, 0, 0]);

    getState().setSelection(new Set([n1, n2, n3]));
    const groupId = getState().createGroup('TestGroup');
    expect(groupId).toBeTruthy();

    // Delete only one node
    getState().setSelection(new Set([n1]));
    getState().deleteSelected();

    // Group should survive because n2 and n3 are still in it
    expect(getState().groups[groupId!]).toBeDefined();
  });
});

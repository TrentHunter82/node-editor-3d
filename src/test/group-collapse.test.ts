/**
 * Group collapse feature tests (~35 tests).
 *
 * Covers: basic collapse/expand, undo/redo, node visibility,
 * boundary connections, serialization, interaction with other features,
 * and duplicate/paste with collapsed groups.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { saveMultiGraph, loadMultiGraph } from '../utils/serialization';

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.searchQuery = '';
    s.contextMenu = null;
    s.validationErrors = {};
    s.breadcrumbStack = [];
    s.activeGraphId = 'default';
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.graphOrder = ['default'];
    s.templates = {};
    s.errorStrategy = 'fail-fast';
    s.executionMetrics = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.checkpoints = {};
    s.graphVariables = {};
  });
  localStorage.clear();
}

beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a group of 2 nodes and return { n1, n2, groupId }. */
function createSimpleGroup(label?: string) {
  const n1 = getState().addNode('source', [0, 0, 0]);
  const n2 = getState().addNode('transform', [5, 0, 0]);
  getState().setSelection(new Set([n1, n2]));
  const groupId = getState().createGroup(label)!;
  expect(groupId).toBeTruthy();
  return { n1, n2, groupId };
}

// ===========================================================================
// 1. Basic collapse/expand
// ===========================================================================

describe('Basic collapse/expand', () => {
  it('toggle collapse sets collapsed=true', () => {
    const { groupId } = createSimpleGroup();
    expect(getState().groups[groupId].collapsed).toBe(false);

    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);
  });

  it('toggle again sets collapsed=false', () => {
    const { groupId } = createSimpleGroup();
    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);

    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(false);
  });

  it('no-op for non-existent group', () => {
    createSimpleGroup();
    const groupsBefore = { ...getState().groups };
    getState().toggleGroupCollapse('nonexistent-id');
    // Groups record should remain unchanged
    expect(getState().groups).toEqual(groupsBefore);
  });

  it('newly created groups start collapsed=false', () => {
    const { groupId } = createSimpleGroup('Fresh');
    expect(getState().groups[groupId].collapsed).toBe(false);
  });

  it('multiple groups can have independent collapse states', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([n1, n2]));
    const g1 = getState().createGroup('GroupA')!;

    const n3 = getState().addNode('source', [10, 0, 0]);
    const n4 = getState().addNode('transform', [15, 0, 0]);
    getState().setSelection(new Set([n3, n4]));
    const g2 = getState().createGroup('GroupB')!;

    // Collapse only g1
    getState().toggleGroupCollapse(g1);
    expect(getState().groups[g1].collapsed).toBe(true);
    expect(getState().groups[g2].collapsed).toBe(false);

    // Collapse g2 as well
    getState().toggleGroupCollapse(g2);
    expect(getState().groups[g1].collapsed).toBe(true);
    expect(getState().groups[g2].collapsed).toBe(true);

    // Expand g1 only
    getState().toggleGroupCollapse(g1);
    expect(getState().groups[g1].collapsed).toBe(false);
    expect(getState().groups[g2].collapsed).toBe(true);
  });
});

// ===========================================================================
// 2. Undo/redo
// ===========================================================================

describe('Collapse is view-state (no undo)', () => {
  it('toggleGroupCollapse does NOT push undo (view-state, not content mutation)', () => {
    const { groupId } = createSimpleGroup();

    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);

    // Undo should revert createGroup (the last undo-tracked action), not collapse
    getState().undo();
    expect(getState().groups[groupId]).toBeUndefined(); // group removed by undo
  });

  it('collapse state preserved through undo of unrelated actions', () => {
    const { groupId } = createSimpleGroup();
    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);

    // Perform an unrelated action: add a new node
    const n3 = getState().addNode('output', [10, 0, 0]);
    expect(getState().nodes[n3]).toBeDefined();

    // Undo the addNode — collapse should remain
    getState().undo();
    expect(getState().nodes[n3]).toBeUndefined();
    expect(getState().groups[groupId].collapsed).toBe(true);
  });
});

// ===========================================================================
// 3. Node visibility with collapsed groups
// ===========================================================================

describe('Node visibility with collapsed groups', () => {
  it('nodes in collapsed group still exist in store', () => {
    const { n1, n2, groupId } = createSimpleGroup();
    getState().toggleGroupCollapse(groupId);

    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();
    expect(Object.keys(getState().nodes)).toHaveLength(2);
  });

  it('nodes in collapsed group retain their groupId', () => {
    const { n1, n2, groupId } = createSimpleGroup();
    getState().toggleGroupCollapse(groupId);

    expect(getState().nodes[n1].groupId).toBe(groupId);
    expect(getState().nodes[n2].groupId).toBe(groupId);
  });

  it('node positions preserved when collapsing', () => {
    const { n1, n2, groupId } = createSimpleGroup();
    const pos1Before = [...getState().nodes[n1].position];
    const pos2Before = [...getState().nodes[n2].position];

    getState().toggleGroupCollapse(groupId);

    expect(getState().nodes[n1].position).toEqual(pos1Before);
    expect(getState().nodes[n2].position).toEqual(pos2Before);
  });

  it('node data preserved when collapsing', () => {
    const { n1, n2, groupId } = createSimpleGroup();
    const data1Before = structuredClone(getState().nodes[n1].data);
    const data2Before = structuredClone(getState().nodes[n2].data);

    getState().toggleGroupCollapse(groupId);

    expect(getState().nodes[n1].data).toEqual(data1Before);
    expect(getState().nodes[n2].data).toEqual(data2Before);
  });

  it('collapsing group does not affect nodes in other groups', () => {
    const { groupId: g1 } = createSimpleGroup('GroupA');

    const n3 = getState().addNode('source', [10, 0, 0]);
    const n4 = getState().addNode('transform', [15, 0, 0]);
    getState().setSelection(new Set([n3, n4]));
    const g2 = getState().createGroup('GroupB')!;

    // Collapse g1
    getState().toggleGroupCollapse(g1);

    // Nodes in g2 unaffected
    expect(getState().nodes[n3].groupId).toBe(g2);
    expect(getState().nodes[n4].groupId).toBe(g2);
    expect(getState().groups[g2].collapsed).toBe(false);
  });
});

// ===========================================================================
// 4. Boundary connections
// ===========================================================================

describe('Boundary connections', () => {
  it('connections between group member and external node survive collapse', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    const nExt = getState().addNode('output', [10, 0, 0]);

    // n1 (source) -> n2 (transform) -> nExt (output)
    const c1 = getState().addConnection(n1, 0, n2, 0);
    expect(c1).toBeTruthy();
    const c2 = getState().addConnection(n2, 0, nExt, 0);
    expect(c2).toBeTruthy();

    // Group n1 and n2
    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('Pipeline')!;

    // Collapse the group
    getState().toggleGroupCollapse(groupId);

    // Both connections still exist
    expect(getState().connections[c1!]).toBeDefined();
    expect(getState().connections[c2!]).toBeDefined();
  });

  it('connections entirely within the group survive collapse', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    const c1 = getState().addConnection(n1, 0, n2, 0);
    expect(c1).toBeTruthy();

    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup()!;

    getState().toggleGroupCollapse(groupId);
    expect(getState().connections[c1!]).toBeDefined();
    expect(getState().connections[c1!].sourceNodeId).toBe(n1);
    expect(getState().connections[c1!].targetNodeId).toBe(n2);
  });

  it('connection to collapsed group member still exists in connections record', () => {
    const nExt = getState().addNode('source', [0, 0, 0]);
    const n1 = getState().addNode('transform', [5, 0, 0]);
    const n2 = getState().addNode('output', [10, 0, 0]);

    // nExt -> n1 (inside group)
    const c1 = getState().addConnection(nExt, 0, n1, 0);
    expect(c1).toBeTruthy();

    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup()!;
    getState().toggleGroupCollapse(groupId);

    expect(Object.keys(getState().connections)).toHaveLength(1);
    expect(getState().connections[c1!]).toBeDefined();
  });

  it('multiple external connections to group members all survive', () => {
    const ext1 = getState().addNode('source', [0, 0, 0]);
    const ext2 = getState().addNode('source', [0, 0, 5]);
    const n1 = getState().addNode('transform', [5, 0, 0]);
    const n2 = getState().addNode('math', [10, 0, 0]); // math has 2 inputs

    // ext1 -> n1 (input 0), ext2 -> n2 (input 0)
    const c1 = getState().addConnection(ext1, 0, n1, 0);
    expect(c1).toBeTruthy();
    const c2 = getState().addConnection(ext2, 0, n2, 0);
    expect(c2).toBeTruthy();

    // Also connect n1 -> n2 (input 1)
    const c3 = getState().addConnection(n1, 0, n2, 1);
    expect(c3).toBeTruthy();

    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup()!;
    getState().toggleGroupCollapse(groupId);

    // All three connections should survive
    expect(getState().connections[c1!]).toBeDefined();
    expect(getState().connections[c2!]).toBeDefined();
    expect(getState().connections[c3!]).toBeDefined();
    expect(Object.keys(getState().connections)).toHaveLength(3);
  });

  it('connections between two different collapsed groups survive', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([n1, n2]));
    const g1 = getState().createGroup('GroupA')!;

    const n3 = getState().addNode('source', [10, 0, 0]);
    const n4 = getState().addNode('output', [15, 0, 0]);
    getState().setSelection(new Set([n3, n4]));
    const g2 = getState().createGroup('GroupB')!;

    // Cross-group connection: n2 (output of g1) -> n4 (in g2)
    // n2 is a transform (has 1 output), but n4 is an output node (1 input)
    const conn = getState().addConnection(n2, 0, n4, 0);
    expect(conn).toBeTruthy();

    // Collapse both groups
    getState().toggleGroupCollapse(g1);
    getState().toggleGroupCollapse(g2);

    expect(getState().connections[conn!]).toBeDefined();
    expect(getState().connections[conn!].sourceNodeId).toBe(n2);
    expect(getState().connections[conn!].targetNodeId).toBe(n4);
  });
});

// ===========================================================================
// 5. Serialization
// ===========================================================================

describe('Serialization', () => {
  it('exportAllGraphs preserves collapsed state', () => {
    const { groupId } = createSimpleGroup('Collapsed Group');
    getState().toggleGroupCollapse(groupId);

    const exported = getState().exportAllGraphs();
    const activeGraph = exported.graphs[exported.activeGraphId];
    expect(activeGraph.groups[groupId]).toBeDefined();
    expect(activeGraph.groups[groupId].collapsed).toBe(true);
  });

  it('importAllGraphs restores collapsed state', () => {
    const { groupId } = createSimpleGroup('Import Test');
    getState().toggleGroupCollapse(groupId);
    const exported = getState().exportAllGraphs();

    // Reset and re-import
    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().groups[groupId]).toBeDefined();
    expect(getState().groups[groupId].collapsed).toBe(true);
    expect(getState().groups[groupId].label).toBe('Import Test');
  });

  it('roundtrip: collapse then export then import preserves collapsed', () => {
    const { n1, n2, groupId } = createSimpleGroup('Roundtrip');
    getState().toggleGroupCollapse(groupId);

    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().groups[groupId].collapsed).toBe(true);
    // Nodes still belong to the group
    expect(getState().nodes[n1].groupId).toBe(groupId);
    expect(getState().nodes[n2].groupId).toBe(groupId);
  });

  it('collapsed groups with connections roundtrip correctly', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    const nExt = getState().addNode('output', [10, 0, 0]);
    const c1 = getState().addConnection(n1, 0, n2, 0);
    expect(c1).toBeTruthy();
    const c2 = getState().addConnection(n2, 0, nExt, 0);
    expect(c2).toBeTruthy();

    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('WithConnections')!;
    getState().toggleGroupCollapse(groupId);

    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().groups[groupId].collapsed).toBe(true);
    expect(getState().connections[c1!]).toBeDefined();
    expect(getState().connections[c2!]).toBeDefined();
    expect(getState().nodes[n1].groupId).toBe(groupId);
    expect(getState().nodes[n2].groupId).toBe(groupId);
    expect(getState().nodes[nExt].groupId).toBeUndefined();
  });

  it('saveMultiGraph/loadMultiGraph preserves collapsed field', () => {
    const { groupId } = createSimpleGroup('Persist');
    getState().toggleGroupCollapse(groupId);

    const exported = getState().exportAllGraphs();
    saveMultiGraph(exported);

    const loaded = loadMultiGraph();
    expect(loaded).not.toBeNull();
    const activeGraph = loaded!.graphs[loaded!.activeGraphId];
    expect(activeGraph.groups[groupId]).toBeDefined();
    expect(activeGraph.groups[groupId].collapsed).toBe(true);
    expect(activeGraph.groups[groupId].label).toBe('Persist');
  });
});

// ===========================================================================
// 6. Interaction with other features
// ===========================================================================

describe('Interaction with other features', () => {
  it('deleting all nodes in a collapsed group removes the group', () => {
    const { n1, n2, groupId } = createSimpleGroup('Doomed');
    getState().toggleGroupCollapse(groupId);

    // Select both nodes and delete
    getState().setSelection(new Set([n1, n2]));
    getState().deleteSelected();

    expect(getState().groups[groupId]).toBeUndefined();
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('adding a node to a collapsed group via groupId works', () => {
    const { groupId } = createSimpleGroup('Expandable');
    getState().toggleGroupCollapse(groupId);

    // Add a new node and manually assign to the collapsed group
    const n3 = getState().addNode('output', [10, 0, 0]);
    useEditorStore.setState((s) => {
      s.nodes[n3].groupId = groupId;
    });

    expect(getState().nodes[n3].groupId).toBe(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);
  });

  it('renaming a collapsed group works', () => {
    const { groupId } = createSimpleGroup('OldName');
    getState().toggleGroupCollapse(groupId);

    getState().renameGroup(groupId, 'NewName');
    expect(getState().groups[groupId].label).toBe('NewName');
    expect(getState().groups[groupId].collapsed).toBe(true);
  });

  it('ungrouping a collapsed group removes group and clears groupId', () => {
    const { n1, n2, groupId } = createSimpleGroup('Ungroup Me');
    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);

    getState().ungroupNodes(groupId);
    expect(getState().groups[groupId]).toBeUndefined();
    expect(getState().nodes[n1].groupId).toBeUndefined();
    expect(getState().nodes[n2].groupId).toBeUndefined();
    // Nodes still exist
    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();
  });

  it('setSelection selects nodes in collapsed groups', () => {
    const { n1, n2, groupId } = createSimpleGroup('Hidden');
    getState().toggleGroupCollapse(groupId);

    // Selecting all node IDs (simulating selectAll behavior)
    const allNodeIds = new Set(Object.keys(getState().nodes));
    getState().setSelection(allNodeIds);

    expect(getState().selectedIds.has(n1)).toBe(true);
    expect(getState().selectedIds.has(n2)).toBe(true);
  });
});

// ===========================================================================
// 7. Duplicate/paste with collapsed groups
// ===========================================================================

describe('Duplicate/paste with collapsed groups', () => {
  it('duplicating nodes preserves groupId', () => {
    const { n1, n2, groupId } = createSimpleGroup('DupeGroup');

    getState().setSelection(new Set([n1, n2]));
    const oldToNew = getState().duplicateSelected();
    expect(oldToNew).not.toBeNull();

    const newN1 = oldToNew!.get(n1)!;
    const newN2 = oldToNew!.get(n2)!;
    expect(getState().nodes[newN1].groupId).toBe(groupId);
    expect(getState().nodes[newN2].groupId).toBe(groupId);
  });

  it('duplicating a node from a collapsed group preserves groupId', () => {
    const { n1, groupId } = createSimpleGroup('CollapsedDupe');
    getState().toggleGroupCollapse(groupId);

    getState().setSelection(new Set([n1]));
    const oldToNew = getState().duplicateSelected();
    expect(oldToNew).not.toBeNull();

    const newN1 = oldToNew!.get(n1)!;
    expect(getState().nodes[newN1].groupId).toBe(groupId);
  });

  it('pasting nodes from collapsed group creates them', () => {
    const { n1, n2, groupId } = createSimpleGroup('CopyPaste');
    getState().toggleGroupCollapse(groupId);

    getState().setSelection(new Set([n1, n2]));
    getState().copySelected();

    // Paste
    getState().paste();
    // Should now have 4 nodes (2 original + 2 pasted)
    expect(Object.keys(getState().nodes)).toHaveLength(4);
  });

  it('copy/paste preserves node data from collapsed group', () => {
    const { n1, n2, groupId } = createSimpleGroup('DataPreserve');
    getState().toggleGroupCollapse(groupId);

    // Capture original data
    const origData1 = structuredClone(getState().nodes[n1].data);
    const origType1 = getState().nodes[n1].type;

    getState().setSelection(new Set([n1, n2]));
    getState().copySelected();
    getState().paste();

    // Find the pasted copies (the new nodes not matching n1 or n2)
    const pastedNodes = Object.values(getState().nodes).filter(
      (n) => n.id !== n1 && n.id !== n2
    );
    expect(pastedNodes).toHaveLength(2);

    // One pasted node should match n1's type and data
    const pastedSource = pastedNodes.find((n) => n.type === origType1);
    expect(pastedSource).toBeDefined();
    expect(pastedSource!.data).toEqual(origData1);
  });

  it('duplicateSelected with collapsed group members works', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    const c1 = getState().addConnection(n1, 0, n2, 0);
    expect(c1).toBeTruthy();

    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('WithConn')!;
    getState().toggleGroupCollapse(groupId);

    // Select and duplicate both members
    getState().setSelection(new Set([n1, n2]));
    const oldToNew = getState().duplicateSelected();
    expect(oldToNew).not.toBeNull();
    expect(oldToNew!.size).toBe(2);

    // New nodes should exist and belong to the same group
    const newN1 = oldToNew!.get(n1)!;
    const newN2 = oldToNew!.get(n2)!;
    expect(getState().nodes[newN1]).toBeDefined();
    expect(getState().nodes[newN2]).toBeDefined();
    expect(getState().nodes[newN1].groupId).toBe(groupId);
    expect(getState().nodes[newN2].groupId).toBe(groupId);

    // Connection between new nodes should also have been duplicated
    const newConnections = Object.values(getState().connections).filter(
      (c) => c.sourceNodeId === newN1 && c.targetNodeId === newN2
    );
    expect(newConnections).toHaveLength(1);
  });
});

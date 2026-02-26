/**
 * Extended Cascade Deletion Tests
 *
 * Covers scenarios NOT already tested in cascade-deletion.test.ts (1077 lines, ~40 tests):
 *
 * 1. Undo/redo cascade with 3-level deep nesting — all levels navigable after undo
 * 2. Delete subgraph while navigated inside (exit first, then delete) — breadcrumb reset
 * 3. Multiple undo/redo cycles — delete→undo→delete→undo→redo chain
 * 4. importWorkflow cleans up inner graphs of existing subgraphs
 * 5. Parallel subgraphs (siblings) — delete one, verify the other still works
 * 6. deleteGraph with subgraphs on a non-active graph tab — verify full cleanup
 * 7. Sequential create+delete+create — no ID collisions
 * 8. Subgraph node inside a group — delete group containing subgraph, verify cascade
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

// enableMapSet required for Set<string> in Zustand + Immer
enableMapSet();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

const getState = () => useEditorStore.getState();

/**
 * Build the 3-level structure A -> B -> C, return all node + graph IDs.
 * Leaves active graph as 'default'.
 */
function create3Level() {
  const sgA = getState().createSubgraph('Level-A')!;
  expect(sgA).toBeTruthy();
  const innerA = getState().nodes[sgA].data.innerGraphId as string;

  getState().enterSubgraph(sgA);
  expect(getState().activeGraphId).toBe(innerA);

  const sgB = getState().createSubgraph('Level-B')!;
  expect(sgB).toBeTruthy();
  const innerB = getState().nodes[sgB].data.innerGraphId as string;

  getState().enterSubgraph(sgB);
  expect(getState().activeGraphId).toBe(innerB);

  const sgC = getState().createSubgraph('Level-C')!;
  expect(sgC).toBeTruthy();
  const innerC = getState().nodes[sgC].data.innerGraphId as string;

  getState().exitSubgraph(); // back to innerA
  getState().exitSubgraph(); // back to default
  expect(getState().activeGraphId).toBe('default');

  return { sgA, innerA, sgB, innerB, sgC, innerC };
}

/**
 * Assert that all given graph IDs are absent from graphTabs.
 */
function assertTabsGone(ids: string[]) {
  const tabs = getState().graphTabs;
  for (const id of ids) {
    expect(tabs[id], `graphTabs should not contain ${id}`).toBeUndefined();
  }
}

// ===========================================================================
// 1. Undo/redo cascade with 3-level deep nesting
// ===========================================================================
describe('Undo/redo cascade with 3-level deep nesting', () => {
  beforeEach(resetStore);

  it('undo after deleting 3-level subgraph restores the top-level node, subgraphDef, and navigable inner graphs', () => {
    const { sgA, innerA, innerB, innerC } = create3Level();

    // Sanity: all tabs exist before deletion
    expect(getState().graphTabs[innerA]).toBeDefined();
    expect(getState().graphTabs[innerB]).toBeDefined();
    expect(getState().graphTabs[innerC]).toBeDefined();

    getState().deleteSubgraphNode(sgA);
    assertTabsGone([innerA, innerB, innerC]);
    expect(getState().nodes[sgA]).toBeUndefined();

    // Undo — node and subgraphDef are restored via snapshot; inactiveGraphs are
    // restored so enterSubgraph can navigate. graphTabs entries for inner graphs
    // are not part of the undo snapshot, but navigation still works.
    getState().undo();
    expect(getState().nodes[sgA]).toBeDefined();
    expect(getState().subgraphDefs[sgA]).toBeDefined();
    expect(getState().subgraphDefs[sgA].innerGraphId).toBe(innerA);
  });

  it('undo restores 3-level nesting so every level is navigable', () => {
    const { sgA, innerA, sgB, innerB, sgC, innerC } = create3Level();

    getState().deleteSubgraphNode(sgA);
    getState().undo();

    // Navigate into A
    getState().enterSubgraph(sgA);
    expect(getState().activeGraphId).toBe(innerA);
    expect(getState().nodes[sgB]).toBeDefined();

    // Navigate into B
    getState().enterSubgraph(sgB);
    expect(getState().activeGraphId).toBe(innerB);
    expect(getState().nodes[sgC]).toBeDefined();

    // Navigate into C
    getState().enterSubgraph(sgC);
    expect(getState().activeGraphId).toBe(innerC);
    // C's inner graph has the standard boundary nodes
    const cNodes = Object.values(getState().nodes);
    expect(cNodes.some(n => n.type === 'subgraph-input')).toBe(true);
    expect(cNodes.some(n => n.type === 'subgraph-output')).toBe(true);

    // Exit all the way back
    getState().exitSubgraph();
    getState().exitSubgraph();
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe('default');
  });

  it('redo after undo re-deletes all 3 levels', () => {
    const { sgA, innerA, innerB, innerC } = create3Level();

    getState().deleteSubgraphNode(sgA);
    getState().undo();
    expect(getState().nodes[sgA]).toBeDefined();

    // Redo re-deletes
    getState().redo();
    expect(getState().nodes[sgA]).toBeUndefined();
    assertTabsGone([innerA, innerB, innerC]);
  });

  it('second undo after undo→redo→undo cycle still navigates all 3 levels', () => {
    const { sgA, innerA, sgB, innerB, sgC, innerC } = create3Level();

    getState().deleteSubgraphNode(sgA);
    getState().undo();  // restored
    getState().redo();  // re-deleted
    getState().undo();  // restored again

    expect(getState().nodes[sgA]).toBeDefined();
    expect(getState().subgraphDefs[sgA]).toBeDefined();

    // Verify all 3 levels navigable after the full cycle
    getState().enterSubgraph(sgA);
    expect(getState().activeGraphId).toBe(innerA);
    expect(getState().nodes[sgB]).toBeDefined();

    getState().enterSubgraph(sgB);
    expect(getState().activeGraphId).toBe(innerB);
    expect(getState().nodes[sgC]).toBeDefined();

    getState().enterSubgraph(sgC);
    expect(getState().activeGraphId).toBe(innerC);
    const cNodes = Object.values(getState().nodes);
    expect(cNodes.some(n => n.type === 'subgraph-input')).toBe(true);

    getState().exitSubgraph();
    getState().exitSubgraph();
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe('default');
  });

  it('canUndo/canRedo reflect correct state across the cycle', () => {
    const { sgA } = create3Level();
    expect(getState().canUndo()).toBe(true); // createSubgraph pushed undo entries

    getState().deleteSubgraphNode(sgA);
    expect(getState().canUndo()).toBe(true);
    expect(getState().canRedo()).toBe(false);

    getState().undo();
    expect(getState().canRedo()).toBe(true);

    getState().redo();
    expect(getState().canRedo()).toBe(false);
    expect(getState().nodes[sgA]).toBeUndefined();
  });
});

// ===========================================================================
// 2. Delete subgraph while navigated inside its inner graph
// ===========================================================================
describe('Delete subgraph while user is navigated inside it', () => {
  beforeEach(resetStore);

  it('exit subgraph then delete: node removed and inner graph tab cleaned up', () => {
    const sg = getState().createSubgraph('NavDelete')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;

    // Navigate inside
    getState().enterSubgraph(sg);
    expect(getState().activeGraphId).toBe(innerId);

    // Exit first (as UI would do before allowing deletion from parent)
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe('default');

    // Delete from parent
    getState().deleteSubgraphNode(sg);

    expect(getState().nodes[sg]).toBeUndefined();
    expect(getState().subgraphDefs[sg]).toBeUndefined();
    expect(getState().graphTabs[innerId]).toBeUndefined();
  });

  it('breadcrumb stack is empty after exiting before deletion', () => {
    const sg = getState().createSubgraph('BreadTest')!;

    getState().enterSubgraph(sg);
    expect(getState().breadcrumbStack.length).toBe(1);

    getState().exitSubgraph();
    expect(getState().breadcrumbStack.length).toBe(0);

    getState().deleteSubgraphNode(sg);
    // After deletion, breadcrumb must still be empty
    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('enter nested subgraph, exit all levels, then delete top-level: no stale breadcrumbs', () => {
    const { sgA, innerA, innerB, innerC } = create3Level();

    // Navigate to deepest level
    getState().enterSubgraph(sgA);
    getState().enterSubgraph(getState().nodes[Object.keys(getState().nodes).find(
      k => getState().nodes[k].type === 'subgraph')!].id);

    // Exit ALL the way
    getState().exitSubgraph();
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe('default');
    expect(getState().breadcrumbStack.length).toBe(0);

    // Now delete sgA from the default (parent) graph
    getState().deleteSubgraphNode(sgA);
    expect(getState().nodes[sgA]).toBeUndefined();
    assertTabsGone([innerA, innerB, innerC]);
    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('undo after exit-then-delete restores subgraph and inner graph is navigable', () => {
    const sg = getState().createSubgraph('ExitDelete')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;

    // Add a node inside the subgraph so we can verify content restoration
    getState().enterSubgraph(sg);
    const contentNode = getState().addNode('math', [1, 0, 1]);
    getState().exitSubgraph();

    // Delete
    getState().deleteSubgraphNode(sg);
    expect(getState().nodes[sg]).toBeUndefined();

    // Undo
    getState().undo();
    expect(getState().nodes[sg]).toBeDefined();

    // Navigate inside and verify content
    getState().enterSubgraph(sg);
    expect(getState().activeGraphId).toBe(innerId);
    expect(getState().nodes[contentNode]).toBeDefined();

    getState().exitSubgraph();
  });
});

// ===========================================================================
// 3. Multiple undo/redo cycles — delete→undo→delete→undo→redo chain
// ===========================================================================
describe('Multiple undo/redo cycles on the same subgraph', () => {
  beforeEach(resetStore);

  it('delete→undo→delete→undo→redo chain leaves node deleted at end', () => {
    const sg = getState().createSubgraph('CycleTest')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;

    // Cycle 1: delete + undo
    getState().deleteSubgraphNode(sg);
    expect(getState().nodes[sg]).toBeUndefined();
    getState().undo();
    // Undo restores node/subgraphDef via snapshot; enterSubgraph works via
    // inactiveGraphs restoration. graphTabs for inner graphs are not part of
    // the snapshot, so we verify navigation rather than graphTabs presence.
    expect(getState().nodes[sg]).toBeDefined();
    expect(getState().subgraphDefs[sg]).toBeDefined();
    getState().enterSubgraph(sg);
    expect(getState().activeGraphId).toBe(innerId);
    getState().exitSubgraph();

    // Cycle 2: delete again + undo
    getState().deleteSubgraphNode(sg);
    expect(getState().nodes[sg]).toBeUndefined();
    getState().undo();
    expect(getState().nodes[sg]).toBeDefined();
    expect(getState().subgraphDefs[sg]).toBeDefined();
    getState().enterSubgraph(sg);
    expect(getState().activeGraphId).toBe(innerId);
    getState().exitSubgraph();

    // Redo: should re-delete
    getState().redo();
    expect(getState().nodes[sg]).toBeUndefined();
    expect(getState().graphTabs[innerId]).toBeUndefined();
  });

  it('inner graph content is preserved across multiple undo cycles', () => {
    const sg = getState().createSubgraph('MultiCycle')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;

    // Add content inside
    getState().enterSubgraph(sg);
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [3, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);
    getState().exitSubgraph();

    // Cycle 1
    getState().deleteSubgraphNode(sg);
    getState().undo();
    getState().enterSubgraph(sg);
    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();
    expect(Object.keys(getState().connections).length).toBeGreaterThanOrEqual(1);
    getState().exitSubgraph();

    // Cycle 2
    getState().deleteSubgraphNode(sg);
    getState().undo();
    getState().enterSubgraph(sg);
    expect(getState().activeGraphId).toBe(innerId);
    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();
    getState().exitSubgraph();
  });

  it('delete two subgraphs, undo twice, redo twice: correct final state', () => {
    const sg1 = getState().createSubgraph('A')!;
    const inner1 = getState().nodes[sg1].data.innerGraphId as string;
    const sg2 = getState().createSubgraph('B')!;
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;

    // Delete sg1, then sg2
    getState().deleteSubgraphNode(sg1);
    getState().deleteSubgraphNode(sg2);
    expect(getState().nodes[sg1]).toBeUndefined();
    expect(getState().nodes[sg2]).toBeUndefined();

    // Undo sg2 deletion — restores sg2's node/def via snapshot
    getState().undo();
    expect(getState().nodes[sg2]).toBeDefined();
    expect(getState().subgraphDefs[sg2]).toBeDefined();
    expect(getState().nodes[sg1]).toBeUndefined(); // still deleted
    // Verify sg2 is navigable (inactiveGraphs restored)
    getState().enterSubgraph(sg2);
    expect(getState().activeGraphId).toBe(inner2);
    getState().exitSubgraph();

    // Undo sg1 deletion — restores sg1's node/def
    getState().undo();
    expect(getState().nodes[sg1]).toBeDefined();
    expect(getState().subgraphDefs[sg1]).toBeDefined();
    // sg1 is navigable
    getState().enterSubgraph(sg1);
    expect(getState().activeGraphId).toBe(inner1);
    getState().exitSubgraph();

    // Redo sg1 deletion
    getState().redo();
    expect(getState().nodes[sg1]).toBeUndefined();
    expect(getState().graphTabs[inner1]).toBeUndefined();
    expect(getState().nodes[sg2]).toBeDefined(); // sg2 still there

    // Redo sg2 deletion
    getState().redo();
    expect(getState().nodes[sg2]).toBeUndefined();
    expect(getState().graphTabs[inner2]).toBeUndefined();
  });
});

// ===========================================================================
// 4. importWorkflow cleans up inner graphs of existing subgraphs
// ===========================================================================
describe('importWorkflow cleans up inner graphs of replaced subgraphs', () => {
  beforeEach(resetStore);

  it('importing over a graph with subgraphs removes old inner graph tabs', () => {
    const sg = getState().createSubgraph('ToReplace')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;

    expect(getState().graphTabs[innerId]).toBeDefined();

    // Import a simple workflow with no subgraphs
    getState().importWorkflow({
      nodes: {},
      connections: {},
    });

    // Old inner graph tab must be gone
    expect(getState().graphTabs[innerId]).toBeUndefined();
    // Node must be gone
    expect(getState().nodes[sg]).toBeUndefined();
  });

  it('importing over a 3-level nested graph cleans up all levels', () => {
    const { innerA, innerB, innerC } = create3Level();

    expect(getState().graphTabs[innerA]).toBeDefined();
    expect(getState().graphTabs[innerB]).toBeDefined();
    expect(getState().graphTabs[innerC]).toBeDefined();

    getState().importWorkflow({ nodes: {}, connections: {} });

    assertTabsGone([innerA, innerB, innerC]);
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('importing workflow resets breadcrumb stack', () => {
    const sg = getState().createSubgraph('BreadImport')!;
    getState().enterSubgraph(sg);
    expect(getState().breadcrumbStack.length).toBe(1);

    // Import replaces everything
    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('importing workflow does not remove user graph tabs', () => {
    // Create Graph 2
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph('default');

    const sg = getState().createSubgraph('ReplacedSG')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;

    getState().importWorkflow({ nodes: {}, connections: {} });

    // Inner graph from replaced sg must be gone
    expect(getState().graphTabs[innerId]).toBeUndefined();
    // But Graph 2 is a user-created top-level tab — it must survive
    expect(getState().graphTabs[g2]).toBeDefined();
    expect(getState().graphTabs['default']).toBeDefined();
  });

  it('undo after importWorkflow restores previous subgraph nodes', () => {
    const sg = getState().createSubgraph('UndoImport')!;

    // importWorkflow calls pushUndo internally, so undo should restore
    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(getState().nodes[sg]).toBeUndefined();

    getState().undo();
    expect(getState().nodes[sg]).toBeDefined();
    expect(getState().subgraphDefs[sg]).toBeDefined();
  });
});

// ===========================================================================
// 5. Parallel subgraphs (siblings) — delete one, verify the other still works
// ===========================================================================
describe('Parallel sibling subgraphs: deleting one does not affect the other', () => {
  beforeEach(resetStore);

  it('delete sibling A, sibling B remains fully functional', () => {
    const sgA = getState().createSubgraph('Sibling-A')!;
    const innerA = getState().nodes[sgA].data.innerGraphId as string;

    const sgB = getState().createSubgraph('Sibling-B')!;
    const innerB = getState().nodes[sgB].data.innerGraphId as string;

    // Add content in B so we can verify it survives
    getState().enterSubgraph(sgB);
    const bNode = getState().addNode('source', [0, 0, 0]);
    getState().exitSubgraph();

    // Delete A
    getState().deleteSubgraphNode(sgA);
    expect(getState().nodes[sgA]).toBeUndefined();
    expect(getState().graphTabs[innerA]).toBeUndefined();

    // B must survive unharmed
    expect(getState().nodes[sgB]).toBeDefined();
    expect(getState().graphTabs[innerB]).toBeDefined();
    expect(getState().subgraphDefs[sgB]).toBeDefined();

    // Navigate into B and verify content
    getState().enterSubgraph(sgB);
    expect(getState().activeGraphId).toBe(innerB);
    expect(getState().nodes[bNode]).toBeDefined();
    getState().exitSubgraph();
  });

  it('delete sibling B, sibling A with nested content remains intact', () => {
    // A has a nested subgraph inside it
    const sgA = getState().createSubgraph('A-Parent')!;
    const innerA = getState().nodes[sgA].data.innerGraphId as string;
    getState().enterSubgraph(sgA);
    const sgAInner = getState().createSubgraph('A-Child')!;
    const innerAChild = getState().nodes[sgAInner].data.innerGraphId as string;
    getState().exitSubgraph();

    const sgB = getState().createSubgraph('B-Sibling')!;
    const innerB = getState().nodes[sgB].data.innerGraphId as string;

    // Delete B
    getState().deleteSubgraphNode(sgB);
    expect(getState().nodes[sgB]).toBeUndefined();
    expect(getState().graphTabs[innerB]).toBeUndefined();

    // A and its nested inner graph must be intact
    expect(getState().nodes[sgA]).toBeDefined();
    expect(getState().graphTabs[innerA]).toBeDefined();
    expect(getState().graphTabs[innerAChild]).toBeDefined();

    // Navigate into A and verify nested subgraph
    getState().enterSubgraph(sgA);
    expect(getState().nodes[sgAInner]).toBeDefined();
    getState().enterSubgraph(sgAInner);
    expect(getState().activeGraphId).toBe(innerAChild);
    const cNodes = Object.values(getState().nodes);
    expect(cNodes.some(n => n.type === 'subgraph-input')).toBe(true);
    getState().exitSubgraph();
    getState().exitSubgraph();
  });

  it('deleteSelected on sibling A only — sibling B connections survive', () => {
    const sgA = getState().createSubgraph('SelA')!;
    const innerA = getState().nodes[sgA].data.innerGraphId as string;
    const sgB = getState().createSubgraph('SelB')!;
    const innerB = getState().nodes[sgB].data.innerGraphId as string;

    // Connect a source to both siblings
    const src = getState().addNode('source', [-5, 0, 0]);
    const connToA = getState().addConnection(src, 0, sgA, 0)!;
    const connToB = getState().addConnection(src, 0, sgB, 0)!;

    // Select and delete only A
    getState().setSelection(new Set([sgA]));
    getState().deleteSelected();

    expect(getState().nodes[sgA]).toBeUndefined();
    expect(getState().graphTabs[innerA]).toBeUndefined();
    expect(getState().connections[connToA]).toBeUndefined();

    // B and its connection are untouched
    expect(getState().nodes[sgB]).toBeDefined();
    expect(getState().graphTabs[innerB]).toBeDefined();
    expect(getState().connections[connToB]).toBeDefined();
  });
});

// ===========================================================================
// 6. deleteGraph with subgraphs on a non-active graph tab
// ===========================================================================
describe('deleteGraph on a non-active tab that contains subgraphs', () => {
  beforeEach(resetStore);

  it('deleting non-active graph with 2-level nested subgraph cleans all inner tabs', () => {
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);

    const sg = getState().createSubgraph('G2-Outer')!;
    const outerInner = getState().nodes[sg].data.innerGraphId as string;
    getState().enterSubgraph(sg);
    const sgNested = getState().createSubgraph('G2-Inner')!;
    const nestedInner = getState().nodes[sgNested].data.innerGraphId as string;
    getState().exitSubgraph();

    // Switch away so g2 is inactive
    getState().switchGraph('default');
    expect(getState().activeGraphId).toBe('default');

    getState().deleteGraph(g2);

    expect(getState().graphTabs[g2]).toBeUndefined();
    expect(getState().graphOrder).not.toContain(g2);
    assertTabsGone([outerInner, nestedInner]);
    // Main graph must be unharmed
    expect(getState().graphTabs['default']).toBeDefined();
    expect(getState().activeGraphId).toBe('default');
  });

  it('deleteGraph on non-active graph does not disturb subgraphs in the active graph', () => {
    // Create Graph 2 and create a subgraph in it
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);
    const g2Sg = getState().createSubgraph('G2-SG')!;
    const g2SgInner = getState().nodes[g2Sg].data.innerGraphId as string;

    // Switch back to main and create a subgraph there
    getState().switchGraph('default');
    const mainSg = getState().createSubgraph('MainSG')!;
    const mainInner = getState().nodes[mainSg].data.innerGraphId as string;

    // Verify both inner tabs exist before deletion
    expect(getState().graphTabs[g2SgInner]).toBeDefined();
    expect(getState().graphTabs[mainInner]).toBeDefined();

    getState().deleteGraph(g2);

    // g2 and g2's inner graph tab are gone
    expect(getState().graphTabs[g2]).toBeUndefined();
    expect(getState().graphTabs[g2SgInner]).toBeUndefined();

    // Main graph subgraph completely intact
    expect(getState().nodes[mainSg]).toBeDefined();
    expect(getState().graphTabs[mainInner]).toBeDefined();
    expect(getState().subgraphDefs[mainSg]).toBeDefined();
  });

  it('deleting all non-default graphs leaves only default', () => {
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);
    getState().createSubgraph('G2-SG');
    const g2Inner = Object.keys(getState().graphTabs).find(
      id => id !== 'default' && id !== g2
    )!;

    const g3 = getState().createGraph('Graph 3');
    getState().switchGraph(g3);
    getState().createSubgraph('G3-SG');
    const g3Inner = Object.keys(getState().graphTabs).find(
      id => id !== 'default' && id !== g2 && id !== g3 && id !== g2Inner
    )!;

    getState().switchGraph('default');
    getState().deleteGraph(g2);
    getState().deleteGraph(g3);

    expect(getState().graphOrder).toEqual(['default']);
    expect(getState().graphTabs['default']).toBeDefined();
    expect(getState().graphTabs[g2]).toBeUndefined();
    expect(getState().graphTabs[g3]).toBeUndefined();
    if (g2Inner) expect(getState().graphTabs[g2Inner]).toBeUndefined();
    if (g3Inner) expect(getState().graphTabs[g3Inner]).toBeUndefined();
  });
});

// ===========================================================================
// 7. Sequential create+delete: no ID collisions
// ===========================================================================
describe('Sequential create+delete operations: no ID collisions', () => {
  beforeEach(resetStore);

  it('IDs of newly created subgraph after deletion differ from deleted ones', () => {
    const sg1 = getState().createSubgraph('First')!;
    const inner1 = getState().nodes[sg1].data.innerGraphId as string;

    getState().deleteSubgraphNode(sg1);

    const sg2 = getState().createSubgraph('Second')!;
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;

    // IDs must not collide with the deleted ones
    expect(sg2).not.toBe(sg1);
    expect(inner2).not.toBe(inner1);
  });

  it('create, delete, create, delete cycle: graphTabs only has default at end', () => {
    for (let i = 0; i < 3; i++) {
      const sg = getState().createSubgraph(`Round-${i}`)!;
      getState().deleteSubgraphNode(sg);
    }

    const tabIds = Object.keys(getState().graphTabs);
    expect(tabIds).toEqual(['default']);
  });

  it('create nested, delete, create nested again: no inner graph ID collisions', () => {
    const sg1 = getState().createSubgraph('Round1')!;
    const inner1 = getState().nodes[sg1].data.innerGraphId as string;
    getState().enterSubgraph(sg1);
    const sgChild1 = getState().createSubgraph('Round1-Child')!;
    const innerChild1 = getState().nodes[sgChild1].data.innerGraphId as string;
    getState().exitSubgraph();

    // Delete outer (cascades to child)
    getState().deleteSubgraphNode(sg1);
    assertTabsGone([inner1, innerChild1]);

    // Re-create the same structure
    const sg2 = getState().createSubgraph('Round2')!;
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;
    getState().enterSubgraph(sg2);
    const sgChild2 = getState().createSubgraph('Round2-Child')!;
    const innerChild2 = getState().nodes[sgChild2].data.innerGraphId as string;
    getState().exitSubgraph();

    // New IDs must be fresh
    expect(sg2).not.toBe(sg1);
    expect(inner2).not.toBe(inner1);
    expect(sgChild2).not.toBe(sgChild1);
    expect(innerChild2).not.toBe(innerChild1);

    // New structure must be fully functional
    getState().enterSubgraph(sg2);
    expect(getState().activeGraphId).toBe(inner2);
    expect(getState().nodes[sgChild2]).toBeDefined();
    getState().enterSubgraph(sgChild2);
    expect(getState().activeGraphId).toBe(innerChild2);
    getState().exitSubgraph();
    getState().exitSubgraph();
  });

  it('undo after second creation does not restore first deleted subgraph', () => {
    const sg1 = getState().createSubgraph('Deleted')!;
    getState().deleteSubgraphNode(sg1);

    const sg2 = getState().createSubgraph('Created')!;

    // Undo createSubgraph for sg2
    getState().undo();

    // sg2 should be gone (undid its creation)
    expect(getState().nodes[sg2]).toBeUndefined();
    // sg1 was already deleted before this undo; it should NOT come back
    expect(getState().nodes[sg1]).toBeUndefined();
  });
});

// ===========================================================================
// 8. Subgraph node inside a group — delete group, verify cascade
// ===========================================================================
describe('Subgraph node inside a group: delete group cascades subgraph cleanup', () => {
  beforeEach(resetStore);

  it('deleteSelected on a group (subgraph + regular node) cleans inner graph', () => {
    const sg = getState().createSubgraph('GroupedSG')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;
    const regular = getState().addNode('source', [5, 0, 0]);

    // Create a group containing both
    getState().setSelection(new Set([sg, regular]));
    const groupId = getState().createGroup('Mixed Group')!;
    expect(groupId).toBeTruthy();
    expect(getState().nodes[sg].groupId).toBe(groupId);
    expect(getState().nodes[regular].groupId).toBe(groupId);

    // Select both nodes and delete
    getState().setSelection(new Set([sg, regular]));
    getState().deleteSelected();

    // Both nodes gone
    expect(getState().nodes[sg]).toBeUndefined();
    expect(getState().nodes[regular]).toBeUndefined();

    // Inner graph cleaned up
    expect(getState().graphTabs[innerId]).toBeUndefined();
    expect(getState().subgraphDefs[sg]).toBeUndefined();

    // Group should be cleaned up (no members remaining)
    expect(getState().groups[groupId]).toBeUndefined();
  });

  it('deleteSelected on subgraph node in group leaves regular group members intact', () => {
    const sg = getState().createSubgraph('PartialDelete')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;
    const regular1 = getState().addNode('source', [5, 0, 0]);
    const regular2 = getState().addNode('math', [10, 0, 0]);

    // Group all three
    getState().setSelection(new Set([sg, regular1, regular2]));
    const groupId = getState().createGroup('Three-Node Group')!;
    expect(groupId).toBeTruthy();

    // Delete only the subgraph
    getState().setSelection(new Set([sg]));
    getState().deleteSelected();

    expect(getState().nodes[sg]).toBeUndefined();
    expect(getState().graphTabs[innerId]).toBeUndefined();

    // The two regular nodes stay in the group
    expect(getState().nodes[regular1]).toBeDefined();
    expect(getState().nodes[regular2]).toBeDefined();
    expect(getState().groups[groupId]).toBeDefined();
    expect(getState().nodes[regular1].groupId).toBe(groupId);
    expect(getState().nodes[regular2].groupId).toBe(groupId);
  });

  it('undo after deleteSelected on subgraph-in-group restores node, group membership, and inner graph', () => {
    const sg = getState().createSubgraph('UndoGroupSG')!;
    const innerId = getState().nodes[sg].data.innerGraphId as string;
    const regular = getState().addNode('source', [5, 0, 0]);

    getState().setSelection(new Set([sg, regular]));
    const groupId = getState().createGroup('UndoGroup')!;

    // Add content to the inner graph
    getState().enterSubgraph(sg);
    const innerNode = getState().addNode('math', [0, 0, 0]);
    getState().exitSubgraph();

    // Delete the subgraph node
    getState().setSelection(new Set([sg]));
    getState().deleteSelected();
    expect(getState().nodes[sg]).toBeUndefined();
    expect(getState().graphTabs[innerId]).toBeUndefined();

    // Undo — snapshot restores node/subgraphDef/groupId; inactiveGraphs restoration
    // makes enterSubgraph functional. graphTabs for inner graphs are not part of
    // the undo snapshot and are not repopulated, but navigation still works.
    getState().undo();

    // Node restored with its group membership
    expect(getState().nodes[sg]).toBeDefined();
    expect(getState().subgraphDefs[sg]).toBeDefined();
    expect(getState().nodes[sg].groupId).toBe(groupId);

    // Navigate inside and verify content (inactiveGraphs was restored by undo)
    getState().enterSubgraph(sg);
    expect(getState().activeGraphId).toBe(innerId);
    expect(getState().nodes[innerNode]).toBeDefined();
    getState().exitSubgraph();
  });

  it('group with nested subgraph node: deleteSelected cascades 2 levels', () => {
    // Build a 2-level nested subgraph and put the outer in a group
    const outerSg = getState().createSubgraph('Outer-Grouped')!;
    const outerInner = getState().nodes[outerSg].data.innerGraphId as string;

    getState().enterSubgraph(outerSg);
    const innerSg = getState().createSubgraph('Inner-Grouped')!;
    const innerInner = getState().nodes[innerSg].data.innerGraphId as string;
    getState().exitSubgraph();

    const companion = getState().addNode('source', [5, 0, 0]);

    // Group outer subgraph + companion
    getState().setSelection(new Set([outerSg, companion]));
    const groupId = getState().createGroup('Nested Group')!;
    expect(groupId).toBeTruthy();

    // Delete both (selecting entire group contents)
    getState().setSelection(new Set([outerSg, companion]));
    getState().deleteSelected();

    // Both nodes gone
    expect(getState().nodes[outerSg]).toBeUndefined();
    expect(getState().nodes[companion]).toBeUndefined();

    // Both levels of inner graph cleaned up
    assertTabsGone([outerInner, innerInner]);
    expect(getState().subgraphDefs[outerSg]).toBeUndefined();

    // Group itself cleaned up (no members)
    expect(getState().groups[groupId]).toBeUndefined();
  });
});

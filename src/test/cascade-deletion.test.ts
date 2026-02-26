/**
 * Recursive Cascade Deletion End-to-End Tests
 *
 * Tests comprehensive cleanup of nested subgraph resources when subgraph
 * nodes are deleted through various code paths:
 *
 * - deleteSubgraphNode: direct single-node deletion
 * - removeNode: generic node removal (delegates cascade for subgraphs)
 * - deleteSelected: multi-selection deletion with nested subgraphs
 * - clearGraph: clearing a graph that contains nested subgraph nodes
 * - deleteGraph: deleting a graph tab that contains nested subgraph nodes
 * - Undo after nested deletion: verifying restore behavior
 * - Orphan verification: ensuring no stale graphTabs or inactiveGraphs remain
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

/**
 * Helper: create a 2-level nested subgraph structure.
 * Returns { outerSgId, outerInnerGraphId, innerSgId, innerInnerGraphId }.
 * After calling, the store is back on the main graph ('default').
 */
function createNestedSubgraph() {
  // Create outer subgraph in main graph
  const outerSgId = getState().createSubgraph('Outer')!;
  expect(outerSgId).toBeTruthy();
  const outerInnerGraphId = getState().nodes[outerSgId].data.innerGraphId as string;
  expect(outerInnerGraphId).toBeTruthy();

  // Enter outer subgraph and create inner subgraph inside it
  getState().enterSubgraph(outerSgId);
  expect(getState().activeGraphId).toBe(outerInnerGraphId);

  const innerSgId = getState().createSubgraph('Inner')!;
  expect(innerSgId).toBeTruthy();
  const innerInnerGraphId = getState().nodes[innerSgId].data.innerGraphId as string;
  expect(innerInnerGraphId).toBeTruthy();

  // Exit back to main graph
  getState().exitSubgraph();
  expect(getState().activeGraphId).toBe('default');

  return { outerSgId, outerInnerGraphId, innerSgId, innerInnerGraphId };
}

/**
 * Helper: create a 3-level nested subgraph structure (A -> B -> C).
 * Returns all relevant IDs.
 * After calling, the store is back on the main graph ('default').
 */
function create3LevelNestedSubgraph() {
  // Level 1: Create subgraph A in main graph
  const sgA = getState().createSubgraph('Level-A')!;
  expect(sgA).toBeTruthy();
  const innerA = getState().nodes[sgA].data.innerGraphId as string;

  // Enter A, create B inside it
  getState().enterSubgraph(sgA);
  expect(getState().activeGraphId).toBe(innerA);

  const sgB = getState().createSubgraph('Level-B')!;
  expect(sgB).toBeTruthy();
  const innerB = getState().nodes[sgB].data.innerGraphId as string;

  // Enter B, create C inside it
  getState().enterSubgraph(sgB);
  expect(getState().activeGraphId).toBe(innerB);

  const sgC = getState().createSubgraph('Level-C')!;
  expect(sgC).toBeTruthy();
  const innerC = getState().nodes[sgC].data.innerGraphId as string;

  // Exit back to A's inner graph
  getState().exitSubgraph();
  expect(getState().activeGraphId).toBe(innerA);

  // Exit back to main graph
  getState().exitSubgraph();
  expect(getState().activeGraphId).toBe('default');

  return { sgA, innerA, sgB, innerB, sgC, innerC };
}

/**
 * Helper: verify all given graph IDs are fully cleaned from graphTabs.
 */
function assertGraphTabsCleanedUp(graphIds: string[]) {
  const tabs = getState().graphTabs;
  for (const gId of graphIds) {
    expect(tabs[gId]).toBeUndefined();
  }
}

/**
 * Helper: verify all given graph IDs are absent from graphOrder.
 */
function assertGraphOrderCleanedUp(graphIds: string[]) {
  const order = getState().graphOrder;
  for (const gId of graphIds) {
    expect(order).not.toContain(gId);
  }
}

// ==========================================================================
// 1. Nested subgraph deletion (2-level): deleteSubgraphNode
// ==========================================================================
describe('Nested subgraph deletion (2-level)', () => {
  beforeEach(() => { resetStore(); });

  it('deleteSubgraphNode recursively cleans up all inner graphs', () => {
    const { outerSgId, outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    // Verify graph tabs exist for both inner graphs before deletion
    expect(getState().graphTabs[outerInnerGraphId]).toBeDefined();
    expect(getState().graphTabs[innerInnerGraphId]).toBeDefined();

    // Verify subgraph node exists
    expect(getState().nodes[outerSgId]).toBeDefined();
    expect(getState().subgraphDefs[outerSgId]).toBeDefined();

    // Delete the outer subgraph node (should cascade to inner)
    getState().deleteSubgraphNode(outerSgId);

    // Outer subgraph node should be removed
    expect(getState().nodes[outerSgId]).toBeUndefined();
    expect(getState().subgraphDefs[outerSgId]).toBeUndefined();

    // Both inner graph tabs should be cleaned up
    assertGraphTabsCleanedUp([outerInnerGraphId, innerInnerGraphId]);
  });

  it('deleteSubgraphNode removes connections to/from the subgraph node', () => {
    const { outerSgId } = createNestedSubgraph();

    // Add a source node and connect it to the subgraph node
    const src = getState().addNode('source', [0, 0, 0]);
    const connId = getState().addConnection(src, 0, outerSgId, 0);
    expect(connId).toBeTruthy();
    expect(Object.keys(getState().connections).length).toBeGreaterThanOrEqual(1);

    // Delete the subgraph node
    getState().deleteSubgraphNode(outerSgId);

    // Connection should be removed
    const remainingConns = Object.values(getState().connections);
    const orphanedConns = remainingConns.filter(
      c => c.sourceNodeId === outerSgId || c.targetNodeId === outerSgId
    );
    expect(orphanedConns).toHaveLength(0);
  });

  it('deleteSubgraphNode deselects the deleted node', () => {
    const { outerSgId } = createNestedSubgraph();

    // Select the subgraph node
    getState().setSelection(new Set([outerSgId]));
    expect(getState().selectedIds.has(outerSgId)).toBe(true);

    getState().deleteSubgraphNode(outerSgId);

    expect(getState().selectedIds.has(outerSgId)).toBe(false);
  });
});

// ==========================================================================
// 2. 3-level deep nesting: A -> B -> C
// ==========================================================================
describe('3-level deep nested subgraph deletion', () => {
  beforeEach(() => { resetStore(); });

  it('deleting top-level subgraph cleans up all 3 levels of inner graphs', () => {
    const { sgA, innerA, innerB, innerC } = create3LevelNestedSubgraph();

    // Verify all inner graph tabs exist
    expect(getState().graphTabs[innerA]).toBeDefined();
    expect(getState().graphTabs[innerB]).toBeDefined();
    expect(getState().graphTabs[innerC]).toBeDefined();

    // Delete the top-level subgraph A
    getState().deleteSubgraphNode(sgA);

    // Node and def removed
    expect(getState().nodes[sgA]).toBeUndefined();
    expect(getState().subgraphDefs[sgA]).toBeUndefined();

    // ALL inner graph tabs at all levels should be cleaned up
    assertGraphTabsCleanedUp([innerA, innerB, innerC]);
  });

  it('removeNode on top-level subgraph also cascades through all 3 levels', () => {
    const { sgA, innerA, innerB, innerC } = create3LevelNestedSubgraph();

    // Use removeNode instead of deleteSubgraphNode
    getState().removeNode(sgA);

    expect(getState().nodes[sgA]).toBeUndefined();
    assertGraphTabsCleanedUp([innerA, innerB, innerC]);
  });

  it('deleting middle-level subgraph only cleans up its descendants', () => {
    const { sgA, innerA, sgB, innerB, innerC } = create3LevelNestedSubgraph();

    // Enter subgraph A to access B
    getState().enterSubgraph(sgA);
    expect(getState().activeGraphId).toBe(innerA);

    // Verify B exists in A's inner graph
    expect(getState().nodes[sgB]).toBeDefined();

    // Delete subgraph B (which contains C)
    getState().deleteSubgraphNode(sgB);

    // B should be removed
    expect(getState().nodes[sgB]).toBeUndefined();

    // B's and C's inner graph tabs should be cleaned up
    assertGraphTabsCleanedUp([innerB, innerC]);

    // Exit back to main graph
    getState().exitSubgraph();

    // A should still exist
    expect(getState().nodes[sgA]).toBeDefined();
    expect(getState().graphTabs[innerA]).toBeDefined();
  });
});

// ==========================================================================
// 3. deleteSelected with nested subgraphs
// ==========================================================================
describe('deleteSelected with nested subgraphs', () => {
  beforeEach(() => { resetStore(); });

  it('deletes multiple subgraph nodes and cascades all inner graphs', () => {
    // Create two independent nested subgraphs in main graph
    const sg1 = getState().createSubgraph('SG1')!;
    const inner1 = getState().nodes[sg1].data.innerGraphId as string;

    // Enter SG1 and create a nested subgraph
    getState().enterSubgraph(sg1);
    const sg1Inner = getState().createSubgraph('SG1-Inner')!;
    const inner1Inner = getState().nodes[sg1Inner].data.innerGraphId as string;
    getState().exitSubgraph();

    // Create a second subgraph in main graph
    const sg2 = getState().createSubgraph('SG2')!;
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;

    // Verify all graph tabs exist
    expect(getState().graphTabs[inner1]).toBeDefined();
    expect(getState().graphTabs[inner1Inner]).toBeDefined();
    expect(getState().graphTabs[inner2]).toBeDefined();

    // Select both top-level subgraph nodes
    getState().setSelection(new Set([sg1, sg2]));

    // Delete selected
    getState().deleteSelected();

    // Both nodes removed
    expect(getState().nodes[sg1]).toBeUndefined();
    expect(getState().nodes[sg2]).toBeUndefined();

    // All subgraphDefs removed
    expect(getState().subgraphDefs[sg1]).toBeUndefined();
    expect(getState().subgraphDefs[sg2]).toBeUndefined();

    // All inner graph tabs cleaned up
    assertGraphTabsCleanedUp([inner1, inner1Inner, inner2]);
  });

  it('deleteSelected handles mix of subgraph and regular nodes', () => {
    // Create a subgraph and a regular node
    const sg = getState().createSubgraph('Mixed')!;
    const innerGraphId = getState().nodes[sg].data.innerGraphId as string;
    const src = getState().addNode('source', [5, 0, 0]);

    // Connect them
    const connId = getState().addConnection(src, 0, sg, 0);
    expect(connId).toBeTruthy();

    // Select both
    getState().setSelection(new Set([sg, src]));
    getState().deleteSelected();

    // Both removed
    expect(getState().nodes[sg]).toBeUndefined();
    expect(getState().nodes[src]).toBeUndefined();
    expect(Object.keys(getState().connections)).toHaveLength(0);

    // Inner graph tab cleaned up
    assertGraphTabsCleanedUp([innerGraphId]);
  });

  it('deleteSelected with deeply nested subgraphs (3-level)', () => {
    const { sgA, innerA, innerB, innerC } = create3LevelNestedSubgraph();

    // Also add a regular node
    const regular = getState().addNode('math', [10, 0, 0]);

    // Select all
    getState().setSelection(new Set([sgA, regular]));
    getState().deleteSelected();

    expect(getState().nodes[sgA]).toBeUndefined();
    expect(getState().nodes[regular]).toBeUndefined();

    // All 3 levels of inner graph tabs cleaned up
    assertGraphTabsCleanedUp([innerA, innerB, innerC]);
  });
});

// ==========================================================================
// 4. clearGraph with nested subgraphs
// ==========================================================================
describe('clearGraph with nested subgraphs', () => {
  beforeEach(() => { resetStore(); });

  it('clears a graph containing nested subgraph nodes', () => {
    const { outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    // Add some regular nodes too
    getState().addNode('source', [5, 0, 0]);
    getState().addNode('transform', [10, 0, 0]);

    // Verify we have content
    expect(Object.keys(getState().nodes).length).toBeGreaterThanOrEqual(3);

    // Clear graph
    getState().clearGraph();

    // All nodes removed
    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(Object.keys(getState().connections)).toHaveLength(0);
    expect(Object.keys(getState().subgraphDefs)).toHaveLength(0);

    // Inner graph tabs cleaned up
    assertGraphTabsCleanedUp([outerInnerGraphId, innerInnerGraphId]);
  });

  it('clearGraph cleans up 3-level nested subgraphs', () => {
    const { innerA, innerB, innerC } = create3LevelNestedSubgraph();

    // Also create a sibling subgraph
    const sibling = getState().createSubgraph('Sibling')!;
    const siblingInner = getState().nodes[sibling].data.innerGraphId as string;

    getState().clearGraph();

    // Everything gone
    expect(Object.keys(getState().nodes)).toHaveLength(0);
    assertGraphTabsCleanedUp([innerA, innerB, innerC, siblingInner]);
  });

  it('clearGraph preserves graphTabs for other user-created graphs', () => {
    // Create a second user-level graph (createGraph switches to it)
    const g2 = getState().createGraph('Graph 2');
    expect(getState().graphTabs[g2]).toBeDefined();

    // Switch back to main before creating subgraphs there
    getState().switchGraph('default');

    // Create nested subgraph in main graph
    const { outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    // Clear main graph
    getState().clearGraph();

    // Inner graph tabs cleaned up
    assertGraphTabsCleanedUp([outerInnerGraphId, innerInnerGraphId]);

    // But the user-created graph tab should survive
    expect(getState().graphTabs[g2]).toBeDefined();
    expect(getState().graphTabs['default']).toBeDefined();
  });
});

// ==========================================================================
// 5. deleteGraph with nested subgraphs
// ==========================================================================
describe('deleteGraph with nested subgraphs', () => {
  beforeEach(() => { resetStore(); });

  it('deleting a graph tab that contains nested subgraphs cascades cleanup', () => {
    // Create a second graph
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);

    // Create nested subgraphs in Graph 2
    const sg = getState().createSubgraph('SG in G2')!;
    const innerGraphId = getState().nodes[sg].data.innerGraphId as string;

    // Create a nested subgraph inside
    getState().enterSubgraph(sg);
    const nestedSg = getState().createSubgraph('Nested in G2')!;
    const nestedInnerGraphId = getState().nodes[nestedSg].data.innerGraphId as string;
    getState().exitSubgraph();

    // Verify tabs exist
    expect(getState().graphTabs[innerGraphId]).toBeDefined();
    expect(getState().graphTabs[nestedInnerGraphId]).toBeDefined();

    // Switch to main graph and delete Graph 2
    getState().switchGraph('default');
    getState().deleteGraph(g2);

    // Graph 2 tab removed
    expect(getState().graphTabs[g2]).toBeUndefined();
    expect(getState().graphOrder).not.toContain(g2);

    // All inner graph tabs from Graph 2 should be cleaned up
    assertGraphTabsCleanedUp([innerGraphId, nestedInnerGraphId]);
  });

  it('deleteGraph cascades 3-level nested subgraphs in a non-active graph', () => {
    // Create Graph 2
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);

    // Build 3-level nesting in Graph 2
    const sgA = getState().createSubgraph('A')!;
    const innerA = getState().nodes[sgA].data.innerGraphId as string;

    getState().enterSubgraph(sgA);
    const sgB = getState().createSubgraph('B')!;
    const innerB = getState().nodes[sgB].data.innerGraphId as string;

    getState().enterSubgraph(sgB);
    const sgC = getState().createSubgraph('C')!;
    const innerC = getState().nodes[sgC].data.innerGraphId as string;
    getState().exitSubgraph();
    getState().exitSubgraph();

    // Switch to main and delete Graph 2
    getState().switchGraph('default');
    getState().deleteGraph(g2);

    // All nested graph tabs should be gone
    expect(getState().graphTabs[g2]).toBeUndefined();
    assertGraphTabsCleanedUp([innerA, innerB, innerC]);

    // Main graph should be unaffected
    expect(getState().graphTabs['default']).toBeDefined();
    expect(getState().activeGraphId).toBe('default');
  });

  it('deleteGraph on active graph switches to another graph first', () => {
    // Create Graph 2 with nested subgraphs
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);

    const sg = getState().createSubgraph('SG')!;
    const innerGraphId = getState().nodes[sg].data.innerGraphId as string;

    // Delete Graph 2 while it is active
    getState().deleteGraph(g2);

    // Should have switched to default
    expect(getState().activeGraphId).toBe('default');
    expect(getState().graphTabs[g2]).toBeUndefined();
    assertGraphTabsCleanedUp([innerGraphId]);
  });

  it('cannot delete the last remaining graph', () => {
    // Only 'default' exists
    const tabCountBefore = Object.keys(getState().graphTabs).length;
    getState().deleteGraph('default');

    // Should still have the default graph
    expect(getState().graphTabs['default']).toBeDefined();
    expect(Object.keys(getState().graphTabs).length).toBe(tabCountBefore);
  });
});

// ==========================================================================
// 6. removeNode with nested subgraph
// ==========================================================================
describe('removeNode with nested subgraph', () => {
  beforeEach(() => { resetStore(); });

  it('removeNode on a subgraph node cascades inner graph cleanup', () => {
    const { outerSgId, outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    // Use generic removeNode
    getState().removeNode(outerSgId);

    // Node removed
    expect(getState().nodes[outerSgId]).toBeUndefined();

    // subgraphDef removed
    expect(getState().subgraphDefs[outerSgId]).toBeUndefined();

    // Inner graph tabs cleaned up
    assertGraphTabsCleanedUp([outerInnerGraphId, innerInnerGraphId]);
  });

  it('removeNode cleans up connections to the subgraph node', () => {
    const { outerSgId } = createNestedSubgraph();

    // Add connections
    const src = getState().addNode('source', [-5, 0, 0]);
    const out = getState().addNode('output', [5, 0, 0]);
    getState().addConnection(src, 0, outerSgId, 0);
    getState().addConnection(outerSgId, 0, out, 0);

    const connsBefore = Object.keys(getState().connections).length;
    expect(connsBefore).toBeGreaterThanOrEqual(2);

    getState().removeNode(outerSgId);

    // Connections to/from the removed node should be gone
    const remainingConns = Object.values(getState().connections);
    const orphaned = remainingConns.filter(
      c => c.sourceNodeId === outerSgId || c.targetNodeId === outerSgId
    );
    expect(orphaned).toHaveLength(0);

    // Source and output nodes should still exist
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[out]).toBeDefined();
  });

  it('removeNode on a non-subgraph node does not affect subgraph tabs', () => {
    const { outerSgId, outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    // Add a regular node
    const regular = getState().addNode('source', [10, 0, 0]);

    // Remove regular node
    getState().removeNode(regular);

    // Subgraph should be unaffected
    expect(getState().nodes[outerSgId]).toBeDefined();
    expect(getState().graphTabs[outerInnerGraphId]).toBeDefined();
    expect(getState().graphTabs[innerInnerGraphId]).toBeDefined();
  });

  it('removeNode does not delete subgraph boundary nodes', () => {
    const sg = getState().createSubgraph('Boundary Test')!;
    getState().enterSubgraph(sg);

    // Find boundary nodes
    const inputNode = Object.values(getState().nodes)
      .find(n => n.type === 'subgraph-input');
    const outputNode = Object.values(getState().nodes)
      .find(n => n.type === 'subgraph-output');
    expect(inputNode).toBeDefined();
    expect(outputNode).toBeDefined();

    // Try to remove them - should be no-ops
    getState().removeNode(inputNode!.id);
    getState().removeNode(outputNode!.id);

    // They should still exist
    expect(getState().nodes[inputNode!.id]).toBeDefined();
    expect(getState().nodes[outputNode!.id]).toBeDefined();

    getState().exitSubgraph();
  });
});

// ==========================================================================
// 7. Verify no orphaned inactiveGraphs
// ==========================================================================
describe('No orphaned inactiveGraphs after deletion', () => {
  beforeEach(() => { resetStore(); });

  it('deleteSubgraphNode removes inactiveGraphs entries', () => {
    const { outerSgId, outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    // Before deletion: after createSubgraph + exitSubgraph, the inner graphs
    // should be in inactiveGraphs (module-scoped).
    // We can't directly access inactiveGraphs, but we can verify via graphTabs
    // and by trying to enter the subgraph (which reads from inactiveGraphs).
    expect(getState().graphTabs[outerInnerGraphId]).toBeDefined();
    expect(getState().graphTabs[innerInnerGraphId]).toBeDefined();

    getState().deleteSubgraphNode(outerSgId);

    // After deletion, graphTabs should be cleaned up
    assertGraphTabsCleanedUp([outerInnerGraphId, innerInnerGraphId]);

    // Verify we can't enter a deleted subgraph (node doesn't exist)
    expect(getState().nodes[outerSgId]).toBeUndefined();
  });

  it('clearGraph removes all inactiveGraphs for nested subgraphs', () => {
    // Create multiple nested subgraphs
    const { outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();
    const sg2 = getState().createSubgraph('SG2')!;
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;

    getState().clearGraph();

    // All inner graph tabs should be gone
    assertGraphTabsCleanedUp([outerInnerGraphId, innerInnerGraphId, inner2]);

    // No nodes should remain
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('after deleteSelected, re-creating subgraphs works without conflicts', () => {
    // This indirectly tests that inactiveGraphs are properly cleaned up
    const sg1 = getState().createSubgraph('SG1')!;
    const inner1 = getState().nodes[sg1].data.innerGraphId as string;

    getState().setSelection(new Set([sg1]));
    getState().deleteSelected();

    assertGraphTabsCleanedUp([inner1]);

    // Create a new subgraph - should work without issues
    const sg2 = getState().createSubgraph('SG2')!;
    expect(sg2).toBeTruthy();
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;
    expect(inner2).toBeTruthy();

    // Enter and exit to verify it's functional
    getState().enterSubgraph(sg2);
    expect(getState().activeGraphId).toBe(inner2);
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe('default');
  });
});

// ==========================================================================
// 8. Verify no orphaned graphTabs
// ==========================================================================
describe('No orphaned graphTabs after deletion', () => {
  beforeEach(() => { resetStore(); });

  it('after deleting a nested subgraph, no graphTabs reference deleted inner graphs', () => {
    const { outerSgId, outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    // Also create another subgraph at the same level
    const sibling = getState().createSubgraph('Sibling')!;
    const siblingInner = getState().nodes[sibling].data.innerGraphId as string;

    // Delete only the nested one
    getState().deleteSubgraphNode(outerSgId);

    // Nested inner graph tabs gone
    assertGraphTabsCleanedUp([outerInnerGraphId, innerInnerGraphId]);

    // Sibling's inner graph tab should still exist
    expect(getState().graphTabs[siblingInner]).toBeDefined();

    // Main graph tab should still exist
    expect(getState().graphTabs['default']).toBeDefined();
  });

  it('graphOrder never contains inner graph IDs (inner graphs are not tab-bar graphs)', () => {
    const { outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    // Inner graph IDs should never appear in graphOrder
    assertGraphOrderCleanedUp([outerInnerGraphId, innerInnerGraphId]);

    // Only 'default' should be in graphOrder
    expect(getState().graphOrder).toEqual(['default']);
  });

  it('after clearGraph, graphTabs only has the main graph (and any user-created graphs)', () => {
    const g2 = getState().createGraph('Graph 2');
    // createGraph switches to g2; switch back to main before creating subgraphs
    getState().switchGraph('default');
    createNestedSubgraph();

    getState().clearGraph();

    // graphTabs should only have 'default' and 'Graph 2'
    const tabIds = Object.keys(getState().graphTabs);
    expect(tabIds).toContain('default');
    expect(tabIds).toContain(g2);

    // No extra tabs should exist
    expect(tabIds.length).toBe(2);
  });

  it('after deleteGraph, remaining graphs do not reference deleted inner graphs', () => {
    // Create Graph 2 with nested subgraph
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);
    const sg = getState().createSubgraph('SG-G2')!;
    const inner = getState().nodes[sg].data.innerGraphId as string;
    getState().switchGraph('default');

    // Create subgraph in main graph
    const mainSg = getState().createSubgraph('SG-Main')!;
    const mainInner = getState().nodes[mainSg].data.innerGraphId as string;

    // Delete Graph 2
    getState().deleteGraph(g2);

    // Graph 2's inner graph tabs should be gone
    assertGraphTabsCleanedUp([inner]);
    expect(getState().graphTabs[g2]).toBeUndefined();

    // Main graph's subgraph should still have its tab
    expect(getState().graphTabs[mainInner]).toBeDefined();
    expect(getState().nodes[mainSg]).toBeDefined();
  });
});

// ==========================================================================
// 9. Undo after nested deletion
// ==========================================================================
describe('Undo after nested deletion', () => {
  beforeEach(() => { resetStore(); });

  it('undo after deleteSubgraphNode restores the subgraph node and subgraphDef', () => {
    const { outerSgId, outerInnerGraphId } = createNestedSubgraph();

    // Delete the outer subgraph
    getState().deleteSubgraphNode(outerSgId);
    expect(getState().nodes[outerSgId]).toBeUndefined();
    expect(getState().subgraphDefs[outerSgId]).toBeUndefined();

    // Undo
    getState().undo();

    // Node and def should be restored
    expect(getState().nodes[outerSgId]).toBeDefined();
    expect(getState().nodes[outerSgId].type).toBe('subgraph');
    expect(getState().subgraphDefs[outerSgId]).toBeDefined();
    expect(getState().subgraphDefs[outerSgId].innerGraphId).toBe(outerInnerGraphId);
  });

  it('undo after removeNode restores the subgraph node and its connections', () => {
    const { outerSgId } = createNestedSubgraph();

    // Add a connection to the subgraph
    const src = getState().addNode('source', [-5, 0, 0]);
    const connId = getState().addConnection(src, 0, outerSgId, 0)!;
    expect(connId).toBeTruthy();

    // Remove the subgraph node
    getState().removeNode(outerSgId);
    expect(getState().nodes[outerSgId]).toBeUndefined();
    expect(getState().connections[connId]).toBeUndefined();

    // Undo
    getState().undo();

    // Node restored
    expect(getState().nodes[outerSgId]).toBeDefined();
    // Connection restored
    expect(getState().connections[connId]).toBeDefined();
  });

  it('undo after deleteSelected restores all deleted subgraph nodes', () => {
    const sg1 = getState().createSubgraph('Undo-SG1')!;
    const sg2 = getState().createSubgraph('Undo-SG2')!;

    getState().setSelection(new Set([sg1, sg2]));
    getState().deleteSelected();

    expect(getState().nodes[sg1]).toBeUndefined();
    expect(getState().nodes[sg2]).toBeUndefined();

    getState().undo();

    expect(getState().nodes[sg1]).toBeDefined();
    expect(getState().nodes[sg2]).toBeDefined();
    expect(getState().subgraphDefs[sg1]).toBeDefined();
    expect(getState().subgraphDefs[sg2]).toBeDefined();
  });

  it('undo after clearGraph restores subgraph nodes and defs', () => {
    const { outerSgId } = createNestedSubgraph();
    const regular = getState().addNode('source', [5, 0, 0]);

    getState().clearGraph();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    getState().undo();

    expect(getState().nodes[outerSgId]).toBeDefined();
    expect(getState().nodes[regular]).toBeDefined();
    expect(getState().subgraphDefs[outerSgId]).toBeDefined();
  });

  it('redo after undo re-deletes the subgraph node', () => {
    const { outerSgId } = createNestedSubgraph();

    getState().deleteSubgraphNode(outerSgId);
    expect(getState().nodes[outerSgId]).toBeUndefined();

    // Undo restores
    getState().undo();
    expect(getState().nodes[outerSgId]).toBeDefined();

    // Redo re-deletes
    getState().redo();
    expect(getState().nodes[outerSgId]).toBeUndefined();
    expect(getState().subgraphDefs[outerSgId]).toBeUndefined();
  });

  it('undo after deleteSubgraphNode restores inner graph data (enterSubgraph works)', () => {
    const { outerSgId, outerInnerGraphId } = createNestedSubgraph();

    // Delete the outer subgraph
    getState().deleteSubgraphNode(outerSgId);
    expect(getState().nodes[outerSgId]).toBeUndefined();

    // Undo
    getState().undo();

    // Node and def should be restored
    expect(getState().nodes[outerSgId]).toBeDefined();
    expect(getState().subgraphDefs[outerSgId]).toBeDefined();
    // Enter the restored subgraph — inner graph data must be available
    getState().enterSubgraph(outerSgId);
    expect(getState().activeGraphId).toBe(outerInnerGraphId);
    // Inner graph should have the subgraph-input and subgraph-output nodes
    const innerNodes = Object.values(getState().nodes);
    expect(innerNodes.some(n => n.type === 'subgraph-input')).toBe(true);
    expect(innerNodes.some(n => n.type === 'subgraph-output')).toBe(true);
  });

  it('redo after undo re-deletes inner graph data', () => {
    const { outerSgId, outerInnerGraphId } = createNestedSubgraph();

    getState().deleteSubgraphNode(outerSgId);

    // Undo restores everything
    getState().undo();
    expect(getState().nodes[outerSgId]).toBeDefined();

    // Redo re-deletes
    getState().redo();
    expect(getState().nodes[outerSgId]).toBeUndefined();

    // Undo again should still restore inner graph data
    getState().undo();
    expect(getState().nodes[outerSgId]).toBeDefined();
    getState().enterSubgraph(outerSgId);
    expect(getState().activeGraphId).toBe(outerInnerGraphId);
    const innerNodes = Object.values(getState().nodes);
    expect(innerNodes.some(n => n.type === 'subgraph-input')).toBe(true);
  });

  it('undo after removeNode restores inner graph data for subgraph nodes', () => {
    const { outerSgId, outerInnerGraphId } = createNestedSubgraph();

    getState().removeNode(outerSgId);
    expect(getState().nodes[outerSgId]).toBeUndefined();

    getState().undo();

    expect(getState().nodes[outerSgId]).toBeDefined();
    // Enter the restored subgraph
    getState().enterSubgraph(outerSgId);
    expect(getState().activeGraphId).toBe(outerInnerGraphId);
    const innerNodes = Object.values(getState().nodes);
    expect(innerNodes.some(n => n.type === 'subgraph-input')).toBe(true);
  });

  it('undo after deleteSelected restores inner graph data for multiple subgraphs', () => {
    const sg1 = getState().createSubgraph('Undo-Inner-1')!;
    const inner1 = getState().nodes[sg1].data.innerGraphId as string;
    const sg2 = getState().createSubgraph('Undo-Inner-2')!;
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;

    getState().setSelection(new Set([sg1, sg2]));
    getState().deleteSelected();

    getState().undo();

    // Both subgraphs should be navigable
    getState().enterSubgraph(sg1);
    expect(getState().activeGraphId).toBe(inner1);
    const nodes1 = Object.values(getState().nodes);
    expect(nodes1.some(n => n.type === 'subgraph-input')).toBe(true);
    getState().exitSubgraph();

    getState().enterSubgraph(sg2);
    expect(getState().activeGraphId).toBe(inner2);
    const nodes2 = Object.values(getState().nodes);
    expect(nodes2.some(n => n.type === 'subgraph-input')).toBe(true);
  });

  it('undo after clearGraph restores inner graph data', () => {
    const { outerSgId, outerInnerGraphId } = createNestedSubgraph();

    getState().clearGraph();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    getState().undo();

    expect(getState().nodes[outerSgId]).toBeDefined();
    getState().enterSubgraph(outerSgId);
    expect(getState().activeGraphId).toBe(outerInnerGraphId);
    const innerNodes = Object.values(getState().nodes);
    expect(innerNodes.some(n => n.type === 'subgraph-input')).toBe(true);
  });
});

// ==========================================================================
// Edge cases and comprehensive scenarios
// ==========================================================================
describe('Edge cases for cascade deletion', () => {
  beforeEach(() => { resetStore(); });

  it('deleting a subgraph with no inner graph (malformed) does not crash', () => {
    // Create a subgraph node manually with no valid innerGraphId
    const sg = getState().createSubgraph('Empty')!;

    // Should not throw
    expect(() => getState().deleteSubgraphNode(sg)).not.toThrow();
    expect(getState().nodes[sg]).toBeUndefined();
  });

  it('multiple sequential deletions do not leave orphaned state', () => {
    // Create 3 independent subgraphs
    const sg1 = getState().createSubgraph('A')!;
    const inner1 = getState().nodes[sg1].data.innerGraphId as string;

    const sg2 = getState().createSubgraph('B')!;
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;

    const sg3 = getState().createSubgraph('C')!;
    const inner3 = getState().nodes[sg3].data.innerGraphId as string;

    // Delete them one by one
    getState().deleteSubgraphNode(sg1);
    assertGraphTabsCleanedUp([inner1]);
    expect(getState().graphTabs[inner2]).toBeDefined();
    expect(getState().graphTabs[inner3]).toBeDefined();

    getState().deleteSubgraphNode(sg2);
    assertGraphTabsCleanedUp([inner1, inner2]);
    expect(getState().graphTabs[inner3]).toBeDefined();

    getState().deleteSubgraphNode(sg3);
    assertGraphTabsCleanedUp([inner1, inner2, inner3]);

    // Only 'default' tab should remain
    const tabIds = Object.keys(getState().graphTabs);
    expect(tabIds).toEqual(['default']);
  });

  it('cascade deletion works when inner subgraph has nodes and connections', () => {
    const outerSgId = getState().createSubgraph('Outer')!;
    const outerInner = getState().nodes[outerSgId].data.innerGraphId as string;

    // Enter outer and add content
    getState().enterSubgraph(outerSgId);
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(src, 0, trn, 0);

    // Create nested subgraph with content
    const innerSg = getState().createSubgraph('Inner')!;
    const innerInner = getState().nodes[innerSg].data.innerGraphId as string;
    getState().enterSubgraph(innerSg);
    getState().addNode('math', [0, 0, 0]);
    getState().exitSubgraph();

    // Exit to main
    getState().exitSubgraph();

    // Delete outer subgraph - should clean up everything including content
    getState().deleteSubgraphNode(outerSgId);

    expect(getState().nodes[outerSgId]).toBeUndefined();
    assertGraphTabsCleanedUp([outerInner, innerInner]);
  });

  it('deleting all nodes via deleteSelected leaves a clean state', () => {
    // Create a variety of nodes including nested subgraphs
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    const { outerSgId, outerInnerGraphId, innerInnerGraphId } = createNestedSubgraph();

    getState().addConnection(src, 0, trn, 0);
    getState().addConnection(trn, 0, outerSgId, 0);

    // Select all
    const allIds = new Set(Object.keys(getState().nodes));
    getState().setSelection(allIds);
    getState().deleteSelected();

    // Everything clean
    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(Object.keys(getState().connections)).toHaveLength(0);
    expect(Object.keys(getState().subgraphDefs)).toHaveLength(0);
    assertGraphTabsCleanedUp([outerInnerGraphId, innerInnerGraphId]);
  });

  it('interleaved create and delete operations maintain consistency', () => {
    // Create, delete, create pattern
    const sg1 = getState().createSubgraph('First')!;
    const inner1 = getState().nodes[sg1].data.innerGraphId as string;

    getState().deleteSubgraphNode(sg1);
    assertGraphTabsCleanedUp([inner1]);

    // Create a new subgraph - should work fine
    const sg2 = getState().createSubgraph('Second')!;
    const inner2 = getState().nodes[sg2].data.innerGraphId as string;
    expect(getState().graphTabs[inner2]).toBeDefined();

    // Enter second and create nested
    getState().enterSubgraph(sg2);
    const sg3 = getState().createSubgraph('Nested')!;
    const inner3 = getState().nodes[sg3].data.innerGraphId as string;
    getState().exitSubgraph();

    // Delete second - should cascade clean nested too
    getState().deleteSubgraphNode(sg2);
    assertGraphTabsCleanedUp([inner2, inner3]);

    // Only default tab should remain
    expect(Object.keys(getState().graphTabs)).toEqual(['default']);
  });

  it('deleteGraph does not affect subgraphs in other graphs', () => {
    // Create subgraph in main graph
    const mainSg = getState().createSubgraph('Main-SG')!;
    const mainInner = getState().nodes[mainSg].data.innerGraphId as string;

    // Create Graph 2 with its own subgraph
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph(g2);
    const g2Sg = getState().createSubgraph('G2-SG')!;
    const g2Inner = getState().nodes[g2Sg].data.innerGraphId as string;

    // Switch back to main and delete Graph 2
    getState().switchGraph('default');
    getState().deleteGraph(g2);

    // Graph 2 subgraph cleaned up
    assertGraphTabsCleanedUp([g2Inner]);

    // Main graph's subgraph should be intact
    expect(getState().nodes[mainSg]).toBeDefined();
    expect(getState().graphTabs[mainInner]).toBeDefined();
    expect(getState().subgraphDefs[mainSg]).toBeDefined();
  });
});

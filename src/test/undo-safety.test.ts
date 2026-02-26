/**
 * Undo safety tests (~20 tests).
 * Verifies inactiveGraphs cleanup on undo of creation actions:
 * createSubgraph, convertSelectionToSubgraph, duplicateSelected, paste.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

enableMapSet();

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionTimings = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

/** Get the inner graph ID from a subgraph node */
function getInnerGraphId(nodeId: string): string {
  const node = getState().nodes[nodeId];
  return node.data.innerGraphId as string;
}

/**
 * Get all inactive graph IDs by exporting the full workspace and
 * subtracting the active graph. exportAllGraphs() dumps inactiveGraphs
 * into its `graphs` record alongside the active graph.
 */
function getInactiveGraphIds(): string[] {
  const exported = getState().exportAllGraphs();
  const activeId = getState().activeGraphId;
  return Object.keys(exported.graphs).filter(id => id !== activeId);
}

/** Count entries in the inactiveGraphs record */
function inactiveGraphCount(): number {
  return getInactiveGraphIds().length;
}

/** Check if a specific graph ID exists in inactiveGraphs */
function hasInactiveGraph(graphId: string): boolean {
  return getInactiveGraphIds().includes(graphId);
}

/** Get inner graph data from an export for verification purposes */
function getInactiveGraphData(graphId: string) {
  const exported = getState().exportAllGraphs();
  return exported.graphs[graphId];
}

// ===========================================================================
// Group 1: createSubgraph undo safety
// ===========================================================================

describe('createSubgraph undo safety', () => {
  beforeEach(resetStore);

  it('creates inner graph in inactiveGraphs', () => {
    const nodeId = getState().createSubgraph('Test');
    expect(nodeId).not.toBeNull();

    const innerGraphId = getInnerGraphId(nodeId!);
    expect(innerGraphId).toBeDefined();
    expect(hasInactiveGraph(innerGraphId)).toBe(true);
    expect(inactiveGraphCount()).toBe(1);
  });

  it('undo of createSubgraph removes inner graph from inactiveGraphs', () => {
    const nodeId = getState().createSubgraph('Test');
    const innerGraphId = getInnerGraphId(nodeId!);
    expect(hasInactiveGraph(innerGraphId)).toBe(true);

    getState().undo();

    expect(hasInactiveGraph(innerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(0);
  });

  it('redo of createSubgraph re-creates inner graph in inactiveGraphs', () => {
    const nodeId = getState().createSubgraph('Test');
    const innerGraphId = getInnerGraphId(nodeId!);

    getState().undo();
    expect(hasInactiveGraph(innerGraphId)).toBe(false);

    getState().redo();
    expect(hasInactiveGraph(innerGraphId)).toBe(true);
    expect(inactiveGraphCount()).toBe(1);
  });

  it('undo->redo->undo cycle does not leak graphs', () => {
    const nodeId = getState().createSubgraph('Test');
    const innerGraphId = getInnerGraphId(nodeId!);

    // Cycle 1
    getState().undo();
    expect(inactiveGraphCount()).toBe(0);
    getState().redo();
    expect(inactiveGraphCount()).toBe(1);
    getState().undo();
    expect(inactiveGraphCount()).toBe(0);

    // Cycle 2
    getState().redo();
    expect(hasInactiveGraph(innerGraphId)).toBe(true);
    expect(inactiveGraphCount()).toBe(1);
    getState().undo();
    expect(hasInactiveGraph(innerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(0);
  });

  it('multiple createSubgraph then undo all cleans up all', () => {
    const id1 = getState().createSubgraph('Sub1');
    const ig1 = getInnerGraphId(id1!);
    const id2 = getState().createSubgraph('Sub2');
    const ig2 = getInnerGraphId(id2!);
    const id3 = getState().createSubgraph('Sub3');
    const ig3 = getInnerGraphId(id3!);

    expect(inactiveGraphCount()).toBe(3);
    expect(hasInactiveGraph(ig1)).toBe(true);
    expect(hasInactiveGraph(ig2)).toBe(true);
    expect(hasInactiveGraph(ig3)).toBe(true);

    getState().undo(); // undo Sub3
    expect(hasInactiveGraph(ig3)).toBe(false);
    expect(inactiveGraphCount()).toBe(2);

    getState().undo(); // undo Sub2
    expect(hasInactiveGraph(ig2)).toBe(false);
    expect(inactiveGraphCount()).toBe(1);

    getState().undo(); // undo Sub1
    expect(hasInactiveGraph(ig1)).toBe(false);
    expect(inactiveGraphCount()).toBe(0);
  });
});

// ===========================================================================
// Group 2: convertSelectionToSubgraph undo safety
// ===========================================================================

describe('convertSelectionToSubgraph undo safety', () => {
  beforeEach(resetStore);

  it('creates inner graph in inactiveGraphs', () => {
    // Add a node and select it
    getState().addNode('source', [0, 0, 0]);
    const nodeIds = Object.keys(getState().nodes);
    useEditorStore.setState(s => { s.selectedIds = new Set(nodeIds); });

    const subId = getState().convertSelectionToSubgraph('Wrapper');
    expect(subId).not.toBeNull();

    const innerGraphId = getInnerGraphId(subId!);
    expect(hasInactiveGraph(innerGraphId)).toBe(true);
    expect(inactiveGraphCount()).toBe(1);
  });

  it('undo of convertSelectionToSubgraph removes inner graph from inactiveGraphs', () => {
    getState().addNode('source', [0, 0, 0]);
    const nodeIds = Object.keys(getState().nodes);
    useEditorStore.setState(s => { s.selectedIds = new Set(nodeIds); });

    const subId = getState().convertSelectionToSubgraph('Wrapper');
    const innerGraphId = getInnerGraphId(subId!);
    expect(hasInactiveGraph(innerGraphId)).toBe(true);

    getState().undo();

    expect(hasInactiveGraph(innerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(0);
  });

  it('redo->undo cycle works correctly', () => {
    getState().addNode('source', [0, 0, 0]);
    const nodeIds = Object.keys(getState().nodes);
    useEditorStore.setState(s => { s.selectedIds = new Set(nodeIds); });

    const subId = getState().convertSelectionToSubgraph('Wrapper');
    const innerGraphId = getInnerGraphId(subId!);

    getState().undo();
    expect(hasInactiveGraph(innerGraphId)).toBe(false);

    getState().redo();
    expect(hasInactiveGraph(innerGraphId)).toBe(true);
    expect(inactiveGraphCount()).toBe(1);

    getState().undo();
    expect(hasInactiveGraph(innerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(0);
  });

  it('with multiple selected nodes — undo cleanup', () => {
    // Add three nodes and select all
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('math', [2, 0, 0]);
    getState().addNode('transform', [4, 0, 0]);
    const nodeIds = Object.keys(getState().nodes);
    expect(nodeIds.length).toBe(3);

    useEditorStore.setState(s => { s.selectedIds = new Set(nodeIds); });

    const subId = getState().convertSelectionToSubgraph('MultiWrapper');
    expect(subId).not.toBeNull();

    const innerGraphId = getInnerGraphId(subId!);
    expect(hasInactiveGraph(innerGraphId)).toBe(true);

    // The inner graph should contain the 3 original nodes + boundary nodes
    const innerGraph = getInactiveGraphData(innerGraphId);
    expect(innerGraph).toBeDefined();
    const innerNodeCount = Object.keys(innerGraph.nodes).length;
    expect(innerNodeCount).toBeGreaterThanOrEqual(3);

    getState().undo();

    expect(hasInactiveGraph(innerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(0);
    // Original nodes should be restored
    expect(Object.keys(getState().nodes).length).toBe(3);
  });
});

// ===========================================================================
// Group 3: duplicateSelected undo safety
// ===========================================================================

describe('duplicateSelected undo safety', () => {
  beforeEach(resetStore);

  /** Helper: create a subgraph node and return its ID + inner graph ID */
  function createSubgraphNode(): { nodeId: string; innerGraphId: string } {
    const nodeId = getState().createSubgraph('Original');
    expect(nodeId).not.toBeNull();
    const innerGraphId = getInnerGraphId(nodeId!);
    return { nodeId: nodeId!, innerGraphId };
  }

  it('duplicateSelected of subgraph node creates new inner graph', () => {
    const { nodeId, innerGraphId: origInnerGraphId } = createSubgraphNode();
    expect(inactiveGraphCount()).toBe(1);

    useEditorStore.setState(s => { s.selectedIds = new Set([nodeId]); });
    const result = getState().duplicateSelected();
    expect(result).not.toBeNull();

    // Should now have 2 inactive graphs: original + duplicate
    expect(inactiveGraphCount()).toBe(2);
    expect(hasInactiveGraph(origInnerGraphId)).toBe(true);

    // The duplicated node should have a different inner graph ID
    const dupNodeId = result!.get(nodeId)!;
    const dupInnerGraphId = getInnerGraphId(dupNodeId);
    expect(dupInnerGraphId).not.toBe(origInnerGraphId);
    expect(hasInactiveGraph(dupInnerGraphId)).toBe(true);
  });

  it('undo of duplicateSelected removes the new inner graph but not the original', () => {
    const { nodeId, innerGraphId: origInnerGraphId } = createSubgraphNode();

    useEditorStore.setState(s => { s.selectedIds = new Set([nodeId]); });
    const result = getState().duplicateSelected();
    const dupNodeId = result!.get(nodeId)!;
    const dupInnerGraphId = getInnerGraphId(dupNodeId);

    expect(inactiveGraphCount()).toBe(2);

    getState().undo(); // undo duplicate

    // Original inner graph should remain; duplicate's inner graph should be gone
    expect(hasInactiveGraph(origInnerGraphId)).toBe(true);
    expect(hasInactiveGraph(dupInnerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(1);
  });

  it('redo of duplicateSelected re-creates the new inner graph', () => {
    const { nodeId, innerGraphId: origInnerGraphId } = createSubgraphNode();

    useEditorStore.setState(s => { s.selectedIds = new Set([nodeId]); });
    const result = getState().duplicateSelected();
    const dupNodeId = result!.get(nodeId)!;
    const dupInnerGraphId = getInnerGraphId(dupNodeId);

    getState().undo();
    expect(hasInactiveGraph(dupInnerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(1);

    getState().redo();
    expect(hasInactiveGraph(dupInnerGraphId)).toBe(true);
    expect(hasInactiveGraph(origInnerGraphId)).toBe(true);
    expect(inactiveGraphCount()).toBe(2);
  });

  it('duplicateSelected multiple subgraph nodes — undo cleans all', () => {
    // Create two subgraph nodes
    const sub1 = createSubgraphNode();
    const sub2 = createSubgraphNode();
    expect(inactiveGraphCount()).toBe(2);

    // Select both and duplicate
    useEditorStore.setState(s => {
      s.selectedIds = new Set([sub1.nodeId, sub2.nodeId]);
    });
    const result = getState().duplicateSelected();
    expect(result).not.toBeNull();

    // Should have 4 inactive graphs total
    expect(inactiveGraphCount()).toBe(4);

    const dup1InnerGraphId = getInnerGraphId(result!.get(sub1.nodeId)!);
    const dup2InnerGraphId = getInnerGraphId(result!.get(sub2.nodeId)!);

    getState().undo(); // undo duplicate

    // Only originals should remain
    expect(hasInactiveGraph(sub1.innerGraphId)).toBe(true);
    expect(hasInactiveGraph(sub2.innerGraphId)).toBe(true);
    expect(hasInactiveGraph(dup1InnerGraphId)).toBe(false);
    expect(hasInactiveGraph(dup2InnerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(2);
  });
});

// ===========================================================================
// Group 4: paste undo safety
// ===========================================================================

describe('paste undo safety', () => {
  beforeEach(resetStore);

  /** Helper: create a subgraph, select it, and copy to clipboard */
  function createAndCopySubgraph(): { nodeId: string; innerGraphId: string } {
    const nodeId = getState().createSubgraph('Original');
    expect(nodeId).not.toBeNull();
    const innerGraphId = getInnerGraphId(nodeId!);

    useEditorStore.setState(s => { s.selectedIds = new Set([nodeId!]); });
    getState().copySelected();

    return { nodeId: nodeId!, innerGraphId };
  }

  it('paste of subgraph node creates new inner graph', () => {
    const { innerGraphId: origInnerGraphId } = createAndCopySubgraph();
    expect(inactiveGraphCount()).toBe(1);

    getState().paste();

    // Should now have 2 inactive graphs: original + pasted
    expect(inactiveGraphCount()).toBe(2);
    expect(hasInactiveGraph(origInnerGraphId)).toBe(true);

    // Find the pasted subgraph node (the one that is not the original)
    const subNodes = Object.values(getState().nodes).filter(n => n.type === 'subgraph');
    expect(subNodes.length).toBe(2);
    const pastedNode = subNodes.find(n => getInnerGraphId(n.id) !== origInnerGraphId)!;
    expect(hasInactiveGraph(getInnerGraphId(pastedNode.id))).toBe(true);
  });

  it('undo of paste removes the new inner graph', () => {
    const { innerGraphId: origInnerGraphId } = createAndCopySubgraph();

    getState().paste();
    expect(inactiveGraphCount()).toBe(2);

    // Find the pasted inner graph ID before undo
    const subNodes = Object.values(getState().nodes).filter(n => n.type === 'subgraph');
    const pastedNode = subNodes.find(n => getInnerGraphId(n.id) !== origInnerGraphId)!;
    const pastedInnerGraphId = getInnerGraphId(pastedNode.id);

    getState().undo(); // undo paste

    expect(hasInactiveGraph(origInnerGraphId)).toBe(true);
    expect(hasInactiveGraph(pastedInnerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(1);
  });

  it('redo of paste re-creates the inner graph', () => {
    const { innerGraphId: origInnerGraphId } = createAndCopySubgraph();

    getState().paste();
    const subNodes = Object.values(getState().nodes).filter(n => n.type === 'subgraph');
    const pastedNode = subNodes.find(n => getInnerGraphId(n.id) !== origInnerGraphId)!;
    const pastedInnerGraphId = getInnerGraphId(pastedNode.id);

    getState().undo();
    expect(hasInactiveGraph(pastedInnerGraphId)).toBe(false);
    expect(inactiveGraphCount()).toBe(1);

    getState().redo();
    expect(hasInactiveGraph(pastedInnerGraphId)).toBe(true);
    expect(hasInactiveGraph(origInnerGraphId)).toBe(true);
    expect(inactiveGraphCount()).toBe(2);
  });
});

// ===========================================================================
// Group 5: exportAllGraphs does not include orphans
// ===========================================================================

describe('exportAllGraphs does not include orphans', () => {
  beforeEach(resetStore);

  it('after create->undo, exportAllGraphs does not include orphaned graph', () => {
    const nodeId = getState().createSubgraph('Test');
    const innerGraphId = getInnerGraphId(nodeId!);

    // Export before undo should include the inner graph
    const exportBefore = getState().exportAllGraphs();
    expect(exportBefore.graphs[innerGraphId]).toBeDefined();

    getState().undo();

    // Export after undo should NOT include the inner graph
    const exportAfter = getState().exportAllGraphs();
    expect(exportAfter.graphs[innerGraphId]).toBeUndefined();
  });

  it('after duplicate->undo, exportAllGraphs does not include orphaned graph', () => {
    // Create a subgraph node
    const origNodeId = getState().createSubgraph('Original');
    const origInnerGraphId = getInnerGraphId(origNodeId!);

    // Duplicate it
    useEditorStore.setState(s => { s.selectedIds = new Set([origNodeId!]); });
    const result = getState().duplicateSelected();
    const dupNodeId = result!.get(origNodeId!)!;
    const dupInnerGraphId = getInnerGraphId(dupNodeId);

    // Export before undo should include both
    const exportBefore = getState().exportAllGraphs();
    expect(exportBefore.graphs[origInnerGraphId]).toBeDefined();
    expect(exportBefore.graphs[dupInnerGraphId]).toBeDefined();

    getState().undo(); // undo duplicate

    // Export after undo should include only original
    const exportAfter = getState().exportAllGraphs();
    expect(exportAfter.graphs[origInnerGraphId]).toBeDefined();
    expect(exportAfter.graphs[dupInnerGraphId]).toBeUndefined();
  });
});

// ===========================================================================
// Group 6: jumpToUndo safety
// ===========================================================================

describe('jumpToUndo safety', () => {
  beforeEach(resetStore);

  it('jumpToUndo over multiple creation actions cleans up all', () => {
    // Add a baseline node to create an undo entry before any subgraph creation.
    // jumpToUndo(0) will consume the target entry + intermediates, cleaning up
    // createdInactiveGraphs on all of them. The entry at index 0 (addNode) has
    // no createdInactiveGraphs and remains as the base.
    getState().addNode('source', [0, 0, 0]);

    const id1 = getState().createSubgraph('Sub1');
    const ig1 = getInnerGraphId(id1!);

    const id2 = getState().createSubgraph('Sub2');
    const ig2 = getInnerGraphId(id2!);

    const id3 = getState().createSubgraph('Sub3');
    const ig3 = getInnerGraphId(id3!);

    expect(inactiveGraphCount()).toBe(3);

    // Jump to index 0 (the addNode entry) — undoes Sub3, Sub2, Sub1
    getState().jumpToUndo(0);

    expect(hasInactiveGraph(ig1)).toBe(false);
    expect(hasInactiveGraph(ig2)).toBe(false);
    expect(hasInactiveGraph(ig3)).toBe(false);
    expect(inactiveGraphCount()).toBe(0);
  });

  // Regression: jumpToUndo must transfer target's createdInactiveGraphs to the redo stack
  // so that subsequent redo calls re-create all inner graphs.
  it('jumpToUndo followed by full redo chain restores all graphs', () => {
    // Baseline undo entry so jumpToUndo(0) can reach before all subgraph actions
    getState().addNode('source', [0, 0, 0]);

    const id1 = getState().createSubgraph('Sub1');
    const ig1 = getInnerGraphId(id1!);

    const id2 = getState().createSubgraph('Sub2');
    const ig2 = getInnerGraphId(id2!);

    const id3 = getState().createSubgraph('Sub3');
    const ig3 = getInnerGraphId(id3!);

    expect(inactiveGraphCount()).toBe(3);

    // Jump back to index 0 — undoes all 3 subgraph creation actions
    getState().jumpToUndo(0);
    expect(inactiveGraphCount()).toBe(0);

    // Redo all the way back to the full state.
    // Each redo re-creates its own createdInactiveGraphs entry.
    getState().redo();
    getState().redo();
    getState().redo();

    // After full redo chain, all inner graphs should be restored
    expect(hasInactiveGraph(ig1)).toBe(true);
    expect(hasInactiveGraph(ig2)).toBe(true);
    expect(hasInactiveGraph(ig3)).toBe(true);
    expect(inactiveGraphCount()).toBe(3);
  });

  // Regression: jumpToUndo partial (jump to middle) then redo
  it('jumpToUndo to middle index then partial redo preserves correct graphs', () => {
    getState().addNode('source', [0, 0, 0]);

    const id1 = getState().createSubgraph('Sub1');
    const ig1 = getInnerGraphId(id1!);

    const id2 = getState().createSubgraph('Sub2');
    const ig2 = getInnerGraphId(id2!);

    const id3 = getState().createSubgraph('Sub3');
    const ig3 = getInnerGraphId(id3!);

    expect(inactiveGraphCount()).toBe(3);

    // Jump to index 2 — only undoes the last subgraph creation (Sub3)
    // Undo stack: [addNode, Sub1, Sub2, Sub3] → jump to 2 = Sub2
    getState().jumpToUndo(2);
    expect(inactiveGraphCount()).toBe(2);
    expect(hasInactiveGraph(ig1)).toBe(true);
    expect(hasInactiveGraph(ig2)).toBe(true);
    expect(hasInactiveGraph(ig3)).toBe(false);

    // Redo once to re-create Sub3
    getState().redo();
    expect(inactiveGraphCount()).toBe(3);
    expect(hasInactiveGraph(ig3)).toBe(true);
  });

  // Regression: jumpToUndo then undo further, then redo all
  it('jumpToUndo then further undo then redo chain restores all', () => {
    getState().addNode('source', [0, 0, 0]);

    const id1 = getState().createSubgraph('Sub1');
    const ig1 = getInnerGraphId(id1!);

    const id2 = getState().createSubgraph('Sub2');
    const ig2 = getInnerGraphId(id2!);

    // Jump back to index 1 — undoes Sub2
    getState().jumpToUndo(1);
    expect(inactiveGraphCount()).toBe(1);
    expect(hasInactiveGraph(ig1)).toBe(true);
    expect(hasInactiveGraph(ig2)).toBe(false);

    // Regular undo — undoes Sub1
    getState().undo();
    expect(inactiveGraphCount()).toBe(0);

    // Redo all the way back
    getState().redo();
    expect(inactiveGraphCount()).toBe(1);
    expect(hasInactiveGraph(ig1)).toBe(true);

    getState().redo();
    expect(inactiveGraphCount()).toBe(2);
    expect(hasInactiveGraph(ig1)).toBe(true);
    expect(hasInactiveGraph(ig2)).toBe(true);
  });
});

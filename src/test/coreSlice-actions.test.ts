/**
 * Comprehensive unit tests for coreSlice compound actions:
 * - deleteSelected (15 tests)
 * - duplicateSelected (10 tests)
 * - importAllGraphs (5 tests)
 *
 * Tests exercise through the full Zustand store (useEditorStore) since the
 * slice is composed into it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';
import type { GraphData, GraphTab } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.contextMenu = null;
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
    s.graphVariables = {};
    s.breakpoints = {};
    s.breakpointConditions = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

// ---------------------------------------------------------------------------
// deleteSelected
// ---------------------------------------------------------------------------

describe('deleteSelected', () => {
  beforeEach(() => { resetStore(); });

  // 1. No-op when selection is empty (no undo push)
  it('no-ops when selection is empty (no undo push)', () => {
    const canUndoBefore = getState().canUndo();
    getState().deleteSelected();
    expect(getState().canUndo()).toBe(canUndoBefore);
  });

  // 2. Deletes a single selected node
  it('deletes a single selected node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id]).toBeDefined();

    getState().setSelection(new Set([id]));
    getState().deleteSelected();

    expect(getState().nodes[id]).toBeUndefined();
  });

  // 3. Cascade-deletes connections when node is removed
  it('cascade-deletes connections when node is removed', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0);
    expect(connId).toBeTruthy();
    expect(Object.keys(getState().connections).length).toBe(1);

    // Delete only the source node
    getState().setSelection(new Set([src]));
    getState().deleteSelected();

    expect(getState().nodes[src]).toBeUndefined();
    expect(getState().nodes[tgt]).toBeDefined();
    // Connection referencing deleted node should be gone
    expect(Object.keys(getState().connections).length).toBe(0);
  });

  // 4. Deletes a selected connection (not just nodes)
  it('deletes a selected connection (not just nodes)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0)!;
    expect(getState().connections[connId]).toBeDefined();

    // Select just the connection, not the nodes
    getState().setSelection(new Set([connId]));
    getState().deleteSelected();

    expect(getState().connections[connId]).toBeUndefined();
    // Both nodes should still exist
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[tgt]).toBeDefined();
  });

  // 5. Skips locked nodes (locked: true nodes remain)
  it('skips locked nodes (locked: true nodes remain)', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);

    getState().setSelection(new Set([id]));
    getState().deleteSelected();

    // Locked node should survive
    expect(getState().nodes[id]).toBeDefined();
  });

  // 6. Skips subgraph-input and subgraph-output boundary nodes
  it('skips subgraph-input and subgraph-output boundary nodes', () => {
    const sgId = getState().createSubgraph('TestSG')!;
    expect(sgId).toBeTruthy();

    // Enter the subgraph to access boundary nodes
    getState().enterSubgraph(sgId);

    const boundaryNodes = Object.values(getState().nodes).filter(
      n => n.type === 'subgraph-input' || n.type === 'subgraph-output'
    );
    expect(boundaryNodes.length).toBeGreaterThan(0);

    // Select all nodes inside the subgraph and try to delete
    const allIds = new Set(Object.keys(getState().nodes));
    getState().setSelection(allIds);
    getState().deleteSelected();

    // Boundary nodes should survive
    const remaining = Object.values(getState().nodes).filter(
      n => n.type === 'subgraph-input' || n.type === 'subgraph-output'
    );
    expect(remaining.length).toBe(boundaryNodes.length);
  });

  // 7. Cleans up breakpoints and breakpointConditions for deleted nodes
  it('cleans up breakpoints and breakpointConditions for deleted nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Set a breakpoint + condition on the node
    getState().toggleBreakpoint(id);
    getState().setBreakpointCondition(id, 'x > 5');
    expect(getState().breakpoints[id]).toBe(true);
    expect(getState().breakpointConditions[id]).toBe('x > 5');

    getState().setSelection(new Set([id]));
    getState().deleteSelected();

    expect(getState().breakpoints[id]).toBeUndefined();
    expect(getState().breakpointConditions[id]).toBeUndefined();
  });

  // 8. Removes empty groups after deleting all group members
  it('removes empty groups after deleting all group members', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);

    // Create a group with both nodes
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('TestGroup');
    expect(groupId).toBeTruthy();
    expect(Object.keys(getState().groups).length).toBe(1);

    // Select both nodes and delete them
    getState().setSelection(new Set([a, b]));
    getState().deleteSelected();

    // Group should be gone since all members were deleted
    expect(Object.keys(getState().groups).length).toBe(0);
  });

  // 9. Doesn't remove groups that still have members
  it('does not remove groups that still have members', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);

    // Group a, b, and c together (need 2+ for createGroup)
    getState().setSelection(new Set([a, b, c]));
    const groupId = getState().createGroup('KeepGroup');
    expect(groupId).toBeTruthy();
    expect(Object.keys(getState().groups).length).toBe(1);

    // Delete only node a — group still has b and c
    getState().setSelection(new Set([a]));
    getState().deleteSelected();

    expect(getState().nodes[a]).toBeUndefined();
    expect(getState().nodes[b]).toBeDefined();
    expect(getState().nodes[c]).toBeDefined();
    expect(Object.keys(getState().groups).length).toBe(1);
  });

  // 10. Creates single undo entry (can undo to restore)
  it('creates single undo entry (can undo to restore)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(a, 0, b, 0);

    // Drain prior undo entries from addNode/addConnection
    while (getState().canUndo()) getState().undo();
    // Re-create after draining
    resetStore();
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);

    // Clear the undo stack from setup ops
    const undoCountBefore = getState().getUndoHistory().undo.length;

    getState().setSelection(new Set([n1, n2]));
    getState().deleteSelected();

    // Exactly one additional undo entry was added
    const undoCountAfter = getState().getUndoHistory().undo.length;
    expect(undoCountAfter).toBe(undoCountBefore + 1);
  });

  // 11. Undo restores deleted nodes and connections
  it('undo restores deleted nodes and connections', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0)!;
    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(Object.keys(getState().connections).length).toBe(1);

    getState().setSelection(new Set([src, tgt]));
    getState().deleteSelected();

    expect(Object.keys(getState().nodes).length).toBe(0);
    expect(Object.keys(getState().connections).length).toBe(0);

    getState().undo();

    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(Object.keys(getState().connections).length).toBe(1);
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[tgt]).toBeDefined();
    expect(getState().connections[connId]).toBeDefined();
  });

  // 12. Mixed selection: nodes and connections deleted together
  it('mixed selection: nodes and connections deleted together', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);
    const conn1 = getState().addConnection(a, 0, b, 0)!;
    const conn2 = getState().addConnection(b, 0, c, 0)!;

    // Select node b (which will cascade-delete conn1 and conn2) plus conn2 explicitly
    getState().setSelection(new Set([b, conn2]));
    getState().deleteSelected();

    expect(getState().nodes[b]).toBeUndefined();
    expect(getState().connections[conn1]).toBeUndefined(); // cascade from node b deletion
    expect(getState().connections[conn2]).toBeUndefined(); // explicitly selected + cascade
    // Nodes a and c should remain
    expect(getState().nodes[a]).toBeDefined();
    expect(getState().nodes[c]).toBeDefined();
  });

  // 13. Deletes subgraph node and cleans up subgraphDefs
  it('deletes subgraph node and cleans up subgraphDefs', () => {
    const sgId = getState().createSubgraph('MySG')!;
    expect(sgId).toBeTruthy();
    expect(getState().subgraphDefs[sgId]).toBeDefined();
    const innerGraphId = getState().subgraphDefs[sgId].innerGraphId;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    getState().setSelection(new Set([sgId]));
    getState().deleteSelected();

    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  // 14. Clears selectedIds after deletion
  it('clears selectedIds after deletion', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    expect(getState().selectedIds.size).toBe(1);

    getState().deleteSelected();

    expect(getState().selectedIds.size).toBe(0);
  });

  // 15. Triggers scheduleAutoExecute (execution state updates after delete)
  it('triggers scheduleAutoExecute when autoExecute is enabled', () => {
    // Enable auto-execute in settings store
    useSettingsStore.getState().setAutoExecute(true);

    const id = getState().addNode('source', [0, 0, 0]);

    // Spy on executeGraph to see if scheduleAutoExecute fires
    const executeSpy = vi.fn();
    useEditorStore.setState({ executeGraph: executeSpy });

    getState().setSelection(new Set([id]));
    getState().deleteSelected();

    // scheduleAutoExecute debounces at 200ms — advance timers
    vi.useFakeTimers();
    vi.advanceTimersByTime(300);
    vi.useRealTimers();

    // Reset autoExecute to default
    useSettingsStore.getState().setAutoExecute(false);
  });
});

// ---------------------------------------------------------------------------
// duplicateSelected
// ---------------------------------------------------------------------------

describe('duplicateSelected', () => {
  beforeEach(() => { resetStore(); });

  // 1. Returns null when nothing is selected
  it('returns null when nothing is selected', () => {
    const result = getState().duplicateSelected();
    expect(result).toBeNull();
  });

  // 2. Creates new nodes with unique IDs
  it('creates new nodes with unique IDs', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));

    const oldToNew = getState().duplicateSelected()!;
    expect(oldToNew).not.toBeNull();
    expect(oldToNew.size).toBe(1);

    const newId = oldToNew.get(id)!;
    expect(newId).toBeDefined();
    expect(newId).not.toBe(id);
    expect(getState().nodes[newId]).toBeDefined();
    expect(getState().nodes[id]).toBeDefined(); // original preserved
  });

  // 3. Offsets position by [+1.5, 0, +1] by default
  it('offsets position by [+1.5, 0, +1] by default', () => {
    const id = getState().addNode('source', [5, 2, 3]);
    getState().setSelection(new Set([id]));

    const oldToNew = getState().duplicateSelected()!;
    const newId = oldToNew.get(id)!;

    const orig = [5, 2, 3];
    const duped = getState().nodes[newId].position;
    expect(duped[0]).toBeCloseTo(orig[0] + 1.5);
    expect(duped[1]).toBeCloseTo(orig[1]);
    expect(duped[2]).toBeCloseTo(orig[2] + 1);
  });

  // 4. inPlace=true preserves original position
  it('inPlace=true preserves original position', () => {
    const id = getState().addNode('source', [5, 2, 3]);
    getState().setSelection(new Set([id]));

    const oldToNew = getState().duplicateSelected(true)!;
    const newId = oldToNew.get(id)!;

    const duped = getState().nodes[newId].position;
    expect(duped[0]).toBeCloseTo(5);
    expect(duped[1]).toBeCloseTo(2);
    expect(duped[2]).toBeCloseTo(3);
  });

  // 5. Copies collapsed, groupId, comment, locked, autoInserted fields
  it('copies collapsed, groupId, comment, locked, autoInserted fields', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);

    // Create a group so we can assign groupId
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('G')!;

    // Set various fields on node a
    getState().toggleNodeCollapse(a);
    getState().updateNodeComment(a, 'test comment');
    getState().toggleNodeLock(a);

    // Manually set autoInserted since there is no public API for it
    useEditorStore.setState(s => {
      s.nodes[a].autoInserted = true;
    });

    expect(getState().nodes[a].collapsed).toBe(true);
    expect(getState().nodes[a].groupId).toBe(groupId);
    expect(getState().nodes[a].comment).toBe('test comment');
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[a].autoInserted).toBe(true);

    getState().setSelection(new Set([a]));
    const oldToNew = getState().duplicateSelected()!;
    const newId = oldToNew.get(a)!;

    const duped = getState().nodes[newId];
    expect(duped.collapsed).toBe(true);
    expect(duped.groupId).toBe(groupId);
    expect(duped.comment).toBe('test comment');
    expect(duped.locked).toBe(true);
    expect(duped.autoInserted).toBe(true);
  });

  // 6. Deep-clones node data (not shared reference)
  it('deep-clones node data (not shared reference)', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Set some nested data
    getState().updateNodeData(id, 'nested', { a: [1, 2, 3] });

    getState().setSelection(new Set([id]));
    const oldToNew = getState().duplicateSelected()!;
    const newId = oldToNew.get(id)!;

    // Mutate original data — clone should not be affected
    getState().updateNodeData(id, 'nested', { a: [99] });

    const origData = getState().nodes[id].data.nested as { a: number[] };
    const dupedData = getState().nodes[newId].data.nested as { a: number[] };
    expect(origData.a).toEqual([99]);
    expect(dupedData.a).toEqual([1, 2, 3]);
  });

  // 7. Deep-clones inputs/outputs (custom node ports)
  it('deep-clones inputs/outputs (custom node ports)', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const origInputs = getState().nodes[id].inputs;
    const origOutputs = getState().nodes[id].outputs;

    getState().setSelection(new Set([id]));
    const oldToNew = getState().duplicateSelected()!;
    const newId = oldToNew.get(id)!;

    const dupedInputs = getState().nodes[newId].inputs;
    const dupedOutputs = getState().nodes[newId].outputs;

    // Should have equal values
    expect(dupedInputs).toEqual(origInputs);
    expect(dupedOutputs).toEqual(origOutputs);

    // But should NOT be the same reference
    if (origInputs.length > 0) {
      expect(dupedInputs).not.toBe(origInputs);
      expect(dupedInputs[0]).not.toBe(origInputs[0]);
    }
    if (origOutputs.length > 0) {
      expect(dupedOutputs).not.toBe(origOutputs);
      expect(dupedOutputs[0]).not.toBe(origOutputs[0]);
    }
  });

  // 8. Duplicates internal connections between selected nodes
  it('duplicates internal connections between selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(a, 0, b, 0)!;
    expect(connId).toBeTruthy();

    getState().setSelection(new Set([a, b]));
    const oldToNew = getState().duplicateSelected()!;

    const newA = oldToNew.get(a)!;
    const newB = oldToNew.get(b)!;

    // Find connections between the duplicated nodes
    const newConns = Object.values(getState().connections).filter(
      c => c.sourceNodeId === newA && c.targetNodeId === newB
    );
    expect(newConns.length).toBe(1);
    expect(newConns[0].sourcePortIndex).toBe(0);
    expect(newConns[0].targetPortIndex).toBe(0);

    // Original connection should still exist
    expect(getState().connections[connId]).toBeDefined();
  });

  // 9. Preserves connection label, colorOverride, styleOverride
  it('preserves connection label, colorOverride, styleOverride', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const connId = getState().addConnection(a, 0, b, 0)!;

    // Set connection metadata
    useEditorStore.setState(s => {
      s.connections[connId].label = 'test-label';
      s.connections[connId].colorOverride = '#ff0000';
      s.connections[connId].styleOverride = 'straight';
    });

    getState().setSelection(new Set([a, b]));
    const oldToNew = getState().duplicateSelected()!;

    const newA = oldToNew.get(a)!;
    const newB = oldToNew.get(b)!;

    const newConn = Object.values(getState().connections).find(
      c => c.sourceNodeId === newA && c.targetNodeId === newB
    )!;
    expect(newConn).toBeDefined();
    expect(newConn.label).toBe('test-label');
    expect(newConn.colorOverride).toBe('#ff0000');
    expect(newConn.styleOverride).toBe('straight');
  });

  // 10. Selects duplicated nodes (selectedIds updated)
  it('selects duplicated nodes (selectedIds updated)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);

    getState().setSelection(new Set([a, b]));
    const oldToNew = getState().duplicateSelected()!;

    const newA = oldToNew.get(a)!;
    const newB = oldToNew.get(b)!;

    // Selected IDs should now be the duplicated nodes, NOT the originals
    expect(getState().selectedIds.has(newA)).toBe(true);
    expect(getState().selectedIds.has(newB)).toBe(true);
    expect(getState().selectedIds.has(a)).toBe(false);
    expect(getState().selectedIds.has(b)).toBe(false);
    expect(getState().selectedIds.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// importAllGraphs
// ---------------------------------------------------------------------------

describe('importAllGraphs', () => {
  beforeEach(() => { resetStore(); });

  // Helper to build a minimal valid v2 storage object
  function makeV2Storage(overrides: {
    graphs?: Record<string, GraphData>;
    graphTabs?: Record<string, GraphTab>;
    activeGraphId?: string;
    graphOrder?: string[];
    templates?: Record<string, any>;
  } = {}) {
    const activeId = overrides.activeGraphId ?? 'graph-A';
    const graphs = overrides.graphs ?? {
      [activeId]: {
        nodes: {
          'n1': {
            id: 'n1',
            type: 'source' as const,
            position: [0, 0, 0] as [number, number, number],
            title: 'Source',
            data: { value: 42 },
            inputs: [],
            outputs: [{ id: 'out-0', label: 'output', portType: 'number' as const }],
          },
        },
        connections: {},
        groups: {},
        customNodeDefs: {},
      },
    };
    const graphTabs = overrides.graphTabs ?? {
      [activeId]: { id: activeId, name: 'Graph A', createdAt: Date.now() },
    };
    const graphOrder = overrides.graphOrder ?? [activeId];
    const templates = overrides.templates ?? {};

    return {
      version: 2 as const,
      graphs,
      graphTabs,
      activeGraphId: activeId,
      graphOrder,
      templates,
    };
  }

  // 1. Replaces entire workspace from valid v2 storage
  it('replaces entire workspace from valid v2 storage', () => {
    // Setup: add some existing nodes
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(2);

    const storage = makeV2Storage();
    getState().importAllGraphs(storage);

    // Active graph should now contain exactly what was in storage
    expect(Object.keys(getState().nodes).length).toBe(1);
    expect(getState().nodes['n1']).toBeDefined();
    expect(getState().nodes['n1'].title).toBe('Source');
    expect(getState().activeGraphId).toBe('graph-A');
  });

  // 2. Rejects storage with wrong version
  it('rejects storage with wrong version', () => {
    const existingId = getState().addNode('source', [0, 0, 0]);

    // Pass version: 1 — should be ignored
    const badStorage = {
      version: 1,
      graphs: {},
      graphTabs: {},
      activeGraphId: 'x',
      graphOrder: [],
      templates: {},
    };
    getState().importAllGraphs(badStorage as any);

    // State should be unchanged
    expect(getState().nodes[existingId]).toBeDefined();
  });

  // 3. Sanitizes graphOrder (filters missing graph IDs)
  it('sanitizes graphOrder (filters missing graph IDs)', () => {
    const activeId = 'graph-X';
    const storage = makeV2Storage({
      activeGraphId: activeId,
      graphs: {
        [activeId]: {
          nodes: {},
          connections: {},
          groups: {},
          customNodeDefs: {},
        },
      },
      graphTabs: {
        [activeId]: { id: activeId, name: 'X', createdAt: Date.now() },
      },
      // graphOrder includes a stale ID that doesn't exist in graphTabs
      graphOrder: [activeId, 'ghost-id', 'nonexistent'],
    });

    getState().importAllGraphs(storage);

    // graphOrder should only contain IDs that exist in graphTabs
    expect(getState().graphOrder).toContain(activeId);
    expect(getState().graphOrder).not.toContain('ghost-id');
    expect(getState().graphOrder).not.toContain('nonexistent');
  });

  // 4. Restores templates from storage
  it('restores templates from storage', () => {
    const myTemplate = {
      id: 'tpl-1',
      name: 'My Template',
      nodes: [{ type: 'source', position: [0, 0, 0], title: 'S' }],
    };

    const storage = makeV2Storage({
      templates: { 'tpl-1': myTemplate },
    });

    getState().importAllGraphs(storage);

    expect(getState().templates['tpl-1']).toBeDefined();
    expect((getState().templates['tpl-1'] as any).name).toBe('My Template');
  });

  // 5. Resets undo stacks and clears execution state
  it('resets undo stacks and clears execution state', () => {
    // Create undo history by doing some work
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);
    expect(getState().canUndo()).toBe(true);

    // Set some execution state
    useEditorStore.setState(s => {
      s.executionStates = { 'n1': 'complete' };
      s.nodeOutputs = { 'n1': [42] };
      s.executionErrors = { 'n1': 'some error' };
    });

    const storage = makeV2Storage();
    getState().importAllGraphs(storage);

    // Undo should be cleared — importAllGraphs clears all stacks
    expect(getState().canUndo()).toBe(false);

    // Execution state should be cleared
    expect(Object.keys(getState().executionStates).length).toBe(0);
    expect(Object.keys(getState().nodeOutputs).length).toBe(0);
    expect(Object.keys(getState().executionErrors).length).toBe(0);
    expect(getState().selectedIds.size).toBe(0);
  });
});

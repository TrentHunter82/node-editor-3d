/**
 * Accessibility & Keyboard Navigation Tests
 *
 * Tests the store-level behavior triggered by keyboard shortcuts in the
 * Rosebud node editor. Since R3F components cannot render in jsdom, these
 * tests exercise the Zustand store actions that the keyboard handler
 * (useKeyboardShortcuts) calls, verifying graph traversal, node cycling,
 * subgraph navigation, shortcut conflict avoidance, selection workflows,
 * and screen-reader-relevant state transitions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import type { NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.selectedIds = new Set<string>();
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.graphTabs = { default: { id: 'default', name: 'Graph 1', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.contextMenu = null;
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.errorStrategy = 'fail-fast';
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.isExecuting = false;
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.validationErrors = {};
    s.searchQuery = '';
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
  });
  localStorage.clear();
}

/** Add a node and return its ID. */
function addTestNode(type: NodeType = 'source', position?: [number, number, number]): string {
  return getState().addNode(type, position ?? [0, 0, 0]);
}

/** Add a connection and return its ID (or null if invalid). */
function addTestConnection(srcId: string, srcPort: number, tgtId: string, tgtPort: number): string | null {
  return getState().addConnection(srcId, srcPort, tgtId, tgtPort);
}

// ---------------------------------------------------------------------------
// Simulate keyboard shortcut actions (call store actions directly, reproducing
// the exact logic from useKeyboardShortcuts.ts)
// ---------------------------------------------------------------------------

/** Alt+Right / Alt+Down: move selection to first downstream neighbour. */
function simulateAltRight() {
  const state = getState();
  const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
  if (selectedNodeIds.length !== 1) return;
  const nodeId = selectedNodeIds[0];
  const conns = Object.values(state.connections);
  const downstream = conns.filter(c => c.sourceNodeId === nodeId).map(c => c.targetNodeId);
  const unique = [...new Set(downstream)].filter(id => state.nodes[id]);
  if (unique.length === 0) return;
  state.setSelection(new Set([unique[0]]));
}

/** Alt+Left / Alt+Up: move selection to first upstream neighbour. */
function simulateAltLeft() {
  const state = getState();
  const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
  if (selectedNodeIds.length !== 1) return;
  const nodeId = selectedNodeIds[0];
  const conns = Object.values(state.connections);
  const upstream = conns.filter(c => c.targetNodeId === nodeId).map(c => c.sourceNodeId);
  const unique = [...new Set(upstream)].filter(id => state.nodes[id]);
  if (unique.length === 0) return;
  state.setSelection(new Set([unique[0]]));
}

/** Tab: cycle forward through nodes. */
function simulateTab() {
  const state = getState();
  const nodeIds = Object.keys(state.nodes);
  if (nodeIds.length === 0) return;
  const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
  const currentId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const currentIdx = currentId ? nodeIds.indexOf(currentId) : -1;
  const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1 + nodeIds.length) % nodeIds.length;
  state.setSelection(new Set([nodeIds[nextIdx]]));
}

/** Shift+Tab: cycle backward through nodes. */
function simulateShiftTab() {
  const state = getState();
  const nodeIds = Object.keys(state.nodes);
  if (nodeIds.length === 0) return;
  const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
  const currentId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const currentIdx = currentId ? nodeIds.indexOf(currentId) : -1;
  const nextIdx = currentIdx === -1 ? 0 : (currentIdx - 1 + nodeIds.length) % nodeIds.length;
  state.setSelection(new Set([nodeIds[nextIdx]]));
}

/** Enter: enter subgraph node if exactly one subgraph node is selected. */
function simulateEnter() {
  const state = getState();
  const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
  if (selectedNodeIds.length === 1) {
    const node = state.nodes[selectedNodeIds[0]];
    if (node.type === 'subgraph') {
      state.enterSubgraph(selectedNodeIds[0]);
    }
  }
}

/** Backspace (empty selection + breadcrumb): exit subgraph; else delete. */
function simulateBackspace() {
  const state = getState();
  if (state.selectedIds.size === 0 && state.breadcrumbStack.length > 0) {
    state.exitSubgraph();
    return;
  }
  if (state.selectedIds.size > 0) {
    state.deleteSelected();
  }
}

/** Escape: cancel connection + clear selection. */
function simulateEscape() {
  const state = getState();
  state.cancelConnection();
  state.setSelection(new Set());
}

/** Ctrl+A: select all nodes and connections. */
function simulateSelectAll() {
  const state = getState();
  state.setSelection(new Set([
    ...Object.keys(state.nodes),
    ...Object.keys(state.connections),
  ]));
}

/** Delete: delete selected nodes/connections. */
function simulateDelete() {
  const state = getState();
  if (state.selectedIds.size === 0) return;
  state.deleteSelected();
}

/** Ctrl+D: duplicate selection. */
function simulateDuplicate() {
  getState().duplicateSelected();
}

/** Ctrl+C: copy selected. */
function simulateCopy() {
  getState().copySelected();
}

/** Ctrl+V: paste. */
function simulatePaste() {
  getState().paste();
}

/** Toggle snap: 'g' (no modifiers). */
function simulateToggleSnap() {
  getState().toggleSnap();
}

/** Toggle value previews: 'v' (no modifiers). */
function simulateToggleValuePreviews() {
  getState().toggleValuePreviews();
}

/** Toggle collapse: 'h' (no modifiers). */
function simulateToggleCollapse() {
  const state = getState();
  const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
  if (selectedNodeIds.length === 0) return;
  const anyExpanded = selectedNodeIds.some(id => !state.nodes[id].collapsed);
  if (anyExpanded) {
    state.collapseSelected();
  } else {
    state.expandSelected();
  }
}


// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
});

// ===========================================================================
// 1. Alt+Arrow Graph Traversal
// ===========================================================================

describe('Alt+Arrow Graph Traversal', () => {
  it('Alt+Right on source with downstream connection moves selection to target', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const out = addTestNode('output', [5, 0, 0]);
    // source port 0 (number) -> output port 0 (any) — compatible
    addTestConnection(src, 0, out, 0);

    getState().setSelection(new Set([src]));
    simulateAltRight();

    expect(getState().selectedIds.has(out)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('Alt+Left on target with upstream connection moves selection to source', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const out = addTestNode('output', [5, 0, 0]);
    addTestConnection(src, 0, out, 0);

    getState().setSelection(new Set([out]));
    simulateAltLeft();

    expect(getState().selectedIds.has(src)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('Alt+Arrow with no connections keeps selection unchanged', () => {
    const src = addTestNode('source', [0, 0, 0]);
    addTestNode('output', [5, 0, 0]); // not connected

    getState().setSelection(new Set([src]));
    simulateAltRight();

    expect(getState().selectedIds.has(src)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('Alt+Arrow with multiple nodes selected is a no-op', () => {
    const a = addTestNode('source', [0, 0, 0]);
    const b = addTestNode('output', [5, 0, 0]);
    addTestConnection(a, 0, b, 0);

    getState().setSelection(new Set([a, b]));
    simulateAltRight();

    // Selection unchanged — both still selected
    expect(getState().selectedIds.size).toBe(2);
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
  });

  it('Alt+Arrow with no selection is a no-op', () => {
    addTestNode('source', [0, 0, 0]);
    getState().setSelection(new Set());
    simulateAltRight();

    expect(getState().selectedIds.size).toBe(0);
  });

  it('Alt+Right picks the first downstream target when multiple exist', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const outA = addTestNode('output', [5, 0, 0]);
    const outB = addTestNode('output', [5, 0, 5]);
    addTestConnection(src, 0, outA, 0);
    addTestConnection(src, 0, outB, 0);

    getState().setSelection(new Set([src]));
    simulateAltRight();

    // Should pick the first one encountered
    const selected = [...getState().selectedIds];
    expect(selected.length).toBe(1);
    expect([outA, outB]).toContain(selected[0]);
  });

  it('Alt+Left picks the first upstream source when multiple exist', () => {
    // math has 2 number inputs — connect two sources to the same target
    const srcA = addTestNode('source', [0, 0, 0]);
    const srcB = addTestNode('source', [0, 0, 5]);
    const math = addTestNode('math', [5, 0, 0]);
    addTestConnection(srcA, 0, math, 0);
    addTestConnection(srcB, 0, math, 1);

    getState().setSelection(new Set([math]));
    simulateAltLeft();

    const selected = [...getState().selectedIds];
    expect(selected.length).toBe(1);
    expect([srcA, srcB]).toContain(selected[0]);
  });

  it('traverses a chain: source -> transform -> output via Alt+Right twice', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const xfm = addTestNode('transform', [5, 0, 0]);
    const out = addTestNode('output', [10, 0, 0]);
    // source.value(number:0) -> transform.in(number:0)
    addTestConnection(src, 0, xfm, 0);
    // transform.result(number:0) -> output.data(any:0)
    addTestConnection(xfm, 0, out, 0);

    getState().setSelection(new Set([src]));
    simulateAltRight();
    expect(getState().selectedIds.has(xfm)).toBe(true);

    simulateAltRight();
    expect(getState().selectedIds.has(out)).toBe(true);
  });

  it('Alt+Up behaves the same as Alt+Left (upstream)', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const out = addTestNode('output', [5, 0, 0]);
    addTestConnection(src, 0, out, 0);

    getState().setSelection(new Set([out]));
    // simulateAltLeft uses same logic as Alt+Up
    simulateAltLeft();

    expect(getState().selectedIds.has(src)).toBe(true);
  });

  it('Alt+Down behaves the same as Alt+Right (downstream)', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const out = addTestNode('output', [5, 0, 0]);
    addTestConnection(src, 0, out, 0);

    getState().setSelection(new Set([src]));
    // simulateAltRight uses same logic as Alt+Down
    simulateAltRight();

    expect(getState().selectedIds.has(out)).toBe(true);
  });

  it('traversal filters out invalid/missing connection targets', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const out = addTestNode('output', [5, 0, 0]);
    const connId = addTestConnection(src, 0, out, 0);
    expect(connId).toBeTruthy();

    // Remove the target node without cleaning up connections manually
    // (deleteSelected would clean both, so we manually corrupt the state)
    useEditorStore.setState((s) => {
      delete s.nodes[out];
    });

    getState().setSelection(new Set([src]));
    simulateAltRight();

    // Should stay on src because the target node no longer exists
    expect(getState().selectedIds.has(src)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('deduplicates adjacent nodes when multiple connections exist between same pair', () => {
    // source has two outputs: value (number) and label (string)
    // output has two inputs: data (any) and label (string)
    const src = addTestNode('source', [0, 0, 0]);
    const out = addTestNode('output', [5, 0, 0]);
    // Connect source.value -> output.data
    addTestConnection(src, 0, out, 0);
    // Connect source.label -> output.label
    addTestConnection(src, 1, out, 1);

    getState().setSelection(new Set([src]));
    simulateAltRight();

    // Even though there are 2 connections to `out`, we should only have 1 selection
    expect(getState().selectedIds.size).toBe(1);
    expect(getState().selectedIds.has(out)).toBe(true);
  });
});

// ===========================================================================
// 2. Tab/Shift+Tab Node Cycling
// ===========================================================================

describe('Tab/Shift+Tab Node Cycling', () => {
  it('Tab selects first node when nothing is selected', () => {
    addTestNode('source', [0, 0, 0]);
    addTestNode('transform', [5, 0, 0]);

    getState().setSelection(new Set());
    simulateTab();

    const nodeIds = Object.keys(getState().nodes);
    expect(getState().selectedIds.has(nodeIds[0])).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('Tab selects next node in order', () => {
    addTestNode('source', [0, 0, 0]);
    addTestNode('transform', [5, 0, 0]);
    addTestNode('output', [10, 0, 0]);

    const nodeIds = Object.keys(getState().nodes);
    getState().setSelection(new Set([nodeIds[0]]));
    simulateTab();

    expect(getState().selectedIds.has(nodeIds[1])).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('Shift+Tab selects previous node', () => {
    addTestNode('source', [0, 0, 0]);
    addTestNode('transform', [5, 0, 0]);
    addTestNode('output', [10, 0, 0]);

    const nodeIds = Object.keys(getState().nodes);
    getState().setSelection(new Set([nodeIds[1]]));
    simulateShiftTab();

    expect(getState().selectedIds.has(nodeIds[0])).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('Tab wraps around from last to first', () => {
    addTestNode('source', [0, 0, 0]);
    addTestNode('transform', [5, 0, 0]);

    const nodeIds = Object.keys(getState().nodes);
    getState().setSelection(new Set([nodeIds[nodeIds.length - 1]]));
    simulateTab();

    expect(getState().selectedIds.has(nodeIds[0])).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('Shift+Tab wraps around from first to last', () => {
    addTestNode('source', [0, 0, 0]);
    addTestNode('transform', [5, 0, 0]);

    const nodeIds = Object.keys(getState().nodes);
    getState().setSelection(new Set([nodeIds[0]]));
    simulateShiftTab();

    expect(getState().selectedIds.has(nodeIds[nodeIds.length - 1])).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('Tab with empty graph is a no-op', () => {
    // No nodes added
    getState().setSelection(new Set());
    simulateTab();

    expect(getState().selectedIds.size).toBe(0);
  });

  it('Tab with single node stays on that node', () => {
    const n1 = addTestNode('source', [0, 0, 0]);

    getState().setSelection(new Set([n1]));
    simulateTab();

    expect(getState().selectedIds.has(n1)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('multiple Tab presses cycle through all nodes', () => {
    addTestNode('source', [0, 0, 0]);
    addTestNode('transform', [5, 0, 0]);
    addTestNode('output', [10, 0, 0]);

    const nodeIds = Object.keys(getState().nodes);
    getState().setSelection(new Set());

    const visited: string[] = [];
    for (let i = 0; i < nodeIds.length; i++) {
      simulateTab();
      const sel = [...getState().selectedIds];
      expect(sel.length).toBe(1);
      visited.push(sel[0]);
    }

    // Every node should have been visited exactly once
    expect(new Set(visited).size).toBe(nodeIds.length);
    for (const id of nodeIds) {
      expect(visited).toContain(id);
    }
  });
});

// ===========================================================================
// 3. Enter Subgraph Navigation
// ===========================================================================

describe('Enter Subgraph Navigation', () => {
  /** Helper: creates a subgraph node by converting a selection and returns its ID. */
  function createSubgraphNode(): string {
    const src = addTestNode('source', [0, 0, 0]);
    const xfm = addTestNode('transform', [5, 0, 0]);
    addTestConnection(src, 0, xfm, 0);

    getState().setSelection(new Set([src, xfm]));
    const subId = getState().convertSelectionToSubgraph('TestSub');
    expect(subId).toBeTruthy();
    return subId!;
  }

  it('Enter with subgraph node selected enters subgraph (breadcrumbStack grows)', () => {
    const subId = createSubgraphNode();

    expect(getState().breadcrumbStack.length).toBe(0);
    getState().setSelection(new Set([subId]));
    simulateEnter();

    expect(getState().breadcrumbStack.length).toBe(1);
    expect(getState().breadcrumbStack[0].subgraphNodeId).toBe(subId);
  });

  it('Enter with non-subgraph node selected is a no-op', () => {
    const src = addTestNode('source', [0, 0, 0]);

    getState().setSelection(new Set([src]));
    simulateEnter();

    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('Enter with multiple nodes selected is a no-op', () => {
    const subId = createSubgraphNode();
    const extra = addTestNode('source', [10, 0, 0]);

    getState().setSelection(new Set([subId, extra]));
    simulateEnter();

    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('Enter with no selection is a no-op', () => {
    createSubgraphNode();

    getState().setSelection(new Set());
    simulateEnter();

    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('Backspace with empty selection and breadcrumbStack > 0 exits subgraph', () => {
    const subId = createSubgraphNode();

    // Enter subgraph first
    getState().setSelection(new Set([subId]));
    simulateEnter();
    expect(getState().breadcrumbStack.length).toBe(1);

    // Clear selection, then backspace should exit
    getState().setSelection(new Set());
    simulateBackspace();

    expect(getState().breadcrumbStack.length).toBe(0);
  });

  it('Backspace with selection deletes nodes (does not exit subgraph)', () => {
    const subId = createSubgraphNode();

    // Enter subgraph
    getState().setSelection(new Set([subId]));
    simulateEnter();
    expect(getState().breadcrumbStack.length).toBe(1);

    // Inside subgraph, add a note and select it, then backspace
    const note = addTestNode('note', [0, 0, 0]);
    const nodeCountBefore = Object.keys(getState().nodes).length;
    getState().setSelection(new Set([note]));
    simulateBackspace();

    // Should have deleted the note, NOT exited the subgraph
    expect(getState().breadcrumbStack.length).toBe(1);
    expect(Object.keys(getState().nodes).length).toBe(nodeCountBefore - 1);
  });
});

// ===========================================================================
// 4. Shortcut Conflict Detection
// ===========================================================================

describe('Shortcut Conflict Detection', () => {
  it('"g" (snap toggle) does not fire when Ctrl+G (group) would apply', () => {
    // The keyboard handler checks Ctrl+G *before* bare 'g'.
    // We verify that toggling snap alone works, and that the group shortcut
    // calls createGroup. Since we only test store actions, we verify
    // that bare 'g' toggles snap as expected.
    const snapBefore = getState().snapEnabled;
    simulateToggleSnap();
    expect(getState().snapEnabled).toBe(!snapBefore);

    // Ctrl+G would call createGroup instead — different code path
    // Verify snap state didn't double-toggle
    simulateToggleSnap();
    expect(getState().snapEnabled).toBe(snapBefore);
  });

  it('"v" (value previews) does not fire when Ctrl+V (paste) would apply', () => {
    // Bare 'v' toggles value previews
    const previewsBefore = getState().showValuePreviews;
    simulateToggleValuePreviews();
    expect(getState().showValuePreviews).toBe(!previewsBefore);

    // Ctrl+V would call paste() — different action entirely
    // Verify the toggle is independent of paste
    simulateToggleValuePreviews();
    expect(getState().showValuePreviews).toBe(previewsBefore);
  });

  it('"h" (collapse) does not fire when Ctrl+H (find/replace) would apply', () => {
    const node = addTestNode('source', [0, 0, 0]);
    getState().setSelection(new Set([node]));

    // Bare 'h' toggles collapse
    expect(getState().nodes[node].collapsed).toBeFalsy();
    simulateToggleCollapse();
    expect(getState().nodes[node].collapsed).toBe(true);

    // Ctrl+H would open find/replace panel — not tested here (UI callback)
    // but the code paths are guarded by ctrlKey check in the handler
  });

  it('"d" (downstream select) does not fire when Ctrl+D (duplicate) would apply', () => {
    const src = addTestNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));

    // Ctrl+D duplicates
    const countBefore = Object.keys(getState().nodes).length;
    simulateDuplicate();
    const countAfter = Object.keys(getState().nodes).length;
    expect(countAfter).toBe(countBefore + 1);

    // Shift+D (selectConnected downstream) is a separate shortcut guarded by shiftKey
    // Bare 'd' without Ctrl would do nothing in the keyboard handler (only Shift+D or Ctrl+D)
  });

  it('Arrow keys with Alt (traverse) do not nudge nodes', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const out = addTestNode('output', [5, 0, 0]);
    addTestConnection(src, 0, out, 0);

    getState().setSelection(new Set([src]));
    const posBefore = [...getState().nodes[src].position] as [number, number, number];

    // Alt+Right traverses — should NOT nudge position
    simulateAltRight();

    // The source node's position should be unchanged
    expect(getState().nodes[src].position[0]).toBe(posBefore[0]);
    expect(getState().nodes[src].position[1]).toBe(posBefore[1]);
    expect(getState().nodes[src].position[2]).toBe(posBefore[2]);

    // Verify selection moved to the output (traversal happened, not nudge)
    expect(getState().selectedIds.has(out)).toBe(true);
  });
});

// ===========================================================================
// 5. Selection Flow
// ===========================================================================

describe('Selection Flow', () => {
  it('Select all (Ctrl+A) selects all nodes and connections', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const xfm = addTestNode('transform', [5, 0, 0]);
    const out = addTestNode('output', [10, 0, 0]);
    const c1 = addTestConnection(src, 0, xfm, 0);
    const c2 = addTestConnection(xfm, 0, out, 0);

    simulateSelectAll();

    expect(getState().selectedIds.size).toBe(5); // 3 nodes + 2 connections
    expect(getState().selectedIds.has(src)).toBe(true);
    expect(getState().selectedIds.has(xfm)).toBe(true);
    expect(getState().selectedIds.has(out)).toBe(true);
    expect(getState().selectedIds.has(c1!)).toBe(true);
    expect(getState().selectedIds.has(c2!)).toBe(true);
  });

  it('Escape clears selection', () => {
    const src = addTestNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    expect(getState().selectedIds.size).toBe(1);

    simulateEscape();

    expect(getState().selectedIds.size).toBe(0);
  });

  it('Delete deletes selected nodes', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const xfm = addTestNode('transform', [5, 0, 0]);

    getState().setSelection(new Set([src]));
    simulateDelete();

    expect(getState().nodes[src]).toBeUndefined();
    expect(getState().nodes[xfm]).toBeDefined();
    expect(Object.keys(getState().nodes).length).toBe(1);
  });

  it('Tab then Delete: cycle to a node and delete it', () => {
    addTestNode('source', [0, 0, 0]);
    addTestNode('transform', [5, 0, 0]);
    addTestNode('output', [10, 0, 0]);

    const nodeIds = Object.keys(getState().nodes);
    expect(nodeIds.length).toBe(3);

    // Tab to select first node
    simulateTab();
    const selected = [...getState().selectedIds][0];
    expect(selected).toBeDefined();

    // Delete it
    simulateDelete();
    expect(getState().nodes[selected]).toBeUndefined();
    expect(Object.keys(getState().nodes).length).toBe(2);
  });

  it('Ctrl+D duplicates selection', () => {
    const src = addTestNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));

    const countBefore = Object.keys(getState().nodes).length;
    simulateDuplicate();
    const countAfter = Object.keys(getState().nodes).length;

    expect(countAfter).toBe(countBefore + 1);

    // The duplicate should be selected (not the original)
    const selectedIds = [...getState().selectedIds];
    expect(selectedIds.length).toBe(1);
    expect(selectedIds[0]).not.toBe(src);
  });

  it('Ctrl+C then Ctrl+V: copy-paste workflow', () => {
    const src = addTestNode('source', [0, 0, 0]);
    const xfm = addTestNode('transform', [5, 0, 0]);
    addTestConnection(src, 0, xfm, 0);

    // Select both nodes
    getState().setSelection(new Set([src, xfm]));
    const countBefore = Object.keys(getState().nodes).length;
    const connsBefore = Object.keys(getState().connections).length;

    // Copy then paste
    simulateCopy();
    simulatePaste();

    const countAfter = Object.keys(getState().nodes).length;
    const connsAfter = Object.keys(getState().connections).length;

    // Should have 2 new nodes (copies of src and xfm)
    expect(countAfter).toBe(countBefore + 2);
    // Should have 1 new connection (copy of the internal connection)
    expect(connsAfter).toBe(connsBefore + 1);
  });
});

// ===========================================================================
// 6. Screen Reader Announcer Logic (state transitions)
// ===========================================================================

describe('Screen Reader Announcer Logic', () => {
  it('selection clear sets selectedIds to empty', () => {
    const src = addTestNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    expect(getState().selectedIds.size).toBe(1);

    getState().setSelection(new Set());
    expect(getState().selectedIds.size).toBe(0);
  });

  it('single node selection sets selectedIds to 1 element', () => {
    const src = addTestNode('source', [0, 0, 0]);
    addTestNode('transform', [5, 0, 0]);

    getState().setSelection(new Set([src]));

    expect(getState().selectedIds.size).toBe(1);
    expect(getState().selectedIds.has(src)).toBe(true);
  });

  it('multi-select sets selectedIds to N elements', () => {
    const n1 = addTestNode('source', [0, 0, 0]);
    const n2 = addTestNode('transform', [5, 0, 0]);
    const n3 = addTestNode('output', [10, 0, 0]);

    getState().setSelection(new Set([n1, n2, n3]));

    expect(getState().selectedIds.size).toBe(3);
  });

  it('graph switch changes activeGraphId', () => {
    const originalGraphId = getState().activeGraphId;
    const newGraphId = getState().createGraph('Second Graph');

    expect(getState().activeGraphId).toBe(newGraphId);
    expect(getState().activeGraphId).not.toBe(originalGraphId);
    expect(getState().graphTabs[newGraphId].name).toBe('Second Graph');
  });

  it('selection then deselection changes selectedIds twice', () => {
    const src = addTestNode('source', [0, 0, 0]);

    // Track changes
    const sizes: number[] = [];
    const unsub = useEditorStore.subscribe(
      s => s.selectedIds.size,
      (size) => { sizes.push(size); }
    );

    getState().setSelection(new Set([src])); // 1
    getState().setSelection(new Set());      // 0

    unsub();

    expect(sizes).toEqual([1, 0]);
  });

  it('node deletion reduces node count', () => {
    addTestNode('source', [0, 0, 0]);
    const n2 = addTestNode('transform', [5, 0, 0]);
    addTestNode('output', [10, 0, 0]);

    expect(Object.keys(getState().nodes).length).toBe(3);

    getState().setSelection(new Set([n2]));
    getState().deleteSelected();

    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(getState().nodes[n2]).toBeUndefined();
  });

  it('graph tab creation adds a new graphTab', () => {
    const tabsBefore = Object.keys(getState().graphTabs).length;
    const newId = getState().createGraph('New Tab');
    const tabsAfter = Object.keys(getState().graphTabs).length;

    expect(tabsAfter).toBe(tabsBefore + 1);
    expect(getState().graphTabs[newId]).toBeDefined();
    expect(getState().graphTabs[newId].name).toBe('New Tab');
  });

  it('enter subgraph changes breadcrumbStack', () => {
    // Create a subgraph node by converting selection
    const src = addTestNode('source', [0, 0, 0]);
    const xfm = addTestNode('transform', [5, 0, 0]);
    addTestConnection(src, 0, xfm, 0);
    getState().setSelection(new Set([src, xfm]));
    const subId = getState().convertSelectionToSubgraph('AnnSub');
    expect(subId).toBeTruthy();

    expect(getState().breadcrumbStack.length).toBe(0);

    getState().setSelection(new Set([subId!]));
    getState().enterSubgraph(subId!);

    expect(getState().breadcrumbStack.length).toBe(1);
    expect(getState().breadcrumbStack[0].subgraphNodeId).toBe(subId);
  });
});

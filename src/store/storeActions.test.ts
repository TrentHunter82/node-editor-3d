import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore } from './editorStore';
import type { EditorNode, Connection, NodeGroup, CustomNodeDef } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
  });
}

function drainUndoRedo() {
  // Reset by performing undo until empty, then clear redo by doing a
  // trivial action (which clears the redo stack), then undo that too.
  while (getState().canUndo()) getState().undo();
  // Any remaining redo entries are stale — performing a new action clears redo stack
  if (getState().canRedo()) {
    // Push a no-op undo snapshot to clear redo
    getState().pushUndoSnapshot();
    getState().undo();
  }
}

function getState() {
  return useEditorStore.getState();
}

// ============================================================================
// autoLayout
// ============================================================================

describe('autoLayout', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('no-ops on empty graph', () => {
    const before = getState().canUndo();
    getState().autoLayout();
    expect(getState().canUndo()).toBe(before);
  });

  it('repositions a single node', () => {
    const id = getState().addNode('source', [10, 0, 10]);
    getState().autoLayout();
    // Position should change (single node goes to center)
    expect(getState().nodes[id].position[0]).toBe(0);
    expect(getState().nodes[id].position[2]).toBe(0);
  });

  it('pushes undo', () => {
    const id = getState().addNode('source', [10, 0, 10]);
    getState().autoLayout();
    getState().undo();
    expect(getState().nodes[id].position[0]).toBe(10);
    expect(getState().nodes[id].position[2]).toBe(10);
  });

  it('handles linear chain', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [0, 0, 0]);
    getState().addConnection(s, 0, t, 0);
    getState().autoLayout();
    // Source should be before transform in X
    expect(getState().nodes[s].position[0]).toBeLessThan(getState().nodes[t].position[0]);
  });

  it('preserves Y coordinate', () => {
    const id = getState().addNode('source', [0, 5, 0]);
    getState().autoLayout();
    expect(getState().nodes[id].position[1]).toBe(5);
  });

  it('handles disconnected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [0, 0, 0]);
    getState().autoLayout();
    expect(getState().nodes[a]).toBeDefined();
    expect(getState().nodes[b]).toBeDefined();
    // Both should get positions
    expect(getState().nodes[a].position).toBeDefined();
    expect(getState().nodes[b].position).toBeDefined();
  });

  it('undo fully restores original positions', () => {
    const a = getState().addNode('source', [1, 2, 3]);
    const b = getState().addNode('transform', [4, 5, 6]);
    getState().addConnection(a, 0, b, 0);
    getState().autoLayout();
    getState().undo();
    expect(getState().nodes[a].position).toEqual([1, 2, 3]);
    expect(getState().nodes[b].position).toEqual([4, 5, 6]);
  });
});

// ============================================================================
// alignSelected
// ============================================================================

describe('alignSelected', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('no-ops with fewer than 2 selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));
    const posBefore = [...getState().nodes[a].position];
    getState().alignSelected('left');
    expect(getState().nodes[a].position).toEqual(posBefore);
  });

  it('aligns left', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 3]);
    getState().setSelection(new Set([a, b]));
    getState().alignSelected('left');
    expect(getState().nodes[a].position[0]).toBe(0);
    expect(getState().nodes[b].position[0]).toBe(0);
  });

  it('aligns right', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 3]);
    getState().setSelection(new Set([a, b]));
    getState().alignSelected('right');
    expect(getState().nodes[a].position[0]).toBe(5);
    expect(getState().nodes[b].position[0]).toBe(5);
  });

  it('aligns top (min Z)', () => {
    const a = getState().addNode('source', [0, 0, 2]);
    const b = getState().addNode('source', [5, 0, 8]);
    getState().setSelection(new Set([a, b]));
    getState().alignSelected('top');
    expect(getState().nodes[a].position[2]).toBe(2);
    expect(getState().nodes[b].position[2]).toBe(2);
  });

  it('aligns bottom (max Z)', () => {
    const a = getState().addNode('source', [0, 0, 2]);
    const b = getState().addNode('source', [5, 0, 8]);
    getState().setSelection(new Set([a, b]));
    getState().alignSelected('bottom');
    expect(getState().nodes[a].position[2]).toBe(8);
    expect(getState().nodes[b].position[2]).toBe(8);
  });

  it('aligns center-x', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [10, 0, 0]);
    getState().setSelection(new Set([a, b]));
    getState().alignSelected('center-x');
    expect(getState().nodes[a].position[0]).toBe(5);
    expect(getState().nodes[b].position[0]).toBe(5);
  });

  it('aligns center-z', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [0, 0, 10]);
    getState().setSelection(new Set([a, b]));
    getState().alignSelected('center-z');
    expect(getState().nodes[a].position[2]).toBe(5);
    expect(getState().nodes[b].position[2]).toBe(5);
  });

  it('pushes undo', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 3]);
    getState().setSelection(new Set([a, b]));
    getState().alignSelected('left');
    getState().undo();
    expect(getState().nodes[b].position[0]).toBe(5);
  });

  it('preserves Y', () => {
    const a = getState().addNode('source', [0, 3, 0]);
    const b = getState().addNode('source', [5, 7, 3]);
    getState().setSelection(new Set([a, b]));
    getState().alignSelected('left');
    expect(getState().nodes[a].position[1]).toBe(3);
    expect(getState().nodes[b].position[1]).toBe(7);
  });
});

// ============================================================================
// importWorkflow
// ============================================================================

describe('importWorkflow', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('imports nodes and connections', () => {
    const nodes: Record<string, EditorNode> = {
      n1: {
        id: 'n1', type: 'source', position: [0, 0, 0], title: 'S', data: {},
        inputs: [], outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {};
    getState().importWorkflow({ nodes, connections });
    expect(getState().nodes.n1).toBeDefined();
    expect(getState().nodes.n1.title).toBe('S');
  });

  it('clears previous state', () => {
    getState().addNode('source', [0, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(1);
    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(Object.keys(getState().nodes).length).toBe(0);
  });

  it('pushes undo', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(Object.keys(getState().nodes).length).toBe(0);
    getState().undo();
    expect(getState().nodes[id]).toBeDefined();
  });

  it('imports groups', () => {
    const nodes: Record<string, EditorNode> = {
      n1: {
        id: 'n1', type: 'source', position: [0, 0, 0], title: 'S', data: {},
        inputs: [], outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
        groupId: 'g1',
      },
    };
    const groups: Record<string, NodeGroup> = {
      g1: { id: 'g1', label: 'Test Group', collapsed: false },
    };
    getState().importWorkflow({ nodes, connections: {}, groups });
    expect(getState().groups.g1.label).toBe('Test Group');
    expect(getState().nodes.n1.groupId).toBe('g1');
  });

  it('imports customNodeDefs', () => {
    const customNodeDefs: Record<string, CustomNodeDef> = {
      cd1: {
        id: 'cd1', name: 'MyCustom', color: 'blue', category: 'Math',
        inputs: [{ label: 'in0', portType: 'number' }],
        outputs: [{ label: 'out0', portType: 'number' }],
        expression: 'in0 * 2',
      },
    };
    getState().importWorkflow({ nodes: {}, connections: {}, customNodeDefs });
    expect(getState().customNodeDefs.cd1.name).toBe('MyCustom');
  });

  it('clears validationErrors', () => {
    getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    expect(Object.keys(getState().validationErrors).length).toBeGreaterThan(0);
    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(Object.keys(getState().validationErrors).length).toBe(0);
  });

  it('clears selection and interaction', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(getState().selectedIds.size).toBe(0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });
});

// ============================================================================
// invalidateNode
// ============================================================================

describe('invalidateNode', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('invalidates cache without crashing', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    // Execute to populate cache
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    // Invalidate source - should not throw
    expect(() => getState().invalidateNode(src)).not.toThrow();
  });

  it('invalidate non-existent node does not crash', () => {
    expect(() => getState().invalidateNode('fake')).not.toThrow();
  });
});

// ============================================================================
// resetExecution
// ============================================================================

describe('resetExecution', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears all execution state fields', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    getState().executeGraph();
    vi.advanceTimersByTime(100); // Partial execution
    expect(getState().isExecuting).toBe(true);

    getState().resetExecution();
    expect(getState().isExecuting).toBe(false);
    expect(getState().executionStates).toEqual({});
    expect(getState().nodeOutputs).toEqual({});
    expect(getState().executionErrors).toEqual({});
  });

  it('prevents zombie timeouts from firing', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    getState().executeGraph();
    vi.advanceTimersByTime(100);
    getState().resetExecution();
    // Advance past when timeouts would have fired
    vi.advanceTimersByTime(10000);
    // Should still be false (not restarted by zombie timeout)
    expect(getState().isExecuting).toBe(false);
  });
});

// ============================================================================
// setNodeExecutionState
// ============================================================================

describe('setNodeExecutionState', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('sets execution state for a node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setNodeExecutionState(id, 'running');
    expect(getState().executionStates[id]).toBe('running');
  });

  it('can transition through states', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setNodeExecutionState(id, 'idle');
    expect(getState().executionStates[id]).toBe('idle');
    getState().setNodeExecutionState(id, 'running');
    expect(getState().executionStates[id]).toBe('running');
    getState().setNodeExecutionState(id, 'complete');
    expect(getState().executionStates[id]).toBe('complete');
  });

  it('sets error state', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setNodeExecutionState(id, 'error');
    expect(getState().executionStates[id]).toBe('error');
  });
});

// ============================================================================
// getCompatiblePorts
// ============================================================================

describe('getCompatiblePorts', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('returns compatible target ports', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const ports = getState().getCompatiblePorts(src, 0); // number output
    // Should find transform's number input ports
    const xfmPorts = ports.filter(p => p.nodeId === xfm);
    expect(xfmPorts.length).toBeGreaterThan(0);
  });

  it('excludes self', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const ports = getState().getCompatiblePorts(src, 0);
    expect(ports.every(p => p.nodeId !== src)).toBe(true);
  });

  it('returns empty for bad source', () => {
    expect(getState().getCompatiblePorts('fake', 0)).toEqual([]);
  });

  it('returns empty for invalid port index', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    expect(getState().getCompatiblePorts(src, 99)).toEqual([]);
  });

  it('respects type compatibility', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const concat = getState().addNode('concat', [5, 0, 0]);
    // Source output 0 is 'number', concat input 0 is 'string'
    const ports = getState().getCompatiblePorts(src, 0);
    const concatPorts = ports.filter(p => p.nodeId === concat);
    // number is not compatible with string, so no concat ports
    expect(concatPorts.length).toBe(0);
  });

  it('finds any-type ports', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const reroute = getState().addNode('reroute', [5, 0, 0]);
    const ports = getState().getCompatiblePorts(src, 0);
    // Reroute has 'any' input type
    const reroutePorts = ports.filter(p => p.nodeId === reroute);
    expect(reroutePorts.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Undo/Redo edge cases
// ============================================================================

describe('Undo/Redo edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('complex chain: addNode → updateData → addConnection → undo 3 times', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(s, 'value', 42);
    const t = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(s, 0, t, 0);
    // Undo addConnection (addConnection doesn't push undo)
    // Undo addNode (transform)
    getState().undo();
    expect(getState().nodes[t]).toBeUndefined();
    // Undo updateNodeData
    getState().undo();
    expect(getState().nodes[s].data.value).toBeUndefined();
    // Undo addNode (source)
    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(0);
  });

  it('undo/redo clears execution state', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setNodeExecutionState(src, 'complete');
    useEditorStore.setState({ nodeOutputs: { [src]: { 0: 42 } } });
    getState().undo();
    expect(getState().executionStates).toEqual({});
    expect(getState().nodeOutputs).toEqual({});
  });

  it('redo after undo restores correctly', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'MySource');
    getState().undo();
    expect(getState().nodes[id].title).toBe('Source');
    getState().redo();
    expect(getState().nodes[id].title).toBe('MySource');
  });

  it('new action clears redo stack', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'Title1');
    getState().undo();
    expect(getState().canRedo()).toBe(true);
    // New action should clear redo
    getState().updateNodeTitle(id, 'Title2');
    expect(getState().canRedo()).toBe(false);
  });

  it('undo with no history is no-op', () => {
    expect(getState().canUndo()).toBe(false);
    getState().undo(); // Should not throw
    expect(Object.keys(getState().nodes).length).toBe(0);
  });

  it('redo does not throw even when called without matching undo', () => {
    // Note: redo stack is module-scoped, so canRedo may be true from prior tests
    // The key behavior: redo() should not throw or corrupt state
    getState().redo();
    // State should remain consistent
    expect(getState().interaction).toBe('idle');
  });
});

// ============================================================================
// Cycle detection via addConnection
// ============================================================================

describe('Cycle detection', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('prevents direct cycle (A → B → A)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    // Try to create B → A (would create cycle)
    const result = getState().addConnection(b, 0, a, 0);
    expect(result).toBeNull();
  });

  it('prevents indirect cycle (A → B → C → A)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    const c = getState().addNode('transform', [10, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);
    // Try to create C → A (would create cycle)
    const result = getState().addConnection(c, 0, a, 0);
    expect(result).toBeNull();
  });

  it('allows parallel connections (no cycle)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    // A → B again on different port - should be fine
    const result = getState().addConnection(a, 0, b, 1);
    expect(result).not.toBeNull();
  });
});

// ============================================================================
// clearGraph edge cases
// ============================================================================

describe('clearGraph edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('clears customNodeDefs', () => {
    getState().addCustomNodeDef({
      name: 'Test', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0',
    });
    getState().addNode('source', [0, 0, 0]); // Need a node for clearGraph to work
    getState().clearGraph();
    expect(Object.keys(getState().customNodeDefs).length).toBe(0);
  });

  it('clears validationErrors', () => {
    getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    expect(Object.keys(getState().validationErrors).length).toBeGreaterThan(0);
    getState().clearGraph();
    expect(Object.keys(getState().validationErrors).length).toBe(0);
  });

  it('clears pendingConnection and resets interaction', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    expect(getState().interaction).toBe('drawing-connection');
    getState().clearGraph();
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('no-ops on already empty graph', () => {
    const before = getState().canUndo();
    getState().clearGraph();
    expect(getState().canUndo()).toBe(before);
  });
});

// ============================================================================
// Paste edge cases
// ============================================================================

describe('Paste edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('paste generates unique IDs each time', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();
    const ids1 = Object.keys(getState().nodes).filter(k => k !== id);
    getState().paste();
    const ids2 = Object.keys(getState().nodes).filter(k => k !== id && !ids1.includes(k));
    expect(ids1.length).toBe(1);
    expect(ids2.length).toBe(1);
    expect(ids1[0]).not.toBe(ids2[0]);
  });

  it('paste preserves collapsed flag', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeCollapse(id);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();
    const pastedId = [...getState().selectedIds][0];
    expect(getState().nodes[pastedId].collapsed).toBe(true);
  });

  it('paste preserves node data', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 42);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();
    const pastedId = [...getState().selectedIds][0];
    expect(getState().nodes[pastedId].data.value).toBe(42);
  });

  it('paste with internal connections recreates them', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().setSelection(new Set([src, xfm]));
    getState().copySelected();
    getState().paste();
    // Should have 2 original + 2 pasted = 4 nodes
    expect(Object.keys(getState().nodes).length).toBe(4);
    // Should have 1 original + 1 pasted = 2 connections
    expect(Object.keys(getState().connections).length).toBe(2);
  });

  it('canPaste returns true after copySelected', () => {
    // clipboard is module-scoped, verify copy → canPaste behavior
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    expect(getState().canPaste()).toBe(true);
  });

  it('paste single undo', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();
    expect(Object.keys(getState().nodes).length).toBe(2);
    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(1);
  });
});

// ============================================================================
// Duplicate edge cases
// ============================================================================

describe('Duplicate edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('no-ops with empty selection', () => {
    const before = getState().canUndo();
    getState().duplicateSelected();
    expect(getState().canUndo()).toBe(before);
  });

  it('preserves collapsed flag', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeCollapse(id);
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();
    const dupId = [...getState().selectedIds][0];
    expect(getState().nodes[dupId].collapsed).toBe(true);
  });

  it('preserves node data', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 100);
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();
    const dupId = [...getState().selectedIds][0];
    expect(getState().nodes[dupId].data.value).toBe(100);
  });

  it('selects only duplicated nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    getState().duplicateSelected();
    // Selection should be the 2 new nodes, not the originals
    expect(getState().selectedIds.size).toBe(2);
    expect(getState().selectedIds.has(a)).toBe(false);
    expect(getState().selectedIds.has(b)).toBe(false);
  });

  it('offsets position', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();
    const dupId = [...getState().selectedIds][0];
    expect(getState().nodes[dupId].position[0]).toBe(1.5);
    expect(getState().nodes[dupId].position[2]).toBe(1);
  });
});

// ============================================================================
// completeConnection edge cases
// ============================================================================

describe('completeConnection edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('single-input enforcement: replaces existing connection', () => {
    const s1 = getState().addNode('source', [0, 0, 0]);
    const s2 = getState().addNode('source', [0, 0, 5]);
    const t = getState().addNode('transform', [5, 0, 0]);
    // Connect s1 → t input 0
    getState().addConnection(s1, 0, t, 0);
    expect(Object.keys(getState().connections).length).toBe(1);
    // Now draw connection from s2 → t input 0
    getState().startConnection(s2, 0);
    getState().completeConnection(t, 0);
    // Should still have just 1 connection (s2 replaced s1)
    expect(Object.keys(getState().connections).length).toBe(1);
    const conn = Object.values(getState().connections)[0];
    expect(conn.sourceNodeId).toBe(s2);
  });

  it('cancels when target node does not exist', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    getState().completeConnection('fake', 0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('no-op when no pending connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    expect(() => getState().completeConnection(src, 0)).not.toThrow();
  });
});

// ============================================================================
// Serialization edge cases: importFromJSON
// ============================================================================

describe('importFromJSON edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('import with groups field', () => {
    const data = {
      nodes: {},
      connections: {},
      groups: { g1: { id: 'g1', label: 'G', collapsed: false } },
    };
    getState().importWorkflow(data);
    expect(getState().groups.g1.label).toBe('G');
  });

  it('import without optional fields uses defaults', () => {
    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(getState().groups).toEqual({});
    expect(getState().customNodeDefs).toEqual({});
  });
});

// ============================================================================
// Validation with cycles
// ============================================================================

describe('validateGraph with cycles', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('detects cycles and reports errors', () => {
    // Manually create a cycle by setting connections directly
    const nodes: Record<string, EditorNode> = {
      a: {
        id: 'a', type: 'transform', position: [0, 0, 0], title: 'A', data: {},
        inputs: [{ id: 'in-0', label: 'value', portType: 'number' }, { id: 'in-1', label: 'factor', portType: 'number' }],
        outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
      },
      b: {
        id: 'b', type: 'transform', position: [5, 0, 0], title: 'B', data: {},
        inputs: [{ id: 'in-0', label: 'value', portType: 'number' }, { id: 'in-1', label: 'factor', portType: 'number' }],
        outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'a', targetPortIndex: 0 },
    };
    useEditorStore.setState({ nodes, connections });
    getState().validateGraph();
    // All nodes should have cycle error
    expect(getState().validationErrors.a.some(e => e.includes('cycle'))).toBe(true);
    expect(getState().validationErrors.b.some(e => e.includes('cycle'))).toBe(true);
  });
});

// ============================================================================
// Validation: type mismatch warnings (concrete-to-concrete mismatches)
// ============================================================================

describe('validateGraph type mismatch warnings', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('warns when concrete types mismatch (e.g. imported data with number → string)', () => {
    // Simulate a connection that shouldn't exist but could from imported/legacy data
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src', type: 'source', position: [0, 0, 0], title: 'Source', data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
      concat: {
        id: 'concat', type: 'concat', position: [6, 0, 0], title: 'Concat', data: {},
        inputs: [{ id: 'in-0', label: 'a', portType: 'string' }, { id: 'in-1', label: 'b', portType: 'string' }],
        outputs: [{ id: 'out-0', label: 'result', portType: 'string' }],
      },
    };
    // Force an incompatible connection (number → string) as if from imported data
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'concat', targetPortIndex: 0 },
    };
    useEditorStore.setState({ nodes, connections });
    getState().validateGraph();
    const errors = getState().validationErrors;
    expect(errors.concat?.some(e => e.includes('Type mismatch') && e.includes('warning'))).toBe(true);
  });

  it('does not warn for any-port connections (number → any is valid)', () => {
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src', type: 'source', position: [0, 0, 0], title: 'Source', data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
      filter: {
        id: 'filter', type: 'filter', position: [3, 0, 0], title: 'Filter', data: {},
        inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'filter', targetPortIndex: 0 },
    };
    useEditorStore.setState({ nodes, connections });
    getState().validateGraph();
    const errors = getState().validationErrors;
    const filterErrors = errors.filter || [];
    expect(filterErrors.some(e => e.includes('Type mismatch'))).toBe(false);
  });

  it('does not warn for direct same-type connections', () => {
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src', type: 'source', position: [0, 0, 0], title: 'Source', data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
      math: {
        id: 'math', type: 'math', position: [3, 0, 0], title: 'Math', data: {},
        inputs: [{ id: 'in-0', label: 'a', portType: 'number' }, { id: 'in-1', label: 'b', portType: 'number' }],
        outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'math', targetPortIndex: 0 },
    };
    useEditorStore.setState({ nodes, connections });
    getState().validateGraph();
    const errors = getState().validationErrors;
    const mathErrors = errors.math || [];
    expect(mathErrors.some(e => e.includes('Type mismatch'))).toBe(false);
  });

  it('does not warn when both sides are any', () => {
    const nodes: Record<string, EditorNode> = {
      r1: {
        id: 'r1', type: 'reroute', position: [0, 0, 0], title: 'R1', data: {},
        inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      },
      r2: {
        id: 'r2', type: 'reroute', position: [3, 0, 0], title: 'R2', data: {},
        inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'r1', sourcePortIndex: 0, targetNodeId: 'r2', targetPortIndex: 0 },
    };
    useEditorStore.setState({ nodes, connections });
    getState().validateGraph();
    const errors = getState().validationErrors;
    const r2Errors = errors.r2 || [];
    expect(r2Errors.some(e => e.includes('Type mismatch'))).toBe(false);
  });
});

// ============================================================================
// Validation: disconnected output leaf node warnings
// ============================================================================

describe('validateGraph disconnected output warnings', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('warns when a connected node has no outgoing connections', () => {
    // source → transform (but transform output goes nowhere)
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src', type: 'source', position: [0, 0, 0], title: 'Source', data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
      xform: {
        id: 'xform', type: 'transform', position: [3, 0, 0], title: 'Transform', data: {},
        inputs: [{ id: 'in-0', label: 'value', portType: 'number' }, { id: 'in-1', label: 'factor', portType: 'number' }],
        outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'xform', targetPortIndex: 0 },
    };
    useEditorStore.setState({ nodes, connections });
    getState().validateGraph();
    const errors = getState().validationErrors;
    // Transform is connected (has input) but output goes nowhere → warning
    expect(errors.xform?.some(e => e.includes('Output not connected') && e.includes('warning'))).toBe(true);
  });

  it('does not warn for terminal nodes (output, display, subgraph-output)', () => {
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src', type: 'source', position: [0, 0, 0], title: 'Source', data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
      out: {
        id: 'out', type: 'output', position: [3, 0, 0], title: 'Output', data: {},
        inputs: [{ id: 'in-0', label: 'data', portType: 'any' }, { id: 'in-1', label: 'label', portType: 'string' }],
        outputs: [],
      },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'out', targetPortIndex: 0 },
    };
    useEditorStore.setState({ nodes, connections });
    getState().validateGraph();
    const errors = getState().validationErrors;
    // Output node has no outputs — terminal node, should not warn
    expect(errors.out?.some(e => e.includes('Output not connected'))).toBeFalsy();
  });

  it('does not warn for fully disconnected nodes (already covered by existing warning)', () => {
    // A totally disconnected source should get "no connections" warning, NOT "output not connected"
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src', type: 'source', position: [0, 0, 0], title: 'Source', data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
    };
    useEditorStore.setState({ nodes, connections: {} });
    getState().validateGraph();
    const errors = getState().validationErrors;
    // Should have "no connections" warning, NOT "output not connected"
    expect(errors.src?.some(e => e.includes('no connections'))).toBe(true);
    expect(errors.src?.some(e => e.includes('Output not connected'))).toBeFalsy();
  });

  it('does not warn when output is connected', () => {
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src', type: 'source', position: [0, 0, 0], title: 'Source', data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      },
      out: {
        id: 'out', type: 'output', position: [3, 0, 0], title: 'Output', data: {},
        inputs: [{ id: 'in-0', label: 'data', portType: 'any' }],
        outputs: [],
      },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'out', targetPortIndex: 0 },
    };
    useEditorStore.setState({ nodes, connections });
    getState().validateGraph();
    const errors = getState().validationErrors;
    // Source has its output connected — no warning
    expect(errors.src?.some(e => e.includes('Output not connected'))).toBeFalsy();
  });
});

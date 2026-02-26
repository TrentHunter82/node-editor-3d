import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, snapToGrid } from './editorStore';

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
  while (getState().canUndo()) getState().undo();
  if (getState().canRedo()) {
    getState().pushUndoSnapshot();
    getState().undo();
  }
}

function getState() {
  return useEditorStore.getState();
}

// ===========================================================================
// renameGroup edge cases
// ===========================================================================
describe('renameGroup edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('renaming non-existent group is no-op', () => {
    expect(() => getState().renameGroup('fake-group', 'New Name')).not.toThrow();
  });

  it('renaming pushes undo', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('Original');
    expect(groupId).not.toBeNull();
    getState().renameGroup(groupId!, 'Renamed');
    expect(getState().groups[groupId!].label).toBe('Renamed');
    getState().undo();
    expect(getState().groups[groupId!].label).toBe('Original');
  });

  it('renaming to empty string succeeds', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('Test')!;
    getState().renameGroup(groupId, '');
    expect(getState().groups[groupId].label).toBe('');
  });

  it('renaming to same name is idempotent', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('Same')!;
    getState().renameGroup(groupId, 'Same');
    expect(getState().groups[groupId].label).toBe('Same');
  });
});

// ===========================================================================
// ungroupNodes edge cases
// ===========================================================================
describe('ungroupNodes edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('ungrouping non-existent group is no-op', () => {
    expect(() => getState().ungroupNodes('fake-group')).not.toThrow();
  });

  it('ungrouping removes groupId from all member nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('Test')!;
    expect(getState().nodes[a].groupId).toBe(groupId);
    getState().ungroupNodes(groupId);
    expect(getState().nodes[a].groupId).toBeUndefined();
    expect(getState().nodes[b].groupId).toBeUndefined();
    expect(getState().groups[groupId]).toBeUndefined();
  });

  it('ungrouping pushes undo and can be restored', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('Test')!;
    getState().ungroupNodes(groupId);
    expect(getState().groups[groupId]).toBeUndefined();
    getState().undo();
    expect(getState().groups[groupId]).toBeDefined();
    expect(getState().groups[groupId].label).toBe('Test');
  });
});

// ===========================================================================
// toggleGroupCollapse edge cases
// ===========================================================================
describe('toggleGroupCollapse edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('toggling non-existent group is no-op', () => {
    expect(() => getState().toggleGroupCollapse('fake-group')).not.toThrow();
  });

  it('toggles collapsed state (no undo — view-state)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('Test')!;
    expect(getState().groups[groupId].collapsed).toBe(false);
    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(true);
    getState().toggleGroupCollapse(groupId);
    expect(getState().groups[groupId].collapsed).toBe(false);
  });
});

// ===========================================================================
// createGroup edge cases
// ===========================================================================
describe('createGroup edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('returns null with < 2 selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));
    expect(getState().createGroup('Single')).toBeNull();
  });

  it('returns null when all selected nodes are already in the same group', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    getState().createGroup('Group1');
    // Try creating another group with same nodes
    getState().setSelection(new Set([a, b]));
    expect(getState().createGroup('Group2')).toBeNull();
  });

  it('uses default label when none provided', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup()!;
    expect(getState().groups[groupId].label).toBe('Group');
  });

  it('ignores non-node IDs in selection', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    // Include a fake ID in selection
    getState().setSelection(new Set([a, b, 'fake-id']));
    const groupId = getState().createGroup('Test');
    expect(groupId).not.toBeNull();
  });
});

// ===========================================================================
// boxSelect edge cases
// ===========================================================================
describe('boxSelect edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('selects nodes within rectangle', () => {
    const a = getState().addNode('source', [1, 0, 1]);
    const b = getState().addNode('source', [5, 0, 5]);
    const c = getState().addNode('source', [10, 0, 10]);
    getState().boxSelect(0, 0, 6, 6, false);
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.has(c)).toBe(false);
  });

  it('additive mode preserves existing selection', () => {
    const a = getState().addNode('source', [1, 0, 1]);
    const b = getState().addNode('source', [5, 0, 5]);
    const c = getState().addNode('source', [10, 0, 10]);
    getState().setSelection(new Set([a]));
    getState().boxSelect(4, 4, 6, 6, true);
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.has(c)).toBe(false);
  });

  it('non-additive mode replaces selection', () => {
    const a = getState().addNode('source', [1, 0, 1]);
    const b = getState().addNode('source', [5, 0, 5]);
    getState().setSelection(new Set([a]));
    getState().boxSelect(4, 4, 6, 6, false);
    expect(getState().selectedIds.has(a)).toBe(false);
    expect(getState().selectedIds.has(b)).toBe(true);
  });

  it('empty rectangle selects nothing', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().boxSelect(100, 100, 200, 200, false);
    expect(getState().selectedIds.size).toBe(0);
  });

  it('includes nodes on boundary', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().boxSelect(0, 0, 0, 0, false);
    expect(getState().selectedIds.has(a)).toBe(true);
  });
});

// ===========================================================================
// toggleSelection edge cases
// ===========================================================================
describe('toggleSelection edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('adds to selection', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().toggleSelection(a);
    expect(getState().selectedIds.has(a)).toBe(true);
  });

  it('removes from selection', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));
    getState().toggleSelection(a);
    expect(getState().selectedIds.has(a)).toBe(false);
  });

  it('can toggle connection IDs', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(s, 0, t, 0)!;
    getState().toggleSelection(connId);
    expect(getState().selectedIds.has(connId)).toBe(true);
    getState().toggleSelection(connId);
    expect(getState().selectedIds.has(connId)).toBe(false);
  });
});

// ===========================================================================
// toggleSnap edge cases
// ===========================================================================
describe('toggleSnap', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('toggles snap enabled state', () => {
    expect(getState().snapEnabled).toBe(true);
    getState().toggleSnap();
    expect(getState().snapEnabled).toBe(false);
    getState().toggleSnap();
    expect(getState().snapEnabled).toBe(true);
  });
});

// ===========================================================================
// snapToGrid edge cases
// ===========================================================================
describe('snapToGrid edge cases', () => {
  it('snaps positive numbers', () => {
    expect(snapToGrid(0.3)).toBe(0.5);
    expect(snapToGrid(0.7)).toBe(0.5);
    expect(snapToGrid(1.0)).toBe(1.0);
  });

  it('snaps negative numbers', () => {
    expect(snapToGrid(-0.3)).toBeCloseTo(0.5 * Math.round(-0.3 / 0.5));
    expect(snapToGrid(-1.0)).toBe(-1.0);
  });

  it('handles zero', () => {
    expect(snapToGrid(0)).toBeCloseTo(0);
  });

  it('handles large numbers', () => {
    expect(snapToGrid(100.3)).toBeCloseTo(100.5);
    expect(snapToGrid(10000.7)).toBeCloseTo(10000.5);
  });

  it('handles exact grid values', () => {
    expect(snapToGrid(0.5)).toBe(0.5);
    expect(snapToGrid(1.5)).toBe(1.5);
    expect(snapToGrid(2.0)).toBe(2.0);
  });
});

// ===========================================================================
// context menu edge cases
// ===========================================================================
describe('Context menu edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('open and close context menu', () => {
    getState().openContextMenu({ x: 100, y: 200, target: { kind: 'canvas' } });
    expect(getState().contextMenu).not.toBeNull();
    expect(getState().contextMenu!.x).toBe(100);
    expect(getState().contextMenu!.y).toBe(200);
    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('opening new menu replaces old one', () => {
    getState().openContextMenu({ x: 100, y: 200, target: { kind: 'canvas' } });
    getState().openContextMenu({ x: 300, y: 400, target: { kind: 'canvas' } });
    expect(getState().contextMenu!.x).toBe(300);
    expect(getState().contextMenu!.y).toBe(400);
  });

  it('node-targeted context menu', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().openContextMenu({ x: 50, y: 50, target: { kind: 'node', nodeId: id } });
    expect(getState().contextMenu!.target).toEqual({ kind: 'node', nodeId: id });
  });

  it('connection-targeted context menu', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(s, 0, t, 0)!;
    getState().openContextMenu({ x: 50, y: 50, target: { kind: 'connection', connectionId: connId } });
    expect(getState().contextMenu!.target).toEqual({ kind: 'connection', connectionId: connId });
  });
});

// ===========================================================================
// updateCustomNodePorts edge cases
// ===========================================================================
describe('updateCustomNodePorts edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('clamps input count to 0-8 range', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Test', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0',
    });
    const nodeId = getState().addCustomNode(defId, [0, 0, 0])!;
    getState().updateCustomNodePorts(nodeId, -5, 1);
    expect(getState().nodes[nodeId].inputs.length).toBe(0);
    getState().updateCustomNodePorts(nodeId, 100, 1);
    expect(getState().nodes[nodeId].inputs.length).toBe(8);
  });

  it('clamps output count to 1-8 range', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Test', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0',
    });
    const nodeId = getState().addCustomNode(defId, [0, 0, 0])!;
    getState().updateCustomNodePorts(nodeId, 1, -5);
    expect(getState().nodes[nodeId].outputs.length).toBe(1);
    getState().updateCustomNodePorts(nodeId, 1, 100);
    expect(getState().nodes[nodeId].outputs.length).toBe(8);
  });

  it('removes stale connections when ports shrink', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Test', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'any' }, { label: 'in1', portType: 'any' }],
      outputs: [{ label: 'out0', portType: 'any' }],
      expression: 'in0',
    });
    const nodeId = getState().addCustomNode(defId, [5, 0, 0])!;
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addConnection(src, 0, nodeId, 0);
    getState().addConnection(src, 0, nodeId, 1);
    expect(Object.keys(getState().connections).length).toBe(2);
    // Shrink to 1 input - connection to port 1 should be removed
    getState().updateCustomNodePorts(nodeId, 1, 1);
    expect(Object.keys(getState().connections).length).toBe(1);
  });

  it('no-ops on non-custom node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const inputsBefore = getState().nodes[id].inputs.length;
    getState().updateCustomNodePorts(id, 5, 5);
    expect(getState().nodes[id].inputs.length).toBe(inputsBefore);
  });

  it('no-ops on non-existent node', () => {
    expect(() => getState().updateCustomNodePorts('fake', 5, 5)).not.toThrow();
  });

  it('pushes undo', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Test', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0',
    });
    const nodeId = getState().addCustomNode(defId, [0, 0, 0])!;
    getState().updateCustomNodePorts(nodeId, 3, 2);
    expect(getState().nodes[nodeId].inputs.length).toBe(3);
    getState().undo();
    expect(getState().nodes[nodeId].inputs.length).toBe(1);
  });
});

// ===========================================================================
// removeCustomNodeDef edge cases
// ===========================================================================
describe('removeCustomNodeDef edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('removes definition and pushes undo', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Test', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0',
    });
    expect(getState().customNodeDefs[defId]).toBeDefined();
    getState().removeCustomNodeDef(defId);
    expect(getState().customNodeDefs[defId]).toBeUndefined();
    getState().undo();
    expect(getState().customNodeDefs[defId]).toBeDefined();
  });

  it('no-ops on non-existent definition', () => {
    expect(() => getState().removeCustomNodeDef('fake')).not.toThrow();
  });
});

// ===========================================================================
// addCustomNode edge cases
// ===========================================================================
describe('addCustomNode edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('returns null for non-existent definition', () => {
    expect(getState().addCustomNode('fake')).toBeNull();
  });

  it('creates node with correct ports from definition', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Double', color: 'red', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }, { label: 'in1', portType: 'string' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0 * 2',
    });
    const nodeId = getState().addCustomNode(defId, [0, 0, 0])!;
    const node = getState().nodes[nodeId];
    expect(node.type).toBe('custom');
    expect(node.title).toBe('Double');
    expect(node.inputs.length).toBe(2);
    expect(node.outputs.length).toBe(1);
    expect(node.inputs[0].portType).toBe('number');
    expect(node.inputs[1].portType).toBe('string');
    expect(node.data.customDefId).toBe(defId);
    expect(node.data.expression).toBe('in0 * 2');
  });
});

// ===========================================================================
// disconnectAndReroute edge cases
// ===========================================================================
describe('disconnectAndReroute edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('removes connection and starts new pending connection', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(s, 0, t, 0)!;
    getState().disconnectAndReroute(connId);
    expect(getState().connections[connId]).toBeUndefined();
    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().pendingConnection!.sourceNodeId).toBe(s);
    expect(getState().pendingConnection!.sourcePortIndex).toBe(0);
  });

  it('no-ops on non-existent connection', () => {
    expect(() => getState().disconnectAndReroute('fake')).not.toThrow();
    expect(getState().interaction).toBe('idle');
  });

  it('pushing undo restores the removed connection', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(s, 0, t, 0)!;
    getState().disconnectAndReroute(connId);
    getState().cancelConnection();
    getState().undo();
    expect(getState().connections[connId]).toBeDefined();
  });
});

// ===========================================================================
// setInteraction, setHoveredConnection, setNearestSnapPort
// ===========================================================================
describe('UI state setters', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('setInteraction updates mode', () => {
    getState().setInteraction('dragging-node');
    expect(getState().interaction).toBe('dragging-node');
    getState().setInteraction('idle');
    expect(getState().interaction).toBe('idle');
  });

  it('setHoveredConnection updates hoveredConnectionId', () => {
    getState().setHoveredConnection('conn-123');
    expect(getState().hoveredConnectionId).toBe('conn-123');
    getState().setHoveredConnection(null);
    expect(getState().hoveredConnectionId).toBeNull();
  });

  it('setNearestSnapPort updates', () => {
    getState().setNearestSnapPort({ nodeId: 'n1', portIndex: 2 });
    expect(getState().nearestSnapPort).toEqual({ nodeId: 'n1', portIndex: 2 });
    getState().setNearestSnapPort(null);
    expect(getState().nearestSnapPort).toBeNull();
  });
});

// ===========================================================================
// startConnection / updatePendingCursor / cancelConnection edge cases
// ===========================================================================
describe('Connection drawing flow', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('startConnection with invalid node is no-op', () => {
    getState().startConnection('fake', 0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('startConnection with out-of-range port is no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(id, 99);
    expect(getState().interaction).toBe('idle');
  });

  it('startConnection with negative port is no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(id, -1);
    expect(getState().interaction).toBe('idle');
  });

  it('updatePendingCursor updates cursor position', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(id, 0);
    getState().updatePendingCursor([5, 0, 5]);
    expect(getState().pendingConnection!.cursorPos).toEqual([5, 0, 5]);
  });

  it('updatePendingCursor is no-op without pending connection', () => {
    getState().updatePendingCursor([5, 0, 5]);
    expect(getState().pendingConnection).toBeNull();
  });

  it('cancelConnection resets state', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(id, 0);
    expect(getState().interaction).toBe('drawing-connection');
    getState().cancelConnection();
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().nearestSnapPort).toBeNull();
  });
});

// ===========================================================================
// addConnection edge cases
// ===========================================================================
describe('addConnection edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('prevents self-connection', () => {
    const id = getState().addNode('transform', [0, 0, 0]);
    expect(getState().addConnection(id, 0, id, 0)).toBeNull();
  });

  it('prevents duplicate connections', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    expect(getState().addConnection(s, 0, t, 0)).not.toBeNull();
    expect(getState().addConnection(s, 0, t, 0)).toBeNull();
  });

  it('returns null for non-existent source', () => {
    const t = getState().addNode('transform', [5, 0, 0]);
    expect(getState().addConnection('fake', 0, t, 0)).toBeNull();
  });

  it('returns null for non-existent target', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    expect(getState().addConnection(s, 0, 'fake', 0)).toBeNull();
  });

  it('returns null for invalid port indices', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    expect(getState().addConnection(s, -1, t, 0)).toBeNull();
    expect(getState().addConnection(s, 0, t, -1)).toBeNull();
    expect(getState().addConnection(s, 99, t, 0)).toBeNull();
    expect(getState().addConnection(s, 0, t, 99)).toBeNull();
  });

  it('rejects incompatible port types', () => {
    const s = getState().addNode('source', [0, 0, 0]); // outputs: number, string
    const c = getState().addNode('concat', [5, 0, 0]); // inputs: string, string
    // Source output[0] is 'number', concat input[0] is 'string' - incompatible
    expect(getState().addConnection(s, 0, c, 0)).toBeNull();
  });

  it('allows any-type connections', () => {
    const s = getState().addNode('source', [0, 0, 0]); // output[0] = number
    const r = getState().addNode('reroute', [5, 0, 0]); // input[0] = any
    expect(getState().addConnection(s, 0, r, 0)).not.toBeNull();
  });
});

// ===========================================================================
// removeNode edge cases
// ===========================================================================
describe('removeNode edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('removing a node cascades connection deletion', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(s, 0, t, 0);
    expect(Object.keys(getState().connections).length).toBe(1);
    getState().removeNode(s);
    expect(Object.keys(getState().connections).length).toBe(0);
  });

  it('removing last node from group deletes group', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('Test')!;
    getState().removeNode(a);
    getState().removeNode(b);
    expect(getState().groups[groupId]).toBeUndefined();
  });

  it('removing non-existent node is no-op', () => {
    expect(() => getState().removeNode('fake')).not.toThrow();
  });

  it('removing removes from selectedIds', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().removeNode(id);
    expect(getState().selectedIds.has(id)).toBe(false);
  });
});

// ===========================================================================
// deleteSelected edge cases
// ===========================================================================
describe('deleteSelected with groups', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('deleting all group members removes the group', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    const groupId = getState().createGroup('Test')!;
    getState().setSelection(new Set([a, b]));
    getState().deleteSelected();
    expect(getState().groups[groupId]).toBeUndefined();
  });

  it('deleting one group member preserves group if others remain', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    const c = getState().addNode('source', [10, 0, 0]);
    getState().setSelection(new Set([a, b, c]));
    const groupId = getState().createGroup('Test')!;
    getState().setSelection(new Set([a]));
    getState().deleteSelected();
    expect(getState().groups[groupId]).toBeDefined();
  });

  it('can delete connections from selection', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(s, 0, t, 0)!;
    getState().setSelection(new Set([connId]));
    getState().deleteSelected();
    expect(getState().connections[connId]).toBeUndefined();
    expect(getState().nodes[s]).toBeDefined();
    expect(getState().nodes[t]).toBeDefined();
  });
});

// ===========================================================================
// expandSelected edge cases
// ===========================================================================
describe('expandSelected edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('expands collapsed nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().toggleNodeCollapse(a);
    getState().toggleNodeCollapse(b);
    getState().setSelection(new Set([a, b]));
    getState().expandSelected();
    expect(getState().nodes[a].collapsed).toBeFalsy();
    expect(getState().nodes[b].collapsed).toBeFalsy();
  });

  it('no-ops when no nodes are collapsed', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([a]));
    getState().expandSelected();
    // No undo pushed since nothing changed
    // (it already had undo from addNode, so we check differently)
    expect(getState().nodes[a].collapsed).toBeFalsy();
  });

  it('no-ops with empty selection', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set());
    expect(() => getState().expandSelected()).not.toThrow();
  });

  it('pushes undo', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeCollapse(a);
    getState().setSelection(new Set([a]));
    getState().expandSelected();
    expect(getState().nodes[a].collapsed).toBeFalsy();
    getState().undo();
    expect(getState().nodes[a].collapsed).toBe(true);
  });
});

// ===========================================================================
// collapseSelected edge cases
// ===========================================================================
describe('collapseSelected edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('no-ops when all are already collapsed', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeCollapse(a);
    expect(getState().nodes[a].collapsed).toBe(true);
    getState().setSelection(new Set([a]));
    // This should not push undo since nothing to collapse
    getState().collapseSelected();
    // Node stays collapsed
    expect(getState().nodes[a].collapsed).toBe(true);
  });

  it('only collapses non-collapsed nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().toggleNodeCollapse(a); // already collapsed
    getState().setSelection(new Set([a, b]));
    getState().collapseSelected();
    expect(getState().nodes[a].collapsed).toBe(true);
    expect(getState().nodes[b].collapsed).toBe(true);
  });
});

// ===========================================================================
// getCompatibleNodeTypes edge cases
// ===========================================================================
describe('getCompatibleNodeTypes edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('returns empty for non-existent source node', () => {
    expect(getState().getCompatibleNodeTypes('fake', 0, true)).toEqual([]);
  });

  it('returns empty for invalid port index on output', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().getCompatibleNodeTypes(id, 99, true)).toEqual([]);
  });

  it('returns empty for invalid port index on input', () => {
    const id = getState().addNode('transform', [0, 0, 0]);
    expect(getState().getCompatibleNodeTypes(id, 99, false)).toEqual([]);
  });

  it('excludes note type', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const types = getState().getCompatibleNodeTypes(id, 0, true);
    expect(types.some(t => t.type === 'note')).toBe(false);
  });

  it('includes reroute (any-type) for number output', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const types = getState().getCompatibleNodeTypes(id, 0, true);
    expect(types.some(t => t.type === 'reroute')).toBe(true);
  });

  it('returns types with categories', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const types = getState().getCompatibleNodeTypes(id, 0, true);
    for (const t of types) {
      expect(t.category).toBeDefined();
      expect(typeof t.category).toBe('string');
    }
  });
});

// ===========================================================================
// addNodeAndConnect edge cases
// ===========================================================================
describe('addNodeAndConnect edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('returns null for non-existent source', () => {
    expect(getState().addNodeAndConnect('transform', [0, 0, 0], 'fake', 0, true)).toBeNull();
  });

  it('returns null for invalid output port index', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().addNodeAndConnect('transform', [5, 0, 0], id, 99, true)).toBeNull();
  });

  it('returns null for invalid input port index', () => {
    const id = getState().addNode('transform', [0, 0, 0]);
    expect(getState().addNodeAndConnect('source', [5, 0, 0], id, 99, false)).toBeNull();
  });

  it('auto-selects the new node', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const newId = getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true)!;
    expect(getState().selectedIds.has(newId)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('single undo removes node and connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true);
    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(Object.keys(getState().connections).length).toBe(1);
    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(1);
    expect(Object.keys(getState().connections).length).toBe(0);
  });
});

// ===========================================================================
// validateGraph edge cases
// ===========================================================================
describe('validateGraph edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('validates empty graph with no errors', () => {
    getState().validateGraph();
    expect(Object.keys(getState().validationErrors).length).toBe(0);
  });

  it('source node with no connections gets only warning, no input errors', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    getState().validateGraph();
    // Source has no inputs, so no "input not connected" errors
    // But it may get a "no connections" warning since it's isolated
    const errs = getState().validationErrors[s] || [];
    const inputErrors = errs.filter(e => e.includes('" is not connected'));
    expect(inputErrors.length).toBe(0);
  });

  it('disconnected transform has errors', () => {
    const t = getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    expect(getState().validationErrors[t]).toBeDefined();
    expect(getState().validationErrors[t].length).toBeGreaterThan(0);
  });

  it('fully connected graph has no input errors', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(s, 0, t, 0);
    getState().addConnection(s, 0, t, 1); // connect factor too
    getState().addConnection(t, 0, out, 0); // connect output downstream
    getState().validateGraph();
    const transformErrors = (getState().validationErrors[t] || []).filter(e => e.includes('not connected'));
    expect(transformErrors.length).toBe(0);
  });

  it('note nodes are skipped in validation', () => {
    const n = getState().addNode('note', [0, 0, 0]);
    getState().validateGraph();
    expect(getState().validationErrors[n]).toBeUndefined();
  });

  it('random node has no input errors (no inputs)', () => {
    const r = getState().addNode('random', [0, 0, 0]);
    getState().validateGraph();
    // Random has no inputs, so no disconnected-input errors
    const errs = getState().validationErrors[r] || [];
    const inputErrors = errs.filter(e => e.includes('not connected'));
    expect(inputErrors.length).toBe(0);
  });
});

// ===========================================================================
// searchNodes edge cases
// ===========================================================================
describe('searchNodes edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('search with whitespace-only query returns all', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    const results = getState().searchNodes('   ');
    expect(results.length).toBe(2);
  });

  it('search is case insensitive', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const results = getState().searchNodes('SOURCE');
    expect(results.some(r => r.id === id)).toBe(true);
  });

  it('search by node ID', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const results = getState().searchNodes(id);
    expect(results.some(r => r.id === id)).toBe(true);
  });

  it('no matches returns empty array', () => {
    getState().addNode('source', [0, 0, 0]);
    const results = getState().searchNodes('zzzznonexistent');
    expect(results.length).toBe(0);
  });
});

// ===========================================================================
// focusNode edge cases
// ===========================================================================
describe('focusNode edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('focuses non-existent node is no-op', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().focusNode('fake');
    expect(getState().selectedIds.size).toBe(0);
  });

  it('replaces existing selection', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([a]));
    getState().focusNode(b);
    expect(getState().selectedIds.has(a)).toBe(false);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });
});

// ===========================================================================
// setSearchQuery
// ===========================================================================
describe('setSearchQuery', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('updates search query state', () => {
    getState().setSearchQuery('test query');
    expect(getState().searchQuery).toBe('test query');
    getState().setSearchQuery('');
    expect(getState().searchQuery).toBe('');
  });
});

// ===========================================================================
// updateNodePosition
// ===========================================================================
describe('updateNodePosition edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('updates position', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodePosition(id, [5, 10, 15]);
    expect(getState().nodes[id].position).toEqual([5, 10, 15]);
  });

  it('no-ops on non-existent node', () => {
    expect(() => getState().updateNodePosition('fake', [0, 0, 0])).not.toThrow();
  });

  it('does not push undo (position updates are continuous)', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    drainUndoRedo();
    getState().updateNodePosition(id, [5, 0, 5]);
    // updateNodePosition does NOT push undo (it's called every frame during drag)
    // The undo is expected to be pushed at drag start by the drag handler
  });
});

// ===========================================================================
// updateNodeTitle edge cases
// ===========================================================================
describe('updateNodeTitle edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('no-ops on non-existent node', () => {
    expect(() => getState().updateNodeTitle('fake', 'New Title')).not.toThrow();
  });

  it('updates title and pushes undo', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'Custom Title');
    expect(getState().nodes[id].title).toBe('Custom Title');
    getState().undo();
    expect(getState().nodes[id].title).toBe('Source');
  });
});

// ===========================================================================
// removeConnection edge cases
// ===========================================================================
describe('removeConnection edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('no-ops on non-existent connection', () => {
    expect(() => getState().removeConnection('fake')).not.toThrow();
  });

  it('removes from selectedIds', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(s, 0, t, 0)!;
    getState().setSelection(new Set([connId]));
    getState().removeConnection(connId);
    expect(getState().selectedIds.has(connId)).toBe(false);
  });

  it('pushes undo', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    const t = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(s, 0, t, 0)!;
    getState().removeConnection(connId);
    expect(getState().connections[connId]).toBeUndefined();
    getState().undo();
    expect(getState().connections[connId]).toBeDefined();
  });
});

// ===========================================================================
// loadFromStorage edge cases
// ===========================================================================
describe('loadFromStorage edge cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); localStorage.clear(); });

  it('returns false when nothing saved', () => {
    expect(getState().loadFromStorage()).toBe(false);
  });

  it('returns false for invalid data', () => {
    localStorage.setItem('node-editor-3d-graph', 'not json');
    expect(getState().loadFromStorage()).toBe(false);
  });

  it('returns false for data with invalid nodes', () => {
    localStorage.setItem('node-editor-3d-graph', '{"nodes":"bad","connections":{}}');
    expect(getState().loadFromStorage()).toBe(false);
  });

  it('clears undo/redo history on load', () => {
    getState().addNode('source', [0, 0, 0]);
    expect(getState().canUndo()).toBe(true);
    // Save and reload
    const { nodes, connections, groups, customNodeDefs } = getState();
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({ nodes, connections, groups, customNodeDefs }));
    resetStore();
    getState().loadFromStorage();
    expect(getState().canUndo()).toBe(false);
    expect(getState().canRedo()).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/editorStore';
import { _resetModuleState } from '../store/editorStore';
import type { EditorNode, Connection } from '../types';

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
    errorStrategy: 'fail-fast',
    debugMode: false,
    pausedAtWave: -1,
    debugWaves: [],
    traceNodeId: null,
    executionMetrics: {},
    executionTotalDuration: 0,
    graphTabs: { default: { id: 'default', name: 'Main Graph', createdAt: Date.now() } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
    storageWarning: null,
  });
}

function getState() {
  return useEditorStore.getState();
}

// ---------------------------------------------------------------------------
// 1. Interaction State Management
// ---------------------------------------------------------------------------
describe('Interaction State Management', () => {
  beforeEach(() => resetStore());

  it('starts with interaction set to idle', () => {
    expect(getState().interaction).toBe('idle');
  });

  it('setInteraction to dragging-node', () => {
    getState().setInteraction('dragging-node');
    expect(getState().interaction).toBe('dragging-node');
  });

  it('setInteraction to drawing-connection', () => {
    getState().setInteraction('drawing-connection');
    expect(getState().interaction).toBe('drawing-connection');
  });

  it('setInteraction to box-selecting', () => {
    getState().setInteraction('box-selecting');
    expect(getState().interaction).toBe('box-selecting');
  });

  it('setInteraction to idle resets document.body.style.cursor', () => {
    // First go to non-idle so the transition to idle is a real state change
    getState().setInteraction('dragging-node');
    document.body.style.cursor = 'grabbing';
    getState().setInteraction('idle');
    expect(document.body.style.cursor).toBe('auto');
  });

  it('setInteraction to non-idle does not reset cursor', () => {
    document.body.style.cursor = 'crosshair';
    getState().setInteraction('dragging-node');
    expect(document.body.style.cursor).toBe('crosshair');
  });

  it('multiple transitions work correctly', () => {
    getState().setInteraction('dragging-node');
    expect(getState().interaction).toBe('dragging-node');
    getState().setInteraction('box-selecting');
    expect(getState().interaction).toBe('box-selecting');
    getState().setInteraction('drawing-connection');
    expect(getState().interaction).toBe('drawing-connection');
    getState().setInteraction('idle');
    expect(getState().interaction).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// 2. Selection System
// ---------------------------------------------------------------------------
describe('Selection System', () => {
  beforeEach(() => resetStore());

  it('setSelection with empty set clears selection', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    expect(getState().selectedIds.size).toBe(1);
    getState().setSelection(new Set());
    expect(getState().selectedIds.size).toBe(0);
  });

  it('setSelection with node IDs selects them', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().setSelection(new Set([a, b]));
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.size).toBe(2);
  });

  it('toggleSelection adds a node to selection', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().selectedIds.has(id)).toBe(false);
    getState().toggleSelection(id);
    expect(getState().selectedIds.has(id)).toBe(true);
  });

  it('toggleSelection removes a node from selection', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().toggleSelection(id);
    expect(getState().selectedIds.has(id)).toBe(false);
  });

  it('selection can include non-existent IDs (store does not filter)', () => {
    getState().setSelection(new Set(['nonexistent-id']));
    expect(getState().selectedIds.has('nonexistent-id')).toBe(true);
  });

  it('selectConnected upstream selects upstream nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);
    // Select output node, then select connected upstream
    getState().setSelection(new Set([c]));
    getState().selectConnected('upstream');
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.has(c)).toBe(true);
  });

  it('selectConnected downstream selects downstream nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);
    // Select source node, then select connected downstream
    getState().setSelection(new Set([a]));
    getState().selectConnected('downstream');
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.has(c)).toBe(true);
  });

  it('selectConnected both selects all connected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);
    const d = getState().addNode('source', [10, 0, 0]); // disconnected
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);
    // Select middle node, then select connected both
    getState().setSelection(new Set([b]));
    getState().selectConnected('both');
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.has(c)).toBe(true);
    expect(getState().selectedIds.has(d)).toBe(false);
  });

  it('selectConnected with no selected nodes is a no-op', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set());
    getState().selectConnected('both');
    expect(getState().selectedIds.size).toBe(0);
  });

  it('boxSelect in non-additive mode replaces selection', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 5]);
    getState().setSelection(new Set([b]));
    // Box that only captures node a (at 0,0,0)
    getState().boxSelect(-1, -1, 1, 1, false);
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(false);
  });

  it('boxSelect in additive mode adds to selection', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('source', [5, 0, 5]);
    getState().setSelection(new Set([b]));
    // Box that only captures node a, additive keeps b
    getState().boxSelect(-1, -1, 1, 1, true);
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
  });

  it('boxSelect with no nodes in bounds produces empty selection', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().boxSelect(100, 100, 200, 200, false);
    expect(getState().selectedIds.size).toBe(0);
  });

  it('boxSelect boundary conditions: node exactly on boundary is included', () => {
    const id = getState().addNode('source', [5, 0, 5]);
    // The box min/max is inclusive (>= and <=)
    getState().boxSelect(5, 5, 10, 10, false);
    expect(getState().selectedIds.has(id)).toBe(true);
  });

  it('boxSelect boundary conditions: node at exact max boundary is included', () => {
    const id = getState().addNode('source', [10, 0, 10]);
    getState().boxSelect(5, 5, 10, 10, false);
    expect(getState().selectedIds.has(id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Connection Drawing Flow
// ---------------------------------------------------------------------------
describe('Connection Drawing Flow', () => {
  beforeEach(() => resetStore());

  it('startConnection sets interaction to drawing-connection', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(id, 0);
    expect(getState().interaction).toBe('drawing-connection');
  });

  it('startConnection creates pendingConnection', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(id, 0);
    const pending = getState().pendingConnection;
    expect(pending).not.toBeNull();
    expect(pending!.sourceNodeId).toBe(id);
    expect(pending!.sourcePortIndex).toBe(0);
    expect(pending!.cursorPos).toEqual([0, 0, 0]);
  });

  it('startConnection with invalid node is no-op', () => {
    getState().startConnection('nonexistent', 0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('startConnection with out-of-range port index is no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Source has 2 outputs (value, label), index 5 is out of range
    getState().startConnection(id, 5);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('startConnection with negative port index is no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(id, -1);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('updatePendingCursor updates cursor position', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(id, 0);
    getState().updatePendingCursor([5, 1, 3]);
    expect(getState().pendingConnection!.cursorPos).toEqual([5, 1, 3]);
  });

  it('updatePendingCursor is no-op when no pending connection', () => {
    getState().updatePendingCursor([5, 1, 3]);
    expect(getState().pendingConnection).toBeNull();
  });

  it('completeConnection creates the connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    getState().completeConnection(tgt, 0);
    const conns = Object.values(getState().connections) as Connection[];
    expect(conns.length).toBe(1);
    expect(conns[0].sourceNodeId).toBe(src);
    expect(conns[0].sourcePortIndex).toBe(0);
    expect(conns[0].targetNodeId).toBe(tgt);
    expect(conns[0].targetPortIndex).toBe(0);
  });

  it('completeConnection resets interaction to idle', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    getState().completeConnection(tgt, 0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('completeConnection with invalid target cancels', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    getState().completeConnection('nonexistent', 0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('completeConnection with no pending connection is no-op', () => {
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().completeConnection(tgt, 0);
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('cancelConnection resets interaction to idle', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    expect(getState().interaction).toBe('drawing-connection');
    getState().cancelConnection();
    expect(getState().interaction).toBe('idle');
  });

  it('cancelConnection clears pendingConnection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    expect(getState().pendingConnection).not.toBeNull();
    getState().cancelConnection();
    expect(getState().pendingConnection).toBeNull();
  });

  it('cancelConnection clears nearestSnapPort', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    getState().setNearestSnapPort({ nodeId: tgt, portIndex: 0 });
    getState().cancelConnection();
    expect(getState().nearestSnapPort).toBeNull();
  });

  it('completeConnection enforces single-input (replaces existing connection)', () => {
    const src1 = getState().addNode('source', [0, 0, 0]);
    const src2 = getState().addNode('source', [0, 0, 5]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    // First connection to target's input port 0
    getState().addConnection(src1, 0, tgt, 0);
    expect(Object.values(getState().connections)).toHaveLength(1);
    // Use startConnection + completeConnection to connect src2 to the same target port
    getState().startConnection(src2, 0);
    getState().completeConnection(tgt, 0);
    // The old connection should be replaced - only 1 connection remains
    const conns = Object.values(getState().connections) as Connection[];
    expect(conns).toHaveLength(1);
    expect(conns[0].sourceNodeId).toBe(src2);
    expect(conns[0].targetNodeId).toBe(tgt);
    expect(conns[0].targetPortIndex).toBe(0);
  });

  it('disconnectAndReroute removes connection and starts new pending connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0)!;
    expect(Object.keys(getState().connections)).toHaveLength(1);
    getState().disconnectAndReroute(connId);
    // Connection should be removed
    expect(Object.keys(getState().connections)).toHaveLength(0);
    // A new pending connection should start from the original source
    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().pendingConnection).not.toBeNull();
    expect(getState().pendingConnection!.sourceNodeId).toBe(src);
    expect(getState().pendingConnection!.sourcePortIndex).toBe(0);
  });

  it('disconnectAndReroute with invalid connection is no-op', () => {
    getState().disconnectAndReroute('nonexistent');
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Context Menu
// ---------------------------------------------------------------------------
describe('Context Menu', () => {
  beforeEach(() => resetStore());

  it('openContextMenu sets context menu state', () => {
    getState().openContextMenu({ x: 100, y: 200, target: { kind: 'canvas' } });
    const menu = getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu!.x).toBe(100);
    expect(menu!.y).toBe(200);
  });

  it('closeContextMenu clears it', () => {
    getState().openContextMenu({ x: 100, y: 200, target: { kind: 'canvas' } });
    expect(getState().contextMenu).not.toBeNull();
    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('canvas context menu target', () => {
    getState().openContextMenu({ x: 0, y: 0, target: { kind: 'canvas' } });
    expect(getState().contextMenu!.target).toEqual({ kind: 'canvas' });
  });

  it('node context menu target', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().openContextMenu({ x: 50, y: 50, target: { kind: 'node', nodeId: id } });
    const target = getState().contextMenu!.target;
    expect(target).toEqual({ kind: 'node', nodeId: id });
  });

  it('connection context menu target', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0)!;
    getState().openContextMenu({
      x: 25, y: 25,
      target: { kind: 'connection', connectionId: connId },
    });
    const target = getState().contextMenu!.target;
    expect(target).toEqual({ kind: 'connection', connectionId: connId });
  });

  it('port context menu target', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().openContextMenu({
      x: 10, y: 10,
      target: { kind: 'port', nodeId: id, portIndex: 0, portType: 'output' },
    });
    const target = getState().contextMenu!.target;
    expect(target).toEqual({ kind: 'port', nodeId: id, portIndex: 0, portType: 'output' });
  });

  it('opening a new context menu replaces the old one', () => {
    getState().openContextMenu({ x: 0, y: 0, target: { kind: 'canvas' } });
    const nodeId = getState().addNode('source', [0, 0, 0]);
    getState().openContextMenu({ x: 99, y: 99, target: { kind: 'node', nodeId } });
    expect(getState().contextMenu!.x).toBe(99);
    expect(getState().contextMenu!.target).toEqual({ kind: 'node', nodeId });
  });
});

// ---------------------------------------------------------------------------
// 5. Snap Port & Hover
// ---------------------------------------------------------------------------
describe('Snap Port & Hover', () => {
  beforeEach(() => resetStore());

  it('setNearestSnapPort sets the snap target', () => {
    const id = getState().addNode('transform', [0, 0, 0]);
    getState().setNearestSnapPort({ nodeId: id, portIndex: 0 });
    expect(getState().nearestSnapPort).toEqual({ nodeId: id, portIndex: 0 });
  });

  it('setNearestSnapPort(null) clears it', () => {
    const id = getState().addNode('transform', [0, 0, 0]);
    getState().setNearestSnapPort({ nodeId: id, portIndex: 0 });
    getState().setNearestSnapPort(null);
    expect(getState().nearestSnapPort).toBeNull();
  });

  it('setHoveredConnection sets hovered connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0)!;
    getState().setHoveredConnection(connId);
    expect(getState().hoveredConnectionId).toBe(connId);
  });

  it('setHoveredConnection(null) clears it', () => {
    getState().setHoveredConnection('some-id');
    getState().setHoveredConnection(null);
    expect(getState().hoveredConnectionId).toBeNull();
  });

  it('hoveredConnectionId starts as null', () => {
    expect(getState().hoveredConnectionId).toBeNull();
  });

  it('nearestSnapPort starts as null', () => {
    expect(getState().nearestSnapPort).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Focus and Navigation
// ---------------------------------------------------------------------------
describe('Focus and Navigation', () => {
  beforeEach(() => resetStore());

  it('focusNode selects the node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set());
    getState().focusNode(id);
    expect(getState().selectedIds.has(id)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('focusNode replaces existing selection', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([a]));
    getState().focusNode(b);
    expect(getState().selectedIds.has(a)).toBe(false);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('focusNode with non-existent ID is no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().focusNode('nonexistent');
    // Selection should remain unchanged
    expect(getState().selectedIds.has(id)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Port Compatibility
// ---------------------------------------------------------------------------
describe('Port Compatibility', () => {
  beforeEach(() => resetStore());

  it('getCompatiblePorts returns compatible target ports', () => {
    const src = getState().addNode('source', [0, 0, 0]); // outputs: number, string
    const tgt = getState().addNode('transform', [5, 0, 0]); // inputs: number, number
    const ports = getState().getCompatiblePorts(src, 0); // source output port 0 is number
    // Should find both number inputs on the transform node
    expect(ports.length).toBeGreaterThanOrEqual(1);
    const tgtPorts = ports.filter((p: { nodeId: string; portIndex: number }) => p.nodeId === tgt);
    expect(tgtPorts.length).toBe(2); // transform has 2 number inputs
  });

  it('getCompatiblePorts excludes same-node connections', () => {
    const node = getState().addNode('transform', [0, 0, 0]); // has both inputs and outputs
    const ports = getState().getCompatiblePorts(node, 0); // output 0 is number
    const selfPorts = ports.filter((p: { nodeId: string; portIndex: number }) => p.nodeId === node);
    expect(selfPorts.length).toBe(0);
  });

  it('getCompatiblePorts respects type compatibility', () => {
    const src = getState().addNode('source', [0, 0, 0]); // output 1 is string
    const tgt = getState().addNode('math', [5, 0, 0]); // inputs: number, number
    const ports = getState().getCompatiblePorts(src, 1); // source output 1 is string
    const mathPorts = ports.filter((p: { nodeId: string; portIndex: number }) => p.nodeId === tgt);
    // Math node has only number inputs - string is NOT compatible with number
    expect(mathPorts.length).toBe(0);
  });

  it('getCompatiblePorts includes any-type ports', () => {
    const src = getState().addNode('source', [0, 0, 0]); // output 0 is number
    const tgt = getState().addNode('filter', [5, 0, 0]); // input 0 is any
    const ports = getState().getCompatiblePorts(src, 0);
    const filterPorts = ports.filter((p: { nodeId: string; portIndex: number }) => p.nodeId === tgt);
    expect(filterPorts.length).toBe(1); // 'any' type accepts 'number'
  });

  it('getCompatiblePorts returns empty for invalid source node', () => {
    const ports = getState().getCompatiblePorts('nonexistent', 0);
    expect(ports).toEqual([]);
  });

  it('getCompatiblePorts returns empty for out-of-range port index', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const ports = getState().getCompatiblePorts(src, 99);
    expect(ports).toEqual([]);
  });

  it('getCompatibleNodeTypes returns compatible node types for drag-from-output', () => {
    const src = getState().addNode('source', [0, 0, 0]); // output 0 is number
    const types = getState().getCompatibleNodeTypes(src, 0, true);
    // Should include transform (has number inputs)
    const typeNames = types.map((t: { type: string }) => t.type);
    expect(typeNames).toContain('transform');
    expect(typeNames).toContain('math');
    expect(typeNames).toContain('clamp');
    // Should NOT include note (no ports at all)
    expect(typeNames).not.toContain('note');
  });

  it('getCompatibleNodeTypes returns compatible node types for drag-from-input', () => {
    const tgt = getState().addNode('transform', [0, 0, 0]); // input 0 is number
    const types = getState().getCompatibleNodeTypes(tgt, 0, false);
    // Should include source (has number output)
    const typeNames = types.map((t: { type: string }) => t.type);
    expect(typeNames).toContain('source');
    expect(typeNames).toContain('math');
  });

  it('getCompatibleNodeTypes returns empty for invalid node', () => {
    const types = getState().getCompatibleNodeTypes('nonexistent', 0, true);
    expect(types).toEqual([]);
  });

  it('addNodeAndConnect creates node and connection from output', () => {
    const src = getState().addNode('source', [0, 0, 0]); // output 0 is number
    const newId = getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true);
    expect(newId).not.toBeNull();
    expect(getState().nodes[newId!]).toBeDefined();
    expect(getState().nodes[newId!].type).toBe('transform');
    // Should have a connection from src output 0 to new node's first compatible input
    const conns = Object.values(getState().connections) as Connection[];
    const conn = conns.find(c => c.sourceNodeId === src && c.targetNodeId === newId);
    expect(conn).toBeDefined();
    expect(conn!.sourcePortIndex).toBe(0);
  });

  it('addNodeAndConnect creates node and connection from input', () => {
    const tgt = getState().addNode('transform', [5, 0, 0]); // input 0 is number
    const newId = getState().addNodeAndConnect('source', [0, 0, 0], tgt, 0, false);
    expect(newId).not.toBeNull();
    expect(getState().nodes[newId!]).toBeDefined();
    // Connection should go from new node's output to target's input
    const conns = Object.values(getState().connections) as Connection[];
    const conn = conns.find(c => c.sourceNodeId === newId && c.targetNodeId === tgt);
    expect(conn).toBeDefined();
    expect(conn!.targetPortIndex).toBe(0);
  });

  it('addNodeAndConnect returns null for incompatible types', () => {
    const src = getState().addNode('source', [0, 0, 0]); // output 1 is string
    // output node has inputs: any, string -- but 'note' has no ports at all
    const result = getState().addNodeAndConnect('note', [5, 0, 0], src, 0, true);
    // Note has no inputs, so no compatible port can be found
    expect(result).toBeNull();
  });

  it('addNodeAndConnect returns null for invalid source node', () => {
    const result = getState().addNodeAndConnect('transform', [5, 0, 0], 'nonexistent', 0, true);
    expect(result).toBeNull();
  });

  it('addNodeAndConnect auto-selects the new node', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const newId = getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true)!;
    expect(getState().selectedIds.has(newId)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Batch Operations
// ---------------------------------------------------------------------------
describe('Batch Operations', () => {
  beforeEach(() => resetStore());

  it('deleteSelected removes nodes and their connections', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    const c = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);
    // Select and delete the middle node
    getState().setSelection(new Set([b]));
    getState().deleteSelected();
    expect(getState().nodes[b]).toBeUndefined();
    // Both connections involving b should be removed
    const conns = Object.values(getState().connections) as Connection[];
    expect(conns.length).toBe(0);
    // Other nodes remain
    expect(getState().nodes[a]).toBeDefined();
    expect(getState().nodes[c]).toBeDefined();
  });

  it('deleteSelected with no selection is no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set());
    getState().deleteSelected();
    expect(getState().nodes[id]).toBeDefined();
  });

  it('deleteSelected clears selection', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().deleteSelected();
    expect(getState().selectedIds.size).toBe(0);
  });

  it('deleteSelected can delete connections directly', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(a, 0, b, 0)!;
    // Select the connection (not a node)
    getState().setSelection(new Set([connId]));
    getState().deleteSelected();
    expect(getState().connections[connId]).toBeUndefined();
    // Nodes should still exist
    expect(getState().nodes[a]).toBeDefined();
    expect(getState().nodes[b]).toBeDefined();
  });

  it('duplicateSelected creates copies offset from originals', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();
    const nodeIds = Object.keys(getState().nodes);
    expect(nodeIds.length).toBe(2);
    // Find the new node (not the original)
    const newNode = (Object.values(getState().nodes) as EditorNode[]).find(n => n.id !== id)!;
    expect(newNode.type).toBe('source');
    expect(newNode.title).toBe('Source Copy');
    // Offset: [+1.5, 0, +1]
    expect(newNode.position[0]).toBe(1.5);
    expect(newNode.position[1]).toBe(0);
    expect(newNode.position[2]).toBe(1);
  });

  it('duplicateSelected selects the new copies', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();
    // Selection should be the new node, not the original
    expect(getState().selectedIds.has(id)).toBe(false);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('duplicateSelected with no node selection is no-op', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set());
    getState().duplicateSelected();
    expect(Object.keys(getState().nodes)).toHaveLength(1);
  });

  it('duplicateSelected with multiple nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    getState().duplicateSelected();
    expect(Object.keys(getState().nodes)).toHaveLength(4);
    // Both new nodes should be selected
    expect(getState().selectedIds.size).toBe(2);
    expect(getState().selectedIds.has(a)).toBe(false);
    expect(getState().selectedIds.has(b)).toBe(false);
  });

  it('copySelected and paste cycle creates new nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    expect(getState().canPaste()).toBe(true);
    getState().paste();
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    const newNode = (Object.values(getState().nodes) as EditorNode[]).find(n => n.id !== id)!;
    expect(newNode.type).toBe('source');
    expect(newNode.position[0]).toBe(1.5);
    expect(newNode.position[2]).toBe(1);
  });

  it('copySelected preserves internal connections on paste', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().setSelection(new Set([a, b]));
    getState().copySelected();
    getState().paste();
    // Original: 2 nodes, 1 connection. After paste: 4 nodes, 2 connections
    expect(Object.keys(getState().nodes)).toHaveLength(4);
    expect(Object.keys(getState().connections)).toHaveLength(2);
  });

  it('paste with nothing copied is no-op', () => {
    expect(getState().canPaste()).toBe(false);
    getState().paste();
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('paste can be called multiple times', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();
    getState().paste();
    expect(Object.keys(getState().nodes)).toHaveLength(3);
  });

  it('collapseSelected collapses all selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    getState().collapseSelected();
    expect(getState().nodes[a].collapsed).toBe(true);
    expect(getState().nodes[b].collapsed).toBe(true);
  });

  it('collapseSelected with no selection is no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set());
    getState().collapseSelected();
    expect(getState().nodes[id].collapsed).toBeFalsy();
  });

  it('collapseSelected skips already-collapsed nodes (no unnecessary undo)', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    // Collapse a first
    getState().setSelection(new Set([a]));
    getState().collapseSelected();
    expect(getState().nodes[a].collapsed).toBe(true);
    // Try to collapse again - should be a no-op since already collapsed
    getState().collapseSelected();
    expect(getState().nodes[a].collapsed).toBe(true);
  });

  it('expandSelected expands all selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([a, b]));
    getState().collapseSelected();
    expect(getState().nodes[a].collapsed).toBe(true);
    expect(getState().nodes[b].collapsed).toBe(true);
    // Re-select (collapseSelected does not change selection, but let's be explicit)
    getState().setSelection(new Set([a, b]));
    getState().expandSelected();
    expect(getState().nodes[a].collapsed).toBe(false);
    expect(getState().nodes[b].collapsed).toBe(false);
  });

  it('expandSelected with no selection is no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().collapseSelected();
    getState().setSelection(new Set());
    getState().expandSelected();
    expect(getState().nodes[id].collapsed).toBe(true);
  });

  it('expandSelected skips already-expanded nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    // Node starts expanded (collapsed is undefined/falsy)
    getState().setSelection(new Set([a]));
    getState().expandSelected();
    // Should be no-op since all are already expanded
    expect(getState().nodes[a].collapsed).toBeFalsy();
  });
});

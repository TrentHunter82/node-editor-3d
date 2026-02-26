/**
 * Unit tests for connectionSlice — connection CRUD, drawing workflow,
 * cycle detection, and metadata updates.
 *
 * Tests use direct slice-level mocking (mutable state + set/get) to validate
 * the createConnectionActions factory and the wouldCreateCycle helper in isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  wouldCreateCycle,
  connectionInitialState,
  createConnectionActions,
  type ConnectionActions,
} from './connectionSlice';
import type { EditorNode, Connection, InteractionMode, PendingConnection } from '../../types';

// ---------------------------------------------------------------------------
// Helpers — node factories
// ---------------------------------------------------------------------------

/** Source node: no inputs, one number output */
function makeSourceNode(id: string): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: 'Source',
    data: {},
    inputs: [],
    outputs: [{ id: `${id}-out-0`, label: 'value', portType: 'number' }],
  };
}

/** Transform node: one number input, one number output */
function makeTransformNode(id: string): EditorNode {
  return {
    id,
    type: 'transform',
    position: [2, 0, 0],
    title: 'Transform',
    data: {},
    inputs: [{ id: `${id}-in-0`, label: 'value', portType: 'number' }],
    outputs: [{ id: `${id}-out-0`, label: 'result', portType: 'number' }],
  };
}

/** Concat node: two string inputs, one string output */
function makeConcatNode(id: string): EditorNode {
  return {
    id,
    type: 'concat',
    position: [4, 0, 0],
    title: 'Concat',
    data: {},
    inputs: [
      { id: `${id}-in-0`, label: 'a', portType: 'string' },
      { id: `${id}-in-1`, label: 'b', portType: 'string' },
    ],
    outputs: [{ id: `${id}-out-0`, label: 'result', portType: 'string' }],
  };
}

/** Filter node: one 'any' input, one 'any' output (compatible with everything) */
function makeFilterNode(id: string): EditorNode {
  return {
    id,
    type: 'filter',
    position: [6, 0, 0],
    title: 'Filter',
    data: {},
    inputs: [{ id: `${id}-in-0`, label: 'in', portType: 'any' }],
    outputs: [{ id: `${id}-out-0`, label: 'out', portType: 'any' }],
  };
}

// ---------------------------------------------------------------------------
// Test harness — mutable state + set/get + mock helpers
// ---------------------------------------------------------------------------

interface TestState {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  selectedIds: Set<string>;
  interaction: InteractionMode;
  pendingConnection: PendingConnection | null;
  nearestSnapPort: { nodeId: string; portIndex: number } | null;
  hoveredMismatchPort: { nodeId: string; portIndex: number } | null;
  focusedPort: { nodeId: string; portIndex: number; side: 'input' | 'output' } | null;
  highlightedPorts: Set<string>;
  incompatibleNodeIds: Set<string>;
}

let state: TestState;
let actions: ConnectionActions;
let undoPushed: number;
let undoLabels: string[];
let nextConnId: number;
let invalidated: string[];
let mutatedCalled: number;

function buildActions() {
  const set = (fn: (s: TestState) => void) => {
    fn(state);
  };
  const get = (): any => ({
    ...state,
    addConnection: actions.addConnection,
    cancelConnection: actions.cancelConnection,
    startConnection: actions.startConnection,
  });
  const pushUndo = (label?: string) => {
    undoPushed++;
    if (label) undoLabels.push(label);
  };
  const genConnectionId = () => `conn-${nextConnId++}`;
  const getActiveExecutionCache = () => undefined;
  const invalidateDownstream = (nodeId: string) => {
    invalidated.push(nodeId);
  };
  const onConnectionMutated = () => {
    mutatedCalled++;
  };

  actions = createConnectionActions(
    set,
    get,
    pushUndo,
    genConnectionId,
    getActiveExecutionCache,
    invalidateDownstream,
    onConnectionMutated,
  );
}

function resetHarness() {
  undoPushed = 0;
  undoLabels = [];
  nextConnId = 1;
  invalidated = [];
  mutatedCalled = 0;
  state = {
    nodes: {
      src: makeSourceNode('src'),
      tfm: makeTransformNode('tfm'),
    },
    connections: {},
    selectedIds: new Set(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredMismatchPort: null,
    focusedPort: null,
    highlightedPorts: new Set(),
    incompatibleNodeIds: new Set(),
  };
  buildActions();
}

// ==========================================================================
// wouldCreateCycle
// ==========================================================================

describe('wouldCreateCycle', () => {
  it('returns false for empty connections', () => {
    expect(wouldCreateCycle({}, 'A', 'B')).toBe(false);
  });

  it('returns false when no path from toNode to fromNode', () => {
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
    };
    // Adding C -> D: would fromNode=C reach toNode=D? No existing path from D to C.
    // Actually: wouldCreateCycle checks if fromNodeId can reach toNodeId via existing connections.
    // When called as wouldCreateCycle(conns, fromNodeId, toNodeId), it BFS-traverses from
    // fromNodeId following connections and checks if it can reach toNodeId.
    // For addConnection(source, target), the call is wouldCreateCycle(conns, targetNodeId, sourceNodeId).
    // This means: can targetNode reach sourceNode? If yes, adding source->target creates a cycle.
    expect(wouldCreateCycle(conns, 'C', 'D')).toBe(false);
  });

  it('detects direct cycle (A->B exists, checking B->A)', () => {
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
    };
    // If we want to add B->A: the code calls wouldCreateCycle(conns, targetNodeId=A, sourceNodeId=B)
    // BFS from A: A -> (follows c1) -> B. Found toNodeId=B. Returns true.
    expect(wouldCreateCycle(conns, 'A', 'B')).toBe(true);
  });

  it('detects indirect cycle (A->B->C exists, checking C->A)', () => {
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'B', sourcePortIndex: 0, targetNodeId: 'C', targetPortIndex: 0 },
    };
    // Adding C->A: call wouldCreateCycle(conns, A, C)
    // BFS from A -> B -> C. Found C. Returns true.
    expect(wouldCreateCycle(conns, 'A', 'C')).toBe(true);
  });

  it('returns false for non-cyclic path (A->B exists, checking A->C)', () => {
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
    };
    // Adding A->C: call wouldCreateCycle(conns, C, A)
    // BFS from C: no outgoing connections from C. Never reaches A. Returns false.
    expect(wouldCreateCycle(conns, 'C', 'A')).toBe(false);
  });

  it('handles diamond-shaped DAGs without false positives', () => {
    //     A
    //    / \
    //   B   C
    //    \ /
    //     D
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'A', sourcePortIndex: 0, targetNodeId: 'B', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'A', sourcePortIndex: 1, targetNodeId: 'C', targetPortIndex: 0 },
      c3: { id: 'c3', sourceNodeId: 'B', sourcePortIndex: 0, targetNodeId: 'D', targetPortIndex: 0 },
      c4: { id: 'c4', sourceNodeId: 'C', sourcePortIndex: 0, targetNodeId: 'D', targetPortIndex: 1 },
    };
    // Adding E->A (E is disconnected) should not create cycle
    expect(wouldCreateCycle(conns, 'E', 'A')).toBe(false);
    // But adding D->A would create a cycle
    expect(wouldCreateCycle(conns, 'A', 'D')).toBe(true);
  });

  it('returns true for self-referencing path check', () => {
    // wouldCreateCycle(conns, 'A', 'A') — BFS from A, immediately checks if A === toNodeId
    expect(wouldCreateCycle({}, 'A', 'A')).toBe(true);
  });
});

// ==========================================================================
// connectionInitialState
// ==========================================================================

describe('connectionInitialState', () => {
  it('has null pendingConnection', () => {
    expect(connectionInitialState.pendingConnection).toBeNull();
  });
});

// ==========================================================================
// addConnection
// ==========================================================================

describe('addConnection', () => {
  beforeEach(resetHarness);

  it('creates a connection between compatible ports', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0);
    expect(id).toBe('conn-1');
    expect(state.connections['conn-1']).toBeDefined();
    expect(state.connections['conn-1'].sourceNodeId).toBe('src');
    expect(state.connections['conn-1'].sourcePortIndex).toBe(0);
    expect(state.connections['conn-1'].targetNodeId).toBe('tfm');
    expect(state.connections['conn-1'].targetPortIndex).toBe(0);
  });

  it('calls invalidateDownstream and onConnectionMutated after creating', () => {
    actions.addConnection('src', 0, 'tfm', 0);
    expect(invalidated).toContain('tfm');
    expect(mutatedCalled).toBe(1);
  });

  it('returns null for nonexistent source node', () => {
    const id = actions.addConnection('nonexistent', 0, 'tfm', 0);
    expect(id).toBeNull();
    expect(Object.keys(state.connections)).toHaveLength(0);
  });

  it('returns null for nonexistent target node', () => {
    const id = actions.addConnection('src', 0, 'nonexistent', 0);
    expect(id).toBeNull();
    expect(Object.keys(state.connections)).toHaveLength(0);
  });

  it('returns null for self-connection', () => {
    // Add a node that has both inputs and outputs
    state.nodes['both'] = makeTransformNode('both');
    buildActions();
    const id = actions.addConnection('both', 0, 'both', 0);
    expect(id).toBeNull();
  });

  it('returns null for out-of-range source port index (negative)', () => {
    const id = actions.addConnection('src', -1, 'tfm', 0);
    expect(id).toBeNull();
  });

  it('returns null for out-of-range source port index (too large)', () => {
    // src has 1 output (index 0)
    const id = actions.addConnection('src', 1, 'tfm', 0);
    expect(id).toBeNull();
  });

  it('returns null for out-of-range target port index (negative)', () => {
    const id = actions.addConnection('src', 0, 'tfm', -1);
    expect(id).toBeNull();
  });

  it('returns null for out-of-range target port index (too large)', () => {
    // tfm has 1 input (index 0)
    const id = actions.addConnection('src', 0, 'tfm', 1);
    expect(id).toBeNull();
  });

  it('returns null for duplicate connection', () => {
    const id1 = actions.addConnection('src', 0, 'tfm', 0);
    expect(id1).not.toBeNull();
    const id2 = actions.addConnection('src', 0, 'tfm', 0);
    expect(id2).toBeNull();
    expect(Object.keys(state.connections)).toHaveLength(1);
  });

  it('returns null when cycle would be created', () => {
    // Create chain: src -> tfm. Then try tfm -> src (would create cycle).
    // But src has no inputs so let's set up a more suitable scenario.
    state.nodes = {
      a: makeTransformNode('a'),
      b: makeTransformNode('b'),
    };
    buildActions();

    const id1 = actions.addConnection('a', 0, 'b', 0);
    expect(id1).not.toBeNull();

    // b -> a would create cycle (b reaches a is checked via wouldCreateCycle(conns, targetNodeId=a, sourceNodeId=b))
    // BFS from a: follows conn a->b, reaches b = sourceNodeId. True => cycle.
    const id2 = actions.addConnection('b', 0, 'a', 0);
    expect(id2).toBeNull();
  });

  it('returns null for incompatible port types (string output to number input)', () => {
    // concat has string output, tfm has number input
    state.nodes['cat'] = makeConcatNode('cat');
    buildActions();

    const id = actions.addConnection('cat', 0, 'tfm', 0);
    expect(id).toBeNull();
  });

  it('allows connection when one port type is any', () => {
    // filter has 'any' input, src has 'number' output
    state.nodes['flt'] = makeFilterNode('flt');
    buildActions();

    const id = actions.addConnection('src', 0, 'flt', 0);
    expect(id).not.toBeNull();
    expect(state.connections[id!]).toBeDefined();
  });

  it('does not push undo (addConnection does not push undo directly)', () => {
    actions.addConnection('src', 0, 'tfm', 0);
    expect(undoPushed).toBe(0);
  });

  it('increments connection ID for each new connection', () => {
    state.nodes['tfm2'] = makeTransformNode('tfm2');
    buildActions();

    const id1 = actions.addConnection('src', 0, 'tfm', 0);
    const id2 = actions.addConnection('src', 0, 'tfm2', 0);
    expect(id1).toBe('conn-1');
    expect(id2).toBe('conn-2');
  });
});

// ==========================================================================
// removeConnection
// ==========================================================================

describe('removeConnection', () => {
  beforeEach(resetHarness);

  it('removes an existing connection and pushes undo', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    expect(state.connections[id]).toBeDefined();
    undoPushed = 0;

    actions.removeConnection(id);
    expect(state.connections[id]).toBeUndefined();
    expect(undoPushed).toBe(1);
    expect(undoLabels).toContain('Remove connection');
  });

  it('removes connection from selectedIds', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    state.selectedIds.add(id);
    expect(state.selectedIds.has(id)).toBe(true);

    actions.removeConnection(id);
    expect(state.selectedIds.has(id)).toBe(false);
  });

  it('calls invalidateDownstream for the target node', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    invalidated = [];

    actions.removeConnection(id);
    expect(invalidated).toContain('tfm');
  });

  it('calls onConnectionMutated', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    mutatedCalled = 0;

    actions.removeConnection(id);
    expect(mutatedCalled).toBe(1);
  });

  it('no-ops for nonexistent connection', () => {
    actions.removeConnection('nonexistent');
    expect(undoPushed).toBe(0);
    expect(mutatedCalled).toBe(0);
  });
});

// ==========================================================================
// startConnection
// ==========================================================================

describe('startConnection', () => {
  beforeEach(resetHarness);

  it('sets pendingConnection and interaction to drawing-connection', () => {
    actions.startConnection('src', 0);
    expect(state.interaction).toBe('drawing-connection');
    expect(state.pendingConnection).not.toBeNull();
    expect(state.pendingConnection!.sourceNodeId).toBe('src');
    expect(state.pendingConnection!.sourcePortIndex).toBe(0);
    expect(state.pendingConnection!.cursorPos).toEqual([0, 0, 0]); // node position
  });

  it('no-ops for nonexistent node', () => {
    actions.startConnection('nonexistent', 0);
    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
  });

  it('no-ops for invalid port index (negative)', () => {
    actions.startConnection('src', -1);
    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
  });

  it('no-ops for invalid port index (too large)', () => {
    // src has 1 output (index 0 only)
    actions.startConnection('src', 1);
    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
  });

  it('uses the node position as initial cursor position', () => {
    state.nodes['src'].position = [10, 5, 3];
    buildActions();

    actions.startConnection('src', 0);
    expect(state.pendingConnection!.cursorPos).toEqual([10, 5, 3]);
  });
});

// ==========================================================================
// cancelConnection
// ==========================================================================

describe('cancelConnection', () => {
  beforeEach(resetHarness);

  it('resets interaction to idle and clears pendingConnection', () => {
    // Set up a pending connection first
    actions.startConnection('src', 0);
    expect(state.interaction).toBe('drawing-connection');
    expect(state.pendingConnection).not.toBeNull();

    actions.cancelConnection();
    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
  });

  it('clears nearestSnapPort', () => {
    state.nearestSnapPort = { nodeId: 'tfm', portIndex: 0 };
    actions.cancelConnection();
    expect(state.nearestSnapPort).toBeNull();
  });

  it('is safe to call when nothing is pending', () => {
    actions.cancelConnection();
    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
  });
});

// ==========================================================================
// completeConnection
// ==========================================================================

describe('completeConnection', () => {
  beforeEach(resetHarness);

  it('creates a connection from the pending source to the specified target', () => {
    actions.startConnection('src', 0);
    actions.completeConnection('tfm', 0);

    const conns = Object.values(state.connections);
    expect(conns).toHaveLength(1);
    expect(conns[0].sourceNodeId).toBe('src');
    expect(conns[0].sourcePortIndex).toBe(0);
    expect(conns[0].targetNodeId).toBe('tfm');
    expect(conns[0].targetPortIndex).toBe(0);
  });

  it('clears drawing state after successful connection', () => {
    actions.startConnection('src', 0);
    actions.completeConnection('tfm', 0);

    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
    expect(state.nearestSnapPort).toBeNull();
  });

  it('pushes undo with label', () => {
    actions.startConnection('src', 0);
    undoPushed = 0;
    undoLabels = [];

    actions.completeConnection('tfm', 0);
    expect(undoPushed).toBe(1);
    expect(undoLabels).toContain('Add connection');
  });

  it('cancels when no pendingConnection exists', () => {
    // No startConnection called
    actions.completeConnection('tfm', 0);
    expect(Object.keys(state.connections)).toHaveLength(0);
  });

  it('cancels for nonexistent target node', () => {
    actions.startConnection('src', 0);
    actions.completeConnection('nonexistent', 0);

    expect(Object.keys(state.connections)).toHaveLength(0);
    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
  });

  it('cancels for self-connection', () => {
    state.nodes['both'] = makeTransformNode('both');
    buildActions();

    actions.startConnection('both', 0);
    actions.completeConnection('both', 0);

    expect(Object.keys(state.connections)).toHaveLength(0);
    expect(state.interaction).toBe('idle');
  });

  it('cancels for incompatible port types', () => {
    state.nodes['cat'] = makeConcatNode('cat');
    buildActions();

    // src output is number, cat input is string
    actions.startConnection('src', 0);
    actions.completeConnection('cat', 0);

    expect(Object.keys(state.connections)).toHaveLength(0);
    expect(state.interaction).toBe('idle');
  });

  it('cancels for duplicate connection', () => {
    actions.addConnection('src', 0, 'tfm', 0);
    actions.startConnection('src', 0);
    actions.completeConnection('tfm', 0);

    // Only the original connection should exist
    expect(Object.keys(state.connections)).toHaveLength(1);
    expect(state.interaction).toBe('idle');
  });

  it('cancels when cycle would be created', () => {
    state.nodes = {
      a: makeTransformNode('a'),
      b: makeTransformNode('b'),
    };
    buildActions();

    // Create A -> B
    actions.addConnection('a', 0, 'b', 0);

    // Try to draw B -> A (cycle)
    actions.startConnection('b', 0);
    actions.completeConnection('a', 0);

    // Only the original connection should exist
    expect(Object.keys(state.connections)).toHaveLength(1);
    expect(state.interaction).toBe('idle');
  });

  it('replaces existing connection on the same input port (single-input enforcement)', () => {
    state.nodes['src2'] = makeSourceNode('src2');
    buildActions();

    // Connect src -> tfm[0]
    actions.addConnection('src', 0, 'tfm', 0);
    expect(Object.keys(state.connections)).toHaveLength(1);

    // Now draw src2 -> tfm[0]. Should replace the old connection.
    actions.startConnection('src2', 0);
    actions.completeConnection('tfm', 0);

    const conns = Object.values(state.connections);
    expect(conns).toHaveLength(1);
    expect(conns[0].sourceNodeId).toBe('src2');
    expect(conns[0].targetNodeId).toBe('tfm');
  });

  it('preserves metadata from old connection when reconnecting', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    // Set metadata on the old connection
    state.connections[id].label = 'my label';
    state.connections[id].colorOverride = '#ff0000';
    state.connections[id].styleOverride = 'bezier';

    // Draw a new source to the same target port
    state.nodes['src2'] = makeSourceNode('src2');
    buildActions();

    actions.startConnection('src2', 0);
    actions.completeConnection('tfm', 0);

    const conns = Object.values(state.connections);
    expect(conns).toHaveLength(1);
    expect(conns[0].label).toBe('my label');
    expect(conns[0].colorOverride).toBe('#ff0000');
    expect(conns[0].styleOverride).toBe('bezier');
  });

  it('calls invalidateDownstream and onConnectionMutated', () => {
    actions.startConnection('src', 0);
    invalidated = [];
    mutatedCalled = 0;

    actions.completeConnection('tfm', 0);
    expect(invalidated).toContain('tfm');
    expect(mutatedCalled).toBe(1);
  });

  it('cancels when source port index is out of range', () => {
    // Manually construct a pending connection with invalid sourcePortIndex
    state.interaction = 'drawing-connection';
    state.pendingConnection = {
      sourceNodeId: 'src',
      sourcePortIndex: 99,
      cursorPos: [0, 0, 0],
    };

    actions.completeConnection('tfm', 0);
    expect(Object.keys(state.connections)).toHaveLength(0);
    expect(state.interaction).toBe('idle');
  });

  it('cancels when target port index is out of range', () => {
    actions.startConnection('src', 0);
    actions.completeConnection('tfm', 99);
    expect(Object.keys(state.connections)).toHaveLength(0);
    expect(state.interaction).toBe('idle');
  });
});

// ==========================================================================
// disconnectAndReroute
// ==========================================================================

describe('disconnectAndReroute', () => {
  beforeEach(resetHarness);

  it('removes the connection and starts a new one from the same source', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    expect(state.connections[id]).toBeDefined();

    actions.disconnectAndReroute(id);

    // Connection should be removed
    expect(state.connections[id]).toBeUndefined();
    // A new pending connection should be started from the same source
    expect(state.interaction).toBe('drawing-connection');
    expect(state.pendingConnection).not.toBeNull();
    expect(state.pendingConnection!.sourceNodeId).toBe('src');
    expect(state.pendingConnection!.sourcePortIndex).toBe(0);
  });

  it('pushes undo with Reroute label', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    undoPushed = 0;
    undoLabels = [];

    actions.disconnectAndReroute(id);
    expect(undoPushed).toBe(1);
    expect(undoLabels).toContain('Reroute connection');
  });

  it('removes connection from selectedIds', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    state.selectedIds.add(id);

    actions.disconnectAndReroute(id);
    expect(state.selectedIds.has(id)).toBe(false);
  });

  it('calls invalidateDownstream for the target node', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    invalidated = [];

    actions.disconnectAndReroute(id);
    expect(invalidated).toContain('tfm');
  });

  it('calls onConnectionMutated', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    mutatedCalled = 0;

    actions.disconnectAndReroute(id);
    expect(mutatedCalled).toBe(1);
  });

  it('no-ops for nonexistent connection', () => {
    actions.disconnectAndReroute('nonexistent');
    expect(undoPushed).toBe(0);
    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
  });
});

// ==========================================================================
// updatePendingCursor
// ==========================================================================

describe('updatePendingCursor', () => {
  beforeEach(resetHarness);

  it('updates cursorPos on pendingConnection', () => {
    actions.startConnection('src', 0);
    actions.updatePendingCursor([5, 3, 1]);
    expect(state.pendingConnection!.cursorPos).toEqual([5, 3, 1]);
  });

  it('does nothing when no pending connection', () => {
    // Should not throw
    actions.updatePendingCursor([1, 2, 3]);
    expect(state.pendingConnection).toBeNull();
  });
});

// ==========================================================================
// updateConnectionLabel
// ==========================================================================

describe('updateConnectionLabel', () => {
  beforeEach(resetHarness);

  it('sets a label on an existing connection', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    undoPushed = 0;

    actions.updateConnectionLabel(id, 'My Label');
    expect(state.connections[id].label).toBe('My Label');
    expect(undoPushed).toBe(1);
    expect(undoLabels).toContain('Update connection label');
  });

  it('clears the label when undefined is passed', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    actions.updateConnectionLabel(id, 'A label');
    expect(state.connections[id].label).toBe('A label');

    actions.updateConnectionLabel(id, undefined);
    expect(state.connections[id].label).toBeUndefined();
  });

  it('no-ops for nonexistent connection', () => {
    undoPushed = 0;
    actions.updateConnectionLabel('nonexistent', 'label');
    expect(undoPushed).toBe(0);
  });
});

// ==========================================================================
// updateConnectionColor
// ==========================================================================

describe('updateConnectionColor', () => {
  beforeEach(resetHarness);

  it('sets a color override on an existing connection', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    undoPushed = 0;

    actions.updateConnectionColor(id, '#ff0000');
    expect(state.connections[id].colorOverride).toBe('#ff0000');
    expect(undoPushed).toBe(1);
    expect(undoLabels).toContain('Update connection color');
  });

  it('clears the color when undefined is passed', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    actions.updateConnectionColor(id, '#00ff00');
    expect(state.connections[id].colorOverride).toBe('#00ff00');

    actions.updateConnectionColor(id, undefined);
    expect(state.connections[id].colorOverride).toBeUndefined();
  });

  it('no-ops for nonexistent connection', () => {
    undoPushed = 0;
    actions.updateConnectionColor('nonexistent', '#aabbcc');
    expect(undoPushed).toBe(0);
  });
});

// ==========================================================================
// updateConnectionStyle
// ==========================================================================

describe('updateConnectionStyle', () => {
  beforeEach(resetHarness);

  it('sets a style override on an existing connection', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    undoPushed = 0;
    undoLabels = [];

    actions.updateConnectionStyle(id, 'bezier');
    expect(state.connections[id].styleOverride).toBe('bezier');
    expect(undoPushed).toBe(1);
    expect(undoLabels).toContain('Update connection style');
  });

  it('allows all valid style values', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    const styles: Array<'bezier' | 'straight' | 'right-angle' | 'organic'> = [
      'bezier', 'straight', 'right-angle', 'organic',
    ];
    for (const style of styles) {
      actions.updateConnectionStyle(id, style);
      expect(state.connections[id].styleOverride).toBe(style);
    }
  });

  it('clears the style when undefined is passed', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    actions.updateConnectionStyle(id, 'straight');
    expect(state.connections[id].styleOverride).toBe('straight');

    actions.updateConnectionStyle(id, undefined);
    expect(state.connections[id].styleOverride).toBeUndefined();
  });

  it('no-ops for nonexistent connection', () => {
    undoPushed = 0;
    actions.updateConnectionStyle('nonexistent', 'bezier');
    expect(undoPushed).toBe(0);
  });

  it('no-ops when the style is the same as current', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    actions.updateConnectionStyle(id, 'bezier');
    undoPushed = 0;

    // Same value again
    actions.updateConnectionStyle(id, 'bezier');
    expect(undoPushed).toBe(0);
  });

  it('no-ops when both current and new style are undefined', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    // styleOverride starts undefined
    undoPushed = 0;

    actions.updateConnectionStyle(id, undefined);
    expect(undoPushed).toBe(0);
  });
});

// ==========================================================================
// completeConnection with coercion callback
// ==========================================================================

describe('completeConnection with onCoercion', () => {
  beforeEach(() => {
    resetHarness();
  });

  it('invokes onCoercion for incompatible types when a coercion rule exists', () => {
    const coercionSpy = vi.fn().mockReturnValue(true);
    // Rebuild actions with onCoercion
    const set = (fn: (s: TestState) => void) => { fn(state); };
    const get = (): any => ({
      ...state,
      addConnection: actions.addConnection,
      cancelConnection: actions.cancelConnection,
      startConnection: actions.startConnection,
    });

    const actionsWithCoercion = createConnectionActions(
      set,
      get,
      () => { undoPushed++; },
      () => `conn-${nextConnId++}`,
      () => undefined,
      (nodeId: string) => { invalidated.push(nodeId); },
      () => { mutatedCalled++; },
      coercionSpy,
    );
    // Need to make actions reference the new set for cancelConnection/startConnection
    actions = actionsWithCoercion;

    // src has number output, cat has string input — incompatible but coercion exists (number->string)
    state.nodes['cat'] = makeConcatNode('cat');

    actions.startConnection('src', 0);
    actions.completeConnection('cat', 0);

    expect(coercionSpy).toHaveBeenCalledTimes(1);
    // The coercion callback receives (rule, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex)
    const call = coercionSpy.mock.calls[0];
    expect(call[1]).toBe('src');      // sourceNodeId
    expect(call[2]).toBe(0);          // sourcePortIndex
    expect(call[3]).toBe('cat');      // targetNodeId
    expect(call[4]).toBe(0);          // targetPortIndex
    // Drawing state should be cleared
    expect(state.interaction).toBe('idle');
    expect(state.pendingConnection).toBeNull();
  });
});

// ==========================================================================
// Edge cases and integration scenarios
// ==========================================================================

describe('connection edge cases', () => {
  beforeEach(resetHarness);

  it('allows multiple connections from the same output to different inputs', () => {
    state.nodes['tfm2'] = makeTransformNode('tfm2');
    buildActions();

    const id1 = actions.addConnection('src', 0, 'tfm', 0);
    const id2 = actions.addConnection('src', 0, 'tfm2', 0);
    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    expect(Object.keys(state.connections)).toHaveLength(2);
  });

  it('handles filter node (any type) connecting to any other type', () => {
    state.nodes['flt'] = makeFilterNode('flt');
    state.nodes['cat'] = makeConcatNode('cat');
    buildActions();

    // filter output (any) -> concat input (string) — should work because 'any' is compatible
    const id = actions.addConnection('flt', 0, 'cat', 0);
    expect(id).not.toBeNull();
  });

  it('connecting number output to any input works', () => {
    state.nodes['flt'] = makeFilterNode('flt');
    buildActions();

    const id = actions.addConnection('src', 0, 'flt', 0);
    expect(id).not.toBeNull();
  });

  it('three-node chain does not create false cycle detection', () => {
    state.nodes = {
      a: makeTransformNode('a'),
      b: makeTransformNode('b'),
      c: makeTransformNode('c'),
    };
    buildActions();

    const id1 = actions.addConnection('a', 0, 'b', 0);
    const id2 = actions.addConnection('b', 0, 'c', 0);
    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    expect(Object.keys(state.connections)).toHaveLength(2);
  });

  it('multiple operations preserve state consistency', () => {
    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    expect(Object.keys(state.connections)).toHaveLength(1);

    actions.updateConnectionLabel(id, 'test');
    actions.updateConnectionColor(id, '#abcdef');
    actions.updateConnectionStyle(id, 'organic');

    expect(state.connections[id].label).toBe('test');
    expect(state.connections[id].colorOverride).toBe('#abcdef');
    expect(state.connections[id].styleOverride).toBe('organic');

    // Remove it
    actions.removeConnection(id);
    expect(Object.keys(state.connections)).toHaveLength(0);
  });

  it('disconnectAndReroute followed by completeConnection creates new connection', () => {
    state.nodes['tfm2'] = makeTransformNode('tfm2');
    buildActions();

    const id = actions.addConnection('src', 0, 'tfm', 0)!;
    actions.disconnectAndReroute(id);

    // Now we should be in drawing mode from src:0
    expect(state.interaction).toBe('drawing-connection');
    expect(state.pendingConnection!.sourceNodeId).toBe('src');

    // Complete to a different target
    actions.completeConnection('tfm2', 0);

    const conns = Object.values(state.connections);
    expect(conns).toHaveLength(1);
    expect(conns[0].sourceNodeId).toBe('src');
    expect(conns[0].targetNodeId).toBe('tfm2');
    expect(state.interaction).toBe('idle');
  });
});

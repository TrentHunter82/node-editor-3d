/**
 * Unit tests for selectionSlice and connectionSlice.
 *
 * - selectionSlice: selection state, toggle, snap port, hovered connection,
 *   selectConnected (BFS upstream/downstream/both), boxSelect
 * - connectionSlice: wouldCreateCycle, addConnection, removeConnection,
 *   startConnection/completeConnection/cancelConnection, metadata updates
 *
 * Uses the same local-mutable-state pattern as slices.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectionInitialState,
  createSelectionActions,
  type SelectionState,
} from './selectionSlice';
import {
  wouldCreateCycle,
  createConnectionActions,
  type ConnectionActions,
} from './connectionSlice';
import type { EditorNode, Connection, InteractionMode, PendingConnection } from '../../types';

// ===========================================================================
// Helpers
// ===========================================================================

function makeNode(id: string, x: number, z: number): EditorNode {
  return {
    id,
    type: 'source',
    position: [x, 0, z],
    title: `Node ${id}`,
    data: {},
    inputs: [{ id: `${id}-in-0`, label: 'in', portType: 'number' }],
    outputs: [{ id: `${id}-out-0`, label: 'value', portType: 'number' }],
  };
}

function makeConnection(
  id: string,
  sourceNodeId: string,
  sourcePortIndex: number,
  targetNodeId: string,
  targetPortIndex: number,
): Connection {
  return { id, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex };
}

// ===========================================================================
// selectionInitialState
// ===========================================================================

describe('selectionInitialState', () => {
  it('has an empty selectedIds Set', () => {
    expect(selectionInitialState.selectedIds).toBeInstanceOf(Set);
    expect(selectionInitialState.selectedIds.size).toBe(0);
  });

  it('has null hoveredConnectionId', () => {
    expect(selectionInitialState.hoveredConnectionId).toBeNull();
  });

  it('has null nearestSnapPort', () => {
    expect(selectionInitialState.nearestSnapPort).toBeNull();
  });
});

// ===========================================================================
// createSelectionActions
// ===========================================================================

describe('createSelectionActions', () => {
  let state: SelectionState & {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
  };
  let actions: ReturnType<typeof createSelectionActions>;

  beforeEach(() => {
    state = {
      selectedIds: new Set<string>(),
      hoveredConnectionId: null,
      hoveredMismatchPort: null,
      nearestSnapPort: null,
      focusedPort: null,
      nodes: {},
      connections: {},
    };

    const set = (fn: (s: SelectionState) => void) => { fn(state); };
    const get = () => state;
    actions = createSelectionActions(set, get);
  });

  // -------------------------------------------------------------------------
  // setSelection
  // -------------------------------------------------------------------------

  describe('setSelection', () => {
    it('replaces the entire selection', () => {
      actions.setSelection(new Set(['a', 'b']));
      expect(state.selectedIds).toEqual(new Set(['a', 'b']));
    });

    it('clears previous selection when replacing', () => {
      state.selectedIds = new Set(['old']);
      actions.setSelection(new Set(['new']));
      expect(state.selectedIds.has('old')).toBe(false);
      expect(state.selectedIds.has('new')).toBe(true);
    });

    it('can set an empty selection', () => {
      state.selectedIds = new Set(['a']);
      actions.setSelection(new Set());
      expect(state.selectedIds.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // toggleSelection
  // -------------------------------------------------------------------------

  describe('toggleSelection', () => {
    it('adds an id that is not in the selection', () => {
      actions.toggleSelection('a');
      expect(state.selectedIds.has('a')).toBe(true);
    });

    it('removes an id that is already in the selection', () => {
      state.selectedIds.add('a');
      actions.toggleSelection('a');
      expect(state.selectedIds.has('a')).toBe(false);
    });

    it('preserves other selected ids when toggling', () => {
      state.selectedIds = new Set(['a', 'b']);
      actions.toggleSelection('a');
      expect(state.selectedIds.has('a')).toBe(false);
      expect(state.selectedIds.has('b')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // setNearestSnapPort
  // -------------------------------------------------------------------------

  describe('setNearestSnapPort', () => {
    it('sets the snap port', () => {
      actions.setNearestSnapPort({ nodeId: 'n1', portIndex: 2 });
      expect(state.nearestSnapPort).toEqual({ nodeId: 'n1', portIndex: 2 });
    });

    it('clears the snap port with null', () => {
      state.nearestSnapPort = { nodeId: 'n1', portIndex: 0 };
      actions.setNearestSnapPort(null);
      expect(state.nearestSnapPort).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // setHoveredConnection
  // -------------------------------------------------------------------------

  describe('setHoveredConnection', () => {
    it('sets the hovered connection id', () => {
      actions.setHoveredConnection('conn-1');
      expect(state.hoveredConnectionId).toBe('conn-1');
    });

    it('clears the hovered connection with null', () => {
      state.hoveredConnectionId = 'conn-1';
      actions.setHoveredConnection(null);
      expect(state.hoveredConnectionId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // selectConnected — upstream
  // -------------------------------------------------------------------------

  describe('selectConnected("upstream")', () => {
    it('selects upstream nodes via BFS (A->B->C, select C, expect A and B added)', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 2, 0),
        C: makeNode('C', 4, 0),
      };
      state.connections = {
        'c1': makeConnection('c1', 'A', 0, 'B', 0),
        'c2': makeConnection('c2', 'B', 0, 'C', 0),
      };
      state.selectedIds = new Set(['C']);

      actions.selectConnected('upstream');

      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(true);
      expect(state.selectedIds.has('C')).toBe(true);
    });

    it('does not select downstream nodes', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 2, 0),
        C: makeNode('C', 4, 0),
      };
      state.connections = {
        'c1': makeConnection('c1', 'A', 0, 'B', 0),
        'c2': makeConnection('c2', 'B', 0, 'C', 0),
      };
      state.selectedIds = new Set(['A']);

      actions.selectConnected('upstream');

      expect(state.selectedIds.has('A')).toBe(true);
      // B and C are downstream, not upstream
      expect(state.selectedIds.has('B')).toBe(false);
      expect(state.selectedIds.has('C')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // selectConnected — downstream
  // -------------------------------------------------------------------------

  describe('selectConnected("downstream")', () => {
    it('selects downstream nodes via BFS (A->B->C, select A, expect B and C added)', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 2, 0),
        C: makeNode('C', 4, 0),
      };
      state.connections = {
        'c1': makeConnection('c1', 'A', 0, 'B', 0),
        'c2': makeConnection('c2', 'B', 0, 'C', 0),
      };
      state.selectedIds = new Set(['A']);

      actions.selectConnected('downstream');

      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(true);
      expect(state.selectedIds.has('C')).toBe(true);
    });

    it('does not select upstream nodes', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 2, 0),
        C: makeNode('C', 4, 0),
      };
      state.connections = {
        'c1': makeConnection('c1', 'A', 0, 'B', 0),
        'c2': makeConnection('c2', 'B', 0, 'C', 0),
      };
      state.selectedIds = new Set(['C']);

      actions.selectConnected('downstream');

      expect(state.selectedIds.has('C')).toBe(true);
      // A and B are upstream, not downstream
      expect(state.selectedIds.has('A')).toBe(false);
      expect(state.selectedIds.has('B')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // selectConnected — both
  // -------------------------------------------------------------------------

  describe('selectConnected("both")', () => {
    it('selects both upstream and downstream (A->B->C, select B, expect A and C added)', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 2, 0),
        C: makeNode('C', 4, 0),
      };
      state.connections = {
        'c1': makeConnection('c1', 'A', 0, 'B', 0),
        'c2': makeConnection('c2', 'B', 0, 'C', 0),
      };
      state.selectedIds = new Set(['B']);

      actions.selectConnected('both');

      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(true);
      expect(state.selectedIds.has('C')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // selectConnected — no-op when nothing selected
  // -------------------------------------------------------------------------

  describe('selectConnected — no selection', () => {
    it('no-ops when no nodes are selected', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 2, 0),
      };
      state.connections = {
        'c1': makeConnection('c1', 'A', 0, 'B', 0),
      };
      state.selectedIds = new Set();

      actions.selectConnected('both');

      expect(state.selectedIds.size).toBe(0);
    });

    it('no-ops when only non-node ids are selected (e.g. connection ids)', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
      };
      state.connections = {};
      // selectedIds contains an id that is NOT in state.nodes
      state.selectedIds = new Set(['conn-123']);

      actions.selectConnected('both');

      // The original selectedIds are preserved but no new nodes are added
      expect(state.selectedIds.has('conn-123')).toBe(true);
      expect(state.selectedIds.has('A')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // selectConnected — diamond graph
  // -------------------------------------------------------------------------

  describe('selectConnected — diamond graph', () => {
    it('handles diamond graph (A->C, B->C) upstream from C', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 0, 2),
        C: makeNode('C', 4, 1),
      };
      state.connections = {
        'c1': makeConnection('c1', 'A', 0, 'C', 0),
        'c2': makeConnection('c2', 'B', 0, 'C', 0),
      };
      state.selectedIds = new Set(['C']);

      actions.selectConnected('upstream');

      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(true);
      expect(state.selectedIds.has('C')).toBe(true);
    });

    it('handles diamond graph (A->B, A->C, B->D, C->D) downstream from A', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 2, 0),
        C: makeNode('C', 2, 2),
        D: makeNode('D', 4, 1),
      };
      state.connections = {
        'c1': makeConnection('c1', 'A', 0, 'B', 0),
        'c2': makeConnection('c2', 'A', 0, 'C', 0),
        'c3': makeConnection('c3', 'B', 0, 'D', 0),
        'c4': makeConnection('c4', 'C', 0, 'D', 0),
      };
      state.selectedIds = new Set(['A']);

      actions.selectConnected('downstream');

      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(true);
      expect(state.selectedIds.has('C')).toBe(true);
      expect(state.selectedIds.has('D')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // boxSelect — non-additive
  // -------------------------------------------------------------------------

  describe('boxSelect (non-additive)', () => {
    it('selects only nodes within the bounding rectangle', () => {
      state.nodes = {
        A: makeNode('A', 1, 1),
        B: makeNode('B', 3, 3),
        C: makeNode('C', 10, 10),
      };
      state.selectedIds = new Set(['C']); // pre-existing selection

      actions.boxSelect(0, 0, 5, 5, false);

      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(true);
      // C is outside bounds and non-additive clears previous selection
      expect(state.selectedIds.has('C')).toBe(false);
    });

    it('clears previous selection when non-additive', () => {
      state.nodes = {
        A: makeNode('A', 1, 1),
        B: makeNode('B', 50, 50),
      };
      state.selectedIds = new Set(['B']);

      actions.boxSelect(0, 0, 5, 5, false);

      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // boxSelect — additive
  // -------------------------------------------------------------------------

  describe('boxSelect (additive)', () => {
    it('adds to existing selection', () => {
      state.nodes = {
        A: makeNode('A', 1, 1),
        B: makeNode('B', 3, 3),
        C: makeNode('C', 10, 10),
      };
      state.selectedIds = new Set(['C']); // pre-existing selection

      actions.boxSelect(0, 0, 5, 5, true);

      // A and B are in bounds
      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(true);
      // C was already selected and should remain
      expect(state.selectedIds.has('C')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // boxSelect — ignores nodes outside bounds
  // -------------------------------------------------------------------------

  describe('boxSelect — boundary behavior', () => {
    it('ignores nodes outside bounds', () => {
      state.nodes = {
        A: makeNode('A', -5, -5),
        B: makeNode('B', 100, 100),
      };

      actions.boxSelect(0, 0, 10, 10, false);

      expect(state.selectedIds.has('A')).toBe(false);
      expect(state.selectedIds.has('B')).toBe(false);
      expect(state.selectedIds.size).toBe(0);
    });

    it('includes nodes exactly on the boundary', () => {
      state.nodes = {
        A: makeNode('A', 0, 0),
        B: makeNode('B', 10, 10),
      };

      actions.boxSelect(0, 0, 10, 10, false);

      // Boundary is inclusive (>= minX, <= maxX, >= minZ, <= maxZ)
      expect(state.selectedIds.has('A')).toBe(true);
      expect(state.selectedIds.has('B')).toBe(true);
    });

    it('returns empty set when no nodes are in bounds', () => {
      state.nodes = {
        A: makeNode('A', 100, 100),
      };

      actions.boxSelect(0, 0, 5, 5, false);

      expect(state.selectedIds.size).toBe(0);
    });
  });
});

// ===========================================================================
// wouldCreateCycle (connectionSlice helper)
// ===========================================================================

describe('wouldCreateCycle', () => {
  it('returns true when a downstream path from fromNodeId reaches toNodeId', () => {
    // wouldCreateCycle does BFS from fromNodeId following downstream edges,
    // checking if it can reach toNodeId. This is used by addConnection which
    // calls wouldCreateCycle(conns, targetNodeId, sourceNodeId) — meaning
    // "from target, can we reach source downstream? If so, adding source->target
    // would create a cycle."
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'A', 0, 'B', 0),
      c2: makeConnection('c2', 'B', 0, 'C', 0),
    };
    // From A downstream: A -> B -> C. Can we reach C? Yes.
    // This means adding C -> A would create A -> B -> C -> A.
    expect(wouldCreateCycle(connections, 'A', 'C')).toBe(true);
  });

  it('returns false when no downstream path exists from fromNodeId to toNodeId', () => {
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'A', 0, 'B', 0),
    };
    // From C downstream: no edges. Cannot reach A.
    expect(wouldCreateCycle(connections, 'C', 'A')).toBe(false);
  });

  it('returns true for self-connection', () => {
    const connections: Record<string, Connection> = {};
    // fromNodeId === toNodeId => immediate cycle
    expect(wouldCreateCycle(connections, 'A', 'A')).toBe(true);
  });

  it('returns false with empty connections', () => {
    expect(wouldCreateCycle({}, 'A', 'B')).toBe(false);
  });

  it('detects cycle through longer chain', () => {
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'A', 0, 'B', 0),
      c2: makeConnection('c2', 'B', 0, 'C', 0),
      c3: makeConnection('c3', 'C', 0, 'D', 0),
    };
    // From A downstream: A -> B -> C -> D. Can we reach D? Yes.
    // This means adding D -> A would create A -> B -> C -> D -> A.
    expect(wouldCreateCycle(connections, 'A', 'D')).toBe(true);
    // From D downstream: no outgoing edges. Cannot reach A.
    expect(wouldCreateCycle(connections, 'D', 'A')).toBe(false);
  });
});

// ===========================================================================
// createConnectionActions
// ===========================================================================

describe('createConnectionActions', () => {
  let state: {
    connections: Record<string, Connection>;
    nodes: Record<string, EditorNode>;
    selectedIds: Set<string>;
    interaction: InteractionMode;
    pendingConnection: PendingConnection | null;
    nearestSnapPort: { nodeId: string; portIndex: number } | null;
    focusedPort: { nodeId: string; portIndex: number; side: 'input' | 'output' } | null;
    hoveredMismatchPort: { nodeId: string; portIndex: number } | null;
    highlightedPorts: Set<string>;
    incompatibleNodeIds: Set<string>;
  };
  let actions: ConnectionActions;
  let undoPushCount: number;
  let nextConnId: number;
  let invalidatedNodes: string[];
  let mutationCount: number;

  beforeEach(() => {
    state = {
      connections: {},
      nodes: {
        src: {
          id: 'src',
          type: 'source',
          position: [0, 0, 0],
          title: 'Source',
          data: {},
          inputs: [],
          outputs: [{ id: 'src-out-0', label: 'value', portType: 'number' }],
        },
        tgt: {
          id: 'tgt',
          type: 'output',
          position: [4, 0, 0],
          title: 'Target',
          data: {},
          inputs: [{ id: 'tgt-in-0', label: 'data', portType: 'number' }],
          outputs: [],
        },
      },
      selectedIds: new Set<string>(),
      interaction: 'idle',
      pendingConnection: null,
      nearestSnapPort: null,
      focusedPort: null,
      hoveredMismatchPort: null,
      highlightedPorts: new Set<string>(),
      incompatibleNodeIds: new Set<string>(),
    };
    undoPushCount = 0;
    nextConnId = 1;
    invalidatedNodes = [];
    mutationCount = 0;

    const set = (fn: (s: typeof state) => void) => { fn(state); };
    const get = (): any => ({
      ...state,
      addConnection: actions.addConnection,
      cancelConnection: actions.cancelConnection,
      startConnection: actions.startConnection,
    });
    const pushUndo = () => { undoPushCount++; };
    const genConnectionId = () => `conn-${nextConnId++}`;
    const getActiveExecutionCache = () => undefined;
    const invalidateDownstream = (nodeId: string) => { invalidatedNodes.push(nodeId); };
    const onConnectionMutated = () => { mutationCount++; };

    actions = createConnectionActions(
      set, get, pushUndo, genConnectionId,
      getActiveExecutionCache, invalidateDownstream, onConnectionMutated,
    );
  });

  // -------------------------------------------------------------------------
  // addConnection
  // -------------------------------------------------------------------------

  describe('addConnection', () => {
    it('creates a connection and returns its id', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0);
      expect(id).toBe('conn-1');
      expect(state.connections['conn-1']).toBeDefined();
      expect(state.connections['conn-1'].sourceNodeId).toBe('src');
      expect(state.connections['conn-1'].targetNodeId).toBe('tgt');
    });

    it('returns null for non-existent source node', () => {
      expect(actions.addConnection('nonexistent', 0, 'tgt', 0)).toBeNull();
    });

    it('returns null for non-existent target node', () => {
      expect(actions.addConnection('src', 0, 'nonexistent', 0)).toBeNull();
    });

    it('returns null for self-connections', () => {
      expect(actions.addConnection('src', 0, 'src', 0)).toBeNull();
    });

    it('returns null for out-of-range source port index', () => {
      expect(actions.addConnection('src', 5, 'tgt', 0)).toBeNull();
      expect(actions.addConnection('src', -1, 'tgt', 0)).toBeNull();
    });

    it('returns null for out-of-range target port index', () => {
      expect(actions.addConnection('src', 0, 'tgt', 5)).toBeNull();
      expect(actions.addConnection('src', 0, 'tgt', -1)).toBeNull();
    });

    it('returns null for incompatible port types', () => {
      // Add a node with a string input
      state.nodes['str-tgt'] = {
        id: 'str-tgt',
        type: 'concat',
        position: [6, 0, 0],
        title: 'String Target',
        data: {},
        inputs: [{ id: 'str-tgt-in-0', label: 'a', portType: 'string' }],
        outputs: [],
      };
      // src has number output, str-tgt has string input
      expect(actions.addConnection('src', 0, 'str-tgt', 0)).toBeNull();
    });

    it('returns null for duplicate connections', () => {
      actions.addConnection('src', 0, 'tgt', 0);
      expect(actions.addConnection('src', 0, 'tgt', 0)).toBeNull();
    });

    it('returns null when connection would create a cycle', () => {
      // Create A -> B, then trying B -> A should fail
      state.nodes['A'] = makeNode('A', 0, 0);
      state.nodes['B'] = makeNode('B', 2, 0);
      actions.addConnection('A', 0, 'B', 0);
      expect(actions.addConnection('B', 0, 'A', 0)).toBeNull();
    });

    it('calls invalidateDownstream on the target node', () => {
      actions.addConnection('src', 0, 'tgt', 0);
      expect(invalidatedNodes).toContain('tgt');
    });

    it('calls onConnectionMutated', () => {
      actions.addConnection('src', 0, 'tgt', 0);
      expect(mutationCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // removeConnection
  // -------------------------------------------------------------------------

  describe('removeConnection', () => {
    it('removes an existing connection', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      actions.removeConnection(id);
      expect(state.connections[id]).toBeUndefined();
    });

    it('pushes undo', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      undoPushCount = 0;
      actions.removeConnection(id);
      expect(undoPushCount).toBe(1);
    });

    it('removes the connection from selectedIds', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      state.selectedIds.add(id);
      actions.removeConnection(id);
      expect(state.selectedIds.has(id)).toBe(false);
    });

    it('no-ops for non-existent connection id', () => {
      undoPushCount = 0;
      actions.removeConnection('nonexistent');
      expect(undoPushCount).toBe(0);
    });

    it('calls invalidateDownstream on the target node', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      invalidatedNodes = [];
      actions.removeConnection(id);
      expect(invalidatedNodes).toContain('tgt');
    });
  });

  // -------------------------------------------------------------------------
  // startConnection
  // -------------------------------------------------------------------------

  describe('startConnection', () => {
    it('sets interaction to drawing-connection and creates pendingConnection', () => {
      actions.startConnection('src', 0);
      expect(state.interaction).toBe('drawing-connection');
      expect(state.pendingConnection).not.toBeNull();
      expect(state.pendingConnection!.sourceNodeId).toBe('src');
      expect(state.pendingConnection!.sourcePortIndex).toBe(0);
    });

    it('no-ops for non-existent node', () => {
      actions.startConnection('nonexistent', 0);
      expect(state.interaction).toBe('idle');
      expect(state.pendingConnection).toBeNull();
    });

    it('no-ops for out-of-range port index', () => {
      actions.startConnection('src', 5);
      expect(state.interaction).toBe('idle');
      expect(state.pendingConnection).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // cancelConnection
  // -------------------------------------------------------------------------

  describe('cancelConnection', () => {
    it('resets interaction to idle and clears pendingConnection and nearestSnapPort', () => {
      actions.startConnection('src', 0);
      state.nearestSnapPort = { nodeId: 'tgt', portIndex: 0 };

      actions.cancelConnection();

      expect(state.interaction).toBe('idle');
      expect(state.pendingConnection).toBeNull();
      expect(state.nearestSnapPort).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // updatePendingCursor
  // -------------------------------------------------------------------------

  describe('updatePendingCursor', () => {
    it('updates cursor position on the pending connection', () => {
      actions.startConnection('src', 0);
      actions.updatePendingCursor([5, 0, 3]);
      expect(state.pendingConnection!.cursorPos).toEqual([5, 0, 3]);
    });

    it('no-ops when there is no pending connection', () => {
      // Should not throw
      actions.updatePendingCursor([1, 2, 3]);
      expect(state.pendingConnection).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // completeConnection
  // -------------------------------------------------------------------------

  describe('completeConnection', () => {
    it('creates a connection and clears drawing state', () => {
      actions.startConnection('src', 0);
      actions.completeConnection('tgt', 0);

      expect(state.interaction).toBe('idle');
      expect(state.pendingConnection).toBeNull();
      expect(Object.keys(state.connections).length).toBe(1);
    });

    it('no-ops when there is no pending connection', () => {
      actions.completeConnection('tgt', 0);
      expect(Object.keys(state.connections).length).toBe(0);
    });

    it('cancels when target node does not exist', () => {
      actions.startConnection('src', 0);
      actions.completeConnection('nonexistent', 0);
      expect(state.interaction).toBe('idle');
      expect(state.pendingConnection).toBeNull();
      expect(Object.keys(state.connections).length).toBe(0);
    });

    it('replaces existing connection on same input port (single-input enforcement)', () => {
      // Add initial connection via addConnection
      const oldId = actions.addConnection('src', 0, 'tgt', 0)!;
      expect(state.connections[oldId]).toBeDefined();

      // Add a second source node
      state.nodes['src2'] = {
        id: 'src2',
        type: 'source',
        position: [0, 0, 4],
        title: 'Source 2',
        data: {},
        inputs: [],
        outputs: [{ id: 'src2-out-0', label: 'value', portType: 'number' }],
      };

      // Draw a new connection to the same target port
      actions.startConnection('src2', 0);
      actions.completeConnection('tgt', 0);

      // Old connection should be replaced
      expect(state.connections[oldId]).toBeUndefined();
      // New connection should exist
      const newConns = Object.values(state.connections);
      expect(newConns.length).toBe(1);
      expect(newConns[0].sourceNodeId).toBe('src2');
    });

    it('pushes undo on successful completion', () => {
      undoPushCount = 0;
      actions.startConnection('src', 0);
      actions.completeConnection('tgt', 0);
      expect(undoPushCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // disconnectAndReroute
  // -------------------------------------------------------------------------

  describe('disconnectAndReroute', () => {
    it('removes the connection and starts a new one from the same source', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      undoPushCount = 0;

      actions.disconnectAndReroute(id);

      expect(state.connections[id]).toBeUndefined();
      expect(state.interaction).toBe('drawing-connection');
      expect(state.pendingConnection!.sourceNodeId).toBe('src');
      expect(state.pendingConnection!.sourcePortIndex).toBe(0);
      expect(undoPushCount).toBe(1);
    });

    it('no-ops for non-existent connection', () => {
      undoPushCount = 0;
      actions.disconnectAndReroute('nonexistent');
      expect(undoPushCount).toBe(0);
      expect(state.interaction).toBe('idle');
    });
  });

  // -------------------------------------------------------------------------
  // updateConnectionLabel
  // -------------------------------------------------------------------------

  describe('updateConnectionLabel', () => {
    it('sets a label on the connection', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      actions.updateConnectionLabel(id, 'Data flow');
      expect(state.connections[id].label).toBe('Data flow');
    });

    it('clears the label with undefined', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      actions.updateConnectionLabel(id, 'Data flow');
      actions.updateConnectionLabel(id, undefined);
      expect(state.connections[id].label).toBeUndefined();
    });

    it('no-ops for non-existent connection', () => {
      undoPushCount = 0;
      actions.updateConnectionLabel('nonexistent', 'Label');
      expect(undoPushCount).toBe(0);
    });

    it('pushes undo', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      undoPushCount = 0;
      actions.updateConnectionLabel(id, 'New label');
      expect(undoPushCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // updateConnectionColor
  // -------------------------------------------------------------------------

  describe('updateConnectionColor', () => {
    it('sets a color override on the connection', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      actions.updateConnectionColor(id, '#ff0000');
      expect(state.connections[id].colorOverride).toBe('#ff0000');
    });

    it('clears the color with undefined', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      actions.updateConnectionColor(id, '#ff0000');
      actions.updateConnectionColor(id, undefined);
      expect(state.connections[id].colorOverride).toBeUndefined();
    });

    it('no-ops for non-existent connection', () => {
      undoPushCount = 0;
      actions.updateConnectionColor('nonexistent', '#ff0000');
      expect(undoPushCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // updateConnectionStyle
  // -------------------------------------------------------------------------

  describe('updateConnectionStyle', () => {
    it('sets a style override on the connection', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      actions.updateConnectionStyle(id, 'bezier');
      expect(state.connections[id].styleOverride).toBe('bezier');
    });

    it('clears the style with undefined', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      actions.updateConnectionStyle(id, 'straight');
      actions.updateConnectionStyle(id, undefined);
      expect(state.connections[id].styleOverride).toBeUndefined();
    });

    it('no-ops for non-existent connection', () => {
      undoPushCount = 0;
      actions.updateConnectionStyle('nonexistent', 'bezier');
      expect(undoPushCount).toBe(0);
    });

    it('no-ops when style is unchanged', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      actions.updateConnectionStyle(id, 'bezier');
      undoPushCount = 0;
      actions.updateConnectionStyle(id, 'bezier');
      expect(undoPushCount).toBe(0);
    });

    it('pushes undo on change', () => {
      const id = actions.addConnection('src', 0, 'tgt', 0)!;
      undoPushCount = 0;
      actions.updateConnectionStyle(id, 'right-angle');
      expect(undoPushCount).toBe(1);
    });
  });
});

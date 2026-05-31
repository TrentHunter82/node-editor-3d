/**
 * Unit tests for undoSlice — undo/redo stack management, snapshots,
 * inactive graph storage, and graph resource cleanup helpers.
 *
 * Uses the local mutable state pattern (same as other slice tests).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  takeSnapshot,
  pushUndo,
  getUndoStack,
  getRedoStack,
  getUndoMetaStack,
  getRedoMetaStack,
  getActiveUndoGraphId,
  setActiveUndoGraphId,
  clearAllUndoStacks,
  saveInactiveGraphsToUndo,
  markCreatedInactiveGraphs,
  collectInnerGraphIds,
  cleanupGraphResources,
  inactiveGraphs,
  createUndoActions,
  _resetUndoModuleState,
  type UndoActions,
} from './undoSlice';
import type { EditorNode, Connection, NodeGroup, CustomNodeDef, SubgraphNodeDef, CheckpointEntry, NodeType } from '../../types';

// ===========================================================================
// Helpers
// ===========================================================================

function makeNode(id: string, type: NodeType = 'source'): EditorNode {
  return {
    id,
    type,
    position: [0, 0, 0],
    title: `Node ${id}`,
    data: type === 'subgraph' ? { innerGraphId: `inner-${id}`, subgraphDefId: id } : {},
    inputs: [{ id: `${id}-in-0`, label: 'in', portType: 'number' }],
    outputs: [{ id: `${id}-out-0`, label: 'value', portType: 'number' }],
  };
}

function makeConnection(id: string, src: string, tgt: string): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: 0, targetNodeId: tgt, targetPortIndex: 0 };
}

function makeState() {
  return {
    nodes: { n1: makeNode('n1'), n2: makeNode('n2') } as Record<string, EditorNode>,
    connections: { c1: makeConnection('c1', 'n1', 'n2') } as Record<string, Connection>,
    groups: {} as Record<string, NodeGroup>,
    customNodeDefs: {} as Record<string, CustomNodeDef>,
    subgraphDefs: {} as Record<string, SubgraphNodeDef>,
    validationErrors: {} as Record<string, string[]>,
    checkpoints: {} as Record<string, CheckpointEntry>,
    graphVariables: {} as Record<string, unknown>,
  };
}

// ===========================================================================
// Setup
// ===========================================================================

beforeEach(() => {
  _resetUndoModuleState('default');
});

// ===========================================================================
// takeSnapshot
// ===========================================================================

describe('takeSnapshot', () => {
  it('creates a deep clone of state', () => {
    const state = makeState();
    const snap = takeSnapshot(state);

    expect(snap.nodes).toEqual(state.nodes);
    expect(snap.connections).toEqual(state.connections);
    // Verify deep clone (not same reference)
    expect(snap.nodes).not.toBe(state.nodes);
    expect(snap.connections).not.toBe(state.connections);
  });

  it('does not share node references between snapshot and original', () => {
    const state = makeState();
    const snap = takeSnapshot(state);

    // Mutate original
    state.nodes.n1.title = 'CHANGED';
    expect(snap.nodes.n1.title).toBe('Node n1');
  });

  it('includes all required fields', () => {
    const state = makeState();
    state.groups = { g1: { id: 'g1', label: 'Group', collapsed: false } };
    state.customNodeDefs = { cd1: { id: 'cd1', name: 'Custom', ports: { inputs: [], outputs: [] } } as unknown as CustomNodeDef };
    state.graphVariables = { x: 42 };

    const snap = takeSnapshot(state);

    expect(snap.groups).toEqual(state.groups);
    expect(snap.customNodeDefs).toEqual(state.customNodeDefs);
    expect(snap.graphVariables).toEqual({ x: 42 });
  });
});

// ===========================================================================
// pushUndo
// ===========================================================================

describe('pushUndo', () => {
  it('pushes a snapshot onto the undo stack', () => {
    const state = makeState();
    pushUndo(state, 'Test action');

    const stack = getUndoStack();
    expect(stack.length).toBe(1);
    expect(stack[0].nodes).toEqual(state.nodes);
  });

  it('stores metadata in the meta stack', () => {
    const state = makeState();
    pushUndo(state, 'Add node');

    const meta = getUndoMetaStack();
    expect(meta.length).toBe(1);
    expect(meta[0].label).toBe('Add node');
    expect(meta[0].nodeCount).toBe(2);
    expect(meta[0].connectionCount).toBe(1);
    expect(meta[0].timestamp).toBeGreaterThan(0);
  });

  it('defaults label to "Edit" when not provided', () => {
    pushUndo(makeState());
    expect(getUndoMetaStack()[0].label).toBe('Edit');
  });

  it('clears the redo stack on new push', () => {
    const state = makeState();
    pushUndo(state, 'Action 1');

    // Manually add something to redo stack
    getRedoStack().push(takeSnapshot(state));
    getRedoMetaStack().push({ label: 'Redo entry', timestamp: 0, nodeCount: 0, connectionCount: 0 });
    expect(getRedoStack().length).toBe(1);

    pushUndo(state, 'Action 2');
    expect(getRedoStack().length).toBe(0);
    expect(getRedoMetaStack().length).toBe(0);
  });

  it('enforces MAX_HISTORY limit (50)', () => {
    const state = makeState();
    for (let i = 0; i < 55; i++) {
      pushUndo(state, `Action ${i}`);
    }
    expect(getUndoStack().length).toBe(50);
    expect(getUndoMetaStack().length).toBe(50);
    // First entries should have been dropped
    expect(getUndoMetaStack()[0].label).toBe('Action 5');
  });
});

// ===========================================================================
// Per-graph stacks
// ===========================================================================

describe('per-graph undo stacks', () => {
  it('maintains separate stacks per graph ID', () => {
    const state = makeState();

    setActiveUndoGraphId('graph-a');
    pushUndo(state, 'A action');

    setActiveUndoGraphId('graph-b');
    pushUndo(state, 'B action');

    setActiveUndoGraphId('graph-a');
    expect(getUndoStack().length).toBe(1);
    expect(getUndoMetaStack()[0].label).toBe('A action');

    setActiveUndoGraphId('graph-b');
    expect(getUndoStack().length).toBe(1);
    expect(getUndoMetaStack()[0].label).toBe('B action');
  });

  it('getActiveUndoGraphId returns the set value', () => {
    setActiveUndoGraphId('custom-graph');
    expect(getActiveUndoGraphId()).toBe('custom-graph');
  });

  it('clearAllUndoStacks clears all graphs', () => {
    setActiveUndoGraphId('graph-a');
    pushUndo(makeState(), 'A');
    setActiveUndoGraphId('graph-b');
    pushUndo(makeState(), 'B');

    clearAllUndoStacks();

    setActiveUndoGraphId('graph-a');
    expect(getUndoStack().length).toBe(0);
    setActiveUndoGraphId('graph-b');
    expect(getUndoStack().length).toBe(0);
  });
});

// ===========================================================================
// saveInactiveGraphsToUndo / markCreatedInactiveGraphs
// ===========================================================================

describe('saveInactiveGraphsToUndo', () => {
  it('saves inactive graph data to the last undo entry', () => {
    const state = makeState();
    pushUndo(state, 'Before delete');

    // Set up an inactive graph
    inactiveGraphs['inner-1'] = {
      nodes: { n: makeNode('n') },
      connections: {},
      groups: {},
      customNodeDefs: {},
    };

    saveInactiveGraphsToUndo(['inner-1']);

    const stack = getUndoStack();
    expect(stack[0].savedInactiveGraphs).toBeDefined();
    expect(stack[0].savedInactiveGraphs!['inner-1']).toBeDefined();
  });

  it('no-ops when undo stack is empty', () => {
    inactiveGraphs['inner-1'] = {
      nodes: {},
      connections: {},
      groups: {},
      customNodeDefs: {},
    };

    // Should not throw
    saveInactiveGraphsToUndo(['inner-1']);
    expect(getUndoStack().length).toBe(0);
  });

  it('ignores IDs not in inactiveGraphs', () => {
    pushUndo(makeState(), 'Action');
    saveInactiveGraphsToUndo(['nonexistent']);
    expect(getUndoStack()[0].savedInactiveGraphs).toBeUndefined();
  });
});

describe('markCreatedInactiveGraphs', () => {
  it('records created graph IDs on the last undo entry', () => {
    const state = makeState();
    pushUndo(state, 'Duplicate subgraph');

    inactiveGraphs['new-inner'] = {
      nodes: {},
      connections: {},
      groups: {},
      customNodeDefs: {},
    };

    markCreatedInactiveGraphs(['new-inner']);

    const stack = getUndoStack();
    expect(stack[0].createdInactiveGraphs).toBeDefined();
    expect(stack[0].createdInactiveGraphs!['new-inner']).toBeDefined();
  });

  it('merges with existing createdInactiveGraphs', () => {
    pushUndo(makeState(), 'Action');

    inactiveGraphs['g1'] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };
    markCreatedInactiveGraphs(['g1']);

    inactiveGraphs['g2'] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };
    markCreatedInactiveGraphs(['g2']);

    const created = getUndoStack()[0].createdInactiveGraphs!;
    expect(Object.keys(created)).toContain('g1');
    expect(Object.keys(created)).toContain('g2');
  });
});

// ===========================================================================
// collectInnerGraphIds
// ===========================================================================

describe('collectInnerGraphIds', () => {
  it('collects inner graph IDs from subgraph nodes', () => {
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'subgraph'),
      n1: makeNode('n1', 'source'),
    };

    const ids = collectInnerGraphIds({ nodes });
    expect(ids).toContain('inner-s1');
  });

  it('recursively collects nested subgraph inner graph IDs', () => {
    // Set up nested subgraph: s1 -> inner-s1 contains s2 -> inner-s2
    inactiveGraphs['inner-s1'] = {
      nodes: { s2: makeNode('s2', 'subgraph') },
      connections: {},
      groups: {},
      customNodeDefs: {},
    };
    inactiveGraphs['inner-s2'] = {
      nodes: {},
      connections: {},
      groups: {},
      customNodeDefs: {},
    };

    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'subgraph'),
    };

    const ids = collectInnerGraphIds({ nodes });
    expect(ids).toContain('inner-s1');
    expect(ids).toContain('inner-s2');
  });

  it('returns empty array for undefined input', () => {
    expect(collectInnerGraphIds(undefined)).toEqual([]);
  });

  it('returns empty array when no subgraph nodes', () => {
    const ids = collectInnerGraphIds({ nodes: { n1: makeNode('n1') } });
    expect(ids).toEqual([]);
  });
});

// ===========================================================================
// cleanupGraphResources
// ===========================================================================

describe('cleanupGraphResources', () => {
  it('removes inactive graphs and undo stacks for given IDs', () => {
    inactiveGraphs['g1'] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };
    inactiveGraphs['g2'] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };

    // Push some undo entries for g1
    setActiveUndoGraphId('g1');
    pushUndo(makeState(), 'Action in g1');

    cleanupGraphResources(['g1']);

    expect(inactiveGraphs['g1']).toBeUndefined();
    expect(inactiveGraphs['g2']).toBeDefined();
    setActiveUndoGraphId('g1');
    expect(getUndoStack().length).toBe(0);
  });
});

// ===========================================================================
// createUndoActions
// ===========================================================================

describe('createUndoActions', () => {
  let state: ReturnType<typeof makeState> & {
    selectedIds: Set<string>;
    graphTabs: Record<string, unknown>;
    templates: Record<string, unknown>;
    undoRedoEvent: string;
  };
  let actions: UndoActions;
  let cancelCalled: number;
  let syncNextIdCalled: number;
  let clearTimeoutsCalled: number;
  let _clearTransientCalled: number;

  beforeEach(() => {
    _resetUndoModuleState('default');
    cancelCalled = 0;
    syncNextIdCalled = 0;
    clearTimeoutsCalled = 0;
    _clearTransientCalled = 0;

    state = {
      ...makeState(),
      selectedIds: new Set<string>(),
      graphTabs: {},
      templates: {},
      undoRedoEvent: '',
    };

    const set = (fn: (s: typeof state) => void) => { fn(state); };
    const get = () => state;

    actions = createUndoActions(set, get, {
      cancelAutoExecute: () => { cancelCalled++; },
      syncNextId: () => { syncNextIdCalled++; },
      clearExecutionTimeoutsAndCache: () => { clearTimeoutsCalled++; },
      clearAllTransientState: () => { _clearTransientCalled++; },
    });
  });

  describe('pushUndoSnapshot', () => {
    it('pushes current state to undo stack', () => {
      actions.pushUndoSnapshot('Test');
      expect(getUndoStack().length).toBe(1);
      expect(getUndoMetaStack()[0].label).toBe('Test');
    });
  });

  describe('canUndo / canRedo', () => {
    it('canUndo is false initially', () => {
      expect(actions.canUndo()).toBe(false);
    });

    it('canUndo is true after push', () => {
      actions.pushUndoSnapshot('A');
      expect(actions.canUndo()).toBe(true);
    });

    it('canRedo is false initially', () => {
      expect(actions.canRedo()).toBe(false);
    });
  });

  describe('undo', () => {
    it('restores the previous snapshot', () => {
      // Push state with n1, n2
      actions.pushUndoSnapshot('Initial');

      // Modify state
      state.nodes.n3 = makeNode('n3');

      // Undo
      actions.undo();

      // Should not have n3
      expect(state.nodes.n3).toBeUndefined();
      expect(Object.keys(state.nodes)).toEqual(['n1', 'n2']);
    });

    it('moves entry from undo to redo', () => {
      actions.pushUndoSnapshot('A');
      actions.undo();

      expect(actions.canUndo()).toBe(false);
      expect(actions.canRedo()).toBe(true);
    });

    it('calls cancelAutoExecute and clears timeouts', () => {
      actions.pushUndoSnapshot('A');
      actions.undo();

      expect(cancelCalled).toBe(1);
      expect(clearTimeoutsCalled).toBe(1);
    });

    it('calls syncNextId on undo', () => {
      actions.pushUndoSnapshot('A');
      actions.undo();
      expect(syncNextIdCalled).toBe(1);
    });

    it('clears selectedIds', () => {
      actions.pushUndoSnapshot('A');
      state.selectedIds = new Set(['n1']);
      actions.undo();
      expect(state.selectedIds.size).toBe(0);
    });

    it('sets undoRedoEvent string', () => {
      actions.pushUndoSnapshot('Delete');
      actions.undo();
      expect(state.undoRedoEvent).toMatch(/^undo:\d+:Delete$/);
    });

    it('no-ops when undo stack is empty', () => {
      const nodesBefore = { ...state.nodes };
      actions.undo();
      expect(state.nodes).toEqual(nodesBefore);
    });

    it('restores savedInactiveGraphs on undo', () => {
      actions.pushUndoSnapshot('Before delete');
      inactiveGraphs['inner-1'] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };
      saveInactiveGraphsToUndo(['inner-1']);
      delete inactiveGraphs['inner-1'];

      actions.undo();

      expect(inactiveGraphs['inner-1']).toBeDefined();
    });

    it('removes createdInactiveGraphs on undo', () => {
      actions.pushUndoSnapshot('Before create');
      inactiveGraphs['new-graph'] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };
      markCreatedInactiveGraphs(['new-graph']);

      actions.undo();

      expect(inactiveGraphs['new-graph']).toBeUndefined();
    });
  });

  describe('redo', () => {
    it('restores the undone state', () => {
      actions.pushUndoSnapshot('A');
      state.nodes.n3 = makeNode('n3');
      void { ...state.nodes };

      actions.pushUndoSnapshot('B');
      // Now undo to remove n3's snapshot
      actions.undo();
      // Redo should bring back the B state
      actions.redo();

      // After redo, state should have the nodes from the B snapshot (which had n1, n2, n3)
      expect(actions.canRedo()).toBe(false);
    });

    it('no-ops when redo stack is empty', () => {
      const nodesBefore = { ...state.nodes };
      actions.redo();
      expect(state.nodes).toEqual(nodesBefore);
    });

    it('sets undoRedoEvent string for redo', () => {
      actions.pushUndoSnapshot('Add');
      actions.undo();
      actions.redo();
      expect(state.undoRedoEvent).toMatch(/^redo:\d+:/);
    });
  });

  describe('getUndoHistory', () => {
    it('returns undo and redo meta arrays', () => {
      actions.pushUndoSnapshot('Action 1');
      actions.pushUndoSnapshot('Action 2');

      const history = actions.getUndoHistory();
      expect(history.undo.length).toBe(2);
      expect(history.undo[0].label).toBe('Action 1');
      expect(history.undo[1].label).toBe('Action 2');
      expect(history.redo.length).toBe(0);
    });

    it('returns copies (not references)', () => {
      actions.pushUndoSnapshot('A');
      const h1 = actions.getUndoHistory();
      const h2 = actions.getUndoHistory();
      expect(h1.undo).not.toBe(h2.undo);
    });
  });

  describe('getSnapshotSummary', () => {
    it('returns summary for undo entry', () => {
      actions.pushUndoSnapshot('Add node');
      const summary = actions.getSnapshotSummary(0);

      expect(summary).not.toBeNull();
      expect(summary!.label).toBe('Add node');
      expect(summary!.nodeCount).toBe(2);
      expect(summary!.connectionCount).toBe(1);
      expect(summary!.index).toBe(0);
    });

    it('returns current state summary for index -1', () => {
      const summary = actions.getSnapshotSummary(-1);
      expect(summary).not.toBeNull();
      expect(summary!.label).toBe('Current');
      expect(summary!.nodeCount).toBe(2);
    });

    it('returns null for out-of-range index', () => {
      expect(actions.getSnapshotSummary(99)).toBeNull();
      expect(actions.getSnapshotSummary(-2)).toBeNull();
    });
  });

  describe('diffUndoSnapshots', () => {
    it('returns null for invalid indices', () => {
      expect(actions.diffUndoSnapshots(99, 100)).toBeNull();
    });

    it('returns a diff between two snapshots', () => {
      // Push initial state
      actions.pushUndoSnapshot('Initial');

      // Add a node
      state.nodes.n3 = makeNode('n3');
      actions.pushUndoSnapshot('Added n3');

      const diff = actions.diffUndoSnapshots(0, 1);
      expect(diff).not.toBeNull();
      expect(diff!.snapshotA.label).toBe('Initial');
      expect(diff!.snapshotB.label).toBe('Added n3');
    });

    it('supports comparing with current state (index -1)', () => {
      actions.pushUndoSnapshot('Before');
      state.nodes.n3 = makeNode('n3');

      const diff = actions.diffUndoSnapshots(0, -1);
      expect(diff).not.toBeNull();
      expect(diff!.snapshotB.label).toBe('Current');
    });
  });

  describe('jumpToUndo', () => {
    it('jumps back multiple steps', () => {
      // Initial: n1, n2
      actions.pushUndoSnapshot('Step 1'); // undo[0] = {n1, n2}

      state.nodes.n3 = makeNode('n3');
      actions.pushUndoSnapshot('Step 2'); // undo[1] = {n1, n2, n3}

      state.nodes.n4 = makeNode('n4');
      actions.pushUndoSnapshot('Step 3'); // undo[2] = {n1, n2, n3, n4}

      state.nodes.n5 = makeNode('n5');
      // Current state: {n1, n2, n3, n4, n5}

      // jumpToUndo(0) with 3-entry stack:
      //   - pushes current + intermediate to redo
      //   - pops target (entry at index 1) and restores it
      //   - leaves entry at index 0 on undo stack
      actions.jumpToUndo(0);

      // Restored to undo[1] = {n1, n2, n3}
      expect(state.nodes.n3).toBeDefined();
      expect(state.nodes.n4).toBeUndefined();
      expect(state.nodes.n5).toBeUndefined();
      expect(Object.keys(state.nodes).sort()).toEqual(['n1', 'n2', 'n3']);
    });

    it('pushes intermediate states onto redo', () => {
      actions.pushUndoSnapshot('Step 1');
      actions.pushUndoSnapshot('Step 2');
      actions.pushUndoSnapshot('Step 3');

      actions.jumpToUndo(0);

      // Should be able to redo multiple times
      expect(actions.canRedo()).toBe(true);
    });

    it('no-ops for invalid target index', () => {
      actions.pushUndoSnapshot('A');
      const before = { ...state.nodes };
      actions.jumpToUndo(-1);
      expect(state.nodes).toEqual(before);
      actions.jumpToUndo(99);
      expect(state.nodes).toEqual(before);
    });

    it('no-ops when stepsBack is 0', () => {
      actions.pushUndoSnapshot('A');
      const stackBefore = getUndoStack().length;
      // targetIndex = stack.length - 1 means stepsBack = 0
      actions.jumpToUndo(getUndoStack().length - 1);
      expect(getUndoStack().length).toBe(stackBefore);
    });
  });
});

// ===========================================================================
// _resetUndoModuleState
// ===========================================================================

describe('_resetUndoModuleState', () => {
  it('clears all stacks and resets active graph ID', () => {
    setActiveUndoGraphId('graph-a');
    pushUndo(makeState(), 'Action');

    _resetUndoModuleState('new-default');

    expect(getActiveUndoGraphId()).toBe('new-default');
    setActiveUndoGraphId('graph-a');
    expect(getUndoStack().length).toBe(0);
  });

  it('clears inactiveGraphs', () => {
    inactiveGraphs['g1'] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };
    _resetUndoModuleState('default');
    expect(inactiveGraphs['g1']).toBeUndefined();
  });
});

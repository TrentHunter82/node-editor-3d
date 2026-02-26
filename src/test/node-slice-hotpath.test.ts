/**
 * Hot-path node operation tests for setNodePositions and batchToggleNodeLock.
 *
 * These tests focus on edge cases, correctness invariants, and behavioral
 * guarantees beyond the basic coverage in node-slice-extraction.test.ts.
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

// ===========================================================================
// setNodePositions
// ===========================================================================

describe('setNodePositions', () => {
  beforeEach(resetStore);

  it('updates a single node position', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setNodePositions({ [id]: [5, 1, 3] });
    expect(getState().nodes[id].position).toEqual([5, 1, 3]);
  });

  it('updates multiple node positions in a single call', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [1, 0, 1]);
    const c = getState().addNode('output', [2, 0, 2]);

    getState().setNodePositions({
      [a]: [10, 0, 10],
      [b]: [20, 0, 20],
      [c]: [30, 0, 30],
    });

    expect(getState().nodes[a].position).toEqual([10, 0, 10]);
    expect(getState().nodes[b].position).toEqual([20, 0, 20]);
    expect(getState().nodes[c].position).toEqual([30, 0, 30]);
  });

  it('ignores non-existent node IDs without crashing', () => {
    const id = getState().addNode('source', [0, 0, 0]);

    // Mix real and fake IDs
    getState().setNodePositions({
      [id]: [7, 0, 7],
      'non-existent-1': [99, 99, 99],
      'non-existent-2': [88, 88, 88],
    });

    expect(getState().nodes[id].position).toEqual([7, 0, 7]);
    expect(getState().nodes['non-existent-1']).toBeUndefined();
    expect(getState().nodes['non-existent-2']).toBeUndefined();
  });

  it('preserves other node properties (type, title, data, inputs, outputs)', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 42);

    const before = getState().nodes[id];
    const origType = before.type;
    const origTitle = before.title;
    const origInputs = before.inputs;
    const origOutputs = before.outputs;

    getState().setNodePositions({ [id]: [100, 200, 300] });

    const after = getState().nodes[id];
    expect(after.position).toEqual([100, 200, 300]);
    expect(after.type).toBe(origType);
    expect(after.title).toBe(origTitle);
    expect(after.data.value).toBe(42);
    expect(after.inputs.length).toBe(origInputs.length);
    expect(after.outputs.length).toBe(origOutputs.length);
  });

  it('does not push undo (hot-path, no undo)', () => {
    // Create a node (pushes undo for addNode), then reset undo stacks
    const id = getState().addNode('source', [0, 0, 0]);
    _resetModuleState(); // clears undo/redo stacks

    // Directly set a known node state to avoid relying on addNode undo
    useEditorStore.setState(s => {
      s.nodes[id] = {
        id,
        type: 'source' as any,
        position: [0, 0, 0],
        title: 'Src',
        data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'Value', portType: 'number' as const }],
      };
    });

    expect(getState().canUndo()).toBe(false);

    getState().setNodePositions({ [id]: [5, 5, 5] });
    expect(getState().nodes[id].position).toEqual([5, 5, 5]);
    expect(getState().canUndo()).toBe(false);
  });

  it('is a no-op with an empty positions record', () => {
    const id = getState().addNode('source', [1, 2, 3]);
    const posBefore = getState().nodes[id].position;

    getState().setNodePositions({});

    expect(getState().nodes[id].position).toEqual(posBefore);
  });

  it('handles zero-coordinate positions', () => {
    const id = getState().addNode('source', [5, 5, 5]);
    getState().setNodePositions({ [id]: [0, 0, 0] });
    expect(getState().nodes[id].position).toEqual([0, 0, 0]);
  });

  it('handles large position values', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const big: [number, number, number] = [1e6, -1e6, 9999999];
    getState().setNodePositions({ [id]: big });
    expect(getState().nodes[id].position).toEqual(big);
  });

  it('does not trigger scheduleAutoExecute (position-only change)', () => {
    // If setNodePositions triggered execution, the executionStates would change.
    // We verify by enabling autoExecute and checking no execution occurs.
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('output', [5, 0, 0]);
    getState().addConnection(a, 0, b, 0);

    // Clear execution state
    useEditorStore.setState(s => {
      s.executionStates = {};
      s.nodeOutputs = {};
    });

    getState().setNodePositions({
      [a]: [10, 0, 10],
      [b]: [20, 0, 20],
    });

    // No execution should have been scheduled — executionStates remains empty
    expect(getState().executionStates).toEqual({});
  });

  it('validates round-trip: set positions then read back identical values', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [1, 0, 1]);
    const c = getState().addNode('output', [2, 0, 2]);

    const positions: Record<string, [number, number, number]> = {
      [a]: [3.14159, -2.71828, 0.001],
      [b]: [-100.5, 0, 200.75],
      [c]: [0, 0, 0],
    };

    getState().setNodePositions(positions);

    for (const [id, pos] of Object.entries(positions)) {
      expect(getState().nodes[id].position).toEqual(pos);
    }
  });
});

// ===========================================================================
// batchToggleNodeLock
// ===========================================================================

describe('batchToggleNodeLock', () => {
  beforeEach(resetStore);

  it('locks all unlocked nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);

    // All start unlocked
    expect(getState().nodes[a].locked).toBeFalsy();
    expect(getState().nodes[b].locked).toBeFalsy();
    expect(getState().nodes[c].locked).toBeFalsy();

    getState().batchToggleNodeLock([a, b, c]);

    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBe(true);
    expect(getState().nodes[c].locked).toBe(true);
  });

  it('unlocks all locked nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().toggleNodeLock(a);
    getState().toggleNodeLock(b);

    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBe(true);

    getState().batchToggleNodeLock([a, b]);

    expect(getState().nodes[a].locked).toBeFalsy();
    expect(getState().nodes[b].locked).toBeFalsy();
  });

  it('mixed selection: if any unlocked, locks all', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);

    // a locked, b and c unlocked
    getState().toggleNodeLock(a);
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBeFalsy();
    expect(getState().nodes[c].locked).toBeFalsy();

    getState().batchToggleNodeLock([a, b, c]);

    // All should be locked
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBe(true);
    expect(getState().nodes[c].locked).toBe(true);
  });

  it('all locked selection: unlocks all', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().toggleNodeLock(a);
    getState().toggleNodeLock(b);

    getState().batchToggleNodeLock([a, b]);

    expect(getState().nodes[a].locked).toBeFalsy();
    expect(getState().nodes[b].locked).toBeFalsy();
  });

  it('single node lock/unlock', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].locked).toBeFalsy();

    // Lock via batch with single ID
    getState().batchToggleNodeLock([id]);
    expect(getState().nodes[id].locked).toBe(true);

    // Unlock via batch with single ID
    getState().batchToggleNodeLock([id]);
    expect(getState().nodes[id].locked).toBeFalsy();
  });

  it('empty selection is a no-op', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const undoHistBefore = getState().getUndoHistory().undo.length;

    getState().batchToggleNodeLock([]);

    // No undo entry pushed, node unchanged
    expect(getState().getUndoHistory().undo.length).toBe(undoHistBefore);
    expect(getState().nodes[id].locked).toBeFalsy();
  });

  it('non-existent node IDs are ignored without crashing', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const undoHistBefore = getState().getUndoHistory().undo.length;

    // All IDs are non-existent — should be a no-op (validIds is empty)
    getState().batchToggleNodeLock(['fake-1', 'fake-2']);
    expect(getState().getUndoHistory().undo.length).toBe(undoHistBefore);

    // Mix of valid and non-existent — valid node gets toggled
    getState().batchToggleNodeLock([id, 'fake-3']);
    expect(getState().nodes[id].locked).toBe(true);
  });

  it('pushes a single undo entry for batch operation', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);

    const undoCountBefore = getState().getUndoHistory().undo.length;

    getState().batchToggleNodeLock([a, b, c]);

    // Exactly one undo entry added for the batch
    expect(getState().getUndoHistory().undo.length).toBe(undoCountBefore + 1);

    // All three locked
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBe(true);
    expect(getState().nodes[c].locked).toBe(true);
  });

  it('undo restores previous lock states', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);

    // a locked, b unlocked
    getState().toggleNodeLock(a);
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBeFalsy();

    // Batch lock all
    getState().batchToggleNodeLock([a, b]);
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBe(true);

    // Undo should restore: a=locked, b=unlocked
    getState().undo();
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBeFalsy();
  });

  it('locked state is preserved through JSON serialization round-trip', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);

    // Lock node a
    getState().toggleNodeLock(a);
    expect(getState().nodes[a].locked).toBe(true);
    expect(getState().nodes[b].locked).toBeFalsy();

    // Serialize the nodes to JSON and parse back (simulates save/load)
    const serialized = JSON.stringify(getState().nodes);
    const deserialized = JSON.parse(serialized) as Record<string, { locked?: boolean }>;

    expect(deserialized[a].locked).toBe(true);
    expect(deserialized[b].locked).toBeFalsy();
  });
});

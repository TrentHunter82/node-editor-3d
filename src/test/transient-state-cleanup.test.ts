/**
 * Transient state cleanup tests (~20 tests).
 * Verifies clearExecutionTransientState clears all execution fields,
 * and all graph-context-switch paths properly reset transient state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { clearExecutionTransientState } from '../store/slices/executionSlice';
import type { ExecutionSliceState } from '../store/slices/executionSlice';

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

/** Inject fake transient state to test cleanup */
function injectTransientState() {
  useEditorStore.setState(s => {
    s.executionStates = { 'node-1': 'complete' as any };
    s.nodeOutputs = { 'node-1': { 0: 42 } };
    s.executionErrors = { 'node-1': 'test error' };
    s.isExecuting = true;
    s.executionMetrics = { 'node-1': { duration: 10, cached: false } as any };
    s.executionTimings = { 'node-1': 10 };
    s.executionTotalDuration = 50;
    s.executionMaxNodeDuration = 10;
    s.executionTimedOut = true;
    s.traceNodeId = 'node-1';
  });
}

/** Verify all transient state is cleared */
function expectTransientStateCleared() {
  const state = getState();
  expect(Object.keys(state.executionStates)).toHaveLength(0);
  expect(Object.keys(state.nodeOutputs)).toHaveLength(0);
  expect(Object.keys(state.executionErrors)).toHaveLength(0);
  expect(state.isExecuting).toBe(false);
  expect(Object.keys(state.executionMetrics)).toHaveLength(0);
  expect(Object.keys(state.executionTimings)).toHaveLength(0);
  expect(state.executionTotalDuration).toBe(0);
  expect(state.executionMaxNodeDuration).toBe(0);
  expect(state.executionTimedOut).toBe(false);
}

// ---------------------------------------------------------------------------
// 1. clearExecutionTransientState direct tests
// ---------------------------------------------------------------------------

describe('clearExecutionTransientState direct tests', () => {
  beforeEach(resetStore);

  it('clears all core execution fields (executionStates, nodeOutputs, executionErrors, isExecuting, executionMetrics, executionTimings)', () => {
    injectTransientState();
    // Verify injected state is present
    expect(Object.keys(getState().executionStates).length).toBeGreaterThan(0);
    expect(Object.keys(getState().nodeOutputs).length).toBeGreaterThan(0);
    expect(Object.keys(getState().executionErrors).length).toBeGreaterThan(0);
    expect(getState().isExecuting).toBe(true);
    expect(Object.keys(getState().executionMetrics).length).toBeGreaterThan(0);
    expect(Object.keys(getState().executionTimings).length).toBeGreaterThan(0);

    // Apply clearExecutionTransientState via set callback
    useEditorStore.setState(s => {
      clearExecutionTransientState(s as unknown as ExecutionSliceState);
    });

    expectTransientStateCleared();
  });

  it('clears timing fields (executionTotalDuration, executionMaxNodeDuration)', () => {
    useEditorStore.setState(s => {
      s.executionTotalDuration = 123.45;
      s.executionMaxNodeDuration = 67.89;
    });
    expect(getState().executionTotalDuration).toBe(123.45);
    expect(getState().executionMaxNodeDuration).toBe(67.89);

    useEditorStore.setState(s => {
      clearExecutionTransientState(s as unknown as ExecutionSliceState);
    });

    expect(getState().executionTotalDuration).toBe(0);
    expect(getState().executionMaxNodeDuration).toBe(0);
  });

  it('clears debug fields (pausedAtWave, debugWaves)', () => {
    useEditorStore.setState(s => {
      s.pausedAtWave = 3;
      s.debugWaves = [['node-1'], ['node-2', 'node-3']];
    });
    expect(getState().pausedAtWave).toBe(3);
    expect(getState().debugWaves).toHaveLength(2);

    useEditorStore.setState(s => {
      clearExecutionTransientState(s as unknown as ExecutionSliceState);
    });

    expect(getState().pausedAtWave).toBe(-1);
    expect(getState().debugWaves).toHaveLength(0);
  });

  it('sets executionTimedOut to false', () => {
    useEditorStore.setState(s => {
      s.executionTimedOut = true;
    });
    expect(getState().executionTimedOut).toBe(true);

    useEditorStore.setState(s => {
      clearExecutionTransientState(s as unknown as ExecutionSliceState);
    });

    expect(getState().executionTimedOut).toBe(false);
  });

  it('preserves breakpoints and breakpointConditions (these are NOT cleared)', () => {
    // Add a node so toggleBreakpoint can find it
    const nodeId = getState().addNode('source', [0, 0, 0]);

    useEditorStore.setState(s => {
      s.breakpoints = { [nodeId]: true };
      s.breakpointConditions = { [nodeId]: 'out0 > 5' };
    });
    // Also inject transient state
    injectTransientState();

    useEditorStore.setState(s => {
      clearExecutionTransientState(s as unknown as ExecutionSliceState);
    });

    // Breakpoints and conditions should be preserved
    expect(getState().breakpoints[nodeId]).toBe(true);
    expect(getState().breakpointConditions[nodeId]).toBe('out0 > 5');
    // But transient state should be cleared
    expectTransientStateCleared();
  });
});

// ---------------------------------------------------------------------------
// 2. Undo clears transient state
// ---------------------------------------------------------------------------

describe('Undo clears transient state', () => {
  beforeEach(resetStore);

  it('after injecting transient state, undo clears it', () => {
    // addNode pushes an undo entry
    getState().addNode('source', [0, 0, 0]);
    expect(getState().canUndo()).toBe(true);

    // Inject transient execution state
    injectTransientState();

    // Undo should clear transient state
    getState().undo();
    expectTransientStateCleared();
  });

  it('after undo, traceNodeId is null', () => {
    getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState(s => { s.traceNodeId = 'node-1'; });
    expect(getState().traceNodeId).toBe('node-1');

    getState().undo();
    expect(getState().traceNodeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Redo clears transient state
// ---------------------------------------------------------------------------

describe('Redo clears transient state', () => {
  beforeEach(resetStore);

  it('after injecting transient state, redo clears it', () => {
    // Create an undo entry, then undo to create a redo entry
    getState().addNode('source', [0, 0, 0]);
    getState().undo();
    expect(getState().canRedo()).toBe(true);

    // Inject transient state after undo
    injectTransientState();

    // Redo should clear transient state
    getState().redo();
    expectTransientStateCleared();
  });

  it('after redo, interaction is idle', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().undo();
    expect(getState().canRedo()).toBe(true);

    // Set interaction to something non-idle
    useEditorStore.setState(s => { s.interaction = 'dragging-node'; });

    getState().redo();
    expect(getState().interaction).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// 4. clearGraph clears transient state
// ---------------------------------------------------------------------------

describe('clearGraph clears transient state', () => {
  beforeEach(resetStore);

  it('clearGraph clears all transient execution state', () => {
    // Add a node so clearGraph has something to clear
    getState().addNode('source', [0, 0, 0]);
    injectTransientState();

    getState().clearGraph();
    expectTransientStateCleared();
  });

  it('clearGraph also clears graphVariables (since entire graph is replaced)', () => {
    getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState(s => {
      s.graphVariables = { counter: 10, name: 'test' };
    });
    expect(Object.keys(getState().graphVariables).length).toBeGreaterThan(0);

    getState().clearGraph();
    expect(Object.keys(getState().graphVariables)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. switchGraph clears transient state
// ---------------------------------------------------------------------------

describe('switchGraph clears transient state', () => {
  beforeEach(resetStore);

  it('create second graph, switchGraph clears transient state for the new graph', () => {
    // Create a second graph tab (createGraph auto-switches to it)
    const g2 = getState().createGraph('Graph 2');
    // Switch back to default so we can inject transient state and then switch to g2
    getState().switchGraph('default');

    // Inject transient state while on default graph
    injectTransientState();

    // Switch to the second graph
    getState().switchGraph(g2);

    // Transient state should be cleared upon entering the new graph
    expectTransientStateCleared();
  });

  it('after switchGraph, pendingConnection is null', () => {
    // Create second graph and switch back to default
    const g2 = getState().createGraph('Graph 2');
    getState().switchGraph('default');

    // Set a pending connection on default graph
    useEditorStore.setState(s => {
      s.pendingConnection = {
        sourceNodeId: 'node-1',
        sourcePortIndex: 0,
        mousePosition: [0, 0, 0],
      } as any;
    });
    expect(getState().pendingConnection).not.toBeNull();

    getState().switchGraph(g2);
    expect(getState().pendingConnection).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. importWorkflow clears transient state
// ---------------------------------------------------------------------------

describe('importWorkflow clears transient state', () => {
  beforeEach(resetStore);

  it('importWorkflow resets execution state', () => {
    getState().addNode('source', [0, 0, 0]);
    injectTransientState();

    getState().importWorkflow({ nodes: {}, connections: {} });
    expectTransientStateCleared();
  });

  it('importWorkflow resets breadcrumbStack to []', () => {
    getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState(s => {
      s.breadcrumbStack = [
        { graphId: 'graph-1', nodeId: 'node-1' } as any,
      ];
    });
    expect(getState().breadcrumbStack.length).toBeGreaterThan(0);

    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(getState().breadcrumbStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Graph variables preserved by clearExecutionTransientState
// ---------------------------------------------------------------------------

describe('Graph variables preserved by clearExecutionTransientState', () => {
  beforeEach(resetStore);

  it('graphVariables are NOT cleared by clearExecutionTransientState (they are per-graph persistent)', () => {
    useEditorStore.setState(s => {
      s.graphVariables = { counter: 42, label: 'persistent' };
    });

    // Inject transient state
    injectTransientState();

    // Clear transient state
    useEditorStore.setState(s => {
      clearExecutionTransientState(s as unknown as ExecutionSliceState);
    });

    // graphVariables should be preserved
    expect(getState().graphVariables).toEqual({ counter: 42, label: 'persistent' });
    // But execution fields should be cleared
    expectTransientStateCleared();
  });
});

// ---------------------------------------------------------------------------
// 8. Execution history preserved across undo/redo
// ---------------------------------------------------------------------------

describe('Execution history preserved across undo/redo', () => {
  beforeEach(resetStore);

  it('executionHistory entries survive undo/redo (not part of transient state)', () => {
    // Add a node so we have an undo entry
    getState().addNode('source', [0, 0, 0]);

    // Inject executionHistory entries manually
    useEditorStore.setState(s => {
      s.executionHistory = [
        {
          id: 1,
          timestamp: Date.now(),
          nodeOutputs: {},
          metrics: {},
          errors: {},
          totalDuration: 100,
          maxNodeDuration: 50,
          waveCount: 2,
          nodeCount: 3,
        },
      ];
    });
    expect(getState().executionHistory).toHaveLength(1);

    // Undo — clearExecutionTransientState does NOT clear executionHistory
    getState().undo();

    // executionHistory should still be present (it is not cleared by clearExecutionTransientState)
    // Note: undo does NOT explicitly clear executionHistory — only clearGraph and importWorkflow
    // explicitly set executionHistory = []. The clearExecutionTransientState function preserves it.
    expect(getState().executionHistory).toHaveLength(1);
    expect(getState().executionHistory[0].totalDuration).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 9. jumpToUndo clears transient state
// ---------------------------------------------------------------------------

describe('jumpToUndo clears transient state', () => {
  beforeEach(resetStore);

  it('after injecting transient state, jumpToUndo(0) clears it', () => {
    // Create multiple undo entries by adding several nodes
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('source', [1, 0, 0]);
    getState().addNode('source', [2, 0, 0]);

    // Verify we have undo history
    const history = getState().getUndoHistory();
    expect(history.undo.length).toBeGreaterThanOrEqual(3);

    // Inject transient state
    injectTransientState();

    // Jump back to the first undo entry
    getState().jumpToUndo(0);

    // All transient state should be cleared
    expectTransientStateCleared();
    // traceNodeId should also be null after jumpToUndo
    expect(getState().traceNodeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. restoreCheckpoint clears transient state
// ---------------------------------------------------------------------------

describe('restoreCheckpoint clears transient state', () => {
  beforeEach(resetStore);

  it('create checkpoint, inject transient state, restoreCheckpoint clears it', () => {
    // Add a node so we have graph content to checkpoint
    getState().addNode('source', [0, 0, 0]);

    // Create a checkpoint
    const cpId = getState().createCheckpoint('My Checkpoint');
    expect(cpId).toBeTruthy();
    expect(getState().checkpoints[cpId]).toBeDefined();

    // Inject transient state
    injectTransientState();

    // Restore the checkpoint
    getState().restoreCheckpoint(cpId);

    // Transient state should be cleared
    expectTransientStateCleared();
  });

  it('after restoreCheckpoint, selectedIds is empty', () => {
    // Add nodes and select them
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('source', [1, 0, 0]);

    // Create checkpoint
    const cpId = getState().createCheckpoint('Selected Checkpoint');

    // Select nodes
    useEditorStore.setState(s => {
      s.selectedIds = new Set([id1, id2]);
    });
    expect(getState().selectedIds.size).toBe(2);

    // Restore checkpoint
    getState().restoreCheckpoint(cpId);

    // selectedIds should be empty after restore
    expect(getState().selectedIds.size).toBe(0);
  });
});

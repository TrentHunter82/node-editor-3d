/**
 * Conditional Breakpoints Tests
 *
 * Comprehensive tests for the conditional breakpoint system:
 * - breakpointConditions: Record<string, string> in execution state
 * - setBreakpointCondition(nodeId, expression)
 * - clearBreakpointCondition(nodeId)
 * - toggleBreakpoint(nodeId) — cleans up conditions when toggling off
 * - clearAllBreakpoints() — clears both breakpoints AND conditions
 * - Condition evaluation in resumeExecution using
 *   new Function('outputs', 'out0', 'out1', 'out2', 'out3', ...)
 *
 * 25 tests total covering CRUD, persistence, condition evaluation, and integration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() { return useEditorStore.getState(); }

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.validationErrors = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.isExecuting = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.showValuePreviews = true;
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.executionStats = { executionCount: 0, totalDuration: 0, errorCount: 0, totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null, timeoutCount: 0 };
  });
}

// ===========================================================================
// 1. CRUD Operations (10 tests)
// ===========================================================================

describe('Conditional breakpoint CRUD operations', () => {
  beforeEach(() => {
    resetStore();
  });

  it('1. setBreakpointCondition stores expression on a node', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().setBreakpointCondition(id, 'out0 > 5');

    expect(getStore().breakpointConditions[id]).toBe('out0 > 5');
  });

  it('2. setBreakpointCondition auto-creates breakpoint if not already present', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    expect(getStore().breakpoints[id]).toBeUndefined();

    getStore().setBreakpointCondition(id, 'out0 > 0');

    expect(getStore().breakpoints[id]).toBe(true);
  });

  it('3. setBreakpointCondition with empty string removes condition but keeps breakpoint', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().setBreakpointCondition(id, 'out0 > 5');
    expect(getStore().breakpointConditions[id]).toBe('out0 > 5');

    getStore().setBreakpointCondition(id, '');

    expect(getStore().breakpointConditions[id]).toBeUndefined();
    // The breakpoint itself is still present (auto-created by first call)
    expect(getStore().breakpoints[id]).toBe(true);
  });

  it('4. setBreakpointCondition with whitespace-only string removes condition', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().setBreakpointCondition(id, 'out0 !== null');
    expect(getStore().breakpointConditions[id]).toBeDefined();

    getStore().setBreakpointCondition(id, '   ');

    expect(getStore().breakpointConditions[id]).toBeUndefined();
  });

  it('5. clearBreakpointCondition removes condition but keeps breakpoint', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().toggleBreakpoint(id);           // set breakpoint
    getStore().setBreakpointCondition(id, 'out0 > 0');

    getStore().clearBreakpointCondition(id);

    expect(getStore().breakpointConditions[id]).toBeUndefined();
    expect(getStore().breakpoints[id]).toBe(true); // breakpoint still present
  });

  it('6. clearBreakpointCondition on non-existent node is a no-op', () => {
    const before = { ...getStore().breakpointConditions };
    getStore().clearBreakpointCondition('no-such-node');

    expect(getStore().breakpointConditions).toEqual(before);
  });

  it('7. toggleBreakpoint OFF deletes the condition for that node', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().toggleBreakpoint(id);                       // ON
    getStore().setBreakpointCondition(id, 'out0 > 10');   // add condition

    getStore().toggleBreakpoint(id);                       // OFF

    expect(getStore().breakpoints[id]).toBeUndefined();
    expect(getStore().breakpointConditions[id]).toBeUndefined();
  });

  it('8. toggleBreakpoint ON does not create a condition', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().toggleBreakpoint(id);

    expect(getStore().breakpoints[id]).toBe(true);
    expect(getStore().breakpointConditions[id]).toBeUndefined();
  });

  it('9. clearAllBreakpoints clears both breakpoints and conditions', () => {
    const id1 = getStore().addNode('source', [0, 0, 0]);
    const id2 = getStore().addNode('transform', [5, 0, 0]);
    getStore().toggleBreakpoint(id1);
    getStore().setBreakpointCondition(id2, 'out0 > 0'); // also auto-creates breakpoint

    getStore().clearAllBreakpoints();

    expect(getStore().breakpoints).toEqual({});
    expect(getStore().breakpointConditions).toEqual({});
  });

  it('10. Multiple conditions on different nodes are independent', () => {
    const id1 = getStore().addNode('source', [0, 0, 0]);
    const id2 = getStore().addNode('transform', [5, 0, 0]);
    const id3 = getStore().addNode('output', [10, 0, 0]);

    getStore().setBreakpointCondition(id1, 'out0 > 100');
    getStore().setBreakpointCondition(id2, 'out0 < 0');
    getStore().toggleBreakpoint(id3); // unconditional

    getStore().clearBreakpointCondition(id1);

    expect(getStore().breakpointConditions[id1]).toBeUndefined();
    expect(getStore().breakpointConditions[id2]).toBe('out0 < 0');
    expect(getStore().breakpoints[id3]).toBe(true);
    expect(getStore().breakpointConditions[id3]).toBeUndefined();
  });
});

// ===========================================================================
// 2. Persistence Tests (3 tests)
// ===========================================================================

describe('Breakpoint condition persistence', () => {
  beforeEach(() => {
    resetStore();
  });

  it('11. Conditions persist across clearExecutionTransientState (execution reset)', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().setBreakpointCondition(id, 'out0 > 5');
    expect(getStore().breakpointConditions[id]).toBe('out0 > 5');

    // Simulate what happens during resetExecution / undo:
    // clearExecutionTransientState clears executionStates, nodeOutputs, etc.
    // but NOT breakpointConditions.
    getStore().resetExecution();

    expect(getStore().breakpointConditions[id]).toBe('out0 > 5');
    expect(getStore().breakpoints[id]).toBe(true);
  });

  it('12. Conditions are not cleared by undo/redo', () => {
    // Add a node (adds to undo stack)
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().setBreakpointCondition(id, 'out0 !== null');
    expect(getStore().breakpointConditions[id]).toBe('out0 !== null');

    // Undo the node addition — node is gone, but that's about content
    // What matters: the conditions map itself is not cleared by undo
    // (If node is gone, condition for it simply becomes stale but still exists in the map)
    // Trigger redo so node comes back
    getStore().undo();
    getStore().redo();

    // After redo, conditions were not cleared by the undo/redo cycle
    expect(getStore().breakpointConditions[id]).toBe('out0 !== null');
  });

  it('13. Conditions persist when debugMode changes', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().setBreakpointCondition(id, 'out0 > 0');

    getStore().toggleDebugMode(); // ON
    expect(getStore().breakpointConditions[id]).toBe('out0 > 0');

    getStore().toggleDebugMode(); // OFF
    expect(getStore().breakpointConditions[id]).toBe('out0 > 0');
  });
});

// ===========================================================================
// 3. Condition Evaluation in resumeExecution (9 tests)
// ===========================================================================

describe('Condition evaluation in resumeExecution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Helper: set up a two-node graph (source -> transform) in debug mode,
   * execute it, and step once so we're paused at wave 0.
   * Returns { srcId, tfId }.
   */
  function setupDebugGraph(sourceValue = 10) {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', sourceValue);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(srcId, 0, tfId, 0);
    getStore().toggleDebugMode();
    getStore().executeGraph();
    // Step to wave 0 so we're paused mid-execution
    getStore().stepExecution();
    return { srcId, tfId };
  }

  it('14. Unconditional breakpoint (no condition) always causes pause on resume', () => {
    const { tfId } = setupDebugGraph();
    getStore().toggleBreakpoint(tfId); // unconditional

    getStore().resumeExecution();

    // Should have paused at wave 0 (the wave before tfId's wave which is wave 1)
    // pausedAtWave = i - 1 where i > startWave (startWave = 0+1 = 1, tfId is in wave 1)
    // So it pauses at i-1 = 0... but we already are at pausedAtWave = 0.
    // The point is: isExecuting remains true, not completed.
    expect(getStore().isExecuting).toBe(true);
  });

  it('15. Truthy condition causes resume to pause before that breakpoint wave', () => {
    const { tfId } = setupDebugGraph(20);
    // Set outputs manually to simulate a previously executed state
    useEditorStore.setState(s => { s.nodeOutputs[tfId] = { 0: 40 }; });
    getStore().toggleBreakpoint(tfId);
    getStore().setBreakpointCondition(tfId, 'out0 > 10'); // 40 > 10 = truthy

    getStore().resumeExecution();

    // Execution should be paused (not finished)
    expect(getStore().isExecuting).toBe(true);
  });

  it('16. Falsy condition allows execution to continue past that breakpoint', () => {
    const { tfId } = setupDebugGraph(1);
    useEditorStore.setState(s => { s.nodeOutputs[tfId] = { 0: 1 }; });
    getStore().toggleBreakpoint(tfId);
    getStore().setBreakpointCondition(tfId, 'out0 > 100'); // 1 > 100 = false

    getStore().resumeExecution();

    // No pause — execution completes after timeouts
    vi.advanceTimersByTime(5000);
    expect(getStore().isExecuting).toBe(false);
  });

  it('17. Condition using out0 syntax works', () => {
    const { tfId } = setupDebugGraph(10);
    useEditorStore.setState(s => { s.nodeOutputs[tfId] = { 0: 99 }; });
    getStore().setBreakpointCondition(tfId, 'out0 === 99');

    getStore().resumeExecution();

    // out0 === 99 is truthy — should pause
    expect(getStore().isExecuting).toBe(true);
  });

  it('18. Condition using outputs[0] syntax works', () => {
    const { tfId } = setupDebugGraph(10);
    useEditorStore.setState(s => { s.nodeOutputs[tfId] = { 0: 55 }; });
    getStore().setBreakpointCondition(tfId, 'outputs[0] === 55');

    getStore().resumeExecution();

    // outputs[0] === 55 is truthy — should pause
    expect(getStore().isExecuting).toBe(true);
  });

  it('19. Invalid condition expression defaults to pause (treats as unconditional)', () => {
    const { tfId } = setupDebugGraph();
    getStore().toggleBreakpoint(tfId);
    getStore().setBreakpointCondition(tfId, 'this is not valid javascript !!!');

    getStore().resumeExecution();

    // Expression throws → treated as unconditional → pauses
    expect(getStore().isExecuting).toBe(true);
  });

  it('20. Condition "out0 > 5" with out0=10 causes pause', () => {
    const { tfId } = setupDebugGraph();
    useEditorStore.setState(s => { s.nodeOutputs[tfId] = { 0: 10 }; });
    getStore().setBreakpointCondition(tfId, 'out0 > 5'); // 10 > 5 = true

    getStore().resumeExecution();

    expect(getStore().isExecuting).toBe(true);
  });

  it('21. Condition "out0 > 5" with out0=2 does not cause pause', () => {
    const { tfId } = setupDebugGraph();
    useEditorStore.setState(s => { s.nodeOutputs[tfId] = { 0: 2 }; });
    getStore().setBreakpointCondition(tfId, 'out0 > 5'); // 2 > 5 = false

    getStore().resumeExecution();

    // No pause — all timeouts fire, execution completes
    vi.advanceTimersByTime(5000);
    expect(getStore().isExecuting).toBe(false);
  });

  it('22. Breakpoint on first wave causes re-pause when resumed from wave -1', () => {
    // With a single-node graph, the breakpoint is on wave 0.
    // When paused at wave -1 (not yet stepped), startWave = 0.
    // The breakpoint is in wave 0 and the shouldPause check fires (no i > startWave guard),
    // so resumeExecution re-pauses at wave -1 (i - 1 = 0 - 1 = -1).
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 42);
    getStore().toggleBreakpoint(srcId); // unconditional breakpoint on wave 0 node
    getStore().toggleDebugMode();
    getStore().executeGraph();
    // Do NOT step — pausedAtWave is -1, startWave = 0

    getStore().resumeExecution();

    // The breakpoint on wave 0 fires, re-pausing execution. isExecuting stays true.
    vi.advanceTimersByTime(5000);
    expect(getStore().isExecuting).toBe(true);
    expect(getStore().pausedAtWave).toBe(-1);
  });
});

// ===========================================================================
// 4. Integration Tests (3 tests)
// ===========================================================================

describe('Conditional breakpoints integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('23. Multiple breakpoints: one conditional (falsy), one unconditional — unconditional wins', () => {
    // Graph: source -> transform -> output (3 waves)
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 1);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(srcId, 0, tfId, 0);
    const outId = getStore().addNode('output', [10, 0, 0]);
    getStore().addConnection(tfId, 0, outId, 0);

    // Conditional breakpoint on transform (wave 1): condition is falsy (won't pause)
    useEditorStore.setState(s => { s.nodeOutputs[tfId] = { 0: 0 }; });
    getStore().setBreakpointCondition(tfId, 'out0 > 100'); // 0 > 100 = false

    // Unconditional breakpoint on output (wave 2): always pauses
    getStore().toggleBreakpoint(outId);

    getStore().toggleDebugMode();
    getStore().executeGraph();
    getStore().stepExecution(); // step to wave 0

    getStore().resumeExecution();

    // transform's condition is falsy so no pause there.
    // output's unconditional breakpoint at wave 2 (i > startWave: 2 > 1 = true) → pauses.
    expect(getStore().isExecuting).toBe(true);
    // pausedAtWave should be i - 1 = 1
    expect(getStore().pausedAtWave).toBe(1);
  });

  it('24. Condition persists through an executeGraph cycle', () => {
    // Set condition before first execution, verify it survives into next execute
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 7);
    getStore().setBreakpointCondition(srcId, 'out0 > 0');

    // First execution (non-debug, just verify condition still there)
    getStore().executeGraph();
    vi.advanceTimersByTime(2000);

    expect(getStore().breakpointConditions[srcId]).toBe('out0 > 0');
    expect(getStore().breakpoints[srcId]).toBe(true);

    // Second execution
    getStore().executeGraph();
    vi.advanceTimersByTime(2000);

    expect(getStore().breakpointConditions[srcId]).toBe('out0 > 0');
  });

  it('25. getExecutionStats works independently from breakpoints', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 5);
    getStore().setBreakpointCondition(srcId, 'out0 > 0');

    // executionStats starts zeroed
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);

    // Breakpoint manipulation does not affect stats
    getStore().clearAllBreakpoints();

    const statsAfter = getStore().executionStats;
    expect(statsAfter.executionCount).toBe(0);
    expect(statsAfter.totalDuration).toBe(0);
  });
});

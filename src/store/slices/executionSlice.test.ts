/**
 * Unit tests for executionSlice helper functions:
 * - getExecutionCache / deleteExecutionCache
 * - clearExecutionTimeoutsAndCache / clearExecutionTimeouts
 * - clearExecutionTransientState
 * - exportExecutionResults
 * - executionInitialState
 * - _resetExecutionModuleState
 *
 * Tests execution action factories (toggleBreakpoint, toggleDebugMode, etc.)
 * via the local mutable state pattern.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getExecutionCache,
  deleteExecutionCache,
  clearExecutionTimeoutsAndCache,
  clearExecutionTimeouts,
  clearExecutionTransientState,
  exportExecutionResults,
  executionInitialState,
  _resetExecutionModuleState,
  createExecutionActions,
  type ExecutionSliceState,
  type ExecutionSliceActions,
} from './executionSlice';
import type { EditorNode, Connection, ExecutionState, NodeExecutionMetric } from '../../types';

// ===========================================================================
// Helpers
// ===========================================================================

function makeNode(id: string): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: `Node ${id}`,
    data: {},
    inputs: [{ id: `${id}-in-0`, label: 'in', portType: 'number' }],
    outputs: [{ id: `${id}-out-0`, label: 'value', portType: 'number' }],
  };
}

function makeExecState(): ExecutionSliceState {
  return { ...executionInitialState };
}

// ===========================================================================
// Setup
// ===========================================================================

beforeEach(() => {
  _resetExecutionModuleState();
  vi.useRealTimers();
});

// ===========================================================================
// executionInitialState
// ===========================================================================

describe('executionInitialState', () => {
  it('has default values for all fields', () => {
    expect(executionInitialState.isExecuting).toBe(false);
    expect(executionInitialState.debugMode).toBe(false);
    expect(executionInitialState.pausedAtWave).toBe(-1);
    expect(executionInitialState.debugWaves).toEqual([]);
    expect(executionInitialState.traceNodeId).toBeNull();
    expect(executionInitialState.errorStrategy).toBe('fail-fast');
    expect(executionInitialState.executionHistoryIndex).toBe(-1);
    expect(executionInitialState.executionTimedOut).toBe(false);
  });

  it('has empty metric collections', () => {
    expect(Object.keys(executionInitialState.executionStates)).toHaveLength(0);
    expect(Object.keys(executionInitialState.nodeOutputs)).toHaveLength(0);
    expect(Object.keys(executionInitialState.executionErrors)).toHaveLength(0);
    expect(Object.keys(executionInitialState.executionMetrics)).toHaveLength(0);
    expect(Object.keys(executionInitialState.breakpoints)).toHaveLength(0);
  });

  it('has initial execution stats', () => {
    expect(executionInitialState.executionStats).toEqual({
      executionCount: 0,
      totalDuration: 0,
      errorCount: 0,
      totalCacheHits: 0,
      totalNodesExecuted: 0,
      lastExecutedAt: null,
      timeoutCount: 0,
    });
  });
});

// ===========================================================================
// getExecutionCache / deleteExecutionCache
// ===========================================================================

describe('getExecutionCache', () => {
  it('returns a new Map for unknown graph ID', () => {
    const cache = getExecutionCache('graph-1');
    expect(cache).toBeInstanceOf(Map);
    expect(cache.size).toBe(0);
  });

  it('returns the same cache for repeated calls with same ID', () => {
    const c1 = getExecutionCache('graph-1');
    c1.set('key', { outputs: {}, inputHash: '' });
    const c2 = getExecutionCache('graph-1');
    expect(c2.size).toBe(1);
    expect(c1).toBe(c2);
  });

  it('returns different caches for different graph IDs', () => {
    const c1 = getExecutionCache('a');
    const c2 = getExecutionCache('b');
    expect(c1).not.toBe(c2);
  });
});

describe('deleteExecutionCache', () => {
  it('removes the cache for a graph ID', () => {
    const cache = getExecutionCache('graph-1');
    cache.set('key', { outputs: {}, inputHash: '' });

    deleteExecutionCache('graph-1');

    // Getting it again should return a new empty cache
    const newCache = getExecutionCache('graph-1');
    expect(newCache.size).toBe(0);
  });

  it('no-ops for nonexistent graph ID', () => {
    deleteExecutionCache('nonexistent');
    // Should not throw
  });
});

// ===========================================================================
// clearExecutionTimeoutsAndCache
// ===========================================================================

describe('clearExecutionTimeoutsAndCache', () => {
  it('clears the cache for the given graph', () => {
    const cache = getExecutionCache('g1');
    cache.set('n1', { outputs: { 0: 42 }, inputHash: '' });

    clearExecutionTimeoutsAndCache('g1');
    expect(getExecutionCache('g1').size).toBe(0);
  });
});

describe('clearExecutionTimeouts', () => {
  it('can be called without error', () => {
    // No pending timeouts — should not throw
    clearExecutionTimeouts();
  });
});

// ===========================================================================
// clearExecutionTransientState
// ===========================================================================

describe('clearExecutionTransientState', () => {
  it('resets all transient fields to initial values', () => {
    const draft = makeExecState();
    draft.isExecuting = true;
    draft.executionStates = { n1: 'running' as ExecutionState };
    draft.nodeOutputs = { n1: { 0: 42 } };
    draft.executionErrors = { n1: 'Error' };
    draft.executionMetrics = { n1: { duration: 10, cacheHit: false, timestamp: 0 } };
    draft.executionTimings = { n1: 10 };
    draft.executionTotalDuration = 100;
    draft.executionMaxNodeDuration = 50;
    draft.pausedAtWave = 2;
    draft.debugWaves = [['n1']];
    draft.executionTimedOut = true;
    draft.executionHistoryIndex = 3;

    clearExecutionTransientState(draft);

    expect(draft.isExecuting).toBe(false);
    expect(Object.keys(draft.executionStates)).toHaveLength(0);
    expect(Object.keys(draft.nodeOutputs)).toHaveLength(0);
    expect(Object.keys(draft.executionErrors)).toHaveLength(0);
    expect(Object.keys(draft.executionMetrics)).toHaveLength(0);
    expect(Object.keys(draft.executionTimings)).toHaveLength(0);
    expect(draft.executionTotalDuration).toBe(0);
    expect(draft.executionMaxNodeDuration).toBe(0);
    expect(draft.pausedAtWave).toBe(-1);
    expect(draft.debugWaves).toEqual([]);
    expect(draft.executionTimedOut).toBe(false);
    expect(draft.executionHistoryIndex).toBe(-1);
  });

  it('does NOT clear breakpoints (user config, not transient)', () => {
    const draft = makeExecState();
    draft.breakpoints = { n1: true };
    draft.breakpointConditions = { n1: 'out0 > 5' };

    clearExecutionTransientState(draft);

    expect(draft.breakpoints).toEqual({ n1: true });
    expect(draft.breakpointConditions).toEqual({ n1: 'out0 > 5' });
  });

  it('does NOT clear graphVariables (per-graph persistent state)', () => {
    const draft = makeExecState();
    draft.graphVariables = { x: 42 };

    clearExecutionTransientState(draft);

    expect(draft.graphVariables).toEqual({ x: 42 });
  });

  it('does NOT clear executionHistory (persists across undo/redo)', () => {
    const draft = makeExecState();
    draft.executionHistory = [{
      id: 1, timestamp: 0, nodeOutputs: {}, metrics: {}, errors: {},
      totalDuration: 0, maxNodeDuration: 0, waveCount: 0, nodeCount: 0,
    }];

    clearExecutionTransientState(draft);

    expect(draft.executionHistory.length).toBe(1);
  });
});

// ===========================================================================
// exportExecutionResults
// ===========================================================================

describe('exportExecutionResults', () => {
  it('returns null when no node outputs exist', () => {
    const state = {
      ...makeExecState(),
      nodes: { n1: makeNode('n1') } as Record<string, EditorNode>,
    };

    const result = exportExecutionResults(state);
    expect(result).toBeNull();
  });

  it('exports JSON and CSV for executed nodes', () => {
    const state = {
      ...makeExecState(),
      nodes: {
        n1: makeNode('n1'),
        n2: makeNode('n2'),
      } as Record<string, EditorNode>,
      nodeOutputs: {
        n1: { 0: 42 },
        n2: { 0: 'hello' },
      },
      executionMetrics: {
        n1: { duration: 5.5, cacheHit: false, timestamp: 100 },
        n2: { duration: 1.2, cacheHit: true, timestamp: 105 },
      } as Record<string, NodeExecutionMetric>,
      executionErrors: { n2: 'Some error' },
      executionTotalDuration: 6.7,
    };

    const result = exportExecutionResults(state);

    expect(result).not.toBeNull();
    expect(result!.json).toBeTruthy();
    expect(result!.csv).toBeTruthy();

    // Verify JSON structure
    const parsed = JSON.parse(result!.json);
    expect(parsed.totalDuration).toBe(6.7);
    expect(parsed.nodeCount).toBe(2);
    expect(parsed.results.length).toBe(2);

    // Verify CSV has header + data rows
    const csvLines = result!.csv.split('\n');
    expect(csvLines[0]).toContain('nodeId,nodeType,nodeTitle');
    expect(csvLines.length).toBe(3); // header + 2 rows
  });

  it('handles nodes with no metrics gracefully', () => {
    const state = {
      ...makeExecState(),
      nodes: { n1: makeNode('n1') } as Record<string, EditorNode>,
      nodeOutputs: { n1: { 0: 'result' } },
    };

    const result = exportExecutionResults(state);
    expect(result).not.toBeNull();

    const parsed = JSON.parse(result!.json);
    expect(parsed.results[0].durationMs).toBe(0);
    expect(parsed.results[0].cacheHit).toBe(false);
    expect(parsed.results[0].error).toBeNull();
  });

  it('handles special CSV characters in output', () => {
    const state = {
      ...makeExecState(),
      nodes: { n1: { ...makeNode('n1'), title: 'Node, with "commas"' } } as Record<string, EditorNode>,
      nodeOutputs: { n1: { 0: 'value,with,commas' } },
    };

    const result = exportExecutionResults(state);
    expect(result).not.toBeNull();
    // CSV should properly escape
    expect(result!.csv).toContain('"');
  });
});

// ===========================================================================
// createExecutionActions (simple actions)
// ===========================================================================

describe('createExecutionActions', () => {
  let state: ExecutionSliceState & {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    subgraphDefs: Record<string, unknown>;
    setNodeExecutionState: (id: string, state: ExecutionState) => void;
  };
  let actions: ExecutionSliceActions;

  beforeEach(() => {
    _resetExecutionModuleState();
    state = {
      ...makeExecState(),
      nodes: { n1: makeNode('n1'), n2: makeNode('n2') },
      connections: {},
      subgraphDefs: {},
      setNodeExecutionState: (id: string, execState: ExecutionState) => {
        state.executionStates[id] = execState;
      },
    };

    const set = (fn: (s: ExecutionSliceState) => void) => { fn(state); };
    const get = () => state;

    actions = createExecutionActions(
      set,
      get as any,
      () => 'default',      // getActiveGraphId
      () => undefined,       // getInactiveGraph
      () => state as any,    // getStoreRef
      () => false,           // getWorkerEnabled
    );
    // Wire up the setNodeExecutionState action
    state.setNodeExecutionState = actions.setNodeExecutionState;
  });

  describe('setNodeExecutionState', () => {
    it('sets execution state for a node', () => {
      actions.setNodeExecutionState('n1', 'running');
      expect(state.executionStates.n1).toBe('running');
    });
  });

  describe('resetExecution', () => {
    it('clears all execution state', () => {
      state.isExecuting = true;
      state.nodeOutputs = { n1: { 0: 42 } };
      state.executionErrors = { n1: 'Error' };

      actions.resetExecution();

      expect(state.isExecuting).toBe(false);
      expect(Object.keys(state.nodeOutputs)).toHaveLength(0);
      expect(Object.keys(state.executionErrors)).toHaveLength(0);
    });
  });

  describe('toggleDebugMode', () => {
    it('toggles debug mode on', () => {
      expect(state.debugMode).toBe(false);
      actions.toggleDebugMode();
      expect(state.debugMode).toBe(true);
    });

    it('toggles debug mode off', () => {
      state.debugMode = true;
      actions.toggleDebugMode();
      expect(state.debugMode).toBe(false);
    });
  });

  describe('setErrorStrategy', () => {
    it('sets error strategy', () => {
      actions.setErrorStrategy('continue');
      expect(state.errorStrategy).toBe('continue');
    });
  });

  describe('setTraceNode', () => {
    it('sets trace node ID', () => {
      actions.setTraceNode('n1');
      expect(state.traceNodeId).toBe('n1');
    });

    it('clears trace node with null', () => {
      state.traceNodeId = 'n1';
      actions.setTraceNode(null);
      expect(state.traceNodeId).toBeNull();
    });
  });

  describe('toggleBreakpoint', () => {
    it('adds a breakpoint to a node', () => {
      actions.toggleBreakpoint('n1');
      expect(state.breakpoints.n1).toBe(true);
    });

    it('removes a breakpoint from a node', () => {
      state.breakpoints.n1 = true;
      actions.toggleBreakpoint('n1');
      expect(state.breakpoints.n1).toBeUndefined();
    });

    it('clears condition when removing breakpoint', () => {
      state.breakpoints.n1 = true;
      state.breakpointConditions.n1 = 'out0 > 5';
      actions.toggleBreakpoint('n1');
      expect(state.breakpointConditions.n1).toBeUndefined();
    });

    it('ignores nonexistent node', () => {
      actions.toggleBreakpoint('nonexistent');
      expect(state.breakpoints.nonexistent).toBeUndefined();
    });
  });

  describe('clearAllBreakpoints', () => {
    it('removes all breakpoints and conditions', () => {
      state.breakpoints = { n1: true, n2: true };
      state.breakpointConditions = { n1: 'x > 0' };

      actions.clearAllBreakpoints();

      expect(Object.keys(state.breakpoints)).toHaveLength(0);
      expect(Object.keys(state.breakpointConditions)).toHaveLength(0);
    });
  });

  describe('setBreakpointCondition', () => {
    it('sets a condition and auto-creates breakpoint', () => {
      actions.setBreakpointCondition('n1', 'out0 > 5');
      expect(state.breakpoints.n1).toBe(true);
      expect(state.breakpointConditions.n1).toBe('out0 > 5');
    });

    it('clears condition when empty string', () => {
      state.breakpoints.n1 = true;
      state.breakpointConditions.n1 = 'old';

      actions.setBreakpointCondition('n1', '   ');
      expect(state.breakpointConditions.n1).toBeUndefined();
      // Breakpoint itself should still exist
      expect(state.breakpoints.n1).toBe(true);
    });

    it('ignores nonexistent node', () => {
      actions.setBreakpointCondition('nonexistent', 'x > 0');
      expect(state.breakpointConditions.nonexistent).toBeUndefined();
    });
  });

  describe('clearBreakpointCondition', () => {
    it('removes condition for a node', () => {
      state.breakpointConditions.n1 = 'x > 0';
      actions.clearBreakpointCondition('n1');
      expect(state.breakpointConditions.n1).toBeUndefined();
    });
  });

  describe('scrubExecutionHistory', () => {
    it('switches to a history entry', () => {
      // Set up a history entry
      state.executionHistory = [{
        id: 1, timestamp: 0,
        nodeOutputs: { n1: { 0: 'old' } },
        metrics: { n1: { duration: 5, cacheHit: false, timestamp: 0 } },
        errors: {},
        totalDuration: 5, maxNodeDuration: 5, waveCount: 1, nodeCount: 1,
      }];
      state.nodeOutputs = { n1: { 0: 'current' } };

      actions.scrubExecutionHistory(0);

      expect(state.executionHistoryIndex).toBe(0);
      expect(state.nodeOutputs.n1[0]).toBe('old');
    });

    it('returns to live view with negative index', () => {
      state.executionHistory = [{
        id: 1, timestamp: 0,
        nodeOutputs: { n1: { 0: 'old' } },
        metrics: { n1: { duration: 5, cacheHit: false, timestamp: 0 } },
        errors: {},
        totalDuration: 5, maxNodeDuration: 5, waveCount: 1, nodeCount: 1,
      }];
      state.nodeOutputs = { n1: { 0: 'live' } };

      // Scrub to history
      actions.scrubExecutionHistory(0);
      expect(state.executionHistoryIndex).toBe(0);

      // Return to live
      actions.scrubExecutionHistory(-1);
      expect(state.executionHistoryIndex).toBe(-1);
    });
  });

  describe('clearExecutionHistory', () => {
    it('clears history and resets index', () => {
      state.executionHistory = [{
        id: 1, timestamp: 0, nodeOutputs: {}, metrics: {}, errors: {},
        totalDuration: 0, maxNodeDuration: 0, waveCount: 0, nodeCount: 0,
      }];
      state.executionHistoryIndex = 0;

      actions.clearExecutionHistory();

      expect(state.executionHistory).toEqual([]);
      expect(state.executionHistoryIndex).toBe(-1);
    });
  });

  describe('getExecutionStats', () => {
    it('returns current stats', () => {
      state.executionStats = {
        executionCount: 5,
        totalDuration: 100,
        errorCount: 2,
        totalCacheHits: 10,
        totalNodesExecuted: 50,
        lastExecutedAt: 12345,
        timeoutCount: 1,
      };

      const stats = actions.getExecutionStats();
      expect(stats.executionCount).toBe(5);
      expect(stats.totalDuration).toBe(100);
      expect(stats.timeoutCount).toBe(1);
    });
  });
});

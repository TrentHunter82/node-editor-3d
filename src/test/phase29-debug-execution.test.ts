/**
 * Phase 29 Debug Execution & Breakpoint Infrastructure Tests
 *
 * Comprehensive tests for the debug/step/resume execution system,
 * including integration with graph execution, error states, edge cases,
 * and infrastructure that breakpoints will build upon.
 *
 * Target: 25+ tests covering debug mode integration, step/resume edge cases,
 * wave management, error propagation during debug, and future breakpoint
 * state management (pending Claude-1 implementation).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { topologicalSort } from '../utils/execution';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, NodeType } from '../types';

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
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

function makeNode(id: string, type: NodeType, data: Record<string, unknown> = {}): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${id}-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${id}-${i}`, label: c.label, portType: c.portType })),
  };
}

// ===========================================================================
// 1. Debug Mode Integration with Real Graph Execution (10 tests)
// ===========================================================================

describe('Debug mode integration with graph execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('executeGraph in debug mode stores waves from topological sort', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 10);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(srcId, 0, tfId, 0);

    getStore().toggleDebugMode();
    expect(getStore().debugMode).toBe(true);

    getStore().executeGraph();

    // Should store waves and be in executing state
    expect(getStore().isExecuting).toBe(true);
    expect(getStore().debugWaves.length).toBeGreaterThan(0);
    expect(getStore().pausedAtWave).toBe(-1); // Not yet stepped
  });

  it('topologicalSort produces correct wave ordering for linear chain', () => {
    const src = makeNode('s1', 'source', { value: 5 });
    const tf = makeNode('t1', 'transform');
    const out = makeNode('o1', 'output');

    const nodes = { s1: src, t1: tf, o1: out };
    const connections = {
      c1: { id: 'c1', sourceNodeId: 's1', sourcePortIndex: 0, targetNodeId: 't1', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 't1', sourcePortIndex: 0, targetNodeId: 'o1', targetPortIndex: 0 },
    };

    const waves = topologicalSort(nodes, connections);
    expect(waves.length).toBe(3); // 3 sequential waves
    expect(waves[0]).toContain('s1'); // Source first
    expect(waves[1]).toContain('t1'); // Transform second
    expect(waves[2]).toContain('o1'); // Output third
  });

  it('topologicalSort groups parallel nodes in same wave', () => {
    const src = makeNode('s1', 'source', { value: 5 });
    const tf1 = makeNode('t1', 'transform');
    const tf2 = makeNode('t2', 'transform');

    const nodes = { s1: src, t1: tf1, t2: tf2 };
    const connections = {
      c1: { id: 'c1', sourceNodeId: 's1', sourcePortIndex: 0, targetNodeId: 't1', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 's1', sourcePortIndex: 0, targetNodeId: 't2', targetPortIndex: 0 },
    };

    const waves = topologicalSort(nodes, connections);
    expect(waves.length).toBe(2); // 2 waves: source, then both transforms
    expect(waves[0]).toContain('s1');
    expect(waves[1]).toContain('t1');
    expect(waves[1]).toContain('t2');
  });

  it('step execution processes one wave at a time', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 10);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(srcId, 0, tfId, 0);

    getStore().toggleDebugMode();
    getStore().executeGraph();

    // Step to wave 0
    getStore().stepExecution();
    expect(getStore().pausedAtWave).toBe(0);

    // Step to wave 1
    getStore().stepExecution();
    expect(getStore().pausedAtWave).toBe(1);
  });

  it('debug mode execution with single node graph', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 42);

    getStore().toggleDebugMode();
    getStore().executeGraph();

    expect(getStore().debugWaves.length).toBe(1);
    expect(getStore().debugWaves[0]).toContain(srcId);
  });

  it('stepping past final wave clears execution state', () => {
    getStore().addNode('source', [0, 0, 0]);

    getStore().toggleDebugMode();
    getStore().executeGraph();

    const numWaves = getStore().debugWaves.length;
    for (let i = 0; i <= numWaves; i++) {
      getStore().stepExecution();
    }

    expect(getStore().isExecuting).toBe(false);
    expect(getStore().pausedAtWave).toBe(-1);
    expect(getStore().debugWaves).toEqual([]);
  });

  it('resume after partial stepping completes remaining waves', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 10);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(srcId, 0, tfId, 0);
    const outId = getStore().addNode('output', [10, 0, 0]);
    getStore().addConnection(tfId, 0, outId, 0);

    getStore().toggleDebugMode();
    getStore().executeGraph();

    // Step through first wave
    getStore().stepExecution();
    expect(getStore().pausedAtWave).toBe(0);

    // Resume from wave 1 onwards
    getStore().resumeExecution();

    // After resume schedules all remaining waves, eventually execution stops
    vi.advanceTimersByTime(10000); // Advance past all timeouts
    expect(getStore().isExecuting).toBe(false);
  });

  it('step has no effect when not in debug mode', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().executeGraph(); // Non-debug execution

    const pausedBefore = getStore().pausedAtWave;
    getStore().stepExecution();
    expect(getStore().pausedAtWave).toBe(pausedBefore);
  });

  it('resume has no effect when not in debug mode', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().executeGraph();

    getStore().resumeExecution(); // Should no-op
    // No crash, no state change
    expect(getStore().debugWaves).toEqual([]);
  });

  it('toggling debug mode during execution does not crash', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().toggleDebugMode();
    getStore().executeGraph();

    expect(getStore().isExecuting).toBe(true);
    // Toggle off during execution
    getStore().toggleDebugMode();
    expect(getStore().debugMode).toBe(false);
    // Step should no-op now
    getStore().stepExecution();
  });
});

// ===========================================================================
// 2. Debug Wave Edge Cases (8 tests)
// ===========================================================================

describe('Debug wave edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('empty graph in debug mode produces no waves', () => {
    getStore().toggleDebugMode();
    getStore().executeGraph();
    // Empty graph should still set waves (empty)
    expect(getStore().debugWaves.length).toBe(0);
  });

  it('undo clears debug execution state', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().toggleDebugMode();
    getStore().executeGraph();
    getStore().stepExecution();

    expect(getStore().pausedAtWave).toBe(0);

    getStore().undo(); // Undo remove the node addition
    expect(getStore().debugWaves).toEqual([]);
    expect(getStore().pausedAtWave).toBe(-1);
  });

  it('clearGraph clears debug execution state but preserves debugMode preference', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().toggleDebugMode();
    getStore().executeGraph();

    getStore().clearGraph();
    // debugMode is a user preference — preserved like errorStrategy
    expect(getStore().debugMode).toBe(true);
    // But execution-related debug state is cleared
    expect(getStore().debugWaves).toEqual([]);
    expect(getStore().pausedAtWave).toBe(-1);
    expect(getStore().isExecuting).toBe(false);
  });

  it('trace node ID is independent of debug mode', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);

    getStore().setTraceNode(srcId);
    expect(getStore().traceNodeId).toBe(srcId);

    getStore().setTraceNode(null);
    expect(getStore().traceNodeId).toBeNull();
  });

  it('multiple rapid steps are safe', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(srcId, 0, tfId, 0);

    getStore().toggleDebugMode();
    getStore().executeGraph();

    // Rapid stepping
    getStore().stepExecution();
    getStore().stepExecution();
    getStore().stepExecution(); // Past end

    expect(getStore().isExecuting).toBe(false);
  });

  it('debug mode persists across toggles', () => {
    getStore().toggleDebugMode();
    expect(getStore().debugMode).toBe(true);
    getStore().toggleDebugMode();
    expect(getStore().debugMode).toBe(false);
    getStore().toggleDebugMode();
    expect(getStore().debugMode).toBe(true);
  });

  it('step sets wave nodes to running state', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 5);

    getStore().toggleDebugMode();
    getStore().executeGraph();
    getStore().stepExecution();

    // Source node should be in running state
    expect(getStore().executionStates[srcId]).toBe('running');

    // After timeout, should be complete
    vi.advanceTimersByTime(500);
    expect(getStore().executionStates[srcId]).toBe('complete');
  });

  it('resetExecution clears all debug state', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().toggleDebugMode();
    getStore().executeGraph();
    getStore().stepExecution();

    getStore().resetExecution();
    expect(getStore().isExecuting).toBe(false);
    expect(getStore().debugWaves).toEqual([]);
    expect(getStore().pausedAtWave).toBe(-1);
    expect(getStore().executionStates).toEqual({});
  });
});

// ===========================================================================
// 3. Breakpoint Infrastructure (7 tests — future-proofing)
// ===========================================================================

describe('Breakpoint infrastructure (pending Claude-1 implementation)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('debug mode defaults to false', () => {
    expect(getStore().debugMode).toBe(false);
  });

  it('pausedAtWave defaults to -1', () => {
    expect(getStore().pausedAtWave).toBe(-1);
  });

  it('debugWaves defaults to empty array', () => {
    expect(getStore().debugWaves).toEqual([]);
  });

  it('execution state interface supports per-node states', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().setNodeExecutionState(srcId, 'running');
    expect(getStore().executionStates[srcId]).toBe('running');

    getStore().setNodeExecutionState(srcId, 'complete');
    expect(getStore().executionStates[srcId]).toBe('complete');

    getStore().setNodeExecutionState(srcId, 'error');
    expect(getStore().executionStates[srcId]).toBe('error');
  });

  it('execution errors can be set per-node for breakpoint error display', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    useEditorStore.setState(s => {
      s.executionErrors[srcId] = 'Test error message';
    });
    expect(getStore().executionErrors[srcId]).toBe('Test error message');
  });

  it('debug stepping sets nodes to running, then complete after delay', () => {
    vi.useFakeTimers();

    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 42);

    getStore().toggleDebugMode();
    getStore().executeGraph();
    getStore().stepExecution();

    // After stepping, node should be in running state
    expect(getStore().executionStates[srcId]).toBe('running');

    // After NODE_DURATION (400ms), node transitions to complete
    vi.advanceTimersByTime(500);
    expect(getStore().executionStates[srcId]).toBe('complete');

    vi.useRealTimers();
  });

  it('data flow tracing works with trace node', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(srcId, 0, tfId, 0);

    getStore().setTraceNode(tfId);
    expect(getStore().traceNodeId).toBe(tfId);

    // Setting a different trace node replaces the previous
    getStore().setTraceNode(srcId);
    expect(getStore().traceNodeId).toBe(srcId);
  });
});

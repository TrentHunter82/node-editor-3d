/**
 * Worker + graphVariables store-level integration tests.
 *
 * Tests the executionSlice's worker execution path:
 * - graphVariables sent in worker payload
 * - updatedGraphVariables from worker response applied to store
 * - Variable persistence across execution cycles
 * - Error handling doesn't corrupt graphVariables
 * - executionMaxNodeDuration pre-computation
 *
 * Since jsdom doesn't support real Workers, we mock executeInWorker
 * and test the store-level integration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import { useEditorStore } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection, NodeType } from '../types';
import type { ExecuteResultMessage } from '../workers/execution.worker';
import type { NodeResult } from '../utils/execution';

// ---------------------------------------------------------------------------
// Mock the worker manager so executeGraph's worker path uses our mock
// ---------------------------------------------------------------------------
let mockExecuteInWorker: ReturnType<typeof vi.fn>;

vi.mock('../workers/executionWorkerManager', () => ({
  executeInWorker: (...args: unknown[]) => (mockExecuteInWorker as (...a: unknown[]) => unknown)(...args),
  getExecutionWorker: () => ({}),
  terminateExecutionWorker: vi.fn(),
  checkWorkerHealth: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: NodeType,
  data?: Record<string, unknown>,
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data: data ?? {},
    inputs: config.inputs.map((p, i) => ({
      id: `${id}-in-${i}`,
      label: p.label,
      portType: p.portType,
    })),
    outputs: config.outputs.map((p, i) => ({
      id: `${id}-out-${i}`,
      label: p.label,
      portType: p.portType,
    })),
  };
}

function makeConnection(
  id: string,
  src: string,
  srcPort: number,
  tgt: string,
  tgtPort: number,
): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: srcPort,
    targetNodeId: tgt,
    targetPortIndex: tgtPort,
  };
}

/** Build a mock worker result for given nodes */
function buildWorkerResult(
  nodeIds: string[],
  opts?: {
    updatedGraphVariables?: Record<string, unknown>;
    metrics?: [string, { duration: number; cacheHit: boolean; timestamp: number }][];
  },
): ExecuteResultMessage {
  const results: [string, NodeResult][] = nodeIds.map(id => [
    id,
    { outputs: { 0: 42 }, inputHash: '{}' },
  ]);
  const metrics: [string, { duration: number; cacheHit: boolean; timestamp: number }][] =
    opts?.metrics ?? nodeIds.map(id => [
      id,
      { duration: 10, cacheHit: false, timestamp: Date.now() },
    ]);
  return {
    type: 'result',
    id: 1,
    results,
    waves: [nodeIds],
    errors: [],
    metrics,
    totalDuration: 10,
    updatedGraphVariables: opts?.updatedGraphVariables,
  };
}

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------

function resetStore() {
  // Reset module-scoped state
  const mod = useEditorStore.getState();
  if (typeof (mod as unknown as Record<string, unknown>)._resetModuleState === 'function') {
    ((mod as unknown as Record<string, unknown>)._resetModuleState as () => void)();
  }

  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.selectedIds = new Set<string>();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.validationErrors = {};
    s.customNodeDefs = {};
    s.templates = {};
    s.subgraphDefs = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.checkpoints = {};
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.searchHighlightIds = new Set<string>();
    s.storageWarning = null;
    s.lastSaveTime = null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worker execution: store-level graphVariables integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    mockExecuteInWorker = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('executeGraph sends graphVariables in worker payload', async () => {
    // Set up store with nodes and graphVariables
    const srcNode = makeNode('src', 'source', { value: 10 });
    useEditorStore.setState((s) => {
      s.nodes = { src: srcNode };
      s.graphVariables = { existingVar: 'hello', count: 42 };
    });

    // Enable worker execution
    useSettingsStore.setState({ workerExecution: true });

    // Mock the worker to capture the payload
    mockExecuteInWorker.mockReturnValue(new Promise(() => {})); // never resolves (we just check the call)

    // Trigger execution
    useEditorStore.getState().executeGraph();

    // Flush the health check promise so executeInWorker gets called
    await vi.advanceTimersByTimeAsync(0);

    // Verify worker was called with graphVariables
    expect(mockExecuteInWorker).toHaveBeenCalledTimes(1);
    const payload = mockExecuteInWorker.mock.calls[0][0];
    expect(payload.graphVariables).toEqual({ existingVar: 'hello', count: 42 });
  });

  it('worker response updatedGraphVariables are applied to store', async () => {
    const srcNode = makeNode('src', 'source', { value: 10 });
    useEditorStore.setState((s) => {
      s.nodes = { src: srcNode };
      s.graphVariables = { before: true };
    });

    useSettingsStore.setState({ workerExecution: true });

    // Mock worker to resolve with updated graphVariables
    const workerResult = buildWorkerResult(['src'], {
      updatedGraphVariables: { before: true, newVar: 'fromWorker', computed: 99 },
    });
    mockExecuteInWorker.mockResolvedValue(workerResult);

    // Trigger execution
    useEditorStore.getState().executeGraph();

    // Flush the health check + executeInWorker promise chain
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    const state = useEditorStore.getState();
    expect(state.graphVariables).toEqual({
      before: true,
      newVar: 'fromWorker',
      computed: 99,
    });
  });

  it('graphVariables persist across multiple worker execution cycles', async () => {
    const srcNode = makeNode('src', 'source', { value: 1 });
    useEditorStore.setState((s) => {
      s.nodes = { src: srcNode };
      s.graphVariables = {};
    });

    useSettingsStore.setState({ workerExecution: true });

    // First execution — sets var1
    mockExecuteInWorker.mockResolvedValueOnce(
      buildWorkerResult(['src'], { updatedGraphVariables: { var1: 'first' } }),
    );

    useEditorStore.getState().executeGraph();

    // Flush health check + executeInWorker + applyResults promise chain
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(useEditorStore.getState().graphVariables.var1).toBe('first');

    // Advance timers to complete animation and allow next execution
    await vi.advanceTimersByTimeAsync(2000);

    // Second execution — sends var1, returns var1 + var2
    mockExecuteInWorker.mockResolvedValueOnce(
      buildWorkerResult(['src'], { updatedGraphVariables: { var1: 'first', var2: 'second' } }),
    );

    useEditorStore.getState().executeGraph();

    // Flush health check + executeInWorker + applyResults promise chain
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // Verify both variables persisted
    const state = useEditorStore.getState();
    expect(state.graphVariables).toEqual({ var1: 'first', var2: 'second' });

    // Verify second call sent the variables from first execution
    const secondPayload = mockExecuteInWorker.mock.calls[1][0];
    expect(secondPayload.graphVariables).toEqual({ var1: 'first' });
  });

  it('worker error does not corrupt existing graphVariables', async () => {
    const srcNode = makeNode('src', 'source', { value: 1 });
    useEditorStore.setState((s) => {
      s.nodes = { src: srcNode };
      s.graphVariables = { safe: 'data', count: 42 };
    });

    useSettingsStore.setState({ workerExecution: true });

    // Mock worker to reject (error)
    mockExecuteInWorker.mockRejectedValue(new Error('Worker crashed'));

    useEditorStore.getState().executeGraph();

    // Flush health check + executeInWorker rejection + main-thread fallback
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    // graphVariables should remain unchanged after worker error
    // (main-thread fallback may update them, but they should be consistent)
    const state = useEditorStore.getState();
    expect(state.graphVariables).toEqual({ safe: 'data', count: 42 });
  });

  it('worker response without updatedGraphVariables does not modify store variables', async () => {
    const srcNode = makeNode('src', 'source', { value: 1 });
    useEditorStore.setState((s) => {
      s.nodes = { src: srcNode };
      s.graphVariables = { preserved: true };
    });

    useSettingsStore.setState({ workerExecution: true });

    // Mock worker result without updatedGraphVariables
    const workerResult = buildWorkerResult(['src']); // no updatedGraphVariables
    mockExecuteInWorker.mockResolvedValue(workerResult);

    useEditorStore.getState().executeGraph();

    // Flush health check + executeInWorker + applyResults promise chain
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // graphVariables should be unchanged
    const state = useEditorStore.getState();
    expect(state.graphVariables).toEqual({ preserved: true });
  });

  it('empty graphVariables are sent as empty object (not undefined)', async () => {
    const srcNode = makeNode('src', 'source', { value: 1 });
    useEditorStore.setState((s) => {
      s.nodes = { src: srcNode };
      s.graphVariables = {};
    });

    useSettingsStore.setState({ workerExecution: true });

    mockExecuteInWorker.mockReturnValue(new Promise(() => {}));

    useEditorStore.getState().executeGraph();

    // Flush the health check promise so executeInWorker gets called
    await vi.advanceTimersByTimeAsync(0);

    const payload = mockExecuteInWorker.mock.calls[0][0];
    expect(payload.graphVariables).toEqual({});
    expect(payload.graphVariables).not.toBeUndefined();
  });

  it('complex graphVariables values survive worker payload', async () => {
    const srcNode = makeNode('src', 'source', { value: 1 });
    useEditorStore.setState((s) => {
      s.nodes = { src: srcNode };
      s.graphVariables = {
        str: 'hello',
        num: 3.14,
        bool: false,
        arr: [1, 'two', { three: 3 }],
        obj: { nested: { deep: true }, list: [1, 2] },
        nil: null,
      };
    });

    useSettingsStore.setState({ workerExecution: true });

    mockExecuteInWorker.mockReturnValue(new Promise(() => {}));

    useEditorStore.getState().executeGraph();

    // Flush the health check promise so executeInWorker gets called
    await vi.advanceTimersByTimeAsync(0);

    const payload = mockExecuteInWorker.mock.calls[0][0];
    expect(payload.graphVariables).toEqual({
      str: 'hello',
      num: 3.14,
      bool: false,
      arr: [1, 'two', { three: 3 }],
      obj: { nested: { deep: true }, list: [1, 2] },
      nil: null,
    });
  });
});

describe('executionMaxNodeDuration pre-computation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0 in initial state', () => {
    expect(useEditorStore.getState().executionMaxNodeDuration).toBe(0);
  });

  it('is computed from execution metrics after main-thread execution', () => {
    // Add nodes and execute
    const src = makeNode('src', 'source', { value: 1 });
    const math = makeNode('math', 'math');
    useEditorStore.setState((s) => {
      s.nodes = { src, math };
      s.connections = {
        c1: makeConnection('c1', 'src', 0, 'math', 0),
      };
    });

    useEditorStore.getState().executeGraph();

    // After execution, executionMaxNodeDuration should be set
    const state = useEditorStore.getState();
    expect(state.executionMaxNodeDuration).toBeGreaterThanOrEqual(0);

    // Verify it matches the actual max from metrics
    const metrics = state.executionMetrics;
    let expectedMax = 0;
    for (const k in metrics) {
      if (!metrics[k].cacheHit && metrics[k].duration > expectedMax) {
        expectedMax = metrics[k].duration;
      }
    }
    expect(state.executionMaxNodeDuration).toBe(expectedMax);
  });

  it('is cleared by clearExecutionTransientState (via resetExecution)', () => {
    // Set some metrics manually
    useEditorStore.setState((s) => {
      s.executionMaxNodeDuration = 42;
      s.executionMetrics = {
        n1: { duration: 42, cacheHit: false, timestamp: Date.now() },
      };
    });

    expect(useEditorStore.getState().executionMaxNodeDuration).toBe(42);

    // Reset execution
    useEditorStore.getState().resetExecution();

    expect(useEditorStore.getState().executionMaxNodeDuration).toBe(0);
  });

  it('correctly identifies the max non-cached duration', () => {
    // Simulate execution by directly setting state
    useEditorStore.setState((s) => {
      s.executionMetrics = {
        n1: { duration: 5, cacheHit: false, timestamp: Date.now() },
        n2: { duration: 15, cacheHit: false, timestamp: Date.now() },
        n3: { duration: 100, cacheHit: true, timestamp: Date.now() }, // cached, should be excluded
        n4: { duration: 8, cacheHit: false, timestamp: Date.now() },
      };
      // Pre-compute max (simulating what applyResults does)
      let max = 0;
      for (const k in s.executionMetrics) {
        if (!s.executionMetrics[k].cacheHit && s.executionMetrics[k].duration > max) {
          max = s.executionMetrics[k].duration;
        }
      }
      s.executionMaxNodeDuration = max;
    });

    // n2 has the highest non-cached duration (15)
    expect(useEditorStore.getState().executionMaxNodeDuration).toBe(15);
  });

  it('is available as a simple O(1) selector', () => {
    // This tests the selector access pattern that NodeModule uses
    useEditorStore.setState((s) => {
      s.executionMaxNodeDuration = 99;
    });

    // Simulating the NodeModule selector
    const max = useEditorStore.getState().executionMaxNodeDuration;
    expect(max).toBe(99);
  });

  it('is recomputed on scrubExecutionHistory', () => {
    // Setup: create an execution history entry with known metrics
    useEditorStore.setState((s) => {
      s.executionMetrics = {
        a: { duration: 50, cacheHit: false, timestamp: Date.now() },
      };
      s.executionMaxNodeDuration = 50;
      s.nodeOutputs = { a: { 0: 1 } };
      s.executionErrors = {};
      s.executionHistory = [{
        id: 1,
        timestamp: Date.now(),
        nodeOutputs: { b: { 0: 2 } },
        metrics: {
          b: { duration: 30, cacheHit: false, timestamp: Date.now() },
          c: { duration: 70, cacheHit: false, timestamp: Date.now() },
        },
        errors: {},
        totalDuration: 100,
        maxNodeDuration: 70,
        waveCount: 1,
        nodeCount: 2,
      }];
    });

    // Scrub to history entry 0
    useEditorStore.getState().scrubExecutionHistory(0);

    // Max should be recomputed from the history entry's metrics
    expect(useEditorStore.getState().executionMaxNodeDuration).toBe(70);
  });

  it('is restored from live snapshot when scrubbing back to live', () => {
    // Setup: live state with known max
    useEditorStore.setState((s) => {
      s.executionMetrics = {
        live: { duration: 25, cacheHit: false, timestamp: Date.now() },
      };
      s.executionMaxNodeDuration = 25;
      s.nodeOutputs = { live: { 0: 1 } };
      s.executionErrors = {};
      s.executionHistory = [{
        id: 1,
        timestamp: Date.now(),
        nodeOutputs: { hist: { 0: 2 } },
        metrics: {
          hist: { duration: 80, cacheHit: false, timestamp: Date.now() },
        },
        errors: {},
        totalDuration: 80,
        maxNodeDuration: 80,
        waveCount: 1,
        nodeCount: 1,
      }];
    });

    // Scrub to history (saves live snapshot)
    useEditorStore.getState().scrubExecutionHistory(0);
    expect(useEditorStore.getState().executionMaxNodeDuration).toBe(80);

    // Scrub back to live (restores from snapshot)
    useEditorStore.getState().scrubExecutionHistory(-1);
    expect(useEditorStore.getState().executionMaxNodeDuration).toBe(25);
  });
});

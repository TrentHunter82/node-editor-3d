/**
 * Worker Fallback Cascade Tests (Store-Level Integration)
 *
 * Tests the executeGraph action's fallback behavior:
 * - When worker execution succeeds, results are applied normally
 * - When worker execution fails (reject), main-thread fallback fires
 * - When worker is disabled, main-thread path is used directly
 *
 * Uses vi.mock to intercept the executeInWorker import at the module level
 * so that the executionSlice's import is replaced before store initialisation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

// Use vi.hoisted so the mock fn is available when vi.mock factory runs (hoisted above imports).
const { mockExecuteInWorker } = vi.hoisted(() => ({
  mockExecuteInWorker: vi.fn(),
}));

// Mock the worker manager module BEFORE importing the store.
// Vitest hoists vi.mock calls so this takes effect before any store module loads.
vi.mock('../workers/executionWorkerManager', () => ({
  executeInWorker: mockExecuteInWorker,
  getExecutionWorker: vi.fn(() => null),
  terminateExecutionWorker: vi.fn(),
  checkWorkerHealth: vi.fn(() => Promise.resolve(true)),
  startHealthMonitor: vi.fn(),
  stopHealthMonitor: vi.fn(),
}));

import { useEditorStore, _resetModuleState, cancelAutoExecute } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settingsStore';
import type { ExecuteResultMessage } from '../workers/execution.worker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  cancelAutoExecute();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.customNodeDefs = {};
    s.searchQuery = '';
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.templates = {};
    s.breadcrumbStack = [];
    s.subgraphDefs = {};
    s.errorStrategy = 'fail-fast';
    s.validationErrors = {};
    s.executionMetrics = {};
    s.showValuePreviews = false;
    s.undoRedoEvent = null;
    s.contextMenu = null;
    s.storageWarning = null;
  });
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, recentFiles: [] });
  localStorage.clear();
}

function getState() {
  return useEditorStore.getState();
}

// ---------------------------------------------------------------------------
// 7. Worker Fallback Cascade (Store-Level)
// ---------------------------------------------------------------------------

describe('Worker Fallback Cascade (Store-Level)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    mockExecuteInWorker.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('when worker execution succeeds, results are applied normally', async () => {
    // Enable worker execution
    useSettingsStore.setState({ workerExecution: true });

    // Add a source node
    const srcId = getState().addNode('source', [0, 0, 0]);

    // Mock executeInWorker to resolve with a valid result
    const workerResult: ExecuteResultMessage = {
      type: 'result',
      id: 1,
      results: [[srcId, { outputs: { 0: 42 }, inputHash: '{}' }]],
      waves: [[srcId]],
      errors: [],
      metrics: [[srcId, { duration: 1, cacheHit: false, timestamp: Date.now() }]],
      totalDuration: 1,
    };
    mockExecuteInWorker.mockResolvedValueOnce(workerResult);

    // Execute the graph
    getState().executeGraph();

    // Flush health check microtask so executeInWorker gets called
    await vi.advanceTimersByTimeAsync(0);

    // executeInWorker should have been called
    expect(mockExecuteInWorker).toHaveBeenCalledTimes(1);

    // Flush executeInWorker resolution + applyResults
    await vi.advanceTimersByTimeAsync(0);

    // Advance through wave animation timeouts
    await vi.advanceTimersByTimeAsync(2000);

    // The source node should have its output applied
    expect(getState().nodeOutputs[srcId]).toBeDefined();
    expect(getState().nodeOutputs[srcId][0]).toBe(42);
  });

  it('when worker execution fails, main-thread fallback fires and results are still correct', async () => {
    // Enable worker execution
    useSettingsStore.setState({ workerExecution: true });

    // Add a source node with a known value
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 99);

    // Mock executeInWorker to reject (simulating worker failure)
    mockExecuteInWorker.mockRejectedValueOnce(new Error('Worker crashed'));

    // Execute the graph
    getState().executeGraph();

    // Flush health check microtask so executeInWorker gets called
    await vi.advanceTimersByTimeAsync(0);

    // executeInWorker should have been called
    expect(mockExecuteInWorker).toHaveBeenCalledTimes(1);

    // Flush the rejected promise to trigger the catch fallback
    await vi.advanceTimersByTimeAsync(0);

    // Advance through wave animation timeouts
    await vi.advanceTimersByTimeAsync(2000);

    // The fallback main-thread execution should have produced results
    expect(getState().nodeOutputs[srcId]).toBeDefined();
    expect(getState().nodeOutputs[srcId][0]).toBe(99);
  });

  it('when worker is disabled, main-thread path is used directly', () => {
    // Ensure worker execution is disabled (default)
    useSettingsStore.setState({ workerExecution: false });

    // Add a source node with a known value
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 77);

    // Execute the graph
    getState().executeGraph();

    // executeInWorker should NOT have been called
    expect(mockExecuteInWorker).not.toHaveBeenCalled();

    // Advance through wave animation timeouts
    vi.advanceTimersByTime(2000);

    // Main-thread execution should have produced results directly
    expect(getState().nodeOutputs[srcId]).toBeDefined();
    expect(getState().nodeOutputs[srcId][0]).toBe(77);
  });
});

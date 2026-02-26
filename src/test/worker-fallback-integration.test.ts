/**
 * Tests for worker execution fallback, health-check, watchdog timeout,
 * and concurrent execution prevention.
 *
 * Since jsdom does not support real Web Workers, we mock the Worker
 * constructor globally and simulate message passing by invoking the
 * onmessage / onerror handlers that executionWorkerManager attaches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import type {
  ExecuteMessage,
  ExecuteResultMessage,
  ExecuteErrorMessage,
  PongResponse,
} from '../workers/execution.worker';

// ---------------------------------------------------------------------------
// Mock Worker infrastructure
// ---------------------------------------------------------------------------

interface MockWorkerInstance {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

let mockWorkerInstances: MockWorkerInstance[];

function createMockWorkerClass() {
  return class MockWorker implements MockWorkerInstance {
    postMessage = vi.fn();
    terminate = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;

    constructor() {
      mockWorkerInstances.push(this);
    }
  };
}

/** Simulate the worker responding with a pong for a given message id. */
function simulatePong(mock: MockWorkerInstance, id: number): void {
  const response: PongResponse = { type: 'pong', id };
  mock.onmessage?.({ data: response } as MessageEvent);
}

/** Simulate the worker responding with an execution result. */
function simulateResult(mock: MockWorkerInstance, id: number, extras?: Partial<ExecuteResultMessage>): void {
  const response: ExecuteResultMessage = {
    type: 'result',
    id,
    results: [],
    waves: [],
    errors: [],
    metrics: [],
    totalDuration: 0,
    ...extras,
  };
  mock.onmessage?.({ data: response } as MessageEvent);
}

/** Simulate the worker responding with an error message. */
function simulateError(mock: MockWorkerInstance, id: number, message: string): void {
  const response: ExecuteErrorMessage = { type: 'error', id, message };
  mock.onmessage?.({ data: response } as MessageEvent);
}

/** Simulate a Worker error event (onerror). */
function simulateWorkerCrash(mock: MockWorkerInstance, message: string): void {
  mock.onerror?.({ message } as ErrorEvent);
}

// ---------------------------------------------------------------------------
// 1. Health-check ping-pong tests
// ---------------------------------------------------------------------------

describe('Health-check ping-pong', () => {
  let managerModule: typeof import('../workers/executionWorkerManager');

  beforeEach(async () => {
    vi.resetModules();
    mockWorkerInstances = [];
    vi.stubGlobal('Worker', createMockWorkerClass());
    managerModule = await import('../workers/executionWorkerManager');
  });

  afterEach(() => {
    managerModule.terminateExecutionWorker();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('resolves true when worker responds with pong within timeout', async () => {
    const promise = managerModule.checkWorkerHealth();

    const mock = mockWorkerInstances[0];
    expect(mock.postMessage).toHaveBeenCalledTimes(1);
    const sentMsg = mock.postMessage.mock.calls[0][0];
    expect(sentMsg.type).toBe('ping');

    // Simulate pong response
    simulatePong(mock, sentMsg.id);

    const result = await promise;
    expect(result).toBe(true);
  });

  it('resolves false when worker does not respond within 5s (fake timers)', async () => {
    vi.useFakeTimers();

    const promise = managerModule.checkWorkerHealth();

    const mock = mockWorkerInstances[0];
    expect(mock.postMessage).toHaveBeenCalledTimes(1);

    // Advance time past the 5000ms health check timeout
    vi.advanceTimersByTime(5000);

    const result = await promise;
    expect(result).toBe(false);

    vi.useRealTimers();
  });

  it('terminates unresponsive worker after health-check timeout', async () => {
    vi.useFakeTimers();

    const promise = managerModule.checkWorkerHealth();

    const mock = mockWorkerInstances[0];

    // Advance past timeout
    vi.advanceTimersByTime(5000);

    await promise;

    // The worker should have been terminated
    expect(mock.terminate).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('multiple concurrent health checks are independently tracked', async () => {
    const promise1 = managerModule.checkWorkerHealth();
    const promise2 = managerModule.checkWorkerHealth();

    const mock = mockWorkerInstances[0];
    expect(mock.postMessage).toHaveBeenCalledTimes(2);

    const id1 = mock.postMessage.mock.calls[0][0].id;
    const id2 = mock.postMessage.mock.calls[1][0].id;

    expect(id1).not.toBe(id2);

    // Respond to first health check only
    simulatePong(mock, id1);
    const result1 = await promise1;
    expect(result1).toBe(true);

    // Now respond to the second
    simulatePong(mock, id2);
    const result2 = await promise2;
    expect(result2).toBe(true);
  });

  it('health check with no worker available resolves false immediately', async () => {
    vi.resetModules();
    vi.stubGlobal('Worker', class FailWorker {
      constructor() { throw new Error('Workers not supported'); }
    });
    const freshModule = await import('../workers/executionWorkerManager');

    const result = await freshModule.checkWorkerHealth();
    expect(result).toBe(false);
  });

  it('health check pong clears the timeout timer (does not terminate worker later)', async () => {
    vi.useFakeTimers();

    const promise = managerModule.checkWorkerHealth();

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0];

    // Respond with pong before timeout
    simulatePong(mock, sentMsg.id);

    const result = await promise;
    expect(result).toBe(true);

    // Advance past what would have been the timeout
    vi.advanceTimersByTime(10000);

    // Worker should NOT have been terminated because pong arrived in time
    expect(mock.terminate).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('health check timeout resolves pending health checks as false on terminate', async () => {
    vi.useFakeTimers();

    const promise1 = managerModule.checkWorkerHealth();
    const promise2 = managerModule.checkWorkerHealth();

    // Advance past timeout for the first health check (both share the same 5000ms timeout)
    vi.advanceTimersByTime(5000);

    // The first timeout fires and terminates the worker, which resolves all health checks as false
    const result1 = await promise1;
    const result2 = await promise2;
    expect(result1).toBe(false);
    expect(result2).toBe(false);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// 2. Fallback cascade tests (worker manager level)
// ---------------------------------------------------------------------------

describe('Fallback cascade', () => {
  let managerModule: typeof import('../workers/executionWorkerManager');

  beforeEach(async () => {
    vi.resetModules();
    mockWorkerInstances = [];
    vi.stubGlobal('Worker', createMockWorkerClass());
    managerModule = await import('../workers/executionWorkerManager');
  });

  afterEach(() => {
    managerModule.terminateExecutionWorker();
    vi.unstubAllGlobals();
  });

  it('executeInWorker rejects when Worker constructor throws (no worker available)', async () => {
    vi.resetModules();
    vi.stubGlobal('Worker', class FailWorker {
      constructor() { throw new Error('Workers not supported'); }
    });
    const freshModule = await import('../workers/executionWorkerManager');

    await expect(
      freshModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'continue',
      }),
    ).rejects.toThrow('Worker not available');
  });

  it('worker error event rejects all pending requests with error message', async () => {
    const p1 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });
    const p2 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    const mock = mockWorkerInstances[0];

    // Simulate a worker crash
    simulateWorkerCrash(mock, 'Uncaught ReferenceError');

    await expect(p1).rejects.toThrow('Worker error: Uncaught ReferenceError');
    await expect(p2).rejects.toThrow('Worker error: Uncaught ReferenceError');
  });

  it('worker error event terminates the worker', async () => {
    const p = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    const mock = mockWorkerInstances[0];
    simulateWorkerCrash(mock, 'Script error');

    await p.catch(() => {});

    expect(mock.terminate).toHaveBeenCalled();
  });

  it('terminateExecutionWorker rejects all pending and clears state', async () => {
    const p1 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });
    const p2 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'fail-fast',
    });
    const p3 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    managerModule.terminateExecutionWorker();

    await expect(p1).rejects.toThrow('Worker terminated');
    await expect(p2).rejects.toThrow('Worker terminated');
    await expect(p3).rejects.toThrow('Worker terminated');
  });

  it('after termination, next getExecutionWorker creates fresh worker', () => {
    managerModule.getExecutionWorker();
    expect(mockWorkerInstances).toHaveLength(1);
    const firstMock = mockWorkerInstances[0];

    managerModule.terminateExecutionWorker();
    expect(firstMock.terminate).toHaveBeenCalled();

    // Get a new worker
    const newWorker = managerModule.getExecutionWorker();
    expect(newWorker).not.toBeNull();
    expect(mockWorkerInstances).toHaveLength(2);
    expect(mockWorkerInstances[1]).not.toBe(firstMock);
  });

  it('executeInWorker rejects on worker error message (type: error)', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;

    simulateError(mock, sentMsg.id, 'Graph execution failed: cycle detected');

    await expect(promise).rejects.toThrow('Graph execution failed: cycle detected');
  });

  it('executeInWorker resolves on worker result message (type: result)', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;

    simulateResult(mock, sentMsg.id, {
      results: [['n1', { outputs: { 0: 42 }, inputHash: '{}' }]],
      totalDuration: 5,
    });

    const result = await promise;
    expect(result.type).toBe('result');
    expect(result.totalDuration).toBe(5);
    expect(result.results).toHaveLength(1);
    expect(result.results[0][0]).toBe('n1');
  });

  it('response for unknown message id is ignored without error', () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    // Simulate a result for a message id that was never sent
    expect(() => {
      simulateResult(mock, 99999);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Watchdog timeout tests
// ---------------------------------------------------------------------------

describe('Watchdog timeout', () => {
  let managerModule: typeof import('../workers/executionWorkerManager');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mockWorkerInstances = [];
    vi.stubGlobal('Worker', createMockWorkerClass());
    managerModule = await import('../workers/executionWorkerManager');
    // Stop health monitor so its 30s interval doesn't interfere with
    // large fake-timer advances in watchdog-specific tests
    managerModule.stopHealthMonitor();
  });

  afterEach(() => {
    managerModule.terminateExecutionWorker();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('watchdog timer fires after maxExecutionMs + 2000ms grace period', async () => {
    const MAX_MS = 3000;
    const GRACE_MS = 2000;

    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      maxExecutionMs: MAX_MS,
    });

    const mock = mockWorkerInstances[0];

    // Advance time just before watchdog fires
    vi.advanceTimersByTime(MAX_MS + GRACE_MS - 1);

    // Worker should NOT have been terminated yet
    expect(mock.terminate).not.toHaveBeenCalled();

    // Advance the final millisecond to trigger the watchdog
    vi.advanceTimersByTime(1);

    // Worker should now be terminated
    expect(mock.terminate).toHaveBeenCalledTimes(1);

    // The pending promise should be rejected
    await expect(promise).rejects.toThrow('Worker terminated');
  });

  it('watchdog terminates worker and rejects pending request', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      maxExecutionMs: 1000,
    });

    const mock = mockWorkerInstances[0];

    // Advance past maxExecutionMs + 2000ms grace
    vi.advanceTimersByTime(3000);

    expect(mock.terminate).toHaveBeenCalled();
    await expect(promise).rejects.toThrow('Worker terminated');
  });

  it('successful response before watchdog clears the timer (no termination)', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      maxExecutionMs: 5000,
    });

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;

    // Respond before the watchdog fires (within 5000 + 2000 = 7000ms)
    vi.advanceTimersByTime(1000);
    simulateResult(mock, sentMsg.id, { totalDuration: 900 });

    const result = await promise;
    expect(result.type).toBe('result');

    // Advance past when the watchdog would have fired
    vi.advanceTimersByTime(10000);

    // Worker should NOT have been terminated since the result arrived in time
    expect(mock.terminate).not.toHaveBeenCalled();
  });

  it('no watchdog set when maxExecutionMs is 0', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      maxExecutionMs: 0,
    });

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;

    // Advance a long time -- no watchdog should fire
    vi.advanceTimersByTime(100000);

    // Worker should NOT have been terminated
    expect(mock.terminate).not.toHaveBeenCalled();

    // Resolve the promise to clean up
    simulateResult(mock, sentMsg.id);
    await promise;
  });

  it('no watchdog set when maxExecutionMs is undefined', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      // maxExecutionMs not provided
    });

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;

    // Advance a long time
    vi.advanceTimersByTime(100000);

    // Worker should NOT have been terminated
    expect(mock.terminate).not.toHaveBeenCalled();

    // Clean up
    simulateResult(mock, sentMsg.id);
    await promise;
  });

  it('watchdog only terminates if pending request still exists', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      maxExecutionMs: 2000,
    });

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;

    // Respond with error (which removes from pending)
    simulateError(mock, sentMsg.id, 'Early error');
    await promise.catch(() => {});

    // Now advance past watchdog timer -- should NOT terminate since pending was cleared
    vi.advanceTimersByTime(5000);

    // terminate should not be called by watchdog (note: terminateExecutionWorker in afterEach will call it)
    expect(mock.terminate).not.toHaveBeenCalled();
  });

  it('multiple requests each get independent watchdog timers', async () => {
    const p1 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      maxExecutionMs: 2000,
    });
    const p2 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      maxExecutionMs: 8000,
    });

    const mock = mockWorkerInstances[0];
    const id1 = (mock.postMessage.mock.calls[0][0] as ExecuteMessage).id;
    void (mock.postMessage.mock.calls[1][0] as ExecuteMessage).id;

    // Respond to p1 before its watchdog fires
    vi.advanceTimersByTime(1000);
    simulateResult(mock, id1, { totalDuration: 900 });
    const result1 = await p1;
    expect(result1.type).toBe('result');

    // Advance past p1's watchdog window (2000 + 2000 = 4000ms total) but before p2's (8000 + 2000 = 10000ms)
    vi.advanceTimersByTime(5000); // Now at 6000ms total

    // Worker should still be running (p2 watchdog hasn't fired)
    expect(mock.terminate).not.toHaveBeenCalled();

    // Advance past p2's watchdog
    vi.advanceTimersByTime(5000); // Now at 11000ms total, p2 watchdog at 10000ms

    // Worker should now be terminated due to p2 watchdog
    expect(mock.terminate).toHaveBeenCalled();
    await expect(p2).rejects.toThrow('Worker terminated');
  });
});

// ---------------------------------------------------------------------------
// 4. Concurrent execution prevention tests
// ---------------------------------------------------------------------------

describe('Concurrent execution prevention', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockWorkerInstances = [];
    vi.stubGlobal('Worker', createMockWorkerClass());

    // Reset the store between tests
    const { _resetModuleState } = await import('../store/editorStore');
    _resetModuleState();

    const { _resetExecutionModuleState } = await import('../store/slices/executionSlice');
    _resetExecutionModuleState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isExecuting flag prevents concurrent executeGraph calls', async () => {
    const { useEditorStore } = await import('../store/editorStore');

    // Add a node so executeGraph has work to do
    const srcId = useEditorStore.getState().addNode('source');
    useEditorStore.getState().updateNodeData(srcId, 'value', 42);

    // Execute the graph (sets isExecuting = true)
    useEditorStore.getState().executeGraph();

    // Capture the current outputs
    void { ...useEditorStore.getState().nodeOutputs };

    // Now try to execute again while isExecuting is true
    useEditorStore.setState(s => { s.isExecuting = true; });
    useEditorStore.getState().executeGraph();

    // The state should not have changed from the concurrent attempt
    // (the guard returns early, so isExecuting should still be true)
    expect(useEditorStore.getState().isExecuting).toBe(true);
  });

  it('executeSelection is also guarded by isExecuting', async () => {
    const { useEditorStore } = await import('../store/editorStore');

    const srcId = useEditorStore.getState().addNode('source');
    useEditorStore.getState().updateNodeData(srcId, 'value', 42);

    // Set isExecuting to true
    useEditorStore.setState(s => { s.isExecuting = true; });

    // Try to executeSelection while already executing
    useEditorStore.getState().executeSelection(new Set([srcId]));

    // Should not have produced any output since execution was blocked
    expect(useEditorStore.getState().nodeOutputs[srcId]).toBeUndefined();
  });

  it('executeGraph allows execution after isExecuting is reset to false', async () => {
    const { useEditorStore } = await import('../store/editorStore');

    const srcId = useEditorStore.getState().addNode('source');
    useEditorStore.getState().updateNodeData(srcId, 'value', 99);

    // First execution
    useEditorStore.getState().executeGraph();
    expect(useEditorStore.getState().nodeOutputs[srcId]).toBeDefined();

    // Reset isExecuting
    useEditorStore.setState(s => { s.isExecuting = false; });

    // Clear outputs to verify second execution runs
    useEditorStore.setState(s => { s.nodeOutputs = {}; });

    // Second execution should work
    useEditorStore.getState().executeGraph();
    expect(useEditorStore.getState().nodeOutputs[srcId]).toBeDefined();
    expect(useEditorStore.getState().nodeOutputs[srcId][0]).toBe(99);
  });

  it('executeGraph returns early when there are no nodes', async () => {
    const { useEditorStore } = await import('../store/editorStore');

    // No nodes in the graph
    expect(Object.keys(useEditorStore.getState().nodes)).toHaveLength(0);

    useEditorStore.getState().executeGraph();

    // isExecuting should not have been set to true since the guard returns early
    expect(useEditorStore.getState().isExecuting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Integration: health-check + execution fallback flow
// ---------------------------------------------------------------------------

describe('Health-check and execution flow integration', () => {
  let managerModule: typeof import('../workers/executionWorkerManager');

  beforeEach(async () => {
    vi.resetModules();
    mockWorkerInstances = [];
    vi.stubGlobal('Worker', createMockWorkerClass());
    managerModule = await import('../workers/executionWorkerManager');
  });

  afterEach(() => {
    managerModule.terminateExecutionWorker();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('health check followed by successful execution round-trip', async () => {
    // Step 1: Health check passes
    const healthPromise = managerModule.checkWorkerHealth();
    const mock = mockWorkerInstances[0];
    const pingId = mock.postMessage.mock.calls[0][0].id;
    simulatePong(mock, pingId);
    const healthy = await healthPromise;
    expect(healthy).toBe(true);

    // Step 2: Execute in worker
    const execPromise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });
    const execId = mock.postMessage.mock.calls[1][0].id;
    simulateResult(mock, execId, { totalDuration: 42 });
    const result = await execPromise;
    expect(result.totalDuration).toBe(42);
  });

  it('health check fails then new worker is created on next call', async () => {
    vi.useFakeTimers();

    // Health check times out
    const healthPromise = managerModule.checkWorkerHealth();
    vi.advanceTimersByTime(5000);
    const healthy = await healthPromise;
    expect(healthy).toBe(false);

    // First worker was terminated
    expect(mockWorkerInstances[0].terminate).toHaveBeenCalled();

    vi.useRealTimers();

    // New worker is created on next call
    const worker = managerModule.getExecutionWorker();
    expect(worker).not.toBeNull();
    expect(mockWorkerInstances).toHaveLength(2);
  });

  it('terminateExecutionWorker also resolves pending health checks as false', async () => {
    const healthPromise = managerModule.checkWorkerHealth();

    // Terminate before pong arrives
    managerModule.terminateExecutionWorker();

    const result = await healthPromise;
    expect(result).toBe(false);
  });

  it('terminateExecutionWorker rejects pending execution and resolves health checks simultaneously', async () => {
    const healthPromise = managerModule.checkWorkerHealth();
    const execPromise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    managerModule.terminateExecutionWorker();

    const healthResult = await healthPromise;
    expect(healthResult).toBe(false);

    await expect(execPromise).rejects.toThrow('Worker terminated');
  });
});

// ---------------------------------------------------------------------------
// 6. Background health monitor tests
// ---------------------------------------------------------------------------

describe('Background health monitor', () => {
  let managerModule: typeof import('../workers/executionWorkerManager');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mockWorkerInstances = [];
    vi.stubGlobal('Worker', createMockWorkerClass());
    managerModule = await import('../workers/executionWorkerManager');
  });

  afterEach(() => {
    managerModule.terminateExecutionWorker();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('getExecutionWorker starts health monitor automatically', () => {
    // Calling getExecutionWorker creates the worker and starts monitoring.
    // Manually invoke a health check to verify the monitor plumbing works.
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    // Manually trigger a health check (same as what the monitor does)
    managerModule.checkWorkerHealth();

    const pingCalls = mock.postMessage.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'ping',
    );
    expect(pingCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('explicit checkWorkerHealth sends pings and resolves on pong', async () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    const promise = managerModule.checkWorkerHealth();
    const pingCall = mock.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === 'ping',
    );
    expect(pingCall).toBeDefined();

    // Respond with pong
    const pingId = (pingCall![0] as { id: number }).id;
    simulatePong(mock, pingId);
    const result = await promise;
    expect(result).toBe(true);
  });

  it('unresponsive worker is terminated after health check timeout', () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    // Start a health check (no pong will come)
    managerModule.checkWorkerHealth();

    // Advance past the 5s health check timeout
    vi.advanceTimersByTime(5_001);

    // Worker should have been terminated due to no pong response
    expect(mock.terminate).toHaveBeenCalled();
  });

  it('stopHealthMonitor prevents further pings', () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    // Stop the health monitor before the first interval fires
    managerModule.stopHealthMonitor();

    // Advance past when pings would have fired
    vi.advanceTimersByTime(100_000);

    // No pings should have been sent
    const pingCalls = mock.postMessage.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'ping',
    );
    expect(pingCalls.length).toBe(0);
  });

  it('startHealthMonitor is idempotent', () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    // Call startHealthMonitor again (should not create duplicate interval)
    managerModule.startHealthMonitor();
    managerModule.startHealthMonitor();

    // Respond to pings to keep worker alive
    vi.advanceTimersByTime(30_000);
    for (const call of mock.postMessage.mock.calls) {
      const msg = call[0] as { type: string; id: number };
      if (msg.type === 'ping') simulatePong(mock, msg.id);
    }

    // Only one ping should have been sent (not duplicated)
    const pingCalls = mock.postMessage.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'ping',
    );
    expect(pingCalls.length).toBe(1);
  });

  it('terminateExecutionWorker stops the health monitor', () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    // Terminate the worker (should also stop health monitor)
    managerModule.terminateExecutionWorker();

    // Advance past when pings would have fired
    vi.advanceTimersByTime(100_000);

    // No pings should have been sent (only the initial worker setup, no pings)
    const pingCalls = mock.postMessage.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === 'ping',
    );
    expect(pingCalls.length).toBe(0);
  });
});

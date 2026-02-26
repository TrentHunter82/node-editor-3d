/**
 * Worker watchdog regression tests: tests the execution worker manager's
 * timeout and watchdog paths.
 *
 * Mocks Worker to simulate:
 * (a) worker never responds → watchdog fires
 * (b) worker responds after timeout → late result handled gracefully
 * (c) worker.onerror → promise rejects correctly
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ExecuteResultMessage, WorkerResponse } from '../workers/execution.worker';

// ---------------------------------------------------------------------------
// Mock Worker infrastructure
// ---------------------------------------------------------------------------

interface MockWorkerInstance {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

let mockWorkerInstances: MockWorkerInstance[];

function createMockWorkerClass() {
  return class MockWorker {
    postMessage = vi.fn();
    terminate = vi.fn();
    onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;

    constructor() {
      mockWorkerInstances.push(this as unknown as MockWorkerInstance);
    }
  };
}

/** Create a mock successful result message */
function makeResult(id: number): ExecuteResultMessage {
  return {
    type: 'result',
    id,
    results: [],
    waves: [],
    errors: [],
    metrics: [],
    totalDuration: 10,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worker Watchdog Regression Tests', () => {
  let managerModule: typeof import('../workers/executionWorkerManager');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mockWorkerInstances = [];

    // Stub the Worker global with our mock
    vi.stubGlobal('Worker', createMockWorkerClass());

    // Dynamic import to get fresh module state per test
    managerModule = await import('../workers/executionWorkerManager');

    // Stop health monitor to prevent interference with fake timer advances.
    // Tests that advance timers by large amounts would otherwise trigger the
    // 30s health monitor interval, causing unexpected worker terminations.
    managerModule.stopHealthMonitor();
  });

  afterEach(() => {
    // Clean up any remaining worker
    try { managerModule.terminateExecutionWorker(); } catch { /* ignore */ }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Basic worker lifecycle
  // =========================================================================

  describe('Worker lifecycle', () => {
    it('creates worker lazily on first getExecutionWorker call', () => {
      expect(mockWorkerInstances).toHaveLength(0);
      managerModule.getExecutionWorker();
      expect(mockWorkerInstances).toHaveLength(1);
    });

    it('returns same worker on subsequent calls', () => {
      const w1 = managerModule.getExecutionWorker();
      const w2 = managerModule.getExecutionWorker();
      expect(w1).toBe(w2);
      expect(mockWorkerInstances).toHaveLength(1);
    });

    it('terminateExecutionWorker calls terminate on the worker', () => {
      managerModule.getExecutionWorker();
      const mock = mockWorkerInstances[0];
      managerModule.terminateExecutionWorker();
      expect(mock.terminate).toHaveBeenCalledOnce();
    });

    it('creates new worker after terminate + getExecutionWorker', () => {
      managerModule.getExecutionWorker();
      managerModule.terminateExecutionWorker();
      managerModule.getExecutionWorker();
      expect(mockWorkerInstances).toHaveLength(2);
    });
  });

  // =========================================================================
  // Normal execution flow
  // =========================================================================

  describe('Normal execution', () => {
    it('resolves with result when worker responds promptly', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });

      // Simulate immediate worker response
      const mock = mockWorkerInstances[0];
      const postedMsg = mock.postMessage.mock.calls[0][0];
      mock.onmessage!({ data: makeResult(postedMsg.id) } as MessageEvent);

      const result = await promise;
      expect(result.type).toBe('result');
      expect(result.totalDuration).toBe(10);
    });

    it('rejects when worker sends error message', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });

      const mock = mockWorkerInstances[0];
      const postedMsg = mock.postMessage.mock.calls[0][0];
      mock.onmessage!({
        data: { type: 'error', id: postedMsg.id, message: 'Execution failed' },
      } as MessageEvent);

      await expect(promise).rejects.toThrow('Execution failed');
    });

    it('handles multiple concurrent requests', async () => {
      const p1 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });
      const p2 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });

      const mock = mockWorkerInstances[0];
      const msg1 = mock.postMessage.mock.calls[0][0];
      const msg2 = mock.postMessage.mock.calls[1][0];

      // IDs should be different
      expect(msg1.id).not.toBe(msg2.id);

      // Respond to both
      mock.onmessage!({ data: makeResult(msg2.id) } as MessageEvent);
      mock.onmessage!({ data: makeResult(msg1.id) } as MessageEvent);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.type).toBe('result');
      expect(r2.type).toBe('result');
    });
  });

  // =========================================================================
  // Watchdog timeout: worker never responds
  // =========================================================================

  describe('Watchdog: worker never responds', () => {
    it('rejects with "Worker terminated" when watchdog fires', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 5000,
      });

      // Advance past the watchdog timeout (maxExecutionMs + 2000ms grace)
      vi.advanceTimersByTime(7001);

      await expect(promise).rejects.toThrow('Worker terminated');
    });

    it('terminates the worker when watchdog fires', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 3000,
      });

      const mock = mockWorkerInstances[0];

      // Advance past watchdog: 3000 + 2000 grace = 5000
      vi.advanceTimersByTime(5001);

      // Worker should have been terminated
      expect(mock.terminate).toHaveBeenCalled();

      await expect(promise).rejects.toThrow('Worker terminated');
    });

    it('creates new worker after watchdog-triggered termination', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 1000,
      });

      vi.advanceTimersByTime(3001);
      await expect(promise).rejects.toThrow();

      // Getting worker again should create a new one
      managerModule.getExecutionWorker();
      expect(mockWorkerInstances).toHaveLength(2);
    });

    it('watchdog does not fire if no maxExecutionMs', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        // No maxExecutionMs
      });

      // Advance by a long time
      vi.advanceTimersByTime(100000);

      // Promise should still be pending (not rejected)
      const mock = mockWorkerInstances[0];
      expect(mock.terminate).not.toHaveBeenCalled();

      // Resolve normally
      const postedMsg = mock.postMessage.mock.calls[0][0];
      mock.onmessage!({ data: makeResult(postedMsg.id) } as MessageEvent);

      const result = await promise;
      expect(result.type).toBe('result');
    });

    it('watchdog does not fire when maxExecutionMs is 0', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 0,
      });

      vi.advanceTimersByTime(100000);

      const mock = mockWorkerInstances[0];
      expect(mock.terminate).not.toHaveBeenCalled();

      // Resolve normally
      const postedMsg = mock.postMessage.mock.calls[0][0];
      mock.onmessage!({ data: makeResult(postedMsg.id) } as MessageEvent);
      const result = await promise;
      expect(result.type).toBe('result');
    });

    it('watchdog does not fire when maxExecutionMs is negative', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: -100,
      });

      vi.advanceTimersByTime(100000);

      const mock = mockWorkerInstances[0];
      expect(mock.terminate).not.toHaveBeenCalled();

      const postedMsg = mock.postMessage.mock.calls[0][0];
      mock.onmessage!({ data: makeResult(postedMsg.id) } as MessageEvent);
      const result = await promise;
      expect(result.type).toBe('result');
    });

    it('watchdog cleared when worker responds in time', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 5000,
      });

      // Worker responds within timeout
      const mock = mockWorkerInstances[0];
      const postedMsg = mock.postMessage.mock.calls[0][0];
      vi.advanceTimersByTime(1000);
      mock.onmessage!({ data: makeResult(postedMsg.id) } as MessageEvent);

      const result = await promise;
      expect(result.type).toBe('result');

      // Advance past original watchdog timeout
      vi.advanceTimersByTime(10000);

      // Worker should NOT have been terminated
      expect(mock.terminate).not.toHaveBeenCalled();
    });

    it('rejects multiple pending requests on watchdog-triggered termination', async () => {
      const p1 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 2000,
      });
      const p2 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });

      // Watchdog for p1 fires at 2000 + 2000 = 4000ms
      vi.advanceTimersByTime(4001);

      // Both should be rejected since terminateExecutionWorker rejects all pending
      await expect(p1).rejects.toThrow('Worker terminated');
      await expect(p2).rejects.toThrow('Worker terminated');
    });
  });

  // =========================================================================
  // Late response: worker responds after timeout
  // =========================================================================

  describe('Late response handling', () => {
    it('late response after watchdog is handled gracefully', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 1000,
      });

      const mock = mockWorkerInstances[0];
      const postedMsg = mock.postMessage.mock.calls[0][0];

      // Watchdog fires at 1000 + 2000 = 3000ms
      vi.advanceTimersByTime(3001);
      await expect(promise).rejects.toThrow('Worker terminated');

      // Late response arrives on the OLD worker instance — should not crash
      // (pending map was cleared, so onmessage is a no-op for this ID)
      expect(() => {
        mock.onmessage?.({ data: makeResult(postedMsg.id) } as MessageEvent);
      }).not.toThrow();
    });

    it('new request after watchdog works on new worker', async () => {
      // First request — times out
      const p1 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 1000,
      });

      vi.advanceTimersByTime(3001);
      await expect(p1).rejects.toThrow();

      // Second request — should work on a new worker
      const p2 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });

      expect(mockWorkerInstances).toHaveLength(2);
      const mock2 = mockWorkerInstances[1];
      const postedMsg2 = mock2.postMessage.mock.calls[0][0];
      mock2.onmessage!({ data: makeResult(postedMsg2.id) } as MessageEvent);

      const result = await p2;
      expect(result.type).toBe('result');
    });
  });

  // =========================================================================
  // Worker.onerror handling
  // =========================================================================

  describe('Worker.onerror', () => {
    it('rejects pending request with worker error message', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });

      const mock = mockWorkerInstances[0];
      mock.onerror!({ message: 'Script load failed' } as ErrorEvent);

      await expect(promise).rejects.toThrow('Worker error: Script load failed');
    });

    it('rejects ALL pending requests on onerror', async () => {
      const p1 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });
      const p2 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });
      const p3 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });

      const mock = mockWorkerInstances[0];
      mock.onerror!({ message: 'Crash' } as ErrorEvent);

      await expect(p1).rejects.toThrow('Worker error: Crash');
      await expect(p2).rejects.toThrow('Worker error: Crash');
      await expect(p3).rejects.toThrow('Worker error: Crash');
    });

    it('terminates worker on onerror', async () => {
      managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      }).catch(() => { /* expected */ });

      const mock = mockWorkerInstances[0];
      mock.onerror!({ message: 'Error' } as ErrorEvent);

      // Worker should be terminated
      expect(mock.terminate).toHaveBeenCalled();
    });

    it('creates new worker after onerror + getExecutionWorker', async () => {
      managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      }).catch(() => { /* expected */ });

      const mock = mockWorkerInstances[0];
      mock.onerror!({ message: 'Error' } as ErrorEvent);

      // New worker should be created
      managerModule.getExecutionWorker();
      expect(mockWorkerInstances).toHaveLength(2);
    });

    it('onerror clears watchdog timers', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 5000,
      });

      const mock = mockWorkerInstances[0];
      mock.onerror!({ message: 'Error' } as ErrorEvent);

      await expect(promise).rejects.toThrow('Worker error: Error');

      // Advance past watchdog time — should not cause additional termination
      vi.advanceTimersByTime(10000);

      // terminate was called once by onerror, but not again by watchdog
      // (terminateExecutionWorker clears watchdog timers)
      expect(mock.terminate).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // terminateExecutionWorker edge cases
  // =========================================================================

  describe('terminateExecutionWorker edge cases', () => {
    it('terminateExecutionWorker when no worker exists does not throw', () => {
      expect(() => managerModule.terminateExecutionWorker()).not.toThrow();
    });

    it('double terminate does not throw', () => {
      managerModule.getExecutionWorker();
      managerModule.terminateExecutionWorker();
      expect(() => managerModule.terminateExecutionWorker()).not.toThrow();
    });

    it('terminateExecutionWorker rejects all pending and clears watchdogs', async () => {
      const p1 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 10000,
      });
      const p2 = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 10000,
      });

      managerModule.terminateExecutionWorker();

      await expect(p1).rejects.toThrow('Worker terminated');
      await expect(p2).rejects.toThrow('Worker terminated');

      // Advance past watchdog — no additional effects since watchdogs cleared
      vi.advanceTimersByTime(20000);
    });
  });

  // =========================================================================
  // Worker construction failure
  // =========================================================================

  describe('Worker construction failure', () => {
    it('returns null when Worker constructor throws', async () => {
      vi.stubGlobal('Worker', class FailingWorker {
        constructor() { throw new Error('Worker not supported'); }
      });

      // Need fresh module import
      vi.resetModules();
      const freshModule = await import('../workers/executionWorkerManager');

      const worker = freshModule.getExecutionWorker();
      expect(worker).toBeNull();
    });

    it('executeInWorker rejects when Worker unavailable', async () => {
      vi.stubGlobal('Worker', class FailingWorker {
        constructor() { throw new Error('Not supported'); }
      });

      vi.resetModules();
      const freshModule = await import('../workers/executionWorkerManager');

      await expect(
        freshModule.executeInWorker({
          nodes: {},
          connections: {},
          errorStrategy: 'fail-fast',
        }),
      ).rejects.toThrow('Worker not available');
    });
  });

  // =========================================================================
  // Message ID tracking
  // =========================================================================

  describe('Message ID tracking', () => {
    it('increments message IDs across calls', () => {
      managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      }).catch(() => {});
      managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      }).catch(() => {});

      const mock = mockWorkerInstances[0];
      const id1 = mock.postMessage.mock.calls[0][0].id;
      const id2 = mock.postMessage.mock.calls[1][0].id;
      expect(id2).toBe(id1 + 1);
    });

    it('ignores responses with unknown IDs', async () => {
      const promise = managerModule.executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
      });

      const mock = mockWorkerInstances[0];
      const postedMsg = mock.postMessage.mock.calls[0][0];

      // Send response with wrong ID
      expect(() => {
        mock.onmessage!({ data: makeResult(99999) } as MessageEvent);
      }).not.toThrow();

      // Original promise should still be pending — resolve it normally
      mock.onmessage!({ data: makeResult(postedMsg.id) } as MessageEvent);
      const result = await promise;
      expect(result.type).toBe('result');
    });
  });
});

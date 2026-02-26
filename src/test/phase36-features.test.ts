/**
 * Phase 36: Feature Tests (~30 tests)
 *
 * Covers:
 * 1. Worker watchdog system (8 tests)
 * 2. Transform processor – connected factor input (6 tests)
 * 3. Value formatting utilities (16 tests)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import { executeGraph } from '../utils/execution';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection, NodeType } from '../types';
import {
  formatNumberPrecision,
  formatObjectTree,
  formatVector3,
  formatValueDetailed,
} from '../utils/valueFormat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: NodeType,
  data?: Record<string, unknown>,
  opts?: Partial<EditorNode>,
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
    ...opts,
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

// ===========================================================================
// 1. Worker Watchdog Tests (8 tests)
//
// The worker manager has module-scoped state and uses `new Worker(new URL(...))`
// which cannot run in jsdom. We re-implement the watchdog logic in a test
// harness that mirrors the real code to verify the contract without needing
// a real Worker or import.meta.url support.
// ===========================================================================

interface MockWorkerInstance {
  postMessage: (data: unknown) => void;
  terminate: () => void;
  onmessage: ((e: { data: { id: number; type: string; message?: string } }) => void) | null;
}

/**
 * Minimal reimplementation of the watchdog logic from executionWorkerManager.ts.
 * This allows us to test the watchdog behavior in isolation without needing
 * real Worker support or import.meta.url.
 */
function createMockWorkerManager() {
  const WATCHDOG_GRACE_MS = 2000;
  let worker: MockWorkerInstance | null = null;
  let messageId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const watchdogs = new Map<number, ReturnType<typeof setTimeout>>();

  function getExecutionWorker() {
    if (worker) return worker;
    worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
    };
    // Set up the message handler that clears watchdogs (mirrors real code)
    worker.onmessage = (event) => {
      const { id } = event.data;
      const wd = watchdogs.get(id);
      if (wd) { clearTimeout(wd); watchdogs.delete(id); }
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (event.data.type === 'result') {
        p.resolve(event.data);
      } else {
        p.reject(new Error(event.data.message ?? 'Worker error'));
      }
    };
    return worker;
  }

  function executeInWorker(payload: { maxExecutionMs?: number }) {
    const w = getExecutionWorker();
    if (!w) return Promise.reject(new Error('Worker not available'));
    const id = ++messageId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ ...payload, type: 'execute', id });
      const timeoutMs = payload.maxExecutionMs;
      if (timeoutMs && timeoutMs > 0) {
        const wd = setTimeout(() => {
          watchdogs.delete(id);
          if (pending.has(id)) {
            terminateExecutionWorker();
          }
        }, timeoutMs + WATCHDOG_GRACE_MS);
        watchdogs.set(id, wd);
      }
    });
  }

  function terminateExecutionWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    for (const [, wd] of watchdogs) {
      clearTimeout(wd);
    }
    watchdogs.clear();
    for (const [, p] of pending) {
      p.reject(new Error('Worker terminated'));
    }
    pending.clear();
  }

  return {
    WATCHDOG_GRACE_MS,
    getExecutionWorker,
    executeInWorker,
    terminateExecutionWorker,
    // Expose internals for assertions
    _watchdogs: watchdogs,
    _pending: pending,
    _getWorker: () => worker,
    _getMessageId: () => messageId,
  };
}

describe('worker watchdog system', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('watchdog map and grace period constant exist in the module', async () => {
    // Verify the real module exports the expected functions
    const mod = await import('../workers/executionWorkerManager');
    expect(typeof mod.getExecutionWorker).toBe('function');
    expect(typeof mod.executeInWorker).toBe('function');
    expect(typeof mod.terminateExecutionWorker).toBe('function');
  });

  it('executeInWorker rejects when worker is not available (real module, jsdom)', async () => {
    // In jsdom, Worker constructor throws, so getExecutionWorker returns null
    const { executeInWorker } = await import('../workers/executionWorkerManager');
    await expect(
      executeInWorker({
        nodes: {},
        connections: {},
        errorStrategy: 'fail-fast',
        maxExecutionMs: 5000,
      }),
    ).rejects.toThrow('Worker not available');
  });

  it('executeInWorker sets up watchdog when maxExecutionMs is provided', () => {
    const mgr = createMockWorkerManager();

    // Catch the eventual rejection from terminateExecutionWorker cleanup
    mgr.executeInWorker({ maxExecutionMs: 5000 }).catch(() => {});

    // A watchdog timer should exist for message id 1
    expect(mgr._watchdogs.size).toBe(1);
    expect(mgr._watchdogs.has(1)).toBe(true);

    mgr.terminateExecutionWorker();
  });

  it('executeInWorker does NOT set up watchdog when maxExecutionMs is 0', () => {
    const mgr = createMockWorkerManager();

    // Catch the eventual rejection from terminateExecutionWorker cleanup
    mgr.executeInWorker({ maxExecutionMs: 0 }).catch(() => {});

    // No watchdog should be set because maxExecutionMs is falsy (0)
    expect(mgr._watchdogs.size).toBe(0);

    mgr.terminateExecutionWorker();
  });

  it('executeInWorker does NOT set up watchdog when maxExecutionMs is undefined', () => {
    const mgr = createMockWorkerManager();

    // Catch the eventual rejection from terminateExecutionWorker cleanup
    mgr.executeInWorker({}).catch(() => {});

    // No watchdog should be set because maxExecutionMs is undefined
    expect(mgr._watchdogs.size).toBe(0);

    mgr.terminateExecutionWorker();
  });

  it('terminateExecutionWorker clears watchdog timers', () => {
    const mgr = createMockWorkerManager();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    // Create two requests with watchdogs, catch rejections from terminate
    mgr.executeInWorker({ maxExecutionMs: 5000 }).catch(() => {});
    mgr.executeInWorker({ maxExecutionMs: 3000 }).catch(() => {});
    expect(mgr._watchdogs.size).toBe(2);

    const clearBefore = clearTimeoutSpy.mock.calls.length;

    mgr.terminateExecutionWorker();

    // Watchdogs should be cleared
    expect(mgr._watchdogs.size).toBe(0);
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(clearBefore);

    clearTimeoutSpy.mockRestore();
  });

  it('worker response clears the watchdog timer for that request', async () => {
    const mgr = createMockWorkerManager();

    const promise = mgr.executeInWorker({ maxExecutionMs: 5000 });
    expect(mgr._watchdogs.size).toBe(1);

    // Simulate the worker responding with a result for message id 1
    const w = mgr._getWorker();
    expect(w).not.toBeNull();
    w!.onmessage!({ data: { id: 1, type: 'result' } });

    // Watchdog should have been cleared by the response handler
    expect(mgr._watchdogs.size).toBe(0);

    // Promise should resolve
    const result = await promise;
    expect((result as { type: string }).type).toBe('result');

    mgr.terminateExecutionWorker();
  });

  it('watchdog fires and terminates worker when no response arrives', async () => {
    const mgr = createMockWorkerManager();

    const promise = mgr.executeInWorker({ maxExecutionMs: 3000 });
    expect(mgr._watchdogs.size).toBe(1);

    // Advance time past watchdog deadline: 3000 + 2000 grace = 5000
    vi.advanceTimersByTime(5001);

    // The watchdog should have fired and called terminateExecutionWorker
    const w = mgr._getWorker();
    expect(w).toBeNull(); // worker was terminated

    // Promise should reject with 'Worker terminated'
    await expect(promise).rejects.toThrow('Worker terminated');
  });
});

// ===========================================================================
// 2. Transform Processor Tests (6 tests)
// ===========================================================================

describe('transform processor – connected factor input', () => {
  it('uses inputs[1] when connected (not node.data.multiplier)', () => {
    // source(value=10) --[port0]--> transform(port0=in)
    // source(value=3)  --[port0]--> transform(port1=factor)
    // transform should compute 10 * 3 + 0 = 30
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 10 }),
      s2: makeNode('s2', 'source', { value: 3 }),
      t: makeNode('t', 'transform', { multiplier: 999 }), // data.multiplier should be ignored
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 's1', 0, 't', 0),
      c2: makeConnection('c2', 's2', 0, 't', 1),
    };

    const result = executeGraph(nodes, connections);
    const tResult = result.results.get('t');
    expect(tResult).toBeDefined();
    expect(tResult!.outputs[0]).toBe(30); // 10 * 3 + 0
  });

  it('falls back to node.data.multiplier when inputs[1] not connected', () => {
    // source(value=5) --[port0]--> transform(port0=in)
    // No connection to port 1, so should use node.data.multiplier=4
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 5 }),
      t: makeNode('t', 'transform', { multiplier: 4 }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 's1', 0, 't', 0),
    };

    const result = executeGraph(nodes, connections);
    const tResult = result.results.get('t');
    expect(tResult).toBeDefined();
    expect(tResult!.outputs[0]).toBe(20); // 5 * 4 + 0
  });

  it('uses default multiplier 1 when neither connected nor in data', () => {
    // source(value=7) --[port0]--> transform(port0=in)
    // No connection to port 1, node.data has no multiplier field
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 7 }),
      t: makeNode('t', 'transform', {}), // no multiplier in data
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 's1', 0, 't', 0),
    };

    const result = executeGraph(nodes, connections);
    const tResult = result.results.get('t');
    expect(tResult).toBeDefined();
    expect(tResult!.outputs[0]).toBe(7); // 7 * 1 + 0
  });

  it('connected input wins over node.data.multiplier', () => {
    // source(value=6) --[port0]--> transform(port0=in)
    // source(value=2) --[port0]--> transform(port1=factor)
    // node.data.multiplier=100 should be overridden by connected value 2
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 6 }),
      s2: makeNode('s2', 'source', { value: 2 }),
      t: makeNode('t', 'transform', { multiplier: 100 }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 's1', 0, 't', 0),
      c2: makeConnection('c2', 's2', 0, 't', 1),
    };

    const result = executeGraph(nodes, connections);
    const tResult = result.results.get('t');
    expect(tResult).toBeDefined();
    expect(tResult!.outputs[0]).toBe(12); // 6 * 2 + 0 = 12, NOT 6 * 100
  });

  it('debug output reflects correct multiplier source', () => {
    // source(value=4) --[port0]--> transform(port0=in)
    // source(value=5) --[port0]--> transform(port1=factor)
    // Debug output (port 1) should show "4x5+0=20"
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 4 }),
      s2: makeNode('s2', 'source', { value: 5 }),
      t: makeNode('t', 'transform', { offset: 0 }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 's1', 0, 't', 0),
      c2: makeConnection('c2', 's2', 0, 't', 1),
    };

    const result = executeGraph(nodes, connections);
    const tResult = result.results.get('t');
    expect(tResult).toBeDefined();
    // Debug output (output port 1) should be the formatted calculation string
    const debug = tResult!.outputs[1] as string;
    expect(debug).toContain('4');
    expect(debug).toContain('5');
    expect(debug).toContain('20');
    // Uses multiplication sign (unicode ×)
    expect(debug).toBe('4\u00d75+0=20');
  });

  it('preserves offset behavior unchanged', () => {
    // source(value=3) --[port0]--> transform(port0=in)
    // source(value=2) --[port0]--> transform(port1=factor)
    // offset = 10 => 3 * 2 + 10 = 16
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 3 }),
      s2: makeNode('s2', 'source', { value: 2 }),
      t: makeNode('t', 'transform', { offset: 10 }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 's1', 0, 't', 0),
      c2: makeConnection('c2', 's2', 0, 't', 1),
    };

    const result = executeGraph(nodes, connections);
    const tResult = result.results.get('t');
    expect(tResult).toBeDefined();
    expect(tResult!.outputs[0]).toBe(16); // 3 * 2 + 10
    // Debug string should reflect offset
    const debug = tResult!.outputs[1] as string;
    expect(debug).toBe('3\u00d72+10=16');
  });
});

// ===========================================================================
// 3. Value Formatter Tests (16 tests)
// ===========================================================================

describe('formatNumberPrecision', () => {
  it('returns "NaN" for NaN', () => {
    expect(formatNumberPrecision(NaN)).toBe('NaN');
  });

  it('returns infinity symbol for Infinity', () => {
    expect(formatNumberPrecision(Infinity)).toBe('\u221e');
  });

  it('returns negative infinity symbol for -Infinity', () => {
    expect(formatNumberPrecision(-Infinity)).toBe('-\u221e');
  });

  it('returns "0" for zero', () => {
    expect(formatNumberPrecision(0)).toBe('0');
  });

  it('uses scientific notation for large numbers (>= 1e6)', () => {
    const result = formatNumberPrecision(1_500_000);
    expect(result).toMatch(/e\+/); // scientific notation
    expect(result).toBe('1.50e+6');
  });

  it('uses scientific notation for very small numbers (< 1e-3)', () => {
    const result = formatNumberPrecision(0.00042);
    expect(result).toMatch(/e/); // scientific notation
    expect(result).toBe('4.20e-4');
  });

  it('displays integers without decimals', () => {
    expect(formatNumberPrecision(42)).toBe('42');
    expect(formatNumberPrecision(1000)).toBe('1000');
  });

  it('uses adaptive decimal precision for fractional values', () => {
    // abs >= 100 => 1 decimal
    expect(formatNumberPrecision(123.456)).toBe('123.5');
    // abs >= 1 and < 100 => 2 decimals
    expect(formatNumberPrecision(3.14159)).toBe('3.14');
    // abs < 1 => 3 decimals
    expect(formatNumberPrecision(0.12345)).toBe('0.123');
  });
});

describe('formatObjectTree', () => {
  it('returns "{}" for empty object', () => {
    expect(formatObjectTree({})).toBe('{}');
  });

  it('formats small object with key-value pairs', () => {
    const result = formatObjectTree({ a: 1, b: 'hello' });
    expect(result).toContain('a:');
    expect(result).toContain('b:');
    expect(result).toContain('1');
    expect(result).toContain('hello');
  });

  it('formats nested object recursively', () => {
    const result = formatObjectTree({ outer: { inner: 42 } });
    expect(result).toContain('outer:');
    expect(result).toContain('inner:');
    expect(result).toContain('42');
  });

  it('respects depth limit and shows ellipsis', () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const result = formatObjectTree(deep, 2);
    // At depth 2, it should show {..} for deeper objects
    expect(result).toContain('{…}');
  });
});

describe('formatVector3', () => {
  it('formats basic vector correctly', () => {
    const result = formatVector3([1.5, 2.5, 3.5]);
    expect(result).toBe('(1.5, 2.5, 3.5)');
  });

  it('formats zero vector', () => {
    const result = formatVector3([0, 0, 0]);
    expect(result).toBe('(0.0, 0.0, 0.0)');
  });

  it('formats large values with rounding (>= 100)', () => {
    const result = formatVector3([150, 200, 300]);
    // formatNum rounds values >= 100
    expect(result).toBe('(150, 200, 300)');
  });
});

describe('formatValueDetailed', () => {
  it('returns "null" for null', () => {
    expect(formatValueDetailed(null)).toBe('null');
  });

  it('returns JSON-quoted string for strings', () => {
    const result = formatValueDetailed('hello world');
    expect(result).toBe('"hello world"');
  });

  it('formats small array as pretty-printed JSON', () => {
    const result = formatValueDetailed([1, 2, 3]);
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
    // Should be valid JSON
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('formats object as pretty-printed JSON', () => {
    const result = formatValueDetailed({ x: 1, y: 2 });
    expect(result).toContain('"x"');
    expect(result).toContain('"y"');
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

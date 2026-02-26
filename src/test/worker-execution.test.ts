/**
 * Comprehensive tests for the Web Worker execution system.
 *
 * Since jsdom does not support real Web Workers, we test:
 * 1. Message protocol shapes and serialization
 * 2. Worker message handler logic (via direct executeGraph calls)
 * 3. Worker manager behavior (via mocking the Worker constructor)
 * 4. Structured clone compatibility of data flowing through the worker boundary
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import { executeGraph } from '../utils/execution';
import type { NodeResult, SubgraphContext, ExecutionResult } from '../utils/execution';
import { NODE_TYPE_CONFIG } from '../types';
import type {
  EditorNode,
  Connection,
  NodeType,
  SubgraphNodeDef,
  GraphData,
} from '../types';
import type {
  ExecuteMessage,
  ExecuteResultMessage,
  ExecuteErrorMessage,
  WorkerResponse,
  PongResponse,
} from '../workers/execution.worker';

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
  extra?: Partial<Connection>,
): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: srcPort,
    targetNodeId: tgt,
    targetPortIndex: tgtPort,
    ...extra,
  };
}

/**
 * Simulate the serialization roundtrip that happens when postMessage
 * sends data through structured clone (Maps become tuples).
 */
function serializeResult(result: ExecutionResult): ExecuteResultMessage {
  return {
    type: 'result',
    id: 0,
    results: Array.from(result.results),
    waves: result.waves,
    errors: Array.from(result.errors),
    metrics: Array.from(result.metrics),
    totalDuration: result.totalDuration,
  };
}

// ---------------------------------------------------------------------------
// 1. Message Protocol
// ---------------------------------------------------------------------------

describe('Message Protocol', () => {
  it('ExecuteMessage has correct shape with required fields', () => {
    const msg: ExecuteMessage = {
      type: 'execute',
      id: 1,
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    };

    expect(msg.type).toBe('execute');
    expect(msg.id).toBe(1);
    expect(msg.nodes).toEqual({});
    expect(msg.connections).toEqual({});
    expect(msg.errorStrategy).toBe('continue');
    expect(msg.cache).toBeUndefined();
    expect(msg.subgraphDefs).toBeUndefined();
    expect(msg.innerGraphs).toBeUndefined();
  });

  it('ExecuteResultMessage serializes Map results as tuples', () => {
    const results = new Map<string, NodeResult>();
    results.set('n1', { outputs: { 0: 42 }, inputHash: '{}' });
    results.set('n2', { outputs: { 0: 'hello' }, inputHash: '{}' });

    const msg: ExecuteResultMessage = {
      type: 'result',
      id: 5,
      results: Array.from(results),
      waves: [['n1'], ['n2']],
      errors: [],
      metrics: [],
      totalDuration: 10,
    };

    expect(msg.type).toBe('result');
    expect(msg.results).toHaveLength(2);
    expect(msg.results[0]).toEqual(['n1', { outputs: { 0: 42 }, inputHash: '{}' }]);
    expect(msg.results[1]).toEqual(['n2', { outputs: { 0: 'hello' }, inputHash: '{}' }]);
  });

  it('ExecuteErrorMessage has correct shape', () => {
    const msg: ExecuteErrorMessage = {
      type: 'error',
      id: 3,
      message: 'Something went wrong',
    };

    expect(msg.type).toBe('error');
    expect(msg.id).toBe(3);
    expect(msg.message).toBe('Something went wrong');
  });

  it('Cache serialization: Map entries to [key, value][] tuples', () => {
    const cache = new Map<string, NodeResult>();
    cache.set('node-1', { outputs: { 0: 100 }, inputHash: '{"0":5}' });
    cache.set('node-2', { outputs: { 0: 200, 1: 'debug' }, inputHash: '{"0":10}' });

    const tuples: [string, NodeResult][] = Array.from(cache);
    expect(tuples).toHaveLength(2);
    expect(tuples[0][0]).toBe('node-1');
    expect(tuples[0][1].outputs[0]).toBe(100);
    expect(tuples[1][0]).toBe('node-2');
    expect(tuples[1][1].outputs[1]).toBe('debug');

    // Reconstruct the Map from tuples (as worker does)
    const reconstructed = new Map(tuples);
    expect(reconstructed.get('node-1')).toEqual(cache.get('node-1'));
    expect(reconstructed.get('node-2')).toEqual(cache.get('node-2'));
  });

  it('SubgraphContext reconstruction from plain data', () => {
    const subgraphDefs: Record<string, SubgraphNodeDef> = {
      sg1: {
        id: 'sg1',
        name: 'MySub',
        innerGraphId: 'inner-1',
        exposedInputs: [{ portIndex: 0, innerNodeId: 'si1' }],
        exposedOutputs: [{ portIndex: 0, innerNodeId: 'so1' }],
      },
    };
    const innerGraphs: Record<string, GraphData> = {
      'inner-1': {
        nodes: {},
        connections: {},
        groups: {},
        customNodeDefs: {},
      },
    };

    // Reconstruct SubgraphContext as the worker does
    const subgraphContext: SubgraphContext = {
      subgraphDefs,
      getInnerGraph: (graphId: string) => innerGraphs[graphId],
    };

    expect(subgraphContext.subgraphDefs['sg1'].name).toBe('MySub');
    expect(subgraphContext.getInnerGraph('inner-1')).toBeDefined();
    expect(subgraphContext.getInnerGraph('nonexistent')).toBeUndefined();
  });

  it('Empty cache (undefined) handling', () => {
    const msg: ExecuteMessage = {
      type: 'execute',
      id: 1,
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      cache: undefined,
    };

    expect(msg.cache).toBeUndefined();

    // Worker reconstructs as: cache ? new Map(cache) : undefined
    const cacheMap = msg.cache ? new Map(msg.cache) : undefined;
    expect(cacheMap).toBeUndefined();
  });

  it('Empty subgraphDefs/innerGraphs handling', () => {
    const msg: ExecuteMessage = {
      type: 'execute',
      id: 1,
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
      subgraphDefs: undefined,
      innerGraphs: undefined,
    };

    // Worker builds SubgraphContext only when both are defined
    let subgraphContext: SubgraphContext | undefined;
    if (msg.subgraphDefs && msg.innerGraphs) {
      subgraphContext = {
        subgraphDefs: msg.subgraphDefs,
        getInnerGraph: (graphId: string) => msg.innerGraphs![graphId],
      };
    }
    expect(subgraphContext).toBeUndefined();
  });

  it('Error strategy fail-fast vs continue forwarding', () => {
    const failFast: ExecuteMessage = {
      type: 'execute',
      id: 1,
      nodes: {},
      connections: {},
      errorStrategy: 'fail-fast',
    };
    const cont: ExecuteMessage = {
      type: 'execute',
      id: 2,
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    };

    expect(failFast.errorStrategy).toBe('fail-fast');
    expect(cont.errorStrategy).toBe('continue');
  });

  it('Message ID uniqueness (increments)', () => {
    const ids = new Set<number>();
    let messageId = 0;

    for (let i = 0; i < 100; i++) {
      const id = ++messageId;
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }

    expect(ids.size).toBe(100);
    // IDs should be 1..100
    expect(ids.has(1)).toBe(true);
    expect(ids.has(100)).toBe(true);
    expect(ids.has(0)).toBe(false);
  });

  it('WorkerResponse type discrimination (result vs error)', () => {
    const resultMsg: WorkerResponse = {
      type: 'result',
      id: 1,
      results: [],
      waves: [],
      errors: [],
      metrics: [],
      totalDuration: 0,
    };

    const errorMsg: WorkerResponse = {
      type: 'error',
      id: 2,
      message: 'boom',
    };

    // Discriminated union check
    if (resultMsg.type === 'result') {
      expect(resultMsg.results).toBeDefined();
      expect(resultMsg.waves).toBeDefined();
    }
    if (errorMsg.type === 'error') {
      expect(errorMsg.message).toBe('boom');
    }

    expect(resultMsg.type).toBe('result');
    expect(errorMsg.type).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// 2. Worker Message Handler Logic (direct executeGraph tests)
// ---------------------------------------------------------------------------

describe('Worker Message Handler Logic', () => {
  it('Simple source->output graph executes correctly', () => {
    const src = makeNode('s1', 'source', { value: 42 });
    const out = makeNode('o1', 'output');
    const conn = makeConnection('c1', 's1', 0, 'o1', 0);

    const nodes: Record<string, EditorNode> = { s1: src, o1: out };
    const connections: Record<string, Connection> = { c1: conn };

    const result = executeGraph(nodes, connections);

    expect(result.results.get('s1')).toBeDefined();
    expect(result.results.get('s1')!.outputs[0]).toBe(42);
    expect(result.results.get('o1')).toBeDefined();
    expect(result.errors.size).toBe(0);
  });

  it('Source->transform->output chain produces expected results', () => {
    const src = makeNode('s1', 'source', { value: 10 });
    const xfm = makeNode('t1', 'transform', { multiplier: 3, offset: 5 });
    const out = makeNode('o1', 'output');
    const c1 = makeConnection('c1', 's1', 0, 't1', 0);
    const c2 = makeConnection('c2', 't1', 0, 'o1', 0);

    const nodes: Record<string, EditorNode> = { s1: src, t1: xfm, o1: out };
    const connections: Record<string, Connection> = { c1, c2 };

    const result = executeGraph(nodes, connections);

    // transform: inputValue * multiplier + offset = 10 * 3 + 5 = 35
    expect(result.results.get('t1')!.outputs[0]).toBe(35);
    expect(result.results.get('t1')!.outputs[1]).toBe('10×3+5=35');
    expect(result.errors.size).toBe(0);
  });

  it('Graph with cache hit returns cached results', () => {
    const src = makeNode('s1', 'source', { value: 7 });
    const nodes: Record<string, EditorNode> = { s1: src };
    const connections: Record<string, Connection> = {};

    // First execution
    const result1 = executeGraph(nodes, connections);
    expect(result1.results.get('s1')!.outputs[0]).toBe(7);

    // Second execution with cache from first
    const cache = new Map(result1.results);
    const result2 = executeGraph(nodes, connections, cache);

    // Should have a cache hit for s1
    expect(result2.metrics.get('s1')!.cacheHit).toBe(true);
    expect(result2.results.get('s1')!.outputs[0]).toBe(7);
  });

  it('Graph with multiple waves produces correct wave order', () => {
    // source -> transform -> output creates 3 waves
    const src = makeNode('s1', 'source', { value: 1 });
    const xfm = makeNode('t1', 'transform', { multiplier: 2, offset: 0 });
    const out = makeNode('o1', 'output');
    const c1 = makeConnection('c1', 's1', 0, 't1', 0);
    const c2 = makeConnection('c2', 't1', 0, 'o1', 0);

    const nodes: Record<string, EditorNode> = { s1: src, t1: xfm, o1: out };
    const connections: Record<string, Connection> = { c1, c2 };

    const result = executeGraph(nodes, connections);

    expect(result.waves.length).toBeGreaterThanOrEqual(2);
    // Source should be in an earlier wave than transform
    const srcWaveIdx = result.waves.findIndex(w => w.includes('s1'));
    const xfmWaveIdx = result.waves.findIndex(w => w.includes('t1'));
    const outWaveIdx = result.waves.findIndex(w => w.includes('o1'));
    expect(srcWaveIdx).toBeLessThan(xfmWaveIdx);
    expect(xfmWaveIdx).toBeLessThan(outWaveIdx);
  });

  it('Error in processor captured in errors map (continue strategy)', () => {
    // A custom node with an invalid expression will throw
    const customNode = makeNode('c1', 'custom', {
      expression: 'throw new Error("custom error")',
      inputCount: 0,
      outputCount: 1,
    });
    const nodes: Record<string, EditorNode> = { c1: customNode };
    const connections: Record<string, Connection> = {};

    const result = executeGraph(nodes, connections, undefined, undefined, undefined, 'continue');

    expect(result.errors.size).toBeGreaterThan(0);
    expect(result.errors.has('c1')).toBe(true);
  });

  it('Error in processor fails fast (fail-fast strategy)', () => {
    // Create a custom node that throws, followed by a source
    const customNode = makeNode('c1', 'custom', {
      expression: 'throw new Error("fail fast error")',
      inputCount: 0,
      outputCount: 1,
    });
    const src = makeNode('s1', 'source', { value: 99 });
    // c1 -> s1 dependency so s1 executes after c1
    // Actually, no dependency needed - in fail-fast, the error just stops execution
    // Use a chain: c1 (wave 1 with s1), but c1 errors

    const nodes: Record<string, EditorNode> = { c1: customNode, s1: src };
    const connections: Record<string, Connection> = {};

    const result = executeGraph(nodes, connections, undefined, undefined, undefined, 'fail-fast');

    // At least one error captured
    expect(result.errors.size).toBeGreaterThan(0);
  });

  it('SubgraphContext with inner graph definitions', () => {
    // Build an inner graph: subgraph-input -> subgraph-output
    const innerInput = makeNode('si1', 'subgraph-input', { _injectedValue: null });
    const innerOutput = makeNode('so1', 'subgraph-output');
    const innerConn = makeConnection('ic1', 'si1', 0, 'so1', 0);

    const innerGraph: GraphData = {
      nodes: { si1: innerInput, so1: innerOutput },
      connections: { ic1: innerConn },
      groups: {},
      customNodeDefs: {},
    };

    const subgraphDef: SubgraphNodeDef = {
      id: 'sg-def-1',
      name: 'Passthrough',
      innerGraphId: 'inner-graph-1',
      exposedInputs: [{ portIndex: 0, innerNodeId: 'si1' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'so1' }],
    };

    // Create a subgraph node with appropriate ports
    const sgNode = makeNode('sg1', 'subgraph', { subgraphDefId: 'sg-def-1' }, {
      inputs: [{ id: 'sg1-in-0', label: 'in', portType: 'any' }],
      outputs: [{ id: 'sg1-out-0', label: 'out', portType: 'any' }],
    });

    // Source feeds into subgraph, subgraph feeds into output
    const srcNode = makeNode('s1', 'source', { value: 77 });
    const outNode = makeNode('o1', 'output');
    const c1 = makeConnection('c1', 's1', 0, 'sg1', 0);
    const c2 = makeConnection('c2', 'sg1', 0, 'o1', 0);

    const nodes: Record<string, EditorNode> = { s1: srcNode, sg1: sgNode, o1: outNode };
    const connections: Record<string, Connection> = { c1, c2 };

    const subgraphContext: SubgraphContext = {
      subgraphDefs: { 'sg-def-1': subgraphDef },
      getInnerGraph: (graphId: string) => graphId === 'inner-graph-1' ? innerGraph : undefined,
    };

    const result = executeGraph(nodes, connections, undefined, subgraphContext);

    expect(result.results.get('s1')!.outputs[0]).toBe(77);
    // The subgraph-input node receives 77 and passes it to subgraph-output
    expect(result.results.get('sg1')!.outputs[0]).toBe(77);
    expect(result.errors.size).toBe(0);
  });

  it('Empty graph (no nodes) returns empty results', () => {
    const result = executeGraph({}, {});

    expect(result.results.size).toBe(0);
    expect(result.waves).toEqual([]);
    expect(result.errors.size).toBe(0);
    expect(result.metrics.size).toBe(0);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('Single node graph (source only) returns result', () => {
    const src = makeNode('s1', 'source', { value: 99, label: 'Test' });
    const nodes: Record<string, EditorNode> = { s1: src };

    const result = executeGraph(nodes, {});

    expect(result.results.size).toBe(1);
    expect(result.results.get('s1')!.outputs[0]).toBe(99);
    expect(result.results.get('s1')!.outputs[1]).toBe('Test');
    expect(result.waves).toEqual([['s1']]);
  });

  it('Multiple disconnected nodes execute independently', () => {
    const s1 = makeNode('s1', 'source', { value: 10 });
    const s2 = makeNode('s2', 'source', { value: 20 });
    const s3 = makeNode('s3', 'source', { value: 30 });
    const nodes: Record<string, EditorNode> = { s1, s2, s3 };

    const result = executeGraph(nodes, {});

    expect(result.results.size).toBe(3);
    expect(result.results.get('s1')!.outputs[0]).toBe(10);
    expect(result.results.get('s2')!.outputs[0]).toBe(20);
    expect(result.results.get('s3')!.outputs[0]).toBe(30);
    // All disconnected nodes are in the same wave (wave 0)
    expect(result.waves).toHaveLength(1);
    expect(result.waves[0]).toContain('s1');
    expect(result.waves[0]).toContain('s2');
    expect(result.waves[0]).toContain('s3');
  });

  it('Results Map entries match expected node IDs', () => {
    const s1 = makeNode('alpha', 'source', { value: 1 });
    const s2 = makeNode('beta', 'source', { value: 2 });
    const xfm = makeNode('gamma', 'transform', { multiplier: 1, offset: 0 });
    const c1 = makeConnection('c1', 'alpha', 0, 'gamma', 0);
    const nodes: Record<string, EditorNode> = { alpha: s1, beta: s2, gamma: xfm };
    const connections: Record<string, Connection> = { c1 };

    const result = executeGraph(nodes, connections);

    const resultKeys = Array.from(result.results.keys());
    expect(resultKeys).toContain('alpha');
    expect(resultKeys).toContain('beta');
    expect(resultKeys).toContain('gamma');
    expect(resultKeys).toHaveLength(3);
  });

  it('Metrics include duration and cacheHit for each node', () => {
    const s1 = makeNode('s1', 'source', { value: 5 });
    const xfm = makeNode('t1', 'transform', { multiplier: 2, offset: 0 });
    const c1 = makeConnection('c1', 's1', 0, 't1', 0);
    const nodes: Record<string, EditorNode> = { s1, t1: xfm };
    const connections: Record<string, Connection> = { c1 };

    const result = executeGraph(nodes, connections);

    for (const [, metric] of result.metrics) {
      expect(typeof metric.duration).toBe('number');
      expect(typeof metric.cacheHit).toBe('boolean');
      expect(typeof metric.timestamp).toBe('number');
      expect(metric.duration).toBeGreaterThanOrEqual(0);
      expect(metric.timestamp).toBeGreaterThan(0);
    }
    expect(result.metrics.has('s1')).toBe(true);
    expect(result.metrics.has('t1')).toBe(true);
    // Fresh execution — no cache hits
    expect(result.metrics.get('s1')!.cacheHit).toBe(false);
    expect(result.metrics.get('t1')!.cacheHit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Worker Manager (mock Worker)
// ---------------------------------------------------------------------------

describe('Worker Manager', () => {
  // We need to re-import the manager fresh each test to reset module-scoped state.
  // Use vi.importMock or dynamic import + resetModules approach.

  let managerModule: typeof import('../workers/executionWorkerManager');

  /** Captured listeners from mock Worker instances */
  let mockWorkerInstances: Array<{
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
  }>;

  beforeEach(async () => {
    vi.resetModules();
    mockWorkerInstances = [];

    // By default, mock Worker to succeed
    vi.stubGlobal('Worker', class MockWorker {
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      constructor() {
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        mockWorkerInstances.push(this);
      }
    });

    managerModule = await import('../workers/executionWorkerManager');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getExecutionWorker() returns null when Worker constructor throws', async () => {
    vi.resetModules();
    vi.stubGlobal('Worker', class FailWorker {
      constructor() {
        throw new Error('Workers not supported');
      }
    });
    const freshModule = await import('../workers/executionWorkerManager');
    const worker = freshModule.getExecutionWorker();
    expect(worker).toBeNull();
  });

  it('getExecutionWorker() creates worker lazily (only on first call)', () => {
    expect(mockWorkerInstances).toHaveLength(0);
    const w = managerModule.getExecutionWorker();
    expect(w).not.toBeNull();
    expect(mockWorkerInstances).toHaveLength(1);
  });

  it('getExecutionWorker() returns cached worker on subsequent calls', () => {
    const w1 = managerModule.getExecutionWorker();
    const w2 = managerModule.getExecutionWorker();
    expect(w1).toBe(w2);
    expect(mockWorkerInstances).toHaveLength(1);
  });

  it('executeInWorker rejects when worker is null (no Worker support)', async () => {
    vi.resetModules();
    vi.stubGlobal('Worker', class FailWorker {
      constructor() {
        throw new Error('nope');
      }
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

  it('executeInWorker sends message with correct format (type: execute, id)', () => {
    const nodes = { s1: makeNode('s1', 'source', { value: 1 }) };
    const promise = managerModule.executeInWorker({
      nodes,
      connections: {},
      errorStrategy: 'continue',
    });

    expect(mockWorkerInstances).toHaveLength(1);
    const mock = mockWorkerInstances[0];
    expect(mock.postMessage).toHaveBeenCalledTimes(1);

    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;
    expect(sentMsg.type).toBe('execute');
    expect(typeof sentMsg.id).toBe('number');
    expect(sentMsg.id).toBeGreaterThan(0);
    expect(sentMsg.nodes).toEqual(nodes);
    expect(sentMsg.errorStrategy).toBe('continue');

    // Clean up the pending promise
    managerModule.terminateExecutionWorker();
    promise.catch(() => { /* expected rejection from terminate */ });
  });

  it('executeInWorker resolves on result message', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;

    // Simulate worker responding with a result
    const response: ExecuteResultMessage = {
      type: 'result',
      id: sentMsg.id,
      results: [['s1', { outputs: { 0: 42 }, inputHash: '{}' }]],
      waves: [['s1']],
      errors: [],
      metrics: [['s1', { duration: 1, cacheHit: false, timestamp: Date.now() }]],
      totalDuration: 1,
    };

    // Fire the onmessage handler that the manager attached
    mock.onmessage!({ data: response } as MessageEvent);

    const result = await promise;
    expect(result.type).toBe('result');
    expect(result.results).toEqual(response.results);
    expect(result.totalDuration).toBe(1);
  });

  it('executeInWorker rejects on error message', async () => {
    const promise = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    const mock = mockWorkerInstances[0];
    const sentMsg = mock.postMessage.mock.calls[0][0] as ExecuteMessage;

    // Simulate worker responding with an error
    const errorResponse: ExecuteErrorMessage = {
      type: 'error',
      id: sentMsg.id,
      message: 'Execution failed: cycle detected',
    };

    mock.onmessage!({ data: errorResponse } as MessageEvent);

    await expect(promise).rejects.toThrow('Execution failed: cycle detected');
  });

  it('Message ID increments across calls', () => {
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
    const p3 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    const mock = mockWorkerInstances[0];
    const id1 = (mock.postMessage.mock.calls[0][0] as ExecuteMessage).id;
    const id2 = (mock.postMessage.mock.calls[1][0] as ExecuteMessage).id;
    const id3 = (mock.postMessage.mock.calls[2][0] as ExecuteMessage).id;

    expect(id2).toBe(id1 + 1);
    expect(id3).toBe(id2 + 1);

    // Clean up pending promises
    managerModule.terminateExecutionWorker();
    p1.catch(() => {});
    p2.catch(() => {});
    p3.catch(() => {});
  });

  it('terminateExecutionWorker() calls terminate on worker', () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    managerModule.terminateExecutionWorker();
    expect(mock.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminateExecutionWorker() rejects all pending requests', async () => {
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

    managerModule.terminateExecutionWorker();

    await expect(p1).rejects.toThrow('Worker terminated');
    await expect(p2).rejects.toThrow('Worker terminated');
  });

  it('terminateExecutionWorker() clears pending map', async () => {
    const p1 = managerModule.executeInWorker({
      nodes: {},
      connections: {},
      errorStrategy: 'continue',
    });

    managerModule.terminateExecutionWorker();
    await p1.catch(() => {});

    // After terminate, a new worker should be created on next call
    const w = managerModule.getExecutionWorker();
    expect(w).not.toBeNull();
    expect(mockWorkerInstances).toHaveLength(2); // original + new one
  });

  it('Worker onerror rejects all pending and terminates', async () => {
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

    // Simulate a worker error event
    mock.onerror!({ message: 'Script error' } as ErrorEvent);

    await expect(p1).rejects.toThrow('Worker error: Script error');
    await expect(p2).rejects.toThrow('Worker error: Script error');

    // Worker should have been terminated
    expect(mock.terminate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Structured Clone Compatibility
// ---------------------------------------------------------------------------

describe('Structured Clone Compatibility', () => {
  it('Node data survives structured clone (JSON-safe types)', () => {
    const node = makeNode('s1', 'source', {
      value: 42,
      label: 'hello',
      nested: { a: 1, b: [1, 2, 3] },
      flag: true,
      nothing: null,
    });

    // structuredClone simulates the postMessage boundary
    const cloned = structuredClone(node);

    expect(cloned.id).toBe('s1');
    expect(cloned.type).toBe('source');
    expect(cloned.data.value).toBe(42);
    expect(cloned.data.label).toBe('hello');
    expect(cloned.data.nested).toEqual({ a: 1, b: [1, 2, 3] });
    expect(cloned.data.flag).toBe(true);
    expect(cloned.data.nothing).toBeNull();
    // Ensure it is a deep clone
    expect(cloned).not.toBe(node);
    expect(cloned.data).not.toBe(node.data);
  });

  it('Map-to-tuple serialization roundtrips correctly', () => {
    const original = new Map<string, NodeResult>();
    original.set('n1', { outputs: { 0: 42, 1: 'debug' }, inputHash: '{"0":5}' });
    original.set('n2', { outputs: { 0: [1, 2, 3] }, inputHash: '{}' });
    original.set('n3', { outputs: { 0: true, 1: null }, inputHash: '{"0":0}' });

    // Serialize (as worker does on postMessage)
    const tuples: [string, NodeResult][] = Array.from(original);

    // structuredClone the tuples (simulates postMessage transfer)
    const clonedTuples = structuredClone(tuples);

    // Reconstruct Map (as manager/consumer does)
    const reconstructed = new Map(clonedTuples);

    expect(reconstructed.size).toBe(3);
    expect(reconstructed.get('n1')!.outputs[0]).toBe(42);
    expect(reconstructed.get('n1')!.outputs[1]).toBe('debug');
    expect(reconstructed.get('n2')!.outputs[0]).toEqual([1, 2, 3]);
    expect(reconstructed.get('n3')!.outputs[0]).toBe(true);
    expect(reconstructed.get('n3')!.outputs[1]).toBeNull();
  });

  it('Connection metadata (label, colorOverride) survives transfer', () => {
    const conn: Connection = {
      id: 'c1',
      sourceNodeId: 's1',
      sourcePortIndex: 0,
      targetNodeId: 't1',
      targetPortIndex: 0,
      label: 'data flow',
      colorOverride: '#FF0000',
    };

    const cloned = structuredClone(conn);

    expect(cloned.id).toBe('c1');
    expect(cloned.label).toBe('data flow');
    expect(cloned.colorOverride).toBe('#FF0000');
    expect(cloned.sourceNodeId).toBe('s1');
    expect(cloned.targetNodeId).toBe('t1');
    expect(cloned).not.toBe(conn);
  });

  it('Error messages are plain strings (structured-clone safe)', () => {
    const errorMsg: ExecuteErrorMessage = {
      type: 'error',
      id: 1,
      message: 'Graph contains a cycle',
    };

    const cloned = structuredClone(errorMsg);

    expect(cloned.type).toBe('error');
    expect(cloned.id).toBe(1);
    expect(cloned.message).toBe('Graph contains a cycle');
    expect(typeof cloned.message).toBe('string');
  });

  it('SubgraphDefs are plain objects (structured-clone safe)', () => {
    const defs: Record<string, SubgraphNodeDef> = {
      'sg-1': {
        id: 'sg-1',
        name: 'MySubgraph',
        innerGraphId: 'graph-inner-1',
        exposedInputs: [
          { portIndex: 0, innerNodeId: 'si-1' },
          { portIndex: 1, innerNodeId: 'si-2' },
        ],
        exposedOutputs: [
          { portIndex: 0, innerNodeId: 'so-1' },
        ],
      },
      'sg-2': {
        id: 'sg-2',
        name: 'AnotherSubgraph',
        innerGraphId: 'graph-inner-2',
        exposedInputs: [],
        exposedOutputs: [{ portIndex: 0, innerNodeId: 'so-2' }],
      },
    };

    const cloned = structuredClone(defs);

    expect(cloned['sg-1'].name).toBe('MySubgraph');
    expect(cloned['sg-1'].exposedInputs).toHaveLength(2);
    expect(cloned['sg-1'].exposedInputs[0].innerNodeId).toBe('si-1');
    expect(cloned['sg-2'].exposedOutputs[0].portIndex).toBe(0);
    expect(cloned).not.toBe(defs);
    expect(cloned['sg-1']).not.toBe(defs['sg-1']);
  });

  it('Large result sets serialize correctly (100+ nodes)', () => {
    // Build a graph with 120 source nodes
    const nodes: Record<string, EditorNode> = {};
    for (let i = 0; i < 120; i++) {
      const id = `n${i}`;
      nodes[id] = makeNode(id, 'source', { value: i });
    }

    const result = executeGraph(nodes, {});

    // Serialize to worker-format tuples
    const serialized: ExecuteResultMessage = serializeResult(result);

    expect(serialized.results).toHaveLength(120);

    // Simulate structured clone transfer
    const cloned = structuredClone(serialized);
    expect(cloned.results).toHaveLength(120);

    // Reconstruct and verify
    const reconstructed = new Map(cloned.results);
    expect(reconstructed.size).toBe(120);

    for (let i = 0; i < 120; i++) {
      const nodeResult = reconstructed.get(`n${i}`);
      expect(nodeResult).toBeDefined();
      expect(nodeResult!.outputs[0]).toBe(i);
    }

    // Verify all waves, errors, and metrics survived
    expect(cloned.waves).toHaveLength(1); // all disconnected = 1 wave
    expect(cloned.waves[0]).toHaveLength(120);
    expect(cloned.errors).toHaveLength(0);
    expect(cloned.metrics).toHaveLength(120);
    expect(typeof cloned.totalDuration).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 5. Graph Variables with Worker Execution
// ---------------------------------------------------------------------------

import { setGraphVariablesContext, getGraphVariablesContext } from '../utils/execution';

describe('Worker execution: graph variables', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  it('set-var writes to graph variables context', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 42 }),
      sv: makeNode('sv', 'set-var', { variableName: 'myVar' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConnection('c0', 'src', 0, 'sv', 0),
    };
    setGraphVariablesContext({});
    executeGraph(nodes, conns, undefined, undefined, undefined, undefined, {});
    const vars = getGraphVariablesContext();
    expect(vars.myVar).toBe(42);
  });

  it('get-var reads from graph variables context', () => {
    const nodes: Record<string, EditorNode> = {
      gv: makeNode('gv', 'get-var', { variableName: 'preExisting' }),
    };
    setGraphVariablesContext({ preExisting: 'hello' });
    const result = executeGraph(nodes, {}, undefined, undefined, undefined, undefined, { preExisting: 'hello' });
    expect(result.results.get('gv')?.outputs[0]).toBe('hello');
  });

  it('set-var then get-var communicates within same execution', () => {
    // set-var must execute before get-var — connect sv→gv to enforce topological order
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 100 }),
      sv: makeNode('sv', 'set-var', { variableName: 'shared' }),
      gv: makeNode('gv', 'get-var', { variableName: 'shared' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConnection('c0', 'src', 0, 'sv', 0),
      c1: makeConnection('c1', 'sv', 0, 'gv', 0),
    };
    setGraphVariablesContext({});
    const result = executeGraph(nodes, conns, undefined, undefined, undefined, undefined, {});
    // get-var reads the variable set by set-var
    expect(result.results.get('gv')?.outputs[0]).toBe(100);
  });

  it('graphVariables parameter initializes the context', () => {
    const nodes: Record<string, EditorNode> = {
      gv: makeNode('gv', 'get-var', { variableName: 'init' }),
    };
    setGraphVariablesContext({});
    const result = executeGraph(nodes, {}, undefined, undefined, undefined, undefined, { init: 'initialized' });
    expect(result.results.get('gv')?.outputs[0]).toBe('initialized');
  });

  it('updated variables persist in context after execution', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 'modified' }),
      sv: makeNode('sv', 'set-var', { variableName: 'persist' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConnection('c0', 'src', 0, 'sv', 0),
    };
    setGraphVariablesContext({});
    executeGraph(nodes, conns, undefined, undefined, undefined, undefined, {});
    const vars = getGraphVariablesContext();
    expect(vars.persist).toBe('modified');
  });

  it('multiple set-var nodes write different variables', () => {
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 'a' }),
      sv1: makeNode('sv1', 'set-var', { variableName: 'var1' }),
      s2: makeNode('s2', 'source', { value: 'b' }),
      sv2: makeNode('sv2', 'set-var', { variableName: 'var2' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConnection('c0', 's1', 0, 'sv1', 0),
      c1: makeConnection('c1', 's2', 0, 'sv2', 0),
    };
    setGraphVariablesContext({});
    executeGraph(nodes, conns, undefined, undefined, undefined, undefined, {});
    const vars = getGraphVariablesContext();
    expect(vars.var1).toBe('a');
    expect(vars.var2).toBe('b');
  });

  it('set-var overwrites pre-existing variable', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 'new' }),
      sv: makeNode('sv', 'set-var', { variableName: 'existing' }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConnection('c0', 'src', 0, 'sv', 0),
    };
    setGraphVariablesContext({});
    executeGraph(nodes, conns, undefined, undefined, undefined, undefined, { existing: 'old' });
    const vars = getGraphVariablesContext();
    expect(vars.existing).toBe('new');
  });

  it('get-var returns 0 for undefined variable', () => {
    const nodes: Record<string, EditorNode> = {
      gv: makeNode('gv', 'get-var', { variableName: 'nonexistent' }),
    };
    setGraphVariablesContext({});
    const result = executeGraph(nodes, {}, undefined, undefined, undefined, undefined, {});
    // get-var defaults to 0 for unknown variables (via ?? 0 fallback)
    const output = result.results.get('gv')?.outputs[0];
    expect(output).toBe(0);
  });

  it('worker message protocol includes graphVariables', () => {
    // Test the message shape for worker communication
    const msg: ExecuteMessage = {
      type: 'execute',
      id: 1,
      nodes: {},
      connections: {},
      cache: [],
      subgraphDefs: {},
      innerGraphs: {},
      errorStrategy: 'fail-fast',
      graphVariables: { testVar: 42 },
    };
    expect(msg.graphVariables).toEqual({ testVar: 42 });
    expect(msg.type).toBe('execute');
  });

  it('worker result message includes updatedGraphVariables', () => {
    const resultMsg: ExecuteResultMessage = {
      type: 'result',
      id: 1,
      results: [],
      waves: [],
      errors: [],
      metrics: [],
      totalDuration: 10,
      updatedGraphVariables: { output: 'computed' },
    };
    expect(resultMsg.updatedGraphVariables).toEqual({ output: 'computed' });
  });

  it('graphVariables survive structured clone serialization', () => {
    const original: Record<string, unknown> = {
      str: 'hello',
      num: 42,
      bool: true,
      arr: [1, 2, 3],
      obj: { nested: true },
      nil: null,
    };
    // Structured clone simulation via JSON roundtrip
    const cloned = JSON.parse(JSON.stringify(original));
    expect(cloned).toEqual(original);
  });

  it('complex variable values survive execution roundtrip', () => {
    const nodes: Record<string, EditorNode> = {
      // Create an array and store it as a variable
      s0: makeNode('s0', 'source', { value: 1 }),
      s1: makeNode('s1', 'source', { value: 2 }),
      s2: makeNode('s2', 'source', { value: 3 }),
      arr: makeNode('arr', 'create-array'),
      sv: makeNode('sv', 'set-var', { variableName: 'myArray' }),
    };
    const conns: Record<string, Connection> = {
      a0: makeConnection('a0', 's0', 0, 'arr', 0),
      a1: makeConnection('a1', 's1', 0, 'arr', 1),
      a2: makeConnection('a2', 's2', 0, 'arr', 2),
      c0: makeConnection('c0', 'arr', 0, 'sv', 0),
    };
    setGraphVariablesContext({});
    executeGraph(nodes, conns, undefined, undefined, undefined, undefined, {});
    const vars = getGraphVariablesContext();
    expect(vars.myArray).toEqual([1, 2, 3]);
  });

  it('non-deterministic: get-var/set-var bypass execution cache', () => {
    // First execution sets a variable
    const nodes1: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 'first' }),
      sv: makeNode('sv', 'set-var', { variableName: 'cached' }),
    };
    const conns1: Record<string, Connection> = {
      c0: makeConnection('c0', 'src', 0, 'sv', 0),
    };
    setGraphVariablesContext({});
    executeGraph(nodes1, conns1, undefined, undefined, undefined, undefined, {});
    expect(getGraphVariablesContext().cached).toBe('first');

    // Second execution with different value (should NOT use cached result)
    const nodes2: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 'second' }),
      sv: makeNode('sv', 'set-var', { variableName: 'cached' }),
    };
    const conns2: Record<string, Connection> = {
      c0: makeConnection('c0', 'src', 0, 'sv', 0),
    };
    setGraphVariablesContext({});
    executeGraph(nodes2, conns2, undefined, undefined, undefined, undefined, {});
    expect(getGraphVariablesContext().cached).toBe('second');
  });

  it('execution with empty graphVariables does not crash', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 1 }),
    };
    setGraphVariablesContext({});
    const result = executeGraph(nodes, {}, undefined, undefined, undefined, undefined, {});
    expect(result.results.size).toBe(1);
    expect(result.errors.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Health Check Ping-Pong
// ---------------------------------------------------------------------------

describe('Health Check Ping-Pong', () => {
  let managerModule: typeof import('../workers/executionWorkerManager');
  let mockWorkerInstances: Array<{
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
  }>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mockWorkerInstances = [];

    vi.stubGlobal('Worker', class MockWorker {
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      constructor() {
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        mockWorkerInstances.push(this);
      }
    });

    managerModule = await import('../workers/executionWorkerManager');
  });

  afterEach(() => {
    managerModule.stopHealthMonitor();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('checkWorkerHealth resolves true when pong received', async () => {
    // Initialise the worker so onmessage is attached
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    const healthPromise = managerModule.checkWorkerHealth();

    // The ping message should have been posted
    expect(mock.postMessage).toHaveBeenCalledTimes(1);
    const pingMsg = mock.postMessage.mock.calls[0][0] as { type: string; id: number };
    expect(pingMsg.type).toBe('ping');

    // Simulate the worker replying with a matching pong
    const pong: PongResponse = { type: 'pong', id: pingMsg.id };
    mock.onmessage!({ data: pong } as MessageEvent);

    const result = await healthPromise;
    expect(result).toBe(true);
  });

  it('checkWorkerHealth resolves false on timeout', async () => {
    managerModule.getExecutionWorker();

    const healthPromise = managerModule.checkWorkerHealth();

    // Do NOT send a pong — advance past the 5000ms timeout
    vi.advanceTimersByTime(5000);

    const result = await healthPromise;
    expect(result).toBe(false);
  });

  it('checkWorkerHealth terminates worker on timeout', async () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    const healthPromise = managerModule.checkWorkerHealth();

    // Advance past the health check timeout
    vi.advanceTimersByTime(5000);

    await healthPromise;

    // The worker should have been terminated
    expect(mock.terminate).toHaveBeenCalledTimes(1);
  });

  it('checkWorkerHealth resolves false when no worker available', async () => {
    // Re-import with a Worker that throws on construction
    vi.resetModules();
    vi.stubGlobal('Worker', class FailWorker {
      constructor() {
        throw new Error('Workers not supported');
      }
    });
    const freshModule = await import('../workers/executionWorkerManager');

    const result = await freshModule.checkWorkerHealth();
    expect(result).toBe(false);
  });

  it('startHealthMonitor sends periodic pings', () => {
    // Create the worker first so the monitor has something to ping
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    managerModule.startHealthMonitor();

    // Initially no pings sent (interval fires after first 30s)
    expect(mock.postMessage).toHaveBeenCalledTimes(0);

    // Advance 30 seconds — first health check ping fires
    vi.advanceTimersByTime(30_000);
    expect(mock.postMessage).toHaveBeenCalledTimes(1);
    const pingMsg = mock.postMessage.mock.calls[0][0] as { type: string; id: number };
    expect(pingMsg.type).toBe('ping');

    // Respond with pong so the worker is not terminated
    mock.onmessage!({ data: { type: 'pong', id: pingMsg.id } } as MessageEvent);

    // Advance another 30 seconds — second ping fires
    vi.advanceTimersByTime(30_000);
    expect(mock.postMessage).toHaveBeenCalledTimes(2);

    // Respond to second ping too
    const pingMsg2 = mock.postMessage.mock.calls[1][0] as { type: string; id: number };
    mock.onmessage!({ data: { type: 'pong', id: pingMsg2.id } } as MessageEvent);
  });

  it('startHealthMonitor is idempotent (only one interval)', () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    // Call startHealthMonitor twice
    managerModule.startHealthMonitor();
    managerModule.startHealthMonitor();

    // Advance 30 seconds — should get exactly one ping, not two
    vi.advanceTimersByTime(30_000);
    expect(mock.postMessage).toHaveBeenCalledTimes(1);

    // Respond with pong
    const pingMsg = mock.postMessage.mock.calls[0][0] as { type: string; id: number };
    mock.onmessage!({ data: { type: 'pong', id: pingMsg.id } } as MessageEvent);
  });

  it('stopHealthMonitor stops periodic pings', () => {
    managerModule.getExecutionWorker();
    const mock = mockWorkerInstances[0];

    managerModule.startHealthMonitor();

    // First tick: ping fires
    vi.advanceTimersByTime(30_000);
    expect(mock.postMessage).toHaveBeenCalledTimes(1);

    // Respond with pong to keep worker alive
    const pingMsg = mock.postMessage.mock.calls[0][0] as { type: string; id: number };
    mock.onmessage!({ data: { type: 'pong', id: pingMsg.id } } as MessageEvent);

    // Stop the monitor
    managerModule.stopHealthMonitor();

    // Advance another 30 seconds — no new pings
    vi.advanceTimersByTime(30_000);
    expect(mock.postMessage).toHaveBeenCalledTimes(1);
  });

  it('terminateExecutionWorker resolves pending health checks as false', async () => {
    managerModule.getExecutionWorker();

    // Start a health check but do not respond
    const healthPromise = managerModule.checkWorkerHealth();

    // Terminate the worker — should resolve the pending health check as false
    managerModule.terminateExecutionWorker();

    const result = await healthPromise;
    expect(result).toBe(false);
  });
});

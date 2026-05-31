import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  MockExecutionBackend,
  dispatchRemote,
  getExecutionBackend,
  setExecutionBackend,
  registerRemoteNodeType,
  unregisterRemoteNodeType,
  isRemoteNodeType,
  remoteCachedResult,
  _resetRemoteExecution,
  type ExecutionBackend,
  type RemoteRequest,
} from '../utils/remoteExecution';

enableMapSet();

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const req = (overrides: Partial<RemoteRequest> = {}): RemoteRequest => ({
  nodeId: 'n1',
  nodeType: 'remote-compute',
  inputs: { 0: 2, 1: 3 },
  data: {},
  ...overrides,
});

afterEach(() => {
  _resetRemoteExecution();
});

// ── Pure module ──────────────────────────────────────────────────────────

describe('remoteExecution — MockExecutionBackend', () => {
  it('resolves ok and sums numeric inputs by default', async () => {
    const backend = new MockExecutionBackend();
    const result = await backend.execute(req(), () => {});
    expect(result.status).toBe('ok');
    expect(result.outputs[0]).toBe(5);
    expect(String(result.outputs[1])).toContain('remote-compute');
  });

  it('streams monotonic progress that ends at 1', async () => {
    const backend = new MockExecutionBackend({ steps: 4 });
    const seen: number[] = [];
    await backend.execute(req(), p => seen.push(p));
    expect(seen).toHaveLength(4);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });

  it('honours a custom compute function', async () => {
    const backend = new MockExecutionBackend({ compute: (inputs) => ({ 0: (inputs[0] as number) * 10 }) });
    const result = await backend.execute(req({ inputs: { 0: 4 } }), () => {});
    expect(result.outputs[0]).toBe(40);
  });

  it('returns an error result when fail is set', async () => {
    const backend = new MockExecutionBackend({ fail: 'GPU out of memory' });
    const result = await backend.execute(req(), () => {});
    expect(result.status).toBe('error');
    expect(result.error).toBe('GPU out of memory');
  });

  it('throws AbortError when the signal is already aborted', async () => {
    const backend = new MockExecutionBackend();
    const controller = new AbortController();
    controller.abort();
    await expect(backend.execute(req(), () => {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('remoteExecution — dispatchRemote', () => {
  it('normalizes a thrown backend error into an error result', async () => {
    const throwing: ExecutionBackend = {
      id: 'throwing',
      execute: async () => { throw new Error('connection refused'); },
    };
    const result = await dispatchRemote(req(), { backend: throwing });
    expect(result.status).toBe('error');
    expect(result.error).toBe('connection refused');
  });

  it('normalizes cancellation into a cancelled error result', async () => {
    const controller = new AbortController();
    const backend = new MockExecutionBackend({ latencyMs: 20, steps: 5 });
    const promise = dispatchRemote(req(), { backend, signal: controller.signal });
    controller.abort();
    const result = await promise;
    expect(result.status).toBe('error');
    expect(result.error).toBe('cancelled');
  });

  it('uses the active backend when none is passed', async () => {
    setExecutionBackend(new MockExecutionBackend({ compute: () => ({ 0: 'from-active' }) }));
    const result = await dispatchRemote(req());
    expect(result.outputs[0]).toBe('from-active');
  });
});

describe('remoteExecution — registry & helpers', () => {
  it('swaps and restores the active backend', () => {
    const original = getExecutionBackend();
    const custom: ExecutionBackend = { id: 'custom', execute: async () => ({ status: 'ok', outputs: {} }) };
    setExecutionBackend(custom);
    expect(getExecutionBackend()).toBe(custom);
    _resetRemoteExecution();
    expect(getExecutionBackend()).not.toBe(custom);
    expect(getExecutionBackend()).not.toBe(original);
  });

  it('registers and unregisters remote node types', () => {
    expect(isRemoteNodeType('remote-compute')).toBe(false);
    registerRemoteNodeType('remote-compute');
    expect(isRemoteNodeType('remote-compute')).toBe(true);
    unregisterRemoteNodeType('remote-compute');
    expect(isRemoteNodeType('remote-compute')).toBe(false);
  });

  it('remoteCachedResult reads the cache written onto a node', () => {
    const empty = remoteCachedResult({ data: {} });
    expect(empty).toEqual({ 0: null, 1: 'idle', 2: '' });

    const filled = remoteCachedResult({ data: { _remoteResult: { 0: 42 }, _remoteStatus: 'ok', _remoteError: '' } });
    expect(filled[0]).toEqual({ 0: 42 });
    expect(filled[1]).toBe('ok');
  });
});

// ── Store integration ──────────────────────────────────────────────────────

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
  });
}

/** Seed a target node fed by an upstream output, return the target node id. */
function seedRemoteNode(upstreamValue: unknown): string {
  useEditorStore.setState((s) => {
    s.nodes.src = { id: 'src', type: 'source', position: [0, 0, 0], title: 'src', data: {}, inputs: [], outputs: [] } as never;
    s.nodes.rmt = { id: 'rmt', type: 'transform', position: [2, 0, 0], title: 'rmt', data: {}, inputs: [], outputs: [] } as never;
    s.connections.c1 = { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'rmt', targetPortIndex: 0 } as never;
    s.nodeOutputs.src = { 0: upstreamValue };
  });
  return 'rmt';
}

describe('remoteExecution — dispatchRemoteNode store action', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    _resetRemoteExecution();
  });

  it('dispatches, writes the result onto the node, and marks it complete', async () => {
    const id = seedRemoteNode(7);
    useEditorStore.getState().dispatchRemoteNode(id);

    // Marked running immediately
    expect(useEditorStore.getState().executionStates[id]).toBe('running');

    await flush();

    const node = useEditorStore.getState().nodes[id];
    expect(useEditorStore.getState().executionStates[id]).toBe('complete');
    expect(node.data._remoteStatus).toBe('ok');
    expect(node.data._remoteProgress).toBe(1);
    // Default mock sums numeric inputs → upstream 7
    expect((node.data._remoteResult as Record<number, unknown>)[0]).toBe(7);

    // The node's processor view of the cache is consistent
    expect(remoteCachedResult(node)[0]).toEqual(node.data._remoteResult);
  });

  it('records an error and marks the node errored when the backend fails', async () => {
    setExecutionBackend(new MockExecutionBackend({ fail: 'backend down' }));
    const id = seedRemoteNode(1);
    useEditorStore.getState().dispatchRemoteNode(id);
    await flush();

    expect(useEditorStore.getState().executionStates[id]).toBe('error');
    expect(useEditorStore.getState().nodes[id].data._remoteError).toBe('backend down');
    expect(useEditorStore.getState().executionErrors[id]).toBe('backend down');
  });

  it('cancelRemoteNode aborts an in-flight dispatch and resets running state', async () => {
    setExecutionBackend(new MockExecutionBackend({ latencyMs: 30, steps: 5 }));
    const id = seedRemoteNode(3);
    useEditorStore.getState().dispatchRemoteNode(id);
    expect(useEditorStore.getState().executionStates[id]).toBe('running');

    useEditorStore.getState().cancelRemoteNode(id);
    expect(useEditorStore.getState().executionStates[id]).toBe('idle');

    // Let the aborted dispatch settle; it must not overwrite the result
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(useEditorStore.getState().nodes[id].data._remoteResult).toBeUndefined();
  });
});

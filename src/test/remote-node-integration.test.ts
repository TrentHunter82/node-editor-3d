import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  getPluginProcessor,
  getPluginDef,
  isPluginType,
  usePluginStore,
  _resetPluginRegistry,
} from '../store/pluginStore';
import { isRemoteNodeType, _resetRemoteExecution } from '../utils/remoteExecution';
import { registerBuiltInPlugins, REMOTE_COMPUTE_TYPE } from '../plugins/remoteDemo';
import type { NodeType } from '../types';

enableMapSet();

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function resetAll() {
  _resetModuleState();
  _resetPluginRegistry();
  _resetRemoteExecution();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
  });
}

describe('remoteDemo — built-in plugin registration', () => {
  beforeEach(resetAll);
  afterEach(resetAll);

  it('registers the remote-compute plugin and flags it as a remote type', () => {
    expect(isPluginType(REMOTE_COMPUTE_TYPE)).toBe(false);
    expect(isRemoteNodeType(REMOTE_COMPUTE_TYPE)).toBe(false);

    registerBuiltInPlugins();

    expect(isPluginType(REMOTE_COMPUTE_TYPE)).toBe(true);
    expect(isRemoteNodeType(REMOTE_COMPUTE_TYPE)).toBe(true);

    const def = getPluginDef(REMOTE_COMPUTE_TYPE);
    expect(def?.name).toBe('Remote Compute');
    expect(def?.inputs).toHaveLength(2);
    expect(def?.outputs).toHaveLength(3);
  });

  it('is idempotent — repeated calls register exactly one plugin', () => {
    registerBuiltInPlugins();
    registerBuiltInPlugins();
    registerBuiltInPlugins();
    expect(usePluginStore.getState().pluginCount).toBe(1);
    expect(isRemoteNodeType(REMOTE_COMPUTE_TYPE)).toBe(true);
  });

  it('the registered processor surfaces the cached remote result', () => {
    registerBuiltInPlugins();
    const processor = getPluginProcessor(REMOTE_COMPUTE_TYPE);
    expect(processor).toBeTypeOf('function');

    // No cache yet → idle shape
    const idle = processor!({ id: 'n', type: REMOTE_COMPUTE_TYPE, data: {} } as never, {});
    expect(idle).toEqual({ 0: null, 1: 'idle', 2: '' });

    // With a cached result → surfaced on output 0/1/2
    const filled = processor!(
      { id: 'n', type: REMOTE_COMPUTE_TYPE, data: { _remoteResult: { 0: 99 }, _remoteStatus: 'ok', _remoteError: '' } } as never,
      {},
    );
    expect(filled[0]).toEqual({ 0: 99 });
    expect(filled[1]).toBe('ok');
  });
});

describe('remoteDemo — end-to-end dispatch through the store', () => {
  beforeEach(resetAll);
  afterEach(resetAll);

  it('adds a remote-compute node, dispatches it, and the processor reads the result', async () => {
    registerBuiltInPlugins();

    // Add via the real store action (uses the plugin port config) and wire an input.
    // Plugin types live outside the NodeType union; the palette casts the same way.
    const id = useEditorStore.getState().addNode(REMOTE_COMPUTE_TYPE as NodeType, [0, 0, 0]);
    const node0 = useEditorStore.getState().nodes[id];
    expect(node0.inputs).toHaveLength(2);
    expect(node0.outputs).toHaveLength(3);

    useEditorStore.setState((s) => {
      s.nodes.src = { id: 'src', type: 'source', position: [-2, 0, 0], title: 'src', data: {}, inputs: [], outputs: [] } as never;
      s.connections.c1 = { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: id, targetPortIndex: 0 } as never;
      s.nodeOutputs.src = { 0: 21 };
    });

    useEditorStore.getState().dispatchRemoteNode(id);
    expect(useEditorStore.getState().executionStates[id]).toBe('running');
    await flush();

    const node = useEditorStore.getState().nodes[id];
    expect(useEditorStore.getState().executionStates[id]).toBe('complete');
    expect(node.data._remoteStatus).toBe('ok');

    // The synchronous processor now returns the cached result the dispatch wrote.
    const processor = getPluginProcessor(REMOTE_COMPUTE_TYPE)!;
    const out = processor(node as never, { 0: 21 });
    expect((out[0] as Record<number, unknown>)[0]).toBe(21); // mock sums numeric inputs
    expect(out[1]).toBe('ok');
  });
});

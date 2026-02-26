import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import {
  registerPlugin,
  unregisterPlugin,
  getPluginProcessor,
  getPluginDef,
  getAllPluginDefs,
  isPluginType,
  getPluginPortConfig,
  usePluginStore,
  _resetPluginRegistry,
} from '../store/pluginStore';
import type { PluginNodeDef } from '../types';
import type { EditorNode, Connection } from '../types';
import { executeGraph } from '../utils/execution';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeValidPlugin(overrides?: Partial<PluginNodeDef>): PluginNodeDef {
  return {
    type: 'test-plugin',
    name: 'Test Plugin',
    color: 'teal',
    category: 'Test',
    inputs: [{ label: 'in', portType: 'number' }],
    outputs: [{ label: 'out', portType: 'number' }],
    processor: (_node, inputs) => ({
      0: (typeof inputs[0] === 'number' ? inputs[0] : 0) * 2,
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetPluginRegistry();
});

// ===========================================================================
// 1. Registration Validation
// ===========================================================================

describe('Registration Validation', () => {
  it('registers a valid plugin successfully', () => {
    const result = registerPlugin(makeValidPlugin());
    expect(result).toEqual({ success: true });
  });

  it('rejects a plugin with missing type', () => {
    const result = registerPlugin(
      makeValidPlugin({ type: undefined as unknown as string }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/type/i);
  });

  it('rejects a plugin with empty type string', () => {
    const result = registerPlugin(makeValidPlugin({ type: '' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/type/i);
  });

  it('rejects a plugin with missing name', () => {
    const result = registerPlugin(
      makeValidPlugin({ name: undefined as unknown as string }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/name/i);
  });

  it('rejects a plugin with non-function processor', () => {
    const result = registerPlugin(
      makeValidPlugin({
        processor: 'not-a-function' as unknown as PluginNodeDef['processor'],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/processor/i);
  });

  it('rejects a plugin with missing inputs array', () => {
    const result = registerPlugin(
      makeValidPlugin({ inputs: undefined as unknown as PluginNodeDef['inputs'] }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inputs/i);
  });

  it('rejects a plugin with missing outputs array', () => {
    const result = registerPlugin(
      makeValidPlugin({
        outputs: undefined as unknown as PluginNodeDef['outputs'],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outputs/i);
  });

  it('rejects a plugin with a port missing label', () => {
    const result = registerPlugin(
      makeValidPlugin({
        inputs: [{ label: '', portType: 'number' }],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/label/i);
  });

  it('rejects a plugin with a port missing portType', () => {
    const result = registerPlugin(
      makeValidPlugin({
        outputs: [
          { label: 'out', portType: undefined as unknown as 'number' },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/portType/i);
  });

  it('rejects duplicate registration of the same type', () => {
    registerPlugin(makeValidPlugin());
    const result = registerPlugin(makeValidPlugin());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already registered/i);
  });
});

// ===========================================================================
// 2. Built-in Collision Detection
// ===========================================================================

describe('Built-in Collision Detection', () => {
  it('rejects registering "source" (built-in type)', () => {
    const result = registerPlugin(makeValidPlugin({ type: 'source' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collides.*built-in/i);
  });

  it('rejects registering "transform" (built-in type)', () => {
    const result = registerPlugin(makeValidPlugin({ type: 'transform' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collides.*built-in/i);
  });

  it('rejects registering "custom" (built-in type)', () => {
    const result = registerPlugin(makeValidPlugin({ type: 'custom' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collides.*built-in/i);
  });

  it('allows registering a non-colliding type', () => {
    const result = registerPlugin(
      makeValidPlugin({ type: 'my-unique-plugin' }),
    );
    expect(result.success).toBe(true);
  });
});

// ===========================================================================
// 3. Registry Operations
// ===========================================================================

describe('Registry Operations', () => {
  it('getPluginProcessor returns the processor for a registered type', () => {
    const def = makeValidPlugin();
    registerPlugin(def);
    const processor = getPluginProcessor('test-plugin');
    expect(processor).toBeTypeOf('function');
    // Verify it is functionally equivalent (registerPlugin shallow-copies def)
    const result = processor!(
      {} as EditorNode,
      { 0: 7 },
    );
    expect(result).toEqual({ 0: 14 });
  });

  it('getPluginProcessor returns undefined for an unregistered type', () => {
    expect(getPluginProcessor('nonexistent')).toBeUndefined();
  });

  it('getPluginDef returns full definition for a registered type', () => {
    const def = makeValidPlugin();
    registerPlugin(def);
    const retrieved = getPluginDef('test-plugin');
    expect(retrieved).toBeDefined();
    expect(retrieved!.type).toBe('test-plugin');
    expect(retrieved!.name).toBe('Test Plugin');
    expect(retrieved!.category).toBe('Test');
    expect(retrieved!.inputs).toHaveLength(1);
    expect(retrieved!.outputs).toHaveLength(1);
  });

  it('getAllPluginDefs returns all registered plugins', () => {
    registerPlugin(makeValidPlugin({ type: 'plugin-a', name: 'A' }));
    registerPlugin(makeValidPlugin({ type: 'plugin-b', name: 'B' }));
    registerPlugin(makeValidPlugin({ type: 'plugin-c', name: 'C' }));
    const all = getAllPluginDefs();
    expect(all).toHaveLength(3);
    const types = all.map((d) => d.type).sort();
    expect(types).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
  });

  it('isPluginType returns true for registered and false for unregistered', () => {
    registerPlugin(makeValidPlugin());
    expect(isPluginType('test-plugin')).toBe(true);
    expect(isPluginType('not-registered')).toBe(false);
  });

  it('getPluginPortConfig returns port config with color', () => {
    registerPlugin(
      makeValidPlugin({
        color: 'orange',
        inputs: [
          { label: 'x', portType: 'number' },
          { label: 'y', portType: 'number' },
        ],
        outputs: [{ label: 'sum', portType: 'number' }],
      }),
    );
    const config = getPluginPortConfig('test-plugin');
    expect(config).toBeDefined();
    expect(config!.color).toBe('orange');
    expect(config!.inputs).toHaveLength(2);
    expect(config!.outputs).toHaveLength(1);
    expect(config!.inputs[0].label).toBe('x');
    expect(config!.outputs[0].label).toBe('sum');
  });

  it('unregisterPlugin removes from registry and returns true', () => {
    registerPlugin(makeValidPlugin());
    expect(isPluginType('test-plugin')).toBe(true);

    const removed = unregisterPlugin('test-plugin');
    expect(removed).toBe(true);
    expect(isPluginType('test-plugin')).toBe(false);
    expect(getPluginProcessor('test-plugin')).toBeUndefined();
    expect(getPluginDef('test-plugin')).toBeUndefined();
    expect(getPluginPortConfig('test-plugin')).toBeUndefined();
  });

  it('unregisterPlugin returns false for non-existent type', () => {
    expect(unregisterPlugin('does-not-exist')).toBe(false);
  });
});

// ===========================================================================
// 4. Reactive Store
// ===========================================================================

describe('Reactive Store', () => {
  it('registryVersion increments on register', () => {
    const before = usePluginStore.getState().registryVersion;
    registerPlugin(makeValidPlugin());
    const after = usePluginStore.getState().registryVersion;
    expect(after).toBe(before + 1);
  });

  it('registryVersion increments on unregister', () => {
    registerPlugin(makeValidPlugin());
    const before = usePluginStore.getState().registryVersion;
    unregisterPlugin('test-plugin');
    const after = usePluginStore.getState().registryVersion;
    expect(after).toBe(before + 1);
  });

  it('pluginCount tracks registry size', () => {
    expect(usePluginStore.getState().pluginCount).toBe(0);

    registerPlugin(makeValidPlugin({ type: 'p1', name: 'P1' }));
    expect(usePluginStore.getState().pluginCount).toBe(1);

    registerPlugin(makeValidPlugin({ type: 'p2', name: 'P2' }));
    expect(usePluginStore.getState().pluginCount).toBe(2);

    unregisterPlugin('p1');
    expect(usePluginStore.getState().pluginCount).toBe(1);
  });

  it('_resetPluginRegistry resets version and count to 0', () => {
    registerPlugin(makeValidPlugin({ type: 'a', name: 'A' }));
    registerPlugin(makeValidPlugin({ type: 'b', name: 'B' }));
    expect(usePluginStore.getState().pluginCount).toBe(2);
    expect(usePluginStore.getState().registryVersion).toBeGreaterThan(0);

    _resetPluginRegistry();
    expect(usePluginStore.getState().registryVersion).toBe(0);
    expect(usePluginStore.getState().pluginCount).toBe(0);
    expect(getAllPluginDefs()).toHaveLength(0);
  });
});

// ===========================================================================
// 5. Execution Integration
// ===========================================================================

describe('Execution Integration', () => {
  /** Build a minimal source -> plugin graph for executeGraph tests. */
  function buildPluginGraph(pluginType: string) {
    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Source',
        data: { value: 5 },
        inputs: [],
        outputs: [
          { id: 'src-out-0', label: 'value', portType: 'number' },
          { id: 'src-out-1', label: 'label', portType: 'string' },
        ],
      },
      plugin: {
        id: 'plugin',
        type: pluginType as EditorNode['type'],
        position: [2, 0, 0],
        title: 'Plugin',
        data: {},
        inputs: [{ id: 'p-in-0', label: 'in', portType: 'number' }],
        outputs: [{ id: 'p-out-0', label: 'out', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: {
        id: 'c1',
        sourceNodeId: 'src',
        sourcePortIndex: 0,
        targetNodeId: 'plugin',
        targetPortIndex: 0,
      },
    };
    return { nodes, connections };
  }

  it('plugin processor executes via executeGraph', () => {
    registerPlugin(makeValidPlugin());
    const { nodes, connections } = buildPluginGraph('test-plugin');

    const result = executeGraph(nodes, connections);
    // source outputs { 0: 5, 1: '' }, plugin doubles it -> { 0: 10 }
    const pluginResult = result.results.get('plugin');
    expect(pluginResult).toBeDefined();
    expect(pluginResult!.outputs[0]).toBe(10);
    expect(result.errors.size).toBe(0);
  });

  it('plugin processor receives correct inputs from connections', () => {
    const processorSpy = vi.fn((_node: EditorNode, inputs: Record<number, unknown>) => ({
      0: inputs[0],
    }));
    registerPlugin(makeValidPlugin({ processor: processorSpy }));
    const { nodes, connections } = buildPluginGraph('test-plugin');

    executeGraph(nodes, connections);

    expect(processorSpy).toHaveBeenCalledTimes(1);
    // First arg is the node, second arg is the inputs record
    const receivedInputs = processorSpy.mock.calls[0][1];
    expect(receivedInputs[0]).toBe(5); // source value
  });

  it('missing plugin processor produces an error in executeGraph', () => {
    // Do NOT register any plugin -- use a type that has no built-in or plugin processor
    const { nodes, connections } = buildPluginGraph('nonexistent-plugin');

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBeGreaterThan(0);
    const errMsg = result.errors.get('plugin');
    expect(errMsg).toMatch(/No processor for node type/i);
  });

  it('plugin error with strategy "continue" collects error; "fail-fast" stops', () => {
    const throwingProcessor = () => {
      throw new Error('Plugin boom');
    };
    registerPlugin(
      makeValidPlugin({
        type: 'boom-plugin',
        name: 'Boom',
        processor: throwingProcessor,
      }),
    );

    // Build a graph: source -> boom-plugin -> downstream-plugin
    // downstream-plugin should still execute under 'continue' but not under 'fail-fast'
    const doubler = makeValidPlugin({
      type: 'downstream-plugin',
      name: 'Downstream',
    });
    registerPlugin(doubler);

    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Source',
        data: { value: 3 },
        inputs: [],
        outputs: [
          { id: 'src-out-0', label: 'value', portType: 'number' },
          { id: 'src-out-1', label: 'label', portType: 'string' },
        ],
      },
      boom: {
        id: 'boom',
        type: 'boom-plugin' as EditorNode['type'],
        position: [2, 0, 0],
        title: 'Boom',
        data: {},
        inputs: [{ id: 'b-in-0', label: 'in', portType: 'number' }],
        outputs: [{ id: 'b-out-0', label: 'out', portType: 'number' }],
      },
      down: {
        id: 'down',
        type: 'downstream-plugin' as EditorNode['type'],
        position: [4, 0, 0],
        title: 'Downstream',
        data: {},
        inputs: [{ id: 'd-in-0', label: 'in', portType: 'number' }],
        outputs: [{ id: 'd-out-0', label: 'out', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: {
        id: 'c1',
        sourceNodeId: 'src',
        sourcePortIndex: 0,
        targetNodeId: 'boom',
        targetPortIndex: 0,
      },
      c2: {
        id: 'c2',
        sourceNodeId: 'boom',
        sourcePortIndex: 0,
        targetNodeId: 'down',
        targetPortIndex: 0,
      },
    };

    // 'continue' strategy: collects error from boom but still executes downstream
    const continueResult = executeGraph(
      nodes,
      connections,
      undefined,
      undefined,
      undefined,
      'continue',
    );
    expect(continueResult.errors.has('boom')).toBe(true);
    expect(continueResult.errors.get('boom')).toMatch(/Plugin boom/);
    // downstream should have been reached (it processes, even if input is undefined/null)
    expect(continueResult.results.has('down')).toBe(true);

    // 'fail-fast' strategy: stops execution after boom errors
    const failFastResult = executeGraph(
      nodes,
      connections,
      undefined,
      undefined,
      undefined,
      'fail-fast',
    );
    expect(failFastResult.errors.has('boom')).toBe(true);
    // Under fail-fast, the downstream node should NOT have a valid result
    // (execution stops early so downstream may not be reached at all)
    const downResult = failFastResult.results.get('down');
    // Either downstream was not reached, or it has no outputs
    if (downResult) {
      // If it somehow ran, it would have no meaningful output since boom errored
      expect(Object.keys(downResult.outputs).length).toBe(0);
    }
  });
});

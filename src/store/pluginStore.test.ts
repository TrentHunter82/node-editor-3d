import { describe, it, expect, beforeEach } from 'vitest';
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
} from './pluginStore';
import type { PluginNodeDef } from '../types';

// ---------------------------------------------------------------------------
// Helper: create a valid plugin definition with optional overrides
// ---------------------------------------------------------------------------

function makePluginDef(overrides?: Partial<PluginNodeDef>): PluginNodeDef {
  return {
    type: 'test-plugin',
    name: 'Test Plugin',
    category: 'Custom',
    color: 'teal',
    inputs: [{ label: 'In', portType: 'number' as any }],
    outputs: [{ label: 'Out', portType: 'number' as any }],
    processor: (_node, inputs) => ({ 0: ((inputs[0] as number) ?? 0) * 2 }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset registry before each test to guarantee isolation
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetPluginRegistry();
});

// ===========================================================================
// registerPlugin
// ===========================================================================

describe('registerPlugin', () => {
  it('successfully registers a valid plugin and returns { success: true }', () => {
    const result = registerPlugin(makePluginDef());
    expect(result).toEqual({ success: true });
  });

  it('rejects an empty type string', () => {
    const result = registerPlugin(makePluginDef({ type: '' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/type/i);
  });

  it('rejects a non-string type', () => {
    const result = registerPlugin(
      makePluginDef({ type: 42 as unknown as string }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/type/i);
  });

  it('rejects an empty name string', () => {
    const result = registerPlugin(makePluginDef({ name: '' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/name/i);
  });

  it('rejects a non-function processor', () => {
    const result = registerPlugin(
      makePluginDef({ processor: 'not-a-fn' as unknown as PluginNodeDef['processor'] }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/processor/i);
  });

  it('rejects non-array inputs', () => {
    const result = registerPlugin(
      makePluginDef({ inputs: 'bad' as unknown as PluginNodeDef['inputs'] }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inputs/i);
  });

  it('rejects non-array outputs', () => {
    const result = registerPlugin(
      makePluginDef({ outputs: null as unknown as PluginNodeDef['outputs'] }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outputs/i);
  });

  it('rejects collision with a built-in type (math)', () => {
    const result = registerPlugin(makePluginDef({ type: 'math' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collides.*built-in/i);
  });

  it('rejects collision with a built-in type (source)', () => {
    const result = registerPlugin(makePluginDef({ type: 'source' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/collides.*built-in/i);
  });

  it('rejects duplicate plugin registration', () => {
    registerPlugin(makePluginDef());
    const result = registerPlugin(makePluginDef());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already registered/i);
  });

  it('rejects an input port missing label', () => {
    const result = registerPlugin(
      makePluginDef({
        inputs: [{ label: '', portType: 'number' as any }],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/label/i);
  });

  it('rejects an output port missing portType', () => {
    const result = registerPlugin(
      makePluginDef({
        outputs: [{ label: 'Out', portType: undefined as unknown as any }],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/portType/i);
  });

  it('increments registryVersion and pluginCount in the Zustand store', () => {
    const before = usePluginStore.getState();
    expect(before.registryVersion).toBe(0);
    expect(before.pluginCount).toBe(0);

    registerPlugin(makePluginDef({ type: 'plugin-a', name: 'A' }));
    const afterFirst = usePluginStore.getState();
    expect(afterFirst.registryVersion).toBe(1);
    expect(afterFirst.pluginCount).toBe(1);

    registerPlugin(makePluginDef({ type: 'plugin-b', name: 'B' }));
    const afterSecond = usePluginStore.getState();
    expect(afterSecond.registryVersion).toBe(2);
    expect(afterSecond.pluginCount).toBe(2);
  });

  it('does not increment store counters on failed registration', () => {
    const before = usePluginStore.getState();

    // Attempt invalid registrations
    registerPlugin(makePluginDef({ type: '' }));
    registerPlugin(makePluginDef({ name: '' }));
    registerPlugin(makePluginDef({ type: 'source' }));

    const after = usePluginStore.getState();
    expect(after.registryVersion).toBe(before.registryVersion);
    expect(after.pluginCount).toBe(before.pluginCount);
  });
});

// ===========================================================================
// unregisterPlugin
// ===========================================================================

describe('unregisterPlugin', () => {
  it('returns true and removes a registered plugin', () => {
    registerPlugin(makePluginDef());
    expect(isPluginType('test-plugin')).toBe(true);

    const removed = unregisterPlugin('test-plugin');
    expect(removed).toBe(true);
    expect(isPluginType('test-plugin')).toBe(false);
    expect(getPluginDef('test-plugin')).toBeUndefined();
    expect(getPluginProcessor('test-plugin')).toBeUndefined();
    expect(getPluginPortConfig('test-plugin')).toBeUndefined();
  });

  it('returns false for an unregistered type', () => {
    const removed = unregisterPlugin('never-registered');
    expect(removed).toBe(false);
  });

  it('decrements pluginCount and increments registryVersion in the store', () => {
    registerPlugin(makePluginDef({ type: 'p1', name: 'P1' }));
    registerPlugin(makePluginDef({ type: 'p2', name: 'P2' }));
    expect(usePluginStore.getState().pluginCount).toBe(2);
    const versionAfterRegistrations = usePluginStore.getState().registryVersion;

    unregisterPlugin('p1');
    expect(usePluginStore.getState().pluginCount).toBe(1);
    expect(usePluginStore.getState().registryVersion).toBe(versionAfterRegistrations + 1);

    unregisterPlugin('p2');
    expect(usePluginStore.getState().pluginCount).toBe(0);
    expect(usePluginStore.getState().registryVersion).toBe(versionAfterRegistrations + 2);
  });

  it('does not change store when unregistering a non-existent type', () => {
    registerPlugin(makePluginDef());
    const before = usePluginStore.getState();

    unregisterPlugin('does-not-exist');

    const after = usePluginStore.getState();
    expect(after.registryVersion).toBe(before.registryVersion);
    expect(after.pluginCount).toBe(before.pluginCount);
  });
});

// ===========================================================================
// query functions
// ===========================================================================

describe('query functions', () => {
  it('getPluginDef returns the registered definition', () => {
    const def = makePluginDef();
    registerPlugin(def);

    const retrieved = getPluginDef('test-plugin');
    expect(retrieved).toBeDefined();
    expect(retrieved!.type).toBe('test-plugin');
    expect(retrieved!.name).toBe('Test Plugin');
    expect(retrieved!.category).toBe('Custom');
    expect(retrieved!.inputs).toHaveLength(1);
    expect(retrieved!.outputs).toHaveLength(1);
  });

  it('getPluginDef returns undefined for an unregistered type', () => {
    expect(getPluginDef('unknown')).toBeUndefined();
  });

  it('getPluginProcessor returns the processor function and it works correctly', () => {
    registerPlugin(makePluginDef());

    const proc = getPluginProcessor('test-plugin');
    expect(proc).toBeTypeOf('function');

    // The default processor doubles the input
    const output = proc!({} as any, { 0: 7 });
    expect(output).toEqual({ 0: 14 });
  });

  it('getPluginProcessor returns undefined for an unregistered type', () => {
    expect(getPluginProcessor('missing')).toBeUndefined();
  });

  it('getAllPluginDefs returns all registered plugin definitions', () => {
    expect(getAllPluginDefs()).toHaveLength(0);

    registerPlugin(makePluginDef({ type: 'alpha', name: 'Alpha' }));
    registerPlugin(makePluginDef({ type: 'beta', name: 'Beta' }));
    registerPlugin(makePluginDef({ type: 'gamma', name: 'Gamma' }));

    const all = getAllPluginDefs();
    expect(all).toHaveLength(3);

    const types = all.map((d) => d.type).sort();
    expect(types).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('isPluginType returns true for registered types and false otherwise', () => {
    registerPlugin(makePluginDef());

    expect(isPluginType('test-plugin')).toBe(true);
    expect(isPluginType('not-a-plugin')).toBe(false);
    expect(isPluginType('')).toBe(false);
  });

  it('getPluginPortConfig returns port config with the specified color', () => {
    registerPlugin(
      makePluginDef({
        color: 'coral',
        inputs: [
          { label: 'X', portType: 'number' as any },
          { label: 'Y', portType: 'number' as any },
        ],
        outputs: [{ label: 'Sum', portType: 'number' as any }],
      }),
    );

    const config = getPluginPortConfig('test-plugin');
    expect(config).toBeDefined();
    expect(config!.color).toBe('coral');
    expect(config!.inputs).toHaveLength(2);
    expect(config!.outputs).toHaveLength(1);
    expect(config!.inputs[0].label).toBe('X');
    expect(config!.inputs[1].label).toBe('Y');
    expect(config!.outputs[0].label).toBe('Sum');
  });

  it('getPluginPortConfig defaults color to "teal" when no color is specified', () => {
    // Create a def without color — but PluginNodeDef requires color as string,
    // so we cast to simulate a plugin registered with no color field
    const def = makePluginDef();
    delete (def as any).color;
    registerPlugin(def);

    const config = getPluginPortConfig('test-plugin');
    expect(config).toBeDefined();
    expect(config!.color).toBe('teal');
  });

  it('getPluginPortConfig returns undefined for an unregistered type', () => {
    expect(getPluginPortConfig('nope')).toBeUndefined();
  });
});

// ===========================================================================
// _resetPluginRegistry
// ===========================================================================

describe('_resetPluginRegistry', () => {
  it('clears all plugins and resets store counters to zero', () => {
    registerPlugin(makePluginDef({ type: 'x', name: 'X' }));
    registerPlugin(makePluginDef({ type: 'y', name: 'Y' }));
    expect(getAllPluginDefs()).toHaveLength(2);
    expect(usePluginStore.getState().registryVersion).toBeGreaterThan(0);

    _resetPluginRegistry();

    expect(getAllPluginDefs()).toHaveLength(0);
    expect(isPluginType('x')).toBe(false);
    expect(isPluginType('y')).toBe(false);
    expect(usePluginStore.getState().registryVersion).toBe(0);
    expect(usePluginStore.getState().pluginCount).toBe(0);
  });

  it('allows re-registration of previously registered types after reset', () => {
    registerPlugin(makePluginDef());
    _resetPluginRegistry();

    // Should succeed since registry was cleared
    const result = registerPlugin(makePluginDef());
    expect(result.success).toBe(true);
    expect(isPluginType('test-plugin')).toBe(true);
  });
});

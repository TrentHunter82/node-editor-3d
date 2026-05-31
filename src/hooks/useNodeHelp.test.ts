import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * Tests for useNodeHelp, getNodeHelpLazy, and preloadNodeHelp.
 *
 * The hook lazily loads the nodeHelp module via dynamic import and caches
 * it in module-scoped variables (_module, _loadPromise, _subscribers).
 * Between tests we use vi.resetModules() to get a fresh copy of the hook
 * module so the module-level cache is clean.
 */

// A fake help entry returned by the mocked nodeHelp module.
const FAKE_HELP_ENTRY = {
  nodeType: 'source',
  category: 'Core',
  summary: 'A source node.',
  description: 'Produces a value.',
  inputs: [],
  outputs: [{ name: 'value', type: 'number', description: 'The value.' }],
};

// We mock ../utils/nodeHelp so the dynamic import() inside the hook resolves
// with our controlled data instead of loading the real 1500-line file.
vi.mock('../utils/nodeHelp', () => ({
  getNodeHelp: (type: string) => (type === 'source' ? FAKE_HELP_ENTRY : undefined),
  getAllNodeHelp: () => [FAKE_HELP_ENTRY],
  getNodeHelpByCategory: () => [FAKE_HELP_ENTRY],
}));

beforeEach(() => {
  vi.resetModules();
});

describe('useNodeHelp', () => {
  it('returns null when nodeType is null', async () => {
    const { useNodeHelp } = await import('./useNodeHelp');

    const { result } = renderHook(() => useNodeHelp(null));
    expect(result.current).toBeNull();
  });

  it('returns null when nodeType is undefined', async () => {
    const { useNodeHelp } = await import('./useNodeHelp');

    const { result } = renderHook(() => useNodeHelp(undefined));
    expect(result.current).toBeNull();
  });

  it('returns null initially before module loads, then returns the entry', async () => {
    const { useNodeHelp } = await import('./useNodeHelp');

    const { result } = renderHook(() => useNodeHelp('source'));

    // After the dynamic import resolves and subscriber fires, we should get the entry
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current).toEqual(FAKE_HELP_ENTRY);
  });

  it('returns null for an unknown node type after module loads', async () => {
    const { useNodeHelp } = await import('./useNodeHelp');

    // First, render with a known type to trigger module loading
    const { result: knownResult } = renderHook(() => useNodeHelp('source'));
    await waitFor(() => {
      expect(knownResult.current).not.toBeNull();
    });

    // Now render with an unknown type -- module is loaded, getNodeHelp returns undefined
    const { result: unknownResult } = renderHook(() => useNodeHelp('nonexistent'));
    expect(unknownResult.current).toBeNull();
  });

  it('cleans up subscriber on unmount', async () => {
    const { useNodeHelp } = await import('./useNodeHelp');

    const { unmount } = renderHook(() => useNodeHelp('source'));

    // Unmounting should remove the subscriber without throwing
    expect(() => unmount()).not.toThrow();
  });

  it('does not subscribe when module is already loaded', async () => {
    const { useNodeHelp, preloadNodeHelp } = await import('./useNodeHelp');

    // Preload to ensure module is cached
    preloadNodeHelp();
    // Wait for the dynamic import to resolve
    await (vi.dynamicImportSettled?.() ?? new Promise(r => setTimeout(r, 50)));

    // Render after module is already loaded -- effect should return early
    const { result } = renderHook(() => useNodeHelp('source'));

    // Should immediately have the entry since module is already loaded
    await waitFor(() => {
      expect(result.current).toEqual(FAKE_HELP_ENTRY);
    });
  });
});

describe('getNodeHelpLazy', () => {
  it('returns null before module is loaded', async () => {
    const { getNodeHelpLazy } = await import('./useNodeHelp');

    const result = getNodeHelpLazy('source');
    expect(result).toBeNull();
  });

  it('returns the help entry after module has loaded', async () => {
    const { getNodeHelpLazy, preloadNodeHelp } = await import('./useNodeHelp');

    // Trigger module load
    preloadNodeHelp();
    // Wait for the dynamic import to resolve
    await new Promise(r => setTimeout(r, 50));

    const result = getNodeHelpLazy('source');
    expect(result).toEqual(FAKE_HELP_ENTRY);
  });

  it('returns null for unknown node types even after load', async () => {
    const { getNodeHelpLazy, preloadNodeHelp } = await import('./useNodeHelp');

    preloadNodeHelp();
    await new Promise(r => setTimeout(r, 50));

    const result = getNodeHelpLazy('does-not-exist');
    expect(result).toBeNull();
  });

  it('kicks off loading as a side effect', async () => {
    const { getNodeHelpLazy } = await import('./useNodeHelp');

    // First call returns null and starts loading
    expect(getNodeHelpLazy('source')).toBeNull();

    // After import resolves, second call should return the entry
    await new Promise(r => setTimeout(r, 50));
    expect(getNodeHelpLazy('source')).toEqual(FAKE_HELP_ENTRY);
  });
});

describe('preloadNodeHelp', () => {
  it('triggers the module load', async () => {
    const { preloadNodeHelp, getNodeHelpLazy } = await import('./useNodeHelp');

    // Before preload, nothing is available
    expect(getNodeHelpLazy('source')).toBeNull();

    preloadNodeHelp();
    await new Promise(r => setTimeout(r, 50));

    // After preload resolves, data is available
    expect(getNodeHelpLazy('source')).toEqual(FAKE_HELP_ENTRY);
  });

  it('is idempotent -- multiple calls do not cause errors', async () => {
    const { preloadNodeHelp } = await import('./useNodeHelp');

    expect(() => {
      preloadNodeHelp();
      preloadNodeHelp();
      preloadNodeHelp();
    }).not.toThrow();

    await new Promise(r => setTimeout(r, 50));
  });
});

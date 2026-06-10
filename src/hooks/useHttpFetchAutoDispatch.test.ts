import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { enableMapSet } from 'immer';

enableMapSet();

import { useHttpFetchAutoDispatch } from './useHttpFetchAutoDispatch';
import { useEditorStore } from '../store/editorStore';

const getState = () => useEditorStore.getState();

function resetStore() {
  useEditorStore.setState((s) => {
    Object.assign(s, {
      nodes: {},
      connections: {},
      groups: {},
      selectedIds: new Set<string>(),
      interaction: 'idle',
      pendingConnection: null,
      contextMenu: null,
      customNodeDefs: {},
      executionStates: {},
      nodeOutputs: {},
      executionErrors: {},
      isExecuting: false,
      validationErrors: {},
    });
  });
}

/** Write upstream outputs directly — the hook reads nodes/connections/nodeOutputs,
 *  so tests don't need the full execution machinery (whose completion timers
 *  don't fire under fake timers). */
function setOutputs(outputs: Record<string, Record<number, unknown>>) {
  useEditorStore.setState((s) => {
    s.nodeOutputs = { ...s.nodeOutputs, ...outputs };
  });
}

describe('useHttpFetchAutoDispatch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
    fetchSpy = vi.fn(() =>
      Promise.resolve({
        headers: { get: () => 'application/json' },
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function buildFetchGraph() {
    const src = getState().addNode('source', [0, 0, 0]);
    const fetchNode = getState().addNode('http-fetch', [3, 0, 0]);
    getState().updateNodeData(src, 'label', 'https://example.com/api');
    getState().addConnection(src, 1, fetchNode, 0); // label (string) → url
    return { src, fetchNode };
  }

  it('dispatches a fetch when the url input resolves after the initial scan', () => {
    const { unmount } = renderHook(() => useHttpFetchAutoDispatch());

    const { src } = buildFetchGraph();
    setOutputs({ [src]: { 0: 1, 1: 'https://example.com/api' } });

    vi.advanceTimersByTime(100); // debounce
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/api');
    unmount();
  });

  it('does not dispatch for graphs already present at mount (initial batch skipped)', () => {
    const { src } = buildFetchGraph();
    setOutputs({ [src]: { 0: 1, 1: 'https://example.com/api' } });

    const { unmount } = renderHook(() => useHttpFetchAutoDispatch());
    vi.advanceTimersByTime(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('does not dispatch when a wired trigger is falsy, then fires when it flips truthy', () => {
    const { unmount } = renderHook(() => useHttpFetchAutoDispatch());

    const { src, fetchNode } = buildFetchGraph();
    const gate = getState().addNode('source', [0, 0, 3]);
    getState().addConnection(gate, 0, fetchNode, 1);

    setOutputs({
      [src]: { 0: 1, 1: 'https://example.com/api' },
      [gate]: { 0: 0, 1: 'Source' },
    });
    vi.advanceTimersByTime(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    setOutputs({ [gate]: { 0: 1, 1: 'Source' } });
    vi.advanceTimersByTime(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('respects the per-node cooldown for rapid trigger changes', () => {
    const { unmount } = renderHook(() => useHttpFetchAutoDispatch());

    const { src, fetchNode } = buildFetchGraph();
    const tick = getState().addNode('source', [0, 0, 3]);
    getState().addConnection(tick, 0, fetchNode, 1);

    setOutputs({
      [src]: { 0: 1, 1: 'https://example.com/api' },
      [tick]: { 0: 1, 1: 'Source' },
    });
    vi.advanceTimersByTime(100);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Rapid trigger change within the cooldown window → no second dispatch
    setOutputs({ [tick]: { 0: 2, 1: 'Source' } });
    vi.advanceTimersByTime(100);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // After the cooldown expires, the next change dispatches again
    vi.advanceTimersByTime(1000);
    setOutputs({ [tick]: { 0: 3, 1: 'Source' } });
    vi.advanceTimersByTime(100);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    unmount();
  });
});

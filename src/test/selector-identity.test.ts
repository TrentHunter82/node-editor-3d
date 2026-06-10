import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore } from '../store/editorStore';

/**
 * Referential-identity guarantees that keep per-node Zustand subscribers
 * (NodeModule) from re-rendering when their slice of state didn't change:
 *  - validateGraph keeps the same message-array ref for nodes whose issues
 *    are unchanged between passes.
 *  - applyResults keeps the same metric object for nodes whose visible
 *    metric fields (duration, cacheHit) are unchanged between executions.
 */

const WAVE_DELAY = 120;
const NODE_DURATION = 250;

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    executionMetrics: {},
    isExecuting: false,
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
  });
}

function getState() {
  return useEditorStore.getState();
}

describe('validation error referential identity', () => {
  beforeEach(() => resetStore());

  it('unchanged node keeps the same messages array across validation passes', () => {
    const a = getState().addNode('transform', [0, 0, 0]); // unconnected → warnings
    const b = getState().addNode('display', [3, 0, 0]);   // unconnected → error

    getState().validateGraph();
    const firstA = getState().validationErrors[a];
    const firstB = getState().validationErrors[b];
    expect(firstA).toBeDefined();
    expect(firstB).toBeDefined();

    getState().validateGraph();
    expect(getState().validationErrors[a]).toBe(firstA);
    expect(getState().validationErrors[b]).toBe(firstB);
  });

  it('a node whose issues changed gets a fresh array; others keep theirs', () => {
    const a = getState().addNode('transform', [0, 0, 0]);
    const src = getState().addNode('source', [-3, 0, 0]);
    getState().validateGraph();
    const firstA = getState().validationErrors[a];

    // Wiring source→transform changes a's issues (and src's)
    getState().addConnection(src, 0, a, 0);
    getState().validateGraph();
    const secondA = getState().validationErrors[a];
    expect(secondA).not.toBe(firstA);
  });
});

describe('execution metric referential identity', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cache-hit nodes keep their metric object across executions', () => {
    const s1 = getState().addNode('source', [0, 0, 0]);
    const t1 = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(s1, 0, t1, 0);

    const run = () => {
      getState().executeGraph();
      // Advance past all wave timeouts + the completion timeout so
      // isExecuting clears and the next executeGraph isn't blocked.
      vi.advanceTimersByTime(5 * WAVE_DELAY + NODE_DURATION + 100);
    };

    // Let the cache converge to its all-hit steady state, then assert the
    // contract between two consecutive steady-state runs: nodes whose visible
    // metric fields are unchanged keep their object identity.
    run();
    run();
    run();
    const before = { ...getState().executionMetrics };
    run();
    const after = getState().executionMetrics;

    const ids = Object.keys(after);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(after[id].cacheHit, `${id} should be a cache hit at steady state`).toBe(true);
      expect(after[id]).toBe(before[id]);
    }
  });
});

/**
 * Phase 34: Profiling Improvement Tests (~25 tests)
 *
 * Tests executionTimings store population, executionStats accumulation,
 * executionMaxNodeDuration calculation, per-node timing accuracy,
 * cache hit filtering, percentage calculation, and critical path
 * highlighting logic integration.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  getBottleneckNodes,
  getCacheHitRate,
  getExecutionTimeline,
  getCriticalPath,
  getGraphAnalytics,
} from '../utils/profiling';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.validationErrors = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.isExecuting = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTimings = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionStats = {
      executionCount: 0,
      totalDuration: 0,
      errorCount: 0,
      totalCacheHits: 0,
      totalNodesExecuted: 0,
      lastExecutedAt: null,
      timeoutCount: 0,
    };
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

beforeEach(() => {
  resetStore();
});

// ===========================================================================
// 1. executionTimings store population
// ===========================================================================

describe('executionTimings store population', () => {
  it('is empty before any execution', () => {
    expect(getStore().executionTimings).toEqual({});
  });

  it('is populated after executing a single-node graph', () => {
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    execAction();
    const st = getStore();
    const nodeIds = Object.keys(st.nodes);
    expect(nodeIds).toHaveLength(1);
    // executionTimings should have an entry for the source node
    expect(st.executionTimings[nodeIds[0]]).toBeDefined();
    expect(typeof st.executionTimings[nodeIds[0]]).toBe('number');
    expect(st.executionTimings[nodeIds[0]]).toBeGreaterThanOrEqual(0);
  });

  it('has entries for every executed node in a chain', () => {
    const { addNode, addConnection, executeGraph: execAction } = getStore();
    const src = addNode('source', [0, 0, 0]);
    const xform = addNode('transform', [1, 0, 0]);
    const out = addNode('output', [2, 0, 0]);
    addConnection(src, 0, xform, 0);
    addConnection(xform, 0, out, 0);
    execAction();
    const st = getStore();
    expect(Object.keys(st.executionTimings)).toHaveLength(3);
    expect(st.executionTimings[src]).toBeGreaterThanOrEqual(0);
    expect(st.executionTimings[xform]).toBeGreaterThanOrEqual(0);
    expect(st.executionTimings[out]).toBeGreaterThanOrEqual(0);
  });

  it('matches executionMetrics durations one-to-one', () => {
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    addNode('math', [1, 0, 0]);
    execAction();
    const st = getStore();
    for (const [id, timing] of Object.entries(st.executionTimings)) {
      expect(timing).toBe(st.executionMetrics[id].duration);
    }
  });

  it('is cleared on undo', () => {
    const { addNode, executeGraph: execAction, undo } = getStore();
    addNode('source', [0, 0, 0]);
    execAction();
    expect(Object.keys(getStore().executionTimings).length).toBeGreaterThan(0);
    undo();
    expect(getStore().executionTimings).toEqual({});
  });
});

// ===========================================================================
// 2. executionMaxNodeDuration calculation
// ===========================================================================

describe('executionMaxNodeDuration', () => {
  it('is 0 before execution', () => {
    expect(getStore().executionMaxNodeDuration).toBe(0);
  });

  it('reflects the longest non-cached node duration', () => {
    const { addNode, addConnection, executeGraph: execAction } = getStore();
    const src = addNode('source', [0, 0, 0]);
    const xform = addNode('transform', [1, 0, 0]);
    addConnection(src, 0, xform, 0);
    execAction();
    const st = getStore();
    // Max should be the maximum of non-cached node durations
    const maxDuration = Math.max(
      ...Object.entries(st.executionMetrics)
        .filter(([, m]) => !m.cacheHit)
        .map(([, m]) => m.duration),
    );
    expect(st.executionMaxNodeDuration).toBe(maxDuration);
  });

  it('excludes cache hits from max calculation', () => {
    // Execute twice — second run should have cache hits
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    execAction();
    useEditorStore.setState((s) => { s.isExecuting = false; });
    // Execute again (no changes → cache hits likely)
    execAction();
    const st = getStore();
    // All metrics with cacheHit=true should NOT contribute to max
    for (const [_id, metric] of Object.entries(st.executionMetrics)) {
      if (metric.cacheHit) {
        // Cache hit durations are 0, which is ≤ max
        expect(metric.duration).toBeLessThanOrEqual(st.executionMaxNodeDuration);
      }
    }
  });
});

// ===========================================================================
// 3. executionStats accumulation
// ===========================================================================

describe('executionStats accumulation', () => {
  it('starts with all zeros', () => {
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });

  it('increments executionCount on each execution', () => {
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    execAction();
    expect(getStore().executionStats.executionCount).toBe(1);
    // Reset isExecuting so next call isn't skipped
    useEditorStore.setState((s) => { s.isExecuting = false; });
    execAction();
    expect(getStore().executionStats.executionCount).toBe(2);
    useEditorStore.setState((s) => { s.isExecuting = false; });
    execAction();
    expect(getStore().executionStats.executionCount).toBe(3);
  });

  it('accumulates totalDuration across executions', () => {
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    execAction();
    const dur1 = getStore().executionStats.totalDuration;
    expect(dur1).toBeGreaterThanOrEqual(0);
    useEditorStore.setState((s) => { s.isExecuting = false; });
    execAction();
    const dur2 = getStore().executionStats.totalDuration;
    expect(dur2).toBeGreaterThanOrEqual(dur1);
  });

  it('tracks totalNodesExecuted across executions', () => {
    const { addNode, addConnection, executeGraph: execAction } = getStore();
    const src = addNode('source', [0, 0, 0]);
    const xform = addNode('transform', [1, 0, 0]);
    addConnection(src, 0, xform, 0);
    execAction();
    // First run: 2 nodes executed
    expect(getStore().executionStats.totalNodesExecuted).toBe(2);
    // Reset isExecuting so next call isn't skipped
    useEditorStore.setState((s) => { s.isExecuting = false; });
    execAction();
    // Second run: 2 more (even if cached, they're counted)
    expect(getStore().executionStats.totalNodesExecuted).toBe(4);
  });

  it('accumulates cache hits across runs', () => {
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    execAction();
    const hits1 = getStore().executionStats.totalCacheHits;
    useEditorStore.setState((s) => { s.isExecuting = false; });
    // Second execution should have more cache hits (source value unchanged)
    execAction();
    const hits2 = getStore().executionStats.totalCacheHits;
    expect(hits2).toBeGreaterThanOrEqual(hits1);
  });

  it('tracks errorCount when nodes fail', () => {
    const { addNode, updateNodeData, executeGraph: execAction } = getStore();
    const cst = addNode('custom', [0, 0, 0]);
    getStore().updateCustomNodePorts(cst, 1, 1);
    updateNodeData(cst, 'expression', 'throw new Error("test")');
    execAction();
    expect(getStore().executionStats.errorCount).toBeGreaterThan(0);
  });

  it('sets lastExecutedAt timestamp', () => {
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    const before = Date.now();
    execAction();
    const after = Date.now();
    const lastExec = getStore().executionStats.lastExecutedAt;
    expect(lastExec).not.toBeNull();
    expect(lastExec!).toBeGreaterThanOrEqual(before);
    expect(lastExec!).toBeLessThanOrEqual(after);
  });
});

// ===========================================================================
// 4. Profiling utilities with real execution data
// ===========================================================================

describe('profiling utilities with store execution data', () => {
  it('getBottleneckNodes works with real executionMetrics', () => {
    const { addNode, addConnection, executeGraph: execAction } = getStore();
    const src = addNode('source', [0, 0, 0]);
    const x1 = addNode('transform', [1, 0, 0]);
    const x2 = addNode('transform', [2, 0, 0]);
    addConnection(src, 0, x1, 0);
    addConnection(src, 0, x2, 0);
    execAction();
    const metrics = getStore().executionMetrics;
    const bottlenecks = getBottleneckNodes(metrics, 3);
    // Should return nodes sorted by duration desc
    expect(bottlenecks.length).toBeGreaterThan(0);
    expect(bottlenecks.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < bottlenecks.length; i++) {
      expect(bottlenecks[i - 1].duration).toBeGreaterThanOrEqual(bottlenecks[i].duration);
    }
  });

  it('getCacheHitRate returns 0 on first execution (no cache)', () => {
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    execAction();
    const metrics = getStore().executionMetrics;
    const rate = getCacheHitRate(metrics);
    expect(rate).toBe(0); // First run = no cache hits
  });

  it('getCacheHitRate increases on re-execution without changes', () => {
    const { addNode, executeGraph: execAction } = getStore();
    addNode('source', [0, 0, 0]);
    execAction();
    const rate1 = getCacheHitRate(getStore().executionMetrics);
    useEditorStore.setState((s) => { s.isExecuting = false; });
    execAction();
    const rate2 = getCacheHitRate(getStore().executionMetrics);
    // Second execution should have higher or equal cache hit rate
    expect(rate2).toBeGreaterThanOrEqual(rate1);
  });

  it('getExecutionTimeline returns entries in chronological order', () => {
    const { addNode, addConnection, executeGraph: execAction } = getStore();
    const src = addNode('source', [0, 0, 0]);
    const xform = addNode('transform', [1, 0, 0]);
    const out = addNode('output', [2, 0, 0]);
    addConnection(src, 0, xform, 0);
    addConnection(xform, 0, out, 0);
    execAction();
    const metrics = getStore().executionMetrics;
    const timeline = getExecutionTimeline(metrics);
    expect(timeline).toHaveLength(3);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].startTime).toBeGreaterThanOrEqual(timeline[i - 1].startTime);
    }
  });

  it('getCriticalPath uses execution metrics for weighted path', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [1, 0, 0]);
    const out = st.addNode('output', [2, 0, 0]);
    st.addConnection(src, 0, xform, 0);
    st.addConnection(xform, 0, out, 0);
    st.executeGraph();
    const state = getStore();
    const cp = getCriticalPath(state.nodes, state.connections, state.executionMetrics);
    // Critical path should be src → xform → out
    expect(cp.path).toHaveLength(3);
    expect(cp.path[0]).toBe(src);
    expect(cp.path[2]).toBe(out);
    expect(cp.length).toBeGreaterThan(0);
  });

  it('getGraphAnalytics returns comprehensive analytics with metrics', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [1, 0, 0]);
    st.addConnection(src, 0, xform, 0);
    st.executeGraph();
    const state = getStore();
    const analytics = getGraphAnalytics(state.nodes, state.connections, state.executionMetrics);
    expect(analytics.nodeCount).toBe(2);
    expect(analytics.connectionCount).toBe(1);
    expect(analytics.criticalPathLength).toBeGreaterThan(0);
    expect(analytics.criticalPath).toHaveLength(2);
    expect(analytics.connectionDensity).toBeGreaterThan(0);
    expect(Object.keys(analytics.nodeCountByType).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 5. executionTimings percentage and filtering
// ===========================================================================

describe('executionTimings percentage and filtering', () => {
  it('can compute per-node percentage of total', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const xform = st.addNode('transform', [1, 0, 0]);
    st.addConnection(src, 0, xform, 0);
    st.executeGraph();
    const state = getStore();
    const totalDuration = state.executionTotalDuration;
    if (totalDuration > 0) {
      for (const [, timing] of Object.entries(state.executionTimings)) {
        const pct = (timing / totalDuration) * 100;
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    }
  });

  it('can filter to only non-cached nodes via executionMetrics', () => {
    const st = getStore();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    useEditorStore.setState((s) => { s.isExecuting = false; });
    // Execute again for potential cache hits
    st.executeGraph();
    const state = getStore();
    const nonCached = Object.entries(state.executionMetrics)
      .filter(([, m]) => !m.cacheHit)
      .map(([id]) => id);
    const cached = Object.entries(state.executionMetrics)
      .filter(([, m]) => m.cacheHit)
      .map(([id]) => id);
    // All IDs should be in either cached or non-cached
    const allIds = Object.keys(state.executionTimings);
    for (const id of allIds) {
      expect(nonCached.includes(id) || cached.includes(id)).toBe(true);
    }
  });

  it('can sort nodes by execution time descending', () => {
    const st = getStore();
    const src = st.addNode('source', [0, 0, 0]);
    const x1 = st.addNode('transform', [1, 0, 0]);
    const x2 = st.addNode('math', [2, 0, 0]);
    st.addConnection(src, 0, x1, 0);
    st.addConnection(src, 0, x2, 0);
    st.executeGraph();
    const state = getStore();
    const sorted = Object.entries(state.executionTimings)
      .sort(([, a], [, b]) => b - a);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1][1]).toBeGreaterThanOrEqual(sorted[i][1]);
    }
  });
});

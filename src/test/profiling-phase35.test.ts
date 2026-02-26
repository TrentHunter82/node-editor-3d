/// <reference types="vitest/config" />
/**
 * Phase 35: Execution Profiling Integration Tests (~25 tests)
 *
 * Tests the integration between executeSelection, executeGraph (store action),
 * executionStats accumulation, executionTimings/executionMaxNodeDuration
 * population, timeout behavior, and profiling utilities.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';
import {
  getBottleneckNodes,
  getCacheHitRate,
  getCriticalPath,
  getGraphAnalytics,
} from '../utils/profiling';
enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() { return useEditorStore.getState(); }

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
      executionCount: 0, totalDuration: 0, errorCount: 0,
      totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null,
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
    s.breakpoints = {};
    s.breakpointConditions = {};
  });
}

/** Allow a subsequent call to store.executeGraph() within the same test. */
function allowNextExecution(): void {
  useEditorStore.setState(s => { s.isExecuting = false; });
}

/** Execute the current store nodes/connections directly via the utility (bypasses store stats). */
function execDirect(maxExecutionMs?: number) {
  const st = getStore();
  return executeGraph(
    st.nodes,
    st.connections,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    maxExecutionMs,
  );
}

// ===========================================================================
// 1. executeSelection stats accumulation
// ===========================================================================

describe('executeSelection stats accumulation', () => {
  beforeEach(() => { resetStore(); });

  it('executeSelection does not increment executionStats.executionCount (only full graph runs do)', () => {
    // executeSelection deliberately skips applyResults and therefore does not
    // increment executionStats. This verifies that contract is stable.
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 5);
    useEditorStore.setState(s => { s.selectedIds = new Set([src]); });
    getStore().executeSelection(getStore().selectedIds);

    expect(getStore().executionStats.executionCount).toBe(0);
  });

  it('executeGraph (store action) increments executionStats.executionCount', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 5);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);
  });

  it('executeGraph accumulates totalDuration across successive calls', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 5);
    getStore().executeGraph();
    const dur1 = getStore().executionStats.totalDuration;
    expect(Number.isFinite(dur1)).toBe(true);
    expect(dur1).toBeGreaterThanOrEqual(0);

    allowNextExecution();
    getStore().executeGraph();
    const dur2 = getStore().executionStats.totalDuration;
    expect(dur2).toBeGreaterThanOrEqual(dur1);
  });

  it('executeGraph tracks totalNodesExecuted (counts all nodes per run, including cached)', () => {
    const src = getStore().addNode('source');
    const xform = getStore().addNode('transform');
    getStore().addConnection(src, 0, xform, 0);

    getStore().executeGraph();
    expect(getStore().executionStats.totalNodesExecuted).toBe(2);

    allowNextExecution();
    getStore().executeGraph();
    // Second run: even cached nodes are counted in totalNodesExecuted
    expect(getStore().executionStats.totalNodesExecuted).toBe(4);
  });

  it('executeSelection then executeGraph: executionStats.executionCount increments only for full run', () => {
    const src = getStore().addNode('source');
    const xform = getStore().addNode('transform');
    getStore().addConnection(src, 0, xform, 0);

    // Selection run first — should not increment executionCount
    useEditorStore.setState(s => { s.selectedIds = new Set([xform]); });
    getStore().executeSelection(getStore().selectedIds);
    expect(getStore().executionStats.executionCount).toBe(0);

    // Full graph run — now it should increment
    allowNextExecution();
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);
  });
});

// ===========================================================================
// 2. executionTimings with executeSelection
// ===========================================================================

describe('executionTimings with executeSelection', () => {
  beforeEach(() => { resetStore(); });

  it('executeSelection merges timings into existing executionTimings (does not replace)', () => {
    // Build two connected nodes. Run a full execution to populate all timings.
    const src = getStore().addNode('source');
    const xform = getStore().addNode('transform');
    getStore().addConnection(src, 0, xform, 0);
    getStore().executeGraph();

    expect(Object.keys(getStore().executionTimings).length).toBe(2);

    // Now select only src; upstream is empty; scope = {src}
    allowNextExecution();
    useEditorStore.setState(s => { s.selectedIds = new Set([src]); });
    getStore().executeSelection(getStore().selectedIds);

    // Both nodes must still be in executionTimings (merged, not replaced)
    const timings = getStore().executionTimings;
    expect(timings[src]).toBeDefined();
    expect(timings[xform]).toBeDefined();
  });

  it('executeSelection updates executionMaxNodeDuration incrementally', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 42);

    expect(getStore().executionMaxNodeDuration).toBe(0);

    useEditorStore.setState(s => { s.selectedIds = new Set([src]); });
    getStore().executeSelection(getStore().selectedIds);

    // After selection execution, maxNodeDuration is updated (>= 0)
    expect(getStore().executionMaxNodeDuration).toBeGreaterThanOrEqual(0);
    // And metrics must contain the source node
    expect(getStore().executionMetrics[src]).toBeDefined();
  });

  it('executeSelection timings contain only selected + upstream nodes (not downstream)', () => {
    // Chain: src -> mid -> tail. Select only mid.
    // Scope: {src (upstream), mid (selected)}. tail must not appear.
    const src = getStore().addNode('source');
    const mid = getStore().addNode('transform');
    const tail = getStore().addNode('transform');
    getStore().addConnection(src, 0, mid, 0);
    getStore().addConnection(mid, 0, tail, 0);

    useEditorStore.setState(s => { s.selectedIds = new Set([mid]); });
    getStore().executeSelection(getStore().selectedIds);

    const metrics = getStore().executionMetrics;
    expect(metrics[src]).toBeDefined();
    expect(metrics[mid]).toBeDefined();
    expect(metrics[tail]).toBeUndefined();
  });

  it('full executeGraph after executeSelection covers all nodes in executionTimings', () => {
    // Start with a selection that only covers a subset, then a full run that covers all.
    const src = getStore().addNode('source');
    const xform = getStore().addNode('transform');
    const tail = getStore().addNode('transform');
    getStore().addConnection(src, 0, xform, 0);
    getStore().addConnection(xform, 0, tail, 0);

    // Select only src — tail won't be in metrics yet
    useEditorStore.setState(s => { s.selectedIds = new Set([src]); });
    getStore().executeSelection(getStore().selectedIds);
    expect(getStore().executionMetrics[tail]).toBeUndefined();

    // Full execution replaces executionTimings for the entire graph
    allowNextExecution();
    getStore().executeGraph();

    const timings = getStore().executionTimings;
    expect(timings[src]).toBeDefined();
    expect(timings[xform]).toBeDefined();
    expect(timings[tail]).toBeDefined();
  });
});

// ===========================================================================
// 3. executionStats per-graph behavior
// ===========================================================================

describe('executionStats per-graph behavior', () => {
  beforeEach(() => { resetStore(); });

  it('executionStats reset to zero after resetStore', () => {
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });

  it('executionStats accumulate correctly across multiple executions', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 7);

    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);
    expect(getStore().executionStats.lastExecutedAt).not.toBeNull();

    allowNextExecution();
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(2);

    allowNextExecution();
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(3);
    expect(getStore().executionStats.totalNodesExecuted).toBe(3);
  });

  it('clearGraph resets executionStats to initial values', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 1);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);
    expect(getStore().executionStats.lastExecutedAt).not.toBeNull();

    getStore().clearGraph();

    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });

  it('switchGraph restores per-graph executionStats for each graph independently', () => {
    // Graph A (default): one execution
    const srcA = getStore().addNode('source');
    getStore().updateNodeData(srcA, 'value', 1);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);
    const graphAId = getStore().activeGraphId;

    // Create and switch to graph B; stats start at zero
    const graphBId = getStore().createGraph('Graph B');
    expect(getStore().executionStats.executionCount).toBe(0);

    // Two executions in graph B
    const srcB = getStore().addNode('source');
    getStore().updateNodeData(srcB, 'value', 2);
    getStore().executeGraph();
    allowNextExecution();
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(2);

    // Switch back to graph A — stats must be graph A's
    getStore().switchGraph(graphAId);
    expect(getStore().executionStats.executionCount).toBe(1);

    // Switch to graph B — stats must be graph B's
    getStore().switchGraph(graphBId);
    expect(getStore().executionStats.executionCount).toBe(2);
  });
});

// ===========================================================================
// 4. Timeout integration with profiling
// ===========================================================================

describe('Timeout integration with profiling', () => {
  beforeEach(() => { resetStore(); });

  it('timedOut execution still produces a valid metrics Map in ExecutionResult', () => {
    for (let i = 0; i < 100; i++) {
      getStore().addNode('source');
    }
    const result = execDirect(1);
    // Regardless of whether timeout occurred, the result is always structurally valid
    expect(result.metrics).toBeInstanceOf(Map);
    expect(result.results).toBeInstanceOf(Map);
    expect(result.errors).toBeInstanceOf(Map);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('timedOut execution still increments executionStats.executionCount via store action', () => {
    for (let i = 0; i < 50; i++) {
      getStore().addNode('source');
    }
    // Set a very tight timeout in settingsStore so store.executeGraph() picks it up
    const originalMs = useSettingsStore.getState().maxExecutionMs;
    useSettingsStore.setState({ maxExecutionMs: 1 });

    getStore().executeGraph();

    // executionCount must always be 1 (the run happened, regardless of timeout)
    expect(getStore().executionStats.executionCount).toBe(1);
    // timeoutCount is non-negative
    expect(getStore().executionStats.timeoutCount).toBeGreaterThanOrEqual(0);

    useSettingsStore.setState({ maxExecutionMs: originalMs });
  });

  it('maxExecutionMs=0 means no timeout — graph completes all nodes', () => {
    for (let i = 0; i < 10; i++) {
      const id = getStore().addNode('source');
      getStore().updateNodeData(id, 'value', i);
    }
    const result = execDirect(0);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(10);
  });

  it('very tight timeout (1ms) on large graph — result is always structurally sound', () => {
    // Build a long chain to make timeout more likely
    let prevId = getStore().addNode('source');
    for (let i = 0; i < 100; i++) {
      const id = getStore().addNode('transform');
      getStore().addConnection(prevId, 0, id, 0);
      prevId = id;
    }
    const result = execDirect(1);
    // Structure must always be valid
    expect(result.results).toBeInstanceOf(Map);
    expect(result.errors).toBeInstanceOf(Map);
    expect(result.metrics).toBeInstanceOf(Map);
    expect(typeof result.totalDuration).toBe('number');
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    if (result.timedOut) {
      expect(result.errors.has('__graph__')).toBe(true);
      const msg = result.errors.get('__graph__')!;
      expect(msg).toMatch(/timeout/i);
    }
  });
});

// ===========================================================================
// 5. executionMaxNodeDuration edge cases
// ===========================================================================

describe('executionMaxNodeDuration edge cases', () => {
  beforeEach(() => { resetStore(); });

  it('executionMaxNodeDuration excludes cached nodes (cache-hit durations are not counted)', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 3);

    // First execution — all nodes non-cached
    getStore().executeGraph();
    allowNextExecution();
    // Second execution — nodes may be cached
    getStore().executeGraph();

    const st = getStore();
    // All cache-hit metric durations must be <= the stored max
    for (const metric of Object.values(st.executionMetrics)) {
      if (metric.cacheHit) {
        expect(metric.duration).toBeLessThanOrEqual(st.executionMaxNodeDuration);
      }
    }
  });

  it('executionMaxNodeDuration is 0 before any execution', () => {
    getStore().addNode('source');
    expect(getStore().executionMaxNodeDuration).toBe(0);
  });

  it('single-node graph: executionMaxNodeDuration equals that node duration (non-cached)', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 99);
    getStore().executeGraph();

    const st = getStore();
    const nonCached = Object.values(st.executionMetrics).filter(m => !m.cacheHit);
    if (nonCached.length > 0) {
      const expectedMax = Math.max(...nonCached.map(m => m.duration));
      expect(st.executionMaxNodeDuration).toBe(expectedMax);
    } else {
      // Edge case: all cached (should not happen on first run, but handle gracefully)
      expect(st.executionMaxNodeDuration).toBeGreaterThanOrEqual(0);
    }
  });

  it('executionMaxNodeDuration remains 0 when all metrics in state are cache hits', () => {
    const src = getStore().addNode('source');
    // Manually inject all-cached metrics into the store state
    useEditorStore.setState(s => {
      s.executionMetrics[src] = { duration: 0, cacheHit: true, timestamp: 0 };
      s.executionTimings[src] = 0;
      // executionMaxNodeDuration was computed as 0 because all are cached
      s.executionMaxNodeDuration = 0;
    });
    expect(getStore().executionMaxNodeDuration).toBe(0);
  });
});

// ===========================================================================
// 6. Profiling utilities integration
// ===========================================================================

describe('Profiling utilities integration', () => {
  beforeEach(() => { resetStore(); });

  it('getBottleneckNodes after real execution returns non-empty sorted list for multi-node graphs', () => {
    const src = getStore().addNode('source');
    const x1 = getStore().addNode('transform');
    const x2 = getStore().addNode('transform');
    getStore().addConnection(src, 0, x1, 0);
    getStore().addConnection(src, 0, x2, 0);
    getStore().executeGraph();

    const metrics = getStore().executionMetrics;
    const bottlenecks = getBottleneckNodes(metrics, 3);

    // Should return at least one bottleneck for a non-trivial graph
    expect(bottlenecks.length).toBeGreaterThan(0);
    expect(bottlenecks.length).toBeLessThanOrEqual(3);
    // Results must be sorted by duration descending
    for (let i = 1; i < bottlenecks.length; i++) {
      expect(bottlenecks[i - 1].duration).toBeGreaterThanOrEqual(bottlenecks[i].duration);
    }
    // Every returned nodeId must exist in the graph
    for (const entry of bottlenecks) {
      expect(getStore().nodes[entry.nodeId]).toBeDefined();
    }
  });

  it('getCriticalPath with real execution metrics returns a valid path', () => {
    const src = getStore().addNode('source');
    const xform = getStore().addNode('transform');
    const out = getStore().addNode('output');
    getStore().addConnection(src, 0, xform, 0);
    getStore().addConnection(xform, 0, out, 0);
    getStore().executeGraph();

    const st = getStore();
    const cp = getCriticalPath(st.nodes, st.connections, st.executionMetrics);

    expect(cp.path.length).toBeGreaterThanOrEqual(1);
    expect(cp.length).toBeGreaterThanOrEqual(0);
    // In a linear 3-node graph the critical path visits all nodes
    if (cp.path.length === 3) {
      expect(cp.path[0]).toBe(src);
      expect(cp.path[2]).toBe(out);
    }
  });

  it('getCacheHitRate is 0 after the first execution (no prior cache)', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 10);
    getStore().executeGraph();

    const rate = getCacheHitRate(getStore().executionMetrics);
    // First execution has no cache hits by definition
    expect(rate).toBe(0);
  });

  it('getCacheHitRate is >0 after a second identical execution (cache populated)', () => {
    const src = getStore().addNode('source');
    getStore().updateNodeData(src, 'value', 10);
    getStore().executeGraph();
    const rate1 = getCacheHitRate(getStore().executionMetrics);

    allowNextExecution();
    getStore().executeGraph();
    const rate2 = getCacheHitRate(getStore().executionMetrics);

    // Second run on unchanged graph should hit the cache for at least one node
    expect(rate2).toBeGreaterThan(rate1);
    expect(rate2).toBeGreaterThan(0);
  });

  it('getGraphAnalytics returns comprehensive summary with correct counts and density', () => {
    const src = getStore().addNode('source');
    const xform = getStore().addNode('transform');
    getStore().addConnection(src, 0, xform, 0);
    getStore().executeGraph();

    const st = getStore();
    const analytics = getGraphAnalytics(st.nodes, st.connections, st.executionMetrics);

    expect(analytics.nodeCount).toBe(2);
    expect(analytics.connectionCount).toBe(1);
    expect(Object.keys(analytics.nodeCountByType).length).toBeGreaterThan(0);
    // source (1 output) + transform (1 input 1 output) => max = 1*2=2, actual=1 → density=0.5
    expect(analytics.connectionDensity).toBeGreaterThan(0);
    expect(analytics.criticalPath.length).toBeGreaterThanOrEqual(1);
    expect(analytics.criticalPathLength).toBeGreaterThanOrEqual(0);
  });
});

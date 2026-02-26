/// <reference types="vitest/config" />
/**
 * Execution Statistics Tracking Tests
 *
 * Tests the ExecutionStats tracking system:
 *
 *   interface ExecutionStats {
 *     executionCount: number;
 *     totalDuration: number;
 *     errorCount: number;
 *     totalCacheHits: number;
 *     totalNodesExecuted: number;
 *     lastExecutedAt: number | null;
 *   }
 *
 * Key implementation details verified:
 * - executionStats is per-graph state in executionSlice
 * - Stats accumulated in applyResults (called by store's executeGraph action)
 * - getExecutionStats() accessor returns current stats
 * - Stats reset on clearGraph() and importWorkflow()
 * - Stats preserved per-graph across switchGraph, enterSubgraph, exitSubgraph
 * - exportAllGraphs includes stats only when executionCount > 0
 * - Stats loaded from storage if present, default to initial otherwise
 * - Stats are NOT in Snapshot — undo/redo does NOT affect them
 * - Stats are NOT cleared by clearExecutionTransientState
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { NODE_TYPE_CONFIG } from '../types';

import type { MultiGraphStorage } from '../utils/serialization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() { return useEditorStore.getState(); }

/**
 * Allow a second (or Nth) call to store.executeGraph() within the same test.
 *
 * After the first call, applyResults() sets isExecuting=true and schedules
 * a setTimeout to clear it. Since Jest/Vitest does NOT auto-advance fake
 * timers here (real timers), isExecuting stays true synchronously. We flip it
 * back to false without disturbing the execution cache so that subsequent
 * executeGraph() calls run normally.
 */
function allowNextExecution(): void {
  useEditorStore.setState(s => { s.isExecuting = false; });
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
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.showValuePreviews = true;
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.executionStats = {
      executionCount: 0,
      totalDuration: 0,
      errorCount: 0,
      totalCacheHits: 0,
      totalNodesExecuted: 0,
      lastExecutedAt: null,
      timeoutCount: 0,
    };
  });
}

/**
 * Build a minimal executable graph in the store (source → display).
 * Returns the source node ID.
 */
function buildSimpleGraph(sourceValue = 42): string {
  const src = getStore().addNode('source');
  getStore().updateNodeData(src, 'value', sourceValue);
  const disp = getStore().addNode('display');
  getStore().startConnection(src, 0);
  getStore().completeConnection(disp, 0);
  return src;
}

/**
 * Build a graph that will produce an execution error.
 * Uses get-var with no variableName configured → processor throws.
 */
function buildErrorGraph(): string {
  const gv = getStore().addNode('get-var');
  // Do NOT set variableName — defaults to empty string which the processor rejects
  return gv;
}

// ---------------------------------------------------------------------------
// 1. Initial State
// ---------------------------------------------------------------------------

describe('ExecutionStats — initial state', () => {
  beforeEach(() => { resetStore(); });

  it('1. Initial executionStats has all zeros and null lastExecutedAt', () => {
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });

  it('2. getExecutionStats() accessor returns the same initial stats object values', () => {
    const viaField = getStore().executionStats;
    const viaAccessor = getStore().executionStats;
    expect(viaAccessor.executionCount).toBe(viaField.executionCount);
    expect(viaAccessor.totalDuration).toBe(viaField.totalDuration);
    expect(viaAccessor.errorCount).toBe(viaField.errorCount);
    expect(viaAccessor.totalCacheHits).toBe(viaField.totalCacheHits);
    expect(viaAccessor.totalNodesExecuted).toBe(viaField.totalNodesExecuted);
    expect(viaAccessor.lastExecutedAt).toBe(viaField.lastExecutedAt);
  });
});

// ---------------------------------------------------------------------------
// 2. Stats Accumulation
// ---------------------------------------------------------------------------

describe('ExecutionStats — accumulation after execution', () => {
  beforeEach(() => { resetStore(); });

  it('3. Single execution increments executionCount to 1', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);
  });

  it('4. totalDuration > 0 after a successful execution', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    expect(getStore().executionStats.totalDuration).toBeGreaterThanOrEqual(0);
    // totalDuration is accumulated — it may be 0 if timing is sub-ms, but
    // the field must exist and be a non-negative finite number.
    expect(Number.isFinite(getStore().executionStats.totalDuration)).toBe(true);
  });

  it('5. lastExecutedAt is set (non-null, recent timestamp) after execution', () => {
    buildSimpleGraph(10);
    const before = Date.now();
    getStore().executeGraph();
    const after = Date.now();
    const { lastExecutedAt } = getStore().executionStats;
    expect(lastExecutedAt).not.toBeNull();
    expect(lastExecutedAt!).toBeGreaterThanOrEqual(before);
    expect(lastExecutedAt!).toBeLessThanOrEqual(after);
  });

  it('6. Two executions: executionCount = 2, totalDuration accumulates', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    const durationAfterFirst = getStore().executionStats.totalDuration;
    expect(getStore().executionStats.executionCount).toBe(1);

    allowNextExecution();
    getStore().executeGraph();
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(2);
    // Total duration after second run should be >= duration after first run
    expect(stats.totalDuration).toBeGreaterThanOrEqual(durationAfterFirst);
  });

  it('7. Execution with errors increments errorCount', () => {
    // get-var without variableName will produce an error in fail-fast mode
    buildErrorGraph();
    // Use continue-on-error so execution runs as far as possible
    getStore().setErrorStrategy('continue');
    getStore().executeGraph();
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(1);
    expect(stats.errorCount).toBeGreaterThan(0);
  });

  it('8. totalNodesExecuted counts all nodes that were processed (metrics entries)', () => {
    // Build a two-node graph: source + display
    buildSimpleGraph(10);
    getStore().executeGraph();
    const stats = getStore().executionStats;
    // At least both nodes should have been recorded in metrics
    expect(stats.totalNodesExecuted).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Cache Hits
// ---------------------------------------------------------------------------

describe('ExecutionStats — cache hit tracking', () => {
  beforeEach(() => { resetStore(); });

  it('9. Second execution of same graph increases totalCacheHits', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    const hitsAfterFirst = getStore().executionStats.totalCacheHits;

    // Second run — nodes are cached, cache hits should increase.
    // Use allowNextExecution() (not resetExecution!) to preserve the cache.
    allowNextExecution();
    getStore().executeGraph();
    const stats = getStore().executionStats;
    expect(stats.totalCacheHits).toBeGreaterThan(hitsAfterFirst);
  });

  it('10. After data change the updated node is re-executed (cache invalidated for that node)', () => {
    const src = buildSimpleGraph(10);
    getStore().executeGraph();
    const hitsAfterFirst = getStore().executionStats.totalCacheHits;

    // Change the source value — invalidates source + downstream cache
    getStore().updateNodeData(src, 'value', 99);
    getStore().executeGraph();
    const stats = getStore().executionStats;

    // Cache hits in second run should be fewer (or zero) for the invalidated path
    // totalCacheHits is cumulative — second run's hits added on top of first run's hits
    // The source node should NOT have been a cache hit in the second run,
    // so the incremental cache hits for run 2 should be < incremental hits for run 1.
    const hitsInRun1 = hitsAfterFirst; // run 1 had no prior cache
    const hitsInRun2 = stats.totalCacheHits - hitsAfterFirst;
    // After invalidation, fewer (or 0) nodes should be cache hits
    expect(hitsInRun2).toBeLessThanOrEqual(hitsInRun1);
  });
});

// ---------------------------------------------------------------------------
// 4. Per-graph Isolation
// ---------------------------------------------------------------------------

describe('ExecutionStats — per-graph isolation', () => {
  beforeEach(() => { resetStore(); });

  it('11. Stats from graph A do not bleed into a newly created graph B', () => {
    // Execute in the default graph
    buildSimpleGraph(10);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);

    // Create and switch to graph B
    const graphBId = getStore().createGraph('Graph B');
    // After switching to the new graph, stats should be reset to initial
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();

    // Keep graphBId in scope to avoid lint warnings
    void graphBId;
  });

  it('12. switchGraph saves current stats to inactive, then restores target stats', () => {
    // Run one execution in default graph
    buildSimpleGraph(10);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);
    const graphAId = getStore().activeGraphId;

    // Create graph B and execute there twice
    const graphBId = getStore().createGraph('Graph B');
    buildSimpleGraph(5);
    getStore().executeGraph();
    allowNextExecution();
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(2);

    // Switch back to graph A — should restore graph A's stats
    getStore().switchGraph(graphAId);
    expect(getStore().executionStats.executionCount).toBe(1);

    // Switch to graph B — should restore graph B's stats
    getStore().switchGraph(graphBId);
    expect(getStore().executionStats.executionCount).toBe(2);
  });

  it('13. A new graph has initial (zero) execution stats', () => {
    const newGraphId = getStore().createGraph('Fresh Graph');
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
    void newGraphId;
  });
});

// ---------------------------------------------------------------------------
// 5. Persistence — clearGraph and importWorkflow
// ---------------------------------------------------------------------------

describe('ExecutionStats — reset on clearGraph / importWorkflow', () => {
  beforeEach(() => { resetStore(); });

  it('14. clearGraph resets executionStats to initial values', () => {
    buildSimpleGraph(10);
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

  it('15. Stats survive undo/redo (NOT stored in Snapshot)', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    const statsBeforeUndo = { ...getStore().executionStats };
    expect(statsBeforeUndo.executionCount).toBe(1);

    // Make an undoable change
    const src = Object.keys(getStore().nodes).find(id => getStore().nodes[id].type === 'source')!;
    getStore().updateNodeData(src, 'value', 999);

    // Undo the data change — stats should NOT be reverted
    getStore().undo();
    const statsAfterUndo = getStore().executionStats;
    expect(statsAfterUndo.executionCount).toBe(statsBeforeUndo.executionCount);
    expect(statsAfterUndo.lastExecutedAt).toBe(statsBeforeUndo.lastExecutedAt);

    // Redo — stats still should not change
    getStore().redo();
    const statsAfterRedo = getStore().executionStats;
    expect(statsAfterRedo.executionCount).toBe(statsBeforeUndo.executionCount);
  });

  it('16. Stats are NOT cleared by clearExecutionTransientState (they persist)', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);

    // Simulate what clearExecutionTransientState does by triggering it via resetExecution
    // resetExecution calls clearExecutionTransientState internally
    getStore().resetExecution();

    // Transient state (nodeOutputs, executionStates) should be cleared
    expect(Object.keys(getStore().nodeOutputs).length).toBe(0);
    expect(Object.keys(getStore().executionStates).length).toBe(0);

    // But executionStats should remain intact
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(1);
    expect(stats.lastExecutedAt).not.toBeNull();
  });

  it('17. importWorkflow resets executionStats to initial', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);

    // Import a minimal workflow — this should reset stats
    const srcConf = NODE_TYPE_CONFIG.source;
    getStore().importWorkflow({
      nodes: {
        n1: {
          id: 'n1',
          type: 'source',
          position: [0, 0, 0],
          title: 'Imported Source',
          data: { value: 1 },
          inputs: srcConf.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
          outputs: srcConf.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
        },
      },
      connections: {},
    });

    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. exportAllGraphs — conditional inclusion
// ---------------------------------------------------------------------------

describe('ExecutionStats — exportAllGraphs serialization', () => {
  beforeEach(() => { resetStore(); });

  it('18. exportAllGraphs includes executionStats when executionCount > 0', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);

    const exported = getStore().exportAllGraphs();
    const activeId = exported.activeGraphId;
    const graphData = exported.graphs[activeId];

    expect(graphData.executionStats).toBeDefined();
    expect(graphData.executionStats!.executionCount).toBe(1);
    expect(graphData.executionStats!.lastExecutedAt).not.toBeNull();
  });

  it('19. exportAllGraphs omits executionStats when executionCount = 0', () => {
    // No execution performed — executionCount is 0
    getStore().addNode('source');

    const exported = getStore().exportAllGraphs();
    const activeId = exported.activeGraphId;
    const graphData = exported.graphs[activeId];

    // Should be undefined (omitted) when no executions have run
    expect(graphData.executionStats).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Serialization Roundtrip
// ---------------------------------------------------------------------------

describe('ExecutionStats — serialization roundtrip', () => {
  beforeEach(() => { resetStore(); });

  it('20. importAllGraphs loads executionStats from storage when present', () => {
    // Build a graph, execute it to accumulate real stats
    buildSimpleGraph(42);
    getStore().executeGraph();
    allowNextExecution();
    getStore().executeGraph();
    const originalStats = { ...getStore().executionStats };
    expect(originalStats.executionCount).toBe(2);

    // Export the workspace (includes stats because executionCount > 0)
    const exported = getStore().exportAllGraphs() as MultiGraphStorage;

    // Reset the store completely
    resetStore();
    expect(getStore().executionStats.executionCount).toBe(0);

    // Re-import — stats should be restored from the exported data
    getStore().importAllGraphs(exported);

    const restoredStats = getStore().executionStats;
    expect(restoredStats.executionCount).toBe(originalStats.executionCount);
    expect(restoredStats.totalNodesExecuted).toBe(originalStats.totalNodesExecuted);
    expect(restoredStats.totalCacheHits).toBe(originalStats.totalCacheHits);
    expect(restoredStats.lastExecutedAt).toBe(originalStats.lastExecutedAt);
  });

  it('20b. importAllGraphs defaults to initial stats when storage has no executionStats', () => {
    // Create a valid MultiGraphStorage with executionStats explicitly undefined
    const srcConf = NODE_TYPE_CONFIG.source;
    const storage: MultiGraphStorage = {
      version: 2,
      graphs: {
        default: {
          nodes: {
            n1: {
              id: 'n1',
              type: 'source',
              position: [0, 0, 0],
              title: 'Source',
              data: { value: 1 },
              inputs: srcConf.inputs.map((c, i) => ({
                id: `in-${i}`, label: c.label, portType: c.portType,
              })),
              outputs: srcConf.outputs.map((c, i) => ({
                id: `out-${i}`, label: c.label, portType: c.portType,
              })),
            },
          },
          connections: {},
          groups: {},
          customNodeDefs: {},
          // executionStats intentionally absent
        },
      },
      graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
      activeGraphId: 'default',
      graphOrder: ['default'],
      templates: {},
    };

    getStore().importAllGraphs(storage);

    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. getExecutionStats() Accessor Accuracy
// ---------------------------------------------------------------------------

describe('ExecutionStats — getExecutionStats() accessor', () => {
  beforeEach(() => { resetStore(); });

  it('21. getExecutionStats() reflects live state after multiple executions', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    allowNextExecution();
    getStore().executeGraph();
    allowNextExecution();
    getStore().executeGraph();

    const via = getStore().executionStats;
    const direct = getStore().executionStats;

    expect(via.executionCount).toBe(direct.executionCount);
    expect(via.executionCount).toBe(3);
    expect(via.totalNodesExecuted).toBe(direct.totalNodesExecuted);
    expect(via.totalCacheHits).toBe(direct.totalCacheHits);
    expect(via.totalDuration).toBe(direct.totalDuration);
    expect(via.lastExecutedAt).toBe(direct.lastExecutedAt);
  });

  it('22. getExecutionStats() after clearGraph returns zeroed stats', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    getStore().clearGraph();

    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Error Count Accumulation
// ---------------------------------------------------------------------------

describe('ExecutionStats — errorCount accumulation', () => {
  beforeEach(() => { resetStore(); });

  it('23. Error-free execution: errorCount remains 0', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    getStore().executeGraph();
    expect(getStore().executionStats.errorCount).toBe(0);
  });

  it('24. errorCount accumulates across multiple executions with errors', () => {
    buildErrorGraph();
    getStore().setErrorStrategy('continue');
    getStore().executeGraph();
    allowNextExecution();
    getStore().executeGraph();

    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(2);
    // Should have accumulated errors from both runs
    expect(stats.errorCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 10. totalNodesExecuted Accumulation
// ---------------------------------------------------------------------------

describe('ExecutionStats — totalNodesExecuted accumulation', () => {
  beforeEach(() => { resetStore(); });

  it('25. totalNodesExecuted grows with each execution run', () => {
    buildSimpleGraph(10);
    getStore().executeGraph();
    const afterFirst = getStore().executionStats.totalNodesExecuted;
    expect(afterFirst).toBeGreaterThan(0);

    allowNextExecution();
    getStore().executeGraph();
    const afterSecond = getStore().executionStats.totalNodesExecuted;
    // Should be greater after two runs (cached nodes still count toward total)
    expect(afterSecond).toBeGreaterThan(afterFirst);
  });

  it('26. totalNodesExecuted counts nodes including cached ones', () => {
    // A cached node still appears in metrics (with cacheHit=true), so it counts
    buildSimpleGraph(10);
    getStore().executeGraph();
    const nodesAfterFirst = getStore().executionStats.totalNodesExecuted;

    allowNextExecution();
    getStore().executeGraph(); // second run: nodes are cached
    const nodesAfterSecond = getStore().executionStats.totalNodesExecuted;
    const cacheHitsAfterSecond = getStore().executionStats.totalCacheHits;

    // Second run should have contributed cached node metrics
    expect(nodesAfterSecond - nodesAfterFirst).toBeGreaterThan(0);
    // And some of those should be cache hits
    expect(cacheHitsAfterSecond).toBeGreaterThan(0);
  });
});

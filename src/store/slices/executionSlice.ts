/**
 * Execution slice — manages execution state, profiling, debug mode, tracing,
 * error strategy, and all execution-related actions.
 *
 * Extracted from editorStore.ts for modularity. The actual state + actions live here;
 * editorStore.ts composes them via the Zustand slice pattern.
 */
import type { ExecutionState, ErrorStrategy, NodeExecutionMetric, EditorNode, Connection, SubgraphNodeDef, GraphData, ExecutionStats } from '../../types';
import { executeGraph as execGraph, invalidateDownstream, setGraphVariablesContext, getGraphVariablesContext } from '../../utils/execution';
import type { NodeResult, SubgraphContext } from '../../utils/execution';
import { executeInWorker, checkWorkerHealth } from '../../workers/executionWorkerManager';
import type { ExecuteResultMessage } from '../../workers/execution.worker';
import { getUpstreamPath } from '../../utils/profiling';
import { useSettingsStore } from '../settingsStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single execution run snapshot for the history timeline. */
export interface ExecutionHistoryEntry {
  id: number;
  timestamp: number;
  nodeOutputs: Record<string, Record<number, unknown>>;
  metrics: Record<string, NodeExecutionMetric>;
  errors: Record<string, string>;
  totalDuration: number;
  maxNodeDuration: number;
  waveCount: number;
  nodeCount: number;
}

const MAX_EXECUTION_HISTORY = 20;
let executionHistoryCounter = 0;

export interface ExecutionSliceState {
  executionStates: Record<string, ExecutionState>;
  nodeOutputs: Record<string, Record<number, unknown>>;
  executionErrors: Record<string, string>;
  isExecuting: boolean;
  executionMetrics: Record<string, NodeExecutionMetric>;
  executionTotalDuration: number;
  debugMode: boolean;
  pausedAtWave: number;
  debugWaves: string[][];
  /** Node IDs with breakpoints set. Execution pauses before the wave containing a breakpoint node. */
  breakpoints: Record<string, true>;
  /** Optional conditional expressions for breakpoints. If set, breakpoint only pauses when expression evaluates truthy. */
  breakpointConditions: Record<string, string>;
  traceNodeId: string | null;
  errorStrategy: ErrorStrategy;
  executionHistory: ExecutionHistoryEntry[];
  executionHistoryIndex: number; // -1 means "live" (current), >= 0 means viewing a past entry
  graphVariables: Record<string, unknown>;
  /** Pre-computed max non-cached node duration for heatmap normalization (avoids O(N) per-node scan). */
  executionMaxNodeDuration: number;
  /** Cumulative execution statistics for the current graph */
  executionStats: ExecutionStats;
  /** Per-node execution duration in milliseconds (convenience view of executionMetrics). */
  executionTimings: Record<string, number>;
  /** True when the most recent execution was terminated by timeout */
  executionTimedOut: boolean;
}

export interface ExecutionSliceActions {
  executeGraph: () => void;
  executeSelection: (selectedNodeIds: Set<string>) => void;
  setNodeExecutionState: (nodeId: string, state: ExecutionState) => void;
  resetExecution: () => void;
  invalidateNode: (nodeId: string) => void;
  toggleDebugMode: () => void;
  stepExecution: () => void;
  resumeExecution: () => void;
  toggleBreakpoint: (nodeId: string) => void;
  clearAllBreakpoints: () => void;
  setBreakpointCondition: (nodeId: string, expression: string) => void;
  clearBreakpointCondition: (nodeId: string) => void;
  setTraceNode: (nodeId: string | null) => void;
  setErrorStrategy: (strategy: ErrorStrategy) => void;
  scrubExecutionHistory: (index: number) => void;
  clearExecutionHistory: () => void;
  getExecutionStats: () => ExecutionStats;
}

export type ExecutionSlice = ExecutionSliceState & ExecutionSliceActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const executionInitialState: ExecutionSliceState = {
  executionStates: {},
  nodeOutputs: {},
  executionErrors: {},
  isExecuting: false,
  executionMetrics: {} as Record<string, NodeExecutionMetric>,
  executionTotalDuration: 0,
  debugMode: false,
  pausedAtWave: -1,
  debugWaves: [] as string[][],
  breakpoints: {},
  breakpointConditions: {},
  traceNodeId: null as string | null,
  errorStrategy: 'fail-fast' as ErrorStrategy,
  executionHistory: [] as ExecutionHistoryEntry[],
  executionHistoryIndex: -1,
  graphVariables: {},
  executionMaxNodeDuration: 0,
  executionStats: {
    executionCount: 0,
    totalDuration: 0,
    errorCount: 0,
    totalCacheHits: 0,
    totalNodesExecuted: 0,
    lastExecutedAt: null,
    timeoutCount: 0,
  },
  executionTimings: {},
  executionTimedOut: false,
};

// ---------------------------------------------------------------------------
// Module-scoped execution infrastructure
// ---------------------------------------------------------------------------

let executionTimeouts: ReturnType<typeof setTimeout>[] = [];

// Snapshot of live execution outputs saved before scrubbing to a history entry.
// Restored when user returns to "live" view.
let liveOutputsSnapshot: {
  nodeOutputs: Record<string, Record<number, unknown>>;
  executionErrors: Record<string, string>;
  executionMetrics: Record<string, NodeExecutionMetric>;
  executionTimings: Record<string, number>;
  executionTotalDuration: number;
  executionMaxNodeDuration: number;
} | null = null;

// Per-graph execution cache
const executionCaches = new Map<string, Map<string, NodeResult>>();

/** Get (or create) the execution cache for the active graph. */
export function getExecutionCache(activeGraphId: string): Map<string, NodeResult> {
  let cache = executionCaches.get(activeGraphId);
  if (!cache) { cache = new Map(); executionCaches.set(activeGraphId, cache); }
  return cache;
}

/** Delete the execution cache for a specific graph (used when deleting graphs). */
export function deleteExecutionCache(graphId: string): void {
  executionCaches.delete(graphId);
}

/**
 * Clear execution timeouts and cache for the active graph.
 * Called by undo/redo, clearGraph, importWorkflow, switchGraph, etc.
 */
export function clearExecutionTimeoutsAndCache(activeGraphId: string): void {
  executionTimeouts.forEach(id => clearTimeout(id));
  executionTimeouts = [];
  getExecutionCache(activeGraphId).clear();
}

/** Clear only execution timeouts (no cache clear). Used by switchGraph. */
export function clearExecutionTimeouts(): void {
  executionTimeouts.forEach(id => clearTimeout(id));
  executionTimeouts = [];
}

// ---------------------------------------------------------------------------
// Execution result persistence — save/restore per-graph to separate localStorage key
// ---------------------------------------------------------------------------
const EXEC_RESULTS_KEY = 'node-editor-3d-exec-results';
/** Max serialized size per graph (50KB) to avoid bloating localStorage. */
const MAX_PERSISTED_SIZE = 50_000;

interface PersistedExecutionResults {
  nodeOutputs: Record<string, Record<number, unknown>>;
  executionTimings: Record<string, number>;
  executionErrors: Record<string, string>;
}

/** Save execution results for a graph to localStorage. Called after applyResults. */
export function saveExecutionResults(graphId: string, state: ExecutionSliceState): void {
  try {
    const payload: PersistedExecutionResults = {
      nodeOutputs: state.nodeOutputs,
      executionTimings: state.executionTimings,
      executionErrors: state.executionErrors,
    };
    const json = JSON.stringify(payload);
    // Skip if payload is too large (prevents localStorage quota issues)
    if (json.length > MAX_PERSISTED_SIZE) return;
    const allResults = loadAllPersistedResults();
    allResults[graphId] = payload;
    localStorage.setItem(EXEC_RESULTS_KEY, JSON.stringify(allResults));
  } catch {
    // Silently fail — execution persistence is best-effort
  }
}

/** Load execution results for a specific graph from localStorage. */
export function loadExecutionResults(graphId: string): PersistedExecutionResults | null {
  try {
    const all = loadAllPersistedResults();
    return all[graphId] ?? null;
  } catch {
    return null;
  }
}

/** Delete persisted execution results for a graph (called on graph delete). */
export function deletePersistedExecutionResults(graphId: string): void {
  try {
    const all = loadAllPersistedResults();
    delete all[graphId];
    localStorage.setItem(EXEC_RESULTS_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

function loadAllPersistedResults(): Record<string, PersistedExecutionResults> {
  try {
    const raw = localStorage.getItem(EXEC_RESULTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, PersistedExecutionResults>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Assigns the execution-related fields in the given draft state to their initial values.
 * Used by undo/redo, clearGraph, importWorkflow, switchGraph to clear transient execution state.
 * Call inside a Zustand `set()` callback on the draft.
 */
export function clearExecutionTransientState(draft: ExecutionSliceState): void {
  draft.executionStates = {};
  draft.nodeOutputs = {};
  draft.executionErrors = {};
  draft.isExecuting = false;
  draft.executionMetrics = {};
  draft.executionTimings = {};
  draft.executionTotalDuration = 0;
  draft.executionMaxNodeDuration = 0;
  draft.pausedAtWave = -1;
  draft.debugWaves = [];
  // Note: breakpoints and breakpointConditions are NOT cleared here — they persist across executions as user config
  draft.executionTimedOut = false;
  draft.executionHistoryIndex = -1;
  // Note: graphVariables are NOT cleared here — they are per-graph persistent state
  // restored from snapshots or inactive graph data, not transient execution state.
  // Note: executionHistory is NOT cleared here — it persists across undo/redo
  // Clear stale live outputs snapshot (from a prior scrub session)
  liveOutputsSnapshot = null;
}

/**
 * Export execution results as a structured object (for JSON/CSV export).
 * Returns null if no execution results exist.
 */
export function exportExecutionResults(
  state: ExecutionSliceState & { nodes: Record<string, EditorNode> },
): { json: string; csv: string } | null {
  const nodeOutputs = state.nodeOutputs;
  const metrics = state.executionMetrics;
  const errors = state.executionErrors;
  const nodes = state.nodes;

  const nodeIds = Object.keys(nodeOutputs);
  if (nodeIds.length === 0) return null;

  // Build structured data
  const rows: Array<{
    nodeId: string;
    nodeType: string;
    nodeTitle: string;
    outputs: Record<number, unknown>;
    durationMs: number;
    cacheHit: boolean;
    error: string | null;
  }> = [];

  for (const nodeId of nodeIds) {
    const node = nodes[nodeId];
    if (!node) continue;
    const metric = metrics[nodeId];
    rows.push({
      nodeId,
      nodeType: node.type,
      nodeTitle: node.title,
      outputs: nodeOutputs[nodeId],
      durationMs: metric?.duration ?? 0,
      cacheHit: metric?.cacheHit ?? false,
      error: errors[nodeId] ?? null,
    });
  }

  // JSON output
  const jsonObj = {
    timestamp: new Date().toISOString(),
    totalDuration: state.executionTotalDuration,
    nodeCount: rows.length,
    results: rows,
  };
  const json = JSON.stringify(jsonObj, null, 2);

  // CSV output
  const csvHeader = 'nodeId,nodeType,nodeTitle,output0,output1,output2,durationMs,cacheHit,error';
  const csvRows = rows.map(r => {
    const o0 = r.outputs[0] !== undefined ? JSON.stringify(r.outputs[0]) : '';
    const o1 = r.outputs[1] !== undefined ? JSON.stringify(r.outputs[1]) : '';
    const o2 = r.outputs[2] !== undefined ? JSON.stringify(r.outputs[2]) : '';
    const escapeCsv = (s: string) =>
      s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
        ? `"${s.replace(/"/g, '""')}"` : s;
    return [
      escapeCsv(r.nodeId), escapeCsv(r.nodeType), escapeCsv(r.nodeTitle),
      escapeCsv(o0), escapeCsv(o1), escapeCsv(o2),
      r.durationMs.toFixed(2), r.cacheHit ? 'true' : 'false',
      r.error ? escapeCsv(r.error) : '',
    ].join(',');
  });
  const csv = [csvHeader, ...csvRows].join('\n');

  return { json, csv };
}

/** Reset all module-scoped execution state (for testing). */
export function _resetExecutionModuleState(): void {
  executionCaches.clear();
  executionTimeouts.forEach(id => clearTimeout(id));
  executionTimeouts = [];
  executionHistoryCounter = 0;
  liveOutputsSnapshot = null;
}

// ---------------------------------------------------------------------------
// Actions factory
// ---------------------------------------------------------------------------

/** Full store shape that execution actions need to read from via get(). */
interface ExecutionStoreReader extends ExecutionSliceState {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  subgraphDefs: Record<string, SubgraphNodeDef>;
  graphVariables: Record<string, unknown>;
  setNodeExecutionState: (nodeId: string, state: ExecutionState) => void;
}

/**
 * Creates execution actions. Requires `set`, `get`, and context from the host store.
 *
 * @param set - Zustand immer set
 * @param get - Zustand get (returns full store state)
 * @param getActiveGraphId - Returns the current active graph ID (module-scoped in editorStore)
 * @param getInactiveGraph - Returns inactive graph data for subgraph execution
 * @param getStoreRef - Returns `useEditorStore.getState()` for timeout callbacks
 * @param getWorkerEnabled - Returns whether Web Worker execution is enabled
 */
export function createExecutionActions(
  set: (fn: (state: ExecutionSliceState) => void) => void,
  get: () => ExecutionStoreReader,
  getActiveGraphId: () => string,
  getInactiveGraph: (graphId: string) => GraphData | undefined,
  getStoreRef: () => ExecutionStoreReader,
  getWorkerEnabled: () => boolean,
): ExecutionSliceActions {
  return {
    setNodeExecutionState: (nodeId, execState) => {
      set(s => { s.executionStates[nodeId] = execState; });
    },

    resetExecution: () => {
      clearExecutionTimeoutsAndCache(getActiveGraphId());
      set(s => {
        clearExecutionTransientState(s);
      });
    },

    setErrorStrategy: (strategy) => {
      set(s => { s.errorStrategy = strategy; });
    },

    toggleDebugMode: () => {
      set(s => { s.debugMode = !s.debugMode; });
    },

    setTraceNode: (nodeId) => {
      set(s => { s.traceNodeId = nodeId; });
    },

    toggleBreakpoint: (nodeId) => {
      if (!get().nodes[nodeId]) return; // Guard: node must exist
      set(s => {
        if (s.breakpoints[nodeId]) {
          delete s.breakpoints[nodeId];
          delete s.breakpointConditions[nodeId];
        } else {
          s.breakpoints[nodeId] = true;
        }
      });
    },

    clearAllBreakpoints: () => {
      set(s => { s.breakpoints = {}; s.breakpointConditions = {}; });
    },

    setBreakpointCondition: (nodeId, expression) => {
      if (!get().nodes[nodeId]) return; // Guard: node must exist
      set(s => {
        // Ensure breakpoint exists when setting a condition
        if (!s.breakpoints[nodeId]) {
          s.breakpoints[nodeId] = true;
        }
        if (expression.trim()) {
          s.breakpointConditions[nodeId] = expression;
        } else {
          delete s.breakpointConditions[nodeId];
        }
      });
    },

    clearBreakpointCondition: (nodeId) => {
      set(s => { delete s.breakpointConditions[nodeId]; });
    },

    stepExecution: () => {
      const state = get();
      if (!state.isExecuting || !state.debugMode) return;
      const nextWave = state.pausedAtWave + 1;
      if (nextWave >= state.debugWaves.length) {
        // All waves done
        set(s => { s.isExecuting = false; s.pausedAtWave = -1; s.debugWaves = []; });
        return;
      }
      const wave = state.debugWaves[nextWave];
      // Set wave nodes to 'running' then 'complete' after delay
      for (const id of wave) {
        const hasError = state.executionErrors[id];
        state.setNodeExecutionState(id, hasError ? 'error' : 'running');
      }
      const NODE_DURATION = 400;
      executionTimeouts.push(setTimeout(() => {
        const s = getStoreRef();
        if (!s.isExecuting) return;
        for (const id of wave) {
          const hasError = s.executionErrors[id];
          s.setNodeExecutionState(id, hasError ? 'error' : 'complete');
        }
      }, NODE_DURATION));
      set(s => { s.pausedAtWave = nextWave; });
    },

    resumeExecution: () => {
      const state = get();
      if (!state.isExecuting || !state.debugMode) return;
      const startWave = state.pausedAtWave + 1;
      const waves = state.debugWaves;
      const breakpoints = state.breakpoints;
      const conditions = state.breakpointConditions;
      const nodeOutputs = state.nodeOutputs;
      const WAVE_DELAY = 600;
      const NODE_DURATION = 400;
      let delay = 0;
      for (let i = startWave; i < waves.length; i++) {
        const wave = waves[i];
        // Check if this wave contains a breakpoint node that should pause
        const shouldPause = wave.some(id => {
          if (!breakpoints[id]) return false;
          const condition = conditions[id];
          if (!condition) return true; // Unconditional breakpoint always pauses
          // Evaluate condition expression against node outputs
          try {
            const outputs = nodeOutputs[id] ?? {};
            const fn = new Function('outputs', 'out0', 'out1', 'out2', 'out3',
              `"use strict"; return (${condition})`);
            return !!fn(outputs, outputs[0], outputs[1], outputs[2], outputs[3]);
          } catch {
            // If expression fails, treat as unconditional (pause)
            return true;
          }
        });
        if (shouldPause) {
          // Pause at the wave before the breakpoint wave (so the breakpoint wave hasn't run yet)
          set(s => { s.pausedAtWave = i - 1; });
          return;
        }
        const waveDelay = delay;
        executionTimeouts.push(setTimeout(() => {
          const s = getStoreRef();
          if (!s.isExecuting) return;
          for (const id of wave) {
            const hasError = s.executionErrors[id];
            s.setNodeExecutionState(id, hasError ? 'error' : 'running');
          }
        }, waveDelay));
        executionTimeouts.push(setTimeout(() => {
          const s = getStoreRef();
          if (!s.isExecuting) return;
          for (const id of wave) {
            const hasError = s.executionErrors[id];
            s.setNodeExecutionState(id, hasError ? 'error' : 'complete');
          }
        }, waveDelay + NODE_DURATION));
        delay += WAVE_DELAY;
      }
      executionTimeouts.push(setTimeout(() => {
        set(s => { s.isExecuting = false; s.pausedAtWave = -1; s.debugWaves = []; });
      }, delay + NODE_DURATION));
      // Clear debug mode pausing (remaining waves now run automatically)
      set(s => { s.pausedAtWave = waves.length - 1; });
    },

    invalidateNode: (nodeId) => {
      invalidateDownstream(nodeId, get().connections, getExecutionCache(getActiveGraphId()));
    },

    scrubExecutionHistory: (index) => {
      // Save live outputs before first scrub (must read from get(), not the immer draft)
      const current = get();
      if (current.executionHistoryIndex === -1 && index >= 0 && index < current.executionHistory.length) {
        liveOutputsSnapshot = {
          nodeOutputs: JSON.parse(JSON.stringify(current.nodeOutputs)),
          executionErrors: JSON.parse(JSON.stringify(current.executionErrors)),
          executionMetrics: JSON.parse(JSON.stringify(current.executionMetrics)),
          executionTimings: { ...current.executionTimings },
          executionTotalDuration: current.executionTotalDuration,
          executionMaxNodeDuration: current.executionMaxNodeDuration,
        };
      }
      set(s => {
        if (index < 0 || index >= s.executionHistory.length) {
          // Back to live view — restore saved live outputs
          s.executionHistoryIndex = -1;
          if (liveOutputsSnapshot) {
            s.nodeOutputs = liveOutputsSnapshot.nodeOutputs;
            s.executionErrors = liveOutputsSnapshot.executionErrors;
            s.executionMetrics = liveOutputsSnapshot.executionMetrics;
            s.executionTimings = liveOutputsSnapshot.executionTimings;
            s.executionTotalDuration = liveOutputsSnapshot.executionTotalDuration;
            s.executionMaxNodeDuration = liveOutputsSnapshot.executionMaxNodeDuration;
            liveOutputsSnapshot = null;
          }
          return;
        }
        s.executionHistoryIndex = index;
        // Restore the outputs/errors/metrics from the history entry for display
        const entry = s.executionHistory[index];
        s.nodeOutputs = entry.nodeOutputs;
        s.executionErrors = entry.errors;
        s.executionMetrics = entry.metrics;
        // Rebuild executionTimings from entry metrics
        const timings: Record<string, number> = {};
        for (const [id, m] of Object.entries(entry.metrics)) {
          timings[id] = m.duration;
        }
        s.executionTimings = timings;
        s.executionTotalDuration = entry.totalDuration;
        // Use pre-computed max (avoids O(N) rescan on every history scrub)
        s.executionMaxNodeDuration = entry.maxNodeDuration ?? 0;
      });
    },

    clearExecutionHistory: () => {
      set(s => {
        s.executionHistory = [];
        s.executionHistoryIndex = -1;
      });
      liveOutputsSnapshot = null;
    },

    executeGraph: () => {
      const state = get();
      if (state.isExecuting) return;
      const nodeIds = Object.keys(state.nodes);
      if (nodeIds.length === 0) return;

      const activeGraphId = getActiveGraphId();

      // ---------------------------------------------------------------
      // Shared: apply execution results to the store and start animation
      // ---------------------------------------------------------------
      const applyResults = (
        resultEntries: [string, NodeResult][],
        waves: string[][],
        errorEntries: [string, string][],
        metricEntries: [string, NodeExecutionMetric][],
        totalDuration: number,
        timedOut?: boolean,
      ) => {
        // Store outputs, errors, and metrics
        set(s => {
          s.isExecuting = true;
          for (const id of nodeIds) {
            s.executionStates[id] = 'idle';
          }
          // Store node outputs
          for (const [id, nodeResult] of resultEntries) {
            s.nodeOutputs[id] = nodeResult.outputs as Record<number, unknown>;
          }
          // Store errors
          s.executionErrors = {};
          for (const [id, msg] of errorEntries) {
            s.executionErrors[id] = msg;
          }
          // Store execution metrics (profiling) and pre-compute max node duration + timings.
          // Preserve referential identity for entries whose visible fields are
          // unchanged (typical for cache hits) — per-node subscribers in
          // NodeModule then skip re-rendering untouched nodes.
          const prevMetrics = s.executionMetrics;
          const nextMetrics: Record<string, NodeExecutionMetric> = {};
          s.executionTimings = {};
          let maxNodeDuration = 0;
          for (const [id, metric] of metricEntries) {
            const prev = prevMetrics[id];
            nextMetrics[id] = prev && prev.duration === metric.duration && prev.cacheHit === metric.cacheHit
              ? prev
              : metric;
            s.executionTimings[id] = metric.duration;
            if (!metric.cacheHit && metric.duration > maxNodeDuration) {
              maxNodeDuration = metric.duration;
            }
          }
          s.executionMetrics = nextMetrics;
          s.executionMaxNodeDuration = maxNodeDuration;
          s.executionTotalDuration = totalDuration;

          // Record execution history entry
          const entry: ExecutionHistoryEntry = {
            id: ++executionHistoryCounter,
            timestamp: Date.now(),
            nodeOutputs: {} as Record<string, Record<number, unknown>>,
            metrics: {} as Record<string, NodeExecutionMetric>,
            errors: {} as Record<string, string>,
            totalDuration,
            maxNodeDuration,
            waveCount: waves.length,
            nodeCount: nodeIds.length,
          };
          for (const [id, nr] of resultEntries) {
            entry.nodeOutputs[id] = nr.outputs as Record<number, unknown>;
          }
          for (const [id, m] of metricEntries) {
            entry.metrics[id] = { ...m };
          }
          for (const [id, msg] of errorEntries) {
            entry.errors[id] = msg;
          }
          s.executionHistory = [...s.executionHistory, entry].slice(-MAX_EXECUTION_HISTORY);
          s.executionHistoryIndex = -1; // reset to live view

          // Accumulate execution statistics
          let cacheHits = 0;
          let nodesExecuted = 0;
          for (const [, m] of metricEntries) {
            nodesExecuted++;
            if (m.cacheHit) cacheHits++;
          }
          s.executionTimedOut = !!timedOut;
          s.executionStats = {
            executionCount: s.executionStats.executionCount + 1,
            totalDuration: s.executionStats.totalDuration + totalDuration,
            errorCount: s.executionStats.errorCount + errorEntries.length,
            totalCacheHits: s.executionStats.totalCacheHits + cacheHits,
            totalNodesExecuted: s.executionStats.totalNodesExecuted + nodesExecuted,
            lastExecutedAt: Date.now(),
            timeoutCount: (s.executionStats.timeoutCount || 0) + (timedOut ? 1 : 0),
          };
        });
        // Fresh results are now live — clear any stale pre-scrub snapshot
        liveOutputsSnapshot = null;

        // Persist execution results to localStorage for immediate value previews on reload
        saveExecutionResults(getActiveGraphId(), get());

        // Clear any pending timeouts from a previous execution before starting new animation
        executionTimeouts.forEach(tid => clearTimeout(tid));
        executionTimeouts = [];

        // Re-read debug mode and breakpoints at apply time (worker path is async)
        const currentState = get();
        const debugMode = currentState.debugMode;
        const hasAnyBreakpoints = Object.keys(currentState.breakpoints).length > 0;
        if (debugMode || hasAnyBreakpoints) {
          // In debug mode OR when breakpoints are set, store waves and pause
          // If breakpoints exist but debug mode is off, auto-enable debug mode
          set(s => {
            s.debugWaves = waves;
            s.pausedAtWave = -1;
            if (hasAnyBreakpoints && !debugMode) s.debugMode = true;
          });
          return;
        }

        // Animate waves with delays for visual effect
        let delay = 0;
        const WAVE_DELAY = 600;
        const NODE_DURATION = 400;

        for (const wave of waves) {
          const waveDelay = delay;

          executionTimeouts.push(setTimeout(() => {
            const store = getStoreRef();
            if (!store.isExecuting) return;
            for (const id of wave) {
              const hasError = store.executionErrors[id];
              store.setNodeExecutionState(id, hasError ? 'error' : 'running');
            }
          }, waveDelay));

          executionTimeouts.push(setTimeout(() => {
            const store = getStoreRef();
            if (!store.isExecuting) return;
            for (const id of wave) {
              const hasError = store.executionErrors[id];
              store.setNodeExecutionState(id, hasError ? 'error' : 'complete');
            }
          }, waveDelay + NODE_DURATION));

          delay += WAVE_DELAY;
        }

        // Mark execution complete
        executionTimeouts.push(setTimeout(() => {
          set(s => {
            s.isExecuting = false;
            // Clear execution highlighting so nodes return to normal
            for (const id of Object.keys(s.executionStates)) {
              s.executionStates[id] = 'idle';
            }
          });
        }, delay + NODE_DURATION));
      };

      // ---------------------------------------------------------------
      // Main-thread execution helper (used directly and as worker fallback)
      // ---------------------------------------------------------------
      const executeOnMainThread = () => {
        const s = get();
        const hasSubgraphs = Object.values(s.nodes).some(n => n.type === 'subgraph');
        const subgraphContext: SubgraphContext | undefined = hasSubgraphs ? {
          subgraphDefs: s.subgraphDefs,
          getInnerGraph: (graphId: string) => getInactiveGraph(graphId),
        } : undefined;

        try {
          const graphVars = { ...(s.graphVariables ?? {}) };
          setGraphVariablesContext(graphVars);

          const maxMs = useSettingsStore.getState().maxExecutionMs;
          const result = execGraph(s.nodes, s.connections, getExecutionCache(activeGraphId), subgraphContext, undefined, s.errorStrategy, graphVars, maxMs);
          executionCaches.set(activeGraphId, result.results);

          const updatedVars = getGraphVariablesContext();
          set(d => { d.graphVariables = updatedVars; });

          applyResults(
            Array.from(result.results),
            result.waves,
            Array.from(result.errors),
            Array.from(result.metrics),
            result.totalDuration,
            result.timedOut,
          );
        } catch (err) {
          // Unexpected execution error — preserve partial results and surface error
          const msg = err instanceof Error ? err.message : String(err);
          set(d => {
            d.isExecuting = false;
            d.executionErrors = { ...d.executionErrors, __graph__: `Execution failed: ${msg}` };
          });
        }
      };

      // ---------------------------------------------------------------
      // Check whether to use Worker execution
      // ---------------------------------------------------------------
      const useWorker = getWorkerEnabled();

      if (useWorker) {
        // ----- Worker path (async, off main thread) -----
        const hasSubgraphs = Object.values(state.nodes).some(n => n.type === 'subgraph');

        // Collect all inner graphs needed for subgraph execution
        let innerGraphs: Record<string, GraphData> | undefined;
        if (hasSubgraphs) {
          innerGraphs = {};
          for (const node of Object.values(state.nodes)) {
            if (node.type === 'subgraph') {
              const innerGraphId = node.data.innerGraphId as string | undefined;
              if (innerGraphId) {
                const g = getInactiveGraph(innerGraphId);
                if (g) innerGraphs[innerGraphId] = g;
              }
            }
          }
        }

        // Serialize the cache for postMessage (Maps are not structured-clone-safe)
        const cache = getExecutionCache(activeGraphId);
        const cacheEntries: [string, NodeResult][] = cache.size > 0 ? Array.from(cache) : [];

        // Mark executing immediately so a second call is blocked
        set(s => { s.isExecuting = true; });

        const workerMaxMs = useSettingsStore.getState().maxExecutionMs;

        // Pre-execution health check: if worker is unresponsive, skip directly
        // to main-thread fallback without waiting for executeInWorker to time out.
        checkWorkerHealth().then(healthy => {
          if (!healthy) {
            executeOnMainThread();
            return;
          }
          executeInWorker({
            nodes: state.nodes,
            connections: state.connections,
            cache: cacheEntries.length > 0 ? cacheEntries : undefined,
            subgraphDefs: hasSubgraphs ? state.subgraphDefs : undefined,
            innerGraphs,
            errorStrategy: state.errorStrategy,
            graphVariables: state.graphVariables ?? {},
            maxExecutionMs: workerMaxMs > 0 ? workerMaxMs : undefined,
          }).then((response: ExecuteResultMessage) => {
            // Discard stale results if user switched graphs during async execution
            if (getActiveGraphId() !== activeGraphId) {
              set(s => { s.isExecuting = false; });
              return;
            }
            // Rebuild the cache from worker results
            const newCache = new Map<string, NodeResult>(response.results);
            executionCaches.set(activeGraphId, newCache);

            // Update graph variables from worker execution (set-var may have modified them)
            if (response.updatedGraphVariables) {
              set(s => { s.graphVariables = response.updatedGraphVariables!; });
            }

            // Note: do NOT reset isExecuting here — applyResults sets it to true in its
            // first set() call. Resetting to false first creates a momentary window where
            // scheduleAutoExecute could start a concurrent execution (race condition).

            applyResults(
              response.results,
              response.waves,
              response.errors,
              response.metrics,
              response.totalDuration,
              response.timedOut,
            );
          }).catch(() => {
            // Worker failed — fall back to main-thread execution
            executeOnMainThread();
          });
        }).catch(() => {
          // Health check itself failed (e.g. postMessage threw) — fall back to main thread
          executeOnMainThread();
        });

        return;
      }

      // ----- Main-thread path (synchronous) -----
      executeOnMainThread();
    },

    executeSelection: (selectedNodeIds: Set<string>) => {
      const state = get();
      if (state.isExecuting) return;
      if (selectedNodeIds.size === 0) return;

      // Collect selected nodes + all upstream dependencies
      const scopeIds = new Set(selectedNodeIds);
      for (const id of selectedNodeIds) {
        if (!state.nodes[id]) continue;
        for (const upId of getUpstreamPath(id, state.nodes, state.connections)) {
          scopeIds.add(upId);
        }
      }

      // Filter nodes and connections to scope
      const filteredNodes: Record<string, EditorNode> = {};
      for (const id of scopeIds) {
        if (state.nodes[id]) filteredNodes[id] = state.nodes[id];
      }
      if (Object.keys(filteredNodes).length === 0) return;

      const filteredConns: Record<string, Connection> = {};
      for (const [cId, conn] of Object.entries(state.connections)) {
        if (scopeIds.has(conn.sourceNodeId) && scopeIds.has(conn.targetNodeId)) {
          filteredConns[cId] = conn;
        }
      }

      const activeGraphId = getActiveGraphId();

      // Build subgraph context if needed
      const hasSubgraphs = Object.values(filteredNodes).some(n => n.type === 'subgraph');
      const subgraphContext: SubgraphContext | undefined = hasSubgraphs ? {
        subgraphDefs: state.subgraphDefs,
        getInnerGraph: (graphId: string) => getInactiveGraph(graphId),
      } : undefined;

      // Mark scoped nodes as running during execution
      set(s => {
        for (const id of scopeIds) {
          s.executionStates[id] = 'running';
        }
      });

      try {
        // Set up graph variables context for selection execution
        const graphVars = { ...(state.graphVariables ?? {}) };
        setGraphVariablesContext(graphVars);

        const maxMs = useSettingsStore.getState().maxExecutionMs;
        const result = execGraph(
          filteredNodes,
          filteredConns,
          getExecutionCache(activeGraphId),
          subgraphContext,
          undefined,
          state.errorStrategy,
          graphVars,
          maxMs,
        );

        // Update graph variables from execution (set-var may have modified them)
        const updatedVars = getGraphVariablesContext();
        set(s => { s.graphVariables = updatedVars; });

        // Merge results into the existing cache (don't replace entire cache)
        const cache = getExecutionCache(activeGraphId);
        for (const [id, nodeResult] of result.results) {
          cache.set(id, nodeResult);
        }

        // Store outputs and metrics for the scoped nodes
        set(s => {
          for (const [id, nodeResult] of result.results) {
            s.nodeOutputs[id] = nodeResult.outputs as Record<number, unknown>;
          }
          for (const [id, msg] of result.errors) {
            s.executionErrors[id] = msg;
          }
          // Merge new metrics/timings and update max incrementally (avoids O(N) rescan)
          let maxDur = s.executionMaxNodeDuration;
          for (const [id, metric] of result.metrics) {
            s.executionMetrics[id] = metric;
            s.executionTimings[id] = metric.duration;
            if (!metric.cacheHit && metric.duration > maxDur) {
              maxDur = metric.duration;
            }
          }
          s.executionMaxNodeDuration = maxDur;
          // Track timeout for selection execution
          s.executionTimedOut = !!result.timedOut;
          // Mark scoped nodes as complete, error, or idle (clear stuck 'running')
          for (const id of scopeIds) {
            if (result.errors.has(id)) {
              s.executionStates[id] = 'error';
            } else if (result.results.has(id)) {
              s.executionStates[id] = 'complete';
            } else {
              s.executionStates[id] = 'idle';
            }
          }
        });
      } catch {
        // Cycle detected or other error in subgraph — clear running states
        set(s => {
          for (const id of scopeIds) {
            if (s.executionStates[id] === 'running') {
              s.executionStates[id] = 'error';
            }
          }
        });
        return;
      }
    },

    getExecutionStats: () => {
      return get().executionStats;
    },
  };
}

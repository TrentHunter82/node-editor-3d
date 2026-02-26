/**
 * Web Worker for off-main-thread graph execution.
 *
 * Imports the pure `executeGraph` function (zero runtime deps) and runs it
 * inside a Worker context. Communication uses structured-clone-safe messages:
 * Maps are serialized as [key, value][] tuples, and the SubgraphContext
 * function is reconstructed from a plain Record of inner graphs.
 */
import { executeGraph, setGraphVariablesContext, getGraphVariablesContext } from '../utils/execution';
import type { EditorNode, Connection, SubgraphNodeDef, GraphData, ErrorStrategy } from '../types';
import type { NodeResult, SubgraphContext } from '../utils/execution';

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

export interface ExecuteMessage {
  type: 'execute';
  id: number;
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  /** Serialized cache: Map entries as [nodeId, NodeResult][] */
  cache?: [string, NodeResult][];
  subgraphDefs?: Record<string, SubgraphNodeDef>;
  /** All inner graphs keyed by graph ID (replaces the getInnerGraph function) */
  innerGraphs?: Record<string, GraphData>;
  errorStrategy: ErrorStrategy;
  /** Graph variables for get-var/set-var nodes */
  graphVariables?: Record<string, unknown>;
  /** Execution timeout in ms (0 = no limit) */
  maxExecutionMs?: number;
}

export interface ExecuteResultMessage {
  type: 'result';
  id: number;
  results: [string, NodeResult][];
  waves: string[][];
  errors: [string, string][];
  metrics: [string, { duration: number; cacheHit: boolean; timestamp: number }][];
  totalDuration: number;
  /** Updated graph variables after execution (set-var may have modified them) */
  updatedGraphVariables?: Record<string, unknown>;
  /** True if execution was cut short by timeout */
  timedOut?: boolean;
}

export interface ExecuteErrorMessage {
  type: 'error';
  id: number;
  message: string;
}

export interface PingMessage {
  type: 'ping';
  id: number;
}

export interface PongResponse {
  type: 'pong';
  id: number;
}

export type WorkerMessage = ExecuteMessage | PingMessage;
export type WorkerResponse = ExecuteResultMessage | ExecuteErrorMessage | PongResponse;

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === 'ping') {
    const response: PongResponse = { type: 'pong', id: event.data.id };
    self.postMessage(response);
    return;
  }

  // Type narrowing: must be 'execute' at this point
  const { id, nodes, connections, cache, subgraphDefs, innerGraphs, errorStrategy, graphVariables, maxExecutionMs } = event.data;

  // Reconstruct Map from serialized tuples
  const cacheMap = cache ? new Map(cache) : undefined;

  // Reconstruct SubgraphContext from plain data
  let subgraphContext: SubgraphContext | undefined;
  if (subgraphDefs && innerGraphs) {
    subgraphContext = {
      subgraphDefs,
      getInnerGraph: (graphId: string) => innerGraphs[graphId],
    };
  }

  // Set up graph variables context (same as main-thread path)
  const graphVars = graphVariables ? { ...graphVariables } : {};
  setGraphVariablesContext(graphVars);

  try {
    const result = executeGraph(nodes, connections, cacheMap, subgraphContext, undefined, errorStrategy, graphVars, maxExecutionMs);

    const response: ExecuteResultMessage = {
      type: 'result',
      id,
      results: Array.from(result.results),
      waves: result.waves,
      errors: Array.from(result.errors),
      metrics: Array.from(result.metrics),
      totalDuration: result.totalDuration,
      updatedGraphVariables: getGraphVariablesContext(),
      timedOut: result.timedOut || undefined,
    };

    self.postMessage(response);
  } catch (err) {
    const response: ExecuteErrorMessage = {
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};

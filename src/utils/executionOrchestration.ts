/**
 * Execution orchestration — topological sorting, graph execution engine, subgraph execution,
 * caching, cache invalidation, and profiling utilities.
 *
 * Extracted from execution.ts for modularity. Contains:
 * - topologicalSort / topologicalOrder (Kahn's algorithm)
 * - executeGraph (main execution engine with wave batching)
 * - executeSubgraphNode (recursive inner graph execution)
 * - gatherInputs / hashInputs (input collection and cache keying)
 * - invalidateDownstream (cache invalidation)
 * - getUpstreamPath / getDownstreamPath / getBottleneckNodes / getCacheHitRate / getExecutionTimeline
 */
import type { EditorNode, Connection, SubgraphNodeDef, GraphData, ErrorStrategy, NodeExecutionMetric } from '../types';
import { getPluginProcessor } from '../store/pluginStore';
import { getNodeHelp } from './nodeHelp';
import { processors, setGraphVariablesContext, getGraphVariablesContext } from './executionProcessors';
import type { NodeProcessor } from './executionProcessors';

// Re-export for backward compat (consumers may import NodeProcessor from execution.ts facade)
export type { NodeProcessor };

/**
 * Topological sort using Kahn's algorithm.
 * Returns nodes grouped into execution waves (each wave can run in parallel).
 * Throws if a cycle is detected.
 */
export function topologicalSort(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): string[][] {
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  let nodeCount = 0;

  // Direct iteration — avoids intermediate Object.keys() array allocation
  for (const id in nodes) {
    if (Object.prototype.hasOwnProperty.call(nodes, id)) {
      inDegree[id] = 0;
      adj[id] = [];
      nodeCount++;
    }
  }
  if (nodeCount === 0) return [];

  // Direct iteration — avoids intermediate Object.values() array allocation
  for (const connId in connections) {
    if (Object.prototype.hasOwnProperty.call(connections, connId)) {
      const c = connections[connId];
      // Skip connections with dangling endpoints (stale refs to deleted nodes)
      if (inDegree[c.sourceNodeId] === undefined || inDegree[c.targetNodeId] === undefined) {
        continue;
      }
      inDegree[c.targetNodeId]++;
      adj[c.sourceNodeId].push(c.targetNodeId);
    }
  }

  const waves: string[][] = [];
  let queue: string[] = [];
  for (const id in inDegree) {
    if (Object.prototype.hasOwnProperty.call(inDegree, id) && inDegree[id] === 0) {
      queue.push(id);
    }
  }
  const visited = new Set<string>();

  while (queue.length > 0) {
    waves.push([...queue]);
    const nextQueue: string[] = [];
    const nextQueueSet = new Set<string>();
    for (const id of queue) {
      visited.add(id);
      for (const neighbor of (adj[id] ?? [])) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0 && !visited.has(neighbor) && !nextQueueSet.has(neighbor)) {
          nextQueue.push(neighbor);
          nextQueueSet.add(neighbor);
        }
      }
    }
    queue = nextQueue;
  }

  // If not all nodes were visited, there's a cycle
  if (visited.size !== nodeCount) {
    throw new Error('Graph contains a cycle');
  }

  return waves;
}

/**
 * Flat topological order (all waves flattened).
 */
export function topologicalOrder(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): string[] {
  return topologicalSort(nodes, connections).flat();
}

/**
 * Result cache for node execution.
 * Maps nodeId -> { outputData, inputHash }.
 * Invalidation: if a node's inputs change, its cache entry is stale.
 */
export interface NodeResult {
  outputs: Record<number, unknown>;
  inputHash: string;
}

function hashInputs(inputs: Record<number, unknown>): string {
  try {
    return JSON.stringify(inputs);
  } catch {
    // Cannot serialize (e.g. circular refs) — force cache miss to avoid stale results
    return `__unserializable__:${hashCounter++}`;
  }
}
let hashCounter = 0;

/**
 * Build a connection index keyed by target node ID for O(1) lookups.
 * Called once per execution, avoids O(C) scan in gatherInputs per node.
 */
function buildConnectionIndex(
  connections: Record<string, Connection>,
): Map<string, Connection[]> {
  const index = new Map<string, Connection[]>();
  for (const connId in connections) {
    if (Object.prototype.hasOwnProperty.call(connections, connId)) {
      const conn = connections[connId];
      let arr = index.get(conn.targetNodeId);
      if (!arr) {
        arr = [];
        index.set(conn.targetNodeId, arr);
      }
      arr.push(conn);
    }
  }
  return index;
}

/**
 * Build a forward connection index keyed by source node ID → target node IDs.
 * Used by invalidateDownstream, getDownstreamPath for O(K) per-hop lookup
 * instead of O(C) full-scan per BFS node.
 */
function buildForwardIndex(
  connections: Record<string, Connection>,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const connId in connections) {
    if (Object.prototype.hasOwnProperty.call(connections, connId)) {
      const conn = connections[connId];
      let arr = index.get(conn.sourceNodeId);
      if (!arr) {
        arr = [];
        index.set(conn.sourceNodeId, arr);
      }
      arr.push(conn.targetNodeId);
    }
  }
  return index;
}

/**
 * Build a reverse connection index keyed by target node ID → source node IDs.
 * Used by getUpstreamPath for O(K) per-hop lookup.
 */
function buildReverseNodeIndex(
  connections: Record<string, Connection>,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const connId in connections) {
    if (Object.prototype.hasOwnProperty.call(connections, connId)) {
      const conn = connections[connId];
      let arr = index.get(conn.targetNodeId);
      if (!arr) {
        arr = [];
        index.set(conn.targetNodeId, arr);
      }
      arr.push(conn.sourceNodeId);
    }
  }
  return index;
}

/**
 * Gather input data for a node from its incoming connections.
 * Uses pre-built connection index for O(K) lookup where K = connections to this node.
 */
function gatherInputs(
  nodeId: string,
  connsByTarget: Map<string, Connection[]>,
  results: Map<string, NodeResult>,
): Record<number, unknown> {
  const inputs: Record<number, unknown> = {};
  const conns = connsByTarget.get(nodeId);
  if (conns) {
    for (const conn of conns) {
      const sourceResult = results.get(conn.sourceNodeId);
      if (sourceResult) {
        inputs[conn.targetPortIndex] = sourceResult.outputs[conn.sourcePortIndex];
      }
    }
  }
  return inputs;
}

export interface ExecutionResult {
  /** Per-node output data */
  results: Map<string, NodeResult>;
  /** Execution order (wave groups) */
  waves: string[][];
  /** Nodes that had errors during execution */
  errors: Map<string, string>;
  /** Per-node execution metrics (profiling data) */
  metrics: Map<string, NodeExecutionMetric>;
  /** Total execution time in milliseconds */
  totalDuration: number;
  /** True if execution was terminated early due to timeout */
  timedOut?: boolean;
}

/** Maximum recursion depth for nested subgraph execution */
const MAX_SUBGRAPH_DEPTH = 10;

/** Context for subgraph resolution during execution */
export interface SubgraphContext {
  /** Map of subgraph node ID → SubgraphNodeDef */
  subgraphDefs: Record<string, SubgraphNodeDef>;
  /** Map of inner graph ID → GraphData (from inactiveGraphs or similar) */
  getInnerGraph: (graphId: string) => GraphData | undefined;
}

/**
 * Execute a subgraph node: inject inputs into inner graph, execute it, collect outputs.
 */
function executeSubgraphNode(
  node: EditorNode,
  inputs: Record<number, unknown>,
  context: SubgraphContext,
  depth: number,
  errorStrategy?: ErrorStrategy,
  maxExecutionMs?: number,
  parentStart?: number,
): Record<number, unknown> {
  if (depth >= MAX_SUBGRAPH_DEPTH) {
    throw new Error(`Subgraph recursion depth exceeded (max ${MAX_SUBGRAPH_DEPTH})`);
  }

  const defId = node.data.subgraphDefId;
  if (typeof defId !== 'string') {
    throw new Error(`Subgraph node ${node.id} is missing a valid subgraphDefId`);
  }
  const def = context.subgraphDefs[defId];
  if (!def) {
    throw new Error(`Subgraph definition not found: ${defId}`);
  }

  const innerGraph = context.getInnerGraph(def.innerGraphId);
  if (!innerGraph) {
    throw new Error(`Inner graph not found: ${def.innerGraphId}`);
  }

  // Clone inner graph data to avoid mutation
  const innerNodes: Record<string, EditorNode> = structuredClone(innerGraph.nodes);
  const innerConnections: Record<string, Connection> = structuredClone(innerGraph.connections);

  // Inject input values into subgraph-input nodes
  for (const { portIndex, innerNodeId } of def.exposedInputs) {
    const inputNode = innerNodes[innerNodeId];
    if (inputNode) {
      // Store the injected value in the node's data so the processor can read it
      inputNode.data._injectedValue = inputs[portIndex] ?? null;
    }
  }

  // Execute the inner graph (recursive — depth incremented)
  // The subgraph-input processor reads _injectedValue from node.data (set above)
  // Isolate graph variables: subgraphs get their own scope so set-var/get-var don't cross-contaminate
  const savedVars = getGraphVariablesContext();
  setGraphVariablesContext({});
  // Compute remaining timeout budget for inner graph
  const remainingMs = (maxExecutionMs && maxExecutionMs > 0 && parentStart !== undefined)
    ? Math.max(1, maxExecutionMs - (performance.now() - parentStart))
    : maxExecutionMs;
  let result: ExecutionResult;
  try {
    result = executeGraph(innerNodes, innerConnections, undefined, context, depth + 1, errorStrategy, undefined, remainingMs);
  } finally {
    setGraphVariablesContext(savedVars);
  }

  // If inner graph timed out, propagate as an error to the outer graph
  if (result.timedOut) {
    throw new Error(`Subgraph execution timed out`);
  }

  // Collect outputs from subgraph-output nodes
  const outputs: Record<number, unknown> = {};
  for (const { portIndex, innerNodeId } of def.exposedOutputs) {
    const outputResult = result.results.get(innerNodeId);
    if (outputResult) {
      outputs[portIndex] = outputResult.outputs[0] ?? null;
    } else {
      outputs[portIndex] = null;
    }
  }

  return outputs;
}

/**
 * Find a relevant tip from nodeHelp that matches the error message.
 * Returns a concise tip string, or empty string if no match found.
 */
function getRelevantHelpTip(nodeType: string, errorMsg: string): string {
  const help = getNodeHelp(nodeType);
  if (!help?.tips || help.tips.length === 0) return '';

  const lowerMsg = errorMsg.toLowerCase();

  // Try to match error keywords to tips
  for (const tip of help.tips) {
    const lowerTip = tip.toLowerCase();
    // Match on shared keywords between error and tip
    if (
      (lowerMsg.includes('type') && lowerTip.includes('type')) ||
      (lowerMsg.includes('input') && lowerTip.includes('input')) ||
      (lowerMsg.includes('null') && lowerTip.includes('disconnect')) ||
      (lowerMsg.includes('undefined') && lowerTip.includes('default')) ||
      (lowerMsg.includes('array') && lowerTip.includes('array')) ||
      (lowerMsg.includes('expression') && lowerTip.includes('expression')) ||
      (lowerMsg.includes('nan') && (lowerTip.includes('number') || lowerTip.includes('valid'))) ||
      (lowerMsg.includes('range') && lowerTip.includes('range'))
    ) {
      return tip;
    }
  }

  // No specific match — return the first tip as general guidance
  return help.tips[0];
}

/**
 * Execute the graph: topological sort, propagate data, cache results.
 * Uses the provided cache for incremental re-execution.
 * When subgraphContext is provided, subgraph nodes execute their inner graphs recursively.
 * @param errorStrategy - 'fail-fast' (default): stop on first error. 'continue': skip errored nodes, pass null downstream.
 */
export function executeGraph(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
  cache?: Map<string, NodeResult>,
  subgraphContext?: SubgraphContext,
  depth?: number,
  errorStrategy?: ErrorStrategy,
  graphVariables?: Record<string, unknown>,
  maxExecutionMs?: number,
): ExecutionResult {
  const currentDepth = depth ?? 0;
  const strategy = errorStrategy ?? 'fail-fast';
  const timeLimit = maxExecutionMs ?? 0; // 0 = no limit
  const graphStart = performance.now();
  // Set graph variables context for get-var/set-var processors (top-level only)
  // When graphVariables is provided, use it; otherwise preserve existing context
  // (callers like tests may pre-set context via setGraphVariablesContext)
  if (currentDepth === 0 && graphVariables !== undefined) {
    setGraphVariablesContext(graphVariables);
  }
  let waves: string[][];
  try {
    waves = topologicalSort(nodes, connections);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errors = new Map<string, string>([['__graph__', `Topology error: ${msg}`]]);
    return { results: new Map(cache ?? []), waves: [], errors, metrics: new Map(), totalDuration: 0 };
  }
  const results = new Map<string, NodeResult>(cache ?? []);
  const errors = new Map<string, string>();
  const metrics = new Map<string, NodeExecutionMetric>();

  // Pre-build connection index once — avoids O(C) scan per node in gatherInputs
  const connsByTarget = buildConnectionIndex(connections);

  for (const wave of waves) {
    // Check execution timeout at the start of each wave
    if (timeLimit > 0 && (performance.now() - graphStart) > timeLimit) {
      errors.set('__graph__', `Execution timeout: exceeded ${timeLimit}ms limit`);
      return { results, waves, errors, metrics, totalDuration: performance.now() - graphStart, timedOut: true };
    }

    for (const nodeId of wave) {
      const node = nodes[nodeId];
      if (!node) continue;

      const inputs = gatherInputs(nodeId, connsByTarget, results);
      const inputHash = hashInputs(inputs);

      // Check cache: if inputs haven't changed, skip re-execution
      // Unseeded random nodes are non-deterministic — always re-execute
      const isNonDeterministic =
        (node.type === 'random' && typeof node.data.seed !== 'number') ||
        node.type === 'timer' ||
        node.type === 'http-fetch' ||
        node.type === 'get-var' ||
        node.type === 'set-var' ||
        node.type === 'get-timestamp';
      const cached = results.get(nodeId);
      if (cached && cached.inputHash === inputHash && !isNonDeterministic) {
        metrics.set(nodeId, { duration: 0, cacheHit: true, timestamp: performance.now() });
        continue;
      }

      // Special handling for subgraph nodes when context is provided
      if (node.type === 'subgraph' && subgraphContext) {
        // Timeout check before subgraph execution (subgraph nodes skip the per-node check below)
        if (timeLimit > 0 && (performance.now() - graphStart) > timeLimit) {
          errors.set('__graph__', `Execution timeout: exceeded ${timeLimit}ms limit`);
          return { results, waves, errors, metrics, totalDuration: performance.now() - graphStart, timedOut: true };
        }
        const t0 = performance.now();
        try {
          const outputs = executeSubgraphNode(node, inputs, subgraphContext, currentDepth, strategy, timeLimit > 0 ? timeLimit : undefined, graphStart);
          results.set(nodeId, { outputs, inputHash });
          metrics.set(nodeId, { duration: performance.now() - t0, cacheHit: false, timestamp: t0 });
        } catch (err) {
          const rawMsg = err instanceof Error ? err.message : String(err);
          const message = `subgraph "${node.title}" (${nodeId}): ${rawMsg}`;
          errors.set(nodeId, message);
          results.set(nodeId, { outputs: {}, inputHash });
          metrics.set(nodeId, { duration: performance.now() - t0, cacheHit: false, timestamp: t0 });
          if (strategy === 'fail-fast') {
            return { results, waves, errors, metrics, totalDuration: performance.now() - graphStart };
          }
        }
        continue;
      }

      // Execute the node — check built-in processors first, then plugin registry
      const processor = processors[node.type] ?? getPluginProcessor(node.type);
      if (!processor) {
        errors.set(nodeId, `No processor for node type: ${node.type}`);
        results.set(nodeId, { outputs: {}, inputHash });
        metrics.set(nodeId, { duration: 0, cacheHit: false, timestamp: performance.now() });
        if (strategy === 'fail-fast') {
          return { results, waves, errors, metrics, totalDuration: performance.now() - graphStart };
        }
        continue;
      }
      // Per-node timeout check (between nodes within a wave)
      if (timeLimit > 0 && (performance.now() - graphStart) > timeLimit) {
        errors.set('__graph__', `Execution timeout: exceeded ${timeLimit}ms limit`);
        return { results, waves, errors, metrics, totalDuration: performance.now() - graphStart, timedOut: true };
      }
      const t0 = performance.now();
      try {
        const outputs = processor(node, inputs);
        results.set(nodeId, { outputs, inputHash });
        metrics.set(nodeId, { duration: performance.now() - t0, cacheHit: false, timestamp: t0 });
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        // Build contextual error message with node identity and truncated inputs
        let inputSummary = '';
        try {
          inputSummary = Object.entries(inputs)
            .map(([k, v]) => {
              let s: string;
              try {
                s = typeof v === 'object' ? JSON.stringify(v) : String(v);
              } catch {
                s = '[unserializable]';
              }
              return `[${k}]=${s.length > 50 ? s.slice(0, 50) + '...' : s}`;
            })
            .join(', ');
        } catch {
          inputSummary = '[error building summary]';
        }
        const context = `${node.type} "${node.title}" (${nodeId})`;
        let hint = '';
        if (err instanceof TypeError) hint = ' — check input types';
        else if (err instanceof RangeError) hint = ' — value out of range';
        const helpTip = getRelevantHelpTip(node.type, rawMsg);
        const message = `${context}: ${rawMsg}${hint}${helpTip ? ` | tip: ${helpTip}` : ''}${inputSummary ? ` | inputs: ${inputSummary}` : ''}`;
        errors.set(nodeId, message);
        results.set(nodeId, { outputs: {}, inputHash });
        metrics.set(nodeId, { duration: performance.now() - t0, cacheHit: false, timestamp: t0 });
        if (strategy === 'fail-fast') {
          return { results, waves, errors, metrics, totalDuration: performance.now() - graphStart };
        }
      }
    }
  }

  return { results, waves, errors, metrics, totalDuration: performance.now() - graphStart };
}

/**
 * Invalidate cache entries for a node and all its downstream dependents.
 * Uses a forward index (source → targets) for O(C + N) total instead of O(N*C).
 */
export function invalidateDownstream(
  nodeId: string,
  connections: Record<string, Connection>,
  cache: Map<string, unknown> | undefined,
): void {
  if (!cache) return;
  const fwd = buildForwardIndex(connections);
  const queue = [nodeId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    cache.delete(current);

    const targets = fwd.get(current);
    if (targets) {
      for (let i = 0; i < targets.length; i++) {
        queue.push(targets[i]);
      }
    }
  }
}

/**
 * Get all upstream node IDs in data flow order (sources first, target last).
 * Returns the path from root sources to the given node, BFS traversal.
 * Uses a reverse index (target → sources) for O(C + N) total instead of O(N*C).
 */
export function getUpstreamPath(
  nodeId: string,
  connections: Record<string, Connection>,
): string[] {
  const rev = buildReverseNodeIndex(connections);
  const path: string[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    path.push(current);

    const sources = rev.get(current);
    if (sources) {
      for (let i = 0; i < sources.length; i++) {
        if (!visited.has(sources[i])) queue.push(sources[i]);
      }
    }
  }

  // Reverse so sources come first, target last
  return path.reverse();
}

/**
 * Get all downstream node IDs in data flow order (source first, leaves last).
 * Returns the path from the given node to all downstream dependents, BFS traversal.
 * Uses a forward index (source → targets) for O(C + N) total instead of O(N*C).
 */
export function getDownstreamPath(
  nodeId: string,
  connections: Record<string, Connection>,
): string[] {
  const fwd = buildForwardIndex(connections);
  const path: string[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    path.push(current);

    const targets = fwd.get(current);
    if (targets) {
      for (let i = 0; i < targets.length; i++) {
        if (!visited.has(targets[i])) queue.push(targets[i]);
      }
    }
  }

  return path;
}

/**
 * Get the top N slowest nodes by execution duration.
 */
export function getBottleneckNodes(
  metrics: Record<string, NodeExecutionMetric>,
  n: number,
): { nodeId: string; duration: number; cacheHit: boolean }[] {
  return Object.entries(metrics)
    .map(([nodeId, m]) => ({ nodeId, duration: m.duration, cacheHit: m.cacheHit }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, n);
}

/**
 * Trace the data flow path through a node in a given direction.
 *
 * - 'upstream': returns all ancestor nodes in source→target order (sources first)
 * - 'downstream': returns all descendant nodes in source→target order (given node first)
 * - 'both': returns the union of upstream and downstream, deduplicated,
 *           ordered from upstream sources through the node to downstream leaves
 *
 * Cycle-safe via visited set (though DAGs shouldn't have cycles).
 */
export function traceDataFlow(
  nodeId: string,
  direction: 'upstream' | 'downstream' | 'both',
  connections: Record<string, Connection>,
): string[] {
  if (direction === 'upstream') {
    return getUpstreamPath(nodeId, connections);
  }
  if (direction === 'downstream') {
    return getDownstreamPath(nodeId, connections);
  }
  // 'both': merge upstream (sources first) + downstream (skip nodeId to avoid duplicate)
  const upstream = getUpstreamPath(nodeId, connections);
  const downstream = getDownstreamPath(nodeId, connections);
  const seen = new Set(upstream);
  const merged = [...upstream];
  for (const id of downstream) {
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }
  return merged;
}

/**
 * Get execution cache hit rate as a percentage (0-100).
 */
export function getCacheHitRate(
  metrics: Record<string, NodeExecutionMetric>,
): number {
  const entries = Object.values(metrics);
  if (entries.length === 0) return 0;
  const hits = entries.filter(m => m.cacheHit).length;
  return (hits / entries.length) * 100;
}

/**
 * Get execution timeline: ordered list of nodes by execution start time.
 */
export function getExecutionTimeline(
  metrics: Record<string, NodeExecutionMetric>,
): { nodeId: string; startTime: number; duration: number }[] {
  return Object.entries(metrics)
    .map(([nodeId, m]) => ({ nodeId, startTime: m.timestamp, duration: m.duration }))
    .sort((a, b) => a.startTime - b.startTime);
}

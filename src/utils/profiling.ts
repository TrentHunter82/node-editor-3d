import type { EditorNode, Connection, NodeExecutionMetric, NodeType } from '../types';

// --- Data Flow Tracing ---

/**
 * Returns an ordered array of node IDs upstream of the given node
 * (all nodes that feed data into this node, transitively).
 * The result is in reverse topological order (closest first).
 */
export function getUpstreamPath(
  nodeId: string,
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): string[] {
  const upstream: string[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];
  visited.add(nodeId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    // Find all connections targeting this node
    for (const conn of Object.values(connections)) {
      if (conn.targetNodeId === current && !visited.has(conn.sourceNodeId)) {
        if (nodes[conn.sourceNodeId]) {
          visited.add(conn.sourceNodeId);
          upstream.push(conn.sourceNodeId);
          queue.push(conn.sourceNodeId);
        }
      }
    }
  }

  return upstream;
}

/**
 * Returns an ordered array of node IDs downstream of the given node
 * (all nodes that receive data from this node, transitively).
 * The result is in topological order (closest first).
 */
export function getDownstreamPath(
  nodeId: string,
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): string[] {
  const downstream: string[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];
  visited.add(nodeId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    // Find all connections from this node
    for (const conn of Object.values(connections)) {
      if (conn.sourceNodeId === current && !visited.has(conn.targetNodeId)) {
        if (nodes[conn.targetNodeId]) {
          visited.add(conn.targetNodeId);
          downstream.push(conn.targetNodeId);
          queue.push(conn.targetNodeId);
        }
      }
    }
  }

  return downstream;
}

// --- Profiling Aggregation ---

export interface TimelineEntry {
  nodeId: string;
  startTime: number;
  duration: number;
}

/**
 * Returns the top N slowest nodes by execution duration.
 * Excludes cache hits (duration=0, cacheHit=true).
 */
export function getBottleneckNodes(
  metrics: Record<string, NodeExecutionMetric>,
  n: number,
): { nodeId: string; duration: number }[] {
  return Object.entries(metrics)
    .filter(([, m]) => !m.cacheHit)
    .sort(([, a], [, b]) => b.duration - a.duration)
    .slice(0, n)
    .map(([nodeId, m]) => ({ nodeId, duration: m.duration }));
}

/**
 * Returns the cache hit rate as a percentage (0-100).
 * Returns 0 if no metrics exist.
 */
export function getCacheHitRate(
  metrics: Record<string, NodeExecutionMetric>,
): number {
  const entries = Object.values(metrics);
  if (entries.length === 0) return 0;
  const cacheHits = entries.filter(m => m.cacheHit).length;
  return (cacheHits / entries.length) * 100;
}

/**
 * Returns an ordered timeline of execution events, sorted by start time.
 */
export function getExecutionTimeline(
  metrics: Record<string, NodeExecutionMetric>,
): TimelineEntry[] {
  return Object.entries(metrics)
    .map(([nodeId, m]) => ({
      nodeId,
      startTime: m.timestamp,
      duration: m.duration,
    }))
    .sort((a, b) => a.startTime - b.startTime);
}

// --- Graph Analytics ---

export interface GraphAnalytics {
  nodeCount: number;
  connectionCount: number;
  nodeCountByType: Partial<Record<NodeType, number>>;
  connectionDensity: number;
  criticalPathLength: number;
  criticalPath: string[];
}

/**
 * Returns a count of nodes grouped by their type.
 */
export function getNodeCountByType(
  nodes: Record<string, EditorNode>,
): Partial<Record<NodeType, number>> {
  const counts: Partial<Record<NodeType, number>> = {};
  for (const node of Object.values(nodes)) {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
  }
  return counts;
}

/**
 * Returns the connection density: actual connections / max possible connections.
 * Max possible = total output ports * total input ports (excluding self-loops).
 * Returns 0 for graphs with no possible connections.
 */
export function getConnectionDensity(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): number {
  const nodeArr = Object.values(nodes);
  const totalOutputs = nodeArr.reduce((sum, n) => sum + n.outputs.length, 0);
  const totalInputs = nodeArr.reduce((sum, n) => sum + n.inputs.length, 0);
  const maxConnections = totalOutputs * totalInputs;
  if (maxConnections === 0) return 0;
  return Object.keys(connections).length / maxConnections;
}

/**
 * Finds the critical path (longest chain) through the graph using topological ordering.
 * If metrics are provided, uses execution duration as weight; otherwise counts nodes.
 * Returns { length, path } where length is the weighted length and path is the node ID sequence.
 */
export function getCriticalPath(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
  metrics?: Record<string, NodeExecutionMetric>,
): { length: number; path: string[] } {
  const nodeIds = Object.keys(nodes);
  if (nodeIds.length === 0) return { length: 0, path: [] };

  // Build adjacency list and in-degree map
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const id of nodeIds) {
    adj.set(id, []);
    inDeg.set(id, 0);
  }
  for (const conn of Object.values(connections)) {
    if (nodes[conn.sourceNodeId] && nodes[conn.targetNodeId]) {
      adj.get(conn.sourceNodeId)!.push(conn.targetNodeId);
      inDeg.set(conn.targetNodeId, (inDeg.get(conn.targetNodeId) ?? 0) + 1);
    }
  }

  // Topological sort via Kahn's algorithm, tracking longest path
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const queue: string[] = [];

  for (const id of nodeIds) {
    const weight = metrics?.[id]?.cacheHit ? 0 : (metrics?.[id]?.duration ?? 1);
    const isRoot = inDeg.get(id) === 0;
    // Root nodes start with their own weight; non-root nodes start at 0
    // (their distance is updated when visited from predecessors)
    dist.set(id, isRoot ? weight : 0);
    prev.set(id, null);
    if (isRoot) queue.push(id);
  }

  let processedCount = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processedCount++;
    const currentDist = dist.get(current)!;
    for (const neighbor of adj.get(current)!) {
      const neighborWeight = metrics?.[neighbor]?.cacheHit ? 0 : (metrics?.[neighbor]?.duration ?? 1);
      const newDist = currentDist + neighborWeight;
      if (newDist > dist.get(neighbor)!) {
        dist.set(neighbor, newDist);
        prev.set(neighbor, current);
      }
      const newInDeg = inDeg.get(neighbor)! - 1;
      inDeg.set(neighbor, newInDeg);
      if (newInDeg === 0) queue.push(neighbor);
    }
  }

  // If not all nodes were processed, graph has a cycle — return empty result
  if (processedCount < nodeIds.length) {
    return { length: 0, path: [] };
  }

  // Find the node with maximum distance (end of critical path)
  let maxDist = -Infinity;
  let endNode = '';
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  // Guard: when all nodes have zero weight (e.g. all cache hits), return empty path
  if (!endNode || maxDist <= 0) return { length: 0, path: [] };

  // Reconstruct path
  const path: string[] = [];
  let cur: string | null = endNode;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  return { length: maxDist, path };
}

/**
 * Detects structural bottlenecks: nodes with high fan-in (many incoming connections)
 * that create serialization points in the graph.
 * Returns nodes sorted by fan-in count (descending), with a minimum threshold.
 */
export function detectBottlenecks(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
  minFanIn = 2,
): { nodeId: string; fanIn: number; fanOut: number }[] {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const id of Object.keys(nodes)) {
    fanIn.set(id, 0);
    fanOut.set(id, 0);
  }
  for (const conn of Object.values(connections)) {
    if (nodes[conn.targetNodeId]) {
      fanIn.set(conn.targetNodeId, (fanIn.get(conn.targetNodeId) ?? 0) + 1);
    }
    if (nodes[conn.sourceNodeId]) {
      fanOut.set(conn.sourceNodeId, (fanOut.get(conn.sourceNodeId) ?? 0) + 1);
    }
  }
  return Array.from(fanIn.entries())
    .filter(([, count]) => count >= minFanIn)
    .sort(([, a], [, b]) => b - a)
    .map(([nodeId, fi]) => ({
      nodeId,
      fanIn: fi,
      fanOut: fanOut.get(nodeId) ?? 0,
    }));
}

/**
 * Computes comprehensive graph analytics in a single pass.
 */
export function getGraphAnalytics(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
  metrics?: Record<string, NodeExecutionMetric>,
): GraphAnalytics {
  const { length, path } = getCriticalPath(nodes, connections, metrics);
  return {
    nodeCount: Object.keys(nodes).length,
    connectionCount: Object.keys(connections).length,
    nodeCountByType: getNodeCountByType(nodes),
    connectionDensity: getConnectionDensity(nodes, connections),
    criticalPathLength: length,
    criticalPath: path,
  };
}

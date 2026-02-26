import type { EditorNode, Connection } from '../types';

export interface GraphComplexity {
  nodeCount: number;
  connectionCount: number;
  maxFanIn: number;
  maxFanOut: number;
  avgConnectivity: number;
  longestPath: number;
  cyclomaticComplexity: number;
  connectedComponents: number;
  isolatedNodes: number;
}

/**
 * Computes comprehensive graph complexity metrics in a single pass.
 * All metrics are structure-based (no execution timing needed).
 */
export function getGraphComplexity(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): GraphComplexity {
  const nodeIds = Object.keys(nodes);
  const nodeCount = nodeIds.length;
  const conns = Object.values(connections);
  const connectionCount = conns.length;

  if (nodeCount === 0) {
    return {
      nodeCount: 0, connectionCount: 0, maxFanIn: 0, maxFanOut: 0,
      avgConnectivity: 0, longestPath: 0, cyclomaticComplexity: 0,
      connectedComponents: 0, isolatedNodes: 0,
    };
  }

  // Build fan-in/fan-out and adjacency
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  // Undirected adjacency for connected components
  const undirected = new Map<string, Set<string>>();

  for (const id of nodeIds) {
    fanIn.set(id, 0);
    fanOut.set(id, 0);
    adj.set(id, []);
    inDeg.set(id, 0);
    undirected.set(id, new Set());
  }

  let validConnectionCount = 0;
  for (const conn of conns) {
    if (!nodes[conn.sourceNodeId] || !nodes[conn.targetNodeId]) continue;
    validConnectionCount++;
    fanIn.set(conn.targetNodeId, (fanIn.get(conn.targetNodeId) ?? 0) + 1);
    fanOut.set(conn.sourceNodeId, (fanOut.get(conn.sourceNodeId) ?? 0) + 1);
    adj.get(conn.sourceNodeId)!.push(conn.targetNodeId);
    inDeg.set(conn.targetNodeId, (inDeg.get(conn.targetNodeId) ?? 0) + 1);
    undirected.get(conn.sourceNodeId)!.add(conn.targetNodeId);
    undirected.get(conn.targetNodeId)!.add(conn.sourceNodeId);
  }

  // Max fan-in / fan-out
  let maxFI = 0, maxFO = 0, totalDeg = 0;
  for (const id of nodeIds) {
    const fi = fanIn.get(id)!;
    const fo = fanOut.get(id)!;
    if (fi > maxFI) maxFI = fi;
    if (fo > maxFO) maxFO = fo;
    totalDeg += fi + fo;
  }

  const avgConnectivity = nodeCount > 0 ? totalDeg / nodeCount : 0;

  // Connected components (undirected BFS)
  const visited = new Set<string>();
  let connectedComponents = 0;
  let isolatedNodes = 0;

  for (const id of nodeIds) {
    if (visited.has(id)) continue;
    connectedComponents++;
    const neighbors = undirected.get(id)!;
    if (neighbors.size === 0) {
      isolatedNodes++;
      visited.add(id);
      continue;
    }
    // BFS
    const queue = [id];
    visited.add(id);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      undirected.get(cur)!.forEach((nb) => {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      });
    }
  }

  // Longest path via topological sort (Kahn's algorithm, count = node hops)
  // On cyclic graphs, cycle nodes are never dequeued — only report paths for acyclic portion
  const dist = new Map<string, number>();
  const tQueue: string[] = [];
  const tempInDeg = new Map(inDeg);

  for (const id of nodeIds) {
    dist.set(id, 1); // each node counts as 1
    if (tempInDeg.get(id) === 0) tQueue.push(id);
  }

  let processedCount = 0;
  while (tQueue.length > 0) {
    const cur = tQueue.shift()!;
    processedCount++;
    for (const nb of adj.get(cur)!) {
      const newDist = dist.get(cur)! + 1;
      if (newDist > dist.get(nb)!) dist.set(nb, newDist);
      const nd = tempInDeg.get(nb)! - 1;
      tempInDeg.set(nb, nd);
      if (nd === 0) tQueue.push(nb);
    }
  }

  let longestPath = 0;
  // Only count distances for nodes that were processed (not stuck in cycles)
  if (processedCount === nodeCount) {
    dist.forEach((d) => {
      if (d > longestPath) longestPath = d;
    });
  } else {
    // Graph has cycles — report longest path from the acyclic portion only
    for (const [id, d] of dist) {
      if (tempInDeg.get(id) === 0 && d > longestPath) longestPath = d;
    }
  }

  // Cyclomatic complexity: E - N + 2P (valid edges - nodes + 2 * connected components)
  const cyclomaticComplexity = validConnectionCount - nodeCount + 2 * connectedComponents;

  return {
    nodeCount,
    connectionCount,
    maxFanIn: maxFI,
    maxFanOut: maxFO,
    avgConnectivity: Math.round(avgConnectivity * 100) / 100,
    longestPath,
    cyclomaticComplexity: Math.max(1, cyclomaticComplexity),
    connectedComponents,
    isolatedNodes,
  };
}

import type { Connection } from '../types';

/**
 * Traces data flow upstream or downstream from a node through connections.
 * Returns ordered list of node IDs in the flow path.
 * Handles branches (fan-out), merges (fan-in), and is cycle-safe.
 *
 * - 'upstream': follow connections backwards (find connections where targetNodeId === current, go to sourceNodeId)
 * - 'downstream': follow connections forwards (find connections where sourceNodeId === current, go to targetNodeId)
 * - BFS order (breadth-first)
 * - Visited set for cycle safety
 * - Does NOT include the starting nodeId in results
 * - Returns unique node IDs in BFS order
 */
export function traceDataFlow(
  nodeId: string,
  direction: 'upstream' | 'downstream',
  connections: Record<string, Connection>,
): string[] {
  const visited = new Set<string>();
  visited.add(nodeId);

  const result: string[] = [];
  const queue: string[] = [nodeId];

  const connArray = Object.values(connections);

  while (queue.length > 0) {
    const current = queue.shift()!;

    let neighbors: string[];

    if (direction === 'downstream') {
      // Follow connections forward: current is the source, get target nodes
      neighbors = connArray
        .filter((c) => c.sourceNodeId === current)
        .map((c) => c.targetNodeId);
    } else {
      // Follow connections backward: current is the target, get source nodes
      neighbors = connArray
        .filter((c) => c.targetNodeId === current)
        .map((c) => c.sourceNodeId);
    }

    for (const neighbor of neighbors) {
      // Skip self-referencing connections and already-visited nodes
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        result.push(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return result;
}

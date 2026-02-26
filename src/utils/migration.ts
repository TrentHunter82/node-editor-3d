/**
 * State migration framework for versioned persistence.
 *
 * Each migration transforms data from version N to N+1. Migrations run
 * sequentially when loading data that is older than the current version.
 *
 * Currently the multi-graph storage format is v2 with no sub-versions.
 * This framework is infrastructure for future schema changes.
 */

import type { EditorNode, Connection, NodeGroup, CustomNodeDef, SubgraphNodeDef, GraphData } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A migration function transforms graph data in-place from version N to N+1. */
export type MigrationFn = (graphData: MigratableGraphData) => void;

/** Subset of per-graph data that migrations can modify. */
export interface MigratableGraphData {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups: Record<string, NodeGroup>;
  customNodeDefs: Record<string, CustomNodeDef>;
  subgraphDefs?: Record<string, SubgraphNodeDef>;
  [key: string]: unknown;
}

/** Registry entry: a migration from `fromVersion` to `fromVersion + 1`. */
interface MigrationEntry {
  fromVersion: number;
  description: string;
  migrate: MigrationFn;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Current data schema version. Bump when adding a new migration. */
export const CURRENT_SCHEMA_VERSION = 1;

const migrations: MigrationEntry[] = [
  // Example: when adding a new required field in the future:
  // {
  //   fromVersion: 1,
  //   description: 'Add myNewField to all nodes',
  //   migrate: (data) => {
  //     for (const node of Object.values(data.nodes)) {
  //       if (node.myNewField === undefined) node.myNewField = defaultValue;
  //     }
  //   },
  // },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all necessary migrations on `graphData` from `fromVersion` to current.
 * Mutates `graphData` in place. Returns the final version number.
 */
export function migrateGraphData(
  graphData: MigratableGraphData,
  fromVersion: number,
): number {
  let version = fromVersion;
  for (const entry of migrations) {
    if (entry.fromVersion === version) {
      entry.migrate(graphData);
      version = entry.fromVersion + 1;
    }
  }
  return version;
}

/**
 * Validate and normalize individual node fields.
 * Fixes common corruption patterns without rejecting the entire graph.
 */
export function normalizeNode(node: Record<string, unknown>): boolean {
  if (typeof node.id !== 'string' || node.id === '') return false;
  if (typeof node.type !== 'string') return false;

  // Position must be a 3-element numeric array
  if (!Array.isArray(node.position) || node.position.length !== 3) {
    node.position = [0, 0, 0];
  } else {
    for (let i = 0; i < 3; i++) {
      if (typeof node.position[i] !== 'number' || !Number.isFinite(node.position[i])) {
        node.position[i] = 0;
      }
    }
  }

  if (typeof node.title !== 'string') node.title = String(node.type ?? 'Node');
  if (node.data === null || typeof node.data !== 'object' || Array.isArray(node.data)) {
    node.data = {};
  }
  if (!Array.isArray(node.inputs)) node.inputs = [];
  if (!Array.isArray(node.outputs)) node.outputs = [];

  return true;
}

/**
 * Validate and normalize an individual connection.
 * Returns false if the connection is irrecoverably corrupt.
 */
export function normalizeConnection(conn: Record<string, unknown>): boolean {
  if (typeof conn.id !== 'string' || conn.id === '') return false;
  if (typeof conn.sourceNodeId !== 'string' || conn.sourceNodeId === '') return false;
  if (typeof conn.targetNodeId !== 'string' || conn.targetNodeId === '') return false;
  if (typeof conn.sourcePortIndex !== 'number' || !Number.isInteger(conn.sourcePortIndex) || conn.sourcePortIndex < 0) return false;
  if (typeof conn.targetPortIndex !== 'number' || !Number.isInteger(conn.targetPortIndex) || conn.targetPortIndex < 0) return false;
  return true;
}

/**
 * Validate and normalize all nodes and connections in a graph.
 * Removes invalid entries, preserving whatever can be recovered.
 */
export function validateGraphData(graphData: MigratableGraphData | GraphData): void {
  // Validate nodes
  const invalidNodeIds: string[] = [];
  for (const [id, node] of Object.entries(graphData.nodes)) {
    const nodeObj = node as unknown as Record<string, unknown>;
    if (!normalizeNode(nodeObj)) {
      invalidNodeIds.push(id);
    }
  }
  for (const id of invalidNodeIds) {
    delete graphData.nodes[id];
  }

  // Validate connections — remove those with invalid structure or dangling references
  const invalidConnIds: string[] = [];
  for (const [id, conn] of Object.entries(graphData.connections)) {
    const connObj = conn as unknown as Record<string, unknown>;
    if (!normalizeConnection(connObj)) {
      invalidConnIds.push(id);
      continue;
    }
    // Check that referenced nodes exist
    if (!graphData.nodes[conn.sourceNodeId] || !graphData.nodes[conn.targetNodeId]) {
      invalidConnIds.push(id);
      continue;
    }
    // Check port indices are within bounds
    const src = graphData.nodes[conn.sourceNodeId];
    const tgt = graphData.nodes[conn.targetNodeId];
    if (conn.sourcePortIndex >= src.outputs.length || conn.targetPortIndex >= tgt.inputs.length) {
      invalidConnIds.push(id);
    }
  }
  for (const id of invalidConnIds) {
    delete graphData.connections[id];
  }

  // Validate groups — remove those with no ID
  for (const [id, group] of Object.entries(graphData.groups)) {
    if (typeof (group as unknown as Record<string, unknown>).id !== 'string') {
      delete graphData.groups[id];
    }
  }

  // Clear groupId references that point to deleted groups
  for (const node of Object.values(graphData.nodes)) {
    if (node.groupId && !graphData.groups[node.groupId]) {
      node.groupId = undefined;
    }
  }
}

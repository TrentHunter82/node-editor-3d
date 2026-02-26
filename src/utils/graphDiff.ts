import type { EditorNode, Connection } from '../types';

/** Summary metadata for a single undo snapshot (cheap to compute without full diff) */
export interface SnapshotSummary {
  label: string;
  timestamp: number;
  nodeCount: number;
  connectionCount: number;
  /** Index in the undo stack, or -1 for current state */
  index: number;
}

/** Enhanced GraphDiff with snapshot metadata for richer diff display */
export interface EnrichedGraphDiff extends GraphDiff {
  /** Metadata about the "before" snapshot */
  snapshotA: SnapshotSummary;
  /** Metadata about the "after" snapshot */
  snapshotB: SnapshotSummary;
  /** Delta in node count (B - A) */
  nodeCountDelta: number;
  /** Delta in connection count (B - A) */
  connectionCountDelta: number;
}

export interface NodeChange {
  nodeId: string;
  type: 'added' | 'removed' | 'modified';
  /** Present for 'modified' — which fields changed */
  changedFields?: string[];
  /** The node in state A (for removed/modified) */
  before?: EditorNode;
  /** The node in state B (for added/modified) */
  after?: EditorNode;
}

export interface ConnectionChange {
  connectionId: string;
  type: 'added' | 'removed' | 'modified';
  changedFields?: string[];
  before?: Connection;
  after?: Connection;
}

export interface GraphDiff {
  nodeChanges: NodeChange[];
  connectionChanges: ConnectionChange[];
  summary: {
    nodesAdded: number;
    nodesRemoved: number;
    nodesModified: number;
    connectionsAdded: number;
    connectionsRemoved: number;
    connectionsModified: number;
  };
  isEmpty: boolean;
}

/** Compare specific fields of two nodes to find changes */
function diffNode(a: EditorNode, b: EditorNode): string[] {
  const changed: string[] = [];

  if (a.type !== b.type) changed.push('type');
  if (a.title !== b.title) changed.push('title');

  // Deep compare position (tuple of 3 numbers)
  if (
    a.position[0] !== b.position[0] ||
    a.position[1] !== b.position[1] ||
    a.position[2] !== b.position[2]
  ) {
    changed.push('position');
  }

  // Compare data by serialization
  if (JSON.stringify(a.data) !== JSON.stringify(b.data)) changed.push('data');

  if (a.comment !== b.comment) changed.push('comment');
  if (a.locked !== b.locked) changed.push('locked');
  if (a.collapsed !== b.collapsed) changed.push('collapsed');
  if (a.groupId !== b.groupId) changed.push('groupId');
  if (a.autoInserted !== b.autoInserted) changed.push('autoInserted');

  // Compare dynamic port definitions (custom nodes have mutable ports)
  if (JSON.stringify(a.inputs) !== JSON.stringify(b.inputs)) changed.push('inputs');
  if (JSON.stringify(a.outputs) !== JSON.stringify(b.outputs)) changed.push('outputs');

  return changed;
}

/** Compare specific fields of two connections to find changes */
function diffConnection(a: Connection, b: Connection): string[] {
  const changed: string[] = [];

  if (a.sourceNodeId !== b.sourceNodeId) changed.push('sourceNodeId');
  if (a.sourcePortIndex !== b.sourcePortIndex) changed.push('sourcePortIndex');
  if (a.targetNodeId !== b.targetNodeId) changed.push('targetNodeId');
  if (a.targetPortIndex !== b.targetPortIndex) changed.push('targetPortIndex');
  if (a.label !== b.label) changed.push('label');
  if (a.colorOverride !== b.colorOverride) changed.push('colorOverride');
  if (a.styleOverride !== b.styleOverride) changed.push('styleOverride');

  return changed;
}

export function compareGraphs(
  nodesA: Record<string, EditorNode>,
  connectionsA: Record<string, Connection>,
  nodesB: Record<string, EditorNode>,
  connectionsB: Record<string, Connection>,
): GraphDiff {
  const nodeChanges: NodeChange[] = [];
  const connectionChanges: ConnectionChange[] = [];

  // Collect all node IDs from both states
  const allNodeIds = new Set<string>([
    ...Object.keys(nodesA),
    ...Object.keys(nodesB),
  ]);

  for (const id of allNodeIds) {
    const inA = id in nodesA;
    const inB = id in nodesB;

    if (inB && !inA) {
      nodeChanges.push({ nodeId: id, type: 'added', after: nodesB[id] });
    } else if (inA && !inB) {
      nodeChanges.push({ nodeId: id, type: 'removed', before: nodesA[id] });
    } else {
      const changedFields = diffNode(nodesA[id], nodesB[id]);
      if (changedFields.length > 0) {
        nodeChanges.push({
          nodeId: id,
          type: 'modified',
          changedFields,
          before: nodesA[id],
          after: nodesB[id],
        });
      }
    }
  }

  // Collect all connection IDs from both states
  const allConnectionIds = new Set<string>([
    ...Object.keys(connectionsA),
    ...Object.keys(connectionsB),
  ]);

  for (const id of allConnectionIds) {
    const inA = id in connectionsA;
    const inB = id in connectionsB;

    if (inB && !inA) {
      connectionChanges.push({
        connectionId: id,
        type: 'added',
        after: connectionsB[id],
      });
    } else if (inA && !inB) {
      connectionChanges.push({
        connectionId: id,
        type: 'removed',
        before: connectionsA[id],
      });
    } else {
      const changedFields = diffConnection(connectionsA[id], connectionsB[id]);
      if (changedFields.length > 0) {
        connectionChanges.push({
          connectionId: id,
          type: 'modified',
          changedFields,
          before: connectionsA[id],
          after: connectionsB[id],
        });
      }
    }
  }

  const nodesAdded = nodeChanges.filter((c) => c.type === 'added').length;
  const nodesRemoved = nodeChanges.filter((c) => c.type === 'removed').length;
  const nodesModified = nodeChanges.filter((c) => c.type === 'modified').length;
  const connectionsAdded = connectionChanges.filter((c) => c.type === 'added').length;
  const connectionsRemoved = connectionChanges.filter((c) => c.type === 'removed').length;
  const connectionsModified = connectionChanges.filter((c) => c.type === 'modified').length;

  return {
    nodeChanges,
    connectionChanges,
    summary: {
      nodesAdded,
      nodesRemoved,
      nodesModified,
      connectionsAdded,
      connectionsRemoved,
      connectionsModified,
    },
    isEmpty: nodeChanges.length === 0 && connectionChanges.length === 0,
  };
}

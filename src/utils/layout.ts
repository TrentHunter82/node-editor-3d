import type { EditorNode, Connection } from '../types';
import { topologicalSort } from './execution';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../store/slices/nodeSlice';

const LAYER_SPACING = 3.5; // X distance between layers
const NODE_SPACING = 2.0;  // Z distance between nodes in a layer

/** Get effective node width in world units. */
export function getNodeWidth(node: EditorNode): number {
  return node.width ?? DEFAULT_NODE_WIDTH;
}
/** Get effective node height (depth) in world units. */
export function getNodeHeight(node: EditorNode): number {
  return node.height ?? DEFAULT_NODE_HEIGHT;
}

/**
 * Simple layered graph layout (Sugiyama-style).
 * 1. Assign layers via topological sort waves
 * 2. Order within layers using barycenter heuristic
 * 3. Assign X/Z positions with even spacing
 */
export function layeredLayout(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): Record<string, [number, number, number]> {
  if (Object.keys(nodes).length === 0) return {};

  // Step 1: Get layers from topological sort
  let waves: string[][];
  try {
    waves = topologicalSort(nodes, connections);
  } catch {
    // Cycle detected - fall back to single layer with all nodes
    waves = [Object.keys(nodes)];
  }

  // Step 2: Barycenter ordering within layers to reduce edge crossings
  const conns = Object.values(connections);
  const nodeLayer = new Map<string, number>();
  for (let i = 0; i < waves.length; i++) {
    for (const id of waves[i]) {
      nodeLayer.set(id, i);
    }
  }

  // Build adjacency for barycenter calculation
  const incomingFrom = new Map<string, string[]>();
  for (const c of conns) {
    if (!incomingFrom.has(c.targetNodeId)) {
      incomingFrom.set(c.targetNodeId, []);
    }
    incomingFrom.get(c.targetNodeId)!.push(c.sourceNodeId);
  }

  // For each layer (starting from layer 1), sort by average position of connected nodes in previous layer
  for (let layerIdx = 1; layerIdx < waves.length; layerIdx++) {
    const prevLayer = waves[layerIdx - 1];
    const prevPositions = new Map<string, number>();
    prevLayer.forEach((id, idx) => prevPositions.set(id, idx));

    waves[layerIdx].sort((a, b) => {
      const aIncoming = (incomingFrom.get(a) ?? []).filter(id => prevPositions.has(id));
      const bIncoming = (incomingFrom.get(b) ?? []).filter(id => prevPositions.has(id));

      const aBarycenter = aIncoming.length > 0
        ? aIncoming.reduce((sum, id) => sum + (prevPositions.get(id) ?? 0), 0) / aIncoming.length
        : 0;
      const bBarycenter = bIncoming.length > 0
        ? bIncoming.reduce((sum, id) => sum + (prevPositions.get(id) ?? 0), 0) / bIncoming.length
        : 0;

      return aBarycenter - bBarycenter;
    });
  }

  // Step 3: Assign positions, accounting for variable node widths/heights
  const positions: Record<string, [number, number, number]> = {};

  // Compute per-layer max width for variable spacing
  const layerMaxWidth: number[] = [];
  for (let i = 0; i < waves.length; i++) {
    let maxW = 0;
    for (const nid of waves[i]) {
      const w = getNodeWidth(nodes[nid]);
      if (w > maxW) maxW = w;
    }
    layerMaxWidth.push(maxW);
  }

  // Compute cumulative X offset per layer (center-aligned)
  const layerX: number[] = [];
  let totalX = 0;
  for (let i = 0; i < waves.length; i++) {
    layerX.push(totalX);
    // Gap between this layer's edge and next layer's edge
    if (i < waves.length - 1) {
      totalX += (layerMaxWidth[i] / 2) + LAYER_SPACING + (layerMaxWidth[i + 1] / 2);
    }
  }
  // Center the whole layout around origin
  const midX = totalX / 2;

  for (let layerIdx = 0; layerIdx < waves.length; layerIdx++) {
    const layer = waves[layerIdx];

    // Compute per-node Z spacing based on max node height in this layer
    let maxH = 0;
    for (const nid of layer) {
      const h = getNodeHeight(nodes[nid]);
      if (h > maxH) maxH = h;
    }
    const effectiveSpacing = Math.max(NODE_SPACING, maxH + 0.4);
    const startZ = -((layer.length - 1) * effectiveSpacing) / 2;

    for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
      const nodeId = layer[nodeIdx];
      const y = nodes[nodeId]?.position[1] ?? 0; // Preserve Y
      positions[nodeId] = [
        layerX[layerIdx] - midX,
        y,
        startZ + nodeIdx * effectiveSpacing,
      ];
    }
  }

  return positions;
}

export type LayoutMode = 'layered' | 'force';

const FORCE_REPULSION = 8.0;
const FORCE_ATTRACTION = 0.15;
const FORCE_ITERATIONS = 80;
const FORCE_MIN_DIST = 0.5;
/** Max node count for O(N²) force-directed layout. Above this, fall back to layered. */
export const FORCE_LAYOUT_MAX_NODES = 150;

/**
 * Force-directed layout (Fruchterman-Reingold style).
 * Places nodes on XZ plane using spring-embedder algorithm.
 * Better than layered for densely connected or cyclic graphs.
 * For graphs exceeding FORCE_LAYOUT_MAX_NODES, falls back to layered layout
 * to avoid O(N²) repulsion cost.
 */
export function forceDirectedLayout(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): Record<string, [number, number, number]> {
  const nodeIds = Object.keys(nodes);
  if (nodeIds.length === 0) return {};
  if (nodeIds.length === 1) {
    return { [nodeIds[0]]: [0, nodes[nodeIds[0]].position[1], 0] };
  }

  // Performance guard: O(N²) repulsion is too expensive for large graphs
  if (nodeIds.length > FORCE_LAYOUT_MAX_NODES) {
    return layeredLayout(nodes, connections);
  }

  const conns = Object.values(connections).filter(
    c => nodes[c.sourceNodeId] && nodes[c.targetNodeId]
  );

  // Initialize positions in a circle
  const posX = new Map<string, number>();
  const posZ = new Map<string, number>();
  const velX = new Map<string, number>();
  const velZ = new Map<string, number>();
  const radius = Math.sqrt(nodeIds.length) * 2;

  for (let i = 0; i < nodeIds.length; i++) {
    const angle = (2 * Math.PI * i) / nodeIds.length;
    posX.set(nodeIds[i], radius * Math.cos(angle));
    posZ.set(nodeIds[i], radius * Math.sin(angle));
    velX.set(nodeIds[i], 0);
    velZ.set(nodeIds[i], 0);
  }

  for (let iter = 0; iter < FORCE_ITERATIONS; iter++) {
    const temp = 1 - iter / FORCE_ITERATIONS;

    // Reset displacement per iteration (standard Fruchterman-Reingold)
    for (const id of nodeIds) {
      velX.set(id, 0);
      velZ.set(id, 0);
    }

    // Repulsive forces (all pairs)
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = nodeIds[i], b = nodeIds[j];
        let dx = posX.get(a)! - posX.get(b)!;
        let dz = posZ.get(a)! - posZ.get(b)!;
        const rawDist = Math.sqrt(dx * dx + dz * dz);
        // Break symmetry when nodes overlap — add deterministic jitter
        if (rawDist < FORCE_MIN_DIST) {
          dx = (i - j) * 0.1;
          dz = (i + j) * 0.05;
        }
        const dist = Math.max(FORCE_MIN_DIST, rawDist);
        const force = (FORCE_REPULSION * FORCE_REPULSION) / dist;
        const fx = (dx / dist) * force;
        const fz = (dz / dist) * force;
        velX.set(a, velX.get(a)! + fx);
        velZ.set(a, velZ.get(a)! + fz);
        velX.set(b, velX.get(b)! - fx);
        velZ.set(b, velZ.get(b)! - fz);
      }
    }

    // Attractive forces (along edges)
    for (const conn of conns) {
      const a = conn.sourceNodeId, b = conn.targetNodeId;
      const dx = posX.get(a)! - posX.get(b)!;
      const dz = posZ.get(a)! - posZ.get(b)!;
      const dist = Math.max(FORCE_MIN_DIST, Math.sqrt(dx * dx + dz * dz));
      const force = dist * FORCE_ATTRACTION;
      const fx = (dx / dist) * force;
      const fz = (dz / dist) * force;
      velX.set(a, velX.get(a)! - fx);
      velZ.set(a, velZ.get(a)! - fz);
      velX.set(b, velX.get(b)! + fx);
      velZ.set(b, velZ.get(b)! + fz);
    }

    // Apply displacement clamped by temperature
    for (const id of nodeIds) {
      const vx = velX.get(id)!;
      const vz = velZ.get(id)!;
      const mag = Math.sqrt(vx * vx + vz * vz);
      if (mag > 0) {
        const clamp = Math.min(mag, temp * FORCE_REPULSION);
        posX.set(id, posX.get(id)! + (vx / mag) * clamp);
        posZ.set(id, posZ.get(id)! + (vz / mag) * clamp);
      }
    }
  }

  // Snap to grid-friendly positions (round to 0.5)
  const positions: Record<string, [number, number, number]> = {};
  for (const id of nodeIds) {
    const y = nodes[id].position[1];
    positions[id] = [
      Math.round(posX.get(id)! * 2) / 2,
      y,
      Math.round(posZ.get(id)! * 2) / 2,
    ];
  }

  return positions;
}

export type DistributeDirection = 'horizontal' | 'vertical';

/**
 * Evenly distribute selected nodes along an axis.
 * 'horizontal' distributes along X, 'vertical' distributes along Z.
 * Preserves the outermost positions and spaces inner nodes evenly.
 */
export function distributeNodes(
  selectedIds: string[],
  nodes: Record<string, EditorNode>,
  direction: DistributeDirection,
): Record<string, [number, number, number]> {
  if (selectedIds.length < 3) return {};

  const selectedNodes = selectedIds
    .map(id => nodes[id])
    .filter(Boolean);

  if (selectedNodes.length < 3) return {};

  const axis = direction === 'horizontal' ? 0 : 2; // X or Z
  const sorted = [...selectedNodes].sort((a, b) => a.position[axis] - b.position[axis]);
  const min = sorted[0].position[axis];
  const max = sorted[sorted.length - 1].position[axis];
  const step = (max - min) / (sorted.length - 1);

  const positions: Record<string, [number, number, number]> = {};
  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i];
    const pos: [number, number, number] = [...node.position];
    pos[axis] = min + step * i;
    positions[node.id] = pos;
  }

  return positions;
}

export type AlignDirection = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-z';

/**
 * Align selected nodes along an axis.
 * 'left'/'right' align X, 'top'/'bottom' align Z, 'center-x'/'center-z' align to average.
 */
export function alignNodes(
  selectedIds: string[],
  nodes: Record<string, EditorNode>,
  direction: AlignDirection,
): Record<string, [number, number, number]> {
  if (selectedIds.length < 2) return {};

  const selectedNodes = selectedIds
    .map(id => nodes[id])
    .filter(Boolean);

  if (selectedNodes.length < 2) return {};

  const positions: Record<string, [number, number, number]> = {};

  switch (direction) {
    case 'left': {
      const minX = Math.min(...selectedNodes.map(n => n.position[0]));
      for (const node of selectedNodes) {
        positions[node.id] = [minX, node.position[1], node.position[2]];
      }
      break;
    }
    case 'right': {
      const maxX = Math.max(...selectedNodes.map(n => n.position[0]));
      for (const node of selectedNodes) {
        positions[node.id] = [maxX, node.position[1], node.position[2]];
      }
      break;
    }
    case 'top': {
      const minZ = Math.min(...selectedNodes.map(n => n.position[2]));
      for (const node of selectedNodes) {
        positions[node.id] = [node.position[0], node.position[1], minZ];
      }
      break;
    }
    case 'bottom': {
      const maxZ = Math.max(...selectedNodes.map(n => n.position[2]));
      for (const node of selectedNodes) {
        positions[node.id] = [node.position[0], node.position[1], maxZ];
      }
      break;
    }
    case 'center-x': {
      const avgX = selectedNodes.reduce((s, n) => s + n.position[0], 0) / selectedNodes.length;
      for (const node of selectedNodes) {
        positions[node.id] = [avgX, node.position[1], node.position[2]];
      }
      break;
    }
    case 'center-z': {
      const avgZ = selectedNodes.reduce((s, n) => s + n.position[2], 0) / selectedNodes.length;
      for (const node of selectedNodes) {
        positions[node.id] = [node.position[0], node.position[1], avgZ];
      }
      break;
    }
  }

  return positions;
}

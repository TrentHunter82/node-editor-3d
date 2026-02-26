/**
 * Node bounding box cache and port position pre-computation.
 *
 * Provides O(1) lookup for node AABBs and port world positions.
 * Invalidated on node move/resize/add/remove.
 * Used by: routing algorithms, viewport culling, spatial queries, box selection.
 */
import type { EditorNode, Connection } from '../types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../store/slices/nodeSlice';
import { getPortWorldPos } from './portPositions';

/** Axis-aligned bounding box on XZ plane */
export interface NodeAABB {
  nodeId: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
}

/** Pre-computed port position: [x, y, z] */
export type PortPosition = [number, number, number];

/** Port position cache entry keyed by "nodeId:type:index" */
export interface PortPositionCache {
  /** Get cached port world position. Returns undefined if not cached. */
  get(nodeId: string, type: 'input' | 'output', portIndex: number): PortPosition | undefined;
  /** Number of cached entries */
  size: number;
}

/**
 * Build AABB cache for all nodes in a graph.
 * Returns a Map<nodeId, NodeAABB> for O(1) lookups.
 */
export function buildNodeAABBs(nodes: Record<string, EditorNode>): Map<string, NodeAABB> {
  const cache = new Map<string, NodeAABB>();
  for (const id in nodes) {
    if (!Object.prototype.hasOwnProperty.call(nodes, id)) continue;
    const node = nodes[id];
    const w = node.width ?? DEFAULT_NODE_WIDTH;
    const d = node.height ?? DEFAULT_NODE_HEIGHT;
    const [x, , z] = node.position;
    const halfW = w / 2;
    const halfD = d / 2;
    cache.set(id, {
      nodeId: id,
      minX: x - halfW,
      maxX: x + halfW,
      minZ: z - halfD,
      maxZ: z + halfD,
      centerX: x,
      centerZ: z,
      width: w,
      depth: d,
    });
  }
  return cache;
}

/**
 * Build port world position cache for all nodes.
 * Returns a lookup function and a Map for direct access.
 */
export function buildPortPositionCache(
  nodes: Record<string, EditorNode>,
): PortPositionCache {
  const cache = new Map<string, PortPosition>();

  for (const id in nodes) {
    if (!Object.prototype.hasOwnProperty.call(nodes, id)) continue;
    const node = nodes[id];
    const w = node.width ?? DEFAULT_NODE_WIDTH;
    const d = node.height ?? DEFAULT_NODE_HEIGHT;

    for (let i = 0; i < node.inputs.length; i++) {
      const key = `${id}:input:${i}`;
      cache.set(key, getPortWorldPos(node.position, 'input', i, node.inputs.length, w, d));
    }
    for (let i = 0; i < node.outputs.length; i++) {
      const key = `${id}:output:${i}`;
      cache.set(key, getPortWorldPos(node.position, 'output', i, node.outputs.length, w, d));
    }
  }

  return {
    get(nodeId: string, type: 'input' | 'output', portIndex: number): PortPosition | undefined {
      return cache.get(`${nodeId}:${type}:${portIndex}`);
    },
    size: cache.size,
  };
}

/**
 * Check if two AABBs overlap (on XZ plane) with optional margin.
 */
export function aabbsOverlap(a: NodeAABB, b: NodeAABB, margin = 0): boolean {
  return (
    a.minX - margin < b.maxX + margin &&
    a.maxX + margin > b.minX - margin &&
    a.minZ - margin < b.maxZ + margin &&
    a.maxZ + margin > b.minZ - margin
  );
}

/**
 * Check if a point is inside an AABB (on XZ plane).
 */
export function pointInAABB(x: number, z: number, aabb: NodeAABB): boolean {
  return x >= aabb.minX && x <= aabb.maxX && z >= aabb.minZ && z <= aabb.maxZ;
}

/**
 * Get node AABB for a single node (no cache, direct computation).
 */
export function getNodeAABB(node: EditorNode): NodeAABB {
  const w = node.width ?? DEFAULT_NODE_WIDTH;
  const d = node.height ?? DEFAULT_NODE_HEIGHT;
  const [x, , z] = node.position;
  const halfW = w / 2;
  const halfD = d / 2;
  return {
    nodeId: node.id,
    minX: x - halfW,
    maxX: x + halfW,
    minZ: z - halfD,
    maxZ: z + halfD,
    centerX: x,
    centerZ: z,
    width: w,
    depth: d,
  };
}

// ---------------------------------------------------------------------------
// Graph bounds and minimap projection
// ---------------------------------------------------------------------------

/** Bounding box for the entire graph on the XZ plane. */
export interface GraphBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  /** True when the graph has no nodes (bounds are zero). */
  empty: boolean;
}

/** Viewport rectangle for minimap projection. */
export interface MinimapViewport {
  /** Minimap width in CSS pixels. */
  width: number;
  /** Minimap height in CSS pixels. */
  height: number;
  /** Padding around nodes in world units (added to each side). Default: 2 */
  padding?: number;
}

/** Minimap projection result: maps world XZ coordinates to minimap pixel coordinates. */
export interface MinimapProjection {
  /** Scale factor: world units → CSS pixels. */
  scale: number;
  /** X offset in CSS pixels (world minX maps to this pixel). */
  offsetX: number;
  /** Z offset in CSS pixels (world minZ maps to this pixel). */
  offsetZ: number;
  /** Convert a world XZ position to minimap pixel coordinates. */
  project: (worldX: number, worldZ: number) => { x: number; y: number };
  /** Convert minimap pixel coordinates back to world XZ position. */
  unproject: (pixelX: number, pixelY: number) => { x: number; z: number };
}

/**
 * Compute the axis-aligned bounding box of all nodes in a graph,
 * accounting for per-node width/height (with fallback to defaults).
 * Returns a GraphBounds with empty=true when there are no nodes.
 */
export function getGraphBounds(nodes: Record<string, EditorNode>): GraphBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let count = 0;

  for (const id in nodes) {
    if (!Object.prototype.hasOwnProperty.call(nodes, id)) continue;
    const node = nodes[id];
    const w = node.width ?? DEFAULT_NODE_WIDTH;
    const d = node.height ?? DEFAULT_NODE_HEIGHT;
    const [x, , z] = node.position;
    const halfW = w / 2;
    const halfD = d / 2;
    if (x - halfW < minX) minX = x - halfW;
    if (x + halfW > maxX) maxX = x + halfW;
    if (z - halfD < minZ) minZ = z - halfD;
    if (z + halfD > maxZ) maxZ = z + halfD;
    count++;
  }

  if (count === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, centerX: 0, centerZ: 0, width: 0, depth: 0, empty: true };
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
    empty: false,
  };
}

/**
 * Compute a minimap projection that maps world XZ coordinates to pixel coordinates
 * within a minimap viewport of the given dimensions.
 *
 * Maintains aspect ratio — the scale is determined by the tighter axis.
 * The graph is centered within the viewport.
 */
export function getMinimapProjection(
  nodes: Record<string, EditorNode>,
  viewport: MinimapViewport,
): MinimapProjection {
  const bounds = getGraphBounds(nodes);
  const padding = viewport.padding ?? 2;
  const paddedW = bounds.width + padding * 2;
  const paddedD = bounds.depth + padding * 2;

  // Scale to fit, maintaining aspect ratio (use the tighter axis)
  const scale = (paddedW === 0 && paddedD === 0)
    ? 1
    : Math.min(viewport.width / Math.max(paddedW, 0.01), viewport.height / Math.max(paddedD, 0.01));

  // Offset so the padded bounds are centered in the viewport
  const worldLeft = bounds.empty ? 0 : bounds.minX - padding;
  const worldTop = bounds.empty ? 0 : bounds.minZ - padding;
  const renderedW = paddedW * scale;
  const renderedD = paddedD * scale;
  const offsetX = (viewport.width - renderedW) / 2;
  const offsetZ = (viewport.height - renderedD) / 2;

  return {
    scale,
    offsetX,
    offsetZ,
    project(worldX: number, worldZ: number) {
      return {
        x: (worldX - worldLeft) * scale + offsetX,
        y: (worldZ - worldTop) * scale + offsetZ,
      };
    },
    unproject(pixelX: number, pixelY: number) {
      return {
        x: (pixelX - offsetX) / scale + worldLeft,
        z: (pixelY - offsetZ) / scale + worldTop,
      };
    },
  };
}

/**
 * Test if a line segment (x1,z1)→(x2,z2) intersects an axis-aligned rect.
 * Uses Liang-Barsky algorithm for segment-AABB intersection.
 */
function segmentIntersectsRect(
  x1: number, z1: number, x2: number, z2: number,
  minX: number, minZ: number, maxX: number, maxZ: number,
): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;

  // Check each edge of the rect
  const edges = [
    { p: -dx, q: x1 - minX },  // left
    { p: dx,  q: maxX - x1 },  // right
    { p: -dz, q: z1 - minZ },  // bottom
    { p: dz,  q: maxZ - z1 },  // top
  ];

  for (let i = 0; i < 4; i++) {
    const { p, q } = edges[i];
    if (p === 0) {
      // Parallel to this edge — check if outside
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > tMax) return false;
        if (r > tMin) tMin = r;
      } else {
        if (r < tMin) return false;
        if (r < tMax) tMax = r;
      }
    }
  }

  return tMin <= tMax;
}

/**
 * Find all connections where either endpoint is in the rect OR the segment crosses the rect.
 * Uses pre-computed port positions for efficiency.
 */
export function findConnectionsInRect(
  connections: Record<string, Connection>,
  nodes: Record<string, EditorNode>,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): string[] {
  const result: string[] = [];
  for (const connId in connections) {
    if (!Object.prototype.hasOwnProperty.call(connections, connId)) continue;
    const conn = connections[connId];
    const srcNode = nodes[conn.sourceNodeId];
    const tgtNode = nodes[conn.targetNodeId];
    if (!srcNode || !tgtNode) continue;

    const srcW = srcNode.width ?? DEFAULT_NODE_WIDTH;
    const srcD = srcNode.height ?? DEFAULT_NODE_HEIGHT;
    const tgtW = tgtNode.width ?? DEFAULT_NODE_WIDTH;
    const tgtD = tgtNode.height ?? DEFAULT_NODE_HEIGHT;

    const srcPos = getPortWorldPos(srcNode.position, 'output', conn.sourcePortIndex, srcNode.outputs.length, srcW, srcD);
    const tgtPos = getPortWorldPos(tgtNode.position, 'input', conn.targetPortIndex, tgtNode.inputs.length, tgtW, tgtD);

    // Check if either endpoint is inside the rect
    const srcIn = srcPos[0] >= minX && srcPos[0] <= maxX && srcPos[2] >= minZ && srcPos[2] <= maxZ;
    const tgtIn = tgtPos[0] >= minX && tgtPos[0] <= maxX && tgtPos[2] >= minZ && tgtPos[2] <= maxZ;
    if (srcIn || tgtIn) {
      result.push(connId);
      continue;
    }
    // Check if the line segment between endpoints intersects the rect boundary
    // (handles connections that cross through the rect without endpoints inside)
    if (segmentIntersectsRect(srcPos[0], srcPos[2], tgtPos[0], tgtPos[2], minX, minZ, maxX, maxZ)) {
      result.push(connId);
    }
  }
  return result;
}

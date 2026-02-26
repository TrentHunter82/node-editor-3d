import type { EditorNode } from '../types';

// Import from nodeSlice - these are the defaults when node.width/height are unset
// DEFAULT_NODE_WIDTH = 1.6, DEFAULT_NODE_HEIGHT = 0.8
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../store/slices/nodeSlice';

export interface GraphBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;  // maxX - minX
  depth: number;  // maxZ - minZ
  centerX: number;
  centerZ: number;
}

/**
 * Computes the axis-aligned bounding box of all nodes,
 * accounting for node width and height (depth).
 * Returns null if no nodes.
 *
 * Node position is the CENTER of the node.
 * Node extends: position.x +/- width/2, position.z +/- height/2
 * Y axis is irrelevant for top-down minimap view.
 */
export function getGraphBounds(nodes: Record<string, EditorNode>): GraphBounds | null {
  const keys = Object.keys(nodes);
  if (keys.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const key of keys) {
    const node = nodes[key];
    const w = (node.width ?? DEFAULT_NODE_WIDTH) / 2;
    const h = (node.height ?? DEFAULT_NODE_HEIGHT) / 2;

    const left = node.position[0] - w;
    const right = node.position[0] + w;
    const top = node.position[2] - h;
    const bottom = node.position[2] + h;

    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
    if (top < minZ) minZ = top;
    if (bottom > maxZ) maxZ = bottom;
  }

  const width = maxX - minX;
  const depth = maxZ - minZ;

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width,
    depth,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
}

export interface MinimapViewport {
  width: number;   // minimap width in pixels
  height: number;  // minimap height in pixels
  padding: number; // padding in pixels (default 10)
}

export interface MinimapProjection {
  /** Scale factor from world units to pixels */
  scale: number;
  /** Offset to apply to world X to get pixel X */
  offsetX: number;
  /** Offset to apply to world Z to get pixel Y (Z maps to Y in 2D) */
  offsetZ: number;
}

/**
 * Maps world coordinates to minimap pixel coordinates.
 * Fits the graph bounds within the viewport with uniform scaling (aspect-ratio preserved).
 * Centers the graph in the viewport.
 * Returns null if bounds is null.
 */
export function getMinimapProjection(
  bounds: GraphBounds,
  viewport: MinimapViewport,
): MinimapProjection {
  const availW = viewport.width - 2 * viewport.padding;
  const availH = viewport.height - 2 * viewport.padding;

  let scale: number;

  if (bounds.width === 0 && bounds.depth === 0) {
    // All nodes stacked at the exact same position with same size:
    // Use a reasonable fallback that fits a single default node.
    scale = Math.min(availW / DEFAULT_NODE_WIDTH, availH / DEFAULT_NODE_HEIGHT);
  } else if (bounds.width === 0) {
    // All nodes share the same X extent — scale by depth only
    scale = availH / bounds.depth;
  } else if (bounds.depth === 0) {
    // All nodes share the same Z extent — scale by width only
    scale = availW / bounds.width;
  } else {
    scale = Math.min(availW / bounds.width, availH / bounds.depth);
  }

  const offsetX = viewport.width / 2 - bounds.centerX * scale;
  const offsetZ = viewport.height / 2 - bounds.centerZ * scale;

  return { scale, offsetX, offsetZ };
}

/**
 * Convert a world position to minimap pixel position.
 * worldX maps to pixelX, worldZ maps to pixelY (top-down view).
 */
export function worldToMinimap(
  worldX: number,
  worldZ: number,
  projection: MinimapProjection,
): { x: number; y: number } {
  return {
    x: worldX * projection.scale + projection.offsetX,
    y: worldZ * projection.scale + projection.offsetZ,
  };
}

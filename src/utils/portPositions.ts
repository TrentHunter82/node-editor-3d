import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../store/slices/nodeSlice';

// Re-export defaults so existing consumers that import NODE_W / NODE_D still work
export const NODE_W = DEFAULT_NODE_WIDTH;
export const NODE_D = DEFAULT_NODE_HEIGHT;

/**
 * Compute the world position of a port on a node.
 * Supports variable node sizes via optional nodeWidth/nodeDepth parameters.
 */
export function getPortWorldPos(
  nodePos: [number, number, number],
  type: 'input' | 'output',
  portIndex: number,
  portCount: number,
  nodeWidth?: number,
  nodeDepth?: number,
): [number, number, number] {
  const w = nodeWidth ?? DEFAULT_NODE_WIDTH;
  const d = nodeDepth ?? DEFAULT_NODE_HEIGHT;
  const side = type === 'output' ? w / 2 + 0.05 : -w / 2 - 0.05;
  const z = portCount <= 1 ? 0 : (portIndex / (portCount - 1) - 0.5) * (d - 0.2);
  return [nodePos[0] + side, nodePos[1], nodePos[2] + z];
}

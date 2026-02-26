/**
 * Node resize system and node bounds utilities tests (~40 tests).
 *
 * Covers:
 * - resizeNode store action (undo support, clamping, locked/no-op guards)
 * - setNodeSizes store action (batch hot-path, no undo, locked guard, clamping)
 * - getPortWorldPos with custom node dimensions
 * - buildNodeAABBs / buildPortPositionCache from nodeBounds.ts
 * - aabbsOverlap / pointInAABB spatial queries
 * - getNodeWidth / getNodeHeight layout helpers
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  MIN_NODE_WIDTH,
  MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  MAX_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
} from '../store/slices/nodeSlice';
import { getMinNodeDepth } from '../utils/nodeDepth';
import { getPortWorldPos } from '../utils/portPositions';
import {
  buildNodeAABBs,
  buildPortPositionCache,
  aabbsOverlap,
  pointInAABB,
  type NodeAABB,
} from '../utils/nodeBounds';
import { getNodeWidth, getNodeHeight } from '../utils/layout';
import type { EditorNode } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionTimings = {};
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.searchHighlightIds = new Set();
    s.traceNodeId = null;
  });
}

function getState() {
  return useEditorStore.getState();
}

function makeNode(
  id: string,
  pos: [number, number, number] = [0, 0, 0],
  overrides: Partial<EditorNode> = {},
): EditorNode {
  return {
    id,
    type: 'source',
    position: pos,
    title: id,
    data: {},
    inputs: [{ id: 'in-0', label: 'A', portType: 'number' }],
    outputs: [{ id: 'out-0', label: 'Out', portType: 'number' }],
    ...overrides,
  };
}

// ============================================================================
// 1. resizeNode store action
// ============================================================================
describe('resizeNode store action', () => {
  beforeEach(() => resetStore());

  it('resizes a node and stores custom width/height', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 2.5, 1.2);
    const node = getState().nodes[id];
    expect(node.width).toBe(2.5);
    expect(node.height).toBe(1.2);
  });

  it('clamps width to MIN_NODE_WIDTH', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 0.3, 1.0);
    expect(getState().nodes[id].width).toBe(MIN_NODE_WIDTH);
  });

  it('clamps width to MAX_NODE_WIDTH', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 10.0, 1.0);
    expect(getState().nodes[id].width).toBe(MAX_NODE_WIDTH);
  });

  it('clamps height to MIN_NODE_HEIGHT', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 2.0, 0.1);
    expect(getState().nodes[id].height).toBe(MIN_NODE_HEIGHT);
  });

  it('clamps height to MAX_NODE_HEIGHT', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 2.0, 99.0);
    expect(getState().nodes[id].height).toBe(MAX_NODE_HEIGHT);
  });

  it('is a no-op for locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);
    getState().resizeNode(id, 3.0, 2.0);
    // Size should remain at defaults (undefined means default)
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('is a no-op when size unchanged from current values', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const creationH = getMinNodeDepth('source', 0, 2);
    // Attempt to set to the same as current (width=default, height=creationH) — should not push undo
    getState().resizeNode(id, DEFAULT_NODE_WIDTH, creationH);
    // Node should not have explicit width set (still undefined), height stays at creation value
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(creationH);
  });

  it('is a no-op when size unchanged from current custom size', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.0, 1.5);
    expect(getState().nodes[id].width).toBe(3.0);
    // Resize to same values — no-op
    getState().resizeNode(id, 3.0, 1.5);
    // Still the same
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(1.5);
  });

  it('is a no-op for nonexistent node id', () => {
    // Should not throw
    expect(() => getState().resizeNode('nonexistent', 2.0, 1.0)).not.toThrow();
  });

  it('pushes undo and can be undone', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.0, 1.5);
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(1.5);

    getState().undo();
    // After undo, size should be back to defaults (undefined)
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('undo then redo restores the resized dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 2.0);
    getState().undo();
    getState().redo();
    expect(getState().nodes[id].width).toBe(4.0);
    expect(getState().nodes[id].height).toBe(2.0);
  });
});

// ============================================================================
// 2. setNodeSizes store action (hot path, no undo)
// ============================================================================
describe('setNodeSizes store action', () => {
  beforeEach(() => resetStore());

  it('batch-sets sizes for multiple nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('source', [3, 0, 0]);
    getState().setNodeSizes({
      [id1]: { width: 2.0, height: 1.0 },
      [id2]: { width: 3.5, height: 1.8 },
    });
    expect(getState().nodes[id1].width).toBe(2.0);
    expect(getState().nodes[id1].height).toBe(1.0);
    expect(getState().nodes[id2].width).toBe(3.5);
    expect(getState().nodes[id2].height).toBe(1.8);
  });

  it('skips locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);
    getState().setNodeSizes({ [id]: { width: 3.0, height: 2.0 } });
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('clamps values to constraints', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setNodeSizes({ [id]: { width: 0.2, height: 100.0 } });
    expect(getState().nodes[id].width).toBe(MIN_NODE_WIDTH);
    expect(getState().nodes[id].height).toBe(MAX_NODE_HEIGHT);
  });

  it('skips nonexistent node ids gracefully', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(() =>
      getState().setNodeSizes({
        [id]: { width: 2.0, height: 1.0 },
        nonexistent: { width: 3.0, height: 2.0 },
      }),
    ).not.toThrow();
    expect(getState().nodes[id].width).toBe(2.0);
  });
});

// ============================================================================
// 3. getPortWorldPos with custom dimensions
// ============================================================================
describe('getPortWorldPos with custom dimensions', () => {
  const nodePos: [number, number, number] = [5, 0, 3];

  it('default behavior (no custom dims) matches NODE_W=1.6, NODE_D=0.8', () => {
    const outPos = getPortWorldPos(nodePos, 'output', 0, 1);
    const expectedX = nodePos[0] + DEFAULT_NODE_WIDTH / 2 + 0.05;
    expect(outPos[0]).toBeCloseTo(expectedX, 5);
    expect(outPos[1]).toBe(nodePos[1]);
    // Single port: z offset is 0
    expect(outPos[2]).toBeCloseTo(nodePos[2], 5);
  });

  it('custom width shifts output port X position', () => {
    const customWidth = 3.0;
    const outPos = getPortWorldPos(nodePos, 'output', 0, 1, customWidth);
    const expectedX = nodePos[0] + customWidth / 2 + 0.05;
    expect(outPos[0]).toBeCloseTo(expectedX, 5);
  });

  it('custom width shifts input port X position', () => {
    const customWidth = 4.0;
    const inPos = getPortWorldPos(nodePos, 'input', 0, 1, customWidth);
    const expectedX = nodePos[0] - customWidth / 2 - 0.05;
    expect(inPos[0]).toBeCloseTo(expectedX, 5);
  });

  it('custom depth affects port Z distribution for multiple ports', () => {
    const customDepth = 2.0;
    // 3 ports: indices 0, 1, 2
    const pos0 = getPortWorldPos(nodePos, 'input', 0, 3, undefined, customDepth);
    const pos1 = getPortWorldPos(nodePos, 'input', 1, 3, undefined, customDepth);
    const pos2 = getPortWorldPos(nodePos, 'input', 2, 3, undefined, customDepth);

    // First port should be at -0.5 * (depth - 0.2), last at +0.5 * (depth - 0.2)
    const spread = customDepth - 0.2;
    expect(pos0[2]).toBeCloseTo(nodePos[2] - spread / 2, 5);
    expect(pos1[2]).toBeCloseTo(nodePos[2], 5); // middle port at center
    expect(pos2[2]).toBeCloseTo(nodePos[2] + spread / 2, 5);
  });

  it('larger depth produces wider port spacing than default', () => {
    const defaultPos0 = getPortWorldPos(nodePos, 'input', 0, 2);
    const defaultPos1 = getPortWorldPos(nodePos, 'input', 1, 2);
    const defaultSpan = Math.abs(defaultPos1[2] - defaultPos0[2]);

    const widePos0 = getPortWorldPos(nodePos, 'input', 0, 2, undefined, 3.0);
    const widePos1 = getPortWorldPos(nodePos, 'input', 1, 2, undefined, 3.0);
    const wideSpan = Math.abs(widePos1[2] - widePos0[2]);

    expect(wideSpan).toBeGreaterThan(defaultSpan);
  });
});

// ============================================================================
// 4. buildNodeAABBs from nodeBounds.ts
// ============================================================================
describe('buildNodeAABBs', () => {
  it('returns correct AABB for default-sized node', () => {
    const node = makeNode('n1', [4, 0, 2]);
    const aabbs = buildNodeAABBs({ n1: node });

    expect(aabbs.size).toBe(1);
    const aabb = aabbs.get('n1')!;
    expect(aabb.nodeId).toBe('n1');
    expect(aabb.centerX).toBe(4);
    expect(aabb.centerZ).toBe(2);
    expect(aabb.width).toBe(DEFAULT_NODE_WIDTH);
    expect(aabb.depth).toBe(DEFAULT_NODE_HEIGHT);
    expect(aabb.minX).toBeCloseTo(4 - DEFAULT_NODE_WIDTH / 2, 5);
    expect(aabb.maxX).toBeCloseTo(4 + DEFAULT_NODE_WIDTH / 2, 5);
    expect(aabb.minZ).toBeCloseTo(2 - DEFAULT_NODE_HEIGHT / 2, 5);
    expect(aabb.maxZ).toBeCloseTo(2 + DEFAULT_NODE_HEIGHT / 2, 5);
  });

  it('returns correct AABB for custom-sized node', () => {
    const node = makeNode('n1', [0, 0, 0], { width: 3.0, height: 2.0 });
    const aabbs = buildNodeAABBs({ n1: node });

    const aabb = aabbs.get('n1')!;
    expect(aabb.width).toBe(3.0);
    expect(aabb.depth).toBe(2.0);
    expect(aabb.minX).toBeCloseTo(-1.5, 5);
    expect(aabb.maxX).toBeCloseTo(1.5, 5);
    expect(aabb.minZ).toBeCloseTo(-1.0, 5);
    expect(aabb.maxZ).toBeCloseTo(1.0, 5);
  });

  it('returns empty map for empty nodes', () => {
    const aabbs = buildNodeAABBs({});
    expect(aabbs.size).toBe(0);
  });

  it('handles multiple nodes correctly', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', [0, 0, 0]),
      b: makeNode('b', [10, 0, 5], { width: 4.0, height: 1.5 }),
    };
    const aabbs = buildNodeAABBs(nodes);
    expect(aabbs.size).toBe(2);
    expect(aabbs.get('a')!.width).toBe(DEFAULT_NODE_WIDTH);
    expect(aabbs.get('b')!.width).toBe(4.0);
    expect(aabbs.get('b')!.depth).toBe(1.5);
  });
});

// ============================================================================
// 5. buildPortPositionCache from nodeBounds.ts
// ============================================================================
describe('buildPortPositionCache', () => {
  it('caches all input and output ports', () => {
    const node = makeNode('n1', [0, 0, 0], {
      inputs: [
        { id: 'in-0', label: 'A', portType: 'number' },
        { id: 'in-1', label: 'B', portType: 'number' },
      ],
      outputs: [
        { id: 'out-0', label: 'Out', portType: 'number' },
      ],
    });
    const cache = buildPortPositionCache({ n1: node });
    // 2 inputs + 1 output = 3 entries
    expect(cache.size).toBe(3);
    expect(cache.get('n1', 'input', 0)).toBeDefined();
    expect(cache.get('n1', 'input', 1)).toBeDefined();
    expect(cache.get('n1', 'output', 0)).toBeDefined();
  });

  it('returns undefined for non-cached port', () => {
    const node = makeNode('n1', [0, 0, 0]);
    const cache = buildPortPositionCache({ n1: node });
    expect(cache.get('n1', 'input', 99)).toBeUndefined();
    expect(cache.get('nonexistent', 'input', 0)).toBeUndefined();
  });

  it('uses custom node sizes for port positions', () => {
    const customWidth = 4.0;
    const customDepth = 2.0;
    const pos: [number, number, number] = [5, 0, 3];
    const node = makeNode('n1', pos, { width: customWidth, height: customDepth });
    const cache = buildPortPositionCache({ n1: node });

    const outPos = cache.get('n1', 'output', 0)!;
    const expectedX = pos[0] + customWidth / 2 + 0.05;
    expect(outPos[0]).toBeCloseTo(expectedX, 5);

    const inPos = cache.get('n1', 'input', 0)!;
    const expectedInX = pos[0] - customWidth / 2 - 0.05;
    expect(inPos[0]).toBeCloseTo(expectedInX, 5);
  });

  it('returns correct positions matching getPortWorldPos', () => {
    const pos: [number, number, number] = [2, 0, -1];
    const node = makeNode('n1', pos, { width: 3.0, height: 1.5 });
    const cache = buildPortPositionCache({ n1: node });

    const cached = cache.get('n1', 'output', 0)!;
    const direct = getPortWorldPos(pos, 'output', 0, 1, 3.0, 1.5);
    expect(cached[0]).toBeCloseTo(direct[0], 5);
    expect(cached[1]).toBeCloseTo(direct[1], 5);
    expect(cached[2]).toBeCloseTo(direct[2], 5);
  });

  it('handles empty nodes record', () => {
    const cache = buildPortPositionCache({});
    expect(cache.size).toBe(0);
  });
});

// ============================================================================
// 6. aabbsOverlap and pointInAABB from nodeBounds.ts
// ============================================================================
describe('aabbsOverlap', () => {
  function makeAABB(cx: number, cz: number, w: number, d: number): NodeAABB {
    return {
      nodeId: 'test',
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      centerX: cx,
      centerZ: cz,
      width: w,
      depth: d,
    };
  }

  it('detects overlapping AABBs', () => {
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(1, 1, 2, 2);
    expect(aabbsOverlap(a, b)).toBe(true);
  });

  it('detects fully contained AABBs as overlapping', () => {
    const outer = makeAABB(0, 0, 10, 10);
    const inner = makeAABB(0, 0, 1, 1);
    expect(aabbsOverlap(outer, inner)).toBe(true);
  });

  it('non-overlapping AABBs are not detected', () => {
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(10, 10, 2, 2);
    expect(aabbsOverlap(a, b)).toBe(false);
  });

  it('touching edges are not considered overlapping (strict inequality)', () => {
    // a goes from -1 to 1 on X, b goes from 1 to 3 on X
    // They share edge at x=1, but strict < means maxA > minB (1 > 1 is false)
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(2, 0, 2, 2);
    expect(aabbsOverlap(a, b)).toBe(false);
  });

  it('margin expands overlap detection', () => {
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(2, 0, 2, 2);
    // Without margin, they don't overlap (touching edges)
    expect(aabbsOverlap(a, b, 0)).toBe(false);
    // With margin of 0.1, they overlap
    expect(aabbsOverlap(a, b, 0.1)).toBe(true);
  });

  it('detects overlap on Z axis only', () => {
    const a = makeAABB(0, 0, 2, 2);
    const b = makeAABB(0.5, 0.5, 2, 2);
    expect(aabbsOverlap(a, b)).toBe(true);
  });
});

describe('pointInAABB', () => {
  const aabb: NodeAABB = {
    nodeId: 'test',
    minX: -1,
    maxX: 1,
    minZ: -1,
    maxZ: 1,
    centerX: 0,
    centerZ: 0,
    width: 2,
    depth: 2,
  };

  it('point inside AABB returns true', () => {
    expect(pointInAABB(0, 0, aabb)).toBe(true);
    expect(pointInAABB(0.5, -0.5, aabb)).toBe(true);
  });

  it('point on boundary returns true (inclusive check)', () => {
    expect(pointInAABB(-1, 0, aabb)).toBe(true);
    expect(pointInAABB(1, 1, aabb)).toBe(true);
    expect(pointInAABB(-1, -1, aabb)).toBe(true);
  });

  it('point outside AABB returns false', () => {
    expect(pointInAABB(2, 0, aabb)).toBe(false);
    expect(pointInAABB(0, -2, aabb)).toBe(false);
    expect(pointInAABB(5, 5, aabb)).toBe(false);
  });

  it('point just outside returns false', () => {
    expect(pointInAABB(1.001, 0, aabb)).toBe(false);
    expect(pointInAABB(0, 1.001, aabb)).toBe(false);
  });
});

// ============================================================================
// 7. getNodeWidth / getNodeHeight from layout.ts
// ============================================================================
describe('getNodeWidth / getNodeHeight', () => {
  it('returns custom width when set', () => {
    const node = makeNode('n1', [0, 0, 0], { width: 3.5 });
    expect(getNodeWidth(node)).toBe(3.5);
  });

  it('returns DEFAULT_NODE_WIDTH when width is undefined', () => {
    const node = makeNode('n1', [0, 0, 0]);
    expect(getNodeWidth(node)).toBe(DEFAULT_NODE_WIDTH);
  });

  it('returns custom height when set', () => {
    const node = makeNode('n1', [0, 0, 0], { height: 2.5 });
    expect(getNodeHeight(node)).toBe(2.5);
  });

  it('returns DEFAULT_NODE_HEIGHT when height is undefined', () => {
    const node = makeNode('n1', [0, 0, 0]);
    expect(getNodeHeight(node)).toBe(DEFAULT_NODE_HEIGHT);
  });

  it('returns defaults when both width and height are undefined', () => {
    const node = makeNode('n1');
    expect(getNodeWidth(node)).toBe(DEFAULT_NODE_WIDTH);
    expect(getNodeHeight(node)).toBe(DEFAULT_NODE_HEIGHT);
  });
});

// ============================================================================
// 8. Constants sanity checks
// ============================================================================
describe('resize constraint constants', () => {
  it('MIN < DEFAULT < MAX for width', () => {
    expect(MIN_NODE_WIDTH).toBeLessThan(DEFAULT_NODE_WIDTH);
    expect(DEFAULT_NODE_WIDTH).toBeLessThan(MAX_NODE_WIDTH);
  });

  it('MIN < DEFAULT < MAX for height', () => {
    expect(MIN_NODE_HEIGHT).toBeLessThan(DEFAULT_NODE_HEIGHT);
    expect(DEFAULT_NODE_HEIGHT).toBeLessThan(MAX_NODE_HEIGHT);
  });

  it('has expected constraint values', () => {
    expect(MIN_NODE_WIDTH).toBe(1.0);
    expect(MAX_NODE_WIDTH).toBe(6.0);
    expect(MIN_NODE_HEIGHT).toBe(0.6);
    expect(MAX_NODE_HEIGHT).toBe(4.0);
    expect(DEFAULT_NODE_WIDTH).toBe(1.6);
    expect(DEFAULT_NODE_HEIGHT).toBe(0.8);
  });
});

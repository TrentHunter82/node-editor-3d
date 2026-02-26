/**
 * Phase 45 — Minimap Bounds Calculation Accuracy with Variable-Size Nodes
 *
 * The Minimap renders via HTML Canvas / DOM overlays, so we test the
 * underlying bounds-computation logic rather than pixel output.
 *
 * World bounds algorithm (from Minimap.tsx):
 *   halfW = (node.width ?? DEFAULT_NODE_WIDTH) / 2
 *   halfD = (node.height ?? DEFAULT_NODE_HEIGHT) / 2
 *   minX  = min(node.position[0] - halfW)
 *   maxX  = max(node.position[0] + halfW)
 *   minZ  = min(node.position[2] - halfD)
 *   maxZ  = max(node.position[2] + halfD)
 *   pad   = 3
 *   worldW = (maxX - minX) + pad * 2
 *   worldH = (maxZ - minZ) + pad * 2
 *   scale  = min(MAP_W / worldW, MAP_H / worldH) * zoom
 *
 * Node pixel rect:
 *   cx = x * scale + offsetX,  cy = z * scale + offsetZ
 *   pw = max(minPx, round(worldW * scale))
 *   ph = max(minPx, round(worldD * scale))
 *
 * Tests focus on store-level data and the buildNodeAABBs utility.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  MIN_NODE_WIDTH, MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT, MAX_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT,
} from '../store/slices/nodeSlice';
import { buildNodeAABBs } from '../utils/nodeBounds';
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
    s.templates = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
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

function getState() { return useEditorStore.getState(); }

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

/**
 * Replicate the Minimap's world-bounds calculation (Minimap.tsx L170-193).
 * Returns { minX, maxX, minZ, maxZ, worldW, worldH, scale, offsetX, offsetZ }.
 */
function computeMinimapBounds(
  nodes: Record<string, EditorNode>,
  mapW: number,
  mapH: number,
  zoom = 1,
) {
  const list = Object.values(nodes);
  if (list.length === 0) return null;

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const n of list) {
    const halfW = (n.width ?? DEFAULT_NODE_WIDTH) / 2;
    const halfD = (n.height ?? DEFAULT_NODE_HEIGHT) / 2;
    minX = Math.min(minX, n.position[0] - halfW);
    maxX = Math.max(maxX, n.position[0] + halfW);
    minZ = Math.min(minZ, n.position[2] - halfD);
    maxZ = Math.max(maxZ, n.position[2] + halfD);
  }

  const pad = 3;
  const worldW = (maxX - minX) + pad * 2;
  const worldH = (maxZ - minZ) + pad * 2;
  const baseScale = Math.min(mapW / worldW, mapH / worldH);
  const scale = baseScale * zoom;

  const offsetX = -(minX - pad) * scale + (mapW - worldW * scale) / 2;
  const offsetZ = -(minZ - pad) * scale + (mapH - worldH * scale) / 2;

  return { minX, maxX, minZ, maxZ, worldW, worldH, scale, offsetX, offsetZ };
}

// Minimap default inner dimensions (from settings defaults: 180x140 minus padding)
const PAD_H = 16;
const PAD_V = 28;
const DEFAULT_MAP_W = 180 - PAD_H; // 164
const DEFAULT_MAP_H = 140 - PAD_V; // 112

beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// 1. World bounds with uniform default-size nodes
// ---------------------------------------------------------------------------
describe('Minimap Bounds Accuracy — Variable-Size Nodes', () => {
  it('1. world bounds with uniform default-size nodes', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', [0, 0, 0]),
      b: makeNode('b', [10, 0, 0]),
      c: makeNode('c', [0, 0, 10]),
    };

    const halfW = DEFAULT_NODE_WIDTH / 2;  // 0.8
    const halfD = DEFAULT_NODE_HEIGHT / 2;  // 0.4

    const bounds = computeMinimapBounds(nodes, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(bounds).not.toBeNull();

    // Node 'a' at [0,0,0] gives minX = 0 - 0.8 = -0.8
    // Node 'b' at [10,0,0] gives maxX = 10 + 0.8 = 10.8
    // Node 'c' at [0,0,10] gives maxZ = 10 + 0.4 = 10.4
    expect(bounds!.minX).toBeCloseTo(0 - halfW);
    expect(bounds!.maxX).toBeCloseTo(10 + halfW);
    expect(bounds!.minZ).toBeCloseTo(0 - halfD);
    expect(bounds!.maxZ).toBeCloseTo(10 + halfD);

    // worldW = (10.8 - (-0.8)) + 6 = 11.6 + 6 = 17.6
    expect(bounds!.worldW).toBeCloseTo(17.6);
    // worldH = (10.4 - (-0.4)) + 6 = 10.8 + 6 = 16.8
    expect(bounds!.worldH).toBeCloseTo(16.8);
  });

  // ---------------------------------------------------------------------------
  // 2. World bounds with one resized node expanding the range
  // ---------------------------------------------------------------------------
  it('2. world bounds with one resized node expanding the range', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', [0, 0, 0]),
      b: makeNode('b', [5, 0, 5]),
      big: makeNode('big', [5, 0, 5], { width: 4.0, height: 3.0 }),
    };

    const bounds = computeMinimapBounds(nodes, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(bounds).not.toBeNull();

    // Node 'a' default: minX = 0 - 0.8 = -0.8, minZ = 0 - 0.4 = -0.4
    // Node 'big' at [5,0,5] with width=4, height=3: maxX = 5+2 = 7, maxZ = 5+1.5 = 6.5
    expect(bounds!.minX).toBeCloseTo(-0.8);  // from node 'a'
    expect(bounds!.maxX).toBeCloseTo(7.0);   // from node 'big' (5 + 4/2)
    expect(bounds!.minZ).toBeCloseTo(-0.4);  // from node 'a'
    expect(bounds!.maxZ).toBeCloseTo(6.5);   // from node 'big' (5 + 3/2)

    // Verify the resized node actually expanded bounds compared to default
    const defaultBig = makeNode('big', [5, 0, 5]); // no resize
    const defaultBounds = computeMinimapBounds({
      a: nodes.a,
      b: nodes.b,
      big: defaultBig,
    }, DEFAULT_MAP_W, DEFAULT_MAP_H);

    expect(bounds!.maxX).toBeGreaterThan(defaultBounds!.maxX);
    expect(bounds!.maxZ).toBeGreaterThan(defaultBounds!.maxZ);
  });

  // ---------------------------------------------------------------------------
  // 3. World bounds with mixed default/resized nodes
  // ---------------------------------------------------------------------------
  it('3. world bounds with mixed default/resized nodes', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', [-5, 0, -5]),                              // default size
      n2: makeNode('n2', [0, 0, 0], { width: 2.0, height: 1.5 }),  // slightly larger
      n3: makeNode('n3', [5, 0, 5]),                                // default size
      n4: makeNode('n4', [3, 0, -2], { width: 3.0, height: 2.0 }), // medium
    };

    const bounds = computeMinimapBounds(nodes, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(bounds).not.toBeNull();

    // minX candidates: n1: -5 - 0.8 = -5.8, n2: 0-1 = -1, n3: 5-0.8 = 4.2, n4: 3-1.5 = 1.5
    expect(bounds!.minX).toBeCloseTo(-5.8); // from n1 (default width)

    // maxX candidates: n1: -5+0.8 = -4.2, n2: 0+1 = 1, n3: 5+0.8 = 5.8, n4: 3+1.5 = 4.5
    expect(bounds!.maxX).toBeCloseTo(5.8);  // from n3 (default width)

    // minZ candidates: n1: -5-0.4 = -5.4, n2: 0-0.75 = -0.75, n3: 5-0.4 = 4.6, n4: -2-1 = -3
    expect(bounds!.minZ).toBeCloseTo(-5.4); // from n1 (default height)

    // maxZ candidates: n1: -5+0.4 = -4.6, n2: 0+0.75 = 0.75, n3: 5+0.4 = 5.4, n4: -2+1 = -1
    expect(bounds!.maxZ).toBeCloseTo(5.4);  // from n3 (default height)
  });

  // ---------------------------------------------------------------------------
  // 4. Resized node at MIN_NODE_WIDTH/HEIGHT — bounds still correct
  // ---------------------------------------------------------------------------
  it('4. resized node at MIN_NODE_WIDTH/HEIGHT — bounds still correct', () => {
    const tiny = makeNode('tiny', [0, 0, 0], {
      width: MIN_NODE_WIDTH,   // 1.0
      height: MIN_NODE_HEIGHT, // 0.6
    });

    const aabb = buildNodeAABBs({ tiny });
    const box = aabb.get('tiny')!;

    expect(box.width).toBe(MIN_NODE_WIDTH);
    expect(box.depth).toBe(MIN_NODE_HEIGHT);
    expect(box.minX).toBeCloseTo(0 - MIN_NODE_WIDTH / 2);   // -0.5
    expect(box.maxX).toBeCloseTo(0 + MIN_NODE_WIDTH / 2);   //  0.5
    expect(box.minZ).toBeCloseTo(0 - MIN_NODE_HEIGHT / 2);  // -0.3
    expect(box.maxZ).toBeCloseTo(0 + MIN_NODE_HEIGHT / 2);  //  0.3
    expect(box.centerX).toBe(0);
    expect(box.centerZ).toBe(0);

    // Minimap bounds should still pad correctly
    const bounds = computeMinimapBounds({ tiny }, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(bounds).not.toBeNull();
    expect(bounds!.worldW).toBeCloseTo(MIN_NODE_WIDTH + 6);  // 1.0 + 6 = 7.0
    expect(bounds!.worldH).toBeCloseTo(MIN_NODE_HEIGHT + 6); // 0.6 + 6 = 6.6
  });

  // ---------------------------------------------------------------------------
  // 5. Resized node at MAX_NODE_WIDTH/HEIGHT — bounds expand proportionally
  // ---------------------------------------------------------------------------
  it('5. resized node at MAX_NODE_WIDTH/HEIGHT — bounds expand proportionally', () => {
    const huge = makeNode('huge', [0, 0, 0], {
      width: MAX_NODE_WIDTH,   // 6.0
      height: MAX_NODE_HEIGHT, // 4.0
    });

    const aabb = buildNodeAABBs({ huge });
    const box = aabb.get('huge')!;

    expect(box.width).toBe(MAX_NODE_WIDTH);
    expect(box.depth).toBe(MAX_NODE_HEIGHT);
    expect(box.minX).toBeCloseTo(-3.0);
    expect(box.maxX).toBeCloseTo(3.0);
    expect(box.minZ).toBeCloseTo(-2.0);
    expect(box.maxZ).toBeCloseTo(2.0);

    const bounds = computeMinimapBounds({ huge }, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(bounds).not.toBeNull();
    expect(bounds!.worldW).toBeCloseTo(MAX_NODE_WIDTH + 6);  // 6.0 + 6 = 12.0
    expect(bounds!.worldH).toBeCloseTo(MAX_NODE_HEIGHT + 6); // 4.0 + 6 = 10.0

    // Verify proportional expansion: MAX is much wider than default
    const defaultNode = makeNode('def', [0, 0, 0]);
    const defaultBounds = computeMinimapBounds({ def: defaultNode }, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(bounds!.worldW).toBeGreaterThan(defaultBounds!.worldW);
    expect(bounds!.worldH).toBeGreaterThan(defaultBounds!.worldH);
  });

  // ---------------------------------------------------------------------------
  // 6. AABB-based bounds match expected minimap bounds for resized nodes
  // ---------------------------------------------------------------------------
  it('6. AABB-based bounds match expected minimap bounds for resized nodes', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', [-3, 0, 2], { width: 2.0, height: 1.0 }),
      b: makeNode('b', [4, 0, -1], { width: 3.0, height: 2.5 }),
      c: makeNode('c', [0, 0, 0]),  // default size
    };

    // Build AABB cache
    const aabbs = buildNodeAABBs(nodes);

    // Also compute minimap bounds
    const minimapBounds = computeMinimapBounds(nodes, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(minimapBounds).not.toBeNull();

    // The minimap's raw world extent (before pad) should equal the union of all AABBs
    let unionMinX = Infinity, unionMaxX = -Infinity;
    let unionMinZ = Infinity, unionMaxZ = -Infinity;
    for (const [, aabb] of aabbs) {
      unionMinX = Math.min(unionMinX, aabb.minX);
      unionMaxX = Math.max(unionMaxX, aabb.maxX);
      unionMinZ = Math.min(unionMinZ, aabb.minZ);
      unionMaxZ = Math.max(unionMaxZ, aabb.maxZ);
    }

    expect(minimapBounds!.minX).toBeCloseTo(unionMinX);
    expect(minimapBounds!.maxX).toBeCloseTo(unionMaxX);
    expect(minimapBounds!.minZ).toBeCloseTo(unionMinZ);
    expect(minimapBounds!.maxZ).toBeCloseTo(unionMaxZ);

    // Verify individual AABBs are correct
    const aabbA = aabbs.get('a')!;
    expect(aabbA.minX).toBeCloseTo(-3 - 1.0);  // -4
    expect(aabbA.maxX).toBeCloseTo(-3 + 1.0);  // -2
    expect(aabbA.minZ).toBeCloseTo(2 - 0.5);   //  1.5
    expect(aabbA.maxZ).toBeCloseTo(2 + 0.5);   //  2.5

    const aabbB = aabbs.get('b')!;
    expect(aabbB.minX).toBeCloseTo(4 - 1.5);   //  2.5
    expect(aabbB.maxX).toBeCloseTo(4 + 1.5);   //  5.5
    expect(aabbB.minZ).toBeCloseTo(-1 - 1.25); // -2.25
    expect(aabbB.maxZ).toBeCloseTo(-1 + 1.25); // -0.25 (wait, maxZ comes from node 'c' or 'a')
  });

  // ---------------------------------------------------------------------------
  // 7. Node at extreme positions with custom size
  // ---------------------------------------------------------------------------
  it('7. node at extreme positions with custom size', () => {
    const nodes: Record<string, EditorNode> = {
      far: makeNode('far', [100, 0, -50], { width: 5.0, height: 3.0 }),
      origin: makeNode('origin', [0, 0, 0]),
    };

    const bounds = computeMinimapBounds(nodes, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(bounds).not.toBeNull();

    // far node: x=100, halfW=2.5 => maxX=102.5; z=-50, halfD=1.5 => minZ=-51.5
    // origin node: x=0, halfW=0.8 => minX=-0.8; z=0, halfD=0.4 => maxZ=0.4
    expect(bounds!.minX).toBeCloseTo(-0.8);
    expect(bounds!.maxX).toBeCloseTo(102.5);
    expect(bounds!.minZ).toBeCloseTo(-51.5);
    expect(bounds!.maxZ).toBeCloseTo(0.4);

    // World extent is very large
    expect(bounds!.worldW).toBeCloseTo(102.5 - (-0.8) + 6);  // 109.3
    expect(bounds!.worldH).toBeCloseTo(0.4 - (-51.5) + 6);   // 57.9

    // Scale should be small since the world is large
    expect(bounds!.scale).toBeLessThan(2);
    expect(bounds!.scale).toBeGreaterThan(0);

    // AABB for the far node should be correct
    const aabbs = buildNodeAABBs(nodes);
    const farBox = aabbs.get('far')!;
    expect(farBox.centerX).toBe(100);
    expect(farBox.centerZ).toBe(-50);
    expect(farBox.width).toBe(5.0);
    expect(farBox.depth).toBe(3.0);
  });

  // ---------------------------------------------------------------------------
  // 8. Performance: buildNodeAABBs with 200+ nodes including variable sizes
  // ---------------------------------------------------------------------------
  it('8. performance: buildNodeAABBs with 200+ variable-size nodes completes quickly', () => {
    const nodes: Record<string, EditorNode> = {};
    const count = 500;

    for (let i = 0; i < count; i++) {
      const id = `n${i}`;
      const x = (i % 20) * 3;
      const z = Math.floor(i / 20) * 3;
      // Alternate between default, small, and large sizes
      const overrides: Partial<EditorNode> = {};
      if (i % 3 === 1) {
        overrides.width = MIN_NODE_WIDTH;
        overrides.height = MIN_NODE_HEIGHT;
      } else if (i % 3 === 2) {
        overrides.width = MAX_NODE_WIDTH;
        overrides.height = MAX_NODE_HEIGHT;
      }
      // else: default (no width/height set)
      nodes[id] = makeNode(id, [x, 0, z], overrides);
    }

    const start = performance.now();
    const aabbs = buildNodeAABBs(nodes);
    const elapsed = performance.now() - start;

    expect(aabbs.size).toBe(count);
    // Should complete in well under 50ms for 500 nodes
    expect(elapsed).toBeLessThan(50);

    // Also verify minimap bounds computation is fast
    const boundsStart = performance.now();
    const bounds = computeMinimapBounds(nodes, DEFAULT_MAP_W, DEFAULT_MAP_H);
    const boundsElapsed = performance.now() - boundsStart;

    expect(bounds).not.toBeNull();
    expect(boundsElapsed).toBeLessThan(50);

    // Spot-check: the largest nodes (every 3rd, MAX size) should contribute to bounds
    // Last row node: n498 (i=498, 498%3=0 → default), n499 (i=499, 499%3=1 → min size)
    // n497 (i=497, 497%3=2 → max size) at x=(497%20)*3=51, z=floor(497/20)*3=72
    const box497 = aabbs.get('n497')!;
    expect(box497.width).toBe(MAX_NODE_WIDTH);
    expect(box497.depth).toBe(MAX_NODE_HEIGHT);
  });

  // ---------------------------------------------------------------------------
  // 9. Group bounds encompass all member nodes including resized ones
  // ---------------------------------------------------------------------------
  it('9. group bounds encompass all member nodes including resized ones', () => {
    // Create nodes in the store with a group
    const id1 = getState().addNode('source', [-2, 0, -2]);
    const id2 = getState().addNode('source', [3, 0, 3]);

    // Resize node 2 to be large
    getState().resizeNode(id2, 4.0, 3.0);
    expect(getState().nodes[id2].width).toBe(4.0);
    expect(getState().nodes[id2].height).toBe(3.0);

    // Create a group containing both nodes
    useEditorStore.setState(s => { s.selectedIds = new Set([id1, id2]); });
    const groupId = getState().createGroup('Test Group');
    expect(groupId).toBeTruthy();

    const groupNodes = Object.values(getState().nodes).filter(n => n.groupId === groupId);
    expect(groupNodes.length).toBe(2);

    // Compute group bounds the same way the Minimap does (groupRects in Minimap.tsx L596-622)
    let gMinX = Infinity, gMaxX = -Infinity;
    let gMinZ = Infinity, gMaxZ = -Infinity;
    for (const n of groupNodes) {
      gMinX = Math.min(gMinX, n.position[0]);
      gMaxX = Math.max(gMaxX, n.position[0]);
      gMinZ = Math.min(gMinZ, n.position[2]);
      gMaxZ = Math.max(gMaxZ, n.position[2]);
    }

    expect(gMinX).toBe(-2);
    expect(gMaxX).toBe(3);
    expect(gMinZ).toBe(-2);
    expect(gMaxZ).toBe(3);

    // Now verify with AABB — the resized node extends farther from center
    const aabbs = buildNodeAABBs(getState().nodes);
    const box1 = aabbs.get(id1)!;
    const box2 = aabbs.get(id2)!;

    // Node 1 (default): [-2 - 0.8, -2 + 0.8] = [-2.8, -1.2]
    expect(box1.minX).toBeCloseTo(-2.8);
    expect(box1.maxX).toBeCloseTo(-1.2);

    // Node 2 (resized 4.0 wide): [3 - 2.0, 3 + 2.0] = [1.0, 5.0]
    expect(box2.minX).toBeCloseTo(1.0);
    expect(box2.maxX).toBeCloseTo(5.0);

    // Node 2 (resized 3.0 deep): [3 - 1.5, 3 + 1.5] = [1.5, 4.5]
    expect(box2.minZ).toBeCloseTo(1.5);
    expect(box2.maxZ).toBeCloseTo(4.5);

    // The AABB union of group members extends well beyond position-only bounds
    const aabbUnionMaxX = Math.max(box1.maxX, box2.maxX);
    expect(aabbUnionMaxX).toBeCloseTo(5.0); // wider than position-only maxX=3
    expect(aabbUnionMaxX).toBeGreaterThan(gMaxX);
  });

  // ---------------------------------------------------------------------------
  // 10. Scale factor calculation preserves relative node proportions
  // ---------------------------------------------------------------------------
  it('10. scale factor calculation preserves relative node proportions', () => {
    const smallNode = makeNode('small', [0, 0, 0], {
      width: MIN_NODE_WIDTH,   // 1.0
      height: MIN_NODE_HEIGHT, // 0.6
    });
    const largeNode = makeNode('large', [10, 0, 0], {
      width: MAX_NODE_WIDTH,   // 6.0
      height: MAX_NODE_HEIGHT, // 4.0
    });

    const nodes: Record<string, EditorNode> = { small: smallNode, large: largeNode };
    const bounds = computeMinimapBounds(nodes, DEFAULT_MAP_W, DEFAULT_MAP_H);
    expect(bounds).not.toBeNull();
    const { scale } = bounds!;

    // At this scale, the pixel width of each node should preserve the world-space ratio
    const smallPxW = MIN_NODE_WIDTH * scale;
    const largePxW = MAX_NODE_WIDTH * scale;
    const smallPxH = MIN_NODE_HEIGHT * scale;
    const largePxH = MAX_NODE_HEIGHT * scale;

    // The ratio of pixel sizes must match the ratio of world sizes
    expect(largePxW / smallPxW).toBeCloseTo(MAX_NODE_WIDTH / MIN_NODE_WIDTH);   // 6.0
    expect(largePxH / smallPxH).toBeCloseTo(MAX_NODE_HEIGHT / MIN_NODE_HEIGHT); // ~6.67

    // Verify scale is uniform (same factor for X and Z axes)
    // Both nodes map through the same scale factor, so proportions are preserved
    const worldToMapX = (x: number) => x * scale + bounds!.offsetX;
    const _worldToMapZ = (z: number) => z * scale + bounds!.offsetZ;
    void _worldToMapZ; // used for documentation/symmetry

    // Distance between node centers in minimap pixels
    const mapDist = Math.abs(worldToMapX(10) - worldToMapX(0));
    // Should equal world distance * scale
    expect(mapDist).toBeCloseTo(10 * scale);

    // The mapped positions should be within the minimap area [0, MAP_W] / [0, MAP_H]
    const smallCx = worldToMapX(0);
    const largeCx = worldToMapX(10);
    expect(smallCx).toBeGreaterThanOrEqual(0);
    expect(largeCx).toBeLessThanOrEqual(DEFAULT_MAP_W);
  });
});

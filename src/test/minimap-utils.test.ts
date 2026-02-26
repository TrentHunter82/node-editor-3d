/**
 * Minimap Utilities Test Suite
 *
 * Tests for getGraphBounds, getMinimapProjection, and worldToMinimap
 * from src/utils/minimapUtils.ts
 */
import { describe, it, expect } from 'vitest';
import type { EditorNode } from '../types';
import {
  getGraphBounds,
  getMinimapProjection,
  worldToMinimap,
  type GraphBounds,
  type MinimapViewport,
} from '../utils/minimapUtils';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../store/slices/nodeSlice';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal EditorNode for testing purposes. */
function makeNode(
  id: string,
  position: [number, number, number],
  overrides?: Partial<EditorNode>,
): EditorNode {
  return {
    id,
    type: 'source',
    position,
    title: id,
    data: {},
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

/** Build a Record<string, EditorNode> from an array of nodes. */
function nodesRecord(...nodes: EditorNode[]): Record<string, EditorNode> {
  const rec: Record<string, EditorNode> = {};
  for (const n of nodes) rec[n.id] = n;
  return rec;
}

/** Standard minimap viewport used by most tests. */
void ({ width: 200, height: 150, padding: 10 } satisfies MinimapViewport);

// ---------------------------------------------------------------------------
// getGraphBounds
// ---------------------------------------------------------------------------

describe('getGraphBounds', () => {
  it('1. returns null for an empty nodes object', () => {
    expect(getGraphBounds({})).toBeNull();
  });

  it('2. single node at origin with default size produces correct bounds', () => {
    const nodes = nodesRecord(makeNode('a', [0, 0, 0]));
    const bounds = getGraphBounds(nodes)!;
    expect(bounds).not.toBeNull();

    const halfW = DEFAULT_NODE_WIDTH / 2; // 0.8
    const halfH = DEFAULT_NODE_HEIGHT / 2; // 0.4

    expect(bounds.minX).toBeCloseTo(-halfW);
    expect(bounds.maxX).toBeCloseTo(halfW);
    expect(bounds.minZ).toBeCloseTo(-halfH);
    expect(bounds.maxZ).toBeCloseTo(halfH);
    expect(bounds.width).toBeCloseTo(DEFAULT_NODE_WIDTH);
    expect(bounds.depth).toBeCloseTo(DEFAULT_NODE_HEIGHT);
  });

  it('3. single node at (5, 0, 3) with default size accounts for position', () => {
    const nodes = nodesRecord(makeNode('a', [5, 0, 3]));
    const bounds = getGraphBounds(nodes)!;

    const halfW = DEFAULT_NODE_WIDTH / 2;
    const halfH = DEFAULT_NODE_HEIGHT / 2;

    expect(bounds.minX).toBeCloseTo(5 - halfW);
    expect(bounds.maxX).toBeCloseTo(5 + halfW);
    expect(bounds.minZ).toBeCloseTo(3 - halfH);
    expect(bounds.maxZ).toBeCloseTo(3 + halfH);
  });

  it('4. two nodes far apart: bounds encompass both', () => {
    const nodes = nodesRecord(
      makeNode('a', [0, 0, 0]),
      makeNode('b', [10, 0, 8]),
    );
    const bounds = getGraphBounds(nodes)!;

    const halfW = DEFAULT_NODE_WIDTH / 2;
    const halfH = DEFAULT_NODE_HEIGHT / 2;

    expect(bounds.minX).toBeCloseTo(0 - halfW);
    expect(bounds.maxX).toBeCloseTo(10 + halfW);
    expect(bounds.minZ).toBeCloseTo(0 - halfH);
    expect(bounds.maxZ).toBeCloseTo(8 + halfH);
  });

  it('5. node with custom width=3.0 extends +/-1.5 in X', () => {
    const nodes = nodesRecord(makeNode('a', [0, 0, 0], { width: 3.0 }));
    const bounds = getGraphBounds(nodes)!;

    expect(bounds.minX).toBeCloseTo(-1.5);
    expect(bounds.maxX).toBeCloseTo(1.5);
    expect(bounds.width).toBeCloseTo(3.0);
  });

  it('6. node with custom height=2.0 extends +/-1.0 in Z', () => {
    const nodes = nodesRecord(makeNode('a', [0, 0, 0], { height: 2.0 }));
    const bounds = getGraphBounds(nodes)!;

    expect(bounds.minZ).toBeCloseTo(-1.0);
    expect(bounds.maxZ).toBeCloseTo(1.0);
    expect(bounds.depth).toBeCloseTo(2.0);
  });

  it('7. nodes at extremes: (-100, 0, -50) and (100, 0, 50)', () => {
    const nodes = nodesRecord(
      makeNode('a', [-100, 0, -50]),
      makeNode('b', [100, 0, 50]),
    );
    const bounds = getGraphBounds(nodes)!;

    const halfW = DEFAULT_NODE_WIDTH / 2;
    const halfH = DEFAULT_NODE_HEIGHT / 2;

    expect(bounds.minX).toBeCloseTo(-100 - halfW);
    expect(bounds.maxX).toBeCloseTo(100 + halfW);
    expect(bounds.minZ).toBeCloseTo(-50 - halfH);
    expect(bounds.maxZ).toBeCloseTo(50 + halfH);
  });

  it('8. all nodes at same position: bounds equal single node size', () => {
    const nodes = nodesRecord(
      makeNode('a', [5, 0, 5]),
      makeNode('b', [5, 0, 5]),
      makeNode('c', [5, 0, 5]),
    );
    const bounds = getGraphBounds(nodes)!;

    expect(bounds.width).toBeCloseTo(DEFAULT_NODE_WIDTH);
    expect(bounds.depth).toBeCloseTo(DEFAULT_NODE_HEIGHT);
  });

  it('9. center calculation: (minX + maxX) / 2, (minZ + maxZ) / 2', () => {
    const nodes = nodesRecord(
      makeNode('a', [-10, 0, -5]),
      makeNode('b', [20, 0, 15]),
    );
    const bounds = getGraphBounds(nodes)!;

    expect(bounds.centerX).toBeCloseTo((bounds.minX + bounds.maxX) / 2);
    expect(bounds.centerZ).toBeCloseTo((bounds.minZ + bounds.maxZ) / 2);
  });

  it('10. width/depth calculation matches maxX - minX, maxZ - minZ', () => {
    const nodes = nodesRecord(
      makeNode('a', [-3, 0, -2]),
      makeNode('b', [7, 0, 6]),
    );
    const bounds = getGraphBounds(nodes)!;

    expect(bounds.width).toBeCloseTo(bounds.maxX - bounds.minX);
    expect(bounds.depth).toBeCloseTo(bounds.maxZ - bounds.minZ);
  });
});

// ---------------------------------------------------------------------------
// getMinimapProjection
// ---------------------------------------------------------------------------

describe('getMinimapProjection', () => {
  it('11. uniform scaling preserves aspect ratio', () => {
    // Graph that is 20 wide, 10 deep — wider than tall
    const bounds: GraphBounds = {
      minX: 0, maxX: 20, minZ: 0, maxZ: 10,
      width: 20, depth: 10, centerX: 10, centerZ: 5,
    };
    const viewport: MinimapViewport = { width: 200, height: 200, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);

    // scale should be min(200/20, 200/10) = min(10, 20) = 10
    expect(proj.scale).toBeCloseTo(10);
  });

  it('12. wider graph than minimap: scale limited by width', () => {
    const bounds: GraphBounds = {
      minX: 0, maxX: 40, minZ: 0, maxZ: 10,
      width: 40, depth: 10, centerX: 20, centerZ: 5,
    };
    const viewport: MinimapViewport = { width: 200, height: 200, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);

    // min(200/40, 200/10) = min(5, 20) = 5
    expect(proj.scale).toBeCloseTo(5);
  });

  it('13. taller graph than minimap: scale limited by height', () => {
    const bounds: GraphBounds = {
      minX: 0, maxX: 10, minZ: 0, maxZ: 40,
      width: 10, depth: 40, centerX: 5, centerZ: 20,
    };
    const viewport: MinimapViewport = { width: 200, height: 200, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);

    // min(200/10, 200/40) = min(20, 5) = 5
    expect(proj.scale).toBeCloseTo(5);
  });

  it('14. square graph in square minimap: scale = available / bounds.width', () => {
    const bounds: GraphBounds = {
      minX: 0, maxX: 10, minZ: 0, maxZ: 10,
      width: 10, depth: 10, centerX: 5, centerZ: 5,
    };
    const viewport: MinimapViewport = { width: 100, height: 100, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);

    expect(proj.scale).toBeCloseTo(100 / 10);
  });

  it('15. padding is subtracted from available area', () => {
    const bounds: GraphBounds = {
      minX: 0, maxX: 10, minZ: 0, maxZ: 10,
      width: 10, depth: 10, centerX: 5, centerZ: 5,
    };
    const viewport: MinimapViewport = { width: 100, height: 100, padding: 20 };
    const proj = getMinimapProjection(bounds, viewport);

    // available = 100 - 2*20 = 60, scale = 60/10 = 6
    expect(proj.scale).toBeCloseTo(6);
  });

  it('16. zero-width bounds (all nodes on same X): uses fallback scale', () => {
    const bounds: GraphBounds = {
      minX: 5, maxX: 5, minZ: 0, maxZ: 10,
      width: 0, depth: 10, centerX: 5, centerZ: 5,
    };
    const viewport: MinimapViewport = { width: 200, height: 200, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);

    // width is 0, so scale comes from depth: 200/10 = 20
    expect(proj.scale).toBeCloseTo(20);
    expect(Number.isFinite(proj.scale)).toBe(true);
  });

  it('17. zero-depth bounds (all nodes on same Z): uses fallback scale', () => {
    const bounds: GraphBounds = {
      minX: 0, maxX: 10, minZ: 5, maxZ: 5,
      width: 10, depth: 0, centerX: 5, centerZ: 5,
    };
    const viewport: MinimapViewport = { width: 200, height: 200, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);

    // depth is 0, so scale comes from width: 200/10 = 20
    expect(proj.scale).toBeCloseTo(20);
    expect(Number.isFinite(proj.scale)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// worldToMinimap
// ---------------------------------------------------------------------------

describe('worldToMinimap', () => {
  it('18. center of graph maps to center of minimap', () => {
    const bounds: GraphBounds = {
      minX: 0, maxX: 10, minZ: 0, maxZ: 10,
      width: 10, depth: 10, centerX: 5, centerZ: 5,
    };
    const viewport: MinimapViewport = { width: 200, height: 150, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);
    const center = worldToMinimap(bounds.centerX, bounds.centerZ, proj);

    expect(center.x).toBeCloseTo(viewport.width / 2);
    expect(center.y).toBeCloseTo(viewport.height / 2);
  });

  it('19. corner of graph maps correctly', () => {
    const bounds: GraphBounds = {
      minX: 0, maxX: 20, minZ: 0, maxZ: 10,
      width: 20, depth: 10, centerX: 10, centerZ: 5,
    };
    // No padding, 200x100 viewport
    const viewport: MinimapViewport = { width: 200, height: 100, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);

    // scale = min(200/20, 100/10) = min(10, 10) = 10
    // offsetX = 200/2 - 10*10 = 100 - 100 = 0
    // offsetZ = 100/2 - 5*10 = 50 - 50 = 0
    const topLeft = worldToMinimap(bounds.minX, bounds.minZ, proj);
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);

    const bottomRight = worldToMinimap(bounds.maxX, bounds.maxZ, proj);
    expect(bottomRight.x).toBeCloseTo(200);
    expect(bottomRight.y).toBeCloseTo(100);
  });

  it('20. node at origin with centered graph maps to minimap center', () => {
    // Graph centered at origin
    const bounds: GraphBounds = {
      minX: -5, maxX: 5, minZ: -5, maxZ: 5,
      width: 10, depth: 10, centerX: 0, centerZ: 0,
    };
    const viewport: MinimapViewport = { width: 200, height: 200, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);
    const origin = worldToMinimap(0, 0, proj);

    expect(origin.x).toBeCloseTo(100);
    expect(origin.y).toBeCloseTo(100);
  });

  it('21. scaling works correctly for known input/output pairs', () => {
    const bounds: GraphBounds = {
      minX: 0, maxX: 100, minZ: 0, maxZ: 50,
      width: 100, depth: 50, centerX: 50, centerZ: 25,
    };
    // viewport 300x200, padding 0
    const viewport: MinimapViewport = { width: 300, height: 200, padding: 0 };
    const proj = getMinimapProjection(bounds, viewport);

    // scale = min(300/100, 200/50) = min(3, 4) = 3
    expect(proj.scale).toBeCloseTo(3);

    // offsetX = 300/2 - 50*3 = 150 - 150 = 0
    // offsetZ = 200/2 - 25*3 = 100 - 75 = 25
    const point = worldToMinimap(25, 10, proj);
    // x = 25*3 + 0 = 75
    // y = 10*3 + 25 = 55
    expect(point.x).toBeCloseTo(75);
    expect(point.y).toBeCloseTo(55);
  });
});

// ---------------------------------------------------------------------------
// Integration (full pipeline)
// ---------------------------------------------------------------------------

describe('Integration: full pipeline', () => {
  it('22. nodes -> getGraphBounds -> getMinimapProjection -> worldToMinimap -> correct pixel', () => {
    const nodes = nodesRecord(
      makeNode('a', [0, 0, 0]),
      makeNode('b', [10, 0, 5]),
    );
    const bounds = getGraphBounds(nodes)!;
    expect(bounds).not.toBeNull();

    const viewport: MinimapViewport = { width: 200, height: 150, padding: 10 };
    const proj = getMinimapProjection(bounds, viewport);

    // The center of the graph should map to the center of the minimap
    const center = worldToMinimap(bounds.centerX, bounds.centerZ, proj);
    expect(center.x).toBeCloseTo(viewport.width / 2);
    expect(center.y).toBeCloseTo(viewport.height / 2);

    // Node 'a' position should map to a valid pixel within the minimap
    const aPixel = worldToMinimap(0, 0, proj);
    expect(Number.isFinite(aPixel.x)).toBe(true);
    expect(Number.isFinite(aPixel.y)).toBe(true);

    // Node 'b' position should also be within the minimap
    const bPixel = worldToMinimap(10, 5, proj);
    expect(Number.isFinite(bPixel.x)).toBe(true);
    expect(Number.isFinite(bPixel.y)).toBe(true);
  });

  it('23. resized node affects bounds correctly', () => {
    const nodes = nodesRecord(
      makeNode('a', [0, 0, 0], { width: 4.0, height: 3.0 }),
      makeNode('b', [10, 0, 10]),
    );
    const bounds = getGraphBounds(nodes)!;

    // Node 'a' at origin with width=4 extends to -2..2 in X and -1.5..1.5 in Z
    // Node 'b' at (10,0,10) with defaults extends to 10-0.8..10+0.8 in X and 10-0.4..10+0.4 in Z
    expect(bounds.minX).toBeCloseTo(-2.0);
    expect(bounds.maxX).toBeCloseTo(10.8);
    expect(bounds.minZ).toBeCloseTo(-1.5);
    expect(bounds.maxZ).toBeCloseTo(10.4);
  });

  it('24. single node: projection centers it in the minimap', () => {
    const nodes = nodesRecord(makeNode('a', [5, 0, 3]));
    const bounds = getGraphBounds(nodes)!;
    const viewport: MinimapViewport = { width: 200, height: 200, padding: 10 };
    const proj = getMinimapProjection(bounds, viewport);

    // The node center (5, 3) should map to the center of the minimap
    const pixel = worldToMinimap(5, 3, proj);
    expect(pixel.x).toBeCloseTo(viewport.width / 2);
    expect(pixel.y).toBeCloseTo(viewport.height / 2);
  });

  it('25. multiple nodes: all mapped within minimap viewport (with padding)', () => {
    const nodes = nodesRecord(
      makeNode('a', [-10, 0, -5]),
      makeNode('b', [10, 0, 5]),
      makeNode('c', [0, 0, 0]),
      makeNode('d', [5, 0, -3]),
    );
    const bounds = getGraphBounds(nodes)!;
    const viewport: MinimapViewport = { width: 300, height: 200, padding: 10 };
    const proj = getMinimapProjection(bounds, viewport);

    // Every node center should map to a pixel within the viewport dimensions
    for (const node of Object.values(nodes)) {
      const pixel = worldToMinimap(node.position[0], node.position[2], proj);
      // Node centers should be within the padded area (with a little tolerance
      // since node centers inside bounds always fit within the available area)
      expect(pixel.x).toBeGreaterThanOrEqual(viewport.padding - 1);
      expect(pixel.x).toBeLessThanOrEqual(viewport.width - viewport.padding + 1);
      expect(pixel.y).toBeGreaterThanOrEqual(viewport.padding - 1);
      expect(pixel.y).toBeLessThanOrEqual(viewport.height - viewport.padding + 1);
    }
  });
});

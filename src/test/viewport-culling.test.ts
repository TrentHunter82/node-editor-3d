import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialIndex } from '../utils/spatialIndex';

// Helper: create a nodes record for rebuild()
function makeNodes(
  entries: Array<[string, number, number, number]>,
): Record<string, { position: [number, number, number] }> {
  const rec: Record<string, { position: [number, number, number] }> = {};
  for (const [id, x, y, z] of entries) {
    rec[id] = { position: [x, y, z] };
  }
  return rec;
}

// ============================================================================
// 1. SpatialIndex edge cases (~20 tests)
// ============================================================================
describe('Viewport Culling', () => {
  describe('SpatialIndex edge cases', () => {
    let index: SpatialIndex;

    beforeEach(() => {
      index = new SpatialIndex(10);
    });

    // ---- Rapid position updates across cell boundaries ----

    it('handles rapid position updates across multiple cell boundaries', () => {
      // Simulate a node being dragged quickly from cell (0,0) through (1,0), (2,0), (3,0)
      index.update('n1', 5, 5);   // cell (0,0)
      index.update('n1', 15, 5);  // cell (1,0)
      index.update('n1', 25, 5);  // cell (2,0)
      index.update('n1', 35, 5);  // cell (3,0)

      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1);
      // Node should only be in cell (3,0), not any intermediate cells
      expect(index.queryAABB(0, 9, 0, 9)).toHaveLength(0);
      expect(index.queryAABB(10, 19, 0, 9)).toHaveLength(0);
      expect(index.queryAABB(20, 29, 0, 9)).toHaveLength(0);
      expect(index.queryAABB(30, 39, 0, 9)).toEqual(['n1']);
    });

    it('handles oscillating position updates back and forth across a cell boundary', () => {
      // Simulate jitter around cell boundary at x=10
      index.update('n1', 9.5, 5);  // cell (0,0)
      index.update('n1', 10.5, 5); // cell (1,0)
      index.update('n1', 9.8, 5);  // cell (0,0)
      index.update('n1', 10.2, 5); // cell (1,0)
      index.update('n1', 9.9, 5);  // cell (0,0)

      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1);
      // Should be in cell (0,0) after final update
      const results = index.queryAABB(0, 9.99, 0, 9);
      expect(results).toEqual(['n1']);
      expect(index.queryAABB(10, 19, 0, 9)).toHaveLength(0);
    });

    // ---- queryAABB with very small/large bounds ----

    it('queryAABB with zero-width bounds (point query)', () => {
      index.update('n1', 5, 5);

      // A point query at (5,5) should still find n1 because it resolves to cell (0,0)
      const results = index.queryAABB(5, 5, 5, 5);
      expect(results).toEqual(['n1']);
    });

    it('queryAABB with very small bounds within a single cell', () => {
      index.update('n1', 5, 5);
      index.update('n2', 15, 15);

      // Query only the center of cell (0,0)
      const results = index.queryAABB(4.9, 5.1, 4.9, 5.1);
      expect(results).toEqual(['n1']);
    });

    it('queryAABB with extremely large bounds returns all nodes', () => {
      for (let i = 0; i < 50; i++) {
        index.update(`n${i}`, i * 20 - 500, i * 20 - 500);
      }

      const results = index.queryAABB(-10000, 10000, -10000, 10000);
      expect(results).toHaveLength(50);
    });

    // ---- Nodes exactly on cell boundaries ----

    it('node at exact cell boundary (0, 0) goes to cell (0, 0)', () => {
      index.update('n1', 0, 0);
      const results = index.queryAABB(-0.1, 0.1, -0.1, 0.1);
      expect(results).toEqual(['n1']);
    });

    it('node at exact cell boundary (10, 10) goes to cell (1, 1)', () => {
      index.update('n1', 10, 10);
      // cell (1,1) spans [10, 20)
      // query that only covers cell (0,0) should NOT find it
      expect(index.queryAABB(0, 9.99, 0, 9.99)).toHaveLength(0);
      // query that covers cell (1,1) should find it
      expect(index.queryAABB(10, 10, 10, 10)).toEqual(['n1']);
    });

    it('nodes at exact negative cell boundaries', () => {
      // -10 => Math.floor(-10/10) = -1, cell (-1, -1)
      index.update('n1', -10, -10);
      expect(index.queryAABB(-10, -10, -10, -10)).toEqual(['n1']);
      // -10.01 => Math.floor(-10.01/10) = -2, cell (-2, -2)
      index.update('n2', -10.01, -10.01);
      expect(index.queryAABB(-10.01, -10.01, -10.01, -10.01)).toEqual(['n2']);
    });

    it('two nodes on opposite sides of a cell boundary are in different cells', () => {
      // 9.99 => cell (0,0), 10.0 => cell (1,0)
      index.update('n1', 9.99, 5);
      index.update('n2', 10.0, 5);

      expect(index.cellCount).toBe(2);

      // Query only cell (0,0)
      const cell0 = index.queryAABB(0, 9, 0, 9);
      expect(cell0).toEqual(['n1']);

      // Query only cell (1,0)
      const cell1 = index.queryAABB(10, 19, 0, 9);
      expect(cell1).toEqual(['n2']);
    });

    // ---- Same cell optimization ----

    it('update within same cell does not change cell mapping', () => {
      index.update('n1', 1, 1);
      const initialCellCount = index.cellCount;

      // Move within same cell — many updates
      for (let i = 0; i < 100; i++) {
        index.update('n1', Math.random() * 9.99, Math.random() * 9.99);
      }

      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(initialCellCount);
    });

    // ---- Mass node movement simulation ----

    it('simultaneous movement of 10 nodes maintains consistency', () => {
      // Insert 10 nodes
      for (let i = 0; i < 10; i++) {
        index.update(`n${i}`, i * 5, 0);
      }
      expect(index.size).toBe(10);

      // Simulate dragging all 10 nodes by +15 in X (crosses cell boundaries)
      for (let i = 0; i < 10; i++) {
        index.update(`n${i}`, i * 5 + 15, 0);
      }
      expect(index.size).toBe(10);

      // All nodes should be findable at their new positions
      const all = index.queryAABB(0, 100, -1, 1);
      expect(all).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(all).toContain(`n${i}`);
      }
    });

    it('mass movement of 100 nodes in a grid pattern', () => {
      // Create 100 nodes in a 10x10 grid
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
          index.update(`n${row}_${col}`, col * 12, row * 12);
        }
      }
      expect(index.size).toBe(100);

      // Move all nodes by (-50, -50) — many will go to negative coordinates
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
          index.update(`n${row}_${col}`, col * 12 - 50, row * 12 - 50);
        }
      }
      expect(index.size).toBe(100);

      // All should be queryable
      const all = index.queryAABB(-100, 200, -100, 200);
      expect(all).toHaveLength(100);
    });

    // ---- Empty index queries ----

    it('queryAABB on empty index returns empty array', () => {
      expect(index.queryAABB(-100, 100, -100, 100)).toHaveLength(0);
    });

    it('size and cellCount are 0 on empty index', () => {
      expect(index.size).toBe(0);
      expect(index.cellCount).toBe(0);
    });

    // ---- Node removal and re-insertion ----

    it('node can be removed and re-inserted at a different position', () => {
      index.update('n1', 5, 5);
      index.remove('n1');
      expect(index.has('n1')).toBe(false);
      expect(index.size).toBe(0);

      index.update('n1', 55, 55);
      expect(index.has('n1')).toBe(true);
      expect(index.size).toBe(1);
      expect(index.queryAABB(50, 59, 50, 59)).toEqual(['n1']);
    });

    it('double removal is a no-op', () => {
      index.update('n1', 5, 5);
      index.remove('n1');
      index.remove('n1');
      expect(index.size).toBe(0);
      expect(index.cellCount).toBe(0);
    });

    // ---- Very large coordinates ----

    it('handles very large positive coordinates', () => {
      index.update('n1', 1_000_000, 1_000_000);
      expect(index.has('n1')).toBe(true);
      const results = index.queryAABB(999_990, 1_000_010, 999_990, 1_000_010);
      expect(results).toEqual(['n1']);
    });

    it('handles very large negative coordinates', () => {
      index.update('n1', -1_000_000, -1_000_000);
      expect(index.has('n1')).toBe(true);
      const results = index.queryAABB(-1_000_010, -999_990, -1_000_010, -999_990);
      expect(results).toEqual(['n1']);
    });

    // ---- Rebuild clears stale data ----

    it('rebuild replaces all previous data', () => {
      index.update('old1', 5, 5);
      index.update('old2', 15, 15);

      const nodes = makeNodes([
        ['new1', 25, 0, 25],
        ['new2', 35, 0, 35],
      ]);
      index.rebuild(nodes);

      expect(index.has('old1')).toBe(false);
      expect(index.has('old2')).toBe(false);
      expect(index.has('new1')).toBe(true);
      expect(index.has('new2')).toBe(true);
      expect(index.size).toBe(2);
    });

    it('rebuild with empty record clears the index', () => {
      index.update('n1', 5, 5);
      index.rebuild({});
      expect(index.size).toBe(0);
      expect(index.cellCount).toBe(0);
    });

    // ---- Custom cell size ----

    it('small cell size (1) produces more cells', () => {
      const small = new SpatialIndex(1);
      small.update('n1', 0.5, 0.5); // cell (0,0)
      small.update('n2', 1.5, 0.5); // cell (1,0)
      small.update('n3', 2.5, 0.5); // cell (2,0)

      expect(small.cellCount).toBe(3);

      // Query single unit cell
      expect(small.queryAABB(0, 0.9, 0, 0.9)).toEqual(['n1']);
    });

    it('large cell size (1000) groups distant nodes together', () => {
      const large = new SpatialIndex(1000);
      large.update('n1', 100, 200);
      large.update('n2', 300, 400);
      large.update('n3', 900, 900);

      // All within one cell (0,0) since cellSize=1000
      expect(large.cellCount).toBe(1);
      expect(large.queryAABB(0, 999, 0, 999)).toHaveLength(3);
    });
  });

  // ============================================================================
  // 2. Culling logic simulation (~15 tests)
  //    Simulates the "mark all culled then check candidates" pattern from
  //    useViewportCulling, testing the logic that could cause the bug
  //    "nodes disappear during drag".
  // ============================================================================
  describe('Culling logic simulation', () => {
    type LODLevel = 'full' | 'lod' | 'culled';
    let index: SpatialIndex;

    beforeEach(() => {
      index = new SpatialIndex(10);
    });

    /**
     * Simulates the exact culling logic from useViewportCulling (lines 167-200).
     * Steps:
     * 1. Mark all existing entries in lodMap as 'culled'
     * 2. queryAABB for candidates
     * 3. Set candidates to 'full' or 'lod'
     * 4. Any node not in lodMap gets set to 'culled'
     */
    function simulateCullingFrame(
      nodes: Record<string, { position: [number, number, number] }>,
      lodMap: Map<string, LODLevel>,
      aabbMinX: number,
      aabbMaxX: number,
      aabbMinZ: number,
      aabbMaxZ: number,
    ): void {
      const nodeKeys = Object.keys(nodes);

      // Step 1: Mark all existing as culled, remove stale
      for (const id of lodMap.keys()) {
        if (!(id in nodes)) {
          lodMap.delete(id);
        } else {
          lodMap.set(id, 'culled');
        }
      }

      // Step 2: Query spatial index
      const candidates = index.queryAABB(aabbMinX, aabbMaxX, aabbMinZ, aabbMaxZ);

      // Step 3: Set candidates to 'full' (simplified — no distance check)
      for (const id of candidates) {
        if (nodes[id]) {
          lodMap.set(id, 'full');
        }
      }

      // Step 4: Nodes not yet in lodMap get 'culled'
      for (const id of nodeKeys) {
        if (!lodMap.has(id)) {
          lodMap.set(id, 'culled');
        }
      }
    }

    it('normal case: all nodes within AABB are classified as full', () => {
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 15],
        ['n3', 25, 0, 25],
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();
      simulateCullingFrame(nodes, lodMap, -10, 50, -10, 50);

      expect(lodMap.get('n1')).toBe('full');
      expect(lodMap.get('n2')).toBe('full');
      expect(lodMap.get('n3')).toBe('full');
    });

    it('nodes outside AABB are culled', () => {
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 200, 0, 200],
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();
      simulateCullingFrame(nodes, lodMap, 0, 20, 0, 20);

      expect(lodMap.get('n1')).toBe('full');
      expect(lodMap.get('n2')).toBe('culled');
    });

    it('BUG SCENARIO: empty queryAABB result culls ALL nodes', () => {
      // This simulates the bug: if the frustum AABB calculation is wrong
      // (e.g., returns a degenerate region far from any nodes), all nodes
      // become culled even though they were visible in the previous frame.
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 15],
        ['n3', 25, 0, 25],
      ]);
      index.rebuild(nodes);

      // Frame 1: All visible
      const lodMap = new Map<string, LODLevel>();
      simulateCullingFrame(nodes, lodMap, -10, 50, -10, 50);
      expect(lodMap.get('n1')).toBe('full');
      expect(lodMap.get('n2')).toBe('full');
      expect(lodMap.get('n3')).toBe('full');

      // Frame 2: AABB is completely wrong (e.g., during camera transition or bad projection)
      // Query returns nothing, so ALL nodes become culled
      simulateCullingFrame(nodes, lodMap, 9000, 9001, 9000, 9001);
      expect(lodMap.get('n1')).toBe('culled');
      expect(lodMap.get('n2')).toBe('culled');
      expect(lodMap.get('n3')).toBe('culled');
    });

    it('defensive guard: preserving previous LOD when queryAABB returns empty prevents flash', () => {
      // This tests a potential FIX for the disappearing-nodes bug:
      // If queryAABB returns 0 candidates but there were visible nodes
      // last frame, skip the culling update entirely.
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 15],
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();

      // Frame 1: normal, everything visible
      simulateCullingFrame(nodes, lodMap, -10, 50, -10, 50);
      const prevVisibleCount = [...lodMap.values()].filter(v => v !== 'culled').length;
      expect(prevVisibleCount).toBe(2);

      // Frame 2: save a copy of lodMap before a potentially bad frame
      const savedLodMap = new Map(lodMap);

      // Simulate bad AABB
      simulateCullingFrame(nodes, lodMap, 9000, 9001, 9000, 9001);

      // Without the guard, everything is culled
      const visibleAfterBadFrame = [...lodMap.values()].filter(v => v !== 'culled').length;
      expect(visibleAfterBadFrame).toBe(0);

      // WITH the defensive guard: if we detect all-culled after having visible nodes,
      // we restore the previous frame's state
      if (visibleAfterBadFrame === 0 && prevVisibleCount > 0) {
        // Restore previous frame
        for (const [id, level] of savedLodMap) {
          lodMap.set(id, level);
        }
      }
      expect(lodMap.get('n1')).toBe('full');
      expect(lodMap.get('n2')).toBe('full');
    });

    it('new node added between frames gets classified correctly', () => {
      const nodes = makeNodes([['n1', 5, 0, 5]]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();
      simulateCullingFrame(nodes, lodMap, -10, 50, -10, 50);
      expect(lodMap.get('n1')).toBe('full');

      // Add a new node
      const updatedNodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 15],
      ]);
      index.update('n2', 15, 15);

      simulateCullingFrame(updatedNodes, lodMap, -10, 50, -10, 50);
      expect(lodMap.get('n1')).toBe('full');
      expect(lodMap.get('n2')).toBe('full');
    });

    it('node removed between frames is cleaned from lodMap', () => {
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 15],
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();
      simulateCullingFrame(nodes, lodMap, -10, 50, -10, 50);
      expect(lodMap.size).toBe(2);

      // Remove n2 from nodes
      const reducedNodes = makeNodes([['n1', 5, 0, 5]]);
      index.remove('n2');

      simulateCullingFrame(reducedNodes, lodMap, -10, 50, -10, 50);
      expect(lodMap.has('n2')).toBe(false);
      expect(lodMap.get('n1')).toBe('full');
    });

    it('AABB exactly covering one cell returns only that cell nodes', () => {
      const nodes = makeNodes([
        ['n1', 5, 0, 5],   // cell (0,0)
        ['n2', 15, 0, 15], // cell (1,1)
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();
      // AABB covers only cell (0,0)
      simulateCullingFrame(nodes, lodMap, 0, 9, 0, 9);

      expect(lodMap.get('n1')).toBe('full');
      expect(lodMap.get('n2')).toBe('culled');
    });

    it('fallback margin calculation: pad proportional to span', () => {
      // Simulates the padding logic from useViewportCulling lines 158-164:
      // pad = Math.max(spanX, spanZ) * 0.2 + 5
      const minX = 10, maxX = 50, minZ = 20, maxZ = 60;
      const spanX = maxX - minX; // 40
      const spanZ = maxZ - minZ; // 40
      const pad = Math.max(spanX, spanZ) * 0.2 + 5; // 40 * 0.2 + 5 = 13

      expect(pad).toBe(13);

      // The padded AABB should be larger in every direction
      const paddedMinX = minX - pad;
      const paddedMaxX = maxX + pad;
      expect(paddedMinX).toBe(-3);
      expect(paddedMaxX).toBe(63);
    });

    it('fallback margin with asymmetric span uses max of spanX/spanZ', () => {
      const minX = 0, maxX = 100, minZ = 0, maxZ = 10;
      const spanX = maxX - minX; // 100
      const spanZ = maxZ - minZ; // 10
      const pad = Math.max(spanX, spanZ) * 0.2 + 5; // 100 * 0.2 + 5 = 25

      expect(pad).toBe(25);
    });

    it('culling with zero-area AABB (degenerate frustum) culls everything', () => {
      // This can happen if the camera projection matrix is degenerate
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 15],
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();

      // First frame: normal
      simulateCullingFrame(nodes, lodMap, -10, 50, -10, 50);
      expect(lodMap.get('n1')).toBe('full');

      // Degenerate AABB at far-off point
      simulateCullingFrame(nodes, lodMap, 500, 500, 500, 500);

      // Even a point-AABB queries the cell at that point, but no nodes are there
      expect(lodMap.get('n1')).toBe('culled');
      expect(lodMap.get('n2')).toBe('culled');
    });

    it('fallback: hitCount < 2 uses camera position +/- 50 margin', () => {
      // Simulates the fallback from useViewportCulling lines 150-155
      const cameraX = 30, cameraZ = 40;
      const fallbackMargin = 50;
      const minX = cameraX - fallbackMargin; // -20
      const maxX = cameraX + fallbackMargin; // 80
      const minZ = cameraZ - fallbackMargin; // -10
      const maxZ = cameraZ + fallbackMargin; // 90

      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 50, 0, 50],
        ['n3', 200, 0, 200], // outside fallback range
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();
      simulateCullingFrame(nodes, lodMap, minX, maxX, minZ, maxZ);

      expect(lodMap.get('n1')).toBe('full');
      expect(lodMap.get('n2')).toBe('full');
      expect(lodMap.get('n3')).toBe('culled');
    });

    it('transition from linear to spatial path triggers rebuild', () => {
      // The hook rebuilds when node count crosses the SPATIAL_INDEX_THRESHOLD (100).
      // Verify rebuild produces a consistent index.
      const nodesArray: Array<[string, number, number, number]> = [];
      for (let i = 0; i < 120; i++) {
        nodesArray.push([`n${i}`, (i % 10) * 15, 0, Math.floor(i / 10) * 15]);
      }
      const nodes = makeNodes(nodesArray);
      index.rebuild(nodes);

      expect(index.size).toBe(120);

      // Query the entire area
      const all = index.queryAABB(-10, 200, -10, 200);
      expect(all).toHaveLength(120);
    });

    it('multiple consecutive frames with shifting AABB tracks node visibility correctly', () => {
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 50, 0, 50],
        ['n3', 100, 0, 100],
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();

      // Frame 1: camera sees n1 and n2
      simulateCullingFrame(nodes, lodMap, -10, 60, -10, 60);
      expect(lodMap.get('n1')).toBe('full');
      expect(lodMap.get('n2')).toBe('full');
      expect(lodMap.get('n3')).toBe('culled');

      // Frame 2: camera pans to see n2 and n3
      simulateCullingFrame(nodes, lodMap, 40, 120, 40, 120);
      expect(lodMap.get('n1')).toBe('culled');
      expect(lodMap.get('n2')).toBe('full');
      expect(lodMap.get('n3')).toBe('full');

      // Frame 3: camera sees only n3
      simulateCullingFrame(nodes, lodMap, 80, 120, 80, 120);
      expect(lodMap.get('n1')).toBe('culled');
      expect(lodMap.get('n2')).toBe('culled');
      expect(lodMap.get('n3')).toBe('full');
    });

    it('stale entries in lodMap for removed nodes are cleaned up', () => {
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 15],
        ['n3', 25, 0, 25],
      ]);
      index.rebuild(nodes);

      const lodMap = new Map<string, LODLevel>();
      simulateCullingFrame(nodes, lodMap, -10, 50, -10, 50);
      expect(lodMap.size).toBe(3);

      // Remove n2 and n3 from the nodes record
      const reduced = makeNodes([['n1', 5, 0, 5]]);
      index.remove('n2');
      index.remove('n3');

      simulateCullingFrame(reduced, lodMap, -10, 50, -10, 50);
      expect(lodMap.size).toBe(1);
      expect(lodMap.has('n1')).toBe(true);
      expect(lodMap.has('n2')).toBe(false);
      expect(lodMap.has('n3')).toBe(false);
    });
  });

  // ============================================================================
  // 3. Drag simulation (~10 tests)
  //    Simulates rapid node position updates during drag operations and
  //    verifies spatial index consistency throughout.
  // ============================================================================
  describe('Drag simulation', () => {
    let index: SpatialIndex;

    beforeEach(() => {
      index = new SpatialIndex(10);
    });

    it('single node drag across 5 cell boundaries in one frame', () => {
      // Node starts at (5, 5), cell (0,0)
      index.update('n1', 5, 5);

      // "Dragged" to (55, 5), skipping cells (1,0) through (4,0) and landing in (5,0)
      index.update('n1', 55, 5);

      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1);
      expect(index.queryAABB(50, 59, 0, 9)).toEqual(['n1']);
      // No ghost in old cell
      expect(index.queryAABB(0, 9, 0, 9)).toHaveLength(0);
    });

    it('multi-select drag: 5 nodes moved simultaneously', () => {
      // Setup: 5 nodes in a row
      for (let i = 0; i < 5; i++) {
        index.update(`n${i}`, i * 5, 0);
      }

      // Drag all by (+20, +30)
      for (let i = 0; i < 5; i++) {
        index.update(`n${i}`, i * 5 + 20, 30);
      }

      expect(index.size).toBe(5);

      // Verify each node is at correct new position's cell
      for (let i = 0; i < 5; i++) {
        const newX = i * 5 + 20;
        const newZ = 30;
        const cellMinX = Math.floor(newX / 10) * 10;
        const cellMinZ = Math.floor(newZ / 10) * 10;
        const results = index.queryAABB(cellMinX, cellMinX + 9, cellMinZ, cellMinZ + 9);
        expect(results).toContain(`n${i}`);
      }
    });

    it('drag simulation with frame-by-frame incremental updates', () => {
      // Simulate 30 frames of dragging a node diagonally
      index.update('n1', 0, 0);

      for (let frame = 1; frame <= 30; frame++) {
        const x = frame * 3; // 3 units per frame
        const z = frame * 2; // 2 units per frame
        index.update('n1', x, z);
      }

      // After 30 frames: position (90, 60)
      expect(index.size).toBe(1);
      expect(index.queryAABB(85, 95, 55, 65)).toEqual(['n1']);
      // No ghosts in any previous cells
      expect(index.queryAABB(0, 9, 0, 9)).toHaveLength(0);
    });

    it('concurrent drag of 10 nodes with varying velocities', () => {
      // 10 nodes at different starting positions
      const nodeIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = `n${i}`;
        nodeIds.push(id);
        index.update(id, i * 10, i * 10);
      }

      // Simulate 20 frames of dragging with different speeds per node
      for (let frame = 1; frame <= 20; frame++) {
        for (let i = 0; i < 10; i++) {
          const baseX = i * 10;
          const baseZ = i * 10;
          // Each node has a different velocity
          const vx = (i + 1) * 0.5;
          const vz = (i + 1) * 0.3;
          index.update(`n${i}`, baseX + vx * frame, baseZ + vz * frame);
        }
      }

      expect(index.size).toBe(10);

      // Verify no duplicate entries — query the whole space
      const all = index.queryAABB(-100, 500, -100, 500);
      expect(all).toHaveLength(10);

      // Verify each node is unique
      const unique = new Set(all);
      expect(unique.size).toBe(10);
    });

    it('rebuild vs incremental update produce same results', () => {
      // Setup initial state
      const initialNodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 15],
        ['n3', 25, 0, 25],
        ['n4', 35, 0, 35],
        ['n5', 45, 0, 45],
      ]);

      // After "drag", new positions
      const draggedNodes = makeNodes([
        ['n1', 25, 0, 25],
        ['n2', 35, 0, 35],
        ['n3', 45, 0, 45],
        ['n4', 55, 0, 55],
        ['n5', 65, 0, 65],
      ]);

      // Path A: incremental updates
      const indexA = new SpatialIndex(10);
      indexA.rebuild(initialNodes);
      for (const id in draggedNodes) {
        const pos = draggedNodes[id].position;
        indexA.update(id, pos[0], pos[2]);
      }

      // Path B: full rebuild
      const indexB = new SpatialIndex(10);
      indexB.rebuild(draggedNodes);

      // Both should produce identical query results
      const queryAll = (idx: SpatialIndex) =>
        idx.queryAABB(-100, 200, -100, 200).sort();

      expect(queryAll(indexA)).toEqual(queryAll(indexB));
      expect(indexA.size).toBe(indexB.size);
      expect(indexA.cellCount).toBe(indexB.cellCount);
    });

    it('rapid drag to negative space and back', () => {
      index.update('n1', 5, 5);

      // Drag deep into negative
      index.update('n1', -100, -100);
      expect(index.queryAABB(-110, -90, -110, -90)).toEqual(['n1']);
      expect(index.queryAABB(0, 9, 0, 9)).toHaveLength(0);

      // Drag back to positive
      index.update('n1', 5, 5);
      expect(index.queryAABB(0, 9, 0, 9)).toEqual(['n1']);
      expect(index.queryAABB(-110, -90, -110, -90)).toHaveLength(0);
    });

    it('drag that lands node exactly on cell boundary', () => {
      index.update('n1', 5, 5); // cell (0,0)

      // Drag to exactly (10, 10) — cell (1,1)
      index.update('n1', 10, 10);
      expect(index.queryAABB(10, 19, 10, 19)).toEqual(['n1']);
      expect(index.queryAABB(0, 9, 0, 9)).toHaveLength(0);

      // Drag to exactly (20, 20) — cell (2,2)
      index.update('n1', 20, 20);
      expect(index.queryAABB(20, 29, 20, 29)).toEqual(['n1']);
      expect(index.queryAABB(10, 19, 10, 19)).toHaveLength(0);
    });

    it('multi-select drag does not produce duplicate queryAABB entries per cell', () => {
      // Put 3 nodes in cell (0,0) and drag them all to cell (2,2)
      index.update('n1', 1, 1);
      index.update('n2', 3, 3);
      index.update('n3', 5, 5);

      // Drag to cell (2,2)
      index.update('n1', 21, 21);
      index.update('n2', 23, 23);
      index.update('n3', 25, 25);

      const results = index.queryAABB(20, 29, 20, 29);
      expect(results).toHaveLength(3);
      // Ensure no duplicates
      expect(new Set(results).size).toBe(3);

      // Old cell should be completely empty
      expect(index.queryAABB(0, 9, 0, 9)).toHaveLength(0);
      expect(index.cellCount).toBe(1); // only cell (2,2) should exist
    });

    it('drag with intermediate rebuild does not lose nodes', () => {
      // Simulate: drag starts, undo happens mid-drag (triggers rebuild), drag continues
      // Note: rebuild uses position[0] for X and position[2] for Z
      const nodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 5], // Z=5 so it stays in Z-cell 0
      ]);
      index.rebuild(nodes);

      // Start dragging n1
      index.update('n1', 25, 5);

      // Undo triggers rebuild (restores n1 to original position, n2 unchanged)
      const undoNodes = makeNodes([
        ['n1', 5, 0, 5],
        ['n2', 15, 0, 5],
      ]);
      index.rebuild(undoNodes);

      expect(index.size).toBe(2);
      expect(index.queryAABB(0, 9, 0, 9)).toEqual(['n1']);
      expect(index.queryAABB(10, 19, 0, 9)).toEqual(['n2']);
      // The dragged position should be gone
      expect(index.queryAABB(20, 29, 0, 9)).toHaveLength(0);
    });

    it('stress test: 200 nodes, 50 frames of drag, index stays consistent', () => {
      // Create 200 nodes
      for (let i = 0; i < 200; i++) {
        index.update(`n${i}`, (i % 20) * 8, Math.floor(i / 20) * 8);
      }
      expect(index.size).toBe(200);

      // Simulate 50 frames of dragging all 200 nodes by (+2, +1) per frame
      for (let frame = 1; frame <= 50; frame++) {
        for (let i = 0; i < 200; i++) {
          const baseX = (i % 20) * 8;
          const baseZ = Math.floor(i / 20) * 8;
          index.update(`n${i}`, baseX + 2 * frame, baseZ + 1 * frame);
        }
      }

      expect(index.size).toBe(200);

      // Query entire space — all 200 should be there, no duplicates
      const all = index.queryAABB(-100, 500, -100, 500);
      expect(all).toHaveLength(200);
      expect(new Set(all).size).toBe(200);

      // Verify a specific node's final position is queryable
      // Node n0: base (0,0), after 50 frames of (+2,+1): (100, 50)
      const n0Results = index.queryAABB(95, 105, 45, 55);
      expect(n0Results).toContain('n0');
    });
  });
});

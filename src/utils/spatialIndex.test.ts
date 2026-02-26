import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialIndex } from './spatialIndex';

describe('SpatialIndex', () => {
  let index: SpatialIndex;

  beforeEach(() => {
    index = new SpatialIndex();
  });

  // ── Constructor ──────────────────────────────────────────────────────

  describe('constructor', () => {
    it('uses default cell size of 10', () => {
      expect(index.cellSize).toBe(10);
    });

    it('accepts a custom cell size', () => {
      const custom = new SpatialIndex(25);
      expect(custom.cellSize).toBe(25);
    });
  });

  // ── update ───────────────────────────────────────────────────────────

  describe('update', () => {
    it('inserts a single node and updates size/has/cellCount', () => {
      index.update('n1', 5, 5);

      expect(index.size).toBe(1);
      expect(index.has('n1')).toBe(true);
      expect(index.cellCount).toBe(1);
    });

    it('inserts multiple nodes into the same cell', () => {
      // Both positions fall within cell (0,0) for cellSize=10
      index.update('n1', 1, 2);
      index.update('n2', 3, 7);

      expect(index.size).toBe(2);
      expect(index.cellCount).toBe(1);

      const results = index.queryAABB(0, 9, 0, 9);
      expect(results).toContain('n1');
      expect(results).toContain('n2');
    });

    it('inserts nodes into different cells', () => {
      index.update('n1', 5, 5);   // cell (0, 0)
      index.update('n2', 15, 25); // cell (1, 2)

      expect(index.size).toBe(2);
      expect(index.cellCount).toBe(2);
    });

    it('moves a node to a different cell and cleans up the old cell', () => {
      index.update('n1', 5, 5);   // cell (0, 0)
      expect(index.cellCount).toBe(1);

      index.update('n1', 15, 15); // cell (1, 1)
      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1); // old empty cell removed

      // Node should only appear in the new cell's region
      const oldRegion = index.queryAABB(0, 9, 0, 9);
      expect(oldRegion).toHaveLength(0);

      const newRegion = index.queryAABB(10, 19, 10, 19);
      expect(newRegion).toEqual(['n1']);
    });

    it('is a no-op when the position maps to the same cell', () => {
      index.update('n1', 1, 1);
      index.update('n1', 2, 3); // still cell (0, 0)

      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes a node from the index and decrements size', () => {
      index.update('n1', 5, 5);
      index.update('n2', 6, 6);
      index.remove('n1');

      expect(index.size).toBe(1);
      expect(index.has('n1')).toBe(false);
      expect(index.has('n2')).toBe(true);
    });

    it('removes the cell entry when the last node in a cell is removed', () => {
      index.update('n1', 5, 5);
      expect(index.cellCount).toBe(1);

      index.remove('n1');
      expect(index.cellCount).toBe(0);
    });

    it('is a no-op for an unknown node', () => {
      index.update('n1', 5, 5);
      index.remove('nonexistent');

      expect(index.size).toBe(1);
      expect(index.cellCount).toBe(1);
    });
  });

  // ── clear ────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('empties all data', () => {
      index.update('n1', 5, 5);
      index.update('n2', 15, 15);
      index.update('n3', 25, 25);

      index.clear();

      expect(index.size).toBe(0);
      expect(index.cellCount).toBe(0);
      expect(index.has('n1')).toBe(false);
    });
  });

  // ── rebuild ──────────────────────────────────────────────────────────

  describe('rebuild', () => {
    it('builds from a record of nodes', () => {
      const nodes: Record<string, { position: [number, number, number] }> = {
        a: { position: [5, 0, 5] },
        b: { position: [15, 0, 5] },
        c: { position: [5, 0, 15] },
      };

      index.rebuild(nodes);

      expect(index.size).toBe(3);
      expect(index.has('a')).toBe(true);
      expect(index.has('b')).toBe(true);
      expect(index.has('c')).toBe(true);

      // 'a' is in cell (0,0), 'b' in (1,0), 'c' in (0,1) — three distinct cells
      expect(index.cellCount).toBe(3);
    });
  });

  // ── queryAABB ────────────────────────────────────────────────────────

  describe('queryAABB', () => {
    it('finds nodes within a bounding box', () => {
      index.update('n1', 5, 5);
      index.update('n2', 15, 15);

      const results = index.queryAABB(0, 9, 0, 9);
      expect(results).toEqual(['n1']);
    });

    it('returns empty array for an empty region', () => {
      index.update('n1', 5, 5);

      const results = index.queryAABB(100, 200, 100, 200);
      expect(results).toHaveLength(0);
    });

    it('returns nodes from multiple cells', () => {
      index.update('n1', 5, 5);   // cell (0, 0)
      index.update('n2', 15, 5);  // cell (1, 0)
      index.update('n3', 5, 15);  // cell (0, 1)

      const results = index.queryAABB(0, 19, 0, 19);
      expect(results).toHaveLength(3);
      expect(results).toContain('n1');
      expect(results).toContain('n2');
      expect(results).toContain('n3');
    });

    it('handles queries spanning cell boundaries', () => {
      // Place node right at boundary: position 10 => cell (1, 0)
      index.update('n1', 10, 0);
      // Position 9.99 => cell (0, 0)
      index.update('n2', 9, 0);

      // Query that spans the boundary at x=10
      const results = index.queryAABB(8, 12, -1, 1);
      expect(results).toHaveLength(2);
      expect(results).toContain('n1');
      expect(results).toContain('n2');
    });

    it('works with negative coordinates', () => {
      index.update('n1', -5, -5);   // cell (-1, -1)
      index.update('n2', -15, -15); // cell (-2, -2)

      const results = index.queryAABB(-20, -1, -20, -1);
      expect(results).toHaveLength(2);
      expect(results).toContain('n1');
      expect(results).toContain('n2');
    });
  });

  // ── has ──────────────────────────────────────────────────────────────

  describe('has', () => {
    it('returns true for an existing node and false for a missing one', () => {
      index.update('n1', 5, 5);

      expect(index.has('n1')).toBe(true);
      expect(index.has('n2')).toBe(false);
    });
  });

  // ── Multiple operations in sequence ──────────────────────────────────

  describe('multiple operations in sequence', () => {
    it('handles update, remove, and query correctly in sequence', () => {
      // Insert several nodes
      index.update('a', 5, 5);
      index.update('b', 15, 5);
      index.update('c', 25, 5);

      expect(index.size).toBe(3);

      // Remove one
      index.remove('b');
      expect(index.size).toBe(2);
      expect(index.has('b')).toBe(false);

      // Move 'a' to where 'b' was
      index.update('a', 15, 5);
      expect(index.size).toBe(2);

      // Query should find 'a' in its new location
      const region = index.queryAABB(10, 19, 0, 9);
      expect(region).toEqual(['a']);

      // 'a' should NOT appear in old location
      const oldRegion = index.queryAABB(0, 9, 0, 9);
      expect(oldRegion).toHaveLength(0);

      // 'c' still in its original cell
      const cRegion = index.queryAABB(20, 29, 0, 9);
      expect(cRegion).toEqual(['c']);

      // Clear and verify empty
      index.clear();
      expect(index.size).toBe(0);
      expect(index.queryAABB(-1000, 1000, -1000, 1000)).toHaveLength(0);
    });
  });
});

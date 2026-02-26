import { describe, it, expect } from 'vitest';
import { getPortWorldPos, NODE_W, NODE_D } from './portPositions';

describe('portPositions', () => {
  describe('constants', () => {
    it('exports correct node dimensions', () => {
      expect(NODE_W).toBe(1.6);
      expect(NODE_D).toBe(0.8);
    });
  });

  describe('getPortWorldPos', () => {
    const origin: [number, number, number] = [0, 0, 0];

    it('places output ports on the right side (+X)', () => {
      const pos = getPortWorldPos(origin, 'output', 0, 1);
      expect(pos[0]).toBeGreaterThan(0);
      expect(pos[0]).toBeCloseTo(NODE_W / 2 + 0.05);
    });

    it('places input ports on the left side (-X)', () => {
      const pos = getPortWorldPos(origin, 'input', 0, 1);
      expect(pos[0]).toBeLessThan(0);
      expect(pos[0]).toBeCloseTo(-NODE_W / 2 - 0.05);
    });

    it('preserves node Y position', () => {
      const nodePos: [number, number, number] = [5, 3, 2];
      const pos = getPortWorldPos(nodePos, 'input', 0, 1);
      expect(pos[1]).toBe(3);
    });

    it('centers single port at Z=0 relative to node', () => {
      const pos = getPortWorldPos(origin, 'output', 0, 1);
      expect(pos[2]).toBe(0);
    });

    it('distributes multiple ports along Z axis', () => {
      const pos0 = getPortWorldPos(origin, 'input', 0, 2);
      const pos1 = getPortWorldPos(origin, 'input', 1, 2);
      // First port should be at negative Z, second at positive Z
      expect(pos0[2]).toBeLessThan(pos1[2]);
      // They should be symmetric around 0
      expect(pos0[2]).toBeCloseTo(-pos1[2]);
    });

    it('offsets positions by node position', () => {
      const nodePos: [number, number, number] = [10, 5, 3];
      const pos = getPortWorldPos(nodePos, 'output', 0, 1);
      expect(pos[0]).toBeCloseTo(10 + NODE_W / 2 + 0.05);
      expect(pos[1]).toBe(5);
      expect(pos[2]).toBeCloseTo(3); // Single port centered
    });

    it('handles 3 ports with correct spacing', () => {
      const p0 = getPortWorldPos(origin, 'input', 0, 3);
      const p1 = getPortWorldPos(origin, 'input', 1, 3);
      const p2 = getPortWorldPos(origin, 'input', 2, 3);
      // Middle port should be at center
      expect(p1[2]).toBeCloseTo(0);
      // Outer ports should be symmetric
      expect(p0[2]).toBeCloseTo(-p2[2]);
    });
  });
});

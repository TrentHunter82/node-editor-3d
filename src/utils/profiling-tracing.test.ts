import { describe, it, expect } from 'vitest';
import { getUpstreamPath, getDownstreamPath } from './profiling';
import type { EditorNode, Connection } from '../types';

// --- Helpers ---

function makeNode(id: string): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: id,
    data: {},
    inputs: [{ id: `${id}-in-0`, label: 'in', portType: 'any' }],
    outputs: [{ id: `${id}-out-0`, label: 'out', portType: 'any' }],
  };
}

function makeConn(id: string, src: string, tgt: string): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: 0, targetNodeId: tgt, targetPortIndex: 0 };
}

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  const rec: Record<string, T> = {};
  for (const item of items) rec[item.id] = item;
  return rec;
}

// --- getUpstreamPath ---

describe('getUpstreamPath', () => {
  it('returns empty for node with no incoming connections', () => {
    const nodes = toRecord([makeNode('A')]);
    const connections: Record<string, Connection> = {};

    expect(getUpstreamPath('A', nodes, connections)).toEqual([]);
  });

  it('returns direct parent', () => {
    // A -> B
    const nodes = toRecord([makeNode('A'), makeNode('B')]);
    const connections = toRecord([makeConn('c1', 'A', 'B')]);

    const result = getUpstreamPath('B', nodes, connections);
    expect(result).toEqual(['A']);
  });

  it('returns transitive ancestors', () => {
    // A -> B -> C
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C')]);
    const connections = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'B', 'C'),
    ]);

    const result = getUpstreamPath('C', nodes, connections);
    // BFS: closest first, so B before A
    expect(result).toEqual(['B', 'A']);
  });

  it('handles diamond graph', () => {
    // A -> C, B -> C
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C')]);
    const connections = toRecord([
      makeConn('c1', 'A', 'C'),
      makeConn('c2', 'B', 'C'),
    ]);

    const result = getUpstreamPath('C', nodes, connections);
    // Both A and B are direct parents; order depends on connection iteration
    expect(result).toHaveLength(2);
    expect(result).toContain('A');
    expect(result).toContain('B');
  });

  it('handles deep chain', () => {
    // A -> B -> C -> D -> E
    const nodes = toRecord([
      makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D'), makeNode('E'),
    ]);
    const connections = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'B', 'C'),
      makeConn('c3', 'C', 'D'),
      makeConn('c4', 'D', 'E'),
    ]);

    const result = getUpstreamPath('E', nodes, connections);
    // BFS order: D, C, B, A (closest first)
    expect(result).toEqual(['D', 'C', 'B', 'A']);
  });

  it('returns empty for nonexistent node', () => {
    const nodes = toRecord([makeNode('A')]);
    const connections: Record<string, Connection> = {};

    expect(getUpstreamPath('Z', nodes, connections)).toEqual([]);
  });

  it('does not include the node itself', () => {
    // A -> B
    const nodes = toRecord([makeNode('A'), makeNode('B')]);
    const connections = toRecord([makeConn('c1', 'A', 'B')]);

    const result = getUpstreamPath('B', nodes, connections);
    expect(result).not.toContain('B');
  });

  it('handles graph with branches', () => {
    // A -> B, A -> C, B -> D, C -> D
    const nodes = toRecord([
      makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D'),
    ]);
    const connections = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
      makeConn('c3', 'B', 'D'),
      makeConn('c4', 'C', 'D'),
    ]);

    const result = getUpstreamPath('D', nodes, connections);
    // D's direct parents are B and C; their shared parent is A
    expect(result).toHaveLength(3);
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
    // A should appear after B and C (BFS: closest first)
    expect(result.indexOf('A')).toBeGreaterThan(result.indexOf('B'));
    expect(result.indexOf('A')).toBeGreaterThan(result.indexOf('C'));
  });
});

// --- getDownstreamPath ---

describe('getDownstreamPath', () => {
  it('returns empty for node with no outgoing connections', () => {
    const nodes = toRecord([makeNode('A')]);
    const connections: Record<string, Connection> = {};

    expect(getDownstreamPath('A', nodes, connections)).toEqual([]);
  });

  it('returns direct child', () => {
    // A -> B
    const nodes = toRecord([makeNode('A'), makeNode('B')]);
    const connections = toRecord([makeConn('c1', 'A', 'B')]);

    const result = getDownstreamPath('A', nodes, connections);
    expect(result).toEqual(['B']);
  });

  it('returns transitive descendants', () => {
    // A -> B -> C
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C')]);
    const connections = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'B', 'C'),
    ]);

    const result = getDownstreamPath('A', nodes, connections);
    // BFS: closest first, so B before C
    expect(result).toEqual(['B', 'C']);
  });

  it('handles fan-out', () => {
    // A -> B, A -> C
    const nodes = toRecord([makeNode('A'), makeNode('B'), makeNode('C')]);
    const connections = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
    ]);

    const result = getDownstreamPath('A', nodes, connections);
    expect(result).toHaveLength(2);
    expect(result).toContain('B');
    expect(result).toContain('C');
  });

  it('handles deep chain', () => {
    // A -> B -> C -> D -> E
    const nodes = toRecord([
      makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D'), makeNode('E'),
    ]);
    const connections = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'B', 'C'),
      makeConn('c3', 'C', 'D'),
      makeConn('c4', 'D', 'E'),
    ]);

    const result = getDownstreamPath('A', nodes, connections);
    // BFS order: B, C, D, E (closest first)
    expect(result).toEqual(['B', 'C', 'D', 'E']);
  });

  it('does not include the node itself', () => {
    // A -> B
    const nodes = toRecord([makeNode('A'), makeNode('B')]);
    const connections = toRecord([makeConn('c1', 'A', 'B')]);

    const result = getDownstreamPath('A', nodes, connections);
    expect(result).not.toContain('A');
  });

  it('handles complex graph with merge', () => {
    // A -> B, A -> C, B -> D, C -> D, D -> E
    const nodes = toRecord([
      makeNode('A'), makeNode('B'), makeNode('C'), makeNode('D'), makeNode('E'),
    ]);
    const connections = toRecord([
      makeConn('c1', 'A', 'B'),
      makeConn('c2', 'A', 'C'),
      makeConn('c3', 'B', 'D'),
      makeConn('c4', 'C', 'D'),
      makeConn('c5', 'D', 'E'),
    ]);

    const result = getDownstreamPath('A', nodes, connections);
    expect(result).toHaveLength(4);
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toContain('D');
    expect(result).toContain('E');
    // B and C should appear before D (BFS: closest first)
    expect(result.indexOf('B')).toBeLessThan(result.indexOf('D'));
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('D'));
    // D should appear before E
    expect(result.indexOf('D')).toBeLessThan(result.indexOf('E'));
  });
});

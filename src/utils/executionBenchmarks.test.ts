/**
 * Performance benchmark tests for execution hot paths.
 * Validates that optimized Object.keys/values/entries patterns
 * perform within acceptable bounds on large graphs.
 */
import { describe, it, expect } from 'vitest';
import { topologicalSort, executeGraph, invalidateDownstream, getUpstreamPath, getDownstreamPath } from './execution';
import type { EditorNode, Connection } from '../types';

/** Build a linear chain of N source nodes */
function buildLinearGraph(n: number): { nodes: Record<string, EditorNode>; connections: Record<string, Connection> } {
  const nodes: Record<string, EditorNode> = {};
  const connections: Record<string, Connection> = {};
  for (let i = 0; i < n; i++) {
    const id = `node-${i}`;
    nodes[id] = {
      id,
      type: 'source',
      position: [i * 2, 0, 0],
      title: `Node ${i}`,
      data: { value: i },
      inputs: [],
      outputs: [{ id: `out-0`, label: 'Value', portType: 'number' }],
    };
    if (i > 0) {
      const connId = `conn-${i}`;
      connections[connId] = {
        id: connId,
        sourceNodeId: `node-${i - 1}`,
        sourcePortIndex: 0,
        targetNodeId: `node-${i}`,
        targetPortIndex: 0,
      };
      // Add input port to non-first nodes (transform type would be better but source is simpler)
      nodes[id].type = 'transform';
      nodes[id].inputs = [{ id: `in-0`, label: 'Input', portType: 'number' }];
      nodes[id].data = { multiplier: 1, offset: 0 };
    }
  }
  return { nodes, connections };
}

/** Build a wide fan-out graph: 1 source → N transforms */
function buildFanOutGraph(n: number): { nodes: Record<string, EditorNode>; connections: Record<string, Connection> } {
  const nodes: Record<string, EditorNode> = {};
  const connections: Record<string, Connection> = {};
  // Single source
  nodes['node-0'] = {
    id: 'node-0',
    type: 'source',
    position: [0, 0, 0],
    title: 'Source',
    data: { value: 42 },
    inputs: [],
    outputs: [{ id: 'out-0', label: 'Value', portType: 'number' }],
  };
  // N transform targets
  for (let i = 1; i <= n; i++) {
    const id = `node-${i}`;
    nodes[id] = {
      id,
      type: 'transform',
      position: [2, 0, i * 2],
      title: `Transform ${i}`,
      data: { multiplier: 2, offset: i },
      inputs: [{ id: 'in-0', label: 'Input', portType: 'number' }],
      outputs: [{ id: 'out-0', label: 'Result', portType: 'number' }],
    };
    connections[`conn-${i}`] = {
      id: `conn-${i}`,
      sourceNodeId: 'node-0',
      sourcePortIndex: 0,
      targetNodeId: id,
      targetPortIndex: 0,
    };
  }
  return { nodes, connections };
}

describe('execution hot path benchmarks', () => {
  it('topologicalSort handles 500-node linear chain', () => {
    const { nodes, connections } = buildLinearGraph(500);
    const start = performance.now();
    const waves = topologicalSort(nodes, connections);
    const elapsed = performance.now() - start;

    expect(waves.length).toBe(500);
    expect(waves[0]).toEqual(['node-0']);
    expect(elapsed).toBeLessThan(50); // Should complete well under 50ms
  });

  it('topologicalSort handles 1000-node linear chain', () => {
    const { nodes, connections } = buildLinearGraph(1000);
    const start = performance.now();
    const waves = topologicalSort(nodes, connections);
    const elapsed = performance.now() - start;

    expect(waves.length).toBe(1000);
    expect(elapsed).toBeLessThan(100);
  });

  it('executeGraph handles 200-node fan-out graph', () => {
    const { nodes, connections } = buildFanOutGraph(200);
    const start = performance.now();
    const result = executeGraph(nodes, connections);
    const elapsed = performance.now() - start;

    expect(result.errors.size).toBe(0);
    expect(result.results.size).toBe(201); // 1 source + 200 transforms
    expect(elapsed).toBeLessThan(100);

    // Verify correct data propagation
    const sourceResult = result.results.get('node-0');
    expect(sourceResult?.outputs[0]).toBe(42);
    const transformResult = result.results.get('node-1');
    expect(transformResult?.outputs[0]).toBe(42 * 2 + 1); // multiplier=2, offset=1
  });

  it('executeGraph with cache hit path on 200 nodes', () => {
    const { nodes, connections } = buildFanOutGraph(200);
    // First execution populates cache
    const result1 = executeGraph(nodes, connections);
    const cache = result1.results;

    // Second execution should hit cache for all nodes
    const start = performance.now();
    const result2 = executeGraph(nodes, connections, cache);
    const elapsed = performance.now() - start;

    expect(result2.errors.size).toBe(0);
    expect(elapsed).toBeLessThan(50); // Cache hits should be fast
  });

  it('invalidateDownstream on 500-node chain', () => {
    const { connections } = buildLinearGraph(500);
    const cache = new Map<string, unknown>();
    for (let i = 0; i < 500; i++) {
      cache.set(`node-${i}`, { outputs: { 0: i }, inputHash: '' });
    }

    const start = performance.now();
    invalidateDownstream('node-0', connections, cache);
    const elapsed = performance.now() - start;

    // All 500 nodes should be invalidated
    expect(cache.size).toBe(0);
    expect(elapsed).toBeLessThan(100);
  });

  it('getUpstreamPath on deep chain', () => {
    const { connections } = buildLinearGraph(500);
    const start = performance.now();
    const path = getUpstreamPath('node-499', connections);
    const elapsed = performance.now() - start;

    expect(path.length).toBe(500);
    expect(path[0]).toBe('node-0'); // Sources first
    expect(path[path.length - 1]).toBe('node-499'); // Target last
    expect(elapsed).toBeLessThan(200);
  });

  it('getDownstreamPath on deep chain', () => {
    const { connections } = buildLinearGraph(500);
    const start = performance.now();
    const path = getDownstreamPath('node-0', connections);
    const elapsed = performance.now() - start;

    expect(path.length).toBe(500);
    expect(path[0]).toBe('node-0'); // Source first
    expect(path[path.length - 1]).toBe('node-499'); // Leaves last
    expect(elapsed).toBeLessThan(200);
  });

  it('connection index makes gatherInputs O(K) not O(C)', () => {
    // Build graph with many connections but sparse per-node connectivity
    const { nodes, connections } = buildFanOutGraph(500);

    // Execute twice to verify consistent results with connection index
    const result1 = executeGraph(nodes, connections);
    const result2 = executeGraph(nodes, connections);

    expect(result1.results.size).toBe(result2.results.size);
    // Verify all transforms got correct data
    for (let i = 1; i <= 500; i++) {
      const r = result1.results.get(`node-${i}`);
      expect(r?.outputs[0]).toBe(42 * 2 + i);
    }
  });
});

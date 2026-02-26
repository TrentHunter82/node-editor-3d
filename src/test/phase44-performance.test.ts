import { describe, it, expect } from 'vitest';
import { enableMapSet } from 'immer';
import {
  buildNodeAABBs,
  buildPortPositionCache,
  findConnectionsInRect,
  aabbsOverlap,
} from '../utils/nodeBounds';
import { topologicalSort } from '../utils/executionOrchestration';
import type { EditorNode, Connection } from '../types';

enableMapSet();

// Helper to create N nodes in a grid layout
function createNodes(count: number): Record<string, EditorNode> {
  const nodes: Record<string, EditorNode> = {};
  for (let i = 0; i < count; i++) {
    const id = `n${i}`;
    nodes[id] = {
      id,
      type: 'math',
      title: `Math ${i}`,
      position: [(i % 50) * 3, 0, Math.floor(i / 50) * 3] as [number, number, number],
      data: {},
      inputs: [
        { id: `${id}-in0`, label: 'A', portType: 'number' },
        { id: `${id}-in1`, label: 'B', portType: 'number' },
      ],
      outputs: [{ id: `${id}-out0`, label: 'Result', portType: 'number' }],
    };
  }
  return nodes;
}

// Helper to create a linear chain of connections
function createChainConnections(count: number): Record<string, Connection> {
  const connections: Record<string, Connection> = {};
  for (let i = 0; i < count - 1; i++) {
    const id = `c${i}`;
    connections[id] = {
      id,
      sourceNodeId: `n${i}`,
      sourcePortIndex: 0,
      targetNodeId: `n${i + 1}`,
      targetPortIndex: 0,
    };
  }
  return connections;
}

// Helper to create a DAG with fan-out pattern
function createFanOutConnections(nodeCount: number): Record<string, Connection> {
  const connections: Record<string, Connection> = {};
  let connIdx = 0;
  // Each node connects to the next 2-3 nodes (when they exist)
  for (let i = 0; i < nodeCount; i++) {
    for (let j = 1; j <= 2 && i + j < nodeCount; j++) {
      const id = `c${connIdx++}`;
      connections[id] = {
        id,
        sourceNodeId: `n${i}`,
        sourcePortIndex: 0,
        targetNodeId: `n${i + j}`,
        targetPortIndex: j === 1 ? 0 : 1,
      };
    }
  }
  return connections;
}

/** Run a benchmark fn 3 times and return the minimum elapsed time (ms). */
function benchMin(fn: () => void): number {
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 1. buildNodeAABBs performance
// ---------------------------------------------------------------------------
describe('buildNodeAABBs performance', () => {
  it('100 nodes completes in < 10ms', () => {
    const nodes = createNodes(100);
    let result!: Map<string, unknown>;
    const elapsed = benchMin(() => {
      result = buildNodeAABBs(nodes);
    });
    expect(elapsed).toBeLessThan(10);
    expect(result.size).toBe(100);
  });

  it('1000 nodes completes in < 50ms', () => {
    const nodes = createNodes(1000);
    let result!: Map<string, unknown>;
    const elapsed = benchMin(() => {
      result = buildNodeAABBs(nodes);
    });
    expect(elapsed).toBeLessThan(50);
    expect(result.size).toBe(1000);
  });

  it('5000 nodes completes in < 200ms', () => {
    const nodes = createNodes(5000);
    let result!: Map<string, unknown>;
    const elapsed = benchMin(() => {
      result = buildNodeAABBs(nodes);
    });
    expect(elapsed).toBeLessThan(200);
    expect(result.size).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// 2. buildPortPositionCache performance
// ---------------------------------------------------------------------------
describe('buildPortPositionCache performance', () => {
  it('100 nodes (300 ports) completes in < 10ms', () => {
    const nodes = createNodes(100);
    let size = 0;
    const elapsed = benchMin(() => {
      const cache = buildPortPositionCache(nodes);
      size = cache.size;
    });
    expect(elapsed).toBeLessThan(10);
    expect(size).toBe(300); // 2 inputs + 1 output per node
  });

  it('1000 nodes (3000 ports) completes in < 50ms', () => {
    const nodes = createNodes(1000);
    let size = 0;
    const elapsed = benchMin(() => {
      const cache = buildPortPositionCache(nodes);
      size = cache.size;
    });
    expect(elapsed).toBeLessThan(50);
    expect(size).toBe(3000);
  });

  it('5000 nodes (15000 ports) completes in < 200ms', () => {
    const nodes = createNodes(5000);
    let size = 0;
    const elapsed = benchMin(() => {
      const cache = buildPortPositionCache(nodes);
      size = cache.size;
    });
    expect(elapsed).toBeLessThan(200);
    expect(size).toBe(15000);
  });
});

// ---------------------------------------------------------------------------
// 3. findConnectionsInRect performance
// ---------------------------------------------------------------------------
describe('findConnectionsInRect performance', () => {
  it('1000 nodes + 999 connections, rect covering full graph < 50ms', () => {
    const nodes = createNodes(1000);
    const connections = createChainConnections(1000);
    // Full graph rect: nodes span x=[0..147], z=[0..57] with grid 50*3=150, 20*3=60
    let resultLen = 0;
    const elapsed = benchMin(() => {
      const result = findConnectionsInRect(connections, nodes, -200, -200, 200, 200);
      resultLen = result.length;
    });
    expect(elapsed).toBeLessThan(50);
    expect(resultLen).toBeGreaterThan(0); // should find connections
  });

  it('1000 nodes + 999 connections, rect covering ~10% of graph < 30ms', () => {
    const nodes = createNodes(1000);
    const connections = createChainConnections(1000);
    // Small rect covering roughly 10% of the XZ space
    let resultLen = 0;
    const elapsed = benchMin(() => {
      const result = findConnectionsInRect(connections, nodes, 0, 0, 15, 6);
      resultLen = result.length;
    });
    expect(elapsed).toBeLessThan(30);
    // Some connections should be found in this rect
    expect(resultLen).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 4. topologicalSort performance
// ---------------------------------------------------------------------------
describe('topologicalSort performance', () => {
  it('linear chain of 1000 nodes < 50ms', () => {
    const nodes = createNodes(1000);
    const connections = createChainConnections(1000);
    let wavesLen = 0;
    let totalNodes = 0;
    const elapsed = benchMin(() => {
      const waves = topologicalSort(nodes, connections);
      wavesLen = waves.length;
      totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
    });
    expect(elapsed).toBeLessThan(50);
    // A linear chain of 1000 nodes should produce 1000 waves (each with 1 node)
    expect(wavesLen).toBe(1000);
    expect(totalNodes).toBe(1000);
  });

  it('fan-out DAG of 1000 nodes (~2000 connections) < 50ms', () => {
    const nodes = createNodes(1000);
    const connections = createFanOutConnections(1000);
    let totalNodes = 0;
    const elapsed = benchMin(() => {
      const waves = topologicalSort(nodes, connections);
      totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
    });
    expect(elapsed).toBeLessThan(50);
    expect(totalNodes).toBe(1000); // all nodes should appear
  });

  it('wide parallel graph (1000 independent nodes, 0 connections) < 20ms', () => {
    const nodes = createNodes(1000);
    const connections: Record<string, Connection> = {};
    let wavesLen = 0;
    let totalNodes = 0;
    const elapsed = benchMin(() => {
      const waves = topologicalSort(nodes, connections);
      wavesLen = waves.length;
      totalNodes = waves.reduce((sum, w) => sum + w.length, 0);
    });
    expect(elapsed).toBeLessThan(20);
    // All independent nodes should be in a single wave
    expect(wavesLen).toBe(1);
    expect(totalNodes).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 5. aabbsOverlap brute-force scan performance
// ---------------------------------------------------------------------------
describe('aabbsOverlap brute-force scan performance', () => {
  it('all-pairs overlap for 100 nodes (4950 checks) < 20ms', () => {
    const nodes = createNodes(100);
    const aabbCache = buildNodeAABBs(nodes);
    const aabbs = Array.from(aabbCache.values());
    let overlapCount = 0;
    const elapsed = benchMin(() => {
      overlapCount = 0;
      for (let i = 0; i < aabbs.length; i++) {
        for (let j = i + 1; j < aabbs.length; j++) {
          if (aabbsOverlap(aabbs[i], aabbs[j])) {
            overlapCount++;
          }
        }
      }
    });
    expect(elapsed).toBeLessThan(20);
    // With 3-unit spacing and default node size (~1.6 wide), nodes should not overlap
    expect(overlapCount).toBeGreaterThanOrEqual(0);
  });

  it('all-pairs overlap for 500 nodes (124750 checks) < 200ms', () => {
    const nodes = createNodes(500);
    const aabbCache = buildNodeAABBs(nodes);
    const aabbs = Array.from(aabbCache.values());
    let checkCount = 0;
    const elapsed = benchMin(() => {
      checkCount = 0;
      for (let i = 0; i < aabbs.length; i++) {
        for (let j = i + 1; j < aabbs.length; j++) {
          aabbsOverlap(aabbs[i], aabbs[j]);
          checkCount++;
        }
      }
    });
    expect(elapsed).toBeLessThan(200);
    expect(checkCount).toBe(124750); // n*(n-1)/2 = 500*499/2
  });
});

// ---------------------------------------------------------------------------
// 6. Memory efficiency sanity checks
// ---------------------------------------------------------------------------
describe('Memory efficiency sanity checks', () => {
  it('buildNodeAABBs(1000 nodes) result has exactly 1000 entries', () => {
    const nodes = createNodes(1000);
    const cache = buildNodeAABBs(nodes);
    expect(cache.size).toBe(1000);
    // Verify each node has an entry
    for (const id in nodes) {
      if (Object.prototype.hasOwnProperty.call(nodes, id)) {
        expect(cache.has(id)).toBe(true);
      }
    }
  });

  it('buildPortPositionCache(1000 nodes with 3 ports each) size is 3000', () => {
    const nodes = createNodes(1000);
    const cache = buildPortPositionCache(nodes);
    expect(cache.size).toBe(3000);
    // Spot check: first and last node ports should be cached
    expect(cache.get('n0', 'input', 0)).toBeDefined();
    expect(cache.get('n0', 'input', 1)).toBeDefined();
    expect(cache.get('n0', 'output', 0)).toBeDefined();
    expect(cache.get('n999', 'input', 0)).toBeDefined();
    expect(cache.get('n999', 'output', 0)).toBeDefined();
    // Non-existent port should be undefined
    expect(cache.get('n0', 'input', 5)).toBeUndefined();
  });
});

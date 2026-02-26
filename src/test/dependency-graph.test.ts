/// <reference types="vitest/config" />
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { topologicalSort } from '../utils/execution';
import { getCriticalPath } from '../utils/profiling';
import type { EditorNode, Connection, NodeExecutionMetric } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() { return useEditorStore.getState(); }

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.validationErrors = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.isExecuting = false;
    s.executionStates = {};
    s.executionErrors = {};
    s.nodeOutputs = {};
    s.executionMetrics = {};
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
  });
}

/** Add a node and return its ID */
function addNode(type: string, pos: [number, number, number] = [0, 0, 0]): string {
  return getStore().addNode(type as any, pos);
}

/** Connect two nodes and return the connection ID (or null if rejected) */
function connect(srcId: string, srcPort: number, tgtId: string, tgtPort: number): string | null {
  return getStore().addConnection(srcId, srcPort, tgtId, tgtPort);
}

// ---------------------------------------------------------------------------
// DependencyGraphPanel layout constants (mirrored from component)
// ---------------------------------------------------------------------------
const NODE_W = 130;
const NODE_H = 40;
const COL_GAP = 50;
const ROW_GAP = 16;
const PAD_X = 24;
const PAD_Y = 16;

/** Compute node positions the same way the DependencyGraphPanel does */
function computeNodePositions(waves: string[][]) {
  const map = new Map<string, { x: number; y: number; waveIndex: number; rowIndex: number }>();
  for (let wi = 0; wi < waves.length; wi++) {
    const wave = waves[wi];
    for (let ri = 0; ri < wave.length; ri++) {
      map.set(wave[ri], {
        x: PAD_X + wi * (NODE_W + COL_GAP),
        y: PAD_Y + ri * (NODE_H + ROW_GAP),
        waveIndex: wi,
        rowIndex: ri,
      });
    }
  }
  return map;
}

/** Compute edges from connections (deduplicating same source→target pairs) */
function computeEdges(
  connections: Record<string, Connection>,
  nodePositions: Map<string, { x: number; y: number }>,
  criticalEdgeSet: Set<string>,
) {
  const result: { sourceId: string; targetId: string; isCritical: boolean }[] = [];
  const seen = new Set<string>();
  for (const conn of Object.values(connections)) {
    const key = `${conn.sourceNodeId}->${conn.targetNodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!nodePositions.has(conn.sourceNodeId) || !nodePositions.has(conn.targetNodeId)) continue;
    result.push({
      sourceId: conn.sourceNodeId,
      targetId: conn.targetNodeId,
      isCritical: criticalEdgeSet.has(key),
    });
  }
  return result;
}

/** Compute SVG dimensions from waves */
function computeSvgSize(waves: string[][] | null) {
  if (!waves || waves.length === 0) return { width: 300, height: 100 };
  const maxRows = Math.max(...waves.map(w => w.length));
  const width = PAD_X * 2 + waves.length * (NODE_W + COL_GAP) - COL_GAP;
  const height = PAD_Y * 2 + maxRows * (NODE_H + ROW_GAP) - ROW_GAP;
  return { width, height };
}

/** Compute summary stats */
function computeStats(
  nodes: Record<string, EditorNode>,
  waves: string[][] | null,
  executionMetrics: Record<string, NodeExecutionMetric>,
) {
  const totalNodes = Object.keys(nodes).length;
  const waveCount = waves ? waves.length : 0;
  const metricsArr = Object.values(executionMetrics);
  const totalDuration = metricsArr.reduce((sum, m) => sum + m.duration, 0);
  const cacheHits = metricsArr.filter(m => m.cacheHit).length;
  const cacheRate = metricsArr.length > 0
    ? Math.round((cacheHits / metricsArr.length) * 100)
    : 0;
  return { totalNodes, waveCount, totalDuration, cacheHits, cacheRate };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
});

describe('DependencyGraph: Topological wave layout', () => {
  it('assigns each node to a wave column', () => {
    const src = addNode('source');
    const xfm = addNode('transform');
    const out = addNode('output');
    connect(src, 0, xfm, 0);
    connect(xfm, 0, out, 0);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    expect(waves.length).toBe(3);
    expect(waves[0]).toContain(src);
    expect(waves[1]).toContain(xfm);
    expect(waves[2]).toContain(out);
  });

  it('places parallel nodes in the same wave', () => {
    const s1 = addNode('source');
    const s2 = addNode('source');
    const out = addNode('output');
    connect(s1, 0, out, 0);
    connect(s2, 0, out, 1);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    // s1 and s2 should be in wave 0 (no inputs)
    expect(waves[0]).toContain(s1);
    expect(waves[0]).toContain(s2);
    expect(waves[1]).toContain(out);
  });

  it('handles disconnected nodes (each in wave 0)', () => {
    const a = addNode('source');
    const b = addNode('source');
    const c = addNode('source');

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    expect(waves.length).toBe(1);
    expect(waves[0]).toContain(a);
    expect(waves[0]).toContain(b);
    expect(waves[0]).toContain(c);
  });

  it('returns empty waves for empty graph', () => {
    const waves = topologicalSort(getStore().nodes, getStore().connections);
    expect(waves).toEqual([]);
  });

  it('handles diamond convergence (A→B, A→C, B→D, C→D)', () => {
    const a = addNode('source');
    const b = addNode('math');
    const c = addNode('math');
    const d = addNode('output');
    connect(a, 0, b, 0);
    connect(a, 0, c, 0);
    connect(b, 0, d, 0);
    connect(c, 0, d, 1);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    expect(waves.length).toBe(3);
    expect(waves[0]).toContain(a);
    expect(waves[1]).toContain(b);
    expect(waves[1]).toContain(c);
    expect(waves[2]).toContain(d);
  });
});

describe('DependencyGraph: Node positions', () => {
  it('computes correct X position per wave column', () => {
    const waves = [['a'], ['b'], ['c']];
    const positions = computeNodePositions(waves);

    expect(positions.get('a')!.x).toBe(PAD_X);
    expect(positions.get('b')!.x).toBe(PAD_X + 1 * (NODE_W + COL_GAP));
    expect(positions.get('c')!.x).toBe(PAD_X + 2 * (NODE_W + COL_GAP));
  });

  it('computes correct Y position per row within wave', () => {
    const waves = [['a', 'b', 'c']];
    const positions = computeNodePositions(waves);

    expect(positions.get('a')!.y).toBe(PAD_Y);
    expect(positions.get('b')!.y).toBe(PAD_Y + 1 * (NODE_H + ROW_GAP));
    expect(positions.get('c')!.y).toBe(PAD_Y + 2 * (NODE_H + ROW_GAP));
  });

  it('records waveIndex and rowIndex', () => {
    const waves = [['a', 'b'], ['c']];
    const positions = computeNodePositions(waves);

    expect(positions.get('a')!.waveIndex).toBe(0);
    expect(positions.get('a')!.rowIndex).toBe(0);
    expect(positions.get('b')!.waveIndex).toBe(0);
    expect(positions.get('b')!.rowIndex).toBe(1);
    expect(positions.get('c')!.waveIndex).toBe(1);
    expect(positions.get('c')!.rowIndex).toBe(0);
  });

  it('returns empty map for empty waves', () => {
    const positions = computeNodePositions([]);
    expect(positions.size).toBe(0);
  });
});

describe('DependencyGraph: Edge computation', () => {
  it('creates edges from connections', () => {
    const src = addNode('source');
    const out = addNode('output');
    connect(src, 0, out, 0);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const positions = computeNodePositions(waves);
    const edges = computeEdges(getStore().connections, positions, new Set());

    expect(edges.length).toBe(1);
    expect(edges[0].sourceId).toBe(src);
    expect(edges[0].targetId).toBe(out);
    expect(edges[0].isCritical).toBe(false);
  });

  it('deduplicates same source→target pairs (multiple ports)', () => {
    const src = addNode('source');
    const out = addNode('output');
    connect(src, 0, out, 0);
    connect(src, 1, out, 1);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const positions = computeNodePositions(waves);
    const edges = computeEdges(getStore().connections, positions, new Set());

    // Two connections between same pair should produce only 1 edge
    expect(edges.length).toBe(1);
  });

  it('marks critical path edges', () => {
    const src = addNode('source');
    const out = addNode('output');
    connect(src, 0, out, 0);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const positions = computeNodePositions(waves);
    const criticalEdges = new Set([`${src}->${out}`]);
    const edges = computeEdges(getStore().connections, positions, criticalEdges);

    expect(edges[0].isCritical).toBe(true);
  });

  it('skips edges referencing nodes not in positions map', () => {
    const src = addNode('source');
    const out = addNode('output');
    connect(src, 0, out, 0);

    // Positions with only src (simulate missing node from positions)
    const partialPositions = new Map([['src', { x: 0, y: 0 }]]);
    const edges = computeEdges(getStore().connections, partialPositions as any, new Set());

    expect(edges.length).toBe(0);
  });

  it('returns empty edges for graph with no connections', () => {
    addNode('source');
    addNode('output');

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const positions = computeNodePositions(waves);
    const edges = computeEdges(getStore().connections, positions, new Set());

    expect(edges.length).toBe(0);
  });
});

describe('DependencyGraph: SVG dimensions', () => {
  it('returns default size for null waves (cycle)', () => {
    const size = computeSvgSize(null);
    expect(size.width).toBe(300);
    expect(size.height).toBe(100);
  });

  it('returns default size for empty waves', () => {
    const size = computeSvgSize([]);
    expect(size.width).toBe(300);
    expect(size.height).toBe(100);
  });

  it('scales width with number of waves', () => {
    const size1 = computeSvgSize([['a']]);
    const size3 = computeSvgSize([['a'], ['b'], ['c']]);

    expect(size3.width).toBeGreaterThan(size1.width);
    // 3 columns vs 1 column: 2 extra COL_GAP + NODE_W
    expect(size3.width - size1.width).toBe(2 * (NODE_W + COL_GAP));
  });

  it('scales height with max rows in any wave', () => {
    const sizeFlat = computeSvgSize([['a', 'b']]);
    const sizeTall = computeSvgSize([['a', 'b', 'c', 'd']]);

    expect(sizeTall.height).toBeGreaterThan(sizeFlat.height);
  });

  it('computes exact dimensions for 2 waves, 3 rows', () => {
    const size = computeSvgSize([['a', 'b', 'c'], ['d']]);
    const expectedWidth = PAD_X * 2 + 2 * (NODE_W + COL_GAP) - COL_GAP;
    const expectedHeight = PAD_Y * 2 + 3 * (NODE_H + ROW_GAP) - ROW_GAP;
    expect(size.width).toBe(expectedWidth);
    expect(size.height).toBe(expectedHeight);
  });
});

describe('DependencyGraph: Summary stats', () => {
  it('computes correct node count', () => {
    addNode('source');
    addNode('transform');
    addNode('output');

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const stats = computeStats(getStore().nodes, waves, {});

    expect(stats.totalNodes).toBe(3);
  });

  it('computes wave count', () => {
    const src = addNode('source');
    const xfm = addNode('transform');
    connect(src, 0, xfm, 0);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const stats = computeStats(getStore().nodes, waves, {});

    expect(stats.waveCount).toBe(2);
  });

  it('computes total duration from metrics', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      n1: { duration: 5.0, cacheHit: false, timestamp: 0 },
      n2: { duration: 10.0, cacheHit: false, timestamp: 5 },
      n3: { duration: 3.5, cacheHit: true, timestamp: 15 },
    };
    const stats = computeStats({} as any, [], metrics);

    expect(stats.totalDuration).toBeCloseTo(18.5);
  });

  it('computes cache hit rate', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      n1: { duration: 5.0, cacheHit: false, timestamp: 0 },
      n2: { duration: 0.0, cacheHit: true, timestamp: 5 },
      n3: { duration: 0.0, cacheHit: true, timestamp: 5 },
      n4: { duration: 2.0, cacheHit: false, timestamp: 5 },
    };
    const stats = computeStats({} as any, [], metrics);

    expect(stats.cacheHits).toBe(2);
    expect(stats.cacheRate).toBe(50);
  });

  it('returns 0% cache rate when no metrics', () => {
    const stats = computeStats({} as any, [], {});
    expect(stats.cacheRate).toBe(0);
    expect(stats.cacheHits).toBe(0);
  });

  it('handles null waves (cycle) with 0 wave count', () => {
    const stats = computeStats({} as any, null, {});
    expect(stats.waveCount).toBe(0);
  });
});

describe('DependencyGraph: Critical path integration', () => {
  it('finds critical path in linear chain', () => {
    const src = addNode('source');
    const xfm = addNode('transform');
    const out = addNode('output');
    connect(src, 0, xfm, 0);
    connect(xfm, 0, out, 0);

    const { path } = getCriticalPath(getStore().nodes, getStore().connections);
    expect(path.length).toBe(3);
    expect(path[0]).toBe(src);
    expect(path[1]).toBe(xfm);
    expect(path[2]).toBe(out);
  });

  it('finds critical path with metrics (longest duration)', () => {
    const src = addNode('source');
    const fast = addNode('math');
    const slow = addNode('math');
    const out = addNode('output');
    connect(src, 0, fast, 0);
    connect(src, 0, slow, 0);
    connect(fast, 0, out, 0);
    connect(slow, 0, out, 1);

    const metrics: Record<string, NodeExecutionMetric> = {
      [src]: { duration: 1.0, cacheHit: false, timestamp: 0 },
      [fast]: { duration: 2.0, cacheHit: false, timestamp: 1 },
      [slow]: { duration: 10.0, cacheHit: false, timestamp: 1 },
      [out]: { duration: 1.0, cacheHit: false, timestamp: 11 },
    };

    const { path, length } = getCriticalPath(getStore().nodes, getStore().connections, metrics);
    // Critical path should go through the slow node
    expect(path).toContain(slow);
    expect(length).toBeGreaterThan(0);
  });

  it('returns empty path for empty graph', () => {
    const { path, length } = getCriticalPath({}, {});
    expect(path).toEqual([]);
    expect(length).toBe(0);
  });

  it('builds critical edge set correctly', () => {
    const src = addNode('source');
    const xfm = addNode('transform');
    const out = addNode('output');
    connect(src, 0, xfm, 0);
    connect(xfm, 0, out, 0);

    const { path } = getCriticalPath(getStore().nodes, getStore().connections);
    const criticalEdgeSet = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      criticalEdgeSet.add(`${path[i]}->${path[i + 1]}`);
    }

    expect(criticalEdgeSet.size).toBe(2);
    expect(criticalEdgeSet.has(`${src}->${xfm}`)).toBe(true);
    expect(criticalEdgeSet.has(`${xfm}->${out}`)).toBe(true);
  });
});

describe('DependencyGraph: Store integration', () => {
  it('reads executionErrors from store', () => {
    const src = addNode('source');
    useEditorStore.setState((s) => {
      s.executionErrors[src] = 'Division by zero';
    });

    const errors = getStore().executionErrors;
    expect(errors[src]).toBe('Division by zero');
  });

  it('reads executionMetrics from store', () => {
    const src = addNode('source');
    useEditorStore.setState((s) => {
      s.executionMetrics[src] = { duration: 5.0, cacheHit: false, timestamp: 0 };
    });

    const metrics = getStore().executionMetrics;
    expect(metrics[src].duration).toBe(5.0);
  });

  it('reads executionStates from store', () => {
    const src = addNode('source');
    useEditorStore.setState((s) => {
      s.executionStates[src] = 'running';
    });

    expect(getStore().executionStates[src]).toBe('running');
  });

  it('setSelection is called correctly for node focus', () => {
    const src = addNode('source');
    getStore().setSelection(new Set([src]));

    expect(getStore().selectedIds.has(src)).toBe(true);
    expect(getStore().selectedIds.size).toBe(1);
  });

  it('handles multiple execution states', () => {
    const n1 = addNode('source');
    const n2 = addNode('transform');
    const n3 = addNode('output');
    connect(n1, 0, n2, 0);
    connect(n2, 0, n3, 0);

    useEditorStore.setState((s) => {
      s.executionStates[n1] = 'complete';
      s.executionStates[n2] = 'running';
      s.executionStates[n3] = 'idle';
      s.executionErrors[n2] = 'Type mismatch';
      s.executionMetrics[n1] = { duration: 2.0, cacheHit: false, timestamp: 0 };
      s.executionMetrics[n2] = { duration: 0.0, cacheHit: true, timestamp: 2 };
    });

    const state = getStore();
    expect(state.executionStates[n1]).toBe('complete');
    expect(state.executionStates[n2]).toBe('running');
    expect(state.executionErrors[n2]).toBe('Type mismatch');
    expect(state.executionMetrics[n1].cacheHit).toBe(false);
    expect(state.executionMetrics[n2].cacheHit).toBe(true);
  });
});

describe('DependencyGraph: Cycle detection', () => {
  it('topologicalSort throws on cyclic graphs', () => {
    // Can't create cycles through addConnection (it prevents them),
    // so test with raw nodes/connections
    const nodes: Record<string, EditorNode> = {
      a: { id: 'a', type: 'math', position: [0, 0, 0], title: 'A', data: {},
        inputs: [{ id: 'a-in-0', label: 'x', portType: 'number' }],
        outputs: [{ id: 'a-out-0', label: 'out', portType: 'number' }] },
      b: { id: 'b', type: 'math', position: [5, 0, 0], title: 'B', data: {},
        inputs: [{ id: 'b-in-0', label: 'x', portType: 'number' }],
        outputs: [{ id: 'b-out-0', label: 'out', portType: 'number' }] },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'a', targetPortIndex: 0 },
    };

    expect(() => topologicalSort(nodes, connections)).toThrow();
  });

  it('panel uses try/catch to return null for cycles', () => {
    // Simulate what the panel does
    const nodes: Record<string, EditorNode> = {
      a: { id: 'a', type: 'math', position: [0, 0, 0], title: 'A', data: {},
        inputs: [{ id: 'a-in-0', label: 'x', portType: 'number' }],
        outputs: [{ id: 'a-out-0', label: 'out', portType: 'number' }] },
      b: { id: 'b', type: 'math', position: [5, 0, 0], title: 'B', data: {},
        inputs: [{ id: 'b-in-0', label: 'x', portType: 'number' }],
        outputs: [{ id: 'b-out-0', label: 'out', portType: 'number' }] },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'a', targetPortIndex: 0 },
    };

    let waves: string[][] | null;
    try {
      waves = topologicalSort(nodes, connections);
    } catch {
      waves = null;
    }

    expect(waves).toBeNull();
  });
});

describe('DependencyGraph: Complex graph scenarios', () => {
  it('handles wide graph with many parallel nodes', () => {
    const nodes: string[] = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(addNode('source'));
    }
    const out = addNode('output');
    // Connect first 2 sources to output (output has 2 inputs)
    connect(nodes[0], 0, out, 0);
    connect(nodes[1], 0, out, 1);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    expect(waves.length).toBe(2);
    // All 20 sources + the non-connected sources in wave 0
    expect(waves[0].length).toBe(20);
    expect(waves[1]).toContain(out);
  });

  it('handles deep chain', () => {
    const nodeIds: string[] = [];
    nodeIds.push(addNode('source'));
    for (let i = 1; i < 10; i++) {
      const prev = nodeIds[i - 1];
      const type = i < 9 ? 'math' : 'output';
      const curr = addNode(type);
      connect(prev, 0, curr, 0);
      nodeIds.push(curr);
    }

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    expect(waves.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(waves[i]).toContain(nodeIds[i]);
    }
  });

  it('computes positions for a real graph scenario', () => {
    const src = addNode('source');
    const xfm = addNode('transform');
    const out = addNode('output');
    connect(src, 0, xfm, 0);
    connect(xfm, 0, out, 0);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const positions = computeNodePositions(waves);

    // src in wave 0
    expect(positions.get(src)!.waveIndex).toBe(0);
    // xfm in wave 1
    expect(positions.get(xfm)!.waveIndex).toBe(1);
    // out in wave 2
    expect(positions.get(out)!.waveIndex).toBe(2);

    // X positions increase left to right
    expect(positions.get(xfm)!.x).toBeGreaterThan(positions.get(src)!.x);
    expect(positions.get(out)!.x).toBeGreaterThan(positions.get(xfm)!.x);
  });

  it('computes edges with critical path for full graph', () => {
    const src = addNode('source');
    const xfm = addNode('transform');
    const out = addNode('output');
    connect(src, 0, xfm, 0);
    connect(xfm, 0, out, 0);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const positions = computeNodePositions(waves);
    const { path } = getCriticalPath(getStore().nodes, getStore().connections);

    const criticalEdgeSet = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      criticalEdgeSet.add(`${path[i]}->${path[i + 1]}`);
    }

    const edges = computeEdges(getStore().connections, positions, criticalEdgeSet);
    expect(edges.length).toBe(2);
    expect(edges.every(e => e.isCritical)).toBe(true);
  });

  it('computes correct SVG size for real graph', () => {
    const src = addNode('source');
    const xfm = addNode('transform');
    const out = addNode('output');
    connect(src, 0, xfm, 0);
    connect(xfm, 0, out, 0);

    const waves = topologicalSort(getStore().nodes, getStore().connections);
    const size = computeSvgSize(waves);

    // 3 waves, max 1 row each
    const expectedWidth = PAD_X * 2 + 3 * (NODE_W + COL_GAP) - COL_GAP;
    const expectedHeight = PAD_Y * 2 + 1 * (NODE_H + ROW_GAP) - ROW_GAP;
    expect(size.width).toBe(expectedWidth);
    expect(size.height).toBe(expectedHeight);
  });
});

describe('DependencyGraph: Node display logic', () => {
  it('truncates long titles to maxTitleLen', () => {
    const maxTitleLen = 12;
    const longTitle = 'This is a very long node title';
    const truncated = longTitle.length > maxTitleLen
      ? longTitle.slice(0, maxTitleLen - 1) + '\u2026'
      : longTitle;

    expect(truncated.length).toBe(maxTitleLen);
    expect(truncated.endsWith('\u2026')).toBe(true);
  });

  it('does not truncate short titles', () => {
    const maxTitleLen = 12;
    const shortTitle = 'Source';
    const result = shortTitle.length > maxTitleLen
      ? shortTitle.slice(0, maxTitleLen - 1) + '\u2026'
      : shortTitle;

    expect(result).toBe('Source');
  });

  it('truncates long type names for badge', () => {
    const type = 'decompose-vec3';
    const maxLen = 8;
    const badge = type.length > maxLen ? type.slice(0, 7) + '\u2026' : type;

    expect(badge.length).toBe(8);
    expect(badge.endsWith('\u2026')).toBe(true);
  });

  it('formats timing label from metric', () => {
    const metricCached: NodeExecutionMetric = { duration: 0.0, cacheHit: true, timestamp: 0 };
    const metricRun: NodeExecutionMetric = { duration: 5.123, cacheHit: false, timestamp: 0 };

    const labelCached = metricCached.cacheHit ? 'cached' : `${metricCached.duration.toFixed(1)}ms`;
    const labelRun = metricRun.cacheHit ? 'cached' : `${metricRun.duration.toFixed(1)}ms`;

    expect(labelCached).toBe('cached');
    expect(labelRun).toBe('5.1ms');
  });

  it('formats empty timing label when no metric', () => {
    // Simulate the panel's logic: metric is undefined for nodes without execution data
    function formatLabel(m: NodeExecutionMetric | undefined): string {
      return m ? (m.cacheHit ? 'cached' : `${m.duration.toFixed(1)}ms`) : '';
    }

    expect(formatLabel(undefined)).toBe('');
  });
});

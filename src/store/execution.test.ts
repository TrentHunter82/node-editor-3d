import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore } from './editorStore';
import { topologicalSort, executeGraph as execGraph, invalidateDownstream } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
  });
}

function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  while (getState().canRedo()) getState().redo();
  while (getState().canUndo()) getState().undo();
}

function getState() {
  return useEditorStore.getState();
}

describe('Execution System', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    drainUndoRedo();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('setNodeExecutionState', () => {
    it('sets execution state for a node', () => {
      const id = getState().addNode('source');
      getState().setNodeExecutionState(id, 'running');
      expect(getState().executionStates[id]).toBe('running');
    });

    it('can set different states', () => {
      const id = getState().addNode('source');
      getState().setNodeExecutionState(id, 'idle');
      expect(getState().executionStates[id]).toBe('idle');

      getState().setNodeExecutionState(id, 'running');
      expect(getState().executionStates[id]).toBe('running');

      getState().setNodeExecutionState(id, 'complete');
      expect(getState().executionStates[id]).toBe('complete');

      getState().setNodeExecutionState(id, 'error');
      expect(getState().executionStates[id]).toBe('error');
    });
  });

  describe('resetExecution', () => {
    it('clears all execution states and isExecuting', () => {
      const id = getState().addNode('source');
      getState().setNodeExecutionState(id, 'running');
      useEditorStore.setState({ isExecuting: true });

      getState().resetExecution();
      expect(getState().executionStates).toEqual({});
      expect(getState().isExecuting).toBe(false);
    });
  });

  describe('executeGraph', () => {
    it('does nothing on empty graph', () => {
      getState().executeGraph();
      expect(getState().isExecuting).toBe(false);
    });

    it('does nothing if already executing', () => {
      const id = getState().addNode('source');
      useEditorStore.setState({ isExecuting: true });

      // Should be a no-op
      getState().executeGraph();
      // executionStates should not be reset for nodes
      expect(getState().executionStates[id]).toBeUndefined();
    });

    it('sets isExecuting to true on start', () => {
      getState().addNode('source');
      getState().executeGraph();
      expect(getState().isExecuting).toBe(true);
    });

    it('initializes all nodes to idle state', () => {
      const n1 = getState().addNode('source');
      const n2 = getState().addNode('transform');
      getState().executeGraph();

      expect(getState().executionStates[n1]).toBe('idle');
      expect(getState().executionStates[n2]).toBe('idle');
    });

    it('processes source nodes first (wave 0 - no incoming connections)', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().executeGraph();

      // At time 0, first wave should fire - source should become running
      vi.advanceTimersByTime(0);
      expect(getState().executionStates[src]).toBe('running');
      // Transform should still be idle (not in first wave)
      expect(getState().executionStates[xfm]).toBe('idle');
    });

    it('transitions nodes from running to complete', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().executeGraph();

      vi.advanceTimersByTime(0); // Start of wave 0
      expect(getState().executionStates[src]).toBe('running');

      vi.advanceTimersByTime(400); // NODE_DURATION = 400ms
      expect(getState().executionStates[src]).toBe('complete');
    });

    it('processes nodes in topological order (source -> transform)', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().executeGraph();

      // Wave 0: source runs
      vi.advanceTimersByTime(0);
      expect(getState().executionStates[src]).toBe('running');
      expect(getState().executionStates[xfm]).toBe('idle');

      // Wave 0: source completes
      vi.advanceTimersByTime(400);
      expect(getState().executionStates[src]).toBe('complete');

      // Wave 1: transform runs (at WAVE_DELAY = 600ms from start)
      vi.advanceTimersByTime(200); // total: 600ms
      expect(getState().executionStates[xfm]).toBe('running');

      // Wave 1: transform completes
      vi.advanceTimersByTime(400); // total: 1000ms
      expect(getState().executionStates[xfm]).toBe('complete');
    });

    it('processes a chain: source -> transform -> output', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const out = getState().addNode('output', [10, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);
      getState().addConnection(xfm, 0, out, 0);

      getState().executeGraph();

      // Wave 0: source
      vi.advanceTimersByTime(0);
      expect(getState().executionStates[src]).toBe('running');

      vi.advanceTimersByTime(400); // source complete
      expect(getState().executionStates[src]).toBe('complete');

      // Wave 1: transform (at 600ms)
      vi.advanceTimersByTime(200);
      expect(getState().executionStates[xfm]).toBe('running');

      vi.advanceTimersByTime(400); // transform complete (at 1000ms)
      expect(getState().executionStates[xfm]).toBe('complete');

      // Wave 2: output (at 1200ms)
      vi.advanceTimersByTime(200);
      expect(getState().executionStates[out]).toBe('running');

      vi.advanceTimersByTime(400); // output complete (at 1600ms)
      expect(getState().executionStates[out]).toBe('complete');
    });

    it('processes parallel nodes in the same wave', () => {
      // source -> transform1, source -> transform2 (both in wave 1)
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm1 = getState().addNode('transform', [5, 0, 0]);
      const xfm2 = getState().addNode('transform', [5, 0, 5]);
      getState().addConnection(src, 0, xfm1, 0);
      getState().addConnection(src, 0, xfm2, 0);

      getState().executeGraph();

      // Wave 0: source
      vi.advanceTimersByTime(0);
      expect(getState().executionStates[src]).toBe('running');

      vi.advanceTimersByTime(400);
      expect(getState().executionStates[src]).toBe('complete');

      // Wave 1: both transforms should be running together
      vi.advanceTimersByTime(200); // total: 600ms
      expect(getState().executionStates[xfm1]).toBe('running');
      expect(getState().executionStates[xfm2]).toBe('running');

      vi.advanceTimersByTime(400);
      expect(getState().executionStates[xfm1]).toBe('complete');
      expect(getState().executionStates[xfm2]).toBe('complete');
    });

    it('isExecuting becomes false after all waves complete', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().executeGraph();
      expect(getState().isExecuting).toBe(true);

      // 2 waves: delay increments by WAVE_DELAY(600) per wave
      // After loop: delay = 1200
      // Final timer: 1200 + NODE_DURATION(400) = 1600ms
      vi.advanceTimersByTime(1599);
      expect(getState().isExecuting).toBe(true);

      vi.advanceTimersByTime(1); // total: 1600ms
      expect(getState().isExecuting).toBe(false);
    });

    it('handles disconnected nodes (multiple roots)', () => {
      // Two independent nodes, both should be in wave 0
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('filter', [5, 0, 0]);

      getState().executeGraph();

      vi.advanceTimersByTime(0);
      expect(getState().executionStates[n1]).toBe('running');
      expect(getState().executionStates[n2]).toBe('running');

      vi.advanceTimersByTime(400);
      expect(getState().executionStates[n1]).toBe('complete');
      expect(getState().executionStates[n2]).toBe('complete');
    });

    it('single node graph completes correctly', () => {
      const n = getState().addNode('source');
      getState().executeGraph();

      vi.advanceTimersByTime(0);
      expect(getState().executionStates[n]).toBe('running');

      vi.advanceTimersByTime(400);
      expect(getState().executionStates[n]).toBe('complete');

      // 1 wave: delay after loop = 600, final timer = 600 + 400 = 1000ms
      vi.advanceTimersByTime(600); // total: 1000ms
      expect(getState().isExecuting).toBe(false);
    });

    it('cancellation stops further wave processing', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().executeGraph();

      // Wave 0 fires
      vi.advanceTimersByTime(0);
      expect(getState().executionStates[src]).toBe('running');

      // Cancel execution before wave 1
      getState().resetExecution();
      expect(getState().isExecuting).toBe(false);

      // Wave 1 timer fires but should be a no-op (isExecuting is false)
      vi.advanceTimersByTime(1000);
      // executionStates was cleared by resetExecution
      expect(getState().executionStates[xfm]).toBeUndefined();
    });
  });
});

// ─── Utility function tests (execution.ts) ────────────────────

function makeNode(id: string, type: 'source' | 'transform' | 'filter' | 'output', data: Record<string, unknown> = {}): EditorNode {
  const portConfigs: Record<string, { inputs: { id: string; label: string; portType: 'number' | 'string' | 'any' }[]; outputs: { id: string; label: string; portType: 'number' | 'string' | 'any' }[] }> = {
    source: { inputs: [], outputs: [{ id: 'out-0', label: 'value', portType: 'number' }, { id: 'out-1', label: 'label', portType: 'string' }] },
    transform: { inputs: [{ id: 'in-0', label: 'in', portType: 'number' }, { id: 'in-1', label: 'factor', portType: 'number' }], outputs: [{ id: 'out-0', label: 'result', portType: 'number' }, { id: 'out-1', label: 'debug', portType: 'string' }] },
    filter: { inputs: [{ id: 'in-0', label: 'in', portType: 'any' }], outputs: [{ id: 'out-0', label: 'out', portType: 'any' }] },
    output: { inputs: [{ id: 'in-0', label: 'data', portType: 'any' }, { id: 'in-1', label: 'label', portType: 'string' }], outputs: [] },
  };
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type.charAt(0).toUpperCase() + type.slice(1),
    data,
    inputs: portConfigs[type].inputs,
    outputs: portConfigs[type].outputs,
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

describe('topologicalSort', () => {
  it('returns empty for empty graph', () => {
    expect(topologicalSort({}, {})).toEqual([]);
  });

  it('returns single wave for single node', () => {
    const nodes = { n1: makeNode('n1', 'source') };
    const waves = topologicalSort(nodes, {});
    expect(waves).toHaveLength(1);
    expect(waves[0]).toEqual(['n1']);
  });

  it('returns correct order for linear chain', () => {
    const nodes = {
      src: makeNode('src', 'source'),
      xfm: makeNode('xfm', 'transform'),
      out: makeNode('out', 'output'),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'xfm', 0),
      c2: makeConn('c2', 'xfm', 0, 'out', 0),
    };

    const waves = topologicalSort(nodes, connections);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toContain('src');
    expect(waves[1]).toContain('xfm');
    expect(waves[2]).toContain('out');
  });

  it('groups parallel nodes in same wave', () => {
    const nodes = {
      src: makeNode('src', 'source'),
      f1: makeNode('f1', 'filter'),
      f2: makeNode('f2', 'filter'),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'f1', 0),
      c2: makeConn('c2', 'src', 0, 'f2', 0),
    };

    const waves = topologicalSort(nodes, connections);
    expect(waves).toHaveLength(2);
    expect(waves[0]).toContain('src');
    expect(waves[1]).toContain('f1');
    expect(waves[1]).toContain('f2');
  });

  it('throws on cycle', () => {
    // Note: this tests the topologicalSort directly; the store's addConnection prevents cycles
    const nodes = {
      a: makeNode('a', 'filter'),
      b: makeNode('b', 'filter'),
    };
    const connections = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'a', 0),
    };

    expect(() => topologicalSort(nodes, connections)).toThrow('cycle');
  });

  it('handles disconnected components', () => {
    const nodes = {
      a: makeNode('a', 'source'),
      b: makeNode('b', 'source'),
    };

    const waves = topologicalSort(nodes, {});
    expect(waves).toHaveLength(1);
    expect(waves[0]).toContain('a');
    expect(waves[0]).toContain('b');
  });

  it('handles diamond graph (A -> B, A -> C, B -> D, C -> D)', () => {
    const nodes = {
      a: makeNode('a', 'source'),
      b: makeNode('b', 'filter'),
      c: makeNode('c', 'filter'),
      d: makeNode('d', 'output'),
    };
    const connections = {
      ab: makeConn('ab', 'a', 0, 'b', 0),
      ac: makeConn('ac', 'a', 0, 'c', 0),
      bd: makeConn('bd', 'b', 0, 'd', 0),
      cd: makeConn('cd', 'c', 0, 'd', 0),
    };

    const waves = topologicalSort(nodes, connections);
    // A is wave 0, B and C are wave 1, D is wave 2
    expect(waves).toHaveLength(3);
    expect(waves[0]).toEqual(['a']);
    expect(waves[1].sort()).toEqual(['b', 'c']);
    expect(waves[2]).toEqual(['d']);
  });
});

describe('executeGraph (data propagation)', () => {
  it('source node emits configured value', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 42, label: 'test' }),
    };
    const result = execGraph(nodes, {});
    expect(result.results.get('src')?.outputs[0]).toBe(42);
    expect(result.results.get('src')?.outputs[1]).toBe('test');
  });

  it('source node uses defaults when no data', () => {
    const nodes = {
      src: makeNode('src', 'source'),
    };
    const result = execGraph(nodes, {});
    expect(result.results.get('src')?.outputs[0]).toBe(0);
    expect(result.results.get('src')?.outputs[1]).toBe('Source');
  });

  it('transform node processes data correctly', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 10 }),
      xfm: makeNode('xfm', 'transform', { multiplier: 3, offset: 5 }),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'xfm', 0),
    };

    const result = execGraph(nodes, connections);
    // result = 10 * 3 + 5 = 35
    expect(result.results.get('xfm')?.outputs[0]).toBe(35);
  });

  it('transform defaults: multiplier=1, offset=0', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 7 }),
      xfm: makeNode('xfm', 'transform'),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'xfm', 0),
    };

    const result = execGraph(nodes, connections);
    // result = 7 * 1 + 0 = 7
    expect(result.results.get('xfm')?.outputs[0]).toBe(7);
  });

  it('filter passes value when condition met', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 10 }),
      filt: makeNode('filt', 'filter', { threshold: 5, mode: 'greater' }),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'filt', 0),
    };

    const result = execGraph(nodes, connections);
    expect(result.results.get('filt')?.outputs[0]).toBe(10);
  });

  it('filter blocks value when condition not met', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 3 }),
      filt: makeNode('filt', 'filter', { threshold: 5, mode: 'greater' }),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'filt', 0),
    };

    const result = execGraph(nodes, connections);
    expect(result.results.get('filt')?.outputs[0]).toBeNull();
  });

  it('filter less mode works', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 3 }),
      filt: makeNode('filt', 'filter', { threshold: 5, mode: 'less' }),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'filt', 0),
    };

    const result = execGraph(nodes, connections);
    expect(result.results.get('filt')?.outputs[0]).toBe(3);
  });

  it('filter equal mode works', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 5 }),
      filt: makeNode('filt', 'filter', { threshold: 5, mode: 'equal' }),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'filt', 0),
    };

    const result = execGraph(nodes, connections);
    expect(result.results.get('filt')?.outputs[0]).toBe(5);
  });

  it('chain: source -> transform -> output', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 5 }),
      xfm: makeNode('xfm', 'transform', { multiplier: 2, offset: 1 }),
      out: makeNode('out', 'output'),
    };
    const connections = {
      c1: makeConn('c1', 'src', 0, 'xfm', 0),
      c2: makeConn('c2', 'xfm', 0, 'out', 0),
    };

    const result = execGraph(nodes, connections);
    // source output: 5
    // transform: 5 * 2 + 1 = 11
    expect(result.results.get('xfm')?.outputs[0]).toBe(11);
    expect(result.errors.size).toBe(0);
  });

  it('uses cache for unchanged inputs', () => {
    const nodes = {
      src: makeNode('src', 'source', { value: 10 }),
    };

    // First execution
    const result1 = execGraph(nodes, {});
    expect(result1.results.get('src')?.outputs[0]).toBe(10);

    // Second execution with same inputs and cache - should reuse
    const result2 = execGraph(nodes, {}, result1.results);
    expect(result2.results.get('src')?.outputs[0]).toBe(10);
  });
});

describe('invalidateDownstream', () => {
  it('removes cache entry for the target node', () => {
    const cache = new Map([
      ['n1', { outputs: { 0: 42 }, inputHash: '{}' }],
      ['n2', { outputs: { 0: 84 }, inputHash: '{"0":42}' }],
    ]);

    invalidateDownstream('n1', {}, cache);
    expect(cache.has('n1')).toBe(false);
    expect(cache.has('n2')).toBe(true);
  });

  it('invalidates downstream dependents', () => {
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'n1', 0, 'n2', 0),
      c2: makeConn('c2', 'n2', 0, 'n3', 0),
    };
    const cache = new Map([
      ['n1', { outputs: { 0: 1 }, inputHash: '{}' }],
      ['n2', { outputs: { 0: 2 }, inputHash: '{"0":1}' }],
      ['n3', { outputs: { 0: 3 }, inputHash: '{"0":2}' }],
    ]);

    invalidateDownstream('n1', connections, cache);
    expect(cache.has('n1')).toBe(false);
    expect(cache.has('n2')).toBe(false);
    expect(cache.has('n3')).toBe(false);
  });

  it('only invalidates downstream, not upstream', () => {
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'n1', 0, 'n2', 0),
      c2: makeConn('c2', 'n2', 0, 'n3', 0),
    };
    const cache = new Map([
      ['n1', { outputs: { 0: 1 }, inputHash: '{}' }],
      ['n2', { outputs: { 0: 2 }, inputHash: '{"0":1}' }],
      ['n3', { outputs: { 0: 3 }, inputHash: '{"0":2}' }],
    ]);

    invalidateDownstream('n2', connections, cache);
    expect(cache.has('n1')).toBe(true);  // upstream preserved
    expect(cache.has('n2')).toBe(false);
    expect(cache.has('n3')).toBe(false);
  });

  it('handles no connections gracefully', () => {
    const cache = new Map([
      ['n1', { outputs: { 0: 1 }, inputHash: '{}' }],
    ]);

    invalidateDownstream('n1', {}, cache);
    expect(cache.has('n1')).toBe(false);
  });
});

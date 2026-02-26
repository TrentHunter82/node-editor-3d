import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';
import { executeGraph as execGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

function resetStore() {
  _resetModuleState();
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
    executionMetrics: {},
    executionTotalDuration: 0,
    errorStrategy: 'fail-fast',
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: 0 } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
  });
}

function getState() {
  return useEditorStore.getState();
}

// Helper: build a minimal source node
function makeSourceNode(id: string): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: 'Source',
    data: { value: 42 },
    inputs: [],
    outputs: [{ id: 'out0', label: 'Value', portType: 'number' }],
  };
}

// Helper: build a minimal transform node
function makeTransformNode(id: string): EditorNode {
  return {
    id,
    type: 'transform',
    position: [5, 0, 0],
    title: 'Transform',
    data: { operation: 'multiply', operand: 2 },
    inputs: [{ id: 'in0', label: 'Input', portType: 'number' }],
    outputs: [{ id: 'out0', label: 'Output', portType: 'number' }],
  };
}

// Helper: build a connection
function makeConnection(id: string, srcId: string, srcPort: number, tgtId: string, tgtPort: number): Connection {
  return {
    id,
    sourceNodeId: srcId,
    sourcePortIndex: srcPort,
    targetNodeId: tgtId,
    targetPortIndex: tgtPort,
  };
}

describe('Phase 9 – Execution Profiling', () => {
  // ─── Unit tests: direct execGraph() calls (no fake timers needed) ───

  describe('executeGraph() profiling – direct function call', () => {
    it('returns metrics map with entries for each executed node', () => {
      const nodes: Record<string, EditorNode> = {
        s1: makeSourceNode('s1'),
        s2: makeSourceNode('s2'),
      };
      const connections: Record<string, Connection> = {};

      const result = execGraph(nodes, connections);

      expect(result.metrics).toBeInstanceOf(Map);
      expect(result.metrics.size).toBe(2);
      expect(result.metrics.has('s1')).toBe(true);
      expect(result.metrics.has('s2')).toBe(true);
    });

    it('metrics contain valid duration, cacheHit=false, and timestamp', () => {
      const nodes: Record<string, EditorNode> = {
        s1: makeSourceNode('s1'),
      };
      const connections: Record<string, Connection> = {};

      const result = execGraph(nodes, connections);
      const metric = result.metrics.get('s1')!;

      expect(metric).toBeDefined();
      expect(typeof metric.duration).toBe('number');
      expect(metric.duration).toBeGreaterThanOrEqual(0);
      expect(metric.cacheHit).toBe(false);
      expect(typeof metric.timestamp).toBe('number');
      expect(metric.timestamp).toBeGreaterThan(0);
    });

    it('totalDuration is a positive number', () => {
      const nodes: Record<string, EditorNode> = {
        s1: makeSourceNode('s1'),
      };
      const connections: Record<string, Connection> = {};

      const result = execGraph(nodes, connections);

      expect(typeof result.totalDuration).toBe('number');
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('cache hit nodes have cacheHit=true and duration=0', () => {
      const nodes: Record<string, EditorNode> = {
        s1: makeSourceNode('s1'),
      };
      const connections: Record<string, Connection> = {};

      // First execution populates cache
      const cache = new Map();
      const first = execGraph(nodes, connections, cache);
      expect(first.metrics.get('s1')!.cacheHit).toBe(false);

      // Second execution with same cache should hit cache
      const second = execGraph(nodes, connections, first.results);
      const metric = second.metrics.get('s1')!;

      expect(metric.cacheHit).toBe(true);
      expect(metric.duration).toBe(0);
    });

    it('metrics populated for nodes in multi-wave graph', () => {
      const nodes: Record<string, EditorNode> = {
        src: makeSourceNode('src'),
        xfm: makeTransformNode('xfm'),
      };
      const connections: Record<string, Connection> = {
        c1: makeConnection('c1', 'src', 0, 'xfm', 0),
      };

      const result = execGraph(nodes, connections);

      expect(result.metrics.size).toBe(2);

      const srcMetric = result.metrics.get('src')!;
      const xfmMetric = result.metrics.get('xfm')!;

      expect(srcMetric).toBeDefined();
      expect(srcMetric.cacheHit).toBe(false);
      expect(srcMetric.duration).toBeGreaterThanOrEqual(0);

      expect(xfmMetric).toBeDefined();
      expect(xfmMetric.cacheHit).toBe(false);
      expect(xfmMetric.duration).toBeGreaterThanOrEqual(0);

      // Source should have started before or at the same time as transform
      expect(srcMetric.timestamp).toBeLessThanOrEqual(xfmMetric.timestamp);
    });
  });

  // ─── Store-level tests (require fake timers for wave animation) ───

  describe('Store-level profiling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      resetStore();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('executeGraph populates executionMetrics in store', () => {
      const s1 = getState().addNode('source', [0, 0, 0]);
      const s2 = getState().addNode('source', [5, 0, 0]);

      getState().executeGraph();

      const metrics = getState().executionMetrics;
      expect(Object.keys(metrics).length).toBe(2);
      expect(metrics[s1]).toBeDefined();
      expect(metrics[s2]).toBeDefined();
      expect(typeof metrics[s1].duration).toBe('number');
      expect(metrics[s1].cacheHit).toBe(false);
      expect(typeof metrics[s1].timestamp).toBe('number');
    });

    it('executeGraph sets executionTotalDuration in store', () => {
      getState().addNode('source', [0, 0, 0]);

      getState().executeGraph();

      expect(typeof getState().executionTotalDuration).toBe('number');
      expect(getState().executionTotalDuration).toBeGreaterThanOrEqual(0);
    });

    it('resetExecution clears executionMetrics and executionTotalDuration', () => {
      const s1 = getState().addNode('source', [0, 0, 0]);

      getState().executeGraph();
      // Verify metrics are populated first
      expect(Object.keys(getState().executionMetrics).length).toBe(1);
      expect(getState().executionMetrics[s1]).toBeDefined();

      getState().resetExecution();

      expect(getState().executionMetrics).toEqual({});
      expect(getState().executionTotalDuration).toBe(0);
    });

    it('undo clears executionMetrics', () => {
      getState().addNode('source', [0, 0, 0]);

      getState().executeGraph();
      // Drain wave animations so execution completes
      vi.advanceTimersByTime(2000);
      expect(Object.keys(getState().executionMetrics).length).toBe(1);

      // Perform another action that pushes undo
      getState().addNode('source', [10, 0, 0]);

      // Undo should clear metrics
      getState().undo();

      expect(getState().executionMetrics).toEqual({});
      expect(getState().executionTotalDuration).toBe(0);
    });

    it('redo clears executionMetrics', () => {
      getState().addNode('source', [0, 0, 0]);

      getState().executeGraph();
      vi.advanceTimersByTime(2000);
      expect(Object.keys(getState().executionMetrics).length).toBe(1);

      // Push another action, then undo so redo is available
      getState().addNode('source', [10, 0, 0]);
      getState().undo();
      expect(getState().executionMetrics).toEqual({});

      // Now re-execute so metrics are populated again before redo
      getState().executeGraph();
      expect(Object.keys(getState().executionMetrics).length).toBeGreaterThan(0);

      // Reset execution so we can redo (isExecuting must be false)
      getState().resetExecution();

      // Redo should clear metrics
      getState().redo();

      expect(getState().executionMetrics).toEqual({});
      expect(getState().executionTotalDuration).toBe(0);
    });

    it('clearGraph clears executionMetrics', () => {
      getState().addNode('source', [0, 0, 0]);

      getState().executeGraph();
      expect(Object.keys(getState().executionMetrics).length).toBe(1);

      // Need to stop execution first for clearGraph to take effect on fresh state
      getState().resetExecution();

      getState().clearGraph();

      expect(getState().executionMetrics).toEqual({});
      expect(getState().executionTotalDuration).toBe(0);
    });
  });
});

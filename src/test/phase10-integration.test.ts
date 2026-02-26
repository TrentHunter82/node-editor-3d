import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settingsStore';
import { getUpstreamPath, getDownstreamPath, getBottleneckNodes, getCacheHitRate, getExecutionTimeline } from '../utils/profiling';
import { executeGraph as execGraph } from '../utils/execution';
import type { NodeExecutionMetric } from '../types';

function resetEditorStore() {
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

function resetSettingsStore() {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, recentFiles: [] });
  localStorage.clear();
}

function getEditor() {
  return useEditorStore.getState();
}

function getSettings() {
  return useSettingsStore.getState();
}

describe('Phase 10 Integration: Settings + Editor', () => {
  beforeEach(() => {
    resetEditorStore();
    resetSettingsStore();
  });

  it('settings and editor stores are independent', () => {
    // Modifying settings does not affect editor
    getSettings().setTheme('light');
    expect(getEditor().nodes).toEqual({});

    // Modifying editor does not affect settings
    getEditor().addNode('source');
    expect(getSettings().theme).toBe('light');
  });

  it('settings persist independently of graph data', () => {
    getSettings().setGridSnapSize(2);
    getSettings().setTheme('light');

    // Clear editor graph
    getEditor().addNode('source');
    getEditor().clearGraph();

    // Settings should be unaffected
    expect(getSettings().gridSnapSize).toBe(2);
    expect(getSettings().theme).toBe('light');
  });

  it('settings survive editor import/export cycle', () => {
    getSettings().setAnimationSpeed(0.5);
    getSettings().setMinimapVisible(false);

    // Do editor operations
    getEditor().addNode('source');
    const exported = getEditor().exportAllGraphs();
    getEditor().clearGraph();
    getEditor().importAllGraphs(exported);

    // Settings untouched
    expect(getSettings().animationSpeed).toBe(0.5);
    expect(getSettings().minimapVisible).toBe(false);
  });

  it('resetToDefaults does not affect editor state', () => {
    const nodeId = getEditor().addNode('source');
    getSettings().setTheme('light');
    getSettings().resetToDefaults();

    expect(getEditor().nodes[nodeId]).toBeDefined();
    expect(getSettings().theme).toBe('dark');
  });
});

describe('Phase 10 Integration: Profiling Utilities + Real Graph', () => {
  beforeEach(() => {
    resetEditorStore();
  });

  it('getUpstreamPath works with store-created graph', () => {
    const src = getEditor().addNode('source', [0, 0, 0]);
    const xfm = getEditor().addNode('transform', [5, 0, 0]);
    const out = getEditor().addNode('output', [10, 0, 0]);
    getEditor().addConnection(src, 0, xfm, 0);
    getEditor().addConnection(xfm, 0, out, 0);

    const upstream = getUpstreamPath(out, getEditor().nodes, getEditor().connections);
    expect(upstream).toContain(xfm);
    expect(upstream).toContain(src);
    expect(upstream).not.toContain(out);
    // xfm should come before src (closest first)
    expect(upstream.indexOf(xfm)).toBeLessThan(upstream.indexOf(src));
  });

  it('getDownstreamPath works with store-created graph', () => {
    const src = getEditor().addNode('source', [0, 0, 0]);
    const xfm = getEditor().addNode('transform', [5, 0, 0]);
    const out = getEditor().addNode('output', [10, 0, 0]);
    getEditor().addConnection(src, 0, xfm, 0);
    getEditor().addConnection(xfm, 0, out, 0);

    const downstream = getDownstreamPath(src, getEditor().nodes, getEditor().connections);
    expect(downstream).toContain(xfm);
    expect(downstream).toContain(out);
    expect(downstream).not.toContain(src);
    // xfm should come before out
    expect(downstream.indexOf(xfm)).toBeLessThan(downstream.indexOf(out));
  });

  it('profiling utilities work with real execution metrics', () => {
    const src = getEditor().addNode('source', [0, 0, 0]);
    const xfm = getEditor().addNode('transform', [5, 0, 0]);
    const out = getEditor().addNode('output', [10, 0, 0]);
    getEditor().addConnection(src, 0, xfm, 0);
    getEditor().addConnection(xfm, 0, out, 0);

    // Execute directly to get metrics
    const result = execGraph(getEditor().nodes, getEditor().connections);
    const metricsRecord: Record<string, NodeExecutionMetric> = {};
    for (const [id, m] of result.metrics) {
      metricsRecord[id] = m;
    }

    // getBottleneckNodes
    const bottlenecks = getBottleneckNodes(metricsRecord, 2);
    expect(bottlenecks.length).toBeGreaterThanOrEqual(1);
    expect(bottlenecks.length).toBeLessThanOrEqual(3);
    // Durations should be sorted descending
    for (let i = 1; i < bottlenecks.length; i++) {
      expect(bottlenecks[i - 1].duration).toBeGreaterThanOrEqual(bottlenecks[i].duration);
    }

    // getCacheHitRate - first run, no cache hits
    const hitRate = getCacheHitRate(metricsRecord);
    expect(hitRate).toBe(0);

    // getExecutionTimeline
    const timeline = getExecutionTimeline(metricsRecord);
    expect(timeline).toHaveLength(3);
    // Sorted by startTime
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].startTime).toBeGreaterThanOrEqual(timeline[i - 1].startTime);
    }
  });

  it('cache hit rate increases on re-execution', () => {
    const src = getEditor().addNode('source', [0, 0, 0]);
    const xfm = getEditor().addNode('transform', [5, 0, 0]);
    getEditor().addConnection(src, 0, xfm, 0);

    // First execution
    const result1 = execGraph(getEditor().nodes, getEditor().connections);
    expect(getCacheHitRate(mapToRecord(result1.metrics))).toBe(0);

    // Second execution with cache from first
    const result2 = execGraph(getEditor().nodes, getEditor().connections, result1.results);
    const rate2 = getCacheHitRate(mapToRecord(result2.metrics));
    expect(rate2).toBe(100); // All cache hits
  });

  it('tracing + profiling combined: find slowest path', () => {
    // Build a graph: src1 -> math -> out, src2 -> math
    const src1 = getEditor().addNode('source', [0, 0, 0]);
    const src2 = getEditor().addNode('source', [0, 0, 5]);
    const math = getEditor().addNode('math', [5, 0, 0]);
    const out = getEditor().addNode('output', [10, 0, 0]);
    getEditor().addConnection(src1, 0, math, 0);
    getEditor().addConnection(src2, 0, math, 1);
    getEditor().addConnection(math, 0, out, 0);

    const result = execGraph(getEditor().nodes, getEditor().connections);
    const metricsRecord = mapToRecord(result.metrics);

    // Upstream of output
    const upstream = getUpstreamPath(out, getEditor().nodes, getEditor().connections);
    expect(upstream).toContain(math);
    expect(upstream).toContain(src1);
    expect(upstream).toContain(src2);

    // Timeline should have all 4 nodes
    const timeline = getExecutionTimeline(metricsRecord);
    expect(timeline).toHaveLength(4);

    // Sources should execute before math (lower timestamp)
    const mathEntry = timeline.find(t => t.nodeId === math);
    const src1Entry = timeline.find(t => t.nodeId === src1);
    expect(mathEntry).toBeDefined();
    expect(src1Entry).toBeDefined();
    expect(src1Entry!.startTime).toBeLessThanOrEqual(mathEntry!.startTime);
  });
});

describe('Phase 10 Integration: Error Recovery + Profiling Utilities', () => {
  beforeEach(() => {
    resetEditorStore();
  });

  it('bottleneck analysis works with errored nodes in continue mode', () => {
    const src = getEditor().addNode('source', [0, 0, 0]);
    const custom = getEditor().addNode('custom', [5, 0, 0]);
    getEditor().updateCustomNodePorts(custom, 1, 1);
    getEditor().updateNodeData(custom, 'expression', '(() => { throw new Error("boom") })()');
    const out = getEditor().addNode('output', [10, 0, 0]);
    getEditor().addConnection(src, 0, custom, 0);
    getEditor().addConnection(custom, 0, out, 0);

    const result = execGraph(getEditor().nodes, getEditor().connections, undefined, undefined, undefined, 'continue');
    const metricsRecord = mapToRecord(result.metrics);

    // All 3 nodes should have metrics
    expect(Object.keys(metricsRecord)).toHaveLength(3);

    // Bottleneck analysis should include errored nodes
    const bottlenecks = getBottleneckNodes(metricsRecord, 5);
    expect(bottlenecks.length).toBe(3);

    // Timeline should be ordered
    const timeline = getExecutionTimeline(metricsRecord);
    expect(timeline).toHaveLength(3);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].startTime).toBeGreaterThanOrEqual(timeline[i - 1].startTime);
    }
  });

  it('upstream/downstream tracing helps identify error propagation', () => {
    const src = getEditor().addNode('source', [0, 0, 0]);
    const custom = getEditor().addNode('custom', [5, 0, 0]);
    // Custom nodes start with empty ports - add ports first
    getEditor().updateCustomNodePorts(custom, 1, 1);
    getEditor().updateNodeData(custom, 'expression', '(() => { throw new Error("boom") })()');
    const out = getEditor().addNode('output', [10, 0, 0]);
    getEditor().addConnection(src, 0, custom, 0);
    getEditor().addConnection(custom, 0, out, 0);

    const result = execGraph(getEditor().nodes, getEditor().connections, undefined, undefined, undefined, 'continue');

    // Find errored nodes
    const erroredNodes = Array.from(result.errors.keys());
    expect(erroredNodes).toContain(custom);

    // Get downstream of errored node to understand impact
    const impacted = getDownstreamPath(custom, getEditor().nodes, getEditor().connections);
    expect(impacted).toContain(out);
    expect(impacted).not.toContain(src);
  });
});

// Helper to convert Map<string, NodeExecutionMetric> to Record
function mapToRecord(map: Map<string, NodeExecutionMetric>): Record<string, NodeExecutionMetric> {
  const record: Record<string, NodeExecutionMetric> = {};
  for (const [id, m] of map) {
    record[id] = m;
  }
  return record;
}

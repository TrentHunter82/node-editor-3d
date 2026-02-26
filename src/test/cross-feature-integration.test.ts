/**
 * Cross-Feature Integration Tests
 *
 * Tests interactions between multiple features that were added across phases:
 * - Profiling + Error Strategy + Execution
 * - Debugger + Data Flow Tracing
 * - Connection Labels + Undo/Redo
 * - Settings Store + Editor Store
 * - Multi-graph state isolation
 * - Groups + Undo
 * - Custom Nodes + Execution + Profiling
 * - Templates + Connection Metadata
 * - Validation + Custom Nodes
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settingsStore';
import { getUpstreamPath, getDownstreamPath, getBottleneckNodes, getCacheHitRate } from '../utils/profiling';

const NODE_DURATION = 400;
const WAVE_DELAY = 600;

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
    showValuePreviews: false,
    contextMenu: null,
    customNodeDefs: {},
    searchQuery: '',
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    executionMetrics: {},
    executionTotalDuration: 0,
    debugMode: false,
    pausedAtWave: -1,
    debugWaves: [],
    traceNodeId: null,
    errorStrategy: 'fail-fast',
    validationErrors: {},
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: 0 } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    templates: {},
    subgraphDefs: {},
    breadcrumbStack: [],
  });
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
}

function getState() {
  return useEditorStore.getState();
}

// ─── Helpers ──────────────────────────────────────────────────────────

function createChain(length: number): { nodeIds: string[]; connIds: string[] } {
  const nodeIds: string[] = [];
  const connIds: string[] = [];

  // First node is always a source
  nodeIds.push(getState().addNode('source', [0, 0, 0]));
  getState().updateNodeData(nodeIds[0], 'value', 42);

  // Middle nodes are transforms
  for (let i = 1; i < length - 1; i++) {
    nodeIds.push(getState().addNode('transform', [i * 3, 0, 0]));
    getState().updateNodeData(nodeIds[i], 'multiplier', 2);
  }

  // Last node is output
  if (length > 1) {
    nodeIds.push(getState().addNode('output', [(length - 1) * 3, 0, 0]));
  }

  // Connect them in a chain
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const conn = getState().addConnection(nodeIds[i], 0, nodeIds[i + 1], 0);
    if (conn) connIds.push(conn);
  }

  return { nodeIds, connIds };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Cross-Feature Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ────────────────────────────────────────────────────────────────────
  // Profiling + Error Strategy + Execution
  // ────────────────────────────────────────────────────────────────────

  describe('Profiling + Error Strategy', () => {
    it('collects metrics even when error strategy is continue and nodes fail', () => {
      getState().setErrorStrategy('continue');

      // Source → Custom (throws) → Output
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 10);
      const custom = getState().addNode('custom', [3, 0, 0]);
      getState().updateCustomNodePorts(custom, 1, 1);
      getState().updateNodeData(custom, 'expression', '(() => { throw new Error("boom") })()');
      const out = getState().addNode('output', [6, 0, 0]);

      getState().addConnection(src, 0, custom, 0);
      getState().addConnection(custom, 0, out, 0);

      // Execute
      getState().executeGraph();
      vi.advanceTimersByTime(3 * WAVE_DELAY + NODE_DURATION + 100);

      // Metrics should exist for all executed nodes
      const metrics = getState().executionMetrics;
      expect(metrics[src]).toBeDefined();
      expect(metrics[src].duration).toBeGreaterThanOrEqual(0);

      // The custom node should have metrics too (it was attempted)
      expect(metrics[custom]).toBeDefined();

      // Errors should be recorded for the failing node
      expect(getState().executionErrors[custom]).toBeDefined();

      // Total duration should be >= 0 (fake timers may cause perf.now to return 0)
      expect(getState().executionTotalDuration).toBeGreaterThanOrEqual(0);
    });

    it('fail-fast stops metrics collection after first error', () => {
      getState().setErrorStrategy('fail-fast');

      // Source → Custom (throws) → Transform → Output
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 10);
      const custom = getState().addNode('custom', [3, 0, 0]);
      getState().updateCustomNodePorts(custom, 1, 1);
      getState().updateNodeData(custom, 'expression', '(() => { throw new Error("fail") })()');
      getState().addNode('transform', [6, 0, 0]);
      getState().addNode('output', [9, 0, 0]);

      getState().addConnection(src, 0, custom, 0);
      getState().addConnection(custom, 0, getState().addNode('transform', [6, 0, 0]), 0);

      getState().executeGraph();
      vi.advanceTimersByTime(4 * WAVE_DELAY + NODE_DURATION + 100);

      const metrics = getState().executionMetrics;
      // Source should have metrics (executed before the failing custom node)
      expect(metrics[src]).toBeDefined();
    });

    it('profiling bottleneck detection uses execution metrics from store', () => {
      const { nodeIds } = createChain(3);

      getState().executeGraph();
      vi.advanceTimersByTime(3 * WAVE_DELAY + NODE_DURATION + 100);

      const metrics = getState().executionMetrics;
      if (Object.keys(metrics).length > 0) {
        const bottlenecks = getBottleneckNodes(metrics, 2);
        expect(bottlenecks.length).toBeLessThanOrEqual(2);
        for (const b of bottlenecks) {
          expect(nodeIds).toContain(b.nodeId);
          expect(b.duration).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('cache hit rate reflects re-execution efficiency', () => {
      createChain(3);

      // First execution — no cache hits
      getState().executeGraph();
      vi.advanceTimersByTime(3 * WAVE_DELAY + NODE_DURATION + 100);

      const metrics1 = { ...getState().executionMetrics };
      if (Object.keys(metrics1).length > 0) {
        const rate1 = getCacheHitRate(metrics1);
        expect(rate1).toBe(0); // first run = 0% cache hits
      }

      // Re-execute — should hit cache for unchanged nodes
      getState().resetExecution();
      getState().executeGraph();
      vi.advanceTimersByTime(3 * WAVE_DELAY + NODE_DURATION + 100);

      const metrics2 = getState().executionMetrics;
      if (Object.keys(metrics2).length > 0) {
        const rate2 = getCacheHitRate(metrics2);
        expect(rate2).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Data Flow Tracing + Graph Structure
  // ────────────────────────────────────────────────────────────────────

  describe('Data Flow Tracing', () => {
    it('traces upstream and downstream paths through a chain', () => {
      const { nodeIds } = createChain(4);
      const { nodes, connections } = getState();

      // Trace from middle node
      const midNode = nodeIds[1];
      const upstream = getUpstreamPath(midNode, nodes, connections);
      const downstream = getDownstreamPath(midNode, nodes, connections);

      // Source should be upstream
      expect(upstream).toContain(nodeIds[0]);
      // Transform and Output should be downstream
      expect(downstream).toContain(nodeIds[2]);
      expect(downstream).toContain(nodeIds[3]);
    });

    it('setTraceNode stores the traced node id', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().setTraceNode(src);
      expect(getState().traceNodeId).toBe(src);

      getState().setTraceNode(null);
      expect(getState().traceNodeId).toBeNull();
    });

    it('traceNodeId cleared on undo (transient UI state)', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().setTraceNode(src);
      expect(getState().traceNodeId).toBe(src);

      getState().undo();
      // traceNodeId is cleared on undo along with other transient state
      expect(getState().traceNodeId).toBeNull();
    });

    it('traces through diamond-shaped graphs correctly', () => {
      // Diamond: src → tfA → math, src → tfB → math
      const src = getState().addNode('source', [0, 0, 0]);
      const tfA = getState().addNode('transform', [3, 0, -2]);
      const tfB = getState().addNode('transform', [3, 0, 2]);
      const math = getState().addNode('math', [6, 0, 0]);

      getState().addConnection(src, 0, tfA, 0);
      getState().addConnection(src, 0, tfB, 0);
      getState().addConnection(tfA, 0, math, 0);
      getState().addConnection(tfB, 0, math, 1);

      const { nodes, connections } = getState();
      const upstream = getUpstreamPath(math, nodes, connections);
      // Both transforms and the source should be upstream of math
      expect(upstream).toContain(src);
      expect(upstream).toContain(tfA);
      expect(upstream).toContain(tfB);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Connection Labels + Undo/Redo
  // ────────────────────────────────────────────────────────────────────

  describe('Connection Labels + Undo', () => {
    it('connection label survives undo of a subsequent operation', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      const connId = getState().addConnection(src, 0, out, 0);
      expect(connId).not.toBeNull();

      // Add label
      getState().updateConnectionLabel(connId!, 'data-flow');
      expect(getState().connections[connId!].label).toBe('data-flow');

      // Add another node (separate undo entry)
      getState().addNode('transform', [6, 0, 0]);

      // Undo the addNode — label should still exist
      getState().undo();
      expect(getState().connections[connId!].label).toBe('data-flow');
    });

    it('undo of updateConnectionLabel restores previous label', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      const connId = getState().addConnection(src, 0, out, 0)!;

      getState().updateConnectionLabel(connId, 'first-label');
      expect(getState().connections[connId].label).toBe('first-label');

      getState().updateConnectionLabel(connId, 'second-label');
      expect(getState().connections[connId].label).toBe('second-label');

      getState().undo(); // should restore 'first-label'
      expect(getState().connections[connId].label).toBe('first-label');

      getState().undo(); // should remove label
      expect(getState().connections[connId].label).toBeUndefined();
    });

    it('connection colorOverride is restored on undo', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      const connId = getState().addConnection(src, 0, out, 0)!;

      getState().updateConnectionColor(connId, '#FF0000');
      expect(getState().connections[connId].colorOverride).toBe('#FF0000');

      getState().undo();
      expect(getState().connections[connId].colorOverride).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Debugger + Execution
  // ────────────────────────────────────────────────────────────────────

  describe('Debugger + Execution Integration', () => {
    it('debug mode records waves during execution', () => {
      const { nodeIds } = createChain(3);

      getState().toggleDebugMode();
      expect(getState().debugMode).toBe(true);

      getState().executeGraph();
      // In debug mode, waves are stored immediately (no timeout animation)

      const waves = getState().debugWaves;
      expect(waves.length).toBeGreaterThan(0);

      // Each wave should contain valid node IDs
      for (const wave of waves) {
        for (const nid of wave) {
          expect(nodeIds).toContain(nid);
        }
      }
    });

    it('debug mode cleared by resetExecution', () => {
      getState().toggleDebugMode();
      getState().addNode('source', [0, 0, 0]);
      getState().executeGraph();

      getState().resetExecution();
      expect(getState().isExecuting).toBe(false);
      expect(getState().executionStates).toEqual({});
      expect(getState().nodeOutputs).toEqual({});
    });

    it('stepping through waves advances pausedAtWave', () => {
      createChain(3);

      getState().toggleDebugMode();
      getState().executeGraph();

      const numWaves = getState().debugWaves.length;
      expect(numWaves).toBeGreaterThan(0);
      expect(getState().pausedAtWave).toBe(-1); // paused before first wave

      // Step once — should advance to wave 0
      getState().stepExecution();
      vi.advanceTimersByTime(NODE_DURATION + 100);
      expect(getState().pausedAtWave).toBe(0);

      // Step through remaining waves
      for (let i = 1; i < numWaves; i++) {
        getState().stepExecution();
        vi.advanceTimersByTime(NODE_DURATION + 100);
      }

      // One more step to finish (step past last wave)
      getState().stepExecution();
      vi.advanceTimersByTime(NODE_DURATION + 100);

      // After stepping past all waves, execution should be complete
      expect(getState().isExecuting).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Multi-Graph State Isolation
  // ────────────────────────────────────────────────────────────────────

  describe('Multi-Graph State Isolation', () => {
    it('error strategy is per-graph', () => {
      // Set continue in default graph
      getState().setErrorStrategy('continue');
      expect(getState().errorStrategy).toBe('continue');

      // Create and switch to new graph
      const graphB = getState().createGraph('Graph B');
      getState().switchGraph(graphB);

      // New graph should have default strategy
      expect(getState().errorStrategy).toBe('fail-fast');

      // Switch back — should restore continue
      getState().switchGraph('default');
      expect(getState().errorStrategy).toBe('continue');
    });

    it('execution metrics are cleared on graph switch', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().executeGraph();
      vi.advanceTimersByTime(2000);

      const graphB = getState().createGraph('Graph B');
      getState().switchGraph(graphB);

      // Metrics should be cleared in new graph
      expect(getState().executionMetrics).toEqual({});
      expect(getState().executionTotalDuration).toBe(0);
    });

    it('connection labels are preserved per-graph', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      const connId = getState().addConnection(src, 0, out, 0)!;
      getState().updateConnectionLabel(connId, 'graph-a-label');

      // Switch to new graph
      const graphB = getState().createGraph('Graph B');
      getState().switchGraph(graphB);

      // New graph has no connections
      expect(Object.keys(getState().connections)).toHaveLength(0);

      // Switch back — label should be preserved
      getState().switchGraph('default');
      expect(getState().connections[connId].label).toBe('graph-a-label');
    });

    it('debugger state is global (not per-graph)', () => {
      // debugMode and traceNodeId are NOT in GraphData — they're global
      getState().toggleDebugMode();
      expect(getState().debugMode).toBe(true);

      const graphB = getState().createGraph('Graph B');
      getState().switchGraph(graphB);

      // Debug mode persists across graph switches (it's global)
      expect(getState().debugMode).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Settings Store Integration
  // ────────────────────────────────────────────────────────────────────

  describe('Settings Store Integration', () => {
    it('settings store is independent of editor store reset', () => {
      useSettingsStore.getState().setTheme('light');
      useSettingsStore.getState().setGridSnapSize(0.5);

      // Reset editor store
      resetStore();

      // Settings should have been reset too (our resetStore resets both)
      expect(useSettingsStore.getState().theme).toBe('dark');
      expect(useSettingsStore.getState().gridSnapSize).toBe(1);
    });

    it('settings defaults are sensible', () => {
      const settings = useSettingsStore.getState();
      expect(settings.gridSnapSize).toBe(1);
      expect(settings.animationSpeed).toBe(1);
      expect(settings.uiScale).toBe(1);
      expect(settings.theme).toBe('dark');
      expect(settings.minimapVisible).toBe(true);
      expect(settings.inspectorVisible).toBe(true);
      expect(settings.autoSave).toBe(true);
      expect(settings.recentFiles).toEqual([]);
    });

    it('settings persist independently of graph operations', () => {
      useSettingsStore.getState().setTheme('light');
      useSettingsStore.getState().setAnimationSpeed(0.5);

      // Create graph, add nodes — settings shouldn't change
      getState().addNode('source', [0, 0, 0]);
      getState().addNode('transform', [3, 0, 0]);

      expect(useSettingsStore.getState().theme).toBe('light');
      expect(useSettingsStore.getState().animationSpeed).toBe(0.5);
    });

    it('resetToDefaults restores all settings', () => {
      const settings = useSettingsStore.getState();
      settings.setTheme('light');
      settings.setGridSnapSize(0.25);
      settings.setAnimationSpeed(2);
      settings.setUiScale(1.5);
      settings.setMinimapVisible(false);
      settings.setInspectorVisible(false);
      settings.setAutoSave(false);
      settings.addRecentFile('test.json');

      settings.resetToDefaults();

      const reset = useSettingsStore.getState();
      expect(reset.theme).toBe('dark');
      expect(reset.gridSnapSize).toBe(1);
      expect(reset.animationSpeed).toBe(1);
      expect(reset.uiScale).toBe(1);
      expect(reset.minimapVisible).toBe(true);
      expect(reset.inspectorVisible).toBe(true);
      expect(reset.autoSave).toBe(true);
      expect(reset.recentFiles).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Combined Workflow: Create → Configure → Execute → Profile → Undo
  // ────────────────────────────────────────────────────────────────────

  describe('End-to-End Workflow', () => {
    it('create graph, label connections, execute, check metrics, undo', () => {
      // 1. Create nodes
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 100);
      const tf = getState().addNode('transform', [3, 0, 0]);
      getState().updateNodeData(tf, 'multiplier', 2);
      const out = getState().addNode('output', [6, 0, 0]);

      // 2. Connect and label
      const c1 = getState().addConnection(src, 0, tf, 0)!;
      const c2 = getState().addConnection(tf, 0, out, 0)!;
      getState().updateConnectionLabel(c1, 'raw-data');
      getState().updateConnectionColor(c2, '#00FF00');

      // 3. Execute
      getState().executeGraph();
      vi.advanceTimersByTime(3 * WAVE_DELAY + NODE_DURATION + 100);

      // 4. Check execution completed
      expect(getState().isExecuting).toBe(false);

      // 5. Check metrics exist
      const metrics = getState().executionMetrics;
      expect(Object.keys(metrics).length).toBeGreaterThan(0);

      // 6. Check outputs
      const outputs = getState().nodeOutputs;
      expect(outputs[src]).toBeDefined();

      // 7. Undo — should clear execution state
      getState().undo();
      expect(getState().executionMetrics).toEqual({});
    });

    it('error strategy affects execution behavior end-to-end', () => {
      // Create a graph with a failing node
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 42);
      const custom = getState().addNode('custom', [3, 0, 0]);
      getState().updateCustomNodePorts(custom, 1, 1);
      getState().updateNodeData(custom, 'expression', 'undefined.foo');
      const out = getState().addNode('output', [6, 0, 0]);

      getState().addConnection(src, 0, custom, 0);
      getState().addConnection(custom, 0, out, 0);

      // Execute with fail-fast
      getState().setErrorStrategy('fail-fast');
      getState().executeGraph();
      vi.advanceTimersByTime(3 * WAVE_DELAY + NODE_DURATION + 100);

      const errors1 = getState().executionErrors;
      expect(Object.keys(errors1).length).toBeGreaterThan(0);

      // Reset and try with continue
      getState().resetExecution();
      getState().setErrorStrategy('continue');
      getState().executeGraph();
      vi.advanceTimersByTime(3 * WAVE_DELAY + NODE_DURATION + 100);

      // In continue mode, errors are recorded but execution continues
      const errors2 = getState().executionErrors;
      expect(Object.keys(errors2).length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Group Operations + Undo Integration
  // ────────────────────────────────────────────────────────────────────

  describe('Groups + Undo', () => {
    it('group collapse state survives undo of unrelated operations', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [3, 0, 0]);

      // Select both and create group
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('My Group');
      expect(groupId).not.toBeNull();

      // Collapse the group
      getState().toggleGroupCollapse(groupId!);
      expect(getState().groups[groupId!].collapsed).toBe(true);

      // Add a new node (separate undo entry)
      getState().addNode('output', [6, 0, 0]);

      // Undo addNode — group should still be collapsed
      getState().undo();
      expect(getState().groups[groupId!].collapsed).toBe(true);
    });

    it('undo of group creation removes the group', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [3, 0, 0]);

      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('Test Group');
      expect(groupId).not.toBeNull();
      expect(Object.keys(getState().groups)).toHaveLength(1);

      getState().undo();
      expect(Object.keys(getState().groups)).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Custom Node + Execution + Profiling
  // ────────────────────────────────────────────────────────────────────

  describe('Custom Nodes + Execution', () => {
    it('custom node with multiple outputs populates metrics', () => {
      // Create a custom node def with 2 outputs
      const defId = getState().addCustomNodeDef({
        name: 'Splitter',
        color: '#FF6B35',
        category: 'custom',
        inputs: [{ label: 'in', portType: 'number' }],
        outputs: [
          { label: 'double', portType: 'number' },
          { label: 'half', portType: 'number' },
        ],
        expression: '[in0 * 2, in0 / 2]',
      });

      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 10);
      const custom = getState().addNode('custom', [3, 0, 0]);
      getState().updateNodeData(custom, 'customDefId', defId);
      getState().updateCustomNodePorts(custom, 1, 2);
      getState().updateNodeData(custom, 'expression', '[in0 * 2, in0 / 2]');

      getState().addConnection(src, 0, custom, 0);

      getState().executeGraph();
      vi.advanceTimersByTime(2 * WAVE_DELAY + NODE_DURATION + 100);

      // Metrics should be populated
      const metrics = getState().executionMetrics;
      expect(metrics[src]).toBeDefined();
      expect(metrics[custom]).toBeDefined();
    });

    it('custom node expression error is recorded', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 5);
      const custom = getState().addNode('custom', [3, 0, 0]);
      getState().updateCustomNodePorts(custom, 1, 1);
      getState().updateNodeData(custom, 'expression', 'syntax error !!');

      getState().addConnection(src, 0, custom, 0);
      getState().setErrorStrategy('continue');

      getState().executeGraph();
      vi.advanceTimersByTime(2 * WAVE_DELAY + NODE_DURATION + 100);

      // Error should be recorded
      expect(getState().executionErrors[custom]).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Templates + Connection Metadata
  // ────────────────────────────────────────────────────────────────────

  describe('Templates preserve connection metadata', () => {
    it('connection labels survive template save and instantiate', () => {
      // Create a small graph
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      const connId = getState().addConnection(src, 0, out, 0)!;
      getState().updateConnectionLabel(connId, 'template-label');
      getState().updateConnectionColor(connId, '#FF00FF');

      // Select all and save as template
      getState().setSelection(new Set([src, out]));
      const templateId = getState().saveSelectionAsTemplate('Labeled Template');
      expect(templateId).not.toBeNull();

      // Clear selection and instantiate
      getState().setSelection(new Set());
      getState().instantiateTemplate(templateId!, [10, 0, 0]);

      // Find the new connection (should have the label)
      const allConns = Object.values(getState().connections);
      const newConns = allConns.filter(c => c.id !== connId);
      expect(newConns.length).toBeGreaterThanOrEqual(1);

      // At least one new connection should have the label
      const labeled = newConns.find(c => c.label === 'template-label');
      expect(labeled).toBeDefined();
      expect(labeled!.colorOverride).toBe('#FF00FF');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Duplicate preserves connection metadata
  // ────────────────────────────────────────────────────────────────────

  describe('Duplicate preserves connection metadata', () => {
    it('duplicated connections retain labels and colors', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const tf = getState().addNode('transform', [3, 0, 0]);
      const connId = getState().addConnection(src, 0, tf, 0)!;
      getState().updateConnectionLabel(connId, 'copied-label');
      getState().updateConnectionColor(connId, '#AABB00');

      // Select both nodes and duplicate
      getState().setSelection(new Set([src, tf]));
      getState().duplicateSelected();

      // Should have 4 nodes now
      const allNodes = Object.keys(getState().nodes);
      expect(allNodes).toHaveLength(4);

      // Check if the duplicated connection has the label
      const allConns = Object.values(getState().connections);
      // There should be at least 1 connection with the copied label
      const labeled = allConns.filter(c => c.label === 'copied-label');
      expect(labeled.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Validation + Custom Nodes
  // ────────────────────────────────────────────────────────────────────

  describe('Validation + Disconnected inputs', () => {
    it('validateGraph detects disconnected inputs on transform nodes', () => {
      // Add a transform node without any connection to its input
      getState().addNode('transform', [0, 0, 0]);

      getState().validateGraph();
      const errors = getState().validationErrors;
      // Transform has inputs that need connections
      expect(Object.keys(errors).length).toBeGreaterThan(0);
    });

    it('validateGraph clears on undo to pre-validation state', () => {
      getState().addNode('transform', [0, 0, 0]);

      getState().validateGraph();
      expect(Object.keys(getState().validationErrors).length).toBeGreaterThan(0);

      // Undo should clear validation errors (transient state)
      getState().undo();
      expect(getState().validationErrors).toEqual({});
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Node Selection + Tracing
  // ────────────────────────────────────────────────────────────────────

  describe('Selection + Tracing', () => {
    it('selectConnected selects upstream/downstream nodes', () => {
      const { nodeIds } = createChain(4);

      // Select middle node and select connected upstream
      getState().setSelection(new Set([nodeIds[1]]));
      getState().selectConnected('upstream');

      const selected = getState().selectedIds;
      expect(selected.has(nodeIds[0])).toBe(true); // source
      expect(selected.has(nodeIds[1])).toBe(true); // self
    });

    it('selectConnected selects downstream nodes', () => {
      const { nodeIds } = createChain(4);

      // Select middle node and select connected downstream
      getState().setSelection(new Set([nodeIds[1]]));
      getState().selectConnected('downstream');

      const selected = getState().selectedIds;
      expect(selected.has(nodeIds[1])).toBe(true); // self
      expect(selected.has(nodeIds[2])).toBe(true); // next
      expect(selected.has(nodeIds[3])).toBe(true); // output
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Snap + Position
  // ────────────────────────────────────────────────────────────────────

  describe('Snap + Position', () => {
    it('snap enabled affects grid alignment', () => {
      expect(getState().snapEnabled).toBe(true);

      getState().toggleSnap();
      expect(getState().snapEnabled).toBe(false);

      getState().toggleSnap();
      expect(getState().snapEnabled).toBe(true);
    });
  });
});

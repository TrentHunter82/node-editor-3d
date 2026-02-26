import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph as execGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
  });
}

function getState() {
  return useEditorStore.getState();
}

/** Advance past all execution animation waves (generous time to cover long chains) */
function drainExecution() {
  vi.advanceTimersByTime(10_000);
}

// ============================================================================
// Cross-feature: Profiling + Error Recovery
// ============================================================================

describe('Cross-feature: Profiling + Error Recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fail-fast execution still populates metrics for completed nodes', () => {
    // Chain: source(42) -> custom(throws) -> output
    // In fail-fast mode, source runs fine, custom throws, output is never reached.
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 42);

    const customId = getState().addNode('custom', [5, 0, 0]);
    getState().updateNodeData(customId, 'expression', '(() => { throw new Error("boom") })()');

    const outId = getState().addNode('output', [10, 0, 0]);

    // Connect source -> custom -> output
    // Note: custom nodes from addNode('custom') have no ports (empty from config).
    // Connections to portless nodes are rejected, but all 3 nodes still get executed
    // as independent or partially-connected nodes in topological order.
    getState().addConnection(srcId, 0, customId, 0);
    getState().addConnection(customId, 0, outId, 0);

    // Ensure fail-fast
    expect(getState().errorStrategy).toBe('fail-fast');

    // Execute
    getState().executeGraph();

    const metrics = getState().executionMetrics;

    // Source should have metrics (it ran successfully before the error)
    expect(metrics[srcId]).toBeDefined();
    expect(metrics[srcId].duration).toBeGreaterThanOrEqual(0);
    expect(metrics[srcId].cacheHit).toBe(false);

    // Custom (thrower) should have metrics (it ran and errored)
    expect(metrics[customId]).toBeDefined();
    expect(metrics[customId].duration).toBeGreaterThanOrEqual(0);

    // Output should NOT have metrics in fail-fast mode
    // (execution stops at the first error, so output is never reached)
    expect(metrics[outId]).toBeUndefined();

    // Error should be recorded for the thrower
    expect(getState().executionErrors[customId]).toContain('boom');

    drainExecution();
  });

  it('continue mode populates metrics for ALL nodes including errored ones', () => {
    // Same chain but with continue strategy
    getState().setErrorStrategy('continue');

    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 42);

    const customId = getState().addNode('custom', [5, 0, 0]);
    getState().updateNodeData(customId, 'expression', '(() => { throw new Error("boom") })()');

    const outId = getState().addNode('output', [10, 0, 0]);

    getState().addConnection(srcId, 0, customId, 0);
    getState().addConnection(customId, 0, outId, 0);

    getState().executeGraph();

    const metrics = getState().executionMetrics;

    // In continue mode, all nodes are processed regardless of errors
    expect(metrics[srcId]).toBeDefined();
    expect(metrics[srcId].duration).toBeGreaterThanOrEqual(0);

    expect(metrics[customId]).toBeDefined();
    expect(metrics[customId].duration).toBeGreaterThanOrEqual(0);

    expect(metrics[outId]).toBeDefined();
    expect(metrics[outId].duration).toBeGreaterThanOrEqual(0);

    // Error still recorded for thrower
    expect(getState().executionErrors[customId]).toContain('boom');

    drainExecution();
  });

  it('metrics include totalDuration even when errors occur', () => {
    // Test with fail-fast
    const srcId1 = getState().addNode('source', [0, 0, 0]);
    const customId1 = getState().addNode('custom', [5, 0, 0]);
    getState().updateNodeData(customId1, 'expression', '(() => { throw new Error("boom") })()');

    getState().addConnection(srcId1, 0, customId1, 0);

    getState().executeGraph();
    expect(getState().executionTotalDuration).toBeGreaterThanOrEqual(0);

    drainExecution();

    // Reset and test with continue mode
    resetStore();
    getState().setErrorStrategy('continue');

    const srcId2 = getState().addNode('source', [0, 0, 0]);
    const customId2 = getState().addNode('custom', [5, 0, 0]);
    getState().updateNodeData(customId2, 'expression', '(() => { throw new Error("fail") })()');

    getState().addConnection(srcId2, 0, customId2, 0);

    getState().executeGraph();
    expect(getState().executionTotalDuration).toBeGreaterThanOrEqual(0);

    drainExecution();
  });
});

// ============================================================================
// Cross-feature: Connection Labels + Undo + Execution
// ============================================================================

describe('Cross-feature: Connection Labels + Undo + Execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('labeled connections execute the same as unlabeled', () => {
    // Build source(10) -> transform(×3) -> output
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 10);

    const xfmId = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfmId, 'multiplier', 3);
    getState().updateNodeData(xfmId, 'offset', 0);

    const outId = getState().addNode('output', [10, 0, 0]);

    const c1 = getState().addConnection(srcId, 0, xfmId, 0);
    const c2 = getState().addConnection(xfmId, 0, outId, 0);
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    // Label the connections
    getState().updateConnectionLabel(c1!, 'source value');
    getState().updateConnectionColor(c1!, '#FF0000');
    getState().updateConnectionLabel(c2!, 'result data');

    // Verify labels are set
    expect(getState().connections[c1!].label).toBe('source value');
    expect(getState().connections[c1!].colorOverride).toBe('#FF0000');
    expect(getState().connections[c2!].label).toBe('result data');

    // Execute - labels should have zero effect on computation
    getState().executeGraph();
    drainExecution();

    // Transform: in=10, factor=3, offset=0 -> result = 10 * 3 + 0 = 30
    expect(getState().nodeOutputs[xfmId][0]).toBe(30);

    // Labels still present after execution
    expect(getState().connections[c1!].label).toBe('source value');
    expect(getState().connections[c2!].label).toBe('result data');
  });

  it('connection labels survive save/load roundtrip', () => {
    // Build a simple graph with labeled and colored connections
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 5);
    const xfmId = getState().addNode('transform', [5, 0, 0]);
    const outId = getState().addNode('output', [10, 0, 0]);

    const c1 = getState().addConnection(srcId, 0, xfmId, 0)!;
    const c2 = getState().addConnection(xfmId, 0, outId, 0)!;

    // Label + color
    getState().updateConnectionLabel(c1, 'signal-A');
    getState().updateConnectionColor(c1, '#00FF00');
    getState().updateConnectionLabel(c2, 'output-pipe');
    getState().updateConnectionColor(c2, '#0000FF');

    // Export
    const exported = getState().exportAllGraphs();

    // Reset everything
    resetStore();

    // Import
    getState().importAllGraphs(exported);

    // Verify labels and colors survived the roundtrip
    const conns = getState().connections;
    const conn1 = conns[c1];
    const conn2 = conns[c2];

    expect(conn1).toBeDefined();
    expect(conn1.label).toBe('signal-A');
    expect(conn1.colorOverride).toBe('#00FF00');

    expect(conn2).toBeDefined();
    expect(conn2.label).toBe('output-pipe');
    expect(conn2.colorOverride).toBe('#0000FF');
  });

  it('undo connection label, execute, re-label workflow', () => {
    // Build source -> transform
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 7);
    const xfmId = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfmId, 'multiplier', 2);
    getState().updateNodeData(xfmId, 'offset', 0);

    const connId = getState().addConnection(srcId, 0, xfmId, 0)!;

    // Step 1: Set a label
    getState().updateConnectionLabel(connId, 'first-label');
    expect(getState().connections[connId].label).toBe('first-label');

    // Step 2: Undo the label
    expect(getState().canUndo()).toBe(true);
    getState().undo();
    expect(getState().connections[connId].label).toBeUndefined();

    // Step 3: Execute (no label present) - should work fine
    getState().executeGraph();
    drainExecution();
    expect(getState().nodeOutputs[xfmId][0]).toBe(14); // 7 * 2 = 14

    // Step 4: Set a new label - should work without issues
    getState().updateConnectionLabel(connId, 'second-label');
    expect(getState().connections[connId].label).toBe('second-label');

    // Step 5: Re-execute - still works fine with new label
    getState().executeGraph();
    drainExecution();
    expect(getState().nodeOutputs[xfmId][0]).toBe(14);
    expect(getState().connections[connId].label).toBe('second-label');
  });
});

// ============================================================================
// Cross-feature: Port Metadata + Node Creation + Duplicate
// ============================================================================

describe('Cross-feature: Port Metadata + Node Creation + Duplicate', () => {
  beforeEach(() => {
    resetStore();
  });

  it('duplicated nodes preserve port metadata from original', () => {
    // Create a source node - it has port descriptions in NODE_TYPE_CONFIG
    const srcId = getState().addNode('source', [0, 0, 0]);
    const original = getState().nodes[srcId];

    // Verify the original has port metadata
    expect(original.outputs.length).toBeGreaterThan(0);
    expect(original.outputs[0].description).toBe('The numeric value of this source');
    expect(original.outputs[0].defaultValue).toBe(0);
    if (original.outputs.length > 1) {
      expect(original.outputs[1].description).toBe('Display label for this source');
    }

    // Select and duplicate
    useEditorStore.setState({ selectedIds: new Set([srcId]) });
    getState().duplicateSelected();

    // Find the duplicate (the new selection)
    const dupId = [...getState().selectedIds][0];
    expect(dupId).not.toBe(srcId);

    const duplicate = getState().nodes[dupId];

    // Verify duplicate preserves port metadata
    expect(duplicate.outputs).toHaveLength(original.outputs.length);
    for (let i = 0; i < original.outputs.length; i++) {
      expect(duplicate.outputs[i].description).toBe(original.outputs[i].description);
      expect(duplicate.outputs[i].defaultValue).toBe(original.outputs[i].defaultValue);
      expect(duplicate.outputs[i].label).toBe(original.outputs[i].label);
      expect(duplicate.outputs[i].portType).toBe(original.outputs[i].portType);
    }

    // Verify the duplicate has different port IDs (deep-copied, not shared references)
    expect(duplicate.outputs[0]).not.toBe(original.outputs[0]);
  });

  it('port metadata present after save/load cycle', () => {
    // Create a transform node (has inputs with descriptions, defaultValues, etc.)
    const xfmId = getState().addNode('transform', [0, 0, 0]);
    const originalNode = getState().nodes[xfmId];

    // Verify it has port metadata from config
    expect(originalNode.inputs[0].description).toBe('Input value to transform');
    expect(originalNode.inputs[0].defaultValue).toBe(0);
    expect(originalNode.inputs[1].description).toBe('Multiplication factor');
    expect(originalNode.inputs[1].defaultValue).toBe(1);

    // Export and import
    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    // Verify metadata survived roundtrip
    const loadedNode = getState().nodes[xfmId];
    expect(loadedNode).toBeDefined();
    expect(loadedNode.inputs[0].description).toBe('Input value to transform');
    expect(loadedNode.inputs[0].defaultValue).toBe(0);
    expect(loadedNode.inputs[1].description).toBe('Multiplication factor');
    expect(loadedNode.inputs[1].defaultValue).toBe(1);
    expect(loadedNode.outputs[0].description).toBe('in \u00d7 factor + offset');
  });

  it('clamp node port metadata includes min/max bounds', () => {
    // Clamp node has min/max on its ports
    const clampId = getState().addNode('clamp', [0, 0, 0]);
    const node = getState().nodes[clampId];

    // Check that port metadata with min/max is correctly created
    expect(node.inputs).toHaveLength(3);
    expect(node.inputs[0].description).toBe('Value to clamp');
    expect(node.inputs[1].description).toBe('Lower bound');
    expect(node.inputs[2].description).toBe('Upper bound');

    // The defaultValues should match config
    expect(node.inputs[0].defaultValue).toBe(0);
    expect(node.inputs[1].defaultValue).toBe(0);
    expect(node.inputs[2].defaultValue).toBe(1);
  });
});

// ============================================================================
// Cross-feature: Error Strategy + Multi-graph
// ============================================================================

describe('Cross-feature: Error Strategy + Multi-graph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('error strategy is per-graph: persists when switching back', () => {
    // errorStrategy is saved/restored per-graph (see switchGraph implementation)
    const defaultGraphId = getState().activeGraphId;

    // Set default graph to 'continue'
    getState().setErrorStrategy('continue');
    expect(getState().errorStrategy).toBe('continue');

    // Create a new graph (switches to it automatically)
    const newGraphId = getState().createGraph('Test Graph');
    expect(getState().activeGraphId).toBe(newGraphId);

    // New graph defaults to 'fail-fast'
    expect(getState().errorStrategy).toBe('fail-fast');

    // Switch back to default graph
    getState().switchGraph(defaultGraphId);
    expect(getState().activeGraphId).toBe(defaultGraphId);

    // The 'continue' strategy should have been preserved for the default graph
    expect(getState().errorStrategy).toBe('continue');
  });

  it('each graph can have its own error strategy', () => {
    const defaultGraphId = getState().activeGraphId;

    // Default graph: continue
    getState().setErrorStrategy('continue');

    // Create graph B
    const graphB = getState().createGraph('Graph B');
    // Graph B: fail-fast (default)
    expect(getState().errorStrategy).toBe('fail-fast');

    // Set graph B to continue
    getState().setErrorStrategy('continue');

    // Create graph C
    const graphC = getState().createGraph('Graph C');
    // Graph C: fail-fast (default)
    expect(getState().errorStrategy).toBe('fail-fast');

    // Verify each graph preserved its strategy
    getState().switchGraph(defaultGraphId);
    expect(getState().errorStrategy).toBe('continue');

    getState().switchGraph(graphB);
    expect(getState().errorStrategy).toBe('continue');

    getState().switchGraph(graphC);
    expect(getState().errorStrategy).toBe('fail-fast');
  });

  it('error strategy survives export/import across graphs', () => {
    const defaultGraphId = getState().activeGraphId;
    getState().setErrorStrategy('continue');

    // Create a second graph with default (fail-fast) strategy
    const graphB = getState().createGraph('Graph B');
    expect(getState().errorStrategy).toBe('fail-fast');

    // Export everything
    const exported = getState().exportAllGraphs();

    // Reset and import
    resetStore();
    getState().importAllGraphs(exported);

    // After import, we should be on the active graph (graphB) with fail-fast
    expect(getState().activeGraphId).toBe(graphB);
    expect(getState().errorStrategy).toBe('fail-fast');

    // Switch to default graph, should have 'continue'
    getState().switchGraph(defaultGraphId);
    expect(getState().errorStrategy).toBe('continue');
  });
});

// ============================================================================
// End-to-end: Full Phase 9 workflow
// ============================================================================

describe('End-to-end: Full Phase 9 workflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('full workflow: create graph with labels, execute with profiling, check metrics', () => {
    // Build: source(10) -> transform(×3) -> output
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 10);

    const xfmId = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfmId, 'multiplier', 3);
    getState().updateNodeData(xfmId, 'offset', 0);

    const outId = getState().addNode('output', [10, 0, 0]);

    const c1 = getState().addConnection(srcId, 0, xfmId, 0)!;
    const c2 = getState().addConnection(xfmId, 0, outId, 0)!;

    // Label connections
    getState().updateConnectionLabel(c1, 'raw-value');
    getState().updateConnectionColor(c1, '#FFD700');
    getState().updateConnectionLabel(c2, 'transformed');

    // Execute
    getState().executeGraph();

    // Verify metrics for all 3 nodes
    const metrics = getState().executionMetrics;
    expect(metrics[srcId]).toBeDefined();
    expect(metrics[srcId].duration).toBeGreaterThanOrEqual(0);
    expect(typeof metrics[srcId].timestamp).toBe('number');

    expect(metrics[xfmId]).toBeDefined();
    expect(metrics[xfmId].duration).toBeGreaterThanOrEqual(0);

    expect(metrics[outId]).toBeDefined();
    expect(metrics[outId].duration).toBeGreaterThanOrEqual(0);

    // Total duration should be positive
    expect(getState().executionTotalDuration).toBeGreaterThanOrEqual(0);

    // Verify execution results
    // transform: 10 * 3 + 0 = 30
    expect(getState().nodeOutputs[xfmId][0]).toBe(30);

    // Labels should still be present after execution
    expect(getState().connections[c1].label).toBe('raw-value');
    expect(getState().connections[c1].colorOverride).toBe('#FFD700');
    expect(getState().connections[c2].label).toBe('transformed');

    drainExecution();
    expect(getState().isExecuting).toBe(false);
  });

  it('full workflow: error recovery with profiling and labels', () => {
    // Set continue mode for error recovery
    getState().setErrorStrategy('continue');

    // Build: source(42) -> custom(throws) -> output
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 42);

    const customId = getState().addNode('custom', [5, 0, 0]);
    getState().updateNodeData(customId, 'expression', '(() => { throw new Error("intentional-fail") })()');

    const outId = getState().addNode('output', [10, 0, 0]);

    // Connect and label (connections may be rejected due to portless custom node,
    // but all nodes still get executed)
    getState().addConnection(srcId, 0, customId, 0);
    getState().addConnection(customId, 0, outId, 0);

    // Label whatever connections were accepted, and also test labeling source->out directly
    const c3 = getState().addConnection(srcId, 0, outId, 0);
    if (c3) {
      getState().updateConnectionLabel(c3, 'bypass');
      getState().updateConnectionColor(c3, '#FF4444');
    }

    // Execute with continue strategy
    getState().executeGraph();

    // Errors should be recorded for the throwing custom node
    expect(getState().executionErrors[customId]).toBeDefined();
    expect(getState().executionErrors[customId]).toContain('intentional-fail');

    // In continue mode, all nodes should have metrics
    const metrics = getState().executionMetrics;
    expect(metrics[srcId]).toBeDefined();
    expect(metrics[customId]).toBeDefined();
    expect(metrics[outId]).toBeDefined();

    // Total duration should be recorded
    expect(getState().executionTotalDuration).toBeGreaterThanOrEqual(0);

    // Labels should be unaffected by execution
    if (c3) {
      expect(getState().connections[c3].label).toBe('bypass');
      expect(getState().connections[c3].colorOverride).toBe('#FF4444');
    }

    // Advance through animation
    drainExecution();
    expect(getState().isExecuting).toBe(false);

    // After animation cleanup, all execution states are reset to idle
    expect(getState().executionStates[customId]).toBe('idle');
    expect(getState().executionStates[srcId]).toBe('idle');
  });

  it('clearGraph resets all Phase 9 transient state but preserves errorStrategy', () => {
    // Set up a graph with everything: labels, metrics, error strategy
    getState().setErrorStrategy('continue');

    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 5);

    const xfmId = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfmId, 'multiplier', 2);
    getState().updateNodeData(xfmId, 'offset', 0);

    const connId = getState().addConnection(srcId, 0, xfmId, 0)!;
    getState().updateConnectionLabel(connId, 'test-label');
    getState().updateConnectionColor(connId, '#123456');

    // Execute to populate metrics
    getState().executeGraph();
    drainExecution();

    // Verify state before clear
    expect(Object.keys(getState().executionMetrics).length).toBeGreaterThan(0);
    expect(getState().executionTotalDuration).toBeGreaterThanOrEqual(0);
    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(Object.keys(getState().connections).length).toBe(1);
    expect(getState().errorStrategy).toBe('continue');

    // Clear graph
    getState().clearGraph();

    // Nodes, connections, metrics should all be cleared
    expect(Object.keys(getState().nodes).length).toBe(0);
    expect(Object.keys(getState().connections).length).toBe(0);
    expect(Object.keys(getState().executionMetrics).length).toBe(0);
    expect(getState().executionTotalDuration).toBe(0);
    expect(getState().isExecuting).toBe(false);
    expect(Object.keys(getState().executionErrors).length).toBe(0);
    expect(Object.keys(getState().nodeOutputs).length).toBe(0);

    // Error strategy should be preserved (it's a user preference, not graph data)
    expect(getState().errorStrategy).toBe('continue');
  });
});

// ============================================================================
// Direct executeGraph: Profiling + Error Recovery (utility-level)
// ============================================================================

describe('Direct executeGraph: Profiling metrics with errors', () => {
  // These tests call execGraph directly (not via store) for precise control

  function makeSourceNode(id: string, value: number = 0): EditorNode {
    return {
      id,
      type: 'source',
      position: [0, 0, 0],
      title: 'Source',
      data: { value },
      inputs: [],
      outputs: [
        { id: 'out-0', label: 'value', portType: 'number' },
        { id: 'out-1', label: 'label', portType: 'string' },
      ],
    };
  }

  function makeThrowingNode(id: string): EditorNode {
    return {
      id,
      type: 'custom',
      position: [5, 0, 0],
      title: 'Thrower',
      data: { expression: '(() => { throw new Error("boom") })()' },
      inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
      outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
    };
  }

  function makeOutputNode(id: string): EditorNode {
    return {
      id,
      type: 'output',
      position: [10, 0, 0],
      title: 'Output',
      data: {},
      inputs: [
        { id: 'in-0', label: 'data', portType: 'any' },
        { id: 'in-1', label: 'label', portType: 'string' },
      ],
      outputs: [],
    };
  }

  function makeConn(
    id: string,
    src: string,
    srcPort: number,
    tgt: string,
    tgtPort: number,
  ): Connection {
    return {
      id,
      sourceNodeId: src,
      sourcePortIndex: srcPort,
      targetNodeId: tgt,
      targetPortIndex: tgtPort,
    };
  }

  it('fail-fast: metrics for source and thrower only', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeSourceNode('src', 10),
      thrower: makeThrowingNode('thrower'),
      out: makeOutputNode('out'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'thrower', 0),
      c2: makeConn('c2', 'thrower', 0, 'out', 0),
    };

    const result = execGraph(nodes, connections, undefined, undefined, undefined, 'fail-fast');

    // Source has metrics
    expect(result.metrics.has('src')).toBe(true);
    expect(result.metrics.get('src')!.cacheHit).toBe(false);

    // Thrower has metrics (it tried to execute)
    expect(result.metrics.has('thrower')).toBe(true);

    // Output never reached => no metrics
    expect(result.metrics.has('out')).toBe(false);

    // Total duration exists
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('continue: metrics for all nodes', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeSourceNode('src', 10),
      thrower: makeThrowingNode('thrower'),
      out: makeOutputNode('out'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'thrower', 0),
      c2: makeConn('c2', 'thrower', 0, 'out', 0),
    };

    const result = execGraph(nodes, connections, undefined, undefined, undefined, 'continue');

    // All 3 nodes have metrics in continue mode
    expect(result.metrics.has('src')).toBe(true);
    expect(result.metrics.has('thrower')).toBe(true);
    expect(result.metrics.has('out')).toBe(true);

    // Timestamps should be sequential (source before thrower before output)
    const srcTs = result.metrics.get('src')!.timestamp;
    const throwerTs = result.metrics.get('thrower')!.timestamp;
    const outTs = result.metrics.get('out')!.timestamp;
    expect(throwerTs).toBeGreaterThanOrEqual(srcTs);
    expect(outTs).toBeGreaterThanOrEqual(throwerTs);

    // Error still captured
    expect(result.errors.has('thrower')).toBe(true);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('labeled connections do not affect execution results', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeSourceNode('src', 7),
      out: makeOutputNode('out'),
    };
    const connections: Record<string, Connection> = {
      c1: {
        ...makeConn('c1', 'src', 0, 'out', 0),
        label: 'my-label',
        colorOverride: '#FF0000',
      },
    };

    const result = execGraph(nodes, connections);

    // Source produces 7
    expect(result.results.get('src')?.outputs[0]).toBe(7);

    // Output receives the value from source
    expect(result.results.has('out')).toBe(true);

    // No errors
    expect(result.errors.size).toBe(0);
  });
});

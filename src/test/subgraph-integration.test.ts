/**
 * Subgraph Integration Tests
 *
 * Tests the subgraph system's integration with other features:
 * - Enter/Exit + Undo/Redo
 * - Custom nodes inside subgraphs
 * - Execution (store-level and direct utility)
 * - Delete cascade (deleteSubgraphNode, deleteSelected)
 * - Multi-graph isolation
 * - Direct executeGraph with SubgraphContext (depth limit, missing def)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph as execGraph } from '../utils/execution';
import type { EditorNode, Connection, SubgraphNodeDef, GraphData } from '../types';

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
    storageWarning: null,
  });
}

function getState() {
  return useEditorStore.getState();
}

/** Advance past execution animation waves */
function drainExecution() {
  vi.advanceTimersByTime(10_000);
}

// ---------------------------------------------------------------------------
// Helpers for direct executeGraph tests
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
  inputs: EditorNode['inputs'] = [],
  outputs: EditorNode['outputs'] = [],
): EditorNode {
  return { id, type, position: [0, 0, 0], title: id, data, inputs, outputs };
}

function makeConn(
  id: string,
  src: string,
  srcPort: number,
  tgt: string,
  tgtPort: number,
): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ============================================================================
// 1. Subgraph + Enter/Exit + Undo/Redo
// ============================================================================

describe('Subgraph + Enter/Exit + Undo/Redo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('createSubgraph then undo removes the subgraph node and its def', () => {
    const subId = getState().createSubgraph('TestSub');
    expect(subId).toBeTruthy();

    // Subgraph node exists in current graph
    expect(getState().nodes[subId!]).toBeDefined();
    expect(getState().nodes[subId!].type).toBe('subgraph');

    // SubgraphDef exists
    expect(getState().subgraphDefs[subId!]).toBeDefined();
    expect(getState().subgraphDefs[subId!].name).toBe('TestSub');

    // Graph tab exists for inner graph
    const innerGraphId = getState().nodes[subId!].data.innerGraphId as string;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Undo removes everything
    expect(getState().canUndo()).toBe(true);
    getState().undo();

    expect(getState().nodes[subId!]).toBeUndefined();
    expect(getState().subgraphDefs[subId!]).toBeUndefined();
  });

  it('enterSubgraph changes activeGraphId and pushes breadcrumb', () => {
    const subId = getState().createSubgraph('NavTest')!;
    const parentGraphId = getState().activeGraphId;
    const innerGraphId = getState().nodes[subId].data.innerGraphId as string;

    expect(getState().breadcrumbStack).toHaveLength(0);

    getState().enterSubgraph(subId);

    // Active graph switched to inner graph
    expect(getState().activeGraphId).toBe(innerGraphId);

    // Breadcrumb pushed with parent info
    expect(getState().breadcrumbStack).toHaveLength(1);
    expect(getState().breadcrumbStack[0].graphId).toBe(parentGraphId);
    expect(getState().breadcrumbStack[0].subgraphNodeId).toBe(subId);

    // Inner graph has subgraph-input and subgraph-output nodes
    const innerNodes = Object.values(getState().nodes) as EditorNode[];
    const inputNodes = innerNodes.filter(n => n.type === 'subgraph-input');
    const outputNodes = innerNodes.filter(n => n.type === 'subgraph-output');
    expect(inputNodes).toHaveLength(1);
    expect(outputNodes).toHaveLength(1);
  });

  it('exitSubgraph restores parent graph state', () => {
    // Add a source node before creating subgraph
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 99);

    const subId = getState().createSubgraph('ExitTest')!;
    const parentGraphId = getState().activeGraphId;

    // Enter subgraph
    getState().enterSubgraph(subId);
    expect(getState().activeGraphId).not.toBe(parentGraphId);

    // Exit subgraph
    getState().exitSubgraph();

    // Back to parent graph
    expect(getState().activeGraphId).toBe(parentGraphId);
    expect(getState().breadcrumbStack).toHaveLength(0);

    // Parent graph's nodes are restored
    expect(getState().nodes[srcId]).toBeDefined();
    expect(getState().nodes[srcId].data.value).toBe(99);
    expect(getState().nodes[subId]).toBeDefined();
    expect(getState().nodes[subId].type).toBe('subgraph');

    // Selection restored to the subgraph node
    expect(getState().selectedIds.has(subId)).toBe(true);
  });

  it('breadcrumbStack tracks navigation depth across nested subgraphs', () => {
    // Create outer subgraph
    const outerSubId = getState().createSubgraph('Outer')!;
    getState().enterSubgraph(outerSubId);
    expect(getState().breadcrumbStack).toHaveLength(1);

    // Create inner subgraph while inside outer
    const innerSubId = getState().createSubgraph('Inner')!;
    getState().enterSubgraph(innerSubId);
    expect(getState().breadcrumbStack).toHaveLength(2);

    // First breadcrumb is root -> outer
    expect(getState().breadcrumbStack[0].subgraphNodeId).toBe(outerSubId);
    // Second breadcrumb is outer -> inner
    expect(getState().breadcrumbStack[1].subgraphNodeId).toBe(innerSubId);

    // Exit inner -> back to outer graph
    getState().exitSubgraph();
    expect(getState().breadcrumbStack).toHaveLength(1);

    // Exit outer -> back to root graph
    getState().exitSubgraph();
    expect(getState().breadcrumbStack).toHaveLength(0);
  });
});

// ============================================================================
// 2. Subgraph + Custom Nodes
// ============================================================================

describe('Subgraph + Custom Nodes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('convertSelectionToSubgraph wraps a custom node', () => {
    // Create a custom node def
    const defId = getState().addCustomNodeDef({
      name: 'Doubler',
      color: 'blue',
      category: 'Math',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'result', portType: 'number' }],
      expression: 'in0 * 2',
    });

    // Add a custom node instance
    const customNodeId = getState().addCustomNode(defId, [0, 0, 0])!;
    expect(customNodeId).toBeTruthy();
    expect(getState().nodes[customNodeId].type).toBe('custom');

    // Select it and convert to subgraph
    getState().setSelection(new Set([customNodeId]));
    const subId = getState().convertSelectionToSubgraph('CustomSub')!;
    expect(subId).toBeTruthy();

    // The custom node should no longer be in the parent graph
    expect(getState().nodes[customNodeId]).toBeUndefined();

    // The subgraph node should exist
    expect(getState().nodes[subId]).toBeDefined();
    expect(getState().nodes[subId].type).toBe('subgraph');
  });

  it('entering a subgraph that contains a custom node shows the custom node inside', () => {
    // Create custom node def + instance
    const defId = getState().addCustomNodeDef({
      name: 'Tripler',
      color: 'green',
      category: 'Math',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'result', portType: 'number' }],
      expression: 'in0 * 3',
    });
    const customNodeId = getState().addCustomNode(defId, [0, 0, 0])!;

    // Convert to subgraph
    getState().setSelection(new Set([customNodeId]));
    const subId = getState().convertSelectionToSubgraph('TripleSub')!;

    // Enter the subgraph
    getState().enterSubgraph(subId);

    // The custom node should be inside the inner graph
    const innerNodes = Object.values(getState().nodes) as EditorNode[];
    const customInside = innerNodes.find(n => n.type === 'custom');
    expect(customInside).toBeDefined();
    expect(customInside!.id).toBe(customNodeId);
    expect(customInside!.data.expression).toBe('in0 * 3');
  });

  it('executes a subgraph that contains a custom node (via store)', () => {
    // Build: source(5) -> [subgraph containing custom(in0*2)] -> output
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 5);

    const defId = getState().addCustomNodeDef({
      name: 'Doubler',
      color: 'blue',
      category: 'Math',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'result', portType: 'number' }],
      expression: 'in0 * 2',
    });
    const customNodeId = getState().addCustomNode(defId, [3, 0, 0])!;

    const outId = getState().addNode('output', [6, 0, 0]);

    // Connect source -> custom -> output
    getState().addConnection(srcId, 0, customNodeId, 0);
    getState().addConnection(customNodeId, 0, outId, 0);

    // Convert the custom node to a subgraph
    getState().setSelection(new Set([customNodeId]));
    const subId = getState().convertSelectionToSubgraph('DoublerSub')!;
    expect(subId).toBeTruthy();

    // Verify the subgraph is wired: source -> subgraph -> output
    const conns = Object.values(getState().connections) as Connection[];
    const toSub = conns.find(c => c.targetNodeId === subId);
    const fromSub = conns.find(c => c.sourceNodeId === subId);
    expect(toSub).toBeDefined();
    expect(fromSub).toBeDefined();

    // Execute the graph through the store
    getState().executeGraph();
    drainExecution();

    // The subgraph should produce 5 * 2 = 10
    // The output node receives the result
    expect(getState().nodeOutputs[subId]).toBeDefined();
    expect(getState().nodeOutputs[subId][0]).toBe(10);
  });
});

// ============================================================================
// 3. Subgraph + Execution
// ============================================================================

describe('Subgraph + Execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subgraph execution propagates data from parent inputs to inner graph and back', () => {
    // Build: source(7) -> subgraph(passthrough) -> output
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 7);

    const subId = getState().createSubgraph('Passthrough')!;

    const outId = getState().addNode('output', [6, 0, 0]);

    // Connect source -> subgraph -> output
    const c1 = getState().addConnection(srcId, 0, subId, 0);
    const c2 = getState().addConnection(subId, 0, outId, 0);
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    // Wire the inner graph: subgraph-input -> subgraph-output
    getState().enterSubgraph(subId);
    const innerNodes = Object.values(getState().nodes) as EditorNode[];
    const inputNode = innerNodes.find(n => n.type === 'subgraph-input')!;
    const outputNode = innerNodes.find(n => n.type === 'subgraph-output')!;
    getState().addConnection(inputNode.id, 0, outputNode.id, 0);
    getState().exitSubgraph();

    // Execute the parent graph
    getState().executeGraph();
    drainExecution();

    // Subgraph should pass through the value: 7
    expect(getState().nodeOutputs[subId]).toBeDefined();
    expect(getState().nodeOutputs[subId][0]).toBe(7);
  });

  it('error in inner subgraph node causes subgraph to produce null output', () => {
    // Build: source(1) -> subgraph(contains thrower) -> output
    // The inner error is caught inside the subgraph execution; the subgraph node
    // itself "succeeds" but produces null output because the inner output node
    // never receives data (fail-fast stops the inner graph early).
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 1);

    const subId = getState().createSubgraph('ErrorSub')!;
    const outId = getState().addNode('output', [6, 0, 0]);

    getState().addConnection(srcId, 0, subId, 0);
    getState().addConnection(subId, 0, outId, 0);

    // Enter subgraph and add a throwing custom node between input and output
    getState().enterSubgraph(subId);
    const innerNodes = Object.values(getState().nodes) as EditorNode[];
    const inputNode = innerNodes.find(n => n.type === 'subgraph-input')!;
    const outputNode = innerNodes.find(n => n.type === 'subgraph-output')!;

    // Add a custom node that throws
    const defId = getState().addCustomNodeDef({
      name: 'Thrower',
      color: 'red',
      category: 'Utility',
      inputs: [{ label: 'in', portType: 'any' }],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '(() => { throw new Error("inner-boom") })()',
    });
    const throwerId = getState().addCustomNode(defId, [0, 0, 0])!;

    // Connect input -> thrower -> output
    getState().addConnection(inputNode.id, 0, throwerId, 0);
    getState().addConnection(throwerId, 0, outputNode.id, 0);

    getState().exitSubgraph();

    // Execute with fail-fast (default)
    getState().executeGraph();
    drainExecution();

    // The inner error causes the subgraph to produce null output
    // (inner fail-fast stops before inner output node runs)
    expect(getState().nodeOutputs[subId]).toBeDefined();
    expect(getState().nodeOutputs[subId][0]).toBeNull();
  });

  it('error strategy "continue" allows other nodes to proceed even if subgraph has internal errors', () => {
    // Build two parallel paths:
    // source(42) -> subgraph(inner throws, produces null)
    // source(42) -> transform(×3) -> output
    // With "continue", both paths execute regardless
    getState().setErrorStrategy('continue');

    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 42);

    const subId = getState().createSubgraph('FailSub')!;
    getState().addConnection(srcId, 0, subId, 0);

    // Wire the inner subgraph to throw
    getState().enterSubgraph(subId);
    const innerNodes = Object.values(getState().nodes) as EditorNode[];
    const inputNode = innerNodes.find(n => n.type === 'subgraph-input')!;
    const outputNode = innerNodes.find(n => n.type === 'subgraph-output')!;
    const defId = getState().addCustomNodeDef({
      name: 'Thrower',
      color: 'red',
      category: 'Utility',
      inputs: [{ label: 'in', portType: 'any' }],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '(() => { throw new Error("sub-fail") })()',
    });
    const throwerId = getState().addCustomNode(defId, [0, 0, 0])!;
    getState().addConnection(inputNode.id, 0, throwerId, 0);
    getState().addConnection(throwerId, 0, outputNode.id, 0);
    getState().exitSubgraph();

    // Second path: transform
    const xfmId = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfmId, 'multiplier', 3);
    getState().updateNodeData(xfmId, 'offset', 0);
    const outId = getState().addNode('output', [8, 0, 0]);
    getState().addConnection(srcId, 0, xfmId, 0);
    getState().addConnection(xfmId, 0, outId, 0);

    // Execute with continue strategy
    getState().executeGraph();
    drainExecution();

    // Subgraph completed but produced null output (inner error absorbed)
    expect(getState().nodeOutputs[subId]).toBeDefined();
    expect(getState().nodeOutputs[subId][0]).toBeNull();

    // Transform still executed: 42 * 3 + 0 = 126
    expect(getState().nodeOutputs[xfmId]).toBeDefined();
    expect(getState().nodeOutputs[xfmId][0]).toBe(126);
  });

  it('store executeGraph builds SubgraphContext correctly for subgraph nodes', () => {
    // Create a subgraph that multiplies input by the transform processor
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 10);

    const subId = getState().createSubgraph('TransformSub')!;
    const outId = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(srcId, 0, subId, 0);
    getState().addConnection(subId, 0, outId, 0);

    // Enter subgraph, add a transform node: in * 5 + 0
    getState().enterSubgraph(subId);
    const innerNodesList = Object.values(getState().nodes) as EditorNode[];
    const inputNode = innerNodesList.find(n => n.type === 'subgraph-input')!;
    const outputNode = innerNodesList.find(n => n.type === 'subgraph-output')!;

    const xfmId = getState().addNode('transform', [0, 0, 0]);
    getState().updateNodeData(xfmId, 'multiplier', 5);
    getState().updateNodeData(xfmId, 'offset', 0);

    getState().addConnection(inputNode.id, 0, xfmId, 0);
    getState().addConnection(xfmId, 0, outputNode.id, 0);
    getState().exitSubgraph();

    // Execute
    getState().executeGraph();
    drainExecution();

    // Subgraph result: 10 * 5 + 0 = 50
    expect(getState().nodeOutputs[subId]).toBeDefined();
    expect(getState().nodeOutputs[subId][0]).toBe(50);
  });
});

// ============================================================================
// 4. Subgraph + Delete Cascade
// ============================================================================

describe('Subgraph + Delete Cascade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deleteSubgraphNode removes node, subgraphDef, and graphTab', () => {
    const subId = getState().createSubgraph('DelTest')!;
    const innerGraphId = getState().nodes[subId].data.innerGraphId as string;

    // Verify everything exists before deletion
    expect(getState().nodes[subId]).toBeDefined();
    expect(getState().subgraphDefs[subId]).toBeDefined();
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Delete via dedicated method
    getState().deleteSubgraphNode(subId);

    // All cleaned up
    expect(getState().nodes[subId]).toBeUndefined();
    expect(getState().subgraphDefs[subId]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('deleteSelected also cascades subgraph cleanup', () => {
    const subId = getState().createSubgraph('SelDelTest')!;
    const innerGraphId = getState().nodes[subId].data.innerGraphId as string;

    // Also add a connection to it
    const srcId = getState().addNode('source', [0, 0, 0]);
    const connId = getState().addConnection(srcId, 0, subId, 0);
    expect(connId).toBeTruthy();

    // Select the subgraph node and delete it via deleteSelected
    getState().setSelection(new Set([subId]));
    getState().deleteSelected();

    // Node, def, tab, and connection all cleaned up
    expect(getState().nodes[subId]).toBeUndefined();
    expect(getState().subgraphDefs[subId]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
    expect(getState().connections[connId!]).toBeUndefined();

    // Source node still exists
    expect(getState().nodes[srcId]).toBeDefined();
  });

  it('undo after deleteSubgraphNode restores node and subgraphDef', () => {
    const subId = getState().createSubgraph('UndoDelTest')!;
    const defName = getState().subgraphDefs[subId].name;

    // Delete
    getState().deleteSubgraphNode(subId);
    expect(getState().nodes[subId]).toBeUndefined();
    expect(getState().subgraphDefs[subId]).toBeUndefined();

    // Undo restores the node and subgraphDef (graphTabs is not part of undo snapshot)
    getState().undo();

    expect(getState().nodes[subId]).toBeDefined();
    expect(getState().nodes[subId].type).toBe('subgraph');
    expect(getState().subgraphDefs[subId]).toBeDefined();
    expect(getState().subgraphDefs[subId].name).toBe(defName);
  });
});

// ============================================================================
// 5. Subgraph + Multi-Graph
// ============================================================================

describe('Subgraph + Multi-Graph', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subgraphDefs are per-graph (creating in graph A does not affect graph B)', () => {
    // Create a subgraph in the default graph (graph A)
    const subIdA = getState().createSubgraph('SubA')!;
    expect(Object.keys(getState().subgraphDefs)).toHaveLength(1);
    expect(getState().subgraphDefs[subIdA]).toBeDefined();

    // Create a second graph and switch to it
    const graphB = getState().createGraph('Graph B');
    expect(getState().activeGraphId).toBe(graphB);

    // Graph B should have no subgraphDefs
    expect(Object.keys(getState().subgraphDefs)).toHaveLength(0);

    // Create a subgraph in graph B
    const subIdB = getState().createSubgraph('SubB')!;
    expect(Object.keys(getState().subgraphDefs)).toHaveLength(1);
    expect(getState().subgraphDefs[subIdB]).toBeDefined();

    // Switch back to graph A — its subgraphDefs should be intact
    getState().switchGraph('default');
    expect(Object.keys(getState().subgraphDefs)).toHaveLength(1);
    expect(getState().subgraphDefs[subIdA]).toBeDefined();
    expect(getState().subgraphDefs[subIdB]).toBeUndefined();
  });

  it('subgraph inner graph tabs do not appear in graphOrder', () => {
    const subId = getState().createSubgraph('HiddenTab')!;
    const innerGraphId = getState().nodes[subId].data.innerGraphId as string;

    // The inner graph has a tab (for breadcrumb navigation)
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // But it should NOT appear in graphOrder (tab bar)
    expect(getState().graphOrder).not.toContain(innerGraphId);
    expect(getState().graphOrder).toContain('default');
  });

  it('switching graphs preserves subgraphDefs', () => {
    // Create subgraph in default graph
    const subId = getState().createSubgraph('Persist')!;
    const defSnapshot = { ...getState().subgraphDefs[subId] };

    // Create and switch to new graph
    const graphB = getState().createGraph('Graph B');
    expect(getState().activeGraphId).toBe(graphB);

    // Switch back
    getState().switchGraph('default');

    // SubgraphDef survived the roundtrip
    expect(getState().subgraphDefs[subId]).toBeDefined();
    expect(getState().subgraphDefs[subId].name).toBe(defSnapshot.name);
    expect(getState().subgraphDefs[subId].innerGraphId).toBe(defSnapshot.innerGraphId);
    expect(getState().subgraphDefs[subId].exposedInputs).toEqual(defSnapshot.exposedInputs);
    expect(getState().subgraphDefs[subId].exposedOutputs).toEqual(defSnapshot.exposedOutputs);
  });
});

// ============================================================================
// 6. Direct executeGraph with SubgraphContext
// ============================================================================

describe('Direct executeGraph with SubgraphContext', () => {
  it('passthrough subgraph: source -> subgraph(input->output) -> output', () => {
    // Build parent graph nodes
    const srcNode = makeNode('src', 'source', { value: 42 }, [], [
      { id: 'src-out-0', label: 'value', portType: 'number' },
      { id: 'src-out-1', label: 'label', portType: 'string' },
    ]);

    const subNode = makeNode('sub', 'subgraph', {
      innerGraphId: 'inner-1',
      subgraphDefId: 'sub',
    }, [
      { id: 'sub-in-0', label: 'in', portType: 'any' },
    ], [
      { id: 'sub-out-0', label: 'out', portType: 'any' },
    ]);

    const outNode = makeNode('out', 'output', {}, [
      { id: 'out-in-0', label: 'data', portType: 'any' },
      { id: 'out-in-1', label: 'label', portType: 'string' },
    ]);

    const parentNodes: Record<string, EditorNode> = { src: srcNode, sub: subNode, out: outNode };
    const parentConns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sub', 0),
      c2: makeConn('c2', 'sub', 0, 'out', 0),
    };

    // Build inner graph: subgraph-input -> subgraph-output (passthrough)
    const innerInputNode = makeNode('inner-in', 'subgraph-input', { portIndex: 0 }, [], [
      { id: 'ii-out-0', label: 'value', portType: 'any' },
    ]);
    const innerOutputNode = makeNode('inner-out', 'subgraph-output', { portIndex: 0 }, [
      { id: 'io-in-0', label: 'value', portType: 'any' },
    ]);

    const innerGraph: GraphData = {
      nodes: { 'inner-in': innerInputNode, 'inner-out': innerOutputNode },
      connections: { ic1: makeConn('ic1', 'inner-in', 0, 'inner-out', 0) },
      groups: {},
      customNodeDefs: {},
    };

    const subDef: SubgraphNodeDef = {
      id: 'sub',
      name: 'Passthrough',
      innerGraphId: 'inner-1',
      exposedInputs: [{ portIndex: 0, innerNodeId: 'inner-in' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'inner-out' }],
    };

    const context = {
      subgraphDefs: { sub: subDef },
      getInnerGraph: (graphId: string) => graphId === 'inner-1' ? innerGraph : undefined,
    };

    const result = execGraph(parentNodes, parentConns, undefined, context);

    // Source produces 42
    expect(result.results.get('src')?.outputs[0]).toBe(42);

    // Subgraph passes through 42
    expect(result.results.get('sub')?.outputs[0]).toBe(42);

    // No errors
    expect(result.errors.size).toBe(0);
  });

  it('subgraph depth limit (10) produces error at the deepest level', () => {
    // Build a self-referencing subgraph that will recurse until depth limit.
    // The inner graph contains another subgraph node pointing to the same def.
    // At depth 10, the recursion is cut off with an error. The error is caught
    // by the inner executeGraph call, so the outer subgraph node does not directly
    // error but produces null output. We verify via a direct call at depth 9 to
    // confirm the depth limit error is thrown.
    const subNode = makeNode('sub', 'subgraph', {
      innerGraphId: 'inner-recursive',
      subgraphDefId: 'sub',
    }, [
      { id: 'sub-in-0', label: 'in', portType: 'any' },
    ], [
      { id: 'sub-out-0', label: 'out', portType: 'any' },
    ]);

    const parentNodes: Record<string, EditorNode> = { sub: subNode };
    const parentConns: Record<string, Connection> = {};

    // Inner graph: input -> subgraph(same def) -> output
    const innerInputNode = makeNode('inner-in', 'subgraph-input', { portIndex: 0 }, [], [
      { id: 'ii-out-0', label: 'value', portType: 'any' },
    ]);
    const innerSubNode = makeNode('inner-sub', 'subgraph', {
      innerGraphId: 'inner-recursive',
      subgraphDefId: 'sub',
    }, [
      { id: 'is-in-0', label: 'in', portType: 'any' },
    ], [
      { id: 'is-out-0', label: 'out', portType: 'any' },
    ]);
    const innerOutputNode = makeNode('inner-out', 'subgraph-output', { portIndex: 0 }, [
      { id: 'io-in-0', label: 'value', portType: 'any' },
    ]);

    const innerGraph: GraphData = {
      nodes: {
        'inner-in': innerInputNode,
        'inner-sub': innerSubNode,
        'inner-out': innerOutputNode,
      },
      connections: {
        ic1: makeConn('ic1', 'inner-in', 0, 'inner-sub', 0),
        ic2: makeConn('ic2', 'inner-sub', 0, 'inner-out', 0),
      },
      groups: {},
      customNodeDefs: {},
    };

    const subDef: SubgraphNodeDef = {
      id: 'sub',
      name: 'Recursive',
      innerGraphId: 'inner-recursive',
      exposedInputs: [{ portIndex: 0, innerNodeId: 'inner-in' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'inner-out' }],
    };

    const context = {
      subgraphDefs: { sub: subDef },
      getInnerGraph: (graphId: string) => graphId === 'inner-recursive' ? innerGraph : undefined,
    };

    // Execute at depth 9 — the inner subgraph hits depth 10 and errors.
    // The error is caught by executeGraph internally (fail-fast), so the
    // result has an error entry for the inner 'inner-sub' node.
    const result = execGraph(parentNodes, parentConns, undefined, context, 9);

    // The top-level 'sub' node processed via executeSubgraphNode at depth 9.
    // Inside, 'inner-sub' tried to recurse at depth 10 and hit the limit.
    // The error is recorded in the inner execution but the outer sub node
    // completes with null output. Verify the outer node has a result.
    expect(result.results.has('sub')).toBe(true);
    expect(result.results.get('sub')?.outputs[0]).toBeNull();

    // Also verify: when called at exactly depth 10, the subgraph node
    // directly errors with the depth exceeded message.
    const resultAtLimit = execGraph(parentNodes, parentConns, undefined, context, 10);
    expect(resultAtLimit.errors.has('sub')).toBe(true);
    expect(resultAtLimit.errors.get('sub')).toContain('recursion depth exceeded');
  });

  it('missing subgraphDef throws error', () => {
    const subNode = makeNode('sub', 'subgraph', {
      innerGraphId: 'inner-missing',
      subgraphDefId: 'nonexistent-def',
    }, [
      { id: 'sub-in-0', label: 'in', portType: 'any' },
    ], [
      { id: 'sub-out-0', label: 'out', portType: 'any' },
    ]);

    const parentNodes: Record<string, EditorNode> = { sub: subNode };
    const parentConns: Record<string, Connection> = {};

    const context = {
      subgraphDefs: {} as Record<string, SubgraphNodeDef>,
      getInnerGraph: () => undefined,
    };

    const result = execGraph(parentNodes, parentConns, undefined, context);

    // Should have error about missing def
    expect(result.errors.has('sub')).toBe(true);
    expect(result.errors.get('sub')).toContain('not found');
  });
});

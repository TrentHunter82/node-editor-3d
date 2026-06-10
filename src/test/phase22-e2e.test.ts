/// <reference types="vitest/config" />
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';
import { executeGraph, topologicalSort } from '../utils/execution';
import { getUpstreamPath, getDownstreamPath } from '../utils/profiling';
import { validateGraphData } from '../utils/migration';
import { NODE_TYPE_CONFIG } from '../types';
import type { NodeType, EditorNode, Connection } from '../types';

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
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
  });
}
function resetSettings() {
  useSettingsStore.setState(useSettingsStore.getInitialState());
}

/**
 * Build a raw EditorNode for direct use with executeGraph utility.
 * Uses NODE_TYPE_CONFIG to get correct ports.
 */
function makeRawNode(id: string, type: NodeType, data: Record<string, unknown> = {}): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ============================================================================
// 1. Large graph execution correctness
// ============================================================================
describe('Large graph execution correctness', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('50-node chain executes correctly end-to-end', () => {
    // source(42) -> transform(x1+0) -> transform(x1+0) -> ... (48 transforms)
    // The value 42 should propagate through all 48 identity transforms
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['n0'] = makeRawNode('n0', 'source', { value: 42 });
    for (let i = 1; i < 50; i++) {
      nodes[`n${i}`] = makeRawNode(`n${i}`, 'transform', { multiplier: 1, offset: 0 });
      connections[`c${i}`] = makeConn(`c${i}`, `n${i - 1}`, 0, `n${i}`, 0);
    }

    const result = executeGraph(nodes, connections);
    // The last transform should output 42
    const lastResult = result.results.get('n49');
    expect(lastResult).toBeDefined();
    expect(lastResult!.outputs[0]).toBe(42);
    expect(result.errors.size).toBe(0);
  });

  it('fan-out graph: 1 source -> 10 transforms all get correct values', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['src'] = makeRawNode('src', 'source', { value: 7 });
    for (let i = 0; i < 10; i++) {
      const tid = `t${i}`;
      nodes[tid] = makeRawNode(tid, 'transform', { multiplier: i + 1, offset: 0 });
      connections[`c${i}`] = makeConn(`c${i}`, 'src', 0, tid, 0);
    }

    const result = executeGraph(nodes, connections);
    for (let i = 0; i < 10; i++) {
      const r = result.results.get(`t${i}`);
      expect(r).toBeDefined();
      // transform: inputValue * multiplier + offset = 7 * (i+1) + 0
      expect(r!.outputs[0]).toBe(7 * (i + 1));
    }
  });

  it('diamond convergence: 2 sources -> math (add) -> result is sum', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['s1'] = makeRawNode('s1', 'source', { value: 13 });
    nodes['s2'] = makeRawNode('s2', 'source', { value: 29 });
    nodes['add'] = makeRawNode('add', 'math', { operation: 'add' });

    connections['c1'] = makeConn('c1', 's1', 0, 'add', 0);
    connections['c2'] = makeConn('c2', 's2', 0, 'add', 1);

    const result = executeGraph(nodes, connections);
    const addResult = result.results.get('add');
    expect(addResult).toBeDefined();
    expect(addResult!.outputs[0]).toBe(42);
  });

  it('mixed topology: chains + fan-out + convergence all in one graph', () => {
    // src1(10) --[x2]--> t1(20) --+
    //                              +--> math(add) --> result(25)
    // src2(5) -------------------+
    //   \--> t2(x3) --> abs --> (result=15 separate branch)
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['src1'] = makeRawNode('src1', 'source', { value: 10 });
    nodes['src2'] = makeRawNode('src2', 'source', { value: 5 });
    nodes['t1'] = makeRawNode('t1', 'transform', { multiplier: 2, offset: 0 });
    nodes['t2'] = makeRawNode('t2', 'transform', { multiplier: 3, offset: 0 });
    nodes['add'] = makeRawNode('add', 'math', { operation: 'add' });
    nodes['absNode'] = makeRawNode('absNode', 'abs');

    // src1 -> t1 -> add input 0
    connections['c1'] = makeConn('c1', 'src1', 0, 't1', 0);
    connections['c2'] = makeConn('c2', 't1', 0, 'add', 0);
    // src2 -> add input 1
    connections['c3'] = makeConn('c3', 'src2', 0, 'add', 1);
    // src2 -> t2 -> abs
    connections['c4'] = makeConn('c4', 'src2', 0, 't2', 0);
    connections['c5'] = makeConn('c5', 't2', 0, 'absNode', 0);

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);
    // t1: 10 * 2 + 0 = 20
    expect(result.results.get('t1')!.outputs[0]).toBe(20);
    // add: 20 + 5 = 25
    expect(result.results.get('add')!.outputs[0]).toBe(25);
    // t2: 5 * 3 + 0 = 15
    expect(result.results.get('t2')!.outputs[0]).toBe(15);
    // abs(15) = 15
    expect(result.results.get('absNode')!.outputs[0]).toBe(15);
  });

  it('execution with cache warming (execute twice, second uses cache)', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['s'] = makeRawNode('s', 'source', { value: 99 });
    nodes['t'] = makeRawNode('t', 'transform', { multiplier: 2, offset: 1 });
    connections['c1'] = makeConn('c1', 's', 0, 't', 0);

    // First execution - no cache
    const result1 = executeGraph(nodes, connections);
    expect(result1.results.get('t')!.outputs[0]).toBe(199); // 99*2+1

    // Second execution - pass result1's results as cache
    const result2 = executeGraph(nodes, connections, result1.results);
    expect(result2.results.get('t')!.outputs[0]).toBe(199);

    // On second execution, all nodes should be cache hits
    const tMetric = result2.metrics.get('t');
    expect(tMetric).toBeDefined();
    expect(tMetric!.cacheHit).toBe(true);
  });

  it('execution with continue error strategy handles errors in middle of chain', () => {
    // source -> custom(throws) -> transform -> output
    // With 'continue', execution should proceed past the error
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['s'] = makeRawNode('s', 'source', { value: 5 });
    nodes['bad'] = makeRawNode('bad', 'custom', { expression: 'throw new Error("boom")', inputCount: 1, outputCount: 1 });
    // Give the custom node proper ports
    nodes['bad'].inputs = [{ id: 'in-0', label: 'in', portType: 'any' }];
    nodes['bad'].outputs = [{ id: 'out-0', label: 'out', portType: 'any' }];
    nodes['t'] = makeRawNode('t', 'transform', { multiplier: 1, offset: 0 });

    connections['c1'] = makeConn('c1', 's', 0, 'bad', 0);
    connections['c2'] = makeConn('c2', 'bad', 0, 't', 0);

    const result = executeGraph(nodes, connections, undefined, undefined, undefined, 'continue');
    // The custom node should have errored
    expect(result.errors.has('bad')).toBe(true);
    // But execution continued: the source should have a result
    expect(result.results.get('s')).toBeDefined();
    // And t should also have run (with empty input from errored bad node)
    expect(result.results.get('t')).toBeDefined();
  });
});

// ============================================================================
// 2. Graph analysis foundations
// ============================================================================
describe('Graph analysis foundations', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('topologicalSort produces correct wave ordering for linear chain', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['a'] = makeRawNode('a', 'source');
    nodes['b'] = makeRawNode('b', 'transform');
    nodes['c'] = makeRawNode('c', 'transform');
    nodes['d'] = makeRawNode('d', 'transform');

    connections['c1'] = makeConn('c1', 'a', 0, 'b', 0);
    connections['c2'] = makeConn('c2', 'b', 0, 'c', 0);
    connections['c3'] = makeConn('c3', 'c', 0, 'd', 0);

    const waves = topologicalSort(nodes, connections);
    // Linear chain = 4 waves, one node each
    expect(waves.length).toBe(4);
    expect(waves[0]).toContain('a');
    expect(waves[1]).toContain('b');
    expect(waves[2]).toContain('c');
    expect(waves[3]).toContain('d');
  });

  it('topologicalSort handles independent subgraphs (multiple roots)', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    // Two independent chains: a->b, c->d
    nodes['a'] = makeRawNode('a', 'source');
    nodes['b'] = makeRawNode('b', 'transform');
    nodes['c'] = makeRawNode('c', 'source');
    nodes['d'] = makeRawNode('d', 'transform');

    connections['c1'] = makeConn('c1', 'a', 0, 'b', 0);
    connections['c2'] = makeConn('c2', 'c', 0, 'd', 0);

    const waves = topologicalSort(nodes, connections);
    // Wave 0 should contain both roots (a, c)
    expect(waves[0].length).toBe(2);
    expect(waves[0]).toContain('a');
    expect(waves[0]).toContain('c');
    // Wave 1 should contain both dependents (b, d)
    expect(waves[1].length).toBe(2);
    expect(waves[1]).toContain('b');
    expect(waves[1]).toContain('d');
  });

  it('getUpstreamPath collects full dependency tree', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    // a -> b -> c -> d
    nodes['a'] = makeRawNode('a', 'source');
    nodes['b'] = makeRawNode('b', 'transform');
    nodes['c'] = makeRawNode('c', 'transform');
    nodes['d'] = makeRawNode('d', 'transform');

    connections['c1'] = makeConn('c1', 'a', 0, 'b', 0);
    connections['c2'] = makeConn('c2', 'b', 0, 'c', 0);
    connections['c3'] = makeConn('c3', 'c', 0, 'd', 0);

    const upstream = getUpstreamPath('d', nodes, connections);
    expect(upstream).toContain('c');
    expect(upstream).toContain('b');
    expect(upstream).toContain('a');
    expect(upstream.length).toBe(3);
    // d itself should NOT be in the upstream list
    expect(upstream).not.toContain('d');
  });

  it('getDownstreamPath collects full dependent tree', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    // a -> b -> c, a -> d
    nodes['a'] = makeRawNode('a', 'source');
    nodes['b'] = makeRawNode('b', 'transform');
    nodes['c'] = makeRawNode('c', 'transform');
    nodes['d'] = makeRawNode('d', 'transform');

    connections['c1'] = makeConn('c1', 'a', 0, 'b', 0);
    connections['c2'] = makeConn('c2', 'b', 0, 'c', 0);
    connections['c3'] = makeConn('c3', 'a', 0, 'd', 0);

    const downstream = getDownstreamPath('a', nodes, connections);
    expect(downstream).toContain('b');
    expect(downstream).toContain('c');
    expect(downstream).toContain('d');
    expect(downstream.length).toBe(3);
    expect(downstream).not.toContain('a');
  });

  it('critical path: longest chain in graph has correct length', () => {
    // a -> b -> c -> d -> e (length 5)
    // f -> g (length 2, independent)
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['a'] = makeRawNode('a', 'source');
    nodes['b'] = makeRawNode('b', 'transform');
    nodes['c'] = makeRawNode('c', 'transform');
    nodes['d'] = makeRawNode('d', 'transform');
    nodes['e'] = makeRawNode('e', 'transform');
    nodes['f'] = makeRawNode('f', 'source');
    nodes['g'] = makeRawNode('g', 'transform');

    connections['c1'] = makeConn('c1', 'a', 0, 'b', 0);
    connections['c2'] = makeConn('c2', 'b', 0, 'c', 0);
    connections['c3'] = makeConn('c3', 'c', 0, 'd', 0);
    connections['c4'] = makeConn('c4', 'd', 0, 'e', 0);
    connections['c5'] = makeConn('c5', 'f', 0, 'g', 0);

    const waves = topologicalSort(nodes, connections);
    // The longest chain has 5 nodes => 5 waves
    expect(waves.length).toBe(5);
    // First wave has roots: a, f
    expect(waves[0]).toContain('a');
    expect(waves[0]).toContain('f');
    // Last wave has only e
    expect(waves[4]).toContain('e');
  });
});

// ============================================================================
// 3. Multi-graph + execution isolation
// ============================================================================
describe('Multi-graph + execution isolation', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('execute graph A, switch to graph B, execute B -> results are independent', () => {
    const store = getStore();
    // Graph A: add a source with value 10
    const srcA = store.addNode('source');
    store.updateNodeData(srcA, 'value', 10);
    store.executeGraph();
    expect(getStore().nodeOutputs[srcA]?.[0]).toBe(10);

    // Create graph B and switch
    const graphB = store.createGraph('Graph B');
    getStore().switchGraph(graphB);

    // Graph B: add a source with value 99
    const srcB = getStore().addNode('source');
    getStore().updateNodeData(srcB, 'value', 99);
    getStore().executeGraph();
    expect(getStore().nodeOutputs[srcB]?.[0]).toBe(99);

    // Switch back to graph A: nodeOutputs should be cleared (execution state is transient)
    getStore().switchGraph('default');
    // Execution state is cleared on switch, so outputs should be empty
    expect(Object.keys(getStore().nodeOutputs).length).toBe(0);
  });

  it('custom node defs are per-graph (def in graph A not visible in graph B)', () => {
    const store = getStore();
    const defId = store.addCustomNodeDef({
      name: 'MyDoubler',
      color: 'orange',
      category: 'Custom',
      inputs: [{ label: 'in', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'in0 * 2',
    });

    expect(getStore().customNodeDefs[defId]).toBeDefined();

    const graphB = getStore().createGraph('Graph B');
    getStore().switchGraph(graphB);

    // Graph B should have no custom node defs
    expect(Object.keys(getStore().customNodeDefs).length).toBe(0);
  });

  it('export graph with execution results -> import preserves graph but clears execution state', () => {
    const store = getStore();
    const srcId = store.addNode('source');
    store.updateNodeData(srcId, 'value', 42);
    store.executeGraph();
    expect(getStore().nodeOutputs[srcId]).toBeDefined();

    const exported = getStore().exportAllGraphs();
    // Verify the export has the graph data
    expect(Object.keys(exported.graphs).length).toBeGreaterThan(0);
    const graphData = exported.graphs[exported.activeGraphId];
    expect(Object.keys(graphData.nodes).length).toBe(1);

    // Import into a fresh store
    resetStore();
    getStore().importAllGraphs(exported);

    // Graph structure should be restored
    const nodeIds = Object.keys(getStore().nodes);
    expect(nodeIds.length).toBe(1);
    // Execution state should be cleared after import
    expect(Object.keys(getStore().nodeOutputs).length).toBe(0);
    expect(Object.keys(getStore().executionStates).length).toBe(0);
  });

  it('checkpoint restore -> execution state cleared', () => {
    const store = getStore();
    const srcId = store.addNode('source');
    store.updateNodeData(srcId, 'value', 42);
    store.executeGraph();
    expect(getStore().nodeOutputs[srcId]).toBeDefined();

    // Create checkpoint capturing the current state (value=42, with execution outputs)
    const cpId = getStore().createCheckpoint('Before change');

    // Modify the value — this pushes undo and may re-execute
    getStore().updateNodeData(srcId, 'value', 100);
    // Execute to populate new outputs
    getStore().executeGraph();
    // Verify execution happened (outputs exist for this node)
    expect(getStore().nodeOutputs[srcId]).toBeDefined();

    // Restore checkpoint — should clear execution state regardless of what value was
    getStore().restoreCheckpoint(cpId);

    // Execution state should be cleared
    expect(Object.keys(getStore().nodeOutputs).length).toBe(0);
    expect(Object.keys(getStore().executionStates).length).toBe(0);
    // Node data should be restored to the checkpoint's value (42)
    expect(getStore().nodes[srcId].data.value).toBe(42);
  });

  it('undo after execution -> execution state cleared (transient state)', () => {
    const store = getStore();
    const srcId = store.addNode('source');
    store.updateNodeData(srcId, 'value', 55);
    store.executeGraph();
    expect(getStore().nodeOutputs[srcId]).toBeDefined();

    // Make a change that triggers undo snapshot
    getStore().updateNodeData(srcId, 'value', 77);

    // Undo
    getStore().undo();

    // Execution state should be cleared by undo
    expect(Object.keys(getStore().nodeOutputs).length).toBe(0);
    expect(Object.keys(getStore().executionErrors).length).toBe(0);
  });
});

// ============================================================================
// 4. Node type coverage regression
// ============================================================================
describe('Node type coverage regression', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('all expected node types are in NODE_TYPE_CONFIG', () => {
    const allTypes: NodeType[] = [
      'source', 'transform', 'filter', 'output',
      'math', 'clamp', 'remap',
      'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt',
      'lerp',
      'concat', 'template',
      'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number',
      'string-concat', 'string-replace', 'string-includes', 'string-template',
      'compare', 'switch',
      'and', 'or', 'not', 'xor',
      'compose-vec3', 'decompose-vec3',
      'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length',
      'mean', 'median', 'stddev', 'min-array', 'max-array',
      'note', 'reroute', 'random', 'display', 'image-preview',
      'timer', 'color-picker', 'color-mix', 'hsl-to-rgb', 'rgb-to-hsl', 'http-fetch',
      'custom',
      'subgraph', 'subgraph-input', 'subgraph-output',
      'create-array', 'get-element', 'set-element', 'array-length', 'array-push', 'array-filter', 'array-map',
      'array-reduce',
      'create-object', 'get-property', 'set-property', 'object-keys', 'object-values', 'merge-objects',
      'if-gate', 'select',
      'get-var', 'set-var',
      'json-parse', 'json-stringify', 'base64-encode', 'base64-decode', 'uri-encode', 'uri-decode',
      'array-slice', 'array-find', 'array-sort', 'array-reverse', 'array-flatten', 'array-zip', 'array-unique',
      'get-timestamp', 'format-date', 'parse-date',
    ];

    for (const type of allTypes) {
      expect(NODE_TYPE_CONFIG[type], `Missing NODE_TYPE_CONFIG entry for "${type}"`).toBeDefined();
    }
    // Verify the total count matches
    expect(Object.keys(NODE_TYPE_CONFIG).length).toBe(allTypes.length);
  });

  it('all node types can be added to the store via addNode', () => {
    const store = getStore();
    const typesToTest: NodeType[] = [
      'source', 'transform', 'filter', 'output', 'math', 'clamp', 'remap',
      'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt', 'lerp',
      'concat', 'template', 'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number',
      'compare', 'switch', 'and', 'or', 'not', 'xor',
      'compose-vec3', 'decompose-vec3', 'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length',
      'mean', 'median', 'stddev', 'min-array', 'max-array',
      'note', 'reroute', 'random', 'display', 'image-preview',
      'timer', 'color-picker', 'color-mix', 'hsl-to-rgb', 'rgb-to-hsl', 'http-fetch',
      'custom', 'subgraph', 'subgraph-input', 'subgraph-output',
      'create-array', 'get-element', 'set-element', 'array-length', 'array-push', 'array-filter', 'array-map',
      'if-gate', 'select',
      'get-var', 'set-var',
    ];

    for (const type of typesToTest) {
      const id = store.addNode(type);
      const node = getStore().nodes[id];
      expect(node, `addNode("${type}") did not create a node`).toBeDefined();
      expect(node.type).toBe(type);
    }

    expect(Object.keys(getStore().nodes).length).toBe(typesToTest.length);
  });

  it('math operations: sin, cos, abs produce correct values when executed', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    nodes['src'] = makeRawNode('src', 'source', { value: Math.PI / 2 });
    nodes['sinN'] = makeRawNode('sinN', 'sin');
    nodes['cosN'] = makeRawNode('cosN', 'cos');
    // For abs, use a negative source
    nodes['negSrc'] = makeRawNode('negSrc', 'source', { value: -7.5 });
    nodes['absN'] = makeRawNode('absN', 'abs');

    connections['c1'] = makeConn('c1', 'src', 0, 'sinN', 0);
    connections['c2'] = makeConn('c2', 'src', 0, 'cosN', 0);
    connections['c3'] = makeConn('c3', 'negSrc', 0, 'absN', 0);

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);

    // sin(PI/2) = 1
    expect(result.results.get('sinN')!.outputs[0]).toBeCloseTo(1, 10);
    // cos(PI/2) = 0
    expect(result.results.get('cosN')!.outputs[0]).toBeCloseTo(0, 10);
    // abs(-7.5) = 7.5
    expect(result.results.get('absN')!.outputs[0]).toBe(7.5);
  });

  it('string operations: string-length, string-case produce correct results', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    // We need a source that outputs a string. Use a 'source' node — but source outputs number.
    // Instead, build raw nodes with injected data via reroute or custom expression.
    // Actually, string-length takes a string input. Without a string source, the disconnected
    // default is '' which has length 0. Let's use a custom node to produce a string.
    nodes['str'] = makeRawNode('str', 'custom', { expression: '"Hello World"', inputCount: 0, outputCount: 1 });
    nodes['str'].inputs = [];
    nodes['str'].outputs = [{ id: 'out-0', label: 'out', portType: 'any' }];

    nodes['len'] = makeRawNode('len', 'string-length');
    nodes['case'] = makeRawNode('case', 'string-case');

    connections['c1'] = makeConn('c1', 'str', 0, 'len', 0);
    connections['c2'] = makeConn('c2', 'str', 0, 'case', 0);

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);

    // "Hello World".length = 11
    expect(result.results.get('len')!.outputs[0]).toBe(11);
    // string-case: output 0 = uppercase, output 1 = lowercase
    expect(result.results.get('case')!.outputs[0]).toBe('HELLO WORLD');
    expect(result.results.get('case')!.outputs[1]).toBe('hello world');
  });
});

// ============================================================================
// 5. Serialization integrity
// ============================================================================
describe('Serialization integrity', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('large graph (50 nodes, 49 connections) survives saveMultiGraph -> loadMultiGraph roundtrip', () => {
    const store = getStore();
    const nodeIds: string[] = [];
    nodeIds.push(store.addNode('source'));
    store.updateNodeData(nodeIds[0], 'value', 123);

    for (let i = 1; i < 50; i++) {
      const id = getStore().addNode('transform');
      nodeIds.push(id);
      getStore().addConnection(nodeIds[i - 1], 0, id, 0);
    }

    expect(Object.keys(getStore().nodes).length).toBe(50);
    expect(Object.keys(getStore().connections).length).toBe(49);

    const exported = getStore().exportAllGraphs();
    // Save and reload
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json);

    // Import into fresh store
    resetStore();
    getStore().importAllGraphs(parsed);

    expect(Object.keys(getStore().nodes).length).toBe(50);
    expect(Object.keys(getStore().connections).length).toBe(49);
  });

  it('graph with custom nodes + defs survives roundtrip', () => {
    const store = getStore();
    const defId = store.addCustomNodeDef({
      name: 'Doubler',
      color: 'teal',
      category: 'Custom',
      inputs: [{ label: 'in', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'in0 * 2',
    });

    const nodeId = getStore().addCustomNode(defId);
    expect(nodeId).not.toBeNull();

    const exported = getStore().exportAllGraphs();
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json);

    resetStore();
    getStore().importAllGraphs(parsed);

    // Custom node def should be restored
    expect(Object.keys(getStore().customNodeDefs).length).toBe(1);
    const restoredDef = Object.values(getStore().customNodeDefs)[0];
    expect(restoredDef.name).toBe('Doubler');
    expect(restoredDef.expression).toBe('in0 * 2');

    // Custom node instance should be restored
    const customNodes = Object.values(getStore().nodes).filter(n => n.type === 'custom');
    expect(customNodes.length).toBe(1);
  });

  it('graph with checkpoints survives roundtrip', () => {
    const store = getStore();
    store.addNode('source');
    const cpId = getStore().createCheckpoint('Test Checkpoint');

    expect(getStore().checkpoints[cpId]).toBeDefined();
    expect(getStore().checkpoints[cpId].label).toBe('Test Checkpoint');

    const exported = getStore().exportAllGraphs();
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json);

    resetStore();
    getStore().importAllGraphs(parsed);

    // Checkpoints should be restored
    const checkpoints = getStore().checkpoints;
    const cpValues = Object.values(checkpoints);
    expect(cpValues.length).toBe(1);
    expect(cpValues[0].label).toBe('Test Checkpoint');
  });

  it('graph with groups (including collapsed) survives roundtrip', () => {
    const store = getStore();
    const n1 = store.addNode('source');
    const n2 = store.addNode('transform');
    getStore().setSelection(new Set([n1, n2]));
    const groupId = getStore().createGroup('My Group');
    expect(groupId).not.toBeNull();

    // Collapse the group
    getStore().toggleGroupCollapse(groupId!);
    expect(getStore().groups[groupId!].collapsed).toBe(true);

    const exported = getStore().exportAllGraphs();
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json);

    resetStore();
    getStore().importAllGraphs(parsed);

    // Group should be restored with collapsed state
    const groups = getStore().groups;
    const groupValues = Object.values(groups);
    expect(groupValues.length).toBe(1);
    expect(groupValues[0].label).toBe('My Group');
    expect(groupValues[0].collapsed).toBe(true);

    // Nodes should be in the group
    const nodesInGroup = Object.values(getStore().nodes).filter(n => n.groupId === groupValues[0].id);
    expect(nodesInGroup.length).toBe(2);
  });

  it('validateGraphData accepts roundtripped data', () => {
    const store = getStore();
    store.addNode('source');
    store.addNode('transform');
    const srcId = Object.keys(getStore().nodes)[0];
    const tgtId = Object.keys(getStore().nodes)[1];
    getStore().addConnection(srcId, 0, tgtId, 0);

    const exported = getStore().exportAllGraphs();
    const graphData = exported.graphs[exported.activeGraphId];

    // validateGraphData should not throw and should not remove valid data
    const nodeCountBefore = Object.keys(graphData.nodes).length;
    const connCountBefore = Object.keys(graphData.connections).length;

    validateGraphData(graphData);

    expect(Object.keys(graphData.nodes).length).toBe(nodeCountBefore);
    expect(Object.keys(graphData.connections).length).toBe(connCountBefore);
  });
});

// ============================================================================
// 6. Connection type system
// ============================================================================
describe('Connection type system', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('number->number connection succeeds', () => {
    const store = getStore();
    const src = store.addNode('source'); // output[0] = number
    const tgt = getStore().addNode('transform'); // input[0] = number

    const connId = getStore().addConnection(src, 0, tgt, 0);
    expect(connId).not.toBeNull();
    expect(getStore().connections[connId!]).toBeDefined();
  });

  it('string->number connection is rejected (addConnection returns null)', () => {
    const store = getStore();
    const src = store.addNode('concat'); // output[0] = string
    const tgt = getStore().addNode('math'); // input[0] = number

    const connId = getStore().addConnection(src, 0, tgt, 0);
    expect(connId).toBeNull();
    expect(Object.keys(getStore().connections).length).toBe(0);
  });

  it('any->number connection succeeds', () => {
    const store = getStore();
    const src = store.addNode('filter'); // output[0] = any
    const tgt = getStore().addNode('transform'); // input[0] = number

    const connId = getStore().addConnection(src, 0, tgt, 0);
    expect(connId).not.toBeNull();
  });

  it('port indices beyond node port count are rejected', () => {
    const store = getStore();
    const src = store.addNode('source'); // 2 outputs (indices 0, 1)
    const tgt = getStore().addNode('transform'); // 2 inputs (indices 0, 1)

    // sourcePortIndex 99 is out of bounds
    const connId1 = getStore().addConnection(src, 99, tgt, 0);
    expect(connId1).toBeNull();

    // targetPortIndex 99 is out of bounds
    const connId2 = getStore().addConnection(src, 0, tgt, 99);
    expect(connId2).toBeNull();
  });

  it('self-connection (node->same node) is rejected', () => {
    const store = getStore();
    // Use a node with both inputs and outputs (transform has 2 inputs, 2 outputs)
    const node = store.addNode('transform');

    const connId = getStore().addConnection(node, 0, node, 0);
    expect(connId).toBeNull();
  });
});

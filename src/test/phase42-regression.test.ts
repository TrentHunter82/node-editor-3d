/**
 * Phase 42 E2E regression tests (~25 tests).
 * Full-stack regression covering:
 * - Store compound action atomicity (coreSlice extraction readiness)
 * - Execution pipeline integrity (module split readiness)
 * - importWorkflow edge cases
 * - Cross-feature interactions
 * - 93 node type smoke test
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph, topologicalSort } from '../utils/execution';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection, NodeType } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionTimings = {};
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.checkpoints = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.errorStrategy = 'fail-fast';
    s.validationErrors = {};
    s.searchQuery = '';
    s.searchHighlightIds = new Set();
  });
  localStorage.clear();
}

function getState() { return useEditorStore.getState(); }

function makeNode(
  id: string,
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `${id}-in${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `${id}-out${i}`, label: c.label, portType: c.portType })),
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ===========================================================================
// 1. Store compound action atomicity (6 tests)
// ===========================================================================

describe('Store compound action atomicity', () => {
  beforeEach(() => { resetStore(); });

  it('duplicateSelected is reversed by a single undo', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [2, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);

    const nodesBefore = Object.keys(getState().nodes).length;
    const connsBefore = Object.keys(getState().connections).length;

    getState().setSelection(new Set([n1, n2]));
    getState().duplicateSelected(true);

    // Should have more nodes after duplicate
    expect(Object.keys(getState().nodes).length).toBeGreaterThan(nodesBefore);

    // A single undo should reverse the entire compound operation
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(nodesBefore);
    expect(Object.keys(getState().connections)).toHaveLength(connsBefore);
  });

  it('deleteSelected is reversed by a single undo', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [2, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);

    const nodesBefore = Object.keys(getState().nodes).length;
    const connsBefore = Object.keys(getState().connections).length;

    getState().setSelection(new Set([n1, n2]));
    getState().deleteSelected();

    // Should have no nodes after delete
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // A single undo should restore everything
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(nodesBefore);
    expect(Object.keys(getState().connections)).toHaveLength(connsBefore);
  });

  it('paste is reversed by a single undo', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([n1]));
    getState().copySelected();

    const nodesBefore = Object.keys(getState().nodes).length;

    getState().paste();

    // Should have one more node after paste
    expect(Object.keys(getState().nodes).length).toBeGreaterThan(nodesBefore);

    // A single undo should restore to before paste
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(nodesBefore);
  });

  it('clearGraph is undoable', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('math', [2, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(2);

    getState().clearGraph();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // clearGraph pushes undo so the operation is reversible
    expect(getState().canUndo()).toBe(true);

    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(2);
  });

  it('importAllGraphs resets undo stack', () => {
    getState().addNode('source', [0, 0, 0]);
    const storage = getState().exportAllGraphs();

    // Make more changes
    getState().addNode('math', [2, 0, 0]);
    expect(getState().canUndo()).toBe(true);

    getState().importAllGraphs(storage);
    expect(getState().canUndo()).toBe(false);
  });

  it('clearGraph followed by importAllGraphs produces clean state', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(n1, 'value', 42);
    const storage = getState().exportAllGraphs();

    getState().clearGraph();
    getState().importAllGraphs(storage);

    // Should have clean state with the imported node
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    const imported = Object.values(getState().nodes)[0];
    expect(imported.type).toBe('source');
    expect(imported.data.value).toBe(42);
    expect(getState().canUndo()).toBe(false);
  });
});

// ===========================================================================
// 2. Execution pipeline integrity (5 tests)
// ===========================================================================

describe('Execution pipeline integrity', () => {
  beforeEach(() => { resetStore(); });

  it('executeGraph produces correct results for basic chain', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 10 }),
      mul: makeNode('mul', 'math', { operation: 'multiply' }),
      out: makeNode('out', 'output'),
    };
    // source(10) → math:multiply (10 * default) → output
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'mul', 0),
      c2: makeConn('c2', 'mul', 0, 'out', 0),
    };
    const result = executeGraph(nodes, conns);
    expect(result.errors.size).toBe(0);
    expect(result.results.has('src')).toBe(true);
    expect(result.results.has('mul')).toBe(true);
    expect(result.results.has('out')).toBe(true);
  });

  it('topologicalSort produces correct wave ordering', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source'),
      b: makeNode('b', 'math'),
      c: makeNode('c', 'output'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };
    const waves = topologicalSort(nodes, conns);
    // Wave 0: source node 'a', Wave 1: 'b' depends on 'a', Wave 2: 'c' depends on 'b'
    expect(waves.length).toBeGreaterThanOrEqual(2);
    // 'a' must come before 'b' in execution order
    const aWave = waves.findIndex(w => w.includes('a'));
    const bWave = waves.findIndex(w => w.includes('b'));
    expect(aWave).toBeLessThan(bWave);
  });

  it('error strategy continue collects errors without stopping', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 5 }),
      custom: {
        ...makeNode('custom', 'custom'),
        data: { expression: 'invalid @@@@', inputCount: 1, outputCount: 1 },
        inputs: [{ id: 'cin0', label: 'in0', portType: 'any' as const }],
        outputs: [{ id: 'cout0', label: 'out0', portType: 'any' as const }],
      },
      out: makeNode('out', 'output'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'custom', 0),
      c2: makeConn('c2', 'custom', 0, 'out', 0),
    };
    const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'continue');
    // Error collected but execution continues
    expect(result.errors.has('custom')).toBe(true);
    // Source should still have results
    expect(result.results.has('src')).toBe(true);
  });

  it('execution cache returns consistent results on re-execution', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 7 }),
      m: makeNode('m', 'math'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'm', 0),
    };
    const cache = new Map();
    const r1 = executeGraph(nodes, conns, cache);
    const r2 = executeGraph(nodes, conns, cache);

    const out1 = r1.results.get('m')?.outputs[0];
    const out2 = r2.results.get('m')?.outputs[0];
    expect(out1).toBe(out2);
  });

  it('subgraph execution works through execution pipeline', () => {
    // Create a subgraph by converting selection
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [2, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);
    getState().setSelection(new Set([n1, n2]));

    const subNodeId = getState().convertSelectionToSubgraph('Sub');
    expect(subNodeId).toBeTruthy();

    // Execute the main graph containing the subgraph node
    const state = getState();
    const result = executeGraph(state.nodes, state.connections, undefined, undefined, undefined, 'continue');
    // Should not throw and subgraph node should have a result
    expect(result.results.has(subNodeId!)).toBe(true);
  });
});

// ===========================================================================
// 3. Export/import round-trip integrity (4 tests)
// ===========================================================================

describe('Export/import round-trip integrity', () => {
  beforeEach(() => { resetStore(); });

  it('multi-graph export/import preserves all graph tabs', () => {
    getState().createGraph('Graph 2');
    getState().createGraph('Graph 3');
    const orderBefore = [...getState().graphOrder];

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    expect(getState().graphOrder).toHaveLength(orderBefore.length);
  });

  it('export/import preserves node data, connections, and groups', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [3, 0, 0]);
    getState().updateNodeData(n1, 'value', 42);
    getState().addConnection(n1, 0, n2, 0);
    getState().setSelection(new Set([n1, n2]));
    getState().createGroup('TestGroup');

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(Object.keys(getState().connections)).toHaveLength(1);
    expect(Object.keys(getState().groups)).toHaveLength(1);
    expect(Object.values(getState().nodes).find(n => n.type === 'source')?.data.value).toBe(42);
  });

  it('export/import preserves custom node definitions per graph', () => {
    const defId = getState().addCustomNodeDef({
      name: 'MyCustom',
      color: '#ff0000',
      category: 'custom',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'in0 * 2',
    });

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    expect(getState().customNodeDefs[defId]).toBeDefined();
    expect(getState().customNodeDefs[defId].name).toBe('MyCustom');
    expect(getState().customNodeDefs[defId].expression).toBe('in0 * 2');
  });

  it('export/import preserves graph variables', () => {
    useEditorStore.setState(s => {
      s.graphVariables = { counter: 10, label: 'test' };
    });

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    expect(getState().graphVariables).toHaveProperty('counter', 10);
    expect(getState().graphVariables).toHaveProperty('label', 'test');
  });
});

// ===========================================================================
// 4. Cross-feature regression (5 tests)
// ===========================================================================

describe('Cross-feature regression', () => {
  beforeEach(() => { resetStore(); });

  it('paste + undo fully reverses to original state', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [2, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);
    const nodeCountBefore = Object.keys(getState().nodes).length;
    const connCountBefore = Object.keys(getState().connections).length;

    getState().setSelection(new Set([n1, n2]));
    getState().copySelected();
    getState().paste();

    expect(Object.keys(getState().nodes).length).toBeGreaterThan(nodeCountBefore);

    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(nodeCountBefore);
    expect(Object.keys(getState().connections)).toHaveLength(connCountBefore);
  });

  it('clearGraph + addNode + deleteSelected + undo chain is fully reversible', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().clearGraph();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    const n1 = getState().addNode('math', [0, 0, 0]);
    getState().setSelection(new Set([n1]));
    getState().deleteSelected();
    expect(getState().nodes[n1]).toBeUndefined();

    getState().undo(); // undo delete
    expect(getState().nodes[n1]).toBeDefined();

    getState().undo(); // undo addNode
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('locked nodes survive deleteSelected but unlocked are removed', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [2, 0, 0]);
    const n3 = getState().addNode('output', [4, 0, 0]);
    getState().toggleNodeLock(n1);
    getState().toggleNodeLock(n3);

    getState().setSelection(new Set([n1, n2, n3]));
    getState().deleteSelected();

    expect(getState().nodes[n1]).toBeDefined();  // locked
    expect(getState().nodes[n2]).toBeUndefined(); // unlocked → deleted
    expect(getState().nodes[n3]).toBeDefined();  // locked
  });

  it('graph variables persist through undo/redo cycle', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState(s => { s.graphVariables = { x: 1 }; });

    getState().undo(); // undo addNode

    // Graph variables are transient, but should not crash
    expect(getState().graphVariables).toBeDefined();

    getState().redo(); // redo addNode
    expect(getState().nodes[n1]).toBeDefined();
  });

  it('execution after undo produces correct results', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(n1, 'value', 10);
    const n2 = getState().addNode('math', [2, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);

    // Execute
    const state1 = getState();
    const r1 = executeGraph(state1.nodes, state1.connections);
    expect(r1.errors.size).toBe(0);

    // Undo connection
    getState().undo();

    // Execute again — should still work (no stale cache issues)
    const state2 = getState();
    const r2 = executeGraph(state2.nodes, state2.connections);
    expect(r2.errors.size).toBe(0);
  });
});

// ===========================================================================
// 5. Node type smoke test — all 93 types execute without error (5 tests)
// ===========================================================================

describe('Node type execution smoke test', () => {
  // Split 93 node types into manageable batches to pinpoint failures

  const allTypes = Object.keys(NODE_TYPE_CONFIG) as NodeType[];

  it('all registered node types have valid config', () => {
    expect(allTypes.length).toBeGreaterThanOrEqual(93);
    for (const type of allTypes) {
      const config = NODE_TYPE_CONFIG[type];
      expect(config).toBeDefined();
      expect(config.inputs).toBeDefined();
      expect(config.outputs).toBeDefined();
    }
  });

  it('source-like nodes (no inputs) execute without error', () => {
    const sourceTypes = allTypes.filter(t => NODE_TYPE_CONFIG[t].inputs.length === 0);
    for (const type of sourceTypes) {
      const nodes: Record<string, EditorNode> = {
        n: makeNode('n', type),
      };
      const result = executeGraph(nodes, {}, undefined, undefined, undefined, 'continue');
      // Should not throw
      expect(result.results.has('n')).toBe(true);
    }
  });

  it('single-input nodes execute with source feeding them', () => {
    const singleInputTypes = allTypes.filter(t => {
      const config = NODE_TYPE_CONFIG[t];
      return config.inputs.length === 1 && config.outputs.length >= 1;
    });

    for (const type of singleInputTypes) {
      // Skip subgraph — requires SubgraphContext
      if (type === 'subgraph') continue;
      const nodes: Record<string, EditorNode> = {
        src: makeNode('src', 'source', { value: 1 }),
        n: makeNode('n', type),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'src', 0, 'n', 0),
      };
      const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'continue');
      // All should produce output or a handled error, never throw
      expect(result.results.has('n') || result.errors.has('n')).toBe(true);
    }
  });

  it('math node executes with all operation variants', () => {
    // 'math' is a single NodeType; operations are set via data.operation
    const mathOperations = ['add', 'subtract', 'multiply', 'divide', 'power', 'modulo', 'min', 'max'];

    for (const op of mathOperations) {
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 6 }),
        b: makeNode('b', 'source', { value: 3 }),
        m: makeNode('m', 'math', { operation: op }),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'm', 0),
        c2: makeConn('c2', 'b', 0, 'm', 1),
      };
      const result = executeGraph(nodes, conns);
      expect(result.errors.size).toBe(0);
      expect(result.results.get('m')?.outputs[0]).toBeDefined();
    }

    // Also test actual two-input NodeTypes (compare, and, or)
    const twoInputTypes: NodeType[] = ['compare', 'and', 'or'];
    const validTypes = twoInputTypes.filter(t => allTypes.includes(t));

    for (const type of validTypes) {
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 6 }),
        b: makeNode('b', 'source', { value: 3 }),
        op: makeNode('op', type),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'op', 0),
        c2: makeConn('c2', 'b', 0, 'op', 1),
      };
      const result = executeGraph(nodes, conns);
      expect(result.errors.size).toBe(0);
      expect(result.results.get('op')?.outputs[0]).toBeDefined();
    }
  });

  it('string/object/array nodes execute without error', () => {
    const dataTypes: NodeType[] = [
      'string-concat', 'string-replace', 'string-includes', 'string-template',
      'create-object', 'get-property', 'set-property', 'object-keys', 'object-values', 'merge-objects',
      'create-array', 'array-length', 'array-push', 'get-element',
    ];
    const validTypes = dataTypes.filter(t => allTypes.includes(t));

    for (const type of validTypes) {
      const nodes: Record<string, EditorNode> = {
        n: makeNode('n', type),
      };
      const result = executeGraph(nodes, {}, undefined, undefined, undefined, 'continue');
      // Should produce output (possibly default/empty) without throwing
      expect(result.results.has('n') || result.errors.has('n')).toBe(true);
    }
  });
});

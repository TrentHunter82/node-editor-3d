import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';
import { executeGraph as execGraph } from '../utils/execution';
import type { EditorNode, Connection, GraphData, SubgraphNodeDef } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  // Reset ALL module-scoped state (inactiveGraphs, undo stacks, clipboard, etc.)
  _resetModuleState();
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
    subgraphDefs: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    showValuePreviews: false,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
    breadcrumbStack: [],
    activeGraphId: 'default',
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    graphOrder: ['default'],
    templates: {},
    storageWarning: null,
  });
}

function getState() {
  return useEditorStore.getState();
}

// ===========================================================================
// createSubgraph
// ===========================================================================
describe('createSubgraph', () => {
  beforeEach(() => { resetStore(); });

  it('creates a subgraph node in the current graph', () => {
    const sgId = getState().createSubgraph('My Subgraph');
    expect(sgId).not.toBeNull();
    expect(getState().nodes[sgId!]).toBeDefined();
    expect(getState().nodes[sgId!].type).toBe('subgraph');
    expect(getState().nodes[sgId!].title).toBe('My Subgraph');
  });

  it('creates a subgraphDef for the node', () => {
    const sgId = getState().createSubgraph('Test')!;
    expect(getState().subgraphDefs[sgId]).toBeDefined();
    expect(getState().subgraphDefs[sgId].name).toBe('Test');
    expect(getState().subgraphDefs[sgId].innerGraphId).toBeTruthy();
    expect(getState().subgraphDefs[sgId].exposedInputs.length).toBe(1);
    expect(getState().subgraphDefs[sgId].exposedOutputs.length).toBe(1);
  });

  it('creates a graph tab for the inner graph', () => {
    const sgId = getState().createSubgraph('Inner')!;
    const def = getState().subgraphDefs[sgId];
    expect(getState().graphTabs[def.innerGraphId]).toBeDefined();
    expect(getState().graphTabs[def.innerGraphId].name).toBe('Inner');
  });

  it('defaults name to "Subgraph" when omitted', () => {
    const sgId = getState().createSubgraph()!;
    expect(getState().nodes[sgId].title).toBe('Subgraph');
  });

  it('selects the new subgraph node', () => {
    const sgId = getState().createSubgraph()!;
    expect(getState().selectedIds.has(sgId)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });

  it('is undoable', () => {
    getState().createSubgraph('Test');
    expect(Object.keys(getState().nodes).length).toBe(1);
    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(0);
    expect(Object.keys(getState().subgraphDefs).length).toBe(0);
  });

  it('subgraph node has input and output ports', () => {
    const sgId = getState().createSubgraph()!;
    const node = getState().nodes[sgId];
    expect(node.inputs.length).toBeGreaterThan(0);
    expect(node.outputs.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// convertSelectionToSubgraph
// ===========================================================================
describe('convertSelectionToSubgraph', () => {
  beforeEach(() => { resetStore(); });

  it('returns null when nothing is selected', () => {
    const result = getState().convertSelectionToSubgraph('Test');
    expect(result).toBeNull();
  });

  it('converts a single node into a subgraph', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const sgId = getState().convertSelectionToSubgraph('Single')!;
    expect(sgId).not.toBeNull();
    // Original node should be gone
    expect(getState().nodes[src]).toBeUndefined();
    // Subgraph node should exist
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().nodes[sgId].type).toBe('subgraph');
  });

  it('converts multi-node selection with internal connections', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(a, 0, b, 0);

    getState().setSelection(new Set([a, b]));
    const sgId = getState().convertSelectionToSubgraph('Chain')!;

    // Both original nodes removed
    expect(getState().nodes[a]).toBeUndefined();
    expect(getState().nodes[b]).toBeUndefined();
    // Subgraph node exists
    expect(getState().nodes[sgId]).toBeDefined();
  });

  it('preserves external connections via subgraph ports', () => {
    const ext1 = getState().addNode('source', [-3, 0, 0]); // external source
    const a = getState().addNode('transform', [0, 0, 0]);   // will be inside subgraph
    const ext2 = getState().addNode('output', [3, 0, 0]);    // external target

    getState().addConnection(ext1, 0, a, 0);
    getState().addConnection(a, 0, ext2, 0);

    getState().setSelection(new Set([a]));
    const sgId = getState().convertSelectionToSubgraph('Middle')!;

    // External nodes still exist
    expect(getState().nodes[ext1]).toBeDefined();
    expect(getState().nodes[ext2]).toBeDefined();

    // Check connections: ext1 → subgraph → ext2
    const conns = Object.values(getState().connections);
    const toSubgraph = conns.filter(c => c.targetNodeId === sgId);
    const fromSubgraph = conns.filter(c => c.sourceNodeId === sgId);
    expect(toSubgraph.length).toBeGreaterThan(0);
    expect(fromSubgraph.length).toBeGreaterThan(0);
  });

  it('refuses to convert subgraph-input or subgraph-output nodes', () => {
    // First create a subgraph and enter it
    const sgId = getState().createSubgraph('Test')!;
    getState().enterSubgraph(sgId);

    // Try to convert the subgraph-input node
    const inputNodes = Object.values(getState().nodes).filter(n => n.type === 'subgraph-input');
    expect(inputNodes.length).toBeGreaterThan(0);

    getState().setSelection(new Set([inputNodes[0].id]));
    const result = getState().convertSelectionToSubgraph('Nested');
    expect(result).toBeNull();

    // Clean up: exit back
    getState().exitSubgraph();
  });

  it('is undoable', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(a, 0, b, 0);

    getState().setSelection(new Set([a, b]));
    getState().convertSelectionToSubgraph('Test');

    // Undo should restore original nodes
    getState().undo();
    expect(getState().nodes[a]).toBeDefined();
    expect(getState().nodes[b]).toBeDefined();
    expect(getState().nodes[a].type).toBe('source');
    expect(getState().nodes[b].type).toBe('transform');
    // Connection should be restored
    const conns = Object.values(getState().connections);
    expect(conns.some(c => c.sourceNodeId === a && c.targetNodeId === b)).toBe(true);
  });

  it('places subgraph node at center of selected nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [10, 0, 10]);
    getState().addConnection(a, 0, b, 0);

    getState().setSelection(new Set([a, b]));
    const sgId = getState().convertSelectionToSubgraph('Center')!;

    expect(getState().nodes[sgId].position[0]).toBe(5); // avg of 0 and 10
    expect(getState().nodes[sgId].position[2]).toBe(5);
  });
});

// ===========================================================================
// enterSubgraph / exitSubgraph
// ===========================================================================
describe('enterSubgraph / exitSubgraph', () => {
  beforeEach(() => { resetStore(); });

  it('enterSubgraph switches to inner graph', () => {
    const sgId = getState().createSubgraph('Test')!;
    const outerGraphId = getState().activeGraphId;

    getState().enterSubgraph(sgId);

    expect(getState().activeGraphId).not.toBe(outerGraphId);
    // Should have subgraph-input and subgraph-output nodes
    const nodeTypes = Object.values(getState().nodes).map(n => n.type);
    expect(nodeTypes).toContain('subgraph-input');
    expect(nodeTypes).toContain('subgraph-output');
  });

  it('enterSubgraph updates breadcrumb stack', () => {
    const sgId = getState().createSubgraph('Test')!;
    expect(getState().breadcrumbStack.length).toBe(0);

    getState().enterSubgraph(sgId);
    expect(getState().breadcrumbStack.length).toBe(1);
    expect(getState().breadcrumbStack[0].subgraphNodeId).toBe(sgId);
  });

  it('exitSubgraph returns to parent graph', () => {
    const sgId = getState().createSubgraph('Test')!;
    const outerGraphId = getState().activeGraphId;

    getState().enterSubgraph(sgId);
    getState().exitSubgraph();

    expect(getState().activeGraphId).toBe(outerGraphId);
    expect(getState().breadcrumbStack.length).toBe(0);
    // Subgraph node should be visible again
    expect(getState().nodes[sgId]).toBeDefined();
  });

  it('exitSubgraph selects the subgraph node on return', () => {
    const sgId = getState().createSubgraph('Test')!;
    getState().enterSubgraph(sgId);
    getState().exitSubgraph();
    expect(getState().selectedIds.has(sgId)).toBe(true);
  });

  it('exitSubgraph is a no-op at top level', () => {
    const outerGraphId = getState().activeGraphId;
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(outerGraphId);
  });

  it('enterSubgraph on non-subgraph node is a no-op', () => {
    const src = getState().addNode('source');
    const beforeGraphId = getState().activeGraphId;
    getState().enterSubgraph(src);
    expect(getState().activeGraphId).toBe(beforeGraphId);
  });

  it('enterSubgraph clears transient state', () => {
    const sgId = getState().createSubgraph('Test')!;
    useEditorStore.setState({
      executionStates: { fake: 'running' },
      contextMenu: { x: 0, y: 0, target: { kind: 'canvas' } },
      interaction: 'box-selecting',
    });

    getState().enterSubgraph(sgId);

    expect(getState().executionStates).toEqual({});
    expect(getState().contextMenu).toBeNull();
    expect(getState().interaction).toBe('idle');
  });

  it('nested subgraph navigation: enter → enter → exit → exit', () => {
    // Create subgraph in main graph
    const sg1 = getState().createSubgraph('Level 1')!;
    const mainGraphId = getState().activeGraphId;

    // Enter level 1
    getState().enterSubgraph(sg1);
    const level1GraphId = getState().activeGraphId;
    expect(getState().breadcrumbStack.length).toBe(1);

    // Create subgraph inside level 1
    const sg2 = getState().createSubgraph('Level 2')!;

    // Enter level 2
    getState().enterSubgraph(sg2);
    expect(getState().breadcrumbStack.length).toBe(2);

    // Exit level 2 → back to level 1
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(level1GraphId);
    expect(getState().breadcrumbStack.length).toBe(1);

    // Exit level 1 → back to main
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(mainGraphId);
    expect(getState().breadcrumbStack.length).toBe(0);
  });
});

// ===========================================================================
// deleteSubgraphNode
// ===========================================================================
describe('deleteSubgraphNode', () => {
  beforeEach(() => { resetStore(); });

  it('deletes subgraph node and its def', () => {
    const sgId = getState().createSubgraph('Test')!;
    getState().deleteSubgraphNode(sgId);

    expect(getState().nodes[sgId]).toBeUndefined();
    expect(getState().subgraphDefs[sgId]).toBeUndefined();
  });

  it('removes connections to/from the subgraph node', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const sgId = getState().createSubgraph('Test')!;
    getState().addConnection(src, 0, sgId, 0);

    const connsBefore = Object.keys(getState().connections).length;
    expect(connsBefore).toBeGreaterThan(0);

    getState().deleteSubgraphNode(sgId);
    const sgConns = Object.values(getState().connections)
      .filter(c => c.sourceNodeId === sgId || c.targetNodeId === sgId);
    expect(sgConns.length).toBe(0);
  });

  it('removes inner graph tab', () => {
    const sgId = getState().createSubgraph('Test')!;
    const def = getState().subgraphDefs[sgId];
    const innerGraphId = def.innerGraphId;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    getState().deleteSubgraphNode(sgId);
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('is undoable', () => {
    const sgId = getState().createSubgraph('Test')!;
    getState().deleteSubgraphNode(sgId);
    expect(getState().nodes[sgId]).toBeUndefined();

    getState().undo();
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().subgraphDefs[sgId]).toBeDefined();
  });

  it('ignores non-subgraph nodes', () => {
    const src = getState().addNode('source');
    getState().deleteSubgraphNode(src);
    // Source node should still exist (not deleted)
    expect(getState().nodes[src]).toBeDefined();
  });
});

// ===========================================================================
// expandSubgraph
// ===========================================================================
describe('expandSubgraph', () => {
  beforeEach(() => { resetStore(); });

  it('expands subgraph: inner nodes appear in parent graph', () => {
    // Build: src → transform, convert to subgraph, then expand
    const src = getState().addNode('source', [0, 0, 0]);
    const trn = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(src, 0, trn, 0);

    getState().setSelection(new Set([src, trn]));
    const sgId = getState().convertSelectionToSubgraph('Expand Test')!;

    // Now expand
    getState().expandSubgraph(sgId);

    // Subgraph node should be gone
    expect(getState().nodes[sgId]).toBeUndefined();
    // Original nodes should be back (by their original IDs since they were deep-copied)
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[trn]).toBeDefined();
  });

  it('restores external connections after expand', () => {
    const ext1 = getState().addNode('source', [-3, 0, 0]);
    const inner = getState().addNode('transform', [0, 0, 0]);
    const ext2 = getState().addNode('output', [3, 0, 0]);

    getState().addConnection(ext1, 0, inner, 0);
    getState().addConnection(inner, 0, ext2, 0);

    getState().setSelection(new Set([inner]));
    const sgId = getState().convertSelectionToSubgraph('Expand Test')!;
    getState().expandSubgraph(sgId);

    // ext1 → inner → ext2 connections should be restored
    const conns = Object.values(getState().connections);
    const ext1ToInner = conns.find(c => c.sourceNodeId === ext1 && c.targetNodeId === inner);
    const innerToExt2 = conns.find(c => c.sourceNodeId === inner && c.targetNodeId === ext2);
    expect(ext1ToInner).toBeDefined();
    expect(innerToExt2).toBeDefined();
  });

  it('is undoable', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const sgId = getState().convertSelectionToSubgraph('Test')!;
    getState().expandSubgraph(sgId);

    getState().undo();
    // Subgraph node should be back
    expect(getState().nodes[sgId]).toBeDefined();
    expect(getState().nodes[sgId].type).toBe('subgraph');
  });

  it('removes subgraphDef and inner graph tab on expand', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const sgId = getState().convertSelectionToSubgraph('Test')!;
    const def = getState().subgraphDefs[sgId];
    const innerGraphId = def.innerGraphId;

    getState().expandSubgraph(sgId);
    expect(getState().subgraphDefs[sgId]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('ignores non-subgraph nodes', () => {
    const src = getState().addNode('source');
    const nodeCount = Object.keys(getState().nodes).length;
    getState().expandSubgraph(src);
    expect(Object.keys(getState().nodes).length).toBe(nodeCount);
  });

  it('selects expanded nodes', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().setSelection(new Set([a, b]));
    const sgId = getState().convertSelectionToSubgraph('Test')!;

    getState().expandSubgraph(sgId);

    // The expanded nodes (a, b) should be selected
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
  });
});

// ===========================================================================
// Subgraph execution
// ===========================================================================
describe('subgraph execution', () => {
  function makeNode(id: string, type: EditorNode['type'], data: Record<string, unknown> = {}): EditorNode {
    const config = NODE_TYPE_CONFIG[type];
    return {
      id, type, position: [0, 0, 0], title: type, data,
      inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
      outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
    };
  }

  function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
    return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
  }

  it('executes a simple subgraph: source → [transform] → output', () => {
    // Inner graph: subgraph-input → transform(x2) → subgraph-output
    const innerGraph: GraphData = {
      nodes: {
        si: {
          id: 'si', type: 'subgraph-input', position: [-3, 0, 0], title: 'Input',
          data: { portIndex: 0 }, inputs: [],
          outputs: [{ id: 'out-0', label: 'value', portType: 'any' }],
        },
        t: makeNode('t', 'transform', { multiplier: 2, offset: 0 }),
        so: {
          id: 'so', type: 'subgraph-output', position: [3, 0, 0], title: 'Output',
          data: { portIndex: 0 },
          inputs: [{ id: 'in-0', label: 'value', portType: 'any' }],
          outputs: [],
        },
      },
      connections: {
        c1: makeConn('c1', 'si', 0, 't', 0),
        c2: makeConn('c2', 't', 0, 'so', 0),
      },
      groups: {},
      customNodeDefs: {},
    };

    // Outer graph: source(5) → subgraph → output
    const subDef: SubgraphNodeDef = {
      id: 'sg',
      name: 'DoubleIt',
      innerGraphId: 'inner-1',
      exposedInputs: [{ portIndex: 0, innerNodeId: 'si' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'so' }],
    };

    const outerNodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 5 }),
      sg: {
        id: 'sg', type: 'subgraph', position: [0, 0, 0], title: 'DoubleIt',
        data: { innerGraphId: 'inner-1', subgraphDefId: 'sg' },
        inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      },
      out: makeNode('out', 'output'),
    };
    const outerConns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
      c2: makeConn('c2', 'sg', 0, 'out', 0),
    };

    const context = {
      subgraphDefs: { sg: subDef },
      getInnerGraph: (id: string) => id === 'inner-1' ? innerGraph : undefined,
    };

    const result = execGraph(outerNodes, outerConns, undefined, context);
    // Source outputs 5, subgraph transforms ×2 = 10
    expect(result.results.get('sg')!.outputs[0]).toBe(10);
  });

  it('recursion depth limit is handled gracefully', () => {
    // Create a subgraph that references itself (infinite recursion)
    const innerGraph: GraphData = {
      nodes: {
        si: {
          id: 'si', type: 'subgraph-input', position: [0, 0, 0], title: 'Input',
          data: { portIndex: 0 }, inputs: [],
          outputs: [{ id: 'out-0', label: 'value', portType: 'any' }],
        },
        // Another subgraph node inside that points back to itself
        sg: {
          id: 'sg', type: 'subgraph', position: [0, 0, 0], title: 'Recursive',
          data: { innerGraphId: 'inner-1', subgraphDefId: 'sg-outer' },
          inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
          outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
        },
        so: {
          id: 'so', type: 'subgraph-output', position: [0, 0, 0], title: 'Output',
          data: { portIndex: 0 },
          inputs: [{ id: 'in-0', label: 'value', portType: 'any' }],
          outputs: [],
        },
      },
      connections: {
        c1: makeConn('c1', 'si', 0, 'sg', 0),
        c2: makeConn('c2', 'sg', 0, 'so', 0),
      },
      groups: {},
      customNodeDefs: {},
    };

    const subDef: SubgraphNodeDef = {
      id: 'sg-outer',
      name: 'Recursive',
      innerGraphId: 'inner-1',
      exposedInputs: [{ portIndex: 0, innerNodeId: 'si' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'so' }],
    };

    const outerNodes: Record<string, EditorNode> = {
      src: makeNode('src', 'source', { value: 1 }),
      sg: {
        id: 'sg', type: 'subgraph', position: [0, 0, 0], title: 'Recursive',
        data: { innerGraphId: 'inner-1', subgraphDefId: 'sg-outer' },
        inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      },
    };
    const outerConns: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'sg', 0),
    };

    const context = {
      subgraphDefs: { 'sg-outer': subDef },
      getInnerGraph: () => innerGraph,
    };

    // Recursion is caught at each nesting level's try/catch in executeGraph.
    // The deepest level captures the error; outer levels complete with empty outputs.
    // Key assertion: execution doesn't crash/hang and completes gracefully.
    const result = execGraph(outerNodes, outerConns, undefined, context);
    expect(result.results).toBeDefined();
    expect(result.waves.length).toBeGreaterThan(0);
    // The outer 'sg' node should have a result entry (possibly with empty outputs)
    expect(result.results.has('sg')).toBe(true);
  });

  it('subgraph with missing def produces error', () => {
    const outerNodes: Record<string, EditorNode> = {
      sg: {
        id: 'sg', type: 'subgraph', position: [0, 0, 0], title: 'Bad',
        data: { innerGraphId: 'missing', subgraphDefId: 'missing-def' },
        inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      },
    };

    const context = {
      subgraphDefs: {},
      getInnerGraph: () => undefined,
    };

    const result = execGraph(outerNodes, {}, undefined, context);
    expect(result.errors.has('sg')).toBe(true);
  });

  it('subgraph with missing inner graph produces error', () => {
    const subDef: SubgraphNodeDef = {
      id: 'sg-def',
      name: 'Missing Graph',
      innerGraphId: 'missing-graph',
      exposedInputs: [],
      exposedOutputs: [],
    };

    const outerNodes: Record<string, EditorNode> = {
      sg: {
        id: 'sg', type: 'subgraph', position: [0, 0, 0], title: 'Bad',
        data: { innerGraphId: 'missing-graph', subgraphDefId: 'sg-def' },
        inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      },
    };

    const context = {
      subgraphDefs: { 'sg-def': subDef },
      getInnerGraph: () => undefined,
    };

    const result = execGraph(outerNodes, {}, undefined, context);
    expect(result.errors.has('sg')).toBe(true);
    expect(result.errors.get('sg')).toContain('Inner graph not found');
  });
});

// ===========================================================================
// Subgraph serialization roundtrip
// ===========================================================================
describe('subgraph serialization', () => {
  beforeEach(() => { resetStore(); });

  it('subgraph node survives export → import cycle', () => {
    const sgId = getState().createSubgraph('Persist Test')!;
    // Access subgraphDefs to ensure it exists before export
    void getState().subgraphDefs[sgId];

    // Export
    const exported = getState().exportAllGraphs();

    // Clear and import
    getState().clearGraph();
    getState().importAllGraphs(exported);

    // Subgraph node and def should be restored
    // (Might be in a different graph state, but importAllGraphs restores the active graph)
    expect(Object.values(getState().nodes).some(n => n.type === 'subgraph')).toBe(true);
  });
});

// ===========================================================================
// Subgraph + undo/redo
// ===========================================================================
describe('subgraph + undo/redo', () => {
  beforeEach(() => { resetStore(); });

  it('convertSelectionToSubgraph then undo restores all original state', () => {
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);

    const nodesBefore = Object.keys(getState().nodes).length;
    const connsBefore = Object.keys(getState().connections).length;

    getState().setSelection(new Set([b])); // only middle node
    getState().convertSelectionToSubgraph('Undo Test');

    getState().undo();

    expect(Object.keys(getState().nodes).length).toBe(nodesBefore);
    expect(Object.keys(getState().connections).length).toBe(connsBefore);
    expect(getState().nodes[b].type).toBe('transform');
  });

  it('undo after entering subgraph only affects inner graph', () => {
    const sgId = getState().createSubgraph('Test')!;
    getState().enterSubgraph(sgId);

    // Add a node inside the subgraph
    const innerNode = getState().addNode('source', [0, 0, 2]);
    expect(getState().nodes[innerNode]).toBeDefined();

    getState().undo();
    // The added inner node should be undone
    expect(getState().nodes[innerNode]).toBeUndefined();

    // Exit back to parent — parent should be unaffected
    getState().exitSubgraph();
    expect(getState().nodes[sgId]).toBeDefined();
  });
});

// ===========================================================================
// Subgraph + templates
// ===========================================================================
describe('subgraph + templates', () => {
  beforeEach(() => { resetStore(); });

  it('can save a subgraph node as template', () => {
    const sgId = getState().createSubgraph('Template Test')!;
    getState().setSelection(new Set([sgId]));
    getState().saveSelectionAsTemplate('My SG Template', 'subgraph');

    const templates = getState().templates;
    expect(Object.keys(templates).length).toBe(1);
    const tpl = Object.values(templates)[0];
    expect(tpl.nodes.some(n => n.type === 'subgraph')).toBe(true);
  });
});

// ===========================================================================
// Custom node deep-copy in duplicate (coverage gap)
// ===========================================================================
describe('custom node deep-copy in duplicate', () => {
  beforeEach(() => { resetStore(); });

  it('duplicated custom node preserves dynamic ports', () => {
    // Create a custom node with 4 inputs
    getState().addCustomNodeDef({
      name: 'Four In',
      color: '#FF0000',
      category: 'custom',
      inputs: [
        { label: 'a', portType: 'number' },
        { label: 'b', portType: 'number' },
        { label: 'c', portType: 'number' },
        { label: 'd', portType: 'number' },
      ],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'in0 + in1 + in2 + in3',
    });

    const customId = getState().addNode('custom', [0, 0, 0]);
    // updateCustomNodePorts to set 4 inputs
    getState().updateCustomNodePorts(customId, 4, 1);

    expect(getState().nodes[customId].inputs.length).toBe(4);

    // Duplicate
    getState().setSelection(new Set([customId]));
    getState().duplicateSelected();

    const newIds = [...getState().selectedIds];
    expect(newIds.length).toBe(1);
    const duped = getState().nodes[newIds[0]];
    // Must preserve all 4 inputs (not regenerate from NODE_TYPE_CONFIG which has 0)
    expect(duped.inputs.length).toBe(4);
    expect(duped.outputs.length).toBe(1);
  });
});

// ===========================================================================
// Drag undo coverage (pushUndoSnapshot before updateNodePosition)
// ===========================================================================
describe('drag undo', () => {
  beforeEach(() => { resetStore(); });

  it('pushUndoSnapshot then updateNodePosition creates undoable move', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().pushUndoSnapshot();
    getState().updateNodePosition(id, [5, 0, 5]);
    expect(getState().nodes[id].position).toEqual([5, 0, 5]);

    getState().undo();
    expect(getState().nodes[id].position).toEqual([0, 0, 0]);
  });

  it('multiple position updates after single pushUndo create single undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().pushUndoSnapshot();
    getState().updateNodePosition(id, [1, 0, 0]);
    getState().updateNodePosition(id, [2, 0, 0]);
    getState().updateNodePosition(id, [3, 0, 0]);

    getState().undo();
    expect(getState().nodes[id].position).toEqual([0, 0, 0]);
  });
});

// ===========================================================================
// subgraph-input/output nodes cannot be deleted
// ===========================================================================
describe('subgraph boundary node protection', () => {
  beforeEach(() => { resetStore(); });

  it('removeNode refuses to delete subgraph-input nodes', () => {
    const sgId = getState().createSubgraph('Test')!;
    getState().enterSubgraph(sgId);

    const inputNode = Object.values(getState().nodes).find(n => n.type === 'subgraph-input');
    expect(inputNode).toBeDefined();

    getState().removeNode(inputNode!.id);
    // Should still exist (guarded)
    expect(getState().nodes[inputNode!.id]).toBeDefined();

    getState().exitSubgraph();
  });

  it('removeNode refuses to delete subgraph-output nodes', () => {
    const sgId = getState().createSubgraph('Test')!;
    getState().enterSubgraph(sgId);

    const outputNode = Object.values(getState().nodes).find(n => n.type === 'subgraph-output');
    expect(outputNode).toBeDefined();

    getState().removeNode(outputNode!.id);
    // Should still exist (guarded)
    expect(getState().nodes[outputNode!.id]).toBeDefined();

    getState().exitSubgraph();
  });

  it('deleteSelected skips subgraph-input/output nodes', () => {
    const sgId = getState().createSubgraph('Test')!;
    getState().enterSubgraph(sgId);

    // Select all nodes (including boundary nodes)
    const allIds = new Set(Object.keys(getState().nodes));
    getState().setSelection(allIds);
    getState().deleteSelected();

    // Boundary nodes should survive
    const remaining = Object.values(getState().nodes);
    expect(remaining.some(n => n.type === 'subgraph-input')).toBe(true);
    expect(remaining.some(n => n.type === 'subgraph-output')).toBe(true);

    getState().exitSubgraph();
  });
});

describe('deleteSelected cascade for subgraph nodes', () => {
  beforeEach(() => resetStore());

  it('deleteSelected on a subgraph node removes def and inner graph tab', () => {
    const sgId = getState().createSubgraph('CascadeTest');
    expect(sgId).toBeTruthy();

    const innerGraphId = getState().nodes[sgId!].data.innerGraphId as string;
    expect(getState().subgraphDefs[sgId!]).toBeDefined();
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Select just the subgraph node and delete
    useEditorStore.setState({ selectedIds: new Set([sgId!]) });
    getState().deleteSelected();

    const after = getState();
    expect(after.nodes[sgId!]).toBeUndefined();
    expect(after.subgraphDefs[sgId!]).toBeUndefined();
    expect(after.graphTabs[innerGraphId]).toBeUndefined();
  });

  it('deleteSelected preserves non-selected subgraph nodes', () => {
    const sg1 = getState().createSubgraph('Keep');
    const sg2 = getState().createSubgraph('Delete');

    // Select only sg2
    useEditorStore.setState({ selectedIds: new Set([sg2!]) });
    getState().deleteSelected();

    const after = getState();
    expect(after.nodes[sg1!]).toBeDefined();
    expect(after.subgraphDefs[sg1!]).toBeDefined();
    expect(after.nodes[sg2!]).toBeUndefined();
    expect(after.subgraphDefs[sg2!]).toBeUndefined();
  });

  it('deleteSelected cascade is undoable (nodes and defs restored)', () => {
    const sgId = getState().createSubgraph('UndoCascade');

    useEditorStore.setState({ selectedIds: new Set([sgId!]) });
    getState().deleteSelected();

    expect(getState().nodes[sgId!]).toBeUndefined();

    getState().undo();

    const after = getState();
    expect(after.nodes[sgId!]).toBeDefined();
    expect(after.subgraphDefs[sgId!]).toBeDefined();
    // Note: graphTabs is not in Snapshot, so inner graph tab is NOT restored by undo
  });
});

describe('subgraphDefs persistence across graph switches', () => {
  beforeEach(() => resetStore());

  it('subgraphDefs survive switch to another graph and back', () => {
    const sgId = getState().createSubgraph('Persistent');
    const defBefore = getState().subgraphDefs[sgId!];
    expect(defBefore).toBeDefined();

    // Create a second graph and switch to it
    const secondId = getState().createGraph('Second');
    getState().switchGraph(secondId);

    // Switch back to default
    getState().switchGraph('default');

    const defAfter = getState().subgraphDefs[sgId!];
    expect(defAfter).toBeDefined();
    expect(defAfter.name).toBe('Persistent');
  });

  it('entering subgraph preserves defs in parent graph data', () => {
    const sgId = getState().createSubgraph('EnterPersist');

    getState().enterSubgraph(sgId!);
    // While inside, def should still be accessible when we exit
    getState().exitSubgraph();

    expect(getState().subgraphDefs[sgId!]).toBeDefined();
    expect(getState().subgraphDefs[sgId!].name).toBe('EnterPersist');
  });
});

describe('subgraph round-trip: create → enter → add nodes → exit → execute', () => {
  beforeEach(() => resetStore());

  it('full round-trip workflow', () => {
    // 1. Create outer source node
    getState().addNode('source', [0, 0, 0]);
    const srcId = Object.keys(getState().nodes)[0];
    useEditorStore.setState(s => { s.nodes[srcId].data.value = 42; });

    // 2. Create a subgraph
    const sgId = getState().createSubgraph('RoundTrip');
    expect(sgId).toBeTruthy();

    // 3. Connect source to subgraph input
    getState().addConnection(srcId, 0, sgId!, 0);

    // 4. Enter the subgraph
    getState().enterSubgraph(sgId!);

    // 5. Add a transform node inside
    getState().addNode('transform', [2, 0, 0]);
    const innerNodes = getState().nodes;
    const inputNode = Object.values(innerNodes).find(n => n.type === 'subgraph-input');
    const transformNode = Object.values(innerNodes).find(n => n.type === 'transform');
    const outputNode = Object.values(innerNodes).find(n => n.type === 'subgraph-output');

    expect(inputNode).toBeDefined();
    expect(transformNode).toBeDefined();
    expect(outputNode).toBeDefined();

    // 6. Wire: input → transform → output
    getState().addConnection(inputNode!.id, 0, transformNode!.id, 0);
    getState().addConnection(transformNode!.id, 0, outputNode!.id, 0);

    // 7. Exit back to parent
    getState().exitSubgraph();

    // Verify we're back in default graph
    expect(getState().activeGraphId).toBe('default');
    expect(getState().nodes[sgId!]).toBeDefined();
    expect(getState().nodes[srcId]).toBeDefined();
  });
});

// ===========================================================================
// Nested subgraph execution from an ancestor level (regression)
// ===========================================================================
describe('nested subgraph execution from the top level', () => {
  beforeEach(() => { resetStore(); });

  it('resolves defs stored on inner GraphData when executing from the parent', () => {
    // source(42) → [Outer [Nested [source]]] → output, executed from the top.
    // Nested defs live on the inner graph's GraphData (not the active graph's
    // subgraphDefs) — execution must merge them when recursing.
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    const out = getState().addNode('output', [5, 0, 0]);
    getState().addConnection(src, 0, out, 0);
    getState().setSelection(new Set([src]));
    const sgId = getState().convertSelectionToSubgraph('Outer')!;

    getState().enterSubgraph(sgId);
    const innerSrc = Object.values(getState().nodes).find(n => n.type === 'source')!;
    getState().setSelection(new Set([innerSrc.id]));
    getState().convertSelectionToSubgraph('Nested');
    getState().exitSubgraph();

    getState().executeGraph();
    expect(Object.keys(getState().executionErrors)).toEqual([]);
    expect(getState().nodeOutputs[sgId][0]).toBe(42);
  });
});

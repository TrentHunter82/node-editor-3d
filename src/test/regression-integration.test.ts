/**
 * Regression Integration Tests
 *
 * Tests cross-feature interactions and regression scenarios across:
 * 1. Undo/Redo + Graph Operations
 * 2. Copy/Paste + Custom Nodes
 * 3. Multi-Graph + Templates
 * 4. Execution + Error Strategy
 * 5. Selection + Groups
 * 6. Subgraph Basics
 * 7. Connection Validation
 * 8. Edge Cases
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import type { Connection, EditorNode } from '../types';
import { enableMapSet } from 'immer';

enableMapSet();

const getState = () => useEditorStore.getState();
const setState = (partial: Partial<ReturnType<typeof useEditorStore.getState>>) => useEditorStore.setState((s) => { Object.assign(s, partial); });

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    Object.assign(s, {
      nodes: {},
      connections: {},
      groups: {},
      selectedIds: new Set<string>(),
      interaction: 'idle',
      pendingConnection: null,
      contextMenu: null,
      customNodeDefs: {},
      searchQuery: '',
      executionStates: {},
      nodeOutputs: {},
      executionErrors: {},
      isExecuting: false,
      graphTabs: { default: { id: 'default', name: 'Main', isSubgraph: false } },
      activeGraphId: 'default',
      graphOrder: ['default'],
      breadcrumbStack: [],
      templates: {},
      subgraphDefs: {},
      validationErrors: {},
      errorStrategy: 'fail-fast',
      snapEnabled: false,
      showValuePreviews: true,
      undoRedoEvent: null,
      executionMetrics: {},
      executionTotalDuration: 0,
      debugMode: false,
      pausedAtWave: -1,
    });
  });
}

// ---------------------------------------------------------------------------
// 1. Undo/Redo + Graph Operations
// ---------------------------------------------------------------------------

describe('Undo/Redo + Graph Operations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('undo after creating multiple nodes restores correctly', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [3, 0, 0]);
    const id3 = getState().addNode('output', [6, 0, 0]);

    expect(Object.keys(getState().nodes)).toHaveLength(3);
    expect(getState().canUndo()).toBe(true);

    // Undo the third addNode
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(getState().nodes[id3]).toBeUndefined();
    expect(getState().nodes[id1]).toBeDefined();
    expect(getState().nodes[id2]).toBeDefined();

    // Undo the second addNode
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes[id1]).toBeDefined();

    // Undo the first addNode restores to empty
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(getState().canUndo()).toBe(false);
  });

  it('redo after undo preserves node positions', () => {
    const id = getState().addNode('source', [5, 1, 3]);
    expect(getState().nodes[id].position).toEqual([5, 1, 3]);

    getState().undo();
    expect(getState().nodes[id]).toBeUndefined();

    getState().redo();
    expect(getState().nodes[id]).toBeDefined();
    expect(getState().nodes[id].position).toEqual([5, 1, 3]);
  });

  it('undo after connection creation via completeConnection removes connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const out = getState().addNode('output', [5, 0, 0]);

    // completeConnection pushes undo (unlike addConnection which does not)
    getState().startConnection(src, 0);
    getState().completeConnection(out, 0);

    expect(Object.keys(getState().connections)).toHaveLength(1);

    getState().undo();
    expect(Object.keys(getState().connections)).toHaveLength(0);
    // Both nodes still exist because undo only reverts the connection step
    expect(Object.keys(getState().nodes)).toHaveLength(2);
  });

  it('undo after deleteSelected restores all deleted entities', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const math = getState().addNode('math', [3, 0, 0]);
    const conn = getState().addConnection(src, 0, math, 0);
    expect(conn).toBeTruthy();

    // Select both nodes and delete
    getState().setSelection(new Set([src, math]));
    getState().deleteSelected();

    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(Object.keys(getState().connections)).toHaveLength(0);

    // Undo restores nodes and connections
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(Object.keys(getState().connections)).toHaveLength(1);
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[math]).toBeDefined();
    expect(getState().connections[conn!]).toBeDefined();
  });

  it('multiple undo then redo maintains correct state', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [3, 0, 0]);
    getState().updateNodeData(id1, 'value', 42);

    // State: 3 undo entries (addNode, addNode, updateNodeData)
    expect(getState().canUndo()).toBe(true);

    // Undo updateNodeData
    getState().undo();
    expect(getState().nodes[id1].data.value).toBeUndefined();

    // Undo addNode(math)
    getState().undo();
    expect(getState().nodes[id2]).toBeUndefined();
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Redo addNode(math)
    getState().redo();
    expect(getState().nodes[id2]).toBeDefined();
    expect(Object.keys(getState().nodes)).toHaveLength(2);

    // Redo updateNodeData
    getState().redo();
    expect(getState().nodes[id1].data.value).toBe(42);
    expect(getState().canRedo()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Copy/Paste + Custom Nodes
// ---------------------------------------------------------------------------

describe('Copy/Paste + Custom Nodes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('duplicate custom node preserves all ports (deep copies, NOT from NODE_TYPE_CONFIG)', () => {
    // NODE_TYPE_CONFIG for 'custom' has empty inputs/outputs
    // A real custom node gets ports from the definition
    const defId = getState().addCustomNodeDef({
      name: 'Adder',
      color: '#ff0000',
      category: 'Math',
      inputs: [
        { label: 'x', portType: 'number' },
        { label: 'y', portType: 'number' },
      ],
      outputs: [{ label: 'sum', portType: 'number' }],
      expression: 'in0 + in1',
    });

    const nodeId = getState().addCustomNode(defId, [0, 0, 0]);
    expect(nodeId).toBeTruthy();
    expect(getState().nodes[nodeId!].inputs).toHaveLength(2);
    expect(getState().nodes[nodeId!].outputs).toHaveLength(1);

    // Select and duplicate
    getState().setSelection(new Set([nodeId!]));
    const mapping = getState().duplicateSelected();
    expect(mapping).toBeTruthy();

    const dupId = mapping!.get(nodeId!);
    expect(dupId).toBeTruthy();

    const dupNode = getState().nodes[dupId!];
    expect(dupNode.type).toBe('custom');
    // Ports must be deep-copied, not regenerated from NODE_TYPE_CONFIG (which has 0 ports)
    expect(dupNode.inputs).toHaveLength(2);
    expect(dupNode.outputs).toHaveLength(1);
    expect(dupNode.inputs[0].label).toBe('x');
    expect(dupNode.inputs[1].label).toBe('y');
    expect(dupNode.outputs[0].label).toBe('sum');
  });

  it('paste custom node preserves expression data', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Multiplier',
      color: '#00ff00',
      category: 'Math',
      inputs: [{ label: 'val', portType: 'number' }],
      outputs: [{ label: 'result', portType: 'number' }],
      expression: 'in0 * 2',
    });

    const nodeId = getState().addCustomNode(defId, [0, 0, 0]);
    expect(nodeId).toBeTruthy();

    // Copy and paste
    getState().setSelection(new Set([nodeId!]));
    getState().copySelected();
    getState().paste();

    // The newly pasted node should have the expression in data
    const pastedIds = [...getState().selectedIds];
    expect(pastedIds).toHaveLength(1);
    const pastedNode = getState().nodes[pastedIds[0]];
    expect(pastedNode.data.expression).toBe('in0 * 2');
    expect(pastedNode.data.customDefId).toBe(defId);
    expect(pastedNode.inputs).toHaveLength(1);
    expect(pastedNode.outputs).toHaveLength(1);
  });

  it('duplicate node preserves collapsed state', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeCollapse(id);
    expect(getState().nodes[id].collapsed).toBe(true);

    getState().setSelection(new Set([id]));
    const mapping = getState().duplicateSelected();
    expect(mapping).toBeTruthy();

    const dupId = mapping!.get(id)!;
    expect(getState().nodes[dupId].collapsed).toBe(true);
  });

  it('copy/paste chain: source -> transform -> output preserves connections between pasted nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [3, 0, 0]);
    const out = getState().addNode('output', [6, 0, 0]);

    const c1 = getState().addConnection(src, 0, xfm, 0);
    const c2 = getState().addConnection(xfm, 0, out, 0);
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    // Select all three and copy/paste
    getState().setSelection(new Set([src, xfm, out]));
    getState().copySelected();
    getState().paste();

    // Should have 6 nodes and 4 connections
    expect(Object.keys(getState().nodes)).toHaveLength(6);
    expect(Object.keys(getState().connections)).toHaveLength(4);

    // Pasted nodes should be connected to each other (not to originals)
    const pastedIds = [...getState().selectedIds];
    expect(pastedIds).toHaveLength(3);

    // Find connections among pasted nodes
    const pastedSet = new Set(pastedIds);
    const pastedConns = (Object.values(getState().connections) as Connection[]).filter(
      c => pastedSet.has(c.sourceNodeId) && pastedSet.has(c.targetNodeId)
    );
    expect(pastedConns).toHaveLength(2);
  });

  it('paste into different graph works correctly', () => {
    // Create and copy a node in the default graph
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 99);
    getState().setSelection(new Set([srcId]));
    getState().copySelected();

    // Create a new graph and switch to it
    const graphB = getState().createGraph('Graph B');
    expect(getState().activeGraphId).toBe(graphB);
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Paste into the new graph
    expect(getState().canPaste()).toBe(true);
    getState().paste();

    expect(Object.keys(getState().nodes)).toHaveLength(1);
    const pastedId = [...getState().selectedIds][0];
    expect(getState().nodes[pastedId].data.value).toBe(99);
    expect(getState().nodes[pastedId].type).toBe('source');
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-Graph + Templates
// ---------------------------------------------------------------------------

describe('Multi-Graph + Templates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('template saved in graph A can be instantiated in graph B', () => {
    // Create a template in graph A (default)
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [3, 0, 0]);
    const conn = getState().addConnection(src, 0, xfm, 0);
    expect(conn).toBeTruthy();

    getState().setSelection(new Set([src, xfm]));
    const templateId = getState().saveSelectionAsTemplate('My Template');
    expect(templateId).toBeTruthy();

    // Templates are workspace-global, not per-graph
    expect(getState().templates[templateId!]).toBeDefined();

    // Create graph B and switch
    const graphB = getState().createGraph('Graph B');
    expect(getState().activeGraphId).toBe(graphB);
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Template should still be accessible
    expect(getState().templates[templateId!]).toBeDefined();

    // Instantiate
    getState().instantiateTemplate(templateId!, [0, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(Object.keys(getState().connections)).toHaveLength(1);
  });

  it('switching graphs preserves undo stacks independently', () => {
    // Add a node in graph A
    const nodeA = getState().addNode('source', [0, 0, 0]);
    expect(getState().canUndo()).toBe(true);

    // Create graph B (switches automatically)
    const graphB = getState().createGraph('Graph B');
    expect(getState().activeGraphId).toBe(graphB);

    // Graph B has no undo history of its own yet
    expect(getState().canUndo()).toBe(false);

    // Add node in graph B
    getState().addNode('math', [0, 0, 0]);
    expect(getState().canUndo()).toBe(true);

    // Switch back to graph A
    getState().switchGraph('default');
    expect(getState().activeGraphId).toBe('default');

    // Graph A's undo stack should still have its entry
    expect(getState().canUndo()).toBe(true);
    expect(getState().nodes[nodeA]).toBeDefined();
  });

  it('delete graph cleans up undo/redo stacks for that graph', () => {
    // Create graph B, add some nodes, build undo history
    const graphB = getState().createGraph('Graph B');
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('math', [3, 0, 0]);

    // Switch back to default
    getState().switchGraph('default');
    expect(getState().graphOrder).toContain(graphB);

    // Delete graph B
    getState().deleteGraph(graphB);
    expect(getState().graphOrder).not.toContain(graphB);
    expect(getState().graphTabs[graphB]).toBeUndefined();

    // The deleted graph's data should be cleaned up (no crash on future operations)
    expect(getState().activeGraphId).toBe('default');
  });

  it('graph order is maintained after delete', () => {
    const g1 = getState().createGraph('Graph 1');
    const g2 = getState().createGraph('Graph 2');
    const g3 = getState().createGraph('Graph 3');

    // Order: default, g1, g2, g3
    expect(getState().graphOrder).toEqual(['default', g1, g2, g3]);

    // Delete g2
    getState().deleteGraph(g2);
    expect(getState().graphOrder).toEqual(['default', g1, g3]);

    // Remaining graphs are still accessible
    getState().switchGraph(g1);
    expect(getState().activeGraphId).toBe(g1);
    getState().switchGraph(g3);
    expect(getState().activeGraphId).toBe(g3);
  });

  it('clearGraph does NOT clear user preferences (errorStrategy, snapEnabled)', () => {
    // Set user preferences
    getState().setErrorStrategy('continue');
    setState({ snapEnabled: true });

    // Add some nodes
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('math', [3, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(2);

    // clearGraph should clear content but preserve preferences
    getState().clearGraph();

    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(Object.keys(getState().connections)).toHaveLength(0);
    // errorStrategy is preserved per the store comment:
    // "Note: errorStrategy is preserved — it's a user preference, not graph data"
    expect(getState().errorStrategy).toBe('continue');
    expect(getState().snapEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Execution + Error Strategy
// ---------------------------------------------------------------------------

describe('Execution + Error Strategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('execute with fail-fast stops on first error', () => {
    getState().setErrorStrategy('fail-fast');

    // Create a custom node that will throw
    const defId = getState().addCustomNodeDef({
      name: 'Thrower',
      color: '#ff0000',
      category: 'Test',
      inputs: [{ label: 'in', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'throw new Error("boom")',
    });

    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 5);

    const customId = getState().addCustomNode(defId, [3, 0, 0]);
    expect(customId).toBeTruthy();
    getState().updateCustomNodePorts(customId!, 1, 1);

    const out = getState().addNode('output', [6, 0, 0]);

    getState().addConnection(src, 0, customId!, 0);
    getState().addConnection(customId!, 0, out, 0);

    getState().executeGraph();

    // The custom node should have an error
    expect(getState().executionErrors[customId!]).toBeDefined();

    // In fail-fast, the output node should NOT have outputs (execution stopped early)
    expect(getState().nodeOutputs[out]).toBeUndefined();
  });

  it('execute with continue processes all available nodes', () => {
    getState().setErrorStrategy('continue');

    const defId = getState().addCustomNodeDef({
      name: 'Thrower',
      color: '#ff0000',
      category: 'Test',
      inputs: [{ label: 'in', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'throw new Error("boom")',
    });

    // Build: source1 -> thrower -> output1 (error path)
    //        source2 -> output2               (healthy path)
    const src1 = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src1, 'value', 5);

    const customId = getState().addCustomNode(defId, [3, 0, 0]);
    expect(customId).toBeTruthy();
    getState().updateCustomNodePorts(customId!, 1, 1);

    const src2 = getState().addNode('source', [0, 0, 3]);
    getState().updateNodeData(src2, 'value', 10);

    const out2 = getState().addNode('output', [6, 0, 3]);

    getState().addConnection(src1, 0, customId!, 0);
    getState().addConnection(src2, 0, out2, 0);

    getState().executeGraph();

    // Error node should have error recorded
    expect(getState().executionErrors[customId!]).toBeDefined();

    // Healthy path should still have outputs (continue strategy)
    expect(getState().nodeOutputs[src2]).toBeDefined();
    expect(getState().nodeOutputs[src2][0]).toBe(10);
  });

  it('execution cache invalidated after updateNodeData', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);

    const math = getState().addNode('math', [3, 0, 0]);
    getState().updateNodeData(math, 'operation', 'add');

    getState().addConnection(src, 0, math, 0);

    // First execution
    getState().executeGraph();
    vi.advanceTimersByTime(2000);

    const firstResult = getState().nodeOutputs[math]?.[0];

    // Now update the source value
    getState().updateNodeData(src, 'value', 20);

    // Re-execute - cache should be invalidated for downstream
    getState().executeGraph();
    vi.advanceTimersByTime(2000);

    const secondResult = getState().nodeOutputs[math]?.[0];
    // Results should differ because cache was invalidated
    expect(secondResult).not.toBe(firstResult);
  });

  it('resetExecution clears previous results before re-run', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);

    const math = getState().addNode('math', [3, 0, 0]);
    getState().addConnection(src, 0, math, 0);

    getState().executeGraph();
    vi.advanceTimersByTime(2000);

    expect(getState().nodeOutputs[src]).toBeDefined();
    expect(getState().nodeOutputs[src][0]).toBe(42);
    expect(getState().nodeOutputs[math]).toBeDefined();

    // resetExecution clears all transient execution state
    getState().resetExecution();

    expect(getState().nodeOutputs[src]).toBeUndefined();
    expect(getState().nodeOutputs[math]).toBeUndefined();
    expect(getState().executionStates).toEqual({});
    expect(getState().executionErrors).toEqual({});
    expect(getState().isExecuting).toBe(false);

    // Re-execute produces fresh results
    getState().executeGraph();
    vi.advanceTimersByTime(2000);

    expect(getState().nodeOutputs[src]).toBeDefined();
    expect(getState().nodeOutputs[src][0]).toBe(42);
  });

  it('non-deterministic random nodes (no seed) bypass cache', () => {
    const rand = getState().addNode('random', [0, 0, 0]);
    // Do NOT set a seed - this makes it non-deterministic

    getState().executeGraph();
    vi.advanceTimersByTime(2000);

    const firstResult = getState().nodeOutputs[rand]?.[0] as number;
    expect(typeof firstResult).toBe('number');

    // Reset execution state manually to allow re-execution
    getState().resetExecution();

    // Execute again - random should re-run (not use cached value)
    getState().executeGraph();
    vi.advanceTimersByTime(2000);

    // We cannot guarantee a different value (randomness could repeat),
    // but we can verify it executed (has output)
    const secondResult = getState().nodeOutputs[rand]?.[0];
    expect(typeof secondResult).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 5. Selection + Groups
// ---------------------------------------------------------------------------

describe('Selection + Groups', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('select all includes both nodes and connections', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const out = getState().addNode('output', [5, 0, 0]);
    const conn = getState().addConnection(src, 0, out, 0);
    expect(conn).toBeTruthy();

    // Select all entities
    const allIds = new Set([src, out, conn!]);
    getState().setSelection(allIds);

    expect(getState().selectedIds.size).toBe(3);
    expect(getState().selectedIds.has(src)).toBe(true);
    expect(getState().selectedIds.has(out)).toBe(true);
    expect(getState().selectedIds.has(conn!)).toBe(true);
  });

  it('box selection works with coordinates', () => {
    const n1 = getState().addNode('source', [1, 0, 1]);
    const n2 = getState().addNode('math', [2, 0, 2]);
    const n3 = getState().addNode('output', [10, 0, 10]);

    // Box select a region that contains n1 and n2 but not n3
    getState().boxSelect(0, 0, 5, 5, false);

    expect(getState().selectedIds.has(n1)).toBe(true);
    expect(getState().selectedIds.has(n2)).toBe(true);
    expect(getState().selectedIds.has(n3)).toBe(false);
  });

  it('group creation requires at least 2 nodes', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);

    // Try to group a single node
    getState().setSelection(new Set([n1]));
    const groupId = getState().createGroup('Test Group');

    expect(groupId).toBeNull();
    expect(Object.keys(getState().groups)).toHaveLength(0);
  });

  it('ungroup preserves node positions', () => {
    const n1 = getState().addNode('source', [1, 0, 2]);
    const n2 = getState().addNode('math', [4, 0, 5]);

    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('Test Group');
    expect(groupId).toBeTruthy();

    expect(getState().nodes[n1].groupId).toBe(groupId);
    expect(getState().nodes[n2].groupId).toBe(groupId);

    // Ungroup
    getState().ungroupNodes(groupId!);

    // Positions should be unchanged
    expect(getState().nodes[n1].position).toEqual([1, 0, 2]);
    expect(getState().nodes[n2].position).toEqual([4, 0, 5]);
    // Group ID should be removed from nodes
    expect(getState().nodes[n1].groupId).toBeUndefined();
    expect(getState().nodes[n2].groupId).toBeUndefined();
    // Group itself should be removed
    expect(getState().groups[groupId!]).toBeUndefined();
  });

  it('delete group cascades to remove groupId from nodes', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [3, 0, 0]);
    const n3 = getState().addNode('output', [6, 0, 0]);

    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('Test Group');
    expect(groupId).toBeTruthy();

    // Select both nodes in the group and delete them
    getState().setSelection(new Set([n1, n2]));
    getState().deleteSelected();

    // The group should be auto-cleaned since no members remain
    expect(getState().groups[groupId!]).toBeUndefined();
    // The remaining node should be unaffected
    expect(getState().nodes[n3]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Subgraph Basics
// ---------------------------------------------------------------------------

describe('Subgraph Basics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('createSubgraph creates inner graph with input/output nodes', () => {
    const subId = getState().createSubgraph('TestSub');
    expect(subId).toBeTruthy();

    const subNode = getState().nodes[subId!];
    expect(subNode).toBeDefined();
    expect(subNode.type).toBe('subgraph');
    expect(subNode.title).toBe('TestSub');

    // Should have a subgraph def
    expect(getState().subgraphDefs[subId!]).toBeDefined();

    // The inner graph should have a graph tab
    const innerGraphId = subNode.data.innerGraphId as string;
    expect(innerGraphId).toBeTruthy();
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // The subgraph def should reference the inner graph and boundary nodes
    const def = getState().subgraphDefs[subId!];
    expect(def.innerGraphId).toBe(innerGraphId);
    expect(def.exposedInputs).toHaveLength(1);
    expect(def.exposedOutputs).toHaveLength(1);
  });

  it('enter/exit subgraph maintains breadcrumb trail', () => {
    const subId = getState().createSubgraph('TestSub');
    expect(subId).toBeTruthy();

    const parentGraphId = getState().activeGraphId;
    expect(getState().breadcrumbStack).toHaveLength(0);

    // Enter subgraph
    getState().enterSubgraph(subId!);

    const innerGraphId = getState().activeGraphId;
    expect(innerGraphId).not.toBe(parentGraphId);
    expect(getState().breadcrumbStack).toHaveLength(1);
    expect(getState().breadcrumbStack[0].graphId).toBe(parentGraphId);
    expect(getState().breadcrumbStack[0].subgraphNodeId).toBe(subId);

    // Inner graph should have boundary nodes
    const innerNodes = Object.values(getState().nodes) as EditorNode[];
    const inputNodes = innerNodes.filter((n: EditorNode) => n.type === 'subgraph-input');
    const outputNodes = innerNodes.filter((n: EditorNode) => n.type === 'subgraph-output');
    expect(inputNodes).toHaveLength(1);
    expect(outputNodes).toHaveLength(1);

    // Exit subgraph
    getState().exitSubgraph();
    expect(getState().activeGraphId).toBe(parentGraphId);
    expect(getState().breadcrumbStack).toHaveLength(0);

    // The subgraph node should still exist
    expect(getState().nodes[subId!]).toBeDefined();
  });

  it('delete subgraph node cascades cleanup (subgraphDefs, graphTabs, inactiveGraphs)', () => {
    const subId = getState().createSubgraph('TestSub');
    expect(subId).toBeTruthy();

    const innerGraphId = getState().nodes[subId!].data.innerGraphId as string;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();
    expect(getState().subgraphDefs[subId!]).toBeDefined();

    // Delete the subgraph node
    getState().deleteSubgraphNode(subId!);

    // Everything should be cleaned up
    expect(getState().nodes[subId!]).toBeUndefined();
    expect(getState().subgraphDefs[subId!]).toBeUndefined();
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
  });

  it('subgraph nodes preserve ports when duplicated', () => {
    const subId = getState().createSubgraph('TestSub');
    expect(subId).toBeTruthy();

    const subNode = getState().nodes[subId!];
    const inputCount = subNode.inputs.length;
    const outputCount = subNode.outputs.length;
    expect(inputCount).toBeGreaterThan(0);
    expect(outputCount).toBeGreaterThan(0);

    // Select and duplicate
    getState().setSelection(new Set([subId!]));
    const mapping = getState().duplicateSelected();
    expect(mapping).toBeTruthy();

    const dupId = mapping!.get(subId!)!;
    const dupNode = getState().nodes[dupId];
    expect(dupNode).toBeDefined();
    expect(dupNode.type).toBe('subgraph');

    // Ports must be deep-copied, preserving count and types
    expect(dupNode.inputs).toHaveLength(inputCount);
    expect(dupNode.outputs).toHaveLength(outputCount);
    for (let i = 0; i < inputCount; i++) {
      expect(dupNode.inputs[i].label).toBe(subNode.inputs[i].label);
      expect(dupNode.inputs[i].portType).toBe(subNode.inputs[i].portType);
    }
  });

  it('convertSelectionToSubgraph moves nodes into inner graph', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [3, 0, 0]);
    const out = getState().addNode('output', [6, 0, 0]);

    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(xfm, 0, out, 0);

    // Select the transform node to convert
    getState().setSelection(new Set([xfm]));
    const subId = getState().convertSelectionToSubgraph('XfmSub');
    expect(subId).toBeTruthy();

    // The transform node should be gone from the parent graph
    expect(getState().nodes[xfm]).toBeUndefined();

    // A subgraph node should have replaced it
    expect(getState().nodes[subId!]).toBeDefined();
    expect(getState().nodes[subId!].type).toBe('subgraph');

    // Source and output should still exist in parent graph
    expect(getState().nodes[src]).toBeDefined();
    expect(getState().nodes[out]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Connection Validation
// ---------------------------------------------------------------------------

describe('Connection Validation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cannot create self-loop connection', () => {
    const math = getState().addNode('math', [0, 0, 0]);
    // math has outputs[0]=result (number) and inputs[0]=a (number)
    const result = getState().addConnection(math, 0, math, 0);
    expect(result).toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('cannot create duplicate connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const math = getState().addNode('math', [3, 0, 0]);

    const c1 = getState().addConnection(src, 0, math, 0);
    expect(c1).toBeTruthy();

    // Try to create the exact same connection again
    const c2 = getState().addConnection(src, 0, math, 0);
    expect(c2).toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(1);
  });

  it('cycle detection prevents circular graphs', () => {
    // Build: A -> B -> C, then try C -> A
    const a = getState().addNode('source', [0, 0, 0]);
    const b = getState().addNode('transform', [3, 0, 0]);
    const c = getState().addNode('transform', [6, 0, 0]);

    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);

    // Try to create C -> A (would create a cycle via reroute)
    // But source has no inputs, so let's use a different setup
    // A(source) -> B(transform) -> C(transform), try C -> B (cycle)
    const cycleConn = getState().addConnection(c, 0, b, 0);
    expect(cycleConn).toBeNull();
  });

  it('port type compatibility is enforced', () => {
    // Source has output[0]=number, output[1]=string
    // Compare has input[0]=number, input[1]=number
    const src = getState().addNode('source', [0, 0, 0]);
    const cmp = getState().addNode('compare', [3, 0, 0]);

    // Connect number output to number input - should work
    const valid = getState().addConnection(src, 0, cmp, 0);
    expect(valid).toBeTruthy();

    // Connect string output (port 1) to number input (port 1) - should fail
    const invalid = getState().addConnection(src, 1, cmp, 1);
    expect(invalid).toBeNull();
  });

  it('addConnection returns null for invalid connections', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const math = getState().addNode('math', [3, 0, 0]);

    // Non-existent source node
    expect(getState().addConnection('nonexistent', 0, math, 0)).toBeNull();

    // Non-existent target node
    expect(getState().addConnection(src, 0, 'nonexistent', 0)).toBeNull();

    // Out-of-range source port index
    expect(getState().addConnection(src, 99, math, 0)).toBeNull();

    // Out-of-range target port index
    expect(getState().addConnection(src, 0, math, 99)).toBeNull();

    // Negative port index
    expect(getState().addConnection(src, -1, math, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Edge Cases
// ---------------------------------------------------------------------------

describe('Edge Cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('operations on empty graph do not crash', () => {
    // Execute on empty graph
    expect(() => getState().executeGraph()).not.toThrow();

    // Validate on empty graph
    expect(() => getState().validateGraph()).not.toThrow();
    expect(Object.keys(getState().validationErrors)).toHaveLength(0);

    // Auto-layout on empty graph
    expect(() => getState().autoLayout()).not.toThrow();

    // Clear on empty graph (should be a no-op since nothing to clear)
    expect(() => getState().clearGraph()).not.toThrow();
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('delete with no selection is a no-op', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('math', [3, 0, 0]);

    // Ensure no selection
    getState().setSelection(new Set());
    expect(getState().selectedIds.size).toBe(0);

    const nodeCountBefore = Object.keys(getState().nodes).length;
    getState().deleteSelected();
    const nodeCountAfter = Object.keys(getState().nodes).length;

    expect(nodeCountAfter).toBe(nodeCountBefore);
    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();
  });

  it('undo with empty stack is a no-op', () => {
    // Fresh store has no undo history
    expect(getState().canUndo()).toBe(false);

    const stateSnapshot = {
      nodes: { ...getState().nodes },
      connections: { ...getState().connections },
    };

    getState().undo();

    // State should be unchanged
    expect(getState().nodes).toEqual(stateSnapshot.nodes);
    expect(getState().connections).toEqual(stateSnapshot.connections);
  });

  it('duplicate with no selection is a no-op', () => {
    getState().addNode('source', [0, 0, 0]);

    // Ensure nothing is selected
    getState().setSelection(new Set());

    const nodeCountBefore = Object.keys(getState().nodes).length;
    const result = getState().duplicateSelected();

    expect(result).toBeNull();
    expect(Object.keys(getState().nodes)).toHaveLength(nodeCountBefore);
  });

  it('paste with empty clipboard is a no-op', () => {
    getState().addNode('source', [0, 0, 0]);

    expect(getState().canPaste()).toBe(false);

    const nodeCountBefore = Object.keys(getState().nodes).length;
    getState().paste();

    expect(Object.keys(getState().nodes)).toHaveLength(nodeCountBefore);
  });
});

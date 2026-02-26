import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore } from '../store/editorStore';
import { saveGraph, importFromJSON } from '../utils/serialization';
import { validateGraph as utilValidateGraph } from '../utils/validation';
import type { EditorNode, Connection } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
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
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
  });
  // Clear persisted execution results to prevent cross-test contamination
  localStorage.removeItem('node-editor-3d-exec-results');
}

function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  while (getState().canRedo()) getState().redo();
  while (getState().canUndo()) getState().undo();
}

function getState() {
  return useEditorStore.getState();
}

// ============================================================================
// 1. Full Workflow: Create → Connect → Execute → Validate → Save → Load
// ============================================================================

describe('Full Workflow: Create → Execute → Save → Load', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('end-to-end: create graph, execute, save, load, re-execute', () => {
    // Create nodes
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfm, 'multiplier', 3);
    getState().updateNodeData(xfm, 'offset', 0);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(xfm, 0, out, 0);

    // Execute
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().isExecuting).toBe(false);
    expect(getState().nodeOutputs[xfm][0]).toBe(30);

    // Save
    saveGraph(getState().nodes, getState().connections, getState().groups, getState().customNodeDefs);

    // Reset and load
    resetStore();
    expect(getState().loadFromStorage()).toBe(true);
    expect(Object.keys(getState().nodes).length).toBe(3);
    expect(Object.keys(getState().connections).length).toBe(2);

    // Re-execute on loaded graph
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[xfm][0]).toBe(30);
  });

  it('custom node: define → create → connect → execute → validate', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Double', color: 'red', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0 * 2',
    });
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 25);
    const custom = getState().addCustomNode(defId, [5, 0, 0])!;
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, custom, 0);
    getState().addConnection(custom, 0, out, 0);

    // Execute
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[custom][0]).toBe(50);

    // Validate - fully connected graph: source → custom → output
    getState().validateGraph();
    // Custom node should NOT have any validation errors (fully connected)
    expect(getState().validationErrors[custom]).toBeUndefined();
  });
});

// ============================================================================
// 2. Grouping + Execution Integration
// ============================================================================

describe('Grouping + Execution Integration', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('grouped nodes execute correctly', () => {
    const s1 = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(s1, 'value', 5);
    const s2 = getState().addNode('source', [0, 0, 3]);
    getState().updateNodeData(s2, 'value', 10);
    const m = getState().addNode('math', [5, 0, 0]);
    getState().addConnection(s1, 0, m, 0);
    getState().addConnection(s2, 0, m, 1);

    // Group the sources
    getState().setSelection(new Set([s1, s2]));
    const groupId = getState().createGroup('Sources');
    expect(groupId).not.toBeNull();

    // Execute - grouping should not affect execution
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[m][0]).toBe(15); // 5 + 10
  });

  it('custom nodes can be grouped', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Add1', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0 + 1',
    });
    const c1 = getState().addCustomNode(defId, [0, 0, 0])!;
    const c2 = getState().addCustomNode(defId, [5, 0, 0])!;
    getState().setSelection(new Set([c1, c2]));
    const groupId = getState().createGroup('Custom Nodes');
    expect(groupId).not.toBeNull();
    expect(getState().nodes[c1].groupId).toBe(groupId);
    expect(getState().nodes[c2].groupId).toBe(groupId);
  });

  it('delete group with custom nodes → undo restores them', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Test', color: 'green', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0',
    });
    const c1 = getState().addCustomNode(defId, [0, 0, 0])!;
    const c2 = getState().addCustomNode(defId, [5, 0, 0])!;
    getState().setSelection(new Set([c1, c2]));
    getState().createGroup('Test Group');

    // Delete the custom nodes
    getState().setSelection(new Set([c1, c2]));
    getState().deleteSelected();
    expect(getState().nodes[c1]).toBeUndefined();
    expect(getState().nodes[c2]).toBeUndefined();

    // Undo should restore them
    getState().undo();
    expect(getState().nodes[c1]).toBeDefined();
    expect(getState().nodes[c2]).toBeDefined();
  });
});

// ============================================================================
// 3. Collapse + Execution Integration
// ============================================================================

describe('Collapse + Execution Integration', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('collapsed node in chain still passes data', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(s, 'value', 7);
    const t = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(t, 'multiplier', 2);
    getState().updateNodeData(t, 'offset', 0);
    const o = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(s, 0, t, 0);
    getState().addConnection(t, 0, o, 0);

    // Collapse the middle node
    getState().toggleNodeCollapse(t);
    expect(getState().nodes[t].collapsed).toBe(true);

    // Execute
    getState().executeGraph();
    vi.advanceTimersByTime(5000);

    // Data should flow through collapsed transform
    expect(getState().nodeOutputs[t][0]).toBe(14); // 7 * 2
  });

  it('batch collapse then execute', () => {
    const s1 = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(s1, 'value', 3);
    const s2 = getState().addNode('source', [0, 0, 3]);
    getState().updateNodeData(s2, 'value', 4);
    const m = getState().addNode('math', [5, 0, 0]);
    getState().addConnection(s1, 0, m, 0);
    getState().addConnection(s2, 0, m, 1);

    // Batch collapse sources
    getState().setSelection(new Set([s1, s2]));
    getState().collapseSelected();
    expect(getState().nodes[s1].collapsed).toBe(true);
    expect(getState().nodes[s2].collapsed).toBe(true);

    // Execute
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[m][0]).toBe(7); // 3 + 4
  });
});

// ============================================================================
// 4. AutoLayout + Undo Integration
// ============================================================================

describe('AutoLayout + Undo Integration', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('layout then undo restores exact positions', () => {
    const a = getState().addNode('source', [1, 2, 3]);
    const b = getState().addNode('transform', [4, 5, 6]);
    const c = getState().addNode('output', [7, 8, 9]);
    getState().addConnection(a, 0, b, 0);
    getState().addConnection(b, 0, c, 0);

    getState().autoLayout();
    // Positions should have changed
    expect(getState().nodes[a].position).not.toEqual([1, 2, 3]);

    // Undo should restore originals exactly
    getState().undo();
    expect(getState().nodes[a].position).toEqual([1, 2, 3]);
    expect(getState().nodes[b].position).toEqual([4, 5, 6]);
    expect(getState().nodes[c].position).toEqual([7, 8, 9]);
  });

  it('layout → edit → layout → undo undoes second layout only', () => {
    const a = getState().addNode('source', [1, 0, 1]);
    const b = getState().addNode('transform', [5, 0, 5]);
    getState().addConnection(a, 0, b, 0);

    getState().autoLayout();
    const posAfterFirstLayout = [...getState().nodes[a].position];
    getState().updateNodeData(a, 'value', 42);
    getState().autoLayout();
    // Undo second layout
    getState().undo();
    // Should be at post-first-layout positions
    expect(getState().nodes[a].position).toEqual(posAfterFirstLayout);
  });
});

// ============================================================================
// 5. Drag-from-Port End-to-End
// ============================================================================

describe('Drag-from-Port End-to-End', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('drag from output → create math node', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const types = getState().getCompatibleNodeTypes(src, 0, true);
    expect(types.some(t => t.type === 'math')).toBe(true);

    const mathId = getState().addNodeAndConnect('math', [5, 0, 0], src, 0, true);
    expect(mathId).not.toBeNull();
    expect(getState().nodes[mathId!].type).toBe('math');
    // Connection should exist
    const conn = Object.values(getState().connections)[0];
    expect(conn.sourceNodeId).toBe(src);
    expect(conn.targetNodeId).toBe(mathId);
  });

  it('drag from input → create source node', () => {
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const types = getState().getCompatibleNodeTypes(xfm, 0, false);
    expect(types.some(t => t.type === 'source')).toBe(true);

    const srcId = getState().addNodeAndConnect('source', [0, 0, 0], xfm, 0, false);
    expect(srcId).not.toBeNull();
    // Connection: new source's output → transform's input
    const conn = Object.values(getState().connections)[0];
    expect(conn.sourceNodeId).toBe(srcId);
    expect(conn.targetNodeId).toBe(xfm);
  });

  it('drag-create → undo → redo roundtrip', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true);
    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(Object.keys(getState().connections).length).toBe(1);

    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(1);
    expect(Object.keys(getState().connections).length).toBe(0);

    getState().redo();
    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(Object.keys(getState().connections).length).toBe(1);
  });
});

// ============================================================================
// 6. Serialization + Import/Export Roundtrips
// ============================================================================

describe('Serialization Roundtrips', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('importFromJSON → full graph with custom nodes', () => {
    const json = JSON.stringify({
      nodes: {
        n1: {
          id: 'n1', type: 'source', position: [0, 0, 0], title: 'S', data: { value: 42 },
          inputs: [], outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
        },
        n2: {
          id: 'n2', type: 'custom', position: [5, 0, 0], title: 'Custom', data: { expression: 'in0 * 2', customDefId: 'cd1' },
          inputs: [{ id: 'in-0', label: 'in0', portType: 'number' }],
          outputs: [{ id: 'out-0', label: 'out0', portType: 'number' }],
        },
      },
      connections: {
        c1: { id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 0, targetNodeId: 'n2', targetPortIndex: 0 },
      },
      customNodeDefs: {
        cd1: {
          id: 'cd1', name: 'Double', color: 'blue', category: 'Math',
          inputs: [{ label: 'in0', portType: 'number' }],
          outputs: [{ label: 'out0', portType: 'number' }],
          expression: 'in0 * 2',
        },
      },
    });

    const data = importFromJSON(json);
    expect(data).not.toBeNull();
    getState().importWorkflow(data!);
    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(getState().customNodeDefs.cd1.name).toBe('Double');
  });

  it('importFromJSON rejects invalid JSON', () => {
    expect(importFromJSON('not json')).toBeNull();
    expect(importFromJSON('{}')).toBeNull(); // Missing nodes/connections
    expect(importFromJSON('{"nodes": "bad", "connections": {}}')).toBeNull();
  });

  it('save → load preserves groups and customNodeDefs', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Test', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0',
    });
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('source', [5, 0, 0]);
    getState().setSelection(new Set([n1, n2]));
    const groupId = getState().createGroup('MyGroup');

    saveGraph(getState().nodes, getState().connections, getState().groups, getState().customNodeDefs);
    resetStore();
    expect(getState().loadFromStorage()).toBe(true);
    expect(getState().groups[groupId!].label).toBe('MyGroup');
    expect(getState().customNodeDefs[defId].name).toBe('Test');
  });

  it('load clears execution state', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    // Simulate execution state
    useEditorStore.setState({
      executionStates: { [src]: 'complete' },
      nodeOutputs: { [src]: { 0: 42 } },
      isExecuting: false,
    });
    saveGraph(getState().nodes, getState().connections, getState().groups, getState().customNodeDefs);
    resetStore();
    getState().loadFromStorage();
    // Execution state should NOT be loaded (it's transient)
    expect(getState().executionStates).toEqual({});
    expect(getState().nodeOutputs).toEqual({});
  });
});

// ============================================================================
// 7. Validation Utility Integration
// ============================================================================

describe('Validation Utility Integration', () => {
  it('util validateGraph finds disconnected inputs', () => {
    const config = NODE_TYPE_CONFIG['transform'];
    const nodes: Record<string, EditorNode> = {
      t: {
        id: 't', type: 'transform', position: [0, 0, 0], title: 'T', data: {},
        inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
        outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
      },
    };
    const issues = utilValidateGraph(nodes, {});
    expect(issues.length).toBeGreaterThan(0);
    // Should have disconnected-input issues for the transform's inputs
    expect(issues.some(i => i.type === 'disconnected-input')).toBe(true);
    // Also gets no-connections warning since it's isolated
    expect(issues.some(i => i.type === 'no-connections')).toBe(true);
  });

  it('util validateGraph returns empty for fully connected', () => {
    const srcConfig = NODE_TYPE_CONFIG['source'];
    const xfmConfig = NODE_TYPE_CONFIG['transform'];
    const nodes: Record<string, EditorNode> = {
      s: {
        id: 's', type: 'source', position: [0, 0, 0], title: 'S', data: {},
        inputs: srcConfig.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
        outputs: srcConfig.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
      },
      t: {
        id: 't', type: 'transform', position: [5, 0, 0], title: 'T', data: {},
        inputs: xfmConfig.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
        outputs: xfmConfig.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
      },
    };
    const conns: Record<string, Connection> = {};
    // Connect all transform inputs
    for (let i = 0; i < xfmConfig.inputs.length; i++) {
      conns[`c${i}`] = { id: `c${i}`, sourceNodeId: 's', sourcePortIndex: 0, targetNodeId: 't', targetPortIndex: i };
    }
    const issues = utilValidateGraph(nodes, conns);
    // Transform should have no disconnected-input issues
    const xfmDisconnectedInputs = issues.filter(i => i.nodeId === 't' && i.type === 'disconnected-input');
    expect(xfmDisconnectedInputs.length).toBe(0);
  });
});

// ============================================================================
// 8. Execution Edge Cases
// ============================================================================

describe('Execution Edge Cases', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('double executeGraph is no-op while executing', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().executeGraph();
    expect(getState().isExecuting).toBe(true);
    // Second call should be no-op
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().isExecuting).toBe(false);
  });

  it('execute empty graph is no-op', () => {
    getState().executeGraph();
    expect(getState().isExecuting).toBe(false);
  });

  it('execution with error records error state', () => {
    // Create a custom node with a bad expression
    const defId = getState().addCustomNodeDef({
      name: 'Bad', color: 'red', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: '{{syntax error}}',
    });
    const src = getState().addNode('source', [0, 0, 0]);
    const bad = getState().addCustomNode(defId, [5, 0, 0])!;
    getState().addConnection(src, 0, bad, 0);

    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().executionErrors[bad]).toBeDefined();
  });

  it('resetExecution mid-execution stops animation', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().executeGraph();
    vi.advanceTimersByTime(100);
    expect(getState().isExecuting).toBe(true);

    getState().resetExecution();
    expect(getState().isExecuting).toBe(false);

    // Advance past all timeouts
    vi.advanceTimersByTime(10000);
    // Should remain false (zombie timeouts cleared)
    expect(getState().isExecuting).toBe(false);
    expect(getState().executionStates).toEqual({});
  });
});

// ============================================================================
// 9. Search + Focus Integration
// ============================================================================

describe('Search + Focus Integration', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('search by title finds correct nodes', () => {
    const s = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    getState().addNode('output', [10, 0, 0]);
    const results = getState().searchNodes('source');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(s);
  });

  it('search by type', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('source', [5, 0, 0]);
    getState().addNode('transform', [10, 0, 0]);
    const results = getState().searchNodes('source');
    expect(results.length).toBe(2);
  });

  it('fuzzy search', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'MyDataProvider');
    const results = getState().searchNodes('mdp');
    // Fuzzy should find 'MyDataProvider' matching m-d-p
    expect(results.some(r => r.id === id)).toBe(true);
  });

  it('empty query returns all nodes', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    const results = getState().searchNodes('');
    expect(results.length).toBe(2);
  });

  it('focus selects the node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    getState().focusNode(id);
    expect(getState().selectedIds.has(id)).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
  });
});

// ============================================================================
// 10. Complex Multi-Step Undo/Redo
// ============================================================================

describe('Complex Multi-Step Undo/Redo', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('5-step workflow: add → connect → rename → collapse → delete → undo all', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    // addConnection doesn't push undo
    getState().addConnection(src, 0, xfm, 0);
    getState().updateNodeTitle(src, 'DataSource');
    getState().toggleNodeCollapse(src);
    getState().setSelection(new Set([xfm]));
    getState().deleteSelected();

    // transform deleted
    expect(getState().nodes[xfm]).toBeUndefined();

    // Undo delete
    getState().undo();
    expect(getState().nodes[xfm]).toBeDefined();

    // Undo collapse
    getState().undo();
    expect(getState().nodes[src].collapsed).toBeFalsy();

    // Undo rename
    getState().undo();
    expect(getState().nodes[src].title).toBe('Source');

    // Undo addNode(transform)
    getState().undo();
    expect(getState().nodes[xfm]).toBeUndefined();

    // Undo addNode(source)
    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(0);
  });

  it('redo chain restores multi-step workflow', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(src, 'MySource');
    getState().toggleNodeCollapse(src);

    // Undo all
    getState().undo(); // undo collapse
    getState().undo(); // undo rename
    getState().undo(); // undo addNode

    // Redo all
    getState().redo(); // redo addNode
    expect(getState().nodes[src]).toBeDefined();
    getState().redo(); // redo rename
    expect(getState().nodes[src].title).toBe('MySource');
    getState().redo(); // redo collapse
    expect(getState().nodes[src].collapsed).toBe(true);
  });
});

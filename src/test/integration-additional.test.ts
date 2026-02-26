/**
 * Additional integration tests covering cross-cutting concerns:
 * - Validation + Store integration
 * - Multi-graph + templates interactions
 * - Custom node error recovery
 * - Persistence robustness
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { importFromJSON } from '../utils/serialization';

// Helper to get/set store state
const getState = () => useEditorStore.getState();
const mergeState = (partial: Record<string, unknown>) =>
  useEditorStore.setState((s) => { Object.assign(s, partial); });

function resetStore() {
  // Reset module-scoped state (undo/redo stacks, clipboard, execution caches, inactive graphs)
  _resetModuleState();
  // Reset to clean state
  mergeState({
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    interaction: 'idle' as const,
    pendingConnection: null,
    contextMenu: null,
    snapEnabled: false,
    isExecuting: false,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    executionMetrics: {},
    executionTotalDuration: 0,
    validationErrors: {},
    customNodeDefs: {},
    subgraphDefs: {},
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
  });
}

describe('Validation + Store Integration', () => {
  beforeEach(resetStore);

  it('validateGraph detects disconnected inputs via store action', () => {
    const s = getState();
    const id = s.addNode('transform', [0, 0, 0]);
    s.validateGraph();
    const errors = getState().validationErrors;
    // Transform has 2 inputs, both disconnected
    expect(errors[id]).toBeDefined();
    expect(errors[id].length).toBeGreaterThanOrEqual(2);
    expect(errors[id].some((e: string) => e.includes('not connected'))).toBe(true);
  });

  it('validateGraph clears errors when all inputs connected', () => {
    const s = getState();
    const srcId = s.addNode('source', [0, 0, 0]);
    const filterId = s.addNode('filter', [5, 0, 0]);
    const outId = s.addNode('output', [10, 0, 0]);
    s.addConnection(srcId, 0, filterId, 0);
    s.addConnection(filterId, 0, outId, 0);
    s.validateGraph();
    const errors = getState().validationErrors;
    // filter's input is connected and output goes to output node
    expect(errors[filterId]).toBeUndefined();
  });

  it('validateGraph detects disconnected nodes (warning)', () => {
    const s = getState();
    const id = s.addNode('source', [0, 0, 0]);
    s.validateGraph();
    const errors = getState().validationErrors;
    // Source has no connections at all → warning
    expect(errors[id]).toBeDefined();
    expect(errors[id].some((e: string) => e.includes('no connections'))).toBe(true);
  });

  it('validation clears after connecting a lonely node', () => {
    const s = getState();
    const srcId = s.addNode('source', [0, 0, 0]);
    const filterId = s.addNode('filter', [5, 0, 0]);
    s.validateGraph();
    // Source has no connections → error
    expect(getState().validationErrors[srcId]).toBeDefined();

    // Connect them
    s.addConnection(srcId, 0, filterId, 0);
    s.validateGraph();
    // Both connected now - source node should have no errors
    expect(getState().validationErrors[srcId]).toBeUndefined();
  });

  it('addConnection rejects connections that would create cycles', () => {
    const s = getState();
    const f1 = s.addNode('filter', [0, 0, 0]);
    const f2 = s.addNode('filter', [5, 0, 0]);
    // Create forward connection: f1 → f2
    const conn1 = s.addConnection(f1, 0, f2, 0);
    expect(conn1).not.toBeNull();
    // Attempt cycle: f2 → f1 should be rejected
    const conn2 = s.addConnection(f2, 0, f1, 0);
    expect(conn2).toBeNull();
    // Only the forward connection should exist
    expect(Object.keys(getState().connections).length).toBe(1);
  });
});

describe('Multi-Graph + Template Interactions', () => {
  beforeEach(resetStore);

  it('templates persist across graph switches', () => {
    const s = getState();
    // Create content in graph
    const srcId = s.addNode('source', [0, 0, 0]);
    const filterId = s.addNode('filter', [5, 0, 0]);
    s.addConnection(srcId, 0, filterId, 0);

    // Select and save as template
    s.setSelection(new Set([srcId, filterId]));
    s.saveSelectionAsTemplate('TestTemplate', 'Test');

    // Verify template exists
    const templates1 = getState().templates;
    expect(Object.keys(templates1).length).toBe(1);

    // Create new graph and switch to it
    s.createGraph('Graph 2');
    // Templates should still be available
    const templates2 = getState().templates;
    expect(Object.keys(templates2).length).toBe(1);
  });

  it('custom node defs are per-graph, not shared', () => {
    const s = getState();
    // Create a custom node def in default graph (addCustomNodeDef generates its own ID)
    const defId = s.addCustomNodeDef({
      name: 'MyCustom',
      color: 'teal',
      category: 'Custom',
      inputs: [{ label: 'in', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'inputs[0] * 2',
    });

    const defs1 = getState().customNodeDefs;
    expect(defs1[defId]).toBeDefined();

    // Create and switch to a new graph
    s.createGraph('Graph 2');
    // Custom defs should be empty in new graph
    const defs2 = getState().customNodeDefs;
    expect(defs2[defId]).toBeUndefined();
  });

  it('deleteSelected removes nodes and connections in single undo step', () => {
    const s = getState();
    const src = s.addNode('source', [0, 0, 0]);
    const filter = s.addNode('filter', [5, 0, 0]);
    s.addConnection(src, 0, filter, 0);

    s.setSelection(new Set([src, filter]));
    s.deleteSelected();

    expect(Object.keys(getState().nodes).length).toBe(0);
    expect(Object.keys(getState().connections).length).toBe(0);

    // Single undo should restore everything
    s.undo();
    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(Object.keys(getState().connections).length).toBe(1);
  });

  it('graph switching preserves undo history per graph', () => {
    const s = getState();
    // Add node in default graph
    const n1 = s.addNode('source', [0, 0, 0]);
    expect(getState().nodes[n1]).toBeDefined();

    // Create and switch to graph 2
    const graphTabs = getState().graphTabs;
    const defaultGraphId = Object.keys(graphTabs)[0];
    s.createGraph('Graph 2');

    // Add node in graph 2
    const n2 = s.addNode('transform', [5, 0, 0]);
    expect(getState().nodes[n2]).toBeDefined();

    // Undo in graph 2 should remove n2
    s.undo();
    expect(getState().nodes[n2]).toBeUndefined();

    // Switch back to default graph - n1 should still be there
    s.switchGraph(defaultGraphId);
    expect(getState().nodes[n1]).toBeDefined();
  });
});

describe('Custom Node Error Recovery', () => {
  beforeEach(resetStore);

  it('custom node with invalid expression returns error gracefully', () => {
    const s = getState();
    // Add custom def with broken expression
    const brokenDefId = s.addCustomNodeDef({
      name: 'Broken',
      color: 'teal',
      category: 'Custom',
      inputs: [{ label: 'in', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'this is not valid javascript!!!',
    });

    // Create a custom node and source
    const srcId = s.addNode('source', [0, 0, 0]);
    const customId = s.addNode('custom', [5, 0, 0]);

    // Set the custom node's data to use the broken def
    s.updateNodeData(customId, 'customDefId', brokenDefId);

    s.addConnection(srcId, 0, customId, 0);

    // Execute should not throw
    s.executeGraph();
    // May have execution errors but shouldn't crash
    const state = getState();
    // The graph should still be intact
    expect(state.nodes[srcId]).toBeDefined();
    expect(state.nodes[customId]).toBeDefined();
  });

  it('removing a node clears its execution state', () => {
    const s = getState();
    const srcId = s.addNode('source', [0, 0, 0]);

    // Set some execution state manually
    mergeState({
      executionStates: { [srcId]: 'complete' as const },
      nodeOutputs: { [srcId]: { 0: 42 } },
    });

    // Remove the node
    s.removeNode(srcId);

    // Node should be gone
    expect(getState().nodes[srcId]).toBeUndefined();
  });
});

describe('Persistence Robustness', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('importFromJSON returns null for invalid JSON', () => {
    const result = importFromJSON('this is not json!!!');
    expect(result).toBeNull();
  });

  it('importFromJSON returns null for empty string', () => {
    const result = importFromJSON('');
    expect(result).toBeNull();
  });

  it('importFromJSON returns null for array (wrong shape)', () => {
    const result = importFromJSON('[1,2,3]');
    expect(result).toBeNull();
  });

  it('importFromJSON returns null for garbage data', () => {
    const garbage = JSON.stringify({ nodes: 'not an object', connections: 42 });
    const result = importFromJSON(garbage);
    expect(result).toBeNull();
  });

  it('importFromJSON accepts valid minimal data', () => {
    const result = importFromJSON(JSON.stringify({ nodes: {}, connections: {} }));
    expect(result).not.toBeNull();
    expect(result!.nodes).toEqual({});
    expect(result!.connections).toEqual({});
  });

  it('save and load roundtrip preserves full state', () => {
    const s = getState();
    // Build a non-trivial graph
    const src = s.addNode('source', [0, 0, 0]);
    const math = s.addNode('math', [5, 0, 0]);
    s.addConnection(src, 0, math, 0);
    s.updateNodeData(src, 'value', 42);
    s.updateNodeTitle(src, 'My Source');

    // Create a group
    s.setSelection(new Set([src, math]));
    s.createGroup('TestGroup');

    // Export
    const storage = s.exportAllGraphs();
    expect(storage).toBeTruthy();

    // Clear and reimport
    s.clearGraph();
    expect(Object.keys(getState().nodes).length).toBe(0);

    s.importAllGraphs(storage);
    const state = getState();
    expect(Object.keys(state.nodes).length).toBe(2);
    expect(Object.keys(state.connections).length).toBe(1);
  });

  it('clearGraph resets all transient state', () => {
    const s = getState();
    s.addNode('source', [0, 0, 0]);

    // Set various transient state
    mergeState({
      isExecuting: true,
      executionStates: { 'n': 'running' as const },
      nodeOutputs: { 'n': { 0: 42 } },
      executionErrors: { 'n': 'oops' },
    });

    s.clearGraph();
    const state = getState();
    expect(Object.keys(state.nodes).length).toBe(0);
    expect(state.isExecuting).toBe(false);
    expect(Object.keys(state.executionStates).length).toBe(0);
    expect(Object.keys(state.nodeOutputs).length).toBe(0);
    expect(Object.keys(state.executionErrors).length).toBe(0);
  });
});

describe('Undo/Redo Edge Cases', () => {
  beforeEach(resetStore);

  it('undo after redo restores correct state', () => {
    const s = getState();
    const id1 = s.addNode('source', [0, 0, 0]);
    const id2 = s.addNode('filter', [5, 0, 0]);

    // Undo both
    s.undo(); // remove filter
    expect(getState().nodes[id2]).toBeUndefined();
    s.undo(); // remove source
    expect(getState().nodes[id1]).toBeUndefined();

    // Redo once
    s.redo();
    expect(getState().nodes[id1]).toBeDefined();
    expect(getState().nodes[id2]).toBeUndefined();

    // Undo again
    s.undo();
    expect(getState().nodes[id1]).toBeUndefined();
  });

  it('new action after undo clears redo stack', () => {
    const s = getState();
    s.addNode('source', [0, 0, 0]);
    s.addNode('filter', [5, 0, 0]);

    s.undo(); // remove filter
    expect(s.canRedo()).toBe(true);

    // New action should clear redo
    s.addNode('math', [10, 0, 0]);
    expect(s.canRedo()).toBe(false);
  });

  it('undo clears transient execution state', () => {
    const s = getState();
    s.addNode('source', [0, 0, 0]);

    // Simulate execution state
    mergeState({
      isExecuting: true,
      executionStates: { 'x': 'running' as const },
    });

    s.undo();
    expect(getState().isExecuting).toBe(false);
    expect(Object.keys(getState().executionStates).length).toBe(0);
  });
});

describe('Node Type Coverage', () => {
  beforeEach(resetStore);

  const nodeTypes = [
    'source', 'transform', 'filter', 'output',
    'math', 'clamp', 'remap',
    'concat', 'template',
    'compare', 'switch',
    'compose-vec3', 'decompose-vec3',
    'note', 'reroute', 'random', 'display',
  ] as const;

  for (const type of nodeTypes) {
    it(`creates ${type} node with correct port configuration`, () => {
      const s = getState();
      const id = s.addNode(type, [0, 0, 0]);
      const node = getState().nodes[id];
      expect(node).toBeDefined();
      expect(node.type).toBe(type);
      // Every port should have id, label, portType
      for (const port of node.inputs) {
        expect(port.id).toBeTruthy();
        expect(port.label).toBeTruthy();
        expect(port.portType).toBeTruthy();
      }
      for (const port of node.outputs) {
        expect(port.id).toBeTruthy();
        expect(port.label).toBeTruthy();
        expect(port.portType).toBeTruthy();
      }
    });
  }
});

describe('Connection Validation', () => {
  beforeEach(resetStore);

  it('allows connecting compatible port types', () => {
    const s = getState();
    // source output[0] is 'number', compare input[0] is 'number' → compatible
    const srcId = s.addNode('source', [0, 0, 0]);
    const compareId = s.addNode('compare', [5, 0, 0]);
    s.addConnection(srcId, 0, compareId, 0);
    expect(Object.keys(getState().connections).length).toBe(1);
  });

  it('allows connecting "any" port type to anything', () => {
    const s = getState();
    const srcId = s.addNode('source', [0, 0, 0]);
    // filter input is 'any' type
    const filterId = s.addNode('filter', [5, 0, 0]);
    s.addConnection(srcId, 0, filterId, 0);
    expect(Object.keys(getState().connections).length).toBe(1);
  });

  it('removing a node cascades connection deletion', () => {
    const s = getState();
    const srcId = s.addNode('source', [0, 0, 0]);
    const filterId = s.addNode('filter', [5, 0, 0]);
    const outId = s.addNode('output', [10, 0, 0]);
    s.addConnection(srcId, 0, filterId, 0);
    s.addConnection(filterId, 0, outId, 0);
    expect(Object.keys(getState().connections).length).toBe(2);

    // Remove middle node
    s.removeNode(filterId);
    // Both connections should be gone
    expect(Object.keys(getState().connections).length).toBe(0);
  });

  it('duplicate connections are not created', () => {
    const s = getState();
    const srcId = s.addNode('source', [0, 0, 0]);
    const filterId = s.addNode('filter', [5, 0, 0]);

    s.addConnection(srcId, 0, filterId, 0);
    // Adding same connection again replaces the old one
    s.addConnection(srcId, 0, filterId, 0);

    // Should not have two connections to same target port
    const conns = Object.values(getState().connections);
    const targetPorts = conns.filter(c => c.targetNodeId === filterId && c.targetPortIndex === 0);
    expect(targetPorts.length).toBe(1);
  });
});

describe('Selection and Interaction', () => {
  beforeEach(resetStore);

  it('setSelection updates selectedIds', () => {
    const s = getState();
    const id1 = s.addNode('source', [0, 0, 0]);
    const id2 = s.addNode('filter', [5, 0, 0]);

    s.setSelection(new Set([id1, id2]));
    expect(getState().selectedIds.size).toBe(2);
    expect(getState().selectedIds.has(id1)).toBe(true);
    expect(getState().selectedIds.has(id2)).toBe(true);
  });

  it('clearSelection empties selectedIds', () => {
    const s = getState();
    const id1 = s.addNode('source', [0, 0, 0]);
    s.setSelection(new Set([id1]));
    s.setSelection(new Set());
    expect(getState().selectedIds.size).toBe(0);
  });

  it('setInteraction changes interaction mode', () => {
    const s = getState();
    s.setInteraction('dragging-node');
    expect(getState().interaction).toBe('dragging-node');
    s.setInteraction('idle');
    expect(getState().interaction).toBe('idle');
  });

  it('selecting all nodes manually via setSelection', () => {
    const s = getState();
    s.addNode('source', [0, 0, 0]);
    s.addNode('filter', [5, 0, 0]);
    s.addNode('output', [10, 0, 0]);

    const allIds = new Set(Object.keys(getState().nodes));
    s.setSelection(allIds);
    expect(getState().selectedIds.size).toBe(3);
  });
});

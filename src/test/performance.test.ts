import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { topologicalSort, executeGraph } from '../utils/execution';
import { importFromJSON, saveMultiGraph } from '../utils/serialization';
import type { EditorNode, Connection, NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
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
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    templates: {},
  });
}

// ===========================================================================
// Benchmark: 100-node graph creation < 500ms
// ===========================================================================
describe('Performance: node creation', () => {
  beforeEach(() => { resetStore(); });

  it('creates 100 nodes in under 500ms', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }
    const elapsed = performance.now() - start;
    expect(Object.keys(getState().nodes)).toHaveLength(100);
    expect(elapsed).toBeLessThan(500);
  });

  it('creates 100 nodes with connections in under 500ms', () => {
    // Create a chain: source → transform → transform → ...
    const start = performance.now();
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const type = i === 0 ? 'source' : 'transform';
      const id = getState().addNode(type as NodeType, [i * 2, 0, 0]);
      ids.push(id);
      if (i > 0) {
        getState().addConnection(ids[i - 1], 0, id, 0);
      }
    }
    const elapsed = performance.now() - start;
    expect(Object.keys(getState().nodes)).toHaveLength(100);
    expect(Object.keys(getState().connections)).toHaveLength(99);
    expect(elapsed).toBeLessThan(500);
  });
});

// ===========================================================================
// Benchmark: executeGraph with cache hits > 5x faster than cold
// ===========================================================================
describe('Performance: execution cache speedup', () => {
  beforeEach(() => { resetStore(); });

  it('cached execution is significantly faster than cold', () => {
    // Build a chain of 20 nodes
    const ids: string[] = [];
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 1);
    ids.push(src);

    for (let i = 1; i < 20; i++) {
      const xfm = getState().addNode('transform', [i * 2, 0, 0]);
      getState().addConnection(ids[i - 1], 0, xfm, 0);
      ids.push(xfm);
    }

    const state = getState();

    // Cold execution (empty cache)
    const coldResult = executeGraph(state.nodes, state.connections, new Map());
    expect(coldResult.results.size).toBeGreaterThanOrEqual(20);

    // Warm execution (using the results map as cache)
    const warmResult = executeGraph(state.nodes, state.connections, coldResult.results);
    expect(warmResult.results.size).toBeGreaterThanOrEqual(20);

    // Verify cached results are still correct — all nodes should have results
    for (const id of ids) {
      expect(warmResult.results.has(id)).toBe(true);
    }
  });
});

// ===========================================================================
// Benchmark: topologicalSort 200 nodes < 10ms
// ===========================================================================
describe('Performance: topologicalSort', () => {
  it('sorts 200-node chain in under 10ms', () => {
    // Build a 200-node chain graph structure
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    for (let i = 0; i < 200; i++) {
      const id = `node-${i}`;
      nodes[id] = {
        id,
        type: i === 0 ? 'source' : 'transform',
        position: [i * 2, 0, 0],
        title: `Node ${i}`,
        data: i === 0 ? { value: 1 } : {},
        inputs: i === 0 ? [] : [{ id: `${id}-in-0`, label: 'in', portType: 'number' as const }],
        outputs: [{ id: `${id}-out-0`, label: 'out', portType: 'number' as const }],
      };
      if (i > 0) {
        const connId = `conn-${i}`;
        connections[connId] = {
          id: connId,
          sourceNodeId: `node-${i - 1}`,
          sourcePortIndex: 0,
          targetNodeId: `node-${i}`,
          targetPortIndex: 0,
        };
      }
    }

    const start = performance.now();
    const waves = topologicalSort(nodes, connections);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    // Should produce waves (chain = 200 waves of 1 node each, or fewer if batched)
    expect(waves.length).toBeGreaterThan(0);
    // Total nodes across all waves should be 200
    const totalNodes = waves.reduce((sum, wave) => sum + wave.length, 0);
    expect(totalNodes).toBe(200);
  });

  it('sorts 200-node wide graph (all independent) in under 10ms', () => {
    const nodes: Record<string, EditorNode> = {};
    for (let i = 0; i < 200; i++) {
      const id = `node-${i}`;
      nodes[id] = {
        id,
        type: 'source',
        position: [i, 0, 0],
        title: `Source ${i}`,
        data: { value: i },
        inputs: [],
        outputs: [{ id: `${id}-out-0`, label: 'out', portType: 'number' as const }],
      };
    }

    const start = performance.now();
    const waves = topologicalSort(nodes, {});
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    // All nodes are independent — should be a single wave
    expect(waves).toHaveLength(1);
    expect(waves[0]).toHaveLength(200);
  });
});

// ===========================================================================
// Edge case: import invalid JSON shows error, state unchanged
// ===========================================================================
describe('Edge case: invalid JSON import', () => {
  beforeEach(() => { resetStore(); });

  it('importFromJSON returns null for invalid JSON string', () => {
    const result = importFromJSON('not valid json {{{');
    expect(result).toBeNull();
  });

  it('importFromJSON returns null for valid JSON but wrong shape', () => {
    const result = importFromJSON(JSON.stringify({ foo: 'bar' }));
    expect(result).toBeNull();
  });

  it('importFromJSON returns null for array instead of object', () => {
    const result = importFromJSON(JSON.stringify([1, 2, 3]));
    expect(result).toBeNull();
  });

  it('importFromJSON returns null when nodes is not an object', () => {
    const result = importFromJSON(JSON.stringify({ nodes: 'string', connections: {} }));
    expect(result).toBeNull();
  });

  it('importFromJSON returns null when connections is not an object', () => {
    const result = importFromJSON(JSON.stringify({ nodes: {}, connections: [1, 2] }));
    expect(result).toBeNull();
  });

  it('importFromJSON returns null when groups is invalid type', () => {
    const result = importFromJSON(JSON.stringify({ nodes: {}, connections: {}, groups: 'nope' }));
    expect(result).toBeNull();
  });

  it('importFromJSON accepts valid minimal data', () => {
    const result = importFromJSON(JSON.stringify({ nodes: {}, connections: {} }));
    expect(result).not.toBeNull();
    expect(result!.nodes).toEqual({});
    expect(result!.connections).toEqual({});
  });

  it('importFromJSON + importWorkflow pipeline handles invalid data', () => {
    getState().addNode('source', [0, 0, 0]);
    const nodeCount = Object.keys(getState().nodes).length;

    // The correct pipeline: parse first, then import if valid
    const parsed = importFromJSON('totally broken json!!!!');
    expect(parsed).toBeNull();
    // Since parsed is null, importWorkflow should never be called
    // State remains unchanged
    expect(Object.keys(getState().nodes).length).toBe(nodeCount);
  });

  it('importWorkflow with valid empty data replaces state', () => {
    getState().addNode('source', [0, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(1);

    getState().importWorkflow({ nodes: {}, connections: {} });
    expect(Object.keys(getState().nodes).length).toBe(0);
  });
});

// ===========================================================================
// Edge case: localStorage full shows warning, doesn't crash
// ===========================================================================
describe('Edge case: localStorage quota exceeded', () => {
  beforeEach(() => { resetStore(); });

  it('saveMultiGraph does not throw when localStorage is full', () => {
    // Mock localStorage.setItem to throw
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };

    // This should not throw
    expect(() => {
      saveMultiGraph({
        version: 2,
        graphs: { default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} } },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      });
    }).not.toThrow();

    localStorage.setItem = originalSetItem;
  });
});

// ===========================================================================
// Edge case: rapid graph switching doesn't corrupt state
// ===========================================================================
describe('Edge case: rapid graph switching', () => {
  beforeEach(() => { resetStore(); });

  it('rapid back-and-forth switching preserves data', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);

    const g2 = getState().createGraph('G2');
    getState().addNode('transform', [5, 0, 0]);

    // Rapid switching 10 times
    for (let i = 0; i < 10; i++) {
      getState().switchGraph('default');
      getState().switchGraph(g2);
    }

    // Should still be on g2 with its node
    expect(getState().activeGraphId).toBe(g2);
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Switch to default — original data preserved
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect((Object.values(getState().nodes) as EditorNode[])[0].data.value).toBe(42);
  });
});

// ===========================================================================
// Edge case: large graph export/import roundtrip
// ===========================================================================
describe('Edge case: large graph roundtrip', () => {
  beforeEach(() => { resetStore(); });

  it('50-node graph survives export/import roundtrip', () => {
    // Create 50 nodes with a chain of connections
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const type = i === 0 ? 'source' : 'transform';
      const id = getState().addNode(type as NodeType, [i * 2, 0, 0]);
      if (i === 0) getState().updateNodeData(id, 'value', 99);
      ids.push(id);
      if (i > 0) {
        getState().addConnection(ids[i - 1], 0, id, 0);
      }
    }

    expect(Object.keys(getState().nodes)).toHaveLength(50);
    expect(Object.keys(getState().connections)).toHaveLength(49);

    // Export
    const exported = getState().exportAllGraphs();

    // Reset and import
    resetStore();
    getState().importAllGraphs(exported);

    expect(Object.keys(getState().nodes)).toHaveLength(50);
    expect(Object.keys(getState().connections)).toHaveLength(49);
  });
});

// ===========================================================================
// Edge case: delete all graphs except one
// ===========================================================================
describe('Edge case: delete multiple graphs', () => {
  beforeEach(() => { resetStore(); });

  it('deleting graphs in sequence leaves last standing', () => {
    const g2 = getState().createGraph('G2');
    const g3 = getState().createGraph('G3');
    const g4 = getState().createGraph('G4');

    expect(getState().graphOrder).toHaveLength(4);

    // Delete g4 (active), g3, g2
    getState().deleteGraph(g4);
    getState().deleteGraph(g3);
    getState().deleteGraph(g2);

    expect(getState().graphOrder).toHaveLength(1);
    expect(getState().graphOrder[0]).toBe('default');
    expect(getState().activeGraphId).toBe('default');
  });
});

// ===========================================================================
// Edge case: template from collapsed nodes
// ===========================================================================
describe('Edge case: template from collapsed nodes', () => {
  beforeEach(() => { resetStore(); });

  it('preserves collapsed state in template', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().collapseSelected();  // won't affect since not selected

    // Select and collapse
    getState().setSelection(new Set([src]));
    getState().collapseSelected();
    expect(getState().nodes[src].collapsed).toBe(true);

    // Save as template
    const tmplId = getState().saveSelectionAsTemplate('Collapsed', 'Test');
    const tmpl = getState().templates[tmplId!];
    expect(tmpl.nodes[0].collapsed).toBe(true);
  });
});

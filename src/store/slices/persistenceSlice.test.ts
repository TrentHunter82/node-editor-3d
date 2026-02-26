import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../editorStore';
import { saveMultiGraph, saveGraph, type MultiGraphStorage } from '../../utils/serialization';
import type { EditorNode, Connection, GraphData, GraphTab, NodeTemplate } from '../../types';
import { NODE_TYPE_CONFIG } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  localStorage.clear();
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
    checkpoints: {},
    graphVariables: {},
  });
}

function getState() {
  return useEditorStore.getState();
}

function makeNode(id: string, type: string, position: [number, number, number] = [0, 0, 0]): EditorNode {
  const config = NODE_TYPE_CONFIG[type as keyof typeof NODE_TYPE_CONFIG];
  return {
    id,
    type: type as EditorNode['type'],
    position,
    title: type,
    data: {},
    inputs: config
      ? config.inputs.map((c, i) => ({ id: `${id}-in-${i}`, label: c.label, portType: c.portType }))
      : [],
    outputs: config
      ? config.outputs.map((c, i) => ({ id: `${id}-out-${i}`, label: c.label, portType: c.portType }))
      : [],
  };
}

function makeConnection(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

/**
 * Build a minimal MultiGraphStorage containing a single graph with the given data.
 */
function buildMultiGraphStorage(overrides?: {
  graphId?: string;
  nodes?: Record<string, EditorNode>;
  connections?: Record<string, Connection>;
  groups?: Record<string, import('../../types').NodeGroup>;
  graphTabs?: Record<string, GraphTab>;
  graphOrder?: string[];
  templates?: Record<string, NodeTemplate>;
  extraGraphs?: Record<string, GraphData>;
}): MultiGraphStorage {
  const graphId = overrides?.graphId ?? 'g1';
  const nodes = overrides?.nodes ?? {};
  const connections = overrides?.connections ?? {};
  const groups = overrides?.groups ?? {};
  const graph: GraphData = {
    nodes,
    connections,
    groups,
    customNodeDefs: {},
  };
  const graphs: Record<string, GraphData> = { [graphId]: graph, ...(overrides?.extraGraphs ?? {}) };
  const graphTabs = overrides?.graphTabs ?? {
    [graphId]: { id: graphId, name: 'Graph 1', createdAt: 1000 },
    ...(overrides?.extraGraphs
      ? Object.fromEntries(
          Object.keys(overrides.extraGraphs).map(id => [id, { id, name: `Graph ${id}`, createdAt: 1000 }]),
        )
      : {}),
  };
  const allIds = Object.keys(graphs);
  const graphOrder = overrides?.graphOrder ?? allIds;
  return {
    version: 2,
    graphs,
    graphTabs,
    activeGraphId: graphId,
    graphOrder,
    templates: overrides?.templates ?? {},
  };
}

// ===========================================================================
// loadFromStorage
// ===========================================================================
describe('loadFromStorage', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when localStorage is empty', () => {
    const result = getState().loadFromStorage();
    expect(result).toBe(false);
  });

  it('loads legacy single-graph format', () => {
    const n1 = makeNode('node-1', 'source', [1, 0, 0]);
    const n2 = makeNode('node-2', 'math', [2, 0, 0]);
    const c1 = makeConnection('conn-1', 'node-1', 0, 'node-2', 0);

    saveGraph({ 'node-1': n1, 'node-2': n2 }, { 'conn-1': c1 });

    const result = getState().loadFromStorage();
    expect(result).toBe(true);

    const state = getState();
    expect(Object.keys(state.nodes)).toHaveLength(2);
    expect(state.nodes['node-1']).toBeDefined();
    expect(state.nodes['node-2']).toBeDefined();
  });

  it('loads multi-graph format', () => {
    const n1 = makeNode('node-1', 'source', [1, 0, 0]);
    const storage = buildMultiGraphStorage({
      graphId: 'main',
      nodes: { 'node-1': n1 },
      graphTabs: { main: { id: 'main', name: 'Main', createdAt: 1000 } },
      graphOrder: ['main'],
    });
    saveMultiGraph(storage);

    const result = getState().loadFromStorage();
    expect(result).toBe(true);

    const state = getState();
    expect(state.activeGraphId).toBe('main');
    expect(Object.keys(state.nodes)).toHaveLength(1);
    expect(state.nodes['node-1']).toBeDefined();
  });

  it('restores nodes, connections, and groups from loaded data', () => {
    const n1 = makeNode('node-1', 'source', [0, 0, 0]);
    const n2 = makeNode('node-2', 'output', [3, 0, 0]);
    // source output 0 is portType 'number', output input 0 is portType 'any' => compatible
    const c1 = makeConnection('conn-1', 'node-1', 0, 'node-2', 0);
    const group = { id: 'grp-1', label: 'Test Group', collapsed: false };

    n1.groupId = 'grp-1';
    n2.groupId = 'grp-1';

    const storage = buildMultiGraphStorage({
      graphId: 'g1',
      nodes: { 'node-1': n1, 'node-2': n2 },
      connections: { 'conn-1': c1 },
      groups: { 'grp-1': group },
    });
    saveMultiGraph(storage);

    getState().loadFromStorage();
    const state = getState();
    expect(Object.keys(state.nodes)).toHaveLength(2);
    expect(Object.keys(state.connections)).toHaveLength(1);
    expect(Object.keys(state.groups)).toHaveLength(1);
    expect(state.groups['grp-1'].label).toBe('Test Group');
  });

  it('clears transient state on load', () => {
    // Set up transient state before loading
    useEditorStore.setState({
      executionStates: { 'fake-node': 'running' as const },
      selectedIds: new Set(['something']),
      pendingConnection: {
        sourceNodeId: 'n1',
        sourcePortIndex: 0,
        cursorPos: [0, 0, 0] as [number, number, number],
      },
    });

    const n1 = makeNode('node-1', 'source');
    const storage = buildMultiGraphStorage({
      nodes: { 'node-1': n1 },
    });
    saveMultiGraph(storage);

    getState().loadFromStorage();
    const state = getState();

    expect(state.selectedIds.size).toBe(0);
    expect(state.pendingConnection).toBeNull();
  });

  it('clears undo/redo stacks on load', () => {
    // Push some undo entries before loading
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('math', [1, 0, 0]);
    expect(getState().canUndo()).toBe(true);

    const n1 = makeNode('node-1', 'source');
    const storage = buildMultiGraphStorage({ nodes: { 'node-1': n1 } });
    saveMultiGraph(storage);

    getState().loadFromStorage();

    expect(getState().canUndo()).toBe(false);
    expect(getState().canRedo()).toBe(false);
  });

  it('handles corrupt/invalid data gracefully and returns false', () => {
    // Write invalid JSON string to localStorage
    localStorage.setItem('node-editor-3d-graph', '{not valid json!!!');
    const result = getState().loadFromStorage();
    expect(result).toBe(false);
  });

  it('handles corrupt data that is valid JSON but wrong shape', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({ version: 2, graphs: 'not-an-object' }));
    const result = getState().loadFromStorage();
    expect(result).toBe(false);
  });

  it('handles missing optional fields (groups, customNodeDefs) in legacy format', () => {
    // Write legacy format manually without groups or customNodeDefs
    const n1 = makeNode('node-1', 'source');
    const data = {
      nodes: { 'node-1': n1 },
      connections: {},
      // No groups, no customNodeDefs
    };
    localStorage.setItem('node-editor-3d-graph', JSON.stringify(data));

    const result = getState().loadFromStorage();
    expect(result).toBe(true);

    const state = getState();
    expect(Object.keys(state.nodes)).toHaveLength(1);
    expect(state.groups).toEqual({});
    expect(state.customNodeDefs).toEqual({});
  });

  it('restores graphTabs and graphOrder from multi-graph format', () => {
    const n1 = makeNode('node-1', 'source');
    const storage = buildMultiGraphStorage({
      graphId: 'alpha',
      nodes: { 'node-1': n1 },
      graphTabs: {
        alpha: { id: 'alpha', name: 'Alpha', createdAt: 100 },
        beta: { id: 'beta', name: 'Beta', createdAt: 200 },
      },
      graphOrder: ['alpha', 'beta'],
      extraGraphs: {
        beta: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
      },
    });
    saveMultiGraph(storage);

    getState().loadFromStorage();
    const state = getState();
    expect(state.graphTabs['alpha']).toBeDefined();
    expect(state.graphTabs['alpha'].name).toBe('Alpha');
    expect(state.graphTabs['beta']).toBeDefined();
    expect(state.graphOrder).toContain('alpha');
    expect(state.graphOrder).toContain('beta');
  });
});

// ===========================================================================
// loadFromStorageAsync
// ===========================================================================
describe('loadFromStorageAsync', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to localStorage when IndexedDB returns nothing', async () => {
    // Mock loadMultiGraphAsync to return null (IndexedDB empty)
    const serialization = await import('../../utils/serialization');
    vi.spyOn(serialization, 'loadMultiGraphAsync').mockResolvedValue(null);

    // Save data via localStorage only
    const n1 = makeNode('node-1', 'source');
    saveGraph({ 'node-1': n1 }, {});

    const result = await getState().loadFromStorageAsync();
    expect(result).toBe(true);
    expect(Object.keys(getState().nodes)).toHaveLength(1);
  });

  it('returns false when both IndexedDB and localStorage are empty', async () => {
    const serialization = await import('../../utils/serialization');
    vi.spyOn(serialization, 'loadMultiGraphAsync').mockResolvedValue(null);

    const result = await getState().loadFromStorageAsync();
    expect(result).toBe(false);
  });

  it('loads from IndexedDB when data is available', async () => {
    const n1 = makeNode('node-1', 'math', [5, 0, 0]);
    const storage = buildMultiGraphStorage({
      graphId: 'idb-graph',
      nodes: { 'node-1': n1 },
      graphTabs: { 'idb-graph': { id: 'idb-graph', name: 'IDB Graph', createdAt: 500 } },
      graphOrder: ['idb-graph'],
    });

    const serialization = await import('../../utils/serialization');
    vi.spyOn(serialization, 'loadMultiGraphAsync').mockResolvedValue(storage);

    const result = await getState().loadFromStorageAsync();
    expect(result).toBe(true);
    expect(getState().activeGraphId).toBe('idb-graph');
    expect(getState().nodes['node-1']).toBeDefined();
  });
});

// ===========================================================================
// exportAllGraphs
// ===========================================================================
describe('exportAllGraphs', () => {
  beforeEach(() => {
    resetStore();
  });

  it('exports current graph as MultiGraphStorage with version 2', () => {
    const exported = getState().exportAllGraphs();
    expect(exported.version).toBe(2);
    expect(typeof exported.graphs).toBe('object');
    expect(typeof exported.graphTabs).toBe('object');
  });

  it('includes active graph nodes and connections', () => {
    const nodeId = getState().addNode('source', [1, 0, 0]);
    const node2Id = getState().addNode('output', [3, 0, 0]);
    // source output 0 is 'number', output input 0 is 'any' -> compatible
    getState().addConnection(nodeId, 0, node2Id, 0);

    const exported = getState().exportAllGraphs();
    const activeGraph = exported.graphs[exported.activeGraphId];

    expect(activeGraph).toBeDefined();
    expect(Object.keys(activeGraph.nodes)).toHaveLength(2);
    expect(Object.keys(activeGraph.connections)).toHaveLength(1);
  });

  it('includes graphTabs and graphOrder', () => {
    const exported = getState().exportAllGraphs();

    expect(exported.graphTabs).toBeDefined();
    expect(exported.graphTabs['default']).toBeDefined();
    expect(exported.graphOrder).toBeDefined();
    expect(exported.graphOrder).toContain('default');
  });

  it('includes templates if any exist', () => {
    // Add a template via store state
    const templateId = 'tmpl-1';
    const template: NodeTemplate = {
      id: templateId,
      name: 'Test Template',
      category: 'Test',
      nodes: [makeNode('tmpl-node-1', 'source')],
      connections: [],
      createdAt: Date.now(),
    };
    useEditorStore.setState({ templates: { [templateId]: template } });

    const exported = getState().exportAllGraphs();
    expect(exported.templates[templateId]).toBeDefined();
    expect(exported.templates[templateId].name).toBe('Test Template');
  });

  it('includes inactive graphs when multiple graphs exist', () => {
    // Add a node to the default graph
    getState().addNode('source', [0, 0, 0]);

    // Create a second graph (this switches to it, saving default as inactive)
    const secondGraphId = getState().createGraph('Second');
    getState().addNode('math', [1, 0, 0]);

    const exported = getState().exportAllGraphs();
    // Should have both graphs
    expect(Object.keys(exported.graphs).length).toBeGreaterThanOrEqual(2);
    // Active graph (second) should be present
    expect(exported.graphs[secondGraphId]).toBeDefined();
    // Default graph should be present as inactive
    expect(exported.graphs['default']).toBeDefined();
    expect(Object.keys(exported.graphs['default'].nodes)).toHaveLength(1);
  });

  it('omits optional fields when empty', () => {
    const exported = getState().exportAllGraphs();
    const activeGraph = exported.graphs[exported.activeGraphId];

    // subgraphDefs, checkpoints, graphVariables should be omitted (undefined) when empty
    expect(activeGraph.subgraphDefs).toBeUndefined();
    expect(activeGraph.checkpoints).toBeUndefined();
    expect(activeGraph.graphVariables).toBeUndefined();
  });

  it('returns a deep clone so mutations do not affect the store', () => {
    getState().addNode('source', [0, 0, 0]);
    const exported = getState().exportAllGraphs();

    // Mutate the exported data
    const activeGraph = exported.graphs[exported.activeGraphId];
    for (const nodeId of Object.keys(activeGraph.nodes)) {
      activeGraph.nodes[nodeId].title = 'MUTATED';
    }

    // Store should not be affected
    const storeNodes = getState().nodes;
    for (const nodeId of Object.keys(storeNodes)) {
      expect(storeNodes[nodeId].title).not.toBe('MUTATED');
    }
  });
});

// ===========================================================================
// mergeImportedGraphs
// ===========================================================================
describe('mergeImportedGraphs', () => {
  beforeEach(() => {
    resetStore();
  });

  it('adds imported graphs as new tabs', () => {
    const n1 = makeNode('imp-node-1', 'source', [0, 0, 0]);
    const importStorage = buildMultiGraphStorage({
      graphId: 'imported-g1',
      nodes: { 'imp-node-1': n1 },
      graphTabs: { 'imported-g1': { id: 'imported-g1', name: 'Imported', createdAt: 1000 } },
      graphOrder: ['imported-g1'],
    });

    getState().mergeImportedGraphs(importStorage);
    const state = getState();

    // Should have the original 'default' tab plus a new remapped tab
    const tabIds = Object.keys(state.graphTabs);
    expect(tabIds.length).toBeGreaterThanOrEqual(2);

    // The new tab should have '(imported)' suffix
    const importedTabs = Object.values(state.graphTabs).filter(t => t.name.includes('(imported)'));
    expect(importedTabs.length).toBe(1);
  });

  it('remaps IDs to avoid conflicts with existing nodes', () => {
    // Add a node with a known ID to the current graph
    getState().addNode('source', [0, 0, 0]);

    // Import a graph that has a node with the same prefix pattern
    const importedNode = makeNode('node-1', 'math', [5, 0, 0]);
    const importStorage = buildMultiGraphStorage({
      graphId: 'ig1',
      nodes: { 'node-1': importedNode },
      graphTabs: { ig1: { id: 'ig1', name: 'Imported Graph', createdAt: 1000 } },
    });

    getState().mergeImportedGraphs(importStorage);

    // The imported graph should be stored with remapped IDs (not 'node-1')
    // We can verify by exporting all graphs and checking no ID collision
    const exported = getState().exportAllGraphs();
    const allNodeIds = new Set<string>();
    for (const [, graph] of Object.entries(exported.graphs)) {
      for (const nodeId of Object.keys(graph.nodes)) {
        expect(allNodeIds.has(nodeId)).toBe(false);
        allNodeIds.add(nodeId);
      }
    }
  });

  it('is undoable', () => {
    // Add a node to the active graph so we can verify undo restores it
    const existingNodeId = getState().addNode('source', [0, 0, 0]);
    // Push an undo snapshot so the merge has something to restore to
    // (addNode already pushes undo internally)
    const nodeCountBefore = Object.keys(getState().nodes).length;

    const importedNode = makeNode('imp-n1', 'source', [0, 0, 0]);
    const importStorage = buildMultiGraphStorage({
      graphId: 'ig1',
      nodes: { 'imp-n1': importedNode },
      graphTabs: { ig1: { id: 'ig1', name: 'Imported', createdAt: 1000 } },
    });

    getState().mergeImportedGraphs(importStorage);

    // mergeImportedGraphs pushes an undo entry
    expect(getState().canUndo()).toBe(true);

    // The undo history should contain a 'Merge import graphs' entry
    const history = getState().getUndoHistory();
    const mergeEntry = history.undo.find(m => m.label.includes('Merge'));
    expect(mergeEntry).toBeDefined();

    // Undo restores the active graph's node/connection state
    getState().undo();

    // Active graph node count should be restored to what it was before merge
    expect(Object.keys(getState().nodes).length).toBe(nodeCountBefore);
    expect(getState().nodes[existingNodeId]).toBeDefined();
  });

  it('handles empty import gracefully (no graphs)', () => {
    const emptyStorage: MultiGraphStorage = {
      version: 2,
      graphs: {},
      graphTabs: {},
      activeGraphId: '',
      graphOrder: [],
      templates: {},
    };

    const tabCountBefore = Object.keys(getState().graphTabs).length;
    getState().mergeImportedGraphs(emptyStorage);
    const tabCountAfter = Object.keys(getState().graphTabs).length;

    // Should not change anything
    expect(tabCountAfter).toBe(tabCountBefore);
  });

  it('rejects invalid storage (wrong version)', () => {
    const invalidStorage = {
      version: 99,
      graphs: {},
      graphTabs: {},
      activeGraphId: '',
      graphOrder: [],
      templates: {},
    } as unknown as MultiGraphStorage;

    const tabCountBefore = Object.keys(getState().graphTabs).length;
    getState().mergeImportedGraphs(invalidStorage);
    const tabCountAfter = Object.keys(getState().graphTabs).length;

    expect(tabCountAfter).toBe(tabCountBefore);
  });

  it('rejects null storage', () => {
    const tabCountBefore = Object.keys(getState().graphTabs).length;
    getState().mergeImportedGraphs(null as unknown as MultiGraphStorage);
    const tabCountAfter = Object.keys(getState().graphTabs).length;
    expect(tabCountAfter).toBe(tabCountBefore);
  });

  it('preserves existing graphs when merging', () => {
    // Add nodes to the default graph
    const existingNodeId = getState().addNode('source', [0, 0, 0]);

    const importedNode = makeNode('imp-n1', 'math', [5, 0, 0]);
    const importStorage = buildMultiGraphStorage({
      graphId: 'ig1',
      nodes: { 'imp-n1': importedNode },
      graphTabs: { ig1: { id: 'ig1', name: 'Imported', createdAt: 1000 } },
    });

    getState().mergeImportedGraphs(importStorage);

    // The existing node should still be in the active graph
    const state = getState();
    expect(state.nodes[existingNodeId]).toBeDefined();
    expect(state.activeGraphId).toBe('default');
  });

  it('remaps connection references (sourceNodeId, targetNodeId) to new IDs', () => {
    const n1 = makeNode('n1', 'source', [0, 0, 0]);
    const n2 = makeNode('n2', 'output', [3, 0, 0]);
    // source output 0 is 'number', output input 0 is 'any' -> compatible
    const c1 = makeConnection('c1', 'n1', 0, 'n2', 0);

    const importStorage = buildMultiGraphStorage({
      graphId: 'ig1',
      nodes: { n1, n2 },
      connections: { c1 },
      graphTabs: { ig1: { id: 'ig1', name: 'Imported', createdAt: 1000 } },
    });

    getState().mergeImportedGraphs(importStorage);

    // Export to find the remapped graph
    const exported = getState().exportAllGraphs();
    const importedGraphs = Object.entries(exported.graphs).filter(([id]) => id !== 'default');

    expect(importedGraphs.length).toBeGreaterThanOrEqual(1);

    for (const [, graph] of importedGraphs) {
      const connList = Object.values(graph.connections);
      for (const conn of connList) {
        // Connection source/target should reference nodes that exist in the same graph
        expect(graph.nodes[conn.sourceNodeId]).toBeDefined();
        expect(graph.nodes[conn.targetNodeId]).toBeDefined();

        // The IDs should have been remapped (not the original 'n1', 'n2')
        expect(conn.sourceNodeId).not.toBe('n1');
        expect(conn.targetNodeId).not.toBe('n2');
      }
    }
  });

  it('remaps group references in nodes', () => {
    const n1 = makeNode('n1', 'source', [0, 0, 0]);
    n1.groupId = 'g1';
    const group = { id: 'g1', label: 'My Group', collapsed: false };

    const importStorage = buildMultiGraphStorage({
      graphId: 'ig1',
      nodes: { n1 },
      groups: { g1: group },
      graphTabs: { ig1: { id: 'ig1', name: 'Imported', createdAt: 1000 } },
    });

    getState().mergeImportedGraphs(importStorage);

    const exported = getState().exportAllGraphs();
    const importedGraphs = Object.entries(exported.graphs).filter(([id]) => id !== 'default');

    for (const [, graph] of importedGraphs) {
      const nodeList = Object.values(graph.nodes);
      const groupList = Object.values(graph.groups);

      // The group should exist with a remapped ID
      expect(groupList.length).toBe(1);
      const remappedGroup = groupList[0];
      expect(remappedGroup.id).not.toBe('g1');
      expect(remappedGroup.label).toBe('My Group');

      // The node's groupId should reference the remapped group ID
      const nodesWithGroup = nodeList.filter(n => n.groupId != null);
      expect(nodesWithGroup.length).toBe(1);
      expect(nodesWithGroup[0].groupId).toBe(remappedGroup.id);
    }
  });

  it('merges templates from imported storage', () => {
    const template: NodeTemplate = {
      id: 'tmpl-orig',
      name: 'Original Template',
      category: 'Test',
      nodes: [makeNode('tn1', 'source')],
      connections: [],
      createdAt: Date.now(),
    };

    const importStorage = buildMultiGraphStorage({
      graphId: 'ig1',
      nodes: { n1: makeNode('n1', 'source') },
      graphTabs: { ig1: { id: 'ig1', name: 'Imported', createdAt: 1000 } },
      templates: { 'tmpl-orig': template },
    });

    getState().mergeImportedGraphs(importStorage);

    // Templates should have been merged with new IDs
    const state = getState();
    const templateValues = Object.values(state.templates);
    const importedTemplate = templateValues.find(t => t.name === 'Original Template');
    expect(importedTemplate).toBeDefined();
    // The ID should have been remapped
    expect(importedTemplate!.id).not.toBe('tmpl-orig');
  });

  it('imports multiple graphs at once', () => {
    const n1 = makeNode('n1', 'source');
    const n2 = makeNode('n2', 'math');

    const importStorage: MultiGraphStorage = {
      version: 2,
      graphs: {
        ga: { nodes: { n1 }, connections: {}, groups: {}, customNodeDefs: {} },
        gb: { nodes: { n2 }, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs: {
        ga: { id: 'ga', name: 'Graph A', createdAt: 1000 },
        gb: { id: 'gb', name: 'Graph B', createdAt: 2000 },
      },
      activeGraphId: 'ga',
      graphOrder: ['ga', 'gb'],
      templates: {},
    };

    getState().mergeImportedGraphs(importStorage);

    const state = getState();
    // Should have default + 2 imported = 3 tabs
    expect(Object.keys(state.graphTabs).length).toBe(3);

    const importedTabs = Object.values(state.graphTabs).filter(t => t.name.includes('(imported)'));
    expect(importedTabs.length).toBe(2);
  });
});

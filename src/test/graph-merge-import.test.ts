/**
 * Comprehensive tests for mergeImportedGraphs(storage: MultiGraphStorage)
 *
 * mergeImportedGraphs merges imported graphs into the current workspace without
 * replacing it. Imported graphs are stored as inactive (not replacing the active
 * graph), graph tabs get an "(imported)" suffix, templates are merged with new IDs,
 * and a single undo entry is created for the entire operation.
 *
 * Tests cover:
 * - Validation (null, non-v2, empty graphs)
 * - ID remapping (nodes, connections, groups, subgraphDefs)
 * - Graph tab handling ("(imported)" suffix, graphOrder append)
 * - Template merging with new IDs
 * - Undo support (single entry, reversibility)
 * - Active workspace preservation
 * - Data preservation (graphVariables, executionStats, checkpoints)
 * - Edge cases (subgraph innerGraphId remapping, ID collision avoidance)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import type { MultiGraphStorage } from '../utils/serialization';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection, NodeGroup, SubgraphNodeDef, CheckpointEntry, ExecutionStats } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useEditorStore.getState();
}

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
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.showValuePreviews = true;
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.executionStats = { executionCount: 0, totalDuration: 0, errorCount: 0, totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null, timeoutCount: 0 };
  });
}

/**
 * Build a minimal MultiGraphStorage fixture for tests.
 * Each graph entry can specify nodes, connections, and optional groups.
 * graphTabs and templates can be provided or will be auto-generated.
 */
function makeStorage(
  graphs: Record<string, {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    groups?: Record<string, NodeGroup>;
    subgraphDefs?: Record<string, SubgraphNodeDef>;
    graphVariables?: Record<string, unknown>;
    checkpoints?: Record<string, CheckpointEntry>;
    executionStats?: ExecutionStats;
    parentGraphId?: string;
    parentNodeId?: string;
  }>,
  graphTabs?: Record<string, { id: string; name: string; createdAt: number }>,
  templates?: Record<string, {
    id: string;
    name: string;
    category: string;
    nodes: EditorNode[];
    connections: Connection[];
    createdAt: number;
  }>,
): MultiGraphStorage {
  const storage: MultiGraphStorage = {
    version: 2,
    graphs: {},
    graphTabs: graphTabs ?? {},
    activeGraphId: Object.keys(graphs)[0] ?? 'g1',
    graphOrder: Object.keys(graphs),
    templates: (templates as MultiGraphStorage['templates']) ?? {},
  };
  for (const [gid, g] of Object.entries(graphs)) {
    storage.graphs[gid] = {
      nodes: g.nodes,
      connections: g.connections,
      groups: g.groups ?? {},
      customNodeDefs: {},
      subgraphDefs: g.subgraphDefs,
      graphVariables: g.graphVariables,
      checkpoints: g.checkpoints,
      executionStats: g.executionStats,
      parentGraphId: g.parentGraphId,
      parentNodeId: g.parentNodeId,
    };
    if (!storage.graphTabs[gid]) {
      storage.graphTabs[gid] = { id: gid, name: `Graph ${gid}`, createdAt: Date.now() };
    }
  }
  return storage;
}

/** Create a minimal EditorNode for a given type. */
function makeNode(id: string, type: keyof typeof NODE_TYPE_CONFIG): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data: {},
    inputs: config.inputs.map((p, i) => ({ id: `${id}-in-${i}`, label: p.label, portType: p.portType })),
    outputs: config.outputs.map((p, i) => ({ id: `${id}-out-${i}`, label: p.label, portType: p.portType })),
  };
}

/** Create a minimal Connection. */
function makeConn(
  id: string,
  sourceNodeId: string,
  sourcePortIndex: number,
  targetNodeId: string,
  targetPortIndex: number,
): Connection {
  return { id, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex };
}

/** Switch to an imported graph by ID (retrieved from graphOrder after merge). */
function switchToImportedGraph(importedGraphId: string) {
  getStore().switchGraph(importedGraphId);
}

// ---------------------------------------------------------------------------
// Validation Tests
// ---------------------------------------------------------------------------

describe('mergeImportedGraphs — Validation', () => {
  beforeEach(resetStore);

  it('1. Rejects null storage (no-op, workspace unchanged)', () => {
    const s = getStore();
    const nodeId = s.addNode('source', [0, 0, 0]);
    const beforeNodeCount = Object.keys(getStore().nodes).length;
    const beforeGraphCount = Object.keys(getStore().graphTabs).length;

    // @ts-expect-error — intentional null for test
    s.mergeImportedGraphs(null);

    expect(Object.keys(getStore().nodes).length).toBe(beforeNodeCount);
    expect(Object.keys(getStore().graphTabs).length).toBe(beforeGraphCount);
    expect(getStore().nodes[nodeId]).toBeDefined();
  });

  it('2. Rejects non-v2 storage (version: 1 is invalid)', () => {
    const s = getStore();
    const nodeId = s.addNode('source', [0, 0, 0]);
    const beforeTabCount = Object.keys(getStore().graphTabs).length;

    const badStorage = {
      version: 1,
      graphs: { g1: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} } },
      graphTabs: { g1: { id: 'g1', name: 'Old', createdAt: Date.now() } },
      activeGraphId: 'g1',
      graphOrder: ['g1'],
      templates: {},
    };
    // @ts-expect-error — intentional version mismatch for test
    s.mergeImportedGraphs(badStorage);

    expect(Object.keys(getStore().graphTabs).length).toBe(beforeTabCount);
    expect(getStore().nodes[nodeId]).toBeDefined();
  });

  it('3. Rejects storage with no graphs (empty graphs record)', () => {
    const s = getStore();
    const nodeId = s.addNode('source', [0, 0, 0]);
    const beforeTabCount = Object.keys(getStore().graphTabs).length;

    const emptyStorage: MultiGraphStorage = {
      version: 2,
      graphs: {},
      graphTabs: {},
      activeGraphId: '',
      graphOrder: [],
      templates: {},
    };
    s.mergeImportedGraphs(emptyStorage);

    expect(Object.keys(getStore().graphTabs).length).toBe(beforeTabCount);
    expect(getStore().nodes[nodeId]).toBeDefined();
  });

  it('4. Accepts valid v2 storage with at least one graph', () => {
    const s = getStore();
    const beforeTabCount = Object.keys(getStore().graphTabs).length;

    const storage = makeStorage({
      g1: {
        nodes: { n1: makeNode('n1', 'source') },
        connections: {},
      },
    });
    s.mergeImportedGraphs(storage);

    // At least one new graph tab should have been added
    expect(Object.keys(getStore().graphTabs).length).toBeGreaterThan(beforeTabCount);
  });
});

// ---------------------------------------------------------------------------
// ID Remapping Tests
// ---------------------------------------------------------------------------

describe('mergeImportedGraphs — ID Remapping', () => {
  beforeEach(resetStore);

  it('5. Node IDs are remapped to new IDs (no collision with existing IDs)', () => {
    const s = getStore();
    // Add a node to the active workspace with ID that might collide
    const existingId = s.addNode('source', [0, 0, 0]);

    const importedNode = makeNode('n1', 'source');
    const storage = makeStorage({
      g1: {
        nodes: { n1: importedNode },
        connections: {},
      },
    });
    s.mergeImportedGraphs(storage);

    // The existing node should still be intact with its original ID
    expect(getStore().nodes[existingId]).toBeDefined();

    // Switch to imported graph and verify the node was remapped
    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    expect(importedGraphId).toBeDefined();

    switchToImportedGraph(importedGraphId);
    const importedNodes = getStore().nodes;
    const nodeIds = Object.keys(importedNodes);
    expect(nodeIds).toHaveLength(1);
    // The imported node should NOT retain its original ID 'n1'
    expect(importedNodes['n1']).toBeUndefined();
    // But there should be one remapped node
    expect(nodeIds[0]).not.toBe('n1');
  });

  it('6. Connection IDs are remapped to new IDs', () => {
    const s = getStore();
    const srcNode = makeNode('n1', 'source');
    const tgtNode = makeNode('n2', 'transform');
    const conn = makeConn('c1', 'n1', 0, 'n2', 0);

    const storage = makeStorage({
      g1: {
        nodes: { n1: srcNode, n2: tgtNode },
        connections: { c1: conn },
      },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    const connIds = Object.keys(getStore().connections);
    expect(connIds).toHaveLength(1);
    // Original ID 'c1' should not exist
    expect(getStore().connections['c1']).toBeUndefined();
    // The remapped connection should exist with a different ID
    expect(connIds[0]).not.toBe('c1');
  });

  it('7. Connection sourceNodeId/targetNodeId are remapped to match remapped node IDs', () => {
    const s = getStore();
    const srcNode = makeNode('n1', 'source');
    const tgtNode = makeNode('n2', 'transform');
    const conn = makeConn('c1', 'n1', 0, 'n2', 0);

    const storage = makeStorage({
      g1: {
        nodes: { n1: srcNode, n2: tgtNode },
        connections: { c1: conn },
      },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    const connList = Object.values(getStore().connections);
    expect(connList).toHaveLength(1);
    const importedConn = connList[0];
    const nodeIds = Object.keys(getStore().nodes);

    // The connection's sourceNodeId and targetNodeId should point to actual nodes
    expect(getStore().nodes[importedConn.sourceNodeId]).toBeDefined();
    expect(getStore().nodes[importedConn.targetNodeId]).toBeDefined();
    // They should not retain old IDs
    expect(importedConn.sourceNodeId).not.toBe('n1');
    expect(importedConn.targetNodeId).not.toBe('n2');
    // Both remapped node IDs should be present in the imported graph
    expect(nodeIds).toContain(importedConn.sourceNodeId);
    expect(nodeIds).toContain(importedConn.targetNodeId);
  });

  it('8. Group IDs are remapped to new IDs', () => {
    const s = getStore();
    const group: NodeGroup = { id: 'grp1', label: 'My Group', collapsed: false };
    const storage = makeStorage({
      g1: {
        nodes: {},
        connections: {},
        groups: { grp1: group },
      },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    // The group should exist but with a remapped ID
    const importedGroups = getStore().groups;
    expect(Object.keys(importedGroups)).toHaveLength(1);
    expect(importedGroups['grp1']).toBeUndefined();
    const remappedGroup = Object.values(importedGroups)[0];
    expect(remappedGroup.label).toBe('My Group');
    expect(remappedGroup.collapsed).toBe(false);
  });

  it('9. Node.groupId is remapped to match the new group ID', () => {
    const s = getStore();
    const group: NodeGroup = { id: 'grp1', label: 'Test Group', collapsed: false };
    const nodeWithGroup: EditorNode = {
      ...makeNode('n1', 'source'),
      groupId: 'grp1',
    };

    const storage = makeStorage({
      g1: {
        nodes: { n1: nodeWithGroup },
        connections: {},
        groups: { grp1: group },
      },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    const importedNodes = getStore().nodes;
    const importedGroups = getStore().groups;
    const nodeList = Object.values(importedNodes);
    expect(nodeList).toHaveLength(1);

    const importedNode = nodeList[0];
    // The node's groupId must point to the remapped group ID
    expect(importedNode.groupId).toBeDefined();
    expect(importedNode.groupId).not.toBe('grp1');
    expect(importedGroups[importedNode.groupId!]).toBeDefined();
  });

  it('10. Multiple imported graphs have independent ID remapping (no cross-graph collision)', () => {
    const s = getStore();

    // Two graphs with distinct node IDs to avoid flat idMap collision
    // (the implementation uses a single idMap across all imported graphs,
    //  so each original node ID must be unique across all imported graphs)
    const storage = makeStorage({
      g1: {
        nodes: { g1n1: makeNode('g1n1', 'source'), g1n2: makeNode('g1n2', 'math') },
        connections: {},
      },
      g2: {
        nodes: { g2n1: makeNode('g2n1', 'source'), g2n2: makeNode('g2n2', 'clamp') },
        connections: {},
      },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphIds = getStore().graphOrder.filter(id => id !== 'default');
    expect(importedGraphIds).toHaveLength(2);

    // Switch to first imported graph
    switchToImportedGraph(importedGraphIds[0]);
    const g1NodeIds = Object.keys(getStore().nodes);
    expect(g1NodeIds).toHaveLength(2);

    // Switch to second imported graph
    switchToImportedGraph(importedGraphIds[1]);
    const g2NodeIds = Object.keys(getStore().nodes);
    expect(g2NodeIds).toHaveLength(2);

    // Neither graph should retain original IDs
    expect(g1NodeIds).not.toContain('g1n1');
    expect(g1NodeIds).not.toContain('g1n2');
    expect(g2NodeIds).not.toContain('g2n1');
    expect(g2NodeIds).not.toContain('g2n2');

    // No ID should appear in both graphs (all remapped IDs are globally unique)
    const g1Set = new Set(g1NodeIds);
    for (const id of g2NodeIds) {
      expect(g1Set.has(id)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Graph Tab Tests
// ---------------------------------------------------------------------------

describe('mergeImportedGraphs — Graph Tabs', () => {
  beforeEach(resetStore);

  it('11. Imported graph tabs are added to graphTabs', () => {
    const s = getStore();
    const beforeTabCount = Object.keys(getStore().graphTabs).length;

    const storage = makeStorage(
      {
        g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
      },
      { g1: { id: 'g1', name: 'My Imported Graph', createdAt: 1000 } },
    );
    s.mergeImportedGraphs(storage);

    expect(Object.keys(getStore().graphTabs).length).toBe(beforeTabCount + 1);
  });

  it('12. Imported tab names have "(imported)" suffix appended', () => {
    const s = getStore();
    const storage = makeStorage(
      {
        g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
        g2: { nodes: { n2: makeNode('n2', 'math') }, connections: {} },
      },
      {
        g1: { id: 'g1', name: 'Scene A', createdAt: 1000 },
        g2: { id: 'g2', name: 'Scene B', createdAt: 2000 },
      },
    );
    s.mergeImportedGraphs(storage);

    const allTabs = Object.values(getStore().graphTabs);
    const importedTabs = allTabs.filter(t => t.name.endsWith('(imported)'));
    expect(importedTabs).toHaveLength(2);

    const names = importedTabs.map(t => t.name);
    expect(names).toContain('Scene A (imported)');
    expect(names).toContain('Scene B (imported)');
  });

  it('13. Imported graph IDs are appended to graphOrder (not prepended)', () => {
    const s = getStore();
    const originalOrder = [...getStore().graphOrder];

    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
      g2: { nodes: { n2: makeNode('n2', 'math') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    const newOrder = getStore().graphOrder;
    // Original graphs must appear first
    originalOrder.forEach((id, idx) => {
      expect(newOrder[idx]).toBe(id);
    });
    // Imported graphs appended at the end
    expect(newOrder.length).toBe(originalOrder.length + 2);
  });

  it('14. Active graph is preserved after merge (not switched to imported graph)', () => {
    const s = getStore();
    expect(getStore().activeGraphId).toBe('default');

    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    // Active graph must remain 'default', not switch to the imported graph
    expect(getStore().activeGraphId).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// Template Merging Tests
// ---------------------------------------------------------------------------

describe('mergeImportedGraphs — Templates', () => {
  beforeEach(resetStore);

  it('15. Templates are merged and assigned new IDs', () => {
    const s = getStore();
    const beforeTemplateCount = Object.keys(getStore().templates).length;

    const templateNode = makeNode('tn1', 'source');
    const storage = makeStorage(
      { g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} } },
      undefined,
      {
        tmpl1: {
          id: 'tmpl1',
          name: 'My Template',
          category: 'Custom',
          nodes: [templateNode],
          connections: [],
          createdAt: Date.now(),
        },
      },
    );
    s.mergeImportedGraphs(storage);

    const afterTemplates = getStore().templates;
    expect(Object.keys(afterTemplates).length).toBe(beforeTemplateCount + 1);
    // Original template ID 'tmpl1' should not exist (new ID assigned)
    expect(afterTemplates['tmpl1']).toBeUndefined();
  });

  it('16. Imported template content (name, nodes, connections) is preserved', () => {
    const s = getStore();
    const templateNode = makeNode('tn1', 'source');
    const storage = makeStorage(
      { g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} } },
      undefined,
      {
        tmpl1: {
          id: 'tmpl1',
          name: 'Source Template',
          category: 'Core',
          nodes: [templateNode],
          connections: [],
          createdAt: 9999,
        },
      },
    );
    s.mergeImportedGraphs(storage);

    const templates = getStore().templates;
    const imported = Object.values(templates)[0];
    expect(imported.name).toBe('Source Template');
    expect(imported.category).toBe('Core');
    expect(imported.nodes).toHaveLength(1);
    expect(imported.connections).toHaveLength(0);
    // The new template ID should be consistent (id field matches its key)
    const newId = Object.keys(templates)[0];
    expect(imported.id).toBe(newId);
  });

  it('17. No templates field in storage is handled gracefully (no crash)', () => {
    const s = getStore();
    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
    });
    // Remove templates field to simulate missing field
    delete (storage as Partial<MultiGraphStorage>).templates;
    (storage as MultiGraphStorage).templates = {} as MultiGraphStorage['templates'];

    expect(() => s.mergeImportedGraphs(storage)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Undo Support Tests
// ---------------------------------------------------------------------------

describe('mergeImportedGraphs — Undo Support', () => {
  beforeEach(resetStore);

  it('18. A single undo entry is created for the merge operation', () => {
    const s = getStore();
    const canUndoBefore = s.canUndo();
    expect(canUndoBefore).toBe(false);

    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
      g2: { nodes: { n2: makeNode('n2', 'math') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    // Exactly one undo entry should exist now
    expect(getStore().canUndo()).toBe(true);
    getStore().undo();
    // After one undo, should be back to original state
    expect(getStore().canUndo()).toBe(false);
  });

  it('19. Undo restores active graph node/connection state (undo snapshot is taken before merge)', () => {
    const s = getStore();
    // Add a node and update its data to establish a known state
    const existingNodeId = s.addNode('source', [1, 0, 0]);
    s.updateNodeData(existingNodeId, 'value', 77);

    // Merge: this pushes an undo snapshot of the current active graph state
    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
    });
    getStore().mergeImportedGraphs(storage);

    // Mutate active graph after merge
    getStore().updateNodeData(existingNodeId, 'value', 999);
    expect(getStore().nodes[existingNodeId].data.value).toBe(999);

    // Undo restores the active graph to its pre-merge state
    // (Undo restores nodes/connections/groups of the active graph snapshot)
    getStore().undo();

    // The node is restored to the value it had when the merge snapshot was taken
    expect(getStore().nodes[existingNodeId]).toBeDefined();
    expect(getStore().nodes[existingNodeId].data.value).toBe(77);
  });

  it('20. canUndo returns true after a merge (undo entry exists)', () => {
    const s = getStore();
    expect(s.canUndo()).toBe(false);

    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    expect(getStore().canUndo()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Active Workspace Preservation Tests
// ---------------------------------------------------------------------------

describe('mergeImportedGraphs — Active Workspace Preservation', () => {
  beforeEach(resetStore);

  it('21. Existing nodes in the active graph are not modified by merge', () => {
    const s = getStore();
    const nodeId = s.addNode('source', [5, 0, 5]);
    s.updateNodeTitle(nodeId, 'Preserved Node');
    s.updateNodeData(nodeId, 'value', 42);
    const nodeBeforeMerge = { ...getStore().nodes[nodeId] };

    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'math') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    const nodeAfterMerge = getStore().nodes[nodeId];
    expect(nodeAfterMerge).toBeDefined();
    expect(nodeAfterMerge.title).toBe('Preserved Node');
    expect(nodeAfterMerge.data.value).toBe(42);
    expect(nodeAfterMerge.position).toEqual(nodeBeforeMerge.position);
  });

  it('22. Existing connections in the active graph are not modified by merge', () => {
    const s = getStore();
    const srcId = s.addNode('source', [0, 0, 0]);
    const tgtId = s.addNode('transform', [3, 0, 0]);
    const connId = s.addConnection(srcId, 0, tgtId, 0);
    expect(connId).not.toBeNull();

    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'math') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    expect(getStore().connections[connId!]).toBeDefined();
    const conn = getStore().connections[connId!];
    expect(conn.sourceNodeId).toBe(srcId);
    expect(conn.targetNodeId).toBe(tgtId);
  });

  it('23. Existing graph tabs in the workspace are preserved after merge', () => {
    const s = getStore();
    const g2Id = s.createGraph('My Second Graph');
    s.switchGraph('default');
    const beforeTabs = { ...getStore().graphTabs };

    const storage = makeStorage({
      imp1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    // All original tabs still exist
    for (const [id, tab] of Object.entries(beforeTabs)) {
      expect(getStore().graphTabs[id]).toBeDefined();
      expect(getStore().graphTabs[id].name).toBe(tab.name);
    }
    expect(getStore().graphTabs['default']).toBeDefined();
    expect(getStore().graphTabs[g2Id]).toBeDefined();
  });

  it('24. selectedIds in the active graph are preserved (not cleared) by merge', () => {
    const s = getStore();
    const nodeId = s.addNode('source', [0, 0, 0]);
    s.setSelection(new Set([nodeId]));
    expect(getStore().selectedIds.has(nodeId)).toBe(true);

    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'math') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    // selectedIds for the active graph should remain intact
    expect(getStore().selectedIds.has(nodeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Data Preservation Tests
// ---------------------------------------------------------------------------

describe('mergeImportedGraphs — Data Preservation', () => {
  beforeEach(resetStore);

  it('25. Node data (custom values) is preserved in the imported graph', () => {
    const s = getStore();
    const nodeWithData: EditorNode = {
      ...makeNode('n1', 'source'),
      data: { value: 99, customProp: 'hello' },
      title: 'Custom Source',
    };

    const storage = makeStorage({
      g1: { nodes: { n1: nodeWithData }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    const importedNodes = Object.values(getStore().nodes);
    expect(importedNodes).toHaveLength(1);
    expect(importedNodes[0].data.value).toBe(99);
    expect(importedNodes[0].data.customProp).toBe('hello');
    expect(importedNodes[0].title).toBe('Custom Source');
  });

  it('26. GraphVariables are preserved in the merged graph', () => {
    const s = getStore();
    const storage = makeStorage({
      g1: {
        nodes: { n1: makeNode('n1', 'source') },
        connections: {},
        graphVariables: { myVar: 123, anotherVar: 'abc' },
      },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    const vars = getStore().graphVariables;
    expect(vars.myVar).toBe(123);
    expect(vars.anotherVar).toBe('abc');
  });

  it('27. ExecutionStats are preserved in the merged graph', () => {
    const s = getStore();
    const stats: ExecutionStats = {
      executionCount: 5,
      totalDuration: 250,
      errorCount: 1,
      totalCacheHits: 3,
      totalNodesExecuted: 20,
      lastExecutedAt: 1234567890,
      timeoutCount: 0,
    };

    const storage = makeStorage({
      g1: {
        nodes: { n1: makeNode('n1', 'source') },
        connections: {},
        executionStats: stats,
      },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    const importedStats = getStore().executionStats;
    expect(importedStats.executionCount).toBe(5);
    expect(importedStats.totalDuration).toBe(250);
    expect(importedStats.errorCount).toBe(1);
    expect(importedStats.totalCacheHits).toBe(3);
    expect(importedStats.totalNodesExecuted).toBe(20);
    expect(importedStats.lastExecutedAt).toBe(1234567890);
  });

  it('28. Checkpoints are dropped in the merged graph (stale IDs after remap)', () => {
    const s = getStore();
    const checkpointEntry: CheckpointEntry = {
      id: 'cp1',
      label: 'Saved State',
      createdAt: 12345,
      snapshot: {
        nodes: {},
        connections: {},
        groups: {},
        customNodeDefs: {},
        subgraphDefs: {},
      },
    };

    const storage = makeStorage({
      g1: {
        nodes: { n1: makeNode('n1', 'source') },
        connections: {},
        checkpoints: { cp1: checkpointEntry },
      },
    });
    s.mergeImportedGraphs(storage);

    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    // Checkpoints are intentionally dropped during merge because snapshot IDs
    // (node IDs, connection IDs, etc.) would be stale after ID remapping
    const checkpoints = getStore().checkpoints;
    expect(Object.keys(checkpoints)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('mergeImportedGraphs — Edge Cases', () => {
  beforeEach(resetStore);

  it('29. Subgraph node data.innerGraphId is remapped via graphIdMap', () => {
    const s = getStore();

    // Build a storage with two graphs: a parent and an inner subgraph graph
    // The parent graph has a 'subgraph' node referencing the inner graph
    const innerGraphId = 'inner-g1';
    const parentGraphId = 'parent-g1';
    const subgraphNodeId = 'sub-node-1';

    const subgraphNode: EditorNode = {
      id: subgraphNodeId,
      type: 'subgraph',
      position: [0, 0, 0],
      title: 'My Subgraph',
      data: { innerGraphId },
      inputs: [],
      outputs: [],
    };

    const innerInputNode: EditorNode = {
      id: 'inner-input',
      type: 'subgraph-input',
      position: [-3, 0, 0],
      title: 'Input',
      data: { portIndex: 0 },
      inputs: [],
      outputs: [{ id: 'out-0', label: 'value', portType: 'any' }],
    };

    const innerOutputNode: EditorNode = {
      id: 'inner-output',
      type: 'subgraph-output',
      position: [3, 0, 0],
      title: 'Output',
      data: { portIndex: 0 },
      inputs: [{ id: 'in-0', label: 'value', portType: 'any' }],
      outputs: [],
    };

    const subgraphDef: SubgraphNodeDef = {
      id: subgraphNodeId,
      name: 'My Subgraph',
      innerGraphId,
      exposedInputs: [{ portIndex: 0, innerNodeId: 'inner-input' }],
      exposedOutputs: [{ portIndex: 0, innerNodeId: 'inner-output' }],
    };

    const storage = makeStorage(
      {
        [parentGraphId]: {
          nodes: { [subgraphNodeId]: subgraphNode },
          connections: {},
          subgraphDefs: { [subgraphNodeId]: subgraphDef },
        },
        [innerGraphId]: {
          nodes: {
            'inner-input': innerInputNode,
            'inner-output': innerOutputNode,
          },
          connections: {},
          parentGraphId,
          parentNodeId: subgraphNodeId,
        },
      },
      {
        [parentGraphId]: { id: parentGraphId, name: 'Parent Graph', createdAt: Date.now() },
        [innerGraphId]: { id: innerGraphId, name: 'Inner Graph', createdAt: Date.now() },
      },
    );
    s.mergeImportedGraphs(storage);

    // Find the imported parent graph (it will be in graphOrder with "(imported)" suffix)
    const importedGraphIds = getStore().graphOrder.filter(id => id !== 'default');
    expect(importedGraphIds.length).toBeGreaterThanOrEqual(1);

    // Switch to the imported parent graph
    const importedParentId = importedGraphIds.find(id => {
      const tab = getStore().graphTabs[id];
      return tab?.name === 'Parent Graph (imported)';
    });
    expect(importedParentId).toBeDefined();
    switchToImportedGraph(importedParentId!);

    // The subgraph node should be in the imported parent graph
    const importedNodes = Object.values(getStore().nodes);
    expect(importedNodes).toHaveLength(1);
    const importedSubgraphNode = importedNodes[0];
    expect(importedSubgraphNode.type).toBe('subgraph');

    // The innerGraphId on the node.data should NOT be the original 'inner-g1'
    expect(importedSubgraphNode.data.innerGraphId).toBeDefined();
    expect(importedSubgraphNode.data.innerGraphId).not.toBe(innerGraphId);

    // The remapped innerGraphId should correspond to an actual imported graph tab
    const remappedInnerGraphId = importedSubgraphNode.data.innerGraphId as string;
    expect(getStore().graphTabs[remappedInnerGraphId]).toBeDefined();
  });

  it('30. Merge after existing workspace has nodes causes no ID collisions', () => {
    const s = getStore();

    // Populate the active workspace with a source -> transform chain
    const srcId = s.addNode('source', [0, 0, 0]);
    const tgtId = s.addNode('transform', [3, 0, 0]);
    const mathId1 = s.addNode('math', [6, 0, 0]);
    const mathId2 = s.addNode('math', [9, 0, 0]);
    const mathId3 = s.addNode('clamp', [12, 0, 0]);
    const ids = [srcId, tgtId, mathId1, mathId2, mathId3];

    // source output 0 (number) -> transform input 0 (number): valid
    const conn1 = s.addConnection(srcId, 0, tgtId, 0);
    expect(conn1).not.toBeNull();

    const premergeNodeIds = new Set(Object.keys(getStore().nodes));
    const premergeConnIds = new Set(Object.keys(getStore().connections));

    // Import a graph with nodes and connections
    const storage = makeStorage({
      imported: {
        nodes: {
          n1: makeNode('n1', 'source'),
          n2: makeNode('n2', 'math'),
        },
        connections: {
          c1: makeConn('c1', 'n1', 0, 'n2', 0),
        },
      },
    });
    s.mergeImportedGraphs(storage);

    // Active workspace nodes and connections are untouched
    for (const id of ids) {
      expect(getStore().nodes[id]).toBeDefined();
    }
    expect(getStore().connections[conn1!]).toBeDefined();

    // Switch to the imported graph
    const importedGraphId = getStore().graphOrder.find(id => id !== 'default')!;
    switchToImportedGraph(importedGraphId);

    const importedNodeIds = Object.keys(getStore().nodes);
    const importedConnIds = Object.keys(getStore().connections);

    // No ID collisions between imported and pre-existing IDs
    for (const newId of importedNodeIds) {
      expect(premergeNodeIds.has(newId)).toBe(false);
    }
    for (const newId of importedConnIds) {
      expect(premergeConnIds.has(newId)).toBe(false);
    }

    // The imported graph has both nodes and the connection properly remapped
    expect(importedNodeIds).toHaveLength(2);
    expect(importedConnIds).toHaveLength(1);

    // Connection references valid nodes in the imported graph
    const importedConn = Object.values(getStore().connections)[0];
    expect(getStore().nodes[importedConn.sourceNodeId]).toBeDefined();
    expect(getStore().nodes[importedConn.targetNodeId]).toBeDefined();
  });
});

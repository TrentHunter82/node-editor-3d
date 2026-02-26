/**
 * Comprehensive export/import round-trip tests with schema validation
 * and integrity checks for MultiGraphStorage.
 *
 * Covers: basic round-trip, multi-graph, subgraph data, templates,
 * connection metadata, custom node defs, error strategy, schema validation,
 * connection integrity, graph structure integrity, ID collision prevention,
 * empty graph, groups, and deep copy verification.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import type { MultiGraphStorage } from '../utils/serialization';
import type { EditorNode, Connection } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.contextMenu = null;
    s.customNodeDefs = {};
    s.searchQuery = '';
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.templates = {};
    s.breadcrumbStack = [];
    s.subgraphDefs = {};
    s.errorStrategy = 'fail-fast';
    s.validationErrors = {};
    s.executionMetrics = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

// ---------------------------------------------------------------------------
// Schema validation helpers
// ---------------------------------------------------------------------------

/** Verify every node in a record has all required fields with correct types. */
function assertNodeSchema(nodes: Record<string, EditorNode>) {
  for (const [id, node] of Object.entries(nodes)) {
    expect(node.id, `node ${id} missing id`).toBe(id);
    expect(typeof node.type, `node ${id} type should be string`).toBe('string');
    expect(Array.isArray(node.position), `node ${id} position should be array`).toBe(true);
    expect(node.position.length, `node ${id} position should have 3 elements`).toBe(3);
    node.position.forEach((v, i) => {
      expect(typeof v, `node ${id} position[${i}] should be number`).toBe('number');
    });
    expect(typeof node.title, `node ${id} title should be string`).toBe('string');
    expect(node.data !== null && typeof node.data === 'object', `node ${id} data should be object`).toBe(true);
    expect(Array.isArray(node.inputs), `node ${id} inputs should be array`).toBe(true);
    expect(Array.isArray(node.outputs), `node ${id} outputs should be array`).toBe(true);
  }
}

/** Verify every connection has required fields. */
function assertConnectionSchema(connections: Record<string, Connection>) {
  for (const [id, conn] of Object.entries(connections)) {
    expect(conn.id, `connection ${id} id mismatch`).toBe(id);
    expect(typeof conn.sourceNodeId, `connection ${id} sourceNodeId should be string`).toBe('string');
    expect(typeof conn.sourcePortIndex, `connection ${id} sourcePortIndex should be number`).toBe('number');
    expect(typeof conn.targetNodeId, `connection ${id} targetNodeId should be string`).toBe('string');
    expect(typeof conn.targetPortIndex, `connection ${id} targetPortIndex should be number`).toBe('number');
  }
}

/** Verify all connection node references point to existing nodes. */
function assertConnectionIntegrity(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
) {
  for (const [id, conn] of Object.entries(connections)) {
    expect(nodes[conn.sourceNodeId], `connection ${id} references missing source node ${conn.sourceNodeId}`).toBeDefined();
    expect(nodes[conn.targetNodeId], `connection ${id} references missing target node ${conn.targetNodeId}`).toBeDefined();

    const srcNode = nodes[conn.sourceNodeId];
    const tgtNode = nodes[conn.targetNodeId];
    expect(
      conn.sourcePortIndex >= 0 && conn.sourcePortIndex < srcNode.outputs.length,
      `connection ${id} sourcePortIndex ${conn.sourcePortIndex} out of range [0..${srcNode.outputs.length - 1}]`,
    ).toBe(true);
    expect(
      conn.targetPortIndex >= 0 && conn.targetPortIndex < tgtNode.inputs.length,
      `connection ${id} targetPortIndex ${conn.targetPortIndex} out of range [0..${tgtNode.inputs.length - 1}]`,
    ).toBe(true);
  }
}

/** Verify graphTabs, graphOrder, activeGraphId are consistent. */
function assertGraphStructureIntegrity(storage: MultiGraphStorage) {
  // activeGraphId must be a key in graphTabs
  expect(storage.graphTabs[storage.activeGraphId], 'activeGraphId not found in graphTabs').toBeDefined();

  // graphOrder should contain all top-level graphTab keys that appear in graphOrder
  for (const id of storage.graphOrder) {
    expect(storage.graphTabs[id], `graphOrder references missing graphTab ${id}`).toBeDefined();
  }

  // Every graph in graphOrder should have a corresponding graph data entry
  for (const id of storage.graphOrder) {
    expect(storage.graphs[id], `graphOrder entry ${id} missing from graphs`).toBeDefined();
  }

  // activeGraphId should appear in graphOrder (for top-level graphs)
  // Note: inner subgraph graphs may have tabs but not be in graphOrder
  expect(storage.graphOrder.includes(storage.activeGraphId), 'activeGraphId not in graphOrder').toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Export/Import Round-Trip', () => {
  beforeEach(resetStore);

  // -----------------------------------------------------------------------
  // 1. Basic round-trip
  // -----------------------------------------------------------------------
  describe('Basic round-trip', () => {
    it('exportAllGraphs -> importAllGraphs preserves all data', () => {
      const s = getState();
      const srcId = s.addNode('source', [1, 0, 2]);
      const xformId = s.addNode('transform', [4, 0, 5]);
      s.updateNodeTitle(srcId, 'My Source');
      s.updateNodeData(srcId, 'value', 42);

      const connId = s.addConnection(srcId, 0, xformId, 0);
      expect(connId).not.toBeNull();

      const exported = s.exportAllGraphs();

      // Clear and re-import
      s.clearGraph();
      expect(Object.keys(getState().nodes).length).toBe(0);

      s.importAllGraphs(exported);
      const after = getState();

      // Nodes preserved
      expect(Object.keys(after.nodes).length).toBe(2);
      expect(after.nodes[srcId]).toBeDefined();
      expect(after.nodes[xformId]).toBeDefined();
      expect(after.nodes[srcId].title).toBe('My Source');
      expect(after.nodes[srcId].data.value).toBe(42);
      expect(after.nodes[srcId].position).toEqual([1, 0, 2]);
      expect(after.nodes[xformId].position).toEqual([4, 0, 5]);

      // Connection preserved
      expect(Object.keys(after.connections).length).toBe(1);
      const conn = Object.values(after.connections)[0];
      expect(conn.sourceNodeId).toBe(srcId);
      expect(conn.targetNodeId).toBe(xformId);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Multi-graph round-trip
  // -----------------------------------------------------------------------
  describe('Multi-graph round-trip', () => {
    it('multiple graphs with different node types, connections, groups survive round-trip', () => {
      const s = getState();

      // Graph 1 (default): source -> math
      const src1 = s.addNode('source', [0, 0, 0]);
      const math1 = s.addNode('math', [3, 0, 0]);
      s.addConnection(src1, 0, math1, 0);

      // Create second graph
      const g2Id = s.createGraph('Graph 2');
      s.switchGraph(g2Id);
      const concat1 = getState().addNode('concat', [0, 0, 0]);
      const tmpl1 = getState().addNode('template', [3, 0, 0]);
      getState().addConnection(concat1, 0, tmpl1, 0);

      // Create third graph
      const g3Id = getState().createGraph('Graph 3');
      getState().switchGraph(g3Id);
      const compare1 = getState().addNode('compare', [0, 0, 0]);
      const switchNode = getState().addNode('switch', [3, 0, 0]);
      getState().addConnection(compare1, 0, switchNode, 0);

      // Switch back to default to export from there
      getState().switchGraph('default');

      const exported = getState().exportAllGraphs();

      // Verify structure before clearing
      expect(Object.keys(exported.graphs).length).toBe(3);
      expect(exported.graphOrder.length).toBe(3);

      // Clear and re-import
      getState().clearGraph();
      _resetModuleState();
      useEditorStore.setState((s) => {
        s.nodes = {};
        s.connections = {};
        s.groups = {};
        s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
        s.activeGraphId = 'default';
        s.graphOrder = ['default'];
        s.templates = {};
        s.subgraphDefs = {};
        s.customNodeDefs = {};
      });

      getState().importAllGraphs(exported);
      const after = getState();

      // Default graph should be active with its nodes
      expect(after.activeGraphId).toBe('default');
      expect(Object.keys(after.nodes).length).toBe(2);
      expect(after.nodes[src1]).toBeDefined();
      expect(after.nodes[math1]).toBeDefined();
      expect(Object.keys(after.connections).length).toBe(1);

      // Graph tabs should be restored
      expect(Object.keys(after.graphTabs).length).toBe(3);
      expect(after.graphTabs[g2Id]).toBeDefined();
      expect(after.graphTabs[g2Id].name).toBe('Graph 2');
      expect(after.graphTabs[g3Id]).toBeDefined();
      expect(after.graphTabs[g3Id].name).toBe('Graph 3');

      // Verify graph order
      expect(after.graphOrder).toContain('default');
      expect(after.graphOrder).toContain(g2Id);
      expect(after.graphOrder).toContain(g3Id);

      // Switch to second graph and verify its data
      after.switchGraph(g2Id);
      const afterG2 = getState();
      expect(Object.keys(afterG2.nodes).length).toBe(2);
      expect(Object.keys(afterG2.connections).length).toBe(1);

      // Switch to third graph and verify
      afterG2.switchGraph(g3Id);
      const afterG3 = getState();
      expect(Object.keys(afterG3.nodes).length).toBe(2);
      expect(Object.keys(afterG3.connections).length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Subgraph data round-trip
  // -----------------------------------------------------------------------
  describe('Subgraph data round-trip', () => {
    it('subgraphDefs and inner graphs are preserved through export/import', () => {
      const s = getState();

      // Add a source node first
      s.addNode('source', [0, 0, 0]);

      // Create a subgraph
      const subgraphNodeId = s.createSubgraph('MySubgraph');
      expect(subgraphNodeId).not.toBeNull();

      const beforeExport = getState();
      const subDef = beforeExport.subgraphDefs[subgraphNodeId!];
      expect(subDef).toBeDefined();
      const innerGraphId = subDef.innerGraphId;

      // The inner graph should have its own graphTab
      expect(beforeExport.graphTabs[innerGraphId]).toBeDefined();

      const exported = beforeExport.exportAllGraphs();

      // Verify exported data includes the inner graph
      expect(exported.graphs[innerGraphId]).toBeDefined();
      const innerGraph = exported.graphs[innerGraphId];
      // Inner graph should have subgraph-input and subgraph-output nodes
      const innerNodeTypes = Object.values(innerGraph.nodes).map((n) => n.type);
      expect(innerNodeTypes).toContain('subgraph-input');
      expect(innerNodeTypes).toContain('subgraph-output');

      // Clear and re-import
      getState().clearGraph();
      resetStore();

      getState().importAllGraphs(exported);
      const after = getState();

      // Subgraph node should exist
      expect(after.nodes[subgraphNodeId!]).toBeDefined();
      expect(after.nodes[subgraphNodeId!].type).toBe('subgraph');

      // SubgraphDefs should be restored
      expect(after.subgraphDefs[subgraphNodeId!]).toBeDefined();
      expect(after.subgraphDefs[subgraphNodeId!].name).toBe('MySubgraph');
      expect(after.subgraphDefs[subgraphNodeId!].innerGraphId).toBe(innerGraphId);
      expect(after.subgraphDefs[subgraphNodeId!].exposedInputs.length).toBeGreaterThan(0);
      expect(after.subgraphDefs[subgraphNodeId!].exposedOutputs.length).toBeGreaterThan(0);

      // Inner graph tab should be restored
      expect(after.graphTabs[innerGraphId]).toBeDefined();

      // Should be able to switch to the inner graph
      after.switchGraph(innerGraphId);
      const innerState = getState();
      const innerTypes = Object.values(innerState.nodes).map((n) => n.type);
      expect(innerTypes).toContain('subgraph-input');
      expect(innerTypes).toContain('subgraph-output');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Template round-trip
  // -----------------------------------------------------------------------
  describe('Template round-trip', () => {
    it('templates survive export/import', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const math = s.addNode('math', [3, 0, 0]);
      s.addConnection(src, 0, math, 0);

      // Select nodes and save as template
      s.setSelection(new Set([src, math]));
      const templateId = s.saveSelectionAsTemplate('MyTemplate', 'Custom');
      expect(templateId).not.toBeNull();

      const beforeExport = getState();
      expect(beforeExport.templates[templateId!]).toBeDefined();
      expect(beforeExport.templates[templateId!].name).toBe('MyTemplate');
      expect(beforeExport.templates[templateId!].category).toBe('Custom');
      expect(beforeExport.templates[templateId!].nodes.length).toBe(2);
      expect(beforeExport.templates[templateId!].connections.length).toBe(1);

      const exported = s.exportAllGraphs();

      // Clear and re-import
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Templates should be restored
      expect(after.templates[templateId!]).toBeDefined();
      expect(after.templates[templateId!].name).toBe('MyTemplate');
      expect(after.templates[templateId!].category).toBe('Custom');
      expect(after.templates[templateId!].nodes.length).toBe(2);
      expect(after.templates[templateId!].connections.length).toBe(1);
      expect(after.templates[templateId!].createdAt).toBe(beforeExport.templates[templateId!].createdAt);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Connection metadata round-trip
  // -----------------------------------------------------------------------
  describe('Connection metadata round-trip', () => {
    it('labels and colorOverride are preserved through export/import', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const xform = s.addNode('transform', [3, 0, 0]);
      const connId = s.addConnection(src, 0, xform, 0);
      expect(connId).not.toBeNull();

      // Set label and color
      s.updateConnectionLabel(connId!, 'Data Flow');
      s.updateConnectionColor(connId!, '#FF5500');

      // Verify before export
      const connBefore = getState().connections[connId!];
      expect(connBefore.label).toBe('Data Flow');
      expect(connBefore.colorOverride).toBe('#FF5500');

      const exported = s.exportAllGraphs();

      // Clear and re-import
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Connection metadata should be preserved
      expect(after.connections[connId!]).toBeDefined();
      expect(after.connections[connId!].label).toBe('Data Flow');
      expect(after.connections[connId!].colorOverride).toBe('#FF5500');
    });
  });

  // -----------------------------------------------------------------------
  // 6. Custom node defs round-trip
  // -----------------------------------------------------------------------
  describe('Custom node defs round-trip', () => {
    it('customNodeDefs per graph are preserved', () => {
      const s = getState();

      // Add a custom node def to the default graph
      const defId = s.addCustomNodeDef({
        name: 'Doubler',
        color: '#00FF00',
        category: 'Math',
        expression: 'inputs[0] * 2',
        inputs: [{ label: 'x', portType: 'number' }],
        outputs: [{ label: 'result', portType: 'number' }],
      });

      expect(getState().customNodeDefs[defId]).toBeDefined();

      // Create a second graph with its own custom node def
      const g2 = s.createGraph('Graph 2');
      s.switchGraph(g2);
      const defId2 = getState().addCustomNodeDef({
        name: 'Tripler',
        color: '#0000FF',
        category: 'Math',
        expression: 'inputs[0] * 3',
        inputs: [{ label: 'x', portType: 'number' }],
        outputs: [{ label: 'result', portType: 'number' }],
      });

      // Switch back to default for export
      getState().switchGraph('default');
      const exported = getState().exportAllGraphs();

      // Verify the exported data has per-graph customNodeDefs
      expect(exported.graphs['default'].customNodeDefs[defId]).toBeDefined();
      expect(exported.graphs[g2].customNodeDefs[defId2]).toBeDefined();

      // Clear and re-import
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Default graph's custom defs should be restored
      expect(after.customNodeDefs[defId]).toBeDefined();
      expect(after.customNodeDefs[defId].name).toBe('Doubler');
      expect(after.customNodeDefs[defId].expression).toBe('inputs[0] * 2');
      expect(after.customNodeDefs[defId].color).toBe('#00FF00');

      // Switch to graph 2 and verify its custom defs
      after.switchGraph(g2);
      const afterG2 = getState();
      expect(afterG2.customNodeDefs[defId2]).toBeDefined();
      expect(afterG2.customNodeDefs[defId2].name).toBe('Tripler');
      expect(afterG2.customNodeDefs[defId2].expression).toBe('inputs[0] * 3');
    });
  });

  // -----------------------------------------------------------------------
  // 7. ErrorStrategy round-trip
  // -----------------------------------------------------------------------
  describe('ErrorStrategy round-trip', () => {
    it('per-graph errorStrategy survives export/import', () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);

      // Change error strategy
      s.setErrorStrategy('continue');
      expect(getState().errorStrategy).toBe('continue');

      const exported = s.exportAllGraphs();

      // The exported active graph should record the non-default errorStrategy
      expect(exported.graphs['default'].errorStrategy).toBe('continue');

      // Clear and re-import
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.errorStrategy).toBe('continue');
    });

    it('default errorStrategy (fail-fast) is correctly restored', () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);

      // Keep default error strategy
      expect(getState().errorStrategy).toBe('fail-fast');

      const exported = s.exportAllGraphs();

      // Clear, set to continue, then import
      resetStore();
      getState().setErrorStrategy('continue');
      expect(getState().errorStrategy).toBe('continue');

      getState().importAllGraphs(exported);
      const after = getState();
      // Should be restored to fail-fast (the default / omitted value)
      expect(after.errorStrategy).toBe('fail-fast');
    });
  });

  // -----------------------------------------------------------------------
  // 8. Schema validation
  // -----------------------------------------------------------------------
  describe('Schema validation', () => {
    it('after import, all nodes have required fields', () => {
      const s = getState();
      s.addNode('source', [1, 2, 3]);
      s.addNode('transform', [4, 5, 6]);
      s.addNode('math', [7, 8, 9]);
      s.addNode('compare', [10, 11, 12]);
      s.addNode('concat', [13, 14, 15]);
      s.addNode('note', [16, 17, 18]);

      const exported = s.exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      assertNodeSchema(after.nodes);
    });

    it('after import, all connections have required fields', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const math = s.addNode('math', [3, 0, 0]);
      const xform = s.addNode('transform', [6, 0, 0]);
      s.addConnection(src, 0, math, 0);
      s.addConnection(src, 0, xform, 0);

      const exported = s.exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      assertConnectionSchema(after.connections);
    });

    it('schema validation across all graphs in multi-graph export', () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);
      s.addNode('transform', [3, 0, 0]);

      const g2 = s.createGraph('G2');
      s.switchGraph(g2);
      getState().addNode('math', [0, 0, 0]);
      getState().addNode('compare', [3, 0, 0]);

      getState().switchGraph('default');
      const exported = getState().exportAllGraphs();

      // Validate schema for every graph in the export
      for (const [, graphData] of Object.entries(exported.graphs)) {
        assertNodeSchema(graphData.nodes);
        assertConnectionSchema(graphData.connections);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 9. Connection integrity
  // -----------------------------------------------------------------------
  describe('Connection integrity', () => {
    it('after import, all connections reference existing nodes with valid port indices', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const math = s.addNode('math', [3, 0, 0]);
      const xform = s.addNode('transform', [6, 0, 0]);
      const output = s.addNode('output', [9, 0, 0]);

      s.addConnection(src, 0, math, 0);     // source out 0 -> math in 0
      s.addConnection(src, 0, xform, 0);     // source out 0 -> transform in 0
      s.addConnection(math, 0, xform, 1);    // math out 0 -> transform in 1 (factor)
      s.addConnection(xform, 0, output, 0);  // transform out 0 -> output in 0

      const exported = s.exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      assertConnectionIntegrity(after.nodes, after.connections);
    });

    it('connection integrity holds across multi-graph export', () => {
      const s = getState();
      const src1 = s.addNode('source', [0, 0, 0]);
      const math1 = s.addNode('math', [3, 0, 0]);
      s.addConnection(src1, 0, math1, 0);

      const g2 = s.createGraph('G2');
      s.switchGraph(g2);
      const src2 = getState().addNode('source', [0, 0, 0]);
      const xform2 = getState().addNode('transform', [3, 0, 0]);
      getState().addConnection(src2, 0, xform2, 0);

      getState().switchGraph('default');
      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);

      // Check default graph
      const afterDefault = getState();
      assertConnectionIntegrity(afterDefault.nodes, afterDefault.connections);

      // Switch to G2 and check
      afterDefault.switchGraph(g2);
      const afterG2 = getState();
      assertConnectionIntegrity(afterG2.nodes, afterG2.connections);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Graph structure integrity
  // -----------------------------------------------------------------------
  describe('Graph structure integrity', () => {
    it('graphTabs, graphOrder, activeGraphId are consistent after import', () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);
      const g2 = s.createGraph('Second');
      const g3 = s.createGraph('Third');

      const exported = s.exportAllGraphs();
      assertGraphStructureIntegrity(exported);

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // activeGraphId should be in graphTabs
      expect(after.graphTabs[after.activeGraphId]).toBeDefined();

      // graphOrder should contain all graph tabs (except inner subgraph tabs)
      for (const id of after.graphOrder) {
        expect(after.graphTabs[id]).toBeDefined();
      }

      // activeGraphId should be in graphOrder
      expect(after.graphOrder).toContain(after.activeGraphId);

      // All graphOrder entries should exist as graph tabs
      expect(after.graphOrder).toContain('default');
      expect(after.graphOrder).toContain(g2);
      expect(after.graphOrder).toContain(g3);
    });

    it('exported MultiGraphStorage passes structure integrity check', () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);
      s.createGraph('AnotherGraph');

      const exported = s.exportAllGraphs();
      assertGraphStructureIntegrity(exported);
    });
  });

  // -----------------------------------------------------------------------
  // 11. ID collision prevention
  // -----------------------------------------------------------------------
  describe('ID collision prevention', () => {
    it('after import, new IDs do not collide with imported ones', () => {
      const s = getState();
      // Create several nodes to push the ID counter up
      const id1 = s.addNode('source', [0, 0, 0]);
      const id2 = s.addNode('math', [3, 0, 0]);
      s.addNode('transform', [6, 0, 0]);
      s.addConnection(id1, 0, id2, 0);

      const exported = s.exportAllGraphs();

      // Collect all existing IDs from the export
      const existingIds = new Set<string>();
      for (const [graphId, graphData] of Object.entries(exported.graphs)) {
        existingIds.add(graphId);
        for (const nodeId of Object.keys(graphData.nodes)) existingIds.add(nodeId);
        for (const connId of Object.keys(graphData.connections)) existingIds.add(connId);
        for (const groupId of Object.keys(graphData.groups)) existingIds.add(groupId);
      }
      for (const tabId of Object.keys(exported.graphTabs)) existingIds.add(tabId);
      for (const tmplId of Object.keys(exported.templates)) existingIds.add(tmplId);

      // Clear and re-import
      resetStore();
      getState().importAllGraphs(exported);

      // Now add new nodes — their IDs should not collide
      const newId1 = getState().addNode('source', [10, 0, 0]);
      const newId2 = getState().addNode('math', [13, 0, 0]);
      const newConnId = getState().addConnection(newId1, 0, newId2, 0);
      const newGraphId = getState().createGraph('NewGraph');

      expect(existingIds.has(newId1)).toBe(false);
      expect(existingIds.has(newId2)).toBe(false);
      if (newConnId) {
        expect(existingIds.has(newConnId)).toBe(false);
      }
      expect(existingIds.has(newGraphId)).toBe(false);
    });

    it('syncNextId accounts for IDs across all graphs, templates, and tabs', () => {
      const s = getState();

      // Create content in default graph
      s.addNode('source', [0, 0, 0]);

      // Create second graph with nodes
      const g2 = s.createGraph('G2');
      s.switchGraph(g2);
      getState().addNode('math', [0, 0, 0]);

      // Go back and save a template
      getState().switchGraph('default');
      const srcId = Object.keys(getState().nodes)[0];
      getState().setSelection(new Set([srcId]));
      getState().saveSelectionAsTemplate('Tmpl');

      const exported = getState().exportAllGraphs();

      // Find the maximum numeric suffix across all IDs
      let maxNumeric = 0;
      const allIds = [
        ...Object.keys(exported.graphTabs),
        ...Object.keys(exported.templates),
      ];
      for (const graphData of Object.values(exported.graphs)) {
        allIds.push(...Object.keys(graphData.nodes));
        allIds.push(...Object.keys(graphData.connections));
        allIds.push(...Object.keys(graphData.groups));
      }
      for (const id of allIds) {
        const num = parseInt(id.replace(/\D+/g, ''), 10);
        if (!isNaN(num) && num > maxNumeric) maxNumeric = num;
      }

      resetStore();
      getState().importAllGraphs(exported);

      // The next generated ID should be > maxNumeric
      const nextNode = getState().addNode('source', [0, 0, 0]);
      const nextNum = parseInt(nextNode.replace(/\D+/g, ''), 10);
      expect(nextNum).toBeGreaterThan(maxNumeric);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Empty graph round-trip
  // -----------------------------------------------------------------------
  describe('Empty graph round-trip', () => {
    it('export/import with an empty graph works correctly', () => {
      const s = getState();
      // Don't add any nodes
      const exported = s.exportAllGraphs();

      expect(exported.version).toBe(2);
      expect(Object.keys(exported.graphs).length).toBe(1);
      expect(Object.keys(exported.graphs['default'].nodes).length).toBe(0);
      expect(Object.keys(exported.graphs['default'].connections).length).toBe(0);

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(Object.keys(after.nodes).length).toBe(0);
      expect(Object.keys(after.connections).length).toBe(0);
      expect(Object.keys(after.groups).length).toBe(0);
      expect(after.activeGraphId).toBe('default');
      expect(after.graphOrder).toContain('default');
    });

    it('empty graph with multiple empty graphs round-trips', () => {
      const s = getState();
      s.createGraph('Empty2');
      s.createGraph('Empty3');

      const exported = s.exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(Object.keys(after.graphTabs).length).toBe(3);
      expect(after.graphOrder.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // 13. Groups round-trip
  // -----------------------------------------------------------------------
  describe('Groups round-trip', () => {
    it('groups with members are preserved through export/import', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const math = s.addNode('math', [3, 0, 0]);
      const xform = s.addNode('transform', [6, 0, 0]);

      // Select first two nodes and create a group
      s.setSelection(new Set([src, math]));
      const groupId = s.createGroup('TestGroup');
      expect(groupId).not.toBeNull();

      // Verify group before export
      const beforeExport = getState();
      expect(beforeExport.groups[groupId!]).toBeDefined();
      expect(beforeExport.groups[groupId!].label).toBe('TestGroup');
      expect(beforeExport.nodes[src].groupId).toBe(groupId);
      expect(beforeExport.nodes[math].groupId).toBe(groupId);
      expect(beforeExport.nodes[xform].groupId).toBeUndefined();

      const exported = s.exportAllGraphs();

      // Clear and re-import
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Group should be restored
      expect(after.groups[groupId!]).toBeDefined();
      expect(after.groups[groupId!].label).toBe('TestGroup');

      // Node-to-group membership should be preserved
      expect(after.nodes[src].groupId).toBe(groupId);
      expect(after.nodes[math].groupId).toBe(groupId);
      expect(after.nodes[xform].groupId).toBeUndefined();
    });

    it('group collapsed state is preserved', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const math = s.addNode('math', [3, 0, 0]);

      s.setSelection(new Set([src, math]));
      const groupId = s.createGroup('Collapsible');
      expect(groupId).not.toBeNull();

      // The group starts uncollapsed by default
      const before = getState();
      const initialCollapsed = before.groups[groupId!].collapsed;

      const exported = s.exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.groups[groupId!].collapsed).toBe(initialCollapsed);
    });
  });

  // -----------------------------------------------------------------------
  // 14. Node data deep copy
  // -----------------------------------------------------------------------
  describe('Node data deep copy', () => {
    it('complex node data (nested objects) preserved without reference sharing', () => {
      const s = getState();
      const srcId = s.addNode('source', [0, 0, 0]);

      // Set complex nested data
      s.updateNodeData(srcId, 'config', {
        nested: { level1: { level2: [1, 2, 3] } },
        metadata: { tags: ['a', 'b'], count: 42 },
      });
      s.updateNodeData(srcId, 'values', [10, 20, 30]);

      const beforeExport = getState();
      const originalData = beforeExport.nodes[srcId].data;

      const exported = s.exportAllGraphs();

      // Verify exported data has the same values (deep equality)
      const exportedNodeData = exported.graphs['default'].nodes[srcId].data;
      expect(exportedNodeData.config).toEqual(originalData.config);
      expect(exportedNodeData.values).toEqual(originalData.values);

      // Verify no reference sharing: exported objects should be different instances
      // (Immer freezes store objects, so we verify identity instead of mutation)
      expect(exportedNodeData.config).not.toBe(originalData.config);
      expect(exportedNodeData.values).not.toBe(originalData.values);

      // Mutate exported data (not frozen) to prove independence from future import
      (exportedNodeData.config as Record<string, unknown>).mutated = true;

      // Clear and re-import
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Verify deep data is preserved (the original values, not the mutation)
      const importedData = after.nodes[srcId].data;
      // importAllGraphs does structuredClone, so the mutation we added should be
      // present (it was in the exported object we passed in), but the import is
      // itself a deep copy - so modifying exported further won't affect it.
      expect(importedData.config).toHaveProperty('nested');
      expect((importedData.config as Record<string, unknown>).nested).toEqual(
        { level1: { level2: [1, 2, 3] } },
      );
      expect((importedData.config as Record<string, unknown>).metadata).toEqual(
        { tags: ['a', 'b'], count: 42 },
      );
      expect(importedData.values).toEqual([10, 20, 30]);

      // Verify imported data is a deep copy (different identity from exported)
      expect(importedData.config).not.toBe(exportedNodeData.config);
      expect(importedData.values).not.toBe(exportedNodeData.values);

      // Further mutations to exported should not affect imported (Immer-frozen)
      (exportedNodeData.config as Record<string, unknown>).postImportMutation = true;
      expect(importedData.config).not.toHaveProperty('postImportMutation');
    });

    it('port definitions are deep-copied through round-trip', () => {
      const s = getState();
      const srcId = s.addNode('source', [0, 0, 0]);

      const exported = s.exportAllGraphs();
      const exportedOutputs = exported.graphs['default'].nodes[srcId].outputs;

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();
      const importedOutputs = after.nodes[srcId].outputs;

      // Should have same content
      expect(importedOutputs.length).toBe(exportedOutputs.length);
      for (let i = 0; i < importedOutputs.length; i++) {
        expect(importedOutputs[i].label).toBe(exportedOutputs[i].label);
        expect(importedOutputs[i].portType).toBe(exportedOutputs[i].portType);
      }

      // Should not share references
      expect(importedOutputs).not.toBe(exportedOutputs);
      if (importedOutputs.length > 0) {
        expect(importedOutputs[0]).not.toBe(exportedOutputs[0]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Combined / edge-case scenarios
  // -----------------------------------------------------------------------
  describe('Combined scenarios', () => {
    it('full workspace round-trip with all features', () => {
      const s = getState();

      // 1. Build a graph with diverse nodes
      const src = s.addNode('source', [0, 0, 0]);
      const math = s.addNode('math', [3, 0, 0]);
      const xform = s.addNode('transform', [6, 0, 0]);
      const output = s.addNode('output', [9, 0, 0]);
      s.updateNodeTitle(src, 'Primary Source');
      s.updateNodeData(src, 'value', 100);

      // 2. Add connections with metadata
      const c1 = s.addConnection(src, 0, math, 0);
      const c2 = s.addConnection(math, 0, xform, 0);
      s.addConnection(xform, 0, output, 0);
      s.updateConnectionLabel(c1!, 'raw data');
      s.updateConnectionColor(c2!, '#00AAFF');

      // 3. Create a group
      s.setSelection(new Set([src, math]));
      const groupId = s.createGroup('InputGroup');

      // 4. Set error strategy
      s.setErrorStrategy('continue');

      // 5. Add custom node def
      const defId = s.addCustomNodeDef({
        name: 'Inverter',
        color: '#FF0000',
        category: 'Custom',
        expression: '-inputs[0]',
        inputs: [{ label: 'in', portType: 'number' }],
        outputs: [{ label: 'out', portType: 'number' }],
      });

      // 6. Save a template
      s.setSelection(new Set([src, math]));
      const tmplId = s.saveSelectionAsTemplate('InputPair');

      // 7. Create a subgraph
      const subId = s.createSubgraph('SubProc');

      // 8. Create a second graph
      const g2 = s.createGraph('AnalysisGraph');
      s.switchGraph(g2);
      getState().addNode('compare', [0, 0, 0]);
      getState().switchGraph('default');

      // Export
      const exported = getState().exportAllGraphs();

      // Full reset
      resetStore();

      // Import
      getState().importAllGraphs(exported);
      const after = getState();

      // Verify everything
      // Nodes
      expect(after.nodes[src].title).toBe('Primary Source');
      expect(after.nodes[src].data.value).toBe(100);
      expect(Object.values(after.nodes).some((n) => n.type === 'subgraph')).toBe(true);

      // Connections
      expect(after.connections[c1!].label).toBe('raw data');
      expect(after.connections[c2!].colorOverride).toBe('#00AAFF');

      // Group
      expect(after.groups[groupId!]).toBeDefined();
      expect(after.groups[groupId!].label).toBe('InputGroup');

      // Error strategy
      expect(after.errorStrategy).toBe('continue');

      // Custom node defs
      expect(after.customNodeDefs[defId]).toBeDefined();
      expect(after.customNodeDefs[defId].name).toBe('Inverter');

      // Templates (workspace-global)
      expect(after.templates[tmplId!]).toBeDefined();
      expect(after.templates[tmplId!].name).toBe('InputPair');

      // Subgraph defs
      expect(after.subgraphDefs[subId!]).toBeDefined();

      // Graph tabs
      expect(after.graphTabs[g2]).toBeDefined();
      expect(after.graphTabs[g2].name).toBe('AnalysisGraph');

      // Schema validation on imported data
      assertNodeSchema(after.nodes);
      assertConnectionSchema(after.connections);
      assertConnectionIntegrity(after.nodes, after.connections);
    });

    it('double round-trip produces identical results', () => {
      const s = getState();
      const src = s.addNode('source', [1, 2, 3]);
      const math = s.addNode('math', [4, 5, 6]);
      s.addConnection(src, 0, math, 0);
      s.updateNodeTitle(src, 'Double-RT Source');
      s.addCustomNodeDef({
        name: 'Test',
        color: '#ABCDEF',
        category: 'Test',
        expression: 'inputs[0]',
        inputs: [{ label: 'a', portType: 'number' }],
        outputs: [{ label: 'b', portType: 'number' }],
      });

      // First round-trip
      const export1 = s.exportAllGraphs();
      resetStore();
      getState().importAllGraphs(export1);

      // Second round-trip
      const export2 = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(export2);

      const final = getState();
      expect(final.nodes[src].title).toBe('Double-RT Source');
      expect(final.nodes[src].position).toEqual([1, 2, 3]);
      expect(Object.keys(final.connections).length).toBe(1);
      expect(Object.keys(final.customNodeDefs).length).toBe(1);

      assertNodeSchema(final.nodes);
      assertConnectionSchema(final.connections);
      assertConnectionIntegrity(final.nodes, final.connections);
    });

    it('importAllGraphs rejects invalid storage (wrong version)', () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);

      // Attempt import with wrong version
      const badStorage = { version: 1, graphs: {}, graphTabs: {}, activeGraphId: 'x', graphOrder: [], templates: {} } as unknown as MultiGraphStorage;
      s.importAllGraphs(badStorage);

      // Store should be unchanged (still has the source node)
      expect(Object.keys(getState().nodes).length).toBe(1);
    });

    it('importAllGraphs clears transient state', () => {
      const s = getState();
      const srcId = s.addNode('source', [0, 0, 0]);

      const exported = s.exportAllGraphs();

      // Set some transient state
      useEditorStore.setState((st) => {
        st.executionStates[srcId] = 'running';
        st.executionErrors[srcId] = 'some error';
        st.selectedIds = new Set([srcId]);
      });

      // Import should clear transient state
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.executionStates[srcId]).toBeUndefined();
      expect(after.executionErrors[srcId]).toBeUndefined();
      expect(after.selectedIds.size).toBe(0);
      expect(after.interaction).toBe('idle');
      expect(after.pendingConnection).toBeNull();
      expect(after.contextMenu).toBeNull();
      expect(after.breadcrumbStack.length).toBe(0);
    });
  });
});

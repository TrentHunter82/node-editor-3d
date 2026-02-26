/**
 * Export/Import round-trip tests with schema validation and integrity checks.
 *
 * Complements serialization-roundtrip.test.ts (which covers basic identity,
 * v1→v2 migration, corrupted data, and localStorage). This file focuses on:
 * - Multi-graph fidelity across all graphs
 * - Subgraph data preservation through export/import
 * - validateGraphData and normalizeNode/normalizeConnection behaviour
 * - Connection metadata persistence
 * - Checkpoint and errorStrategy persistence
 * - graphOrder sanitization
 * - Missing optional GraphData fields normalization
 * - Execution state reset on import
 * - Double import replacement semantics
 * - Inactive graph data inclusion in export
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { saveMultiGraph, loadMultiGraph } from '../utils/serialization';
import type { MultiGraphStorage } from '../utils/serialization';
import { validateGraphData, normalizeNode, normalizeConnection } from '../utils/migration';
import type { EditorNode, NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset Zustand store state AND localStorage. */
function resetStore() {
  resetStoreOnly();
  localStorage.clear();
}

/** Reset Zustand store state only, preserving localStorage. */
function resetStoreOnly() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.searchQuery = '';
    s.contextMenu = null;
    s.validationErrors = {};
    s.breadcrumbStack = [];
    s.activeGraphId = 'default';
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.graphOrder = ['default'];
    s.templates = {};
    s.errorStrategy = 'fail-fast';
    s.checkpoints = {};
    s.graphVariables = {};
    s.executionMetrics = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

const getState = () => useEditorStore.getState();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Export/Import Validation and Schema Integrity', () => {
  beforeEach(resetStore);

  // =========================================================================
  // 1. Multi-graph export preserves ALL graph data
  // =========================================================================
  describe('Multi-graph export preserves all graph data', () => {

    it('creates 3 graphs with different configurations and restores each after import', () => {
      const s = getState();

      // Graph A (default): source → math
      const srcA = s.addNode('source', [0, 0, 0]);
      const mathA = s.addNode('math', [3, 0, 0]);
      s.updateNodeData(srcA, 'value', 42);
      s.updateNodeTitle(srcA, 'SourceA');
      const connA = s.addConnection(srcA, 0, mathA, 0);
      expect(connA).not.toBeNull();

      // Graph B: transform → output
      const graphB = s.createGraph('GraphB');
      const xformB = s.addNode('transform', [1, 0, 1]);
      const outB = s.addNode('output', [4, 0, 1]);
      s.updateNodeData(xformB, 'factor', 7);
      s.addConnection(xformB, 0, outB, 0);

      // Graph C: standalone display node
      const graphC = s.createGraph('GraphC');
      const dispC = s.addNode('display', [2, 0, 2]);
      s.updateNodeTitle(dispC, 'DisplayC');

      const exported = getState().exportAllGraphs();

      // Sanity: exported should have 3 graphs
      expect(Object.keys(exported.graphs).length).toBe(3);
      expect(exported.graphOrder.length).toBe(3);

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Verify graphOrder and tabs are restored
      expect(after.graphOrder.length).toBe(3);
      expect(after.graphTabs[graphB]).toBeDefined();
      expect(after.graphTabs[graphB].name).toBe('GraphB');
      expect(after.graphTabs[graphC]).toBeDefined();
      expect(after.graphTabs[graphC].name).toBe('GraphC');

      // Active graph is graphC (last created/switched to), verify it
      expect(after.activeGraphId).toBe(graphC);
      expect(after.nodes[dispC]).toBeDefined();
      expect(after.nodes[dispC].title).toBe('DisplayC');

      // Verify graph A (default) data via export structure
      const graphAData = exported.graphs['default'];
      expect(graphAData.nodes[srcA]).toBeDefined();
      expect(graphAData.nodes[srcA].data.value).toBe(42);
      expect(graphAData.nodes[srcA].title).toBe('SourceA');
      expect(graphAData.nodes[mathA]).toBeDefined();
      expect(Object.keys(graphAData.connections).length).toBe(1);

      // Verify graph B data
      const graphBData = exported.graphs[graphB];
      expect(graphBData.nodes[xformB]).toBeDefined();
      expect(graphBData.nodes[xformB].data.factor).toBe(7);
      expect(graphBData.nodes[outB]).toBeDefined();
      expect(Object.keys(graphBData.connections).length).toBe(1);
    });

    it('graphTabs metadata (name, createdAt) is preserved for all graphs', () => {
      const s = getState();
      const gB = s.createGraph('Second Graph');
      const gC = s.createGraph('Third Graph');

      const exported = getState().exportAllGraphs();

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.graphTabs['default'].name).toBe('Main');
      expect(after.graphTabs[gB].name).toBe('Second Graph');
      expect(after.graphTabs[gC].name).toBe('Third Graph');
      expect(typeof after.graphTabs['default'].createdAt).toBe('number');
    });
  });

  // =========================================================================
  // 2. Subgraph data survives export/import
  // =========================================================================
  describe('Subgraph data survives export/import', () => {

    it('subgraph node with inner graph can still be entered after export/import', () => {
      const s = getState();
      // Add a source node so the outer graph is non-trivial
      s.addNode('source', [5, 0, 0]);

      // Create a subgraph
      const subgraphNodeId = s.createSubgraph('MySubgraph');
      expect(subgraphNodeId).not.toBeNull();

      const stateBeforeExport = getState();
      const subDef = stateBeforeExport.subgraphDefs[subgraphNodeId!];
      expect(subDef).toBeDefined();
      const innerGraphId = subDef.innerGraphId;

      // Export the workspace
      const exported = stateBeforeExport.exportAllGraphs();

      // Verify inner graph was included in exported graphs
      expect(exported.graphs[innerGraphId]).toBeDefined();
      const innerGraph = exported.graphs[innerGraphId];
      // Inner graph should have subgraph-input and subgraph-output nodes
      const innerNodes = Object.values(innerGraph.nodes);
      expect(innerNodes.some(n => n.type === 'subgraph-input')).toBe(true);
      expect(innerNodes.some(n => n.type === 'subgraph-output')).toBe(true);

      // Import and verify we can still enter the subgraph
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // The subgraph node should exist in the active graph
      expect(after.nodes[subgraphNodeId!]).toBeDefined();
      expect(after.nodes[subgraphNodeId!].type).toBe('subgraph');
      expect(after.subgraphDefs[subgraphNodeId!]).toBeDefined();
      expect(after.subgraphDefs[subgraphNodeId!].name).toBe('MySubgraph');

      // Enter the subgraph — should switch to inner graph
      after.enterSubgraph(subgraphNodeId!);
      const insideState = getState();
      expect(insideState.activeGraphId).toBe(innerGraphId);
      // Should have the boundary nodes
      const insideNodes = Object.values(insideState.nodes);
      expect(insideNodes.length).toBeGreaterThan(0);
      expect(insideNodes.some(n => n.type === 'subgraph-input')).toBe(true);
    });

    it('subgraphDef exposedInputs/outputs are preserved through export/import', () => {
      const s = getState();
      const subgraphNodeId = s.createSubgraph('TestSub');
      expect(subgraphNodeId).not.toBeNull();

      const defBefore = getState().subgraphDefs[subgraphNodeId!];
      const exported = getState().exportAllGraphs();

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      const defAfter = after.subgraphDefs[subgraphNodeId!];
      expect(defAfter).toBeDefined();
      expect(defAfter.innerGraphId).toBe(defBefore.innerGraphId);
      expect(defAfter.exposedInputs).toEqual(defBefore.exposedInputs);
      expect(defAfter.exposedOutputs).toEqual(defBefore.exposedOutputs);
    });
  });

  // =========================================================================
  // 3. validateGraphData fixes malformed nodes
  // =========================================================================
  describe('validateGraphData fixes malformed nodes', () => {

    it('node with NaN position gets position reset to [0, 0, 0]', () => {
      const graphData = {
        nodes: {
          'n1': {
            id: 'n1',
            type: 'source' as NodeType,
            position: [NaN, 1, NaN] as unknown as [number, number, number],
            title: 'NaNNode',
            data: {},
            inputs: [],
            outputs: [{ id: 'out-0', label: 'value', portType: 'number' as const }],
          },
        },
        connections: {},
        groups: {},
        customNodeDefs: {},
      };

      validateGraphData(graphData);

      expect(graphData.nodes['n1']).toBeDefined();
      expect(graphData.nodes['n1'].position[0]).toBe(0);
      expect(graphData.nodes['n1'].position[1]).toBe(1); // valid component preserved
      expect(graphData.nodes['n1'].position[2]).toBe(0);
    });

    it('node with missing inputs array gets inputs defaulted to []', () => {
      const graphData = {
        nodes: {
          'n1': {
            id: 'n1',
            type: 'math',
            position: [0, 0, 0] as [number, number, number],
            title: 'MathNode',
            data: {},
            // inputs missing
            outputs: [{ id: 'out-0', label: 'result', portType: 'number' as const }],
          } as unknown as EditorNode,
        },
        connections: {},
        groups: {},
        customNodeDefs: {},
      };

      validateGraphData(graphData);

      expect(graphData.nodes['n1']).toBeDefined();
      expect(Array.isArray(graphData.nodes['n1'].inputs)).toBe(true);
    });

    it('node with wrong type for data field (array instead of object) gets data reset to {}', () => {
      const graphData = {
        nodes: {
          'n1': {
            id: 'n1',
            type: 'source' as NodeType,
            position: [0, 0, 0] as [number, number, number],
            title: 'BadData',
            data: [1, 2, 3] as unknown as Record<string, unknown>,
            inputs: [],
            outputs: [{ id: 'out-0', label: 'value', portType: 'number' as const }],
          },
        },
        connections: {},
        groups: {},
        customNodeDefs: {},
      };

      validateGraphData(graphData);

      expect(graphData.nodes['n1']).toBeDefined();
      expect(typeof graphData.nodes['n1'].data).toBe('object');
      expect(Array.isArray(graphData.nodes['n1'].data)).toBe(false);
      expect(graphData.nodes['n1'].data).toEqual({});
    });

    it('node with null data gets data reset to {}', () => {
      const graphData = {
        nodes: {
          'n1': {
            id: 'n1',
            type: 'source' as NodeType,
            position: [0, 0, 0] as [number, number, number],
            title: 'NullData',
            data: null as unknown as Record<string, unknown>,
            inputs: [],
            outputs: [{ id: 'out-0', label: 'value', portType: 'number' as const }],
          },
        },
        connections: {},
        groups: {},
        customNodeDefs: {},
      };

      validateGraphData(graphData);

      expect(graphData.nodes['n1']).toBeDefined();
      expect(graphData.nodes['n1'].data).toEqual({});
    });

    it('node with non-string type is removed entirely', () => {
      const graphData = {
        nodes: {
          'n1': {
            id: 'n1',
            type: 42 as unknown as 'source', // wrong type
            position: [0, 0, 0] as [number, number, number],
            title: 'BadType',
            data: {},
            inputs: [],
            outputs: [],
          },
          'n2': {
            id: 'n2',
            type: 'source' as NodeType,
            position: [1, 0, 0] as [number, number, number],
            title: 'GoodNode',
            data: {},
            inputs: [],
            outputs: [{ id: 'out-0', label: 'value', portType: 'number' as const }],
          },
        },
        connections: {},
        groups: {},
        customNodeDefs: {},
      };

      validateGraphData(graphData);

      expect(graphData.nodes['n1']).toBeUndefined();
      expect(graphData.nodes['n2']).toBeDefined();
    });
  });

  // =========================================================================
  // 4. validateGraphData removes dangling connections
  // =========================================================================
  describe('validateGraphData removes dangling connections', () => {

    it('connection where source port index exceeds outputs count is removed', () => {
      const graphData = {
        nodes: {
          'src': {
            id: 'src',
            type: 'source' as const,
            position: [0, 0, 0] as [number, number, number],
            title: 'Source',
            data: {},
            inputs: [],
            outputs: [{ id: 'out-0', label: 'value', portType: 'number' as const }],
          },
          'tgt': {
            id: 'tgt',
            type: 'math' as const,
            position: [3, 0, 0] as [number, number, number],
            title: 'Math',
            data: {},
            inputs: [
              { id: 'in-0', label: 'a', portType: 'number' as const },
              { id: 'in-1', label: 'b', portType: 'number' as const },
            ],
            outputs: [{ id: 'out-0', label: 'result', portType: 'number' as const }],
          },
        },
        connections: {
          'conn-valid': {
            id: 'conn-valid',
            sourceNodeId: 'src',
            sourcePortIndex: 0, // valid: source has 1 output
            targetNodeId: 'tgt',
            targetPortIndex: 0,
          },
          'conn-bad-src-port': {
            id: 'conn-bad-src-port',
            sourceNodeId: 'src',
            sourcePortIndex: 5, // out of range: source only has 1 output
            targetNodeId: 'tgt',
            targetPortIndex: 1,
          },
          'conn-bad-tgt-port': {
            id: 'conn-bad-tgt-port',
            sourceNodeId: 'src',
            sourcePortIndex: 0,
            targetNodeId: 'tgt',
            targetPortIndex: 99, // out of range: target only has 2 inputs
          },
        },
        groups: {},
        customNodeDefs: {},
      };

      validateGraphData(graphData);

      expect(graphData.connections['conn-valid']).toBeDefined();
      expect(graphData.connections['conn-bad-src-port']).toBeUndefined();
      expect(graphData.connections['conn-bad-tgt-port']).toBeUndefined();
    });
  });

  // =========================================================================
  // 5. normalizeConnection rejects NaN port indices
  // =========================================================================
  describe('normalizeConnection rejects NaN port indices', () => {

    it('NaN sourcePortIndex returns false', () => {
      const conn = {
        id: 'c1',
        sourceNodeId: 'n1',
        sourcePortIndex: NaN,
        targetNodeId: 'n2',
        targetPortIndex: 0,
      };
      expect(normalizeConnection(conn as unknown as Record<string, unknown>)).toBe(false);
    });

    it('NaN targetPortIndex returns false', () => {
      const conn = {
        id: 'c1',
        sourceNodeId: 'n1',
        sourcePortIndex: 0,
        targetNodeId: 'n2',
        targetPortIndex: NaN,
      };
      expect(normalizeConnection(conn as unknown as Record<string, unknown>)).toBe(false);
    });

    it('float (non-integer) port index returns false', () => {
      const conn = {
        id: 'c1',
        sourceNodeId: 'n1',
        sourcePortIndex: 1.5,
        targetNodeId: 'n2',
        targetPortIndex: 0,
      };
      expect(normalizeConnection(conn as unknown as Record<string, unknown>)).toBe(false);
    });

    it('negative port index returns false', () => {
      const conn = {
        id: 'c1',
        sourceNodeId: 'n1',
        sourcePortIndex: -1,
        targetNodeId: 'n2',
        targetPortIndex: 0,
      };
      expect(normalizeConnection(conn as unknown as Record<string, unknown>)).toBe(false);
    });

    it('valid integer port indices return true', () => {
      const conn = {
        id: 'c1',
        sourceNodeId: 'n1',
        sourcePortIndex: 0,
        targetNodeId: 'n2',
        targetPortIndex: 2,
      };
      expect(normalizeConnection(conn as unknown as Record<string, unknown>)).toBe(true);
    });
  });

  // =========================================================================
  // 6. Import with extra unknown fields preserves core data
  // =========================================================================
  describe('Import with extra unknown fields preserves core data', () => {

    it('futureField on nodes and connections is tolerated and core data preserved', () => {
      const storage = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              'n1': {
                id: 'n1',
                type: 'source',
                position: [0, 0, 0],
                title: 'Source',
                data: { value: 99 },
                inputs: [],
                outputs: [
                  { id: 'out-0', label: 'value', portType: 'number' },
                  { id: 'out-1', label: 'label', portType: 'string' },
                ],
                futureField: 'some-future-value',
                anotherUnknown: { nested: true },
              },
              'n2': {
                id: 'n2',
                type: 'math',
                position: [3, 0, 0],
                title: 'Math',
                data: {},
                inputs: [
                  { id: 'in-0', label: 'a', portType: 'number' },
                  { id: 'in-1', label: 'b', portType: 'number' },
                ],
                outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
              },
            },
            connections: {
              'c1': {
                id: 'c1',
                sourceNodeId: 'n1',
                sourcePortIndex: 0,
                targetNodeId: 'n2',
                targetPortIndex: 0,
                futureConnectionField: 42,
              },
            },
            groups: {},
            customNodeDefs: {},
            unknownGraphField: 'ignore me',
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
        futureTopLevelField: [1, 2, 3],
      } as unknown as MultiGraphStorage;

      expect(() => getState().importAllGraphs(storage)).not.toThrow();

      const after = getState();
      expect(after.nodes['n1']).toBeDefined();
      expect(after.nodes['n1'].data.value).toBe(99);
      expect(after.nodes['n2']).toBeDefined();
      expect(after.connections['c1']).toBeDefined();
      expect(after.connections['c1'].sourcePortIndex).toBe(0);
    });
  });

  // =========================================================================
  // 7. Export+import preserves connection metadata (label, colorOverride)
  // =========================================================================
  describe('Export+import preserves connection metadata', () => {

    it('label and colorOverride fields on connections survive export/import roundtrip', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const m1 = s.addNode('math', [3, 0, 0]);
      const m2 = s.addNode('math', [6, 0, 0]);
      const m3 = s.addNode('math', [9, 0, 0]);

      const cWithLabel = s.addConnection(src, 0, m1, 0)!;
      s.updateConnectionLabel(cWithLabel, 'my-label');

      const cWithColor = s.addConnection(src, 0, m2, 0)!;
      s.updateConnectionColor(cWithColor, '#ABCDEF');

      const cWithBoth = s.addConnection(src, 0, m3, 0)!;
      s.updateConnectionLabel(cWithBoth, 'both');
      s.updateConnectionColor(cWithBoth, '#112233');

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.connections[cWithLabel].label).toBe('my-label');
      expect(after.connections[cWithLabel].colorOverride).toBeUndefined();

      expect(after.connections[cWithColor].label).toBeUndefined();
      expect(after.connections[cWithColor].colorOverride).toBe('#ABCDEF');

      expect(after.connections[cWithBoth].label).toBe('both');
      expect(after.connections[cWithBoth].colorOverride).toBe('#112233');
    });
  });

  // =========================================================================
  // 8. Export+import preserves checkpoints
  // =========================================================================
  describe('Export+import preserves checkpoints', () => {

    it('named checkpoint created before export is present after import', () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);

      const checkpointId = s.createCheckpoint('My Checkpoint');
      expect(checkpointId).toBeTruthy();
      expect(getState().checkpoints[checkpointId]).toBeDefined();

      const exported = getState().exportAllGraphs();

      // Active graph checkpoints should be in the export
      const activeId = getState().activeGraphId;
      const graphData = exported.graphs[activeId];
      expect(graphData.checkpoints).toBeDefined();
      expect(graphData.checkpoints![checkpointId]).toBeDefined();
      expect(graphData.checkpoints![checkpointId].label).toBe('My Checkpoint');

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.checkpoints[checkpointId]).toBeDefined();
      expect(after.checkpoints[checkpointId].label).toBe('My Checkpoint');
      expect(after.checkpoints[checkpointId].snapshot).toBeDefined();
      expect(typeof after.checkpoints[checkpointId].createdAt).toBe('number');
    });

    it('checkpoint snapshot nodes are preserved after import', () => {
      const s = getState();
      const srcId = s.addNode('source', [1, 2, 3]);
      s.updateNodeData(srcId, 'value', 77);

      const checkpointId = s.createCheckpoint('Snapshot Test');

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      const checkpoint = after.checkpoints[checkpointId];
      expect(checkpoint).toBeDefined();
      expect(checkpoint.snapshot.nodes[srcId]).toBeDefined();
      expect(checkpoint.snapshot.nodes[srcId].data.value).toBe(77);
    });
  });

  // =========================================================================
  // 9. Export+import preserves errorStrategy
  // =========================================================================
  describe('Export+import preserves errorStrategy', () => {

    it("errorStrategy 'continue' is preserved after export/import roundtrip", () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);
      s.setErrorStrategy('continue');

      expect(getState().errorStrategy).toBe('continue');

      const exported = getState().exportAllGraphs();

      // Should be in the graph data
      const activeId = getState().activeGraphId;
      expect(exported.graphs[activeId].errorStrategy).toBe('continue');

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.errorStrategy).toBe('continue');
    });

    it("errorStrategy 'fail-fast' is default when not stored (omitted for brevity)", () => {
      // fail-fast is the default and is omitted from exported data
      const s = getState();
      s.addNode('source', [0, 0, 0]);
      // errorStrategy is 'fail-fast' by default — not explicitly set
      const exported = getState().exportAllGraphs();

      const activeId = getState().activeGraphId;
      // Should be omitted from graph data (undefined or not present)
      expect(exported.graphs[activeId].errorStrategy).toBeUndefined();

      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.errorStrategy).toBe('fail-fast');
    });
  });

  // =========================================================================
  // 10. Import sanitizes graphOrder with missing graph IDs
  // =========================================================================
  describe('Import sanitizes graphOrder with missing graph IDs', () => {

    it('graphOrder entries referencing non-existent graphs are removed', () => {
      const storage: MultiGraphStorage = {
        version: 2,
        graphs: {
          default: {
            nodes: {},
            connections: {},
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default', 'ghost-1', 'ghost-2', 'ghost-3'],
        templates: {},
      };

      getState().importAllGraphs(storage);
      const after = getState();

      expect(after.graphOrder).toContain('default');
      expect(after.graphOrder).not.toContain('ghost-1');
      expect(after.graphOrder).not.toContain('ghost-2');
      expect(after.graphOrder).not.toContain('ghost-3');
      expect(after.graphOrder.length).toBe(1);
    });

    it('graphOrder with all ghost entries still results in graphOrder containing valid graphs', () => {
      const storage: MultiGraphStorage = {
        version: 2,
        graphs: {
          default: {
            nodes: {},
            connections: {},
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['ghost-a', 'ghost-b'], // default is missing from graphOrder
        templates: {},
      };

      getState().importAllGraphs(storage);
      const after = getState();

      // sanitizeGraphOrder should ensure 'default' ends up in graphOrder
      expect(after.graphOrder).toContain('default');
      expect(after.graphOrder).not.toContain('ghost-a');
      expect(after.graphOrder).not.toContain('ghost-b');
    });
  });

  // =========================================================================
  // 11. Import normalizes missing optional GraphData fields
  // =========================================================================
  describe('Import normalizes missing optional GraphData fields', () => {

    it('missing groups, customNodeDefs, and subgraphDefs in graphData default to {} via loadMultiGraph', () => {
      // Normalization of missing optional fields happens in loadMultiGraph (not importAllGraphs).
      // Route through localStorage to exercise the full normalization path.
      const raw = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              'n1': {
                id: 'n1',
                type: 'source',
                position: [0, 0, 0],
                title: 'Source',
                data: { value: 5 },
                inputs: [],
                outputs: [
                  { id: 'out-0', label: 'value', portType: 'number' },
                  { id: 'out-1', label: 'label', portType: 'string' },
                ],
              },
            },
            connections: {},
            // groups, customNodeDefs, subgraphDefs all missing
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      localStorage.setItem('node-editor-3d-graph', JSON.stringify(raw));
      const normalized = loadMultiGraph();
      expect(normalized).not.toBeNull();

      // After normalization, all optional fields should be present as {}
      expect(normalized!.graphs['default'].groups).toEqual({});
      expect(normalized!.graphs['default'].customNodeDefs).toEqual({});
      expect(normalized!.graphs['default'].subgraphDefs).toEqual({});

      // Should import cleanly and produce correct state
      expect(() => getState().importAllGraphs(normalized!)).not.toThrow();
      const after = getState();
      expect(after.nodes['n1']).toBeDefined();
      expect(after.nodes['n1'].data.value).toBe(5);
      expect(after.groups).toEqual({});
      expect(after.customNodeDefs).toEqual({});
      expect(after.subgraphDefs).toEqual({});
    });

    it('missing connections field in graphData defaults to empty connections via loadMultiGraph', () => {
      const raw = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              'n1': {
                id: 'n1',
                type: 'source',
                position: [0, 0, 0],
                title: 'Source',
                data: {},
                inputs: [],
                outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
              },
            },
            // connections missing
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      localStorage.setItem('node-editor-3d-graph', JSON.stringify(raw));
      const normalized = loadMultiGraph();
      expect(normalized).not.toBeNull();
      expect(normalized!.graphs['default'].connections).toEqual({});

      expect(() => getState().importAllGraphs(normalized!)).not.toThrow();
      const after = getState();
      expect(after.nodes['n1']).toBeDefined();
      expect(after.connections).toEqual({});
    });
  });

  // =========================================================================
  // 12. Double import replaces previous import
  // =========================================================================
  describe('Double import replaces previous import', () => {

    it('importing graph B after graph A results in only graph B data present', () => {
      // Import A
      const storageA: MultiGraphStorage = {
        version: 2,
        graphs: {
          'graph-a': {
            nodes: {
              'node-a1': {
                id: 'node-a1',
                type: 'source',
                position: [0, 0, 0],
                title: 'NodeA1',
                data: { value: 111 },
                inputs: [],
                outputs: [
                  { id: 'out-0', label: 'value', portType: 'number' },
                  { id: 'out-1', label: 'label', portType: 'string' },
                ],
              },
            },
            connections: {},
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { 'graph-a': { id: 'graph-a', name: 'GraphA', createdAt: 1000 } },
        activeGraphId: 'graph-a',
        graphOrder: ['graph-a'],
        templates: {},
      };

      getState().importAllGraphs(storageA);
      expect(getState().nodes['node-a1']).toBeDefined();

      // Import B — this should replace A entirely
      const storageB: MultiGraphStorage = {
        version: 2,
        graphs: {
          'graph-b': {
            nodes: {
              'node-b1': {
                id: 'node-b1',
                type: 'math',
                position: [5, 0, 0],
                title: 'NodeB1',
                data: { operation: 'multiply' },
                inputs: [
                  { id: 'in-0', label: 'a', portType: 'number' },
                  { id: 'in-1', label: 'b', portType: 'number' },
                ],
                outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
              },
            },
            connections: {},
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { 'graph-b': { id: 'graph-b', name: 'GraphB', createdAt: 2000 } },
        activeGraphId: 'graph-b',
        graphOrder: ['graph-b'],
        templates: {},
      };

      getState().importAllGraphs(storageB);
      const after = getState();

      // Graph A data should be gone
      expect(after.nodes['node-a1']).toBeUndefined();
      expect(after.graphTabs['graph-a']).toBeUndefined();

      // Graph B data should be present
      expect(after.nodes['node-b1']).toBeDefined();
      expect(after.nodes['node-b1'].data.operation).toBe('multiply');
      expect(after.graphTabs['graph-b']).toBeDefined();
      expect(after.activeGraphId).toBe('graph-b');
    });
  });

  // =========================================================================
  // 13. Import resets execution state
  // =========================================================================
  describe('Import resets execution state', () => {

    it('executionStates, nodeOutputs, executionErrors are cleared after import', () => {
      const s = getState();
      const srcId = s.addNode('source', [0, 0, 0]);

      // Manually inject some execution state
      useEditorStore.setState((state) => {
        state.executionStates[srcId] = 'complete';
        state.nodeOutputs[srcId] = { 0: 42 };
        state.executionErrors[srcId] = 'some error';
        state.isExecuting = false;
      });

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.executionStates[srcId]).toBeUndefined();
      expect(after.nodeOutputs[srcId]).toBeUndefined();
      expect(after.executionErrors[srcId]).toBeUndefined();
      expect(after.isExecuting).toBe(false);
    });

    it('breadcrumbStack is empty after import (no stale subgraph navigation)', () => {
      const s = getState();
      s.addNode('source', [0, 0, 0]);
      const subId = s.createSubgraph('Sub');
      if (subId) {
        s.enterSubgraph(subId);
      }
      // Now breadcrumbStack should be non-empty
      expect(getState().breadcrumbStack.length).toBeGreaterThan(0);

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.breadcrumbStack.length).toBe(0);
    });
  });

  // =========================================================================
  // 14. Export includes inactive graph data
  // =========================================================================
  describe('Export includes inactive graph data', () => {

    it('graph A data is included in export even when graph B is active', () => {
      const s = getState();

      // Set up graph A (default) with a node
      const srcA = s.addNode('source', [10, 0, 0]);
      s.updateNodeData(srcA, 'value', 99);
      s.updateNodeTitle(srcA, 'GraphASource');

      // Create and switch to graph B
      const graphB = s.createGraph('GraphB');
      const mathB = s.addNode('math', [5, 0, 5]);
      s.updateNodeData(mathB, 'operation', 'multiply');

      // Active graph is now graphB
      expect(getState().activeGraphId).toBe(graphB);

      const exported = getState().exportAllGraphs();

      // Both graphs should be in export
      expect(exported.graphs['default']).toBeDefined();
      expect(exported.graphs[graphB]).toBeDefined();

      // Graph A data should be fully present
      expect(exported.graphs['default'].nodes[srcA]).toBeDefined();
      expect(exported.graphs['default'].nodes[srcA].data.value).toBe(99);
      expect(exported.graphs['default'].nodes[srcA].title).toBe('GraphASource');

      // Graph B data should be fully present
      expect(exported.graphs[graphB].nodes[mathB]).toBeDefined();
      expect(exported.graphs[graphB].nodes[mathB].data.operation).toBe('multiply');
    });

    it('switching between graphs and exporting preserves both graphs in export', () => {
      const s = getState();

      // Graph A: add nodes
      const nA1 = s.addNode('source', [0, 0, 0]);
      const nA2 = s.addNode('transform', [3, 0, 0]);
      s.addConnection(nA1, 0, nA2, 0);

      // Create graph B and add nodes
      const gB = s.createGraph('GraphB');
      const nB1 = s.addNode('clamp', [0, 0, 0]);
      s.updateNodeData(nB1, 'min', -5);

      // Switch back to A
      s.switchGraph('default');
      expect(getState().activeGraphId).toBe('default');

      // Switch back to B
      s.switchGraph(gB);
      expect(getState().activeGraphId).toBe(gB);

      // Export from B's context
      const exported = getState().exportAllGraphs();

      // Verify A data is preserved
      expect(exported.graphs['default'].nodes[nA1]).toBeDefined();
      expect(exported.graphs['default'].nodes[nA2]).toBeDefined();
      expect(Object.keys(exported.graphs['default'].connections).length).toBe(1);

      // Verify B data is preserved
      expect(exported.graphs[gB].nodes[nB1]).toBeDefined();
      expect(exported.graphs[gB].nodes[nB1].data.min).toBe(-5);

      // Import and verify both restored
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Active graph should be gB
      expect(after.activeGraphId).toBe(gB);
      expect(after.nodes[nB1]).toBeDefined();
      expect(after.nodes[nB1].data.min).toBe(-5);

      // Switch to A and verify
      after.switchGraph('default');
      const afterA = getState();
      expect(afterA.nodes[nA1]).toBeDefined();
      expect(afterA.nodes[nA2]).toBeDefined();
      expect(Object.keys(afterA.connections).length).toBe(1);
    });
  });

  // =========================================================================
  // Additional schema/integrity tests
  // =========================================================================
  describe('Additional schema and integrity checks', () => {

    it('normalizeNode returns false for node with empty string id', () => {
      const node = {
        id: '',
        type: 'source',
        position: [0, 0, 0],
        title: 'Test',
        data: {},
        inputs: [],
        outputs: [],
      };
      expect(normalizeNode(node as unknown as Record<string, unknown>)).toBe(false);
    });

    it('normalizeNode returns false for node with missing type', () => {
      const node = {
        id: 'n1',
        // type missing
        position: [0, 0, 0],
        title: 'Test',
        data: {},
        inputs: [],
        outputs: [],
      };
      expect(normalizeNode(node as unknown as Record<string, unknown>)).toBe(false);
    });

    it('normalizeNode fixes wrong-length position array to [0, 0, 0]', () => {
      const node = {
        id: 'n1',
        type: 'source',
        position: [1, 2], // only 2 elements
        title: 'Test',
        data: {},
        inputs: [],
        outputs: [],
      };
      normalizeNode(node as unknown as Record<string, unknown>);
      // Should be reset to [0, 0, 0] because length !== 3
      expect(node.position).toEqual([0, 0, 0]);
    });

    it('normalizeNode fixes non-string title to string', () => {
      const node = {
        id: 'n1',
        type: 'math',
        position: [0, 0, 0],
        title: 42 as unknown as string, // wrong type
        data: {},
        inputs: [],
        outputs: [],
      };
      normalizeNode(node as unknown as Record<string, unknown>);
      expect(typeof node.title).toBe('string');
    });

    it('import then export produces graphOrder only containing valid graphTab IDs', () => {
      const s = getState();
      s.createGraph('B');
      s.createGraph('C');

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Every ID in graphOrder must exist in graphTabs
      for (const id of after.graphOrder) {
        expect(after.graphTabs[id]).toBeDefined();
      }
    });

    it('saveMultiGraph + loadMultiGraph + importAllGraphs produces consistent state for multi-graph workspace', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      s.updateNodeData(src, 'value', 55);
      const gB = s.createGraph('B');
      s.addNode('display', [1, 0, 1]);

      const exported = getState().exportAllGraphs();
      const saved = saveMultiGraph(exported);
      expect(saved).toBe(true);

      // Reset store state only — preserve localStorage so loadMultiGraph can read it
      resetStoreOnly();
      const loaded = loadMultiGraph();
      expect(loaded).not.toBeNull();
      getState().importAllGraphs(loaded!);

      const after = getState();
      // Should have both graphs
      expect(after.graphTabs['default']).toBeDefined();
      expect(after.graphTabs[gB]).toBeDefined();
      expect(after.graphOrder.length).toBe(2);
    });

    it('connections in imported graph have correct sourceNodeId and targetNodeId', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const math = s.addNode('math', [3, 0, 0]);
      const connId = s.addConnection(src, 0, math, 0);
      expect(connId).not.toBeNull();

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      expect(after.connections[connId!]).toBeDefined();
      expect(after.connections[connId!].sourceNodeId).toBe(src);
      expect(after.connections[connId!].targetNodeId).toBe(math);
      expect(after.connections[connId!].sourcePortIndex).toBe(0);
      expect(after.connections[connId!].targetPortIndex).toBe(0);
    });
  });
});

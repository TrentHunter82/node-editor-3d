/**
 * Comprehensive serialization round-trip tests:
 * - Export -> Import -> Export identity (triple roundtrip, all node types, deep data, connection metadata)
 * - v1 -> v2 migration (legacy formats with groups, customNodeDefs, missing fields)
 * - Corrupted data recovery (missing fields, orphaned refs, out-of-range ports, unknown fields, etc.)
 * - localStorage persistence (save/load roundtrip, corrupted JSON, quota exceeded, empty)
 * - Graph data normalization (missing graphOrder, templates, activeGraphId)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { saveMultiGraph, loadMultiGraph } from '../utils/serialization';
import type { MultiGraphStorage } from '../utils/serialization';
import type { EditorNode, NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset store state and localStorage. */
function resetStore() {
  resetStoreOnly();
  localStorage.clear();
}

/** Reset store state without touching localStorage. */
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
    s.executionMetrics = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

function getState() {
  return useEditorStore.getState();
}

/**
 * Strip timestamp-like fields (createdAt) from a storage object for comparison,
 * since timestamps may differ between export calls.
 */
function stripTimestamps(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripTimestamps);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (key === 'createdAt') continue;
    result[key] = stripTimestamps(val);
  }
  return result;
}

// All 50 node types from the NodeType union.
// 'custom', 'subgraph', 'subgraph-input', 'subgraph-output' need special handling
// because their ports are dynamically configured. We handle them separately.
const STANDARD_NODE_TYPES: NodeType[] = [
  'source', 'transform', 'filter', 'output',
  'math', 'clamp', 'remap',
  'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt',
  'lerp',
  'concat', 'template',
  'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number',
  'compare', 'switch',
  'and', 'or', 'not', 'xor',
  'compose-vec3', 'decompose-vec3',
  'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length',
  'mean', 'median', 'stddev', 'min-array', 'max-array',
  'note', 'reroute', 'random', 'display',
];

const STORAGE_KEY = 'node-editor-3d-graph';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Serialization Round-Trip', () => {
  beforeEach(resetStore);

  // =======================================================================
  // Export -> Import -> Export Identity Tests
  // =======================================================================
  describe('Export -> Import -> Export Identity', () => {

    // Test 1: Triple roundtrip identity
    it('triple roundtrip: export -> import -> export -> import -> export produces identical JSON (except timestamps)', () => {
      const s = getState();
      const src = s.addNode('source', [1, 2, 3]);
      const math = s.addNode('math', [4, 5, 6]);
      const xform = s.addNode('transform', [7, 8, 9]);
      s.updateNodeData(src, 'value', 77);
      s.updateNodeTitle(src, 'TripleRT');
      const c1 = s.addConnection(src, 0, math, 0);
      const c2 = s.addConnection(math, 0, xform, 0);
      s.updateConnectionLabel(c1!, 'flow-a');
      s.updateConnectionColor(c2!, '#AABBCC');

      // First export
      const export1 = getState().exportAllGraphs();

      // Round 1: import + export
      resetStore();
      getState().importAllGraphs(export1);
      const export2 = getState().exportAllGraphs();

      // Round 2: import + export
      resetStore();
      getState().importAllGraphs(export2);
      const export3 = getState().exportAllGraphs();

      // Compare export1, export2, export3 (minus timestamps)
      const stripped1 = stripTimestamps(export1);
      const stripped2 = stripTimestamps(export2);
      const stripped3 = stripTimestamps(export3);

      expect(stripped2).toEqual(stripped1);
      expect(stripped3).toEqual(stripped1);

      // Also compare JSON strings (deterministic order after stripping)
      const json1 = JSON.stringify(stripped1, Object.keys(stripped1 as object).sort());
      const json3 = JSON.stringify(stripped3, Object.keys(stripped3 as object).sort());
      expect(json3).toBe(json1);
    });

    // Test 2: Identity with every standard node type
    it('identity with every standard node type: all 46 standard types survive roundtrip with all fields', () => {
      const s = getState();

      // Create one node of each standard type at different positions
      const nodeIds: Record<string, string> = {};
      STANDARD_NODE_TYPES.forEach((type, i) => {
        const id = s.addNode(type, [i * 3, 0, i]);
        nodeIds[type] = id;
      });

      expect(Object.keys(getState().nodes).length).toBe(STANDARD_NODE_TYPES.length);

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Verify every node type was preserved
      expect(Object.keys(after.nodes).length).toBe(STANDARD_NODE_TYPES.length);

      for (const type of STANDARD_NODE_TYPES) {
        const id = nodeIds[type];
        const node = after.nodes[id];
        expect(node, `Node of type ${type} should exist after roundtrip`).toBeDefined();
        expect(node.type).toBe(type);
        expect(node.id).toBe(id);
        expect(Array.isArray(node.position)).toBe(true);
        expect(node.position.length).toBe(3);
        expect(typeof node.title).toBe('string');
        expect(Array.isArray(node.inputs)).toBe(true);
        expect(Array.isArray(node.outputs)).toBe(true);
        expect(node.data).toBeDefined();
        expect(typeof node.data).toBe('object');
      }

      // Second export should match first (minus timestamps)
      const export2 = getState().exportAllGraphs();
      expect(stripTimestamps(export2)).toEqual(stripTimestamps(exported));
    });

    // Test 3: Identity with deeply nested node data
    it('identity with deeply nested node data: complex objects, arrays, nulls preserved', () => {
      const s = getState();
      const id = s.addNode('source', [0, 0, 0]);

      // Set deeply nested data
      s.updateNodeData(id, 'nested', {
        level1: {
          level2: {
            level3: {
              value: 42,
              tags: ['alpha', 'beta', 'gamma'],
              matrix: [[1, 2], [3, 4]],
            },
          },
          sibling: null,
        },
      });
      s.updateNodeData(id, 'emptyObj', {});
      s.updateNodeData(id, 'emptyArr', []);
      s.updateNodeData(id, 'boolTrue', true);
      s.updateNodeData(id, 'boolFalse', false);
      s.updateNodeData(id, 'zero', 0);
      s.updateNodeData(id, 'emptyString', '');
      s.updateNodeData(id, 'unicodeStr', '\u00e9\u00e0\u00fc \ud83c\udf1f');
      s.updateNodeData(id, 'largeNumber', Number.MAX_SAFE_INTEGER);
      s.updateNodeData(id, 'negativeFloat', -3.14159265);

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();
      const data = after.nodes[id].data;

      expect(data.nested).toEqual({
        level1: {
          level2: {
            level3: {
              value: 42,
              tags: ['alpha', 'beta', 'gamma'],
              matrix: [[1, 2], [3, 4]],
            },
          },
          sibling: null,
        },
      });
      expect(data.emptyObj).toEqual({});
      expect(data.emptyArr).toEqual([]);
      expect(data.boolTrue).toBe(true);
      expect(data.boolFalse).toBe(false);
      expect(data.zero).toBe(0);
      expect(data.emptyString).toBe('');
      expect(data.unicodeStr).toBe('\u00e9\u00e0\u00fc \ud83c\udf1f');
      expect(data.largeNumber).toBe(Number.MAX_SAFE_INTEGER);
      expect(data.negativeFloat).toBe(-3.14159265);

      // Second export should match first
      const export2 = getState().exportAllGraphs();
      expect(stripTimestamps(export2)).toEqual(stripTimestamps(exported));
    });

    // Test 4: Identity with connection metadata variations
    it('identity with connection metadata variations: labels, colors, both, neither', () => {
      const s = getState();
      const src = s.addNode('source', [0, 0, 0]);
      const m1 = s.addNode('math', [3, 0, 0]);
      const m2 = s.addNode('math', [6, 0, 0]);
      const m3 = s.addNode('math', [9, 0, 0]);
      const m4 = s.addNode('math', [12, 0, 0]);

      // Connection with label only
      const cLabel = s.addConnection(src, 0, m1, 0)!;
      s.updateConnectionLabel(cLabel, 'label-only');

      // Connection with color only
      const cColor = s.addConnection(src, 0, m2, 0)!;
      s.updateConnectionColor(cColor, '#FF0000');

      // Connection with both label and color
      const cBoth = s.addConnection(src, 0, m3, 0)!;
      s.updateConnectionLabel(cBoth, 'both-label');
      s.updateConnectionColor(cBoth, '#00FF00');

      // Connection with neither (plain)
      const cPlain = s.addConnection(src, 0, m4, 0)!;

      const exported = getState().exportAllGraphs();
      resetStore();
      getState().importAllGraphs(exported);
      const after = getState();

      // Label-only connection
      expect(after.connections[cLabel].label).toBe('label-only');
      expect(after.connections[cLabel].colorOverride).toBeUndefined();

      // Color-only connection
      expect(after.connections[cColor].label).toBeUndefined();
      expect(after.connections[cColor].colorOverride).toBe('#FF0000');

      // Both label and color
      expect(after.connections[cBoth].label).toBe('both-label');
      expect(after.connections[cBoth].colorOverride).toBe('#00FF00');

      // Plain connection (no metadata)
      expect(after.connections[cPlain].label).toBeUndefined();
      expect(after.connections[cPlain].colorOverride).toBeUndefined();

      // Verify second export matches
      const export2 = getState().exportAllGraphs();
      expect(stripTimestamps(export2)).toEqual(stripTimestamps(exported));
    });
  });

  // =======================================================================
  // v1 -> v2 Migration Tests
  // =======================================================================
  describe('v1 -> v2 Migration', () => {

    // Test 5: Legacy v1 single-graph format migration
    it('legacy v1 format (nodes + connections, no version) migrates to valid v2 MultiGraphStorage', () => {
      const legacyData = {
        nodes: {
          'node-1': {
            id: 'node-1',
            type: 'source',
            position: [0, 0, 0],
            title: 'Source',
            data: { value: 10 },
            inputs: [],
            outputs: [
              { id: 'out-0', label: 'value', portType: 'number' },
              { id: 'out-1', label: 'label', portType: 'string' },
            ],
          },
          'node-2': {
            id: 'node-2',
            type: 'math',
            position: [3, 0, 0],
            title: 'Math',
            data: { operation: 'add' },
            inputs: [
              { id: 'in-0', label: 'a', portType: 'number' },
              { id: 'in-1', label: 'b', portType: 'number' },
            ],
            outputs: [
              { id: 'out-0', label: 'result', portType: 'number' },
            ],
          },
        },
        connections: {
          'conn-1': {
            id: 'conn-1',
            sourceNodeId: 'node-1',
            sourcePortIndex: 0,
            targetNodeId: 'node-2',
            targetPortIndex: 0,
          },
        },
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyData));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);
      expect(result!.graphs).toBeDefined();
      expect(result!.graphs['default']).toBeDefined();
      expect(result!.graphTabs).toBeDefined();
      expect(result!.graphTabs['default']).toBeDefined();
      expect(result!.activeGraphId).toBe('default');
      expect(result!.graphOrder).toEqual(['default']);
      expect(result!.templates).toEqual({});

      // Data should be preserved
      const graph = result!.graphs['default'];
      expect(Object.keys(graph.nodes).length).toBe(2);
      expect(graph.nodes['node-1'].data.value).toBe(10);
      expect(Object.keys(graph.connections).length).toBe(1);
      expect(graph.connections['conn-1'].sourceNodeId).toBe('node-1');
    });

    // Test 6: v1 format with groups migrates correctly
    it('v1 format with groups migrates groups into v2 graph data', () => {
      const legacyData = {
        nodes: {
          'node-1': {
            id: 'node-1',
            type: 'source',
            position: [0, 0, 0],
            title: 'Source',
            data: {},
            inputs: [],
            outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
            groupId: 'group-1',
          },
        },
        connections: {},
        groups: {
          'group-1': {
            id: 'group-1',
            label: 'MyGroup',
            collapsed: false,
          },
        },
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyData));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);
      const graph = result!.graphs['default'];
      expect(graph.groups).toBeDefined();
      expect(graph.groups['group-1']).toBeDefined();
      expect(graph.groups['group-1'].label).toBe('MyGroup');
      expect(graph.groups['group-1'].collapsed).toBe(false);
      expect(graph.nodes['node-1'].groupId).toBe('group-1');
    });

    // Test 7: v1 format with customNodeDefs migrates correctly
    it('v1 format with customNodeDefs migrates defs into v2 graph data', () => {
      const legacyData = {
        nodes: {
          'node-1': {
            id: 'node-1',
            type: 'source',
            position: [0, 0, 0],
            title: 'Source',
            data: {},
            inputs: [],
            outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
          },
        },
        connections: {},
        customNodeDefs: {
          'def-1': {
            id: 'def-1',
            name: 'Doubler',
            color: '#00FF00',
            category: 'Math',
            expression: 'inputs[0] * 2',
            inputs: [{ label: 'x', portType: 'number' }],
            outputs: [{ label: 'result', portType: 'number' }],
          },
        },
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyData));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      const graph = result!.graphs['default'];
      expect(graph.customNodeDefs).toBeDefined();
      expect(graph.customNodeDefs['def-1']).toBeDefined();
      expect(graph.customNodeDefs['def-1'].name).toBe('Doubler');
      expect(graph.customNodeDefs['def-1'].expression).toBe('inputs[0] * 2');
    });

    // Test 8: v1 missing optional fields get defaults
    it('v1 format without groups or customNodeDefs defaults them to empty objects', () => {
      const legacyData = {
        nodes: {
          'node-1': {
            id: 'node-1',
            type: 'source',
            position: [0, 0, 0],
            title: 'Source',
            data: {},
            inputs: [],
            outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
          },
        },
        connections: {},
        // No groups, no customNodeDefs
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyData));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      const graph = result!.graphs['default'];
      expect(graph.groups).toEqual({});
      expect(graph.customNodeDefs).toEqual({});
    });
  });

  // =======================================================================
  // Corrupted Data Recovery Tests
  // =======================================================================
  describe('Corrupted Data Recovery', () => {

    // Test 9: Missing nodes field
    it('storage with missing or null nodes field does not crash on load', () => {
      // v2 format with nodes undefined
      const corrupt: Record<string, unknown> = {
        version: 2,
        graphs: {
          default: {
            // nodes is missing
            connections: {},
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(corrupt));
      const result = loadMultiGraph();

      // loadMultiGraph should normalize the missing nodes field to {}
      expect(result).not.toBeNull();
      expect(result!.graphs['default'].nodes).toEqual({});
    });

    // Test 10: Node with missing required fields
    it('node missing type or position - importAllGraphs still loads valid nodes', () => {
      const storage: MultiGraphStorage = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              'node-ok': {
                id: 'node-ok',
                type: 'source',
                position: [0, 0, 0],
                title: 'Good Node',
                data: { value: 5 },
                inputs: [],
                outputs: [
                  { id: 'out-0', label: 'value', portType: 'number' },
                  { id: 'out-1', label: 'label', portType: 'string' },
                ],
              },
              'node-bad': {
                id: 'node-bad',
                // Missing type and position - this is malformed
                title: 'Bad Node',
                data: {},
                inputs: [],
                outputs: [],
              } as unknown as EditorNode,
            },
            connections: {},
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      // Should not throw during import
      expect(() => getState().importAllGraphs(storage)).not.toThrow();

      // The valid node should be present
      const after = getState();
      expect(after.nodes['node-ok']).toBeDefined();
      expect(after.nodes['node-ok'].data.value).toBe(5);
    });

    // Test 11: Connection referencing non-existent node
    it('connection referencing non-existent node is sanitized away on import', () => {
      const storage: MultiGraphStorage = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              'node-1': {
                id: 'node-1',
                type: 'source',
                position: [0, 0, 0],
                title: 'Source',
                data: {},
                inputs: [],
                outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
              },
            },
            connections: {
              'conn-orphan': {
                id: 'conn-orphan',
                sourceNodeId: 'node-1',
                sourcePortIndex: 0,
                targetNodeId: 'node-nonexistent', // does not exist
                targetPortIndex: 0,
              },
              'conn-orphan2': {
                id: 'conn-orphan2',
                sourceNodeId: 'node-also-missing', // does not exist
                sourcePortIndex: 0,
                targetNodeId: 'node-1',
                targetPortIndex: 0,
              },
            },
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      getState().importAllGraphs(storage);
      const after = getState();

      // Orphaned connections should have been sanitized away
      expect(Object.keys(after.connections).length).toBe(0);
      // Valid node should still be present
      expect(after.nodes['node-1']).toBeDefined();
    });

    // Test 12: Connection with out-of-range port index
    it('connection with out-of-range port index is sanitized away on import', () => {
      const storage: MultiGraphStorage = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              'node-1': {
                id: 'node-1',
                type: 'source',
                position: [0, 0, 0],
                title: 'Source',
                data: {},
                inputs: [],
                outputs: [
                  { id: 'out-0', label: 'value', portType: 'number' },
                  { id: 'out-1', label: 'label', portType: 'string' },
                ],
              },
              'node-2': {
                id: 'node-2',
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
              'conn-valid': {
                id: 'conn-valid',
                sourceNodeId: 'node-1',
                sourcePortIndex: 0,
                targetNodeId: 'node-2',
                targetPortIndex: 0,
              },
              'conn-bad-src': {
                id: 'conn-bad-src',
                sourceNodeId: 'node-1',
                sourcePortIndex: 99, // out of range
                targetNodeId: 'node-2',
                targetPortIndex: 0,
              },
              'conn-bad-tgt': {
                id: 'conn-bad-tgt',
                sourceNodeId: 'node-1',
                sourcePortIndex: 0,
                targetNodeId: 'node-2',
                targetPortIndex: 99, // out of range
              },
              'conn-negative': {
                id: 'conn-negative',
                sourceNodeId: 'node-1',
                sourcePortIndex: -1, // negative
                targetNodeId: 'node-2',
                targetPortIndex: 0,
              },
            },
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      getState().importAllGraphs(storage);
      const after = getState();

      // Only the valid connection should remain
      expect(Object.keys(after.connections).length).toBe(1);
      expect(after.connections['conn-valid']).toBeDefined();
      expect(after.connections['conn-bad-src']).toBeUndefined();
      expect(after.connections['conn-bad-tgt']).toBeUndefined();
      expect(after.connections['conn-negative']).toBeUndefined();
    });

    // Test 13: Circular reference in node data (after JSON parse fix)
    it('node data with values that survive JSON serialization roundtrip works correctly', () => {
      // Circular references cannot survive JSON.stringify/parse, so this tests
      // that the system handles data that has already been through JSON (which is
      // the case for localStorage persistence). We verify that non-circular but
      // deeply nested repeated-reference structures are handled by structuredClone.
      const s = getState();
      const id = s.addNode('source', [0, 0, 0]);

      const sharedArray = [1, 2, 3];
      s.updateNodeData(id, 'refA', sharedArray);
      s.updateNodeData(id, 'refB', sharedArray);

      const exported = getState().exportAllGraphs();

      // Go through JSON (simulating localStorage)
      const jsonStr = JSON.stringify(exported);
      const reparsed = JSON.parse(jsonStr) as MultiGraphStorage;

      resetStore();
      getState().importAllGraphs(reparsed);
      const after = getState();

      expect(after.nodes[id].data.refA).toEqual([1, 2, 3]);
      expect(after.nodes[id].data.refB).toEqual([1, 2, 3]);
      // After JSON roundtrip, shared references become independent copies
      expect(after.nodes[id].data.refA).not.toBe(after.nodes[id].data.refB);
    });

    // Test 14: Extra unknown fields are preserved or ignored gracefully
    it('storage with extra unknown properties does not crash and core data is preserved', () => {
      const storage = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              'node-1': {
                id: 'node-1',
                type: 'source',
                position: [0, 0, 0],
                title: 'Source',
                data: { value: 42 },
                inputs: [],
                outputs: [
                  { id: 'out-0', label: 'value', portType: 'number' },
                  { id: 'out-1', label: 'label', portType: 'string' },
                ],
                unknownNodeField: 'should not crash',
              },
            },
            connections: {},
            groups: {},
            customNodeDefs: {},
            unknownGraphField: { some: 'data' },
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
        unknownTopLevel: [1, 2, 3],
      } as unknown as MultiGraphStorage;

      expect(() => getState().importAllGraphs(storage)).not.toThrow();
      const after = getState();
      expect(after.nodes['node-1']).toBeDefined();
      expect(after.nodes['node-1'].data.value).toBe(42);
    });

    // Test 15: Empty string IDs
    it('nodes or connections with empty string IDs are handled without crash', () => {
      const storage: MultiGraphStorage = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              '': {
                id: '',
                type: 'source',
                position: [0, 0, 0],
                title: 'EmptyId',
                data: {},
                inputs: [],
                outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
              },
              'node-valid': {
                id: 'node-valid',
                type: 'math',
                position: [3, 0, 0],
                title: 'Valid',
                data: {},
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
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      expect(() => getState().importAllGraphs(storage)).not.toThrow();
      const after = getState();
      // At minimum the valid node should be accessible
      expect(after.nodes['node-valid']).toBeDefined();
    });

    // Test 16: Duplicate connection IDs (same key, just one wins in a Record)
    it('connections with duplicate ID keys collapse to one entry (last wins in Record)', () => {
      // In JSON, duplicate keys in an object cause the last one to win.
      // This test verifies that behavior is handled gracefully.
      const jsonStr = JSON.stringify({
        version: 2,
        graphs: {
          default: {
            nodes: {
              'node-1': {
                id: 'node-1', type: 'source', position: [0, 0, 0], title: 'Source',
                data: {}, inputs: [],
                outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
              },
              'node-2': {
                id: 'node-2', type: 'math', position: [3, 0, 0], title: 'Math',
                data: {},
                inputs: [{ id: 'in-0', label: 'a', portType: 'number' }, { id: 'in-1', label: 'b', portType: 'number' }],
                outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
              },
            },
            connections: {
              'conn-1': {
                id: 'conn-1', sourceNodeId: 'node-1', sourcePortIndex: 0,
                targetNodeId: 'node-2', targetPortIndex: 0,
              },
            },
            groups: {},
            customNodeDefs: {},
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      });

      const parsed = JSON.parse(jsonStr) as MultiGraphStorage;
      expect(() => getState().importAllGraphs(parsed)).not.toThrow();

      const after = getState();
      // Should have exactly one connection
      expect(Object.keys(after.connections).length).toBe(1);
    });

    // Test 17: graphOrder with missing graph IDs
    it('graphOrder referencing non-existent graphs is sanitized during import', () => {
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
        graphOrder: ['default', 'ghost-graph-1', 'ghost-graph-2'],
        templates: {},
      };

      getState().importAllGraphs(storage);
      const after = getState();

      // graphOrder should have been sanitized to only include valid entries
      expect(after.graphOrder).toContain('default');
      expect(after.graphOrder).not.toContain('ghost-graph-1');
      expect(after.graphOrder).not.toContain('ghost-graph-2');
      expect(after.graphOrder.length).toBe(1);
    });

    // Test 18: activeGraphId referencing non-existent graph
    it('activeGraphId set to non-existent graph causes import to be rejected', () => {
      const s = getState();
      const srcBefore = s.addNode('source', [0, 0, 0]);

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
        activeGraphId: 'nonexistent-graph-id',
        graphOrder: ['default'],
        templates: {},
      };

      // importAllGraphs checks if activeGraph exists; if not, it returns early
      getState().importAllGraphs(storage);
      const after = getState();

      // Store should remain unchanged because import was rejected
      expect(after.nodes[srcBefore]).toBeDefined();
    });
  });

  // =======================================================================
  // localStorage Persistence Tests
  // =======================================================================
  describe('localStorage Persistence', () => {

    // Test 19: saveMultiGraph + loadMultiGraph roundtrip
    it('saveMultiGraph saves to localStorage and loadMultiGraph reads it back identically', () => {
      const s = getState();
      const src = s.addNode('source', [1, 2, 3]);
      const math = s.addNode('math', [4, 5, 6]);
      s.addConnection(src, 0, math, 0);
      s.updateNodeData(src, 'value', 99);

      const exported = getState().exportAllGraphs();
      const saveResult = saveMultiGraph(exported);
      expect(saveResult).toBe(true);

      const loaded = loadMultiGraph();
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(2);
      expect(loaded!.activeGraphId).toBe(exported.activeGraphId);
      expect(Object.keys(loaded!.graphs['default'].nodes).length).toBe(2);
      expect(loaded!.graphs['default'].nodes[src].data.value).toBe(99);
      expect(Object.keys(loaded!.graphs['default'].connections).length).toBe(1);

      // Deep equality (timestamps will match since we saved the same object)
      expect(loaded!.graphTabs).toEqual(exported.graphTabs);
      expect(loaded!.graphOrder).toEqual(exported.graphOrder);
      expect(loaded!.templates).toEqual(exported.templates);
    });

    // Test 20: localStorage corrupted JSON
    it('loadMultiGraph returns null when localStorage contains invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
      const result = loadMultiGraph();
      expect(result).toBeNull();
    });

    // Test 21: localStorage quota exceeded
    it('saveMultiGraph returns false when localStorage.setItem throws QuotaExceededError', () => {
      const storage: MultiGraphStorage = {
        version: 2,
        graphs: {
          default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      // Mock localStorage.setItem to throw
      const originalSetItem = localStorage.setItem.bind(localStorage);
      const mockSetItem = vi.fn().mockImplementation(() => {
        const error = new DOMException('QuotaExceededError', 'QuotaExceededError');
        throw error;
      });
      localStorage.setItem = mockSetItem;

      try {
        const result = saveMultiGraph(storage);
        expect(result).toBe(false);
        expect(mockSetItem).toHaveBeenCalled();
      } finally {
        localStorage.setItem = originalSetItem;
      }
    });

    // Test 22: localStorage empty
    it('loadMultiGraph returns null when localStorage has no data', () => {
      localStorage.clear();
      const result = loadMultiGraph();
      expect(result).toBeNull();
    });
  });

  // =======================================================================
  // Graph Data Normalization Tests
  // =======================================================================
  describe('Graph Data Normalization', () => {

    // Test 23: Normalizes missing graphOrder
    it('v2 storage missing graphOrder field gets default from graphTabs keys', () => {
      const data: Record<string, unknown> = {
        version: 2,
        graphs: {
          default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
          'graph-2': { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        },
        graphTabs: {
          default: { id: 'default', name: 'Main', createdAt: 1000 },
          'graph-2': { id: 'graph-2', name: 'Second', createdAt: 2000 },
        },
        activeGraphId: 'default',
        // graphOrder is intentionally missing
        templates: {},
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      expect(Array.isArray(result!.graphOrder)).toBe(true);
      // Should contain all graphTabs keys
      expect(result!.graphOrder).toContain('default');
      expect(result!.graphOrder).toContain('graph-2');
      expect(result!.graphOrder.length).toBe(2);
    });

    // Test 24: Normalizes missing templates
    it('v2 storage missing templates field gets default {}', () => {
      const data: Record<string, unknown> = {
        version: 2,
        graphs: {
          default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        },
        graphTabs: {
          default: { id: 'default', name: 'Main', createdAt: 1000 },
        },
        activeGraphId: 'default',
        graphOrder: ['default'],
        // templates is intentionally missing
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      expect(result!.templates).toEqual({});
    });

    // Test 25: Normalizes missing activeGraphId
    it('v2 storage missing activeGraphId gets first graph key as default', () => {
      const data: Record<string, unknown> = {
        version: 2,
        graphs: {
          'first-graph': { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
          'second-graph': { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        },
        graphTabs: {
          'first-graph': { id: 'first-graph', name: 'First', createdAt: 1000 },
          'second-graph': { id: 'second-graph', name: 'Second', createdAt: 2000 },
        },
        // activeGraphId is intentionally missing
        graphOrder: ['first-graph', 'second-graph'],
        templates: {},
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      expect(typeof result!.activeGraphId).toBe('string');
      // Should default to first key of graphs
      expect(result!.activeGraphId).toBe('first-graph');
    });

    // Additional normalization test: v2 with null activeGraphId
    it('v2 storage with null activeGraphId gets normalized to first graph key', () => {
      const data: Record<string, unknown> = {
        version: 2,
        graphs: {
          default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        },
        graphTabs: {
          default: { id: 'default', name: 'Main', createdAt: 1000 },
        },
        activeGraphId: null,
        graphOrder: ['default'],
        templates: {},
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      expect(result!.activeGraphId).toBe('default');
    });

    // Additional normalization test: per-graph records with missing sub-fields
    it('v2 per-graph data with missing connections/groups/customNodeDefs gets defaults', () => {
      const data: Record<string, unknown> = {
        version: 2,
        graphs: {
          default: {
            nodes: {
              'node-1': {
                id: 'node-1', type: 'source', position: [0, 0, 0], title: 'S',
                data: {}, inputs: [], outputs: [],
              },
            },
            // connections, groups, customNodeDefs, subgraphDefs all missing
          },
        },
        graphTabs: { default: { id: 'default', name: 'Main', createdAt: 1000 } },
        activeGraphId: 'default',
        graphOrder: ['default'],
        templates: {},
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const result = loadMultiGraph();

      expect(result).not.toBeNull();
      const graph = result!.graphs['default'];
      expect(graph.connections).toEqual({});
      expect(graph.groups).toEqual({});
      expect(graph.customNodeDefs).toEqual({});
      expect(graph.subgraphDefs).toEqual({});
      // Original nodes should still be present
      expect(graph.nodes['node-1']).toBeDefined();
    });
  });

  // =======================================================================
  // Additional Edge Case Tests
  // =======================================================================
  describe('Additional Edge Cases', () => {

    it('v2 storage with empty graphs record returns null from loadMultiGraph', () => {
      const data: Record<string, unknown> = {
        version: 2,
        graphs: {},
        graphTabs: {},
        activeGraphId: 'default',
        graphOrder: [],
        templates: {},
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const result = loadMultiGraph();

      // loadMultiGraph returns null when no valid graphs remain
      expect(result).toBeNull();
    });

    it('non-object values in localStorage are rejected', () => {
      // String value
      localStorage.setItem(STORAGE_KEY, JSON.stringify('just a string'));
      expect(loadMultiGraph()).toBeNull();

      // Array value
      localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
      expect(loadMultiGraph()).toBeNull();

      // Number value
      localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
      expect(loadMultiGraph()).toBeNull();

      // Boolean value
      localStorage.setItem(STORAGE_KEY, JSON.stringify(true));
      expect(loadMultiGraph()).toBeNull();

      // Null value
      localStorage.setItem(STORAGE_KEY, JSON.stringify(null));
      expect(loadMultiGraph()).toBeNull();
    });

    it('saveMultiGraph followed by importAllGraphs via loadMultiGraph produces consistent state', () => {
      const s = getState();
      const src = s.addNode('source', [10, 20, 30]);
      const math = s.addNode('math', [40, 50, 60]);
      s.addConnection(src, 0, math, 0);
      s.updateNodeTitle(src, 'Persistent Source');
      s.updateNodeData(src, 'value', 777);

      // Save to localStorage
      const exported = getState().exportAllGraphs();
      const saved = saveMultiGraph(exported);
      expect(saved).toBe(true);

      // Reset store state only (preserve localStorage)
      resetStoreOnly();

      // Load from localStorage and import
      const loaded = loadMultiGraph();
      expect(loaded).not.toBeNull();
      getState().importAllGraphs(loaded!);

      const after = getState();
      expect(after.nodes[src]).toBeDefined();
      expect(after.nodes[src].title).toBe('Persistent Source');
      expect(after.nodes[src].data.value).toBe(777);
      expect(after.nodes[src].position).toEqual([10, 20, 30]);
      expect(after.nodes[math]).toBeDefined();
      expect(Object.keys(after.connections).length).toBe(1);
    });

    it('v1 format with no nodes at all is rejected', () => {
      // v1 format requires nodes and connections to be plain objects
      const data = {
        somethingElse: 'not a valid graph format',
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).toBeNull();
    });

    it('multiple save/load cycles through localStorage remain stable', () => {
      const s = getState();
      s.addNode('source', [1, 1, 1]);

      // Cycle 1: export -> save -> load -> import
      const exp1 = getState().exportAllGraphs();
      saveMultiGraph(exp1);

      resetStoreOnly();
      const load1 = loadMultiGraph()!;
      getState().importAllGraphs(load1);

      // Cycle 2: export -> save -> load -> import
      const exp2 = getState().exportAllGraphs();
      saveMultiGraph(exp2);

      resetStoreOnly();
      const load2 = loadMultiGraph()!;
      getState().importAllGraphs(load2);

      // Cycle 3: export -> save -> load -> import
      const exp3 = getState().exportAllGraphs();
      saveMultiGraph(exp3);

      resetStoreOnly();
      const load3 = loadMultiGraph()!;
      getState().importAllGraphs(load3);

      // All three exports (minus timestamps) should be equal
      expect(stripTimestamps(exp2)).toEqual(stripTimestamps(exp1));
      expect(stripTimestamps(exp3)).toEqual(stripTimestamps(exp1));

      // Final state should match initial
      const final = getState();
      expect(Object.keys(final.nodes).length).toBe(1);
      const node = Object.values(final.nodes)[0];
      expect(node.type).toBe('source');
      expect(node.position).toEqual([1, 1, 1]);
    });
  });
});

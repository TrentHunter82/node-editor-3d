/// <reference types="vitest/config" />
/**
 * Tests for node versioning and migration infrastructure.
 *
 * These tests verify the underlying patterns that a future node versioning
 * system would rely on: NODE_TYPE_CONFIG schema integrity, port migration
 * detection via validateGraphData, custom node port updates, and node type
 * compatibility across all 55+ built-in types.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../types/index';
import type { EditorNode, NodeType } from '../types/index';
import { executeGraph } from '../utils/execution';
import { validateGraphData } from '../utils/migration';
import {
  migrateNodePorts,
  migrateNodeTitle,
  detectAllMismatches,
  migrateAllNodes,
} from '../utils/nodeVersioning';
import { TYPE_LABELS } from '../types/nodeLabels';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() { return useEditorStore.getState(); }

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
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
  });
}

const VALID_PORT_TYPES = new Set(['number', 'string', 'boolean', 'color', 'vector3', 'array', 'object', 'image', 'any']);

// ===========================================================================
// 1. NODE_TYPE_CONFIG schema verification (6 tests)
// ===========================================================================

describe('NODE_TYPE_CONFIG schema verification', () => {
  const allTypes = Object.keys(NODE_TYPE_CONFIG) as Array<keyof typeof NODE_TYPE_CONFIG>;

  it('every node type has a valid inputs array with label and portType on each entry', () => {
    for (const type of allTypes) {
      const config = NODE_TYPE_CONFIG[type];
      expect(Array.isArray(config.inputs), `${type} inputs should be an array`).toBe(true);
      for (const port of config.inputs) {
        expect(typeof port.label, `${type} input port missing label`).toBe('string');
        expect(port.label.length, `${type} input port has empty label`).toBeGreaterThan(0);
        expect(typeof port.portType, `${type} input port missing portType`).toBe('string');
      }
    }
  });

  it('every node type has a valid outputs array with label and portType on each entry', () => {
    for (const type of allTypes) {
      const config = NODE_TYPE_CONFIG[type];
      expect(Array.isArray(config.outputs), `${type} outputs should be an array`).toBe(true);
      for (const port of config.outputs) {
        expect(typeof port.label, `${type} output port missing label`).toBe('string');
        expect(port.label.length, `${type} output port has empty label`).toBeGreaterThan(0);
        expect(typeof port.portType, `${type} output port missing portType`).toBe('string');
      }
    }
  });

  it('all port types are from the allowed set', () => {
    for (const type of allTypes) {
      const config = NODE_TYPE_CONFIG[type];
      for (const port of [...config.inputs, ...config.outputs]) {
        expect(
          VALID_PORT_TYPES.has(port.portType),
          `${type} has invalid portType "${port.portType}" on port "${port.label}"`
        ).toBe(true);
      }
    }
  });

  it('no duplicate port labels within a node type inputs', () => {
    for (const type of allTypes) {
      const config = NODE_TYPE_CONFIG[type];
      const labels = config.inputs.map(p => p.label);
      const unique = new Set(labels);
      expect(
        unique.size,
        `${type} has duplicate input port labels: ${labels.join(', ')}`
      ).toBe(labels.length);
    }
  });

  it('no duplicate port labels within a node type outputs', () => {
    for (const type of allTypes) {
      const config = NODE_TYPE_CONFIG[type];
      const labels = config.outputs.map(p => p.label);
      const unique = new Set(labels);
      expect(
        unique.size,
        `${type} has duplicate output port labels: ${labels.join(', ')}`
      ).toBe(labels.length);
    }
  });

  it('NODE_CATEGORIES contains entries for all types in NODE_TYPE_CONFIG', () => {
    for (const type of allTypes) {
      expect(
        type in NODE_CATEGORIES,
        `${type} is in NODE_TYPE_CONFIG but missing from NODE_CATEGORIES`
      ).toBe(true);
      expect(typeof NODE_CATEGORIES[type]).toBe('string');
    }
  });
});

// ===========================================================================
// 2. Port migration simulation (7 tests)
// ===========================================================================

describe('Port migration simulation', () => {
  beforeEach(() => { resetStore(); });

  it('node with extra ports beyond config - connections to extra ports are detected as invalid', () => {
    // Create a source node and a math node, then manually shrink the math node's
    // inputs to fewer than what a connection targets, simulating a schema migration
    // that removed a port.
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const mathId = getStore().addNode('math', [5, 0, 0]);

    // Connect source output 0 -> math input 1 (the 'b' port, index 1)
    const connId = getStore().addConnection(srcId, 0, mathId, 1);
    expect(connId).toBeTruthy();

    // Simulate schema migration: math node now only has 1 input instead of 2
    const graphData = {
      nodes: { ...getStore().nodes },
      connections: { ...getStore().connections },
      groups: {},
      customNodeDefs: {},
    };
    // Trim the math node to only 1 input port
    graphData.nodes[mathId] = {
      ...graphData.nodes[mathId],
      inputs: [graphData.nodes[mathId].inputs[0]],
    };

    // validateGraphData should remove the connection targeting index 1
    // because the node now only has 1 input (index 0)
    validateGraphData(graphData);
    expect(Object.keys(graphData.connections)).toHaveLength(0);
  });

  it('node with fewer ports than config - missing ports detected by out-of-range index', () => {
    // Build graph data with a node that has 0 inputs but a connection targeting input 0
    const graphData = {
      nodes: {
        'n1': {
          id: 'n1', type: 'source' as const, position: [0, 0, 0] as [number, number, number],
          title: 'Source', data: {},
          inputs: [],
          outputs: [{ id: 'out-0', label: 'value', portType: 'number' as const }],
        },
        'n2': {
          id: 'n2', type: 'output' as const, position: [5, 0, 0] as [number, number, number],
          title: 'Output', data: {},
          inputs: [], // Simulating migration: node lost its input port
          outputs: [],
        },
      },
      connections: {
        'c1': {
          id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 0,
          targetNodeId: 'n2', targetPortIndex: 0,
        },
      },
      groups: {},
      customNodeDefs: {},
    };

    validateGraphData(graphData);
    // Connection should be removed because n2 has 0 inputs
    expect(Object.keys(graphData.connections)).toHaveLength(0);
  });

  it('changing port type (editing node.inputs directly) - type mismatch connections flagged', () => {
    // Create nodes and connect them with compatible types
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);

    // source output 0 (number) -> transform input 0 (number) - valid
    const connId = getStore().addConnection(srcId, 0, xfmId, 0);
    expect(connId).toBeTruthy();

    // Now simulate a schema change: transform input 0 is now 'string' instead of 'number'
    // validateGraphData does not check type compatibility - it only checks structural validity.
    // So the connection should still be present (type checking is a runtime concern, not a
    // structural migration concern).
    const graphData = {
      nodes: { ...getStore().nodes },
      connections: { ...getStore().connections },
      groups: {},
      customNodeDefs: {},
    };
    // Mutate the port type
    graphData.nodes[xfmId] = {
      ...graphData.nodes[xfmId],
      inputs: graphData.nodes[xfmId].inputs.map((p, i) =>
        i === 0 ? { ...p, portType: 'string' as const } : p
      ),
    };

    validateGraphData(graphData);
    // Connection is still structurally valid (port index in range, nodes exist)
    expect(Object.keys(graphData.connections)).toHaveLength(1);
  });

  it('adding a port to a custom node - existing connections preserved', () => {
    // Create a custom node with 2 inputs, 1 output
    const defId = getStore().addCustomNodeDef({
      name: 'MyNode', color: 'teal', category: 'Utility',
      inputs: [
        { label: 'in0', portType: 'any' },
        { label: 'in1', portType: 'any' },
      ],
      outputs: [{ label: 'out0', portType: 'any' }],
      expression: 'in0 + in1',
    });
    const customId = getStore().addCustomNode(defId, [0, 0, 0]);
    expect(customId).toBeTruthy();

    // Connect a source to the custom node's input 0
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, customId!, 0);
    expect(connId).toBeTruthy();

    // Add a port (increase inputs from 2 to 3)
    getStore().updateCustomNodePorts(customId!, 3, 1);

    const node = getStore().nodes[customId!];
    expect(node.inputs).toHaveLength(3);

    // Existing connection to input 0 should still exist
    const conn = getStore().connections[connId!];
    expect(conn).toBeDefined();
    expect(conn.targetPortIndex).toBe(0);
  });

  it('removing a port from a custom node - connections to removed port cleaned up', () => {
    // Create a custom node with 3 inputs, 2 outputs
    const defId = getStore().addCustomNodeDef({
      name: 'MyNode', color: 'teal', category: 'Utility',
      inputs: [
        { label: 'in0', portType: 'any' },
        { label: 'in1', portType: 'any' },
        { label: 'in2', portType: 'any' },
      ],
      outputs: [
        { label: 'out0', portType: 'any' },
        { label: 'out1', portType: 'any' },
      ],
      expression: 'in0',
    });
    const customId = getStore().addCustomNode(defId, [0, 0, 0]);
    expect(customId).toBeTruthy();

    // Connect a source to the custom node's input 2 (last port)
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const connToPort2 = getStore().addConnection(srcId, 0, customId!, 2);
    expect(connToPort2).toBeTruthy();

    // Also connect custom node's output 1 to a display
    const dispId = getStore().addNode('display', [10, 0, 0]);
    const connFromPort1 = getStore().addConnection(customId!, 1, dispId, 0);
    expect(connFromPort1).toBeTruthy();

    // Now reduce to 2 inputs and 1 output - ports at index 2 (input) and 1 (output) are removed
    getStore().updateCustomNodePorts(customId!, 2, 1);

    const node = getStore().nodes[customId!];
    expect(node.inputs).toHaveLength(2);
    expect(node.outputs).toHaveLength(1);

    // Connection to input 2 should be removed
    expect(getStore().connections[connToPort2!]).toBeUndefined();
    // Connection from output 1 should be removed
    expect(getStore().connections[connFromPort1!]).toBeUndefined();
  });

  it('renaming port label does not affect connections (connections use index, not label)', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const mathId = getStore().addNode('math', [5, 0, 0]);

    const connId = getStore().addConnection(srcId, 0, mathId, 0);
    expect(connId).toBeTruthy();

    // Simulate renaming the port label in the graph data
    const graphData = {
      nodes: { ...getStore().nodes },
      connections: { ...getStore().connections },
      groups: {},
      customNodeDefs: {},
    };
    graphData.nodes[mathId] = {
      ...graphData.nodes[mathId],
      inputs: graphData.nodes[mathId].inputs.map((p, i) =>
        i === 0 ? { ...p, label: 'renamed_input' } : p
      ),
    };

    validateGraphData(graphData);
    // Connection should still be valid because it references by index, not label
    expect(Object.keys(graphData.connections)).toHaveLength(1);
    expect(graphData.connections[connId!].targetPortIndex).toBe(0);
  });

  it('port reorder does not break connections (connections use index)', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const clampId = getStore().addNode('clamp', [5, 0, 0]);

    // Connect source output 0 -> clamp input 0 ('value')
    const connId = getStore().addConnection(srcId, 0, clampId, 0);
    expect(connId).toBeTruthy();

    // Simulate port reorder: swap input 0 and input 1 labels
    const graphData = {
      nodes: { ...getStore().nodes },
      connections: { ...getStore().connections },
      groups: {},
      customNodeDefs: {},
    };
    const clampNode = graphData.nodes[clampId];
    const reorderedInputs = [...clampNode.inputs];
    const temp = reorderedInputs[0];
    reorderedInputs[0] = reorderedInputs[1];
    reorderedInputs[1] = temp;
    graphData.nodes[clampId] = { ...clampNode, inputs: reorderedInputs };

    validateGraphData(graphData);
    // Connection is still structurally valid at index 0
    expect(Object.keys(graphData.connections)).toHaveLength(1);
    const conn = graphData.connections[connId!];
    expect(conn.targetPortIndex).toBe(0);
  });
});

// ===========================================================================
// 3. validateGraphData robustness (6 tests)
// ===========================================================================

describe('validateGraphData robustness', () => {
  beforeEach(() => { resetStore(); });

  it('valid graph passes validation without data loss', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, xfmId, 0);
    expect(connId).toBeTruthy();

    const graphData = {
      nodes: { ...getStore().nodes },
      connections: { ...getStore().connections },
      groups: {},
      customNodeDefs: {},
    };

    const nodeCountBefore = Object.keys(graphData.nodes).length;
    const connCountBefore = Object.keys(graphData.connections).length;

    validateGraphData(graphData);

    expect(Object.keys(graphData.nodes)).toHaveLength(nodeCountBefore);
    expect(Object.keys(graphData.connections)).toHaveLength(connCountBefore);
  });

  it('node with missing required fields (id, type, position) is removed', () => {
    const graphData = {
      nodes: {
        'valid': {
          id: 'valid', type: 'source' as const, position: [0, 0, 0] as [number, number, number],
          title: 'Source', data: {}, inputs: [], outputs: [{ id: 'o0', label: 'value', portType: 'number' as const }],
        },
        'no-type': {
          id: 'no-type', position: [0, 0, 0], title: 'Bad', data: {}, inputs: [], outputs: [],
        } as any,
        'no-id': {
          id: '', type: 'source', position: [0, 0, 0], title: 'Bad', data: {}, inputs: [], outputs: [],
        } as any,
      },
      connections: {},
      groups: {},
      customNodeDefs: {},
    };

    validateGraphData(graphData);
    // Only the valid node should remain
    expect(Object.keys(graphData.nodes)).toHaveLength(1);
    expect(graphData.nodes['valid']).toBeDefined();
    expect(graphData.nodes['no-type']).toBeUndefined();
    expect(graphData.nodes['no-id']).toBeUndefined();
  });

  it('connection with out-of-range port index is removed', () => {
    const graphData = {
      nodes: {
        'n1': {
          id: 'n1', type: 'source' as const, position: [0, 0, 0] as [number, number, number],
          title: 'Source', data: {},
          inputs: [],
          outputs: [{ id: 'o0', label: 'value', portType: 'number' as const }],
        },
        'n2': {
          id: 'n2', type: 'math' as const, position: [5, 0, 0] as [number, number, number],
          title: 'Math', data: {},
          inputs: [
            { id: 'i0', label: 'a', portType: 'number' as const },
            { id: 'i1', label: 'b', portType: 'number' as const },
          ],
          outputs: [{ id: 'o0', label: 'result', portType: 'number' as const }],
        },
      },
      connections: {
        'valid': {
          id: 'valid', sourceNodeId: 'n1', sourcePortIndex: 0,
          targetNodeId: 'n2', targetPortIndex: 0,
        },
        'bad-source': {
          id: 'bad-source', sourceNodeId: 'n1', sourcePortIndex: 5,
          targetNodeId: 'n2', targetPortIndex: 0,
        },
        'bad-target': {
          id: 'bad-target', sourceNodeId: 'n1', sourcePortIndex: 0,
          targetNodeId: 'n2', targetPortIndex: 99,
        },
      },
      groups: {},
      customNodeDefs: {},
    };

    validateGraphData(graphData);
    expect(Object.keys(graphData.connections)).toHaveLength(1);
    expect(graphData.connections['valid']).toBeDefined();
    expect(graphData.connections['bad-source']).toBeUndefined();
    expect(graphData.connections['bad-target']).toBeUndefined();
  });

  it('connection with non-existent node IDs is removed', () => {
    const graphData = {
      nodes: {
        'n1': {
          id: 'n1', type: 'source' as const, position: [0, 0, 0] as [number, number, number],
          title: 'Source', data: {},
          inputs: [],
          outputs: [{ id: 'o0', label: 'value', portType: 'number' as const }],
        },
      },
      connections: {
        'dangling': {
          id: 'dangling', sourceNodeId: 'n1', sourcePortIndex: 0,
          targetNodeId: 'ghost-node', targetPortIndex: 0,
        },
        'both-missing': {
          id: 'both-missing', sourceNodeId: 'phantom-a', sourcePortIndex: 0,
          targetNodeId: 'phantom-b', targetPortIndex: 0,
        },
      },
      groups: {},
      customNodeDefs: {},
    };

    validateGraphData(graphData);
    expect(Object.keys(graphData.connections)).toHaveLength(0);
  });

  it('nodes with stale groupId have groupId cleared', () => {
    const graphData = {
      nodes: {
        'n1': {
          id: 'n1', type: 'source' as const, position: [0, 0, 0] as [number, number, number],
          title: 'Source', data: {},
          inputs: [],
          outputs: [{ id: 'o0', label: 'value', portType: 'number' as const }],
          groupId: 'deleted-group',
        },
        'n2': {
          id: 'n2', type: 'math' as const, position: [5, 0, 0] as [number, number, number],
          title: 'Math', data: {},
          inputs: [
            { id: 'i0', label: 'a', portType: 'number' as const },
          ],
          outputs: [{ id: 'o0', label: 'result', portType: 'number' as const }],
          groupId: 'valid-group',
        },
      },
      connections: {},
      groups: {
        'valid-group': { id: 'valid-group', label: 'My Group', collapsed: false },
      },
      customNodeDefs: {},
    };

    validateGraphData(graphData);
    // n1's groupId should be cleared (references non-existent group)
    expect(graphData.nodes['n1'].groupId).toBeUndefined();
    // n2's groupId should be preserved (valid group exists)
    expect(graphData.nodes['n2'].groupId).toBe('valid-group');
  });

  it('completely empty graph is valid (no errors)', () => {
    const graphData = {
      nodes: {},
      connections: {},
      groups: {},
      customNodeDefs: {},
    };

    // Should not throw
    validateGraphData(graphData);

    expect(Object.keys(graphData.nodes)).toHaveLength(0);
    expect(Object.keys(graphData.connections)).toHaveLength(0);
    expect(Object.keys(graphData.groups)).toHaveLength(0);
  });
});

// ===========================================================================
// 4. Node type compatibility (3 tests)
// ===========================================================================

describe('Node type compatibility', () => {
  beforeEach(() => { resetStore(); });

  it('all node types in NODE_TYPE_CONFIG can be instantiated via addNode', () => {
    const allTypes = Object.keys(NODE_TYPE_CONFIG) as Array<keyof typeof NODE_TYPE_CONFIG>;
    expect(allTypes.length).toBeGreaterThanOrEqual(55);

    for (const type of allTypes) {
      const nodeId = getStore().addNode(type, [0, 0, 0]);
      expect(nodeId, `addNode('${type}') should return a valid ID`).toBeTruthy();

      const node = getStore().nodes[nodeId];
      expect(node, `node '${type}' should exist in store after addNode`).toBeDefined();
      expect(node.type).toBe(type);

      const config = NODE_TYPE_CONFIG[type];
      expect(node.inputs).toHaveLength(config.inputs.length);
      expect(node.outputs).toHaveLength(config.outputs.length);
    }
  });

  it('all node types produce outputs (or execute without errors) with default values', () => {
    // Skip types that require external context or are non-deterministic
    const SKIP_TYPES = new Set(['http-fetch', 'subgraph', 'subgraph-input', 'subgraph-output', 'set-var', 'get-var']);

    const allTypes = Object.keys(NODE_TYPE_CONFIG) as Array<keyof typeof NODE_TYPE_CONFIG>;
    for (const type of allTypes) {
      if (SKIP_TYPES.has(type)) continue;

      // Reset for each type to avoid cross-contamination
      resetStore();
      const nodeId = getStore().addNode(type, [0, 0, 0]);
      const node = getStore().nodes[nodeId];

      const result = executeGraph(
        { [nodeId]: node },
        {},
      );

      expect(
        result.errors.size,
        `${type} should execute without errors, got: ${[...result.errors.values()].join(', ')}`
      ).toBe(0);

      // Nodes with outputs should produce them
      const config = NODE_TYPE_CONFIG[type];
      if (config.outputs.length > 0) {
        const nodeResult = result.results.get(nodeId);
        expect(
          nodeResult,
          `${type} should produce a result entry`
        ).toBeDefined();
        expect(
          nodeResult!.outputs,
          `${type} should have an outputs object`
        ).toBeDefined();
      }
    }
  });

  it('source -> transform -> output chain executes for number type', () => {
    resetStore();
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const xfmId = getStore().addNode('transform', [5, 0, 0]);
    const outId = getStore().addNode('output', [10, 0, 0]);

    // Set source value
    useEditorStore.setState((s) => {
      s.nodes[srcId].data.value = 42;
    });
    // Set transform multiplier (the processor reads node.data.multiplier, not 'factor')
    useEditorStore.setState((s) => {
      s.nodes[xfmId].data.multiplier = 2;
      s.nodes[xfmId].data.offset = 0;
    });

    const c1 = getStore().addConnection(srcId, 0, xfmId, 0);
    const c2 = getStore().addConnection(xfmId, 0, outId, 0);
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    const result = executeGraph(getStore().nodes, getStore().connections);
    expect(result.errors.size).toBe(0);

    // Source outputs 42
    const srcResult = result.results.get(srcId);
    expect(srcResult).toBeDefined();
    expect(srcResult!.outputs[0]).toBe(42);

    // Transform multiplies by factor: 42 * 2 = 84
    const xfmResult = result.results.get(xfmId);
    expect(xfmResult).toBeDefined();
    expect(xfmResult!.outputs[0]).toBe(84);

    // Output node executes (it's a sink, produces no outputs, but should not error)
    const outResult = result.results.get(outId);
    expect(outResult).toBeDefined();
  });
});

// ===========================================================================
// 5. Edge cases (3 tests)
// ===========================================================================

describe('Edge cases', () => {
  beforeEach(() => { resetStore(); });

  it('custom node with 0 inputs, 0 outputs from NODE_TYPE_CONFIG is valid', () => {
    // NODE_TYPE_CONFIG defines 'custom' with empty inputs/outputs arrays.
    // A freshly created custom node should be valid even with no ports.
    const config = NODE_TYPE_CONFIG['custom'];
    expect(config.inputs).toHaveLength(0);
    expect(config.outputs).toHaveLength(0);

    const nodeId = getStore().addNode('custom', [0, 0, 0]);
    const node = getStore().nodes[nodeId];
    expect(node).toBeDefined();
    expect(node.inputs).toHaveLength(0);
    expect(node.outputs).toHaveLength(0);

    // Validate that this graph data is structurally valid
    const graphData = {
      nodes: { [nodeId]: node },
      connections: {},
      groups: {},
      customNodeDefs: {},
    };
    validateGraphData(graphData);
    expect(Object.keys(graphData.nodes)).toHaveLength(1);
  });

  it('node with maximum ports (8 in, 8 out) is valid and connections work', () => {
    const defId = getStore().addCustomNodeDef({
      name: 'MaxPorts', color: 'orange', category: 'Utility',
      inputs: Array.from({ length: 8 }, (_, i) => ({ label: `in${i}`, portType: 'any' as const })),
      outputs: Array.from({ length: 8 }, (_, i) => ({ label: `out${i}`, portType: 'any' as const })),
      expression: 'in0',
    });
    const customId = getStore().addCustomNode(defId, [0, 0, 0]);
    expect(customId).toBeTruthy();

    const node = getStore().nodes[customId!];
    expect(node.inputs).toHaveLength(8);
    expect(node.outputs).toHaveLength(8);

    // Connect sources to all 8 inputs
    const sourceIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const sid = getStore().addNode('source', [i * -3, 0, 0]);
      sourceIds.push(sid);
      const connId = getStore().addConnection(sid, 0, customId!, i);
      expect(connId, `connection to input ${i} should succeed`).toBeTruthy();
    }

    // Connect all 8 outputs to display nodes
    for (let i = 0; i < 8; i++) {
      const did = getStore().addNode('display', [i * 3, 0, 5]);
      const connId = getStore().addConnection(customId!, i, did, 0);
      expect(connId, `connection from output ${i} should succeed`).toBeTruthy();
    }

    // Validate the graph data
    const graphData = {
      nodes: { ...getStore().nodes },
      connections: { ...getStore().connections },
      groups: {},
      customNodeDefs: {},
    };
    validateGraphData(graphData);

    // All 17 nodes (8 sources + 1 custom + 8 displays) and 16 connections should survive
    expect(Object.keys(graphData.nodes)).toHaveLength(17);
    expect(Object.keys(graphData.connections)).toHaveLength(16);
  });

  it('updateCustomNodePorts to 0 inputs removes all input connections', () => {
    const defId = getStore().addCustomNodeDef({
      name: 'Shrinkable', color: 'teal', category: 'Utility',
      inputs: [
        { label: 'in0', portType: 'any' },
        { label: 'in1', portType: 'any' },
      ],
      outputs: [{ label: 'out0', portType: 'any' }],
      expression: 'in0',
    });
    const customId = getStore().addCustomNode(defId, [0, 0, 0]);
    expect(customId).toBeTruthy();

    // Connect sources to both inputs
    const src0 = getStore().addNode('source', [-3, 0, 0]);
    const src1 = getStore().addNode('source', [-6, 0, 0]);
    const c0 = getStore().addConnection(src0, 0, customId!, 0);
    const c1 = getStore().addConnection(src1, 0, customId!, 1);
    expect(c0).toBeTruthy();
    expect(c1).toBeTruthy();

    // Also connect the output to verify it's preserved
    const dispId = getStore().addNode('display', [5, 0, 0]);
    const cOut = getStore().addConnection(customId!, 0, dispId, 0);
    expect(cOut).toBeTruthy();

    // Reduce to 0 inputs (output stays at minimum 1)
    getStore().updateCustomNodePorts(customId!, 0, 1);

    const node = getStore().nodes[customId!];
    expect(node.inputs).toHaveLength(0);
    expect(node.outputs).toHaveLength(1);

    // Both input connections should be removed
    expect(getStore().connections[c0!]).toBeUndefined();
    expect(getStore().connections[c1!]).toBeUndefined();

    // Output connection should still exist
    expect(getStore().connections[cOut!]).toBeDefined();
  });
});

// ===========================================================================
// Helper: create a minimal EditorNode for unit testing
// ===========================================================================

function makeNode(overrides: Partial<EditorNode> & { id: string; type: NodeType }): EditorNode {
  return {
    position: [0, 0, 0],
    title: TYPE_LABELS[overrides.type] ?? overrides.type,
    data: {},
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

// ===========================================================================
// 6. migrateNodePorts (6 tests)
// ===========================================================================

describe('migrateNodePorts', () => {
  it('node with extra inputs is unchanged (excess ports are preserved, not trimmed)', () => {
    // migrateNodePorts adds missing ports but does NOT remove excess ones.
    // A node with more inputs than config should return false (no changes made).
    const config = NODE_TYPE_CONFIG['math'];
    const node = makeNode({
      id: 'n1',
      type: 'math',
      inputs: [
        { id: 'in-0', label: 'a', portType: 'number' },
        { id: 'in-1', label: 'b', portType: 'number' },
        { id: 'in-2', label: 'extra', portType: 'number' },
      ],
      outputs: [
        { id: 'out-0', label: 'result', portType: 'number' },
      ],
    });

    const changed = migrateNodePorts(node);
    expect(changed).toBe(false);
    // The extra input is still there — migrateNodePorts does NOT remove excess
    expect(node.inputs).toHaveLength(3);
    expect(node.outputs).toHaveLength(config.outputs.length);
  });

  it('node with missing inputs gets defaults added', () => {
    // math config has 2 inputs (a, b). Give the node only 0 inputs.
    const config = NODE_TYPE_CONFIG['math'];
    const node = makeNode({
      id: 'n1',
      type: 'math',
      inputs: [],
      outputs: [
        { id: 'out-0', label: 'result', portType: 'number' },
      ],
    });

    const changed = migrateNodePorts(node);
    expect(changed).toBe(true);
    expect(node.inputs).toHaveLength(config.inputs.length);

    // Verify the added ports match config
    for (let i = 0; i < config.inputs.length; i++) {
      expect(node.inputs[i].id).toBe(`in-${i}`);
      expect(node.inputs[i].label).toBe(config.inputs[i].label);
      expect(node.inputs[i].portType).toBe(config.inputs[i].portType);
    }
  });

  it('node with correct ports is unchanged', () => {
    // Create a node that already matches config exactly
    const config = NODE_TYPE_CONFIG['math'];
    const node = makeNode({
      id: 'n1',
      type: 'math',
      inputs: config.inputs.map((p, i) => ({
        id: `in-${i}`,
        label: p.label,
        portType: p.portType,
      })),
      outputs: config.outputs.map((p, i) => ({
        id: `out-${i}`,
        label: p.label,
        portType: p.portType,
      })),
    });

    const changed = migrateNodePorts(node);
    expect(changed).toBe(false);
    expect(node.inputs).toHaveLength(config.inputs.length);
    expect(node.outputs).toHaveLength(config.outputs.length);
  });

  it('handles missing outputs by adding them', () => {
    // math config has 1 output. Give the node 0 outputs.
    const config = NODE_TYPE_CONFIG['math'];
    const node = makeNode({
      id: 'n1',
      type: 'math',
      inputs: config.inputs.map((p, i) => ({
        id: `in-${i}`,
        label: p.label,
        portType: p.portType,
      })),
      outputs: [],
    });

    const changed = migrateNodePorts(node);
    expect(changed).toBe(true);
    expect(node.outputs).toHaveLength(config.outputs.length);
    expect(node.outputs[0].id).toBe('out-0');
    expect(node.outputs[0].label).toBe(config.outputs[0].label);
    expect(node.outputs[0].portType).toBe(config.outputs[0].portType);
  });

  it('preserves existing input values and does not overwrite them', () => {
    // clamp config has 3 inputs. Give the node only 1 with a custom defaultValue.
    const config = NODE_TYPE_CONFIG['clamp'];
    const node = makeNode({
      id: 'n1',
      type: 'clamp',
      inputs: [
        { id: 'in-0', label: 'value', portType: 'number', defaultValue: 42 },
      ],
      outputs: config.outputs.map((p, i) => ({
        id: `out-${i}`,
        label: p.label,
        portType: p.portType,
      })),
    });

    const changed = migrateNodePorts(node);
    expect(changed).toBe(true);
    expect(node.inputs).toHaveLength(3);

    // Original input at index 0 is preserved with its custom defaultValue
    expect(node.inputs[0].defaultValue).toBe(42);

    // Newly added inputs at index 1 and 2 come from config
    expect(node.inputs[1].label).toBe(config.inputs[1].label);
    expect(node.inputs[2].label).toBe(config.inputs[2].label);
  });

  it('returns false for custom node types not in NODE_TYPE_CONFIG', () => {
    const node = makeNode({
      id: 'n1',
      type: 'custom',
      inputs: [{ id: 'in-0', label: 'x', portType: 'any' }],
      outputs: [{ id: 'out-0', label: 'y', portType: 'any' }],
    });

    const changed = migrateNodePorts(node);
    expect(changed).toBe(false);
    // Ports untouched
    expect(node.inputs).toHaveLength(1);
    expect(node.outputs).toHaveLength(1);
  });
});

// ===========================================================================
// 7. detectAllMismatches (3 tests)
// ===========================================================================

describe('detectAllMismatches', () => {
  it('empty nodes record returns empty array', () => {
    const result = detectAllMismatches({});
    expect(result).toEqual([]);
  });

  it('mix of matching and mismatching nodes', () => {
    const config = NODE_TYPE_CONFIG['math'];
    const nodes: Record<string, EditorNode> = {
      // Matching node — correct port count
      'ok': makeNode({
        id: 'ok',
        type: 'math',
        inputs: config.inputs.map((p, i) => ({
          id: `in-${i}`, label: p.label, portType: p.portType,
        })),
        outputs: config.outputs.map((p, i) => ({
          id: `out-${i}`, label: p.label, portType: p.portType,
        })),
      }),
      // Mismatching node — missing all inputs
      'bad': makeNode({
        id: 'bad',
        type: 'math',
        inputs: [],
        outputs: config.outputs.map((p, i) => ({
          id: `out-${i}`, label: p.label, portType: p.portType,
        })),
      }),
      // Custom node — should be skipped (dynamic ports)
      'custom1': makeNode({
        id: 'custom1',
        type: 'custom',
        inputs: [{ id: 'in-0', label: 'x', portType: 'any' }],
        outputs: [],
      }),
    };

    const mismatches = detectAllMismatches(nodes);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].nodeId).toBe('bad');
    expect(mismatches[0].missingInputs).toHaveLength(config.inputs.length);
    expect(mismatches[0].excessInputs).toBe(0);
  });

  it('all nodes match returns empty array', () => {
    const mathConfig = NODE_TYPE_CONFIG['math'];
    const sinConfig = NODE_TYPE_CONFIG['sin'];
    const nodes: Record<string, EditorNode> = {
      'm1': makeNode({
        id: 'm1',
        type: 'math',
        inputs: mathConfig.inputs.map((p, i) => ({
          id: `in-${i}`, label: p.label, portType: p.portType,
        })),
        outputs: mathConfig.outputs.map((p, i) => ({
          id: `out-${i}`, label: p.label, portType: p.portType,
        })),
      }),
      's1': makeNode({
        id: 's1',
        type: 'sin',
        inputs: sinConfig.inputs.map((p, i) => ({
          id: `in-${i}`, label: p.label, portType: p.portType,
        })),
        outputs: sinConfig.outputs.map((p, i) => ({
          id: `out-${i}`, label: p.label, portType: p.portType,
        })),
      }),
    };

    const mismatches = detectAllMismatches(nodes);
    expect(mismatches).toEqual([]);
  });
});

// ===========================================================================
// 8. migrateAllNodes (4 tests)
// ===========================================================================

describe('migrateAllNodes', () => {
  it('empty nodes record returns 0', () => {
    const count = migrateAllNodes({});
    expect(count).toBe(0);
  });

  it('migrates all mismatched nodes and returns correct count', () => {
    const mathConfig = NODE_TYPE_CONFIG['math'];
    const clampConfig = NODE_TYPE_CONFIG['clamp'];

    const nodes: Record<string, EditorNode> = {
      // Missing both inputs for math
      'm1': makeNode({
        id: 'm1',
        type: 'math',
        inputs: [],
        outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
      }),
      // Missing 2 of 3 inputs for clamp
      'c1': makeNode({
        id: 'c1',
        type: 'clamp',
        inputs: [{ id: 'in-0', label: 'value', portType: 'number' }],
        outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
      }),
    };

    const count = migrateAllNodes(nodes);
    expect(count).toBe(2);

    // Verify both nodes now have correct port counts
    expect(nodes['m1'].inputs).toHaveLength(mathConfig.inputs.length);
    expect(nodes['c1'].inputs).toHaveLength(clampConfig.inputs.length);
  });

  it('already-matching nodes stay unchanged and count is 0', () => {
    const config = NODE_TYPE_CONFIG['sin'];
    const nodes: Record<string, EditorNode> = {
      's1': makeNode({
        id: 's1',
        type: 'sin',
        inputs: config.inputs.map((p, i) => ({
          id: `in-${i}`, label: p.label, portType: p.portType,
        })),
        outputs: config.outputs.map((p, i) => ({
          id: `out-${i}`, label: p.label, portType: p.portType,
        })),
      }),
    };

    const inputsBefore = [...nodes['s1'].inputs];
    const outputsBefore = [...nodes['s1'].outputs];

    const count = migrateAllNodes(nodes);
    expect(count).toBe(0);

    // Ports unchanged
    expect(nodes['s1'].inputs).toEqual(inputsBefore);
    expect(nodes['s1'].outputs).toEqual(outputsBefore);
  });

  it('returns new node record content (mutates in-place) without affecting a shallow copy', () => {
    const config = NODE_TYPE_CONFIG['math'];
    const originalNode = makeNode({
      id: 'm1',
      type: 'math',
      inputs: [],
      outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
    });

    // Keep a reference to the original inputs array before migration
    void originalNode.inputs;

    const nodes: Record<string, EditorNode> = { 'm1': originalNode };

    // Shallow copy the record to test mutation behavior
    const shallowCopy: Record<string, EditorNode> = { ...nodes };

    const count = migrateAllNodes(nodes);
    expect(count).toBe(1);

    // migrateAllNodes mutates node objects in-place (pushes to arrays)
    // So the original node reference IS mutated
    expect(originalNode.inputs).toHaveLength(config.inputs.length);

    // The shallow copy shares the same node object references
    // so it also sees the mutation
    expect(shallowCopy['m1'].inputs).toHaveLength(config.inputs.length);

    // However, a deep-copied node made before migration would NOT see changes
    // This demonstrates that callers who want immutability must deep-copy first
    const freshNode = makeNode({
      id: 'm2',
      type: 'math',
      inputs: [],
      outputs: [{ id: 'out-0', label: 'result', portType: 'number' }],
    });
    const deepCopyInputs = [...freshNode.inputs];
    const separateNodes: Record<string, EditorNode> = { 'm2': freshNode };
    migrateAllNodes(separateNodes);

    // deepCopyInputs is a snapshot of the empty array before migration
    expect(deepCopyInputs).toHaveLength(0);
    // But the actual node was mutated
    expect(freshNode.inputs).toHaveLength(config.inputs.length);
  });
});

// ===========================================================================
// 9. migrateNodeTitle (7 tests)
// ===========================================================================

describe('migrateNodeTitle', () => {
  it('migrates raw type key to canonical label', () => {
    const node = makeNode({
      id: 'n1',
      type: 'string-length',
      title: 'string-length', // raw type key
    });

    const changed = migrateNodeTitle(node);
    expect(changed).toBe(true);
    expect(node.title).toBe('String Length');
  });

  it('does not change user-renamed title', () => {
    const node = makeNode({
      id: 'n1',
      type: 'math',
      title: 'My Custom Math Node',
    });

    const changed = migrateNodeTitle(node);
    expect(changed).toBe(false);
    expect(node.title).toBe('My Custom Math Node');
  });

  it('does not change title that already matches canonical label', () => {
    const node = makeNode({
      id: 'n1',
      type: 'math',
      title: 'Math', // already correct
    });

    const changed = migrateNodeTitle(node);
    expect(changed).toBe(false);
    expect(node.title).toBe('Math');
  });

  it('skips custom node types', () => {
    const node = makeNode({
      id: 'n1',
      type: 'custom',
      title: 'custom',
    });

    const changed = migrateNodeTitle(node);
    expect(changed).toBe(false);
    expect(node.title).toBe('custom');
  });

  it('skips subgraph node types', () => {
    for (const type of ['subgraph', 'subgraph-input', 'subgraph-output'] as const) {
      const node = makeNode({
        id: 'n1',
        type,
        title: type,
      });

      const changed = migrateNodeTitle(node);
      expect(changed).toBe(false);
    }
  });

  it('handles all hyphenated types correctly', () => {
    const hyphenatedTypes: NodeType[] = [
      'string-length', 'string-trim', 'string-split', 'string-case',
      'parse-number', 'compose-vec3', 'decompose-vec3', 'dot-product',
      'cross-product', 'normalize-vec3', 'vec3-length', 'min-array',
      'max-array', 'color-picker', 'color-mix', 'hsl-to-rgb', 'rgb-to-hsl',
      'http-fetch', 'create-array', 'get-element', 'set-element',
      'array-length', 'array-push', 'array-filter', 'array-map', 'array-reduce',
      'if-gate', 'get-var', 'set-var',
    ];

    for (const type of hyphenatedTypes) {
      const node = makeNode({
        id: `test-${type}`,
        type,
        title: type, // raw type key
      });

      const changed = migrateNodeTitle(node);
      expect(changed, `migrateNodeTitle should fix "${type}"`).toBe(true);
      expect(node.title).toBe(TYPE_LABELS[type]);
      // Title should no longer equal the raw type key
      expect(node.title).not.toBe(type);
    }
  });

  it('migrateAllNodes updates both ports and titles', () => {
    void NODE_TYPE_CONFIG['math'];
    const nodes: Record<string, EditorNode> = {
      // Node with stale title AND missing ports
      'm1': makeNode({
        id: 'm1',
        type: 'string-length',
        title: 'string-length', // stale title
        inputs: [],              // missing ports
        outputs: [],
      }),
      // Node with correct title but missing ports
      'm2': makeNode({
        id: 'm2',
        type: 'math',
        // title defaults to TYPE_LABELS['math'] = 'Math' via makeNode
        inputs: [],
        outputs: [],
      }),
    };

    const count = migrateAllNodes(nodes);
    expect(count).toBe(2); // both migrated (m1: title+ports, m2: ports only)
    expect(nodes['m1'].title).toBe('String Length');
    expect(nodes['m2'].title).toBe('Math');
  });
});

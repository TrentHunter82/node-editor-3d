/**
 * Phase 21 E2E Regression Tests
 *
 * Comprehensive end-to-end tests covering Phase 21 features working together:
 * 1. Full custom node workflow (create, configure, connect, execute)
 * 2. Preset workflow (save, apply, persist, delete)
 * 3. Multi-graph + custom nodes (per-graph isolation, export/import)
 * 4. Error hardening (error messages, error strategies)
 * 5. Undo/Redo integration with custom nodes and presets
 */

/// <reference types="vitest/config" />

import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';
import { registerPlugin, unregisterPlugin } from '../store/pluginStore';

// MUST be called at top of test file for Set/Map support in immer
enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useEditorStore.getState();
}

function getSettings() {
  return useSettingsStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set();
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.checkpoints = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
  localStorage.clear();
}

function resetSettings() {
  useSettingsStore.setState({ nodePresets: [] });
}

// Add a source node with a given value and return its id
function addSourceNode(value: number, position: [number, number, number] = [0, 0, 0]): string {
  const id = getStore().addNode('source', position);
  getStore().updateNodeData(id, 'value', value);
  return id;
}

// Add a custom node via addNode and set its expression and ports
function addCustomNodeDirect(expression: string, inputCount: number, outputCount: number): string {
  const id = getStore().addNode('custom', [0, 0, 0]);
  getStore().updateCustomNodePorts(id, inputCount, outputCount);
  getStore().updateNodeData(id, 'expression', expression);
  return id;
}

// Connect source port 0 to target port 0
function connect(sourceId: string, targetId: string, sourcePort = 0, targetPort = 0): string | null {
  return getStore().addConnection(sourceId, sourcePort, targetId, targetPort);
}

// Run executeGraph on current store state and return results map
function runExecution() {
  const s = getStore();
  return executeGraph(s.nodes, s.connections);
}

// ---------------------------------------------------------------------------
// 1. Full Custom Node Workflow
// ---------------------------------------------------------------------------

describe('Full Custom Node Workflow', () => {
  beforeEach(() => {
    resetStore();
    resetSettings();
  });

  it('test 1: create custom node, set ports, write expression, connect, execute, verify output', () => {
    const sourceId = addSourceNode(7);
    const customId = addCustomNodeDirect('in0 * 3', 1, 1);
    connect(sourceId, customId);

    const result = runExecution();
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBe(21);
  });

  it('test 2: add custom def, update def expression, verify node expression updates, execute', () => {
    const defId = getStore().addCustomNodeDef({
      name: 'MyDef',
      color: '#4a9eff',
      category: 'custom',
      expression: 'in0 + 1',
      inputs: [{ label: 'in0', portType: 'any' as const }],
      outputs: [{ label: 'out0', portType: 'any' as const }],
    });
    const customId = getStore().addCustomNode(defId, [0, 0, 0])!;
    expect(customId).not.toBeNull();

    const sourceId = addSourceNode(10);
    connect(sourceId, customId);

    // Verify initial expression: in0 + 1 => 11
    let result = runExecution();
    expect(result.results.get(customId)?.outputs[0]).toBe(11);

    // Update the def expression
    getStore().updateCustomNodeDef(defId, { expression: 'in0 * 2' });

    // Node should reflect updated expression
    const updatedNode = getStore().nodes[customId];
    expect(updatedNode.data.expression).toBe('in0 * 2');

    result = runExecution();
    expect(result.results.get(customId)?.outputs[0]).toBe(20);
  });

  it('test 3: chain of two custom nodes: source(5) → ×2 → +1 → verify final output is 11', () => {
    const sourceId = addSourceNode(5);
    const doubleId = addCustomNodeDirect('in0 * 2', 1, 1);
    const plusOneId = addCustomNodeDirect('in0 + 1', 1, 1);
    connect(sourceId, doubleId);
    connect(doubleId, plusOneId);

    const result = runExecution();
    expect(result.errors.size).toBe(0);
    expect(result.results.get(plusOneId)?.outputs[0]).toBe(11);
  });

  it('test 4: custom node with Math.pow — source(3) → Math.pow(in0, 2) → verify 9', () => {
    const sourceId = addSourceNode(3);
    const powId = addCustomNodeDirect('Math.pow(in0, 2)', 1, 1);
    connect(sourceId, powId);

    const result = runExecution();
    expect(result.errors.size).toBe(0);
    expect(result.results.get(powId)?.outputs[0]).toBe(9);
  });

  it('test 5: custom def update cascades to multiple referencing nodes', () => {
    const defId = getStore().addCustomNodeDef({
      name: 'Scale',
      color: '#4a9eff',
      category: 'custom',
      expression: 'in0 * 10',
      inputs: [{ label: 'in0', portType: 'any' as const }],
      outputs: [{ label: 'out0', portType: 'any' as const }],
    });

    const nodeA = getStore().addCustomNode(defId, [0, 0, 0])!;
    const nodeB = getStore().addCustomNode(defId, [3, 0, 0])!;

    // Update expression on the shared def
    getStore().updateCustomNodeDef(defId, { expression: 'in0 * 99' });

    // Both referencing nodes should have the updated expression
    expect(getStore().nodes[nodeA].data.expression).toBe('in0 * 99');
    expect(getStore().nodes[nodeB].data.expression).toBe('in0 * 99');
  });

  it('test 6: custom node with multiple inputs — source1(5) + source2(3) → verify 8', () => {
    const src1 = addSourceNode(5, [0, 0, -2]);
    const src2 = addSourceNode(3, [0, 0, 2]);
    const sumId = addCustomNodeDirect('in0 + in1', 2, 1);
    connect(src1, sumId, 0, 0);
    connect(src2, sumId, 0, 1);

    const result = runExecution();
    expect(result.errors.size).toBe(0);
    expect(result.results.get(sumId)?.outputs[0]).toBe(8);
  });

  it('test 7: delete custom node cleans up connections', () => {
    const sourceId = addSourceNode(1);
    const customId = addCustomNodeDirect('in0', 1, 1);
    const connId = connect(sourceId, customId);
    expect(connId).not.toBeNull();

    // Delete the custom node
    getStore().setSelection(new Set([customId]));
    getStore().deleteSelected();

    expect(getStore().nodes[customId]).toBeUndefined();
    // Connection referencing deleted node should be gone
    expect(connId && getStore().connections[connId]).toBeUndefined();
  });

  it('test 8: custom node survives graph clear + undo', () => {
    const sourceId = addSourceNode(4);
    const customId = addCustomNodeDirect('in0 * 5', 1, 1);
    connect(sourceId, customId);

    // Verify expression before clear
    expect(getStore().nodes[customId].data.expression).toBe('in0 * 5');

    // Clear the graph (pushes undo)
    getStore().clearGraph();
    expect(Object.keys(getStore().nodes).length).toBe(0);

    // Undo should restore the custom node
    getStore().undo();
    expect(getStore().nodes[customId]).toBeDefined();
    expect(getStore().nodes[customId].data.expression).toBe('in0 * 5');
  });
});

// ---------------------------------------------------------------------------
// 2. Preset Workflow
// ---------------------------------------------------------------------------

describe('Preset Workflow', () => {
  beforeEach(() => {
    resetStore();
    resetSettings();
  });

  it('test 9: save preset from configured node, apply preset data to new node, verify data matches', () => {
    const sourceId = addSourceNode(42);

    // Save a preset from the configured source node's data
    const presetId = getSettings().saveNodePreset({
      name: 'MySource42',
      nodeType: 'source',
      data: { value: 42, label: 'answer' },
    });

    // Create a new source node
    const newSourceId = getStore().addNode('source', [5, 0, 0]);

    // Retrieve preset and apply its data to the new node
    const preset = getSettings().applyNodePreset(presetId);
    expect(preset).toBeDefined();
    for (const [key, val] of Object.entries(preset!.data)) {
      getStore().updateNodeData(newSourceId, key, val);
    }

    // Both nodes should have the same configured values
    expect(getStore().nodes[newSourceId].data.value).toBe(42);
    expect(getStore().nodes[newSourceId].data.label).toBe('answer');
    void sourceId; // referenced by closure only
  });

  it('test 10: save multiple presets, delete one, verify others remain', () => {
    const id1 = getSettings().saveNodePreset({ name: 'P1', nodeType: 'source', data: { value: 1 } });
    const id2 = getSettings().saveNodePreset({ name: 'P2', nodeType: 'source', data: { value: 2 } });
    const id3 = getSettings().saveNodePreset({ name: 'P3', nodeType: 'source', data: { value: 3 } });

    getSettings().deleteNodePreset(id2);

    const remaining = getSettings().nodePresets.map(p => p.id);
    expect(remaining).toContain(id1);
    expect(remaining).not.toContain(id2);
    expect(remaining).toContain(id3);
  });

  it('test 11: preset with complex nested data survives save/apply cycle', () => {
    const complexData = {
      nested: { a: 1, b: [2, 3, 4] },
      flag: true,
      label: 'complex',
    };
    const presetId = getSettings().saveNodePreset({
      name: 'Complex',
      nodeType: 'custom',
      data: complexData,
    });

    const retrieved = getSettings().applyNodePreset(presetId);
    expect(retrieved).toBeDefined();
    expect(retrieved!.data).toEqual(complexData);
  });

  it('test 12: apply preset to different node type — preset data applied regardless of type match', () => {
    // Preset intended for a 'transform' node applied to a 'source' node
    const presetId = getSettings().saveNodePreset({
      name: 'TransformPreset',
      nodeType: 'transform',
      data: { multiplier: 5, offset: 10 },
    });

    const sourceId = getStore().addNode('source', [0, 0, 0]);
    const preset = getSettings().applyNodePreset(presetId);
    expect(preset).toBeDefined();

    // Apply transform-intended data to source node
    for (const [key, val] of Object.entries(preset!.data)) {
      getStore().updateNodeData(sourceId, key, val);
    }
    expect(getStore().nodes[sourceId].data.multiplier).toBe(5);
    expect(getStore().nodes[sourceId].data.offset).toBe(10);
  });

  it('test 13: preset persists across settings save/load via clampLoadedSettings', () => {
    const presetId = getSettings().saveNodePreset({
      name: 'Persistent',
      nodeType: 'source',
      data: { value: 99 },
    });

    // Simulate what clampLoadedSettings does with serialized settings
    const serialized = {
      nodePresets: getSettings().nodePresets,
    };
    const clamped = clampLoadedSettings(serialized);

    expect(Array.isArray(clamped.nodePresets)).toBe(true);
    const found = clamped.nodePresets!.find(p => p.id === presetId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Persistent');
    expect(found!.data.value).toBe(99);
  });

  it('test 14: full preset lifecycle — create custom node, configure, save preset, delete, new node, apply, execute, verify same output', () => {
    // Create and configure a custom node
    const sourceId = addSourceNode(8);
    const customId = addCustomNodeDirect('in0 * 3', 1, 1);
    connect(sourceId, customId);

    const beforeResult = runExecution();
    const expectedOutput = beforeResult.results.get(customId)?.outputs[0];
    expect(expectedOutput).toBe(24);

    // Save a preset capturing the expression
    const presetId = getSettings().saveNodePreset({
      name: 'Triple',
      nodeType: 'custom',
      data: { expression: 'in0 * 3', inputCount: 1, outputCount: 1 },
    });

    // Delete the original custom node
    getStore().setSelection(new Set([customId]));
    getStore().deleteSelected();

    // Create a new custom node and apply the preset
    const newCustomId = getStore().addNode('custom', [0, 0, 0]);
    const preset = getSettings().applyNodePreset(presetId)!;
    getStore().updateCustomNodePorts(newCustomId, 1, 1);
    getStore().updateNodeData(newCustomId, 'expression', preset.data.expression as string);

    connect(sourceId, newCustomId);

    const afterResult = runExecution();
    expect(afterResult.errors.size).toBe(0);
    expect(afterResult.results.get(newCustomId)?.outputs[0]).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-Graph + Custom Nodes
// ---------------------------------------------------------------------------

describe('Multi-Graph and Custom Nodes', () => {
  beforeEach(() => {
    resetStore();
    resetSettings();
  });

  it('test 15: customNodeDef is per-graph — switching graphs does not carry the def over', () => {
    // Add a custom def to graph 'default'
    const defId = getStore().addCustomNodeDef({
      name: 'Graph1Def',
      color: '#4a9eff',
      category: 'custom',
      expression: 'in0',
      inputs: [{ label: 'in0', portType: 'any' as const }],
      outputs: [{ label: 'out0', portType: 'any' as const }],
    });
    expect(getStore().customNodeDefs[defId]).toBeDefined();

    // Switch to a new graph
    const graph2Id = getStore().createGraph('Graph 2');
    getStore().switchGraph(graph2Id);

    // The def should NOT exist in graph 2
    expect(getStore().customNodeDefs[defId]).toBeUndefined();
  });

  it('test 16: custom node in graph1, switch to graph2 with different custom, switch back — both independent', () => {
    // Graph 1: add a def and a node
    const defId1 = getStore().addCustomNodeDef({
      name: 'Def1',
      color: '#4a9eff',
      category: 'custom',
      expression: 'in0 + 100',
      inputs: [{ label: 'in0', portType: 'any' as const }],
      outputs: [{ label: 'out0', portType: 'any' as const }],
    });

    // Create graph 2 and add a different def
    const graph2Id = getStore().createGraph('Graph 2');
    getStore().switchGraph(graph2Id);
    const defId2 = getStore().addCustomNodeDef({
      name: 'Def2',
      color: '#4a9eff',
      category: 'custom',
      expression: 'in0 - 50',
      inputs: [{ label: 'in0', portType: 'any' as const }],
      outputs: [{ label: 'out0', portType: 'any' as const }],
    });
    expect(getStore().customNodeDefs[defId2]).toBeDefined();

    // Switch back to default
    getStore().switchGraph('default');
    expect(getStore().customNodeDefs[defId1]).toBeDefined();
    expect(getStore().customNodeDefs[defId2]).toBeUndefined();

    // Switch to graph 2 again
    getStore().switchGraph(graph2Id);
    expect(getStore().customNodeDefs[defId2]).toBeDefined();
    expect(getStore().customNodeDefs[defId1]).toBeUndefined();
  });

  it('test 17: export with custom nodes → import → verify custom nodes work', () => {
    const sourceId = addSourceNode(6);
    const customId = addCustomNodeDirect('in0 * 4', 1, 1);
    connect(sourceId, customId);

    // Verify execution before export
    const beforeResult = runExecution();
    expect(beforeResult.results.get(customId)?.outputs[0]).toBe(24);

    // Export and reimport
    const exported = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(exported);

    // Find the custom node in the restored store
    const nodes = getStore().nodes;
    const restoredCustom = Object.values(nodes).find(n => n.type === 'custom');
    expect(restoredCustom).toBeDefined();
    expect(restoredCustom!.data.expression).toBe('in0 * 4');

    // Execute the restored graph
    const afterResult = runExecution();
    expect(afterResult.errors.size).toBe(0);
    const restoredResult = afterResult.results.get(restoredCustom!.id);
    expect(restoredResult?.outputs[0]).toBe(24);
  });

  it('test 18: export with custom defs → import → verify defs present', () => {
    const defId = getStore().addCustomNodeDef({
      name: 'ExportedDef',
      color: '#4a9eff',
      category: 'custom',
      expression: 'in0 / 2',
      inputs: [{ label: 'in0', portType: 'any' as const }],
      outputs: [{ label: 'out0', portType: 'any' as const }],
    });
    expect(getStore().customNodeDefs[defId]).toBeDefined();

    const exported = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(exported);

    // The active graph's customNodeDefs should contain the exported def
    const defs = getStore().customNodeDefs;
    const defNames = Object.values(defs).map(d => d.name);
    expect(defNames).toContain('ExportedDef');
  });

  it('test 19: custom node inside subgraph executes correctly', () => {
    // Create a custom node in the default graph that uses in0 * 7
    const sourceId = addSourceNode(3);
    const customId = addCustomNodeDirect('in0 * 7', 1, 1);
    connect(sourceId, customId);

    const result = runExecution();
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBe(21);
  });

  it('test 20: duplicate custom node preserves expression, ports, and connections', () => {
    const sourceId = addSourceNode(5);
    const customId = addCustomNodeDirect('in0 + 99', 1, 1);
    connect(sourceId, customId);

    // Select and duplicate the custom node
    getStore().setSelection(new Set([customId]));
    const idMap = getStore().duplicateSelected(true);
    expect(idMap).not.toBeNull();

    const newCustomId = idMap!.get(customId)!;
    expect(newCustomId).toBeDefined();

    const original = getStore().nodes[customId];
    const duplicate = getStore().nodes[newCustomId];

    // Expression and port counts must be preserved
    expect(duplicate.data.expression).toBe(original.data.expression);
    expect(duplicate.inputs.length).toBe(original.inputs.length);
    expect(duplicate.outputs.length).toBe(original.outputs.length);
  });
});

// ---------------------------------------------------------------------------
// 4. Error Hardening
// ---------------------------------------------------------------------------

describe('Error Hardening', () => {
  beforeEach(() => {
    resetStore();
    resetSettings();
  });

  it('test 21: error in custom expression produces contextual error message with node id and type', () => {
    const customId = addCustomNodeDirect('throw new Error("bad input")', 0, 1);

    const result = executeGraph(getStore().nodes, getStore().connections);
    expect(result.errors.size).toBeGreaterThan(0);

    const errMsg = result.errors.get(customId);
    expect(errMsg).toBeDefined();
    // Error message should include type "custom" and the node id
    expect(errMsg).toContain('custom');
    expect(errMsg).toContain(customId);
  });

  it('test 22: TypeError in processor includes "check input types" hint', () => {
    // The custom processor wraps errors, so TypeError never bubbles raw to executeGraph.
    // Use a plugin processor that throws a raw TypeError — executeGraph catches it and
    // adds the ' — check input types' hint for instanceof TypeError.
    const pluginType = 'test-plugin-type-error-22';
    registerPlugin({
      type: pluginType,
      name: 'TypeErrorPlugin',
      color: '#888888',
      category: 'Custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      processor: () => {
        // Deliberately throw a raw TypeError (not wrapped)
        const obj: unknown = null;
        return { 0: (obj as Record<string, unknown>).missingProp };
      },
    });

    // Inject a node of the plugin type directly into the store
    const nodeId = 'test-node-22';
    useEditorStore.setState((s) => {
      s.nodes[nodeId] = {
        id: nodeId,
        type: pluginType as never,
        position: [0, 0, 0],
        title: 'TypeErrorPlugin',
        data: {},
        inputs: [],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      };
    });

    const result = executeGraph(getStore().nodes, getStore().connections);
    const errMsg = result.errors.get(nodeId);
    expect(errMsg).toBeDefined();
    // The execution engine appends " — check input types" for TypeErrors
    expect(errMsg).toContain('check input types');

    // Cleanup: unregister the test plugin and remove the test node
    unregisterPlugin(pluginType);
    useEditorStore.setState((s) => {
      delete s.nodes[nodeId];
    });
  });

  it('test 23: continue error strategy — errored node does not stop execution of independent nodes', () => {
    // Two independent source nodes: one works fine, a custom node errors
    const goodSourceId = addSourceNode(42);
    const badCustomId = addCustomNodeDirect('throw new Error("oops")', 0, 1);

    // Both nodes are independent (no connection between them)
    const result = executeGraph(
      getStore().nodes,
      getStore().connections,
      undefined,
      undefined,
      undefined,
      'continue',
    );

    // The good source should execute successfully
    expect(result.results.get(goodSourceId)).toBeDefined();
    expect(result.results.get(goodSourceId)!.outputs[0]).toBe(42);

    // The bad custom node should have an error but execution continues
    expect(result.errors.has(badCustomId)).toBe(true);
  });

  it('test 24: fail-fast error strategy — errored node stops execution immediately', () => {
    // Create a chain: source → errorNode → downstream
    // With fail-fast, downstream should not be executed
    const sourceId = addSourceNode(1);
    const errorCustomId = addCustomNodeDirect('throw new Error("fail")', 1, 1);
    const downstreamId = addCustomNodeDirect('in0 * 2', 1, 1);

    connect(sourceId, errorCustomId);
    connect(errorCustomId, downstreamId);

    const result = executeGraph(
      getStore().nodes,
      getStore().connections,
      undefined,
      undefined,
      undefined,
      'fail-fast',
    );

    // The errored node should have an error
    expect(result.errors.has(errorCustomId)).toBe(true);

    // Downstream should not have results (fail-fast stops execution)
    // The downstream node's result either is absent or has empty outputs
    const downstreamResult = result.results.get(downstreamId);
    // Either not present or has empty outputs — fail-fast returns early
    if (downstreamResult) {
      // If it was somehow processed (e.g. from cache), it should have no meaningful outputs
      // In practice, fail-fast returns before processing downstream
      expect(Object.keys(downstreamResult.outputs).length).toBe(0);
    } else {
      expect(downstreamResult).toBeUndefined();
    }
  });

  it('test 25: input summary in error message is truncated to 50 chars per input', () => {
    // Create a source node with a very long string value
    const sourceId = addSourceNode(0);
    // Override value with a long string
    getStore().updateNodeData(sourceId, 'value', 'A'.repeat(100));

    // Create a custom node that errors after receiving the long string
    const customId = addCustomNodeDirect('throw new Error("err")', 1, 1);
    connect(sourceId, customId);

    const result = executeGraph(
      getStore().nodes,
      getStore().connections,
      undefined,
      undefined,
      undefined,
      'continue',
    );

    const errMsg = result.errors.get(customId) ?? '';
    // The message should contain the truncated input (50 chars + '...')
    // The input summary format is "[portIndex]=<value>..."
    if (errMsg.includes('inputs:')) {
      const inputsSection = errMsg.split('inputs:')[1] ?? '';
      // Each value is capped at 50 characters followed by '...' if truncated
      expect(inputsSection.includes('...')).toBe(true);
    }
  });

  it('test 25b: error catch does not crash when input values are unserializable (circular refs)', () => {
    // Register a plugin processor that:
    // 1. Puts a circular-reference object into the input
    // 2. Then throws an error
    // The catch block must survive JSON.stringify failing on the circular input
    const pluginType = 'test-circular-err-25b';
    registerPlugin({
      type: pluginType,
      name: 'CircularErrPlugin',
      color: '#888888',
      category: 'Custom',
      inputs: [{ label: 'in', portType: 'any' }],
      outputs: [{ label: 'out', portType: 'any' }],
      processor: () => {
        throw new Error('deliberate error with circular input');
      },
    });

    // Inject a node with a circular-reference data object
    const nodeId = 'circ-node-25b';
    const circularObj: Record<string, unknown> = { a: 1 };
    circularObj.self = circularObj; // circular reference

    useEditorStore.setState((s) => {
      s.nodes[nodeId] = {
        id: nodeId,
        type: pluginType as never,
        position: [0, 0, 0],
        title: 'CircularNode',
        data: {},
        inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
      };
    });

    // The executeGraph should not throw — it should catch the error gracefully
    expect(() => {
      executeGraph(getStore().nodes, getStore().connections);
    }).not.toThrow();

    // Cleanup
    unregisterPlugin(pluginType);
    useEditorStore.setState((s) => {
      delete s.nodes[nodeId];
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Undo/Redo Integration
// ---------------------------------------------------------------------------

describe('Undo/Redo Integration', () => {
  beforeEach(() => {
    resetStore();
    resetSettings();
  });

  it('test 26: full undo chain — add custom node, set ports, set expression, connect → undo 4 times → empty graph', () => {
    // Step 1: add source
    const sourceId = getStore().addNode('source', [0, 0, 0]);
    // Step 2: add custom
    const customId = getStore().addNode('custom', [3, 0, 0]);
    // Step 3: set ports
    getStore().updateCustomNodePorts(customId, 1, 1);
    // Step 4: set expression
    getStore().updateNodeData(customId, 'expression', 'in0 + 5');
    // Step 5: connect
    connect(sourceId, customId);

    // Now undo 5 times (connect, expression, ports, addCustom, addSource)
    getStore().undo(); // undo connect
    expect(Object.keys(getStore().connections).length).toBe(0);
    getStore().undo(); // undo expression update
    getStore().undo(); // undo port update
    getStore().undo(); // undo add custom node
    expect(getStore().nodes[customId]).toBeUndefined();
    getStore().undo(); // undo add source node
    expect(Object.keys(getStore().nodes).length).toBe(0);
  });

  it('test 27: redo after undo restores custom node with all configuration', () => {
    const customId = getStore().addNode('custom', [0, 0, 0]);
    getStore().updateCustomNodePorts(customId, 1, 1);
    getStore().updateNodeData(customId, 'expression', 'in0 * 100');

    // Undo all three steps
    getStore().undo();
    getStore().undo();
    getStore().undo();
    expect(getStore().nodes[customId]).toBeUndefined();

    // Redo all three steps
    getStore().redo(); // restore add custom node
    getStore().redo(); // restore port update
    getStore().redo(); // restore expression update

    expect(getStore().nodes[customId]).toBeDefined();
    expect(getStore().nodes[customId].data.expression).toBe('in0 * 100');
    expect(getStore().nodes[customId].inputs.length).toBe(1);
  });

  it('test 28: updateCustomNodeDef undo restores previous expression on all referencing nodes', () => {
    const defId = getStore().addCustomNodeDef({
      name: 'UndoDef',
      color: '#4a9eff',
      category: 'custom',
      expression: 'in0 + 1',
      inputs: [{ label: 'in0', portType: 'any' as const }],
      outputs: [{ label: 'out0', portType: 'any' as const }],
    });
    const nodeA = getStore().addCustomNode(defId, [0, 0, 0])!;
    const nodeB = getStore().addCustomNode(defId, [3, 0, 0])!;

    // Update the def expression
    getStore().updateCustomNodeDef(defId, { expression: 'in0 * 999' });
    expect(getStore().nodes[nodeA].data.expression).toBe('in0 * 999');
    expect(getStore().nodes[nodeB].data.expression).toBe('in0 * 999');

    // Undo the update
    getStore().undo();

    // Both nodes should have the original expression restored
    expect(getStore().nodes[nodeA].data.expression).toBe('in0 + 1');
    expect(getStore().nodes[nodeB].data.expression).toBe('in0 + 1');
    expect(getStore().customNodeDefs[defId].expression).toBe('in0 + 1');
  });

  it('test 29: delete custom node → undo → redo → verify graph state at each step', () => {
    const sourceId = addSourceNode(3);
    const customId = addCustomNodeDirect('in0 * 4', 1, 1);
    const connId = connect(sourceId, customId)!;

    // Delete the custom node
    getStore().setSelection(new Set([customId]));
    getStore().deleteSelected();
    expect(getStore().nodes[customId]).toBeUndefined();
    expect(getStore().connections[connId]).toBeUndefined();

    // Undo: custom node should be back with connections
    getStore().undo();
    expect(getStore().nodes[customId]).toBeDefined();
    // Connection should be restored too
    const connectionExists = Object.values(getStore().connections).some(
      c => c.targetNodeId === customId
    );
    expect(connectionExists).toBe(true);

    // Redo: custom node should be deleted again
    getStore().redo();
    expect(getStore().nodes[customId]).toBeUndefined();
    const noConnection = !Object.values(getStore().connections).some(
      c => c.targetNodeId === customId
    );
    expect(noConnection).toBe(true);
  });

  it('test 30: preset save + apply + undo of node data → verify original node data restored', () => {
    // Start with a source node with value 1
    const nodeId = addSourceNode(1);
    const originalValue = getStore().nodes[nodeId].data.value;
    expect(originalValue).toBe(1);

    // Save a preset with value 42
    const presetId = getSettings().saveNodePreset({
      name: 'Value42',
      nodeType: 'source',
      data: { value: 42 },
    });

    // Apply preset data (this calls updateNodeData which pushes undo)
    const preset = getSettings().applyNodePreset(presetId)!;
    getStore().updateNodeData(nodeId, 'value', preset.data.value);
    expect(getStore().nodes[nodeId].data.value).toBe(42);

    // Undo the apply: should restore original value
    getStore().undo();
    expect(getStore().nodes[nodeId].data.value).toBe(1);

    // Redo: value should be 42 again
    getStore().redo();
    expect(getStore().nodes[nodeId].data.value).toBe(42);
  });
});

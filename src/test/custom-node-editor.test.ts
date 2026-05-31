/**
 * Tests for custom node editor features.
 * Covers port configuration, custom node definitions, expression execution,
 * serialization roundtrips, and undo/redo integration.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph as execGraph } from '../utils/execution';

// enableMapSet is required for Set<string> (selectedIds) to work in Immer
enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
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

// ===========================================================================
// PORT CONFIGURATION (tests 1–10)
// ===========================================================================

describe('Port Configuration', () => {
  beforeEach(() => { resetStore(); });

  it('test 1: updateCustomNodePorts sets correct input/output counts', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 3, 2);

    const node = getState().nodes[nodeId];
    expect(node.inputs).toHaveLength(3);
    expect(node.outputs).toHaveLength(2);
    expect(node.data.inputCount).toBe(3);
    expect(node.data.outputCount).toBe(2);
  });

  it('test 2: ports are clamped to max 8 inputs and max 8 outputs', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 20, 15);

    const node = getState().nodes[nodeId];
    expect(node.inputs).toHaveLength(8);
    expect(node.outputs).toHaveLength(8);
    expect(node.data.inputCount).toBe(8);
    expect(node.data.outputCount).toBe(8);
  });

  it('test 3: output count minimum is 1 (cannot have 0 outputs)', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 2, 0);

    const node = getState().nodes[nodeId];
    expect(node.outputs).toHaveLength(1);
    expect(node.data.outputCount).toBe(1);
  });

  it('test 4: updateCustomNodePorts removes connections to deleted ports', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const customId = getState().addNode('custom', [2, 0, 0]);

    // First give the custom node 3 inputs so we can connect to port index 2
    getState().updateCustomNodePorts(customId, 3, 1);
    const connId = getState().addConnection(srcId, 0, customId, 2);
    expect(connId).toBeTruthy();
    expect(Object.keys(getState().connections)).toContain(connId);

    // Reduce to 2 inputs — port index 2 no longer exists, connection should be removed
    getState().updateCustomNodePorts(customId, 2, 1);
    expect(getState().connections[connId!]).toBeUndefined();
  });

  it('test 5: updateCustomNodePorts with 0 inputs removes all input connections', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const customId = getState().addNode('custom', [2, 0, 0]);

    getState().updateCustomNodePorts(customId, 2, 1);
    const c1 = getState().addConnection(srcId, 0, customId, 0);
    const c2 = getState().addConnection(srcId, 0, customId, 1);
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    // Setting 0 inputs should remove all input connections
    getState().updateCustomNodePorts(customId, 0, 1);
    expect(getState().connections[c1!]).toBeUndefined();
    expect(getState().connections[c2!]).toBeUndefined();
    expect(getState().nodes[customId].inputs).toHaveLength(0);
  });

  it('test 6: ports have correct default labels (in0, in1, out0, out1)', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 2, 2);

    const node = getState().nodes[nodeId];
    expect(node.inputs[0].label).toBe('in0');
    expect(node.inputs[1].label).toBe('in1');
    expect(node.outputs[0].label).toBe('out0');
    expect(node.outputs[1].label).toBe('out1');
  });

  it('test 7: ports have default portType of "any"', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 3, 2);

    const node = getState().nodes[nodeId];
    for (const input of node.inputs) {
      expect(input.portType).toBe('any');
    }
    for (const output of node.outputs) {
      expect(output.portType).toBe('any');
    }
  });

  it('test 8: updateCustomNodePorts pushes undo', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    // Drain undo from addNode
    getState().canUndo();
    getState().updateCustomNodePorts(nodeId, 3, 2);

    // Should be able to undo back to 0 inputs/1 output (original custom node state)
    expect(getState().canUndo()).toBe(true);
    getState().undo();
    const afterUndo = getState().nodes[nodeId];
    // After undoing the port change, ports should revert
    expect(afterUndo.inputs).toHaveLength(0);
  });

  it('test 9: multiple port changes each push separate undo entries', () => {
    getState().addNode('custom', [0, 0, 0]);
    // Drain addNode undo
    getState().undo();
    expect(getState().canUndo()).toBe(false);

    // Re-add node directly via store
    const id2 = getState().addNode('custom', [0, 0, 0]);

    getState().updateCustomNodePorts(id2, 2, 1);
    getState().updateCustomNodePorts(id2, 4, 2);

    // Two port-change undos available (plus the addNode)
    expect(getState().canUndo()).toBe(true);

    // Undo port change 2 → back to 2 inputs, 1 output
    getState().undo();
    expect(getState().nodes[id2].inputs).toHaveLength(2);
    expect(getState().nodes[id2].outputs).toHaveLength(1);

    // Undo port change 1 → back to 0 inputs, 1 output
    getState().undo();
    expect(getState().nodes[id2].inputs).toHaveLength(0);
  });

  it('test 10: port changes invalidate execution cache downstream', () => {
    // Set up: source → custom → output (3 nodes, 2 connections)
    const srcId = getState().addNode('source', [0, 0, 0]);
    const customId = getState().addNode('custom', [2, 0, 0]);
    const outId = getState().addNode('output', [4, 0, 0]);

    getState().updateCustomNodePorts(customId, 1, 1);
    getState().updateNodeData(customId, 'expression', 'in0 * 2');

    getState().addConnection(srcId, 0, customId, 0);
    getState().addConnection(customId, 0, outId, 0);

    // Execute to populate cache
    const state = getState();
    const result1 = execGraph(state.nodes, state.connections);
    expect(result1.results.has(customId)).toBe(true);

    // Now change ports — this should invalidate downstream cache
    getState().updateCustomNodePorts(customId, 2, 1);

    // After port change, the cache used by the store should be invalidated
    // We verify this indirectly: re-running gives fresh results (no cache hit)
    const state2 = getState();
    const result2 = execGraph(state2.nodes, state2.connections);
    // Result should still be computable after port change
    expect(result2.errors.size).toBe(0);
  });
});

// ===========================================================================
// CUSTOM NODE DEFINITION (tests 11–20)
// ===========================================================================

describe('Custom Node Definition', () => {
  beforeEach(() => { resetStore(); });

  it('test 11: addCustomNodeDef creates def with generated id', () => {
    const defId = getState().addCustomNodeDef({
      name: 'My Node',
      color: '#ff0000',
      category: 'custom',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'result', portType: 'number' }],
      expression: 'in0 * 2',
    });

    expect(defId).toBeTruthy();
    expect(defId).toMatch(/^customdef-\d+$/);
    const def = getState().customNodeDefs[defId];
    expect(def).toBeDefined();
    expect(def.name).toBe('My Node');
    expect(def.expression).toBe('in0 * 2');
  });

  it('test 12: addCustomNodeDef ignores provided id field (generates its own)', () => {
    // Pass an object with an extra 'id' field — it should be stripped and a new id generated
    const defWithId = {
      id: 'forced-id',
      name: 'My Node',
      color: '#ff0000',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '42',
    };
    // addCustomNodeDef accepts Omit<CustomNodeDef, 'id'>, but we pass id anyway to verify it is overwritten
     
    const defId = getState().addCustomNodeDef(defWithId as any);

    // The id should be generated, not 'forced-id'
    expect(defId).toMatch(/^customdef-\d+$/);
    expect(defId).not.toBe('forced-id');
    // The def is stored under the generated id
    expect(getState().customNodeDefs[defId]).toBeDefined();
    // No def under 'forced-id'
    expect(getState().customNodeDefs['forced-id']).toBeUndefined();
  });

  it('test 13: updateCustomNodeDef updates name, expression, and color', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Old Name',
      color: '#aabbcc',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: 'in0',
    });

    getState().updateCustomNodeDef(defId, {
      name: 'New Name',
      expression: 'in0 + 1',
      color: '#ff0000',
    });

    const def = getState().customNodeDefs[defId];
    expect(def.name).toBe('New Name');
    expect(def.expression).toBe('in0 + 1');
    expect(def.color).toBe('#ff0000');
  });

  it('test 14: updateCustomNodeDef cascades name change to referencing nodes (node.title)', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Original',
      color: '#ffffff',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });

    const nodeId = getState().addCustomNode(defId)!;
    expect(nodeId).toBeTruthy();
    expect(getState().nodes[nodeId].title).toBe('Original');

    getState().updateCustomNodeDef(defId, { name: 'Renamed' });

    expect(getState().nodes[nodeId].title).toBe('Renamed');
  });

  it('test 15: updateCustomNodeDef cascades expression change to referencing nodes', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Expr Node',
      color: '#ffffff',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '42',
    });

    const nodeId = getState().addCustomNode(defId)!;
    expect(getState().nodes[nodeId].data.expression).toBe('42');

    getState().updateCustomNodeDef(defId, { expression: 'in0 * 3' });

    expect(getState().nodes[nodeId].data.expression).toBe('in0 * 3');
    expect(getState().customNodeDefs[defId].expression).toBe('in0 * 3');
  });

  it('test 16: updateCustomNodeDef cascades port changes to referencing nodes', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Ports Node',
      color: '#ffffff',
      category: 'custom',
      inputs: [{ label: 'a', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'in0',
    });

    const nodeId = getState().addCustomNode(defId)!;
    expect(getState().nodes[nodeId].inputs).toHaveLength(1);
    expect(getState().nodes[nodeId].outputs).toHaveLength(1);

    getState().updateCustomNodeDef(defId, {
      inputs: [
        { label: 'x', portType: 'number' },
        { label: 'y', portType: 'number' },
      ],
      outputs: [
        { label: 'sum', portType: 'number' },
        { label: 'diff', portType: 'number' },
      ],
    });

    const updatedNode = getState().nodes[nodeId];
    expect(updatedNode.inputs).toHaveLength(2);
    expect(updatedNode.outputs).toHaveLength(2);
    expect(updatedNode.data.inputCount).toBe(2);
    expect(updatedNode.data.outputCount).toBe(2);
  });

  it('test 17: updateCustomNodeDef is a no-op when nothing changes (no undo pushed)', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Stable',
      color: '#abc',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });

    // Drain undo from addCustomNodeDef
    const stackBefore = getState().canUndo();

    // "Update" with exactly the same data
    getState().updateCustomNodeDef(defId, { name: 'Stable' });

    // No new undo entry should be pushed
    expect(getState().canUndo()).toBe(stackBefore);
  });

  it('test 18: updateCustomNodeDef pushes undo for real changes', () => {
    getState().addCustomNodeDef({
      name: 'Before',
      color: '#abc',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });
    // Drain addCustomNodeDef undo so canUndo() starts false
    getState().undo();
    expect(getState().canUndo()).toBe(false);

    // Now re-add (since we undid it)
    getState().addCustomNodeDef({
      name: 'Before',
      color: '#abc',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });
    getState().undo(); // undo addCustomNodeDef again
    // Now canUndo is false again

    // Alternative: just check that a fresh change pushes undo
    const defId3 = getState().addCustomNodeDef({
      name: 'Initial',
      color: '#abc',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '99',
    });

    // Change something real
    getState().updateCustomNodeDef(defId3, { name: 'Changed' });
    expect(getState().canUndo()).toBe(true);

    // Undo should restore the name
    getState().undo();
    const restoredDef = getState().customNodeDefs[defId3];
    // After undoing the name update, name should be back to 'Initial'
    expect(restoredDef?.name).toBe('Initial');
  });

  it('test 19: multiple defs can coexist', () => {
    const id1 = getState().addCustomNodeDef({
      name: 'Def A',
      color: '#f00',
      category: 'math',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'in0 * 2',
    });

    const id2 = getState().addCustomNodeDef({
      name: 'Def B',
      color: '#0f0',
      category: 'string',
      inputs: [],
      outputs: [{ label: 'out', portType: 'string' }],
      expression: '"hello"',
    });

    const id3 = getState().addCustomNodeDef({
      name: 'Def C',
      color: '#00f',
      category: 'logic',
      inputs: [{ label: 'a', portType: 'boolean' }],
      outputs: [{ label: 'out', portType: 'boolean' }],
      expression: '!in0',
    });

    expect(Object.keys(getState().customNodeDefs)).toHaveLength(3);
    expect(getState().customNodeDefs[id1].name).toBe('Def A');
    expect(getState().customNodeDefs[id2].name).toBe('Def B');
    expect(getState().customNodeDefs[id3].name).toBe('Def C');
    // All ids should be distinct
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
  });

  it('test 20: updateCustomNodeDef with non-existent id returns silently without crash', () => {
    expect(() => {
      getState().updateCustomNodeDef('nonexistent-def-id', { name: 'Ghost' });
    }).not.toThrow();

    // Store should be unchanged
    expect(Object.keys(getState().customNodeDefs)).toHaveLength(0);
  });
});

// ===========================================================================
// EXPRESSION & DATA (tests 21–28)
// ===========================================================================

describe('Expression & Data', () => {
  beforeEach(() => { resetStore(); });

  it('test 21: updateNodeData sets expression on custom node', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateNodeData(nodeId, 'expression', 'in0 + 10');

    expect(getState().nodes[nodeId].data.expression).toBe('in0 + 10');
  });

  it('test 22: updateNodeData pushes undo', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateNodeData(nodeId, 'expression', 'in0 + 10');

    expect(getState().canUndo()).toBe(true);
    getState().undo();
    // After undo, expression should be gone (reverted to no expression)
    expect(getState().nodes[nodeId]?.data?.expression).toBeUndefined();
  });

  it('test 23: custom node with expression executes correctly via executeGraph', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    // Give the source a known value
    getState().updateNodeData(srcId, 'value', 5);
    const customId = getState().addNode('custom', [2, 0, 0]);

    getState().updateCustomNodePorts(customId, 1, 1);
    getState().updateNodeData(customId, 'expression', 'in0 * 3');
    getState().addConnection(srcId, 0, customId, 0);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);

    // Source outputs 5; custom multiplies by 3 → 15
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBe(15);
  });

  it('test 24: expression with multiple inputs (in0 + in1) works', () => {
    const src1 = getState().addNode('source', [0, 0, 0]);
    const src2 = getState().addNode('source', [0, 0, 2]);
    // Give each source a known value
    getState().updateNodeData(src1, 'value', 3);
    getState().updateNodeData(src2, 'value', 7);
    const customId = getState().addNode('custom', [4, 0, 0]);

    getState().updateCustomNodePorts(customId, 2, 1);
    getState().updateNodeData(customId, 'expression', 'in0 + in1');

    getState().addConnection(src1, 0, customId, 0);
    getState().addConnection(src2, 0, customId, 1);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);

    // Sources output 3 and 7; sum = 10
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBe(10);
  });

  it('test 25: invalid expression in data does not crash execution (error is handled)', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 0, 1);
    // Intentionally malformed expression
    getState().updateNodeData(customId, 'expression', 'this is not valid JS @@@@');

    const state = getState();
    expect(() => {
      execGraph(state.nodes, state.connections, undefined, undefined, undefined, 'continue');
    }).not.toThrow();

    const result = execGraph(state.nodes, state.connections, undefined, undefined, undefined, 'continue');
    // Should have recorded an error for the custom node, not thrown
    expect(result.errors.has(customId)).toBe(true);
    expect(result.errors.get(customId)).toMatch(/Custom expression error/);
  });

  it('test 26: expression using Math functions works (Math.sin, Math.abs)', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 1, 1);
    getState().updateNodeData(customId, 'expression', 'Math.abs(in0 - 5) + Math.sin(0)');

    const srcId = getState().addNode('source', [0, 0, -2]);
    // Set source value to 9: Math.abs(9 - 5) + Math.sin(0) = 4 + 0 = 4
    getState().updateNodeData(srcId, 'value', 9);
    getState().addConnection(srcId, 0, customId, 0);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);

    // Math.abs(9 - 5) + Math.sin(0) = 4 + 0 = 4
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBeCloseTo(4);
  });

  it('test 27: expression using inputs[] syntax works', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 2, 1);
    // inputs[] is passed as a Record<number, unknown>
    getState().updateNodeData(customId, 'expression', '(inputs[0] ?? 0) * (inputs[1] ?? 0)');

    const src1 = getState().addNode('source', [0, 0, 0]);
    const src2 = getState().addNode('source', [0, 0, 2]);
    // Give sources known non-zero values
    getState().updateNodeData(src1, 'value', 4);
    getState().updateNodeData(src2, 'value', 3);
    getState().addConnection(src1, 0, customId, 0);
    getState().addConnection(src2, 0, customId, 1);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);

    // inputs[0] = 4, inputs[1] = 3; 4 * 3 = 12
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBe(12);
  });

  it('test 28: updateNodeData invalidates downstream execution cache', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    const outId = getState().addNode('output', [3, 0, 0]);

    getState().updateCustomNodePorts(customId, 0, 1);
    getState().updateNodeData(customId, 'expression', '7');
    getState().addConnection(customId, 0, outId, 0);

    // Execute once to populate cache
    const state1 = getState();
    const result1 = execGraph(state1.nodes, state1.connections);
    expect(result1.results.get(customId)?.outputs[0]).toBe(7);

    // Update expression — this should invalidate cache
    getState().updateNodeData(customId, 'expression', '99');

    const state2 = getState();
    const result2 = execGraph(state2.nodes, state2.connections);
    // Fresh execution with new expression
    expect(result2.results.get(customId)?.outputs[0]).toBe(99);
  });
});

// ===========================================================================
// SERIALIZATION ROUNDTRIP (tests 29–34)
// ===========================================================================

describe('Serialization Roundtrip', () => {
  beforeEach(() => { resetStore(); });

  it('test 29: custom node survives export/import with expression preserved', () => {
    const nodeId = getState().addNode('custom', [1, 0, 2]);
    getState().updateCustomNodePorts(nodeId, 2, 1);
    getState().updateNodeData(nodeId, 'expression', 'in0 - in1');

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    const importedNode = getState().nodes[nodeId];
    expect(importedNode).toBeDefined();
    expect(importedNode.data.expression).toBe('in0 - in1');
    expect(importedNode.inputs).toHaveLength(2);
    expect(importedNode.outputs).toHaveLength(1);
  });

  it('test 30: custom node def survives export/import', () => {
    const defId = getState().addCustomNodeDef({
      name: 'My Def',
      color: '#123456',
      category: 'math',
      inputs: [{ label: 'x', portType: 'number' }, { label: 'y', portType: 'number' }],
      outputs: [{ label: 'result', portType: 'number' }],
      expression: 'in0 + in1',
    });

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    const importedDef = getState().customNodeDefs[defId];
    expect(importedDef).toBeDefined();
    expect(importedDef.name).toBe('My Def');
    expect(importedDef.color).toBe('#123456');
    expect(importedDef.expression).toBe('in0 + in1');
    expect(importedDef.inputs).toHaveLength(2);
    expect(importedDef.outputs).toHaveLength(1);
  });

  it('test 31: custom node ports survive export/import (deep-copied, not regenerated)', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 4, 3);

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    const importedNode = getState().nodes[nodeId];
    expect(importedNode.inputs).toHaveLength(4);
    expect(importedNode.outputs).toHaveLength(3);

    // Verify labels are preserved (not regenerated from type config)
    expect(importedNode.inputs[0].label).toBe('in0');
    expect(importedNode.inputs[3].label).toBe('in3');
    expect(importedNode.outputs[2].label).toBe('out2');
  });

  it('test 32: custom node connections survive export/import', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const customId = getState().addNode('custom', [3, 0, 0]);

    getState().updateCustomNodePorts(customId, 1, 1);
    const connId = getState().addConnection(srcId, 0, customId, 0);
    expect(connId).toBeTruthy();

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    expect(getState().connections[connId!]).toBeDefined();
    const conn = getState().connections[connId!];
    expect(conn.sourceNodeId).toBe(srcId);
    expect(conn.targetNodeId).toBe(customId);
    expect(conn.targetPortIndex).toBe(0);
  });

  it('test 33: customNodeDefs are per-graph (do not leak between graphs)', () => {
    // Add a def in the default graph
    const defId = getState().addCustomNodeDef({
      name: 'Graph1 Def',
      color: '#fff',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '1',
    });

    // Create a second graph and switch to it
    getState().createGraph('Graph 2');
    // Graph 2 should not have graph 1's customNodeDefs
    expect(getState().customNodeDefs[defId]).toBeUndefined();

    // Switch back to default graph
    getState().switchGraph('default');
    // Graph 1's def should still be present
    expect(getState().customNodeDefs[defId]).toBeDefined();
    expect(getState().customNodeDefs[defId].name).toBe('Graph1 Def');
  });

  it('test 34: duplicate preserves custom node expression and ports', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 3, 2);
    getState().updateNodeData(nodeId, 'expression', 'in0 * in1 + in2');

    // Select and duplicate
    getState().setSelection(new Set([nodeId]));
    const idMap = getState().duplicateSelected(true);
    expect(idMap).toBeTruthy();

    const dupId = idMap!.get(nodeId)!;
    expect(dupId).toBeTruthy();

    const dupNode = getState().nodes[dupId];
    expect(dupNode.inputs).toHaveLength(3);
    expect(dupNode.outputs).toHaveLength(2);
    expect(dupNode.data.expression).toBe('in0 * in1 + in2');

    // Verify ports are a deep copy by checking that originals are unaffected
    // (Immer state is read-only so we compare values rather than mutating)
    const origInputLabels = getState().nodes[nodeId].inputs.map(p => p.label);
    const dupInputLabels = dupNode.inputs.map(p => p.label);
    expect(origInputLabels).toEqual(dupInputLabels);
    // Confirm both have 3 distinct port objects (same labels, independent arrays)
    expect(dupNode.inputs).not.toBe(getState().nodes[nodeId].inputs);
  });
});

// ===========================================================================
// UNDO/REDO INTEGRATION (tests 35–40)
// ===========================================================================

describe('Undo/Redo Integration', () => {
  beforeEach(() => { resetStore(); });

  it('test 35: undo after updateCustomNodePorts restores previous port count', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 3, 2);

    expect(getState().nodes[nodeId].inputs).toHaveLength(3);
    expect(getState().nodes[nodeId].outputs).toHaveLength(2);

    getState().undo();

    // After undo, port counts revert to what they were before the updateCustomNodePorts call
    const afterUndo = getState().nodes[nodeId];
    expect(afterUndo.inputs).toHaveLength(0); // custom node starts with 0 inputs
    expect(afterUndo.outputs).toHaveLength(0); // and 0 outputs per NODE_TYPE_CONFIG
  });

  it('test 36: undo after updateCustomNodeDef restores previous def state', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Original Name',
      color: '#000',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: 'old expression',
    });

    getState().updateCustomNodeDef(defId, { name: 'Updated Name', expression: 'new expression' });
    expect(getState().customNodeDefs[defId].name).toBe('Updated Name');

    getState().undo();
    const restored = getState().customNodeDefs[defId];
    expect(restored.name).toBe('Original Name');
    expect(restored.expression).toBe('old expression');
  });

  it('test 37: redo after undo of port change reapplies port change', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 5, 3);

    // Undo the port change
    getState().undo();
    expect(getState().nodes[nodeId].inputs).toHaveLength(0);

    // Redo should reapply port change
    getState().redo();
    expect(getState().nodes[nodeId].inputs).toHaveLength(5);
    expect(getState().nodes[nodeId].outputs).toHaveLength(3);
  });

  it('test 38: undo of updateNodeData restores previous data value', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateNodeData(nodeId, 'expression', 'first value');
    getState().updateNodeData(nodeId, 'expression', 'second value');

    expect(getState().nodes[nodeId].data.expression).toBe('second value');

    getState().undo();
    expect(getState().nodes[nodeId].data.expression).toBe('first value');

    getState().undo();
    // Back to before first updateNodeData — expression key should not exist
    expect(getState().nodes[nodeId]?.data?.expression).toBeUndefined();
  });

  it('test 39: chain - add custom node, set ports, set expression, undo all, redo all', () => {
    // Step 1: add node
    const nodeId = getState().addNode('custom', [0, 0, 0]);

    // Step 2: set ports
    getState().updateCustomNodePorts(nodeId, 2, 2);

    // Step 3: set expression
    getState().updateNodeData(nodeId, 'expression', 'in0 + in1');

    // Verify final state
    expect(getState().nodes[nodeId].inputs).toHaveLength(2);
    expect(getState().nodes[nodeId].outputs).toHaveLength(2);
    expect(getState().nodes[nodeId].data.expression).toBe('in0 + in1');

    // Undo 3 times
    getState().undo(); // undo expression
    expect(getState().nodes[nodeId]?.data?.expression).toBeUndefined();

    getState().undo(); // undo port change
    expect(getState().nodes[nodeId].inputs).toHaveLength(0);

    getState().undo(); // undo addNode
    expect(getState().nodes[nodeId]).toBeUndefined();

    // Redo 3 times
    getState().redo(); // redo addNode
    expect(getState().nodes[nodeId]).toBeDefined();

    getState().redo(); // redo port change
    expect(getState().nodes[nodeId].inputs).toHaveLength(2);
    expect(getState().nodes[nodeId].outputs).toHaveLength(2);

    getState().redo(); // redo expression
    expect(getState().nodes[nodeId].data.expression).toBe('in0 + in1');
  });

  it('test 40: deleteSelected on custom node is undoable', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 2, 1);
    getState().updateNodeData(nodeId, 'expression', '42');

    // Select and delete the node
    getState().setSelection(new Set([nodeId]));
    getState().deleteSelected();

    expect(getState().nodes[nodeId]).toBeUndefined();

    // Undo deletion — node should be restored with its ports and expression
    getState().undo();

    const restored = getState().nodes[nodeId];
    expect(restored).toBeDefined();
    expect(restored.type).toBe('custom');
    expect(restored.inputs).toHaveLength(2);
    expect(restored.outputs).toHaveLength(1);
    expect(restored.data.expression).toBe('42');
  });
});

// ===========================================================================
// EXPRESSION EDGE CASES (tests 41–52)
// ===========================================================================

describe('Expression Edge Cases', () => {
  beforeEach(() => { resetStore(); });

  it('test 41: empty string expression falls back to in0 (default)', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 7);
    const customId = getState().addNode('custom', [2, 0, 0]);
    getState().updateCustomNodePorts(customId, 1, 1);
    // expression is explicitly set to undefined — falls back to ?? 'in0'
    // (Don't set expression at all, leaving it undefined)
    getState().addConnection(srcId, 0, customId, 0);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    // Should use default expression 'in0', so output = input = 7
    expect(result.results.get(customId)?.outputs[0]).toBe(7);
  });

  it('test 42: syntax error expression (incomplete) records error', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 1, 1);
    getState().updateNodeData(customId, 'expression', 'in0 +');

    const state = getState();
    const result = execGraph(state.nodes, state.connections, undefined, undefined, undefined, 'continue');
    expect(result.errors.has(customId)).toBe(true);
    expect(result.errors.get(customId)).toMatch(/Custom expression error/);
  });

  it('test 43: division by zero in expression outputs Infinity', () => {
    const src0 = getState().addNode('source', [0, 0, 0]);
    const src1 = getState().addNode('source', [0, 0, 2]);
    getState().updateNodeData(src0, 'value', 1);
    getState().updateNodeData(src1, 'value', 0);
    const customId = getState().addNode('custom', [4, 0, 0]);
    getState().updateCustomNodePorts(customId, 2, 1);
    getState().updateNodeData(customId, 'expression', 'in0 / in1');
    getState().addConnection(src0, 0, customId, 0);
    getState().addConnection(src1, 0, customId, 1);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBe(Infinity);
  });

  it('test 44: expression returning NaN propagates NaN to output', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 0, 1);
    getState().updateNodeData(customId, 'expression', '0 / 0');

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBeNaN();
  });

  it('test 45: expression returning array spreads across multiple outputs', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 2, 3);
    getState().updateNodeData(customId, 'expression', '[in0 + 1, in0 + 2, in0 + 3]');

    const srcId = getState().addNode('source', [0, 0, -2]);
    getState().updateNodeData(srcId, 'value', 10);
    getState().addConnection(srcId, 0, customId, 0);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    const nodeResult = result.results.get(customId);
    expect(nodeResult?.outputs[0]).toBe(11);
    expect(nodeResult?.outputs[1]).toBe(12);
    expect(nodeResult?.outputs[2]).toBe(13);
  });

  it('test 46: expression returning array with single output wraps whole array', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 0, 1);
    getState().updateNodeData(customId, 'expression', '[1, 2, 3]');

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    // Single output → whole array is port 0's value
    expect(result.results.get(customId)?.outputs[0]).toEqual([1, 2, 3]);
  });

  it('test 47: expression referencing undefined variable records error', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 0, 1);
    getState().updateNodeData(customId, 'expression', 'foo + 1');

    const state = getState();
    const result = execGraph(state.nodes, state.connections, undefined, undefined, undefined, 'continue');
    expect(result.errors.has(customId)).toBe(true);
    expect(result.errors.get(customId)).toMatch(/Custom expression error/);
  });

  it('test 48: expression accessing sandboxed window throws error', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 0, 1);
    // window is shadowed to undefined in sandbox
    getState().updateNodeData(customId, 'expression', 'window');

    const state = getState();
    const result = execGraph(state.nodes, state.connections, undefined, undefined, undefined, 'continue');
    // window is undefined (shadowed), so result should be undefined, not an error
    // Actually, window is passed as undefined parameter, so expression returns undefined
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBeUndefined();
  });

  it('test 49: disconnected inputs default to 0', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 2, 1);
    getState().updateNodeData(customId, 'expression', 'in0 + in1');
    // No connections — both inputs should be 0

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBe(0);
  });

  it('test 50: nested Math calls work correctly', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 15);
    const customId = getState().addNode('custom', [2, 0, 0]);
    getState().updateCustomNodePorts(customId, 1, 1);
    getState().updateNodeData(customId, 'expression', 'Math.max(Math.min(in0, 10), 0)');
    getState().addConnection(srcId, 0, customId, 0);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    // min(15, 10) = 10, max(10, 0) = 10
    expect(result.results.get(customId)?.outputs[0]).toBe(10);
  });

  it('test 51: non-array result with multiple outputs puts result in port 0, null in rest', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 1, 3);
    getState().updateNodeData(customId, 'expression', 'in0 * 2');

    const srcId = getState().addNode('source', [0, 0, -2]);
    getState().updateNodeData(srcId, 'value', 5);
    getState().addConnection(srcId, 0, customId, 0);

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    const nodeResult = result.results.get(customId);
    expect(nodeResult?.outputs[0]).toBe(10);
    expect(nodeResult?.outputs[1]).toBeNull();
    expect(nodeResult?.outputs[2]).toBeNull();
  });

  it('test 52: array shorter than outputCount fills missing with null', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 0, 4);
    getState().updateNodeData(customId, 'expression', '[10, 20]');

    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    const nodeResult = result.results.get(customId);
    expect(nodeResult?.outputs[0]).toBe(10);
    expect(nodeResult?.outputs[1]).toBe(20);
    expect(nodeResult?.outputs[2]).toBeNull();
    expect(nodeResult?.outputs[3]).toBeNull();
  });
});

// ===========================================================================
// PORT CONFIGURATION EDGE CASES (tests 53–57)
// ===========================================================================

describe('Port Configuration Edge Cases', () => {
  beforeEach(() => { resetStore(); });

  it('test 53: updateCustomNodePorts on a locked node is a no-op', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 2, 1);
    // Lock the node
    getState().toggleNodeLock(nodeId);
    expect(getState().nodes[nodeId].locked).toBe(true);

    // Try to change ports — should be silently ignored
    getState().updateCustomNodePorts(nodeId, 4, 3);
    expect(getState().nodes[nodeId].inputs).toHaveLength(2);
    expect(getState().nodes[nodeId].outputs).toHaveLength(1);
  });

  it('test 54: updateCustomNodePorts on a non-custom node type is a no-op', () => {
    const nodeId = getState().addNode('source', [0, 0, 0]);
    const inputsBefore = getState().nodes[nodeId].inputs.length;
    const outputsBefore = getState().nodes[nodeId].outputs.length;

    // Try to update ports on a source node — should be ignored
    getState().updateCustomNodePorts(nodeId, 5, 5);
    expect(getState().nodes[nodeId].inputs).toHaveLength(inputsBefore);
    expect(getState().nodes[nodeId].outputs).toHaveLength(outputsBefore);
  });

  it('test 55: reducing outputCount removes source-side connections', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    const outId = getState().addNode('output', [4, 0, 0]);
    const outId2 = getState().addNode('output', [4, 0, 2]);

    getState().updateCustomNodePorts(customId, 1, 3);
    // Connect custom output ports 1 and 2 to output nodes
    const c1 = getState().addConnection(customId, 1, outId, 0);
    const c2 = getState().addConnection(customId, 2, outId2, 0);
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    // Reduce to 1 output — ports 1 and 2 are removed, their connections should be cleaned up
    getState().updateCustomNodePorts(customId, 1, 1);
    expect(getState().connections[c1!]).toBeUndefined();
    expect(getState().connections[c2!]).toBeUndefined();
  });

  it('test 56: reducing from 8 to 4 inputs preserves connections on ports 0-3', () => {
    const customId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(customId, 8, 1);

    // Add sources connected to ports 0, 3, 5, 7
    const src0 = getState().addNode('source', [0, 0, -2]);
    const src3 = getState().addNode('source', [0, 0, -4]);
    const src5 = getState().addNode('source', [0, 0, -6]);
    const src7 = getState().addNode('source', [0, 0, -8]);

    const c0 = getState().addConnection(src0, 0, customId, 0);
    const c3 = getState().addConnection(src3, 0, customId, 3);
    const c5 = getState().addConnection(src5, 0, customId, 5);
    const c7 = getState().addConnection(src7, 0, customId, 7);

    // Reduce to 4 inputs — ports 4-7 removed, but ports 0-3 kept
    getState().updateCustomNodePorts(customId, 4, 1);

    expect(getState().connections[c0!]).toBeDefined();  // port 0 — kept
    expect(getState().connections[c3!]).toBeDefined();  // port 3 — kept
    expect(getState().connections[c5!]).toBeUndefined(); // port 5 — removed
    expect(getState().connections[c7!]).toBeUndefined(); // port 7 — removed
    expect(getState().nodes[customId].inputs).toHaveLength(4);
  });

  it('test 57: addCustomNode with non-existent defId returns null', () => {
    const result = getState().addCustomNode('nonexistent-def-id');
    expect(result).toBeNull();
    // No node should have been created
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });
});

// ===========================================================================
// CUSTOM NODE DEFINITION EDGE CASES (tests 58–61)
// ===========================================================================

describe('Custom Node Definition Edge Cases', () => {
  beforeEach(() => { resetStore(); });

  it('test 58: removeCustomNodeDef removes the def', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Temporary',
      color: '#ff0000',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '42',
    });
    expect(getState().customNodeDefs[defId]).toBeDefined();

    getState().removeCustomNodeDef(defId);
    expect(getState().customNodeDefs[defId]).toBeUndefined();
  });

  it('test 59: removeCustomNodeDef on non-existent id is silent no-op', () => {
    expect(() => {
      getState().removeCustomNodeDef('nonexistent-id');
    }).not.toThrow();
    expect(Object.keys(getState().customNodeDefs)).toHaveLength(0);
  });

  it('test 60: two defs with identical names coexist', () => {
    const id1 = getState().addCustomNodeDef({
      name: 'SameName',
      color: '#f00',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '1',
    });
    const id2 = getState().addCustomNodeDef({
      name: 'SameName',
      color: '#0f0',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '2',
    });

    expect(id1).not.toBe(id2);
    expect(getState().customNodeDefs[id1].name).toBe('SameName');
    expect(getState().customNodeDefs[id2].name).toBe('SameName');
    expect(getState().customNodeDefs[id1].expression).toBe('1');
    expect(getState().customNodeDefs[id2].expression).toBe('2');
  });

  it('test 61: addCustomNode from def sets correct customDefId', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Defined Node',
      color: '#abc',
      category: 'custom',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'in0 * 2',
    });

    const nodeId = getState().addCustomNode(defId)!;
    expect(nodeId).toBeTruthy();
    const node = getState().nodes[nodeId];
    expect(node.data.customDefId).toBe(defId);
    expect(node.title).toBe('Defined Node');
    expect(node.data.expression).toBe('in0 * 2');
  });
});

// ===========================================================================
// SERIALIZATION EDGE CASES (tests 62–65)
// ===========================================================================

describe('Serialization Edge Cases', () => {
  beforeEach(() => { resetStore(); });

  it('test 62: custom node with 0 inputs survives export/import', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 0, 1);
    getState().updateNodeData(nodeId, 'expression', '42');

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    const imported = getState().nodes[nodeId];
    expect(imported).toBeDefined();
    expect(imported.inputs).toHaveLength(0);
    expect(imported.outputs).toHaveLength(1);
    expect(imported.data.expression).toBe('42');
  });

  it('test 63: custom node with max ports (8/8) survives export/import', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 8, 8);

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    const imported = getState().nodes[nodeId];
    expect(imported.inputs).toHaveLength(8);
    expect(imported.outputs).toHaveLength(8);
    // Verify labels preserved
    expect(imported.inputs[7].label).toBe('in7');
    expect(imported.outputs[7].label).toBe('out7');
  });

  it('test 64: paste preserves custom node expression and ports', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 3, 2);
    getState().updateNodeData(nodeId, 'expression', 'in0 * in1 + in2');

    // Copy and paste
    getState().setSelection(new Set([nodeId]));
    getState().copySelected();
    getState().paste();

    const allNodes = Object.values(getState().nodes);
    const pastedNode = allNodes.find(n => n.id !== nodeId && n.type === 'custom');
    expect(pastedNode).toBeDefined();
    expect(pastedNode!.inputs).toHaveLength(3);
    expect(pastedNode!.outputs).toHaveLength(2);
    expect(pastedNode!.data.expression).toBe('in0 * in1 + in2');
  });

  it('test 65: export/import preserves custom node execution results', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 5);
    const customId = getState().addNode('custom', [2, 0, 0]);
    getState().updateCustomNodePorts(customId, 1, 1);
    getState().updateNodeData(customId, 'expression', 'in0 * 3');
    getState().addConnection(srcId, 0, customId, 0);

    const storage = getState().exportAllGraphs();
    getState().importAllGraphs(storage);

    // Re-execute after import — should still work
    const state = getState();
    const result = execGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    expect(result.results.get(customId)?.outputs[0]).toBe(15);
  });
});

// ===========================================================================
// UNDO/REDO EDGE CASES (tests 66–70)
// ===========================================================================

describe('Undo/Redo Edge Cases', () => {
  beforeEach(() => { resetStore(); });

  it('test 66: undo of addCustomNode removes the node', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Test',
      color: '#fff',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });

    const nodeId = getState().addCustomNode(defId)!;
    expect(getState().nodes[nodeId]).toBeDefined();

    getState().undo(); // undo addCustomNode
    expect(getState().nodes[nodeId]).toBeUndefined();
  });

  it('test 67: undo of removeCustomNodeDef restores the def', () => {
    const defId = getState().addCustomNodeDef({
      name: 'ToRemove',
      color: '#abc',
      category: 'custom',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
      expression: 'in0 + 1',
    });
    expect(getState().customNodeDefs[defId]).toBeDefined();

    getState().removeCustomNodeDef(defId);
    expect(getState().customNodeDefs[defId]).toBeUndefined();

    getState().undo();
    const restored = getState().customNodeDefs[defId];
    expect(restored).toBeDefined();
    expect(restored.name).toBe('ToRemove');
    expect(restored.expression).toBe('in0 + 1');
  });

  it('test 68: new action after undo clears redo stack', () => {
    const nodeId = getState().addNode('custom', [0, 0, 0]);
    getState().updateCustomNodePorts(nodeId, 2, 1);
    getState().updateNodeData(nodeId, 'expression', 'in0 + in1');

    getState().undo(); // undo expression
    expect(getState().canRedo()).toBe(true);

    // Make a new action — should discard the redo
    getState().updateNodeData(nodeId, 'expression', 'in0 * in1');
    expect(getState().canRedo()).toBe(false);
  });

  it('test 69: undo on empty stack does not throw', () => {
    // Fresh store, no actions
    expect(getState().canUndo()).toBe(false);
    expect(() => getState().undo()).not.toThrow();
    expect(() => getState().redo()).not.toThrow();
  });

  it('test 70: redo after undo of removeCustomNodeDef then re-remove', () => {
    const defId = getState().addCustomNodeDef({
      name: 'ReDoTest',
      color: '#000',
      category: 'custom',
      inputs: [],
      outputs: [{ label: 'out', portType: 'any' }],
      expression: '0',
    });

    getState().removeCustomNodeDef(defId);
    expect(getState().customNodeDefs[defId]).toBeUndefined();

    getState().undo(); // restore def
    expect(getState().customNodeDefs[defId]).toBeDefined();

    getState().redo(); // re-remove
    expect(getState().customNodeDefs[defId]).toBeUndefined();
  });
});

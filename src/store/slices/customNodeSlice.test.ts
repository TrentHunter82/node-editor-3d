/**
 * Unit tests for customNodeSlice — custom node definition CRUD and
 * custom node instance creation / port reconfiguration.
 *
 * Tests addCustomNodeDef, removeCustomNodeDef, updateCustomNodeDef,
 * addCustomNode, and updateCustomNodePorts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCustomNodeActions } from './customNodeSlice';
import type { EditorNode, Connection, CustomNodeDef, PortDef, PortConfig, PortType } from '../../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTestNode(id: string, overrides?: Partial<EditorNode>): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: `Node ${id}`,
    data: {},
    inputs: [],
    outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
    ...overrides,
  };
}

function makeCustomNode(id: string, defId: string, inputCount: number, outputCount: number): EditorNode {
  const inputs: PortDef[] = [];
  for (let i = 0; i < inputCount; i++) {
    inputs.push({ id: `in-${i}`, label: `in${i}`, portType: 'any' });
  }
  const outputs: PortDef[] = [];
  for (let i = 0; i < outputCount; i++) {
    outputs.push({ id: `out-${i}`, label: `out${i}`, portType: 'any' });
  }
  return {
    id,
    type: 'custom',
    position: [0, 0, 0],
    title: 'Custom',
    data: { customDefId: defId, expression: 'a + b', inputCount, outputCount },
    inputs,
    outputs,
  };
}

function makeConnection(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: srcPort,
    targetNodeId: tgt,
    targetPortIndex: tgtPort,
  };
}

function makeDef(overrides?: Partial<CustomNodeDef>): Omit<CustomNodeDef, 'id'> {
  return {
    name: 'MyCustom',
    color: '#ff0000',
    category: 'Custom',
    expression: 'a + b',
    inputs: [
      { label: 'a', portType: 'number' },
      { label: 'b', portType: 'number' },
    ],
    outputs: [
      { label: 'result', portType: 'number' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock makePortDefs
// ---------------------------------------------------------------------------

function mockMakePortDefs(prefix: string, configs: { label: string; portType: PortType }[]): PortDef[] {
  return configs.map((c, i) => ({
    id: `${prefix}-${i}`,
    label: c.label,
    portType: c.portType,
  }));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('createCustomNodeActions', () => {
  let state: {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    customNodeDefs: Record<string, CustomNodeDef>;
    executeGraph: () => void;
  };

  let undoPushed: number;
  let undoLabels: string[];
  let nextId: number;
  let nextDefId: number;
  let scheduleAutoExecuteCalled: number;
  let invalidateDownstreamCalls: Array<{ nodeId: string }>;
  let executionCache: Map<string, unknown> | undefined;

  let actions: ReturnType<typeof createCustomNodeActions>;

  beforeEach(() => {
    state = {
      nodes: {},
      connections: {},
      customNodeDefs: {},
      executeGraph: vi.fn(),
    };

    undoPushed = 0;
    undoLabels = [];
    nextId = 1;
    nextDefId = 1;
    scheduleAutoExecuteCalled = 0;
    invalidateDownstreamCalls = [];
    executionCache = new Map();

    const set = (fn: (s: typeof state) => void) => { fn(state); };
    const get = () => state;

    const helpers = {
      pushUndo: (label?: string) => { undoPushed++; if (label) undoLabels.push(label); },
      genId: () => `node-${nextId++}`,
      genCustomDefId: () => `def-${nextDefId++}`,
      scheduleAutoExecute: (execute: () => void) => { scheduleAutoExecuteCalled++; execute(); },
      makePortDefs: mockMakePortDefs,
      invalidateDownstream: (nodeId: string) => { invalidateDownstreamCalls.push({ nodeId }); },
      getExecutionCache: () => executionCache,
      getActiveUndoGraphId: () => 'main',
    };

    actions = createCustomNodeActions(set, get, helpers);
  });

  // ========================================================================
  // addCustomNodeDef
  // ========================================================================
  describe('addCustomNodeDef', () => {
    it('creates def with generated ID', () => {
      const id = actions.addCustomNodeDef(makeDef());
      expect(id).toBe('def-1');
      expect(state.customNodeDefs['def-1']).toBeDefined();
      expect(state.customNodeDefs['def-1'].name).toBe('MyCustom');
      expect(state.customNodeDefs['def-1'].id).toBe('def-1');
      expect(state.customNodeDefs['def-1'].expression).toBe('a + b');
      expect(state.customNodeDefs['def-1'].inputs).toHaveLength(2);
      expect(state.customNodeDefs['def-1'].outputs).toHaveLength(1);
    });

    it('pushes undo', () => {
      actions.addCustomNodeDef(makeDef());
      expect(undoPushed).toBe(1);
      expect(undoLabels).toContain('Add custom node definition');
    });

    it('assigns unique IDs to successive defs', () => {
      const id1 = actions.addCustomNodeDef(makeDef());
      const id2 = actions.addCustomNodeDef(makeDef({ name: 'Second' }));
      expect(id1).toBe('def-1');
      expect(id2).toBe('def-2');
      expect(state.customNodeDefs['def-1'].name).toBe('MyCustom');
      expect(state.customNodeDefs['def-2'].name).toBe('Second');
    });
  });

  // ========================================================================
  // removeCustomNodeDef
  // ========================================================================
  describe('removeCustomNodeDef', () => {
    it('deletes def', () => {
      const id = actions.addCustomNodeDef(makeDef());
      undoPushed = 0;
      actions.removeCustomNodeDef(id);
      expect(state.customNodeDefs[id]).toBeUndefined();
      expect(undoPushed).toBe(1);
    });

    it('no-ops for nonexistent def', () => {
      undoPushed = 0;
      actions.removeCustomNodeDef('nonexistent');
      expect(undoPushed).toBe(0);
    });
  });

  // ========================================================================
  // updateCustomNodeDef
  // ========================================================================
  describe('updateCustomNodeDef', () => {
    let defId: string;

    beforeEach(() => {
      defId = actions.addCustomNodeDef(makeDef());
      undoPushed = 0;
      undoLabels = [];
      scheduleAutoExecuteCalled = 0;
      invalidateDownstreamCalls = [];
    });

    it('updates fields', () => {
      actions.updateCustomNodeDef(defId, { name: 'Renamed', color: '#00ff00' });
      expect(state.customNodeDefs[defId].name).toBe('Renamed');
      expect(state.customNodeDefs[defId].color).toBe('#00ff00');
      // Unchanged fields should remain
      expect(state.customNodeDefs[defId].expression).toBe('a + b');
    });

    it('pushes undo on change', () => {
      actions.updateCustomNodeDef(defId, { name: 'Changed' });
      expect(undoPushed).toBe(1);
      expect(undoLabels).toContain('Update custom node definition');
    });

    it('no-op guard when nothing changes', () => {
      // Pass the exact same values
      actions.updateCustomNodeDef(defId, {
        name: 'MyCustom',
        color: '#ff0000',
      });
      expect(undoPushed).toBe(0);
      expect(scheduleAutoExecuteCalled).toBe(0);
    });

    it('no-ops for nonexistent def', () => {
      actions.updateCustomNodeDef('nonexistent', { name: 'Nope' });
      expect(undoPushed).toBe(0);
    });

    it('propagates name changes to custom node instances', () => {
      // Add a custom node instance referencing this def
      state.nodes['cn1'] = makeCustomNode('cn1', defId, 2, 1);
      actions.updateCustomNodeDef(defId, { name: 'NewName' });
      expect(state.nodes['cn1'].title).toBe('NewName');
    });

    it('propagates expression changes to custom node instances', () => {
      state.nodes['cn1'] = makeCustomNode('cn1', defId, 2, 1);
      actions.updateCustomNodeDef(defId, { expression: 'a * b' });
      expect(state.nodes['cn1'].data.expression).toBe('a * b');
    });

    it('propagates input changes to custom node instances', () => {
      state.nodes['cn1'] = makeCustomNode('cn1', defId, 2, 1);
      const newInputs: PortConfig[] = [
        { label: 'x', portType: 'number' },
        { label: 'y', portType: 'number' },
        { label: 'z', portType: 'number' },
      ];
      actions.updateCustomNodeDef(defId, { inputs: newInputs });
      expect(state.nodes['cn1'].inputs).toHaveLength(3);
      expect(state.nodes['cn1'].data.inputCount).toBe(3);
    });

    it('propagates output changes to custom node instances', () => {
      state.nodes['cn1'] = makeCustomNode('cn1', defId, 2, 1);
      const newOutputs: PortConfig[] = [
        { label: 'out1', portType: 'number' },
        { label: 'out2', portType: 'string' },
      ];
      actions.updateCustomNodeDef(defId, { outputs: newOutputs });
      expect(state.nodes['cn1'].outputs).toHaveLength(2);
      expect(state.nodes['cn1'].data.outputCount).toBe(2);
    });

    it('removes out-of-range connections when ports change', () => {
      state.nodes['cn1'] = makeCustomNode('cn1', defId, 2, 1);
      // Connection to input port index 1 (will be removed when inputs shrink to 1)
      state.connections['cc1'] = makeConnection('cc1', 'other', 0, 'cn1', 1);
      // Connection to input port index 0 (should survive)
      state.connections['cc2'] = makeConnection('cc2', 'other', 0, 'cn1', 0);

      const newInputs: PortConfig[] = [{ label: 'only', portType: 'number' }];
      actions.updateCustomNodeDef(defId, { inputs: newInputs });

      expect(state.connections['cc1']).toBeUndefined();
      expect(state.connections['cc2']).toBeDefined();
    });

    it('invalidates downstream and schedules auto-execute', () => {
      state.nodes['cn1'] = makeCustomNode('cn1', defId, 2, 1);
      actions.updateCustomNodeDef(defId, { expression: 'a - b' });
      expect(invalidateDownstreamCalls.length).toBeGreaterThanOrEqual(1);
      expect(invalidateDownstreamCalls[0].nodeId).toBe('cn1');
      expect(scheduleAutoExecuteCalled).toBe(1);
    });

    it('does not affect non-custom nodes', () => {
      state.nodes['regular'] = makeTestNode('regular');
      actions.updateCustomNodeDef(defId, { name: 'Updated' });
      expect(state.nodes['regular'].title).toBe('Node regular');
    });

    it('does not affect custom nodes referencing a different def', () => {
      const otherDefId = actions.addCustomNodeDef(makeDef({ name: 'Other' }));
      state.nodes['cn1'] = makeCustomNode('cn1', otherDefId, 2, 1);
      undoPushed = 0;
      actions.updateCustomNodeDef(defId, { name: 'Changed' });
      // cn1 references otherDefId, so its title should not change
      expect(state.nodes['cn1'].title).toBe('Custom');
    });
  });

  // ========================================================================
  // addCustomNode
  // ========================================================================
  describe('addCustomNode', () => {
    let defId: string;

    beforeEach(() => {
      defId = actions.addCustomNodeDef(makeDef());
      undoPushed = 0;
      undoLabels = [];
    });

    it('creates node from definition with ports', () => {
      const nodeId = actions.addCustomNode(defId, [5, 0, 5]);
      expect(nodeId).toBe('node-1');
      const node = state.nodes['node-1'];
      expect(node).toBeDefined();
      expect(node.type).toBe('custom');
      expect(node.title).toBe('MyCustom');
      expect(node.position).toEqual([5, 0, 5]);
      expect(node.data.customDefId).toBe(defId);
      expect(node.data.expression).toBe('a + b');
      // Ports created via makePortDefs mock
      expect(node.inputs).toHaveLength(2);
      expect(node.inputs[0].label).toBe('a');
      expect(node.inputs[1].label).toBe('b');
      expect(node.outputs).toHaveLength(1);
      expect(node.outputs[0].label).toBe('result');
    });

    it('pushes undo', () => {
      actions.addCustomNode(defId);
      expect(undoPushed).toBe(1);
      expect(undoLabels).toContain('Add custom node');
    });

    it('returns null for nonexistent def', () => {
      const result = actions.addCustomNode('nonexistent');
      expect(result).toBeNull();
      expect(undoPushed).toBe(0);
    });

    it('uses random position when not specified', () => {
      const nodeId = actions.addCustomNode(defId);
      const node = state.nodes[nodeId!];
      expect(node.position).toHaveLength(3);
      // Y should be 0 from Math.random formula
      expect(node.position[1]).toBe(0);
    });

    it('creates port defs using makePortDefs', () => {
      const nodeId = actions.addCustomNode(defId);
      const node = state.nodes[nodeId!];
      // Mock makePortDefs creates IDs like "in-0", "in-1", "out-0"
      expect(node.inputs[0].id).toBe('in-0');
      expect(node.inputs[1].id).toBe('in-1');
      expect(node.outputs[0].id).toBe('out-0');
    });
  });

  // ========================================================================
  // updateCustomNodePorts
  // ========================================================================
  describe('updateCustomNodePorts', () => {
    let defId: string;

    beforeEach(() => {
      defId = actions.addCustomNodeDef(makeDef());
      state.nodes['cn1'] = makeCustomNode('cn1', defId, 2, 1);
      undoPushed = 0;
      undoLabels = [];
      scheduleAutoExecuteCalled = 0;
      invalidateDownstreamCalls = [];
    });

    it('changes port counts', () => {
      actions.updateCustomNodePorts('cn1', 3, 2);
      const node = state.nodes['cn1'];
      expect(node.inputs).toHaveLength(3);
      expect(node.outputs).toHaveLength(2);
      expect(node.data.inputCount).toBe(3);
      expect(node.data.outputCount).toBe(2);
    });

    it('pushes undo', () => {
      actions.updateCustomNodePorts('cn1', 3, 2);
      expect(undoPushed).toBe(1);
      expect(undoLabels).toContain('Update custom node ports');
    });

    it('generates port labels as in0, in1, ..., out0, out1, ...', () => {
      actions.updateCustomNodePorts('cn1', 3, 2);
      const node = state.nodes['cn1'];
      expect(node.inputs.map(p => p.label)).toEqual(['in0', 'in1', 'in2']);
      expect(node.outputs.map(p => p.label)).toEqual(['out0', 'out1']);
    });

    it('clamps to bounds (0-8 inputs, 1-8 outputs)', () => {
      // Exceed upper bounds
      actions.updateCustomNodePorts('cn1', 100, 100);
      let node = state.nodes['cn1'];
      expect(node.inputs).toHaveLength(8);
      expect(node.outputs).toHaveLength(8);
      expect(node.data.inputCount).toBe(8);
      expect(node.data.outputCount).toBe(8);

      // Below lower bounds
      undoPushed = 0;
      actions.updateCustomNodePorts('cn1', -5, 0);
      node = state.nodes['cn1'];
      expect(node.inputs).toHaveLength(0);
      expect(node.outputs).toHaveLength(1); // Min 1 output
      expect(node.data.inputCount).toBe(0);
      expect(node.data.outputCount).toBe(1);
    });

    it('removes out-of-range connections', () => {
      // Add connections that target ports that will be removed
      state.connections['c-in0'] = makeConnection('c-in0', 'other', 0, 'cn1', 0);
      state.connections['c-in1'] = makeConnection('c-in1', 'other', 0, 'cn1', 1);
      state.connections['c-out0'] = makeConnection('c-out0', 'cn1', 0, 'other', 0);

      // Reduce to 1 input and 1 output
      actions.updateCustomNodePorts('cn1', 1, 1);

      // c-in0 targets port 0 -> should survive
      expect(state.connections['c-in0']).toBeDefined();
      // c-in1 targets port 1 -> should be removed (only 1 input now)
      expect(state.connections['c-in1']).toBeUndefined();
      // c-out0 sources from port 0 -> should survive
      expect(state.connections['c-out0']).toBeDefined();
    });

    it('removes source connections that exceed output port count', () => {
      state.nodes['cn1'] = makeCustomNode('cn1', defId, 2, 3);
      state.connections['c-out2'] = makeConnection('c-out2', 'cn1', 2, 'other', 0);
      state.connections['c-out0'] = makeConnection('c-out0', 'cn1', 0, 'other', 0);

      // Reduce to 1 output
      actions.updateCustomNodePorts('cn1', 2, 1);

      expect(state.connections['c-out2']).toBeUndefined();
      expect(state.connections['c-out0']).toBeDefined();
    });

    it('no-ops for locked nodes', () => {
      state.nodes['cn1'].locked = true;
      actions.updateCustomNodePorts('cn1', 5, 5);
      // Should remain unchanged
      expect(state.nodes['cn1'].inputs).toHaveLength(2);
      expect(state.nodes['cn1'].outputs).toHaveLength(1);
      expect(undoPushed).toBe(0);
    });

    it('no-ops for nonexistent nodes', () => {
      actions.updateCustomNodePorts('nonexistent', 3, 3);
      expect(undoPushed).toBe(0);
    });

    it('no-ops for non-custom nodes', () => {
      state.nodes['regular'] = makeTestNode('regular');
      actions.updateCustomNodePorts('regular', 3, 3);
      expect(undoPushed).toBe(0);
    });

    it('invalidates downstream and schedules auto-execute', () => {
      actions.updateCustomNodePorts('cn1', 3, 2);
      expect(invalidateDownstreamCalls.length).toBe(1);
      expect(invalidateDownstreamCalls[0].nodeId).toBe('cn1');
      expect(scheduleAutoExecuteCalled).toBe(1);
    });
  });
});

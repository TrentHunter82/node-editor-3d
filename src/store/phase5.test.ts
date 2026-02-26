import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore } from './editorStore';
import { executeGraph as rawExecGraph } from '../utils/execution';
import type { EditorNode, Connection, CustomNodeDef } from '../types';
import { NODE_TYPE_CONFIG, isPortTypeCompatible, NODE_CATEGORIES } from '../types';
import { saveGraph } from '../utils/serialization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
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
  });
}

function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  while (getState().canRedo()) getState().redo();
  while (getState().canUndo()) getState().undo();
}

function getState() {
  return useEditorStore.getState();
}

/** Convenience wrapper */
function execGraph(nodes: Record<string, EditorNode>, connections: Record<string, Connection>) {
  return rawExecGraph(nodes, connections);
}

function makeCustomDef(overrides: Partial<Omit<CustomNodeDef, 'id'>> = {}): Omit<CustomNodeDef, 'id'> {
  return {
    name: 'TestCustom',
    color: 'purple',
    category: 'Custom',
    inputs: [
      { label: 'in0', portType: 'number' },
      { label: 'in1', portType: 'number' },
    ],
    outputs: [{ label: 'out', portType: 'number' }],
    expression: 'in0 + in1',
    ...overrides,
  };
}

function makeNode(id: string, type: EditorNode['type'], data: Record<string, unknown> = {}): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id, type, position: [0, 0, 0], title: type, data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
  };
}

function makeCustomTestNode(id: string, expression: string, inputCount = 2): EditorNode {
  return {
    id, type: 'custom', position: [0, 0, 0], title: 'Custom',
    data: { expression, inputCount },
    inputs: Array.from({ length: inputCount }, (_, i) => ({ id: `in-${i}`, label: `in${i}`, portType: 'number' as const })),
    outputs: [{ id: 'out-0', label: 'out', portType: 'number' as const }],
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ============================================================================
// 1. NODE COLLAPSE TESTS
// ============================================================================

describe('Node Collapse System', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  describe('toggleNodeCollapse', () => {
    it('toggles to true', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().toggleNodeCollapse(id);
      expect(getState().nodes[id].collapsed).toBe(true);
    });

    it('toggles back to false', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().toggleNodeCollapse(id);
      getState().toggleNodeCollapse(id);
      expect(getState().nodes[id].collapsed).toBe(false);
    });

    it('pushes undo', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().toggleNodeCollapse(id);
      getState().undo();
      expect(getState().nodes[id].collapsed).toBeFalsy();
    });

    it('no-ops for nonexistent node', () => {
      const before = getState().canUndo();
      getState().toggleNodeCollapse('fake');
      expect(getState().canUndo()).toBe(before);
    });

    it('preserves connections', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);
      getState().toggleNodeCollapse(src);
      expect(Object.keys(getState().connections)).toHaveLength(1);
    });
  });

  describe('collapseSelected / expandSelected', () => {
    it('collapseSelected collapses all selected', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      getState().collapseSelected();
      expect(getState().nodes[n1].collapsed).toBe(true);
      expect(getState().nodes[n2].collapsed).toBe(true);
    });

    it('expandSelected expands collapsed', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().toggleNodeCollapse(n1);
      getState().toggleNodeCollapse(n2);
      getState().setSelection(new Set([n1, n2]));
      getState().expandSelected();
      expect(getState().nodes[n1].collapsed).toBe(false);
      expect(getState().nodes[n2].collapsed).toBe(false);
    });

    it('collapseSelected single undo', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      getState().collapseSelected();
      getState().undo();
      expect(getState().nodes[n1].collapsed).toBeFalsy();
      expect(getState().nodes[n2].collapsed).toBeFalsy();
    });

    it('expandSelected single undo', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().toggleNodeCollapse(n1);
      getState().toggleNodeCollapse(n2);
      getState().setSelection(new Set([n1, n2]));
      getState().expandSelected();
      getState().undo();
      expect(getState().nodes[n1].collapsed).toBe(true);
      expect(getState().nodes[n2].collapsed).toBe(true);
    });

    it('skips already-collapsed', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [5, 0, 0]);
      getState().toggleNodeCollapse(n1);
      getState().setSelection(new Set([n1, n2]));
      getState().collapseSelected();
      expect(getState().nodes[n2].collapsed).toBe(true);
    });
  });

  describe('serialization', () => {
    it('save/load preserves collapsed', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().toggleNodeCollapse(id);
      saveGraph(getState().nodes, getState().connections, getState().groups, getState().customNodeDefs);
      resetStore();
      expect(getState().loadFromStorage()).toBe(true);
      expect(getState().nodes[id].collapsed).toBe(true);
    });
  });

  describe('undo/redo', () => {
    it('undo reverts', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().toggleNodeCollapse(id);
      getState().undo();
      expect(getState().nodes[id].collapsed).toBeFalsy();
    });

    it('redo re-applies', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().toggleNodeCollapse(id);
      getState().undo();
      getState().redo();
      expect(getState().nodes[id].collapsed).toBe(true);
    });

    it('multiple toggles chain', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().toggleNodeCollapse(id);
      getState().toggleNodeCollapse(id);
      getState().toggleNodeCollapse(id);
      getState().undo();
      expect(getState().nodes[id].collapsed).toBe(false);
      getState().undo();
      expect(getState().nodes[id].collapsed).toBe(true);
      getState().undo();
      expect(getState().nodes[id].collapsed).toBeFalsy();
    });
  });
});

// ============================================================================
// 2. CUSTOM NODE DEFINITIONS
// ============================================================================

describe('Custom Node Definitions', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  describe('addCustomNodeDef', () => {
    it('creates with generated id', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      expect(defId).toMatch(/^customdef-/);
      expect(getState().customNodeDefs[defId].name).toBe('TestCustom');
    });

    it('stores ports', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      expect(getState().customNodeDefs[defId].inputs).toHaveLength(2);
      expect(getState().customNodeDefs[defId].outputs).toHaveLength(1);
    });

    it('pushes undo', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      getState().undo();
      expect(getState().customNodeDefs[defId]).toBeUndefined();
    });

    it('unique ids', () => {
      const a = getState().addCustomNodeDef(makeCustomDef({ name: 'A' }));
      const b = getState().addCustomNodeDef(makeCustomDef({ name: 'B' }));
      expect(a).not.toBe(b);
    });
  });

  describe('removeCustomNodeDef', () => {
    it('removes', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      getState().removeCustomNodeDef(defId);
      expect(getState().customNodeDefs[defId]).toBeUndefined();
    });

    it('undo restores', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      getState().removeCustomNodeDef(defId);
      getState().undo();
      expect(getState().customNodeDefs[defId]).toBeDefined();
    });
  });

  describe('addCustomNode', () => {
    it('creates node from def', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const nodeId = getState().addCustomNode(defId, [3, 0, 3]);
      expect(getState().nodes[nodeId!].type).toBe('custom');
      expect(getState().nodes[nodeId!].title).toBe('TestCustom');
    });

    it('ports from def', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const nodeId = getState().addCustomNode(defId);
      expect(getState().nodes[nodeId!].inputs).toHaveLength(2);
      expect(getState().nodes[nodeId!].outputs).toHaveLength(1);
    });

    it('stores expression in data', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const nodeId = getState().addCustomNode(defId);
      expect(getState().nodes[nodeId!].data.expression).toBe('in0 + in1');
      expect(getState().nodes[nodeId!].data.customDefId).toBe(defId);
    });

    it('null for bad defId', () => {
      expect(getState().addCustomNode('fake')).toBeNull();
    });

    it('undo removes', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const nodeId = getState().addCustomNode(defId);
      getState().undo();
      expect(getState().nodes[nodeId!]).toBeUndefined();
    });

    it('type-compatible connections work', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const customId = getState().addCustomNode(defId, [0, 0, 0]);
      const srcId = getState().addNode('source', [5, 0, 0]);
      expect(getState().addConnection(srcId, 0, customId!, 0)).toBeTruthy();
    });

    it('incompatible connections rejected', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const customId = getState().addCustomNode(defId, [0, 0, 0]);
      const srcId = getState().addNode('source', [5, 0, 0]);
      expect(getState().addConnection(srcId, 1, customId!, 0)).toBeNull();
    });
  });

  describe('updateCustomNodePorts', () => {
    it('changes counts', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const nodeId = getState().addCustomNode(defId, [0, 0, 0]);
      getState().updateCustomNodePorts(nodeId!, 4, 2);
      expect(getState().nodes[nodeId!].inputs).toHaveLength(4);
      expect(getState().nodes[nodeId!].outputs).toHaveLength(2);
    });

    it('clamps bounds', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const nodeId = getState().addCustomNode(defId, [0, 0, 0]);
      getState().updateCustomNodePorts(nodeId!, -1, 0);
      expect(getState().nodes[nodeId!].inputs).toHaveLength(0);
      expect(getState().nodes[nodeId!].outputs).toHaveLength(1);
      getState().updateCustomNodePorts(nodeId!, 20, 20);
      expect(getState().nodes[nodeId!].inputs).toHaveLength(8);
      expect(getState().nodes[nodeId!].outputs).toHaveLength(8);
    });

    it('removes stale connections', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const customId = getState().addCustomNode(defId, [0, 0, 0]);
      const src = getState().addNode('source', [5, 0, 0]);
      getState().addConnection(src, 0, customId!, 0);
      getState().addConnection(src, 0, customId!, 1);
      getState().updateCustomNodePorts(customId!, 1, 1);
      expect(Object.keys(getState().connections)).toHaveLength(1);
    });

    it('pushes undo', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const nodeId = getState().addCustomNode(defId, [0, 0, 0]);
      getState().updateCustomNodePorts(nodeId!, 4, 2);
      getState().undo();
      expect(getState().nodes[nodeId!].inputs).toHaveLength(2);
    });
  });

  describe('serialization', () => {
    it('save/load roundtrip', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      const nodeId = getState().addCustomNode(defId, [1, 0, 1]);
      saveGraph(getState().nodes, getState().connections, getState().groups, getState().customNodeDefs);
      resetStore();
      expect(getState().loadFromStorage()).toBe(true);
      expect(getState().customNodeDefs[defId].name).toBe('TestCustom');
      expect(getState().nodes[nodeId!].type).toBe('custom');
    });

    it('undo/redo preserves defs', () => {
      const defId = getState().addCustomNodeDef(makeCustomDef());
      getState().undo();
      expect(getState().customNodeDefs[defId]).toBeUndefined();
      getState().redo();
      expect(getState().customNodeDefs[defId]).toBeDefined();
    });
  });
});

// ============================================================================
// 3. EXPRESSION EXECUTION
// ============================================================================

describe('Custom Node Expression Execution', () => {
  describe('basic expressions', () => {
    it('in0 + in1', () => {
      const r = execGraph(
        { s1: makeNode('s1', 'source', { value: 3 }), s2: makeNode('s2', 'source', { value: 7 }), c: makeCustomTestNode('c', 'in0 + in1') },
        { c1: makeConn('c1', 's1', 0, 'c', 0), c2: makeConn('c2', 's2', 0, 'c', 1) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(10);
    });

    it('in0 * 2', () => {
      const r = execGraph(
        { s: makeNode('s', 'source', { value: 5 }), c: makeCustomTestNode('c', 'in0 * 2', 1) },
        { c1: makeConn('c1', 's', 0, 'c', 0) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(10);
    });

    it('Math.sin(in0)', () => {
      const r = execGraph(
        { s: makeNode('s', 'source', { value: Math.PI / 2 }), c: makeCustomTestNode('c', 'Math.sin(in0)', 1) },
        { c1: makeConn('c1', 's', 0, 'c', 0) },
      );
      expect(r.results.get('c')!.outputs[0]).toBeCloseTo(1, 5);
    });

    it('Math.abs(in0)', () => {
      const r = execGraph(
        { s: makeNode('s', 'source', { value: -42 }), c: makeCustomTestNode('c', 'Math.abs(in0)', 1) },
        { c1: makeConn('c1', 's', 0, 'c', 0) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(42);
    });

    it('ternary in0 > 0 ? in1 : in2', () => {
      const r = execGraph(
        { a: makeNode('a', 'source', { value: 1 }), b: makeNode('b', 'source', { value: 42 }), d: makeNode('d', 'source', { value: -1 }), c: makeCustomTestNode('c', 'in0 > 0 ? in1 : in2', 3) },
        { c1: makeConn('c1', 'a', 0, 'c', 0), c2: makeConn('c2', 'b', 0, 'c', 1), c3: makeConn('c3', 'd', 0, 'c', 2) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(42);
    });

    it('Math.max(in0, in1)', () => {
      const r = execGraph(
        { s1: makeNode('s1', 'source', { value: 3 }), s2: makeNode('s2', 'source', { value: 9 }), c: makeCustomTestNode('c', 'Math.max(in0, in1)') },
        { c1: makeConn('c1', 's1', 0, 'c', 0), c2: makeConn('c2', 's2', 0, 'c', 1) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(9);
    });

    it('inputs dict access', () => {
      const r = execGraph(
        { s: makeNode('s', 'source', { value: 7 }), c: makeCustomTestNode('c', 'inputs[0] * 3', 1) },
        { c1: makeConn('c1', 's', 0, 'c', 0) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(21);
    });
  });

  describe('error handling', () => {
    it('syntax error recorded', () => {
      const r = execGraph(
        { s: makeNode('s', 'source', { value: 5 }), c: makeCustomTestNode('c', '{{bad}}', 1) },
        { c1: makeConn('c1', 's', 0, 'c', 0) },
      );
      expect(r.errors.has('c')).toBe(true);
    });

    it('defaults to in0 when no expression', () => {
      const custom: EditorNode = {
        id: 'c', type: 'custom', position: [0, 0, 0], title: 'C',
        data: { inputCount: 1 },
        inputs: [{ id: 'in-0', label: 'in0', portType: 'number' }],
        outputs: [{ id: 'out-0', label: 'out', portType: 'number' }],
      };
      const r = execGraph(
        { s: makeNode('s', 'source', { value: 99 }), c: custom },
        { c1: makeConn('c1', 's', 0, 'c', 0) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(99);
    });
  });

  describe('variable binding', () => {
    it('in0/in1 mapped correctly', () => {
      const r = execGraph(
        { a: makeNode('a', 'source', { value: 10 }), b: makeNode('b', 'source', { value: 20 }), c: makeCustomTestNode('c', 'in0 - in1') },
        { c1: makeConn('c1', 'a', 0, 'c', 0), c2: makeConn('c2', 'b', 0, 'c', 1) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(-10);
    });

    it('unconnected default to 0', () => {
      const r = execGraph({ c: makeCustomTestNode('c', 'in0 + in1') }, {});
      expect(r.results.get('c')!.outputs[0]).toBe(0);
    });
  });

  describe('graph chains', () => {
    it('two custom nodes chained', () => {
      const r = execGraph(
        { s: makeNode('s', 'source', { value: 2 }), d: makeCustomTestNode('d', 'in0 * 2', 1), q: makeCustomTestNode('q', 'in0 * in0', 1) },
        { c1: makeConn('c1', 's', 0, 'd', 0), c2: makeConn('c2', 'd', 0, 'q', 0) },
      );
      expect(r.results.get('d')!.outputs[0]).toBe(4);
      expect(r.results.get('q')!.outputs[0]).toBe(16);
    });

    it('custom between source and transform', () => {
      const r = execGraph(
        { s: makeNode('s', 'source', { value: 10 }), c: makeCustomTestNode('c', 'in0 + 5', 1), x: makeNode('x', 'transform', { multiplier: 2, offset: 0 }) },
        { c1: makeConn('c1', 's', 0, 'c', 0), c2: makeConn('c2', 'c', 0, 'x', 0) },
      );
      expect(r.results.get('c')!.outputs[0]).toBe(15);
      expect(r.results.get('x')!.outputs[0]).toBe(30);
    });
  });
});

// ============================================================================
// 4. PORT COMPAT + getCompatibleNodeTypes + addNodeAndConnect
// ============================================================================

describe('Port Compatibility', () => {
  describe('isPortTypeCompatible', () => {
    it('same types compatible', () => {
      expect(isPortTypeCompatible('number', 'number')).toBe(true);
      expect(isPortTypeCompatible('string', 'string')).toBe(true);
    });

    it('different types incompatible', () => {
      expect(isPortTypeCompatible('number', 'string')).toBe(false);
    });

    it('any compatible with all', () => {
      expect(isPortTypeCompatible('any', 'number')).toBe(true);
      expect(isPortTypeCompatible('number', 'any')).toBe(true);
    });
  });

  describe('getCompatibleNodeTypes', () => {
    beforeEach(() => { drainUndoRedo(); resetStore(); });

    it('number output', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const types = getState().getCompatibleNodeTypes(src, 0, true).map(c => c.type);
      expect(types).toContain('transform');
      expect(types).toContain('math');
      expect(types).toContain('filter');
      expect(types).not.toContain('note');
    });

    it('string output', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const types = getState().getCompatibleNodeTypes(src, 1, true).map(c => c.type);
      expect(types).toContain('concat');
      expect(types).not.toContain('transform');
    });

    it('boolean output', () => {
      const cmp = getState().addNode('compare', [0, 0, 0]);
      const types = getState().getCompatibleNodeTypes(cmp, 0, true).map(c => c.type);
      expect(types).toContain('switch');
    });

    it('from input port', () => {
      const xfm = getState().addNode('transform', [0, 0, 0]);
      const types = getState().getCompatibleNodeTypes(xfm, 0, false).map(c => c.type);
      expect(types).toContain('source');
      expect(types).toContain('math');
    });

    it('correct categories', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      for (const item of getState().getCompatibleNodeTypes(src, 0, true)) {
        expect(item.category).toBe(NODE_CATEGORIES[item.type]);
      }
    });

    it('empty for bad node/port', () => {
      expect(getState().getCompatibleNodeTypes('fake', 0, true)).toEqual([]);
      const src = getState().addNode('source', [0, 0, 0]);
      expect(getState().getCompatibleNodeTypes(src, 99, true)).toEqual([]);
    });
  });

  describe('addNodeAndConnect', () => {
    beforeEach(() => { drainUndoRedo(); resetStore(); });

    it('creates node and connection', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const newId = getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true);
      expect(newId).toBeTruthy();
      expect(getState().nodes[newId!].type).toBe('transform');
      expect(Object.keys(getState().connections)).toHaveLength(1);
    });

    it('correct connection direction (output->input)', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const newId = getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true);
      const conn = Object.values(getState().connections)[0];
      expect(conn.sourceNodeId).toBe(src);
      expect(conn.targetNodeId).toBe(newId);
    });

    it('from input: new output -> existing input', () => {
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const newId = getState().addNodeAndConnect('source', [0, 0, 0], xfm, 0, false);
      const conn = Object.values(getState().connections)[0];
      expect(conn.sourceNodeId).toBe(newId);
      expect(conn.targetNodeId).toBe(xfm);
    });

    it('auto-selects new node', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const newId = getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true);
      expect(getState().selectedIds.has(newId!)).toBe(true);
    });

    it('single undo removes both', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true);
      getState().undo();
      expect(Object.keys(getState().nodes)).toHaveLength(1);
      expect(Object.keys(getState().connections)).toHaveLength(0);
    });

    it('null for bad source/port/type', () => {
      expect(getState().addNodeAndConnect('transform', [0, 0, 0], 'fake', 0, true)).toBeNull();
      const src = getState().addNode('source', [0, 0, 0]);
      expect(getState().addNodeAndConnect('transform', [0, 0, 0], src, 99, true)).toBeNull();
      expect(getState().addNodeAndConnect('note', [5, 0, 0], src, 0, true)).toBeNull();
    });
  });
});

// ============================================================================
// 5. GRAPH VALIDATION
// ============================================================================

describe('Graph Validation', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('flags unconnected inputs', () => {
    const xfm = getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    expect(getState().validationErrors[xfm].some(e => e.includes('not connected'))).toBe(true);
  });

  it('no errors when fully connected', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(src, 0, xfm, 1);
    getState().addConnection(xfm, 0, out, 0);
    getState().validateGraph();
    expect(getState().validationErrors[xfm]).toBeUndefined();
  });

  it('flags disconnected nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().validateGraph();
    expect(getState().validationErrors[src].some(e => e.includes('no connections'))).toBe(true);
  });

  it('skips notes', () => {
    getState().addNode('note', [0, 0, 0]);
    getState().validateGraph();
    expect(Object.keys(getState().validationErrors).filter(id => getState().nodes[id]?.type === 'note')).toHaveLength(0);
  });

  it('re-validate after fix clears errors', () => {
    const xfm = getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    expect(getState().validationErrors[xfm]).toBeDefined();
    const src = getState().addNode('source', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(src, 0, xfm, 1);
    getState().addConnection(xfm, 0, out, 0);
    getState().validateGraph();
    expect(getState().validationErrors[xfm]).toBeUndefined();
  });

  it('in undo/redo snapshot', () => {
    getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    expect(Object.keys(getState().validationErrors).length).toBeGreaterThan(0);
    getState().addNode('source', [5, 0, 0]);
    getState().undo();
    expect(Object.keys(getState().validationErrors).length).toBeGreaterThan(0);
  });
});

describe('Graph Validation Auto-Run (debounce)', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('auto-validates after connection change (300ms debounce)', () => {
    const xfm = getState().addNode('transform', [0, 0, 0]);
    // Clear any auto-validation from addNode
    vi.advanceTimersByTime(500);
    // Manually clear validation errors to test auto-trigger
    useEditorStore.setState({ validationErrors: {} });
    expect(getState().validationErrors[xfm]).toBeUndefined();

    // Add a connection - this should trigger auto-validate after 300ms
    const src = getState().addNode('source', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    // Before debounce fires, validation hasn't re-run (state was cleared)
    // After 300ms, auto-validate should run
    vi.advanceTimersByTime(350);

    // Now validation should have run - transform still has 1 unconnected input (factor)
    expect(getState().validationErrors[xfm]).toBeDefined();
    expect(getState().validationErrors[xfm].some(e => e.includes('factor'))).toBe(true);
  });

  it('debounce coalesces rapid connection changes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    vi.advanceTimersByTime(500);
    useEditorStore.setState({ validationErrors: {} });

    // Rapidly add two connections + output
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(src, 0, xfm, 1);
    getState().addConnection(xfm, 0, out, 0);

    // After debounce, both connections exist
    vi.advanceTimersByTime(350);

    // With both inputs connected and output consumed, no errors for transform
    expect(getState().validationErrors[xfm]).toBeUndefined();
  });
});

// ============================================================================
// 6. INTEGRATION
// ============================================================================

describe('Phase 5 Integration', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('collapsed nodes execute', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfm, 'multiplier', 3);
    getState().updateNodeData(xfm, 'offset', 0);
    getState().addConnection(src, 0, xfm, 0);
    getState().toggleNodeCollapse(src);
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().isExecuting).toBe(false);
    expect(getState().executionStates[src]).toBe('idle');
  });

  it('custom node end-to-end execution via store', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Mul10', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0 * 10',
    });
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 5);
    const customId = getState().addCustomNode(defId, [5, 0, 0]);
    getState().addConnection(srcId, 0, customId!, 0);
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[customId!][0]).toBe(50);
  });

  it('drag-from-port workflow', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    expect(getState().getCompatibleNodeTypes(src, 0, true).some(c => c.type === 'transform')).toBe(true);
    const newId = getState().addNodeAndConnect('transform', [5, 0, 0], src, 0, true);
    expect(Object.keys(getState().connections)).toHaveLength(1);
    expect(getState().selectedIds.has(newId!)).toBe(true);
  });

  it('validate → fix → re-validate', () => {
    const xfm = getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    expect(getState().validationErrors[xfm]).toBeDefined();
    const src = getState().addNode('source', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(src, 0, xfm, 1);
    getState().addConnection(xfm, 0, out, 0);
    getState().validateGraph();
    expect(getState().validationErrors[xfm]).toBeUndefined();
  });

  it('collapsed custom node output survives expand', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Add100', color: 'green', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0 + 100',
    });
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 5);
    const customId = getState().addCustomNode(defId, [5, 0, 0]);
    getState().addConnection(srcId, 0, customId!, 0);
    getState().toggleNodeCollapse(customId!);
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[customId!][0]).toBe(105);
    getState().toggleNodeCollapse(customId!);
    expect(getState().nodeOutputs[customId!][0]).toBe(105);
  });

  it('save/load preserves all Phase 5 state', () => {
    const defId = getState().addCustomNodeDef(makeCustomDef());
    const srcId = getState().addNode('source', [0, 0, 0]);
    const customId = getState().addCustomNode(defId, [5, 0, 0]);
    getState().toggleNodeCollapse(srcId);
    getState().addConnection(srcId, 0, customId!, 0);
    saveGraph(getState().nodes, getState().connections, getState().groups, getState().customNodeDefs);
    resetStore();
    expect(getState().loadFromStorage()).toBe(true);
    expect(getState().nodes[srcId].collapsed).toBe(true);
    expect(getState().customNodeDefs[defId]).toBeDefined();
    expect(getState().nodes[customId!].type).toBe('custom');
  });
});

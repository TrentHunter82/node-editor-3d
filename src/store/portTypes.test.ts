import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
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

describe('Port Type System', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
  });

  describe('addNode creates ports with correct types', () => {
    it('source node has typed outputs (number, string)', () => {
      const id = getState().addNode('source');
      const node = getState().nodes[id];
      expect(node.outputs).toHaveLength(2);
      expect(node.outputs[0].portType).toBe('number');
      expect(node.outputs[1].portType).toBe('string');
      expect(node.inputs).toHaveLength(0);
    });

    it('transform node has typed ports', () => {
      const id = getState().addNode('transform');
      const node = getState().nodes[id];
      expect(node.inputs).toHaveLength(2);
      expect(node.inputs[0].portType).toBe('number');
      expect(node.inputs[1].portType).toBe('number');
      expect(node.outputs).toHaveLength(2);
      expect(node.outputs[0].portType).toBe('number');
      expect(node.outputs[1].portType).toBe('string');
    });

    it('filter node has any-typed ports', () => {
      const id = getState().addNode('filter');
      const node = getState().nodes[id];
      expect(node.inputs).toHaveLength(1);
      expect(node.inputs[0].portType).toBe('any');
      expect(node.outputs).toHaveLength(1);
      expect(node.outputs[0].portType).toBe('any');
    });

    it('output node has typed inputs', () => {
      const id = getState().addNode('output');
      const node = getState().nodes[id];
      expect(node.inputs).toHaveLength(2);
      expect(node.inputs[0].portType).toBe('any');
      expect(node.inputs[1].portType).toBe('string');
      expect(node.outputs).toHaveLength(0);
    });

    it('all ports have labels from config', () => {
      const srcId = getState().addNode('source');
      const src = getState().nodes[srcId];
      expect(src.outputs[0].label).toBe('value');
      expect(src.outputs[1].label).toBe('label');

      const xfmId = getState().addNode('transform');
      const xfm = getState().nodes[xfmId];
      expect(xfm.inputs[0].label).toBe('in');
      expect(xfm.inputs[1].label).toBe('factor');
      expect(xfm.outputs[0].label).toBe('result');
      expect(xfm.outputs[1].label).toBe('debug');
    });
  });

  describe('addConnection with port type validation', () => {
    it('allows compatible types (number -> number)', () => {
      const src = getState().addNode('source');    // output 0 = number
      const tgt = getState().addNode('transform'); // input 0 = number
      const connId = getState().addConnection(src, 0, tgt, 0);
      expect(connId).toBeTruthy();
    });

    it('rejects incompatible types (string -> number)', () => {
      const src = getState().addNode('source');    // output 1 = string
      const tgt = getState().addNode('transform'); // input 0 = number
      const connId = getState().addConnection(src, 1, tgt, 0);
      expect(connId).toBeNull();
    });

    it('rejects incompatible types (number -> string)', () => {
      const src = getState().addNode('source');    // output 0 = number
      const tgt = getState().addNode('output');    // input 1 = string
      const connId = getState().addConnection(src, 0, tgt, 1);
      expect(connId).toBeNull();
    });

    it('allows any type to accept any source', () => {
      const src = getState().addNode('source');  // output 0 = number
      const tgt = getState().addNode('filter');  // input 0 = any
      const connId = getState().addConnection(src, 0, tgt, 0);
      expect(connId).toBeTruthy();
    });

    it('allows any type to accept string source', () => {
      const src = getState().addNode('source');  // output 1 = string
      const tgt = getState().addNode('filter');  // input 0 = any
      const connId = getState().addConnection(src, 1, tgt, 0);
      expect(connId).toBeTruthy();
    });

    it('allows any-typed output to connect to typed input', () => {
      const filt = getState().addNode('filter');    // output 0 = any
      const tgt = getState().addNode('transform');  // input 0 = number
      const connId = getState().addConnection(filt, 0, tgt, 0);
      expect(connId).toBeTruthy();
    });

    it('allows string -> string connection (source label -> output label)', () => {
      const src = getState().addNode('source');  // output 1 = string
      const tgt = getState().addNode('output');  // input 1 = string
      const connId = getState().addConnection(src, 1, tgt, 1);
      expect(connId).toBeTruthy();
    });

    it('allows chain: source -> filter -> output (any accepts all)', () => {
      const src = getState().addNode('source');
      const filt = getState().addNode('filter');
      const out = getState().addNode('output');

      const c1 = getState().addConnection(src, 0, filt, 0);
      const c2 = getState().addConnection(filt, 0, out, 0);
      expect(c1).toBeTruthy();
      expect(c2).toBeTruthy();
      expect(Object.keys(getState().connections)).toHaveLength(2);
    });
  });

  describe('getCompatiblePorts', () => {
    it('returns compatible input ports for a number output', () => {
      const src = getState().addNode('source', [0, 0, 0]);    // output 0 = number
      const xfm = getState().addNode('transform', [5, 0, 0]); // inputs: number, number
      const filt = getState().addNode('filter', [10, 0, 0]);   // input: any

      const compatible = getState().getCompatiblePorts(src, 0);
      // transform has 2 number inputs, filter has 1 any input = 3 total
      expect(compatible).toHaveLength(3);

      // Should include transform port 0 and 1
      expect(compatible).toContainEqual({ nodeId: xfm, portIndex: 0 });
      expect(compatible).toContainEqual({ nodeId: xfm, portIndex: 1 });
      // Should include filter port 0 (any)
      expect(compatible).toContainEqual({ nodeId: filt, portIndex: 0 });
    });

    it('returns compatible input ports for a string output', () => {
      const src = getState().addNode('source', [0, 0, 0]);    // output 1 = string
      const xfm = getState().addNode('transform', [5, 0, 0]); // inputs: number, number
      const out = getState().addNode('output', [10, 0, 0]);    // inputs: any, string
      const filt = getState().addNode('filter', [15, 0, 0]);   // input: any

      const compatible = getState().getCompatiblePorts(src, 1);
      // string is compatible with: output input 0 (any), output input 1 (string), filter input 0 (any)
      // NOT compatible with: transform inputs (number)
      expect(compatible).toContainEqual({ nodeId: out, portIndex: 0 }); // any
      expect(compatible).toContainEqual({ nodeId: out, portIndex: 1 }); // string
      expect(compatible).toContainEqual({ nodeId: filt, portIndex: 0 }); // any

      // Should NOT include transform ports (number != string)
      const hasTransform = compatible.some(p => p.nodeId === xfm);
      expect(hasTransform).toBe(false);
    });

    it('excludes the source node itself', () => {
      const src = getState().addNode('transform', [0, 0, 0]); // has both inputs and outputs
      const compatible = getState().getCompatiblePorts(src, 0);
      const hasSelf = compatible.some(p => p.nodeId === src);
      expect(hasSelf).toBe(false);
    });

    it('returns empty for invalid source node', () => {
      const compatible = getState().getCompatiblePorts('nonexistent', 0);
      expect(compatible).toEqual([]);
    });

    it('returns empty for invalid port index', () => {
      const src = getState().addNode('source');
      const compatible = getState().getCompatiblePorts(src, 99);
      expect(compatible).toEqual([]);
    });

    it('returns empty when no other nodes exist', () => {
      const src = getState().addNode('source');
      const compatible = getState().getCompatiblePorts(src, 0);
      expect(compatible).toEqual([]);
    });
  });

  describe('backward compatibility', () => {
    it('existing connection workflow still works with typed ports', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const tgt = getState().addNode('transform', [5, 0, 0]);

      // Start drawing from source output 0 (number)
      getState().startConnection(src, 0);
      expect(getState().interaction).toBe('drawing-connection');

      // Complete to transform input 0 (number) - compatible
      getState().completeConnection(tgt, 0);
      expect(getState().interaction).toBe('idle');
      expect(Object.keys(getState().connections)).toHaveLength(1);
    });

    it('undo/redo preserves port types', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      expect(getState().nodes[id].outputs[0].portType).toBe('number');

      getState().undo();
      expect(getState().nodes[id]).toBeUndefined();

      getState().redo();
      expect(getState().nodes[id]).toBeDefined();
      expect(getState().nodes[id].outputs[0].portType).toBe('number');
    });

    it('duplicate preserves port types from config', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().duplicateSelected();

      const duped = Object.values(getState().nodes).find(n => n.id !== id)!;
      expect(duped.outputs[0].portType).toBe('number');
      expect(duped.outputs[1].portType).toBe('string');
    });

    it('copy/paste preserves port types', () => {
      const id = getState().addNode('transform', [0, 0, 0]);
      getState().setSelection(new Set([id]));
      getState().copySelected();
      getState().paste();

      const pasted = Object.values(getState().nodes).find(n => n.id !== id)!;
      expect(pasted.inputs[0].portType).toBe('number');
      expect(pasted.outputs[1].portType).toBe('string');
    });
  });
});

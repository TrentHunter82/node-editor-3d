import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore } from '../store/editorStore';
import { topologicalSort, topologicalOrder, executeGraph as execGraph, invalidateDownstream } from '../utils/execution';
import { validateGraph as utilValidateGraph } from '../utils/validation';
import { importFromJSON, saveGraph } from '../utils/serialization';
import type { EditorNode, Connection, NodeType } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

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
  if (getState().canRedo()) {
    getState().pushUndoSnapshot();
    getState().undo();
  }
}

function getState() {
  return useEditorStore.getState();
}

// ===========================================================================
// 1. Paste → Modify → Paste Again
// ===========================================================================
describe('Paste → Modify → Paste workflow', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  it('pasted nodes are independently modifiable', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 10);
    getState().setSelection(new Set([id]));
    getState().copySelected();

    // First paste
    getState().paste();
    const pasted1 = [...getState().selectedIds][0];
    expect(getState().nodes[pasted1].data.value).toBe(10);
    getState().updateNodeData(pasted1, 'value', 20);

    // Second paste (from original clipboard, not modified)
    getState().paste();
    const pasted2 = [...getState().selectedIds][0];
    expect(getState().nodes[pasted2].data.value).toBe(10);
    expect(getState().nodes[pasted1].data.value).toBe(20);
  });
});

// ===========================================================================
// 2. Duplicate → Group → Collapse → Execute
// ===========================================================================
describe('Duplicate → Group → Collapse → Execute', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('duplicated grouped collapsed nodes execute correctly', () => {
    // Create and connect source → transform
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 5);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfm, 'multiplier', 3);
    getState().updateNodeData(xfm, 'offset', 0);
    getState().addConnection(src, 0, xfm, 0);

    // Group them
    getState().setSelection(new Set([src, xfm]));
    const groupId = getState().createGroup('Pipeline')!;
    expect(groupId).not.toBeNull();

    // Collapse source
    getState().toggleNodeCollapse(src);

    // Execute
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[xfm][0]).toBe(15); // 5 * 3
  });
});

// ===========================================================================
// 3. Complex diamond graph execution
// ===========================================================================
describe('Diamond graph execution', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('diamond: S → A, S → B, A → Out, B → Out via math', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const a = getState().addNode('transform', [3, 0, -2]);
    getState().updateNodeData(a, 'multiplier', 2);
    getState().updateNodeData(a, 'offset', 0);
    const b = getState().addNode('transform', [3, 0, 2]);
    getState().updateNodeData(b, 'multiplier', 3);
    getState().updateNodeData(b, 'offset', 0);
    const m = getState().addNode('math', [6, 0, 0]);

    getState().addConnection(src, 0, a, 0);
    getState().addConnection(src, 0, b, 0);
    getState().addConnection(a, 0, m, 0);
    getState().addConnection(b, 0, m, 1);

    getState().executeGraph();
    vi.advanceTimersByTime(5000);

    // a = 10 * 2 = 20, b = 10 * 3 = 30, math = 20 + 30 = 50 (default add)
    expect(getState().nodeOutputs[a][0]).toBe(20);
    expect(getState().nodeOutputs[b][0]).toBe(30);
    expect(getState().nodeOutputs[m][0]).toBe(50);
  });
});

// ===========================================================================
// 4. Execution cache invalidation in chain
// ===========================================================================
describe('Execution cache invalidation', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('changing upstream data invalidates downstream cache', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 5);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfm, 'multiplier', 2);
    getState().updateNodeData(xfm, 'offset', 0);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(xfm, 0, out, 0);

    // First execution
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[xfm][0]).toBe(10); // 5 * 2

    // Change source value
    getState().updateNodeData(src, 'value', 100);
    getState().resetExecution();
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[xfm][0]).toBe(200); // 100 * 2
  });
});

// ===========================================================================
// 5. topologicalSort utility edge cases
// ===========================================================================
describe('topologicalSort utility', () => {
  it('empty graph returns empty', () => {
    expect(topologicalSort({}, {})).toEqual([]);
  });

  it('single node returns one wave', () => {
    const nodes: Record<string, EditorNode> = {
      a: {
        id: 'a', type: 'source', position: [0, 0, 0], title: 'A', data: {},
        inputs: [], outputs: [{ id: 'out-0', label: 'v', portType: 'number' }],
      },
    };
    const waves = topologicalSort(nodes, {});
    expect(waves).toEqual([['a']]);
  });

  it('linear chain produces sequential waves', () => {
    const nodes: Record<string, EditorNode> = {
      a: { id: 'a', type: 'source', position: [0, 0, 0], title: 'A', data: {}, inputs: [], outputs: [{ id: 'out-0', label: 'v', portType: 'number' }] },
      b: { id: 'b', type: 'transform', position: [5, 0, 0], title: 'B', data: {}, inputs: [{ id: 'in-0', label: 'in', portType: 'number' }], outputs: [{ id: 'out-0', label: 'r', portType: 'number' }] },
      c: { id: 'c', type: 'output', position: [10, 0, 0], title: 'C', data: {}, inputs: [{ id: 'in-0', label: 'd', portType: 'any' }], outputs: [] },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'c', targetPortIndex: 0 },
    };
    const waves = topologicalSort(nodes, connections);
    expect(waves.length).toBe(3);
    expect(waves[0]).toEqual(['a']);
    expect(waves[1]).toEqual(['b']);
    expect(waves[2]).toEqual(['c']);
  });

  it('diamond graph: parallel nodes in same wave', () => {
    const nodes: Record<string, EditorNode> = {
      a: { id: 'a', type: 'source', position: [0, 0, 0], title: 'A', data: {}, inputs: [], outputs: [{ id: 'out-0', label: 'v', portType: 'number' }] },
      b: { id: 'b', type: 'transform', position: [3, 0, -2], title: 'B', data: {}, inputs: [{ id: 'in-0', label: 'in', portType: 'number' }], outputs: [{ id: 'out-0', label: 'r', portType: 'number' }] },
      c: { id: 'c', type: 'transform', position: [3, 0, 2], title: 'C', data: {}, inputs: [{ id: 'in-0', label: 'in', portType: 'number' }], outputs: [{ id: 'out-0', label: 'r', portType: 'number' }] },
      d: { id: 'd', type: 'math', position: [6, 0, 0], title: 'D', data: {}, inputs: [{ id: 'in-0', label: 'a', portType: 'number' }, { id: 'in-1', label: 'b', portType: 'number' }], outputs: [{ id: 'out-0', label: 'r', portType: 'number' }] },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'c', targetPortIndex: 0 },
      c3: { id: 'c3', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'd', targetPortIndex: 0 },
      c4: { id: 'c4', sourceNodeId: 'c', sourcePortIndex: 0, targetNodeId: 'd', targetPortIndex: 1 },
    };
    const waves = topologicalSort(nodes, connections);
    expect(waves.length).toBe(3);
    expect(waves[0]).toContain('a');
    // B and C should be in the same wave
    const wave1 = waves[1].sort();
    expect(wave1).toEqual(['b', 'c']);
    expect(waves[2]).toContain('d');
  });

  it('throws on cycle', () => {
    const nodes: Record<string, EditorNode> = {
      a: { id: 'a', type: 'transform', position: [0, 0, 0], title: 'A', data: {}, inputs: [{ id: 'in-0', label: 'in', portType: 'number' }], outputs: [{ id: 'out-0', label: 'r', portType: 'number' }] },
      b: { id: 'b', type: 'transform', position: [5, 0, 0], title: 'B', data: {}, inputs: [{ id: 'in-0', label: 'in', portType: 'number' }], outputs: [{ id: 'out-0', label: 'r', portType: 'number' }] },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'a', targetPortIndex: 0 },
    };
    expect(() => topologicalSort(nodes, connections)).toThrow('cycle');
  });

  it('disconnected subgraphs both appear', () => {
    const nodes: Record<string, EditorNode> = {
      a: { id: 'a', type: 'source', position: [0, 0, 0], title: 'A', data: {}, inputs: [], outputs: [{ id: 'out-0', label: 'v', portType: 'number' }] },
      b: { id: 'b', type: 'source', position: [10, 0, 0], title: 'B', data: {}, inputs: [], outputs: [{ id: 'out-0', label: 'v', portType: 'number' }] },
    };
    const waves = topologicalSort(nodes, {});
    // Both nodes should appear in waves
    const allNodes = waves.flat();
    expect(allNodes).toContain('a');
    expect(allNodes).toContain('b');
  });
});

// ===========================================================================
// 6. topologicalOrder utility
// ===========================================================================
describe('topologicalOrder utility', () => {
  it('returns flat order', () => {
    const nodes: Record<string, EditorNode> = {
      a: { id: 'a', type: 'source', position: [0, 0, 0], title: 'A', data: {}, inputs: [], outputs: [{ id: 'out-0', label: 'v', portType: 'number' }] },
      b: { id: 'b', type: 'transform', position: [5, 0, 0], title: 'B', data: {}, inputs: [{ id: 'in-0', label: 'in', portType: 'number' }], outputs: [{ id: 'out-0', label: 'r', portType: 'number' }] },
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
    };
    const order = topologicalOrder(nodes, connections);
    expect(order).toEqual(['a', 'b']);
  });
});

// ===========================================================================
// 7. invalidateDownstream utility
// ===========================================================================
describe('invalidateDownstream utility', () => {
  it('invalidates target and all downstream', () => {
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'c', targetPortIndex: 0 },
    };
    const cache = new Map();
    cache.set('a', { outputs: { 0: 1 }, inputHash: '{}' });
    cache.set('b', { outputs: { 0: 2 }, inputHash: '{"0":1}' });
    cache.set('c', { outputs: { 0: 3 }, inputHash: '{"0":2}' });

    invalidateDownstream('a', connections, cache);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
  });

  it('only invalidates downstream, not upstream', () => {
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'c', targetPortIndex: 0 },
    };
    const cache = new Map();
    cache.set('a', { outputs: { 0: 1 }, inputHash: '{}' });
    cache.set('b', { outputs: { 0: 2 }, inputHash: '{"0":1}' });
    cache.set('c', { outputs: { 0: 3 }, inputHash: '{"0":2}' });

    invalidateDownstream('b', connections, cache);
    expect(cache.has('a')).toBe(true); // upstream preserved
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
  });

  it('handles non-existent node gracefully', () => {
    const cache = new Map();
    expect(() => invalidateDownstream('fake', {}, cache)).not.toThrow();
  });
});

// ===========================================================================
// 8. executeGraph utility - processor coverage
// ===========================================================================
describe('executeGraph utility - processor coverage', () => {
  function makeNode(id: string, type: NodeType, data: Record<string, unknown> = {}): EditorNode {
    const config = NODE_TYPE_CONFIG[type];
    return {
      id, type, position: [0, 0, 0], title: type, data,
      inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
      outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
    };
  }

  it('filter: greater mode passes value > threshold', () => {
    const src = makeNode('src', 'source', { value: 10 });
    const flt = makeNode('flt', 'filter', { threshold: 5, mode: 'greater' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'flt', targetPortIndex: 0 },
    };
    const result = execGraph({ src, flt }, conns);
    expect(result.results.get('flt')!.outputs[0]).toBe(10);
  });

  it('filter: less mode passes value < threshold', () => {
    const src = makeNode('src', 'source', { value: 3 });
    const flt = makeNode('flt', 'filter', { threshold: 5, mode: 'less' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'flt', targetPortIndex: 0 },
    };
    const result = execGraph({ src, flt }, conns);
    expect(result.results.get('flt')!.outputs[0]).toBe(3);
  });

  it('filter: equal mode', () => {
    const src = makeNode('src', 'source', { value: 5 });
    const flt = makeNode('flt', 'filter', { threshold: 5, mode: 'equal' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'flt', targetPortIndex: 0 },
    };
    const result = execGraph({ src, flt }, conns);
    expect(result.results.get('flt')!.outputs[0]).toBe(5);
  });

  it('filter: value below threshold returns null', () => {
    const src = makeNode('src', 'source', { value: 3 });
    const flt = makeNode('flt', 'filter', { threshold: 5, mode: 'greater' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'flt', targetPortIndex: 0 },
    };
    const result = execGraph({ src, flt }, conns);
    expect(result.results.get('flt')!.outputs[0]).toBeNull();
  });

  it('math: subtract', () => {
    const a = makeNode('a', 'source', { value: 10 });
    const b = makeNode('b', 'source', { value: 3 });
    const m = makeNode('m', 'math', { operation: 'subtract' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 1 },
    };
    const result = execGraph({ a, b, m }, conns);
    expect(result.results.get('m')!.outputs[0]).toBe(7);
  });

  it('math: multiply', () => {
    const a = makeNode('a', 'source', { value: 4 });
    const b = makeNode('b', 'source', { value: 5 });
    const m = makeNode('m', 'math', { operation: 'multiply' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 1 },
    };
    const result = execGraph({ a, b, m }, conns);
    expect(result.results.get('m')!.outputs[0]).toBe(20);
  });

  it('math: divide by zero returns 0', () => {
    const a = makeNode('a', 'source', { value: 10 });
    const b = makeNode('b', 'source', { value: 0 });
    const m = makeNode('m', 'math', { operation: 'divide' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 1 },
    };
    const result = execGraph({ a, b, m }, conns);
    expect(result.results.get('m')!.outputs[0]).toBe(0);
  });

  it('math: power', () => {
    const a = makeNode('a', 'source', { value: 2 });
    const b = makeNode('b', 'source', { value: 10 });
    const m = makeNode('m', 'math', { operation: 'power' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 1 },
    };
    const result = execGraph({ a, b, m }, conns);
    expect(result.results.get('m')!.outputs[0]).toBe(1024);
  });

  it('math: modulo', () => {
    const a = makeNode('a', 'source', { value: 10 });
    const b = makeNode('b', 'source', { value: 3 });
    const m = makeNode('m', 'math', { operation: 'modulo' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 1 },
    };
    const result = execGraph({ a, b, m }, conns);
    expect(result.results.get('m')!.outputs[0]).toBe(1);
  });

  it('math: modulo by zero returns 0', () => {
    const a = makeNode('a', 'source', { value: 10 });
    const b = makeNode('b', 'source', { value: 0 });
    const m = makeNode('m', 'math', { operation: 'modulo' });
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'm', targetPortIndex: 1 },
    };
    const result = execGraph({ a, b, m }, conns);
    expect(result.results.get('m')!.outputs[0]).toBe(0);
  });

  it('clamp: clamps value within range', () => {
    const v = makeNode('v', 'source', { value: 15 });
    const mn = makeNode('mn', 'source', { value: 0 });
    const mx = makeNode('mx', 'source', { value: 10 });
    const cl = makeNode('cl', 'clamp');
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'v', sourcePortIndex: 0, targetNodeId: 'cl', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'mn', sourcePortIndex: 0, targetNodeId: 'cl', targetPortIndex: 1 },
      c3: { id: 'c3', sourceNodeId: 'mx', sourcePortIndex: 0, targetNodeId: 'cl', targetPortIndex: 2 },
    };
    const result = execGraph({ v, mn, mx, cl }, conns);
    expect(result.results.get('cl')!.outputs[0]).toBe(10);
  });

  it('remap: maps value from one range to another', () => {
    const v = makeNode('v', 'source', { value: 5 });
    const inMin = makeNode('inMin', 'source', { value: 0 });
    const inMax = makeNode('inMax', 'source', { value: 10 });
    const outMin = makeNode('outMin', 'source', { value: 0 });
    const outMax = makeNode('outMax', 'source', { value: 100 });
    const rm = makeNode('rm', 'remap');
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'v', sourcePortIndex: 0, targetNodeId: 'rm', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'inMin', sourcePortIndex: 0, targetNodeId: 'rm', targetPortIndex: 1 },
      c3: { id: 'c3', sourceNodeId: 'inMax', sourcePortIndex: 0, targetNodeId: 'rm', targetPortIndex: 2 },
      c4: { id: 'c4', sourceNodeId: 'outMin', sourcePortIndex: 0, targetNodeId: 'rm', targetPortIndex: 3 },
      c5: { id: 'c5', sourceNodeId: 'outMax', sourcePortIndex: 0, targetNodeId: 'rm', targetPortIndex: 4 },
    };
    const result = execGraph({ v, inMin, inMax, outMin, outMax, rm }, conns);
    expect(result.results.get('rm')!.outputs[0]).toBe(50);
  });

  it('concat: concatenates strings', () => {
    const a = makeNode('a', 'source', { value: 0, label: 'hello' });
    const b = makeNode('b', 'source', { value: 0, label: ' world' });
    const cat = makeNode('cat', 'concat');
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 1, targetNodeId: 'cat', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 1, targetNodeId: 'cat', targetPortIndex: 1 },
    };
    const result = execGraph({ a, b, cat }, conns);
    expect(result.results.get('cat')!.outputs[0]).toBe('hello world');
  });

  it('template: replaces {value} placeholder', () => {
    const tpl = makeNode('tpl', 'source', { value: 0, label: 'Count: {value}' });
    const val = makeNode('val', 'source', { value: 42 });
    const tmpl = makeNode('tmpl', 'template');
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'tpl', sourcePortIndex: 1, targetNodeId: 'tmpl', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'val', sourcePortIndex: 0, targetNodeId: 'tmpl', targetPortIndex: 1 },
    };
    const result = execGraph({ tpl, val, tmpl }, conns);
    expect(result.results.get('tmpl')!.outputs[0]).toBe('Count: 42');
  });

  it('compare: all comparison modes', () => {
    const a = makeNode('a', 'source', { value: 5 });
    const b = makeNode('b', 'source', { value: 3 });

    // Test each compare mode
    for (const [mode, expected] of [['>', true], ['<', false], ['==', false], ['!=', true], ['>=', true], ['<=', false]] as const) {
      const cmp = makeNode('cmp', 'compare', { mode });
      const conns: Record<string, Connection> = {
        c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'cmp', targetPortIndex: 0 },
        c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'cmp', targetPortIndex: 1 },
      };
      const result = execGraph({ a, b, cmp }, conns);
      expect(result.results.get('cmp')!.outputs[0]).toBe(expected);
    }
  });

  it('switch: selects matching case or default', () => {
    const val = makeNode('val', 'source', { value: 42 });
    const case0 = makeNode('case0', 'source', { value: 42 });
    const def = makeNode('def', 'source', { value: 99 });
    const sw = makeNode('sw', 'switch');
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'val', sourcePortIndex: 0, targetNodeId: 'sw', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'case0', sourcePortIndex: 0, targetNodeId: 'sw', targetPortIndex: 1 },
      c3: { id: 'c3', sourceNodeId: 'def', sourcePortIndex: 0, targetNodeId: 'sw', targetPortIndex: 5 },
    };
    const result = execGraph({ val, case0, def, sw }, conns);
    expect(result.results.get('sw')!.outputs[0]).toBe(42);
  });

  it('compose-vec3: assembles vector from components', () => {
    const x = makeNode('x', 'source', { value: 1 });
    const y = makeNode('y', 'source', { value: 2 });
    const z = makeNode('z', 'source', { value: 3 });
    const cv = makeNode('cv', 'compose-vec3');
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'x', sourcePortIndex: 0, targetNodeId: 'cv', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'y', sourcePortIndex: 0, targetNodeId: 'cv', targetPortIndex: 1 },
      c3: { id: 'c3', sourceNodeId: 'z', sourcePortIndex: 0, targetNodeId: 'cv', targetPortIndex: 2 },
    };
    const result = execGraph({ x, y, z, cv }, conns);
    expect(result.results.get('cv')!.outputs[0]).toEqual([1, 2, 3]);
  });

  it('decompose-vec3: splits vector into components', () => {
    const x = makeNode('x', 'source', { value: 10 });
    const y = makeNode('y', 'source', { value: 20 });
    const z = makeNode('z', 'source', { value: 30 });
    const cv = makeNode('cv', 'compose-vec3');
    const dv = makeNode('dv', 'decompose-vec3');
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'x', sourcePortIndex: 0, targetNodeId: 'cv', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 'y', sourcePortIndex: 0, targetNodeId: 'cv', targetPortIndex: 1 },
      c3: { id: 'c3', sourceNodeId: 'z', sourcePortIndex: 0, targetNodeId: 'cv', targetPortIndex: 2 },
      c4: { id: 'c4', sourceNodeId: 'cv', sourcePortIndex: 0, targetNodeId: 'dv', targetPortIndex: 0 },
    };
    const result = execGraph({ x, y, z, cv, dv }, conns);
    expect(result.results.get('dv')!.outputs[0]).toBe(10);
    expect(result.results.get('dv')!.outputs[1]).toBe(20);
    expect(result.results.get('dv')!.outputs[2]).toBe(30);
  });

  it('reroute: passes value through', () => {
    const src = makeNode('src', 'source', { value: 42 });
    const rr = makeNode('rr', 'reroute');
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'rr', targetPortIndex: 0 },
    };
    const result = execGraph({ src, rr }, conns);
    expect(result.results.get('rr')!.outputs[0]).toBe(42);
  });

  it('random: produces number in range', () => {
    const rnd = makeNode('rnd', 'random', { min: 10, max: 20, seed: 42 });
    const result = execGraph({ rnd }, {});
    const value = result.results.get('rnd')!.outputs[0] as number;
    expect(value).toBeGreaterThanOrEqual(10);
    expect(value).toBeLessThanOrEqual(20);
  });

  it('random: seeded random is deterministic', () => {
    const rnd1 = makeNode('rnd1', 'random', { min: 0, max: 1, seed: 42 });
    const result1 = execGraph({ rnd1 }, {});
    const rnd2 = makeNode('rnd2', 'random', { min: 0, max: 1, seed: 42 });
    const result2 = execGraph({ rnd2 }, {});
    // Same seed should produce same value
    expect(result1.results.get('rnd1')!.outputs[0]).toBe(result2.results.get('rnd2')!.outputs[0]);
  });

  it('custom: basic expression', () => {
    const src = makeNode('src', 'source', { value: 5 });
    const custom: EditorNode = {
      id: 'custom', type: 'custom', position: [5, 0, 0], title: 'Custom',
      data: { expression: 'in0 * 3', inputCount: 1, outputCount: 1 },
      inputs: [{ id: 'in-0', label: 'in0', portType: 'number' }],
      outputs: [{ id: 'out-0', label: 'out0', portType: 'number' }],
    };
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'custom', targetPortIndex: 0 },
    };
    const result = execGraph({ src, custom }, conns);
    expect(result.results.get('custom')!.outputs[0]).toBe(15);
  });

  it('custom: multi-output with array result', () => {
    const src = makeNode('src', 'source', { value: 10 });
    const custom: EditorNode = {
      id: 'custom', type: 'custom', position: [5, 0, 0], title: 'Multi',
      data: { expression: '[in0, in0 * 2, in0 * 3]', inputCount: 1, outputCount: 3 },
      inputs: [{ id: 'in-0', label: 'in0', portType: 'number' }],
      outputs: [
        { id: 'out-0', label: 'out0', portType: 'number' },
        { id: 'out-1', label: 'out1', portType: 'number' },
        { id: 'out-2', label: 'out2', portType: 'number' },
      ],
    };
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'custom', targetPortIndex: 0 },
    };
    const result = execGraph({ src, custom }, conns);
    expect(result.results.get('custom')!.outputs[0]).toBe(10);
    expect(result.results.get('custom')!.outputs[1]).toBe(20);
    expect(result.results.get('custom')!.outputs[2]).toBe(30);
  });

  it('custom: bad expression records error', () => {
    const custom: EditorNode = {
      id: 'custom', type: 'custom', position: [0, 0, 0], title: 'Bad',
      data: { expression: '{{invalid}}', inputCount: 0, outputCount: 1 },
      inputs: [],
      outputs: [{ id: 'out-0', label: 'out0', portType: 'number' }],
    };
    const result = execGraph({ custom }, {});
    expect(result.errors.has('custom')).toBe(true);
  });

  it('custom: uses inputs record syntax', () => {
    const src = makeNode('src', 'source', { value: 7 });
    const custom: EditorNode = {
      id: 'custom', type: 'custom', position: [5, 0, 0], title: 'Custom',
      data: { expression: 'inputs[0] + 1', inputCount: 1, outputCount: 1 },
      inputs: [{ id: 'in-0', label: 'in0', portType: 'number' }],
      outputs: [{ id: 'out-0', label: 'out0', portType: 'number' }],
    };
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'custom', targetPortIndex: 0 },
    };
    const result = execGraph({ src, custom }, conns);
    expect(result.results.get('custom')!.outputs[0]).toBe(8);
  });

  it('custom: uses Math functions', () => {
    const src = makeNode('src', 'source', { value: 9 });
    const custom: EditorNode = {
      id: 'custom', type: 'custom', position: [5, 0, 0], title: 'Custom',
      data: { expression: 'Math.sqrt(in0)', inputCount: 1, outputCount: 1 },
      inputs: [{ id: 'in-0', label: 'in0', portType: 'number' }],
      outputs: [{ id: 'out-0', label: 'out0', portType: 'number' }],
    };
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'custom', targetPortIndex: 0 },
    };
    const result = execGraph({ src, custom }, conns);
    expect(result.results.get('custom')!.outputs[0]).toBe(3);
  });

  it('source: uses default values when data is empty', () => {
    const src = makeNode('src', 'source');
    const result = execGraph({ src }, {});
    expect(result.results.get('src')!.outputs[0]).toBe(0);
    // Default label is node.title, which makeNode sets to the type string
    expect(result.results.get('src')!.outputs[1]).toBe('source');
  });

  it('note: produces no outputs', () => {
    const note = makeNode('note', 'note');
    const result = execGraph({ note }, {});
    expect(result.results.get('note')!.outputs).toEqual({});
  });

  it('display: produces no outputs', () => {
    const disp = makeNode('disp', 'display');
    const result = execGraph({ disp }, {});
    expect(result.results.get('disp')!.outputs).toEqual({});
  });
});

// ===========================================================================
// 9. importFromJSON edge cases
// ===========================================================================
describe('importFromJSON edge cases', () => {
  it('rejects non-object data', () => {
    expect(importFromJSON('"just a string"')).toBeNull();
    expect(importFromJSON('123')).toBeNull();
    expect(importFromJSON('true')).toBeNull();
    expect(importFromJSON('null')).toBeNull();
  });

  it('rejects arrays', () => {
    expect(importFromJSON('[1,2,3]')).toBeNull();
  });

  it('rejects when nodes is array', () => {
    expect(importFromJSON('{"nodes":[],"connections":{}}')).toBeNull();
  });

  it('rejects when connections is array', () => {
    expect(importFromJSON('{"nodes":{},"connections":[]}')).toBeNull();
  });

  it('rejects when groups is array', () => {
    expect(importFromJSON('{"nodes":{},"connections":{},"groups":[]}')).toBeNull();
  });

  it('rejects when customNodeDefs is array', () => {
    expect(importFromJSON('{"nodes":{},"connections":{},"customNodeDefs":[]}')).toBeNull();
  });

  it('accepts valid data with optional fields', () => {
    const data = importFromJSON('{"nodes":{},"connections":{},"groups":{},"customNodeDefs":{}}');
    expect(data).not.toBeNull();
    expect(data!.nodes).toEqual({});
  });

  it('accepts valid data without optional fields', () => {
    const data = importFromJSON('{"nodes":{},"connections":{}}');
    expect(data).not.toBeNull();
  });
});

// ===========================================================================
// 10. Validation utility edge cases
// ===========================================================================
describe('validateGraph utility edge cases', () => {
  it('empty graph returns no issues', () => {
    expect(utilValidateGraph({}, {}).length).toBe(0);
  });

  it('source-only graph has no disconnected-input issues', () => {
    const src: EditorNode = {
      id: 's', type: 'source', position: [0, 0, 0], title: 'S', data: {},
      inputs: [], outputs: [{ id: 'out-0', label: 'v', portType: 'number' }],
    };
    const issues = utilValidateGraph({ s: src }, {});
    expect(issues.filter(i => i.type === 'disconnected-input').length).toBe(0);
    // Isolated source gets a no-connections warning
    expect(issues.some(i => i.type === 'no-connections')).toBe(true);
  });

  it('note node is skipped', () => {
    const note: EditorNode = {
      id: 'n', type: 'note', position: [0, 0, 0], title: 'N', data: {},
      inputs: [], outputs: [],
    };
    expect(utilValidateGraph({ n: note }, {}).length).toBe(0);
  });

  it('reports each disconnected input separately', () => {
    const xfm: EditorNode = {
      id: 't', type: 'transform', position: [0, 0, 0], title: 'T', data: {},
      inputs: [
        { id: 'in-0', label: 'in', portType: 'number' },
        { id: 'in-1', label: 'factor', portType: 'number' },
      ],
      outputs: [{ id: 'out-0', label: 'r', portType: 'number' }],
    };
    const issues = utilValidateGraph({ t: xfm }, {});
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    expect(disconnected.length).toBe(2);
    expect(disconnected[0].portIndex).toBe(0);
    expect(disconnected[1].portIndex).toBe(1);
  });

  it('connected input is not flagged', () => {
    const src: EditorNode = {
      id: 's', type: 'source', position: [0, 0, 0], title: 'S', data: {},
      inputs: [], outputs: [{ id: 'out-0', label: 'v', portType: 'number' }],
    };
    const xfm: EditorNode = {
      id: 't', type: 'transform', position: [5, 0, 0], title: 'T', data: {},
      inputs: [
        { id: 'in-0', label: 'in', portType: 'number' },
        { id: 'in-1', label: 'factor', portType: 'number' },
      ],
      outputs: [{ id: 'out-0', label: 'r', portType: 'number' }],
    };
    const conns: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 's', sourcePortIndex: 0, targetNodeId: 't', targetPortIndex: 0 },
    };
    const issues = utilValidateGraph({ s: src, t: xfm }, conns);
    // Only input[1] should be flagged as disconnected-input
    const transformDisconnected = issues.filter(i => i.nodeId === 't' && i.type === 'disconnected-input');
    expect(transformDisconnected.length).toBe(1);
    expect(transformDisconnected[0].portIndex).toBe(1);
  });
});

// ===========================================================================
// 11. Undo during active execution
// ===========================================================================
describe('Undo during active execution', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('undo during execution stops execution', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    getState().executeGraph();
    vi.advanceTimersByTime(100);
    expect(getState().isExecuting).toBe(true);

    // Undo should stop execution
    getState().undo();
    expect(getState().isExecuting).toBe(false);
    expect(getState().executionStates).toEqual({});

    // Advance past all timeouts - should stay false
    vi.advanceTimersByTime(10000);
    expect(getState().isExecuting).toBe(false);
  });
});

// ===========================================================================
// 12. Large graph construction and execution
// ===========================================================================
describe('Large graph construction', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('builds and executes a 20-node chain', () => {
    let prevId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(prevId, 'value', 1);

    for (let i = 1; i < 20; i++) {
      const nodeId = getState().addNode('transform', [i * 3, 0, 0]);
      getState().updateNodeData(nodeId, 'multiplier', 1);
      getState().updateNodeData(nodeId, 'offset', 1);
      getState().addConnection(prevId, 0, nodeId, 0);
      prevId = nodeId;
    }

    expect(Object.keys(getState().nodes).length).toBe(20);
    expect(Object.keys(getState().connections).length).toBe(19);

    getState().executeGraph();
    vi.advanceTimersByTime(30000);
    expect(getState().isExecuting).toBe(false);

    // Each transform: value * 1 + 1 = value + 1
    // Starting from 1, after 19 transforms: 1 + 19 = 20
    expect(getState().nodeOutputs[prevId][0]).toBe(20);
  });
});

// ===========================================================================
// 13. Search → Focus → Execute workflow
// ===========================================================================
describe('Search → Focus → Execute workflow', () => {
  beforeEach(() => { vi.useFakeTimers(); drainUndoRedo(); resetStore(); });
  afterEach(() => { vi.useRealTimers(); });

  it('search, focus, then execute produces correct results', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 7);
    getState().updateNodeTitle(src, 'DataProvider');
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().updateNodeData(xfm, 'multiplier', 3);
    getState().updateNodeData(xfm, 'offset', 0);
    getState().addConnection(src, 0, xfm, 0);

    // Search for the source node
    const results = getState().searchNodes('DataProvider');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe(src);

    // Focus it
    getState().focusNode(src);
    expect(getState().selectedIds.has(src)).toBe(true);

    // Execute
    getState().executeGraph();
    vi.advanceTimersByTime(5000);
    expect(getState().nodeOutputs[xfm][0]).toBe(21);
  });
});

// ===========================================================================
// 14. All node types can be created
// ===========================================================================
describe('All node types can be created', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  const nodeTypes: NodeType[] = [
    'source', 'transform', 'filter', 'output',
    'math', 'clamp', 'remap',
    'concat', 'template',
    'compare', 'switch',
    'compose-vec3', 'decompose-vec3',
    'note', 'reroute', 'random', 'display',
  ];

  for (const type of nodeTypes) {
    it(`creates ${type} node with correct port counts`, () => {
      resetStore();
      const id = getState().addNode(type, [0, 0, 0]);
      const node = getState().nodes[id];
      const config = NODE_TYPE_CONFIG[type];
      expect(node.type).toBe(type);
      expect(node.inputs.length).toBe(config.inputs.length);
      expect(node.outputs.length).toBe(config.outputs.length);
    });
  }
});

// ===========================================================================
// 15. Save → Clear → Load roundtrip with full state
// ===========================================================================
describe('Save → Clear → Load roundtrip', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); localStorage.clear(); });

  it('preserves nodes, connections, groups, and customNodeDefs', () => {
    // Build a rich graph
    const defId = getState().addCustomNodeDef({
      name: 'MyNode', color: 'blue', category: 'Math',
      inputs: [{ label: 'in0', portType: 'number' }],
      outputs: [{ label: 'out0', portType: 'number' }],
      expression: 'in0 + 1',
    });
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    const custom = getState().addCustomNode(defId, [5, 0, 0])!;
    getState().addConnection(src, 0, custom, 0);

    const src2 = getState().addNode('source', [0, 0, 5]);
    getState().setSelection(new Set([src, src2]));
    const groupId = getState().createGroup('MyGroup')!;

    // Save
    saveGraph(getState().nodes, getState().connections, getState().groups, getState().customNodeDefs);

    // Clear and reload
    resetStore();
    expect(Object.keys(getState().nodes).length).toBe(0);
    expect(getState().loadFromStorage()).toBe(true);

    // Verify
    expect(Object.keys(getState().nodes).length).toBe(3);
    expect(Object.keys(getState().connections).length).toBe(1);
    expect(getState().groups[groupId]).toBeDefined();
    expect(getState().groups[groupId].label).toBe('MyGroup');
    expect(getState().customNodeDefs[defId]).toBeDefined();
    expect(getState().customNodeDefs[defId].name).toBe('MyNode');
    expect(getState().nodes[src].data.value).toBe(42);
  });
});

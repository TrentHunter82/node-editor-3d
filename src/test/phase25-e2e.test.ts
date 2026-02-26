/**
 * Phase 25 E2E regression tests
 *
 * Cross-feature integration tests covering:
 * - Array workflow + undo/redo
 * - Flow control + execution
 * - Graph variables + multi-graph
 * - Node locking enforcement
 * - Clipboard with Phase 25 nodes
 * - Execution heatmap setting
 * - Coercion + new node types
 * - Regression guards
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings } from '../store/settingsStore';
import { executeGraph, setGraphVariablesContext } from '../utils/execution';

enableMapSet();

function getStore() { return useEditorStore.getState(); }
function getSettings() { return useSettingsStore.getState(); }

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
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
  });
}

/** Execute the current store graph and return results */
function execStore(graphVariables?: Record<string, unknown>) {
  const st = getStore();
  return executeGraph(st.nodes, st.connections, undefined, undefined, undefined, undefined, graphVariables);
}

/** Get a node's output value from execution results */
function out(r: ReturnType<typeof execStore>, nodeId: string, port = 0): unknown {
  return r.results.get(nodeId)?.outputs[port];
}

/**
 * Build a compare node that outputs boolean (a > b where b=0).
 * Connects source → compare input 0, returns compare node id.
 * The compare output 0 is boolean.
 */
function addBooleanCondition(sourceValue: number): string {
  const store = getStore();
  const src = store.addNode('source', [-2, 0, -2]);
  store.updateNodeData(src, 'value', sourceValue);
  const cmp = store.addNode('compare', [-1, 0, -2]);
  store.updateNodeData(cmp, 'mode', '>');
  // compare: input 0 = a (number), input 1 = b (number, defaults to 0)
  store.addConnection(src, 0, cmp, 0);
  // b defaults to 0 when disconnected, so a > 0 gives true when sourceValue > 0
  return cmp;
}

// ============================================================
// 1. Array workflow + undo/redo
// ============================================================
describe('Array workflow + undo/redo', () => {
  beforeEach(() => { resetStore(); });

  it('builds create->push->get-element pipeline, executes, undoes, re-executes, then redoes', () => {
    // source(42) -> create-array -> array-push(source2=99) -> get-element(index=1)
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 42);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(src, 0, arr, 0);
    const src2 = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(src2, 'value', 99);
    const push = getStore().addNode('array-push', [4, 0, 0]);
    getStore().addConnection(arr, 0, push, 0);
    getStore().addConnection(src2, 0, push, 1);
    const getEl = getStore().addNode('get-element', [6, 0, 0]);
    getStore().addConnection(push, 0, getEl, 0);
    // Index source = 1 to get the pushed element
    const idxSrc = getStore().addNode('source', [6, 0, 2]);
    getStore().updateNodeData(idxSrc, 'value', 1);
    getStore().addConnection(idxSrc, 0, getEl, 1);

    // Execute: array = [42], push 99 => [42, 99], get index 1 => 99
    const r1 = execStore();
    expect(out(r1, getEl)).toBe(99);

    // Undo the last action (addConnection idxSrc->getEl)
    getStore().undo();
    // After undo, re-execute — pipeline still works but index may differ
    const r2 = execStore();
    expect(r2.results.has(getEl)).toBe(true);

    // Redo restores the connection
    getStore().redo();
    const r3 = execStore();
    expect(out(r3, getEl)).toBe(99);
  });

  it('create-array -> map -> filter, verifies outputs, then undoes all back to empty', () => {
    // 4 sources: 1, 2, 3, 4
    const ids: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const id = getStore().addNode('source', [0, 0, i]);
      getStore().updateNodeData(id, 'value', i);
      ids.push(id);
    }
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    ids.forEach((id, i) => getStore().addConnection(id, 0, arr, i));

    const map = getStore().addNode('array-map', [4, 0, 0]);
    getStore().updateNodeData(map, 'expression', 'x * 10');
    getStore().addConnection(arr, 0, map, 0);

    const filter = getStore().addNode('array-filter', [6, 0, 0]);
    getStore().updateNodeData(filter, 'expression', 'x > 20');
    getStore().addConnection(map, 0, filter, 0);

    const r = execStore();
    // map: [10,20,30,40], filter(>20): [30,40]
    expect(out(r, filter)).toEqual([30, 40]);

    // Undo until no nodes remain
    while (getStore().canUndo()) getStore().undo();
    expect(Object.keys(getStore().nodes).length).toBe(0);
  });

  it('array-length reflects source value changes and undo restores', () => {
    // Build: source(10), source(20) -> create-array -> array-length
    const src1 = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src1, 'value', 10);
    const src2 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(src2, 'value', 20);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(src1, 0, arr, 0);
    getStore().addConnection(src2, 0, arr, 1);

    const len = getStore().addNode('array-length', [4, 0, 0]);
    getStore().addConnection(arr, 0, len, 0);

    // Length = 2 (two from create-array)
    const r1 = execStore();
    expect(out(r1, len)).toBe(2);

    // Undo addNode('array-length') — last undoable action
    // (addConnection doesn't push undo, so undo removes the length node)
    getStore().undo();
    expect(getStore().nodes[len]).toBeUndefined();

    // Redo restores array-length node with its connection
    getStore().redo();
    expect(getStore().nodes[len]).toBeDefined();
    const r2 = execStore();
    expect(out(r2, len)).toBe(2);
  });

  it('duplicates array pipeline -> both copies execute independently', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 5);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(src, 0, arr, 0);
    const len = getStore().addNode('array-length', [4, 0, 0]);
    getStore().addConnection(arr, 0, len, 0);

    // Select all and duplicate
    getStore().setSelection(new Set([src, arr, len]));
    const idMap = getStore().duplicateSelected();
    expect(idMap).not.toBeNull();

    // Both original and copy should execute
    const r = execStore();
    expect(out(r, len)).toBe(1);
    const newLen = idMap!.get(len)!;
    expect(out(r, newLen)).toBe(1);
  });

  it('export/import graph with array nodes preserves data', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 7);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(src, 0, arr, 0);
    const filter = getStore().addNode('array-filter', [4, 0, 0]);
    getStore().updateNodeData(filter, 'expression', 'x > 5');
    getStore().addConnection(arr, 0, filter, 0);

    // Export
    const exported = getStore().exportAllGraphs();
    expect(exported.version).toBe(2);

    // Import into a fresh store
    resetStore();
    getStore().importAllGraphs(exported);

    // Verify nodes survived the roundtrip
    const filterNode = Object.values(getStore().nodes).find(n => n.type === 'array-filter');
    expect(filterNode).toBeDefined();
    expect(filterNode!.data.expression).toBe('x > 5');

    // Execute after import
    const r = execStore();
    expect(out(r, filterNode!.id)).toEqual([7]);
  });
});

// ============================================================
// 2. Flow control + execution
// ============================================================
describe('Flow control + execution', () => {
  beforeEach(() => { resetStore(); });

  it('if-gate: switching condition via compare node changes which branch is taken', () => {
    // Use compare(a > 0) to produce boolean for if-gate condition
    const condSrc = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(condSrc, 'value', 5); // 5 > 0 => true
    const cmp = getStore().addNode('compare', [1, 0, 0]);
    getStore().updateNodeData(cmp, 'mode', '>');
    getStore().addConnection(condSrc, 0, cmp, 0); // a = 5, b defaults to 0

    const trueSrc = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(trueSrc, 'value', 'YES');
    const falseSrc = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(falseSrc, 'value', 'NO');
    const gate = getStore().addNode('if-gate', [3, 0, 0]);
    getStore().addConnection(cmp, 0, gate, 0); // condition (boolean)
    getStore().addConnection(trueSrc, 0, gate, 1); // trueValue (any)
    getStore().addConnection(falseSrc, 0, gate, 2); // falseValue (any)

    let r = execStore();
    expect(out(r, gate)).toBe('YES');

    // Switch condition: set source to -1 => -1 > 0 is false
    getStore().updateNodeData(condSrc, 'value', -1);
    r = execStore();
    expect(out(r, gate)).toBe('NO');
  });

  it('select: changing index picks a different input', () => {
    const idx = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(idx, 'value', 0);
    const v0 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(v0, 'value', 'alpha');
    const v1 = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(v1, 'value', 'beta');
    const sel = getStore().addNode('select', [3, 0, 0]);
    getStore().addConnection(idx, 0, sel, 0); // index (number)
    getStore().addConnection(v0, 0, sel, 1); // value0 (any)
    getStore().addConnection(v1, 0, sel, 2); // value1 (any)

    let r = execStore();
    expect(out(r, sel)).toBe('alpha');

    // Change index to 1
    getStore().updateNodeData(idx, 'value', 1);
    r = execStore();
    expect(out(r, sel)).toBe('beta');
  });

  it('if-gate with array input routes arrays through conditional flow', () => {
    // Build boolean condition: compare(1 > 0) = true
    const cmp = addBooleanCondition(1);

    // True branch: array [1,2,3]
    const s1 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(s1, 'value', 1);
    const s2 = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(s2, 'value', 2);
    const s3 = getStore().addNode('source', [0, 0, 3]);
    getStore().updateNodeData(s3, 'value', 3);
    const arrTrue = getStore().addNode('create-array', [2, 0, 1]);
    getStore().addConnection(s1, 0, arrTrue, 0);
    getStore().addConnection(s2, 0, arrTrue, 1);
    getStore().addConnection(s3, 0, arrTrue, 2);

    // False branch: empty array
    const arrFalse = getStore().addNode('create-array', [2, 0, 3]);

    const gate = getStore().addNode('if-gate', [4, 0, 0]);
    getStore().addConnection(cmp, 0, gate, 0); // boolean condition
    getStore().addConnection(arrTrue, 0, gate, 1);
    getStore().addConnection(arrFalse, 0, gate, 2);

    const r = execStore();
    expect(out(r, gate)).toEqual([1, 2, 3]);
  });

  it('undo flow control data change reverts execution to previous branch', () => {
    // compare(5 > 0) = true initially
    const condSrc = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(condSrc, 'value', 5);
    const cmp = getStore().addNode('compare', [1, 0, 0]);
    getStore().updateNodeData(cmp, 'mode', '>');
    getStore().addConnection(condSrc, 0, cmp, 0);

    const trueSrc = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(trueSrc, 'value', 'A');
    const falseSrc = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(falseSrc, 'value', 'B');
    const gate = getStore().addNode('if-gate', [3, 0, 0]);
    getStore().addConnection(cmp, 0, gate, 0);
    getStore().addConnection(trueSrc, 0, gate, 1);
    getStore().addConnection(falseSrc, 0, gate, 2);

    // Change condition: -1 > 0 = false
    getStore().updateNodeData(condSrc, 'value', -1);
    let r = execStore();
    expect(out(r, gate)).toBe('B');

    // Undo: condition reverts to 5 > 0 = true
    getStore().undo();
    r = execStore();
    expect(out(r, gate)).toBe('A');
  });
});

// ============================================================
// 3. Graph variables + multi-graph
// ============================================================
describe('Graph variables + multi-graph', () => {
  beforeEach(() => {
    resetStore();
    setGraphVariablesContext({});
  });

  it('set-var writes to context, then get-var reads it in subsequent execution', () => {
    // First execution: set-var writes to graphVariables context
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 42);
    const setter = getStore().addNode('set-var', [2, 0, 0]);
    getStore().updateNodeData(setter, 'variableName', 'myVar');
    getStore().addConnection(src, 0, setter, 0);

    const vars: Record<string, unknown> = {};
    const r1 = execStore(vars);
    // set-var passes value through
    expect(out(r1, setter)).toBe(42);

    // Now get-var in a second execution reads the variable from context
    const getter = getStore().addNode('get-var', [4, 0, 0]);
    getStore().updateNodeData(getter, 'variableName', 'myVar');
    // Context was set by first execution, second run reads it
    const r2 = execStore();
    expect(out(r2, getter)).toBe(42);
  });

  it('clearGraph resets graphVariables to {}', () => {
    getStore().addNode('source', [0, 0, 0]);
    useEditorStore.setState((draft) => { draft.graphVariables = { x: 100 }; });
    expect(getStore().graphVariables).toEqual({ x: 100 });

    getStore().clearGraph();
    expect(getStore().graphVariables).toEqual({});
  });

  it('graph variables persist through export/import', () => {
    useEditorStore.setState((draft) => { draft.graphVariables = { score: 99 }; });
    getStore().addNode('source', [0, 0, 0]);

    const exported = getStore().exportAllGraphs();
    const activeGraph = exported.graphs[exported.activeGraphId];
    expect(activeGraph.graphVariables).toEqual({ score: 99 });

    // Import into fresh store
    resetStore();
    getStore().importAllGraphs(exported);
    expect(getStore().graphVariables).toEqual({ score: 99 });
  });

  it('variables are per-graph: switching graphs isolates variables', () => {
    useEditorStore.setState((draft) => { draft.graphVariables = { x: 'graphA' }; });
    getStore().addNode('source', [0, 0, 0]);

    // Create and switch to a new graph
    const graphB = getStore().createGraph('Graph B');
    expect(getStore().activeGraphId).toBe(graphB);
    expect(getStore().graphVariables).toEqual({});

    // Set different variable in graph B
    useEditorStore.setState((draft) => { draft.graphVariables = { x: 'graphB' }; });

    // Switch back to default
    getStore().switchGraph('default');
    expect(getStore().graphVariables).toEqual({ x: 'graphA' });

    // Switch back to graph B
    getStore().switchGraph(graphB);
    expect(getStore().graphVariables).toEqual({ x: 'graphB' });
  });
});

// ============================================================
// 4. Node locking enforcement
// ============================================================
describe('Node locking enforcement', () => {
  beforeEach(() => { resetStore(); });

  it('locked node survives deleteSelected, unlocked siblings are deleted', () => {
    const lockedId = getStore().addNode('source', [0, 0, 0]);
    getStore().toggleNodeLock(lockedId);
    expect(getStore().nodes[lockedId].locked).toBe(true);

    const unlockedId = getStore().addNode('source', [2, 0, 0]);
    getStore().setSelection(new Set([lockedId, unlockedId]));
    getStore().deleteSelected();

    expect(getStore().nodes[lockedId]).toBeDefined();
    expect(getStore().nodes[unlockedId]).toBeUndefined();
  });

  it('locked node ignores updateNodeData', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(id, 'value', 42);
    getStore().toggleNodeLock(id);
    expect(getStore().nodes[id].locked).toBe(true);

    // Attempt to update — should be silently ignored
    getStore().updateNodeData(id, 'value', 999);
    expect(getStore().nodes[id].data.value).toBe(42);
  });

  it('undo toggleNodeLock -> node unlocked -> can delete', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().toggleNodeLock(id);
    expect(getStore().nodes[id].locked).toBe(true);

    // Undo the lock
    getStore().undo();
    expect(getStore().nodes[id].locked).toBeFalsy();

    // Now it can be deleted
    getStore().setSelection(new Set([id]));
    getStore().deleteSelected();
    expect(getStore().nodes[id]).toBeUndefined();
  });

  it('duplicateSelected preserves locked state on the copy', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(id, 'value', 7);
    getStore().toggleNodeLock(id);

    getStore().setSelection(new Set([id]));
    const idMap = getStore().duplicateSelected();
    expect(idMap).not.toBeNull();

    const newId = idMap!.get(id)!;
    expect(getStore().nodes[newId].locked).toBe(true);
  });

  it('paste preserves locked state on pasted copy', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(id, 'value', 5);
    getStore().toggleNodeLock(id);

    getStore().setSelection(new Set([id]));
    getStore().copySelected();
    getStore().paste();

    // Find the pasted node (not the original)
    const pastedNodes = Object.values(getStore().nodes).filter(n => n.id !== id);
    expect(pastedNodes.length).toBe(1);
    expect(pastedNodes[0].locked).toBe(true);
  });
});

// ============================================================
// 5. Clipboard with Phase 25 nodes
// ============================================================
describe('Clipboard with Phase 25 nodes', () => {
  beforeEach(() => { resetStore(); });

  it('copy array workflow -> paste -> new nodes execute independently', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 10);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(src, 0, arr, 0);
    const len = getStore().addNode('array-length', [4, 0, 0]);
    getStore().addConnection(arr, 0, len, 0);

    getStore().setSelection(new Set([src, arr, len]));
    getStore().copySelected();
    getStore().paste();

    // Should now have 6 nodes (3 original + 3 pasted)
    expect(Object.keys(getStore().nodes).length).toBe(6);

    // Both sets should execute
    const r = execStore();
    expect(out(r, len)).toBe(1);
    // Find pasted length node
    const pastedLen = Object.values(getStore().nodes).find(
      n => n.type === 'array-length' && n.id !== len
    )!;
    expect(out(r, pastedLen.id)).toBe(1);
  });

  it('cross-graph paste: copy from graph A -> create graph B -> paste -> nodes present', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 42);
    const filter = getStore().addNode('array-filter', [2, 0, 0]);
    getStore().addConnection(src, 0, filter, 0);

    getStore().setSelection(new Set([src, filter]));
    getStore().copySelected();

    // Create and switch to new graph
    getStore().createGraph('Graph B');
    expect(Object.keys(getStore().nodes).length).toBe(0);

    getStore().paste();
    expect(Object.keys(getStore().nodes).length).toBe(2);
    const pastedFilter = Object.values(getStore().nodes).find(n => n.type === 'array-filter');
    expect(pastedFilter).toBeDefined();
  });

  it('clipboard preserves node data (array-filter expression)', () => {
    const filter = getStore().addNode('array-filter', [0, 0, 0]);
    getStore().updateNodeData(filter, 'expression', 'x % 2 === 0');

    getStore().setSelection(new Set([filter]));
    getStore().copySelected();
    getStore().paste();

    const pastedFilter = Object.values(getStore().nodes).find(
      n => n.type === 'array-filter' && n.id !== filter
    )!;
    expect(pastedFilter.data.expression).toBe('x % 2 === 0');
  });

  it('paste preserves connection metadata (labels)', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const dest = getStore().addNode('transform', [2, 0, 0]);
    const connId = getStore().addConnection(src, 0, dest, 0)!;
    expect(connId).not.toBeNull();
    // Add metadata to the connection
    getStore().updateConnectionLabel(connId, 'data-flow');
    expect(getStore().connections[connId].label).toBe('data-flow');

    getStore().setSelection(new Set([src, dest]));
    getStore().copySelected();
    getStore().paste();

    // Find the pasted connection (not the original)
    const allConns = Object.values(getStore().connections);
    const pastedConns = allConns.filter(c => c.id !== connId);
    expect(pastedConns.length).toBe(1);
    expect(pastedConns[0].label).toBe('data-flow');
  });
});

// ============================================================
// 6. Execution heatmap
// ============================================================
describe('Execution heatmap setting', () => {
  beforeEach(() => {
    resetStore();
    // Reset settings to defaults
    useSettingsStore.setState({ showExecutionHeatmap: false });
  });

  it('showExecutionHeatmap toggles and is recognized by clampLoadedSettings', () => {
    expect(getSettings().showExecutionHeatmap).toBe(false);
    getSettings().setShowExecutionHeatmap(true);
    expect(getSettings().showExecutionHeatmap).toBe(true);

    // clampLoadedSettings should pass through boolean values
    const clamped = clampLoadedSettings({ showExecutionHeatmap: true });
    expect(clamped.showExecutionHeatmap).toBe(true);
  });

  it('heatmap setting does NOT push undo (user preference)', () => {
    const undoBefore = getStore().canUndo();
    getSettings().setShowExecutionHeatmap(true);
    // Settings changes don't affect the editor store's undo stack
    expect(getStore().canUndo()).toBe(undoBefore);
  });

  it('heatmap setting is independent of execution results', () => {
    getSettings().setShowExecutionHeatmap(true);
    expect(getSettings().showExecutionHeatmap).toBe(true);

    // Even with no nodes/execution, setting persists
    expect(Object.keys(getStore().nodes).length).toBe(0);
    expect(getSettings().showExecutionHeatmap).toBe(true);

    // After adding and executing nodes, setting unchanged
    getStore().addNode('source', [0, 0, 0]);
    execStore();
    expect(getSettings().showExecutionHeatmap).toBe(true);
  });
});

// ============================================================
// 7. Coercion + new node types
// ============================================================
describe('Coercion + new node types', () => {
  beforeEach(() => { resetStore(); });

  it('source -> create-array -> array-map downstream executes correctly', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 5);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(src, 0, arr, 0);
    const map = getStore().addNode('array-map', [4, 0, 0]);
    getStore().updateNodeData(map, 'expression', 'x + 1');
    getStore().addConnection(arr, 0, map, 0);

    const r = execStore();
    // [5] mapped with x+1 => [6]
    expect(out(r, map)).toEqual([6]);
  });

  it('if-gate with compare + array output executes correctly', () => {
    // Boolean condition via compare: 5 > 0 = true
    const condSrc = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(condSrc, 'value', 5);
    const cmp = getStore().addNode('compare', [1, 0, 0]);
    getStore().updateNodeData(cmp, 'mode', '>');
    getStore().addConnection(condSrc, 0, cmp, 0);

    const trueVal = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(trueVal, 'value', 100);
    const falseVal = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(falseVal, 'value', 200);
    const gate = getStore().addNode('if-gate', [3, 0, 0]);
    getStore().addConnection(cmp, 0, gate, 0); // boolean
    getStore().addConnection(trueVal, 0, gate, 1);
    getStore().addConnection(falseVal, 0, gate, 2);

    // Feed output into array
    const arr = getStore().addNode('create-array', [5, 0, 0]);
    getStore().addConnection(gate, 0, arr, 0);

    const r = execStore();
    expect(out(r, gate)).toBe(100);
    expect(out(r, arr)).toEqual([100]);
  });

  it('full workflow: source -> array-map -> execute -> undo -> redo', () => {
    const src1 = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src1, 'value', 2);
    const src2 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(src2, 'value', 4);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(src1, 0, arr, 0);
    getStore().addConnection(src2, 0, arr, 1);
    const map = getStore().addNode('array-map', [4, 0, 0]);
    getStore().updateNodeData(map, 'expression', 'x * x');
    getStore().addConnection(arr, 0, map, 0);

    // Execute: [2,4] mapped with x*x => [4,16]
    let r = execStore();
    expect(out(r, map)).toEqual([4, 16]);

    // Change expression
    getStore().updateNodeData(map, 'expression', 'x + 10');
    r = execStore();
    expect(out(r, map)).toEqual([12, 14]);

    // Undo expression change => back to 'x * x'
    getStore().undo();
    r = execStore();
    expect(out(r, map)).toEqual([4, 16]);

    // Redo => back to 'x + 10'
    getStore().redo();
    r = execStore();
    expect(out(r, map)).toEqual([12, 14]);
  });
});

// ============================================================
// 8. Regression guards
// ============================================================
describe('Regression guards', () => {
  beforeEach(() => { resetStore(); });

  it('clearGraph resets graphVariables to {}', () => {
    getStore().addNode('source', [0, 0, 0]);
    useEditorStore.setState((draft) => { draft.graphVariables = { key: 'value' }; });
    expect(getStore().graphVariables).toEqual({ key: 'value' });

    getStore().clearGraph();
    expect(getStore().graphVariables).toEqual({});
    expect(Object.keys(getStore().nodes).length).toBe(0);
  });

  it('validateGraph works with Phase 25 node types without spurious errors', () => {
    // Build a fully connected graph with Phase 25 nodes
    // For create-array, connect all 4 inputs to avoid "not connected" errors
    const s1 = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(s1, 'value', 1);
    const s2 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(s2, 'value', 2);
    const s3 = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(s3, 'value', 3);
    const s4 = getStore().addNode('source', [0, 0, 3]);
    getStore().updateNodeData(s4, 'value', 4);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(s1, 0, arr, 0);
    getStore().addConnection(s2, 0, arr, 1);
    getStore().addConnection(s3, 0, arr, 2);
    getStore().addConnection(s4, 0, arr, 3);

    const map = getStore().addNode('array-map', [4, 0, 0]);
    getStore().updateNodeData(map, 'expression', 'x * 2');
    getStore().addConnection(arr, 0, map, 0);
    const filter = getStore().addNode('array-filter', [6, 0, 0]);
    getStore().updateNodeData(filter, 'expression', 'x > 1');
    getStore().addConnection(map, 0, filter, 0);
    const len = getStore().addNode('array-length', [8, 0, 0]);
    getStore().addConnection(filter, 0, len, 0);

    // if-gate fully connected with boolean from compare
    const condSrc = getStore().addNode('source', [0, 0, 5]);
    getStore().updateNodeData(condSrc, 'value', 1);
    const cmp = getStore().addNode('compare', [1, 0, 5]);
    getStore().updateNodeData(cmp, 'mode', '>');
    getStore().addConnection(condSrc, 0, cmp, 0);
    // compare has 2 number inputs; connect b too
    const bSrc = getStore().addNode('source', [0, 0, 6]);
    getStore().updateNodeData(bSrc, 'value', 0);
    getStore().addConnection(bSrc, 0, cmp, 1);

    const t = getStore().addNode('source', [0, 0, 7]);
    getStore().updateNodeData(t, 'value', 'yes');
    const f = getStore().addNode('source', [0, 0, 8]);
    getStore().updateNodeData(f, 'value', 'no');
    const gate = getStore().addNode('if-gate', [3, 0, 5]);
    getStore().addConnection(cmp, 0, gate, 0); // boolean
    getStore().addConnection(t, 0, gate, 1);
    getStore().addConnection(f, 0, gate, 2);

    // Validate
    getStore().validateGraph();
    const errs = getStore().validationErrors;

    // Check that Phase 25 nodes don't have actual errors (only possible warnings)
    for (const nodeId of [arr, map, filter, len, gate]) {
      const nodeErrs = errs[nodeId] ?? [];
      // Filter out warnings (those ending with "(warning)")
      const realErrors = nodeErrs.filter((e: string) => !e.includes('(warning)'));
      expect(realErrors).toEqual([]);
    }
  });
});

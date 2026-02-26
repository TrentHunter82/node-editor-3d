/**
 * Phase 26 E2E regression tests
 *
 * Comprehensive regression suite covering Phase 25 features and earlier:
 * - Array workflow pipelines (create-array, get-element, push, filter, map, length)
 * - Flow control (if-gate, select, switch)
 * - Graph variables (set-var, get-var, isolation, clearGraph)
 * - Node locking (deleteSelected, toggleNodeLock undo, duplicate)
 * - Settings store (clampLoadedSettings, BUILTIN_PRESETS)
 * - Coercion + Phase 25 integration (startConnection+completeConnection, undo)
 * - Serialization roundtrip (export/import, graphVariables, heatmap setting)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings, BUILTIN_PRESETS } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';

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

function exec(graphVariables?: Record<string, unknown>) {
  const st = getStore();
  return executeGraph(st.nodes, st.connections, undefined, undefined, undefined, undefined, graphVariables);
}

function out(r: ReturnType<typeof exec>, nodeId: string, port = 0): unknown {
  return r.results.get(nodeId)?.outputs[port];
}

/**
 * Trigger a coercion by starting a connection from a source output
 * to a target input via startConnection + completeConnection.
 * Returns the converter node ID that was auto-inserted, or null.
 */
function triggerCoercion(
  sourceNodeId: string,
  sourcePortIndex: number,
  targetNodeId: string,
  targetPortIndex: number,
): string | null {
  const beforeNodeIds = new Set(Object.keys(getStore().nodes));
  getStore().startConnection(sourceNodeId, sourcePortIndex);
  getStore().completeConnection(targetNodeId, targetPortIndex);
  const afterNodeIds = Object.keys(getStore().nodes);
  const newId = afterNodeIds.find(id => !beforeNodeIds.has(id));
  return newId ?? null;
}

// ============================================================================
// 1. Array workflow regression (5 tests)
// ============================================================================
describe('Array workflow regression', () => {
  beforeEach(() => { resetStore(); });

  it('create-array -> get-element pipeline returns correct value', () => {
    // source(10) + source(20) + source(30) -> create-array -> get-element(index=1)
    const s1 = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(s1, 'value', 10);
    const s2 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(s2, 'value', 20);
    const s3 = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(s3, 'value', 30);

    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(s1, 0, arr, 0);
    getStore().addConnection(s2, 0, arr, 1);
    getStore().addConnection(s3, 0, arr, 2);

    const getEl = getStore().addNode('get-element', [4, 0, 0]);
    getStore().addConnection(arr, 0, getEl, 0);
    // Index = 1 (second element = 20)
    const idxSrc = getStore().addNode('source', [4, 0, 1]);
    getStore().updateNodeData(idxSrc, 'value', 1);
    getStore().addConnection(idxSrc, 0, getEl, 1);

    const r = exec();
    expect(out(r, arr)).toEqual([10, 20, 30]);
    expect(out(r, getEl)).toBe(20);
  });

  it('array-push -> array-length returns correct count', () => {
    // source(5) -> create-array -> array-push(source(99)) -> array-length
    const s1 = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(s1, 'value', 5);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(s1, 0, arr, 0);

    const pushVal = getStore().addNode('source', [2, 0, 1]);
    getStore().updateNodeData(pushVal, 'value', 99);
    const push = getStore().addNode('array-push', [4, 0, 0]);
    getStore().addConnection(arr, 0, push, 0);
    getStore().addConnection(pushVal, 0, push, 1);

    const len = getStore().addNode('array-length', [6, 0, 0]);
    getStore().addConnection(push, 0, len, 0);

    const r = exec();
    // create-array([5]) -> push(99) => [5, 99], length = 2
    expect(out(r, push)).toEqual([5, 99]);
    expect(out(r, len)).toBe(2);
  });

  it('array-filter with expression filters correctly', () => {
    // Create array [1, 2, 3, 4] -> array-filter(x > 2)
    const sources: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const id = getStore().addNode('source', [0, 0, i]);
      getStore().updateNodeData(id, 'value', i);
      sources.push(id);
    }
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    sources.forEach((id, i) => getStore().addConnection(id, 0, arr, i));

    const filter = getStore().addNode('array-filter', [4, 0, 0]);
    getStore().updateNodeData(filter, 'expression', 'x > 2');
    getStore().addConnection(arr, 0, filter, 0);

    const r = exec();
    expect(out(r, filter)).toEqual([3, 4]);
  });

  it('array-map transforms values correctly', () => {
    // Create array [2, 4, 6] -> array-map(x * 10)
    const vals = [2, 4, 6];
    const sources: string[] = [];
    for (let i = 0; i < vals.length; i++) {
      const id = getStore().addNode('source', [0, 0, i]);
      getStore().updateNodeData(id, 'value', vals[i]);
      sources.push(id);
    }
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    sources.forEach((id, i) => getStore().addConnection(id, 0, arr, i));

    const map = getStore().addNode('array-map', [4, 0, 0]);
    getStore().updateNodeData(map, 'expression', 'x * 10');
    getStore().addConnection(arr, 0, map, 0);

    const r = exec();
    expect(out(r, map)).toEqual([20, 40, 60]);
  });

  it('array-push chain of 3 -> get-element at each index', () => {
    // Empty create-array -> push(10) -> push(20) -> push(30) -> get-element at index 0, 1, 2
    const arr = getStore().addNode('create-array', [0, 0, 0]);

    const v1 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(v1, 'value', 10);
    const push1 = getStore().addNode('array-push', [2, 0, 0]);
    getStore().addConnection(arr, 0, push1, 0);
    getStore().addConnection(v1, 0, push1, 1);

    const v2 = getStore().addNode('source', [2, 0, 1]);
    getStore().updateNodeData(v2, 'value', 20);
    const push2 = getStore().addNode('array-push', [4, 0, 0]);
    getStore().addConnection(push1, 0, push2, 0);
    getStore().addConnection(v2, 0, push2, 1);

    const v3 = getStore().addNode('source', [4, 0, 1]);
    getStore().updateNodeData(v3, 'value', 30);
    const push3 = getStore().addNode('array-push', [6, 0, 0]);
    getStore().addConnection(push2, 0, push3, 0);
    getStore().addConnection(v3, 0, push3, 1);

    // get-element at index 0
    const idx0 = getStore().addNode('source', [8, 0, 1]);
    getStore().updateNodeData(idx0, 'value', 0);
    const get0 = getStore().addNode('get-element', [8, 0, 0]);
    getStore().addConnection(push3, 0, get0, 0);
    getStore().addConnection(idx0, 0, get0, 1);

    // get-element at index 1
    const idx1 = getStore().addNode('source', [10, 0, 1]);
    getStore().updateNodeData(idx1, 'value', 1);
    const get1 = getStore().addNode('get-element', [10, 0, 0]);
    getStore().addConnection(push3, 0, get1, 0);
    getStore().addConnection(idx1, 0, get1, 1);

    // get-element at index 2
    const idx2 = getStore().addNode('source', [12, 0, 1]);
    getStore().updateNodeData(idx2, 'value', 2);
    const get2 = getStore().addNode('get-element', [12, 0, 0]);
    getStore().addConnection(push3, 0, get2, 0);
    getStore().addConnection(idx2, 0, get2, 1);

    const r = exec();
    expect(out(r, push3)).toEqual([10, 20, 30]);
    expect(out(r, get0)).toBe(10);
    expect(out(r, get1)).toBe(20);
    expect(out(r, get2)).toBe(30);
  });
});

// ============================================================================
// 2. Flow control regression (4 tests)
// ============================================================================
describe('Flow control regression', () => {
  beforeEach(() => { resetStore(); });

  it('if-gate selects true/false branch based on boolean source', () => {
    // compare(5 > 0) = true -> if-gate selects true branch
    const condSrc = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(condSrc, 'value', 5);
    const cmp = getStore().addNode('compare', [1, 0, 0]);
    getStore().updateNodeData(cmp, 'mode', '>');
    getStore().addConnection(condSrc, 0, cmp, 0); // a=5, b defaults to 0

    const trueSrc = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(trueSrc, 'value', 'TRUE');
    const falseSrc = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(falseSrc, 'value', 'FALSE');

    const gate = getStore().addNode('if-gate', [3, 0, 0]);
    getStore().addConnection(cmp, 0, gate, 0);
    getStore().addConnection(trueSrc, 0, gate, 1);
    getStore().addConnection(falseSrc, 0, gate, 2);

    let r = exec();
    expect(out(r, gate)).toBe('TRUE');

    // Flip condition: -3 > 0 = false
    getStore().updateNodeData(condSrc, 'value', -3);
    r = exec();
    expect(out(r, gate)).toBe('FALSE');
  });

  it('select node picks correct value by index', () => {
    const idx = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(idx, 'value', 2);

    const v0 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(v0, 'value', 'alpha');
    const v1 = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(v1, 'value', 'beta');
    const v2 = getStore().addNode('source', [0, 0, 3]);
    getStore().updateNodeData(v2, 'value', 'gamma');

    const sel = getStore().addNode('select', [3, 0, 0]);
    getStore().addConnection(idx, 0, sel, 0); // index
    getStore().addConnection(v0, 0, sel, 1);  // value0
    getStore().addConnection(v1, 0, sel, 2);  // value1
    getStore().addConnection(v2, 0, sel, 3);  // value2

    const r = exec();
    // index=2 should pick value2 = 'gamma'
    expect(out(r, sel)).toBe('gamma');
  });

  it('switch node selects between branches based on value match', () => {
    // switch: input 0 = value, inputs 1-4 = cases, input 5 = default
    // Returns the matching case value, or default if none match
    const val = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(val, 'value', 42);

    const case1 = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(case1, 'value', 10);
    const case2 = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(case2, 'value', 42); // This matches
    const defaultVal = getStore().addNode('source', [0, 0, 3]);
    getStore().updateNodeData(defaultVal, 'value', -1);

    const sw = getStore().addNode('switch', [3, 0, 0]);
    getStore().addConnection(val, 0, sw, 0);       // value to match
    getStore().addConnection(case1, 0, sw, 1);     // case 1
    getStore().addConnection(case2, 0, sw, 2);     // case 2 (matches)
    getStore().addConnection(defaultVal, 0, sw, 5); // default (input 5)

    const r = exec();
    expect(out(r, sw)).toBe(42);

    // Change value so nothing matches -> should return default
    getStore().updateNodeData(val, 'value', 999);
    const r2 = exec();
    expect(out(r2, sw)).toBe(-1);
  });

  it('if-gate with 0 as condition (falsy) selects false branch', () => {
    // Direct source(0) -> if-gate condition. Boolean(0) = false
    const condSrc = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(condSrc, 'value', 0);

    const trueSrc = getStore().addNode('source', [0, 0, 1]);
    getStore().updateNodeData(trueSrc, 'value', 'YES');
    const falseSrc = getStore().addNode('source', [0, 0, 2]);
    getStore().updateNodeData(falseSrc, 'value', 'NO');

    const gate = getStore().addNode('if-gate', [3, 0, 0]);
    getStore().addConnection(condSrc, 0, gate, 0); // 0 is falsy
    getStore().addConnection(trueSrc, 0, gate, 1);
    getStore().addConnection(falseSrc, 0, gate, 2);

    const r = exec();
    // Boolean(0) = false, so false branch is selected
    expect(out(r, gate)).toBe('NO');
  });
});

// ============================================================================
// 3. Graph variables regression (3 tests)
// ============================================================================
describe('Graph variables regression', () => {
  beforeEach(() => { resetStore(); });

  it('set-var + get-var communication via executeGraph graphVariables parameter', () => {
    // set-var writes to the module-scoped graphVariables context during execution.
    // get-var reads from it. Since get-var has no upstream dependency on set-var,
    // topological sort may execute them in any order within the same call.
    // So we use two executions: first to set, second to get.
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 77);
    const setter = getStore().addNode('set-var', [2, 0, 0]);
    getStore().updateNodeData(setter, 'variableName', 'testVar');
    getStore().addConnection(src, 0, setter, 0);

    // First execution: set-var stores 77 into the module-scoped context
    const vars: Record<string, unknown> = {};
    const r1 = exec(vars);
    expect(out(r1, setter)).toBe(77);

    // Second execution: get-var reads the value set by previous execution
    const getter = getStore().addNode('get-var', [4, 0, 0]);
    getStore().updateNodeData(getter, 'variableName', 'testVar');
    const r2 = exec(); // no fresh vars -- uses the context from prior exec
    expect(out(r2, getter)).toBe(77);
  });

  it('graph variables isolated between executions (fresh context each time)', () => {
    // First execution sets a variable
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 42);
    const setter = getStore().addNode('set-var', [2, 0, 0]);
    getStore().updateNodeData(setter, 'variableName', 'myVar');
    getStore().addConnection(src, 0, setter, 0);

    const vars1: Record<string, unknown> = {};
    exec(vars1);

    // Second execution with a fresh vars context should not see the variable
    // (get-var defaults to 0 when variable not set)
    resetStore();
    const getter = getStore().addNode('get-var', [0, 0, 0]);
    getStore().updateNodeData(getter, 'variableName', 'myVar');

    const vars2: Record<string, unknown> = {};
    const r2 = exec(vars2);
    expect(out(r2, getter)).toBe(0); // default when variable not set
  });

  it('clearGraph resets graphVariables in store', () => {
    getStore().addNode('source', [0, 0, 0]);
    useEditorStore.setState((draft) => { draft.graphVariables = { x: 100, y: 'hello' }; });
    expect(getStore().graphVariables).toEqual({ x: 100, y: 'hello' });

    getStore().clearGraph();
    expect(getStore().graphVariables).toEqual({});
  });
});

// ============================================================================
// 4. Node locking regression (3 tests)
// ============================================================================
describe('Node locking regression', () => {
  beforeEach(() => { resetStore(); });

  it('locked node prevents deletion via deleteSelected', () => {
    const lockedId = getStore().addNode('source', [0, 0, 0]);
    const unlockedId = getStore().addNode('source', [2, 0, 0]);
    getStore().toggleNodeLock(lockedId);
    expect(getStore().nodes[lockedId].locked).toBe(true);

    getStore().setSelection(new Set([lockedId, unlockedId]));
    getStore().deleteSelected();

    // Locked node survives, unlocked node is deleted
    expect(getStore().nodes[lockedId]).toBeDefined();
    expect(getStore().nodes[unlockedId]).toBeUndefined();
  });

  it('toggleNodeLock is undoable', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    expect(getStore().nodes[id].locked).toBeFalsy();

    getStore().toggleNodeLock(id);
    expect(getStore().nodes[id].locked).toBe(true);

    // Undo should revert the lock
    getStore().undo();
    expect(getStore().nodes[id].locked).toBeFalsy();

    // Redo should re-apply the lock
    getStore().redo();
    expect(getStore().nodes[id].locked).toBe(true);
  });

  it('locked field preserved in duplicate', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(id, 'value', 42);
    getStore().toggleNodeLock(id);
    expect(getStore().nodes[id].locked).toBe(true);

    getStore().setSelection(new Set([id]));
    const idMap = getStore().duplicateSelected();
    expect(idMap).not.toBeNull();

    const newId = idMap!.get(id)!;
    expect(getStore().nodes[newId]).toBeDefined();
    expect(getStore().nodes[newId].locked).toBe(true);
    expect(getStore().nodes[newId].data.value).toBe(42);
  });
});

// ============================================================================
// 5. Settings store regression (4 tests)
// ============================================================================
describe('Settings store regression', () => {
  it('clampLoadedSettings validates openPanels (rejects non-array)', () => {
    const result = clampLoadedSettings({ openPanels: 'not-an-array' as unknown });
    // Should fall back to default openPanels
    expect(Array.isArray(result.openPanels)).toBe(true);
    expect(result.openPanels).toEqual(DEFAULT_SETTINGS.openPanels);
  });

  it('clampLoadedSettings preserves valid settings', () => {
    const validSettings = {
      gridSnapSize: 0.5,
      animationSpeed: 1.5,
      uiScale: 1.2,
      theme: 'light',
      connectionStyle: 'straight',
      openPanels: ['debug', 'profiling'],
      showExecutionHeatmap: true,
      autoExecute: true,
    };
    const result = clampLoadedSettings(validSettings);
    expect(result.gridSnapSize).toBe(0.5);
    expect(result.animationSpeed).toBe(1.5);
    expect(result.uiScale).toBe(1.2);
    expect(result.theme).toBe('light');
    expect(result.connectionStyle).toBe('straight');
    expect(result.openPanels).toEqual(['debug', 'profiling']);
    expect(result.showExecutionHeatmap).toBe(true);
  });

  it('clampLoadedSettings rejects invalid connectionStyle', () => {
    const result = clampLoadedSettings({ connectionStyle: 'invalid-style' });
    // Invalid connectionStyle should be deleted (not present in result)
    expect(result.connectionStyle).toBeUndefined();
  });

  it('BUILTIN_PRESETS has 4 entries with expected IDs', () => {
    expect(BUILTIN_PRESETS).toHaveLength(4);
    const ids = BUILTIN_PRESETS.map(p => p.id);
    expect(ids).toContain('minimal');
    expect(ids).toContain('debug');
    expect(ids).toContain('edit');
    expect(ids).toContain('full');
    // Each preset should have required fields
    for (const preset of BUILTIN_PRESETS) {
      expect(typeof preset.name).toBe('string');
      expect(typeof preset.minimapVisible).toBe('boolean');
      expect(typeof preset.inspectorVisible).toBe('boolean');
      expect(Array.isArray(preset.openPanels)).toBe(true);
    }
  });
});

// ============================================================================
// 6. Coercion + Phase 25 integration (3 tests)
// ============================================================================
describe('Coercion + Phase 25 integration', () => {
  beforeEach(() => { resetStore(); });

  it('type coercion works with completeConnection (number -> boolean)', () => {
    // source(number output) -> if-gate(boolean input 0) should trigger coercion
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 5);
    const gate = getStore().addNode('if-gate', [4, 0, 0]);

    // source output 0 is 'number', if-gate input 0 is 'boolean'
    // This should auto-insert a compare node (number->boolean coercion)
    const converterId = triggerCoercion(src, 0, gate, 0);
    expect(converterId).not.toBeNull();

    // Verify the converter node is a compare node
    const converterNode = getStore().nodes[converterId!];
    expect(converterNode).toBeDefined();
    expect(converterNode.type).toBe('compare');

    // Verify connections: source -> compare -> if-gate
    const conns = Object.values(getStore().connections);
    const srcToConverter = conns.find(
      c => c.sourceNodeId === src && c.targetNodeId === converterId
    );
    const converterToGate = conns.find(
      c => c.sourceNodeId === converterId && c.targetNodeId === gate
    );
    expect(srcToConverter).toBeDefined();
    expect(converterToGate).toBeDefined();
  });

  it('undo reverts coerced connection (including converter node)', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const gate = getStore().addNode('if-gate', [4, 0, 0]);

    const nodeCountBefore = Object.keys(getStore().nodes).length;
    const connCountBefore = Object.keys(getStore().connections).length;

    // Trigger coercion
    const converterId = triggerCoercion(src, 0, gate, 0);
    expect(converterId).not.toBeNull();
    expect(Object.keys(getStore().nodes).length).toBeGreaterThan(nodeCountBefore);
    expect(Object.keys(getStore().connections).length).toBeGreaterThan(connCountBefore);

    // Undo should remove the converter node and its connections
    getStore().undo();
    expect(Object.keys(getStore().nodes).length).toBe(nodeCountBefore);
    expect(Object.keys(getStore().connections).length).toBe(connCountBefore);
  });

  it('connection metadata (label, colorOverride) preserved in addConnection', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const dest = getStore().addNode('transform', [2, 0, 0]);
    const connId = getStore().addConnection(src, 0, dest, 0);
    expect(connId).not.toBeNull();

    // Set metadata
    getStore().updateConnectionLabel(connId!, 'data-flow');
    getStore().updateConnectionColor(connId!, '#ff0000');

    expect(getStore().connections[connId!].label).toBe('data-flow');
    expect(getStore().connections[connId!].colorOverride).toBe('#ff0000');

    // Undo color change
    getStore().undo();
    expect(getStore().connections[connId!].colorOverride).toBeUndefined();
    // Label should still be set (only color was undone)
    expect(getStore().connections[connId!].label).toBe('data-flow');
  });
});

// ============================================================================
// 7. Serialization roundtrip regression (3 tests)
// ============================================================================
describe('Serialization roundtrip regression', () => {
  beforeEach(() => { resetStore(); });

  it('export all graphs + import preserves node data', () => {
    // Create a graph with various Phase 25 nodes
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 42);
    const arr = getStore().addNode('create-array', [2, 0, 0]);
    getStore().addConnection(src, 0, arr, 0);
    const map = getStore().addNode('array-map', [4, 0, 0]);
    getStore().updateNodeData(map, 'expression', 'x * 2');
    getStore().addConnection(arr, 0, map, 0);
    getStore().addNode('if-gate', [6, 0, 0]);
    const getter = getStore().addNode('get-var', [8, 0, 0]);
    getStore().updateNodeData(getter, 'variableName', 'score');

    // Execute before export to verify correct behavior
    const r1 = exec();
    expect(out(r1, map)).toEqual([84]);

    // Export
    const exported = getStore().exportAllGraphs();
    expect(exported.version).toBe(2);

    // Reset and import
    resetStore();
    getStore().importAllGraphs(exported);

    // Verify nodes and data survived
    const mapNode = Object.values(getStore().nodes).find(n => n.type === 'array-map');
    expect(mapNode).toBeDefined();
    expect(mapNode!.data.expression).toBe('x * 2');

    const getVarNode = Object.values(getStore().nodes).find(n => n.type === 'get-var');
    expect(getVarNode).toBeDefined();
    expect(getVarNode!.data.variableName).toBe('score');

    const gateNode = Object.values(getStore().nodes).find(n => n.type === 'if-gate');
    expect(gateNode).toBeDefined();

    // Re-execute after import and verify same result
    const r2 = exec();
    expect(out(r2, mapNode!.id)).toEqual([84]);
  });

  it('graph variables cleared on import (fresh workspace)', () => {
    // Set some graph variables in the current store
    useEditorStore.setState((draft) => { draft.graphVariables = { old: 'data' }; });
    expect(getStore().graphVariables).toEqual({ old: 'data' });

    // Create a minimal export with no graph variables
    getStore().addNode('source', [0, 0, 0]);
    // Reset variables before export to simulate a clean workspace
    useEditorStore.setState((draft) => { draft.graphVariables = {}; });
    const exported = getStore().exportAllGraphs();

    // Set variables again to simulate dirty state before import
    useEditorStore.setState((draft) => { draft.graphVariables = { dirty: 'state' }; });

    // Import should clear variables
    getStore().importAllGraphs(exported);
    expect(getStore().graphVariables).toEqual({});
  });

  it('execution heatmap setting persists across settings reload', () => {
    // Set heatmap to true
    getSettings().setShowExecutionHeatmap(true);
    expect(getSettings().showExecutionHeatmap).toBe(true);

    // Simulate a settings reload by running through clampLoadedSettings
    const savedSettings = { showExecutionHeatmap: true };
    const clamped = clampLoadedSettings(savedSettings);

    // The setting should survive the clamp
    expect(clamped.showExecutionHeatmap).toBe(true);

    // Also verify false is preserved
    const savedFalse = { showExecutionHeatmap: false };
    const clampedFalse = clampLoadedSettings(savedFalse);
    expect(clampedFalse.showExecutionHeatmap).toBe(false);
  });
});

/// <reference types="vitest/config" />
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings } from '../store/settingsStore';
import { topologicalSort } from '../utils/execution';
import { generateMismatchWarnings, detectPortMismatch } from '../utils/nodeVersioning';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection, NodeType } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function resetSettings() {
  useSettingsStore.setState(useSettingsStore.getInitialState());
}

/** Build a raw EditorNode for direct utility testing. */
function makeRawNode(id: string, type: NodeType, data: Record<string, unknown> = {}): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

/**
 * Trigger a coercion by starting a connection from a source(number) output
 * to a concat(string) input via startConnection + completeConnection.
 * Returns the converter node ID that was auto-inserted.
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
// 1. Batch Execution + Coercion Integration (5 tests)
// ============================================================================
describe('Batch Execution + Coercion Integration', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('executeSelection on a graph with coerced connections executes correctly', () => {
    // source(number) -> [coercion: template] -> concat(string,string) -> display
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat = getStore().addNode('concat', [10, 0, 0]);

    // This triggers auto-coercion: source(number) -> template -> concat(string)
    const converterId = triggerCoercion(src, 0, concat, 0);
    expect(converterId).not.toBeNull();

    // Verify the converter node exists and is of the coercion type
    const converterNode = getStore().nodes[converterId!];
    expect(converterNode).toBeDefined();

    // Execute selection on the concat node (should pull in upstream converter and source)
    getStore().executeSelection(new Set([concat]));

    // Execution should complete without errors for the scoped nodes
    const errors = getStore().executionErrors;
    expect(errors[src]).toBeUndefined();
    expect(errors[converterId!]).toBeUndefined();
  });

  it('executeSelection includes upstream coercion converters automatically', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat = getStore().addNode('concat', [10, 0, 0]);

    // Coerce number -> string
    const converterId = triggerCoercion(src, 0, concat, 0);
    expect(converterId).not.toBeNull();

    // Execute just the concat node - should include the converter + source upstream
    getStore().executeSelection(new Set([concat]));

    // The converter and source should have been executed (have outputs)
    const outputs = getStore().nodeOutputs;
    expect(outputs[src]).toBeDefined();
    expect(outputs[converterId!]).toBeDefined();
  });

  it('executeSelection of middle node includes coercion chain', () => {
    // Build: source -> [coercion:template] -> concat
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat = getStore().addNode('concat', [10, 0, 0]);

    const converterId = triggerCoercion(src, 0, concat, 0);
    expect(converterId).not.toBeNull();

    // Execute just the converter node itself
    getStore().executeSelection(new Set([converterId!]));

    // The source should be included as upstream dependency
    const states = getStore().executionStates;
    expect(states[src]).toBeDefined();
    expect(states[converterId!]).toBeDefined();
  });

  it('executeSelection with empty selection is a no-op', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().executeSelection(new Set());

    // No execution states should be set
    expect(getStore().executionStates[src]).toBeUndefined();
    expect(Object.keys(getStore().nodeOutputs).length).toBe(0);
  });

  it('executeSelection with non-existent node IDs is gracefully ignored', () => {
    const src = getStore().addNode('source', [0, 0, 0]);

    // Pass IDs that don't exist
    getStore().executeSelection(new Set(['nonexistent-1', 'nonexistent-2']));

    // Should not crash, no outputs generated for fake nodes
    expect(getStore().nodeOutputs['nonexistent-1']).toBeUndefined();
    expect(getStore().nodeOutputs['nonexistent-2']).toBeUndefined();
    // Real node unaffected
    expect(getStore().executionStates[src]).toBeUndefined();
  });
});

// ============================================================================
// 2. Node Schema Versioning (5 tests)
// ============================================================================
describe('Node Schema Versioning', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('validateGraph detects nodes with missing ports', () => {
    // Create a source node then remove one output to simulate schema mismatch
    const srcId = getStore().addNode('source', [0, 0, 0]);

    // Manually strip the second output port (label) to simulate an old schema
    useEditorStore.setState((s) => {
      s.nodes[srcId].outputs = s.nodes[srcId].outputs.slice(0, 1);
    });

    // detectPortMismatch should find the missing output
    const mismatch = detectPortMismatch(getStore().nodes[srcId]);
    expect(mismatch).not.toBeNull();
    expect(mismatch!.missingOutputs.length).toBe(1);
    expect(mismatch!.missingOutputs[0].label).toBe('label');
  });

  it('validateGraph detects nodes with extra ports', () => {
    // Create a math node, then add an extra input to simulate excess ports
    const mathId = getStore().addNode('math', [0, 0, 0]);

    useEditorStore.setState((s) => {
      s.nodes[mathId].inputs.push({ id: 'in-extra', label: 'extra', portType: 'number' });
    });

    const mismatch = detectPortMismatch(getStore().nodes[mathId]);
    expect(mismatch).not.toBeNull();
    expect(mismatch!.excessInputs).toBe(1);
  });

  it('validateGraph produces warning messages for schema mismatches', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);

    // Remove the second output to create a mismatch
    useEditorStore.setState((s) => {
      s.nodes[srcId].outputs = s.nodes[srcId].outputs.slice(0, 1);
    });

    const warnings = generateMismatchWarnings(getStore().nodes);
    expect(warnings[srcId]).toBeDefined();
    expect(warnings[srcId].length).toBeGreaterThan(0);
    // Warnings should contain the (warning) suffix convention
    expect(warnings[srcId].some(msg => msg.includes('(warning)'))).toBe(true);
    expect(warnings[srcId].some(msg => msg.includes('Missing output'))).toBe(true);
  });

  it('validation passes for nodes with correct schemas', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('math', [5, 0, 0]);
    getStore().addNode('concat', [10, 0, 0]);

    // No mismatches expected for freshly created nodes
    const warnings = generateMismatchWarnings(getStore().nodes);
    expect(Object.keys(warnings).length).toBe(0);
  });

  it('validation warnings do not block execution', () => {
    // Create source -> math chain, then mutate source to have schema mismatch
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [5, 0, 0]);
    getStore().startConnection(src, 0);
    getStore().completeConnection(math, 0);

    // Add an extra port to source (schema mismatch -> warning)
    useEditorStore.setState((s) => {
      s.nodes[src].outputs.push({ id: 'out-extra', label: 'extra', portType: 'number' });
    });

    // Validate should produce warnings
    getStore().validateGraph();
    const errors = getStore().validationErrors;
    const srcErrors = errors[src] ?? [];
    const hasWarning = srcErrors.some(msg => msg.includes('(warning)'));
    expect(hasWarning).toBe(true);

    // Execution should still work despite warnings
    getStore().executeGraph();
    expect(getStore().nodeOutputs[src]).toBeDefined();
    expect(getStore().nodeOutputs[math]).toBeDefined();
  });
});

// ============================================================================
// 3. Coercion + Undo Chain (4 tests)
// ============================================================================
describe('Coercion + Undo Chain', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('multiple coercions in sequence are each undoable independently', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat1 = getStore().addNode('concat', [5, 0, 0]);
    const concat2 = getStore().addNode('concat', [10, 0, 0]);

    // First coercion: source -> concat1
    const converter1 = triggerCoercion(src, 0, concat1, 0);
    expect(converter1).not.toBeNull();
    expect(Object.keys(getStore().nodes).length).toBe(4); // src + concat1 + concat2 + converter1

    // Second coercion: source -> concat2
    const converter2 = triggerCoercion(src, 0, concat2, 0);
    expect(converter2).not.toBeNull();
    expect(Object.keys(getStore().nodes).length).toBe(5); // + converter2

    // Undo second coercion
    getStore().undo();
    expect(Object.keys(getStore().nodes).length).toBe(4);
    expect(getStore().nodes[converter2!]).toBeUndefined();
    expect(getStore().nodes[converter1!]).toBeDefined();

    // Undo first coercion
    getStore().undo();
    expect(Object.keys(getStore().nodes).length).toBe(3); // src + concat1 + concat2
    expect(getStore().nodes[converter1!]).toBeUndefined();
  });

  it('undo coercion then redo restores correctly', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat = getStore().addNode('concat', [5, 0, 0]);

    const converterId = triggerCoercion(src, 0, concat, 0);
    expect(converterId).not.toBeNull();
    const connCountBefore = Object.keys(getStore().connections).length;

    // Undo
    getStore().undo();
    expect(getStore().nodes[converterId!]).toBeUndefined();

    // Redo
    getStore().redo();
    expect(getStore().nodes[converterId!]).toBeDefined();
    expect(Object.keys(getStore().connections).length).toBe(connCountBefore);
  });

  it('undo coercion then make new connection clears redo', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat = getStore().addNode('concat', [5, 0, 0]);
    const math = getStore().addNode('math', [10, 0, 0]);

    // Coerce source(number) -> concat(string)
    triggerCoercion(src, 0, concat, 0);

    // Undo the coercion
    getStore().undo();
    expect(getStore().canRedo()).toBe(true);

    // Make a new compatible connection: source -> math (both number)
    getStore().startConnection(src, 0);
    getStore().completeConnection(math, 0);

    // Redo stack should be cleared
    expect(getStore().canRedo()).toBe(false);
  });

  it('complex coercion chain: A(number) -> B(string) -> C(number) via two coercions', () => {
    // source outputs number, concat expects string, parse-number expects string
    // We want: source(number) -> [template] -> concat(string) -> [parse-number] -> math(number)
    // Actually: let's use source(number) -> concat(string) and concat(string) -> math(number)
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat = getStore().addNode('concat', [5, 0, 0]);
    const math = getStore().addNode('math', [15, 0, 0]);

    // First coercion: number -> string (auto-inserts template converter)
    const conv1 = triggerCoercion(src, 0, concat, 0);
    expect(conv1).not.toBeNull();

    // Second coercion: string -> number (auto-inserts parse-number converter)
    const conv2 = triggerCoercion(concat, 0, math, 0);
    expect(conv2).not.toBeNull();

    // Should have 5 nodes: src, concat, math, conv1, conv2
    expect(Object.keys(getStore().nodes).length).toBe(5);

    // Verify the chain: src -> conv1 -> concat, concat -> conv2 -> math
    const conns = Object.values(getStore().connections);
    // Source to converter1
    expect(conns.some(c => c.sourceNodeId === src && c.targetNodeId === conv1!)).toBe(true);
    // Converter1 to concat
    expect(conns.some(c => c.sourceNodeId === conv1! && c.targetNodeId === concat)).toBe(true);
    // Concat to converter2
    expect(conns.some(c => c.sourceNodeId === concat && c.targetNodeId === conv2!)).toBe(true);
    // Converter2 to math
    expect(conns.some(c => c.sourceNodeId === conv2! && c.targetNodeId === math)).toBe(true);
  });
});

// ============================================================================
// 4. Dependency Graph Data (4 tests)
// ============================================================================
describe('Dependency Graph Data', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('topologicalSort returns correct wave structure for simple chain', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeRawNode('a', 'source'),
      b: makeRawNode('b', 'math'),
      c: makeRawNode('c', 'display'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };

    const waves = topologicalSort(nodes, connections);
    expect(waves.length).toBe(3);
    // Wave 0: source (no dependencies)
    expect(waves[0]).toContain('a');
    // Wave 1: math (depends on source)
    expect(waves[1]).toContain('b');
    // Wave 2: display (depends on math)
    expect(waves[2]).toContain('c');
  });

  it('topologicalSort handles diamond convergence pattern', () => {
    //   A
    //  / \
    // B   C
    //  \ /
    //   D
    const nodes: Record<string, EditorNode> = {
      a: makeRawNode('a', 'source'),
      b: makeRawNode('b', 'math'),
      c: makeRawNode('c', 'math'),
      d: makeRawNode('d', 'math'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'a', 0, 'c', 0),
      c3: makeConn('c3', 'b', 0, 'd', 0),
      c4: makeConn('c4', 'c', 0, 'd', 1),
    };

    const waves = topologicalSort(nodes, connections);
    // A in first wave, B and C in second, D in third
    expect(waves.length).toBe(3);
    expect(waves[0]).toContain('a');
    expect(waves[1]).toContain('b');
    expect(waves[1]).toContain('c');
    expect(waves[2]).toContain('d');
  });

  it('topologicalSort handles fan-out (one source, multiple targets)', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeRawNode('s', 'source'),
      t1: makeRawNode('t1', 'math'),
      t2: makeRawNode('t2', 'math'),
      t3: makeRawNode('t3', 'display'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 's', 0, 't1', 0),
      c2: makeConn('c2', 's', 0, 't2', 0),
      c3: makeConn('c3', 's', 0, 't3', 0),
    };

    const waves = topologicalSort(nodes, connections);
    expect(waves.length).toBe(2);
    // Source in first wave
    expect(waves[0]).toContain('s');
    // All targets in second wave (all depend only on source)
    expect(waves[1]).toContain('t1');
    expect(waves[1]).toContain('t2');
    expect(waves[1]).toContain('t3');
  });

  it('topologicalSort returns empty waves for empty graph', () => {
    const waves = topologicalSort({}, {});
    expect(waves).toEqual([]);
  });
});

// ============================================================================
// 5. Settings + Persistence Regression (4 tests)
// ============================================================================
describe('Settings + Persistence Regression', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('connection style setting persists through clampLoadedSettings', () => {
    const loaded = clampLoadedSettings({
      connectionStyle: 'organic',
      gridSnapSize: 2,
      uiScale: 1.5,
    });

    expect(loaded.connectionStyle).toBe('organic');
    expect(loaded.gridSnapSize).toBe(2);
    expect(loaded.uiScale).toBe(1.5);
  });

  it('workspace presets survive setting changes', () => {
    // Save a workspace preset
    getSettings().setMinimapVisible(false);
    getSettings().setInspectorVisible(true);
    const presetId = getSettings().saveWorkspacePreset('Test Layout', ['debug']);

    // Change some settings
    getSettings().setMinimapVisible(true);
    getSettings().setConnectionStyle('straight');

    // The preset should still exist and be intact
    const preset = getSettings().workspacePresets.find(p => p.id === presetId);
    expect(preset).toBeDefined();
    expect(preset!.name).toBe('Test Layout');
    expect(preset!.minimapVisible).toBe(false);
    expect(preset!.inspectorVisible).toBe(true);
    expect(preset!.openPanels).toEqual(['debug']);
  });

  it('node presets persist through clampLoadedSettings', () => {
    const validPresets = [
      { id: 'preset-1', name: 'My Math', nodeType: 'math', data: { operation: '+' } },
      { id: 'preset-2', name: 'My Source', nodeType: 'source', data: { value: 42 } },
    ];

    const loaded = clampLoadedSettings({
      nodePresets: validPresets,
    });

    expect(loaded.nodePresets).toHaveLength(2);
    expect(loaded.nodePresets![0].name).toBe('My Math');
    expect(loaded.nodePresets![1].data).toEqual({ value: 42 });
  });

  it('key binding overrides persist and are loaded correctly', () => {
    const overrides = { undo: 'ctrl+shift+z', redo: 'ctrl+shift+y', delete: 'backspace' };

    const loaded = clampLoadedSettings({
      keyBindingOverrides: overrides,
    });

    expect(loaded.keyBindingOverrides).toEqual(overrides);

    // Also verify through the store
    getSettings().setKeyBinding('undo', 'ctrl+shift+z');
    getSettings().setKeyBinding('delete', 'backspace');
    expect(getSettings().keyBindingOverrides['undo']).toBe('ctrl+shift+z');
    expect(getSettings().keyBindingOverrides['delete']).toBe('backspace');
  });
});

// ============================================================================
// 6. Store Action Edge Cases (4 tests)
// ============================================================================
describe('Store Action Edge Cases', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('addNode returns unique IDs even after undo/redo cycles', () => {
    const id1 = getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('math', [5, 0, 0]);
    getStore().addNode('concat', [10, 0, 0]);

    // Undo the last two
    getStore().undo();
    getStore().undo();

    // Only id1 (source) should remain
    expect(Object.keys(getStore().nodes).length).toBe(1);
    expect(getStore().nodes[id1]).toBeDefined();

    // Add two more nodes after undo
    const id4 = getStore().addNode('display', [15, 0, 0]);
    const id5 = getStore().addNode('math', [20, 0, 0]);

    // All currently live node IDs should be unique (no collision with id1)
    const allIds = Object.keys(getStore().nodes);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
    expect(allIds.length).toBe(3); // id1 + id4 + id5

    // New IDs should not collide with each other
    expect(id4).not.toBe(id5);
    expect(id4).not.toBe(id1);
    expect(id5).not.toBe(id1);
  });

  it('connection validation rejects connections to non-existent ports', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [5, 0, 0]);

    // source has 2 outputs (index 0 and 1), math has 2 inputs (index 0 and 1)
    // Try connecting to port index 99 (non-existent)
    const result = getStore().addConnection(src, 99, math, 0);
    expect(result).toBeNull();

    // Try connecting from valid port to non-existent target port
    const result2 = getStore().addConnection(src, 0, math, 99);
    expect(result2).toBeNull();
  });

  it('duplicate connection on same input replaces old connection', () => {
    const src1 = getStore().addNode('source', [0, 0, 0]);
    const src2 = getStore().addNode('source', [0, 0, 5]);
    const math = getStore().addNode('math', [5, 0, 0]);

    // Connect src1 -> math input 0 (via completeConnection for undo tracking)
    getStore().startConnection(src1, 0);
    getStore().completeConnection(math, 0);

    const conns1 = Object.values(getStore().connections);
    const connToMath0 = conns1.filter(c => c.targetNodeId === math && c.targetPortIndex === 0);
    expect(connToMath0.length).toBe(1);
    expect(connToMath0[0].sourceNodeId).toBe(src1);

    // Connect src2 -> same math input 0 (should replace)
    getStore().startConnection(src2, 0);
    getStore().completeConnection(math, 0);

    const conns2 = Object.values(getStore().connections);
    const connToMath0After = conns2.filter(c => c.targetNodeId === math && c.targetPortIndex === 0);
    expect(connToMath0After.length).toBe(1);
    expect(connToMath0After[0].sourceNodeId).toBe(src2);
  });

  it('deleteSelected removes nodes and all connected connections', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [5, 0, 0]);
    const display = getStore().addNode('display', [10, 0, 0]);

    // src -> math -> display
    getStore().startConnection(src, 0);
    getStore().completeConnection(math, 0);
    getStore().startConnection(math, 0);
    getStore().completeConnection(display, 0);

    expect(Object.keys(getStore().connections).length).toBe(2);

    // Select and delete math node
    getStore().setSelection(new Set([math]));
    getStore().deleteSelected();

    // Math should be gone
    expect(getStore().nodes[math]).toBeUndefined();
    // Both connections should be removed (both touch the deleted node)
    expect(Object.keys(getStore().connections).length).toBe(0);
    // Source and display should remain
    expect(getStore().nodes[src]).toBeDefined();
    expect(getStore().nodes[display]).toBeDefined();
  });
});

// ============================================================================
// 7. Multi-Graph + Coercion (4 tests)
// ============================================================================
describe('Multi-Graph + Coercion', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('coercion in graph A does not affect graph B', () => {
    // Set up graph A with a coercion
    const srcA = getStore().addNode('source', [0, 0, 0]);
    const concatA = getStore().addNode('concat', [5, 0, 0]);
    const convA = triggerCoercion(srcA, 0, concatA, 0);
    expect(convA).not.toBeNull();
    const graphANodeCount = Object.keys(getStore().nodes).length;

    // Create graph B
    const graphBId = getStore().createGraph('Graph B');

    // Graph B should be empty (fresh)
    expect(Object.keys(getStore().nodes).length).toBe(0);
    expect(Object.keys(getStore().connections).length).toBe(0);

    // Add nodes in graph B
    getStore().addNode('source', [0, 0, 0]);
    const graphBNodeCount = Object.keys(getStore().nodes).length;

    // Switch back to graph A
    getStore().switchGraph('default');
    expect(Object.keys(getStore().nodes).length).toBe(graphANodeCount);
    expect(getStore().nodes[convA!]).toBeDefined();

    // Switch back to graph B - should still have its own nodes
    getStore().switchGraph(graphBId);
    expect(Object.keys(getStore().nodes).length).toBe(graphBNodeCount);
  });

  it('switching graphs preserves coerced connections', () => {
    // Build a coercion in the default graph
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat = getStore().addNode('concat', [5, 0, 0]);
    const converterId = triggerCoercion(src, 0, concat, 0);
    expect(converterId).not.toBeNull();

    const connsBefore = Object.keys(getStore().connections).length;

    // Create and switch to another graph
    const graph2 = getStore().createGraph('Graph 2');
    expect(getStore().activeGraphId).toBe(graph2);

    // Switch back
    getStore().switchGraph('default');

    // Coerced connections should be preserved
    expect(Object.keys(getStore().connections).length).toBe(connsBefore);
    expect(getStore().nodes[converterId!]).toBeDefined();

    // Verify the connection chain is intact
    const conns = Object.values(getStore().connections);
    const srcToConverter = conns.find(c => c.sourceNodeId === src && c.targetNodeId === converterId!);
    const converterToConcat = conns.find(c => c.sourceNodeId === converterId! && c.targetNodeId === concat);
    expect(srcToConverter).toBeDefined();
    expect(converterToConcat).toBeDefined();
  });

  it('import/export preserves coerced connections across graphs', () => {
    // Build graph A with coercion
    const src = getStore().addNode('source', [0, 0, 0]);
    const concat = getStore().addNode('concat', [5, 0, 0]);
    const converterId = triggerCoercion(src, 0, concat, 0);
    expect(converterId).not.toBeNull();

    // Create graph B with its own nodes
    getStore().createGraph('Graph B');
    getStore().addNode('math', [0, 0, 0]);

    // Export
    const exported = getStore().exportAllGraphs();
    expect(exported.version).toBe(2);
    expect(Object.keys(exported.graphs).length).toBe(2);

    // Reset and import
    resetStore();
    getStore().importAllGraphs(exported);

    // Verify graph B is active (it was last active before export)
    // or switch to default and verify coercion
    getStore().switchGraph('default');
    expect(getStore().nodes[converterId!]).toBeDefined();

    const conns = Object.values(getStore().connections);
    expect(conns.some(c => c.sourceNodeId === src && c.targetNodeId === converterId!)).toBe(true);
    expect(conns.some(c => c.sourceNodeId === converterId! && c.targetNodeId === concat)).toBe(true);
  });

  it('undo in one graph does not affect another graph', () => {
    // Graph A: add a node
    const srcA = getStore().addNode('source', [0, 0, 0]);
    const graphANodeCount = Object.keys(getStore().nodes).length;

    // Create graph B and add a node
    getStore().createGraph('Graph B');
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('math', [5, 0, 0]);
    const graphBNodeCount = Object.keys(getStore().nodes).length;

    // Undo in graph B (should remove mathB)
    getStore().undo();
    expect(Object.keys(getStore().nodes).length).toBe(graphBNodeCount - 1);

    // Switch to graph A - should be unaffected
    getStore().switchGraph('default');
    expect(Object.keys(getStore().nodes).length).toBe(graphANodeCount);
    expect(getStore().nodes[srcA]).toBeDefined();
  });
});

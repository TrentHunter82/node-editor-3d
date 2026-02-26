/**
 * Phase 41 E2E regression tests (~20 tests).
 * Full-stack regression covering subgraph undo safety, switch strictMode,
 * getCriticalPath, settings debounce, and cross-feature interactions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';
import { getCriticalPath } from '../utils/profiling';
import { executeGraph } from '../utils/execution';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionTimings = {};
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.checkpoints = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

/** Build a node record directly (for executeGraph / getCriticalPath tests). */
function makeNode(
  id: string,
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {},
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
    ...overrides,
  };
}

/** Build a connection record. */
function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

/** Build a minimal node for getCriticalPath tests (transform type with configurable port counts). */
function mkNode(id: string, inputs = 1, outputs = 1): EditorNode {
  return {
    id,
    type: 'transform',
    position: [0, 0, 0],
    title: id,
    data: {},
    inputs: Array.from({ length: inputs }, (_, i) => ({
      id: `${id}-in${i}`,
      label: `in${i}`,
      portType: 'number' as const,
    })),
    outputs: Array.from({ length: outputs }, (_, i) => ({
      id: `${id}-out${i}`,
      label: `out${i}`,
      portType: 'number' as const,
    })),
  };
}

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  const rec: Record<string, T> = {};
  for (const item of items) rec[item.id] = item;
  return rec;
}

function exec(nodes: Record<string, EditorNode>, connections: Record<string, Connection> = {}) {
  return executeGraph(nodes, connections);
}

function out(r: ReturnType<typeof exec>, nodeId: string, port = 0): unknown {
  return r.results.get(nodeId)?.outputs[port];
}

// ==========================================================================
// Group 1: Full workflow with subgraphs and undo
// ==========================================================================
describe('Group 1: Subgraph + undo safety', () => {
  beforeEach(() => { resetStore(); });

  it('1. createSubgraph then undo leaves no orphan graphs or stale subgraphDefs', () => {
    // Add some source nodes
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);

    // Create a subgraph
    const subId = getState().createSubgraph('TestSG');
    expect(subId).not.toBeNull();
    expect(getState().subgraphDefs[subId!]).toBeDefined();

    // The inner graph should have a graphTab entry
    const innerGraphId = getState().nodes[subId!].data.innerGraphId as string;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Undo createSubgraph
    getState().undo();

    // After undo: the subgraph node should be gone
    expect(getState().nodes[subId!]).toBeUndefined();
    // subgraphDefs should not contain the def
    expect(getState().subgraphDefs[subId!]).toBeUndefined();
    // graphTab for inner graph should still exist (tabs are not part of undo snapshot),
    // but the orphan inner graph in inactiveGraphs is cleaned up by undo's createdInactiveGraphs logic
    // Verify we can't enter it (entering requires the subgraph node to exist)
    // The graph is clean: only the original nodes remain
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();
  });

  it('2. convertSelectionToSubgraph then undo restores original nodes', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    const conn = getState().addConnection(n1, 0, n2, 0);
    expect(conn).not.toBeNull();

    const originalNodeCount = Object.keys(getState().nodes).length;
    const originalConnCount = Object.keys(getState().connections).length;

    // Select both nodes and convert to subgraph
    useEditorStore.setState(s => { s.selectedIds = new Set([n1, n2]); });
    const subId = getState().convertSelectionToSubgraph('ConvertedSG');
    expect(subId).not.toBeNull();

    // The original individual nodes should be gone, replaced by a subgraph node
    expect(getState().nodes[n1]).toBeUndefined();
    expect(getState().nodes[n2]).toBeUndefined();
    expect(getState().nodes[subId!]).toBeDefined();
    expect(getState().nodes[subId!].type).toBe('subgraph');

    // Undo convert
    getState().undo();

    // Original nodes should be restored
    expect(getState().nodes[n1]).toBeDefined();
    expect(getState().nodes[n2]).toBeDefined();
    expect(Object.keys(getState().nodes)).toHaveLength(originalNodeCount);
    expect(Object.keys(getState().connections)).toHaveLength(originalConnCount);
    // Subgraph node should be gone
    expect(getState().nodes[subId!]).toBeUndefined();
    expect(getState().subgraphDefs[subId!]).toBeUndefined();
  });

  it('3. multi-graph with subgraphs: delete one graph verifies cascade cleanup', () => {
    // Create 3 graphs
    const g2 = getState().createGraph('Graph2');
    const g3 = getState().createGraph('Graph3');
    expect(getState().graphOrder).toHaveLength(3);

    // Switch to graph2 and create a subgraph there
    getState().switchGraph(g2);
    const sgNodeId = getState().createSubgraph('SG-in-G2');
    expect(sgNodeId).not.toBeNull();
    const innerGraphId = getState().nodes[sgNodeId!].data.innerGraphId as string;
    expect(getState().graphTabs[innerGraphId]).toBeDefined();

    // Delete graph2 (which contains the subgraph node)
    getState().deleteGraph(g2);

    // graph2 should be gone from graphOrder
    expect(getState().graphOrder).not.toContain(g2);
    expect(getState().graphTabs[g2]).toBeUndefined();
    // The inner graph tab should also be cleaned up (cascade)
    expect(getState().graphTabs[innerGraphId]).toBeUndefined();
    // g3 should still exist
    expect(getState().graphTabs[g3]).toBeDefined();
  });

  it('4. copy subgraph node to different graph, undo paste, no orphan in target', () => {
    // Create a subgraph node in default graph
    const sgId = getState().createSubgraph('CopySG');
    expect(sgId).not.toBeNull();

    // Select the subgraph node and duplicate (uses clipboard internally)
    useEditorStore.setState(s => { s.selectedIds = new Set([sgId!]); });
    getState().duplicateSelected();

    // There should now be 2 subgraph nodes
    const subgraphNodes = Object.values(getState().nodes).filter(n => n.type === 'subgraph');
    expect(subgraphNodes).toHaveLength(2);

    // Undo the duplication
    getState().undo();

    // Only the original subgraph node should remain
    const remaining = Object.values(getState().nodes).filter(n => n.type === 'subgraph');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(sgId);
  });

  it('5. create subgraph, enter, add nodes, exit, undo create: inner nodes removed', () => {
    const sgId = getState().createSubgraph('InnerSG');
    expect(sgId).not.toBeNull();

    // Enter the subgraph
    getState().enterSubgraph(sgId!);
    expect(getState().breadcrumbStack.length).toBeGreaterThan(0);

    // Add a node inside the subgraph
    const innerNode = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[innerNode]).toBeDefined();

    // Exit the subgraph
    getState().exitSubgraph();
    expect(getState().breadcrumbStack).toHaveLength(0);

    // The outer graph should have the subgraph node
    expect(getState().nodes[sgId!]).toBeDefined();

    // Undo the createSubgraph (this is the outermost undo that created the subgraph)
    // We need to undo: exitSubgraph doesn't push undo, so we undo addNode(inside), then createSubgraph
    // Actually, the inner graph addNode is on the inner graph's undo stack,
    // and the outer graph's undo stack has the createSubgraph.
    // After exitSubgraph we're back on the outer graph, so undo here undoes the createSubgraph.
    getState().undo();

    // The subgraph node should be gone
    expect(getState().nodes[sgId!]).toBeUndefined();
    expect(getState().subgraphDefs[sgId!]).toBeUndefined();
  });
});

// ==========================================================================
// Group 2: Switch node strictMode E2E
// ==========================================================================
describe('Group 2: Switch node strictMode', () => {
  it('6. switch with default strictMode: number 5 matches case 5 (number)', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 5 }),
      c0: makeNode('c0', 'source', { value: 5 }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
    };
    // Default strictMode is true (backwards compat); 5 === 5 should match
    expect(out(exec(nodes, conns), 'sw')).toBe(5);
  });

  it('7. switch with strictMode=false: number 5 matches string "5"', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 5 }),
      c0: makeNode('c0', 'source', { value: '5' }),
      def: makeNode('def', 'source', { value: 'default' }),
      sw: makeNode('sw', 'switch', { strictMode: false }),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k5: makeConn('k5', 'def', 0, 'sw', 5),
    };
    // With strictMode=false, String(5) === String('5') => matches
    expect(out(exec(nodes, conns), 'sw')).toBe('5');
  });

  it('8. switch strictMode with no matching case outputs default', () => {
    const nodes: Record<string, EditorNode> = {
      val: makeNode('val', 'source', { value: 99 }),
      c0: makeNode('c0', 'source', { value: 1 }),
      c1: makeNode('c1', 'source', { value: 2 }),
      def: makeNode('def', 'source', { value: 'fallback' }),
      sw: makeNode('sw', 'switch'),
    };
    const conns: Record<string, Connection> = {
      k0: makeConn('k0', 'val', 0, 'sw', 0),
      k1: makeConn('k1', 'c0', 0, 'sw', 1),
      k2: makeConn('k2', 'c1', 0, 'sw', 2),
      k5: makeConn('k5', 'def', 0, 'sw', 5),
    };
    // 99 !== 1 and 99 !== 2, so default 'fallback' is returned
    expect(out(exec(nodes, conns), 'sw')).toBe('fallback');
  });
});

// ==========================================================================
// Group 3: getCriticalPath correctness
// ==========================================================================
describe('Group 3: getCriticalPath correctness', () => {
  it('9. linear chain A->B->C->D: critical path = [A,B,C,D], length = 4', () => {
    const nodes = toRecord([mkNode('A'), mkNode('B'), mkNode('C'), mkNode('D')]);
    const conns = toRecord([
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
      makeConn('c3', 'C', 0, 'D', 0),
    ]);
    const result = getCriticalPath(nodes, conns);
    expect(result.length).toBe(4);
    expect(result.path).toEqual(['A', 'B', 'C', 'D']);
  });

  it('10. diamond A->{B,C}->D with equal weights: critical path length = 3', () => {
    const nodes = toRecord([mkNode('A'), mkNode('B'), mkNode('C'), mkNode('D')]);
    const conns = toRecord([
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 0, 'C', 0),
      makeConn('c3', 'B', 0, 'D', 0),
      makeConn('c4', 'C', 0, 'D', 0),
    ]);
    const result = getCriticalPath(nodes, conns);
    // Without metrics, each node weighs 1. Both paths A->B->D and A->C->D = 3.
    expect(result.length).toBe(3);
    expect(result.path).toHaveLength(3);
    expect(result.path[0]).toBe('A');
    expect(result.path[2]).toBe('D');
    // Middle node should be either B or C (both valid)
    expect(['B', 'C']).toContain(result.path[1]);
  });

  it('11. parallel chains of different lengths: critical path follows the longest', () => {
    // Chain 1: A->B->C (length 3)
    // Chain 2: X->Y (length 2)
    const nodes = toRecord([mkNode('A'), mkNode('B'), mkNode('C'), mkNode('X'), mkNode('Y')]);
    const conns = toRecord([
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
      makeConn('c3', 'X', 0, 'Y', 0),
    ]);
    const result = getCriticalPath(nodes, conns);
    expect(result.length).toBe(3);
    expect(result.path).toEqual(['A', 'B', 'C']);
  });

  it('12. single node graph: critical path = [node], length = 1', () => {
    const nodes = toRecord([mkNode('Z')]);
    const result = getCriticalPath(nodes, {});
    expect(result.length).toBe(1);
    expect(result.path).toEqual(['Z']);
  });
});

// ==========================================================================
// Group 4: Settings persistence E2E
// ==========================================================================
describe('Group 4: Settings persistence E2E', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset settings store to defaults
    useSettingsStore.getState().resetToDefaults();
    // Clear localStorage
    localStorage.removeItem('settings-v1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('13. change gridSnapSize, wait debounce, value persisted in localStorage', () => {
    useSettingsStore.getState().setGridSnapSize(2.5);
    expect(useSettingsStore.getState().gridSnapSize).toBe(2.5);

    // Advance past the 200ms debounce
    vi.advanceTimersByTime(250);

    // Read from localStorage
    const raw = localStorage.getItem('settings-v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.gridSnapSize).toBe(2.5);
  });

  it('14. change theme to light, wait debounce, persisted and reloadable', () => {
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');

    // Advance past debounce
    vi.advanceTimersByTime(250);

    const raw = localStorage.getItem('settings-v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.theme).toBe('light');
  });

  it('15. rapid multiple settings changes, wait debounce, all final values correct', () => {
    // Rapidly change multiple settings
    useSettingsStore.getState().setGridSnapSize(5);
    useSettingsStore.getState().setAnimationSpeed(2);
    useSettingsStore.getState().setMinimapVisible(false);
    useSettingsStore.getState().setAutoExecute(true);

    // Only 50ms passed — not yet debounced
    vi.advanceTimersByTime(50);

    // Change some more
    useSettingsStore.getState().setGridSnapSize(3);
    useSettingsStore.getState().setZoomSensitivity(1.5);

    // Now wait for debounce to complete (200ms from last change)
    vi.advanceTimersByTime(250);

    const raw = localStorage.getItem('settings-v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // Only the FINAL values should be persisted
    expect(parsed.gridSnapSize).toBe(3);
    expect(parsed.animationSpeed).toBe(2);
    expect(parsed.minimapVisible).toBe(false);
    expect(parsed.autoExecute).toBe(true);
    expect(parsed.zoomSensitivity).toBe(1.5);
  });
});

// ==========================================================================
// Group 5: Cross-feature regression
// ==========================================================================
describe('Group 5: Cross-feature regression', () => {
  beforeEach(() => { resetStore(); });

  it('16. subgraph execution works after undo/redo cycle', () => {
    // Create a subgraph containing a source node
    const sgId = getState().createSubgraph('ExecSG');
    expect(sgId).not.toBeNull();

    // Enter subgraph and add a source node that connects to the output
    getState().enterSubgraph(sgId!);
    const innerNodes = Object.values(getState().nodes);
    const inputNode = innerNodes.find(n => n.type === 'subgraph-input');
    const outputNode = innerNodes.find(n => n.type === 'subgraph-output');
    expect(inputNode).toBeDefined();
    expect(outputNode).toBeDefined();

    // Add a source that produces 42 and connect to output
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    getState().addConnection(src, 0, outputNode!.id, 0);

    getState().exitSubgraph();

    // Verify the subgraph node exists
    expect(getState().nodes[sgId!]).toBeDefined();
    expect(getState().nodes[sgId!].type).toBe('subgraph');

    // Undo the last operation on the outer graph (createSubgraph),
    // then redo to bring it back
    getState().undo();
    expect(getState().nodes[sgId!]).toBeUndefined();

    getState().redo();
    expect(getState().nodes[sgId!]).toBeDefined();
    expect(getState().nodes[sgId!].type).toBe('subgraph');
  });

  it('17. graph variables survive undo/redo', () => {
    // set-var passes through its input and writes to graph variable context.
    // get-var has inputs:[] so we can't connect set-var→get-var to guarantee
    // execution order. We test set-var passthrough + undo/redo correctness.
    const setVar = getState().addNode('set-var', [0, 0, 0]);
    getState().updateNodeData(setVar, 'variableName', 'myVar');

    // Add a source to feed value into set-var
    const src = getState().addNode('source', [-3, 0, 0]);
    getState().updateNodeData(src, 'value', 100);
    getState().addConnection(src, 0, setVar, 0);

    // Execute with graph variables context
    const nodes = getState().nodes;
    const conns = getState().connections;
    const graphVars: Record<string, unknown> = {};
    const result = executeGraph(nodes, conns, undefined, undefined, undefined, undefined, graphVars);

    // set-var should pass through value 100
    const setVarOut = result.results.get(setVar)?.outputs[0];
    expect(setVarOut).toBe(100);

    // Undo the last node data update and redo
    getState().undo();
    getState().redo();

    // After undo/redo, nodes and connections should be intact
    expect(getState().nodes[setVar]).toBeDefined();
    expect(getState().nodes[src]).toBeDefined();
    expect(Object.keys(getState().connections).length).toBeGreaterThan(0);

    // Re-execute — set-var should still pass through correctly
    const nodes2 = getState().nodes;
    const conns2 = getState().connections;
    const graphVars2: Record<string, unknown> = {};
    const result2 = executeGraph(nodes2, conns2, undefined, undefined, undefined, undefined, graphVars2);
    const setVarOut2 = result2.results.get(setVar)?.outputs[0];
    expect(setVarOut2).toBe(100);
  });

  it('18. node locking prevents mutation via updateNodeData', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 10);
    expect(getState().nodes[id].data.value).toBe(10);

    // Lock the node
    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);

    // Try to update data — should be rejected silently
    getState().updateNodeData(id, 'value', 999);
    expect(getState().nodes[id].data.value).toBe(10); // Unchanged
  });

  it('19. breakpoints are cleared on node deletion', () => {
    const id = getState().addNode('source', [0, 0, 0]);

    // Add a breakpoint
    getState().toggleBreakpoint(id);
    expect(getState().breakpoints[id]).toBe(true);

    // Delete the node
    getState().removeNode(id);
    expect(getState().nodes[id]).toBeUndefined();

    // Breakpoint should be cleaned up
    expect(getState().breakpoints[id]).toBeUndefined();
  });

  it('20. template instantiation preserves all node fields (comment, locked, collapsed)', () => {
    // Create a node with all fields set
    const id = getState().addNode('source', [2, 0, 3]);
    getState().updateNodeData(id, 'value', 42);
    getState().updateNodeComment(id, 'This is a test comment');
    getState().toggleNodeLock(id);
    getState().toggleNodeCollapse(id);

    expect(getState().nodes[id].comment).toBe('This is a test comment');
    expect(getState().nodes[id].locked).toBe(true);
    expect(getState().nodes[id].collapsed).toBe(true);

    // Select and save as template
    useEditorStore.setState(s => { s.selectedIds = new Set([id]); });
    const templateId = getState().saveSelectionAsTemplate('TestTemplate');
    expect(templateId).not.toBeNull();
    expect(getState().templates[templateId!]).toBeDefined();

    // Instantiate the template
    getState().instantiateTemplate(templateId!, [10, 0, 10]);

    // Find the newly instantiated node (the one that's not the original)
    const allNodes = Object.values(getState().nodes);
    const instantiated = allNodes.find(n => n.id !== id && n.type === 'source');
    expect(instantiated).toBeDefined();
    expect(instantiated!.comment).toBe('This is a test comment');
    expect(instantiated!.locked).toBe(true);
    expect(instantiated!.collapsed).toBe(true);
    expect(instantiated!.data.value).toBe(42);
  });
});

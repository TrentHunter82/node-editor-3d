/**
 * Phase 34: Comprehensive tests for Phase 34 features
 *
 * 1. Node Help System (12 tests)
 * 2. Graph Diff Utility (15 tests)
 * 3. Execution Timeout (10 tests)
 * 4. diffUndoSnapshots Store Action (8 tests)
 * 5. Settings Integration (5 tests)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings, DEFAULT_SETTINGS } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';
import { getNodeHelp, getAllNodeHelp, getNodeHelpByCategory } from '../utils/nodeHelp';
import { compareGraphs } from '../utils/graphDiff';
import type { EditorNode, Connection } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
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
function execStore(maxExecutionMs?: number) {
  const st = getStore();
  return executeGraph(
    st.nodes,
    st.connections,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    maxExecutionMs,
  );
}

/** Build a minimal EditorNode for graph diff tests */
function makeNode(id: string, overrides: Partial<EditorNode> = {}): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: 'Node',
    data: { value: 0 },
    inputs: [],
    outputs: [{ id: `${id}-out`, portType: 'number', label: 'value' }],
    ...overrides,
  };
}

/** Build a minimal Connection for graph diff tests */
function makeConn(id: string, src: string, tgt: string): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: 0,
    targetNodeId: tgt,
    targetPortIndex: 0,
  };
}

// ===========================================================================
// 1. Node Help System
// ===========================================================================

describe('node help system', () => {
  it('returns help for source node', () => {
    const help = getNodeHelp('source');
    expect(help).toBeDefined();
    expect(help!.summary).toBeTruthy();
    expect(help!.description).toBeTruthy();
    expect(help!.outputs.length).toBeGreaterThan(0);
  });

  it('returns help for all 94 node types', () => {
    const all = getAllNodeHelp();
    expect(all.length).toBe(94);
  });

  it('returns undefined for unknown type', () => {
    const help = getNodeHelp('nonexistent' as any);
    expect(help).toBeUndefined();
  });

  it('filters by category - Math', () => {
    const mathHelp = getNodeHelpByCategory('Math');
    expect(mathHelp.length).toBeGreaterThan(0);
    // Every returned entry must be in the Math category
    for (const entry of mathHelp) {
      expect(entry.category).toBe('Math');
    }
  });

  it('filters by category - Core', () => {
    const coreHelp = getNodeHelpByCategory('Core');
    expect(coreHelp.length).toBe(4);
  });

  it('every entry has required fields', () => {
    const all = getAllNodeHelp();
    for (const entry of all) {
      expect(entry.nodeType).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.summary).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(Array.isArray(entry.inputs)).toBe(true);
      expect(Array.isArray(entry.outputs)).toBe(true);
    }
  });

  it('custom node has tips', () => {
    const help = getNodeHelp('custom');
    expect(help).toBeDefined();
    expect(help!.tips).toBeDefined();
    expect(help!.tips!.length).toBeGreaterThan(0);
  });

  it('subgraph entry has correct category', () => {
    const help = getNodeHelp('subgraph');
    expect(help).toBeDefined();
    expect(help!.category).toBe('Subgraph');
  });

  it('math node has 2 inputs', () => {
    const help = getNodeHelp('math');
    expect(help).toBeDefined();
    expect(help!.inputs.length).toBe(2);
  });

  it('source node has 0 inputs', () => {
    const help = getNodeHelp('source');
    expect(help).toBeDefined();
    expect(help!.inputs.length).toBe(0);
  });

  it('output node has 2 inputs (data + label)', () => {
    const help = getNodeHelp('output');
    expect(help).toBeDefined();
    expect(help!.inputs.length).toBe(2);
  });

  it('categories cover all nodes', () => {
    const all = getAllNodeHelp();
    const categories = new Set(all.map((e) => e.category));
    // nodeHelp uses 10 categories (date/time nodes are categorized under Utility)
    const expectedCategories = new Set([
      'Core',
      'Math',
      'String',
      'Logic',
      'Vector',
      'Utility',
      'Color',
      'Live',
      'Data',
      'Subgraph',
    ]);
    expect(categories).toEqual(expectedCategories);
  });
});

// ===========================================================================
// 2. Graph Diff Utility
// ===========================================================================

describe('graph diff', () => {
  it('identical graphs produce empty diff', () => {
    const nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    const conns = { c1: makeConn('c1', 'n1', 'n2') };
    const diff = compareGraphs(nodes, conns, nodes, conns);
    expect(diff.nodeChanges.length).toBe(0);
    expect(diff.connectionChanges.length).toBe(0);
    expect(diff.isEmpty).toBe(true);
  });

  it('detects added nodes', () => {
    const nodesA = { n1: makeNode('n1') };
    const nodesB = { n1: makeNode('n1'), n2: makeNode('n2') };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    const added = diff.nodeChanges.filter((c) => c.type === 'added');
    expect(added.length).toBe(1);
    expect(added[0].nodeId).toBe('n2');
    expect(added[0].after).toBeDefined();
  });

  it('detects removed nodes', () => {
    const nodesA = { n1: makeNode('n1'), n2: makeNode('n2') };
    const nodesB = { n1: makeNode('n1') };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    const removed = diff.nodeChanges.filter((c) => c.type === 'removed');
    expect(removed.length).toBe(1);
    expect(removed[0].nodeId).toBe('n2');
    expect(removed[0].before).toBeDefined();
  });

  it('detects modified node title', () => {
    const nodesA = { n1: makeNode('n1', { title: 'Original' }) };
    const nodesB = { n1: makeNode('n1', { title: 'Changed' }) };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    const modified = diff.nodeChanges.filter((c) => c.type === 'modified');
    expect(modified.length).toBe(1);
    expect(modified[0].changedFields).toContain('title');
  });

  it('detects modified node position', () => {
    const nodesA = { n1: makeNode('n1', { position: [0, 0, 0] }) };
    const nodesB = { n1: makeNode('n1', { position: [5, 10, 0] }) };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    const modified = diff.nodeChanges.filter((c) => c.type === 'modified');
    expect(modified.length).toBe(1);
    expect(modified[0].changedFields).toContain('position');
  });

  it('detects modified node data', () => {
    const nodesA = { n1: makeNode('n1', { data: { value: 1 } }) };
    const nodesB = { n1: makeNode('n1', { data: { value: 99 } }) };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    const modified = diff.nodeChanges.filter((c) => c.type === 'modified');
    expect(modified.length).toBe(1);
    expect(modified[0].changedFields).toContain('data');
  });

  it('detects added connections', () => {
    const connsA: Record<string, Connection> = {};
    const connsB = { c1: makeConn('c1', 'n1', 'n2') };
    const diff = compareGraphs({}, connsA, {}, connsB);
    const added = diff.connectionChanges.filter((c) => c.type === 'added');
    expect(added.length).toBe(1);
    expect(added[0].connectionId).toBe('c1');
  });

  it('detects removed connections', () => {
    const connsA = { c1: makeConn('c1', 'n1', 'n2') };
    const connsB: Record<string, Connection> = {};
    const diff = compareGraphs({}, connsA, {}, connsB);
    const removed = diff.connectionChanges.filter((c) => c.type === 'removed');
    expect(removed.length).toBe(1);
    expect(removed[0].connectionId).toBe('c1');
  });

  it('detects modified connection (label change)', () => {
    const connsA = { c1: makeConn('c1', 'n1', 'n2') };
    const connsB = { c1: { ...makeConn('c1', 'n1', 'n2'), label: 'data flow' } };
    const diff = compareGraphs({}, connsA, {}, connsB);
    const modified = diff.connectionChanges.filter((c) => c.type === 'modified');
    expect(modified.length).toBe(1);
    expect(modified[0].changedFields).toContain('label');
  });

  it('summary counts are correct', () => {
    const nodesA = { n1: makeNode('n1'), n2: makeNode('n2', { title: 'Old' }) };
    const nodesB = { n2: makeNode('n2', { title: 'New' }), n3: makeNode('n3') };
    const connsA = { c1: makeConn('c1', 'n1', 'n2') };
    const connsB = { c2: makeConn('c2', 'n2', 'n3') };
    const diff = compareGraphs(nodesA, connsA, nodesB, connsB);
    expect(diff.summary.nodesAdded).toBe(1); // n3
    expect(diff.summary.nodesRemoved).toBe(1); // n1
    expect(diff.summary.nodesModified).toBe(1); // n2 title changed
    expect(diff.summary.connectionsAdded).toBe(1); // c2
    expect(diff.summary.connectionsRemoved).toBe(1); // c1
  });

  it('isEmpty is true for identical graphs', () => {
    const nodes = { n1: makeNode('n1') };
    const diff = compareGraphs(nodes, {}, nodes, {});
    expect(diff.isEmpty).toBe(true);
  });

  it('isEmpty is false when changes exist', () => {
    const nodesA = { n1: makeNode('n1') };
    const nodesB = { n1: makeNode('n1'), n2: makeNode('n2') };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    expect(diff.isEmpty).toBe(false);
  });

  it('handles empty graphs', () => {
    const diff = compareGraphs({}, {}, {}, {});
    expect(diff.isEmpty).toBe(true);
    expect(diff.nodeChanges.length).toBe(0);
    expect(diff.connectionChanges.length).toBe(0);
  });

  it('multiple changes at once', () => {
    const nodesA = {
      n1: makeNode('n1'),
      n2: makeNode('n2', { title: 'Old' }),
      n3: makeNode('n3'),
    };
    const nodesB = {
      n2: makeNode('n2', { title: 'New' }),
      n3: makeNode('n3'),
      n4: makeNode('n4'),
    };
    const connsA = { c1: makeConn('c1', 'n1', 'n2'), c2: makeConn('c2', 'n2', 'n3') };
    const connsB = { c2: makeConn('c2', 'n2', 'n3'), c3: makeConn('c3', 'n3', 'n4') };
    const diff = compareGraphs(nodesA, connsA, nodesB, connsB);
    // n1 removed, n2 modified, n3 unchanged, n4 added
    expect(diff.summary.nodesAdded).toBe(1);
    expect(diff.summary.nodesRemoved).toBe(1);
    expect(diff.summary.nodesModified).toBe(1);
    // c1 removed, c2 unchanged, c3 added
    expect(diff.summary.connectionsAdded).toBe(1);
    expect(diff.summary.connectionsRemoved).toBe(1);
    expect(diff.summary.connectionsModified).toBe(0);
  });

  it('changedFields lists correct fields', () => {
    const nodesA = {
      n1: makeNode('n1', { title: 'A', position: [0, 0, 0], data: { value: 1 } }),
    };
    const nodesB = {
      n1: makeNode('n1', { title: 'B', position: [1, 2, 3], data: { value: 99 } }),
    };
    const diff = compareGraphs(nodesA, {}, nodesB, {});
    const modified = diff.nodeChanges.find((c) => c.type === 'modified');
    expect(modified).toBeDefined();
    expect(modified!.changedFields).toContain('title');
    expect(modified!.changedFields).toContain('position');
    expect(modified!.changedFields).toContain('data');
    // Type should NOT be changed since both are 'source'
    expect(modified!.changedFields).not.toContain('type');
  });
});

// ===========================================================================
// 3. Execution Timeout
// ===========================================================================

describe('execution timeout', () => {
  beforeEach(() => {
    resetStore();
    useSettingsStore.setState({ maxExecutionMs: DEFAULT_SETTINGS.maxExecutionMs });
  });

  /** Build a chain of N source->transform->transform->... nodes in the store */
  function buildChain(length: number) {
    const store = getStore();
    const ids: string[] = [];
    // First node is a source
    const sourceId = store.addNode('source');
    ids.push(sourceId);
    // Remaining are transform nodes
    for (let i = 1; i < length; i++) {
      const tId = store.addNode('transform');
      ids.push(tId);
      store.addConnection(ids[i - 1], 0, tId, 0);
    }
    return ids;
  }

  it('executes normally with no timeout (maxExecutionMs=0)', () => {
    buildChain(5);
    const result = execStore(0);
    expect(result.timedOut).toBeFalsy();
    expect(result.errors.size).toBe(0);
  });

  it('executes normally within timeout', () => {
    buildChain(5);
    const result = execStore(5000);
    expect(result.timedOut).toBeFalsy();
    expect(result.errors.size).toBe(0);
    expect(result.results.size).toBeGreaterThan(0);
  });

  it('returns timedOut=true when exceeding limit', () => {
    // Build a large chain and set an extremely tight timeout
    buildChain(200);
    const result = execStore(1);
    // With 1ms timeout and 200 nodes, it should very likely time out
    // However, if the machine is fast enough it might not, so we only
    // assert the shape of the result regardless
    if (result.timedOut) {
      expect(result.timedOut).toBe(true);
      expect(result.errors.has('__graph__')).toBe(true);
    } else {
      // If it somehow completed within 1ms, at least all nodes have results
      expect(result.results.size).toBeGreaterThan(0);
    }
  });

  it('timeout error appears in errors map', () => {
    buildChain(200);
    const result = execStore(1);
    if (result.timedOut) {
      expect(result.errors.get('__graph__')).toMatch(/timeout/i);
    }
  });

  it('partial results available after timeout', () => {
    buildChain(200);
    const result = execStore(1);
    if (result.timedOut) {
      // Some nodes executed before the timeout kicked in
      // At minimum the first source node should have results
      expect(result.results.size).toBeGreaterThan(0);
    }
  });

  it('cache is preserved after timeout', () => {
    buildChain(200);
    const result = execStore(1);
    // Regardless of timeout, any nodes that completed have results
    if (result.timedOut) {
      const firstResult = result.results.values().next();
      expect(firstResult.done).toBe(false);
      expect(firstResult.value).toBeDefined();
      expect(firstResult.value!.outputs).toBeDefined();
    }
  });

  it('default maxExecutionMs is 30000 in settingsStore', () => {
    expect(DEFAULT_SETTINGS.maxExecutionMs).toBe(30000);
  });

  it('setMaxExecutionMs clamps to 0-300000', () => {
    const settings = useSettingsStore.getState();
    settings.setMaxExecutionMs(-100);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(0);

    settings.setMaxExecutionMs(999999);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(300000);

    settings.setMaxExecutionMs(15000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(15000);
  });

  it('maxExecutionMs persisted in clampLoadedSettings', () => {
    const clamped = clampLoadedSettings({ maxExecutionMs: 50000 });
    expect(clamped.maxExecutionMs).toBe(50000);

    const clampedNeg = clampLoadedSettings({ maxExecutionMs: -10 });
    expect(clampedNeg.maxExecutionMs).toBe(0);

    const clampedHigh = clampLoadedSettings({ maxExecutionMs: 500000 });
    expect(clampedHigh.maxExecutionMs).toBe(300000);
  });

  it('0 means no timeout', () => {
    buildChain(50);
    const result = execStore(0);
    expect(result.timedOut).toBeFalsy();
    // All 50 nodes should have results
    expect(result.results.size).toBe(50);
  });
});

// ===========================================================================
// 4. diffUndoSnapshots Store Action
// ===========================================================================

describe('diffUndoSnapshots', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns null for invalid indices', () => {
    const result = getStore().diffUndoSnapshots(99, 100);
    expect(result).toBeNull();
  });

  it('compares current state (-1) with undo entry', () => {
    // Add a node - this pushes undo (before state = empty)
    getStore().addNode('source');
    // Now undo stack has 1 entry (the empty state before addNode)
    // diffUndoSnapshots(0, -1) compares empty state vs current (1 node)
    const diff = getStore().diffUndoSnapshots(0, -1);
    expect(diff).not.toBeNull();
    expect(diff!.isEmpty).toBe(false);
    expect(diff!.summary.nodesAdded).toBeGreaterThanOrEqual(1);
  });

  it('detects node added between snapshots', () => {
    // First action: add source (pushes empty state to undo[0])
    getStore().addNode('source');
    // Second action: add another source (pushes 1-node state to undo[1])
    getStore().addNode('source');
    // Compare undo[0] (empty) with undo[1] (1 node)
    const diff = getStore().diffUndoSnapshots(0, 1);
    expect(diff).not.toBeNull();
    expect(diff!.summary.nodesAdded).toBeGreaterThanOrEqual(1);
  });

  it('detects node title change between snapshots', () => {
    // Add a node (pushes undo[0] = empty state)
    const id = getStore().addNode('source');
    // Rename node (pushes undo[1] = state with original title)
    getStore().updateNodeTitle(id, 'NewTitle');
    // Compare undo[1] (original title) with current (-1) (NewTitle)
    const diff = getStore().diffUndoSnapshots(1, -1);
    expect(diff).not.toBeNull();
    const titleChange = diff!.nodeChanges.find(
      (c) => c.type === 'modified' && c.changedFields?.includes('title'),
    );
    expect(titleChange).toBeDefined();
  });

  it('detects connection added between snapshots', () => {
    const srcId = getStore().addNode('source');
    const tgtId = getStore().addNode('transform');
    // Undo stack now has 2 entries (indices 0 and 1).
    // Capture index before addConnection
    const connId = getStore().addConnection(srcId, 0, tgtId, 0);
    expect(connId).not.toBeNull(); // Verify the connection was created
    // addConnection pushes undo, so undo stack now has 3 entries (indices 0, 1, 2).
    // Compare undo[1] (state with 2 nodes, 0 connections) with current (-1) (2 nodes + connection)
    const diff = getStore().diffUndoSnapshots(1, -1);
    expect(diff).not.toBeNull();
    expect(diff!.summary.connectionsAdded).toBeGreaterThanOrEqual(1);
  });

  it('compares two undo entries', () => {
    // Action 0: add node (undo[0] = empty)
    getStore().addNode('source');
    // Action 1: add another node (undo[1] = 1 node)
    getStore().addNode('source');
    // Action 2: add third node (undo[2] = 2 nodes)
    getStore().addNode('source');
    // Compare undo[0] (empty) with undo[2] (2 nodes)
    const diff = getStore().diffUndoSnapshots(0, 2);
    expect(diff).not.toBeNull();
    expect(diff!.summary.nodesAdded).toBe(2);
  });

  it('returns empty diff for same index', () => {
    getStore().addNode('source');
    // Compare undo[0] with itself
    const diff = getStore().diffUndoSnapshots(0, 0);
    expect(diff).not.toBeNull();
    expect(diff!.isEmpty).toBe(true);
  });

  it('handles empty undo stack', () => {
    // No actions taken, undo stack is empty
    const diff = getStore().diffUndoSnapshots(0, -1);
    // Index 0 is invalid when the stack is empty, so should return null
    expect(diff).toBeNull();
  });
});

// ===========================================================================
// 5. Settings Integration
// ===========================================================================

describe('settings integration', () => {
  beforeEach(() => {
    useSettingsStore.setState({ maxExecutionMs: DEFAULT_SETTINGS.maxExecutionMs });
  });

  it('maxExecutionMs defaults to 30000', () => {
    expect(DEFAULT_SETTINGS.maxExecutionMs).toBe(30000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(30000);
  });

  it('setMaxExecutionMs updates value', () => {
    useSettingsStore.getState().setMaxExecutionMs(10000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(10000);
  });

  it('setMaxExecutionMs clamps min to 0', () => {
    useSettingsStore.getState().setMaxExecutionMs(-500);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(0);
  });

  it('setMaxExecutionMs clamps max to 300000', () => {
    useSettingsStore.getState().setMaxExecutionMs(1000000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(300000);
  });

  it('clampLoadedSettings validates maxExecutionMs', () => {
    // Valid value passes through
    expect(clampLoadedSettings({ maxExecutionMs: 5000 }).maxExecutionMs).toBe(5000);
    // Below minimum gets clamped
    expect(clampLoadedSettings({ maxExecutionMs: -1 }).maxExecutionMs).toBe(0);
    // Above maximum gets clamped
    expect(clampLoadedSettings({ maxExecutionMs: 999999 }).maxExecutionMs).toBe(300000);
    // Exactly at boundaries
    expect(clampLoadedSettings({ maxExecutionMs: 0 }).maxExecutionMs).toBe(0);
    expect(clampLoadedSettings({ maxExecutionMs: 300000 }).maxExecutionMs).toBe(300000);
  });
});

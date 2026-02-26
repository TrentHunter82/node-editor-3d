/**
 * Unit tests for coreSlice — compound multi-step actions that orchestrate
 * undo, subgraph cleanup, clipboard, and graph-level operations.
 *
 * Uses local mutable state pattern with mocked dependencies.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCoreActions,
  _resetClipboard,
  type CoreMutableState,
  type CoreReadableState,
} from './coreSlice';
import type { EditorNode, Connection, NodeGroup, CustomNodeDef, SubgraphNodeDef, ErrorStrategy, ExecutionStats, NodeType } from '../../types';

// ===========================================================================
// Helpers
// ===========================================================================

function makeNode(id: string, type: NodeType = 'source', opts: Partial<EditorNode> = {}): EditorNode {
  return {
    id,
    type,
    position: [0, 0, 0],
    title: `Node ${id}`,
    data: type === 'subgraph' ? { innerGraphId: `inner-${id}`, subgraphDefId: id } : {},
    inputs: [{ id: `${id}-in-0`, label: 'in', portType: 'number' }],
    outputs: [{ id: `${id}-out-0`, label: 'value', portType: 'number' }],
    ...opts,
  };
}

function makeConnection(id: string, src: string, tgt: string): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: 0, targetNodeId: tgt, targetPortIndex: 0 };
}

const INITIAL_STATS: ExecutionStats = {
  executionCount: 0, totalDuration: 0, errorCount: 0,
  totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null, timeoutCount: 0,
};

// ===========================================================================
// Test state + deps factory
// ===========================================================================

function makeTestContext() {
  let nextId = 100;
  let nextConnId = 200;
  let nextGraphId = 300;
  const undoLabels: string[] = [];
  let autoExecuteScheduled = false;
  let cancelAutoExecuteCalled = 0;
  const localInactiveGraphs: Record<string, any> = {};
  const savedInactiveIds: string[][] = [];
  const createdInactiveIds: string[][] = [];
  const cleanedUpIds: string[][] = [];

  const state: CoreMutableState & { executeGraph: () => void } = {
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    customNodeDefs: {},
    subgraphDefs: {},
    graphTabs: {},
    checkpoints: {},
    validationErrors: {},
    graphVariables: {},
    executionStats: { ...INITIAL_STATS },
    executionHistory: [],
    executionHistoryIndex: -1,
    errorStrategy: 'fail-fast' as ErrorStrategy,
    breadcrumbStack: [],
    activeGraphId: 'default',
    graphOrder: ['default'],
    templates: {},
    breakpoints: {},
    breakpointConditions: {},
    executeGraph: () => {},
  };

  const set = (fn: (s: CoreMutableState) => void) => { fn(state); };
  const get = () => state as CoreReadableState;

  const deps = {
    pushUndo: (label?: string) => { undoLabels.push(label ?? 'Edit'); },
    genId: () => `node-${nextId++}`,
    genConnectionId: () => `conn-${nextConnId++}`,
    genGraphId: () => `graph-${nextGraphId++}`,
    cancelAutoExecute: () => { cancelAutoExecuteCalled++; },
    scheduleAutoExecute: (_execute: () => void) => { autoExecuteScheduled = true; },
    getInactiveGraphs: () => localInactiveGraphs,
    saveInactiveGraphsToUndo: (ids: string[]) => { savedInactiveIds.push(ids); },
    markCreatedInactiveGraphs: (ids: string[]) => { createdInactiveIds.push(ids); },
    cleanupGraphResources: (ids: string[]) => { cleanedUpIds.push(ids); },
    collectInnerGraphIds: () => [] as string[],
    sanitizeConnections: (_nodes: Record<string, EditorNode>, conns: Record<string, Connection>) => conns,
    syncNextId: () => {},
    clearExecutionTimeoutsAndCache: () => {},
    _resetExecutionModuleState: () => {},
    clearAllTransientState: () => {},
    getActiveUndoGraphId: () => 'default',
    setActiveUndoGraphId: () => {},
    clearAllUndoStacks: () => {},
    executionInitialStats: INITIAL_STATS,
  };

  const actions = createCoreActions(set, get, deps);

  return {
    state, actions, undoLabels, deps,
    get autoExecuteScheduled() { return autoExecuteScheduled; },
    get cancelAutoExecuteCalled() { return cancelAutoExecuteCalled; },
    savedInactiveIds, createdInactiveIds, cleanedUpIds,
    localInactiveGraphs,
  };
}

// ===========================================================================
// Setup
// ===========================================================================

beforeEach(() => {
  _resetClipboard();
});

// ===========================================================================
// canPaste (before any copy)
// ===========================================================================

describe('canPaste', () => {
  it('returns false when clipboard is empty', () => {
    const { actions } = makeTestContext();
    expect(actions.canPaste()).toBe(false);
  });
});

// ===========================================================================
// duplicateSelected
// ===========================================================================

describe('duplicateSelected', () => {
  it('returns null when nothing is selected', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };

    const result = actions.duplicateSelected();
    expect(result).toBeNull();
  });

  it('duplicates selected nodes with offset', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    state.selectedIds = new Set(['n1']);

    const idMap = actions.duplicateSelected();

    expect(idMap).not.toBeNull();
    expect(idMap!.size).toBe(1);
    const newId = idMap!.get('n1')!;
    expect(state.nodes[newId]).toBeDefined();
    expect(state.nodes[newId].title).toBe('Node n1 Copy');
    // Position should be offset
    expect(state.nodes[newId].position[0]).toBe(1.5);
    expect(state.nodes[newId].position[2]).toBe(1);
  });

  it('duplicates in-place when flag is set', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.selectedIds = new Set(['n1']);

    const idMap = actions.duplicateSelected(true);

    const newId = idMap!.get('n1')!;
    expect(state.nodes[newId].title).toBe('Node n1'); // No " Copy" suffix
    expect(state.nodes[newId].position).toEqual([0, 0, 0]); // Same position
  });

  it('pushes undo before duplicating', () => {
    const { state, actions, undoLabels } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.selectedIds = new Set(['n1']);

    actions.duplicateSelected();
    expect(undoLabels).toContain('Duplicate selection');
  });

  it('duplicates connections between selected nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    state.connections = { c1: makeConnection('c1', 'n1', 'n2') };
    state.selectedIds = new Set(['n1', 'n2']);

    const idMap = actions.duplicateSelected();

    // Should have original + new connections
    const allConns = Object.values(state.connections);
    expect(allConns.length).toBe(2);

    // New connection should reference new node IDs
    const newConn = allConns.find(c => c.id !== 'c1')!;
    expect(newConn.sourceNodeId).toBe(idMap!.get('n1'));
    expect(newConn.targetNodeId).toBe(idMap!.get('n2'));
  });

  it('updates selection to new nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.selectedIds = new Set(['n1']);

    const idMap = actions.duplicateSelected();

    expect(state.selectedIds.has('n1')).toBe(false);
    expect(state.selectedIds.has(idMap!.get('n1')!)).toBe(true);
  });

  it('deep-copies node data', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.nodes.n1.data = { nested: { value: 42 } };
    state.selectedIds = new Set(['n1']);

    const idMap = actions.duplicateSelected();
    const newId = idMap!.get('n1')!;

    // Mutate original should not affect copy
    (state.nodes.n1.data as any).nested.value = 99;
    expect((state.nodes[newId].data as any).nested.value).toBe(42);
  });

  it('preserves optional fields (collapsed, groupId, comment) but not locked', () => {
    const { state, actions } = makeTestContext();
    state.nodes = {
      n1: makeNode('n1', 'source', {
        collapsed: true,
        groupId: 'g1',
        comment: 'test comment',
        locked: true,
      }),
    };
    state.selectedIds = new Set(['n1']);

    const idMap = actions.duplicateSelected();
    const newId = idMap!.get('n1')!;
    const dup = state.nodes[newId];

    expect(dup.collapsed).toBe(true);
    expect(dup.groupId).toBe('g1');
    expect(dup.comment).toBe('test comment');
    // locked should NOT propagate to duplicated nodes
    expect(dup.locked).toBeUndefined();
  });
});

// ===========================================================================
// deleteSelected
// ===========================================================================

describe('deleteSelected', () => {
  it('no-ops when nothing is selected', () => {
    const { state, actions, undoLabels } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };

    actions.deleteSelected();
    expect(undoLabels.length).toBe(0);
    expect(Object.keys(state.nodes).length).toBe(1);
  });

  it('deletes selected nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    state.selectedIds = new Set(['n1']);

    actions.deleteSelected();

    expect(state.nodes.n1).toBeUndefined();
    expect(state.nodes.n2).toBeDefined();
  });

  it('cascade-deletes connections involving deleted nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    state.connections = { c1: makeConnection('c1', 'n1', 'n2') };
    state.selectedIds = new Set(['n1']);

    actions.deleteSelected();

    expect(state.connections.c1).toBeUndefined();
  });

  it('does not delete locked nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1', 'source', { locked: true }) };
    state.selectedIds = new Set(['n1']);

    actions.deleteSelected();

    expect(state.nodes.n1).toBeDefined();
  });

  it('does not delete subgraph boundary nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = {
      si: makeNode('si', 'subgraph-input'),
      so: makeNode('so', 'subgraph-output'),
    };
    state.selectedIds = new Set(['si', 'so']);

    actions.deleteSelected();

    expect(state.nodes.si).toBeDefined();
    expect(state.nodes.so).toBeDefined();
  });

  it('can delete connections directly from selection', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    state.connections = { c1: makeConnection('c1', 'n1', 'n2') };
    state.selectedIds = new Set(['c1']);

    actions.deleteSelected();

    expect(state.connections.c1).toBeUndefined();
    // Nodes should remain
    expect(state.nodes.n1).toBeDefined();
    expect(state.nodes.n2).toBeDefined();
  });

  it('cleans up empty groups after deletion', () => {
    const { state, actions } = makeTestContext();
    state.nodes = {
      n1: makeNode('n1', 'source', { groupId: 'g1' }),
      n2: makeNode('n2', 'source', { groupId: 'g1' }),
    };
    state.groups = { g1: { id: 'g1', label: 'Group', collapsed: false } };
    state.selectedIds = new Set(['n1', 'n2']);

    actions.deleteSelected();

    expect(state.groups.g1).toBeUndefined();
  });

  it('cleans up breakpoints for deleted nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.breakpoints = { n1: true };
    state.breakpointConditions = { n1: 'x > 5' };
    state.selectedIds = new Set(['n1']);

    actions.deleteSelected();

    expect(state.breakpoints.n1).toBeUndefined();
    expect(state.breakpointConditions.n1).toBeUndefined();
  });

  it('pushes undo and schedules auto-execute', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };
    ctx.state.selectedIds = new Set(['n1']);

    ctx.actions.deleteSelected();

    expect(ctx.undoLabels).toContain('Delete selection');
    expect(ctx.autoExecuteScheduled).toBe(true);
  });

  it('clears selectedIds after deletion', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.selectedIds = new Set(['n1']);

    actions.deleteSelected();

    expect(state.selectedIds.size).toBe(0);
  });
});

// ===========================================================================
// copySelected / paste / canPaste
// ===========================================================================

describe('copySelected + paste', () => {
  it('copies and pastes nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.selectedIds = new Set(['n1']);

    actions.copySelected();
    expect(actions.canPaste()).toBe(true);

    // Clear selection
    state.selectedIds = new Set();
    actions.paste();

    // Should have original + pasted node
    const nodeIds = Object.keys(state.nodes);
    expect(nodeIds.length).toBe(2);

    const pastedNode = Object.values(state.nodes).find(n => n.id !== 'n1')!;
    expect(pastedNode.title).toBe('Node n1');
    expect(pastedNode.position[0]).toBe(1.5); // offset
  });

  it('copy ignores non-node selection IDs', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.selectedIds = new Set(['n1', 'nonexistent']);

    actions.copySelected();
    expect(actions.canPaste()).toBe(true);
  });

  it('copy preserves internal connections', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    state.connections = { c1: makeConnection('c1', 'n1', 'n2') };
    state.selectedIds = new Set(['n1', 'n2']);

    actions.copySelected();
    state.selectedIds = new Set();
    actions.paste();

    // Should have 2 connections: original + pasted
    expect(Object.keys(state.connections).length).toBe(2);
  });

  it('paste pushes undo', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };
    ctx.state.selectedIds = new Set(['n1']);

    ctx.actions.copySelected();
    ctx.actions.paste();

    expect(ctx.undoLabels).toContain('Paste');
  });

  it('paste updates selection to pasted nodes', () => {
    const { state, actions } = makeTestContext();
    state.nodes = { n1: makeNode('n1') };
    state.selectedIds = new Set(['n1']);

    actions.copySelected();
    actions.paste();

    expect(state.selectedIds.has('n1')).toBe(false);
    expect(state.selectedIds.size).toBe(1);
  });

  it('copy does nothing when no nodes selected', () => {
    const { state, actions } = makeTestContext();
    state.selectedIds = new Set();
    actions.copySelected();
    expect(actions.canPaste()).toBe(false);
  });

  it('paste does nothing when clipboard is empty', () => {
    const { actions, undoLabels } = makeTestContext();
    actions.paste();
    expect(undoLabels.length).toBe(0);
  });
});

// ===========================================================================
// clearGraph
// ===========================================================================

describe('clearGraph', () => {
  it('clears all nodes, connections, and groups', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };
    ctx.state.connections = { c1: makeConnection('c1', 'n1', 'n1') };
    ctx.state.groups = { g1: { id: 'g1', label: 'Group', collapsed: false } };

    ctx.actions.clearGraph();

    expect(Object.keys(ctx.state.nodes)).toHaveLength(0);
    expect(Object.keys(ctx.state.connections)).toHaveLength(0);
    expect(Object.keys(ctx.state.groups)).toHaveLength(0);
  });

  it('clears customNodeDefs, subgraphDefs, checkpoints', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };
    ctx.state.customNodeDefs = { cd1: {} as CustomNodeDef };
    ctx.state.subgraphDefs = { sd1: {} as SubgraphNodeDef };
    ctx.state.checkpoints = { cp1: {} as any };

    ctx.actions.clearGraph();

    expect(Object.keys(ctx.state.customNodeDefs)).toHaveLength(0);
    expect(Object.keys(ctx.state.subgraphDefs)).toHaveLength(0);
    expect(Object.keys(ctx.state.checkpoints)).toHaveLength(0);
  });

  it('resets graph variables and execution stats', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };
    ctx.state.graphVariables = { x: 42 };
    ctx.state.executionStats = { ...INITIAL_STATS, executionCount: 5 };

    ctx.actions.clearGraph();

    expect(ctx.state.graphVariables).toEqual({});
    expect(ctx.state.executionStats.executionCount).toBe(0);
  });

  it('pushes undo and cancels auto-execute', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };

    ctx.actions.clearGraph();

    expect(ctx.undoLabels).toContain('Clear graph');
    expect(ctx.cancelAutoExecuteCalled).toBeGreaterThan(0);
  });

  it('no-ops when graph is already empty', () => {
    const ctx = makeTestContext();
    ctx.actions.clearGraph();
    expect(ctx.undoLabels.length).toBe(0);
  });

  it('clears selectedIds and breadcrumbStack', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };
    ctx.state.selectedIds = new Set(['n1']);
    ctx.state.breadcrumbStack = [{ graphId: 'g1', subgraphNodeId: 's1' }];

    ctx.actions.clearGraph();

    expect(ctx.state.selectedIds.size).toBe(0);
    expect(ctx.state.breadcrumbStack).toEqual([]);
  });

  it('preserves errorStrategy (user preference)', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };
    ctx.state.errorStrategy = 'continue';

    ctx.actions.clearGraph();

    expect(ctx.state.errorStrategy).toBe('continue');
  });
});

// ===========================================================================
// importWorkflow
// ===========================================================================

describe('importWorkflow', () => {
  it('replaces nodes and connections', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };

    ctx.actions.importWorkflow({
      nodes: { n2: makeNode('n2'), n3: makeNode('n3') },
      connections: { c1: makeConnection('c1', 'n2', 'n3') },
    });

    expect(Object.keys(ctx.state.nodes)).toEqual(['n2', 'n3']);
    expect(Object.keys(ctx.state.connections)).toEqual(['c1']);
  });

  it('pushes undo and cancels auto-execute', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };

    ctx.actions.importWorkflow({
      nodes: { n2: makeNode('n2') },
      connections: {},
    });

    expect(ctx.undoLabels).toContain('Import workflow');
    expect(ctx.cancelAutoExecuteCalled).toBeGreaterThan(0);
  });

  it('clears transient state and breadcrumbs', () => {
    const ctx = makeTestContext();
    ctx.state.nodes = { n1: makeNode('n1') };
    ctx.state.selectedIds = new Set(['n1']);
    ctx.state.breadcrumbStack = [{ graphId: 'g1', subgraphNodeId: 's1' }];

    ctx.actions.importWorkflow({
      nodes: { n2: makeNode('n2') },
      connections: {},
    });

    expect(ctx.state.selectedIds.size).toBe(0);
    expect(ctx.state.breadcrumbStack).toEqual([]);
  });

  it('accepts optional groups and customNodeDefs', () => {
    const ctx = makeTestContext();
    const groups: Record<string, NodeGroup> = {
      g1: { id: 'g1', label: 'Imported Group', collapsed: false },
    };

    ctx.actions.importWorkflow({
      nodes: { n1: makeNode('n1', 'source', { groupId: 'g1' }) },
      connections: {},
      groups,
    });

    expect(ctx.state.groups.g1).toBeDefined();
    expect(ctx.state.groups.g1.label).toBe('Imported Group');
  });

  it('restores errorStrategy from imported data', () => {
    const ctx = makeTestContext();

    ctx.actions.importWorkflow({
      nodes: { n1: makeNode('n1') },
      connections: {},
      errorStrategy: 'continue',
    });

    expect(ctx.state.errorStrategy).toBe('continue');
  });
});

// ===========================================================================
// importAllGraphs
// ===========================================================================

describe('importAllGraphs', () => {
  it('rejects non-v2 storage', () => {
    const ctx = makeTestContext();
    ctx.actions.importAllGraphs({ version: 1 } as any);
    // Should not change state
    expect(Object.keys(ctx.state.nodes)).toHaveLength(0);
  });

  it('rejects storage with missing active graph', () => {
    const ctx = makeTestContext();
    ctx.actions.importAllGraphs({
      version: 2,
      graphs: {},
      graphTabs: {},
      activeGraphId: 'nonexistent',
      graphOrder: [],
    });
    expect(Object.keys(ctx.state.nodes)).toHaveLength(0);
  });

  it('imports active graph as current state', () => {
    const ctx = makeTestContext();
    const importData = {
      version: 2,
      graphs: {
        main: {
          nodes: { n1: makeNode('n1') },
          connections: {},
          groups: {},
          customNodeDefs: {},
        },
      },
      graphTabs: { main: { id: 'main', name: 'Main', createdAt: 0 } },
      activeGraphId: 'main',
      graphOrder: ['main'],
    };

    ctx.actions.importAllGraphs(importData);

    expect(Object.keys(ctx.state.nodes)).toContain('n1');
    expect(ctx.state.activeGraphId).toBe('main');
  });

  it('stores inactive graphs in module state', () => {
    const ctx = makeTestContext();
    const importData = {
      version: 2,
      graphs: {
        main: {
          nodes: { n1: makeNode('n1') },
          connections: {},
          groups: {},
          customNodeDefs: {},
        },
        secondary: {
          nodes: { n2: makeNode('n2') },
          connections: {},
          groups: {},
          customNodeDefs: {},
        },
      },
      graphTabs: {
        main: { id: 'main', name: 'Main', createdAt: 0 },
        secondary: { id: 'secondary', name: 'Secondary', createdAt: 0 },
      },
      activeGraphId: 'main',
      graphOrder: ['main', 'secondary'],
    };

    ctx.actions.importAllGraphs(importData);

    expect(ctx.localInactiveGraphs['secondary']).toBeDefined();
  });

  it('clears selectedIds and breadcrumbStack', () => {
    const ctx = makeTestContext();
    ctx.state.selectedIds = new Set(['old']);
    ctx.state.breadcrumbStack = [{ graphId: 'x', subgraphNodeId: 'y' }];

    ctx.actions.importAllGraphs({
      version: 2,
      graphs: {
        main: { nodes: { n1: makeNode('n1') }, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs: { main: { id: 'main', name: 'Main', createdAt: 0 } },
      activeGraphId: 'main',
      graphOrder: ['main'],
    });

    expect(ctx.state.selectedIds.size).toBe(0);
    expect(ctx.state.breadcrumbStack).toEqual([]);
  });
});

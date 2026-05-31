/**
 * Unit tests for checkpointSlice — named checkpoint (snapshot) management.
 *
 * Tests createCheckpoint, restoreCheckpoint, and deleteCheckpoint.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCheckpointActions } from './checkpointSlice';
import type { EditorNode, Connection, NodeGroup, CheckpointEntry } from '../../types';

// Mock migrateAllNodes — checkpoint restore calls it on restored nodes
vi.mock('../../utils/nodeVersioning', () => ({
  migrateAllNodes: vi.fn(() => 0),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTestNode(id: string, overrides?: Partial<EditorNode>): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: `Node ${id}`,
    data: { value: 1 },
    inputs: [],
    outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
    ...overrides,
  };
}

function makeConnection(id: string, src: string, tgt: string): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: 0,
    targetNodeId: tgt,
    targetPortIndex: 0,
  };
}

function makeGroup(id: string, label: string): NodeGroup {
  return { id, label, collapsed: false };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('createCheckpointActions', () => {
  let state: {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    groups: Record<string, NodeGroup>;
    customNodeDefs: Record<string, any>;
    subgraphDefs: Record<string, any>;
    graphVariables: Record<string, unknown>;
    checkpoints: Record<string, CheckpointEntry>;
    graphTabs: Record<string, any>;
    templates: Record<string, any>;
    selectedIds: Set<string>;
    executionHistory: any[];
    validationErrors: Record<string, any>;
    executionStats: any;
    breadcrumbStack: any[];
  };

  let undoPushed: number;
  let undoLabels: string[];
  let cancelAutoExecuteCalled: number;
  let syncNextIdCalled: number;
  let clearCacheCalled: number;
  let clearTransientCalled: number;
  let nextCheckpointId: number;

  const executionInitialStats = {
    executionCount: 0,
    totalDuration: 0,
    errorCount: 0,
    totalCacheHits: 0,
    totalNodesExecuted: 0,
    lastExecutedAt: null,
    timeoutCount: 0,
  };

  let actions: ReturnType<typeof createCheckpointActions>;

  beforeEach(() => {
    state = {
      nodes: {
        n1: makeTestNode('n1'),
        n2: makeTestNode('n2'),
      },
      connections: {
        c1: makeConnection('c1', 'n1', 'n2'),
      },
      groups: {
        g1: makeGroup('g1', 'Group 1'),
      },
      customNodeDefs: {},
      subgraphDefs: {},
      graphVariables: { myVar: 'hello' },
      checkpoints: {},
      graphTabs: { main: { id: 'main', name: 'Main', createdAt: 0 } },
      templates: {},
      selectedIds: new Set(['n1']),
      executionHistory: [{ id: 'exec-1' }],
      validationErrors: { n1: 'some error' },
      executionStats: { executionCount: 5 },
      breadcrumbStack: [{ id: 'crumb' }],
    };

    undoPushed = 0;
    undoLabels = [];
    cancelAutoExecuteCalled = 0;
    syncNextIdCalled = 0;
    clearCacheCalled = 0;
    clearTransientCalled = 0;
    nextCheckpointId = 1;

    const set = (fn: (s: typeof state) => void) => { fn(state); };
    const get = () => state;

    const helpers = {
      pushUndo: (label?: string) => { undoPushed++; if (label) undoLabels.push(label); },
      cancelAutoExecute: () => { cancelAutoExecuteCalled++; },
      syncNextId: () => { syncNextIdCalled++; },
      clearExecutionTimeoutsAndCache: () => { clearCacheCalled++; },
      clearAllTransientState: (_s: any) => { clearTransientCalled++; },
      getActiveUndoGraphId: () => 'main',
      genCheckpointId: () => `cp-${nextCheckpointId++}`,
      executionInitialStats,
    };

    actions = createCheckpointActions(
      set as unknown as Parameters<typeof createCheckpointActions>[0],
      get as unknown as Parameters<typeof createCheckpointActions>[1],
      helpers,
    );
  });

  // ========================================================================
  // createCheckpoint
  // ========================================================================
  describe('createCheckpoint', () => {
    it('captures snapshot of nodes, connections, groups', () => {
      const id = actions.createCheckpoint('Snapshot 1');
      expect(id).toBe('cp-1');
      const cp = state.checkpoints['cp-1'];
      expect(cp).toBeDefined();
      expect(cp.label).toBe('Snapshot 1');
      expect(cp.snapshot.nodes.n1).toBeDefined();
      expect(cp.snapshot.nodes.n2).toBeDefined();
      expect(cp.snapshot.connections.c1).toBeDefined();
      expect(cp.snapshot.groups.g1).toBeDefined();
    });

    it('captures customNodeDefs, subgraphDefs, graphVariables in snapshot', () => {
      state.customNodeDefs = { def1: { id: 'def1', name: 'Custom' } };
      state.subgraphDefs = { sg1: { id: 'sg1', name: 'Subgraph' } };
      state.graphVariables = { x: 10 };
      const id = actions.createCheckpoint('Full');
      const cp = state.checkpoints[id];
      expect(cp.snapshot.customNodeDefs).toEqual({ def1: { id: 'def1', name: 'Custom' } });
      expect(cp.snapshot.subgraphDefs).toEqual({ sg1: { id: 'sg1', name: 'Subgraph' } });
      expect(cp.snapshot.graphVariables).toEqual({ x: 10 });
    });

    it('creates deep copy of snapshot (mutation safe)', () => {
      const id = actions.createCheckpoint('Deep');
      // Mutate original state
      state.nodes.n1.data.value = 999;
      // Snapshot should retain the original
      expect(state.checkpoints[id].snapshot.nodes.n1.data.value).toBe(1);
    });

    it('pushes undo', () => {
      actions.createCheckpoint('Test');
      expect(undoPushed).toBe(1);
      expect(undoLabels).toContain('Create checkpoint');
    });

    it('stores createdAt timestamp', () => {
      const before = Date.now();
      const id = actions.createCheckpoint('Timed');
      const after = Date.now();
      expect(state.checkpoints[id].createdAt).toBeGreaterThanOrEqual(before);
      expect(state.checkpoints[id].createdAt).toBeLessThanOrEqual(after);
    });

    it('enforces MAX_CHECKPOINTS limit (removes oldest)', () => {
      // Create 20 checkpoints with staggered times
      for (let i = 0; i < 20; i++) {
        const id = actions.createCheckpoint(`CP ${i}`);
        // Manually set createdAt so we can predict which is oldest
        state.checkpoints[id].createdAt = 1000 + i;
      }
      expect(Object.keys(state.checkpoints)).toHaveLength(20);

      // The 21st should evict the oldest (createdAt = 1000, label "CP 0")
      const newId = actions.createCheckpoint('CP 20');
      expect(Object.keys(state.checkpoints)).toHaveLength(20);
      // "CP 0" should have been removed (it had the lowest createdAt)
      const labels = Object.values(state.checkpoints).map(cp => cp.label);
      expect(labels).not.toContain('CP 0');
      expect(labels).toContain('CP 20');
      expect(state.checkpoints[newId]).toBeDefined();
    });

    it('returns the checkpoint ID', () => {
      const id = actions.createCheckpoint('Return');
      expect(id).toBe('cp-1');
    });
  });

  // ========================================================================
  // restoreCheckpoint
  // ========================================================================
  describe('restoreCheckpoint', () => {
    let checkpointId: string;

    beforeEach(() => {
      checkpointId = actions.createCheckpoint('Restore point');
      // Modify state after checkpoint
      state.nodes.n3 = makeTestNode('n3');
      state.connections.c2 = makeConnection('c2', 'n2', 'n3');
      delete state.groups.g1;
      undoPushed = 0;
      undoLabels = [];
      cancelAutoExecuteCalled = 0;
    });

    it('restores nodes, connections, groups from checkpoint', () => {
      // Verify state was modified
      expect(state.nodes.n3).toBeDefined();
      expect(state.connections.c2).toBeDefined();
      expect(state.groups.g1).toBeUndefined();

      actions.restoreCheckpoint(checkpointId);

      // Should be restored to checkpoint state
      expect(state.nodes.n3).toBeUndefined();
      expect(state.connections.c2).toBeUndefined();
      expect(state.groups.g1).toBeDefined();
      expect(state.groups.g1.label).toBe('Group 1');
      expect(state.nodes.n1).toBeDefined();
      expect(state.nodes.n2).toBeDefined();
      expect(state.connections.c1).toBeDefined();
    });

    it('clears transient state', () => {
      state.selectedIds = new Set(['n1', 'n2']);
      state.executionHistory = [{ id: 'some' }];
      state.validationErrors = { n1: 'err' };
      state.breadcrumbStack = [{ id: 'b' }];

      actions.restoreCheckpoint(checkpointId);

      expect(state.selectedIds.size).toBe(0);
      expect(state.executionHistory).toEqual([]);
      expect(state.validationErrors).toEqual({});
      expect(state.breadcrumbStack).toEqual([]);
      expect(state.executionStats).toEqual(executionInitialStats);
      expect(clearTransientCalled).toBe(1);
    });

    it('calls cancelAutoExecute', () => {
      actions.restoreCheckpoint(checkpointId);
      expect(cancelAutoExecuteCalled).toBe(1);
    });

    it('pushes undo with label', () => {
      actions.restoreCheckpoint(checkpointId);
      expect(undoPushed).toBe(1);
      expect(undoLabels[0]).toContain('Restore checkpoint');
      expect(undoLabels[0]).toContain('Restore point');
    });

    it('syncs next ID counter', () => {
      actions.restoreCheckpoint(checkpointId);
      expect(syncNextIdCalled).toBe(1);
    });

    it('clears execution timeouts and cache', () => {
      actions.restoreCheckpoint(checkpointId);
      expect(clearCacheCalled).toBe(1);
    });

    it('no-ops for nonexistent checkpoint', () => {
      const nodesBefore = { ...state.nodes };
      actions.restoreCheckpoint('nonexistent');
      expect(state.nodes).toEqual(nodesBefore);
      expect(undoPushed).toBe(0);
      expect(cancelAutoExecuteCalled).toBe(0);
    });
  });

  // ========================================================================
  // deleteCheckpoint
  // ========================================================================
  describe('deleteCheckpoint', () => {
    it('removes checkpoint', () => {
      const id = actions.createCheckpoint('ToDelete');
      undoPushed = 0;
      expect(state.checkpoints[id]).toBeDefined();
      actions.deleteCheckpoint(id);
      expect(state.checkpoints[id]).toBeUndefined();
    });

    it('pushes undo', () => {
      const id = actions.createCheckpoint('WillDelete');
      undoPushed = 0;
      undoLabels = [];
      actions.deleteCheckpoint(id);
      expect(undoPushed).toBe(1);
      expect(undoLabels).toContain('Delete checkpoint');
    });

    it('no-ops for nonexistent checkpoint', () => {
      const countBefore = Object.keys(state.checkpoints).length;
      undoPushed = 0;
      actions.deleteCheckpoint('nonexistent');
      expect(Object.keys(state.checkpoints).length).toBe(countBefore);
      expect(undoPushed).toBe(0);
    });
  });
});

/**
 * Checkpoint slice — named checkpoint (snapshot) management.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - createCheckpoint (save named graph snapshot)
 * - restoreCheckpoint (restore graph from checkpoint)
 * - deleteCheckpoint (remove a checkpoint)
 */
import type { EditorNode, Connection, NodeGroup, CheckpointEntry, ExecutionStats } from '../../types';
import type { EditorState } from '../editorStore';
import { migrateAllNodes } from '../../utils/nodeVersioning';

interface CheckpointHelpers {
  pushUndo: (label?: string) => void;
  cancelAutoExecute: () => void;
  syncNextId: (nodes: Record<string, EditorNode>, connections: Record<string, Connection>, groups?: Record<string, NodeGroup>, extraKeys?: string[]) => void;
  clearExecutionTimeoutsAndCache: (graphId: string) => void;
  clearAllTransientState: (state: EditorState) => void;
  getActiveUndoGraphId: () => string;
  genCheckpointId: () => string;
  executionInitialStats: ExecutionStats;
}

const MAX_CHECKPOINTS = 20;

export function createCheckpointActions(
  set: (fn: (state: EditorState) => void) => void,
  get: () => EditorState,
  helpers: CheckpointHelpers,
) {
  const { pushUndo, cancelAutoExecute, syncNextId, clearExecutionTimeoutsAndCache, clearAllTransientState, getActiveUndoGraphId, genCheckpointId, executionInitialStats } = helpers;

  return {
    createCheckpoint: (label: string): string => {
      const state = get();
      pushUndo('Create checkpoint');
      const id = genCheckpointId();
      // Capture snapshot from get() BEFORE set() — structuredClone cannot clone immer drafts
      const snapshot = structuredClone({
        nodes: state.nodes,
        connections: state.connections,
        groups: state.groups,
        customNodeDefs: state.customNodeDefs,
        subgraphDefs: state.subgraphDefs,
        graphVariables: state.graphVariables,
      });
      set(s => {
        // Enforce max limit — remove oldest if at capacity
        const keys = Object.keys(s.checkpoints);
        if (keys.length >= MAX_CHECKPOINTS) {
          let oldestKey = keys[0];
          let oldestTime = s.checkpoints[keys[0]].createdAt;
          for (const k of keys) {
            if (s.checkpoints[k].createdAt < oldestTime) {
              oldestKey = k;
              oldestTime = s.checkpoints[k].createdAt;
            }
          }
          delete s.checkpoints[oldestKey];
        }
        s.checkpoints[id] = {
          id,
          label,
          createdAt: Date.now(),
          snapshot,
        };
      });
      return id;
    },

    restoreCheckpoint: (checkpointId: string): void => {
      const state = get();
      const checkpoint = state.checkpoints[checkpointId] as CheckpointEntry | undefined;
      if (!checkpoint) return;
      cancelAutoExecute();
      pushUndo(`Restore checkpoint: ${checkpoint.label}`);
      // Sync ID counter to prevent collisions with restored entities
      syncNextId(checkpoint.snapshot.nodes, checkpoint.snapshot.connections, checkpoint.snapshot.groups, [
        ...Object.keys(state.graphTabs),
        ...Object.keys(state.templates),
      ]);
      clearExecutionTimeoutsAndCache(getActiveUndoGraphId());
      const restoredNodes = structuredClone(checkpoint.snapshot.nodes);
      migrateAllNodes(restoredNodes);
      set(s => {
        s.nodes = restoredNodes;
        s.connections = structuredClone(checkpoint.snapshot.connections);
        s.groups = structuredClone(checkpoint.snapshot.groups);
        s.customNodeDefs = structuredClone(checkpoint.snapshot.customNodeDefs);
        s.subgraphDefs = structuredClone(checkpoint.snapshot.subgraphDefs);
        s.graphVariables = structuredClone(checkpoint.snapshot.graphVariables ?? {});
        // Clear transient state (matches undo pattern)
        s.selectedIds = new Set<string>();
        clearAllTransientState(s);
        s.executionHistory = [];
        s.validationErrors = {};
        s.executionStats = executionInitialStats;
        s.breadcrumbStack = [];
      });
    },

    deleteCheckpoint: (checkpointId: string): void => {
      const state = get();
      if (!state.checkpoints[checkpointId]) return;
      pushUndo('Delete checkpoint');
      set(s => {
        delete s.checkpoints[checkpointId];
      });
    },
  };
}

/**
 * Undo slice — undo/redo stack management, snapshots, inactive graph storage,
 * and graph resource cleanup helpers.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - Per-graph undo/redo stacks (module-scoped, outside Zustand to avoid immer)
 * - Snapshot creation and push logic
 * - Inactive graph storage for subgraph inner graphs
 * - collectInnerGraphIds / cleanupGraphResources helpers
 * - createUndoActions factory (undo, redo, jumpToUndo, diffUndoSnapshots, etc.)
 */
import type { EditorNode, Connection, NodeGroup, CustomNodeDef, SubgraphNodeDef, CheckpointEntry, GraphData } from '../../types';
import type { EditorState } from '../editorStore';
import { compareGraphs } from '../../utils/graphDiff';
import type { EnrichedGraphDiff, SnapshotSummary } from '../../utils/graphDiff';
import { deleteExecutionCache, deletePersistedExecutionResults } from './executionSlice';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Snapshot {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups: Record<string, NodeGroup>;
  customNodeDefs: Record<string, CustomNodeDef>;
  subgraphDefs: Record<string, SubgraphNodeDef>;
  validationErrors: Record<string, string[]>;
  checkpoints: Record<string, CheckpointEntry>;
  graphVariables: Record<string, unknown>;
  /** Saved inactiveGraphs entries for subgraph nodes deleted by this action.
   *  Populated only by deletion actions so undo can restore the inner graph data. */
  savedInactiveGraphs?: Record<string, GraphData>;
  /** inactiveGraphs entries created by this action (duplicate/paste/createSubgraph/convertSelectionToSubgraph).
   *  On undo, these entries are removed from inactiveGraphs to prevent orphan leaks. */
  createdInactiveGraphs?: Record<string, GraphData>;
}

/** Metadata for an undo entry (stored in parallel with snapshots). */
export interface UndoMeta {
  label: string;
  timestamp: number;
  nodeCount: number;
  connectionCount: number;
}

type SnapshotInput = Pick<Snapshot, 'nodes' | 'connections' | 'groups' | 'customNodeDefs' | 'subgraphDefs' | 'validationErrors' | 'checkpoints' | 'graphVariables'>;

// ---------------------------------------------------------------------------
// Module-scoped state
// ---------------------------------------------------------------------------

const MAX_HISTORY = 50;

// Per-graph undo/redo stacks: Map<graphId, Snapshot[]>
const undoStacks = new Map<string, Snapshot[]>();
const redoStacks = new Map<string, Snapshot[]>();
const undoMetaStacks = new Map<string, UndoMeta[]>();
const redoMetaStacks = new Map<string, UndoMeta[]>();

// Track the active graph ID for undo/redo lookups
let activeUndoGraphId = 'default';

// Counter for unique undoRedoEvent values (consecutive same-type events must differ)
let undoRedoCounter = 0;

// Inactive graph storage (module-scoped, like undo stacks)
export const inactiveGraphs: Record<string, GraphData> = {};

// ---------------------------------------------------------------------------
// Stack accessors
// ---------------------------------------------------------------------------

export function getUndoStack(): Snapshot[] {
  let stack = undoStacks.get(activeUndoGraphId);
  if (!stack) { stack = []; undoStacks.set(activeUndoGraphId, stack); }
  return stack;
}

export function getRedoStack(): Snapshot[] {
  let stack = redoStacks.get(activeUndoGraphId);
  if (!stack) { stack = []; redoStacks.set(activeUndoGraphId, stack); }
  return stack;
}

export function getUndoMetaStack(): UndoMeta[] {
  let stack = undoMetaStacks.get(activeUndoGraphId);
  if (!stack) { stack = []; undoMetaStacks.set(activeUndoGraphId, stack); }
  return stack;
}

export function getRedoMetaStack(): UndoMeta[] {
  let stack = redoMetaStacks.get(activeUndoGraphId);
  if (!stack) { stack = []; redoMetaStacks.set(activeUndoGraphId, stack); }
  return stack;
}

export function getActiveUndoGraphId(): string { return activeUndoGraphId; }
export function setActiveUndoGraphId(id: string): void { activeUndoGraphId = id; }

export function clearAllUndoStacks(): void {
  undoStacks.clear();
  redoStacks.clear();
  undoMetaStacks.clear();
  redoMetaStacks.clear();
}

// ---------------------------------------------------------------------------
// Snapshot functions
// ---------------------------------------------------------------------------

export function takeSnapshot(state: SnapshotInput): Snapshot {
  return structuredClone({ nodes: state.nodes, connections: state.connections, groups: state.groups, customNodeDefs: state.customNodeDefs, subgraphDefs: state.subgraphDefs, validationErrors: state.validationErrors, checkpoints: state.checkpoints, graphVariables: state.graphVariables });
}

export function pushUndo(state: SnapshotInput, label?: string): void {
  const undoStack = getUndoStack();
  const metaStack = getUndoMetaStack();
  undoStack.push(takeSnapshot(state));
  metaStack.push({
    label: label ?? 'Edit',
    timestamp: Date.now(),
    nodeCount: Object.keys(state.nodes).length,
    connectionCount: Object.keys(state.connections).length,
  });
  if (undoStack.length > MAX_HISTORY) { undoStack.shift(); metaStack.shift(); }
  const redoStack = getRedoStack();
  const redoMeta = getRedoMetaStack();
  redoStack.length = 0; // Clear redo on new action
  redoMeta.length = 0;
}

/**
 * Save inactiveGraphs entries to the most recent undo snapshot before they are deleted.
 * Called by deletion actions AFTER pushUndo but BEFORE cleanupGraphResources.
 */
export function saveInactiveGraphsToUndo(graphIds: string[]): void {
  const undoStack = getUndoStack();
  if (undoStack.length === 0) return;
  const last = undoStack[undoStack.length - 1];
  const saved: Record<string, GraphData> = {};
  for (const gId of graphIds) {
    if (inactiveGraphs[gId]) {
      saved[gId] = structuredClone(inactiveGraphs[gId]);
    }
  }
  if (Object.keys(saved).length > 0) {
    last.savedInactiveGraphs = saved;
  }
}

/**
 * Record inactiveGraphs entries CREATED by the current action on the most recent undo snapshot.
 * Called by creation actions (duplicate, paste, createSubgraph, convertSelectionToSubgraph)
 * AFTER adding entries to inactiveGraphs. On undo, these entries are removed to prevent orphan leaks.
 */
export function markCreatedInactiveGraphs(graphIds: string[]): void {
  const undoStack = getUndoStack();
  if (undoStack.length === 0) return;
  const last = undoStack[undoStack.length - 1];
  const created: Record<string, GraphData> = {};
  for (const gId of graphIds) {
    if (inactiveGraphs[gId]) {
      created[gId] = structuredClone(inactiveGraphs[gId]);
    }
  }
  if (Object.keys(created).length > 0) {
    last.createdInactiveGraphs = { ...last.createdInactiveGraphs, ...created };
  }
}

// ---------------------------------------------------------------------------
// Graph resource helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all inner graph IDs owned by subgraph nodes in the given graph data.
 * Used by deletion operations to cascade-cleanup nested subgraph resources.
 */
export function collectInnerGraphIds(
  gData: { nodes: Record<string, EditorNode> } | undefined,
): string[] {
  const ids: string[] = [];
  if (!gData) return ids;
  for (const node of Object.values(gData.nodes)) {
    if (node.type === 'subgraph') {
      const innerGId = node.data.innerGraphId as string | undefined;
      if (innerGId) {
        ids.push(innerGId);
        ids.push(...collectInnerGraphIds(inactiveGraphs[innerGId]));
      }
    }
  }
  return ids;
}

/**
 * Clean up module-scoped resources (inactiveGraphs, undo/redo stacks, execution cache)
 * for a list of graph IDs.
 */
export function cleanupGraphResources(graphIds: string[]): void {
  for (const gId of graphIds) {
    delete inactiveGraphs[gId];
    undoStacks.delete(gId);
    redoStacks.delete(gId);
    undoMetaStacks.delete(gId);
    redoMetaStacks.delete(gId);
    deleteExecutionCache(gId);
    deletePersistedExecutionResults(gId);
  }
}

// ---------------------------------------------------------------------------
// Undo actions factory
// ---------------------------------------------------------------------------

export interface UndoActions {
  pushUndoSnapshot: (label?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getUndoHistory: () => { undo: UndoMeta[]; redo: UndoMeta[] };
  diffUndoSnapshots: (indexA: number, indexB: number) => EnrichedGraphDiff | null;
  getSnapshotSummary: (index: number) => SnapshotSummary | null;
  jumpToUndo: (targetIndex: number) => void;
}

export interface UndoHelpers {
  cancelAutoExecute: () => void;
  syncNextId: (nodes: Record<string, EditorNode>, connections: Record<string, Connection>, groups?: Record<string, NodeGroup>, extraKeys?: string[]) => void;
  clearExecutionTimeoutsAndCache: (graphId: string) => void;
  clearAllTransientState: (state: EditorState) => void;
}

export function createUndoActions(
  set: (fn: (state: EditorState) => void) => void,
  get: () => EditorState,
  helpers: UndoHelpers,
): UndoActions {
  const { cancelAutoExecute, syncNextId, clearExecutionTimeoutsAndCache, clearAllTransientState } = helpers;

  return {
    pushUndoSnapshot: (label?: string) => {
      pushUndo(get() as SnapshotInput, label);
    },

    undo: () => {
      const stack = getUndoStack();
      const rStack = getRedoStack();
      if (stack.length === 0) return;
      cancelAutoExecute();
      const redoEntry = takeSnapshot(get() as SnapshotInput);
      const prev = stack.pop()!;
      // Transfer inactiveGraphs metadata between undo/redo entries
      if (prev.savedInactiveGraphs) {
        redoEntry.savedInactiveGraphs = prev.savedInactiveGraphs;
        for (const [gId, data] of Object.entries(prev.savedInactiveGraphs)) {
          inactiveGraphs[gId] = structuredClone(data);
        }
      }
      if (prev.createdInactiveGraphs) {
        redoEntry.createdInactiveGraphs = prev.createdInactiveGraphs;
        for (const gId of Object.keys(prev.createdInactiveGraphs)) {
          delete inactiveGraphs[gId];
        }
      }
      rStack.push(redoEntry);
      // Mirror meta stacks
      const uMeta = getUndoMetaStack();
      const rMeta = getRedoMetaStack();
      const meta = uMeta.pop();
      if (meta) rMeta.push(meta);
      const undoLabel = meta?.label ?? '';
      const currentState = get();
      syncNextId(
        prev.nodes, prev.connections, prev.groups,
        [...Object.keys(currentState.graphTabs as Record<string, unknown>), ...Object.keys(currentState.templates as Record<string, unknown>)],
      );
      clearExecutionTimeoutsAndCache(activeUndoGraphId);
      set((state) => {
        state.nodes = prev.nodes;
        state.connections = prev.connections;
        state.groups = prev.groups ?? {};
        state.customNodeDefs = prev.customNodeDefs ?? {};
        state.subgraphDefs = prev.subgraphDefs ?? {};
        state.validationErrors = prev.validationErrors ?? {};
        state.checkpoints = prev.checkpoints ?? {};
        state.graphVariables = prev.graphVariables ?? {};
        state.selectedIds = new Set<string>();
        clearAllTransientState(state);
        state.undoRedoEvent = `undo:${++undoRedoCounter}:${undoLabel}`;
      });
    },

    redo: () => {
      const uStack = getUndoStack();
      const rStack = getRedoStack();
      if (rStack.length === 0) return;
      cancelAutoExecute();
      const undoEntry = takeSnapshot(get() as SnapshotInput);
      const next = rStack.pop()!;
      if (next.savedInactiveGraphs) {
        undoEntry.savedInactiveGraphs = next.savedInactiveGraphs;
        for (const gId of Object.keys(next.savedInactiveGraphs)) {
          delete inactiveGraphs[gId];
        }
      }
      if (next.createdInactiveGraphs) {
        undoEntry.createdInactiveGraphs = next.createdInactiveGraphs;
        for (const [gId, data] of Object.entries(next.createdInactiveGraphs)) {
          inactiveGraphs[gId] = structuredClone(data);
        }
      }
      uStack.push(undoEntry);
      const uMeta = getUndoMetaStack();
      const rMeta = getRedoMetaStack();
      const meta = rMeta.pop();
      if (meta) uMeta.push(meta);
      const redoLabel = meta?.label ?? '';
      const currentState = get();
      syncNextId(
        next.nodes, next.connections, next.groups,
        [...Object.keys(currentState.graphTabs as Record<string, unknown>), ...Object.keys(currentState.templates as Record<string, unknown>)],
      );
      clearExecutionTimeoutsAndCache(activeUndoGraphId);
      set((state) => {
        state.nodes = next.nodes;
        state.connections = next.connections;
        state.groups = next.groups ?? {};
        state.customNodeDefs = next.customNodeDefs ?? {};
        state.subgraphDefs = next.subgraphDefs ?? {};
        state.validationErrors = next.validationErrors ?? {};
        state.checkpoints = next.checkpoints ?? {};
        state.graphVariables = next.graphVariables ?? {};
        state.selectedIds = new Set<string>();
        clearAllTransientState(state);
        state.undoRedoEvent = `redo:${++undoRedoCounter}:${redoLabel}`;
      });
    },

    canUndo: () => getUndoStack().length > 0,
    canRedo: () => getRedoStack().length > 0,

    getUndoHistory: () => ({
      undo: [...getUndoMetaStack()],
      redo: [...getRedoMetaStack()],
    }),

    diffUndoSnapshots: (indexA: number, indexB: number) => {
      const uStack = getUndoStack();
      const uMeta = getUndoMetaStack();
      const getSnap = (idx: number) => {
        if (idx === -1) return takeSnapshot(get() as SnapshotInput);
        if (idx >= 0 && idx < uStack.length) return uStack[idx];
        return null;
      };
      const getMeta = (idx: number): SnapshotSummary => {
        if (idx === -1) {
          const s = get();
          return { label: 'Current', timestamp: Date.now(), nodeCount: Object.keys(s.nodes as Record<string, unknown>).length, connectionCount: Object.keys(s.connections as Record<string, unknown>).length, index: -1 };
        }
        const m = idx >= 0 && idx < uMeta.length ? uMeta[idx] : null;
        const snap = getSnap(idx);
        return {
          label: m?.label ?? `Step ${idx}`,
          timestamp: m?.timestamp ?? 0,
          nodeCount: m?.nodeCount ?? (snap ? Object.keys(snap.nodes).length : 0),
          connectionCount: m?.connectionCount ?? (snap ? Object.keys(snap.connections).length : 0),
          index: idx,
        };
      };
      const snapA = getSnap(indexA);
      const snapB = getSnap(indexB);
      if (!snapA || !snapB) return null;
      const diff = compareGraphs(snapA.nodes, snapA.connections, snapB.nodes, snapB.connections);
      const metaA = getMeta(indexA);
      const metaB = getMeta(indexB);
      return {
        ...diff,
        snapshotA: metaA,
        snapshotB: metaB,
        nodeCountDelta: metaB.nodeCount - metaA.nodeCount,
        connectionCountDelta: metaB.connectionCount - metaA.connectionCount,
      };
    },

    getSnapshotSummary: (index: number) => {
      if (index === -1) {
        const s = get();
        return { label: 'Current', timestamp: Date.now(), nodeCount: Object.keys(s.nodes as Record<string, unknown>).length, connectionCount: Object.keys(s.connections as Record<string, unknown>).length, index: -1 };
      }
      const uStack = getUndoStack();
      const uMeta = getUndoMetaStack();
      if (index < 0 || index >= uStack.length) return null;
      const meta = index < uMeta.length ? uMeta[index] : null;
      const snap = uStack[index];
      return {
        label: meta?.label ?? `Step ${index}`,
        timestamp: meta?.timestamp ?? 0,
        nodeCount: meta?.nodeCount ?? Object.keys(snap.nodes).length,
        connectionCount: meta?.connectionCount ?? Object.keys(snap.connections).length,
        index,
      };
    },

    jumpToUndo: (targetIndex: number) => {
      const uStack = getUndoStack();
      const uMeta = getUndoMetaStack();
      const stepsBack = uStack.length - 1 - targetIndex;
      if (stepsBack <= 0 || targetIndex < 0 || targetIndex >= uStack.length) return;
      cancelAutoExecute();
      const rStack = getRedoStack();
      const rMeta = getRedoMetaStack();
      // Push current state + intermediate states onto redo
      for (let i = 0; i < stepsBack; i++) {
        if (i === 0) {
          rStack.push(takeSnapshot(get() as SnapshotInput));
          const s = get();
          rMeta.push({ label: 'Current', timestamp: Date.now(), nodeCount: Object.keys(s.nodes as Record<string, unknown>).length, connectionCount: Object.keys(s.connections as Record<string, unknown>).length });
        } else {
          const snap = uStack.pop()!;
          const m = uMeta.pop();
          rStack.push(snap);
          if (m) rMeta.push(m);
        }
      }
      // Pop the target snapshot (consumed for restore, NOT pushed to redo)
      const target = uStack.pop()!;
      const jumpMeta = uMeta.pop();
      // Restore savedInactiveGraphs from target + intermediate entries
      if (target.savedInactiveGraphs) {
        for (const [gId, data] of Object.entries(target.savedInactiveGraphs)) {
          inactiveGraphs[gId] = structuredClone(data);
        }
      }
      for (let i = rStack.length - stepsBack; i < rStack.length; i++) {
        const entry = rStack[i];
        if (entry?.savedInactiveGraphs) {
          for (const [gId, data] of Object.entries(entry.savedInactiveGraphs)) {
            inactiveGraphs[gId] = structuredClone(data);
          }
        }
      }
      // Clean up createdInactiveGraphs from target + intermediate entries
      if (target.createdInactiveGraphs) {
        for (const gId of Object.keys(target.createdInactiveGraphs)) {
          delete inactiveGraphs[gId];
        }
      }
      for (let i = rStack.length - stepsBack; i < rStack.length; i++) {
        const entry = rStack[i];
        if (entry?.createdInactiveGraphs) {
          for (const gId of Object.keys(entry.createdInactiveGraphs)) {
            delete inactiveGraphs[gId];
          }
        }
      }
      // Transfer target's metadata to top redo entry
      if (rStack.length > 0) {
        const topRedo = rStack[rStack.length - 1];
        if (target.createdInactiveGraphs) {
          topRedo.createdInactiveGraphs = { ...topRedo.createdInactiveGraphs, ...target.createdInactiveGraphs };
        }
        if (target.savedInactiveGraphs) {
          topRedo.savedInactiveGraphs = { ...topRedo.savedInactiveGraphs, ...target.savedInactiveGraphs };
        }
      }
      const currentState = get();
      syncNextId(
        target.nodes, target.connections, target.groups,
        [...Object.keys(currentState.graphTabs as Record<string, unknown>), ...Object.keys(currentState.templates as Record<string, unknown>)],
      );
      clearExecutionTimeoutsAndCache(activeUndoGraphId);
      set((state) => {
        state.nodes = target.nodes;
        state.connections = target.connections;
        state.groups = target.groups ?? {};
        state.customNodeDefs = target.customNodeDefs ?? {};
        state.subgraphDefs = target.subgraphDefs ?? {};
        state.validationErrors = target.validationErrors ?? {};
        state.checkpoints = target.checkpoints ?? {};
        state.graphVariables = target.graphVariables ?? {};
        state.selectedIds = new Set<string>();
        clearAllTransientState(state);
        state.undoRedoEvent = `undo:${++undoRedoCounter}:${jumpMeta?.label ?? ''}`;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Module state reset (for testing)
// ---------------------------------------------------------------------------

export function _resetUndoModuleState(defaultGraphId: string): void {
  undoStacks.clear();
  redoStacks.clear();
  undoMetaStacks.clear();
  redoMetaStacks.clear();
  activeUndoGraphId = defaultGraphId;
  for (const key of Object.keys(inactiveGraphs)) delete inactiveGraphs[key];
}

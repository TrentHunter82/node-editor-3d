/**
 * editorStore.ts — Main Zustand store for the 3D node editor.
 *
 * Architecture: The store is composed of slice factories that each return
 * a set of actions. Each slice follows the pattern:
 *   createXxxActions(set, get, helpers) => { ...actions }
 *
 * Slices (in src/store/slices/):
 *   coreSlice        — Clipboard, undo/redo triggers, clear/reset, import/export JSON
 *   selectionSlice   — Node/connection selection, box-select, select-all
 *   nodeSlice        — addNode, deleteNode, updateNode, moveNode, batch operations
 *   connectionSlice  — addConnection, deleteConnection, auto-insert, reroute
 *   groupSlice       — Node groups (create, resize, snap, dissolve)
 *   layoutSlice      — Align, distribute, snap-to-grid, auto-layout
 *   graphSlice       — Multi-graph tabs (create, switch, delete, reorder)
 *   executionSlice   — Graph execution engine, topological sort, caching
 *   undoSlice        — Undo/redo stacks, snapshot diffing, transactional undo
 *   subgraphSlice    — Subgraph CRUD, enter/exit navigation, expand inline
 *   persistenceSlice — localStorage/IndexedDB save/load, multi-graph import/export
 *   templateSlice    — Save/instantiate/delete/import/export node templates
 *   checkpointSlice  — Named checkpoint save/restore/delete
 *   customNodeSlice  — Custom node definition CRUD, instance management
 *
 * This file defines:
 *   - EditorState interface (all state fields + action signatures)
 *   - Module-scoped state (nextId counter, ID generators)
 *   - Store creation with all slice spreads
 *   - Auto-save subscriber
 *   - Store reset helpers for testing
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { subscribeWithSelector } from 'zustand/middleware';
import type { EditorNode, Connection, InteractionMode, PendingConnection, NodeType, NodeGroup, ContextMenuState, ExecutionState, PortType, CustomNodeDef, PortConfig, GraphData, GraphTab, NodeTemplate, SubgraphNodeDef, ErrorStrategy, NodeExecutionMetric, CheckpointEntry, ExecutionStats } from '../types';
import { NODE_TYPE_CONFIG, isPortTypeCompatible, NODE_CATEGORIES } from '../types';
import { TYPE_LABELS } from '../types/nodeLabels';
import type { NodeCategory } from '../types';
import { saveMultiGraphAsync } from '../utils/serialization';
import type { MultiGraphStorage } from '../utils/serialization';
import { useSettingsStore } from './settingsStore';
import { topologicalSort, invalidateDownstream } from '../utils/execution';
import type { EnrichedGraphDiff, SnapshotSummary } from '../utils/graphDiff';
import type { AlignDirection, DistributeDirection } from '../utils/layout';
import { selectionInitialState, createSelectionActions } from './slices/selectionSlice';
import { executionInitialState, createExecutionActions, getExecutionCache, clearExecutionTimeoutsAndCache, clearExecutionTimeouts, clearExecutionTransientState, _resetExecutionModuleState } from './slices/executionSlice';
import type { ExecutionHistoryEntry } from './slices/executionSlice';
import { DEFAULT_GRAPH_ID, graphInitialState, createGraphActions, sanitizeGraphOrder } from './slices/graphSlice';
import { createGroupActions } from './slices/groupSlice';
import { createLayoutActions } from './slices/layoutSlice';
import { createConnectionActions } from './slices/connectionSlice';
import { createNodeActions } from './slices/nodeSlice';
import { createCoreActions, _resetClipboard } from './slices/coreSlice';
import { createCustomNodeActions } from './slices/customNodeSlice';
import { createSubgraphActions } from './slices/subgraphSlice';
import { createPersistenceActions } from './slices/persistenceSlice';
import { createTemplateActions } from './slices/templateSlice';
import { createCheckpointActions } from './slices/checkpointSlice';
import { generateMismatchWarnings } from '../utils/nodeVersioning';
import { validateGraphVariables, validateNode } from '../utils/validation';
import {
  pushUndo, getUndoStack, getRedoStack, getUndoMetaStack, getRedoMetaStack,
  getActiveUndoGraphId, setActiveUndoGraphId, clearAllUndoStacks,
  inactiveGraphs, saveInactiveGraphsToUndo, markCreatedInactiveGraphs,
  collectInnerGraphIds, cleanupGraphResources,
  createUndoActions, _resetUndoModuleState,
} from './slices/undoSlice';
export type { UndoMeta } from './slices/undoSlice';
import type { UndoMeta } from './slices/undoSlice';

// Enable immer's MapSet plugin for Set/Map support (selectedIds uses Set<string>)
enableMapSet();

let nextId = 1;
function genId(): string {
  return `node-${nextId++}`;
}

function genConnectionId(): string {
  return `conn-${nextId++}`;
}

function genGroupId(): string {
  return `group-${nextId++}`;
}

function genGraphId(): string {
  return `graph-${nextId++}`;
}

function genTemplateId(): string {
  return `template-${nextId++}`;
}

// --- Auto-execute debounce ---
let autoExecTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_EXEC_DEBOUNCE_MS = 200;

// --- Diff highlight auto-clear timer ---
let diffHighlightTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a debounced auto-execution if autoExecute setting is enabled */
function scheduleAutoExecute(executeGraph: () => void): void {
  if (!useSettingsStore.getState().autoExecute) return;
  if (autoExecTimer !== null) clearTimeout(autoExecTimer);
  autoExecTimer = setTimeout(() => {
    autoExecTimer = null;
    // Re-check setting at fire time (user may have disabled mid-debounce)
    if (!useSettingsStore.getState().autoExecute) return;
    executeGraph();
  }, AUTO_EXEC_DEBOUNCE_MS);
}

/** Cancel any pending auto-execution (used on graph switches, undo/redo, etc.) */
export function cancelAutoExecute(): void {
  if (autoExecTimer !== null) {
    clearTimeout(autoExecTimer);
    autoExecTimer = null;
  }
}

function makePortDefs(prefix: string, configs: { label: string; portType: PortType; description?: string; defaultValue?: unknown; min?: number; max?: number }[]) {
  return configs.map((cfg, i) => {
    const def: { id: string; label: string; portType: PortType; description?: string; defaultValue?: unknown; min?: number; max?: number } = {
      id: `${prefix}-${i}`,
      label: cfg.label,
      portType: cfg.portType,
    };
    if (cfg.description !== undefined) def.description = cfg.description;
    if (cfg.defaultValue !== undefined) def.defaultValue = cfg.defaultValue;
    if (cfg.min !== undefined) def.min = cfg.min;
    if (cfg.max !== undefined) def.max = cfg.max;
    return def;
  });
}

// --- Fuzzy search scoring ---
// Returns a score > 0 if all characters in `query` appear in order in `text`.
// Prefers exact substring matches, word-start matches, and consecutive matches.
function fuzzyScore(query: string, text: string): number {
  if (text.includes(query)) return 100 + query.length; // Exact substring = highest score
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      qi++;
      consecutive++;
      score += consecutive; // Consecutive matches score higher
      // Bonus for matching at start of word
      if (ti === 0 || text[ti - 1] === ' ' || text[ti - 1] === '-' || text[ti - 1] === '_') {
        score += 5;
      }
    } else {
      consecutive = 0;
    }
  }
  return qi === query.length ? score : 0; // 0 if not all chars matched
}

// --- Cycle detection ---
// wouldCreateCycle is now in connectionSlice.ts

// Clipboard is now module-scoped in coreSlice.ts

// Undo/redo stacks, snapshots, inactiveGraphs, and cleanupGraphResources
// are now in undoSlice.ts

// Snap-to-grid constant
export const GRID_SNAP_SIZE = 0.5;

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SNAP_SIZE) * GRID_SNAP_SIZE;
}

export interface EditorState {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups: Record<string, NodeGroup>;
  selectedIds: Set<string>;
  interaction: InteractionMode;
  pendingConnection: PendingConnection | null;
  nearestSnapPort: { nodeId: string; portIndex: number } | null;
  hoveredConnectionId: string | null;
  /** Incompatible port being hovered during connection drawing — drives mismatch X indicator */
  hoveredMismatchPort: { nodeId: string; portIndex: number } | null;
  focusedPort: { nodeId: string; portIndex: number; side: 'input' | 'output' } | null;
  /** True when pointer is down on a node but drag threshold not yet crossed.
   *  Used by viewport culling to skip frustum checks during the pre-drag window.
   *  Does NOT affect OrbitControls (only `interaction` does). */
  isNodePointerDown: boolean;
  /** Compatible input port keys ("nodeId:portIndex") highlighted during connection drawing.
   *  Set when startConnection is called, cleared on complete/cancel. Transient, not persisted. */
  highlightedPorts: Set<string>;
  /** Node IDs that have NO compatible input ports for the current pending connection.
   *  Pre-computed in startConnection for O(1) per-node lookup. Transient, not persisted. */
  incompatibleNodeIds: Set<string>;
  /** Node IDs matching the current search query (transient, not persisted/snapshotted) */
  searchHighlightIds: Set<string>;
  /** Diff highlight for graph comparison (transient, auto-clears after 3s) */
  diffHighlightIds: Map<string, 'added' | 'removed' | 'modified'>;
  snapEnabled: boolean;
  showValuePreviews: boolean;
  contextMenu: ContextMenuState | null;

  // Transient UI event (for undo/redo toast notification).
  // Uses a counter suffix to ensure each event triggers a subscriber update
  // even for consecutive same-type events (e.g., undo, undo, undo).
  undoRedoEvent: string | null;

  // Actions
  addNode: (type: NodeType, position?: [number, number, number]) => string;
  removeNode: (id: string) => void;
  updateNodePosition: (id: string, position: [number, number, number]) => void;
  /** Batch set absolute positions for multiple nodes in a single set() call.
   *  No undo push — intended for hot drag loop. Undo is pushed separately at drag start. */
  setNodePositions: (positions: Record<string, [number, number, number]>) => void;
  updateNodeTitle: (id: string, title: string) => void;
  updateNodeComment: (id: string, comment: string | undefined) => void;
  batchUpdateNodeTitles: (updates: { nodeId: string; title: string }[]) => void;
  batchUpdateNodeData: (updates: { nodeId: string; key: string; value: unknown }[]) => void;
  batchMoveNodes: (nodeIds: string[], offset: [number, number, number]) => void;
  getCompatiblePorts: (sourceNodeId: string, sourcePortIndex: number) => { nodeId: string; portIndex: number }[];
  addConnection: (
    sourceNodeId: string,
    sourcePortIndex: number,
    targetNodeId: string,
    targetPortIndex: number
  ) => string | null;
  removeConnection: (id: string) => void;
  setSelection: (ids: Set<string>) => void;
  toggleSelection: (id: string) => void;
  startConnection: (sourceNodeId: string, sourcePortIndex: number) => void;
  updatePendingCursor: (pos: [number, number, number]) => void;
  completeConnection: (targetNodeId: string, targetPortIndex: number) => void;
  cancelConnection: () => void;
  setInteraction: (mode: InteractionMode) => void;
  setNearestSnapPort: (snap: { nodeId: string; portIndex: number } | null) => void;
  setHoveredMismatchPort: (port: { nodeId: string; portIndex: number } | null) => void;
  setHoveredConnection: (id: string | null) => void;
  setFocusedPort: (port: { nodeId: string; portIndex: number; side: 'input' | 'output' } | null) => void;
  setHighlightedPorts: (ports: Set<string>) => void;
  clearHighlightedPorts: () => void;
  setSearchHighlightIds: (ids: Set<string>) => void;
  setDiffHighlight: (ids: Map<string, 'added' | 'removed' | 'modified'>) => void;
  disconnectAndReroute: (connectionId: string) => void;
  loadFromStorage: () => boolean;
  loadFromStorageAsync: () => Promise<boolean>;
  duplicateSelected: (inPlace?: boolean) => Map<string, string> | null;
  deleteSelected: () => void;
  // Copy/Paste
  copySelected: () => void;
  paste: () => void;
  canPaste: () => boolean;
  // Advanced selection
  selectConnected: (direction: 'upstream' | 'downstream' | 'both') => void;
  // Box selection
  boxSelect: (minX: number, minZ: number, maxX: number, maxZ: number, additive: boolean) => void;
  // Undo/Redo
  pushUndoSnapshot: (label?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getUndoHistory: () => { undo: UndoMeta[]; redo: UndoMeta[] };
  jumpToUndo: (index: number) => void;
  /** Compare two undo snapshot indices; returns diff of nodes/connections changes. -1 = current state. */
  diffUndoSnapshots: (indexA: number, indexB: number) => EnrichedGraphDiff | null;
  /** Get quick metadata for a snapshot without full diff computation. -1 = current state. */
  getSnapshotSummary: (index: number) => SnapshotSummary | null;
  // Snap toggle
  toggleSnap: () => void;
  // Value preview toggle
  toggleValuePreviews: () => void;
  // Grouping
  createGroup: (label?: string) => string | null;
  ungroupNodes: (groupId: string) => void;
  toggleGroupCollapse: (groupId: string) => void;
  renameGroup: (groupId: string, label: string) => void;
  setGroupColor: (groupId: string, color: string | undefined) => void;
  setGroupDescription: (groupId: string, description: string) => void;
  // Layout
  autoLayout: () => void;
  alignSelected: (direction: AlignDirection) => void;
  distributeSelected: (direction: DistributeDirection) => void;
  // Clear graph
  clearGraph: () => void;
  // Context menu
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
  // Node data
  updateNodeData: (id: string, key: string, value: unknown) => void;
  // Node collapse
  toggleNodeCollapse: (id: string) => void;
  // Node locking
  toggleNodeLock: (id: string) => void;
  batchToggleNodeLock: (ids: string[]) => void;
  /** Resize a node (with undo). Clamps to min/max constraints. */
  resizeNode: (id: string, width: number, height: number) => void;
  /** Batch set sizes for multiple nodes. No undo — for hot resize drag loop. */
  setNodeSizes: (sizes: Record<string, { width: number; height: number }>) => void;
  // Import/Export
  importWorkflow: (data: { nodes: Record<string, EditorNode>; connections: Record<string, Connection>; groups?: Record<string, NodeGroup>; customNodeDefs?: Record<string, CustomNodeDef> }) => void;
  // Custom node definitions
  customNodeDefs: Record<string, CustomNodeDef>;
  addCustomNodeDef: (def: Omit<CustomNodeDef, 'id'>) => string;
  removeCustomNodeDef: (id: string) => void;
  updateCustomNodeDef: (id: string, partial: Partial<Omit<CustomNodeDef, 'id'>>) => void;
  addCustomNode: (defId: string, position?: [number, number, number]) => string | null;
  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchNodes: (query: string) => EditorNode[];
  focusNode: (nodeId: string) => void;
  // Execution
  executionStates: Record<string, ExecutionState>;
  nodeOutputs: Record<string, Record<number, unknown>>;
  executionErrors: Record<string, string>;
  isExecuting: boolean;
  executeGraph: () => void;
  executeSelection: (selectedNodeIds: Set<string>) => void;
  setNodeExecutionState: (nodeId: string, state: ExecutionState) => void;
  resetExecution: () => void;
  invalidateNode: (nodeId: string) => void;
  // Execution profiling
  executionMetrics: Record<string, NodeExecutionMetric>;
  executionTimings: Record<string, number>;
  executionTotalDuration: number;
  executionMaxNodeDuration: number;
  // Execution debugger
  debugMode: boolean;
  toggleDebugMode: () => void;
  pausedAtWave: number;
  debugWaves: string[][];
  stepExecution: () => void;
  resumeExecution: () => void;
  // Breakpoints
  breakpoints: Record<string, true>;
  breakpointConditions: Record<string, string>;
  toggleBreakpoint: (nodeId: string) => void;
  clearAllBreakpoints: () => void;
  setBreakpointCondition: (nodeId: string, expression: string) => void;
  clearBreakpointCondition: (nodeId: string) => void;
  // Data flow tracing
  traceNodeId: string | null;
  setTraceNode: (nodeId: string | null) => void;
  // Error strategy
  errorStrategy: ErrorStrategy;
  setErrorStrategy: (strategy: ErrorStrategy) => void;
  // Execution history timeline
  executionHistory: ExecutionHistoryEntry[];
  executionHistoryIndex: number;
  scrubExecutionHistory: (index: number) => void;
  clearExecutionHistory: () => void;
  // Execution statistics
  executionStats: ExecutionStats;
  executionTimedOut: boolean;
  // Connection labels
  updateConnectionLabel: (id: string, label: string | undefined) => void;
  updateConnectionColor: (id: string, color: string | undefined) => void;
  updateConnectionStyle: (id: string, style: Connection['styleOverride']) => void;
  // Drag-from-port node creation
  getCompatibleNodeTypes: (sourceNodeId: string, sourcePortIndex: number, sourceIsOutput: boolean) => { type: NodeType; category: NodeCategory }[];
  addNodeAndConnect: (type: NodeType, position: [number, number, number], sourceNodeId: string, sourcePortIndex: number, sourceIsOutput: boolean) => string | null;
  // Insert reroute node on existing connection (double-click to insert)
  insertRerouteOnConnection: (connectionId: string, position: [number, number, number]) => string | null;
  // Batch collapse
  collapseSelected: () => void;
  expandSelected: () => void;
  // Graph validation
  validationErrors: Record<string, string[]>;
  validateGraph: () => void;
  // Custom node port configuration
  updateCustomNodePorts: (nodeId: string, inputCount: number, outputCount: number) => void;
  // --- Multi-graph tabs ---
  graphTabs: Record<string, GraphTab>;
  activeGraphId: string;
  graphOrder: string[];
  createGraph: (name?: string) => string;
  deleteGraph: (graphId: string) => void;
  switchGraph: (graphId: string) => void;
  renameGraph: (graphId: string, name: string) => void;
  reorderGraph: (graphId: string, newIndex: number) => void;
  updateGraphMetadata: (graphId: string, metadata: { description?: string; author?: string; tags?: string[] }) => void;
  // --- Node templates ---
  templates: Record<string, NodeTemplate>;
  saveSelectionAsTemplate: (name: string, category?: string) => string | null;
  instantiateTemplate: (templateId: string, position?: [number, number, number]) => void;
  deleteTemplate: (templateId: string) => void;
  importTemplates: (templates: Record<string, NodeTemplate>) => void;
  exportTemplates: () => Record<string, NodeTemplate>;
  // --- Workspace export/import ---
  exportAllGraphs: () => MultiGraphStorage;
  importAllGraphs: (storage: MultiGraphStorage) => void;
  mergeImportedGraphs: (storage: MultiGraphStorage) => void;
  // --- Storage warning ---
  storageWarning: string | null;
  dismissStorageWarning: () => void;
  lastSaveTime: number | null;
  // --- Subgraph support ---
  subgraphDefs: Record<string, SubgraphNodeDef>;
  /** Navigation breadcrumb: stack of { graphId, subgraphNodeId } for nested subgraph navigation */
  breadcrumbStack: { graphId: string; subgraphNodeId: string }[];
  createSubgraph: (name?: string) => string | null;
  convertSelectionToSubgraph: (name?: string) => string | null;
  enterSubgraph: (subgraphNodeId: string) => void;
  exitSubgraph: () => void;
  deleteSubgraphNode: (nodeId: string) => void;
  expandSubgraph: (nodeId: string) => void;
  // --- Named checkpoints ---
  checkpoints: Record<string, CheckpointEntry>;
  createCheckpoint: (label: string) => string;
  restoreCheckpoint: (checkpointId: string) => void;
  deleteCheckpoint: (checkpointId: string) => void;
  // --- Plugin node support ---
  fetchNodeData: (nodeId: string, url: string) => void;
  // --- Graph variables ---
  graphVariables: Record<string, unknown>;
  clearGraphVariables: () => void;
}

// Hydrate nextId from saved data
/** Remove connections that reference non-existent nodes or out-of-range port indices */
function sanitizeConnections(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): Record<string, Connection> {
  const clean: Record<string, Connection> = {};
  // Direct iteration — avoids intermediate Object.entries() array allocation
  for (const id in connections) {
    if (Object.prototype.hasOwnProperty.call(connections, id)) {
      const conn = connections[id];
      const src = nodes[conn.sourceNodeId];
      const tgt = nodes[conn.targetNodeId];
      if (!src || !tgt) continue; // orphaned — skip
      if (conn.sourcePortIndex < 0 || conn.sourcePortIndex >= src.outputs.length) continue;
      if (conn.targetPortIndex < 0 || conn.targetPortIndex >= tgt.inputs.length) continue;
      clean[id] = conn;
    }
  }
  return clean;
}

function syncNextId(nodes: Record<string, EditorNode>, connections: Record<string, Connection>, groups?: Record<string, NodeGroup>, extraKeys?: string[]) {
  let max = 0;
  // Direct iteration per source — avoids triple spread intermediate array allocation
  const sources: Record<string, unknown>[] = [nodes, connections];
  if (groups) sources.push(groups);
  for (const obj of sources) {
    for (const id in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, id)) {
        const num = parseInt(id.replace(/\D+/g, ''), 10);
        if (!isNaN(num) && num > max) max = num;
      }
    }
  }
  if (extraKeys) {
    for (const id of extraKeys) {
      const num = parseInt(id.replace(/\D+/g, ''), 10);
      if (!isNaN(num) && num > max) max = num;
    }
  }
  nextId = max + 1;
}

/**
 * Clear all UI interaction state that may reference stale nodes/connections.
 * Prefer calling clearAllTransientState() which combines this with
 * clearExecutionTransientState() — both are always needed in
 * graph-context-switch paths.
 */
function clearGraphContextUIState(state: EditorState): void {
  state.contextMenu = null;
  state.pendingConnection = null;
  state.nearestSnapPort = null;
  state.hoveredMismatchPort = null;
  state.hoveredConnectionId = null;
  state.focusedPort = null;
  state.highlightedPorts = new Set<string>();
  state.incompatibleNodeIds = new Set<string>();
  state.interaction = 'idle' as InteractionMode;
  state.isNodePointerDown = false;
  state.traceNodeId = null;
}

/**
 * Clear ALL transient state (execution + UI) in one call.
 * Use inside `set()` callbacks in all graph-context-switch paths:
 * undo, redo, jumpToUndo, clearGraph, switchGraph, enterSubgraph,
 * exitSubgraph, deleteGraph, importWorkflow, importAllGraphs,
 * restoreCheckpoint, loadFromStorage.
 */
function clearAllTransientState(state: EditorState): void {
  clearExecutionTransientState(state);
  clearGraphContextUIState(state);
}

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      nodes: {},
      connections: {},
      groups: {},
      ...selectionInitialState,
      interaction: 'idle',
      pendingConnection: null,
      isNodePointerDown: false,
      highlightedPorts: new Set<string>(),
      incompatibleNodeIds: new Set<string>(),
      snapEnabled: true,
      showValuePreviews: true,
      contextMenu: null,
      undoRedoEvent: null,
      searchHighlightIds: new Set<string>(),
      diffHighlightIds: new Map<string, 'added' | 'removed' | 'modified'>(),
      customNodeDefs: {},
      searchQuery: '',
      ...executionInitialState,
      validationErrors: {},
      // Multi-graph tabs + breadcrumbs
      ...graphInitialState,
      // Node templates
      templates: {} as Record<string, NodeTemplate>,
      // Storage warning
      storageWarning: null,
      dismissStorageWarning: () => set(s => { s.storageWarning = null; }),
      lastSaveTime: null,
      // Subgraph support
      subgraphDefs: {} as Record<string, SubgraphNodeDef>,
      // Named checkpoints (per-graph)
      checkpoints: {} as Record<string, CheckpointEntry>,
      // Graph variables (per-graph, transient execution state)
      graphVariables: {} as Record<string, unknown>,

      // Node CRUD actions delegated to nodeSlice
      ...createNodeActions(set, get, {
        pushUndo: (label?: string) => pushUndo(get(), label),
        genId,
        getActiveUndoGraphId,
        getExecutionCache,
        invalidateDownstream,
        scheduleAutoExecute: (execute) => scheduleAutoExecute(execute),
        getInactiveGraphs: () => inactiveGraphs,
        saveInactiveGraphsToUndo,
        cleanupGraphResources,
        collectInnerGraphIds,
        typeTitles: TYPE_LABELS,
      }),

      getCompatiblePorts: (sourceNodeId, sourcePortIndex) => {
        const state = get();
        const sourceNode = state.nodes[sourceNodeId];
        if (!sourceNode || sourcePortIndex >= sourceNode.outputs.length) return [];
        const sourceType = sourceNode.outputs[sourcePortIndex].portType;
        const results: { nodeId: string; portIndex: number }[] = [];
        for (const node of Object.values(state.nodes)) {
          if (node.id === sourceNodeId) continue;
          for (let i = 0; i < node.inputs.length; i++) {
            if (isPortTypeCompatible(sourceType, node.inputs[i].portType)) {
              results.push({ nodeId: node.id, portIndex: i });
            }
          }
        }
        return results;
      },

      // Connection actions delegated to connectionSlice
      ...createConnectionActions(
        set, get,
        (label?: string) => pushUndo(get(), label),
        genConnectionId,
        () => getExecutionCache(getActiveUndoGraphId()),
        invalidateDownstream,
        () => scheduleAutoExecute(() => get().executeGraph()),
        // onCoercion: auto-insert converter node for incompatible type connections
        (rule, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex) => {
          const state = get();
          const sourceNode = state.nodes[sourceNodeId];
          const targetNode = state.nodes[targetNodeId];
          if (!sourceNode || !targetNode) return false;

          // Position converter at midpoint between source and target
          const midPos: [number, number, number] = [
            (sourceNode.position[0] + targetNode.position[0]) / 2,
            (sourceNode.position[1] + targetNode.position[1]) / 2,
            (sourceNode.position[2] + targetNode.position[2]) / 2,
          ];

          // Single undo entry for the whole coercion operation
          pushUndo(get(), 'Auto-coerce connection');

          // Create the converter node
          const converterId = genId();
          const converterConfig = NODE_TYPE_CONFIG[rule.converterType];
          if (!converterConfig) return false;
          const converterNode: EditorNode = {
            id: converterId,
            type: rule.converterType,
            position: midPos,
            title: `${TYPE_LABELS[rule.converterType] ?? rule.converterType} (auto)`,
            data: { ...(rule.initialData ?? {}) },
            inputs: makePortDefs('in', converterConfig.inputs),
            outputs: makePortDefs('out', converterConfig.outputs),
            autoInserted: true,
          };

          // Create both connections atomically
          const conn1Id = genConnectionId();
          const conn2Id = genConnectionId();
          set(s => {
            // Add converter node
            s.nodes[converterId] = converterNode;
            // Remove old connection on target input (single-input enforcement)
            const oldConnId = Object.keys(s.connections).find(cid => {
              const c = s.connections[cid];
              return c.targetNodeId === targetNodeId && c.targetPortIndex === targetPortIndex;
            });
            if (oldConnId) {
              delete s.connections[oldConnId];
              s.selectedIds.delete(oldConnId);
            }
            // Source → converter input
            s.connections[conn1Id] = {
              id: conn1Id,
              sourceNodeId,
              sourcePortIndex,
              targetNodeId: converterId,
              targetPortIndex: rule.inputPortIndex,
            };
            // Converter output → target
            s.connections[conn2Id] = {
              id: conn2Id,
              sourceNodeId: converterId,
              sourcePortIndex: rule.outputPortIndex,
              targetNodeId,
              targetPortIndex,
              label: rule.description,
            };
          });

          invalidateDownstream(converterId, get().connections, getExecutionCache(getActiveUndoGraphId()));
          invalidateDownstream(targetNodeId, get().connections, getExecutionCache(getActiveUndoGraphId()));
          scheduleAutoExecute(() => get().executeGraph());
          return true;
        },
      ),

      // Selection actions delegated to selectionSlice
      ...createSelectionActions(set, get),

      setInteraction: (mode) => {
        set(state => {
          state.interaction = mode;
        });
        if (mode === 'idle') {
          document.body.style.cursor = 'auto';
        }
      },


      // Core compound actions delegated to coreSlice
      ...createCoreActions(
        set,
        get,
        {
          pushUndo: (label?: string) => pushUndo(get(), label),
          genId,
          genConnectionId,
          genGraphId,
          cancelAutoExecute,
          scheduleAutoExecute,
          getInactiveGraphs: () => inactiveGraphs,
          saveInactiveGraphsToUndo,
          markCreatedInactiveGraphs,
          cleanupGraphResources,
          collectInnerGraphIds,
          sanitizeConnections,
          syncNextId,
          clearExecutionTimeoutsAndCache,
          _resetExecutionModuleState,
          clearAllTransientState,
          getActiveUndoGraphId,
          setActiveUndoGraphId,
          clearAllUndoStacks,
          executionInitialStats: executionInitialState.executionStats,
        },
      ),

      // selectConnected and boxSelect provided by createSelectionActions (line 605)

      // Persistence actions delegated to persistenceSlice
      ...createPersistenceActions(set, get, {
        pushUndo: (label?: string) => pushUndo(get(), label),
        cancelAutoExecute,
        syncNextId,
        clearExecutionTimeoutsAndCache,
        sanitizeConnections,
        sanitizeGraphOrder,
        clearAllTransientState,
        executionInitialStats: executionInitialState.executionStats,
        inactiveGraphs,
        getUndoStack,
        getRedoStack,
        getUndoMetaStack,
        getRedoMetaStack,
        getActiveUndoGraphId,
        setActiveUndoGraphId,
        clearAllUndoStacks,
        _resetExecutionModuleState,
        genId,
        genConnectionId,
        genGraphId,
        genGroupId,
        genTemplateId,
      }),

      // Undo/Redo actions delegated to undoSlice
      ...createUndoActions(set, get, {
        cancelAutoExecute,
        syncNextId,
        clearExecutionTimeoutsAndCache,
        clearAllTransientState,
      }),

      // Snap toggle
      toggleSnap: () => {
        set(state => {
          state.snapEnabled = !state.snapEnabled;
        });
      },

      // Value preview toggle
      toggleValuePreviews: () => {
        set(state => {
          state.showValuePreviews = !state.showValuePreviews;
        });
      },

      // Group actions delegated to groupSlice
      ...createGroupActions(
        set,
        get,
        (label?: string) => pushUndo(get(), label),
        genGroupId,
      ),

      // Layout actions delegated to layoutSlice
      ...createLayoutActions(
        set,
        get,
        (label?: string) => pushUndo(get(), label),
      ),

      // --- Context Menu ---

      openContextMenu: (menu) => {
        set(s => { s.contextMenu = menu; });
      },

      closeContextMenu: () => {
        set(s => { s.contextMenu = null; });
      },

      // Node data/toggle actions provided by createNodeActions above
      // (updateNodeData, toggleNodeCollapse, toggleNodeLock, batchToggleNodeLock)

      // Custom node definition actions provided by createCustomNodeActions
      ...createCustomNodeActions(set, get, {
        pushUndo: (label?: string) => pushUndo(get(), label),
        genId,
        genCustomDefId: () => `customdef-${nextId++}`,
        scheduleAutoExecute: (execute: () => void) => scheduleAutoExecute(execute),
        makePortDefs,
        invalidateDownstream: (nodeId: string, connections: Record<string, Connection>, cache: Map<string, unknown> | undefined) => invalidateDownstream(nodeId, connections, cache),
        getExecutionCache,
        getActiveUndoGraphId,
      }),

      // --- Search ---

      setSearchQuery: (query) => {
        set(s => { s.searchQuery = query; });
      },

      searchNodes: (query) => {
        const q = query.toLowerCase().trim();
        if (!q) return Object.values(get().nodes);
        return Object.values(get().nodes)
          .map(n => {
            const fields = [n.title, n.type, n.id];
            let bestScore = 0;
            for (const field of fields) {
              bestScore = Math.max(bestScore, fuzzyScore(q, field.toLowerCase()));
            }
            return { node: n, score: bestScore };
          })
          .filter(r => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(r => r.node);
      },

      focusNode: (nodeId) => {
        const node = get().nodes[nodeId];
        if (!node) return;
        set(s => { s.selectedIds = new Set([nodeId]); });
      },

      setHighlightedPorts: (ports) => {
        set(s => { s.highlightedPorts = ports; });
      },
      clearHighlightedPorts: () => {
        set(s => { s.highlightedPorts = new Set<string>(); s.incompatibleNodeIds = new Set<string>(); });
      },
      setSearchHighlightIds: (ids) => {
        set(s => { s.searchHighlightIds = ids; });
      },

      setDiffHighlight: (ids) => {
        set(s => { s.diffHighlightIds = ids; });
        // Cancel any pending auto-clear
        if (diffHighlightTimer) { clearTimeout(diffHighlightTimer); diffHighlightTimer = null; }
        // Auto-clear after 3 seconds
        if (ids.size > 0) {
          diffHighlightTimer = setTimeout(() => {
            diffHighlightTimer = null;
            set(s => { s.diffHighlightIds = new Map(); });
          }, 3000);
        }
      },

      // --- Execution (provided by executionSlice) ---
      ...createExecutionActions(
        set, get,
        () => getActiveUndoGraphId(),
        (graphId: string) => inactiveGraphs[graphId],
        get,
        () => useSettingsStore.getState().workerExecution,
      ),

      // updateConnectionLabel and updateConnectionColor provided by createConnectionActions above

      // invalidateNode and executeGraph provided by createExecutionActions above

      // --- Drag-from-port node creation ---

      getCompatibleNodeTypes: (sourceNodeId, sourcePortIndex, sourceIsOutput) => {
        const state = get();
        const sourceNode = state.nodes[sourceNodeId];
        if (!sourceNode) return [];

        // Determine the port type we're dragging from
        let sourcePortType: PortType;
        if (sourceIsOutput) {
          if (sourcePortIndex >= sourceNode.outputs.length) return [];
          sourcePortType = sourceNode.outputs[sourcePortIndex].portType;
        } else {
          if (sourcePortIndex >= sourceNode.inputs.length) return [];
          sourcePortType = sourceNode.inputs[sourcePortIndex].portType;
        }

        const results: { type: NodeType; category: NodeCategory }[] = [];
        const allTypes = Object.keys(NODE_TYPE_CONFIG) as NodeType[];

        for (const nodeType of allTypes) {
          if (nodeType === 'note') continue; // Notes have no ports
          const config = NODE_TYPE_CONFIG[nodeType];

          if (sourceIsOutput) {
            // Dragging from an output port → need a node type with a compatible INPUT
            const hasCompatibleInput = config.inputs.some(
              (input: PortConfig) => isPortTypeCompatible(sourcePortType, input.portType)
            );
            if (hasCompatibleInput) {
              results.push({ type: nodeType, category: NODE_CATEGORIES[nodeType] });
            }
          } else {
            // Dragging from an input port → need a node type with a compatible OUTPUT
            const hasCompatibleOutput = config.outputs.some(
              (output: PortConfig) => isPortTypeCompatible(output.portType, sourcePortType)
            );
            if (hasCompatibleOutput) {
              results.push({ type: nodeType, category: NODE_CATEGORIES[nodeType] });
            }
          }
        }

        return results;
      },

      addNodeAndConnect: (type, position, sourceNodeId, sourcePortIndex, sourceIsOutput) => {
        const state = get();
        const sourceNode = state.nodes[sourceNodeId];
        if (!sourceNode) return null;

        // Validate source port
        if (sourceIsOutput) {
          if (sourcePortIndex >= sourceNode.outputs.length) return null;
        } else {
          if (sourcePortIndex >= sourceNode.inputs.length) return null;
        }

        const sourcePortType = sourceIsOutput
          ? sourceNode.outputs[sourcePortIndex].portType
          : sourceNode.inputs[sourcePortIndex].portType;

        const config = NODE_TYPE_CONFIG[type];

        // Find the first compatible port on the new node
        let targetPortIdx = -1;
        if (sourceIsOutput) {
          // New node needs a compatible input
          targetPortIdx = config.inputs.findIndex(
            (input: PortConfig) => isPortTypeCompatible(sourcePortType, input.portType)
          );
        } else {
          // New node needs a compatible output
          targetPortIdx = config.outputs.findIndex(
            (output: PortConfig) => isPortTypeCompatible(output.portType, sourcePortType)
          );
        }

        if (targetPortIdx < 0) return null;

        // Compound action: single undo entry, direct set()
        pushUndo(state, 'Insert node on connection');
        const newNodeId = genId();
        const connId = genConnectionId();

        set(s => {
          // Create the new node
          const newNode: EditorNode = {
            id: newNodeId,
            type,
            position,
            title: TYPE_LABELS[type] ?? type,
            data: {},
            inputs: makePortDefs('in', config.inputs),
            outputs: makePortDefs('out', config.outputs),
          };
          s.nodes[newNodeId] = newNode;

          // Create the connection
          if (sourceIsOutput) {
            // Source output → new node's input
            s.connections[connId] = {
              id: connId,
              sourceNodeId,
              sourcePortIndex,
              targetNodeId: newNodeId,
              targetPortIndex: targetPortIdx,
            };
          } else {
            // New node's output → source input
            s.connections[connId] = {
              id: connId,
              sourceNodeId: newNodeId,
              sourcePortIndex: targetPortIdx,
              targetNodeId: sourceNodeId,
              targetPortIndex: sourcePortIndex,
            };
          }

          // Auto-select the new node
          s.selectedIds = new Set([newNodeId]);
        });

        // Invalidate cached results for the target of the new connection
        const targetNodeId = sourceIsOutput ? newNodeId : sourceNodeId;
        invalidateDownstream(targetNodeId, get().connections, getExecutionCache(getActiveUndoGraphId()));
        scheduleAutoExecute(() => get().executeGraph());
        return newNodeId;
      },

      insertRerouteOnConnection: (connectionId, position) => {
        const state = get();
        const conn = state.connections[connectionId];
        if (!conn) return null;

        const config = NODE_TYPE_CONFIG['reroute'];
        if (!config) return null;

        // Compound action: single undo entry
        pushUndo(state, 'Insert reroute');
        const rerouteId = genId();
        const conn1Id = genConnectionId();
        const conn2Id = genConnectionId();

        set(s => {
          // Create the reroute node at the given position
          const rerouteNode: EditorNode = {
            id: rerouteId,
            type: 'reroute',
            position,
            title: TYPE_LABELS['reroute'] ?? 'Reroute',
            data: {},
            inputs: makePortDefs('in', config.inputs),
            outputs: makePortDefs('out', config.outputs),
          };
          s.nodes[rerouteId] = rerouteNode;

          // Remove the original connection
          delete s.connections[connectionId];

          // Add source → reroute connection
          s.connections[conn1Id] = {
            id: conn1Id,
            sourceNodeId: conn.sourceNodeId,
            sourcePortIndex: conn.sourcePortIndex,
            targetNodeId: rerouteId,
            targetPortIndex: 0,
          };

          // Add reroute → target connection (preserve original metadata)
          s.connections[conn2Id] = {
            id: conn2Id,
            sourceNodeId: rerouteId,
            sourcePortIndex: 0,
            targetNodeId: conn.targetNodeId,
            targetPortIndex: conn.targetPortIndex,
            ...(conn.label !== undefined && { label: conn.label }),
            ...(conn.colorOverride !== undefined && { colorOverride: conn.colorOverride }),
            ...(conn.styleOverride !== undefined && { styleOverride: conn.styleOverride }),
          };

          // Select the new reroute node
          s.selectedIds = new Set([rerouteId]);
        });

        // Invalidate downstream cache — must invalidate both the reroute node and the
        // original target (same pattern as disconnectAndReroute)
        const cache = getExecutionCache(getActiveUndoGraphId());
        const conns = get().connections;
        invalidateDownstream(rerouteId, conns, cache);
        invalidateDownstream(conn.targetNodeId, conns, cache);
        scheduleAutoExecute(() => get().executeGraph());
        return rerouteId;
      },

      // --- Batch collapse ---

      collapseSelected: () => {
        const state = get();
        const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
        if (selectedNodeIds.length === 0) return;
        // Only collapse nodes that aren't already collapsed
        const toCollapse = selectedNodeIds.filter(id => !state.nodes[id].collapsed);
        if (toCollapse.length === 0) return;
        pushUndo(state, 'Collapse nodes');
        set(s => {
          for (const id of toCollapse) {
            s.nodes[id].collapsed = true;
          }
        });
      },

      expandSelected: () => {
        const state = get();
        const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
        if (selectedNodeIds.length === 0) return;
        // Only expand nodes that are collapsed
        const toExpand = selectedNodeIds.filter(id => state.nodes[id].collapsed);
        if (toExpand.length === 0) return;
        pushUndo(state, 'Expand nodes');
        set(s => {
          for (const id of toExpand) {
            s.nodes[id].collapsed = false;
          }
        });
      },

      // --- Graph validation ---

      validateGraph: () => {
        const state = get();
        const errors: Record<string, string[]> = {};
        const nodes = state.nodes;
        const connections = state.connections;

        // Build a set of connected target ports: { "nodeId:portIndex" }
        const connectedInputs = new Set<string>();
        const connectedOutputs = new Set<string>();
        const connectedNodes = new Set<string>();
        for (const conn of Object.values(connections)) {
          connectedInputs.add(`${conn.targetNodeId}:${conn.targetPortIndex}`);
          connectedOutputs.add(`${conn.sourceNodeId}:${conn.sourcePortIndex}`);
          connectedNodes.add(conn.sourceNodeId);
          connectedNodes.add(conn.targetNodeId);
        }

        // Type mismatch warnings: catch connections with incompatible concrete types
        // (can occur in imported/legacy data where both ports are concrete but differ)
        for (const conn of Object.values(connections)) {
          const srcNode = nodes[conn.sourceNodeId];
          const tgtNode = nodes[conn.targetNodeId];
          if (!srcNode || !tgtNode) continue;
          const srcPort = srcNode.outputs[conn.sourcePortIndex];
          const tgtPort = tgtNode.inputs[conn.targetPortIndex];
          if (!srcPort || !tgtPort) continue;
          const srcType = srcPort.portType;
          const tgtType = tgtPort.portType;
          // Only warn when both sides are concrete (non-any) and different
          if (srcType !== 'any' && tgtType !== 'any' && srcType !== tgtType) {
            const msg = `Type mismatch: ${srcType} → ${tgtType} (warning)`;
            if (!errors[conn.targetNodeId]) errors[conn.targetNodeId] = [];
            if (!errors[conn.targetNodeId].includes(msg)) {
              errors[conn.targetNodeId].push(msg);
            }
          }
        }

        // Terminal node types that are expected to have no outgoing connections
        const terminalTypes = new Set(['output', 'display', 'subgraph-output', 'note']);

        for (const node of Object.values(nodes)) {
          const nodeErrors: string[] = [];

          // Skip notes — they have no ports
          if (node.type === 'note') continue;

          // Check unconnected required inputs (skip 'source' and 'random' which have no inputs)
          for (let i = 0; i < node.inputs.length; i++) {
            const key = `${node.id}:${i}`;
            if (!connectedInputs.has(key)) {
              nodeErrors.push(`Input "${node.inputs[i].label}" is not connected`);
            }
          }

          // Check for disconnected nodes (warning: no connections at all)
          if (node.inputs.length > 0 || node.outputs.length > 0) {
            if (!connectedNodes.has(node.id)) {
              nodeErrors.push('Node has no connections (warning)');
            }
          }

          // Check for leaf nodes with unused outputs (warning)
          if (!terminalTypes.has(node.type) && node.outputs.length > 0) {
            const hasOutgoing = node.outputs.some((_, i) =>
              connectedOutputs.has(`${node.id}:${i}`)
            );
            // Only warn if the node IS connected somewhere (has inputs wired)
            // but its outputs go nowhere — truly disconnected nodes already warned above
            if (!hasOutgoing && connectedNodes.has(node.id)) {
              nodeErrors.push('Output not connected to anything (warning)');
            }
          }

          if (nodeErrors.length > 0) {
            if (!errors[node.id]) errors[node.id] = [];
            errors[node.id].push(...nodeErrors);
          }
        }

        // Per-node data/expression validation via validateNode utility
        for (const nodeId of Object.keys(nodes)) {
          const issues = validateNode(nodeId, nodes, connections);
          for (const issue of issues) {
            if (issue.message) {
              if (!errors[nodeId]) errors[nodeId] = [];
              errors[nodeId].push(issue.message);
            }
          }
        }

        // Node schema version mismatch warnings
        const mismatchWarnings = generateMismatchWarnings(nodes);
        for (const [nodeId, msgs] of Object.entries(mismatchWarnings)) {
          if (!errors[nodeId]) errors[nodeId] = [];
          errors[nodeId].push(...msgs);
        }

        // Cycle detection
        try {
          topologicalSort(nodes, connections);
        } catch {
          // Mark all nodes as having a cycle error — we can't pinpoint which nodes
          // are in the cycle without more analysis, but the user knows there's an issue
          for (const nodeId of Object.keys(nodes)) {
            if (!errors[nodeId]) errors[nodeId] = [];
            errors[nodeId].push('Graph contains a cycle');
          }
        }

        set(s => {
          s.validationErrors = errors;
        });
      },

      // updateCustomNodePorts provided by createCustomNodeActions above

      // --- Multi-graph tab management ---

      createGraph: (name) => {
        const graphId = genGraphId();
        const graphName = name || `Graph ${Object.keys(get().graphTabs).length + 1}`;
        set(s => {
          s.graphTabs[graphId] = { id: graphId, name: graphName, createdAt: Date.now() };
          s.graphOrder.push(graphId);
        });
        // Switch to the new graph (saves current, loads empty)
        get().switchGraph(graphId);
        return graphId;
      },

      deleteGraph: (graphId) => {
        cancelAutoExecute();
        const state = get();
        // Can't delete the last graph
        if (state.graphOrder.length <= 1) return;
        // Can't delete non-existent graph
        if (!state.graphTabs[graphId]) return;

        // Recursively collect inner graph IDs from subgraph nodes (for cascade cleanup)
        const graphData = graphId === state.activeGraphId
          ? { nodes: state.nodes }
          : inactiveGraphs[graphId];
        const innerGraphIds = collectInnerGraphIds(graphData);

        // If deleting the active graph, switch to another first
        if (state.activeGraphId === graphId) {
          const idx = state.graphOrder.indexOf(graphId);
          const switchTo = idx > 0 ? state.graphOrder[idx - 1] : state.graphOrder[idx + 1];
          if (switchTo) get().switchGraph(switchTo);
        }

        // Clean up per-graph module state + cascade inner graphs
        cleanupGraphResources([graphId, ...innerGraphIds]);

        set(s => {
          delete s.graphTabs[graphId];
          s.graphOrder = s.graphOrder.filter(id => id !== graphId);
          for (const innerGraphId of innerGraphIds) {
            if (s.graphTabs[innerGraphId]) {
              delete s.graphTabs[innerGraphId];
            }
          }
        });
      },

      switchGraph: (graphId) => {
        cancelAutoExecute();
        const state = get();
        if (graphId === state.activeGraphId) return;
        if (!state.graphTabs[graphId]) return;

        // Save current graph state to inactive storage (including subgraphDefs, errorStrategy)
        const currentData: GraphData = {
          nodes: structuredClone(state.nodes),
          connections: structuredClone(state.connections),
          groups: structuredClone(state.groups),
          customNodeDefs: structuredClone(state.customNodeDefs),
          subgraphDefs: Object.keys(state.subgraphDefs).length > 0 ? structuredClone(state.subgraphDefs) : undefined,
          errorStrategy: state.errorStrategy !== 'fail-fast' ? state.errorStrategy : undefined,
          checkpoints: Object.keys(state.checkpoints).length > 0 ? structuredClone(state.checkpoints) : undefined,
          graphVariables: Object.keys(state.graphVariables).length > 0 ? structuredClone(state.graphVariables) : undefined,
          executionStats: state.executionStats.executionCount > 0 ? structuredClone(state.executionStats) : undefined,
        };
        inactiveGraphs[state.activeGraphId] = currentData;

        // Clear execution state from current graph
        clearExecutionTimeouts();

        // Load target graph data
        const targetData = inactiveGraphs[graphId];

        // Switch the active graph ID for undo/redo
        setActiveUndoGraphId(graphId);

        if (targetData) {
          const state = get();
          syncNextId(targetData.nodes, targetData.connections, targetData.groups, [
            ...Object.keys(state.graphTabs),
            ...Object.keys(state.templates),
          ]);
          set(s => {
            s.activeGraphId = graphId;
            s.nodes = targetData.nodes;
            s.connections = targetData.connections;
            s.groups = targetData.groups;
            s.customNodeDefs = targetData.customNodeDefs;
            s.subgraphDefs = targetData.subgraphDefs ?? {};
            s.errorStrategy = targetData.errorStrategy ?? 'fail-fast';
            s.checkpoints = targetData.checkpoints ?? {};
            s.validationErrors = {};
            s.selectedIds = new Set<string>();
            clearAllTransientState(s);
            s.breadcrumbStack = [];
            s.graphVariables = validateGraphVariables(targetData.graphVariables ?? {}).variables;
            s.executionStats = targetData.executionStats ?? executionInitialState.executionStats;
            s.executionHistory = [];
          });
          delete inactiveGraphs[graphId];
        } else {
          // New empty graph
          set(s => {
            s.activeGraphId = graphId;
            s.nodes = {};
            s.connections = {};
            s.groups = {};
            s.customNodeDefs = {};
            s.subgraphDefs = {};
            s.errorStrategy = 'fail-fast';
            s.checkpoints = {};
            s.graphVariables = {};
            s.executionStats = executionInitialState.executionStats;
            s.validationErrors = {};
            s.selectedIds = new Set<string>();
            clearAllTransientState(s);
            s.breadcrumbStack = [];
            s.executionHistory = [];
          });
        }
      },

      // renameGraph and reorderGraph provided by graphSlice
      ...createGraphActions(set, get),

      // Template actions delegated to templateSlice
      ...createTemplateActions(set, get, {
        pushUndo: (label?: string) => pushUndo(get(), label),
        genId,
        genConnectionId,
        genTemplateId,
      }),

      // exportAllGraphs and mergeImportedGraphs provided by persistenceSlice (above)

      // Subgraph actions delegated to subgraphSlice
      ...createSubgraphActions(set, get, {
        pushUndo: (label?: string) => pushUndo(get(), label),
        genId,
        genGraphId,
        genConnectionId,
        scheduleAutoExecute: (execute: () => void) => scheduleAutoExecute(execute),
        cancelAutoExecute,
        syncNextId,
        clearExecutionTimeouts,
        getExecutionCache,
        clearAllTransientState,
        executionInitialStats: executionInitialState.executionStats,
        inactiveGraphs,
        saveInactiveGraphsToUndo,
        markCreatedInactiveGraphs,
        collectInnerGraphIds,
        cleanupGraphResources,
        setActiveUndoGraphId,
      }),

      // Checkpoint actions delegated to checkpointSlice
      ...createCheckpointActions(set, get, {
        pushUndo: (label?: string) => pushUndo(get(), label),
        genCheckpointId: () => `checkpoint-${nextId++}`,
        cancelAutoExecute,
        syncNextId,
        clearExecutionTimeoutsAndCache,
        clearAllTransientState,
        executionInitialStats: executionInitialState.executionStats,
        getActiveUndoGraphId,
      }),

      // --- HTTP Fetch for live data nodes ---
      clearGraphVariables: () => {
        if (Object.keys(get().graphVariables).length === 0) return;
        pushUndo(get(), 'Clear graph variables');
        set(s => { s.graphVariables = {}; });
      },

      fetchNodeData: (nodeId, url) => {
        const state = get();
        const node = state.nodes[nodeId];
        if (!node || node.type !== 'http-fetch') return;
        // Set loading state
        set(s => {
          if (s.nodes[nodeId]) {
            s.nodes[nodeId].data._fetchStatus = 0;
            s.nodes[nodeId].data._fetchError = '';
          }
        });
        // Main-thread fetch (not in Worker — CORS requires same origin context)
        fetch(url)
          .then(async (resp) => {
            let data: unknown;
            const ct = resp.headers.get('content-type') ?? '';
            if (ct.includes('application/json')) {
              data = await resp.json();
            } else {
              data = await resp.text();
            }
            set(s => {
              if (s.nodes[nodeId]) {
                s.nodes[nodeId].data._fetchResult = data;
                s.nodes[nodeId].data._fetchStatus = resp.status;
                s.nodes[nodeId].data._fetchError = '';
              }
            });
            // Trigger auto-execute after fetch completes
            scheduleAutoExecute(() => get().executeGraph());
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            set(s => {
              if (s.nodes[nodeId]) {
                s.nodes[nodeId].data._fetchResult = null;
                s.nodes[nodeId].data._fetchStatus = 0;
                s.nodes[nodeId].data._fetchError = msg;
              }
            });
            // Trigger auto-execute so downstream error port propagates
            scheduleAutoExecute(() => get().executeGraph());
          });
      },

    }))
  )
);

// inactiveGraphs, collectInnerGraphIds, cleanupGraphResources are now in undoSlice.ts

// Auto-save on every state change (debounced) — saves all graphs in multi-graph format
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useEditorStore.subscribe(
  (state) => ({
    nodes: state.nodes, connections: state.connections, groups: state.groups,
    customNodeDefs: state.customNodeDefs, subgraphDefs: state.subgraphDefs, graphTabs: state.graphTabs,
    activeGraphId: state.activeGraphId, graphOrder: state.graphOrder, templates: state.templates,
    errorStrategy: state.errorStrategy, checkpoints: state.checkpoints, graphVariables: state.graphVariables,
    executionStats: state.executionStats,
  }),
  ({ nodes, connections, groups, customNodeDefs, subgraphDefs, graphTabs, activeGraphId, graphOrder, templates, errorStrategy, checkpoints, graphVariables, executionStats }) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // Respect the autoSave setting from settingsStore
      if (!useSettingsStore.getState().autoSave) return;
      // Build multi-graph storage (subgraphDefs stored per-graph in GraphData)
      const graphs: Record<string, GraphData> = {
        [activeGraphId]: {
          nodes, connections, groups, customNodeDefs,
          subgraphDefs: Object.keys(subgraphDefs).length > 0 ? subgraphDefs : undefined,
          errorStrategy: errorStrategy !== 'fail-fast' ? errorStrategy : undefined,
          checkpoints: Object.keys(checkpoints).length > 0 ? checkpoints : undefined,
          graphVariables: Object.keys(graphVariables).length > 0 ? graphVariables : undefined,
          executionStats: executionStats.executionCount > 0 ? executionStats : undefined,
        },
      };
      // Include inactive graphs (already have subgraphDefs in their GraphData)
      for (const [id, data] of Object.entries(inactiveGraphs)) {
        graphs[id] = data;
      }
      const storage: MultiGraphStorage = {
        version: 2,
        graphs,
        graphTabs,
        activeGraphId,
        graphOrder,
        templates,
        // Keep top-level subgraphDefs for backward compatibility with existing saved data
        subgraphDefs: Object.keys(subgraphDefs).length > 0 ? subgraphDefs : undefined,
      };
      saveMultiGraphAsync(storage).then((ok) => {
        if (!ok) {
          useEditorStore.setState((s) => { s.storageWarning = 'Storage save failed — changes may not be saved'; });
        } else {
          useEditorStore.setState((s) => {
            s.lastSaveTime = Date.now();
            if (s.storageWarning) s.storageWarning = null;
          });
        }
      });
    }, 500);
  },
  { equalityFn: (a, b) => a === b }
);

// Auto-validate on node or connection changes (debounced 300ms)
let validateTimer: ReturnType<typeof setTimeout> | null = null;
const triggerValidation = () => {
  if (validateTimer) clearTimeout(validateTimer);
  validateTimer = setTimeout(() => {
    useEditorStore.getState().validateGraph();
  }, 300);
};
useEditorStore.subscribe(
  (state) => state.connections,
  triggerValidation,
);
useEditorStore.subscribe(
  (state) => state.nodes,
  triggerValidation,
);

// Centralized cursor reset: any transition to interaction='idle' resets cursor.
// This catches ALL paths (undo/redo, clearGraph, switchGraph, etc.) without
// needing explicit cursor resets at each call site.
useEditorStore.subscribe(
  (state) => state.interaction,
  (mode) => {
    if (mode === 'idle') {
      document.body.style.cursor = 'auto';
    }
  },
);

/**
 * Reset all module-scoped state for testing. Production code should NOT use this.
 * Clears: undo/redo stacks, clipboard, execution cache/timeouts, inactive graphs.
 */
export function _resetModuleState() {
  _resetUndoModuleState(DEFAULT_GRAPH_ID);
  _resetExecutionModuleState();
  cancelAutoExecute();
  // Cancel pending debounced save/validate/diffHighlight timers to prevent cross-test leakage
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (validateTimer) { clearTimeout(validateTimer); validateTimer = null; }
  if (diffHighlightTimer) { clearTimeout(diffHighlightTimer); diffHighlightTimer = null; }
  _resetClipboard();
  nextId = 1;
}

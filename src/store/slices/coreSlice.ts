/**
 * Core slice — compound multi-step actions that orchestrate undo, subgraph cleanup,
 * clipboard, and graph-level operations.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - duplicateSelected / deleteSelected (selection operations)
 * - copySelected / paste / canPaste (clipboard operations)
 * - clearGraph (graph reset)
 * - importWorkflow / importAllGraphs (import operations)
 */
import type { EditorNode, Connection, NodeGroup, CustomNodeDef, SubgraphNodeDef, GraphTab, GraphData, ErrorStrategy, ExecutionStats } from '../../types';
import { sanitizeGraphOrder } from './graphSlice';
import { validateGraphData } from '../../utils/migration';
import { migrateAllNodes } from '../../utils/nodeVersioning';
import { validateGraphVariables } from '../../utils/validation';

// --- Clipboard (module-scoped, like undo/redo) ---
interface ClipboardData {
  nodes: EditorNode[];
  connections: Connection[];
  groups?: Record<string, NodeGroup>;
  customNodeDefs?: Record<string, CustomNodeDef>;
  subgraphDefs?: Record<string, SubgraphNodeDef>;
  innerGraphs?: Record<string, GraphData>;
  innerGraphTabs?: Record<string, GraphTab>;
}
let clipboard: ClipboardData | null = null;

/** Reset clipboard state (used by tests) */
export function _resetClipboard(): void {
  clipboard = null;
}

/** System clipboard envelope key to identify our data */
const CLIPBOARD_ENVELOPE_KEY = 'node-editor-3d-clipboard';

/** Write serialized clipboard to system clipboard (fire-and-forget). */
function writeToSystemClipboard(data: ClipboardData): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      const envelope = { [CLIPBOARD_ENVELOPE_KEY]: true, ...data };
      navigator.clipboard.writeText(JSON.stringify(envelope)).catch(() => {
        // Silently fail — module-scoped clipboard is the primary mechanism
      });
    }
  } catch {
    // navigator.clipboard not available (insecure context, etc.)
  }
}

/**
 * Try to read graph clipboard data from the system clipboard.
 * Returns true if system clipboard contained valid data and the module-scoped
 * clipboard was updated. Returns false if system clipboard doesn't contain
 * valid data or isn't available.
 */
export async function readFromSystemClipboard(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return false;
    const text = await navigator.clipboard.readText();
    if (!text) return false;
    const parsed = JSON.parse(text);
    if (!parsed || parsed[CLIPBOARD_ENVELOPE_KEY] !== true) return false;
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return false;
    if (!Array.isArray(parsed.connections)) return false;
    // Update module-scoped clipboard with system clipboard data
    clipboard = {
      nodes: parsed.nodes,
      connections: parsed.connections,
      ...(parsed.groups ? { groups: parsed.groups } : {}),
      ...(parsed.customNodeDefs ? { customNodeDefs: parsed.customNodeDefs } : {}),
      ...(parsed.subgraphDefs ? { subgraphDefs: parsed.subgraphDefs } : {}),
      ...(parsed.innerGraphs ? { innerGraphs: parsed.innerGraphs } : {}),
      ...(parsed.innerGraphTabs ? { innerGraphTabs: parsed.innerGraphTabs } : {}),
    };
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** State fields accessible by core actions via set() */
export interface CoreMutableState {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups: Record<string, NodeGroup>;
  selectedIds: Set<string>;
  customNodeDefs: Record<string, CustomNodeDef>;
  subgraphDefs: Record<string, SubgraphNodeDef>;
  graphTabs: Record<string, GraphTab>;
  checkpoints: Record<string, unknown>;
  validationErrors: Record<string, string[]>;
  graphVariables: Record<string, unknown>;
  executionStats: ExecutionStats;
  executionHistory: unknown[];
  executionHistoryIndex: number;
  errorStrategy: ErrorStrategy;
  breadcrumbStack: { graphId: string; subgraphNodeId: string }[];
  activeGraphId: string;
  graphOrder: string[];
  templates: Record<string, unknown>;
  breakpoints: Record<string, true>;
  breakpointConditions: Record<string, string>;
}

/** State fields readable by core actions via get() */
export interface CoreReadableState extends CoreMutableState {
  executeGraph: () => void;
}

export interface CoreActions {
  duplicateSelected: (inPlace?: boolean) => Map<string, string> | null;
  deleteSelected: () => void;
  copySelected: () => void;
  paste: () => void;
  canPaste: () => boolean;
  clearGraph: () => void;
  importWorkflow: (data: { nodes: Record<string, EditorNode>; connections: Record<string, Connection>; groups?: Record<string, NodeGroup>; customNodeDefs?: Record<string, CustomNodeDef>; subgraphDefs?: Record<string, SubgraphNodeDef>; innerGraphs?: Record<string, GraphData>; innerGraphTabs?: Record<string, GraphTab>; errorStrategy?: ErrorStrategy }) => void;
  /** Recursively bundle inner graphs of all subgraph nodes in the active graph (for share links / export). */
  collectInnerGraphsForExport: () => { innerGraphs: Record<string, GraphData>; innerGraphTabs: Record<string, GraphTab> };
  importAllGraphs: (storage: { version: number; graphs: Record<string, GraphData>; graphTabs: Record<string, GraphTab>; activeGraphId: string; graphOrder: string[]; templates?: Record<string, unknown>; subgraphDefs?: Record<string, SubgraphNodeDef> }) => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCoreActions(
  set: (fn: (state: CoreMutableState) => void) => void,
  get: () => CoreReadableState,
  deps: {
    pushUndo: (label?: string) => void;
    genId: () => string;
    genConnectionId: () => string;
    genGraphId: () => string;
    cancelAutoExecute: () => void;
    scheduleAutoExecute: (execute: () => void) => void;
    getInactiveGraphs: () => Record<string, GraphData>;
    saveInactiveGraphsToUndo: (graphIds: string[]) => void;
    markCreatedInactiveGraphs: (graphIds: string[]) => void;
    cleanupGraphResources: (graphIds: string[]) => void;
    collectInnerGraphIds: (data: { nodes: Record<string, EditorNode> } | undefined) => string[];
    sanitizeConnections: (nodes: Record<string, EditorNode>, connections: Record<string, Connection>) => Record<string, Connection>;
    syncNextId: (nodes: Record<string, EditorNode>, connections: Record<string, Connection>, groups?: Record<string, NodeGroup>, extraKeys?: string[]) => void;
    clearExecutionTimeoutsAndCache: (graphId: string) => void;
    _resetExecutionModuleState: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clearAllTransientState: (state: any) => void;
    getActiveUndoGraphId: () => string;
    setActiveUndoGraphId: (id: string) => void;
    clearAllUndoStacks: () => void;
    executionInitialStats: ExecutionStats;
  },
): CoreActions {
  const {
    pushUndo, genId, genConnectionId, genGraphId,
    cancelAutoExecute, scheduleAutoExecute,
    getInactiveGraphs, saveInactiveGraphsToUndo, markCreatedInactiveGraphs,
    cleanupGraphResources, collectInnerGraphIds,
    sanitizeConnections, syncNextId,
    clearExecutionTimeoutsAndCache, _resetExecutionModuleState,
    clearAllTransientState,
    getActiveUndoGraphId, setActiveUndoGraphId, clearAllUndoStacks,
    executionInitialStats,
  } = deps;

  return {
    duplicateSelected: (inPlace?: boolean) => {
      const state = get();
      const nodesToDupe = [...state.selectedIds]
        .map(id => state.nodes[id])
        .filter(Boolean);
      if (nodesToDupe.length === 0) return null;
      pushUndo('Duplicate selection');
      const newIds = new Set<string>();
      const oldToNew = new Map<string, string>();
      const createdInnerGraphIds: string[] = [];
      const inactiveGraphs = getInactiveGraphs();
      // Create nodes directly without going through addNode (which pushes undo)
      set(s => {
        for (const node of nodesToDupe) {
          const id = genId();
          oldToNew.set(node.id, id);
          const newData = structuredClone(node.data);

          // Handle subgraph node duplication
          if (node.type === 'subgraph') {
            const oldInnerGraphId = node.data.innerGraphId as string | undefined;
            if (oldInnerGraphId) {
              const newInnerGraphId = genGraphId();
              newData.innerGraphId = newInnerGraphId;
              newData.subgraphDefId = id;
              // Copy inner graph to inactive storage
              if (inactiveGraphs[oldInnerGraphId]) {
                inactiveGraphs[newInnerGraphId] = structuredClone(inactiveGraphs[oldInnerGraphId]);
                createdInnerGraphIds.push(newInnerGraphId);
              }
              // Copy subgraph def with updated references
              const oldDefId = node.data.subgraphDefId as string | undefined;
              if (oldDefId && state.subgraphDefs[oldDefId]) {
                s.subgraphDefs[id] = {
                  ...structuredClone(state.subgraphDefs[oldDefId]),
                  id,
                  innerGraphId: newInnerGraphId,
                };
              }
              // Create graph tab for the new inner graph
              if (state.graphTabs[oldInnerGraphId]) {
                s.graphTabs[newInnerGraphId] = {
                  ...structuredClone(state.graphTabs[oldInnerGraphId]),
                  id: newInnerGraphId,
                };
              }
            }
          }

          s.nodes[id] = {
            id,
            type: node.type,
            position: inPlace
              ? [...node.position] as [number, number, number]
              : [node.position[0] + 1.5, node.position[1], node.position[2] + 1],
            title: node.title + (inPlace ? '' : ' Copy'),
            data: newData,
            inputs: structuredClone(node.inputs),
            outputs: structuredClone(node.outputs),
            collapsed: node.collapsed,
            groupId: node.groupId,
            comment: node.comment,
            autoInserted: node.autoInserted,
            locked: node.locked,
            ...(node.width !== undefined && { width: node.width }),
            ...(node.height !== undefined && { height: node.height }),
          };
          newIds.add(id);
        }
        // Duplicate connections between selected nodes
        const selectedSet = state.selectedIds;
        for (const conn of Object.values(state.connections)) {
          const newSrc = oldToNew.get(conn.sourceNodeId);
          const newTgt = oldToNew.get(conn.targetNodeId);
          if (newSrc && newTgt && selectedSet.has(conn.sourceNodeId) && selectedSet.has(conn.targetNodeId)) {
            const connId = genConnectionId();
            s.connections[connId] = {
              id: connId,
              sourceNodeId: newSrc,
              sourcePortIndex: conn.sourcePortIndex,
              targetNodeId: newTgt,
              targetPortIndex: conn.targetPortIndex,
              ...(conn.label ? { label: conn.label } : {}),
              ...(conn.colorOverride ? { colorOverride: conn.colorOverride } : {}),
              ...(conn.styleOverride !== undefined && { styleOverride: conn.styleOverride }),
            };
          }
        }
        s.selectedIds = newIds;
      });
      // Track created inactiveGraphs so undo can clean them up (prevent orphan leak)
      if (createdInnerGraphIds.length > 0) {
        markCreatedInactiveGraphs(createdInnerGraphIds);
      }
      return oldToNew;
    },

    deleteSelected: () => {
      const state = get();
      if (state.selectedIds.size === 0) return;
      pushUndo('Delete selection');

      // Recursively collect all inner graph IDs for cascade cleanup (module-scoped, outside immer)
      // Only collect from nodes that WILL be deleted (not locked, not boundary nodes)
      const allInnerIds: string[] = [];
      const inactiveGraphs = getInactiveGraphs();
      for (const id of state.selectedIds) {
        const node = state.nodes[id];
        if (node?.type === 'subgraph' && !node.locked) {
          const innerGraphId = node.data.innerGraphId as string;
          if (innerGraphId) {
            allInnerIds.push(innerGraphId);
            allInnerIds.push(...collectInnerGraphIds(inactiveGraphs[innerGraphId]));
          }
        }
      }

      set(s => {
        for (const id of state.selectedIds) {
          if (s.nodes[id]) {
            // Subgraph boundary nodes cannot be deleted
            if (s.nodes[id].type === 'subgraph-input' || s.nodes[id].type === 'subgraph-output') continue;
            // Locked nodes cannot be deleted
            if (s.nodes[id].locked) continue;
            // Clean up subgraph def if this is a subgraph node
            if (s.nodes[id].type === 'subgraph') {
              delete s.subgraphDefs[id];
            }
            delete s.nodes[id];
            // Clean up breakpoints for deleted node
            delete s.breakpoints[id];
            delete s.breakpointConditions[id];
            // Cascade delete connections
            for (const [connId, conn] of Object.entries(s.connections)) {
              if (conn.sourceNodeId === id || conn.targetNodeId === id) {
                delete s.connections[connId];
              }
            }
          } else if (s.connections[id]) {
            delete s.connections[id];
          }
        }
        // Remove all inner graph tabs
        for (const gId of allInnerIds) {
          if (s.graphTabs[gId]) delete s.graphTabs[gId];
        }
        // Clean up empty groups (groups with no remaining members)
        for (const groupId of Object.keys(s.groups)) {
          const hasMembers = Object.values(s.nodes).some(n => n.groupId === groupId);
          if (!hasMembers) {
            delete s.groups[groupId];
          }
        }
        s.selectedIds = new Set<string>();
      });

      // Save inner graph data to undo entry before deleting (for undo restoration)
      saveInactiveGraphsToUndo(allInnerIds);
      // Clean up module-scoped resources for deleted subgraph inner graphs (recursive)
      cleanupGraphResources(allInnerIds);
      scheduleAutoExecute(() => get().executeGraph());
    },

    // Copy selected nodes + internal connections to clipboard
    copySelected: () => {
      const state = get();
      const selectedNodeIds = new Set(
        [...state.selectedIds].filter(id => state.nodes[id])
      );
      if (selectedNodeIds.size === 0) return;
      const nodes = [...selectedNodeIds].map(id => structuredClone(state.nodes[id]));
      // Preserve connections that are fully within the selection
      const connections = Object.values(state.connections)
        .filter(c => selectedNodeIds.has(c.sourceNodeId) && selectedNodeIds.has(c.targetNodeId))
        .map(c => structuredClone(c));
      // Preserve groups that selected nodes belong to (cross-graph clipboard)
      const groups: Record<string, NodeGroup> = {};
      for (const node of nodes) {
        if (node.groupId && state.groups[node.groupId] && !groups[node.groupId]) {
          groups[node.groupId] = structuredClone(state.groups[node.groupId]);
        }
      }
      // Preserve custom node definitions referenced by selected custom nodes (cross-graph support)
      const customNodeDefs: Record<string, CustomNodeDef> = {};
      for (const node of nodes) {
        if (node.type === 'custom') {
          const defId = node.data.customDefId as string | undefined;
          if (defId && state.customNodeDefs[defId] && !customNodeDefs[defId]) {
            customNodeDefs[defId] = structuredClone(state.customNodeDefs[defId]);
          }
        }
      }
      // Preserve subgraph node metadata for paste
      const subgraphDefs: Record<string, SubgraphNodeDef> = {};
      const innerGraphs: Record<string, GraphData> = {};
      const innerGraphTabs: Record<string, GraphTab> = {};
      const inactiveGraphs = getInactiveGraphs();
      for (const node of nodes) {
        if (node.type === 'subgraph') {
          const defId = node.data.subgraphDefId as string | undefined;
          const innerGraphId = node.data.innerGraphId as string | undefined;
          if (defId && state.subgraphDefs[defId]) {
            subgraphDefs[node.id] = structuredClone(state.subgraphDefs[defId]);
          }
          if (innerGraphId && inactiveGraphs[innerGraphId]) {
            innerGraphs[innerGraphId] = structuredClone(inactiveGraphs[innerGraphId]);
          }
          if (innerGraphId && state.graphTabs[innerGraphId]) {
            innerGraphTabs[innerGraphId] = structuredClone(state.graphTabs[innerGraphId]);
          }
        }
      }
      clipboard = {
        nodes, connections,
        ...(Object.keys(groups).length > 0 ? { groups } : {}),
        ...(Object.keys(customNodeDefs).length > 0 ? { customNodeDefs } : {}),
        ...(Object.keys(subgraphDefs).length > 0 ? { subgraphDefs } : {}),
        ...(Object.keys(innerGraphs).length > 0 ? { innerGraphs } : {}),
        ...(Object.keys(innerGraphTabs).length > 0 ? { innerGraphTabs } : {}),
      };
      // Also write to system clipboard for cross-tab copy/paste
      writeToSystemClipboard(clipboard);
    },

    // Paste clipboard contents with offset
    paste: () => {
      if (!clipboard || clipboard.nodes.length === 0) return;
      pushUndo('Paste');
      const idMap = new Map<string, string>();
      const newIds = new Set<string>();
      const createdInnerGraphIds: string[] = [];
      const inactiveGraphs = getInactiveGraphs();
      set(s => {
        // Create new nodes with offset
        for (const node of clipboard!.nodes) {
          const newId = genId();
          idMap.set(node.id, newId);
          const newData = structuredClone(node.data);

          // Handle subgraph node cloning
          if (node.type === 'subgraph') {
            const oldInnerGraphId = node.data.innerGraphId as string | undefined;
            if (oldInnerGraphId) {
              const newInnerGraphId = genGraphId();
              newData.innerGraphId = newInnerGraphId;
              newData.subgraphDefId = newId;
              // Copy inner graph to inactive storage
              const clipboardInnerGraph = clipboard!.innerGraphs?.[oldInnerGraphId];
              if (clipboardInnerGraph) {
                inactiveGraphs[newInnerGraphId] = structuredClone(clipboardInnerGraph);
                createdInnerGraphIds.push(newInnerGraphId);
              }
              // Copy subgraph def with updated references
              const clipboardDef = clipboard!.subgraphDefs?.[node.id];
              if (clipboardDef) {
                s.subgraphDefs[newId] = {
                  ...structuredClone(clipboardDef),
                  id: newId,
                  innerGraphId: newInnerGraphId,
                };
              }
              // Create graph tab for the new inner graph
              const clipboardTab = clipboard!.innerGraphTabs?.[oldInnerGraphId];
              if (clipboardTab) {
                s.graphTabs[newInnerGraphId] = { ...structuredClone(clipboardTab), id: newInnerGraphId };
              }
            }
          }

          s.nodes[newId] = {
            id: newId,
            type: node.type,
            position: [node.position[0] + 1.5, node.position[1], node.position[2] + 1],
            title: node.title,
            data: newData,
            inputs: structuredClone(node.inputs),
            outputs: structuredClone(node.outputs),
            collapsed: node.collapsed,
            groupId: node.groupId,
            comment: node.comment,
            autoInserted: node.autoInserted,
            locked: node.locked,
            ...(node.width !== undefined && { width: node.width }),
            ...(node.height !== undefined && { height: node.height }),
          };
          newIds.add(newId);
        }
        // Recreate internal connections with remapped IDs
        for (const conn of clipboard!.connections) {
          const newSource = idMap.get(conn.sourceNodeId);
          const newTarget = idMap.get(conn.targetNodeId);
          if (newSource && newTarget) {
            const connId = genConnectionId();
            s.connections[connId] = {
              id: connId,
              sourceNodeId: newSource,
              sourcePortIndex: conn.sourcePortIndex,
              targetNodeId: newTarget,
              targetPortIndex: conn.targetPortIndex,
              ...(conn.label !== undefined && { label: conn.label }),
              ...(conn.colorOverride !== undefined && { colorOverride: conn.colorOverride }),
              ...(conn.styleOverride !== undefined && { styleOverride: conn.styleOverride }),
            };
          }
        }
        // Restore groups from clipboard (cross-graph paste)
        if (clipboard!.groups) {
          for (const [groupId, group] of Object.entries(clipboard!.groups)) {
            if (!s.groups[groupId]) {
              s.groups[groupId] = structuredClone(group);
            }
          }
        }
        // Restore custom node definitions (cross-graph paste)
        if (clipboard!.customNodeDefs) {
          for (const [defId, def] of Object.entries(clipboard!.customNodeDefs)) {
            if (!s.customNodeDefs[defId]) {
              s.customNodeDefs[defId] = structuredClone(def);
            }
          }
        }
        s.selectedIds = newIds;
      });
      // Track created inactiveGraphs so undo can clean them up (prevent orphan leak)
      if (createdInnerGraphIds.length > 0) {
        markCreatedInactiveGraphs(createdInnerGraphIds);
      }
      // Trigger auto-execution after paste (pasted nodes may have connections)
      scheduleAutoExecute(() => get().executeGraph());
    },

    canPaste: () => clipboard !== null && clipboard.nodes.length > 0,

    collectInnerGraphsForExport: () => {
      const state = get();
      const inactiveGraphs = getInactiveGraphs();
      const innerGraphs: Record<string, GraphData> = {};
      const innerGraphTabs: Record<string, GraphTab> = {};
      const visit = (nodes: Record<string, EditorNode>) => {
        for (const node of Object.values(nodes) as EditorNode[]) {
          if (node.type !== 'subgraph') continue;
          const innerGraphId = node.data.innerGraphId as string | undefined;
          if (!innerGraphId || innerGraphs[innerGraphId]) continue;
          const inner = inactiveGraphs[innerGraphId];
          if (!inner) continue;
          innerGraphs[innerGraphId] = structuredClone(inner);
          if (state.graphTabs[innerGraphId]) {
            innerGraphTabs[innerGraphId] = structuredClone(state.graphTabs[innerGraphId]);
          }
          // Nested subgraphs: bundle their inner graphs too
          visit(inner.nodes);
        }
      };
      visit(state.nodes);
      return { innerGraphs, innerGraphTabs };
    },

    clearGraph: () => {
      cancelAutoExecute();
      const state = get();
      if (Object.keys(state.nodes).length === 0 &&
          Object.keys(state.connections).length === 0 &&
          Object.keys(state.groups).length === 0) return;
      pushUndo('Clear graph');
      // Recursively collect all inner graph IDs for cascade cleanup
      const allInnerIds = collectInnerGraphIds({ nodes: state.nodes });
      // Save inner graph data to undo entry before deleting (for undo restoration)
      saveInactiveGraphsToUndo(allInnerIds);
      cleanupGraphResources(allInnerIds);
      // Clear execution timeouts and cache
      clearExecutionTimeoutsAndCache(getActiveUndoGraphId());
      set(s => {
        // Remove all inner graph tabs
        for (const gId of allInnerIds) {
          if (s.graphTabs[gId]) delete s.graphTabs[gId];
        }
        s.nodes = {};
        s.connections = {};
        s.groups = {};
        s.customNodeDefs = {};
        s.subgraphDefs = {};
        s.checkpoints = {};
        s.validationErrors = {};
        s.selectedIds = new Set<string>();
        clearAllTransientState(s);
        s.breadcrumbStack = [];
        s.graphVariables = {};
        s.executionStats = executionInitialStats;
        s.executionHistory = [];
        // Note: errorStrategy is preserved — it's a user preference, not graph data
      });
    },

    importWorkflow: (data) => {
      cancelAutoExecute();
      const currentState = get();
      pushUndo('Import workflow');
      // Cascade-cleanup inner graphs owned by subgraph nodes being replaced (recursive)
      const allInnerIds = collectInnerGraphIds({ nodes: currentState.nodes });
      // Save inner graph data to undo snapshot BEFORE cleaning up, so undo can restore them
      saveInactiveGraphsToUndo(allInnerIds);
      cleanupGraphResources(allInnerIds);
      const groups = data.groups ?? {};
      const customDefs = data.customNodeDefs ?? {};
      const cleanConnections = sanitizeConnections(data.nodes, data.connections);
      // Migrate node schemas and validate graph data (same as importAllGraphs)
      migrateAllNodes(data.nodes);
      validateGraphData({ nodes: data.nodes, connections: cleanConnections, groups, customNodeDefs: customDefs });
      // Bundled inner graphs (subgraph internals from share links / exports):
      // their ids and node/connection ids must never collide with newly
      // generated ids, so feed them into the id-counter sync below.
      const bundledInnerGraphs = data.innerGraphs ?? {};
      const innerExtraKeys: string[] = [];
      for (const [gId, g] of Object.entries(bundledInnerGraphs)) {
        innerExtraKeys.push(gId);
        innerExtraKeys.push(...Object.keys(g.nodes), ...Object.keys(g.connections));
      }
      syncNextId(data.nodes, cleanConnections, groups, [
        ...Object.keys(currentState.graphTabs),
        ...Object.keys(currentState.templates),
        ...innerExtraKeys,
      ]);

      // Remap bundled inner graphs to fresh graph ids — share links come from
      // foreign workspaces, so their graph ids could clobber other tabs here.
      // (Mirrors the clipboard paste model; node ids inside each graph keep
      // their ids since each graph is its own node namespace.)
      const graphIdMap = new Map<string, string>();
      for (const oldId of Object.keys(bundledInnerGraphs)) graphIdMap.set(oldId, genGraphId());
      // Subgraph names by (old) inner graph id, for tab fallback names
      const defNameByOldGraphId = new Map<string, string>();
      for (const def of Object.values(data.subgraphDefs ?? {})) defNameByOldGraphId.set(def.innerGraphId, def.name);
      for (const g of Object.values(bundledInnerGraphs)) {
        for (const def of Object.values(g.subgraphDefs ?? {})) defNameByOldGraphId.set(def.innerGraphId, def.name);
      }
      const remapSubgraphRefs = (nodes: Record<string, EditorNode>, defs?: Record<string, SubgraphNodeDef>) => {
        for (const node of Object.values(nodes)) {
          if (node.type !== 'subgraph') continue;
          const oldId = node.data.innerGraphId as string | undefined;
          if (oldId && graphIdMap.has(oldId)) node.data.innerGraphId = graphIdMap.get(oldId)!;
        }
        if (defs) {
          for (const def of Object.values(defs)) {
            if (graphIdMap.has(def.innerGraphId)) def.innerGraphId = graphIdMap.get(def.innerGraphId)!;
          }
        }
      };
      const importedSubgraphDefs = structuredClone(data.subgraphDefs ?? {});
      remapSubgraphRefs(data.nodes, importedSubgraphDefs);

      const inactiveGraphs = getInactiveGraphs();
      const createdInnerGraphIds: string[] = [];
      const newInnerTabs: Record<string, GraphTab> = {};
      for (const [oldId, innerGraph] of Object.entries(bundledInnerGraphs)) {
        const newId = graphIdMap.get(oldId)!;
        const clone = structuredClone(innerGraph);
        clone.connections = sanitizeConnections(clone.nodes, clone.connections);
        migrateAllNodes(clone.nodes);
        remapSubgraphRefs(clone.nodes, clone.subgraphDefs);
        // Top-level inner graphs hang off the graph being imported into;
        // nested ones hang off their (remapped) parent inner graph.
        clone.parentGraphId = clone.parentGraphId && graphIdMap.has(clone.parentGraphId)
          ? graphIdMap.get(clone.parentGraphId)!
          : currentState.activeGraphId;
        inactiveGraphs[newId] = clone;
        createdInnerGraphIds.push(newId);
        const tab = data.innerGraphTabs?.[oldId];
        newInnerTabs[newId] = tab
          ? { ...structuredClone(tab), id: newId }
          : { id: newId, name: defNameByOldGraphId.get(oldId) ?? 'Subgraph', createdAt: Date.now() };
      }

      // Clear execution timeouts and cache from previous graph
      clearExecutionTimeoutsAndCache(getActiveUndoGraphId());
      set(s => {
        // Remove inner graph tabs from previous state (recursive)
        for (const gId of allInnerIds) {
          if (s.graphTabs[gId]) delete s.graphTabs[gId];
        }
        s.nodes = data.nodes;
        s.connections = cleanConnections;
        s.groups = groups;
        s.customNodeDefs = customDefs;
        s.subgraphDefs = importedSubgraphDefs;
        for (const [gId, tab] of Object.entries(newInnerTabs)) {
          s.graphTabs[gId] = tab;
        }
        s.checkpoints = {};
        s.graphVariables = {};
        s.executionStats = executionInitialStats;
        s.validationErrors = {};
        s.errorStrategy = (data as { errorStrategy?: ErrorStrategy }).errorStrategy ?? 'fail-fast';
        s.selectedIds = new Set<string>();
        clearAllTransientState(s);
        s.breadcrumbStack = [];
        s.executionHistory = [];
      });
      // Track created inner graphs so undo can clean them up (prevent orphan leak)
      if (createdInnerGraphIds.length > 0) {
        markCreatedInactiveGraphs(createdInnerGraphIds);
      }
    },

    importAllGraphs: (storage) => {
      if (!storage || storage.version !== 2) return;
      const activeId = storage.activeGraphId;
      const activeGraph = storage.graphs[activeId];
      if (!activeGraph) return;
      cancelAutoExecute();

      // Note: no pushUndo here — we're about to clear all stacks anyway.
      // Import replaces the entire workspace, so undo is not meaningful.

      // Clear all per-graph module state
      clearAllUndoStacks();
      _resetExecutionModuleState();
      const inactiveGraphs = getInactiveGraphs();
      for (const key of Object.keys(inactiveGraphs)) delete inactiveGraphs[key];

      // Sanitize connections, migrate node schemas, and validate all graph data
      for (const [, gd] of Object.entries(storage.graphs)) {
        gd.connections = sanitizeConnections(gd.nodes, gd.connections);
        migrateAllNodes(gd.nodes);
        validateGraphData(gd);
      }

      // Store inactive graphs
      for (const [graphId, graphData] of Object.entries(storage.graphs)) {
        if (graphId !== activeId) {
          inactiveGraphs[graphId] = structuredClone(graphData);
        }
      }

      setActiveUndoGraphId(activeId);
      // Collect all IDs across all graphs, templates, and graph tabs to prevent collisions
      const allExtraKeys = [
        ...Object.keys(storage.graphTabs),
        ...Object.keys(storage.templates ?? {}),
      ];
      for (const [, graphData] of Object.entries(storage.graphs)) {
        if (graphData !== activeGraph) {
          allExtraKeys.push(...Object.keys(graphData.nodes), ...Object.keys(graphData.connections), ...Object.keys(graphData.groups));
        }
      }
      syncNextId(activeGraph.nodes, activeGraph.connections, activeGraph.groups, allExtraKeys);

      // Sanitize graphOrder to match graphTabs
      const cleanGraphOrder = sanitizeGraphOrder(storage.graphTabs, storage.graphOrder);

      set(s => {
        s.nodes = structuredClone(activeGraph.nodes);
        s.connections = structuredClone(activeGraph.connections);
        s.groups = structuredClone(activeGraph.groups);
        s.customNodeDefs = structuredClone(activeGraph.customNodeDefs);
        // Prefer per-graph subgraphDefs, fall back to top-level for backward compat
        s.subgraphDefs = activeGraph.subgraphDefs
          ? structuredClone(activeGraph.subgraphDefs)
          : storage.subgraphDefs
            ? structuredClone(storage.subgraphDefs)
            : {};
        s.errorStrategy = activeGraph.errorStrategy ?? 'fail-fast';
        s.checkpoints = activeGraph.checkpoints ? structuredClone(activeGraph.checkpoints) : {};
        s.graphVariables = validateGraphVariables(activeGraph.graphVariables ?? {}).variables;
        s.executionStats = activeGraph.executionStats ? structuredClone(activeGraph.executionStats) : executionInitialStats;
        s.validationErrors = {};
        s.graphTabs = structuredClone(storage.graphTabs);
        s.activeGraphId = activeId;
        s.graphOrder = cleanGraphOrder;
        s.templates = structuredClone(storage.templates ?? {});
        s.selectedIds = new Set<string>();
        clearAllTransientState(s);
        s.executionHistory = [];
        s.breadcrumbStack = [];
      });
    },
  };
}

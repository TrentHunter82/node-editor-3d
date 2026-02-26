/**
 * Persistence slice — manages loading/saving graph data from storage.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - loadFromStorage (synchronous localStorage load)
 * - loadFromStorageAsync (async IndexedDB load)
 * - exportAllGraphs (export all graphs as MultiGraphStorage)
 * - mergeImportedGraphs (merge imported graphs with ID remapping)
 */
import type { EditorNode, Connection, NodeGroup, CustomNodeDef, SubgraphNodeDef, GraphData, GraphTab, ErrorStrategy, ExecutionStats, CheckpointEntry, NodeTemplate } from '../../types';
import type { MultiGraphStorage } from '../../utils/serialization';
import { loadGraph, loadMultiGraph, loadMultiGraphAsync } from '../../utils/serialization';
import { validateGraphData } from '../../utils/migration';
import { migrateAllNodes } from '../../utils/nodeVersioning';
import { loadExecutionResults } from './executionSlice';
import { validateGraphVariables } from '../../utils/validation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersistenceState {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups: Record<string, NodeGroup>;
  customNodeDefs: Record<string, CustomNodeDef>;
  subgraphDefs: Record<string, SubgraphNodeDef>;
  selectedIds: Set<string>;
  activeGraphId: string;
  graphTabs: Record<string, GraphTab>;
  graphOrder: string[];
  templates: Record<string, NodeTemplate>;
  breadcrumbStack: { graphId: string; subgraphNodeId: string }[];
  validationErrors: Record<string, string[]>;
  errorStrategy: ErrorStrategy;
  checkpoints: Record<string, CheckpointEntry>;
  graphVariables: Record<string, unknown>;
  executionStats: ExecutionStats;
  executionHistory: unknown[];
  executionHistoryIndex: number;
  pendingConnection: unknown;
  nodeOutputs: Record<string, Record<number, unknown>>;
  executionTimings: Record<string, number>;
  executionErrors: Record<string, string>;
  storageWarning: string | null;
  lastSaveTime: number | null;
}

export interface PersistenceActions {
  loadFromStorage: () => boolean;
  loadFromStorageAsync: () => Promise<boolean>;
  exportAllGraphs: () => MultiGraphStorage;
  mergeImportedGraphs: (storage: MultiGraphStorage) => void;
}

interface PersistenceHelpers {
  pushUndo: (label?: string) => void;
  cancelAutoExecute: () => void;
  syncNextId: (nodes: Record<string, EditorNode>, connections: Record<string, Connection>, groups?: Record<string, NodeGroup>, extraKeys?: string[]) => void;
  clearExecutionTimeoutsAndCache: (graphId: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clearAllTransientState: (state: any) => void;
  clearAllUndoStacks: () => void;
  _resetExecutionModuleState: () => void;
  setActiveUndoGraphId: (id: string) => void;
  getActiveUndoGraphId: () => string;
  getUndoStack: () => unknown[];
  getRedoStack: () => unknown[];
  getUndoMetaStack: () => unknown[];
  getRedoMetaStack: () => unknown[];
  inactiveGraphs: Record<string, GraphData>;
  sanitizeConnections: (nodes: Record<string, EditorNode>, connections: Record<string, Connection>) => Record<string, Connection>;
  sanitizeGraphOrder: (tabs: Record<string, GraphTab>, order: string[]) => string[];
  executionInitialStats: ExecutionStats;
  // ID generation helpers
  genId: () => string;
  genConnectionId: () => string;
  genGraphId: () => string;
  genGroupId: () => string;
  genTemplateId: () => string;
}

// ---------------------------------------------------------------------------
// Actions factory
// ---------------------------------------------------------------------------

export function createPersistenceActions(
  set: (fn: (state: PersistenceState) => void) => void,
  get: () => PersistenceState,
  helpers: PersistenceHelpers,
): PersistenceActions {
  const {
    pushUndo, cancelAutoExecute,
    syncNextId, clearExecutionTimeoutsAndCache,
    sanitizeConnections, sanitizeGraphOrder, clearAllTransientState, executionInitialStats,
    inactiveGraphs,
    getUndoStack, getRedoStack, getUndoMetaStack, getRedoMetaStack,
    getActiveUndoGraphId, setActiveUndoGraphId,
    clearAllUndoStacks, _resetExecutionModuleState,
    genId, genConnectionId, genGraphId, genGroupId, genTemplateId,
  } = helpers;

  return {
    loadFromStorage: () => {
      cancelAutoExecute();
      try {
        const storage = loadMultiGraph();
        if (!storage) {
          // Fallback to legacy single-graph load
          const data = loadGraph();
          if (!data) return false;
          if (typeof data.nodes !== 'object' || typeof data.connections !== 'object') return false;
          const groups = (data as { groups?: Record<string, NodeGroup> }).groups ?? {};
          const customDefs = (data as { customNodeDefs?: Record<string, CustomNodeDef> }).customNodeDefs ?? {};
          const cleanConns = sanitizeConnections(data.nodes, data.connections);
          // Validate and normalize loaded graph data (fix corrupt fields, remove invalid entries)
          const graphData = { nodes: data.nodes, connections: cleanConns, groups, customNodeDefs: customDefs };
          validateGraphData(graphData);
          migrateAllNodes(graphData.nodes);
          const currentState = get();
          syncNextId(graphData.nodes, graphData.connections, graphData.groups, [
            ...Object.keys(currentState.graphTabs),
            ...Object.keys(currentState.templates),
          ]);
          clearExecutionTimeoutsAndCache(getActiveUndoGraphId());
          set(state => {
            state.nodes = graphData.nodes;
            state.connections = graphData.connections;
            state.groups = graphData.groups;
            state.customNodeDefs = graphData.customNodeDefs;
            state.subgraphDefs = {};
            state.validationErrors = {};
            state.errorStrategy = 'fail-fast';
            state.executionHistory = [];
            state.executionHistoryIndex = -1;
            state.selectedIds = new Set<string>();
            state.pendingConnection = null;
            state.breadcrumbStack = [];
            state.graphVariables = {};
            state.executionStats = executionInitialStats;
            state.checkpoints = {};
            clearAllTransientState(state);
          });
          // Restore persisted execution results (value previews) if available
          const legacyResults = loadExecutionResults('default');
          if (legacyResults) {
            set(state => {
              state.nodeOutputs = legacyResults.nodeOutputs;
              state.executionTimings = legacyResults.executionTimings;
              state.executionErrors = legacyResults.executionErrors;
            });
          }
          // Clear history on fresh load
          getUndoStack().length = 0;
          getRedoStack().length = 0;
          getUndoMetaStack().length = 0;
          getRedoMetaStack().length = 0;
          return true;
        }

        // Multi-graph format: restore all graphs
        const activeId = storage.activeGraphId;
        const activeGraph = storage.graphs[activeId];
        if (!activeGraph) return false;

        // Clear all per-graph module state
        clearAllUndoStacks();
        _resetExecutionModuleState();
        // Clear inactive graphs storage
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
            inactiveGraphs[graphId] = graphData;
          }
        }

        setActiveUndoGraphId(activeId);
        // Collect all IDs across all graphs, templates, and graph tabs to prevent collisions
        const allExtraKeys = [
          ...Object.keys(storage.graphTabs),
          ...Object.keys(storage.templates ?? {}),
        ];
        // Also scan inactive graph IDs to avoid collisions
        for (const [, graphData] of Object.entries(storage.graphs)) {
          if (graphData !== activeGraph) {
            allExtraKeys.push(...Object.keys(graphData.nodes), ...Object.keys(graphData.connections), ...Object.keys(graphData.groups));
          }
        }
        syncNextId(activeGraph.nodes, activeGraph.connections, activeGraph.groups, allExtraKeys);

        set(state => {
          state.nodes = activeGraph.nodes;
          state.connections = activeGraph.connections;
          state.groups = activeGraph.groups;
          state.customNodeDefs = activeGraph.customNodeDefs;
          // Prefer per-graph subgraphDefs, fall back to top-level for backward compat
          state.subgraphDefs = activeGraph.subgraphDefs ?? storage.subgraphDefs ?? {};
          state.errorStrategy = activeGraph.errorStrategy ?? 'fail-fast';
          state.checkpoints = activeGraph.checkpoints ?? {};
          state.validationErrors = {};
          state.graphTabs = storage.graphTabs;
          state.activeGraphId = activeId;
          state.graphOrder = sanitizeGraphOrder(storage.graphTabs, storage.graphOrder);
          state.templates = storage.templates ?? {};
          state.breadcrumbStack = [];
          state.executionHistory = [];
          state.executionHistoryIndex = -1;
          state.selectedIds = new Set<string>();
          state.pendingConnection = null;
          state.graphVariables = validateGraphVariables(activeGraph.graphVariables ?? {}).variables;
          state.executionStats = activeGraph.executionStats ?? executionInitialStats;
          clearAllTransientState(state);
        });

        // Restore persisted execution results (value previews) if available
        const persistedResults = loadExecutionResults(activeId);
        if (persistedResults) {
          set(state => {
            state.nodeOutputs = persistedResults.nodeOutputs;
            state.executionTimings = persistedResults.executionTimings;
            state.executionErrors = persistedResults.executionErrors;
          });
        }

        getUndoStack().length = 0;
        getRedoStack().length = 0;
        getUndoMetaStack().length = 0;
        getRedoMetaStack().length = 0;
        return true;
      } catch (e) {
        console.warn('[node-editor-3d] Failed to restore state from storage:', e);
        return false;
      }
    },

    loadFromStorageAsync: async () => {
      cancelAutoExecute();
      try {
        const storage = await loadMultiGraphAsync();
        if (!storage) {
          // Fallback to legacy single-graph load
          const data = loadGraph();
          if (!data) return false;
          if (typeof data.nodes !== 'object' || typeof data.connections !== 'object') return false;
          const groups = (data as { groups?: Record<string, NodeGroup> }).groups ?? {};
          const customDefs = (data as { customNodeDefs?: Record<string, CustomNodeDef> }).customNodeDefs ?? {};
          const cleanConns = sanitizeConnections(data.nodes, data.connections);
          const graphData = { nodes: data.nodes, connections: cleanConns, groups, customNodeDefs: customDefs };
          validateGraphData(graphData);
          migrateAllNodes(graphData.nodes);
          const currentState = get();
          syncNextId(graphData.nodes, graphData.connections, graphData.groups, [
            ...Object.keys(currentState.graphTabs),
            ...Object.keys(currentState.templates),
          ]);
          clearExecutionTimeoutsAndCache(getActiveUndoGraphId());
          set(state => {
            state.nodes = graphData.nodes;
            state.connections = graphData.connections;
            state.groups = graphData.groups;
            state.customNodeDefs = graphData.customNodeDefs;
            state.subgraphDefs = {};
            state.validationErrors = {};
            state.errorStrategy = 'fail-fast';
            state.executionHistory = [];
            state.executionHistoryIndex = -1;
            state.selectedIds = new Set<string>();
            state.pendingConnection = null;
            state.breadcrumbStack = [];
            state.graphVariables = {};
            state.executionStats = executionInitialStats;
            state.checkpoints = {};
            clearAllTransientState(state);
          });
          const legacyResults = loadExecutionResults('default');
          if (legacyResults) {
            set(state => {
              state.nodeOutputs = legacyResults.nodeOutputs;
              state.executionTimings = legacyResults.executionTimings;
              state.executionErrors = legacyResults.executionErrors;
            });
          }
          getUndoStack().length = 0;
          getRedoStack().length = 0;
          getUndoMetaStack().length = 0;
          getRedoMetaStack().length = 0;
          return true;
        }

        // Multi-graph format: restore all graphs
        const activeId = storage.activeGraphId;
        const activeGraph = storage.graphs[activeId];
        if (!activeGraph) return false;

        // Clear all per-graph module state
        clearAllUndoStacks();
        _resetExecutionModuleState();
        // Clear inactive graphs storage
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
            inactiveGraphs[graphId] = graphData;
          }
        }

        setActiveUndoGraphId(activeId);
        // Collect all IDs across all graphs, templates, and graph tabs to prevent collisions
        const allExtraKeys = [
          ...Object.keys(storage.graphTabs),
          ...Object.keys(storage.templates ?? {}),
        ];
        // Also scan inactive graph IDs to avoid collisions
        for (const [, graphData] of Object.entries(storage.graphs)) {
          if (graphData !== activeGraph) {
            allExtraKeys.push(...Object.keys(graphData.nodes), ...Object.keys(graphData.connections), ...Object.keys(graphData.groups));
          }
        }
        syncNextId(activeGraph.nodes, activeGraph.connections, activeGraph.groups, allExtraKeys);

        set(state => {
          state.nodes = activeGraph.nodes;
          state.connections = activeGraph.connections;
          state.groups = activeGraph.groups;
          state.customNodeDefs = activeGraph.customNodeDefs;
          // Prefer per-graph subgraphDefs, fall back to top-level for backward compat
          state.subgraphDefs = activeGraph.subgraphDefs ?? storage.subgraphDefs ?? {};
          state.errorStrategy = activeGraph.errorStrategy ?? 'fail-fast';
          state.checkpoints = activeGraph.checkpoints ?? {};
          state.validationErrors = {};
          state.graphTabs = storage.graphTabs;
          state.activeGraphId = activeId;
          state.graphOrder = sanitizeGraphOrder(storage.graphTabs, storage.graphOrder);
          state.templates = storage.templates ?? {};
          state.breadcrumbStack = [];
          state.executionHistory = [];
          state.executionHistoryIndex = -1;
          state.selectedIds = new Set<string>();
          state.pendingConnection = null;
          state.graphVariables = validateGraphVariables(activeGraph.graphVariables ?? {}).variables;
          state.executionStats = activeGraph.executionStats ?? executionInitialStats;
          clearAllTransientState(state);
        });

        // Restore persisted execution results (value previews) if available
        const persistedResults = loadExecutionResults(activeId);
        if (persistedResults) {
          set(state => {
            state.nodeOutputs = persistedResults.nodeOutputs;
            state.executionTimings = persistedResults.executionTimings;
            state.executionErrors = persistedResults.executionErrors;
          });
        }

        getUndoStack().length = 0;
        getRedoStack().length = 0;
        getUndoMetaStack().length = 0;
        getRedoMetaStack().length = 0;
        return true;
      } catch (e) {
        console.warn('[node-editor-3d] Failed to restore state from IndexedDB:', e);
        return false;
      }
    },

    exportAllGraphs: () => {
      const state = get();
      const graphs: Record<string, GraphData> = {
        [state.activeGraphId]: {
          nodes: state.nodes,
          connections: state.connections,
          groups: state.groups,
          customNodeDefs: state.customNodeDefs,
          subgraphDefs: Object.keys(state.subgraphDefs).length > 0 ? state.subgraphDefs : undefined,
          errorStrategy: state.errorStrategy !== 'fail-fast' ? state.errorStrategy : undefined,
          checkpoints: Object.keys(state.checkpoints).length > 0 ? state.checkpoints : undefined,
          graphVariables: Object.keys(state.graphVariables).length > 0 ? state.graphVariables : undefined,
          executionStats: state.executionStats.executionCount > 0 ? state.executionStats : undefined,
        },
      };
      for (const [id, data] of Object.entries(inactiveGraphs)) {
        graphs[id] = data;
      }
      return structuredClone({
        version: 2,
        graphs,
        graphTabs: state.graphTabs,
        activeGraphId: state.activeGraphId,
        graphOrder: state.graphOrder,
        templates: state.templates,
        subgraphDefs: state.subgraphDefs,
      } as MultiGraphStorage);
    },

    mergeImportedGraphs: (storage) => {
      if (!storage || storage.version !== 2) return;
      const importedGraphIds = Object.keys(storage.graphs);
      if (importedGraphIds.length === 0) return;
      cancelAutoExecute();
      pushUndo('Merge import graphs');

      // Build a complete ID map: old imported IDs -> new IDs
      // This ensures internal references (connections, groups, subgraphDefs) remain consistent
      const idMap = new Map<string, string>();
      const graphIdMap = new Map<string, string>();

      // Generate new IDs for all graph tabs
      for (const graphId of importedGraphIds) {
        const newGraphId = genGraphId();
        graphIdMap.set(graphId, newGraphId);
      }

      // Pre-scan all imported graphs to build a complete ID map for nodes, connections, and groups
      for (const [, graphData] of Object.entries(storage.graphs)) {
        for (const nodeId of Object.keys(graphData.nodes)) {
          idMap.set(nodeId, genId());
        }
        for (const connId of Object.keys(graphData.connections)) {
          idMap.set(connId, genConnectionId());
        }
        for (const groupId of Object.keys(graphData.groups)) {
          idMap.set(groupId, genGroupId());
        }
      }

      // Remap a single graph's data using the ID maps
      function remapGraph(graphData: GraphData): GraphData {
        const newNodes: Record<string, EditorNode> = {};
        for (const [oldId, node] of Object.entries(graphData.nodes)) {
          const newId = idMap.get(oldId) ?? oldId;
          const newNode: EditorNode = {
            ...structuredClone(node),
            id: newId,
            groupId: node.groupId ? (idMap.get(node.groupId) ?? node.groupId) : undefined,
          };
          // Remap subgraph inner graph references
          if (node.type === 'subgraph' && node.data.innerGraphId) {
            newNode.data = {
              ...newNode.data,
              innerGraphId: graphIdMap.get(node.data.innerGraphId as string) ?? node.data.innerGraphId,
              subgraphDefId: idMap.get(node.data.subgraphDefId as string) ?? node.data.subgraphDefId,
            };
          }
          newNodes[newId] = newNode;
        }

        const newConnections: Record<string, Connection> = {};
        for (const [oldId, conn] of Object.entries(graphData.connections)) {
          const newId = idMap.get(oldId) ?? oldId;
          newConnections[newId] = {
            ...structuredClone(conn),
            id: newId,
            sourceNodeId: idMap.get(conn.sourceNodeId) ?? conn.sourceNodeId,
            targetNodeId: idMap.get(conn.targetNodeId) ?? conn.targetNodeId,
          };
        }

        const newGroups: Record<string, NodeGroup> = {};
        for (const [oldId, group] of Object.entries(graphData.groups)) {
          const newId = idMap.get(oldId) ?? oldId;
          newGroups[newId] = { ...structuredClone(group), id: newId };
        }

        // Remap subgraphDefs
        let newSubgraphDefs: Record<string, SubgraphNodeDef> | undefined;
        if (graphData.subgraphDefs && Object.keys(graphData.subgraphDefs).length > 0) {
          newSubgraphDefs = {};
          for (const [oldId, def] of Object.entries(graphData.subgraphDefs)) {
            const newId = idMap.get(oldId) ?? oldId;
            newSubgraphDefs[newId] = {
              ...def,
              id: newId,
              innerGraphId: graphIdMap.get(def.innerGraphId) ?? def.innerGraphId,
              exposedInputs: def.exposedInputs.map(ei => ({
                ...ei, innerNodeId: idMap.get(ei.innerNodeId) ?? ei.innerNodeId,
              })),
              exposedOutputs: def.exposedOutputs.map(eo => ({
                ...eo, innerNodeId: idMap.get(eo.innerNodeId) ?? eo.innerNodeId,
              })),
            };
          }
        }

        return {
          nodes: newNodes,
          connections: newConnections,
          groups: newGroups,
          customNodeDefs: structuredClone(graphData.customNodeDefs),
          subgraphDefs: newSubgraphDefs,
          errorStrategy: graphData.errorStrategy,
          checkpoints: undefined, // Drop checkpoints on merge — snapshot IDs would be stale after remap
          graphVariables: graphData.graphVariables ? structuredClone(graphData.graphVariables) : undefined,
          executionStats: graphData.executionStats ? structuredClone(graphData.executionStats) : undefined,
          parentGraphId: graphData.parentGraphId ? (graphIdMap.get(graphData.parentGraphId) ?? graphData.parentGraphId) : undefined,
          parentNodeId: graphData.parentNodeId ? (idMap.get(graphData.parentNodeId) ?? graphData.parentNodeId) : undefined,
        };
      }

      // Migrate and validate all imported graphs, then remap IDs
      for (const [, gd] of Object.entries(storage.graphs)) {
        gd.connections = sanitizeConnections(gd.nodes, gd.connections);
        migrateAllNodes(gd.nodes);
        validateGraphData(gd);
      }

      // Store all remapped graphs as inactive (don't replace current workspace)
      for (const [oldGraphId, graphData] of Object.entries(storage.graphs)) {
        const newGraphId = graphIdMap.get(oldGraphId)!;
        inactiveGraphs[newGraphId] = remapGraph(graphData);
      }

      // Collect inner subgraph graph IDs — these should NOT appear in graphOrder
      const innerGraphIds = new Set<string>();
      for (const [, graphData] of Object.entries(storage.graphs)) {
        if (graphData.subgraphDefs) {
          for (const def of Object.values(graphData.subgraphDefs)) {
            innerGraphIds.add(def.innerGraphId);
          }
        }
        for (const node of Object.values(graphData.nodes)) {
          if (node.type === 'subgraph' && node.data.innerGraphId) {
            innerGraphIds.add(node.data.innerGraphId as string);
          }
        }
      }

      // Add graph tabs for imported graphs
      set(s => {
        for (const [oldGraphId, tab] of Object.entries(storage.graphTabs)) {
          const newGraphId = graphIdMap.get(oldGraphId);
          if (newGraphId) {
            s.graphTabs[newGraphId] = {
              ...structuredClone(tab),
              id: newGraphId,
              name: `${tab.name} (imported)`,
            };
            // Only add top-level graphs to tab bar, not inner subgraph graphs
            if (!innerGraphIds.has(oldGraphId)) {
              s.graphOrder.push(newGraphId);
            }
          }
        }
        // Merge templates (import with new IDs)
        if (storage.templates) {
          for (const [, tmpl] of Object.entries(storage.templates)) {
            const newTemplateId = genTemplateId();
            s.templates[newTemplateId] = {
              ...structuredClone(tmpl),
              id: newTemplateId,
            };
          }
        }
      });
    },
  };
}

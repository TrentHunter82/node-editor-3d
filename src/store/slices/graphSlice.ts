/**
 * Graph management slice — manages multi-graph tabs, graph ordering,
 * and breadcrumb stack for subgraph navigation.
 *
 * Extracted from editorStore.ts for modularity. Contains state, types,
 * initial values, and self-contained actions (rename, reorder).
 *
 * Note: switchGraph, deleteGraph, createGraph, enterSubgraph, exitSubgraph
 * remain in editorStore.ts because they orchestrate saving/restoring ALL
 * per-graph state (nodes, connections, groups, customNodeDefs, subgraphDefs,
 * errorStrategy, etc.) and would require passing 15+ fields as parameters.
 */
import type { GraphTab } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_GRAPH_ID = 'default';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphSliceState {
  graphTabs: Record<string, GraphTab>;
  activeGraphId: string;
  graphOrder: string[];
  breadcrumbStack: { graphId: string; subgraphNodeId: string }[];
}

export interface GraphSliceActions {
  createGraph: (name?: string) => string;
  deleteGraph: (graphId: string) => void;
  switchGraph: (graphId: string) => void;
  renameGraph: (graphId: string, name: string) => void;
  reorderGraph: (graphId: string, newIndex: number) => void;
  updateGraphMetadata: (graphId: string, metadata: { description?: string; author?: string; tags?: string[] }) => void;
}

export type GraphSlice = GraphSliceState & GraphSliceActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const graphInitialState: GraphSliceState = {
  graphTabs: { [DEFAULT_GRAPH_ID]: { id: DEFAULT_GRAPH_ID, name: 'Main', createdAt: Date.now() } } as Record<string, GraphTab>,
  activeGraphId: DEFAULT_GRAPH_ID,
  graphOrder: [DEFAULT_GRAPH_ID],
  breadcrumbStack: [] as { graphId: string; subgraphNodeId: string }[],
};

// ---------------------------------------------------------------------------
// Self-contained actions factory
// ---------------------------------------------------------------------------

/**
 * Creates the self-contained graph management actions (rename, reorder).
 * createGraph, deleteGraph, switchGraph are orchestration-level and remain in editorStore.
 */
export function createGraphActions(
  set: (fn: (state: GraphSliceState) => void) => void,
  get: () => GraphSliceState,
): Pick<GraphSliceActions, 'renameGraph' | 'reorderGraph' | 'updateGraphMetadata'> {
  return {
    renameGraph: (graphId, name) => {
      if (!get().graphTabs[graphId]) return;
      set(s => {
        s.graphTabs[graphId].name = name;
      });
    },

    reorderGraph: (graphId, newIndex) => {
      const state = get();
      const currentIndex = state.graphOrder.indexOf(graphId);
      if (currentIndex === -1) return;
      const clamped = Math.max(0, Math.min(newIndex, state.graphOrder.length - 1));
      if (currentIndex === clamped) return;
      set(s => {
        const order = [...s.graphOrder];
        order.splice(currentIndex, 1);
        order.splice(clamped, 0, graphId);
        s.graphOrder = order;
      });
    },

    updateGraphMetadata: (graphId, metadata) => {
      if (!get().graphTabs[graphId]) return;
      set(s => {
        const tab = s.graphTabs[graphId];
        if (metadata.description !== undefined) tab.description = metadata.description || undefined;
        if (metadata.author !== undefined) tab.author = metadata.author || undefined;
        if (metadata.tags !== undefined) tab.tags = metadata.tags.length > 0 ? metadata.tags : undefined;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Graph order sanitization helper
// ---------------------------------------------------------------------------

/**
 * Ensure graphOrder contains all graphTabs keys and no extra entries.
 * Used by loadFromStorage and importWorkflow to repair potentially stale saved order.
 */
export function sanitizeGraphOrder(
  graphTabs: Record<string, GraphTab>,
  graphOrder: string[],
): string[] {
  const tabIds = new Set(Object.keys(graphTabs));
  const clean = (graphOrder ?? []).filter(id => tabIds.has(id));
  for (const id of tabIds) {
    if (!clean.includes(id)) clean.push(id);
  }
  return clean;
}

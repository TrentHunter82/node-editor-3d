/**
 * Node slice — manages node CRUD, position updates, data mutations, and batch operations.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - addNode / removeNode (creation / deletion with cascade cleanup)
 * - updateNodePosition / setNodePositions (hot-drag, no undo)
 * - updateNodeTitle / updateNodeComment / batchUpdateNodeTitles (rename)
 * - updateNodeData / batchUpdateNodeData (data mutation + cache invalidation)
 * - batchMoveNodes (nudge with undo)
 * - toggleNodeLock / batchToggleNodeLock / toggleNodeCollapse (toggle flags)
 */
import type { EditorNode, Connection, NodeType, NodeGroup, SubgraphNodeDef, GraphTab, GraphData, PortType } from '../../types';
import { NODE_TYPE_CONFIG } from '../../types';
import { getPluginDef, getPluginPortConfig } from '../pluginStore';
import { getMinNodeDepth } from '../../utils/nodeDepth';

// ---------------------------------------------------------------------------
// Helpers (shared with editorStore — passed in or local)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimum node width in world units */
export const MIN_NODE_WIDTH = 1.0;
/** Maximum node width in world units */
export const MAX_NODE_WIDTH = 6.0;
/** Minimum node height (depth) in world units */
export const MIN_NODE_HEIGHT = 0.6;
/** Maximum node height (depth) in world units */
export const MAX_NODE_HEIGHT = 4.0;
/** Default node width in world units (matches NodeModule NODE_W) */
export const DEFAULT_NODE_WIDTH = 1.6;
/** Default node height (depth) in world units (matches NodeModule NODE_D) */
export const DEFAULT_NODE_HEIGHT = 0.8;

export interface NodeActions {
  addNode: (type: NodeType, position?: [number, number, number]) => string;
  removeNode: (id: string) => void;
  updateNodePosition: (id: string, position: [number, number, number]) => void;
  /** Batch set absolute positions in a single set() call. No undo — for hot drag loop. */
  setNodePositions: (positions: Record<string, [number, number, number]>) => void;
  updateNodeTitle: (id: string, title: string) => void;
  updateNodeComment: (id: string, comment: string | undefined) => void;
  batchUpdateNodeTitles: (updates: { nodeId: string; title: string }[]) => void;
  batchUpdateNodeData: (updates: { nodeId: string; key: string; value: unknown }[]) => void;
  batchMoveNodes: (nodeIds: string[], offset: [number, number, number]) => void;
  updateNodeData: (id: string, key: string, value: unknown) => void;
  toggleNodeCollapse: (id: string) => void;
  toggleNodeLock: (id: string) => void;
  batchToggleNodeLock: (ids: string[]) => void;
  /** Resize a node (with undo). Clamps to [MIN, MAX] constraints. */
  resizeNode: (id: string, width: number, height: number) => void;
  /** Batch set sizes for multiple nodes. No undo — for hot resize drag loop. */
  setNodeSizes: (sizes: Record<string, { width: number; height: number }>) => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates node management actions.
 * @param set - Zustand immer set function (scoped to node-relevant state fields)
 * @param get - Zustand get function (returns full state for reads)
 * @param deps - Injected dependencies for cross-cutting concerns
 */
export function createNodeActions(
  set: (fn: (state: {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    selectedIds: Set<string>;
    groups: Record<string, NodeGroup>;
    subgraphDefs: Record<string, SubgraphNodeDef>;
    graphTabs: Record<string, GraphTab>;
    breakpoints: Record<string, true>;
    breakpointConditions: Record<string, string>;
  }) => void) => void,
  get: () => {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    selectedIds: Set<string>;
    groups: Record<string, NodeGroup>;
    subgraphDefs: Record<string, SubgraphNodeDef>;
    graphTabs: Record<string, GraphTab>;
    breakpoints: Record<string, true>;
    breakpointConditions: Record<string, string>;
    breadcrumbStack: { graphId: string; subgraphNodeId: string }[];
    executeGraph: () => void;
  },
  deps: {
    pushUndo: (label?: string) => void;
    genId: () => string;
    getActiveUndoGraphId: () => string;
    getExecutionCache: (graphId: string) => Map<string, unknown> | undefined;
    invalidateDownstream: (nodeId: string, connections: Record<string, Connection>, cache: Map<string, unknown> | undefined) => void;
    scheduleAutoExecute: (execute: () => void) => void;
    getInactiveGraphs: () => Record<string, GraphData>;
    saveInactiveGraphsToUndo: (graphIds: string[]) => void;
    cleanupGraphResources: (graphIds: string[]) => void;
    collectInnerGraphIds: (gData: { nodes: Record<string, EditorNode> } | undefined) => string[];
    typeTitles: Record<string, string>;
  },
): NodeActions {
  const {
    pushUndo, genId, getActiveUndoGraphId, getExecutionCache,
    invalidateDownstream, scheduleAutoExecute, getInactiveGraphs,
    saveInactiveGraphsToUndo, cleanupGraphResources, collectInnerGraphIds,
    typeTitles,
  } = deps;

  return {
    addNode: (type, position) => {
      pushUndo('Add node');
      const id = genId();
      const config = NODE_TYPE_CONFIG[type] ?? getPluginPortConfig(type);
      const pluginDef = config === NODE_TYPE_CONFIG[type] ? undefined : getPluginDef(type);
      const title = typeTitles[type] ?? pluginDef?.name ?? type;
      const inputs = config ? makePortDefs('in', config.inputs) : [];
      const outputs = config ? makePortDefs('out', config.outputs) : [];
      const minDepth = getMinNodeDepth(type, inputs.length, outputs.length);
      const node: EditorNode = {
        id,
        type,
        position: position ?? [Math.random() * 6 - 3, 0, Math.random() * 6 - 3],
        title,
        data: {},
        inputs,
        outputs,
        ...(minDepth > DEFAULT_NODE_HEIGHT ? { height: minDepth } : {}),
      };
      set(state => {
        state.nodes[id] = node;
      });
      return id;
    },

    removeNode: (id) => {
      if (!get().nodes[id]) return;
      const node = get().nodes[id];
      // Subgraph boundary nodes cannot be deleted
      if (node.type === 'subgraph-input' || node.type === 'subgraph-output') return;
      // Locked nodes cannot be deleted
      if (node.locked) return;
      pushUndo('Remove node');

      // Recursively collect all inner graph IDs for cascade cleanup
      const rawInnerGraphId = node.type === 'subgraph' ? node.data.innerGraphId : undefined;
      const innerGraphId = typeof rawInnerGraphId === 'string' ? rawInnerGraphId : undefined;
      const allInnerIds = innerGraphId
        ? [innerGraphId, ...collectInnerGraphIds(getInactiveGraphs()[innerGraphId])]
        : [];

      set(state => {
        const groupId = state.nodes[id].groupId;
        // Clean up subgraph def and inner graph tabs
        if (state.nodes[id].type === 'subgraph') {
          delete state.subgraphDefs[id];
          for (const gId of allInnerIds) {
            if (state.graphTabs[gId]) delete state.graphTabs[gId];
          }
        }
        delete state.nodes[id];
        // Clean up breakpoints for deleted node
        delete state.breakpoints[id];
        delete state.breakpointConditions[id];
        for (const [connId, conn] of Object.entries(state.connections)) {
          if (conn.sourceNodeId === id || conn.targetNodeId === id) {
            delete state.connections[connId];
          }
        }
        state.selectedIds.delete(id);
        // Clean up empty group
        if (groupId && state.groups[groupId]) {
          const hasMembers = Object.values(state.nodes).some(n => n.groupId === groupId);
          if (!hasMembers) {
            delete state.groups[groupId];
          }
        }
      });

      // Save inner graph data to undo entry before deleting (for undo restoration)
      saveInactiveGraphsToUndo(allInnerIds);
      // Clean up module-scoped resources for deleted subgraph inner graphs (recursive)
      cleanupGraphResources(allInnerIds);
      scheduleAutoExecute(() => get().executeGraph());
    },

    updateNodePosition: (id, position) => {
      set(state => {
        if (state.nodes[id] && !state.nodes[id].locked) {
          state.nodes[id].position = position;
        }
      });
    },

    setNodePositions: (positions) => {
      set(state => {
        for (const id in positions) {
          if (state.nodes[id] && !state.nodes[id].locked) {
            state.nodes[id].position = positions[id];
          }
        }
      });
    },

    updateNodeTitle: (id, title) => {
      if (!get().nodes[id]) return;
      if (get().nodes[id].locked) return;
      pushUndo('Rename node');
      set(state => {
        state.nodes[id].title = title;
      });
    },

    updateNodeComment: (id, comment) => {
      const current = get().nodes[id];
      if (!current || current.locked) return;
      const next = (comment !== undefined && comment !== '') ? comment : undefined;
      if (current.comment === next) return; // no-op guard
      pushUndo('Update comment');
      set(state => {
        if (next !== undefined) {
          state.nodes[id].comment = next;
        } else {
          delete state.nodes[id].comment;
        }
      });
    },

    batchUpdateNodeTitles: (updates) => {
      const state = get();
      const valid = updates.filter(u => state.nodes[u.nodeId] && !state.nodes[u.nodeId].locked);
      if (valid.length === 0) return;
      pushUndo('Batch rename nodes');
      set(s => {
        for (const { nodeId, title } of valid) {
          s.nodes[nodeId].title = title;
        }
      });
    },

    batchUpdateNodeData: (updates) => {
      const state = get();
      const valid = updates.filter(u => state.nodes[u.nodeId] && !state.nodes[u.nodeId].locked);
      if (valid.length === 0) return;
      pushUndo('Batch update node data');
      set(s => {
        for (const { nodeId, key, value } of valid) {
          s.nodes[nodeId].data[key] = value;
        }
      });
      // Invalidate downstream for all affected nodes
      const currentState = get();
      const cache = getExecutionCache(getActiveUndoGraphId());
      for (const { nodeId } of valid) {
        invalidateDownstream(nodeId, currentState.connections, cache);
      }
      scheduleAutoExecute(() => get().executeGraph());
    },

    batchMoveNodes: (nodeIds, offset) => {
      const state = get();
      const valid = nodeIds.filter(id => state.nodes[id] && !state.nodes[id].locked);
      if (valid.length === 0) return;
      pushUndo('Move nodes');
      set(s => {
        for (const id of valid) {
          const pos = s.nodes[id].position;
          s.nodes[id].position = [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]];
        }
      });
    },

    updateNodeData: (id, key, value) => {
      if (!get().nodes[id]) return;
      if (get().nodes[id].locked) return;
      pushUndo('Update node data');
      set(s => {
        s.nodes[id].data[key] = value;
      });
      // Invalidate cached execution results for this node and downstream
      invalidateDownstream(id, get().connections, getExecutionCache(getActiveUndoGraphId()));
      // If inside a subgraph, also invalidate parent graph's cache for the subgraph node
      // so re-executing the parent graph will re-run this subgraph with updated data
      const { breadcrumbStack } = get();
      if (breadcrumbStack.length > 0) {
        const parent = breadcrumbStack[breadcrumbStack.length - 1];
        const parentGraph = getInactiveGraphs()[parent.graphId];
        if (parentGraph) {
          const parentCache = getExecutionCache(parent.graphId);
          invalidateDownstream(parent.subgraphNodeId, parentGraph.connections, parentCache);
        }
      }
      // Trigger debounced auto-execution if enabled
      scheduleAutoExecute(() => get().executeGraph());
    },

    toggleNodeCollapse: (id) => {
      if (!get().nodes[id]) return;
      pushUndo('Toggle collapse');
      set(s => {
        s.nodes[id].collapsed = !s.nodes[id].collapsed;
      });
    },

    toggleNodeLock: (id) => {
      if (!get().nodes[id]) return;
      pushUndo('Toggle lock');
      set(s => {
        s.nodes[id].locked = !s.nodes[id].locked;
      });
    },

    batchToggleNodeLock: (ids) => {
      const state = get();
      const validIds = ids.filter(id => state.nodes[id]);
      if (validIds.length === 0) return;
      // Deterministic: if any unlocked, lock all; if all locked, unlock all
      const anyUnlocked = validIds.some(id => !state.nodes[id].locked);
      pushUndo('Toggle lock');
      set(s => {
        for (const id of validIds) {
          s.nodes[id].locked = anyUnlocked;
        }
      });
    },

    resizeNode: (id, width, height) => {
      const node = get().nodes[id];
      if (!node || node.locked) return;
      const clampedW = Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, width));
      const clampedH = Math.max(MIN_NODE_HEIGHT, Math.min(MAX_NODE_HEIGHT, height));
      // No-op if size unchanged
      if ((node.width ?? DEFAULT_NODE_WIDTH) === clampedW && (node.height ?? DEFAULT_NODE_HEIGHT) === clampedH) return;
      pushUndo('Resize node');
      set(s => {
        s.nodes[id].width = clampedW;
        s.nodes[id].height = clampedH;
      });
    },

    setNodeSizes: (sizes) => {
      set(s => {
        for (const id in sizes) {
          if (Object.prototype.hasOwnProperty.call(sizes, id) && s.nodes[id] && !s.nodes[id].locked) {
            const { width, height } = sizes[id];
            const clampedW = Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, width));
            const clampedH = Math.max(MIN_NODE_HEIGHT, Math.min(MAX_NODE_HEIGHT, height));
            // Skip write if size unchanged — avoids unnecessary re-renders during drag at clamp boundaries
            if ((s.nodes[id].width ?? DEFAULT_NODE_WIDTH) === clampedW &&
                (s.nodes[id].height ?? DEFAULT_NODE_HEIGHT) === clampedH) continue;
            s.nodes[id].width = clampedW;
            s.nodes[id].height = clampedH;
          }
        }
      });
    },
  };
}

/**
 * Connection slice — manages connection CRUD, drawing state, and metadata.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - addConnection (validation, cycle detection, creation)
 * - removeConnection (deletion with undo + cache invalidation)
 * - startConnection / completeConnection / cancelConnection (drawing workflow)
 * - disconnectAndReroute (disconnect + re-draw)
 * - updateConnectionLabel / updateConnectionColor (metadata)
 * - updatePendingCursor (cursor tracking during drawing)
 * - wouldCreateCycle (BFS cycle detection helper)
 */
import type { EditorNode, Connection, InteractionMode, PendingConnection } from '../../types';
import { isPortTypeCompatible } from '../../types';
import { getCoercionRule, hasCoercion } from '../../utils/typeCoercions';
import type { CoercionRule } from '../../utils/typeCoercions';

// ---------------------------------------------------------------------------
// Cycle detection helper (BFS)
// ---------------------------------------------------------------------------

export function wouldCreateCycle(
  connections: Record<string, Connection>,
  fromNodeId: string,
  toNodeId: string,
): boolean {
  const visited = new Set<string>();
  const queue = [fromNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const conn of Object.values(connections)) {
      if (conn.sourceNodeId === current) {
        queue.push(conn.targetNodeId);
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionSliceState {
  pendingConnection: PendingConnection | null;
}

export const connectionInitialState: ConnectionSliceState = {
  pendingConnection: null,
};

export interface ConnectionActions {
  addConnection: (sourceNodeId: string, sourcePortIndex: number, targetNodeId: string, targetPortIndex: number) => string | null;
  removeConnection: (id: string) => void;
  startConnection: (sourceNodeId: string, sourcePortIndex: number) => void;
  completeConnection: (targetNodeId: string, targetPortIndex: number) => void;
  cancelConnection: () => void;
  updatePendingCursor: (pos: [number, number, number]) => void;
  disconnectAndReroute: (connectionId: string) => void;
  updateConnectionLabel: (id: string, label: string | undefined) => void;
  updateConnectionColor: (id: string, color: string | undefined) => void;
  updateConnectionStyle: (id: string, style: Connection['styleOverride']) => void;
}

// ---------------------------------------------------------------------------
// Actions factory
// ---------------------------------------------------------------------------

/**
 * Creates connection management actions.
 * @param set - Zustand immer set function
 * @param get - Zustand get function (returns full state)
 * @param pushUndo - Pushes undo snapshot before mutations
 * @param genConnectionId - Generates a unique connection ID
 * @param getActiveExecutionCache - Returns the execution cache for the active graph
 * @param invalidateDownstream - Invalidates execution cache for downstream nodes
 * @param onConnectionMutated - Called after any connection add/remove to trigger auto-execution
 * @param onCoercion - Called when incompatible types have a coercion rule available; returns true if handled
 */
export function createConnectionActions(
  set: (fn: (state: {
    connections: Record<string, Connection>;
    nodes: Record<string, EditorNode>;
    selectedIds: Set<string>;
    interaction: InteractionMode;
    pendingConnection: PendingConnection | null;
    nearestSnapPort: { nodeId: string; portIndex: number } | null;
    hoveredMismatchPort: { nodeId: string; portIndex: number } | null;
    focusedPort: { nodeId: string; portIndex: number; side: 'input' | 'output' } | null;
    highlightedPorts: Set<string>;
    incompatibleNodeIds: Set<string>;
  }) => void) => void,
  get: () => {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    selectedIds: Set<string>;
    pendingConnection: PendingConnection | null;
    addConnection: (sourceNodeId: string, sourcePortIndex: number, targetNodeId: string, targetPortIndex: number) => string | null;
    cancelConnection: () => void;
    startConnection: (sourceNodeId: string, sourcePortIndex: number) => void;
  },
  pushUndo: (label?: string) => void,
  genConnectionId: () => string,
  getActiveExecutionCache: () => Map<string, unknown> | undefined,
  invalidateDownstream: (nodeId: string, connections: Record<string, Connection>, cache: Map<string, unknown> | undefined) => void,
  onConnectionMutated?: () => void,
  onCoercion?: (rule: CoercionRule, sourceNodeId: string, sourcePortIndex: number, targetNodeId: string, targetPortIndex: number) => boolean,
): ConnectionActions {
  return {
    addConnection: (sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex) => {
      const state = get();
      // Validate nodes exist
      if (!state.nodes[sourceNodeId] || !state.nodes[targetNodeId]) return null;
      // Prevent self-connections
      if (sourceNodeId === targetNodeId) return null;
      // Validate port indices
      const sourceNode = state.nodes[sourceNodeId];
      const targetNode = state.nodes[targetNodeId];
      if (sourcePortIndex < 0 || sourcePortIndex >= sourceNode.outputs.length) return null;
      if (targetPortIndex < 0 || targetPortIndex >= targetNode.inputs.length) return null;
      // Port type compatibility check
      const sourcePortType = sourceNode.outputs[sourcePortIndex].portType;
      const targetPortType = targetNode.inputs[targetPortIndex].portType;
      if (!isPortTypeCompatible(sourcePortType, targetPortType)) return null;
      // Prevent duplicate connections
      const exists = Object.values(state.connections).some(
        c =>
          c.sourceNodeId === sourceNodeId &&
          c.sourcePortIndex === sourcePortIndex &&
          c.targetNodeId === targetNodeId &&
          c.targetPortIndex === targetPortIndex
      );
      if (exists) return null;
      // Cycle detection
      if (wouldCreateCycle(state.connections, targetNodeId, sourceNodeId)) return null;

      const id = genConnectionId();
      set(s => {
        s.connections[id] = { id, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex };
      });
      // New connection changes target node's inputs → invalidate its cached execution results
      invalidateDownstream(targetNodeId, get().connections, getActiveExecutionCache());
      onConnectionMutated?.();
      return id;
    },

    removeConnection: (id) => {
      const conn = get().connections[id];
      if (!conn) return;
      pushUndo('Remove connection');
      const targetNodeId = conn.targetNodeId;
      set(state => {
        delete state.connections[id];
        state.selectedIds.delete(id);
      });
      // Removed connection changes target node's inputs → invalidate its cached execution results
      invalidateDownstream(targetNodeId, get().connections, getActiveExecutionCache());
      onConnectionMutated?.();
    },

    startConnection: (sourceNodeId, sourcePortIndex) => {
      const state = get();
      const node = state.nodes[sourceNodeId];
      if (!node) return;
      if (sourcePortIndex < 0 || sourcePortIndex >= node.outputs.length) return;
      // Compute compatible input ports for highlighting + incompatible nodes for dimming
      const sourceType = node.outputs[sourcePortIndex].portType;
      const highlighted = new Set<string>();
      const incompatible = new Set<string>();
      for (const nId in state.nodes) {
        if (!Object.prototype.hasOwnProperty.call(state.nodes, nId)) continue;
        if (nId === sourceNodeId) continue;
        const n = state.nodes[nId];
        let hasCompatible = false;
        for (let i = 0; i < n.inputs.length; i++) {
          if (isPortTypeCompatible(sourceType, n.inputs[i].portType) || hasCoercion(sourceType, n.inputs[i].portType)) {
            highlighted.add(`${nId}:${i}`);
            hasCompatible = true;
          }
        }
        if (!hasCompatible) incompatible.add(nId);
      }
      set(s => {
        s.interaction = 'drawing-connection';
        s.pendingConnection = {
          sourceNodeId,
          sourcePortIndex,
          cursorPos: [...node.position] as [number, number, number],
        };
        s.highlightedPorts = highlighted;
        s.incompatibleNodeIds = incompatible;
      });
    },

    updatePendingCursor: (pos) => {
      set(state => {
        if (state.pendingConnection) {
          state.pendingConnection.cursorPos = pos;
        }
      });
    },

    completeConnection: (targetNodeId, targetPortIndex) => {
      const state = get();
      if (!state.pendingConnection) return;
      if (!state.nodes[targetNodeId]) {
        get().cancelConnection();
        return;
      }
      const { sourceNodeId, sourcePortIndex } = state.pendingConnection;

      // --- Validate BEFORE mutating (atomicity fix) ---
      const sourceNode = state.nodes[sourceNodeId];
      const targetNode = state.nodes[targetNodeId];
      if (!sourceNode || !targetNode) { get().cancelConnection(); return; }
      if (sourceNodeId === targetNodeId) { get().cancelConnection(); return; }
      if (sourcePortIndex < 0 || sourcePortIndex >= sourceNode.outputs.length) { get().cancelConnection(); return; }
      if (targetPortIndex < 0 || targetPortIndex >= targetNode.inputs.length) { get().cancelConnection(); return; }
      const sourcePortType = sourceNode.outputs[sourcePortIndex].portType;
      const targetPortType = targetNode.inputs[targetPortIndex].portType;
      if (!isPortTypeCompatible(sourcePortType, targetPortType)) {
        // Try coercion: auto-insert converter node
        if (onCoercion) {
          const rule = getCoercionRule(sourcePortType, targetPortType);
          if (rule) {
            // Clear drawing state first
            set(s => {
              s.interaction = 'idle';
              s.pendingConnection = null;
              s.nearestSnapPort = null;
              s.highlightedPorts = new Set<string>();
              s.incompatibleNodeIds = new Set<string>();
            });
            // Delegate coercion to the host store (which has access to addNode)
            onCoercion(rule, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex);
            return;
          }
        }
        get().cancelConnection();
        return;
      }
      // Duplicate check
      const isDuplicate = Object.values(state.connections).some(
        c => c.sourceNodeId === sourceNodeId && c.sourcePortIndex === sourcePortIndex
          && c.targetNodeId === targetNodeId && c.targetPortIndex === targetPortIndex
      );
      if (isDuplicate) { get().cancelConnection(); return; }
      // Cycle detection: check against connections WITHOUT the old one on this input
      // (since we'll remove it atomically)
      const oldConnId = Object.keys(state.connections).find(cid => {
        const c = state.connections[cid];
        return c.targetNodeId === targetNodeId && c.targetPortIndex === targetPortIndex;
      });
      const connsForCycleCheck = oldConnId
        ? Object.fromEntries(Object.entries(state.connections).filter(([id]) => id !== oldConnId))
        : state.connections;
      if (wouldCreateCycle(connsForCycleCheck, targetNodeId, sourceNodeId)) { get().cancelConnection(); return; }

      // --- All validation passed: atomic mutation ---
      pushUndo('Add connection');
      const newId = genConnectionId();
      // Capture old connection metadata before mutation (for metadata preservation on reconnect)
      const oldConn = oldConnId ? state.connections[oldConnId] : undefined;
      set(s => {
        // Remove old connection on this input (single-input enforcement)
        if (oldConnId) {
          delete s.connections[oldConnId];
          s.selectedIds.delete(oldConnId);
        }
        // Add new connection (preserving metadata from old connection if reconnecting)
        const newConn: Connection = { id: newId, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex };
        if (oldConn?.label !== undefined) newConn.label = oldConn.label;
        if (oldConn?.colorOverride !== undefined) newConn.colorOverride = oldConn.colorOverride;
        if (oldConn?.styleOverride !== undefined) newConn.styleOverride = oldConn.styleOverride;
        s.connections[newId] = newConn;
        // Clear drawing state
        s.interaction = 'idle';
        s.pendingConnection = null;
        s.nearestSnapPort = null;
        s.hoveredMismatchPort = null;
        s.highlightedPorts = new Set<string>();
        s.incompatibleNodeIds = new Set<string>();
      });
      invalidateDownstream(targetNodeId, get().connections, getActiveExecutionCache());
      onConnectionMutated?.();
    },

    cancelConnection: () => {
      set(state => {
        state.interaction = 'idle';
        state.pendingConnection = null;
        state.nearestSnapPort = null;
        state.hoveredMismatchPort = null;
        state.focusedPort = null;
        state.highlightedPorts = new Set<string>();
        state.incompatibleNodeIds = new Set<string>();
      });
    },

    disconnectAndReroute: (connectionId) => {
      const conn = get().connections[connectionId];
      if (!conn) return;
      pushUndo('Reroute connection');
      const { sourceNodeId, sourcePortIndex, targetNodeId } = conn;
      // Remove connection directly to avoid double undo push
      set(s => {
        delete s.connections[connectionId];
        s.selectedIds.delete(connectionId);
      });
      // Invalidate cached execution results for the disconnected target
      invalidateDownstream(targetNodeId, get().connections, getActiveExecutionCache());
      onConnectionMutated?.();
      get().startConnection(sourceNodeId, sourcePortIndex);
    },

    updateConnectionLabel: (id, label) => {
      if (!get().connections[id]) return;
      pushUndo('Update connection label');
      set(s => {
        if (label !== undefined) {
          s.connections[id].label = label;
        } else {
          delete s.connections[id].label;
        }
      });
    },

    updateConnectionColor: (id, color) => {
      if (!get().connections[id]) return;
      pushUndo('Update connection color');
      set(s => {
        if (color !== undefined) {
          s.connections[id].colorOverride = color;
        } else {
          delete s.connections[id].colorOverride;
        }
      });
    },

    updateConnectionStyle: (id, style) => {
      const conn = get().connections[id];
      if (!conn) return;
      if (conn.styleOverride === style || (conn.styleOverride === undefined && style === undefined)) return;
      pushUndo('Update connection style');
      set(s => {
        if (style !== undefined) {
          s.connections[id].styleOverride = style;
        } else {
          delete s.connections[id].styleOverride;
        }
      });
    },
  };
}

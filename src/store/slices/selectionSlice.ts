/**
 * Selection slice — manages selectedIds, hoveredConnectionId, nearestSnapPort,
 * and selection-related actions (setSelection, toggleSelection, selectConnected, boxSelect).
 *
 * Extracted from editorStore.ts for modularity. The actual state + actions live here;
 * editorStore.ts composes them via the Zustand slice pattern.
 */
import type { EditorNode, Connection } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectionState {
  selectedIds: Set<string>;
  hoveredConnectionId: string | null;
  nearestSnapPort: { nodeId: string; portIndex: number } | null;
  /** Incompatible port being hovered during connection drawing — drives mismatch X indicator */
  hoveredMismatchPort: { nodeId: string; portIndex: number } | null;
  focusedPort: { nodeId: string; portIndex: number; side: 'input' | 'output' } | null;
}

export interface SelectionActions {
  setSelection: (ids: Set<string>) => void;
  toggleSelection: (id: string) => void;
  setNearestSnapPort: (snap: { nodeId: string; portIndex: number } | null) => void;
  setHoveredMismatchPort: (port: { nodeId: string; portIndex: number } | null) => void;
  setHoveredConnection: (id: string | null) => void;
  selectConnected: (direction: 'upstream' | 'downstream' | 'both') => void;
  boxSelect: (minX: number, minZ: number, maxX: number, maxZ: number, additive: boolean) => void;
  setFocusedPort: (port: { nodeId: string; portIndex: number; side: 'input' | 'output' } | null) => void;
}

export type SelectionSlice = SelectionState & SelectionActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const selectionInitialState: SelectionState = {
  selectedIds: new Set<string>(),
  hoveredConnectionId: null,
  nearestSnapPort: null,
  hoveredMismatchPort: null,
  focusedPort: null,
};

// ---------------------------------------------------------------------------
// Actions factory
// ---------------------------------------------------------------------------

/**
 * Creates selection actions. Requires `set` and `get` from the Zustand store.
 * The `get()` function returns the full EditorState so actions can read nodes/connections.
 */
export function createSelectionActions(
  set: (fn: (state: SelectionState) => void) => void,
  get: () => {
    selectedIds: Set<string>;
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
  },
): SelectionActions {
  return {
    setSelection: (ids) => {
      set(state => {
        state.selectedIds = ids;
        // Clear port focus when selection changes
        state.focusedPort = null;
      });
    },

    toggleSelection: (id) => {
      set(state => {
        if (state.selectedIds.has(id)) {
          state.selectedIds.delete(id);
        } else {
          state.selectedIds.add(id);
        }
      });
    },

    setNearestSnapPort: (snap) => {
      set(state => {
        state.nearestSnapPort = snap;
      });
    },

    setHoveredMismatchPort: (port) => {
      set(state => {
        state.hoveredMismatchPort = port;
      });
    },

    setHoveredConnection: (id) => {
      set(state => {
        state.hoveredConnectionId = id;
      });
    },

    selectConnected: (direction) => {
      const state = get();
      const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
      if (selectedNodeIds.length === 0) return;

      const result = new Set<string>(state.selectedIds);
      const visited = new Set<string>();
      const queue = [...selectedNodeIds];
      const conns = Object.values(state.connections);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        result.add(current);

        for (const conn of conns) {
          if ((direction === 'upstream' || direction === 'both') && conn.targetNodeId === current && state.nodes[conn.sourceNodeId]) {
            if (!visited.has(conn.sourceNodeId)) queue.push(conn.sourceNodeId);
          }
          if ((direction === 'downstream' || direction === 'both') && conn.sourceNodeId === current && state.nodes[conn.targetNodeId]) {
            if (!visited.has(conn.targetNodeId)) queue.push(conn.targetNodeId);
          }
        }
      }

      set(s => { s.selectedIds = result; });
    },

    boxSelect: (minX, minZ, maxX, maxZ, additive) => {
      const state = get();
      const ids = new Set<string>(additive ? state.selectedIds : []);
      for (const node of Object.values(state.nodes)) {
        const [x, , z] = node.position;
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
          ids.add(node.id);
        }
      }
      set(s => { s.selectedIds = ids; });
    },

    setFocusedPort: (port) => {
      set(state => {
        state.focusedPort = port;
      });
    },
  };
}

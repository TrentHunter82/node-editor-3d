/**
 * Layout slice — manages layout actions (autoLayout, alignSelected, distributeSelected).
 *
 * Extracted from editorStore.ts for modularity. These are self-contained
 * actions that read node positions and connections, compute new positions
 * via pure layout functions, then apply them.
 */
import type { EditorNode, Connection } from '../../types';
import { layeredLayout, forceDirectedLayout, alignNodes, distributeNodes } from '../../utils/layout';
import type { AlignDirection, DistributeDirection } from '../../utils/layout';
import { useSettingsStore } from '../settingsStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayoutActions {
  autoLayout: () => void;
  alignSelected: (direction: AlignDirection) => void;
  distributeSelected: (direction: DistributeDirection) => void;
}

// ---------------------------------------------------------------------------
// Actions factory
// ---------------------------------------------------------------------------

/**
 * Creates layout actions.
 * @param set - Zustand immer set function
 * @param get - Returns state with nodes, connections, selectedIds
 * @param pushUndo - Pushes undo snapshot before mutations
 */
export function createLayoutActions(
  set: (fn: (state: { nodes: Record<string, EditorNode> }) => void) => void,
  get: () => {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    selectedIds: Set<string>;
  },
  pushUndo: (label?: string) => void,
): LayoutActions {
  return {
    autoLayout: () => {
      const state = get();
      if (Object.keys(state.nodes).length === 0) return;
      pushUndo('Auto layout');
      const layoutMode = useSettingsStore.getState().layoutMode;
      const positions = layoutMode === 'force'
        ? forceDirectedLayout(state.nodes, state.connections)
        : layeredLayout(state.nodes, state.connections);
      set(s => {
        for (const [id, pos] of Object.entries(positions)) {
          if (s.nodes[id] && !s.nodes[id].locked) {
            s.nodes[id].position = pos;
          }
        }
      });
    },

    alignSelected: (direction) => {
      const state = get();
      const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
      if (selectedNodeIds.length < 2) return;
      pushUndo('Align nodes');
      const positions = alignNodes(selectedNodeIds, state.nodes, direction);
      set(s => {
        for (const [id, pos] of Object.entries(positions)) {
          if (s.nodes[id] && !s.nodes[id].locked) {
            s.nodes[id].position = pos;
          }
        }
      });
    },

    distributeSelected: (direction) => {
      const state = get();
      const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
      if (selectedNodeIds.length < 3) return;
      pushUndo('Distribute nodes');
      const positions = distributeNodes(selectedNodeIds, state.nodes, direction);
      set(s => {
        for (const [id, pos] of Object.entries(positions)) {
          if (s.nodes[id] && !s.nodes[id].locked) {
            s.nodes[id].position = pos;
          }
        }
      });
    },
  };
}

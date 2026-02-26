/**
 * Group slice — manages node grouping actions (createGroup, ungroupNodes,
 * toggleGroupCollapse, renameGroup).
 *
 * Extracted from editorStore.ts for modularity. These are self-contained
 * actions that only modify groups and node.groupId fields.
 */
import type { EditorNode, NodeGroup } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupActions {
  createGroup: (label?: string) => string | null;
  ungroupNodes: (groupId: string) => void;
  toggleGroupCollapse: (groupId: string) => void;
  renameGroup: (groupId: string, label: string) => void;
  setGroupColor: (groupId: string, color: string | undefined) => void;
  setGroupDescription: (groupId: string, description: string) => void;
}

// ---------------------------------------------------------------------------
// Actions factory
// ---------------------------------------------------------------------------

/**
 * Creates group management actions.
 * @param set - Zustand immer set function
 * @param get - Zustand get function (returns full state with nodes, groups, selectedIds)
 * @param pushUndo - Pushes undo snapshot before mutations
 * @param genGroupId - Generates a unique group ID
 */
export function createGroupActions(
  set: (fn: (state: { groups: Record<string, NodeGroup>; nodes: Record<string, EditorNode> }) => void) => void,
  get: () => {
    nodes: Record<string, EditorNode>;
    groups: Record<string, NodeGroup>;
    selectedIds: Set<string>;
  },
  pushUndo: (label?: string) => void,
  genGroupId: () => string,
): GroupActions {
  return {
    createGroup: (label) => {
      const state = get();
      const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id] && !state.nodes[id].locked);
      if (selectedNodeIds.length < 2) return null; // Need at least 2 nodes to group

      // Don't group nodes that are already in the same group
      const existingGroups = new Set(selectedNodeIds.map(id => state.nodes[id].groupId).filter(Boolean));
      if (existingGroups.size === 1 && selectedNodeIds.every(id => state.nodes[id].groupId)) {
        return null; // All nodes already in the same group
      }

      pushUndo('Create group');
      const groupId = genGroupId();
      set(s => {
        s.groups[groupId] = {
          id: groupId,
          label: label ?? 'Group',
          collapsed: false,
        };
        for (const nodeId of selectedNodeIds) {
          s.nodes[nodeId].groupId = groupId;
        }
      });
      return groupId;
    },

    ungroupNodes: (groupId) => {
      const state = get();
      if (!state.groups[groupId]) return;
      pushUndo('Ungroup nodes');
      set(s => {
        // Remove groupId from all nodes in this group
        for (const node of Object.values(s.nodes)) {
          if (node.groupId === groupId) {
            delete node.groupId;
          }
        }
        delete s.groups[groupId];
      });
    },

    toggleGroupCollapse: (groupId) => {
      if (!get().groups[groupId]) return;
      // No undo — collapse/expand is view-state, not a content mutation
      // (same as errorStrategy, snapEnabled, showValuePreviews)
      set(s => {
        s.groups[groupId].collapsed = !s.groups[groupId].collapsed;
      });
    },

    renameGroup: (groupId, label) => {
      if (!get().groups[groupId]) return;
      pushUndo('Rename group');
      set(s => {
        s.groups[groupId].label = label;
      });
    },

    setGroupColor: (groupId, color) => {
      if (!get().groups[groupId]) return;
      pushUndo('Set group color');
      set(s => {
        if (color) {
          s.groups[groupId].color = color;
        } else {
          delete s.groups[groupId].color;
        }
      });
    },

    setGroupDescription: (groupId, description) => {
      if (!get().groups[groupId]) return;
      pushUndo('Set group description');
      set(s => {
        if (description) {
          s.groups[groupId].description = description;
        } else {
          delete s.groups[groupId].description;
        }
      });
    },
  };
}

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useEditorStore } from './editorStore';
import { clearFileHandle, getCurrentFileName } from '../utils/fileAccess';
import type { MultiGraphStorage } from '../utils/serialization';

export interface WorkspaceTab {
  id: string;
  name: string;
  /** Serialized workspace state (null for the active workspace — it lives in editorStore) */
  snapshot: MultiGraphStorage | null;
  /** File name associated with this workspace (display only) */
  fileName: string | null;
}

interface WorkspaceState {
  workspaces: Record<string, WorkspaceTab>;
  activeWorkspaceId: string;
  workspaceOrder: string[];

  createWorkspace: (name?: string) => string;
  switchWorkspace: (id: string) => void;
  deleteWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
}

let nextWorkspaceId = 1;
function genWorkspaceId(): string {
  return `ws-${nextWorkspaceId++}`;
}

const DEFAULT_WS_ID = 'ws-default';

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
    workspaces: {
      [DEFAULT_WS_ID]: {
        id: DEFAULT_WS_ID,
        name: 'Workspace 1',
        snapshot: null, // active workspace — state is in editorStore
        fileName: null,
      },
    },
    activeWorkspaceId: DEFAULT_WS_ID,
    workspaceOrder: [DEFAULT_WS_ID],

    createWorkspace: (name) => {
      const id = genWorkspaceId();
      const wsName = name ?? `Workspace ${get().workspaceOrder.length + 1}`;

      // Save current workspace before creating new
      const currentId = get().activeWorkspaceId;
      const currentSnapshot = useEditorStore.getState().exportAllGraphs();
      const currentFileName = getCurrentFileName();

      set(s => {
        // Save current workspace's snapshot
        const current = s.workspaces[currentId];
        if (current) {
          current.snapshot = currentSnapshot;
          current.fileName = currentFileName;
        }

        // Create new empty workspace
        s.workspaces[id] = {
          id,
          name: wsName,
          snapshot: null, // will become active
          fileName: null,
        };
        s.workspaceOrder.push(id);
        s.activeWorkspaceId = id;
      });

      // Clear editor store for new workspace
      clearFileHandle();
      useEditorStore.getState().clearGraph();

      return id;
    },

    switchWorkspace: (id) => {
      const state = get();
      if (id === state.activeWorkspaceId) return;
      const target = state.workspaces[id];
      if (!target) return;

      // Save current workspace state
      const currentId = state.activeWorkspaceId;
      const currentSnapshot = useEditorStore.getState().exportAllGraphs();
      const currentFileName = getCurrentFileName();

      set(s => {
        // Save current workspace
        const current = s.workspaces[currentId];
        if (current) {
          current.snapshot = currentSnapshot;
          current.fileName = currentFileName;
        }
        // Mark target as active (its snapshot will be null since it's now active)
        s.activeWorkspaceId = id;
      });

      // Load target workspace into editorStore
      clearFileHandle();
      const targetSnapshot = target.snapshot;
      if (targetSnapshot) {
        // Deep clone to unfreeze immer state before passing to importAllGraphs
        useEditorStore.getState().importAllGraphs(structuredClone(targetSnapshot));
        // Clear the snapshot since it's now active
        set(s => {
          const ws = s.workspaces[id];
          if (ws) ws.snapshot = null;
        });
      } else {
        // No snapshot — new workspace, clear the graph
        useEditorStore.getState().clearGraph();
      }
    },

    deleteWorkspace: (id) => {
      const state = get();
      if (state.workspaceOrder.length <= 1) return; // Can't delete last workspace
      if (id === state.activeWorkspaceId) {
        // Switch to the next workspace first
        const idx = state.workspaceOrder.indexOf(id);
        const nextIdx = idx > 0 ? idx - 1 : 1;
        const nextId = state.workspaceOrder[nextIdx];
        get().switchWorkspace(nextId);
      }

      set(s => {
        delete s.workspaces[id];
        s.workspaceOrder = s.workspaceOrder.filter(wsId => wsId !== id);
      });
    },

    renameWorkspace: (id, name) => {
      set(s => {
        const ws = s.workspaces[id];
        if (ws) ws.name = name;
      });
    },
  })),
);

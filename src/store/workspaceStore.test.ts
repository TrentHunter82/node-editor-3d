import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fileAccess before importing
vi.mock('../utils/fileAccess', () => ({
  clearFileHandle: vi.fn(),
  getCurrentFileName: vi.fn(() => null),
}));

const { useWorkspaceStore } = await import('./workspaceStore');
const { useEditorStore } = await import('./editorStore');
import { enableMapSet } from 'immer';

enableMapSet();

function getWS() {
  return useWorkspaceStore.getState();
}

function resetWorkspaceStore() {
  useWorkspaceStore.setState({
    workspaces: {
      'ws-default': {
        id: 'ws-default',
        name: 'Workspace 1',
        snapshot: null,
        fileName: null,
      },
    },
    activeWorkspaceId: 'ws-default',
    workspaceOrder: ['ws-default'],
  });
}

describe('Workspace Store', () => {
  beforeEach(() => {
    resetWorkspaceStore();
    // Reset editor store to clean state
    useEditorStore.setState((s: any) => {
      s.nodes = {};
      s.connections = {};
      s.groups = {};
      s.selectedIds = new Set();
    });
  });

  describe('initial state', () => {
    it('has one default workspace', () => {
      expect(getWS().workspaceOrder).toEqual(['ws-default']);
      expect(getWS().activeWorkspaceId).toBe('ws-default');
      expect(getWS().workspaces['ws-default']).toBeDefined();
      expect(getWS().workspaces['ws-default'].name).toBe('Workspace 1');
    });
  });

  describe('createWorkspace', () => {
    it('creates a new workspace and switches to it', () => {
      const id = getWS().createWorkspace('Test Workspace');
      expect(getWS().activeWorkspaceId).toBe(id);
      expect(getWS().workspaces[id].name).toBe('Test Workspace');
      expect(getWS().workspaceOrder).toContain(id);
    });

    it('auto-names workspace if no name given', () => {
      const id = getWS().createWorkspace();
      expect(getWS().workspaces[id].name).toBe('Workspace 2');
    });

    it('saves previous workspace snapshot when creating new', () => {
      getWS().createWorkspace('WS 2');
      // The default workspace should now have a snapshot
      const defaultWs = getWS().workspaces['ws-default'];
      expect(defaultWs.snapshot).not.toBeNull();
      expect(defaultWs.snapshot?.version).toBe(2);
    });
  });

  describe('switchWorkspace', () => {
    it('switches between workspaces', () => {
      const id = getWS().createWorkspace('WS 2');
      expect(getWS().activeWorkspaceId).toBe(id);

      getWS().switchWorkspace('ws-default');
      expect(getWS().activeWorkspaceId).toBe('ws-default');
    });

    it('no-op when switching to active workspace', () => {
      getWS().switchWorkspace('ws-default');
      expect(getWS().activeWorkspaceId).toBe('ws-default');
    });

    it('no-op when switching to nonexistent workspace', () => {
      getWS().switchWorkspace('nonexistent');
      expect(getWS().activeWorkspaceId).toBe('ws-default');
    });

    it('saves current workspace state before switching', () => {
      const id = getWS().createWorkspace('WS 2');
      // Switch back - should save WS 2's state
      getWS().switchWorkspace('ws-default');
      const ws2 = getWS().workspaces[id];
      expect(ws2.snapshot).not.toBeNull();
    });
  });

  describe('deleteWorkspace', () => {
    it('cannot delete the last workspace', () => {
      getWS().deleteWorkspace('ws-default');
      expect(getWS().workspaceOrder.length).toBe(1);
      expect(getWS().workspaces['ws-default']).toBeDefined();
    });

    it('deletes an inactive workspace', () => {
      const id = getWS().createWorkspace('WS 2');
      getWS().switchWorkspace('ws-default');
      getWS().deleteWorkspace(id);
      expect(getWS().workspaces[id]).toBeUndefined();
      expect(getWS().workspaceOrder).not.toContain(id);
    });

    it('switches away before deleting active workspace', () => {
      const id = getWS().createWorkspace('WS 2');
      // id is now active
      getWS().deleteWorkspace(id);
      expect(getWS().activeWorkspaceId).toBe('ws-default');
      expect(getWS().workspaces[id]).toBeUndefined();
    });
  });

  describe('renameWorkspace', () => {
    it('renames a workspace', () => {
      getWS().renameWorkspace('ws-default', 'My Project');
      expect(getWS().workspaces['ws-default'].name).toBe('My Project');
    });

    it('no-op for nonexistent workspace', () => {
      getWS().renameWorkspace('nonexistent', 'Test');
      expect(getWS().workspaces['nonexistent']).toBeUndefined();
    });
  });
});

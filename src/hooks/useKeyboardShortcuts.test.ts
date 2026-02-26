import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { enableMapSet } from 'immer';

enableMapSet();

import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { PanelCallbacks } from './useKeyboardShortcuts';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settingsStore';

// --- Helpers ---

const getState = () => useEditorStore.getState();
const setState = (partial: Partial<ReturnType<typeof useEditorStore.getState>>) => useEditorStore.setState((s) => { Object.assign(s, partial); });

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    Object.assign(s, {
      nodes: {},
      connections: {},
      groups: {},
      selectedIds: new Set<string>(),
      interaction: 'idle',
      pendingConnection: null,
      contextMenu: null,
      customNodeDefs: {},
      searchQuery: '',
      executionStates: {},
      nodeOutputs: {},
      executionErrors: {},
      isExecuting: false,
      graphTabs: { default: { id: 'default', name: 'Main', isSubgraph: false } },
      activeGraphId: 'default',
      graphOrder: ['default'],
      breadcrumbStack: [],
      templates: {},
      subgraphDefs: {},
      validationErrors: {},
      errorStrategy: 'fail-fast',
      snapEnabled: false,
      showValuePreviews: true,
      undoRedoEvent: null,
      executionMetrics: {},
      executionTotalDuration: 0,
      debugMode: false,
      pausedAtWave: -1,
    });
  });
}

function fireKey(key: string, options?: Partial<KeyboardEvent>) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
}

function makeCallbacks(): PanelCallbacks {
  return {
    toggleSearch: vi.fn(),
    toggleFindReplace: vi.fn(),
    toggleValidation: vi.fn(),
    toggleSettings: vi.fn(),
    toggleDebug: vi.fn(),
    toggleProfiling: vi.fn(),
    toggleNodeSearch: vi.fn(),
    closeContextMenu: vi.fn(),
  };
}

describe('useKeyboardShortcuts', () => {
  let callbacks: PanelCallbacks;
  let hookResult: ReturnType<typeof renderHook>;

  beforeEach(() => {
    resetStore();
    callbacks = makeCallbacks();
    hookResult = renderHook(() => useKeyboardShortcuts(callbacks));
    vi.clearAllMocks();
  });

  afterEach(() => {
    hookResult?.unmount();
    // Clean up any window globals set during tests
    delete window.__zoomToFit;
    delete window.__orbitControls;
    delete window.__invalidate;
    delete window.__toggleGrid;
    delete window.__toggleMinimap;
    delete window.__toggleInspector;
  });

  // ====================================================================
  // Shortcuts that work even in inputs
  // ====================================================================

  describe('shortcuts that work even in inputs', () => {
    it('Ctrl+K calls toggleSearch', () => {
      fireKey('k', { ctrlKey: true });
      expect(callbacks.toggleSearch).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+H calls toggleFindReplace', () => {
      fireKey('h', { ctrlKey: true });
      expect(callbacks.toggleFindReplace).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Shift+M calls toggleValidation', () => {
      fireKey('M', { ctrlKey: true, shiftKey: true });
      expect(callbacks.toggleValidation).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+, calls toggleSettings', () => {
      fireKey(',', { ctrlKey: true });
      expect(callbacks.toggleSettings).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Shift+D calls toggleDebug', () => {
      fireKey('D', { ctrlKey: true, shiftKey: true });
      expect(callbacks.toggleDebug).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+K fires even when focus is in an INPUT element', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        input.focus();
        // Dispatch with target set to the input element
        const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true });
        Object.defineProperty(event, 'target', { value: input });
        window.dispatchEvent(event);
        expect(callbacks.toggleSearch).toHaveBeenCalledTimes(1);
      } finally {
        document.body.removeChild(input);
      }
    });

    it('Ctrl+H fires even when focus is in an INPUT element', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        input.focus();
        const event = new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true });
        Object.defineProperty(event, 'target', { value: input });
        window.dispatchEvent(event);
        expect(callbacks.toggleFindReplace).toHaveBeenCalledTimes(1);
      } finally {
        document.body.removeChild(input);
      }
    });

    it('Ctrl+, fires even when focus is in an INPUT element', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        input.focus();
        const event = new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true });
        Object.defineProperty(event, 'target', { value: input });
        window.dispatchEvent(event);
        expect(callbacks.toggleSettings).toHaveBeenCalledTimes(1);
      } finally {
        document.body.removeChild(input);
      }
    });
  });

  // ====================================================================
  // Input blocking
  // ====================================================================

  describe('shortcuts blocked in input elements', () => {
    it('non-global shortcuts are blocked when target is INPUT', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        // Set up a node so Delete would normally trigger deleteSelected
        const nodeId = getState().addNode('source');
        getState().setSelection(new Set([nodeId]));
        const spy = vi.spyOn(getState(), 'deleteSelected');

        const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
        Object.defineProperty(event, 'target', { value: input });
        window.dispatchEvent(event);

        // deleteSelected should NOT have been called
        expect(spy).not.toHaveBeenCalled();
      } finally {
        document.body.removeChild(input);
      }
    });

    it('non-global shortcuts are blocked when target is TEXTAREA', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      try {
        const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true });
        Object.defineProperty(event, 'target', { value: textarea });
        window.dispatchEvent(event);

        // No note node should be added
        expect(Object.values(getState().nodes).filter((n) => n.type === 'note').length).toBe(0);
      } finally {
        document.body.removeChild(textarea);
      }
    });
  });

  // ====================================================================
  // Escape
  // ====================================================================

  describe('Escape key', () => {
    it('closes context menu when context menu is open', () => {
      setState({ contextMenu: { x: 100, y: 200, target: { kind: 'canvas' } } });
      fireKey('Escape');
      expect(callbacks.closeContextMenu).toHaveBeenCalledTimes(1);
    });

    it('cancels connection and deselects when no context menu', () => {
      setState({ contextMenu: null });
      const nodeId = getState().addNode('source');
      getState().setSelection(new Set([nodeId]));
      expect(getState().selectedIds.size).toBe(1);

      fireKey('Escape');
      expect(callbacks.closeContextMenu).not.toHaveBeenCalled();
      expect(getState().selectedIds.size).toBe(0);
    });
  });

  // ====================================================================
  // Delete / Backspace
  // ====================================================================

  describe('Delete and Backspace', () => {
    it('Delete calls deleteSelected when nodes are selected', () => {
      const nodeId = getState().addNode('source');
      getState().setSelection(new Set([nodeId]));
      expect(Object.keys(getState().nodes).length).toBe(1);

      fireKey('Delete');
      expect(Object.keys(getState().nodes).length).toBe(0);
    });

    it('Backspace calls deleteSelected when nodes are selected', () => {
      const nodeId = getState().addNode('source');
      getState().setSelection(new Set([nodeId]));

      fireKey('Backspace');
      expect(Object.keys(getState().nodes).length).toBe(0);
    });

    it('Delete does nothing when no nodes selected', () => {
      getState().addNode('source');
      expect(Object.keys(getState().nodes).length).toBe(1);

      fireKey('Delete');
      // Node still present because nothing was selected
      expect(Object.keys(getState().nodes).length).toBe(1);
    });
  });

  // ====================================================================
  // Select All: Ctrl+A
  // ====================================================================

  describe('Ctrl+A select all', () => {
    it('selects all nodes and connections', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('transform', [3, 0, 0]);
      // Create a connection between them (sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex)
      const connId = getState().addConnection(id1, 0, id2, 0);
      expect(connId).toBeTruthy();

      fireKey('a', { ctrlKey: true });

      const state = getState();
      // Should have both nodes and the connection selected
      expect(state.selectedIds.size).toBe(3);
      expect(state.selectedIds.has(id1)).toBe(true);
      expect(state.selectedIds.has(id2)).toBe(true);
      expect(state.selectedIds.has(connId!)).toBe(true);
    });

    it('selects all nodes even without connections', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('transform', [3, 0, 0]);

      fireKey('a', { ctrlKey: true });

      const state = getState();
      expect(state.selectedIds.size).toBe(2);
      expect(state.selectedIds.has(id1)).toBe(true);
      expect(state.selectedIds.has(id2)).toBe(true);
    });
  });

  // ====================================================================
  // Undo / Redo
  // ====================================================================

  describe('undo and redo', () => {
    it('Ctrl+Z calls undo', () => {
      const spy = vi.spyOn(getState(), 'undo');
      fireKey('z', { ctrlKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Shift+Z calls redo', () => {
      const spy = vi.spyOn(getState(), 'redo');
      fireKey('z', { ctrlKey: true, shiftKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Y calls redo', () => {
      const spy = vi.spyOn(getState(), 'redo');
      fireKey('y', { ctrlKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Copy / Paste / Duplicate
  // ====================================================================

  describe('copy, paste, duplicate', () => {
    it('Ctrl+C calls copySelected', () => {
      const spy = vi.spyOn(getState(), 'copySelected');
      fireKey('c', { ctrlKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+V calls paste', async () => {
      const spy = vi.spyOn(getState(), 'paste');
      fireKey('v', { ctrlKey: true });
      // paste is called after async readFromSystemClipboard resolves
      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(1);
      });
    });

    it('Ctrl+D calls duplicateSelected', () => {
      const spy = vi.spyOn(getState(), 'duplicateSelected');
      fireKey('d', { ctrlKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Group / Ungroup
  // ====================================================================

  describe('group and ungroup', () => {
    it('Ctrl+G calls createGroup', () => {
      const spy = vi.spyOn(getState(), 'createGroup');
      fireKey('g', { ctrlKey: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Shift+G calls ungroupNodes for selected nodes in groups', () => {
      // Add two nodes and group them
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('transform', [3, 0, 0]);
      getState().setSelection(new Set([id1, id2]));
      const groupId = getState().createGroup('TestGroup');
      expect(groupId).toBeTruthy();
      // Verify group exists
      expect(Object.keys(getState().groups).length).toBe(1);

      // Select both nodes (they should be in the group)
      getState().setSelection(new Set([id1, id2]));

      const spy = vi.spyOn(getState(), 'ungroupNodes');
      fireKey('G', { ctrlKey: true, shiftKey: true });
      expect(spy).toHaveBeenCalled();
    });
  });

  // ====================================================================
  // Toggle Snap: G (no modifiers)
  // ====================================================================

  describe('toggle snap', () => {
    it('G (no modifiers) calls toggleSnap', () => {
      expect(getState().snapEnabled).toBe(false);
      fireKey('g');
      expect(getState().snapEnabled).toBe(true);
      fireKey('g');
      expect(getState().snapEnabled).toBe(false);
    });
  });

  // ====================================================================
  // Zoom to Fit: F
  // ====================================================================

  describe('zoom to fit', () => {
    it('F calls window.__zoomToFit', () => {
      const mockZoom = vi.fn();
      window.__zoomToFit = mockZoom;
      fireKey('f');
      expect(mockZoom).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Toggle Collapse: H
  // ====================================================================

  describe('toggle collapse', () => {
    it('H collapses selected expanded nodes', () => {
      const nodeId = getState().addNode('source');
      getState().setSelection(new Set([nodeId]));
      expect(getState().nodes[nodeId].collapsed).toBeFalsy();

      const spyCollapse = vi.spyOn(getState(), 'collapseSelected');
      fireKey('h');
      expect(spyCollapse).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Auto-layout: L
  // ====================================================================

  describe('auto-layout', () => {
    it('L calls autoLayout', () => {
      const spy = vi.spyOn(getState(), 'autoLayout');
      fireKey('l');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Add Note: N
  // ====================================================================

  describe('add note', () => {
    it('N adds a note node', () => {
      expect(Object.keys(getState().nodes).length).toBe(0);
      fireKey('n');
      const nodes = Object.values(getState().nodes);
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe('note');
    });
  });

  // ====================================================================
  // Quick-add nodes: 1-4
  // ====================================================================

  describe('number key quick-add', () => {
    it('1 adds a source node', () => {
      fireKey('1');
      const nodes = Object.values(getState().nodes);
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe('source');
    });

    it('2 adds a transform node', () => {
      fireKey('2');
      const nodes = Object.values(getState().nodes);
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe('transform');
    });

    it('3 adds a filter node', () => {
      fireKey('3');
      const nodes = Object.values(getState().nodes);
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe('filter');
    });

    it('4 adds an output node', () => {
      fireKey('4');
      const nodes = Object.values(getState().nodes);
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe('output');
    });
  });

  // ====================================================================
  // Toggle Value Previews: V
  // ====================================================================

  describe('toggle value previews', () => {
    it('V (no modifiers) calls toggleValuePreviews', () => {
      expect(getState().showValuePreviews).toBe(true);
      fireKey('v');
      expect(getState().showValuePreviews).toBe(false);
      fireKey('v');
      expect(getState().showValuePreviews).toBe(true);
    });
  });

  // ====================================================================
  // Tab: cycle selection
  // ====================================================================

  describe('Tab cycle selection', () => {
    it('Tab cycles forward through nodes when nothing selected', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().addNode('transform', [3, 0, 0]);
      getState().addNode('filter', [6, 0, 0]);

      // Nothing selected -> selects first node
      fireKey('Tab');
      const nodeIds = Object.keys(getState().nodes);
      expect(getState().selectedIds.size).toBe(1);
      expect(getState().selectedIds.has(nodeIds[0])).toBe(true);

      // Now deselect so we cycle nodes again (Tab with 1 node selected cycles ports)
      getState().setSelection(new Set());
      fireKey('Tab');
      expect(getState().selectedIds.has(nodeIds[0])).toBe(true);
    });

    it('Tab cycles ports when exactly one node is selected', () => {
      getState().addNode('source', [0, 0, 0]);
      const nodeIds = Object.keys(getState().nodes);
      getState().setSelection(new Set([nodeIds[0]]));

      // Tab -> cycles to first port on the selected node
      fireKey('Tab');
      const fp = getState().focusedPort;
      expect(fp).not.toBeNull();
      expect(fp!.nodeId).toBe(nodeIds[0]);
    });

    it('Shift+Tab cycles backward through nodes when nothing selected', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().addNode('transform', [3, 0, 0]);

      // Nothing selected -> Shift+Tab selects first node
      fireKey('Tab', { shiftKey: true });
      expect(getState().selectedIds.size).toBe(1);
    });

    it('Tab does nothing when there are no nodes', () => {
      fireKey('Tab');
      expect(getState().selectedIds.size).toBe(0);
    });
  });

  // ====================================================================
  // Graph management: Ctrl+T, Ctrl+W
  // ====================================================================

  describe('graph management', () => {
    it('Ctrl+T creates a new graph', () => {
      expect(getState().graphOrder.length).toBe(1);
      fireKey('t', { ctrlKey: true });
      expect(getState().graphOrder.length).toBe(2);
    });

    it('Ctrl+W closes active graph tab when more than one exists', () => {
      // Create a second graph so we can close one
      fireKey('t', { ctrlKey: true });
      expect(getState().graphOrder.length).toBe(2);

      fireKey('w', { ctrlKey: true });
      expect(getState().graphOrder.length).toBe(1);
    });

    it('Ctrl+W does not close the last graph tab', () => {
      expect(getState().graphOrder.length).toBe(1);
      fireKey('w', { ctrlKey: true });
      expect(getState().graphOrder.length).toBe(1);
    });
  });

  // ====================================================================
  // Debug keys: F10 and F5
  // ====================================================================

  describe('debug keys', () => {
    it('F10 calls stepExecution', () => {
      const spy = vi.spyOn(getState(), 'stepExecution');
      fireKey('F10');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('F5 calls resumeExecution', () => {
      const spy = vi.spyOn(getState(), 'resumeExecution');
      fireKey('F5');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Toggle error strategy: Shift+E
  // ====================================================================

  describe('toggle error strategy', () => {
    it('Shift+E toggles error strategy between fail-fast and continue', () => {
      expect(getState().errorStrategy).toBe('fail-fast');
      fireKey('E', { shiftKey: true });
      expect(getState().errorStrategy).toBe('continue');
      fireKey('E', { shiftKey: true });
      expect(getState().errorStrategy).toBe('fail-fast');
    });
  });

  // ====================================================================
  // Toggle profiling: Shift+P
  // ====================================================================

  describe('toggle profiling', () => {
    it('Shift+P calls toggleProfiling', () => {
      fireKey('P', { shiftKey: true });
      expect(callbacks.toggleProfiling).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Toggle grid: Shift+G
  // ====================================================================

  describe('toggle grid', () => {
    it('Shift+G calls window.__toggleGrid', () => {
      const mockToggleGrid = vi.fn();
      window.__toggleGrid = mockToggleGrid;
      fireKey('G', { shiftKey: true });
      expect(mockToggleGrid).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Toggle minimap: Shift+M
  // ====================================================================

  describe('toggle minimap', () => {
    it('Shift+M calls window.__toggleMinimap', () => {
      const mockToggleMinimap = vi.fn();
      window.__toggleMinimap = mockToggleMinimap;
      fireKey('M', { shiftKey: true });
      expect(mockToggleMinimap).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Toggle inspector: Shift+I
  // ====================================================================

  describe('toggle inspector', () => {
    it('Shift+I calls window.__toggleInspector', () => {
      const mockToggleInspector = vi.fn();
      window.__toggleInspector = mockToggleInspector;
      fireKey('I', { shiftKey: true });
      expect(mockToggleInspector).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Select connected: Shift+U, Shift+D, Shift+B
  // ====================================================================

  describe('select connected', () => {
    it('Shift+U calls selectConnected upstream', () => {
      const spy = vi.spyOn(getState(), 'selectConnected');
      fireKey('U', { shiftKey: true });
      expect(spy).toHaveBeenCalledWith('upstream');
    });

    it('Shift+D calls selectConnected downstream', () => {
      const spy = vi.spyOn(getState(), 'selectConnected');
      fireKey('D', { shiftKey: true });
      expect(spy).toHaveBeenCalledWith('downstream');
    });

    it('Shift+B calls selectConnected both', () => {
      const spy = vi.spyOn(getState(), 'selectConnected');
      fireKey('B', { shiftKey: true });
      expect(spy).toHaveBeenCalledWith('both');
    });
  });

  // ====================================================================
  // Align: Ctrl+Shift+H, Ctrl+Shift+V
  // ====================================================================

  describe('align selected', () => {
    it('Ctrl+Shift+H calls alignSelected center-x', () => {
      const spy = vi.spyOn(getState(), 'alignSelected');
      fireKey('H', { ctrlKey: true, shiftKey: true });
      expect(spy).toHaveBeenCalledWith('center-x');
    });

    it('Ctrl+Shift+V calls alignSelected center-z', () => {
      const spy = vi.spyOn(getState(), 'alignSelected');
      fireKey('V', { ctrlKey: true, shiftKey: true });
      expect(spy).toHaveBeenCalledWith('center-z');
    });
  });

  // ====================================================================
  // Arrow keys: nudge selected nodes
  // ====================================================================

  describe('arrow key nudge', () => {
    it('ArrowRight nudges selected node by 0.5', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));

      fireKey('ArrowRight');
      const pos = getState().nodes[id].position;
      expect(pos[0]).toBeCloseTo(0.5);
      expect(pos[2]).toBeCloseTo(0);
    });

    it('ArrowLeft nudges selected node by -0.5', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));

      fireKey('ArrowLeft');
      const pos = getState().nodes[id].position;
      expect(pos[0]).toBeCloseTo(-0.5);
    });

    it('ArrowUp nudges selected node z by -0.5', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));

      fireKey('ArrowUp');
      const pos = getState().nodes[id].position;
      expect(pos[2]).toBeCloseTo(-0.5);
    });

    it('ArrowDown nudges selected node z by +0.5', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));

      fireKey('ArrowDown');
      const pos = getState().nodes[id].position;
      expect(pos[2]).toBeCloseTo(0.5);
    });

    it('Shift+Arrow nudges by 1.0 instead of 0.5', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([id]));

      fireKey('ArrowRight', { shiftKey: true });
      const pos = getState().nodes[id].position;
      expect(pos[0]).toBeCloseTo(1.0);
    });

    it('Arrow keys switch camera view presets when no nodes are selected', () => {
      const mockFlyToView = vi.fn();
      window.__flyToViewPreset = mockFlyToView;

      fireKey('ArrowRight');
      expect(mockFlyToView).toHaveBeenCalledWith('right');

      mockFlyToView.mockClear();
      fireKey('ArrowLeft');
      expect(mockFlyToView).toHaveBeenCalledWith('left');

      mockFlyToView.mockClear();
      fireKey('ArrowUp');
      expect(mockFlyToView).toHaveBeenCalledWith('top');

      mockFlyToView.mockClear();
      fireKey('ArrowDown');
      expect(mockFlyToView).toHaveBeenCalledWith('isometric');

      // Shift+Up = front view
      mockFlyToView.mockClear();
      fireKey('ArrowUp', { shiftKey: true });
      expect(mockFlyToView).toHaveBeenCalledWith('front');
    });
  });

  // ====================================================================
  // Ctrl+0: reset camera
  // ====================================================================

  describe('reset camera', () => {
    it('Ctrl+0 resets camera position and target', () => {
      const mockSet = vi.fn();
      const mockUpdate = vi.fn();
      const mockInvalidate = vi.fn();
      window.__orbitControls = {
        target: { x: 5, y: 5, z: 5, set: mockSet },
        object: { position: { x: 10, y: 10, z: 10, set: mockSet, clone: vi.fn(), addScaledVector: vi.fn() } },
        update: mockUpdate,
      } as unknown as typeof window.__orbitControls;
      window.__invalidate = mockInvalidate;

      fireKey('0', { ctrlKey: true });
      // target.set(0, 0, 0) and object.position.set(5, 6, 8)
      expect(mockSet).toHaveBeenCalledWith(0, 0, 0);
      expect(mockSet).toHaveBeenCalledWith(5, 6, 8);
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  // ====================================================================
  // Ctrl+1-9: switch graph tabs
  // ====================================================================

  describe('switch graph tabs', () => {
    it('Ctrl+1 switches to the first graph tab', () => {
      // Create a second graph and switch to it
      getState().createGraph('Second');
      const order = getState().graphOrder;
      expect(order.length).toBe(2);
      getState().switchGraph(order[1]);
      expect(getState().activeGraphId).toBe(order[1]);

      // Ctrl+1 should switch back to first graph
      fireKey('1', { ctrlKey: true });
      expect(getState().activeGraphId).toBe(order[0]);
    });
  });

  // ====================================================================
  // Backspace: exit subgraph when nothing selected and breadcrumb stack exists
  // ====================================================================

  describe('Backspace exits subgraph', () => {
    it('Backspace calls exitSubgraph when nothing selected and breadcrumb stack non-empty', () => {
      const spy = vi.spyOn(getState(), 'exitSubgraph');
      setState({
        selectedIds: new Set<string>(),
        breadcrumbStack: [{ graphId: 'default', subgraphNodeId: 'sg-1' }],
      });

      fireKey('Backspace');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // Toggle Toolbar: T
  // ====================================================================

  describe('toggle toolbar', () => {
    beforeEach(() => {
      // Reset settings store to defaults before each toolbar test
      useSettingsStore.setState({ ...DEFAULT_SETTINGS });
    });

    it('T (no modifiers) toggles toolbarVisible in settings store', () => {
      expect(useSettingsStore.getState().toolbarVisible).toBe(true);
      fireKey('t');
      expect(useSettingsStore.getState().toolbarVisible).toBe(false);
      fireKey('t');
      expect(useSettingsStore.getState().toolbarVisible).toBe(true);
    });

    it('T does not toggle when Ctrl is held (prevents conflicts with other shortcuts)', () => {
      expect(useSettingsStore.getState().toolbarVisible).toBe(true);
      fireKey('t', { ctrlKey: true });
      // Should remain true — Ctrl+T is not the toolbar toggle
      expect(useSettingsStore.getState().toolbarVisible).toBe(true);
    });
  });

  // ====================================================================
  // Cleanup: event listener removed on unmount
  // ====================================================================

  describe('cleanup', () => {
    it('removes event listener on unmount', () => {
      hookResult.unmount();

      // After unmount, firing a key should not trigger callbacks
      vi.clearAllMocks();
      fireKey('k', { ctrlKey: true });
      expect(callbacks.toggleSearch).not.toHaveBeenCalled();
    });
  });
});

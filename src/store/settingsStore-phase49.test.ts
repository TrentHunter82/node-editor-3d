import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from './settingsStore';
import type { CameraBookmark } from './settingsStore';

function getState() {
  return useSettingsStore.getState();
}

function resetStore() {
  useSettingsStore.setState({
    ...DEFAULT_SETTINGS,
    recentFiles: [],
    recentlyUsedNodes: [],
    cameraBookmarks: {},
    keyBindingOverrides: {},
    nodePresets: [],
    workspacePresets: [],
    activeWorkspacePreset: null,
    macros: [],
    pinnedNodeTypes: [],
    onboardingCompleted: false,
  });
  localStorage.clear();
}

describe('Settings Store — Phase 49 (untested functionality)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    // Flush any pending debounce timer triggered by resetStore's setState
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------
  // 1. setPanSpeed / setRotateSpeed
  // -------------------------------------------------------
  describe('setPanSpeed', () => {
    it('sets pan speed to a valid value', () => {
      getState().setPanSpeed(1.5);
      expect(getState().panSpeed).toBe(1.5);
    });

    it('clamps pan speed to minimum 0.1', () => {
      getState().setPanSpeed(-2);
      expect(getState().panSpeed).toBe(0.1);

      getState().setPanSpeed(0);
      expect(getState().panSpeed).toBe(0.1);
    });

    it('clamps pan speed to maximum 3', () => {
      getState().setPanSpeed(10);
      expect(getState().panSpeed).toBe(3);
    });
  });

  describe('setRotateSpeed', () => {
    it('sets rotate speed and clamps within [0.1, 3]', () => {
      getState().setRotateSpeed(2.0);
      expect(getState().rotateSpeed).toBe(2.0);

      getState().setRotateSpeed(-1);
      expect(getState().rotateSpeed).toBe(0.1);

      getState().setRotateSpeed(5);
      expect(getState().rotateSpeed).toBe(3);
    });
  });

  // -------------------------------------------------------
  // 2. setConnectionStyle
  // -------------------------------------------------------
  describe('setConnectionStyle', () => {
    it('sets each valid connection style', () => {
      const styles = ['bezier', 'straight', 'right-angle', 'organic'] as const;
      for (const style of styles) {
        getState().setConnectionStyle(style);
        expect(getState().connectionStyle).toBe(style);
      }
    });

    it('defaults to bezier', () => {
      expect(getState().connectionStyle).toBe('bezier');
    });
  });

  // -------------------------------------------------------
  // 3. Boolean toggles: workerExecution, connectionFlowAnimation,
  //    showExecutionHeatmap, showNodeScreens
  // -------------------------------------------------------
  describe('setWorkerExecution', () => {
    it('enables and disables worker execution', () => {
      expect(getState().workerExecution).toBe(false);
      getState().setWorkerExecution(true);
      expect(getState().workerExecution).toBe(true);
      getState().setWorkerExecution(false);
      expect(getState().workerExecution).toBe(false);
    });
  });

  describe('setConnectionFlowAnimation', () => {
    it('toggles connection flow animation on and off', () => {
      expect(getState().connectionFlowAnimation).toBe(true);
      getState().setConnectionFlowAnimation(false);
      expect(getState().connectionFlowAnimation).toBe(false);
      getState().setConnectionFlowAnimation(true);
      expect(getState().connectionFlowAnimation).toBe(true);
    });
  });

  describe('setShowExecutionHeatmap', () => {
    it('toggles execution heatmap on and off', () => {
      expect(getState().showExecutionHeatmap).toBe(false);
      getState().setShowExecutionHeatmap(true);
      expect(getState().showExecutionHeatmap).toBe(true);
      getState().setShowExecutionHeatmap(false);
      expect(getState().showExecutionHeatmap).toBe(false);
    });
  });

  describe('setShowNodeScreens', () => {
    it('toggles node screens on and off', () => {
      expect(getState().showNodeScreens).toBe(true);
      getState().setShowNodeScreens(false);
      expect(getState().showNodeScreens).toBe(false);
      getState().setShowNodeScreens(true);
      expect(getState().showNodeScreens).toBe(true);
    });
  });

  // -------------------------------------------------------
  // 4. Camera bookmarks
  // -------------------------------------------------------
  describe('camera bookmarks', () => {
    const bookmark: CameraBookmark = {
      position: [1, 2, 3],
      target: [4, 5, 6],
    };

    it('setCameraBookmark stores position and target for a slot', () => {
      getState().setCameraBookmark(1, bookmark);
      expect(getState().cameraBookmarks['1']).toEqual(bookmark);
    });

    it('clearCameraBookmark removes a bookmark from its slot', () => {
      getState().setCameraBookmark(3, bookmark);
      expect(getState().cameraBookmarks['3']).toBeDefined();
      getState().clearCameraBookmark(3);
      expect(getState().cameraBookmarks['3']).toBeUndefined();
    });

    it('rejects out-of-range slots (0 and 10)', () => {
      getState().setCameraBookmark(0, bookmark);
      expect(getState().cameraBookmarks['0']).toBeUndefined();

      getState().setCameraBookmark(10, bookmark);
      expect(getState().cameraBookmarks['10']).toBeUndefined();

      // clearCameraBookmark also ignores out-of-range
      getState().setCameraBookmark(1, bookmark);
      getState().clearCameraBookmark(0);
      getState().clearCameraBookmark(10);
      expect(getState().cameraBookmarks['1']).toEqual(bookmark);
    });

    it('supports multiple bookmarks in different slots simultaneously', () => {
      const bk1: CameraBookmark = { position: [0, 0, 0], target: [1, 1, 1] };
      const bk5: CameraBookmark = { position: [10, 20, 30], target: [40, 50, 60] };
      const bk9: CameraBookmark = { position: [-1, -2, -3], target: [-4, -5, -6] };

      getState().setCameraBookmark(1, bk1);
      getState().setCameraBookmark(5, bk5);
      getState().setCameraBookmark(9, bk9);

      expect(getState().cameraBookmarks['1']).toEqual(bk1);
      expect(getState().cameraBookmarks['5']).toEqual(bk5);
      expect(getState().cameraBookmarks['9']).toEqual(bk9);
      expect(Object.keys(getState().cameraBookmarks)).toHaveLength(3);
    });
  });

  // -------------------------------------------------------
  // 5. Keyboard bindings
  // -------------------------------------------------------
  describe('keyboard bindings', () => {
    it('setKeyBinding stores a binding override', () => {
      getState().setKeyBinding('undo', 'ctrl+z');
      expect(getState().keyBindingOverrides['undo']).toBe('ctrl+z');
    });

    it('resetKeyBinding removes a single override', () => {
      getState().setKeyBinding('undo', 'ctrl+z');
      getState().setKeyBinding('redo', 'ctrl+shift+z');
      getState().resetKeyBinding('undo');
      expect(getState().keyBindingOverrides['undo']).toBeUndefined();
      expect(getState().keyBindingOverrides['redo']).toBe('ctrl+shift+z');
    });

    it('resetAllKeyBindings clears all overrides', () => {
      getState().setKeyBinding('undo', 'ctrl+z');
      getState().setKeyBinding('redo', 'ctrl+shift+z');
      getState().setKeyBinding('delete', 'backspace');
      getState().resetAllKeyBindings();
      expect(getState().keyBindingOverrides).toEqual({});
    });

    it('multiple bindings for different actions coexist', () => {
      getState().setKeyBinding('undo', 'ctrl+z');
      getState().setKeyBinding('copy', 'ctrl+c');
      getState().setKeyBinding('paste', 'ctrl+v');
      expect(Object.keys(getState().keyBindingOverrides)).toHaveLength(3);
      expect(getState().keyBindingOverrides['undo']).toBe('ctrl+z');
      expect(getState().keyBindingOverrides['copy']).toBe('ctrl+c');
      expect(getState().keyBindingOverrides['paste']).toBe('ctrl+v');
    });
  });

  // -------------------------------------------------------
  // 6. Node presets
  // -------------------------------------------------------
  describe('node presets', () => {
    it('saveNodePreset returns an ID and stores the preset', () => {
      const id = getState().saveNodePreset({
        name: 'My Math Node',
        nodeType: 'math',
        data: { operator: 'add', value: 10 },
      });
      expect(typeof id).toBe('string');
      expect(id.startsWith('preset-')).toBe(true);
      expect(getState().nodePresets).toHaveLength(1);
      expect(getState().nodePresets[0].name).toBe('My Math Node');
      expect(getState().nodePresets[0].nodeType).toBe('math');
      expect(getState().nodePresets[0].data).toEqual({ operator: 'add', value: 10 });
    });

    it('applyNodePreset retrieves a preset by ID', () => {
      const id = getState().saveNodePreset({
        name: 'Color Preset',
        nodeType: 'color',
        data: { r: 255, g: 0, b: 128 },
      });
      const result = getState().applyNodePreset(id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(id);
      expect(result!.name).toBe('Color Preset');

      // Non-existent ID returns undefined
      expect(getState().applyNodePreset('nonexistent-id')).toBeUndefined();
    });

    it('deleteNodePreset removes a preset', () => {
      const id1 = getState().saveNodePreset({ name: 'A', nodeType: 'a', data: {} });
      const id2 = getState().saveNodePreset({ name: 'B', nodeType: 'b', data: {} });
      expect(getState().nodePresets).toHaveLength(2);

      getState().deleteNodePreset(id1);
      expect(getState().nodePresets).toHaveLength(1);
      expect(getState().nodePresets[0].id).toBe(id2);
    });
  });

  // -------------------------------------------------------
  // 7. Workspace presets
  // -------------------------------------------------------
  describe('workspace presets', () => {
    it('saveWorkspacePreset stores a preset capturing current layout state', () => {
      getState().setMinimapVisible(false);
      getState().setInspectorVisible(true);

      const id = getState().saveWorkspacePreset('My Layout', ['debug', 'timeline']);
      expect(typeof id).toBe('string');
      expect(id.startsWith('ws-')).toBe(true);
      expect(getState().workspacePresets).toHaveLength(1);
      expect(getState().workspacePresets[0].name).toBe('My Layout');
      expect(getState().workspacePresets[0].minimapVisible).toBe(false);
      expect(getState().workspacePresets[0].inspectorVisible).toBe(true);
      expect(getState().workspacePresets[0].openPanels).toEqual(['debug', 'timeline']);
    });

    it('deleteWorkspacePreset removes and nullifies active preset', () => {
      const id = getState().saveWorkspacePreset('Temp', ['validation']);
      getState().setActiveWorkspacePreset(id);
      expect(getState().activeWorkspacePreset).toBe(id);

      getState().deleteWorkspacePreset(id);
      expect(getState().workspacePresets).toHaveLength(0);
      expect(getState().activeWorkspacePreset).toBeNull();
    });
  });

  // -------------------------------------------------------
  // 8. Panel management
  // -------------------------------------------------------
  describe('panel management', () => {
    it('setPanelOpen adds and removes panels', () => {
      // Default openPanels are ['validation', 'profiling']
      getState().setPanelOpen('debug', true);
      expect(getState().openPanels).toContain('debug');

      getState().setPanelOpen('debug', false);
      expect(getState().openPanels).not.toContain('debug');
    });

    it('setPanelOpen does not duplicate already-open panels', () => {
      getState().setPanelOpen('validation', true); // already open by default
      const count = getState().openPanels.filter(p => p === 'validation').length;
      expect(count).toBe(1);
    });

    it('resetPanelLayout resets to default panel state', () => {
      getState().setMinimapVisible(false);
      getState().setInspectorVisible(false);
      getState().setPanelOpen('debug', true);
      getState().setActiveWorkspacePreset('some-id');

      getState().resetPanelLayout();
      expect(getState().minimapVisible).toBe(DEFAULT_SETTINGS.minimapVisible);
      expect(getState().inspectorVisible).toBe(DEFAULT_SETTINGS.inspectorVisible);
      expect(getState().openPanels).toEqual(DEFAULT_SETTINGS.openPanels);
      expect(getState().activeWorkspacePreset).toBeNull();
    });

    it('setMinimapSize clamps width to [120,400] and height to [100,350]', () => {
      getState().setMinimapSize(50, 50);
      expect(getState().minimapWidth).toBe(120);
      expect(getState().minimapHeight).toBe(100);

      getState().setMinimapSize(999, 999);
      expect(getState().minimapWidth).toBe(400);
      expect(getState().minimapHeight).toBe(350);

      getState().setMinimapSize(250, 200);
      expect(getState().minimapWidth).toBe(250);
      expect(getState().minimapHeight).toBe(200);
    });
  });

  // -------------------------------------------------------
  // 9. Macros
  // -------------------------------------------------------
  describe('macros', () => {
    it('saveMacro stores a macro with a generated ID', () => {
      const id = getState().saveMacro({
        name: 'Quick Undo-Redo',
        actions: ['undo', 'redo'],
        delayMs: 100,
      });
      expect(typeof id).toBe('string');
      expect(id.startsWith('macro-')).toBe(true);
      expect(getState().macros).toHaveLength(1);
      expect(getState().macros[0].name).toBe('Quick Undo-Redo');
      expect(getState().macros[0].actions).toEqual(['undo', 'redo']);
      expect(getState().macros[0].delayMs).toBe(100);
    });

    it('deleteMacro removes a macro by ID', () => {
      const id1 = getState().saveMacro({ name: 'M1', actions: ['a'], delayMs: 0 });
      const id2 = getState().saveMacro({ name: 'M2', actions: ['b'], delayMs: 0 });

      getState().deleteMacro(id1);
      expect(getState().macros).toHaveLength(1);
      expect(getState().macros[0].id).toBe(id2);
    });

    it('updateMacro updates specific fields without replacing the whole macro', () => {
      const id = getState().saveMacro({
        name: 'Original',
        actions: ['undo'],
        delayMs: 50,
      });

      getState().updateMacro(id, { name: 'Renamed', delayMs: 200 });
      const macro = getState().macros.find(m => m.id === id)!;
      expect(macro.name).toBe('Renamed');
      expect(macro.delayMs).toBe(200);
      // actions remain unchanged
      expect(macro.actions).toEqual(['undo']);
    });
  });

  // -------------------------------------------------------
  // 10. Pinned node types
  // -------------------------------------------------------
  describe('pinned node types', () => {
    it('pinNodeType adds and respects max-10 limit', () => {
      for (let i = 0; i < 12; i++) {
        getState().pinNodeType(`type-${i}`);
      }
      expect(getState().pinnedNodeTypes).toHaveLength(10);
      // The 11th and 12th should have been rejected
      expect(getState().pinnedNodeTypes).not.toContain('type-10');
      expect(getState().pinnedNodeTypes).not.toContain('type-11');
    });

    it('pinNodeType does not add duplicates; unpinNodeType removes', () => {
      getState().pinNodeType('math');
      getState().pinNodeType('math'); // duplicate, should be ignored
      expect(getState().pinnedNodeTypes).toEqual(['math']);

      getState().pinNodeType('color');
      expect(getState().pinnedNodeTypes).toEqual(['math', 'color']);

      getState().unpinNodeType('math');
      expect(getState().pinnedNodeTypes).toEqual(['color']);
    });
  });

  // -------------------------------------------------------
  // 11. Toolbar sections
  // -------------------------------------------------------
  describe('toolbar sections', () => {
    it('setToolbarCollapsedSections replaces the full list', () => {
      getState().setToolbarCollapsedSections(['file', 'edit']);
      expect(getState().toolbarCollapsedSections).toEqual(['file', 'edit']);
    });

    it('toggleToolbarSection toggles a single section in and out', () => {
      // Start from a known list
      getState().setToolbarCollapsedSections(['file', 'edit']);

      // Toggle 'edit' off (remove from collapsed = expand it)
      getState().toggleToolbarSection('edit');
      expect(getState().toolbarCollapsedSections).toEqual(['file']);

      // Toggle 'edit' back in (collapse it again)
      getState().toggleToolbarSection('edit');
      expect(getState().toolbarCollapsedSections).toContain('edit');

      // Toggle a section that was not in the list (collapse it)
      getState().toggleToolbarSection('view');
      expect(getState().toolbarCollapsedSections).toContain('view');
    });
  });

  // -------------------------------------------------------
  // 12. Overview / Layout / Max execution ms
  // -------------------------------------------------------
  describe('overview mode and layout', () => {
    it('setOverviewMode and toggleOverviewMode work correctly', () => {
      expect(getState().overviewMode).toBe(false);
      getState().setOverviewMode(true);
      expect(getState().overviewMode).toBe(true);

      getState().toggleOverviewMode();
      expect(getState().overviewMode).toBe(false);

      getState().toggleOverviewMode();
      expect(getState().overviewMode).toBe(true);
    });

    it('setMaxExecutionMs clamps to [0, 300000]', () => {
      getState().setMaxExecutionMs(5000);
      expect(getState().maxExecutionMs).toBe(5000);

      getState().setMaxExecutionMs(-100);
      expect(getState().maxExecutionMs).toBe(0);

      getState().setMaxExecutionMs(999999);
      expect(getState().maxExecutionMs).toBe(300000);

      // Boundary values
      getState().setMaxExecutionMs(0);
      expect(getState().maxExecutionMs).toBe(0);

      getState().setMaxExecutionMs(300000);
      expect(getState().maxExecutionMs).toBe(300000);
    });

    it('setLayoutMode switches between layered and force', () => {
      expect(getState().layoutMode).toBe('layered');
      getState().setLayoutMode('force');
      expect(getState().layoutMode).toBe('force');
      getState().setLayoutMode('layered');
      expect(getState().layoutMode).toBe('layered');
    });
  });

  // -------------------------------------------------------
  // 13. addRecentlyUsedNode
  // -------------------------------------------------------
  describe('addRecentlyUsedNode', () => {
    it('adds nodes, deduplicates, and caps at 8', () => {
      for (let i = 0; i < 10; i++) {
        getState().addRecentlyUsedNode(`node-${i}`);
      }
      expect(getState().recentlyUsedNodes).toHaveLength(8);
      // Most recent should be first
      expect(getState().recentlyUsedNodes[0]).toBe('node-9');
      // Oldest overflowed entries should be gone
      expect(getState().recentlyUsedNodes).not.toContain('node-0');
      expect(getState().recentlyUsedNodes).not.toContain('node-1');
    });

    it('moves a duplicate to the front without increasing length', () => {
      getState().addRecentlyUsedNode('alpha');
      getState().addRecentlyUsedNode('beta');
      getState().addRecentlyUsedNode('gamma');
      getState().addRecentlyUsedNode('alpha'); // re-add existing

      expect(getState().recentlyUsedNodes).toEqual(['alpha', 'gamma', 'beta']);
    });
  });

  // -------------------------------------------------------
  // 14. setOnboardingCompleted
  // -------------------------------------------------------
  describe('setOnboardingCompleted', () => {
    it('sets onboarding completed flag', () => {
      expect(getState().onboardingCompleted).toBe(false);
      getState().setOnboardingCompleted(true);
      expect(getState().onboardingCompleted).toBe(true);
      getState().setOnboardingCompleted(false);
      expect(getState().onboardingCompleted).toBe(false);
    });
  });

  // -------------------------------------------------------
  // 15. clampLoadedSettings validation
  // -------------------------------------------------------
  describe('clampLoadedSettings validation', () => {
    it('filters corrupt boolean values (non-boolean becomes deleted)', () => {
      const result = clampLoadedSettings({
        gridVisible: 'yes' as unknown,
        autoSave: 42 as unknown,
        workerExecution: null as unknown,
        overviewMode: undefined as unknown,
      } as Record<string, unknown>);

      // Corrupt booleans should be removed so defaults kick in
      expect(result).not.toHaveProperty('gridVisible');
      expect(result).not.toHaveProperty('autoSave');
      expect(result).not.toHaveProperty('workerExecution');
      expect(result).not.toHaveProperty('overviewMode');
    });

    it('clamps numeric values that are out of range', () => {
      const result = clampLoadedSettings({
        panSpeed: -5,
        rotateSpeed: 100,
        maxExecutionMs: -999,
        gridSnapSize: 9999,
        uiScale: 0.01,
        zoomSensitivity: 50,
      });

      expect(result.panSpeed).toBe(0.1);
      expect(result.rotateSpeed).toBe(3);
      expect(result.maxExecutionMs).toBe(0);
      expect(result.gridSnapSize).toBe(100);
      expect(result.uiScale).toBe(0.5);
      expect(result.zoomSensitivity).toBe(3);
    });

    it('deletes invalid enum values for theme, connectionStyle, and layoutMode', () => {
      const result = clampLoadedSettings({
        theme: 'neon' as unknown,
        connectionStyle: 'wavy' as unknown,
        layoutMode: 'random' as unknown,
      } as Record<string, unknown>);

      expect(result).not.toHaveProperty('theme');
      expect(result).not.toHaveProperty('connectionStyle');
      expect(result).not.toHaveProperty('layoutMode');
    });
  });
});

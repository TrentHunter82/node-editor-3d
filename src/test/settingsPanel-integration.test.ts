import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settingsStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useSettingsStore.getState();
}

function resetStore() {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, recentFiles: [], recentlyUsedNodes: [], keyBindingOverrides: {}, nodePresets: [] });
  localStorage.clear();
}

/** Flush the 200ms debounced auto-save timer so localStorage is written. */
function flushSettingsSave() {
  vi.advanceTimersByTime(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsPanel integration — store interactions', () => {
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

  // =========================================================================
  // 1. Camera section controls — valid values
  // =========================================================================

  describe('camera section controls with valid values', () => {
    it('setZoomSensitivity updates to a valid value', () => {
      getState().setZoomSensitivity(1.5);
      expect(getState().zoomSensitivity).toBe(1.5);
    });

    it('setPanSpeed updates to a valid value', () => {
      getState().setPanSpeed(2.0);
      expect(getState().panSpeed).toBe(2.0);
    });

    it('setRotateSpeed updates to a valid value', () => {
      getState().setRotateSpeed(1.2);
      expect(getState().rotateSpeed).toBe(1.2);
    });

    it('setCameraDamping updates to a valid value', () => {
      getState().setCameraDamping(0.1);
      expect(getState().cameraDamping).toBe(0.1);
    });

    it('setDampingDuration updates to a valid value', () => {
      getState().setDampingDuration(0.3);
      expect(getState().dampingDuration).toBe(0.3);
    });
  });

  // =========================================================================
  // 2. Camera section clamping — out-of-range values
  // =========================================================================

  describe('camera section clamping', () => {
    it('setZoomSensitivity clamps below minimum to 0.1', () => {
      getState().setZoomSensitivity(-5);
      expect(getState().zoomSensitivity).toBe(0.1);
    });

    it('setZoomSensitivity clamps above maximum to 3.0', () => {
      getState().setZoomSensitivity(99);
      expect(getState().zoomSensitivity).toBe(3.0);
    });

    it('setPanSpeed clamps below minimum to 0.1', () => {
      getState().setPanSpeed(0);
      expect(getState().panSpeed).toBe(0.1);
    });

    it('setPanSpeed clamps above maximum to 3.0', () => {
      getState().setPanSpeed(10);
      expect(getState().panSpeed).toBe(3.0);
    });

    it('setRotateSpeed clamps below minimum to 0.1', () => {
      getState().setRotateSpeed(-1);
      expect(getState().rotateSpeed).toBe(0.1);
    });

    it('setRotateSpeed clamps above maximum to 3.0', () => {
      getState().setRotateSpeed(50);
      expect(getState().rotateSpeed).toBe(3.0);
    });

    it('setCameraDamping clamps below minimum to 0.01', () => {
      getState().setCameraDamping(0);
      expect(getState().cameraDamping).toBe(0.01);
    });

    it('setCameraDamping clamps above maximum to 0.2', () => {
      getState().setCameraDamping(5);
      expect(getState().cameraDamping).toBe(0.2);
    });

    it('setDampingDuration clamps below minimum to 0.1', () => {
      getState().setDampingDuration(0);
      expect(getState().dampingDuration).toBe(0.1);
    });

    it('setDampingDuration clamps above maximum to 0.5', () => {
      getState().setDampingDuration(10);
      expect(getState().dampingDuration).toBe(0.5);
    });
  });

  // =========================================================================
  // 3. Full reset-to-defaults
  // =========================================================================

  describe('resetToDefaults restores all settings', () => {
    it('resets camera settings after modification', () => {
      getState().setZoomSensitivity(2.5);
      getState().setPanSpeed(1.5);
      getState().setRotateSpeed(2.0);
      getState().setCameraDamping(0.15);
      getState().setDampingDuration(0.4);

      getState().resetToDefaults();

      expect(getState().zoomSensitivity).toBe(DEFAULT_SETTINGS.zoomSensitivity);
      expect(getState().panSpeed).toBe(DEFAULT_SETTINGS.panSpeed);
      expect(getState().rotateSpeed).toBe(DEFAULT_SETTINGS.rotateSpeed);
      expect(getState().cameraDamping).toBe(DEFAULT_SETTINGS.cameraDamping);
      expect(getState().dampingDuration).toBe(DEFAULT_SETTINGS.dampingDuration);
    });

    it('resets UI settings after modification', () => {
      getState().setTheme('light');
      getState().setUiScale(1.8);
      getState().setAnimationSpeed(2.5);
      getState().setGridSnapSize(0.5);
      getState().setGridVisible(false);

      getState().resetToDefaults();

      expect(getState().theme).toBe(DEFAULT_SETTINGS.theme);
      expect(getState().uiScale).toBe(DEFAULT_SETTINGS.uiScale);
      expect(getState().animationSpeed).toBe(DEFAULT_SETTINGS.animationSpeed);
      expect(getState().gridSnapSize).toBe(DEFAULT_SETTINGS.gridSnapSize);
      expect(getState().gridVisible).toBe(DEFAULT_SETTINGS.gridVisible);
    });

    it('resets boolean toggles after modification', () => {
      getState().setAutoSave(false);
      getState().setWorkerExecution(true);
      getState().setMinimapVisible(false);
      getState().setInspectorVisible(false);
      getState().setToolbarVisible(false);

      getState().resetToDefaults();

      expect(getState().autoSave).toBe(DEFAULT_SETTINGS.autoSave);
      expect(getState().workerExecution).toBe(DEFAULT_SETTINGS.workerExecution);
      expect(getState().minimapVisible).toBe(DEFAULT_SETTINGS.minimapVisible);
      expect(getState().inspectorVisible).toBe(DEFAULT_SETTINGS.inspectorVisible);
      expect(getState().toolbarVisible).toBe(DEFAULT_SETTINGS.toolbarVisible);
    });

    it('resets connection style after modification', () => {
      getState().setConnectionStyle('organic');
      getState().resetToDefaults();
      expect(getState().connectionStyle).toBe(DEFAULT_SETTINGS.connectionStyle);
    });
  });

  // =========================================================================
  // 4. resetPanelLayout — only layout settings reset
  // =========================================================================

  describe('resetPanelLayout preserves non-layout settings', () => {
    it('resets minimap/inspector visibility but keeps camera settings', () => {
      // Change layout settings
      getState().setMinimapVisible(false);
      getState().setInspectorVisible(false);
      getState().setPanelOpen('debug', true);
      getState().setActiveWorkspacePreset('minimal');

      // Change camera settings
      getState().setZoomSensitivity(2.0);
      getState().setPanSpeed(1.5);

      getState().resetPanelLayout();

      // Layout settings should be reset
      expect(getState().minimapVisible).toBe(DEFAULT_SETTINGS.minimapVisible);
      expect(getState().inspectorVisible).toBe(DEFAULT_SETTINGS.inspectorVisible);
      expect(getState().openPanels).toEqual(DEFAULT_SETTINGS.openPanels);
      expect(getState().activeWorkspacePreset).toBeNull();

      // Camera settings should be preserved
      expect(getState().zoomSensitivity).toBe(2.0);
      expect(getState().panSpeed).toBe(1.5);
    });

    it('preserves theme and connection style after layout reset', () => {
      getState().setTheme('light');
      getState().setConnectionStyle('straight');
      getState().setMinimapVisible(false);

      getState().resetPanelLayout();

      expect(getState().theme).toBe('light');
      expect(getState().connectionStyle).toBe('straight');
      expect(getState().minimapVisible).toBe(DEFAULT_SETTINGS.minimapVisible);
    });

    it('preserves boolean execution settings after layout reset', () => {
      getState().setAutoSave(false);
      getState().setWorkerExecution(true);
      getState().setInspectorVisible(false);

      getState().resetPanelLayout();

      expect(getState().autoSave).toBe(false);
      expect(getState().workerExecution).toBe(true);
      expect(getState().inspectorVisible).toBe(DEFAULT_SETTINGS.inspectorVisible);
    });
  });

  // =========================================================================
  // 5. Persistence round-trip
  // =========================================================================

  describe('persistence round-trip via localStorage', () => {
    it('camera settings survive a persistence round-trip', () => {
      getState().setZoomSensitivity(1.8);
      getState().setPanSpeed(2.2);
      getState().setRotateSpeed(1.0);
      getState().setCameraDamping(0.12);
      getState().setDampingDuration(0.35);

      flushSettingsSave();

      const raw = localStorage.getItem('settings-v1');
      expect(raw).not.toBeNull();
      const saved = JSON.parse(raw!);

      expect(saved.zoomSensitivity).toBe(1.8);
      expect(saved.panSpeed).toBe(2.2);
      expect(saved.rotateSpeed).toBe(1.0);
      expect(saved.cameraDamping).toBe(0.12);
      expect(saved.dampingDuration).toBe(0.35);
    });

    it('theme and connection style are persisted', () => {
      getState().setTheme('light');
      getState().setConnectionStyle('right-angle');

      flushSettingsSave();

      const saved = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(saved.theme).toBe('light');
      expect(saved.connectionStyle).toBe('right-angle');
    });

    it('boolean toggles are persisted', () => {
      getState().setAutoSave(false);
      getState().setWorkerExecution(true);
      getState().setGridVisible(false);

      flushSettingsSave();

      const saved = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(saved.autoSave).toBe(false);
      expect(saved.workerExecution).toBe(true);
      expect(saved.gridVisible).toBe(false);
    });

    it('debounce prevents premature save', () => {
      getState().setTheme('light');
      // Before debounce fires, localStorage should still be empty
      vi.advanceTimersByTime(100);
      expect(localStorage.getItem('settings-v1')).toBeNull();

      // After full debounce window, it should be saved
      vi.advanceTimersByTime(200);
      const saved = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(saved.theme).toBe('light');
    });
  });

  // =========================================================================
  // 6. Multiple camera settings interaction — independence
  // =========================================================================

  describe('camera settings are independent of each other', () => {
    it('changing zoomSensitivity does not affect panSpeed', () => {
      const originalPan = getState().panSpeed;
      getState().setZoomSensitivity(2.5);
      expect(getState().panSpeed).toBe(originalPan);
    });

    it('changing panSpeed does not affect rotateSpeed', () => {
      const originalRotate = getState().rotateSpeed;
      getState().setPanSpeed(2.0);
      expect(getState().rotateSpeed).toBe(originalRotate);
    });

    it('changing cameraDamping does not affect dampingDuration', () => {
      const originalDuration = getState().dampingDuration;
      getState().setCameraDamping(0.15);
      expect(getState().dampingDuration).toBe(originalDuration);
    });

    it('changing all five camera settings preserves each value independently', () => {
      getState().setZoomSensitivity(1.0);
      getState().setPanSpeed(1.5);
      getState().setRotateSpeed(2.0);
      getState().setCameraDamping(0.08);
      getState().setDampingDuration(0.25);

      expect(getState().zoomSensitivity).toBe(1.0);
      expect(getState().panSpeed).toBe(1.5);
      expect(getState().rotateSpeed).toBe(2.0);
      expect(getState().cameraDamping).toBe(0.08);
      expect(getState().dampingDuration).toBe(0.25);
    });

    it('setting zoomSensitivity twice only keeps the last value', () => {
      getState().setZoomSensitivity(0.5);
      getState().setZoomSensitivity(2.8);
      expect(getState().zoomSensitivity).toBe(2.8);
    });
  });

  // =========================================================================
  // 7. Connection style setting — all 4 styles
  // =========================================================================

  describe('connection style setting', () => {
    it('defaults to bezier', () => {
      expect(getState().connectionStyle).toBe('bezier');
    });

    it('can set to straight', () => {
      getState().setConnectionStyle('straight');
      expect(getState().connectionStyle).toBe('straight');
    });

    it('can set to right-angle', () => {
      getState().setConnectionStyle('right-angle');
      expect(getState().connectionStyle).toBe('right-angle');
    });

    it('can set to organic', () => {
      getState().setConnectionStyle('organic');
      expect(getState().connectionStyle).toBe('organic');
    });

    it('can cycle through all styles sequentially', () => {
      const styles = ['bezier', 'straight', 'right-angle', 'organic'] as const;
      for (const style of styles) {
        getState().setConnectionStyle(style);
        expect(getState().connectionStyle).toBe(style);
      }
    });
  });

  // =========================================================================
  // 8. Boolean toggles — all toggle setters
  // =========================================================================

  describe('boolean toggle setters', () => {
    it('setGridVisible toggles grid visibility', () => {
      expect(getState().gridVisible).toBe(true);
      getState().setGridVisible(false);
      expect(getState().gridVisible).toBe(false);
      getState().setGridVisible(true);
      expect(getState().gridVisible).toBe(true);
    });

    it('setMinimapVisible toggles minimap visibility', () => {
      expect(getState().minimapVisible).toBe(true);
      getState().setMinimapVisible(false);
      expect(getState().minimapVisible).toBe(false);
    });

    it('setInspectorVisible toggles inspector visibility', () => {
      expect(getState().inspectorVisible).toBe(true);
      getState().setInspectorVisible(false);
      expect(getState().inspectorVisible).toBe(false);
    });

    it('setToolbarVisible toggles toolbar visibility', () => {
      expect(getState().toolbarVisible).toBe(true);
      getState().setToolbarVisible(false);
      expect(getState().toolbarVisible).toBe(false);
    });

    it('setAutoSave toggles auto-save', () => {
      expect(getState().autoSave).toBe(true);
      getState().setAutoSave(false);
      expect(getState().autoSave).toBe(false);
    });

    it('setWorkerExecution toggles worker execution', () => {
      expect(getState().workerExecution).toBe(false);
      getState().setWorkerExecution(true);
      expect(getState().workerExecution).toBe(true);
    });

    it('setConnectionFlowAnimation toggles flow animation', () => {
      expect(getState().connectionFlowAnimation).toBe(true);
      getState().setConnectionFlowAnimation(false);
      expect(getState().connectionFlowAnimation).toBe(false);
    });

    it('setShowExecutionHeatmap toggles heatmap', () => {
      expect(getState().showExecutionHeatmap).toBe(false);
      getState().setShowExecutionHeatmap(true);
      expect(getState().showExecutionHeatmap).toBe(true);
    });

    it('setShowNodeScreens toggles node screens', () => {
      expect(getState().showNodeScreens).toBe(true);
      getState().setShowNodeScreens(false);
      expect(getState().showNodeScreens).toBe(false);
    });
  });

  // =========================================================================
  // 9. Theme switching — dark/light/dark
  // =========================================================================

  describe('theme switching', () => {
    it('defaults to dark theme', () => {
      expect(getState().theme).toBe('dark');
    });

    it('switches from dark to light', () => {
      getState().setTheme('light');
      expect(getState().theme).toBe('light');
    });

    it('switches from light back to dark', () => {
      getState().setTheme('light');
      expect(getState().theme).toBe('light');
      getState().setTheme('dark');
      expect(getState().theme).toBe('dark');
    });

    it('full dark -> light -> dark round-trip', () => {
      expect(getState().theme).toBe('dark');
      getState().setTheme('light');
      expect(getState().theme).toBe('light');
      getState().setTheme('dark');
      expect(getState().theme).toBe('dark');
    });

    it('setting same theme is idempotent', () => {
      getState().setTheme('dark');
      expect(getState().theme).toBe('dark');
      getState().setTheme('dark');
      expect(getState().theme).toBe('dark');
    });
  });

  // =========================================================================
  // Additional edge-case coverage
  // =========================================================================

  describe('numeric setting clamping for non-camera fields', () => {
    it('setGridSnapSize clamps to valid range [0.1, 100]', () => {
      getState().setGridSnapSize(0);
      expect(getState().gridSnapSize).toBe(0.1);
      getState().setGridSnapSize(200);
      expect(getState().gridSnapSize).toBe(100);
    });

    it('setAnimationSpeed clamps to [0, 3]', () => {
      getState().setAnimationSpeed(-1);
      expect(getState().animationSpeed).toBe(0);
      getState().setAnimationSpeed(10);
      expect(getState().animationSpeed).toBe(3);
    });

    it('setUiScale clamps to [0.5, 2.0]', () => {
      getState().setUiScale(0.1);
      expect(getState().uiScale).toBe(0.5);
      getState().setUiScale(5);
      expect(getState().uiScale).toBe(2);
    });
  });

  describe('camera boundary values are accepted', () => {
    it('zoomSensitivity accepts exact min and max', () => {
      getState().setZoomSensitivity(0.1);
      expect(getState().zoomSensitivity).toBe(0.1);
      getState().setZoomSensitivity(3.0);
      expect(getState().zoomSensitivity).toBe(3.0);
    });

    it('panSpeed accepts exact min and max', () => {
      getState().setPanSpeed(0.1);
      expect(getState().panSpeed).toBe(0.1);
      getState().setPanSpeed(3.0);
      expect(getState().panSpeed).toBe(3.0);
    });

    it('cameraDamping accepts exact min and max', () => {
      getState().setCameraDamping(0.01);
      expect(getState().cameraDamping).toBe(0.01);
      getState().setCameraDamping(0.2);
      expect(getState().cameraDamping).toBe(0.2);
    });

    it('dampingDuration accepts exact min and max', () => {
      getState().setDampingDuration(0.1);
      expect(getState().dampingDuration).toBe(0.1);
      getState().setDampingDuration(0.5);
      expect(getState().dampingDuration).toBe(0.5);
    });
  });
});

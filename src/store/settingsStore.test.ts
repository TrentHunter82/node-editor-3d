import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from './settingsStore';

function getState() {
  return useSettingsStore.getState();
}

function resetStore() {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, recentFiles: [] });
  localStorage.clear();
}

/** Flush debounced settings save (200ms debounce) */
function flushSettingsSave() {
  vi.advanceTimersByTime(200);
}

describe('Settings Store', () => {
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

  describe('defaults', () => {
    it('has correct default values', () => {
      expect(getState().gridSnapSize).toBe(1);
      expect(getState().gridVisible).toBe(true);
      expect(getState().animationSpeed).toBe(1);
      expect(getState().uiScale).toBe(1);
      expect(getState().theme).toBe('dark');
      expect(getState().minimapVisible).toBe(true);
      expect(getState().inspectorVisible).toBe(true);
      expect(getState().zoomSensitivity).toBe(0.3);
      expect(getState().autoSave).toBe(true);
      expect(getState().recentFiles).toEqual([]);
    });
  });

  describe('setGridSnapSize', () => {
    it('sets grid snap size', () => {
      getState().setGridSnapSize(2);
      expect(getState().gridSnapSize).toBe(2);
    });

    it('clamps to minimum 0.1', () => {
      getState().setGridSnapSize(0);
      expect(getState().gridSnapSize).toBe(0.1);

      getState().setGridSnapSize(-5);
      expect(getState().gridSnapSize).toBe(0.1);
    });

    it('allows fractional values', () => {
      getState().setGridSnapSize(0.5);
      expect(getState().gridSnapSize).toBe(0.5);
    });
  });

  describe('setAnimationSpeed', () => {
    it('sets animation speed', () => {
      getState().setAnimationSpeed(2);
      expect(getState().animationSpeed).toBe(2);
    });

    it('clamps to minimum 0', () => {
      getState().setAnimationSpeed(-1);
      expect(getState().animationSpeed).toBe(0);
    });

    it('allows zero (pause animations)', () => {
      getState().setAnimationSpeed(0);
      expect(getState().animationSpeed).toBe(0);
    });
  });

  describe('setUiScale', () => {
    it('sets UI scale', () => {
      getState().setUiScale(1.5);
      expect(getState().uiScale).toBe(1.5);
    });

    it('clamps to minimum 0.5', () => {
      getState().setUiScale(0.1);
      expect(getState().uiScale).toBe(0.5);
    });

    it('clamps to maximum 2', () => {
      getState().setUiScale(3);
      expect(getState().uiScale).toBe(2);
    });
  });

  describe('setTheme', () => {
    it('sets theme to light', () => {
      getState().setTheme('light');
      expect(getState().theme).toBe('light');
    });

    it('sets theme back to dark', () => {
      getState().setTheme('light');
      getState().setTheme('dark');
      expect(getState().theme).toBe('dark');
    });
  });

  describe('setMinimapVisible', () => {
    it('hides minimap', () => {
      getState().setMinimapVisible(false);
      expect(getState().minimapVisible).toBe(false);
    });

    it('shows minimap', () => {
      getState().setMinimapVisible(false);
      getState().setMinimapVisible(true);
      expect(getState().minimapVisible).toBe(true);
    });
  });

  describe('setInspectorVisible', () => {
    it('hides inspector', () => {
      getState().setInspectorVisible(false);
      expect(getState().inspectorVisible).toBe(false);
    });

    it('shows inspector', () => {
      getState().setInspectorVisible(false);
      getState().setInspectorVisible(true);
      expect(getState().inspectorVisible).toBe(true);
    });
  });

  describe('setGridVisible', () => {
    it('hides grid', () => {
      getState().setGridVisible(false);
      expect(getState().gridVisible).toBe(false);
    });

    it('shows grid', () => {
      getState().setGridVisible(false);
      getState().setGridVisible(true);
      expect(getState().gridVisible).toBe(true);
    });

    it('defaults to true', () => {
      expect(getState().gridVisible).toBe(true);
    });

    it('persists to localStorage', () => {
      getState().setGridVisible(false);
      flushSettingsSave();
      const stored = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(stored.gridVisible).toBe(false);
    });
  });

  describe('setZoomSensitivity', () => {
    it('sets zoom sensitivity', () => {
      getState().setZoomSensitivity(1.5);
      expect(getState().zoomSensitivity).toBe(1.5);
    });

    it('clamps to minimum 0.1', () => {
      getState().setZoomSensitivity(0);
      expect(getState().zoomSensitivity).toBe(0.1);

      getState().setZoomSensitivity(-1);
      expect(getState().zoomSensitivity).toBe(0.1);
    });

    it('clamps to maximum 3', () => {
      getState().setZoomSensitivity(5);
      expect(getState().zoomSensitivity).toBe(3);
    });

    it('allows boundary values', () => {
      getState().setZoomSensitivity(0.1);
      expect(getState().zoomSensitivity).toBe(0.1);

      getState().setZoomSensitivity(3);
      expect(getState().zoomSensitivity).toBe(3);
    });

    it('defaults to 0.3', () => {
      expect(getState().zoomSensitivity).toBe(0.3);
    });

    it('persists to localStorage', () => {
      getState().setZoomSensitivity(2.5);
      flushSettingsSave();
      const stored = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(stored.zoomSensitivity).toBe(2.5);
    });

    it('survives resetToDefaults', () => {
      getState().setZoomSensitivity(2);
      getState().resetToDefaults();
      expect(getState().zoomSensitivity).toBe(DEFAULT_SETTINGS.zoomSensitivity);
    });
  });

  describe('setCameraDamping', () => {
    it('sets camera damping', () => {
      getState().setCameraDamping(0.1);
      expect(getState().cameraDamping).toBe(0.1);
    });

    it('clamps to minimum 0.01', () => {
      getState().setCameraDamping(0);
      expect(getState().cameraDamping).toBe(0.01);

      getState().setCameraDamping(-1);
      expect(getState().cameraDamping).toBe(0.01);
    });

    it('clamps to maximum 0.2', () => {
      getState().setCameraDamping(5);
      expect(getState().cameraDamping).toBe(0.2);
    });

    it('allows boundary values', () => {
      getState().setCameraDamping(0.01);
      expect(getState().cameraDamping).toBe(0.01);

      getState().setCameraDamping(0.2);
      expect(getState().cameraDamping).toBe(0.2);
    });

    it('defaults to 0.06', () => {
      expect(getState().cameraDamping).toBe(0.06);
    });

    it('persists to localStorage', () => {
      getState().setCameraDamping(0.15);
      flushSettingsSave();
      const stored = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(stored.cameraDamping).toBe(0.15);
    });

    it('survives resetToDefaults', () => {
      getState().setCameraDamping(0.1);
      getState().resetToDefaults();
      expect(getState().cameraDamping).toBe(DEFAULT_SETTINGS.cameraDamping);
    });

    it('clampLoadedSettings validates cameraDamping', () => {
      const result = clampLoadedSettings({ cameraDamping: -5 });
      expect(result.cameraDamping).toBe(0.01);

      const result2 = clampLoadedSettings({ cameraDamping: 100 });
      expect(result2.cameraDamping).toBe(0.2);
    });
  });

  describe('setAutoSave', () => {
    it('disables auto-save', () => {
      getState().setAutoSave(false);
      expect(getState().autoSave).toBe(false);
    });

    it('enables auto-save', () => {
      getState().setAutoSave(false);
      getState().setAutoSave(true);
      expect(getState().autoSave).toBe(true);
    });
  });

  describe('addRecentFile', () => {
    it('adds a file to the front of the list', () => {
      getState().addRecentFile('/path/to/file1.json');
      expect(getState().recentFiles).toEqual(['/path/to/file1.json']);
    });

    it('prepends new files', () => {
      getState().addRecentFile('/path/file1.json');
      getState().addRecentFile('/path/file2.json');
      expect(getState().recentFiles).toEqual(['/path/file2.json', '/path/file1.json']);
    });

    it('deduplicates: moves existing file to front', () => {
      getState().addRecentFile('/path/file1.json');
      getState().addRecentFile('/path/file2.json');
      getState().addRecentFile('/path/file1.json');
      expect(getState().recentFiles).toEqual(['/path/file1.json', '/path/file2.json']);
    });

    it('caps at 10 recent files', () => {
      for (let i = 0; i < 15; i++) {
        getState().addRecentFile(`/path/file${i}.json`);
      }
      expect(getState().recentFiles).toHaveLength(10);
      // Most recent should be first
      expect(getState().recentFiles[0]).toBe('/path/file14.json');
    });
  });

  describe('clearRecentFiles', () => {
    it('clears all recent files', () => {
      getState().addRecentFile('/path/file1.json');
      getState().addRecentFile('/path/file2.json');
      getState().clearRecentFiles();
      expect(getState().recentFiles).toEqual([]);
    });
  });

  describe('resetToDefaults', () => {
    it('resets all settings to defaults', () => {
      getState().setGridSnapSize(5);
      getState().setAnimationSpeed(2);
      getState().setUiScale(1.5);
      getState().setTheme('light');
      getState().setMinimapVisible(false);
      getState().setInspectorVisible(false);
      getState().setAutoSave(false);
      getState().addRecentFile('/path/file.json');

      getState().resetToDefaults();

      expect(getState().gridSnapSize).toBe(DEFAULT_SETTINGS.gridSnapSize);
      expect(getState().animationSpeed).toBe(DEFAULT_SETTINGS.animationSpeed);
      expect(getState().uiScale).toBe(DEFAULT_SETTINGS.uiScale);
      expect(getState().theme).toBe(DEFAULT_SETTINGS.theme);
      expect(getState().minimapVisible).toBe(DEFAULT_SETTINGS.minimapVisible);
      expect(getState().inspectorVisible).toBe(DEFAULT_SETTINGS.inspectorVisible);
      expect(getState().autoSave).toBe(DEFAULT_SETTINGS.autoSave);
      expect(getState().recentFiles).toEqual([]);
    });
  });

  describe('persistence', () => {
    it('saves settings to localStorage on change', () => {
      getState().setTheme('light');
      flushSettingsSave();
      const stored = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(stored.theme).toBe('light');
    });

    it('persists all fields', () => {
      getState().setGridSnapSize(2);
      getState().setAnimationSpeed(0.5);
      getState().setUiScale(1.5);
      getState().setTheme('light');
      getState().setMinimapVisible(false);
      getState().setInspectorVisible(false);
      getState().setAutoSave(false);
      getState().addRecentFile('/path/file.json');
      flushSettingsSave();

      const stored = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(stored.gridSnapSize).toBe(2);
      expect(stored.animationSpeed).toBe(0.5);
      expect(stored.uiScale).toBe(1.5);
      expect(stored.theme).toBe('light');
      expect(stored.minimapVisible).toBe(false);
      expect(stored.inspectorVisible).toBe(false);
      expect(stored.autoSave).toBe(false);
      expect(stored.recentFiles).toEqual(['/path/file.json']);
    });

    it('resetToDefaults saves defaults to localStorage', () => {
      getState().setTheme('light');
      getState().resetToDefaults();
      flushSettingsSave();
      const stored = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(stored.theme).toBe('dark');
    });

    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem('settings-v1', 'not-json!!!');
      // Re-reading should not crash — loadSettings returns {} on parse error
      // The store is already initialized, but we can verify it still works
      getState().setTheme('light');
      expect(getState().theme).toBe('light');
    });

    it('handles missing localStorage gracefully', () => {
      localStorage.removeItem('settings-v1');
      // Store continues to work
      getState().setGridSnapSize(3);
      expect(getState().gridSnapSize).toBe(3);
    });
  });

  // --- Toolbar toggle tests ---
  describe('toolbar toggle', () => {
    it('defaults toolbarVisible to true', () => {
      expect(getState().toolbarVisible).toBe(true);
    });

    it('setToolbarVisible sets visibility', () => {
      getState().setToolbarVisible(false);
      expect(getState().toolbarVisible).toBe(false);

      getState().setToolbarVisible(true);
      expect(getState().toolbarVisible).toBe(true);
    });

    it('toggleToolbarVisible toggles visibility', () => {
      expect(getState().toolbarVisible).toBe(true);

      getState().toggleToolbarVisible();
      expect(getState().toolbarVisible).toBe(false);

      getState().toggleToolbarVisible();
      expect(getState().toolbarVisible).toBe(true);
    });

    it('toolbarVisible persists to localStorage', () => {
      getState().toggleToolbarVisible();
      expect(getState().toolbarVisible).toBe(false);

      flushSettingsSave();
      const stored = JSON.parse(localStorage.getItem('settings-v1')!);
      expect(stored.toolbarVisible).toBe(false);
    });

    it('toolbarVisible survives resetToDefaults (resets to default true)', () => {
      getState().setToolbarVisible(false);
      getState().resetToDefaults();
      expect(getState().toolbarVisible).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';

function getSettings() { return useSettingsStore.getState(); }

function resetSettings() {
  useSettingsStore.setState((s) => {
    Object.assign(s, DEFAULT_SETTINGS);
    s.recentFiles = [];
    s.recentlyUsedNodes = [];
    s.keyBindingOverrides = {};
    s.nodePresets = [];
    s.workspacePresets = [];
    s.activeWorkspacePreset = null;
    s.openPanels = [...DEFAULT_SETTINGS.openPanels];
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('panel-defaults', () => {
  beforeEach(() => {
    resetSettings();
  });

  // --- Default panel state ---------------------------------------------------

  describe('default panel state', () => {
    it('default openPanels contains validation', () => {
      expect(getSettings().openPanels).toContain('validation');
    });

    it('default openPanels contains profiling', () => {
      expect(getSettings().openPanels).toContain('profiling');
    });

    it('default minimapVisible is true', () => {
      expect(getSettings().minimapVisible).toBe(true);
    });

    it('default inspectorVisible is true', () => {
      expect(getSettings().inspectorVisible).toBe(true);
    });

    it('openPanels is an array of strings', () => {
      const panels = getSettings().openPanels;
      expect(Array.isArray(panels)).toBe(true);
      for (const p of panels) {
        expect(typeof p).toBe('string');
      }
    });

    it('default has exactly 2 panels open', () => {
      expect(getSettings().openPanels).toHaveLength(2);
    });
  });

  // --- Panel toggle ----------------------------------------------------------

  describe('panel toggle', () => {
    it('setPanelOpen(panelId, true) adds panel to openPanels', () => {
      getSettings().setPanelOpen('debug', true);
      expect(getSettings().openPanels).toContain('debug');
    });

    it('setPanelOpen(panelId, false) removes panel from openPanels', () => {
      // 'validation' is open by default
      getSettings().setPanelOpen('validation', false);
      expect(getSettings().openPanels).not.toContain('validation');
    });

    it('setPanelOpen for already-open panel does not duplicate', () => {
      // 'validation' is already open by default
      getSettings().setPanelOpen('validation', true);
      const count = getSettings().openPanels.filter(p => p === 'validation').length;
      expect(count).toBe(1);
    });

    it('setPanelOpen for already-closed panel is a no-op', () => {
      const before = [...getSettings().openPanels];
      // 'debug' is not open by default — closing it should change nothing
      getSettings().setPanelOpen('debug', false);
      expect(getSettings().openPanels).toEqual(before);
    });
  });

  // --- Reset layout ----------------------------------------------------------

  describe('reset layout', () => {
    it('resetPanelLayout restores default openPanels', () => {
      // Mutate panels away from defaults
      getSettings().setPanelOpen('debug', true);
      getSettings().setPanelOpen('validation', false);
      expect(getSettings().openPanels).not.toEqual(DEFAULT_SETTINGS.openPanels);

      getSettings().resetPanelLayout();
      expect(getSettings().openPanels).toEqual(DEFAULT_SETTINGS.openPanels);
    });

    it('resetPanelLayout restores minimapVisible and inspectorVisible', () => {
      getSettings().setMinimapVisible(false);
      getSettings().setInspectorVisible(false);

      getSettings().resetPanelLayout();
      expect(getSettings().minimapVisible).toBe(DEFAULT_SETTINGS.minimapVisible);
      expect(getSettings().inspectorVisible).toBe(DEFAULT_SETTINGS.inspectorVisible);
    });

    it('resetPanelLayout clears activeWorkspacePreset', () => {
      getSettings().setActiveWorkspacePreset('minimal');
      expect(getSettings().activeWorkspacePreset).toBe('minimal');

      getSettings().resetPanelLayout();
      expect(getSettings().activeWorkspacePreset).toBeNull();
    });
  });

  // --- clampLoadedSettings validation ----------------------------------------

  describe('clampLoadedSettings validation', () => {
    it('non-array openPanels falls back to default', () => {
      const result = clampLoadedSettings({ openPanels: 'not-an-array' });
      expect(result.openPanels).toEqual(DEFAULT_SETTINGS.openPanels);
    });

    it('array with non-string elements falls back to default', () => {
      const result = clampLoadedSettings({ openPanels: [1, 2, 3] });
      expect(result.openPanels).toEqual(DEFAULT_SETTINGS.openPanels);
    });

    it('valid string array is preserved', () => {
      const result = clampLoadedSettings({ openPanels: ['debug', 'timeline'] });
      expect(result.openPanels).toEqual(['debug', 'timeline']);
    });

    it('null openPanels falls back to default', () => {
      const result = clampLoadedSettings({ openPanels: null });
      expect(result.openPanels).toEqual(DEFAULT_SETTINGS.openPanels);
    });

    it('number openPanels falls back to default', () => {
      const result = clampLoadedSettings({ openPanels: 42 });
      expect(result.openPanels).toEqual(DEFAULT_SETTINGS.openPanels);
    });

    it('empty array is preserved as-is', () => {
      const result = clampLoadedSettings({ openPanels: [] });
      expect(result.openPanels).toEqual([]);
    });
  });
});

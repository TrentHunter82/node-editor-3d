/**
 * Phase 20 Feature Tests
 *
 * Tests for Phase 20 features:
 * 1. Onboarding system (settings store integration)
 * 2. Connection flow animation settings (expanded from existing)
 * 3. Key binding overrides persistence
 * 4. Settings clamp validation for new fields
 * 5. Browser compatibility regression (localStorage, pointer events, keyboard)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { enableMapSet } from 'immer';

enableMapSet();

const SETTINGS_KEY = 'settings-v1';

function getSettings() {
  return useSettingsStore.getState();
}

function getEditorState() {
  return useEditorStore.getState();
}

function resetSettings() {
  useSettingsStore.setState((s) => {
    Object.assign(s, DEFAULT_SETTINGS);
    s.cameraBookmarks = {};
    s.recentFiles = [];
    s.recentlyUsedNodes = [];
    s.keyBindingOverrides = {};
    s.onboardingCompleted = false;
  });
  localStorage.clear();
}

function resetEditorStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.contextMenu = null;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.templates = {};
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
  });
}

describe('Onboarding System', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaults', () => {
    it('onboardingCompleted defaults to false', () => {
      expect(getSettings().onboardingCompleted).toBe(false);
    });
  });

  describe('setOnboardingCompleted', () => {
    it('sets onboarding as completed', () => {
      getSettings().setOnboardingCompleted(true);
      expect(getSettings().onboardingCompleted).toBe(true);
    });

    it('can reset onboarding to incomplete', () => {
      getSettings().setOnboardingCompleted(true);
      getSettings().setOnboardingCompleted(false);
      expect(getSettings().onboardingCompleted).toBe(false);
    });

    it('persists to localStorage', () => {
      getSettings().setOnboardingCompleted(true);
      vi.advanceTimersByTime(200);
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
      expect(stored.onboardingCompleted).toBe(true);
    });

    it('persists false to localStorage', () => {
      getSettings().setOnboardingCompleted(true);
      getSettings().setOnboardingCompleted(false);
      vi.advanceTimersByTime(200);
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
      expect(stored.onboardingCompleted).toBe(false);
    });
  });

  describe('resetToDefaults', () => {
    it('resets onboardingCompleted to false', () => {
      getSettings().setOnboardingCompleted(true);
      getSettings().resetToDefaults();
      expect(getSettings().onboardingCompleted).toBe(false);
    });
  });

  describe('clampLoadedSettings', () => {
    it('preserves valid onboardingCompleted boolean', () => {
      const result = clampLoadedSettings({ onboardingCompleted: true });
      expect(result.onboardingCompleted).toBe(true);
    });

    it('rejects non-boolean onboardingCompleted', () => {
      const result = clampLoadedSettings({ onboardingCompleted: 'bad' as unknown as boolean });
      expect(result.onboardingCompleted).toBeUndefined();
    });
  });
});

describe('Connection Flow Animation Settings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaults', () => {
    it('connectionFlowAnimation defaults to true', () => {
      expect(getSettings().connectionFlowAnimation).toBe(true);
    });
  });

  describe('setConnectionFlowAnimation', () => {
    it('disables animation', () => {
      getSettings().setConnectionFlowAnimation(false);
      expect(getSettings().connectionFlowAnimation).toBe(false);
    });

    it('re-enables animation', () => {
      getSettings().setConnectionFlowAnimation(false);
      getSettings().setConnectionFlowAnimation(true);
      expect(getSettings().connectionFlowAnimation).toBe(true);
    });

    it('persists to localStorage', () => {
      getSettings().setConnectionFlowAnimation(false);
      vi.advanceTimersByTime(200);
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
      expect(stored.connectionFlowAnimation).toBe(false);
    });
  });

  describe('resetToDefaults', () => {
    it('resets connectionFlowAnimation to true', () => {
      getSettings().setConnectionFlowAnimation(false);
      getSettings().resetToDefaults();
      expect(getSettings().connectionFlowAnimation).toBe(true);
    });
  });
});

describe('Key Binding Overrides', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaults', () => {
    it('keyBindingOverrides defaults to empty object', () => {
      expect(getSettings().keyBindingOverrides).toEqual({});
    });
  });

  describe('setKeyBinding', () => {
    it('sets a key binding override', () => {
      getSettings().setKeyBinding('undo', 'ctrl+y');
      expect(getSettings().keyBindingOverrides.undo).toBe('ctrl+y');
    });

    it('can override multiple bindings', () => {
      getSettings().setKeyBinding('undo', 'ctrl+y');
      getSettings().setKeyBinding('redo', 'ctrl+shift+y');
      expect(getSettings().keyBindingOverrides).toEqual({
        undo: 'ctrl+y',
        redo: 'ctrl+shift+y',
      });
    });

    it('overwrites existing override', () => {
      getSettings().setKeyBinding('undo', 'ctrl+y');
      getSettings().setKeyBinding('undo', 'ctrl+shift+z');
      expect(getSettings().keyBindingOverrides.undo).toBe('ctrl+shift+z');
    });

    it('persists to localStorage', () => {
      getSettings().setKeyBinding('delete', 'Backspace');
      vi.advanceTimersByTime(200);
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
      expect(stored.keyBindingOverrides.delete).toBe('Backspace');
    });
  });

  describe('resetKeyBinding', () => {
    it('removes a single override', () => {
      getSettings().setKeyBinding('undo', 'ctrl+y');
      getSettings().setKeyBinding('redo', 'ctrl+shift+y');
      getSettings().resetKeyBinding('undo');
      expect(getSettings().keyBindingOverrides).toEqual({ redo: 'ctrl+shift+y' });
    });

    it('no-ops for non-existent override', () => {
      getSettings().resetKeyBinding('nonexistent');
      expect(getSettings().keyBindingOverrides).toEqual({});
    });
  });

  describe('resetAllKeyBindings', () => {
    it('clears all overrides', () => {
      getSettings().setKeyBinding('undo', 'ctrl+y');
      getSettings().setKeyBinding('redo', 'ctrl+shift+y');
      getSettings().setKeyBinding('delete', 'Backspace');
      getSettings().resetAllKeyBindings();
      expect(getSettings().keyBindingOverrides).toEqual({});
    });

    it('persists empty overrides to localStorage', () => {
      getSettings().setKeyBinding('undo', 'ctrl+y');
      getSettings().resetAllKeyBindings();
      vi.advanceTimersByTime(200);
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
      expect(stored.keyBindingOverrides).toEqual({});
    });
  });

  describe('resetToDefaults', () => {
    it('clears key binding overrides', () => {
      getSettings().setKeyBinding('undo', 'ctrl+y');
      getSettings().resetToDefaults();
      expect(getSettings().keyBindingOverrides).toEqual({});
    });
  });

  describe('clampLoadedSettings', () => {
    it('preserves valid keyBindingOverrides', () => {
      const result = clampLoadedSettings({
        keyBindingOverrides: { undo: 'ctrl+y', redo: 'ctrl+shift+y' },
      });
      expect(result.keyBindingOverrides).toEqual({ undo: 'ctrl+y', redo: 'ctrl+shift+y' });
    });

    it('replaces non-object keyBindingOverrides with empty', () => {
      const result = clampLoadedSettings({ keyBindingOverrides: 'bad' as unknown });
      expect(result.keyBindingOverrides).toEqual({});
    });

    it('replaces null keyBindingOverrides with empty', () => {
      const result = clampLoadedSettings({ keyBindingOverrides: null as unknown });
      expect(result.keyBindingOverrides).toEqual({});
    });

    it('replaces array keyBindingOverrides with empty', () => {
      const result = clampLoadedSettings({ keyBindingOverrides: ['bad'] as unknown });
      expect(result.keyBindingOverrides).toEqual({});
    });

    it('removes non-string values from keyBindingOverrides', () => {
      const result = clampLoadedSettings({
        keyBindingOverrides: { undo: 'ctrl+y', bad: 42 as unknown as string },
      });
      expect(result.keyBindingOverrides).toEqual({ undo: 'ctrl+y' });
    });
  });
});

describe('Browser Compatibility Regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    resetEditorStore();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('localStorage persistence', () => {
    it('settings survive JSON roundtrip with all Phase 20 fields', () => {
      getSettings().setOnboardingCompleted(true);
      getSettings().setConnectionFlowAnimation(false);
      getSettings().setKeyBinding('undo', 'ctrl+y');
      vi.advanceTimersByTime(200);

      const stored = localStorage.getItem(SETTINGS_KEY)!;
      const parsed = JSON.parse(stored);

      expect(parsed.onboardingCompleted).toBe(true);
      expect(parsed.connectionFlowAnimation).toBe(false);
      expect(parsed.keyBindingOverrides).toEqual({ undo: 'ctrl+y' });
    });

    it('handles missing fields gracefully via clampLoadedSettings', () => {
      // Simulate loading settings from an older version without new fields
      const oldSettings = { theme: 'dark', gridSnapSize: 2 };
      const clamped = clampLoadedSettings(oldSettings);
      expect(clamped.theme).toBe('dark');
      expect(clamped.gridSnapSize).toBe(2);
      // Missing fields are simply absent (defaults apply)
      expect(clamped.onboardingCompleted).toBeUndefined();
      expect(clamped.connectionFlowAnimation).toBeUndefined();
    });

    it('handles corrupted numeric values in clampLoadedSettings', () => {
      const corrupted = {
        gridSnapSize: -100,
        animationSpeed: 999,
        uiScale: 0.01,
        zoomSensitivity: 50,
        panSpeed: -5,
        rotateSpeed: 100,
      };
      const clamped = clampLoadedSettings(corrupted);
      expect(clamped.gridSnapSize).toBe(0.1);
      expect(clamped.animationSpeed).toBe(3);
      expect(clamped.uiScale).toBe(0.5);
      expect(clamped.zoomSensitivity).toBe(3);
      expect(clamped.panSpeed).toBe(0.1);
      expect(clamped.rotateSpeed).toBe(3);
    });

    it('handles invalid enum values in clampLoadedSettings', () => {
      const corrupted = {
        theme: 'neon',
        connectionStyle: 'diagonal',
      };
      const clamped = clampLoadedSettings(corrupted);
      // Invalid enums are deleted (defaults apply)
      expect(clamped.theme).toBeUndefined();
      expect(clamped.connectionStyle).toBeUndefined();
    });

    it('handles non-string array elements in recentFiles', () => {
      const corrupted = {
        recentFiles: ['/valid.json', 42, null, '/also-valid.json'],
      };
      const clamped = clampLoadedSettings(corrupted);
      // Entire array is replaced if any element is non-string
      expect(clamped.recentFiles).toEqual([]);
    });
  });

  describe('editor store state lifecycle', () => {
    it('addNode and removeNode maintain consistent state', () => {
      const nodeId = getEditorState().addNode('source', [0, 0, 0]);
      expect(getEditorState().nodes[nodeId]).toBeDefined();
      expect(getEditorState().nodes[nodeId].type).toBe('source');

      getEditorState().removeNode(nodeId);
      expect(getEditorState().nodes[nodeId]).toBeUndefined();
    });

    it('undo/redo cycle preserves node state', () => {
      const nodeId = getEditorState().addNode('math', [5, 0, 5]);
      const nodeBeforeUndo = { ...getEditorState().nodes[nodeId] };

      getEditorState().undo();
      expect(getEditorState().nodes[nodeId]).toBeUndefined();

      getEditorState().redo();
      expect(getEditorState().nodes[nodeId]).toBeDefined();
      expect(getEditorState().nodes[nodeId].type).toBe(nodeBeforeUndo.type);
      expect(getEditorState().nodes[nodeId].position).toEqual(nodeBeforeUndo.position);
    });

    it('connection creation validates port types', () => {
      const src = getEditorState().addNode('source', [0, 0, 0]);
      const math = getEditorState().addNode('math', [3, 0, 0]);

      // source output 0 is 'number', math input 0 is 'number' — should work
      const connId = getEditorState().addConnection(src, 0, math, 0);
      expect(connId).toBeTruthy();
    });

    it('execution produces outputs for connected graphs', () => {
      const src = getEditorState().addNode('source', [0, 0, 0]);
      getEditorState().updateNodeData(src, 'value', 42);
      const disp = getEditorState().addNode('display', [3, 0, 0]);
      getEditorState().addConnection(src, 0, disp, 0);

      getEditorState().executeGraph();

      // After execution, nodeOutputs should have entries
      const outputs = getEditorState().nodeOutputs;
      expect(outputs[src]).toBeDefined();
    });
  });

  describe('multi-graph state isolation', () => {
    it('graphs have isolated nodes', () => {
      const nodeInGraph1 = getEditorState().addNode('source', [0, 0, 0]);
      expect(Object.keys(getEditorState().nodes)).toHaveLength(1);

      getEditorState().createGraph('Second Graph');
      expect(Object.keys(getEditorState().nodes)).toHaveLength(0);

      // Switch back
      getEditorState().switchGraph('default');
      expect(Object.keys(getEditorState().nodes)).toHaveLength(1);
      expect(getEditorState().nodes[nodeInGraph1]).toBeDefined();
    });

    it('settings are shared across graphs', () => {
      getSettings().setOnboardingCompleted(true);
      getEditorState().createGraph('Second');
      // Settings should still show onboarding completed
      expect(getSettings().onboardingCompleted).toBe(true);
    });
  });
});

describe('Recently Used Nodes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds nodes to recently used list', () => {
    getSettings().addRecentlyUsedNode('math');
    expect(getSettings().recentlyUsedNodes).toEqual(['math']);
  });

  it('prepends new nodes to front', () => {
    getSettings().addRecentlyUsedNode('math');
    getSettings().addRecentlyUsedNode('source');
    expect(getSettings().recentlyUsedNodes).toEqual(['source', 'math']);
  });

  it('deduplicates by moving to front', () => {
    getSettings().addRecentlyUsedNode('math');
    getSettings().addRecentlyUsedNode('source');
    getSettings().addRecentlyUsedNode('math');
    expect(getSettings().recentlyUsedNodes).toEqual(['math', 'source']);
  });

  it('caps at 8 entries', () => {
    for (let i = 0; i < 12; i++) {
      getSettings().addRecentlyUsedNode(`type-${i}`);
    }
    expect(getSettings().recentlyUsedNodes).toHaveLength(8);
    expect(getSettings().recentlyUsedNodes[0]).toBe('type-11');
  });

  it('persists to localStorage', () => {
    getSettings().addRecentlyUsedNode('math');
    getSettings().addRecentlyUsedNode('source');
    vi.advanceTimersByTime(200);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.recentlyUsedNodes).toEqual(['source', 'math']);
  });

  it('resets on resetToDefaults', () => {
    getSettings().addRecentlyUsedNode('math');
    getSettings().resetToDefaults();
    expect(getSettings().recentlyUsedNodes).toEqual([]);
  });
});

describe('Worker Execution Setting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to false', () => {
    expect(getSettings().workerExecution).toBe(false);
  });

  it('toggles worker execution', () => {
    getSettings().setWorkerExecution(true);
    expect(getSettings().workerExecution).toBe(true);

    getSettings().setWorkerExecution(false);
    expect(getSettings().workerExecution).toBe(false);
  });

  it('persists to localStorage', () => {
    getSettings().setWorkerExecution(true);
    vi.advanceTimersByTime(200);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.workerExecution).toBe(true);
  });
});

describe('Connection Style Setting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to bezier', () => {
    expect(getSettings().connectionStyle).toBe('bezier');
  });

  it('sets to straight', () => {
    getSettings().setConnectionStyle('straight');
    expect(getSettings().connectionStyle).toBe('straight');
  });

  it('sets to right-angle', () => {
    getSettings().setConnectionStyle('right-angle');
    expect(getSettings().connectionStyle).toBe('right-angle');
  });

  it('persists to localStorage', () => {
    getSettings().setConnectionStyle('straight');
    vi.advanceTimersByTime(200);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.connectionStyle).toBe('straight');
  });

  it('resetToDefaults reverts to bezier', () => {
    getSettings().setConnectionStyle('right-angle');
    getSettings().resetToDefaults();
    expect(getSettings().connectionStyle).toBe('bezier');
  });
});

describe('Auto Execute Setting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to false', () => {
    expect(getSettings().autoExecute).toBe(false);
  });

  it('toggles auto execute', () => {
    getSettings().setAutoExecute(true);
    expect(getSettings().autoExecute).toBe(true);
  });

  it('persists to localStorage', () => {
    getSettings().setAutoExecute(true);
    vi.advanceTimersByTime(200);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.autoExecute).toBe(true);
  });
});

describe('Pan and Rotate Speed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.advanceTimersByTime(300);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('panSpeed defaults to 0.8', () => {
    expect(getSettings().panSpeed).toBe(0.8);
  });

  it('rotateSpeed defaults to 0.6', () => {
    expect(getSettings().rotateSpeed).toBe(0.6);
  });

  it('clamps panSpeed to 0.1-3', () => {
    getSettings().setPanSpeed(0);
    expect(getSettings().panSpeed).toBe(0.1);

    getSettings().setPanSpeed(10);
    expect(getSettings().panSpeed).toBe(3);
  });

  it('clamps rotateSpeed to 0.1-3', () => {
    getSettings().setRotateSpeed(0);
    expect(getSettings().rotateSpeed).toBe(0.1);

    getSettings().setRotateSpeed(10);
    expect(getSettings().rotateSpeed).toBe(3);
  });

  it('persists to localStorage', () => {
    getSettings().setPanSpeed(1.5);
    getSettings().setRotateSpeed(2.0);
    vi.advanceTimersByTime(200);
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(stored.panSpeed).toBe(1.5);
    expect(stored.rotateSpeed).toBe(2.0);
  });
});

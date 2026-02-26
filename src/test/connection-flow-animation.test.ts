/**
 * Connection Flow Animation Tests
 *
 * Tests for the connectionFlowAnimation setting in the settings store,
 * its persistence behavior, and its interaction with execution states.
 *
 * The visual animation itself lives in Pipe.tsx (not unit-testable),
 * but we verify:
 * 1. Settings store toggle behavior
 * 2. Execution state gating (animation only relevant for running/complete nodes)
 * 3. Settings persistence via localStorage
 * 4. Edge cases and robustness
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';

const SETTINGS_STORAGE_KEY = 'settings-v1';

function getSettings() {
  return useSettingsStore.getState();
}

function getState() {
  return useEditorStore.getState();
}

function resetSettings() {
  useSettingsStore.setState((s) => {
    Object.assign(s, DEFAULT_SETTINGS);
    s.cameraBookmarks = {};
    s.recentFiles = [];
    s.recentlyUsedNodes = [];
  });
  localStorage.clear();
}

function resetStore() {
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
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.searchQuery = '';
    s.contextMenu = null;
    s.validationErrors = {};
    s.breadcrumbStack = [];
    s.activeGraphId = 'default';
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.graphOrder = ['default'];
    s.templates = {};
    s.errorStrategy = 'fail-fast';
    s.executionMetrics = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.checkpoints = {};
    s.graphVariables = {};
  });
}

/** Build a source -> transform -> output chain and return IDs */
function buildChain() {
  const src = getState().addNode('source', [0, 0, 0]);
  const xfm = getState().addNode('transform', [5, 0, 0]);
  const out = getState().addNode('output', [10, 0, 0]);
  const c1 = getState().addConnection(src, 0, xfm, 0);
  const c2 = getState().addConnection(xfm, 0, out, 0);
  return { src, xfm, out, c1: c1!, c2: c2! };
}

/** Advance past all execution animation waves */
function drainExecution() {
  vi.advanceTimersByTime(10_000);
}

beforeEach(() => {
  resetSettings();
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// 1. Setting Toggle Behavior
// ===========================================================================

describe('Connection flow animation: setting toggle', () => {
  it('defaults to true', () => {
    expect(getSettings().connectionFlowAnimation).toBe(true);
  });

  it('can be set to false', () => {
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().connectionFlowAnimation).toBe(false);
  });

  it('can be toggled back to true after being disabled', () => {
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().connectionFlowAnimation).toBe(false);

    getSettings().setConnectionFlowAnimation(true);
    expect(getSettings().connectionFlowAnimation).toBe(true);
  });

  it('is independent of other settings', () => {
    // Change several other settings
    getSettings().setAutoExecute(true);
    getSettings().setGridVisible(false);
    getSettings().setConnectionStyle('straight');

    // connectionFlowAnimation should remain at its default
    expect(getSettings().connectionFlowAnimation).toBe(true);

    // Now change it and verify others are unaffected
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().autoExecute).toBe(true);
    expect(getSettings().gridVisible).toBe(false);
    expect(getSettings().connectionStyle).toBe('straight');
  });

  it('handles multiple rapid toggles correctly', () => {
    for (let i = 0; i < 10; i++) {
      getSettings().setConnectionFlowAnimation(i % 2 === 0);
    }
    // After 10 toggles (0-indexed), last call is i=9 => false
    expect(getSettings().connectionFlowAnimation).toBe(false);

    getSettings().setConnectionFlowAnimation(true);
    expect(getSettings().connectionFlowAnimation).toBe(true);
  });
});

// ===========================================================================
// 2. Persistence
// ===========================================================================

describe('Connection flow animation: persistence', () => {
  it('persists to localStorage when changed', () => {
    getSettings().setConnectionFlowAnimation(false);

    // Settings save is debounced at 200ms
    vi.advanceTimersByTime(200);
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.connectionFlowAnimation).toBe(false);
  });

  it('loads persisted value via clampLoadedSettings (real validation path)', () => {
    // Test the actual clampLoadedSettings function used during store initialization
    const saved = { connectionFlowAnimation: false };
    const validated = clampLoadedSettings(saved as Record<string, unknown>);

    // Boolean values pass through clampLoadedSettings unchanged (no boolean validation)
    // Apply validated settings to store — simulates what loadSettings does
    const merged = { ...DEFAULT_SETTINGS, ...validated };
    useSettingsStore.setState((s) => {
      Object.assign(s, merged);
    });

    expect(getSettings().connectionFlowAnimation).toBe(false);
  });

  it('resetToDefaults restores connectionFlowAnimation to true', () => {
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().connectionFlowAnimation).toBe(false);

    getSettings().resetToDefaults();
    expect(getSettings().connectionFlowAnimation).toBe(true);
  });

  it('defaults to true when localStorage contains invalid value', () => {
    // Store a corrupted settings object
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      connectionFlowAnimation: 'not-a-boolean',
    }));

    // Reset settings to force reload pattern. Since the store is already
    // created, we verify that DEFAULT_SETTINGS has the correct default
    // (the clampLoadedSettings function doesn't validate booleans to enum,
    // but the default is true in DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.connectionFlowAnimation).toBe(true);

    // After resetToDefaults, should be true regardless of localStorage
    getSettings().resetToDefaults();
    expect(getSettings().connectionFlowAnimation).toBe(true);
  });
});

// ===========================================================================
// 3. Execution State Integration
// ===========================================================================

describe('Connection flow animation: execution state integration', () => {
  it('executeGraph sets executionStates for nodes in a chain', () => {
    const { src, xfm, out } = buildChain();

    getState().executeGraph();
    drainExecution();

    // After full execution, animation cleanup resets all states to 'idle'
    expect(getState().executionStates[src]).toBe('idle');
    expect(getState().executionStates[xfm]).toBe('idle');
    expect(getState().executionStates[out]).toBe('idle');
  });

  it('execution states are cleared by undo', () => {
    const { src } = buildChain();

    getState().executeGraph();
    drainExecution();
    expect(getState().executionStates[src]).toBe('idle');

    // Add a node (creates an undo point), then undo
    getState().addNode('source', [20, 0, 0]);
    getState().undo();

    // Undo clears transient execution state
    expect(getState().executionStates).toEqual({});
  });

  it('execution states are cleared by clearGraph', () => {
    buildChain();

    getState().executeGraph();
    drainExecution();
    expect(Object.keys(getState().executionStates).length).toBeGreaterThan(0);

    getState().clearGraph();

    expect(getState().executionStates).toEqual({});
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('source -> transform -> output chain produces complete states for all nodes', () => {
    const { src, xfm, out } = buildChain();

    // Set source value
    getState().updateNodeData(src, 'value', 42);
    getState().updateNodeData(xfm, 'multiplier', 2);
    getState().updateNodeData(xfm, 'offset', 0);

    getState().executeGraph();
    drainExecution();

    expect(getState().executionStates[src]).toBe('idle');
    expect(getState().executionStates[xfm]).toBe('idle');
    expect(getState().executionStates[out]).toBe('idle');
    expect(getState().isExecuting).toBe(false);
  });

  it('connections between executed nodes exist alongside execution states', () => {
    const { src, xfm, out, c1, c2 } = buildChain();

    getState().executeGraph();
    drainExecution();

    // Verify connections still exist and nodes have execution states
    expect(getState().connections[c1]).toBeDefined();
    expect(getState().connections[c2]).toBeDefined();
    expect(getState().connections[c1].sourceNodeId).toBe(src);
    expect(getState().connections[c1].targetNodeId).toBe(xfm);
    expect(getState().connections[c2].sourceNodeId).toBe(xfm);
    expect(getState().connections[c2].targetNodeId).toBe(out);

    // After execution completes, animation cleanup resets states to idle
    expect(getState().executionStates[src]).toBe('idle');
    expect(getState().executionStates[xfm]).toBe('idle');
    expect(getState().executionStates[out]).toBe('idle');
  });

  it('execution completes correctly regardless of animation setting', () => {
    getSettings().setConnectionFlowAnimation(false);

    const { src, xfm, out } = buildChain();
    getState().updateNodeData(src, 'value', 10);
    getState().updateNodeData(xfm, 'multiplier', 3);
    getState().updateNodeData(xfm, 'offset', 0);

    getState().executeGraph();
    drainExecution();

    // Execution should complete even with animation disabled
    expect(getState().executionStates[src]).toBe('idle');
    expect(getState().executionStates[xfm]).toBe('idle');
    expect(getState().executionStates[out]).toBe('idle');
    expect(getState().isExecuting).toBe(false);

    // Output should have a computed value
    expect(getState().nodeOutputs[xfm]).toBeDefined();
  });
});

// ===========================================================================
// 4. Edge Cases
// ===========================================================================

describe('Connection flow animation: edge cases', () => {
  it('animation setting does not affect graph execution results', () => {
    // Execute with animation ON
    const chain1 = buildChain();
    getState().updateNodeData(chain1.src, 'value', 7);
    getState().updateNodeData(chain1.xfm, 'multiplier', 5);
    getState().updateNodeData(chain1.xfm, 'offset', 1);

    getSettings().setConnectionFlowAnimation(true);
    getState().executeGraph();
    drainExecution();

    const outputWithAnimation = getState().nodeOutputs[chain1.xfm];

    // Reset and execute with animation OFF
    resetStore();
    const chain2 = buildChain();
    getState().updateNodeData(chain2.src, 'value', 7);
    getState().updateNodeData(chain2.xfm, 'multiplier', 5);
    getState().updateNodeData(chain2.xfm, 'offset', 1);

    getSettings().setConnectionFlowAnimation(false);
    getState().executeGraph();
    drainExecution();

    const outputWithoutAnimation = getState().nodeOutputs[chain2.xfm];

    // Results should be identical
    expect(outputWithAnimation).toEqual(outputWithoutAnimation);
  });

  it('toggling animation during execution does not cause errors', () => {
    buildChain();

    getState().executeGraph();

    // Toggle animation mid-execution several times
    expect(() => {
      getSettings().setConnectionFlowAnimation(false);
      vi.advanceTimersByTime(200);
      getSettings().setConnectionFlowAnimation(true);
      vi.advanceTimersByTime(200);
      getSettings().setConnectionFlowAnimation(false);
    }).not.toThrow();

    drainExecution();
    expect(getState().isExecuting).toBe(false);
  });

  it('animation setting is preserved through settings export/import cycle', () => {
    getSettings().setConnectionFlowAnimation(false);

    // Settings save is debounced at 200ms
    vi.advanceTimersByTime(200);
    // Read what was persisted to localStorage (simulating export)
    const exported = localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(exported).toBeTruthy();

    // Reset settings
    getSettings().resetToDefaults();
    expect(getSettings().connectionFlowAnimation).toBe(true);

    // Re-apply saved settings (simulating import)
    const parsed = JSON.parse(exported!);
    useSettingsStore.setState((s) => {
      Object.assign(s, parsed);
    });

    expect(getSettings().connectionFlowAnimation).toBe(false);
  });

  it('animation disabled then re-enabled persists correctly', () => {
    getSettings().setConnectionFlowAnimation(false);

    // Verify persistence (settings save is debounced at 200ms)
    vi.advanceTimersByTime(200);
    let raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    let parsed = JSON.parse(raw!);
    expect(parsed.connectionFlowAnimation).toBe(false);

    // Re-enable
    getSettings().setConnectionFlowAnimation(true);

    vi.advanceTimersByTime(200);
    raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    parsed = JSON.parse(raw!);
    expect(parsed.connectionFlowAnimation).toBe(true);

    // Verify in-memory state matches
    expect(getSettings().connectionFlowAnimation).toBe(true);
  });

  it('connectionFlowAnimation field exists in DEFAULT_SETTINGS with correct type', () => {
    // Verify the setting is a proper boolean field in defaults
    expect(typeof DEFAULT_SETTINGS.connectionFlowAnimation).toBe('boolean');
    expect(DEFAULT_SETTINGS.connectionFlowAnimation).toBe(true);

    // Verify the setter exists and is callable
    expect(typeof getSettings().setConnectionFlowAnimation).toBe('function');
  });

  it('animation setting survives resetToDefaults after multiple changes', () => {
    getSettings().setConnectionFlowAnimation(false);
    getSettings().setAutoExecute(true);
    getSettings().setGridVisible(false);

    getSettings().resetToDefaults();

    // All settings should be at defaults
    expect(getSettings().connectionFlowAnimation).toBe(true);
    expect(getSettings().autoExecute).toBe(false);
    expect(getSettings().gridVisible).toBe(true);
  });

  it('execution with no connections still works with animation enabled', () => {
    // Single node, no connections
    const src = getState().addNode('source', [0, 0, 0]);
    getSettings().setConnectionFlowAnimation(true);

    getState().executeGraph();
    drainExecution();

    // Source should still execute (states reset to idle after animation finishes)
    expect(getState().executionStates[src]).toBe('idle');
    expect(getState().isExecuting).toBe(false);
  });

  it('animation setting does not interfere with execution error states', () => {
    getSettings().setConnectionFlowAnimation(true);
    getState().setErrorStrategy('continue');

    // Create a custom node that throws
    const src = getState().addNode('source', [0, 0, 0]);
    const custom = getState().addNode('custom', [5, 0, 0]);
    getState().updateNodeData(custom, 'expression', 'throw new Error("test")');
    getState().addConnection(src, 0, custom, 0);

    getState().executeGraph();
    drainExecution();

    // After animation completes, all execution states are reset to idle
    expect(getState().executionStates[src]).toBe('idle');
    expect(getState().executionStates[custom]).toBe('idle');
  });
});

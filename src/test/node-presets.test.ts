/**
 * Node Presets Tests
 *
 * Covers the full node preset lifecycle in settingsStore:
 * save, apply, delete, persistence, per-type isolation, undo behavior,
 * and edge cases.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';
import type { NodePreset } from '../store/settingsStore';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'settings-v1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSettings() {
  return useSettingsStore.getState();
}

function getEditor() {
  return useEditorStore.getState();
}

function resetSettings() {
  useSettingsStore.setState((s) => {
    Object.assign(s, DEFAULT_SETTINGS);
    s.nodePresets = [];
    s.cameraBookmarks = {};
    s.recentFiles = [];
    s.recentlyUsedNodes = [];
    s.keyBindingOverrides = {};
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
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.checkpoints = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

function makePresetInput(overrides?: Partial<Omit<NodePreset, 'id'>>): Omit<NodePreset, 'id'> {
  return {
    name: 'Test Preset',
    nodeType: 'source',
    data: { value: 42 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

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

// ===========================================================================
// 1. Save / Apply / Delete Lifecycle
// ===========================================================================

describe('Save / Apply / Delete Lifecycle', () => {
  it('saveNodePreset creates a preset that appears in nodePresets', () => {
    getSettings().saveNodePreset(makePresetInput());

    expect(getSettings().nodePresets).toHaveLength(1);
    const preset = getSettings().nodePresets[0];
    expect(preset.name).toBe('Test Preset');
    expect(preset.nodeType).toBe('source');
    expect(preset.data).toEqual({ value: 42 });
  });

  it('saveNodePreset returns the generated id string', () => {
    const id = getSettings().saveNodePreset(makePresetInput());

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    // Should match the id stored in state
    expect(getSettings().nodePresets[0].id).toBe(id);
  });

  it('applyNodePreset returns the preset object by id', () => {
    const id = getSettings().saveNodePreset(makePresetInput({ name: 'My Preset', data: { x: 10 } }));

    const found = getSettings().applyNodePreset(id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(id);
    expect(found!.name).toBe('My Preset');
    expect(found!.data).toEqual({ x: 10 });
  });

  it('applyNodePreset returns undefined for a non-existent id', () => {
    getSettings().saveNodePreset(makePresetInput());

    const found = getSettings().applyNodePreset('does-not-exist');
    expect(found).toBeUndefined();
  });

  it('deleteNodePreset removes the preset from nodePresets', () => {
    const id = getSettings().saveNodePreset(makePresetInput());
    expect(getSettings().nodePresets).toHaveLength(1);

    getSettings().deleteNodePreset(id);

    expect(getSettings().nodePresets).toHaveLength(0);
    expect(getSettings().applyNodePreset(id)).toBeUndefined();
  });

  it('deleteNodePreset on a non-existent id is a no-op', () => {
    getSettings().saveNodePreset(makePresetInput());
    expect(getSettings().nodePresets).toHaveLength(1);

    // Should not throw and should not remove the existing preset
    getSettings().deleteNodePreset('ghost-id');

    expect(getSettings().nodePresets).toHaveLength(1);
  });

  it('multiple presets can coexist in the list', () => {
    const id1 = getSettings().saveNodePreset(makePresetInput({ name: 'Alpha', nodeType: 'source' }));
    const id2 = getSettings().saveNodePreset(makePresetInput({ name: 'Beta', nodeType: 'transform' }));
    const id3 = getSettings().saveNodePreset(makePresetInput({ name: 'Gamma', nodeType: 'add' }));

    expect(getSettings().nodePresets).toHaveLength(3);
    expect(getSettings().applyNodePreset(id1)!.name).toBe('Alpha');
    expect(getSettings().applyNodePreset(id2)!.name).toBe('Beta');
    expect(getSettings().applyNodePreset(id3)!.name).toBe('Gamma');
  });
});

// ===========================================================================
// 2. Per-Type Isolation & Lookup
// ===========================================================================

describe('Per-Type Isolation & Lookup', () => {
  it('saves presets for different node types; each is retrievable by id', () => {
    const idSource = getSettings().saveNodePreset({ name: 'Source P', nodeType: 'source', data: { value: 1 } });
    const idTransform = getSettings().saveNodePreset({ name: 'Transform P', nodeType: 'transform', data: { multiplier: 3 } });

    const sourcePresets = getSettings().nodePresets.filter(p => p.nodeType === 'source');
    const transformPresets = getSettings().nodePresets.filter(p => p.nodeType === 'transform');

    expect(sourcePresets).toHaveLength(1);
    expect(sourcePresets[0].id).toBe(idSource);
    expect(transformPresets).toHaveLength(1);
    expect(transformPresets[0].id).toBe(idTransform);
  });

  it('multiple presets for the same node type are all stored', () => {
    getSettings().saveNodePreset({ name: 'Preset A', nodeType: 'source', data: { value: 1 } });
    getSettings().saveNodePreset({ name: 'Preset B', nodeType: 'source', data: { value: 2 } });
    getSettings().saveNodePreset({ name: 'Preset C', nodeType: 'source', data: { value: 3 } });

    const sourcePresets = getSettings().nodePresets.filter(p => p.nodeType === 'source');
    expect(sourcePresets).toHaveLength(3);
    const names = sourcePresets.map(p => p.name);
    expect(names).toContain('Preset A');
    expect(names).toContain('Preset B');
    expect(names).toContain('Preset C');
  });

  it('preset data is independent per preset — stored data of one does not affect another', () => {
    const id1 = getSettings().saveNodePreset({ name: 'P1', nodeType: 'source', data: { value: 100 } });
    const id2 = getSettings().saveNodePreset({ name: 'P2', nodeType: 'source', data: { value: 200 } });

    // Apply and verify each preset independently
    const p1 = getSettings().applyNodePreset(id1)!;
    const p2 = getSettings().applyNodePreset(id2)!;

    expect(p1.data.value).toBe(100);
    expect(p2.data.value).toBe(200);
    // Ensure they are distinct objects
    expect(p1).not.toBe(p2);
    expect(p1.data).not.toBe(p2.data);
  });
});

// ===========================================================================
// 3. Persistence in localStorage
// ===========================================================================

describe('Persistence in localStorage', () => {
  it('presets survive a save + reload via clampLoadedSettings', () => {
    // Save a preset (auto-persists via subscriber after debounce)
    const id = getSettings().saveNodePreset({ name: 'Persisted', nodeType: 'source', data: { value: 77 } });
    vi.advanceTimersByTime(200);

    // Simulate a reload by reading localStorage and running through the real validation path
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    const validated = clampLoadedSettings(raw);
    const merged = { ...DEFAULT_SETTINGS, ...validated };

    useSettingsStore.setState((s) => {
      Object.assign(s, merged);
    });

    // Preset should survive the round-trip
    expect(getSettings().nodePresets).toHaveLength(1);
    expect(getSettings().nodePresets[0].id).toBe(id);
    expect(getSettings().nodePresets[0].name).toBe('Persisted');
    expect(getSettings().nodePresets[0].data).toEqual({ value: 77 });
  });

  it('clampLoadedSettings filters out presets missing the name field', () => {
    const raw = {
      nodePresets: [
        { id: 'p1', nodeType: 'source', data: { value: 1 } },       // missing name
        { id: 'p2', name: 'Valid', nodeType: 'source', data: {} },   // valid
      ],
    };

    const validated = clampLoadedSettings(raw as Record<string, unknown>);
    const presets = validated.nodePresets as NodePreset[];

    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe('p2');
    expect(presets[0].name).toBe('Valid');
  });

  it('clampLoadedSettings filters out presets whose data field is not an object', () => {
    // The validator checks: typeof data === 'object' && data !== null
    // Arrays satisfy typeof === 'object' and are not null, so they pass through.
    // Only true primitives (string, number, boolean) and explicit null are rejected.
    const raw = {
      nodePresets: [
        { id: 'a', name: 'String data', nodeType: 'source', data: 'not-an-object' }, // rejected: string
        { id: 'b', name: 'Null data',   nodeType: 'source', data: null },             // rejected: null
        { id: 'c', name: 'Number data', nodeType: 'source', data: 42 },              // rejected: number
        { id: 'd', name: 'Good',        nodeType: 'source', data: {} },              // accepted: object
      ],
    };

    const validated = clampLoadedSettings(raw as Record<string, unknown>);
    const presets = validated.nodePresets as NodePreset[];

    // Only the preset with a proper non-null object data field survives
    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe('d');
  });

  it('clampLoadedSettings filters out presets with null or undefined id/name/nodeType', () => {
    const raw = {
      nodePresets: [
        { id: null,      name: 'A', nodeType: 'source', data: {} },    // null id
        { id: 'x',      name: null, nodeType: 'source', data: {} },    // null name
        { id: 'y',      name: 'B', nodeType: null,      data: {} },    // null nodeType
        { id: 'valid',  name: 'C', nodeType: 'source',  data: {} },    // all good
      ],
    };

    const validated = clampLoadedSettings(raw as Record<string, unknown>);
    const presets = validated.nodePresets as NodePreset[];

    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe('valid');
  });
});

// ===========================================================================
// 4. Undo Behavior on Apply
// ===========================================================================

describe('Undo Behavior on Apply', () => {
  it('calling updateNodeData after getting a preset pushes an undo entry', () => {
    const nodeId = getEditor().addNode('source', [0, 0, 0]);

    // Baseline: verify canUndo is true after addNode (addNode pushes undo)
    expect(getEditor().canUndo()).toBe(true);

    // Update node data (this also pushes undo)
    getEditor().updateNodeData(nodeId, 'value', 99);
    expect(getEditor().nodes[nodeId].data.value).toBe(99);

    // canUndo is still true — there are stacked undo entries
    expect(getEditor().canUndo()).toBe(true);
  });

  it('undo after applying preset data via updateNodeData restores the previous node data value', () => {
    const nodeId = getEditor().addNode('source', [0, 0, 0]);

    // Set an initial value
    getEditor().updateNodeData(nodeId, 'value', 10);
    expect(getEditor().nodes[nodeId].data.value).toBe(10);

    // "Apply preset" by calling updateNodeData with new value
    getEditor().updateNodeData(nodeId, 'value', 55);
    expect(getEditor().nodes[nodeId].data.value).toBe(55);

    // Undo — should revert to the previous value (10)
    getEditor().undo();
    expect(getEditor().nodes[nodeId].data.value).toBe(10);
  });

  it('full workflow: save preset → create node → apply preset data → verify node data', () => {
    // Save a preset
    const presetId = getSettings().saveNodePreset({
      name: 'Source Config',
      nodeType: 'source',
      data: { value: 123 },
    });

    // Create a new node
    const nodeId = getEditor().addNode('source', [0, 0, 0]);
    expect(getEditor().nodes[nodeId]).toBeDefined();

    // Apply preset: look up the preset then write each data field to the node
    const preset = getSettings().applyNodePreset(presetId)!;
    expect(preset).toBeDefined();
    expect(preset.nodeType).toBe('source');

    for (const [key, val] of Object.entries(preset.data)) {
      getEditor().updateNodeData(nodeId, key, val);
    }

    // Verify node data was written
    expect(getEditor().nodes[nodeId].data.value).toBe(123);
  });
});

// ===========================================================================
// 5. Edge Cases
// ===========================================================================

describe('Edge Cases', () => {
  it('saves a preset with an empty data object', () => {
    const id = getSettings().saveNodePreset({ name: 'Empty Data', nodeType: 'source', data: {} });

    const preset = getSettings().applyNodePreset(id)!;
    expect(preset).toBeDefined();
    expect(preset.data).toEqual({});
  });

  it('saves a preset with complex nested data', () => {
    const complexData = {
      vector: { x: 1.5, y: -2.3, z: 0 },
      tags: ['a', 'b', 'c'],
      config: { nested: { deep: true, count: 99 } },
    };

    const id = getSettings().saveNodePreset({
      name: 'Complex',
      nodeType: 'transform',
      data: complexData,
    });

    const preset = getSettings().applyNodePreset(id)!;
    expect(preset.data).toEqual(complexData);
    expect((preset.data.vector as { x: number }).x).toBe(1.5);
    expect((preset.data.tags as string[])[1]).toBe('b');
    expect(((preset.data.config as { nested: { deep: boolean } }).nested).deep).toBe(true);
  });

  it('deleting all presets leaves an empty nodePresets array', () => {
    const id1 = getSettings().saveNodePreset(makePresetInput({ name: 'One' }));
    const id2 = getSettings().saveNodePreset(makePresetInput({ name: 'Two' }));
    const id3 = getSettings().saveNodePreset(makePresetInput({ name: 'Three' }));
    expect(getSettings().nodePresets).toHaveLength(3);

    getSettings().deleteNodePreset(id1);
    getSettings().deleteNodePreset(id2);
    getSettings().deleteNodePreset(id3);

    expect(getSettings().nodePresets).toHaveLength(0);
    expect(getSettings().nodePresets).toEqual([]);
  });
});

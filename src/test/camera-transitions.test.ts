/**
 * Camera transition tests (~15 tests).
 * Tests camera bookmark CRUD, view preset settings, camera state management,
 * and settings persistence via settingsStore.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';
import type { CameraBookmark } from '../store/settingsStore';

function resetSettings() {
  useSettingsStore.setState(s => {
    Object.assign(s, DEFAULT_SETTINGS);
    s.cameraBookmarks = {};
    s.recentFiles = [];
    s.recentlyUsedNodes = [];
  });
  localStorage.clear();
}

function getSettings() {
  return useSettingsStore.getState();
}

beforeEach(() => {
  resetSettings();
});

// ---------------------------------------------------------------------------
// 1. Camera bookmark save/recall (4 tests)
// ---------------------------------------------------------------------------
describe('Camera bookmark save/recall', () => {
  it('setCameraBookmark stores position and target correctly', () => {
    const bookmark: CameraBookmark = { position: [10, 20, 30], target: [1, 2, 3] };
    getSettings().setCameraBookmark(1, bookmark);

    const stored = getSettings().cameraBookmarks['1'];
    expect(stored).toBeDefined();
    expect(stored.position).toEqual([10, 20, 30]);
    expect(stored.target).toEqual([1, 2, 3]);
  });

  it('recalling a stored bookmark returns the exact data', () => {
    const bookmark: CameraBookmark = { position: [3.14, -2.7, 100], target: [0, 5, -5] };
    getSettings().setCameraBookmark(4, bookmark);

    const recalled = getSettings().cameraBookmarks['4'];
    expect(recalled).toEqual(bookmark);
  });

  it('recalling an empty slot returns undefined', () => {
    const recalled = getSettings().cameraBookmarks['3'];
    expect(recalled).toBeUndefined();
  });

  it('multiple bookmarks in different slots are independent', () => {
    const bm1: CameraBookmark = { position: [1, 0, 0], target: [0, 0, 0] };
    const bm2: CameraBookmark = { position: [0, 1, 0], target: [0, 0, 0] };
    const bm3: CameraBookmark = { position: [0, 0, 1], target: [0, 0, 0] };

    getSettings().setCameraBookmark(1, bm1);
    getSettings().setCameraBookmark(5, bm2);
    getSettings().setCameraBookmark(9, bm3);

    expect(getSettings().cameraBookmarks['1']).toEqual(bm1);
    expect(getSettings().cameraBookmarks['5']).toEqual(bm2);
    expect(getSettings().cameraBookmarks['9']).toEqual(bm3);
    expect(Object.keys(getSettings().cameraBookmarks)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Camera bookmark delete/clear (2 tests)
// ---------------------------------------------------------------------------
describe('Camera bookmark delete/clear', () => {
  it('clearCameraBookmark removes the bookmark from that slot', () => {
    getSettings().setCameraBookmark(3, { position: [1, 2, 3], target: [4, 5, 6] });
    expect(getSettings().cameraBookmarks['3']).toBeDefined();

    getSettings().clearCameraBookmark(3);
    expect(getSettings().cameraBookmarks['3']).toBeUndefined();
  });

  it('clearCameraBookmark on an empty slot is a no-op (no error)', () => {
    // Bookmarks start empty; clearing a non-existent slot should not throw
    const before = { ...getSettings().cameraBookmarks };
    getSettings().clearCameraBookmark(7);
    expect(getSettings().cameraBookmarks).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 3. Bookmark slot validation (3 tests)
// ---------------------------------------------------------------------------
describe('Bookmark slot validation', () => {
  it('save to slot 1 (minimum valid slot) works', () => {
    getSettings().setCameraBookmark(1, { position: [1, 1, 1], target: [0, 0, 0] });
    expect(getSettings().cameraBookmarks['1']).toBeDefined();
    expect(getSettings().cameraBookmarks['1'].position).toEqual([1, 1, 1]);
  });

  it('save to slot 9 (maximum valid slot) works', () => {
    getSettings().setCameraBookmark(9, { position: [9, 9, 9], target: [0, 0, 0] });
    expect(getSettings().cameraBookmarks['9']).toBeDefined();
    expect(getSettings().cameraBookmarks['9'].position).toEqual([9, 9, 9]);
  });

  it('slots are stored as string keys in the cameraBookmarks record', () => {
    getSettings().setCameraBookmark(5, { position: [5, 5, 5], target: [0, 0, 0] });

    // The numeric slot 5 is stored under the string key "5"
    const keys = Object.keys(getSettings().cameraBookmarks);
    expect(keys).toEqual(['5']);
    expect(typeof keys[0]).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 4. Bookmark edge cases (3 tests)
// ---------------------------------------------------------------------------
describe('Bookmark edge cases', () => {
  it('overwriting an existing bookmark updates the stored data', () => {
    getSettings().setCameraBookmark(2, { position: [1, 1, 1], target: [0, 0, 0] });
    expect(getSettings().cameraBookmarks['2'].position).toEqual([1, 1, 1]);

    getSettings().setCameraBookmark(2, { position: [99, 88, 77], target: [10, 20, 30] });
    expect(getSettings().cameraBookmarks['2'].position).toEqual([99, 88, 77]);
    expect(getSettings().cameraBookmarks['2'].target).toEqual([10, 20, 30]);
    // Only one entry for slot 2
    expect(Object.keys(getSettings().cameraBookmarks)).toHaveLength(1);
  });

  it('extreme coordinate values are stored correctly', () => {
    const bm: CameraBookmark = {
      position: [1e12, -1e12, Number.MAX_SAFE_INTEGER],
      target: [Number.MIN_SAFE_INTEGER, 1e15, -1e15],
    };
    getSettings().setCameraBookmark(6, bm);

    const stored = getSettings().cameraBookmarks['6'];
    expect(stored.position[0]).toBe(1e12);
    expect(stored.position[1]).toBe(-1e12);
    expect(stored.position[2]).toBe(Number.MAX_SAFE_INTEGER);
    expect(stored.target[0]).toBe(Number.MIN_SAFE_INTEGER);
    expect(stored.target[1]).toBe(1e15);
    expect(stored.target[2]).toBe(-1e15);
  });

  it('same position and target values (camera looking at its own position) are allowed', () => {
    const bm: CameraBookmark = { position: [42, 42, 42], target: [42, 42, 42] };
    getSettings().setCameraBookmark(8, bm);

    const stored = getSettings().cameraBookmarks['8'];
    expect(stored.position).toEqual(stored.target);
    expect(stored.position).toEqual([42, 42, 42]);
  });
});

// ---------------------------------------------------------------------------
// 5. Settings persistence via clampLoadedSettings (3 tests)
// ---------------------------------------------------------------------------
describe('Settings persistence', () => {
  it('clampLoadedSettings handles missing cameraBookmarks by defaulting to empty object', () => {
    // Simulate loaded settings that have no cameraBookmarks field at all
    const loaded = { gridSnapSize: 2, theme: 'dark' };
    const validated = clampLoadedSettings(loaded as Record<string, unknown>);

    // cameraBookmarks is not in the input so it won't appear in output;
    // the store merges with DEFAULT_SETTINGS which provides the empty object.
    // But if someone passes an explicit undefined-like scenario, clampLoadedSettings
    // should not break. The key insight: the field simply won't be in the output,
    // and DEFAULT_SETTINGS.cameraBookmarks = {} fills the gap.
    const merged = { ...DEFAULT_SETTINGS, ...validated };
    expect(merged.cameraBookmarks).toEqual({});
  });

  it('clampLoadedSettings rejects array-typed cameraBookmarks', () => {
    const loaded = {
      cameraBookmarks: [
        { position: [1, 2, 3], target: [4, 5, 6] },
      ],
    };
    const validated = clampLoadedSettings(loaded as Record<string, unknown>);
    expect(validated.cameraBookmarks).toEqual({});
  });

  it('clampLoadedSettings preserves valid camera bookmarks and strips invalid ones', () => {
    const loaded = {
      cameraBookmarks: {
        '1': { position: [10, 20, 30], target: [0, 0, 0] },     // valid
        '4': { position: [1, 2, 3], target: [4, 5, 6] },         // valid
        '5': { position: [1, 2], target: [4, 5, 6] },             // invalid: position has 2 elements
        '6': { position: [1, 2, 3] },                              // invalid: missing target
        '7': 'garbage',                                             // invalid: not an object
      },
    };
    const validated = clampLoadedSettings(loaded as Record<string, unknown>);
    const bm = validated.cameraBookmarks!;

    // Valid bookmarks survive
    expect(bm['1']).toEqual({ position: [10, 20, 30], target: [0, 0, 0] });
    expect(bm['4']).toEqual({ position: [1, 2, 3], target: [4, 5, 6] });

    // Invalid bookmarks were stripped
    expect(bm['5']).toBeUndefined();
    expect(bm['6']).toBeUndefined();
    expect(bm['7']).toBeUndefined();
    expect(Object.keys(bm)).toHaveLength(2);
  });
});

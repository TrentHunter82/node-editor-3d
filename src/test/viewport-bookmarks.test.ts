import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';
import type { CameraBookmark } from '../store/settingsStore';

const STORAGE_KEY = 'settings-v1';

function getSettings() {
  return useSettingsStore.getState();
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

function makeBookmark(px = 1, py = 2, pz = 3, tx = 0, ty = 0, tz = 0): CameraBookmark {
  return { position: [px, py, pz], target: [tx, ty, tz] };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSettings();
  vi.advanceTimersByTime(300);
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Basic save/recall
// ---------------------------------------------------------------------------
describe('Basic save/recall', () => {
  it('starts with empty cameraBookmarks', () => {
    expect(getSettings().cameraBookmarks).toEqual({});
  });

  it('saves a bookmark to slot 1 and stores it', () => {
    const bm = makeBookmark(5, 10, 15, 0, 1, 0);
    getSettings().setCameraBookmark(1, bm);

    expect(getSettings().cameraBookmarks['1']).toEqual(bm);
  });

  it('saves a bookmark to slot 9 and stores it', () => {
    const bm = makeBookmark(9, 9, 9, 1, 1, 1);
    getSettings().setCameraBookmark(9, bm);

    expect(getSettings().cameraBookmarks['9']).toEqual(bm);
  });

  it('recalled bookmark has correct position and target', () => {
    const bm: CameraBookmark = { position: [3.14, -2.7, 100], target: [0, 5, -5] };
    getSettings().setCameraBookmark(4, bm);

    const stored = getSettings().cameraBookmarks['4'];
    expect(stored.position).toEqual([3.14, -2.7, 100]);
    expect(stored.target).toEqual([0, 5, -5]);
  });

  it('saving to the same slot overwrites the previous bookmark', () => {
    getSettings().setCameraBookmark(2, makeBookmark(1, 1, 1));
    getSettings().setCameraBookmark(2, makeBookmark(9, 9, 9));

    const stored = getSettings().cameraBookmarks['2'];
    expect(stored.position).toEqual([9, 9, 9]);
  });
});

// ---------------------------------------------------------------------------
// 2. Slot validation
// ---------------------------------------------------------------------------
describe('Slot validation', () => {
  it('rejects slot 0 (no-op)', () => {
    getSettings().setCameraBookmark(0, makeBookmark());
    expect(getSettings().cameraBookmarks['0']).toBeUndefined();
  });

  it('rejects slot 10 (no-op)', () => {
    getSettings().setCameraBookmark(10, makeBookmark());
    expect(getSettings().cameraBookmarks['10']).toBeUndefined();
  });

  it('rejects negative slot (no-op)', () => {
    getSettings().setCameraBookmark(-1, makeBookmark());
    expect(getSettings().cameraBookmarks['-1']).toBeUndefined();
  });

  it('non-integer slot 3.7 is accepted because guard only checks < 1 and > 9', () => {
    // The implementation only checks `slot < 1 || slot > 9`, so 3.7 passes
    // and is stored under the string key "3.7".
    getSettings().setCameraBookmark(3.7, makeBookmark(7, 7, 7));
    expect(getSettings().cameraBookmarks['3.7']).toEqual(makeBookmark(7, 7, 7));
  });
});

// ---------------------------------------------------------------------------
// 3. Clear bookmark
// ---------------------------------------------------------------------------
describe('Clear bookmark', () => {
  it('clears an existing bookmark', () => {
    getSettings().setCameraBookmark(5, makeBookmark());
    expect(getSettings().cameraBookmarks['5']).toBeDefined();

    getSettings().clearCameraBookmark(5);
    expect(getSettings().cameraBookmarks['5']).toBeUndefined();
  });

  it('clearing a non-existent bookmark is a no-op', () => {
    // Should not throw or alter state
    const before = { ...getSettings().cameraBookmarks };
    getSettings().clearCameraBookmark(7);
    expect(getSettings().cameraBookmarks).toEqual(before);
  });

  it('clear rejects slot 0 (no-op)', () => {
    // Even if somehow a key "0" existed, clearCameraBookmark(0) won't run
    getSettings().clearCameraBookmark(0);
    expect(Object.keys(getSettings().cameraBookmarks)).toHaveLength(0);
  });

  it('clear rejects slot 10 (no-op)', () => {
    getSettings().clearCameraBookmark(10);
    expect(Object.keys(getSettings().cameraBookmarks)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Multiple bookmarks
// ---------------------------------------------------------------------------
describe('Multiple bookmarks', () => {
  it('saves bookmarks to all 9 slots', () => {
    for (let i = 1; i <= 9; i++) {
      getSettings().setCameraBookmark(i, makeBookmark(i, i * 2, i * 3));
    }
    const bm = getSettings().cameraBookmarks;
    expect(Object.keys(bm)).toHaveLength(9);
    for (let i = 1; i <= 9; i++) {
      expect(bm[String(i)].position).toEqual([i, i * 2, i * 3]);
    }
  });

  it('clearing one slot leaves others intact', () => {
    getSettings().setCameraBookmark(1, makeBookmark(1, 0, 0));
    getSettings().setCameraBookmark(2, makeBookmark(2, 0, 0));
    getSettings().setCameraBookmark(3, makeBookmark(3, 0, 0));

    getSettings().clearCameraBookmark(2);

    expect(getSettings().cameraBookmarks['1']).toBeDefined();
    expect(getSettings().cameraBookmarks['2']).toBeUndefined();
    expect(getSettings().cameraBookmarks['3']).toBeDefined();
  });

  it('each slot stores independent position and target', () => {
    const bm1: CameraBookmark = { position: [1, 2, 3], target: [4, 5, 6] };
    const bm2: CameraBookmark = { position: [10, 20, 30], target: [40, 50, 60] };

    getSettings().setCameraBookmark(1, bm1);
    getSettings().setCameraBookmark(2, bm2);

    expect(getSettings().cameraBookmarks['1']).toEqual(bm1);
    expect(getSettings().cameraBookmarks['2']).toEqual(bm2);
    // Mutating one shouldn't affect the other (immer produces new objects)
    expect(getSettings().cameraBookmarks['1'].position).not.toEqual(
      getSettings().cameraBookmarks['2'].position,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Persistence
// ---------------------------------------------------------------------------
describe('Persistence', () => {
  it('bookmark is persisted to localStorage after save', () => {
    const bm = makeBookmark(11, 22, 33, 44, 55, 66);
    getSettings().setCameraBookmark(3, bm);
    vi.advanceTimersByTime(200);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.cameraBookmarks['3']).toEqual(bm);
  });

  it('bookmarks load via clampLoadedSettings (real validation path)', () => {
    // Seed localStorage with valid and invalid bookmarks
    const stored = {
      ...DEFAULT_SETTINGS,
      recentFiles: [],
      recentlyUsedNodes: [],
      cameraBookmarks: {
        '5': { position: [1, 2, 3], target: [4, 5, 6] },
        '7': { position: [10, 20], target: [1, 2, 3] }, // invalid: position only 2 elements
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    // Use the REAL clampLoadedSettings function (exported from settingsStore)
    // to validate the data — same path the store uses on initialization
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    const validated = clampLoadedSettings(raw);
    const merged = { ...DEFAULT_SETTINGS, ...validated };

    // Apply the validated data to the store (simulates store init)
    useSettingsStore.setState((s) => {
      Object.assign(s, merged);
    });

    // Valid bookmark survives
    expect(getSettings().cameraBookmarks['5']).toEqual({
      position: [1, 2, 3],
      target: [4, 5, 6],
    });
    // Invalid bookmark was filtered out by clampLoadedSettings
    expect(getSettings().cameraBookmarks['7']).toBeUndefined();
  });

  it('invalid bookmarks in localStorage are filtered by clampLoadedSettings', () => {
    // Test clampLoadedSettings directly — the real validation function
    const input = {
      cameraBookmarks: {
        '1': { position: [1, 2], target: [4, 5, 6] },       // position only 2 elements
        '2': { position: [1, 2, 3] },                        // missing target
        '3': { position: [1, 2, 3], target: [4, 5, 6] },    // valid
        '4': 'not-an-object',                                 // completely wrong type
      },
    };

    const validated = clampLoadedSettings(input as Record<string, unknown>);
    const bm = validated.cameraBookmarks as Record<string, unknown>;

    // Only slot 3 should survive validation
    expect(Object.keys(bm)).toEqual(['3']);
    expect(bm['3']).toEqual({ position: [1, 2, 3], target: [4, 5, 6] });
  });

  it('empty cameraBookmarks via clampLoadedSettings passes through as empty', () => {
    const validated = clampLoadedSettings({ cameraBookmarks: {} });
    expect(validated.cameraBookmarks).toEqual({});
  });

  it('non-object cameraBookmarks in localStorage is replaced with empty object', () => {
    const validated = clampLoadedSettings({ cameraBookmarks: 'not-an-object' as any });
    expect(validated.cameraBookmarks).toEqual({});
  });

  it('null cameraBookmarks in localStorage is replaced with empty object', () => {
    const validated = clampLoadedSettings({ cameraBookmarks: null as any });
    expect(validated.cameraBookmarks).toEqual({});
  });

  it('array cameraBookmarks in localStorage is replaced with empty object', () => {
    const validated = clampLoadedSettings({ cameraBookmarks: [1, 2, 3] as any });
    expect(validated.cameraBookmarks).toEqual({});
  });

  it('resetToDefaults clears all bookmarks', () => {
    getSettings().setCameraBookmark(1, makeBookmark(1, 1, 1));
    getSettings().setCameraBookmark(5, makeBookmark(5, 5, 5));
    getSettings().setCameraBookmark(9, makeBookmark(9, 9, 9));
    expect(Object.keys(getSettings().cameraBookmarks).length).toBe(3);

    getSettings().resetToDefaults();

    // DEFAULT_SETTINGS.cameraBookmarks is {}, so resetToDefaults clears them
    expect(getSettings().cameraBookmarks).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------
describe('Edge cases', () => {
  it('bookmark with negative coordinates works', () => {
    const bm: CameraBookmark = { position: [-100, -200, -300], target: [-1, -2, -3] };
    getSettings().setCameraBookmark(1, bm);
    expect(getSettings().cameraBookmarks['1']).toEqual(bm);
  });

  it('bookmark with zero coordinates works', () => {
    const bm: CameraBookmark = { position: [0, 0, 0], target: [0, 0, 0] };
    getSettings().setCameraBookmark(2, bm);
    expect(getSettings().cameraBookmarks['2']).toEqual(bm);
  });

  it('bookmark with very large coordinates works', () => {
    const bm: CameraBookmark = {
      position: [1e12, -1e12, Number.MAX_SAFE_INTEGER],
      target: [1e15, 0, -1e15],
    };
    getSettings().setCameraBookmark(8, bm);
    expect(getSettings().cameraBookmarks['8']).toEqual(bm);
  });

  it('bookmark where position and target are the same point', () => {
    const bm: CameraBookmark = { position: [5, 5, 5], target: [5, 5, 5] };
    getSettings().setCameraBookmark(6, bm);
    const stored = getSettings().cameraBookmarks['6'];
    expect(stored.position).toEqual(stored.target);
    expect(stored.position).toEqual([5, 5, 5]);
  });
});

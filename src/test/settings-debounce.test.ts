/**
 * Settings store debounce tests (~10 tests).
 * Verifies settings save is debounced to 200ms, rapid changes coalesce,
 * and final values persist correctly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settingsStore';

const STORAGE_KEY = 'settings-v1';

function getState() {
  return useSettingsStore.getState();
}

function resetStore() {
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, recentFiles: [] });
  localStorage.clear();
}

function getSaved(): Record<string, unknown> | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw);
}

describe('Settings Store Debounce', () => {
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

  // ── Group 1: Debounce timing ─────────────────────────────────────────

  it('does not write to localStorage before the 200ms debounce window', () => {
    getState().setGridSnapSize(5);
    vi.advanceTimersByTime(50);

    expect(getSaved()).toBeNull();
  });

  it('writes to localStorage after the 200ms debounce window elapses', () => {
    getState().setGridSnapSize(5);
    vi.advanceTimersByTime(200);

    const saved = getSaved();
    expect(saved).not.toBeNull();
    expect(saved!.gridSnapSize).toBe(5);
  });

  it('coalesces multiple rapid changes into a single localStorage write', () => {
    // Track writes by wrapping localStorage.setItem
    let writeCount = 0;
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key: string, value: string) => {
      if (key === STORAGE_KEY) writeCount++;
      origSetItem(key, value);
    };

    getState().setGridSnapSize(2);
    vi.advanceTimersByTime(50);
    getState().setGridSnapSize(4);
    vi.advanceTimersByTime(50);
    getState().setGridSnapSize(8);
    vi.advanceTimersByTime(200);

    // All three changes coalesced into a single write
    expect(writeCount).toBe(1);

    const saved = getSaved();
    expect(saved!.gridSnapSize).toBe(8);

    // Restore original
    localStorage.setItem = origSetItem;
  });

  it('resets the debounce timer when a second change arrives within the window', () => {
    // Change at t=0
    getState().setGridSnapSize(3);

    // At t=150ms — still within the 200ms window — no save yet
    vi.advanceTimersByTime(150);
    expect(getSaved()).toBeNull();

    // Second change at t=150ms resets the timer
    getState().setGridSnapSize(7);

    // At t=300ms (150ms after second change) — still within the reset window
    vi.advanceTimersByTime(150);
    expect(getSaved()).toBeNull();

    // At t=350ms (200ms after second change) — should now be saved
    vi.advanceTimersByTime(50);
    const saved = getSaved();
    expect(saved).not.toBeNull();
    expect(saved!.gridSnapSize).toBe(7);
  });

  // ── Group 2: Persistence correctness ─────────────────────────────────

  it('persists the correct final values, not intermediate ones', () => {
    getState().setTheme('light');
    vi.advanceTimersByTime(50);
    getState().setTheme('dark');
    vi.advanceTimersByTime(50);
    getState().setTheme('light');
    vi.advanceTimersByTime(200);

    const saved = getSaved();
    expect(saved).not.toBeNull();
    expect(saved!.theme).toBe('light');
  });

  it('persists all settings fields after debounce', () => {
    getState().setGridSnapSize(3);
    getState().setTheme('light');
    getState().setMinimapVisible(false);
    getState().setAutoExecute(true);
    getState().setConnectionStyle('straight');
    getState().setUiScale(1.5);
    vi.advanceTimersByTime(200);

    const saved = getSaved();
    expect(saved).not.toBeNull();
    expect(saved!.gridSnapSize).toBe(3);
    expect(saved!.theme).toBe('light');
    expect(saved!.minimapVisible).toBe(false);
    expect(saved!.autoExecute).toBe(true);
    expect(saved!.connectionStyle).toBe('straight');
    expect(saved!.uiScale).toBe(1.5);
    // Fields that were not changed should still be present with defaults
    expect(saved!.gridVisible).toBe(DEFAULT_SETTINGS.gridVisible);
    expect(saved!.animationSpeed).toBe(DEFAULT_SETTINGS.animationSpeed);
  });

  it('settings survive a simulated page reload (write + read back)', () => {
    getState().setGridSnapSize(7);
    getState().setTheme('light');
    getState().setMinimapVisible(false);
    vi.advanceTimersByTime(200);

    // Verify saved
    const saved = getSaved();
    expect(saved).not.toBeNull();

    // Simulate reload: reset store then re-load from localStorage
    // The store's loadSettings() reads from localStorage on creation,
    // but since the module is already loaded we simulate by reading raw.
    const raw = localStorage.getItem(STORAGE_KEY)!;
    const persisted = JSON.parse(raw);

    expect(persisted.gridSnapSize).toBe(7);
    expect(persisted.theme).toBe('light');
    expect(persisted.minimapVisible).toBe(false);
  });

  // ── Group 3: Edge cases ──────────────────────────────────────────────

  it('silently handles localStorage errors without throwing', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    // This should not throw — saveSettings has try/catch
    getState().setGridSnapSize(42);
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();

    spy.mockRestore();
  });

  it('rapid toggle (on/off/on) persists the correct final state', () => {
    getState().setAutoExecute(true);
    vi.advanceTimersByTime(30);
    getState().setAutoExecute(false);
    vi.advanceTimersByTime(30);
    getState().setAutoExecute(true);
    vi.advanceTimersByTime(200);

    const saved = getSaved();
    expect(saved).not.toBeNull();
    expect(saved!.autoExecute).toBe(true);

    // Zustand state should also match
    expect(getState().autoExecute).toBe(true);
  });

  it('persists correctly when multiple different settings change in rapid succession', () => {
    getState().setGridSnapSize(5);
    vi.advanceTimersByTime(10);
    getState().setTheme('light');
    vi.advanceTimersByTime(10);
    getState().setZoomSensitivity(1.5);
    vi.advanceTimersByTime(10);
    getState().setConnectionStyle('organic');
    vi.advanceTimersByTime(10);
    getState().setPanSpeed(2.0);
    vi.advanceTimersByTime(200);

    const saved = getSaved();
    expect(saved).not.toBeNull();
    expect(saved!.gridSnapSize).toBe(5);
    expect(saved!.theme).toBe('light');
    expect(saved!.zoomSensitivity).toBe(1.5);
    expect(saved!.connectionStyle).toBe('organic');
    expect(saved!.panSpeed).toBe(2.0);
  });
});

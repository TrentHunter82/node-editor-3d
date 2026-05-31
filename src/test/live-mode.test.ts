import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, clampLoadedSettings, DEFAULT_SETTINGS } from '../store/settingsStore';

describe('Live Mode settings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      liveMode: DEFAULT_SETTINGS.liveMode,
      liveIntervalMs: DEFAULT_SETTINGS.liveIntervalMs,
    });
  });

  it('defaults to off with a 1s interval', () => {
    expect(DEFAULT_SETTINGS.liveMode).toBe(false);
    expect(DEFAULT_SETTINGS.liveIntervalMs).toBe(1000);
  });

  it('setLiveMode toggles the flag', () => {
    useSettingsStore.getState().setLiveMode(true);
    expect(useSettingsStore.getState().liveMode).toBe(true);
    useSettingsStore.getState().setLiveMode(false);
    expect(useSettingsStore.getState().liveMode).toBe(false);
  });

  it('setLiveIntervalMs sets a valid value', () => {
    useSettingsStore.getState().setLiveIntervalMs(2500);
    expect(useSettingsStore.getState().liveIntervalMs).toBe(2500);
  });

  it('setLiveIntervalMs clamps to the [100, 60000] range', () => {
    useSettingsStore.getState().setLiveIntervalMs(10);
    expect(useSettingsStore.getState().liveIntervalMs).toBe(100);
    useSettingsStore.getState().setLiveIntervalMs(999999);
    expect(useSettingsStore.getState().liveIntervalMs).toBe(60000);
  });

  it('clampLoadedSettings clamps a persisted out-of-range interval', () => {
    expect(clampLoadedSettings({ liveIntervalMs: 0 }).liveIntervalMs).toBe(100);
    expect(clampLoadedSettings({ liveIntervalMs: 120000 }).liveIntervalMs).toBe(60000);
    expect(clampLoadedSettings({ liveIntervalMs: 1500 }).liveIntervalMs).toBe(1500);
  });

  it('clampLoadedSettings rejects a non-boolean liveMode from corrupt storage', () => {
    // Corrupt value should be dropped (falls back to default on load)
    expect('liveMode' in clampLoadedSettings({ liveMode: 'yes' as unknown as boolean })).toBe(false);
    // Valid boolean is preserved
    expect(clampLoadedSettings({ liveMode: true }).liveMode).toBe(true);
  });
});

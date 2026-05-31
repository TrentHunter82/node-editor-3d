import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Drives Live Mode. While enabled, re-executes the graph every `liveIntervalMs`,
 * skipping any tick where a previous execution is still running (so runs never
 * pile up). This is what makes `timer` / `http-fetch` nodes update on their own —
 * the basis for live dashboards and generative animation. Outside Live Mode the
 * graph only runs on a manual Run or debounced auto-execute on edit.
 */
export function useLiveExecution(): void {
  const liveMode = useSettingsStore(s => s.liveMode);
  const liveIntervalMs = useSettingsStore(s => s.liveIntervalMs);

  useEffect(() => {
    if (!liveMode) return;
    const id = setInterval(() => {
      const state = useEditorStore.getState();
      if (state.isExecuting) return; // don't queue a run on top of one in flight
      state.executeGraph();
    }, liveIntervalMs);
    return () => clearInterval(id);
  }, [liveMode, liveIntervalMs]);
}

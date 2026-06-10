import { useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { setExecutionBackend, MockExecutionBackend } from '../utils/remoteExecution';
import { ComfyUIBackend } from '../utils/comfyBackend';

/**
 * Applies the Settings → Remote Execution choice to the active
 * ExecutionBackend: the in-process demo mock, or a ComfyUI server.
 */
export function useRemoteBackendConfig(): void {
  const remoteBackend = useSettingsStore(s => s.remoteBackend);
  const comfyUrl = useSettingsStore(s => s.comfyUrl);

  useEffect(() => {
    if (remoteBackend === 'comfyui' && comfyUrl.trim()) {
      setExecutionBackend(new ComfyUIBackend({ baseUrl: comfyUrl.trim() }));
    } else {
      setExecutionBackend(new MockExecutionBackend({ id: 'mock-demo', latencyMs: 250, steps: 6 }));
    }
  }, [remoteBackend, comfyUrl]);
}

import { useEffect } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import { setExecutionBackend, setMaxConcurrentRemote, MockExecutionBackend } from '../utils/remoteExecution';
import { ComfyUIBackend } from '../utils/comfyBackend';

/**
 * Applies the Settings → Remote Execution choices to the remote-execution
 * layer: the active ExecutionBackend (demo mock or ComfyUI server) and the
 * job queue's concurrency cap.
 */
export function useRemoteBackendConfig(): void {
  const remoteBackend = useSettingsStore(s => s.remoteBackend);
  const comfyUrl = useSettingsStore(s => s.comfyUrl);
  const remoteMaxConcurrent = useSettingsStore(s => s.remoteMaxConcurrent);

  useEffect(() => {
    if (remoteBackend === 'comfyui' && comfyUrl.trim()) {
      setExecutionBackend(new ComfyUIBackend({ baseUrl: comfyUrl.trim() }));
    } else {
      setExecutionBackend(new MockExecutionBackend({ id: 'mock-demo', latencyMs: 250, steps: 6 }));
    }
  }, [remoteBackend, comfyUrl]);

  useEffect(() => {
    setMaxConcurrentRemote(remoteMaxConcurrent);
  }, [remoteMaxConcurrent]);
}

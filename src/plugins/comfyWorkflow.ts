/**
 * ComfyUI workflow node — runs an API-format ComfyUI workflow on the server
 * configured in Settings → Remote Execution, via the remote-execution seam.
 *
 * Usage: in ComfyUI, enable dev mode and use "Save (API format)"; paste the
 * resulting JSON into this node's Workflow field. Bind graph values with
 * tokens: %prompt% (input 0), %seed% (input 1, random when unwired), or
 * %inN% for any input index.
 *
 * Outputs: 0 = first generated image URL, 1 = all image URLs, 2 = status,
 * 3 = error. Image URLs point at the server's /view endpoint, so anything
 * downstream (display, image previews) can use them directly.
 */
import { registerPlugin, isPluginType } from '../store/pluginStore';
import { registerRemoteNodeType, remoteCachedResult } from '../utils/remoteExecution';
import type { PluginNodeDef } from '../types';

export const COMFY_WORKFLOW_TYPE = 'comfy-workflow';

const comfyWorkflowDef: PluginNodeDef = {
  type: COMFY_WORKFLOW_TYPE,
  name: 'ComfyUI Workflow',
  color: 'coral',
  category: 'Remote',
  inputs: [
    { label: 'prompt', portType: 'string', description: 'Substituted for %prompt% in the workflow', defaultValue: '' },
    { label: 'seed', portType: 'number', description: 'Substituted for %seed%; random per run when unwired', defaultValue: 0 },
  ],
  outputs: [
    { label: 'image', portType: 'image', description: 'URL of the first generated image' },
    { label: 'images', portType: 'array', description: 'URLs of all generated images' },
    { label: 'status', portType: 'string', description: 'idle | ok | error' },
    { label: 'error', portType: 'string', description: 'Error message if the job failed' },
  ],
  screenFields: [
    { key: 'workflow', label: 'Workflow (API JSON)', type: 'textarea' },
  ],
  // Synchronous processor surfaces the cached remote result; the real work
  // happens in dispatchRemoteNode → ComfyUIBackend.
  processor: (node) => {
    const r = remoteCachedResult(node);
    const payload = r[0] as Record<number, unknown> | null;
    return {
      0: payload?.[0] ?? null,
      1: payload?.[1] ?? [],
      2: r[1],
      3: r[2],
    };
  },
};

/** Register the ComfyUI workflow node (idempotent). */
export function registerComfyWorkflowPlugin(): void {
  if (!isPluginType(COMFY_WORKFLOW_TYPE)) {
    registerPlugin(comfyWorkflowDef);
  }
  registerRemoteNodeType(COMFY_WORKFLOW_TYPE);
}

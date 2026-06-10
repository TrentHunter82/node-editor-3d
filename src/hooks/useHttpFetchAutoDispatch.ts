import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';

/**
 * Auto-dispatches http-fetch nodes when their resolved url/trigger inputs
 * change. This is the missing "when does the fetch actually fire" half of the
 * http-fetch design: the processor only reads cached results from node.data;
 * `fetchNodeData` performs the real fetch — and previously had no caller, so
 * http-fetch nodes never fetched at all.
 *
 * Mirrors useRemoteAutoDispatch (edge-triggered on the input signature) with
 * fetch-specific rules:
 *  - URL must be a non-empty string.
 *  - If the trigger port is wired, it must be truthy.
 *  - Per-node cooldown (1s) so a timer wired into `trigger` refreshes at a
 *    sane rate instead of re-fetching on every graph execution (each run
 *    changes the timer's output, which would otherwise re-trigger a fetch
 *    whose completion re-runs the graph — an unbounded fetch loop).
 */
const FETCH_COOLDOWN_MS = 1000;

export function useHttpFetchAutoDispatch(): void {
  useEffect(() => {
    const sigs = new Map<string, string>();
    const lastDispatch = new Map<string, number>();
    let primed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scan = () => {
      const state = useEditorStore.getState();
      for (const node of Object.values(state.nodes)) {
        if (node.type !== 'http-fetch') continue;

        let url: unknown;
        let trigger: unknown;
        let triggerWired = false;
        for (const c of Object.values(state.connections)) {
          if (c.targetNodeId !== node.id) continue;
          const value = state.nodeOutputs[c.sourceNodeId]?.[c.sourcePortIndex];
          if (c.targetPortIndex === 0) url = value;
          if (c.targetPortIndex === 1) { trigger = value; triggerWired = true; }
        }

        let sig: string;
        try { sig = JSON.stringify({ url, trigger }); }
        catch { sig = 'unserializable'; }

        const prev = sigs.get(node.id);
        sigs.set(node.id, sig);

        if (!primed) continue;                       // skip the initial load batch
        if (sig === prev) continue;                  // inputs unchanged
        if (typeof url !== 'string' || !url) continue;
        if (triggerWired && !trigger) continue;      // wired trigger must be truthy
        const last = lastDispatch.get(node.id) ?? 0;
        const now = Date.now();
        if (now - last < FETCH_COOLDOWN_MS) continue;
        lastDispatch.set(node.id, now);
        state.fetchNodeData(node.id, url);
      }
      primed = true;
    };

    scan(); // prime signatures from the current graph (no dispatch)

    const unsub = useEditorStore.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(scan, 50);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);
}

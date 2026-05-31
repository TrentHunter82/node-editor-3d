/**
 * Shared helpers for the node on-screen UI (accent colors + inline-edit store
 * writes). Extracted from NodeScreen.tsx so the component file only exports
 * components (react-refresh/only-export-components).
 */
import { useEditorStore } from '../../store/editorStore';

// --- Accent color map ---

export const ACCENT_HEX: Record<string, string> = {
  teal: '#2EC4B6',
  orange: '#FF6B35',
  coral: '#E8453C',
  'teal-coral': '#E8453C',
};

/** Convert hex color to rgba string */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Push a single undo snapshot on focus, then update store directly
 * (without undo) on each change. This batches an entire edit session
 * into one undo step.
 */
export function pushUndoOnFocus() {
  useEditorStore.getState().pushUndoSnapshot();
}

/** Update node data without pushing undo (for mid-edit changes) */
export function setDataDirect(nodeId: string, key: string, value: unknown) {
  useEditorStore.setState(s => {
    if (s.nodes[nodeId] && !s.nodes[nodeId].locked) {
      s.nodes[nodeId].data[key] = value;
    }
  });
}

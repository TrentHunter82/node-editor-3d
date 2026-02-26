/**
 * Centralized keyboard shortcut definitions.
 * Used by both useKeyboardShortcuts (runtime) and SettingsPanel (UI).
 */

export interface ShortcutDef {
  /** Unique action identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Default key combo string (e.g., 'ctrl+z', 'shift+d', 'f') */
  defaultKey: string;
  /** Category for grouping in UI */
  category: 'Selection' | 'Navigation' | 'Editing' | 'Panels' | 'Execution' | 'Camera';
  /** Whether this shortcut works inside text inputs */
  worksInInput?: boolean;
}

/**
 * All keyboard shortcut definitions with their default bindings.
 * The `id` is used as the key in keyBindingOverrides.
 */
export const SHORTCUT_DEFS: ShortcutDef[] = [
  // Panels (work in inputs)
  { id: 'search', label: 'Search / Command Palette', defaultKey: 'ctrl+k', category: 'Panels', worksInInput: true },
  { id: 'find-replace', label: 'Find & Replace', defaultKey: 'ctrl+h', category: 'Panels', worksInInput: true },
  { id: 'validation', label: 'Validation Panel', defaultKey: 'ctrl+shift+m', category: 'Panels', worksInInput: true },
  { id: 'settings', label: 'Settings', defaultKey: 'ctrl+,', category: 'Panels', worksInInput: true },
  { id: 'debug-panel', label: 'Debug Panel', defaultKey: 'ctrl+shift+d', category: 'Panels', worksInInput: true },

  // Execution (work in inputs)
  { id: 'execute-selection', label: 'Execute Selection', defaultKey: 'ctrl+shift+e', category: 'Execution', worksInInput: true },
  { id: 'debug-step', label: 'Debug Step', defaultKey: 'F10', category: 'Execution', worksInInput: true },
  { id: 'debug-resume', label: 'Debug Resume', defaultKey: 'F5', category: 'Execution', worksInInput: true },
  { id: 'toggle-breakpoint', label: 'Toggle Breakpoint', defaultKey: 'F9', category: 'Execution' },

  // Selection
  { id: 'escape', label: 'Cancel / Deselect', defaultKey: 'Escape', category: 'Selection' },
  { id: 'select-all', label: 'Select All', defaultKey: 'ctrl+a', category: 'Selection' },
  { id: 'cycle-next', label: 'Cycle Next Node / Port', defaultKey: 'Tab', category: 'Selection' },
  { id: 'cycle-prev', label: 'Cycle Previous Node / Port', defaultKey: 'shift+Tab', category: 'Selection' },
  { id: 'port-connect', label: 'Start / Complete Port Connection', defaultKey: 'Enter', category: 'Selection' },
  { id: 'select-upstream', label: 'Select Upstream', defaultKey: 'shift+u', category: 'Selection' },
  { id: 'select-downstream', label: 'Select Downstream', defaultKey: 'shift+d', category: 'Selection' },
  { id: 'select-both', label: 'Select Connected', defaultKey: 'shift+b', category: 'Selection' },

  // Editing
  { id: 'delete', label: 'Delete Selected', defaultKey: 'Delete', category: 'Editing' },
  { id: 'undo', label: 'Undo', defaultKey: 'ctrl+z', category: 'Editing' },
  { id: 'redo', label: 'Redo', defaultKey: 'ctrl+shift+z', category: 'Editing' },
  { id: 'copy', label: 'Copy', defaultKey: 'ctrl+c', category: 'Editing' },
  { id: 'paste', label: 'Paste', defaultKey: 'ctrl+v', category: 'Editing' },
  { id: 'duplicate', label: 'Duplicate', defaultKey: 'ctrl+d', category: 'Editing' },
  { id: 'group', label: 'Group Selected', defaultKey: 'ctrl+g', category: 'Editing' },
  { id: 'ungroup', label: 'Ungroup', defaultKey: 'ctrl+shift+g', category: 'Editing' },
  { id: 'clear-graph', label: 'Clear Graph', defaultKey: 'ctrl+shift+Delete', category: 'Editing' },
  { id: 'toggle-snap', label: 'Toggle Snap', defaultKey: 'g', category: 'Editing' },
  { id: 'toggle-grid', label: 'Toggle Grid', defaultKey: 'shift+g', category: 'Editing' },
  { id: 'toggle-collapse', label: 'Toggle Collapse', defaultKey: 'h', category: 'Editing' },
  { id: 'toggle-lock', label: 'Toggle Lock', defaultKey: 'shift+l', category: 'Editing' },
  { id: 'auto-layout', label: 'Auto Layout', defaultKey: 'l', category: 'Editing' },
  { id: 'add-note', label: 'Add Note', defaultKey: 'n', category: 'Editing' },
  { id: 'toggle-values', label: 'Toggle Value Previews', defaultKey: 'v', category: 'Editing' },
  { id: 'toggle-error-strategy', label: 'Toggle Error Strategy', defaultKey: 'shift+e', category: 'Editing' },
  { id: 'align-h', label: 'Align Horizontal', defaultKey: 'ctrl+shift+h', category: 'Editing' },
  { id: 'align-v', label: 'Align Vertical', defaultKey: 'ctrl+shift+v', category: 'Editing' },

  // Navigation
  { id: 'zoom-fit', label: 'Zoom to Fit', defaultKey: 'f', category: 'Navigation' },
  { id: 'reset-camera', label: 'Reset Camera', defaultKey: 'ctrl+0', category: 'Camera' },
  { id: 'zoom-in', label: 'Zoom In', defaultKey: '+', category: 'Camera' },
  { id: 'zoom-out', label: 'Zoom Out', defaultKey: '-', category: 'Camera' },
  { id: 'enter-subgraph', label: 'Enter Subgraph', defaultKey: 'Enter', category: 'Navigation' },
  { id: 'new-graph', label: 'New Graph Tab', defaultKey: 'ctrl+t', category: 'Navigation' },
  { id: 'close-graph', label: 'Close Graph Tab', defaultKey: 'ctrl+w', category: 'Navigation' },

  // Panels (non-input)
  { id: 'toggle-profiling', label: 'Toggle Profiling', defaultKey: 'shift+p', category: 'Panels' },
  { id: 'toggle-minimap', label: 'Toggle Minimap', defaultKey: 'shift+m', category: 'Panels' },
  { id: 'toggle-inspector', label: 'Toggle Inspector', defaultKey: 'shift+i', category: 'Panels' },
  { id: 'toggle-overview', label: 'Toggle Overview Mode', defaultKey: 'shift+o', category: 'Navigation' },
  { id: 'toggle-toolbar', label: 'Toggle Toolbar', defaultKey: 't', category: 'Panels' },
];

/** Map from action ID → default key combo */
export const DEFAULT_KEYBINDINGS: Record<string, string> = {};
for (const def of SHORTCUT_DEFS) {
  DEFAULT_KEYBINDINGS[def.id] = def.defaultKey;
}

/**
 * Parse a key combo string into its components.
 * e.g., 'ctrl+shift+z' → { key: 'z', ctrl: true, shift: true, alt: false, meta: false }
 */
export function parseKeyCombo(combo: string): {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
} {
  // Special-case: '+' or '-' as standalone key (not a modifier separator)
  if (combo === '+') return { key: '+', ctrl: false, shift: false, alt: false };
  if (combo === '-') return { key: '-', ctrl: false, shift: false, alt: false };
  const parts = combo.toLowerCase().split('+');
  const ctrl = parts.includes('ctrl') || parts.includes('meta') || parts.includes('cmd');
  const shift = parts.includes('shift');
  const alt = parts.includes('alt');
  // The key is the last part that's not a modifier
  const key = parts.filter(p => !['ctrl', 'meta', 'cmd', 'shift', 'alt'].includes(p)).pop() ?? '';
  return { key, ctrl, shift, alt };
}

/**
 * Check if a keyboard event matches a key combo string.
 */
export function matchesKeyCombo(e: KeyboardEvent, combo: string): boolean {
  const parsed = parseKeyCombo(combo);
  const eventKey = e.key.toLowerCase();

  // Special key names
  if (parsed.key === 'delete' && e.key !== 'Delete') return false;
  if (parsed.key === 'backspace' && e.key !== 'Backspace') return false;
  if (parsed.key === 'escape' && e.key !== 'Escape') return false;
  if (parsed.key === 'enter' && e.key !== 'Enter') return false;
  if (parsed.key === 'tab' && e.key !== 'Tab') return false;
  if (parsed.key === 'f10' && e.key !== 'F10') return false;
  if (parsed.key === 'f5' && e.key !== 'F5') return false;
  if (parsed.key === ',' && eventKey !== ',') return false;
  if (parsed.key === '+' && eventKey !== '+') return false;
  if (parsed.key === '-' && eventKey !== '-') return false;

  // Regular keys
  if (!['delete', 'backspace', 'escape', 'enter', 'tab', 'f10', 'f5', ',', '+', '-'].includes(parsed.key)) {
    if (eventKey !== parsed.key) return false;
  }

  if (parsed.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;

  return true;
}

/**
 * Format a key combo string for display.
 * e.g., 'ctrl+shift+z' → 'Ctrl+Shift+Z'
 */
export function formatKeyCombo(combo: string): string {
  return combo.split('+').map(part => {
    if (part.toLowerCase() === 'ctrl') return 'Ctrl';
    if (part.toLowerCase() === 'meta' || part.toLowerCase() === 'cmd') return 'Ctrl';
    if (part.toLowerCase() === 'shift') return 'Shift';
    if (part.toLowerCase() === 'alt') return 'Alt';
    if (part.toLowerCase() === 'delete') return 'Del';
    if (part.toLowerCase() === 'backspace') return 'Bksp';
    if (part.toLowerCase() === 'escape') return 'Esc';
    if (part.toLowerCase() === 'enter') return 'Enter';
    if (part.toLowerCase() === 'tab') return 'Tab';
    return part.toUpperCase();
  }).join('+');
}

/**
 * Convert a KeyboardEvent to a key combo string.
 * Used when recording new key bindings.
 */
export function eventToKeyCombo(e: KeyboardEvent): string | null {
  // Don't capture lone modifier keys
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');

  // Normalize the key name
  let key = e.key;
  if (key.length === 1) key = key.toLowerCase();

  parts.push(key);
  return parts.join('+');
}

/**
 * Find conflicts between a proposed key combo and existing bindings.
 * Returns array of conflicting action IDs.
 */
export function findConflicts(
  actionId: string,
  keyCombo: string,
  overrides: Record<string, string>,
): string[] {
  const proposed = parseKeyCombo(keyCombo);
  const conflicts: string[] = [];
  for (const def of SHORTCUT_DEFS) {
    if (def.id === actionId) continue;
    const current = overrides[def.id] ?? def.defaultKey;
    const parsed = parseKeyCombo(current);
    if (
      parsed.key === proposed.key &&
      parsed.ctrl === proposed.ctrl &&
      parsed.shift === proposed.shift &&
      parsed.alt === proposed.alt
    ) {
      conflicts.push(def.id);
    }
  }
  return conflicts;
}

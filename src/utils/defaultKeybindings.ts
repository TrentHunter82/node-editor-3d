/**
 * Default keyboard bindings map.
 * Re-exports from keyboardShortcuts.ts for consumers that only need the defaults.
 */
import { DEFAULT_KEYBINDINGS, SHORTCUT_DEFS } from './keyboardShortcuts';
export type { ShortcutDef } from './keyboardShortcuts';
export { DEFAULT_KEYBINDINGS, SHORTCUT_DEFS };

/** Get the effective key binding for an action, respecting user overrides */
export function getEffectiveBinding(
  actionId: string,
  overrides: Record<string, string>,
): string {
  return overrides[actionId] ?? DEFAULT_KEYBINDINGS[actionId] ?? '';
}

/**
 * Check if an event target is on a UI panel (not the 3D canvas).
 * Uses data-ui-panel attributes for robust detection that won't
 * break when CSS modules rename class hashes.
 */
export function isOnUIPanel(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[data-ui-panel]') !== null;
}

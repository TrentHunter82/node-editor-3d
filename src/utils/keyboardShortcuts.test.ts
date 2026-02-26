import { describe, it, expect } from 'vitest';
import {
  SHORTCUT_DEFS,
  DEFAULT_KEYBINDINGS,
  parseKeyCombo,
  matchesKeyCombo,
  formatKeyCombo,
  eventToKeyCombo,
  findConflicts,
} from './keyboardShortcuts';

/** Helper to create a mock KeyboardEvent with sensible defaults. */
function mockKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// SHORTCUT_DEFS & DEFAULT_KEYBINDINGS
// ---------------------------------------------------------------------------

describe('SHORTCUT_DEFS', () => {
  it('has at least 35 definitions', () => {
    expect(SHORTCUT_DEFS.length).toBeGreaterThanOrEqual(35);
  });

  it('all entries have required fields (id, label, defaultKey, category)', () => {
    for (const def of SHORTCUT_DEFS) {
      expect(def.id).toBeTruthy();
      expect(typeof def.id).toBe('string');
      expect(def.label).toBeTruthy();
      expect(typeof def.label).toBe('string');
      expect(def.defaultKey).toBeTruthy();
      expect(typeof def.defaultKey).toBe('string');
      expect(['Selection', 'Navigation', 'Editing', 'Panels', 'Execution', 'Camera']).toContain(
        def.category,
      );
    }
  });

  it('has no duplicate IDs', () => {
    const ids = SHORTCUT_DEFS.map(d => d.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('DEFAULT_KEYBINDINGS matches SHORTCUT_DEFS', () => {
    for (const def of SHORTCUT_DEFS) {
      expect(DEFAULT_KEYBINDINGS[def.id]).toBe(def.defaultKey);
    }
    // No extra keys beyond what SHORTCUT_DEFS provides
    expect(Object.keys(DEFAULT_KEYBINDINGS).length).toBe(SHORTCUT_DEFS.length);
  });
});

// ---------------------------------------------------------------------------
// parseKeyCombo
// ---------------------------------------------------------------------------

describe('parseKeyCombo', () => {
  it('parses a simple single key', () => {
    expect(parseKeyCombo('a')).toEqual({ key: 'a', ctrl: false, shift: false, alt: false });
  });

  it('parses ctrl combo', () => {
    expect(parseKeyCombo('ctrl+z')).toEqual({ key: 'z', ctrl: true, shift: false, alt: false });
  });

  it('parses complex combo with ctrl+shift', () => {
    expect(parseKeyCombo('ctrl+shift+z')).toEqual({
      key: 'z',
      ctrl: true,
      shift: true,
      alt: false,
    });
  });

  it('treats meta and cmd as ctrl', () => {
    expect(parseKeyCombo('meta+k')).toEqual({ key: 'k', ctrl: true, shift: false, alt: false });
    expect(parseKeyCombo('cmd+s')).toEqual({ key: 's', ctrl: true, shift: false, alt: false });
  });

  it('parses special keys (Delete, Escape, F10)', () => {
    expect(parseKeyCombo('Delete')).toEqual({
      key: 'delete',
      ctrl: false,
      shift: false,
      alt: false,
    });
    expect(parseKeyCombo('Escape')).toEqual({
      key: 'escape',
      ctrl: false,
      shift: false,
      alt: false,
    });
    expect(parseKeyCombo('F10')).toEqual({ key: 'f10', ctrl: false, shift: false, alt: false });
  });
});

// ---------------------------------------------------------------------------
// matchesKeyCombo
// ---------------------------------------------------------------------------

describe('matchesKeyCombo', () => {
  it('matches a simple key press', () => {
    const e = mockKeyEvent({ key: 'g' });
    expect(matchesKeyCombo(e, 'g')).toBe(true);
  });

  it('matches a ctrl combo', () => {
    const e = mockKeyEvent({ key: 'z', ctrlKey: true });
    expect(matchesKeyCombo(e, 'ctrl+z')).toBe(true);
  });

  it('rejects when modifiers do not match', () => {
    // Event has ctrl, combo does not
    const e1 = mockKeyEvent({ key: 'z', ctrlKey: true });
    expect(matchesKeyCombo(e1, 'z')).toBe(false);

    // Event lacks ctrl, combo requires it
    const e2 = mockKeyEvent({ key: 'z' });
    expect(matchesKeyCombo(e2, 'ctrl+z')).toBe(false);

    // Event has shift, combo does not
    const e3 = mockKeyEvent({ key: 'a', shiftKey: true });
    expect(matchesKeyCombo(e3, 'a')).toBe(false);
  });

  it('matches special keys (Delete, Escape, Enter, Tab, F10, F5)', () => {
    expect(matchesKeyCombo(mockKeyEvent({ key: 'Delete' }), 'Delete')).toBe(true);
    expect(matchesKeyCombo(mockKeyEvent({ key: 'Escape' }), 'Escape')).toBe(true);
    expect(matchesKeyCombo(mockKeyEvent({ key: 'Enter' }), 'Enter')).toBe(true);
    expect(matchesKeyCombo(mockKeyEvent({ key: 'Tab' }), 'Tab')).toBe(true);
    expect(matchesKeyCombo(mockKeyEvent({ key: 'F10' }), 'F10')).toBe(true);
    expect(matchesKeyCombo(mockKeyEvent({ key: 'F5' }), 'F5')).toBe(true);
  });

  it('ctrl in combo matches both ctrlKey and metaKey', () => {
    const withCtrl = mockKeyEvent({ key: 'c', ctrlKey: true });
    const withMeta = mockKeyEvent({ key: 'c', metaKey: true });
    expect(matchesKeyCombo(withCtrl, 'ctrl+c')).toBe(true);
    expect(matchesKeyCombo(withMeta, 'ctrl+c')).toBe(true);
  });

  it('rejects when key does not match', () => {
    const e = mockKeyEvent({ key: 'x', ctrlKey: true });
    expect(matchesKeyCombo(e, 'ctrl+z')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatKeyCombo
// ---------------------------------------------------------------------------

describe('formatKeyCombo', () => {
  it('formats modifiers and key with title case', () => {
    expect(formatKeyCombo('ctrl+shift+z')).toBe('Ctrl+Shift+Z');
  });

  it('formats special keys (delete → Del, escape → Esc, backspace → Bksp)', () => {
    expect(formatKeyCombo('delete')).toBe('Del');
    expect(formatKeyCombo('escape')).toBe('Esc');
    expect(formatKeyCombo('backspace')).toBe('Bksp');
  });

  it('formats meta as Ctrl', () => {
    expect(formatKeyCombo('meta+k')).toBe('Ctrl+K');
  });

  it('formats alt modifier', () => {
    expect(formatKeyCombo('alt+f')).toBe('Alt+F');
  });

  it('formats ctrl+shift+Delete combo', () => {
    expect(formatKeyCombo('ctrl+shift+Delete')).toBe('Ctrl+Shift+Del');
  });
});

// ---------------------------------------------------------------------------
// eventToKeyCombo
// ---------------------------------------------------------------------------

describe('eventToKeyCombo', () => {
  it('returns combo string for regular key with modifiers', () => {
    const e = mockKeyEvent({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(eventToKeyCombo(e)).toBe('ctrl+shift+z');
  });

  it('returns null for lone modifier keys', () => {
    expect(eventToKeyCombo(mockKeyEvent({ key: 'Control' }))).toBeNull();
    expect(eventToKeyCombo(mockKeyEvent({ key: 'Shift' }))).toBeNull();
    expect(eventToKeyCombo(mockKeyEvent({ key: 'Alt' }))).toBeNull();
    expect(eventToKeyCombo(mockKeyEvent({ key: 'Meta' }))).toBeNull();
  });

  it('lowercases single character keys', () => {
    const e = mockKeyEvent({ key: 'A', shiftKey: true });
    expect(eventToKeyCombo(e)).toBe('shift+a');
  });

  it('preserves multi-character key names (e.g. Delete, F10)', () => {
    expect(eventToKeyCombo(mockKeyEvent({ key: 'Delete' }))).toBe('Delete');
    expect(eventToKeyCombo(mockKeyEvent({ key: 'F10' }))).toBe('F10');
    expect(eventToKeyCombo(mockKeyEvent({ key: 'Escape' }))).toBe('Escape');
  });

  it('includes alt modifier when pressed', () => {
    const e = mockKeyEvent({ key: 'f', altKey: true });
    expect(eventToKeyCombo(e)).toBe('alt+f');
  });
});

// ---------------------------------------------------------------------------
// findConflicts
// ---------------------------------------------------------------------------

describe('findConflicts', () => {
  it('finds conflict with a default binding', () => {
    // 'ctrl+z' is the default for 'undo'
    const conflicts = findConflicts('some-new-action', 'ctrl+z', {});
    expect(conflicts).toContain('undo');
  });

  it('finds conflict with an override binding', () => {
    // Override 'copy' to use 'ctrl+shift+z' (which is 'redo' by default)
    const overrides = { copy: 'ctrl+shift+z' };
    const conflicts = findConflicts('some-new-action', 'ctrl+shift+z', overrides);
    expect(conflicts).toContain('redo'); // default binding conflict
    expect(conflicts).toContain('copy'); // override binding conflict
  });

  it('returns empty array when there are no conflicts', () => {
    // A combo no shortcut uses
    const conflicts = findConflicts('some-action', 'ctrl+alt+shift+q', {});
    expect(conflicts).toEqual([]);
  });

  it('excludes the actionId itself from results', () => {
    // 'undo' default is 'ctrl+z' — checking itself should not conflict
    const conflicts = findConflicts('undo', 'ctrl+z', {});
    expect(conflicts).not.toContain('undo');
  });
});

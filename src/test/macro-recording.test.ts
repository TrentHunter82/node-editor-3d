import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import { useSettingsStore, clampLoadedSettings } from '../store/settingsStore';
import {
  isRecording,
  isPlaying,
  startRecording,
  stopRecording,
  recordAction,
  getRecordedActions,
  playMacro,
  stopPlayback,
  saveRecordedMacro,
  subscribe,
} from '../utils/macroRecorder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSettings() {
  return useSettingsStore.getState();
}

function resetSettings() {
  useSettingsStore.setState(useSettingsStore.getInitialState());
}

/** Clean up all macro module state and reset settings store between tests. */
function cleanup() {
  stopRecording();
  stopPlayback();
  resetSettings();
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Macro Recording', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // Recording State (tests 1-6)
  // =========================================================================

  describe('Recording State', () => {
    it('1. isRecording() starts false', () => {
      expect(isRecording()).toBe(false);
    });

    it('2. startRecording sets isRecording to true', () => {
      startRecording();
      expect(isRecording()).toBe(true);
    });

    it('3. stopRecording sets isRecording to false', () => {
      startRecording();
      stopRecording();
      expect(isRecording()).toBe(false);
    });

    it('4. startRecording clears previous recorded actions', () => {
      startRecording();
      recordAction('undo');
      recordAction('redo');
      // Start a new recording session — previous actions should be cleared
      startRecording();
      expect(getRecordedActions()).toEqual([]);
    });

    it('5. stopRecording returns copy of actions', () => {
      startRecording();
      recordAction('undo');
      recordAction('redo');
      const result = stopRecording();
      expect(result).toEqual(['undo', 'redo']);
      // Verify it is a copy — mutating the return value should not affect anything
      result.push('injected');
      // A fresh getRecordedActions after stopRecording should be empty (state was cleared)
      expect(getRecordedActions()).toEqual([]);
    });

    it('6. stopRecording clears internal state (getRecordedActions empty after)', () => {
      startRecording();
      recordAction('undo');
      recordAction('redo');
      stopRecording();
      // Internal recorded actions should be empty after stop
      expect(getRecordedActions()).toEqual([]);
    });
  });

  // =========================================================================
  // recordAction (tests 7-10)
  // =========================================================================

  describe('recordAction', () => {
    it('7. recordAction ignored when not recording', () => {
      recordAction('undo');
      recordAction('redo');
      expect(getRecordedActions()).toEqual([]);
    });

    it('8. recordAction accumulates actions in order', () => {
      startRecording();
      recordAction('undo');
      recordAction('redo');
      recordAction('delete');
      expect(getRecordedActions()).toEqual(['undo', 'redo', 'delete']);
    });

    it('9. getRecordedActions returns defensive copy (mutating result does not affect internal)', () => {
      startRecording();
      recordAction('undo');
      const copy = getRecordedActions();
      copy.push('injected');
      // Internal state should be unaffected by mutation of the copy
      expect(getRecordedActions()).toEqual(['undo']);
    });

    it('10. Multiple actions recorded in sequence', () => {
      startRecording();
      const actions = ['selectAll', 'copy', 'paste', 'undo', 'redo'];
      for (const a of actions) {
        recordAction(a);
      }
      expect(getRecordedActions()).toEqual(actions);
      expect(getRecordedActions()).toHaveLength(5);
    });
  });

  // =========================================================================
  // Playback (tests 11-17)
  // =========================================================================

  describe('Playback', () => {
    it('11. playMacro sets isPlaying to true', () => {
      vi.useFakeTimers();
      const dispatch = vi.fn();
      playMacro(['undo', 'redo'], 100, dispatch);
      expect(isPlaying()).toBe(true);
    });

    it('12. playMacro is no-op when already playing (concurrent guard)', () => {
      vi.useFakeTimers();
      const dispatch1 = vi.fn();
      const dispatch2 = vi.fn();

      playMacro(['a', 'b'], 100, dispatch1);
      // Attempt to start a second concurrent playback
      playMacro(['c', 'd'], 100, dispatch2);

      // Advance past all timeouts
      vi.advanceTimersByTime(200);

      // Only the first dispatch should have been called
      expect(dispatch1).toHaveBeenCalledTimes(2);
      expect(dispatch2).not.toHaveBeenCalled();
    });

    it('13. Actions dispatched with correct delays', () => {
      vi.useFakeTimers();
      const dispatch = vi.fn();
      playMacro(['a', 'b', 'c'], 50, dispatch);

      // playMacro uses (i+1)*delayMs, so first action fires at 1*50=50ms
      vi.advanceTimersByTime(49);
      expect(dispatch).toHaveBeenCalledTimes(0);

      // At time 50, first action fires (delay = (0+1) * 50 = 50)
      vi.advanceTimersByTime(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('a');

      // At time 100, second action fires (delay = (1+1) * 50 = 100)
      vi.advanceTimersByTime(50);
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(dispatch).toHaveBeenCalledWith('b');

      // At time 150, third action fires (delay = (2+1) * 50 = 150)
      vi.advanceTimersByTime(50);
      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(dispatch).toHaveBeenCalledWith('c');
    });

    it('14. Last action marks playback as done (isPlaying becomes false)', () => {
      vi.useFakeTimers();
      const dispatch = vi.fn();
      playMacro(['a', 'b'], 100, dispatch);
      expect(isPlaying()).toBe(true);

      // Last action fires at (1+1)*100 = 200ms
      vi.advanceTimersByTime(200);
      expect(isPlaying()).toBe(false);
    });

    it('15. stopPlayback stops playback immediately', () => {
      vi.useFakeTimers();
      const dispatch = vi.fn();
      playMacro(['a', 'b', 'c'], 100, dispatch);
      expect(isPlaying()).toBe(true);

      stopPlayback();
      expect(isPlaying()).toBe(false);

      // Advance time — no actions should fire
      vi.advanceTimersByTime(300);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('16. stopPlayback clears all pending timeouts', () => {
      vi.useFakeTimers();
      const dispatch = vi.fn();
      playMacro(['a', 'b', 'c'], 100, dispatch);

      // Let the first action fire at (0+1)*100 = 100ms
      vi.advanceTimersByTime(100);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith('a');

      // Stop before the remaining actions fire
      stopPlayback();
      vi.advanceTimersByTime(500);

      // Only the first action should have fired
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('17. Empty actions array: playback does not start', () => {
      vi.useFakeTimers();
      const dispatch = vi.fn();
      playMacro([], 100, dispatch);

      // Empty actions array should not start playback at all
      expect(isPlaying()).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Subscription (tests 18-20)
  // =========================================================================

  describe('Subscription', () => {
    it('18. subscribe notifies on startRecording', () => {
      const listener = vi.fn();
      const unsub = subscribe(listener);
      startRecording();
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('19. subscribe notifies on stopRecording', () => {
      const listener = vi.fn();
      startRecording();
      const unsub = subscribe(listener);
      stopRecording();
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('20. Unsubscribe stops notifications', () => {
      const listener = vi.fn();
      const unsub = subscribe(listener);
      unsub();
      startRecording();
      stopRecording();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // saveRecordedMacro (tests 21-23)
  // =========================================================================

  describe('saveRecordedMacro', () => {
    it('21. saveRecordedMacro persists to settingsStore', () => {
      const id = saveRecordedMacro('My Macro', ['undo', 'redo'], 150);
      const macros = getSettings().macros;
      expect(macros).toHaveLength(1);
      expect(macros[0]).toMatchObject({
        id,
        name: 'My Macro',
        actions: ['undo', 'redo'],
        delayMs: 150,
      });
    });

    it('22. Default delayMs is 200', () => {
      saveRecordedMacro('Default Delay', ['a']);
      const macros = getSettings().macros;
      expect(macros[0].delayMs).toBe(200);
    });

    it('23. Generated ID is unique', () => {
      const id1 = saveRecordedMacro('First', ['a']);
      const id2 = saveRecordedMacro('Second', ['b']);
      expect(id1).not.toBe(id2);
      // Both IDs should be strings starting with "macro-"
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1.startsWith('macro-')).toBe(true);
      expect(id2.startsWith('macro-')).toBe(true);
    });
  });

  // =========================================================================
  // settingsStore Macro Actions (tests 24-27)
  // =========================================================================

  describe('settingsStore Macro Actions', () => {
    it('24. saveMacro adds to macros array with generated ID', () => {
      const id = getSettings().saveMacro({ name: 'Test', actions: ['undo'], delayMs: 100 });
      const macros = getSettings().macros;
      expect(macros).toHaveLength(1);
      expect(macros[0].id).toBe(id);
      expect(macros[0].name).toBe('Test');
      expect(macros[0].actions).toEqual(['undo']);
      expect(macros[0].delayMs).toBe(100);
      expect(id.startsWith('macro-')).toBe(true);
    });

    it('25. deleteMacro removes by ID', () => {
      const id = getSettings().saveMacro({ name: 'ToDelete', actions: ['a'], delayMs: 100 });
      expect(getSettings().macros).toHaveLength(1);

      getSettings().deleteMacro(id);
      expect(getSettings().macros).toHaveLength(0);
    });

    it('26. updateMacro partially updates name/actions/delayMs', () => {
      const id = getSettings().saveMacro({ name: 'OldName', actions: ['a'], delayMs: 100 });

      // Update only name
      getSettings().updateMacro(id, { name: 'NewName' });
      let macro = getSettings().macros.find(m => m.id === id)!;
      expect(macro.name).toBe('NewName');
      expect(macro.actions).toEqual(['a']);
      expect(macro.delayMs).toBe(100);

      // Update only actions
      getSettings().updateMacro(id, { actions: ['b', 'c'] });
      macro = getSettings().macros.find(m => m.id === id)!;
      expect(macro.name).toBe('NewName');
      expect(macro.actions).toEqual(['b', 'c']);
      expect(macro.delayMs).toBe(100);

      // Update only delayMs
      getSettings().updateMacro(id, { delayMs: 500 });
      macro = getSettings().macros.find(m => m.id === id)!;
      expect(macro.name).toBe('NewName');
      expect(macro.actions).toEqual(['b', 'c']);
      expect(macro.delayMs).toBe(500);
    });

    it('27. updateMacro is no-op for non-existent ID', () => {
      getSettings().saveMacro({ name: 'Existing', actions: ['a'], delayMs: 100 });
      const before = getSettings().macros;

      getSettings().updateMacro('non-existent-id', { name: 'Nope' });
      const after = getSettings().macros;

      expect(after).toEqual(before);
    });
  });

  // =========================================================================
  // Validation (tests 28-30)
  // =========================================================================

  describe('Validation (clampLoadedSettings)', () => {
    it('28. clampLoadedSettings filters invalid macros (missing fields, wrong types)', () => {
      const result = clampLoadedSettings({
        macros: [
          // Missing id
          { name: 'NoId', actions: ['a'], delayMs: 100 },
          // Missing name
          { id: 'x1', actions: ['a'], delayMs: 100 },
          // Missing actions
          { id: 'x2', name: 'NoActions', delayMs: 100 },
          // actions not string[]
          { id: 'x3', name: 'BadActions', actions: [1, 2], delayMs: 100 },
          // delayMs is negative
          { id: 'x4', name: 'NegDelay', actions: ['a'], delayMs: -5 },
          // delayMs is Infinity
          { id: 'x5', name: 'InfDelay', actions: ['a'], delayMs: Infinity },
          // delayMs is NaN
          { id: 'x6', name: 'NanDelay', actions: ['a'], delayMs: NaN },
          // delayMs is not a number
          { id: 'x7', name: 'StringDelay', actions: ['a'], delayMs: 'fast' },
          // id is not a string
          { id: 123, name: 'NumId', actions: ['a'], delayMs: 100 },
          // null entry
          null,
          // array entry
          ['not', 'a', 'macro'],
          // Valid one should survive
          { id: 'ok', name: 'Valid', actions: ['b'], delayMs: 50 },
        ],
      });
      expect(result.macros).toHaveLength(1);
      expect(result.macros![0].id).toBe('ok');
    });

    it('29. clampLoadedSettings keeps valid macros', () => {
      const validMacros = [
        { id: 'm1', name: 'First', actions: ['undo'], delayMs: 0 },
        { id: 'm2', name: 'Second', actions: ['redo', 'delete'], delayMs: 200 },
        { id: 'm3', name: 'Empty Actions', actions: [], delayMs: 100 },
      ];
      const result = clampLoadedSettings({ macros: validMacros });
      expect(result.macros).toHaveLength(3);
      expect(result.macros).toEqual(validMacros);
    });

    it('30. clampLoadedSettings handles non-array macros input (resets to [])', () => {
      // String input
      expect(clampLoadedSettings({ macros: 'not-an-array' as unknown }).macros).toEqual([]);
      // Number input
      expect(clampLoadedSettings({ macros: 42 as unknown }).macros).toEqual([]);
      // Object input
      expect(clampLoadedSettings({ macros: { a: 1 } as unknown }).macros).toEqual([]);
      // null input
      expect(clampLoadedSettings({ macros: null as unknown }).macros).toEqual([]);
      // undefined input (field not present)
      expect(clampLoadedSettings({}).macros).toEqual([]);
    });
  });
});

/**
 * Macro recording and playback utility.
 * Records sequences of action IDs from keyboard shortcuts
 * and replays them with configurable delay.
 */
import { useSettingsStore } from '../store/settingsStore';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _recording = false;
let _recordedActions: string[] = [];
let _playing = false;
let _playbackTimeouts: ReturnType<typeof setTimeout>[] = [];

// Subscribers notified when recording state changes
const _listeners = new Set<() => void>();

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export function isRecording(): boolean {
  return _recording;
}

export function isPlaying(): boolean {
  return _playing;
}

export function startRecording(): void {
  _recording = true;
  _recordedActions = [];
  _notify();
}

export function stopRecording(): string[] {
  _recording = false;
  const actions = [..._recordedActions];
  // Clear buffer before notifying to prevent race condition:
  // if a listener calls startRecording() during _notify(), the new recording's
  // buffer would be wiped if we cleared after _notify()
  _recordedActions = [];
  _notify();
  return actions;
}

/** Called by the keyboard shortcut handler whenever an action fires */
export function recordAction(actionId: string): void {
  if (!_recording) return;
  _recordedActions.push(actionId);
  _notify();
}

export function getRecordedActions(): string[] {
  return [..._recordedActions];
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/**
 * Play back a macro by dispatching actions with delays.
 * @param actions Array of action IDs to dispatch
 * @param delayMs Delay between each action in milliseconds
 * @param dispatch Function that dispatches an action by ID
 */
export function playMacro(
  actions: string[],
  delayMs: number,
  dispatch: (actionId: string) => void,
): void {
  if (_playing) return;
  if (actions.length === 0) return;
  _playing = true;
  _playbackTimeouts = [];
  _notify();

  actions.forEach((actionId, i) => {
    const timeoutId = setTimeout(() => {
      dispatch(actionId);
      // Last action — mark playback as done
      if (i === actions.length - 1) {
        _playing = false;
        _playbackTimeouts = [];
        _notify();
      }
    }, (i + 1) * delayMs);
    _playbackTimeouts.push(timeoutId);
  });
}

export function stopPlayback(): void {
  _playbackTimeouts.forEach(id => clearTimeout(id));
  _playbackTimeouts = [];
  _playing = false;
  _notify();
}

// ---------------------------------------------------------------------------
// Save to settings
// ---------------------------------------------------------------------------

export function saveRecordedMacro(name: string, actions: string[], delayMs = 200): string {
  return useSettingsStore.getState().saveMacro({ name, actions, delayMs });
}

// ---------------------------------------------------------------------------
// Subscription (for React components to re-render)
// ---------------------------------------------------------------------------

function _notify(): void {
  _listeners.forEach(fn => fn());
}

export function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

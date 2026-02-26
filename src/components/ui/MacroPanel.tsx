/**
 * MacroPanel: UI for recording, managing, and playing back keyboard macros.
 * Macros are sequences of shortcut action IDs that can be replayed with configurable speed.
 */
import { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useEditorStore } from '../../store/editorStore';
import { SHORTCUT_DEFS } from '../../utils/keyboardShortcuts';
import {
  isRecording, isPlaying,
  startRecording, stopRecording, getRecordedActions,
  playMacro, stopPlayback, saveRecordedMacro,
  subscribe,
} from '../../utils/macroRecorder';
import type { MacroDef } from '../../store/settingsStore';
import styles from '../../styles/panels.module.css';

/** Map action IDs to human-readable labels */
function actionLabel(actionId: string): string {
  const def = SHORTCUT_DEFS.find(d => d.id === actionId);
  return def?.label ?? actionId;
}

/** Dispatch an action by its shortcut ID (used for macro playback) */
function dispatchShortcutAction(actionId: string): void {
  const store = useEditorStore.getState();
  switch (actionId) {
    case 'undo': store.undo(); break;
    case 'redo': store.redo(); break;
    case 'delete': store.deleteSelected(); break;
    case 'copy': store.copySelected(); break;
    case 'paste': store.paste(); break;
    case 'duplicate': store.duplicateSelected(); break;
    case 'select-all': store.setSelection(new Set(Object.keys(store.nodes))); break;
    case 'group': store.createGroup(); break;
    case 'toggle-snap': {
      const ss = useSettingsStore.getState();
      ss.setGridVisible(!ss.gridVisible);
      break;
    }
    case 'toggle-grid': {
      const ss = useSettingsStore.getState();
      ss.setGridVisible(!ss.gridVisible);
      break;
    }
    case 'auto-layout': store.autoLayout(); break;
    case 'execute-selection':
      if (store.selectedIds.size > 0) store.executeSelection(store.selectedIds);
      break;
    case 'zoom-fit': window.__zoomToFit?.(); break;
    default: break; // Unknown action — skip
  }
}

/** Use the module-scoped macro recorder state in React */
function useMacroState() {
  return useSyncExternalStore(subscribe, () => ({
    recording: isRecording(),
    playing: isPlaying(),
    recorded: getRecordedActions(),
  }));
}

interface MacroPanelProps {
  onClose: () => void;
}

export function MacroPanel({ onClose }: MacroPanelProps) {
  const macros = useSettingsStore(s => s.macros);
  const deleteMacro = useSettingsStore(s => s.deleteMacro);
  const updateMacro = useSettingsStore(s => s.updateMacro);
  const { recording, playing, recorded } = useMacroState();
  const [macroName, setMacroName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleStartRecording = useCallback(() => {
    startRecording();
  }, []);

  const handleStopAndSave = useCallback(() => {
    const actions = stopRecording();
    if (actions.length > 0) {
      const name = macroName.trim() || `Macro ${macros.length + 1}`;
      saveRecordedMacro(name, actions, 200);
      setMacroName('');
    }
  }, [macroName, macros.length]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
  }, []);

  const handlePlayMacro = useCallback((macro: MacroDef) => {
    playMacro(macro.actions, macro.delayMs, dispatchShortcutAction);
  }, []);

  const handleStopPlayback = useCallback(() => {
    stopPlayback();
  }, []);

  const handleRename = useCallback((macroId: string) => {
    const trimmed = editName.trim();
    if (trimmed) {
      updateMacro(macroId, { name: trimmed });
    }
    setEditingId(null);
  }, [editName, updateMacro]);

  // Escape key closes panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className={styles.panelContainer}
      style={{ width: 280, maxHeight: 400, overflow: 'auto' }}
    >
      <div className={styles.panelHeader}>
        <span>Macros</span>
        <button
          className={styles.panelCloseBtn}
          onClick={onClose}
          title="Close"
        >
          &times;
        </button>
      </div>

      {/* Recording controls */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--panel-border)' }}>
        {recording ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              color: 'var(--danger)', fontSize: 10, fontFamily: 'var(--font-mono)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', animation: 'pulse 1s infinite' }} />
              Recording... ({recorded.length} actions)
            </div>
            {recorded.length > 0 && (
              <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', maxHeight: 60, overflow: 'auto' }}>
                {recorded.map((a, i) => (
                  <span key={i}>{actionLabel(a)}{i < recorded.length - 1 ? ' → ' : ''}</span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                placeholder="Macro name..."
                value={macroName}
                onChange={e => setMacroName(e.target.value)}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleStopAndSave(); }}
                style={{
                  flex: 1, padding: '3px 6px', fontSize: 10,
                  background: 'var(--input-bg)', border: '1px solid var(--panel-border)',
                  borderRadius: 3, color: 'var(--text)', outline: 'none',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <button
                onClick={handleStopAndSave}
                disabled={recorded.length === 0}
                style={{
                  padding: '3px 8px', fontSize: 9,
                  background: recorded.length > 0 ? 'var(--teal)' : 'var(--panel-border)',
                  border: 'none', borderRadius: 3, color: 'var(--text-bright)', cursor: 'pointer',
                }}
              >
                Save
              </button>
              <button
                onClick={handleStopRecording}
                style={{
                  padding: '3px 8px', fontSize: 9,
                  background: 'var(--panel-border)', border: 'none',
                  borderRadius: 3, color: 'var(--text)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleStartRecording}
            disabled={playing}
            style={{
              padding: '4px 10px', fontSize: 10, width: '100%',
              background: 'var(--panel-border)', border: 'none',
              borderRadius: 4, color: 'var(--text)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Start Recording
          </button>
        )}
      </div>

      {/* Macro library */}
      <div style={{ padding: '4px 0' }}>
        {macros.length === 0 ? (
          <div style={{
            padding: '16px 12px', textAlign: 'center',
            fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
          }}>
            No macros recorded yet.
            <br />
            Click "Start Recording" and use keyboard shortcuts.
          </div>
        ) : (
          macros.map(macro => (
            <div
              key={macro.id}
              style={{
                padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6,
                borderBottom: '1px solid var(--panel-border)',
              }}
            >
              {editingId === macro.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => handleRename(macro.id)}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') handleRename(macro.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  style={{
                    flex: 1, padding: '2px 4px', fontSize: 10,
                    background: 'var(--input-bg)', border: '1px solid var(--teal)',
                    borderRadius: 2, color: 'var(--text)', outline: 'none',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              ) : (
                <div
                  style={{ flex: 1, cursor: 'default' }}
                  onDoubleClick={() => {
                    setEditingId(macro.id);
                    setEditName(macro.name);
                  }}
                >
                  <div style={{ fontSize: 10, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                    {macro.name}
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                    {macro.actions.length} actions &middot; {macro.delayMs}ms delay
                  </div>
                </div>
              )}
              <button
                onClick={() => handlePlayMacro(macro)}
                disabled={playing || recording}
                title="Play macro"
                style={{
                  padding: '2px 6px', fontSize: 9, background: 'none',
                  border: '1px solid var(--teal)', borderRadius: 3,
                  color: 'var(--teal)', cursor: 'pointer',
                }}
              >
                &#9654;
              </button>
              <button
                onClick={() => deleteMacro(macro.id)}
                title="Delete macro"
                style={{
                  padding: '2px 6px', fontSize: 9, background: 'none',
                  border: '1px solid var(--panel-border)', borderRadius: 3,
                  color: 'var(--text-dim)', cursor: 'pointer',
                }}
              >
                &times;
              </button>
            </div>
          ))
        )}
      </div>

      {/* Playback status */}
      {playing && (
        <div style={{
          padding: '8px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid var(--panel-border)',
        }}>
          <span style={{ fontSize: 10, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>
            Playing...
          </span>
          <button
            onClick={handleStopPlayback}
            style={{
              padding: '2px 8px', fontSize: 9,
              background: 'var(--danger)', border: 'none',
              borderRadius: 3, color: 'var(--text-bright)', cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
      )}
    </div>
  );
}

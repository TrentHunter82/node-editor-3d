import { useCallback, useRef, useState } from 'react';
import { useSettingsStore, BUILTIN_PRESETS } from '../../store/settingsStore';
import { useEditorStore } from '../../store/editorStore';
import type { Theme } from '../../store/settingsStore';
import { SHORTCUT_DEFS, formatKeyCombo, eventToKeyCombo, findConflicts } from '../../utils/keyboardShortcuts';
import styles from '../../styles/panels.module.css';

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px' }}>
      <span style={{ fontSize: '10px', color: 'var(--text-dim)', minWidth: 100 }}>{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--teal)' }}
      />
      <span style={{
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--teal)',
        minWidth: 36,
        textAlign: 'right',
      }}>
        {value.toFixed(step < 1 ? 1 : 0)}
      </span>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px' }}>
      <span style={{ fontSize: '10px', color: 'var(--text-dim)', flex: 1 }}>{label}</span>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        style={{
          width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer',
          background: value ? 'var(--teal)' : 'var(--btn-bg)',
          position: 'relative', transition: 'background 0.15s',
        }}
      >
        <div style={{
          width: 12, height: 12, borderRadius: '50%',
          background: 'var(--text-bright)', position: 'absolute', top: 2,
          left: value ? 18 : 2, transition: 'left 0.15s',
        }} />
      </button>
    </div>
  );
}

/** Individual key binding row with inline recording */
function KeyBindingRow({ actionId, label, defaultKey }: {
  actionId: string;
  label: string;
  defaultKey: string;
}) {
  const overrides = useSettingsStore(s => s.keyBindingOverrides);
  const setKeyBinding = useSettingsStore(s => s.setKeyBinding);
  const resetKeyBinding = useSettingsStore(s => s.resetKeyBinding);
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const currentKey = overrides[actionId] ?? defaultKey;
  const isCustom = actionId in overrides;

  const handleRecord = useCallback(() => {
    setRecording(true);
    setConflict(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      setRecording(false);
      setConflict(null);
      return;
    }

    const combo = eventToKeyCombo(e.nativeEvent);
    if (!combo) return;

    // Check for conflicts
    const conflicts = findConflicts(actionId, combo, overrides);
    if (conflicts.length > 0) {
      const conflictLabel = SHORTCUT_DEFS.find(d => d.id === conflicts[0])?.label ?? conflicts[0];
      setConflict(`Conflicts with "${conflictLabel}"`);
      return;
    }

    // Apply the binding
    if (combo.toLowerCase() === defaultKey.toLowerCase()) {
      resetKeyBinding(actionId);
    } else {
      setKeyBinding(actionId, combo);
    }
    setRecording(false);
    setConflict(null);
  }, [recording, actionId, overrides, defaultKey, setKeyBinding, resetKeyBinding]);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '3px 16px',
        background: recording ? 'color-mix(in srgb, var(--teal) 8%, transparent)' : undefined,
      }}
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        if (recording && !e.currentTarget.contains(e.relatedTarget as Node)) {
          setRecording(false);
          setConflict(null);
        }
      }}
    >
      <span style={{ fontSize: '9px', color: 'var(--text-dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {conflict && (
        <span style={{ fontSize: '8px', color: 'var(--coral)', flexShrink: 0 }}>
          {conflict}
        </span>
      )}
      <button
        onClick={handleRecord}
        tabIndex={0}
        style={{
          padding: '1px 6px',
          fontSize: '9px',
          fontFamily: 'var(--font-mono)',
          borderRadius: 3,
          border: recording
            ? '1px solid var(--teal)'
            : isCustom
              ? '1px solid var(--orange)'
              : '1px solid var(--btn-border)',
          background: recording
            ? 'color-mix(in srgb, var(--teal) 20%, transparent)'
            : 'var(--btn-bg)',
          color: recording
            ? 'var(--teal)'
            : isCustom
              ? 'var(--orange)'
              : 'var(--btn-text)',
          cursor: 'pointer',
          minWidth: 60,
          textAlign: 'center',
        }}
      >
        {recording ? 'Press key...' : formatKeyCombo(currentKey)}
      </button>
      {isCustom && !recording && (
        <button
          onClick={() => { resetKeyBinding(actionId); setConflict(null); }}
          title="Reset to default"
          style={{
            padding: '0 4px',
            fontSize: '8px',
            background: 'none',
            border: 'none',
            color: 'var(--text-faint)',
            cursor: 'pointer',
          }}
        >
          x
        </button>
      )}
    </div>
  );
}

/** Collapsible keyboard shortcuts section for SettingsPanel */
function KeyboardShortcutsSection() {
  const [expanded, setExpanded] = useState(false);
  const overrides = useSettingsStore(s => s.keyBindingOverrides);
  const resetAllKeyBindings = useSettingsStore(s => s.resetAllKeyBindings);
  const overrideCount = Object.keys(overrides).length;

  // Group shortcuts by category
  const categories = ['Selection', 'Navigation', 'Editing', 'Panels', 'Execution', 'Camera'] as const;

  return (
    <>
      <div
        style={{
          padding: '12px 16px 4px',
          fontSize: '9px',
          color: 'var(--text-faint)',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ flex: 1 }}>
          Keyboard Shortcuts {overrideCount > 0 ? `(${overrideCount} custom)` : ''}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>
          {expanded ? '\u25B2' : '\u25BC'}
        </span>
      </div>
      {expanded && (
        <div>
          {overrideCount > 0 && (
            <div style={{ padding: '2px 16px', textAlign: 'right' }}>
              <button
                onClick={() => { if (window.confirm('Reset all keyboard shortcuts to defaults?')) resetAllKeyBindings(); }}
                style={{
                  fontSize: '8px',
                  fontFamily: 'var(--font-mono)',
                  background: 'none',
                  border: '1px solid var(--btn-border)',
                  borderRadius: 3,
                  color: 'var(--text-faint)',
                  cursor: 'pointer',
                  padding: '1px 6px',
                }}
              >
                Reset All
              </button>
            </div>
          )}
          {categories.map(cat => {
            const defs = SHORTCUT_DEFS.filter(d => d.category === cat);
            if (defs.length === 0) return null;
            return (
              <div key={cat}>
                <div style={{
                  padding: '6px 16px 2px',
                  fontSize: '8px',
                  color: 'var(--text-faint)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  opacity: 0.7,
                }}>
                  {cat}
                </div>
                {defs.map(def => (
                  <KeyBindingRow
                    key={def.id}
                    actionId={def.id}
                    label={def.label}
                    defaultKey={def.defaultKey}
                  />
                ))}
              </div>
            );
          })}
          <div style={{
            padding: '4px 16px 8px',
            fontSize: '8px',
            color: 'var(--text-faint)',
            fontStyle: 'italic',
          }}>
            Click a shortcut to rebind. Press Escape to cancel.
          </div>
        </div>
      )}
    </>
  );
}

/** Collapsible workspace layout presets section */
function WorkspacePresetsSection() {
  const [expanded, setExpanded] = useState(false);
  const [newName, setNewName] = useState('');
  const customPresets = useSettingsStore(s => s.workspacePresets);
  const activePreset = useSettingsStore(s => s.activeWorkspacePreset);
  const savePreset = useSettingsStore(s => s.saveWorkspacePreset);
  const deletePreset = useSettingsStore(s => s.deleteWorkspacePreset);
  const setActivePreset = useSettingsStore(s => s.setActiveWorkspacePreset);

  const handleApply = useCallback((preset: { id: string; openPanels: string[]; minimapVisible: boolean; inspectorVisible: boolean }) => {
    window.__applyWorkspacePreset?.(preset.openPanels, preset.minimapVisible, preset.inspectorVisible);
    setActivePreset(preset.id);
  }, [setActivePreset]);

  const handleSave = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const currentOpenPanels = useSettingsStore.getState().openPanels;
    savePreset(name, currentOpenPanels);
    setNewName('');
  }, [newName, savePreset]);

  return (
    <>
      <div
        style={{
          padding: '12px 16px 4px', fontSize: '9px', color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '1px',
          display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ flex: 1 }}>
          Workspace Presets {activePreset ? `(${activePreset})` : ''}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>
          {expanded ? '\u25B2' : '\u25BC'}
        </span>
      </div>
      {expanded && (
        <div>
          {/* Built-in presets */}
          <div style={{ padding: '4px 16px 2px', fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.5px' }}>
            BUILT-IN
          </div>
          {BUILTIN_PRESETS.map((preset, i) => (
            <div key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 16px' }}>
              <button
                onClick={() => handleApply(preset)}
                style={{
                  flex: 1, textAlign: 'left', padding: '2px 6px', fontSize: 9,
                  background: activePreset === preset.id ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
                  border: `1px solid ${activePreset === preset.id ? 'var(--teal)' : 'var(--btn-border)'}`,
                  color: activePreset === preset.id ? 'var(--teal)' : 'var(--btn-text)',
                  borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {preset.name}
              </button>
              <span style={{ fontSize: 8, color: 'var(--text-faint)', flexShrink: 0 }}>
                Ctrl+Alt+{i + 1}
              </span>
            </div>
          ))}
          {/* Custom presets */}
          {customPresets.length > 0 && (
            <>
              <div style={{ padding: '6px 16px 2px', fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.5px' }}>
                CUSTOM
              </div>
              {customPresets.map(preset => (
                <div key={preset.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 16px' }}>
                  <button
                    onClick={() => handleApply(preset)}
                    style={{
                      flex: 1, textAlign: 'left', padding: '2px 6px', fontSize: 9,
                      background: activePreset === preset.id ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
                      border: `1px solid ${activePreset === preset.id ? 'var(--teal)' : 'var(--btn-border)'}`,
                      color: activePreset === preset.id ? 'var(--teal)' : 'var(--btn-text)',
                      borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {preset.name}
                  </button>
                  <button
                    onClick={() => deletePreset(preset.id)}
                    title="Delete preset"
                    style={{
                      padding: '0 4px', fontSize: 8, background: 'none',
                      border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
            </>
          )}
          {/* Save new preset */}
          <div style={{ display: 'flex', gap: 4, padding: '6px 16px' }}>
            <input
              type="text"
              placeholder="Preset name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleSave(); }}
              style={{
                flex: 1, padding: '2px 6px', fontSize: 9, fontFamily: 'inherit',
                background: 'var(--btn-bg)', border: '1px solid var(--btn-border)',
                borderRadius: 3, color: 'var(--text)', outline: 'none',
              }}
            />
            <button
              onClick={handleSave}
              disabled={!newName.trim()}
              style={{
                padding: '2px 8px', fontSize: 9, fontFamily: 'inherit',
                background: 'var(--btn-bg)', border: '1px solid var(--btn-border)',
                borderRadius: 3, color: 'var(--btn-text)', cursor: 'pointer',
                opacity: newName.trim() ? 1 : 0.5,
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const gridSnapSize = useSettingsStore(s => s.gridSnapSize);
  const gridVisible = useSettingsStore(s => s.gridVisible);
  const animationSpeed = useSettingsStore(s => s.animationSpeed);
  const uiScale = useSettingsStore(s => s.uiScale);
  const theme = useSettingsStore(s => s.theme);
  const minimapVisible = useSettingsStore(s => s.minimapVisible);
  const inspectorVisible = useSettingsStore(s => s.inspectorVisible);
  const toolbarVisible = useSettingsStore(s => s.toolbarVisible);
  const autoSave = useSettingsStore(s => s.autoSave);
  const workerExecution = useSettingsStore(s => s.workerExecution);
  const liveMode = useSettingsStore(s => s.liveMode);
  const liveIntervalMs = useSettingsStore(s => s.liveIntervalMs);
  const connectionStyle = useSettingsStore(s => s.connectionStyle);
  const connectionFlowAnimation = useSettingsStore(s => s.connectionFlowAnimation);
  const showExecutionHeatmap = useSettingsStore(s => s.showExecutionHeatmap);
  const showNodeScreens = useSettingsStore(s => s.showNodeScreens);
  const postProcessing = useSettingsStore(s => s.postProcessing);
  const remoteBackend = useSettingsStore(s => s.remoteBackend);
  const comfyUrl = useSettingsStore(s => s.comfyUrl);
  const remoteMaxConcurrent = useSettingsStore(s => s.remoteMaxConcurrent);
  const zoomSensitivity = useSettingsStore(s => s.zoomSensitivity);
  const panSpeed = useSettingsStore(s => s.panSpeed);
  const rotateSpeed = useSettingsStore(s => s.rotateSpeed);
  const cameraDamping = useSettingsStore(s => s.cameraDamping);
  const dampingDuration = useSettingsStore(s => s.dampingDuration);

  const setGridSnapSize = useSettingsStore(s => s.setGridSnapSize);
  const setGridVisible = useSettingsStore(s => s.setGridVisible);
  const setAnimationSpeed = useSettingsStore(s => s.setAnimationSpeed);
  const setUiScale = useSettingsStore(s => s.setUiScale);
  const setTheme = useSettingsStore(s => s.setTheme);
  const setMinimapVisible = useSettingsStore(s => s.setMinimapVisible);
  const setInspectorVisible = useSettingsStore(s => s.setInspectorVisible);
  const setToolbarVisible = useSettingsStore(s => s.setToolbarVisible);
  const setAutoSave = useSettingsStore(s => s.setAutoSave);
  const setWorkerExecution = useSettingsStore(s => s.setWorkerExecution);
  const setLiveMode = useSettingsStore(s => s.setLiveMode);
  const setLiveIntervalMs = useSettingsStore(s => s.setLiveIntervalMs);
  const setConnectionStyle = useSettingsStore(s => s.setConnectionStyle);
  const setConnectionFlowAnimation = useSettingsStore(s => s.setConnectionFlowAnimation);
  const setShowExecutionHeatmap = useSettingsStore(s => s.setShowExecutionHeatmap);
  const setShowNodeScreens = useSettingsStore(s => s.setShowNodeScreens);
  const setPostProcessing = useSettingsStore(s => s.setPostProcessing);
  const setRemoteBackend = useSettingsStore(s => s.setRemoteBackend);
  const setComfyUrl = useSettingsStore(s => s.setComfyUrl);
  const setRemoteMaxConcurrent = useSettingsStore(s => s.setRemoteMaxConcurrent);
  const showValuePreviews = useEditorStore(s => s.showValuePreviews);
  const toggleValuePreviews = useEditorStore(s => s.toggleValuePreviews);
  const setZoomSensitivity = useSettingsStore(s => s.setZoomSensitivity);
  const setPanSpeed = useSettingsStore(s => s.setPanSpeed);
  const setRotateSpeed = useSettingsStore(s => s.setRotateSpeed);
  const setCameraDamping = useSettingsStore(s => s.setCameraDamping);
  const setDampingDuration = useSettingsStore(s => s.setDampingDuration);
  const resetToDefaults = useSettingsStore(s => s.resetToDefaults);

  const panelRef = useRef<HTMLDivElement>(null);

  const handleReset = useCallback(() => {
    if (window.confirm('Reset all settings to defaults?')) {
      resetToDefaults();
    }
  }, [resetToDefaults]);

  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'input, button, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  }, []);

  if (!open) return null;

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } handleFocusTrap(e); }}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        style={{ maxWidth: 400 }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '13px',
            color: 'var(--text-bright)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Settings
          </span>
          <button
            onClick={handleReset}
            style={{
              background: 'var(--btn-bg)',
              border: '1px solid var(--btn-border)',
              borderRadius: 4,
              color: 'var(--btn-text)',
              cursor: 'pointer',
              padding: '2px 8px',
              fontSize: '9px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Reset
          </button>
        </div>

        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {/* Grid section */}
          <div style={{
            padding: '8px 16px 4px',
            fontSize: '9px',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Grid
          </div>
          <SliderRow
            label="Snap size"
            value={gridSnapSize}
            min={0.1} max={2} step={0.1}
            onChange={setGridSnapSize}
          />
          <ToggleRow label="Show grid" value={gridVisible} onChange={setGridVisible} />

          {/* Animation section */}
          <div style={{
            padding: '12px 16px 4px',
            fontSize: '9px',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Animation
          </div>
          <SliderRow
            label="Speed"
            value={animationSpeed}
            min={0} max={3} step={0.1}
            onChange={setAnimationSpeed}
          />

          {/* UI section */}
          <div style={{
            padding: '12px 16px 4px',
            fontSize: '9px',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Interface
          </div>
          <SliderRow
            label="UI scale"
            value={uiScale}
            min={0.5} max={2} step={0.1}
            onChange={setUiScale}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', flex: 1 }}>Theme</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['dark', 'light'] as Theme[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  style={{
                    padding: '2px 10px',
                    fontSize: '9px',
                    fontFamily: 'var(--font-mono)',
                    borderRadius: 4,
                    border: `1px solid ${theme === t ? 'var(--teal)' : 'var(--btn-border)'}`,
                    background: theme === t ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
                    color: theme === t ? 'var(--teal)' : 'var(--btn-text)',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <ToggleRow label="Show minimap" value={minimapVisible} onChange={setMinimapVisible} />
          <ToggleRow label="Show inspector" value={inspectorVisible} onChange={setInspectorVisible} />
          <ToggleRow label="Show toolbar" value={toolbarVisible} onChange={setToolbarVisible} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', flex: 1 }}>Panel layout</span>
            <button
              onClick={() => useSettingsStore.getState().resetPanelLayout()}
              style={{
                padding: '2px 10px',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                borderRadius: 4,
                border: '1px solid var(--btn-border)',
                background: 'var(--btn-bg)',
                color: 'var(--btn-text)',
                cursor: 'pointer',
              }}
            >
              Reset Layout
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-dim)', flex: 1 }}>Connections</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['bezier', 'straight', 'right-angle', 'organic'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setConnectionStyle(s)}
                  style={{
                    padding: '2px 10px',
                    fontSize: '9px',
                    fontFamily: 'var(--font-mono)',
                    borderRadius: 4,
                    border: `1px solid ${connectionStyle === s ? 'var(--teal)' : 'var(--btn-border)'}`,
                    background: connectionStyle === s ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
                    color: connectionStyle === s ? 'var(--teal)' : 'var(--btn-text)',
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <ToggleRow label="Flow animation" value={connectionFlowAnimation} onChange={setConnectionFlowAnimation} />
          <ToggleRow label="Node screens" value={showNodeScreens} onChange={setShowNodeScreens} />
          <ToggleRow label="Value previews" value={showValuePreviews} onChange={() => toggleValuePreviews()} />
          <ToggleRow label="Execution heatmap" value={showExecutionHeatmap} onChange={setShowExecutionHeatmap} />
          <ToggleRow label="Post-processing (bloom)" value={postProcessing} onChange={setPostProcessing} />

          {/* Camera section */}
          <div style={{
            padding: '12px 16px 4px',
            fontSize: '9px',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Camera
          </div>
          <SliderRow
            label="Zoom sensitivity"
            value={zoomSensitivity}
            min={0.1} max={3} step={0.1}
            onChange={setZoomSensitivity}
          />
          <SliderRow
            label="Pan speed"
            value={panSpeed}
            min={0.1} max={3} step={0.1}
            onChange={setPanSpeed}
          />
          <SliderRow
            label="Rotate speed"
            value={rotateSpeed}
            min={0.1} max={3} step={0.1}
            onChange={setRotateSpeed}
          />
          <SliderRow
            label="Damping"
            value={cameraDamping}
            min={0.01} max={0.2} step={0.01}
            onChange={setCameraDamping}
          />
          <SliderRow
            label="Damping duration"
            value={dampingDuration}
            min={0.1} max={0.5} step={0.01}
            onChange={setDampingDuration}
          />

          {/* Persistence section */}
          <div style={{
            padding: '12px 16px 4px',
            fontSize: '9px',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Persistence
          </div>
          <ToggleRow label="Auto-save" value={autoSave} onChange={setAutoSave} />

          {/* Execution section */}
          <div style={{
            padding: '12px 16px 4px',
            fontSize: '9px',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Execution
          </div>
          <ToggleRow label="Worker execution (off-thread)" value={workerExecution} onChange={setWorkerExecution} />
          <ToggleRow label="Live Mode (re-run on interval)" value={liveMode} onChange={setLiveMode} />
          {liveMode && (
            <SliderRow label="Live interval (ms)" value={liveIntervalMs} min={100} max={10000} step={100} onChange={setLiveIntervalMs} />
          )}

          {/* Remote execution section */}
          <div style={{
            padding: '12px 16px 4px',
            fontSize: '9px',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Remote Execution
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px', gap: 8 }}>
            <span style={{ fontSize: '11px', color: 'var(--btn-text)' }}>Backend</span>
            <select
              className={styles.inspectorInput}
              style={{ width: 130 }}
              value={remoteBackend}
              onChange={(e) => setRemoteBackend(e.target.value as 'demo' | 'comfyui')}
              aria-label="Remote execution backend"
            >
              <option value="demo">Demo (in-process)</option>
              <option value="comfyui">ComfyUI server</option>
            </select>
          </div>
          {remoteBackend === 'comfyui' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px', gap: 8 }}>
              <span style={{ fontSize: '11px', color: 'var(--btn-text)' }}>Server URL</span>
              <input
                className={styles.inspectorInput}
                style={{ width: 170 }}
                value={comfyUrl}
                onChange={(e) => setComfyUrl(e.target.value)}
                placeholder="http://127.0.0.1:8188"
                spellCheck={false}
                aria-label="ComfyUI server URL"
              />
            </div>
          )}
          <SliderRow label="Max concurrent jobs" value={remoteMaxConcurrent} min={1} max={8} step={1} onChange={setRemoteMaxConcurrent} />

          {/* Keyboard Shortcuts section */}
          <KeyboardShortcutsSection />

          {/* Workspace Presets section */}
          <WorkspacePresetsSection />
        </div>

        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--divider)',
          fontSize: '9px',
          color: 'var(--text-faint)',
          textAlign: 'center',
        }}>
          Settings are saved automatically
        </div>
      </div>
    </div>
  );
}

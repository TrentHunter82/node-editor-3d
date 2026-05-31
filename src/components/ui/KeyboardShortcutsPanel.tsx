import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import {
  SHORTCUT_DEFS,
  formatKeyCombo,
  eventToKeyCombo,
  findConflicts,
} from '../../utils/keyboardShortcuts';
import styles from '../../styles/panels.module.css';

const CATEGORIES = ['Selection', 'Navigation', 'Editing', 'Panels', 'Execution', 'Camera'] as const;

/** Individual key binding row with inline recording */
const KeyBindingRow = memo(function KeyBindingRow({ actionId, label, defaultKey }: {
  actionId: string;
  label: string;
  defaultKey: string;
}) {
  const overrides = useSettingsStore(s => s.keyBindingOverrides);
  const setKeyBinding = useSettingsStore(s => s.setKeyBinding);
  const resetKeyBinding = useSettingsStore(s => s.resetKeyBinding);
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

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
      ref={rowRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 16px',
        background: recording ? 'color-mix(in srgb, var(--teal) 8%, transparent)' : undefined,
        transition: 'background 0.12s',
      }}
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        if (recording && !e.currentTarget.contains(e.relatedTarget as Node)) {
          setRecording(false);
          setConflict(null);
        }
      }}
    >
      <span
        style={{
          fontSize: '10px',
          color: 'var(--text-dim)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {conflict && (
        <span style={{ fontSize: '9px', color: 'var(--coral)', flexShrink: 0 }}>
          {conflict}
        </span>
      )}
      <button
        onClick={handleRecord}
        tabIndex={0}
        aria-label={`Rebind ${label}, currently ${formatKeyCombo(currentKey)}`}
        style={{
          padding: '2px 8px',
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          borderRadius: 4,
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
          minWidth: 72,
          textAlign: 'center',
          transition: 'border-color 0.12s, background 0.12s, color 0.12s',
        }}
      >
        {recording ? 'Press key...' : formatKeyCombo(currentKey)}
      </button>
      {isCustom && !recording && (
        <button
          onClick={() => { resetKeyBinding(actionId); setConflict(null); }}
          title={`Reset "${label}" to default (${formatKeyCombo(defaultKey)})`}
          aria-label={`Reset ${label} to default`}
          style={{
            padding: '0 4px',
            fontSize: '9px',
            background: 'none',
            border: 'none',
            color: 'var(--text-faint)',
            cursor: 'pointer',
            transition: 'color 0.12s',
          }}
        >
          {'\u00D7'}
        </button>
      )}
    </div>
  );
});

export function KeyboardShortcutsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overrides = useSettingsStore(s => s.keyBindingOverrides);
  const resetAllKeyBindings = useSettingsStore(s => s.resetAllKeyBindings);
  const overrideCount = Object.keys(overrides).length;

  // Reset the filter on the open transition (during render, via a stored
  // previous value) and focus the input in an effect (it touches the ref).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setFilter('');
  }
  useEffect(() => {
    if (open) {
      // Slight delay to allow the DOM to render before focusing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Filter shortcuts by search term
  const filteredByCategory = useMemo(() => {
    const lowerFilter = filter.toLowerCase().trim();
    const result: Record<string, typeof SHORTCUT_DEFS> = {};
    for (const cat of CATEGORIES) {
      const defs = SHORTCUT_DEFS.filter(d => {
        if (d.category !== cat) return false;
        if (!lowerFilter) return true;
        const currentKey = overrides[d.id] ?? d.defaultKey;
        return (
          d.label.toLowerCase().includes(lowerFilter) ||
          d.id.toLowerCase().includes(lowerFilter) ||
          formatKeyCombo(currentKey).toLowerCase().includes(lowerFilter) ||
          d.category.toLowerCase().includes(lowerFilter)
        );
      });
      if (defs.length > 0) {
        result[cat] = defs;
      }
    }
    return result;
  }, [filter, overrides]);

  const totalVisible = Object.values(filteredByCategory).reduce((sum, defs) => sum + defs.length, 0);

  const handleResetAll = useCallback(() => {
    if (window.confirm('Reset all keyboard shortcuts to defaults?')) {
      resetAllKeyBindings();
    }
  }, [resetAllKeyBindings]);

  // Focus trap
  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'input, button, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
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
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          handleFocusTrap(e);
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        style={{ maxWidth: 480, width: '90vw' }}
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
            Keyboard Shortcuts
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {overrideCount > 0 && (
              <span style={{
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--orange)',
              }}>
                {overrideCount} custom
              </span>
            )}
            <button
              onClick={handleResetAll}
              disabled={overrideCount === 0}
              style={{
                background: 'var(--btn-bg)',
                border: '1px solid var(--btn-border)',
                borderRadius: 4,
                color: overrideCount > 0 ? 'var(--btn-text)' : 'var(--text-faint)',
                cursor: overrideCount > 0 ? 'pointer' : 'default',
                padding: '2px 8px',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                opacity: overrideCount > 0 ? 1 : 0.5,
              }}
            >
              Reset All
            </button>
          </div>
        </div>

        {/* Search / Filter */}
        <input
          ref={inputRef}
          className={styles.searchInput}
          type="text"
          placeholder="Filter shortcuts..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          aria-label="Filter keyboard shortcuts"
        />

        {/* Scrollable shortcut list */}
        <div
          style={{
            maxHeight: 420,
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--scrollbar-thumb) transparent',
          }}
        >
          {totalVisible === 0 ? (
            <div className={styles.searchEmpty}>
              No shortcuts matching "{filter}"
            </div>
          ) : (
            CATEGORIES.map(cat => {
              const defs = filteredByCategory[cat];
              if (!defs) return null;
              return (
                <div key={cat}>
                  <div style={{
                    padding: '8px 16px 2px',
                    fontSize: '9px',
                    fontFamily: 'var(--font-display)',
                    color: 'var(--text-faint)',
                    textTransform: 'uppercase',
                    letterSpacing: '1.5px',
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
            })
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--divider)',
          fontSize: '9px',
          color: 'var(--text-faint)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>Click a shortcut to rebind. Press Esc to cancel.</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {totalVisible} / {SHORTCUT_DEFS.length}
          </span>
        </div>
      </div>
    </div>
  );
}

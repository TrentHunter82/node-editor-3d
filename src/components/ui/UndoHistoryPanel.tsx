import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import type { UndoMeta } from '../../store/editorStore';
import styles from '../../styles/panels.module.css';

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/** Timestamp grouping threshold in ms */
const GROUP_THRESHOLD_MS = 5000;

type DiffKind = 'added' | 'removed' | 'changed' | 'none';

/** Compare adjacent undo entries to determine what changed */
function computeDiff(current: UndoMeta, previous: UndoMeta | null): DiffKind {
  if (!previous) return 'none';
  if (current.nodeCount > previous.nodeCount) return 'added';
  if (current.nodeCount < previous.nodeCount) return 'removed';
  if (current.connectionCount !== previous.connectionCount) return 'changed';
  return 'changed'; // label or data changed
}

const DIFF_COLORS: Record<DiffKind, string> = {
  added: 'var(--success)',
  removed: 'var(--danger)',
  changed: 'var(--gold)',
  none: 'transparent',
};

interface FlatEntry {
  meta: UndoMeta;
  variant: 'undo' | 'redo';
  actualIdx: number; // for undo: index into undoEntries; for redo: -1 (not jumpable)
  diff: DiffKind;
  isGroupStart: boolean; // first entry in a timestamp group
  groupLabel: string | null;
}

export function UndoHistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const undoRedoEvent = useEditorStore(s => s.undoRedoEvent);
  const getUndoHistory = useEditorStore(s => s.getUndoHistory);
  const jumpToUndoRaw = useEditorStore(s => s.jumpToUndo);
  const diffUndoSnapshots = useEditorStore(s => s.diffUndoSnapshots);
  const setDiffHighlight = useEditorStore(s => s.setDiffHighlight);

  // Wrap jumpToUndo to also compute and show diff highlights
  const jumpToUndo = useCallback((idx: number) => {
    // Compute diff between current state and target
    const diff = diffUndoSnapshots(-1, idx);
    jumpToUndoRaw(idx);
    if (diff && !diff.isEmpty) {
      const highlights = new Map<string, 'added' | 'removed' | 'modified'>();
      for (const nc of diff.nodeChanges) {
        highlights.set(nc.nodeId, nc.type);
      }
      setDiffHighlight(highlights);
    }
  }, [jumpToUndoRaw, diffUndoSnapshots, setDiffHighlight]);
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);
  const canUndoVal = useEditorStore(s => s.canUndo());
  const canRedoVal = useEditorStore(s => s.canRedo());

  const [compact, setCompact] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1); // -1 = "current state"
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Re-derive on each undoRedoEvent change
  const history = useMemo(() => {
    void undoRedoEvent;
    return getUndoHistory();
  }, [undoRedoEvent, getUndoHistory]);

  // Build flat list: redo (reversed) → current → undo (reversed)
  // With diff indicators and timestamp grouping
  const flatEntries = useMemo(() => {
    const { undo: undoEntries, redo: redoEntries } = history;
    const entries: FlatEntry[] = [];

    // Redo entries (future) — shown reversed (oldest first)
    const reversedRedo = [...redoEntries].reverse();
    for (let i = 0; i < reversedRedo.length; i++) {
      const meta = reversedRedo[i];
      const prev = i > 0 ? reversedRedo[i - 1] : null;
      const diff = computeDiff(meta, prev);
      const isGroupStart = i === 0 || (meta.timestamp - reversedRedo[i - 1].timestamp > GROUP_THRESHOLD_MS);
      entries.push({
        meta,
        variant: 'redo',
        actualIdx: -1,
        diff,
        isGroupStart,
        groupLabel: isGroupStart ? timeAgo(meta.timestamp) : null,
      });
    }

    // Undo entries (past) — shown reversed (most recent first)
    const reversedUndo = [...undoEntries].reverse();
    for (let i = 0; i < reversedUndo.length; i++) {
      const meta = reversedUndo[i];
      const actualIdx = undoEntries.length - 1 - i;
      const prev = i > 0 ? reversedUndo[i - 1] : null;
      const diff = computeDiff(meta, prev);
      const isGroupStart = i === 0 || (reversedUndo[i - 1].timestamp - meta.timestamp > GROUP_THRESHOLD_MS);
      entries.push({
        meta,
        variant: 'undo',
        actualIdx,
        diff,
        isGroupStart,
        groupLabel: isGroupStart ? timeAgo(meta.timestamp) : null,
      });
    }

    return entries;
  }, [history]);

  // Total navigable items: redo entries + "current state" + undo entries
  const redoCount = history.redo.length;
  const undoCount = history.undo.length;
  const totalItems = redoCount + 1 + undoCount; // +1 for "current state"

  // Reset focus when panel opens
  useEffect(() => {
    if (open) {
      setFocusIdx(redoCount); // focus on "current state"
      requestAnimationFrame(() => panelRef.current?.focus());
    }
  }, [open, redoCount]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx(prev => Math.min(prev + 1, totalItems - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(prev => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      setFocusIdx(0);
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      setFocusIdx(totalItems - 1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      // Determine which entry is focused
      if (focusIdx < redoCount) {
        // Redo entries: can't jump directly
        return;
      }
      if (focusIdx === redoCount) {
        // "Current state" — no action needed
        return;
      }
      // Undo entry
      const undoOffset = focusIdx - redoCount - 1;
      const undoEntries = history.undo;
      const actualIdx = undoEntries.length - 1 - undoOffset;
      if (actualIdx >= 0 && actualIdx < undoEntries.length) {
        jumpToUndo(actualIdx);
      }
      return;
    }
  }, [onClose, totalItems, focusIdx, redoCount, history.undo, jumpToUndo]);

  // Scroll focused entry into view
  useEffect(() => {
    if (focusIdx >= 0 && listRef.current) {
      const el = listRef.current.querySelector(`[data-focus-idx="${focusIdx}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIdx]);

  if (!open) return null;

  const undoEntries = history.undo;
  const redoEntries = history.redo;

  // Build undo flat list for rendering
  const redoFlat = flatEntries.filter(e => e.variant === 'redo');
  const undoFlat = flatEntries.filter(e => e.variant === 'undo');

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Undo history browser"
        tabIndex={-1}
        style={{ maxWidth: 420 }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px 10px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: "'Archivo Black', sans-serif",
            fontSize: '13px',
            color: 'var(--text-bright)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Undo History
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setCompact(c => !c)}
              aria-label={compact ? 'Switch to detailed view' : 'Switch to compact view'}
              aria-pressed={compact}
              style={{
                background: compact ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
                border: compact ? '1px solid color-mix(in srgb, var(--teal) 30%, transparent)' : '1px solid var(--panel-border)',
                color: compact ? 'var(--teal)' : 'var(--text-dim)',
                fontSize: '9px',
                fontFamily: "'JetBrains Mono', monospace",
                padding: '2px 6px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {compact ? 'Compact' : 'Detailed'}
            </button>
            <span style={{
              fontSize: '9px',
              color: 'var(--text-faint)',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {undoEntries.length} undo / {redoEntries.length} redo
            </span>
          </div>
        </div>

        {/* Quick undo/redo buttons */}
        <div style={{ padding: '8px 16px', display: 'flex', gap: 6 }}>
          <button
            className={styles.toolbarBtn}
            onClick={undo}
            disabled={!canUndoVal}
            style={{
              flex: 1, justifyContent: 'center', fontSize: '10px',
              opacity: !canUndoVal ? 0.35 : 1,
            }}
          >
            <UndoIcon /> Undo
          </button>
          <button
            className={styles.toolbarBtn}
            onClick={redo}
            disabled={!canRedoVal}
            style={{
              flex: 1, justifyContent: 'center', fontSize: '10px',
              opacity: !canRedoVal ? 0.35 : 1,
            }}
          >
            <RedoIcon /> Redo
          </button>
        </div>

        <div ref={listRef} style={{ maxHeight: 360, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--scrollbar-thumb) transparent' }}>
          {/* Redo stack (future) */}
          {redoFlat.length > 0 && (
            <div style={{
              borderTop: '1px solid var(--divider)',
              padding: '4px 8px',
            }}>
              <div style={{
                fontFamily: "'Archivo Black', sans-serif",
                fontSize: '8px',
                color: 'color-mix(in srgb, var(--purple) 60%, transparent)',
                textTransform: 'uppercase',
                letterSpacing: '1.5px',
                padding: '4px 8px 2px',
              }}>
                Redo Stack (future)
              </div>
              {redoFlat.map((entry, i) => (
                <div key={`redo-${entry.meta.timestamp}-${i}`}>
                  {entry.isGroupStart && entry.groupLabel && (
                    <TimestampGroup label={entry.groupLabel} />
                  )}
                  <EntryRow
                    meta={entry.meta}
                    variant="redo"
                    compact={compact}
                    diff={entry.diff}
                    focused={focusIdx === i}
                    dataFocusIdx={i}
                    onFocus={() => setFocusIdx(i)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Current state marker */}
          <div
            data-focus-idx={redoCount}
            style={{
              padding: '4px 16px',
              borderTop: '1px solid var(--divider)',
              borderBottom: '1px solid var(--divider)',
              background: focusIdx === redoCount
                ? 'color-mix(in srgb, var(--teal) 12%, transparent)'
                : 'color-mix(in srgb, var(--teal) 6%, transparent)',
              outline: focusIdx === redoCount ? '2px solid color-mix(in srgb, var(--teal) 50%, transparent)' : 'none',
              outlineOffset: -2,
              borderRadius: 2,
            }}
          >
            <div style={{
              fontSize: '10px',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--teal)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 0',
            }}>
              <span style={{ fontSize: '12px' }}>{'\u25C6'}</span>
              Current State
            </div>
          </div>

          {/* Undo stack (past) */}
          {undoFlat.length > 0 ? (
            <div style={{ padding: '0 8px' }}>
              {undoFlat.map((entry, i) => {
                const globalIdx = redoCount + 1 + i;
                return (
                  <div key={`undo-${entry.meta.timestamp}-${i}`}>
                    {entry.isGroupStart && entry.groupLabel && (
                      <TimestampGroup label={entry.groupLabel} />
                    )}
                    <EntryRow
                      meta={entry.meta}
                      variant="undo"
                      compact={compact}
                      diff={entry.diff}
                      focused={focusIdx === globalIdx}
                      dataFocusIdx={globalIdx}
                      onClick={() => jumpToUndo(entry.actualIdx)}
                      onFocus={() => setFocusIdx(globalIdx)}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '16px', color: 'var(--text-faint)', fontSize: '11px', textAlign: 'center' }}>
              No undo history. Make some changes to build history.
            </div>
          )}
        </div>

        {/* Keyboard navigation hint */}
        <div style={{
          padding: '6px 16px',
          borderTop: '1px solid var(--divider)',
          fontSize: '9px',
          color: 'var(--text-faint)',
          fontFamily: "'JetBrains Mono', monospace",
          display: 'flex',
          gap: 12,
        }}>
          <span><kbd style={kbdStyle}>↑↓</kbd> navigate</span>
          <span><kbd style={kbdStyle}>Enter</kbd> jump</span>
          <span><kbd style={kbdStyle}>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: '1px 4px',
  background: 'var(--btn-bg)',
  borderRadius: 3,
  fontSize: '8px',
};

function TimestampGroup({ label }: { label: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        fontSize: '8px',
        fontFamily: "'JetBrains Mono', monospace",
        color: 'var(--text-dim)',
        padding: '6px 8px 2px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}
    >
      {label}
    </div>
  );
}

function EntryRow({
  meta,
  variant,
  compact,
  diff,
  focused,
  dataFocusIdx,
  onClick,
  onFocus,
}: {
  meta: UndoMeta;
  variant: 'undo' | 'redo';
  compact: boolean;
  diff: DiffKind;
  focused: boolean;
  dataFocusIdx: number;
  onClick?: () => void;
  onFocus?: () => void;
}) {
  const color = variant === 'undo' ? 'var(--orange)' : 'var(--purple)';
  const bgAlpha = variant === 'undo' ? 0.04 : 0.03;

  return (
    <button
      data-focus-idx={dataFocusIdx}
      onClick={onClick}
      onMouseEnter={onFocus}
      disabled={!onClick}
      aria-label={`${variant === 'undo' ? 'Undo' : 'Redo'}: ${meta.label}, ${meta.nodeCount} nodes, ${meta.connectionCount} connections, ${timeAgo(meta.timestamp)}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 4 : 8,
        padding: compact ? '3px 8px' : '5px 8px',
        width: '100%',
        border: 'none',
        background: focused
          ? `color-mix(in srgb, ${variant === 'undo' ? 'var(--orange)' : 'var(--purple)'} 10%, transparent)`
          : `color-mix(in srgb, ${variant === 'undo' ? 'var(--orange)' : 'var(--purple)'} ${bgAlpha * 100}%, transparent)`,
        borderLeft: variant === 'undo'
          ? '2px solid color-mix(in srgb, var(--orange) 20%, transparent)'
          : '2px solid color-mix(in srgb, var(--purple) 20%, transparent)',
        borderRadius: '0 4px 4px 0',
        cursor: onClick ? 'pointer' : 'default',
        textAlign: 'left',
        marginBottom: 1,
        opacity: onClick ? 1 : 0.6,
        outline: focused ? `1px solid color-mix(in srgb, ${variant === 'undo' ? 'var(--orange)' : 'var(--purple)'} 40%, transparent)` : 'none',
        outlineOffset: -1,
      }}
    >
      {/* Diff indicator dot */}
      {diff !== 'none' && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: DIFF_COLORS[diff],
            flexShrink: 0,
          }}
        />
      )}

      <span style={{
        fontSize: compact ? '8px' : '9px',
        fontFamily: "'JetBrains Mono', monospace",
        color,
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {meta.label}
      </span>

      {!compact && (
        <span style={{
          fontSize: '8px',
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text-faint)',
        }}>
          {meta.nodeCount}n {meta.connectionCount}c
        </span>
      )}

      <span style={{
        fontSize: '8px',
        fontFamily: "'JetBrains Mono', monospace",
        color: 'var(--text-faint)',
        minWidth: compact ? 36 : 48,
        textAlign: 'right',
      }}>
        {timeAgo(meta.timestamp)}
      </span>
    </button>
  );
}

function UndoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

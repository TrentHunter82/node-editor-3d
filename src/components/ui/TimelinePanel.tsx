import { memo, useCallback, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import type { ExecutionHistoryEntry } from '../../store/slices/executionSlice';
import styles from '../../styles/panels.module.css';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Compute which node outputs changed between two history entries. */
function diffEntries(a: ExecutionHistoryEntry, b: ExecutionHistoryEntry): Set<string> {
  const changed = new Set<string>();
  const allIds = new Set([...Object.keys(a.nodeOutputs), ...Object.keys(b.nodeOutputs)]);
  for (const id of allIds) {
    const aOut = a.nodeOutputs[id];
    const bOut = b.nodeOutputs[id];
    if (!aOut || !bOut) { changed.add(id); continue; }
    if (JSON.stringify(aOut) !== JSON.stringify(bOut)) changed.add(id);
  }
  return changed;
}

export const TimelinePanel = memo(function TimelinePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const history = useEditorStore(s => s.executionHistory);
  const historyIndex = useEditorStore(s => s.executionHistoryIndex);
  const scrub = useEditorStore(s => s.scrubExecutionHistory);
  const clearHistory = useEditorStore(s => s.clearExecutionHistory);
  const focusNode = useEditorStore(s => s.focusNode);
  const nodes = useEditorStore(s => s.nodes);

  const handleScrub = useCallback((index: number) => {
    scrub(index);
  }, [scrub]);

  const handleBackToLive = useCallback(() => {
    scrub(-1);
  }, [scrub]);

  // Active entry for per-node bars
  const activeEntry = useMemo(() => {
    if (historyIndex >= 0 && historyIndex < history.length) return history[historyIndex];
    return history.length > 0 ? history[history.length - 1] : null;
  }, [history, historyIndex]);

  // Sorted metrics: by duration descending
  const sortedMetrics = useMemo(() => {
    if (!activeEntry) return [];
    return Object.entries(activeEntry.metrics)
      .sort(([, a], [, b]) => b.duration - a.duration);
  }, [activeEntry]);

  // Memoize the diff computation (diffEntries uses JSON.stringify, can be expensive)
  const changedNodes = useMemo(() => {
    const currentEntry = historyIndex >= 0 && historyIndex < history.length
      ? history[historyIndex]
      : history.length > 0 ? history[history.length - 1] : null;
    const prevIdx = historyIndex >= 0 ? historyIndex - 1 : history.length - 2;
    const prevEntry = prevIdx >= 0 ? history[prevIdx] : null;
    return currentEntry && prevEntry ? diffEntries(prevEntry, currentEntry) : null;
  }, [history, historyIndex]);

  if (!open) return null;

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
        role="dialog"
        aria-modal="true"
        aria-label="Execution history timeline"
        style={{ maxWidth: 480 }}
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
            fontFamily: "'Archivo Black', sans-serif",
            fontSize: '13px',
            color: 'var(--text-bright)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Execution Timeline
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {historyIndex >= 0 && (
              <span style={{
                fontSize: '9px',
                padding: '2px 6px',
                borderRadius: 3,
                background: 'color-mix(in srgb, var(--warning) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
                color: 'var(--warning)',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                SCRUBBING
              </span>
            )}
            <span style={{
              fontSize: '9px',
              color: 'var(--text-faint)',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {history.length} runs
            </span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ padding: '8px 16px', display: 'flex', gap: 6 }}>
          {historyIndex >= 0 && (
            <button
              className={styles.toolbarBtn}
              onClick={handleBackToLive}
              style={{ fontSize: '10px', color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' }}
            >
              <LiveIcon /> Back to Live
            </button>
          )}
          {history.length > 0 && (
            <button
              className={styles.toolbarBtn}
              onClick={clearHistory}
              style={{ fontSize: '10px', color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}
            >
              Clear History
            </button>
          )}
        </div>

        {/* Timeline */}
        {history.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--text-dim)', fontSize: '11px', textAlign: 'center' }}>
            No execution history yet. Execute the graph to start recording.
          </div>
        ) : (
          <div className={styles.searchResults} style={{ maxHeight: 240, padding: '0 8px' }}>
            {history.map((entry, idx) => {
              const isActive = historyIndex >= 0 ? idx === historyIndex : idx === history.length - 1;
              const hasErrors = Object.keys(entry.errors).length > 0;
              return (
                <button
                  key={entry.id}
                  onClick={() => handleScrub(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    width: '100%',
                    border: 'none',
                    background: isActive ? 'color-mix(in srgb, var(--teal) 8%, transparent)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--teal)' : '2px solid transparent',
                    borderRadius: '0 4px 4px 0',
                    cursor: 'pointer',
                    textAlign: 'left',
                    marginBottom: 1,
                  }}
                >
                  <span style={{
                    fontSize: '9px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: isActive ? 'var(--teal)' : 'var(--text-dim)',
                    minWidth: 20,
                  }}>
                    #{entry.id}
                  </span>
                  <span style={{
                    fontSize: '9px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: 'var(--text-dim)',
                    minWidth: 60,
                  }}>
                    {formatTime(entry.timestamp)}
                  </span>
                  <span style={{
                    fontSize: '9px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: hasErrors ? 'var(--danger)' : 'var(--success)',
                    flex: 1,
                  }}>
                    {formatDuration(entry.totalDuration)}
                    {hasErrors && ` (${Object.keys(entry.errors).length} err)`}
                  </span>
                  <span style={{
                    fontSize: '8px',
                    color: 'var(--text-dim)',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {entry.nodeCount}n {entry.waveCount}w
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Per-node execution bars */}
        {activeEntry && Object.keys(activeEntry.metrics).length > 0 && (
          <div style={{
            borderTop: '1px solid var(--divider)',
            padding: '8px 16px 12px',
          }}>
            <div style={{
              fontFamily: "'Archivo Black', sans-serif",
              fontSize: '9px',
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              marginBottom: 6,
            }}>
              Node Execution ({Object.keys(activeEntry.metrics).length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sortedMetrics.map(([id, metric]) => {
                const barWidth = activeEntry.maxNodeDuration > 0
                  ? Math.max(4, (metric.duration / activeEntry.maxNodeDuration) * 100)
                  : 4;
                const hasError = !!activeEntry.errors[id];
                const barColor = hasError ? 'var(--danger)' : metric.cacheHit ? 'var(--text-dim)' : 'var(--success)';
                return (
                  <button
                    key={id}
                    onClick={() => focusNode(id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '2px 0',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      fontSize: '8px',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--text)',
                      minWidth: 80,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {nodes[id]?.title ?? id}
                    </span>
                    <span style={{
                      flex: 1,
                      height: 8,
                      background: 'color-mix(in srgb, var(--panel-border) 40%, transparent)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}>
                      <span style={{
                        display: 'block',
                        width: `${barWidth}%`,
                        height: '100%',
                        background: barColor,
                        borderRadius: 2,
                        transition: 'width 0.2s',
                      }} />
                    </span>
                    <span style={{
                      fontSize: '7px',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: barColor,
                      minWidth: 40,
                      textAlign: 'right',
                    }}>
                      {formatDuration(metric.duration)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Diff view */}
        {changedNodes && changedNodes.size > 0 && (
          <div style={{
            borderTop: '1px solid var(--divider)',
            padding: '8px 16px 12px',
          }}>
            <div style={{
              fontFamily: "'Archivo Black', sans-serif",
              fontSize: '9px',
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              marginBottom: 6,
            }}>
              Changed Nodes ({changedNodes.size})
            </div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {[...changedNodes].map(id => (
                <button
                  key={id}
                  onClick={() => focusNode(id)}
                  style={{
                    fontSize: '8px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: 'var(--warning)',
                    background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--warning) 20%, transparent)',
                    borderRadius: 3,
                    padding: '1px 5px',
                    cursor: 'pointer',
                  }}
                >
                  {nodes[id]?.title ?? id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function LiveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}

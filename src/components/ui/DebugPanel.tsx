import { memo, useMemo, useCallback, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { getUpstreamPath, getDownstreamPath } from '../../utils/profiling';
import styles from '../../styles/panels.module.css';

export const DebugPanel = memo(function DebugPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const debugMode = useEditorStore(s => s.debugMode);
  const toggleDebugMode = useEditorStore(s => s.toggleDebugMode);
  const isExecuting = useEditorStore(s => s.isExecuting);
  const pausedAtWave = useEditorStore(s => s.pausedAtWave);
  const debugWaves = useEditorStore(s => s.debugWaves);
  const stepExecution = useEditorStore(s => s.stepExecution);
  const resumeExecution = useEditorStore(s => s.resumeExecution);
  const executeGraph = useEditorStore(s => s.executeGraph);
  const resetExecution = useEditorStore(s => s.resetExecution);
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const executionStates = useEditorStore(s => s.executionStates);
  const breakpoints = useEditorStore(s => s.breakpoints);
  const breakpointConditions = useEditorStore(s => s.breakpointConditions);
  const toggleBreakpoint = useEditorStore(s => s.toggleBreakpoint);
  const setBreakpointCondition = useEditorStore(s => s.setBreakpointCondition);
  const clearBreakpointCondition = useEditorStore(s => s.clearBreakpointCondition);
  const traceNodeId = useEditorStore(s => s.traceNodeId);
  const setTraceNode = useEditorStore(s => s.setTraceNode);
  const focusNode = useEditorStore(s => s.focusNode);
  const selectedIds = useEditorStore(s => s.selectedIds);

  // Compute upstream/downstream paths for the traced node
  const tracePaths = useMemo(() => {
    if (!traceNodeId || !nodes[traceNodeId]) return null;
    return {
      upstream: getUpstreamPath(traceNodeId, nodes, connections),
      downstream: getDownstreamPath(traceNodeId, nodes, connections),
    };
  }, [traceNodeId, nodes, connections]);

  // Whether we're paused and waiting for step
  // isPaused: debugMode && isExecuting && pausedAtWave >= -1 (reserved for future step UI)
  const currentWave = pausedAtWave + 1; // next wave to execute
  const totalWaves = debugWaves.length;

  const panelRef = useRef<HTMLDivElement>(null);

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

  // Trace the first selected node
  const handleTraceSelected = useCallback(() => {
    const firstNode = [...selectedIds].find(id => nodes[id]);
    if (firstNode) {
      setTraceNode(traceNodeId === firstNode ? null : firstNode);
    }
  }, [selectedIds, nodes, traceNodeId, setTraceNode]);

  // Derived: any selected node exists in graph (avoid repeated [...selectedIds] spread in JSX)
  const hasValidSelection = useMemo(() => {
    for (const id of selectedIds) {
      if (nodes[id]) return true;
    }
    return false;
  }, [selectedIds, nodes]);

  if (!open) return null;

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onClose(); } handleFocusTrap(e); }}
        role="dialog"
        aria-modal="true"
        aria-label="Debug panel"
        style={{ maxWidth: 440 }}
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
            Debugger
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {debugMode && (
              <span style={{
                fontSize: '9px',
                padding: '2px 6px',
                borderRadius: 3,
                background: 'color-mix(in srgb, var(--warning) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
                color: 'var(--warning)',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                DEBUG
              </span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Debug mode toggle */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`${styles.toolbarBtn} ${debugMode ? styles.toolbarBtnActive : ''}`}
              onClick={toggleDebugMode}
              style={{ flex: 1, justifyContent: 'center', fontSize: '10px' }}
            >
              <BugIcon />
              {debugMode ? 'Debug On' : 'Debug Off'}
            </button>
          </div>

          {/* Execution controls */}
          <div style={{ display: 'flex', gap: 6 }}>
            {!isExecuting ? (
              <button
                className={styles.toolbarBtn}
                onClick={() => executeGraph()}
                style={{ flex: 1, justifyContent: 'center', fontSize: '10px', color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' }}
              >
                <PlayIcon />
                {debugMode ? 'Run (Debug)' : 'Execute'}
              </button>
            ) : (
              <button
                className={styles.toolbarBtn}
                onClick={resetExecution}
                style={{ flex: 1, justifyContent: 'center', fontSize: '10px', color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}
              >
                <StopIcon />
                Stop
              </button>
            )}
          </div>

          {/* Step controls (only when in debug mode and executing) */}
          {debugMode && isExecuting && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={styles.toolbarBtn}
                onClick={stepExecution}
                disabled={currentWave >= totalWaves}
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: 'var(--warning)',
                  borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)',
                  opacity: currentWave >= totalWaves ? 0.35 : 1,
                }}
              >
                <StepIcon />
                Step (F10)
              </button>
              <button
                className={styles.toolbarBtn}
                onClick={resumeExecution}
                disabled={currentWave >= totalWaves}
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: 'var(--success)',
                  borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)',
                  opacity: currentWave >= totalWaves ? 0.35 : 1,
                }}
              >
                <ResumeIcon />
                Resume (F5)
              </button>
            </div>
          )}
        </div>

        {/* Active breakpoints */}
        {Object.keys(breakpoints).length > 0 && (
          <div style={{
            borderTop: '1px solid var(--divider)',
            padding: '8px 16px',
          }}>
            <div style={{
              fontFamily: "'Archivo Black', sans-serif",
              fontSize: '9px',
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              marginBottom: 6,
            }}>
              Breakpoints ({Object.keys(breakpoints).length})
            </div>
            <div className={styles.searchResults} style={{ maxHeight: 120, padding: 0 }}>
              {Object.keys(breakpoints).map(nodeId => {
                const node = nodes[nodeId];
                const condition = breakpointConditions[nodeId];
                return (
                  <BreakpointRow
                    key={nodeId}
                    nodeId={nodeId}
                    nodeTitle={node?.title ?? nodeId}
                    condition={condition}
                    onFocus={() => focusNode(nodeId)}
                    onRemove={() => toggleBreakpoint(nodeId)}
                    onSetCondition={(expr) => {
                      if (expr.trim()) setBreakpointCondition(nodeId, expr.trim());
                      else clearBreakpointCondition(nodeId);
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Wave visualizer */}
        {debugMode && debugWaves.length > 0 && (
          <div style={{
            borderTop: '1px solid var(--divider)',
            padding: '8px 16px',
          }}>
            <div style={{
              fontFamily: "'Archivo Black', sans-serif",
              fontSize: '9px',
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              marginBottom: 6,
            }}>
              Execution Waves ({currentWave}/{totalWaves})
            </div>
            <div className={styles.searchResults} style={{ maxHeight: 160, padding: '0' }}>
              {debugWaves.map((wave, waveIdx) => {
                const isCompleted = waveIdx <= pausedAtWave;
                const isCurrent = waveIdx === pausedAtWave + 1;
                return (
                  <div
                    key={waveIdx}
                    style={{
                      padding: '4px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      borderLeft: isCurrent ? '2px solid var(--warning)' : isCompleted ? '2px solid var(--success)' : '2px solid var(--divider)',
                      background: isCurrent ? 'color-mix(in srgb, var(--warning) 6%, transparent)' : 'transparent',
                      marginBottom: 2,
                      borderRadius: '0 4px 4px 0',
                    }}
                  >
                    <span style={{
                      fontSize: '9px',
                      fontFamily: "'JetBrains Mono', monospace",
                      color: isCompleted ? 'var(--success)' : isCurrent ? 'var(--warning)' : 'var(--text-faint)',
                      minWidth: 16,
                    }}>
                      {isCompleted ? '\u2713' : isCurrent ? '\u25B6' : (waveIdx + 1)}
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
                      {wave.map(nodeId => {
                        const node = nodes[nodeId];
                        const execState = executionStates[nodeId];
                        const stateColor = execState === 'complete' ? 'var(--success)' : execState === 'running' ? 'var(--warning)' : execState === 'error' ? 'var(--danger)' : 'var(--text-dim)';
                        return (
                          <button
                            key={nodeId}
                            onClick={() => focusNode(nodeId)}
                            style={{
                              fontSize: '9px',
                              fontFamily: "'JetBrains Mono', monospace",
                              color: stateColor,
                              background: 'var(--divider)',
                              border: `1px solid ${stateColor}33`,
                              borderRadius: 3,
                              padding: '1px 5px',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: 90,
                            }}
                            title={node?.title ?? nodeId}
                          >
                            {node?.title ?? nodeId}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Data flow tracing section */}
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
            Data Flow Tracing
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button
              className={styles.toolbarBtn}
              onClick={handleTraceSelected}
              disabled={!hasValidSelection}
              style={{
                flex: 1,
                justifyContent: 'center',
                fontSize: '10px',
                opacity: !hasValidSelection ? 0.35 : 1,
                color: traceNodeId ? 'var(--teal)' : undefined,
                borderColor: traceNodeId ? 'color-mix(in srgb, var(--teal) 30%, transparent)' : undefined,
              }}
            >
              <TraceIcon />
              {traceNodeId ? 'Tracing...' : 'Trace Selected'}
            </button>
            {traceNodeId && (
              <button
                className={styles.toolbarBtn}
                onClick={() => setTraceNode(null)}
                style={{ fontSize: '10px', color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Trace results */}
          {traceNodeId && tracePaths && (
            <div style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" }}>
              <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>
                Tracing: <span style={{ color: 'var(--teal)' }}>{nodes[traceNodeId]?.title ?? traceNodeId}</span>
              </div>
              {tracePaths.upstream.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: 'var(--orange)', fontSize: '9px' }}>{'\u25B2'} Upstream ({tracePaths.upstream.length})</span>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                    {tracePaths.upstream.map(id => (
                      <button
                        key={id}
                        onClick={() => focusNode(id)}
                        style={{
                          fontSize: '8px',
                          fontFamily: "'JetBrains Mono', monospace",
                          color: 'var(--orange)',
                          background: 'color-mix(in srgb, var(--orange) 8%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--orange) 20%, transparent)',
                          borderRadius: 3,
                          padding: '1px 4px',
                          cursor: 'pointer',
                        }}
                      >
                        {nodes[id]?.title ?? id}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tracePaths.downstream.length > 0 && (
                <div>
                  <span style={{ color: 'var(--purple)', fontSize: '9px' }}>{'\u25BC'} Downstream ({tracePaths.downstream.length})</span>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                    {tracePaths.downstream.map(id => (
                      <button
                        key={id}
                        onClick={() => focusNode(id)}
                        style={{
                          fontSize: '8px',
                          fontFamily: "'JetBrains Mono', monospace",
                          color: 'var(--purple)',
                          background: 'color-mix(in srgb, var(--purple) 8%, transparent)',
                          border: '1px solid color-mix(in srgb, var(--purple) 20%, transparent)',
                          borderRadius: 3,
                          padding: '1px 4px',
                          cursor: 'pointer',
                        }}
                      >
                        {nodes[id]?.title ?? id}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tracePaths.upstream.length === 0 && tracePaths.downstream.length === 0 && (
                <div style={{ color: 'var(--text-faint)', fontSize: '9px' }}>
                  No connections found.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// --- Breakpoint row component ---

function BreakpointRow({ nodeTitle, condition, onFocus, onRemove, onSetCondition }: {
  nodeId?: string;
  nodeTitle: string;
  condition?: string;
  onFocus: () => void;
  onRemove: () => void;
  onSetCondition: (expr: string) => void;
}) {
  const [editingCondition, setEditingCondition] = useState(false);
  const [draft, setDraft] = useState(condition ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  const commitCondition = useCallback(() => {
    onSetCondition(draft);
    setEditingCondition(false);
  }, [draft, onSetCondition]);

  return (
    <div style={{
      padding: '3px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: '10px',
    }}>
      {/* Colored dot: red = unconditional, yellow = conditional */}
      <span style={{
        width: 8, height: 8,
        borderRadius: '50%',
        background: condition ? 'var(--warning)' : 'var(--danger)',
        flexShrink: 0,
      }} />
      {/* Node name — clickable to focus */}
      <button
        onClick={onFocus}
        style={{
          flex: 1,
          fontSize: '9px',
          fontFamily: "'JetBrains Mono', monospace",
          color: 'var(--text)',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={nodeTitle}
      >
        {nodeTitle}
      </button>
      {/* Condition display / edit */}
      {editingCondition ? (
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={draft}
          placeholder="out0 > 10"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            if (e.key === 'Enter') commitCondition();
            else if (e.key === 'Escape') setEditingCondition(false);
          }}
          onBlur={commitCondition}
          style={{
            width: 80,
            padding: '1px 4px',
            fontSize: '9px',
            fontFamily: "'JetBrains Mono', monospace",
            background: 'var(--bg-subtle)',
            border: '1px solid var(--warning)',
            borderRadius: 2,
            color: 'var(--text)',
            outline: 'none',
          }}
        />
      ) : condition ? (
        <button
          onClick={() => { setDraft(condition); setEditingCondition(true); }}
          style={{
            fontSize: '8px',
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--warning)',
            background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)',
            borderRadius: 2,
            padding: '0 4px',
            cursor: 'pointer',
            maxWidth: 80,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={`Condition: ${condition}`}
        >
          {condition}
        </button>
      ) : (
        <button
          onClick={() => { setDraft(''); setEditingCondition(true); }}
          style={{
            fontSize: '8px',
            color: 'var(--text-faint)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
          title="Add condition"
        >
          if...
        </button>
      )}
      {/* Remove breakpoint */}
      <button
        onClick={onRemove}
        style={{
          fontSize: '10px',
          color: 'var(--text-faint)',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          lineHeight: 1,
        }}
        title="Remove breakpoint"
      >
        {'\u2715'}
      </button>
    </div>
  );
}

// --- SVG Icons ---

function BugIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2l1.88 1.88" /><path d="M14.12 3.88L16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" /><path d="M6.53 9C4.6 8.8 3 7.1 3 5" /><path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" /><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" /><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function StepIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="5 3 15 12 5 21 5 3" />
      <line x1="19" y1="3" x2="19" y2="21" />
    </svg>
  );
}

function ResumeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="3 3 13 12 3 21 3 3" />
      <polygon points="13 3 23 12 13 21 13 3" />
    </svg>
  );
}

function TraceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { getGraphComplexity } from '../../utils/graphMetrics';
import { Tooltip } from './Tooltip';
import styles from '../../styles/panels.module.css';

const MODE_LABELS: Record<string, string> = {
  idle: 'Idle',
  'dragging-node': 'Dragging',
  'drawing-connection': 'Connecting',
  'box-selecting': 'Selecting',
};

/** Short time-ago formatting for save timestamp */
function saveTimeAgo(ts: number | null): string | null {
  if (!ts) return null;
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/** Context-aware shortcut hints based on current state */
function getShortcutHint(interaction: string, selectedCount: number): string {
  if (interaction === 'drawing-connection') return 'Click port to connect | Right-click or Esc cancel';
  if (interaction === 'box-selecting') return 'Release to select | Shift adds to selection';
  if (interaction === 'dragging-node') return 'Shift+drag for Y-axis | Release to place';
  if (selectedCount > 0) return 'Del delete | Ctrl+D duplicate | Ctrl+G group';
  return 'Double-click add node | Ctrl+K palette | ? shortcuts';
}

export const StatusBar = memo(function StatusBar() {
  const nodeCount = useEditorStore(s => Object.keys(s.nodes).length);
  const connectionCount = useEditorStore(s => Object.keys(s.connections).length);
  const selectedCount = useEditorStore(s => s.selectedIds.size);
  const interaction = useEditorStore(s => s.interaction);
  const snapEnabled = useEditorStore(s => s.snapEnabled);
  const storageWarning = useEditorStore(s => s.storageWarning);
  const dismissStorageWarning = useEditorStore(s => s.dismissStorageWarning);
  const errorStrategy = useEditorStore(s => s.errorStrategy);
  const setErrorStrategy = useEditorStore(s => s.setErrorStrategy);
  const isExecuting = useEditorStore(s => s.isExecuting);
  const executionTotalDuration = useEditorStore(s => s.executionTotalDuration);
  const debugMode = useEditorStore(s => s.debugMode);
  const executionTimedOut = useEditorStore(s => s.executionTimedOut);
  const pausedAtWave = useEditorStore(s => s.pausedAtWave);
  const debugWaves = useEditorStore(s => s.debugWaves);
  const traceNodeId = useEditorStore(s => s.traceNodeId);
  const lastSaveTime = useEditorStore(s => s.lastSaveTime);
  // Cache executionStats to avoid Object.is instability (React 19 rule)
  const execStatsCacheRef = useRef(useEditorStore.getState().executionStats);
  const executionStats = useEditorStore(s => {
    const stats = s.executionStats;
    const cached = execStatsCacheRef.current;
    if (cached.executionCount === stats.executionCount &&
        cached.totalDuration === stats.totalDuration &&
        cached.errorCount === stats.errorCount &&
        cached.totalCacheHits === stats.totalCacheHits &&
        cached.totalNodesExecuted === stats.totalNodesExecuted &&
        cached.lastExecutedAt === stats.lastExecutedAt &&
        cached.timeoutCount === stats.timeoutCount) {
      return cached;
    }
    execStatsCacheRef.current = stats;
    return stats;
  });

  // Periodic tick to keep save timestamp label fresh
  const [, tick] = useState(0);
  useEffect(() => {
    if (!lastSaveTime) return;
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [lastSaveTime]);

  // Active graph name — cache to avoid Object.is instability (React 19 rule)
  const graphNameCacheRef = useRef('');
  const activeGraphName = useEditorStore(s => {
    const name = s.graphTabs[s.activeGraphId]?.name ?? 'Untitled';
    if (name === graphNameCacheRef.current) return graphNameCacheRef.current;
    graphNameCacheRef.current = name;
    return name;
  });

  // Validation summary — cache to avoid Object.is instability (React 19 rule)
  const validationCacheRef = useRef({ errorCount: 0, warningCount: 0, firstErrorNodeId: '' });
  const validationSummary = useEditorStore(s => {
    const errors = s.validationErrors;
    let errorCount = 0;
    let warningCount = 0;
    let firstErrorNodeId = '';
    for (const [nodeId, msgs] of Object.entries(errors)) {
      for (const msg of msgs) {
        if (msg.includes('(warning)')) {
          warningCount++;
        } else {
          errorCount++;
          if (!firstErrorNodeId) firstErrorNodeId = nodeId;
        }
      }
    }
    const cached = validationCacheRef.current;
    if (cached.errorCount === errorCount && cached.warningCount === warningCount && cached.firstErrorNodeId === firstErrorNodeId) {
      return cached;
    }
    validationCacheRef.current = { errorCount, warningCount, firstErrorNodeId };
    return validationCacheRef.current;
  });

  // Show position of single selected node — cache to avoid Object.is instability (React 19 rule)
  const posCacheRef = useRef<[number, number, number] | null>(null);
  const selectedNodePos = useEditorStore(s => {
    if (s.selectedIds.size !== 1) {
      posCacheRef.current = null;
      return null;
    }
    const id = s.selectedIds.values().next().value as string;
    const pos = s.nodes[id]?.position ?? null;
    if (pos && posCacheRef.current &&
        pos[0] === posCacheRef.current[0] &&
        pos[1] === posCacheRef.current[1] &&
        pos[2] === posCacheRef.current[2]) {
      return posCacheRef.current;
    }
    posCacheRef.current = pos;
    return pos;
  });

  const focusFirstError = useCallback(() => {
    if (validationSummary.firstErrorNodeId) {
      useEditorStore.getState().focusNode(validationSummary.firstErrorNodeId);
    }
  }, [validationSummary.firstErrorNodeId]);

  // Aria-live announcement for execution state changes
  const [execAnnouncement, setExecAnnouncement] = useState('');
  const wasExecutingRef = useRef(false);
  useEffect(() => {
    if (isExecuting && !wasExecutingRef.current) {
      setExecAnnouncement('');
      // Clear then set to ensure repeated announcements are read
      requestAnimationFrame(() => setExecAnnouncement('Execution started'));
    } else if (!isExecuting && wasExecutingRef.current) {
      const hasErrors = validationSummary.errorCount > 0 || executionTimedOut;
      setExecAnnouncement('');
      requestAnimationFrame(() => {
        if (executionTimedOut) {
          setExecAnnouncement('Execution timed out');
        } else if (hasErrors) {
          setExecAnnouncement(`Execution completed with ${validationSummary.errorCount} errors`);
        } else {
          setExecAnnouncement(`Execution completed in ${executionTotalDuration.toFixed(1)} milliseconds`);
        }
      });
    }
    wasExecutingRef.current = isExecuting;
  }, [isExecuting, executionTotalDuration, validationSummary.errorCount, executionTimedOut]);

  // Graph complexity tooltip — recompute only when node/connection count changes
  const complexityTooltip = useMemo(() => {
    if (nodeCount === 0) return `${nodeCount} nodes, ${connectionCount} connections`;
    const state = useEditorStore.getState();
    const c = getGraphComplexity(state.nodes, state.connections);
    return `${c.nodeCount} nodes, ${c.connectionCount} connections | Fan-in: ${c.maxFanIn} | Fan-out: ${c.maxFanOut} | Avg connectivity: ${c.avgConnectivity} | Longest path: ${c.longestPath} | Components: ${c.connectedComponents}${c.isolatedNodes > 0 ? ` (${c.isolatedNodes} isolated)` : ''}`;
  }, [nodeCount, connectionCount]);

  const saveTimeLabel = saveTimeAgo(lastSaveTime);
  const shortcutHint = getShortcutHint(interaction, selectedCount);

  return (
    <div className={styles.statusBar}>
      {/* Screen-reader execution announcements */}
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
      >
        {execAnnouncement}
      </span>
      {/* Active graph name */}
      <Tooltip label="Active graph" placement="top">
        <span className={styles.statusItem} style={{ fontWeight: 600, color: 'var(--text-bright)' }}>
          {activeGraphName}
        </span>
      </Tooltip>
      <span className={styles.statusDivider} />

      {/* Node/connection counts with complexity tooltip */}
      <Tooltip label={complexityTooltip} placement="top">
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <span className={styles.statusItem}>
            <span className={styles.statusDot} style={{ background: 'var(--teal)' }} />
            {nodeCount}
          </span>
          <span className={styles.statusItem}>
            <span className={styles.statusDot} style={{ background: 'var(--orange)' }} />
            {connectionCount}
          </span>
        </span>
      </Tooltip>
      {selectedCount > 0 && (
        <>
          <span className={styles.statusDivider} />
          <span className={styles.statusItem}>
            {selectedCount} selected
          </span>
        </>
      )}
      <span className={styles.statusDivider} />

      {/* Execution status indicator */}
      {isExecuting ? (
        <span className={styles.statusItem} style={{ color: 'var(--teal)' }}>
          <span style={{
            display: 'inline-block',
            width: 6, height: 6,
            borderRadius: '50%',
            background: 'var(--teal)',
            marginRight: 4,
            animation: 'pulse 1s ease-in-out infinite',
          }} />
          Running
        </span>
      ) : executionTotalDuration > 0 ? (
        <Tooltip label={`Last execution: ${executionTotalDuration.toFixed(1)}ms`} placement="top">
          <span className={styles.statusItem} style={{ color: 'var(--success)', fontFamily: 'monospace', fontSize: '10px' }}>
            {executionTotalDuration.toFixed(1)}ms
          </span>
        </Tooltip>
      ) : (
        <span className={styles.statusItem} style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
          {MODE_LABELS[interaction] ?? interaction}
        </span>
      )}

      {/* Timeout warning indicator */}
      {executionTimedOut && !isExecuting && (
        <Tooltip
          label={`Execution timed out (${executionStats.timeoutCount || 1} total timeout${(executionStats.timeoutCount || 1) !== 1 ? 's' : ''}). Increase limit in Settings.`}
          placement="top"
        >
          <span className={styles.statusItem} style={{ color: 'var(--warning, #FFB347)', fontWeight: 600, fontSize: '10px' }}>
            Timed out
          </span>
        </Tooltip>
      )}

      {/* Cumulative execution stats — compact metrics */}
      {executionStats.executionCount > 0 && !isExecuting && (
        <Tooltip
          label={`${executionStats.executionCount} runs | Avg ${(executionStats.totalDuration / executionStats.executionCount).toFixed(1)}ms | ${executionStats.errorCount} errors${(executionStats.timeoutCount || 0) > 0 ? ` | ${executionStats.timeoutCount} timeouts` : ''}`}
          placement="top"
        >
          <span className={styles.statusItem} style={{ fontFamily: 'monospace', fontSize: '9px', color: 'var(--text-dim)' }}>
            {'\u00D7'}{executionStats.executionCount}
          </span>
        </Tooltip>
      )}

      {selectedNodePos && (
        <>
          <span className={styles.statusDivider} />
          <span className={styles.statusItem} style={{ fontFamily: 'monospace', fontSize: '10px' }}>
            X:{selectedNodePos[0].toFixed(1)} Z:{selectedNodePos[2].toFixed(1)}
            {Math.abs(selectedNodePos[1]) > 0.01 && (
              <span style={{ color: 'var(--teal)' }}> Y:{selectedNodePos[1].toFixed(1)}</span>
            )}
          </span>
        </>
      )}
      {snapEnabled && (
        <>
          <span className={styles.statusDivider} />
          <Tooltip label="Snap to grid active (G to toggle)" placement="top">
            <span className={styles.statusItem} style={{ color: 'var(--teal)' }}>
              Snap
            </span>
          </Tooltip>
        </>
      )}
      {(validationSummary.errorCount > 0 || validationSummary.warningCount > 0) && (
        <>
          <span className={styles.statusDivider} />
          {validationSummary.firstErrorNodeId ? (
            <Tooltip label="Click to focus first error node" placement="top">
              <button
                className={styles.statusBtn}
                onClick={focusFirstError}
              >
                {validationSummary.errorCount > 0 && (
                  <span style={{ color: 'var(--danger)' }}>
                    {validationSummary.errorCount} error{validationSummary.errorCount !== 1 ? 's' : ''}
                  </span>
                )}
                {validationSummary.errorCount > 0 && validationSummary.warningCount > 0 && ', '}
                {validationSummary.warningCount > 0 && (
                  <span style={{ color: 'var(--warning)' }}>
                    {validationSummary.warningCount} warning{validationSummary.warningCount !== 1 ? 's' : ''}
                  </span>
                )}
              </button>
            </Tooltip>
          ) : (
            <button
              className={styles.statusBtn}
              disabled
            >
              {validationSummary.errorCount > 0 && (
                <span style={{ color: 'var(--danger)' }}>
                  {validationSummary.errorCount} error{validationSummary.errorCount !== 1 ? 's' : ''}
                </span>
              )}
              {validationSummary.errorCount > 0 && validationSummary.warningCount > 0 && ', '}
              {validationSummary.warningCount > 0 && (
                <span style={{ color: 'var(--warning)' }}>
                  {validationSummary.warningCount} warning{validationSummary.warningCount !== 1 ? 's' : ''}
                </span>
              )}
            </button>
          )}
        </>
      )}
      {storageWarning && (
        <>
          <span className={styles.statusDivider} />
          <span className={styles.statusItem} style={{ color: 'var(--warning)' }}>
            {storageWarning}
            <Tooltip label="Dismiss" placement="top">
              <button
                onClick={dismissStorageWarning}
                aria-label="Dismiss warning"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--btn-text)',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '0 4px',
                  marginLeft: 4,
                }}
              >
                ×
              </button>
            </Tooltip>
          </span>
        </>
      )}
      <span className={styles.statusDivider} />
      <Tooltip label={`Error strategy: ${errorStrategy}. Click to toggle.`} placement="top">
        <button
          className={styles.statusBtn}
          role="switch"
          aria-checked={errorStrategy === 'continue'}
          aria-label="Error strategy: continue on errors"
          style={{
            color: errorStrategy === 'continue' ? 'var(--warning)' : 'var(--text-dim)',
          }}
          onClick={() => setErrorStrategy(errorStrategy === 'fail-fast' ? 'continue' : 'fail-fast')}
        >
          {errorStrategy === 'fail-fast' ? 'Fail-fast' : 'Continue'}
        </button>
      </Tooltip>
      {debugMode && (
        <>
          <span className={styles.statusDivider} />
          <Tooltip label="Debug step mode active (Shift+F5 to toggle)" placement="top">
            <span className={styles.statusItem} style={{ color: 'var(--warning)' }}>
              {isExecuting && pausedAtWave >= 0
                ? `Debug: wave ${pausedAtWave + 1}/${debugWaves.length}`
                : 'Debug'}
            </span>
          </Tooltip>
        </>
      )}
      {traceNodeId && (
        <>
          <span className={styles.statusDivider} />
          <Tooltip label="Data flow tracing active (click node to change)" placement="top">
            <span className={styles.statusItem} style={{ color: 'var(--teal)' }}>
              Tracing
            </span>
          </Tooltip>
        </>
      )}

      {/* Right-aligned section: save time + contextual shortcuts */}
      <span className={styles.statusRight}>
        {saveTimeLabel && (
          <Tooltip label="Last auto-save" placement="top">
            <span className={styles.statusItem} style={{ color: 'var(--text-faint)', fontSize: '10px' }}>
              Saved {saveTimeLabel}
            </span>
          </Tooltip>
        )}
        <span className={styles.statusItem} style={{ opacity: 0.5, fontSize: '10px' }}>
          {shortcutHint}
        </span>
        <Tooltip label="Help guide — how to use this editor" placement="top">
          <button
            className={styles.statusBtn}
            onClick={() => window.__openHelpGuide?.()}
            aria-label="Open help guide"
            style={{ color: 'var(--teal)', fontWeight: 700, fontSize: 12, padding: '0 6px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
        </Tooltip>
      </span>
    </div>
  );
});

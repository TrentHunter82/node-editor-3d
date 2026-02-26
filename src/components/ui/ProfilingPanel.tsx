import { memo, useMemo, useCallback, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { getBottleneckNodes, getCacheHitRate, getExecutionTimeline } from '../../utils/profiling';
import styles from '../../styles/panels.module.css';

type SortKey = 'name' | 'type' | 'duration' | 'percent' | 'cache';
type SortDir = 'asc' | 'desc';
type ViewMode = 'chart' | 'table';

export const ProfilingPanel = memo(function ProfilingPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const executionMetrics = useEditorStore(s => s.executionMetrics);
  const executionTotalDuration = useEditorStore(s => s.executionTotalDuration);
  const executionRunCount = useEditorStore(s => s.executionHistory.length);
  const executionStats = useEditorStore(s => s.executionStats);
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const focusNode = useEditorStore(s => s.focusNode);

  const [viewMode, setViewMode] = useState<ViewMode>('chart');
  const [sortKey, setSortKey] = useState<SortKey>('duration');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [hideCached, setHideCached] = useState(false);

  const timeline = useMemo(() => getExecutionTimeline(executionMetrics), [executionMetrics]);
  const bottlenecks = useMemo(() => getBottleneckNodes(executionMetrics, 5), [executionMetrics]);
  const cacheHitRate = useMemo(() => getCacheHitRate(executionMetrics), [executionMetrics]);

  // Memory usage estimate
  const memoryEstimate = useMemo(() => {
    const nodeCount = Object.keys(nodes).length;
    const connCount = Object.keys(connections).length;
    const metricsSize = (() => {
      try { return JSON.stringify(executionMetrics).length; } catch { return 0; }
    })();
    const totalBytes = nodeCount * 500 + connCount * 200 + metricsSize;
    if (totalBytes < 1024) return `~${totalBytes}B`;
    if (totalBytes < 1024 * 1024) return `~${(totalBytes / 1024).toFixed(1)}KB`;
    return `~${(totalBytes / (1024 * 1024)).toFixed(1)}MB`;
  }, [nodes, connections, executionMetrics]);

  // Cache hit/miss counts for ring visualization
  const cacheBreakdown = useMemo(() => {
    const entries = Object.values(executionMetrics);
    const hits = entries.filter(m => m.cacheHit).length;
    const total = entries.length;
    return { hits, misses: total - hits, total };
  }, [executionMetrics]);

  const maxDuration = useMemo(() => {
    if (timeline.length === 0) return 1;
    return Math.max(...timeline.map(e => e.duration), 0.01);
  }, [timeline]);

  // Build table rows with all needed fields
  const tableRows = useMemo(() => {
    const totalDur = executionTotalDuration || 1;
    return Object.entries(executionMetrics).map(([nodeId, metric]) => {
      const node = nodes[nodeId];
      return {
        nodeId,
        name: node?.title ?? nodeId,
        type: node?.type ?? 'unknown',
        duration: metric.duration,
        percent: (metric.duration / totalDur) * 100,
        cacheHit: metric.cacheHit,
      };
    });
  }, [executionMetrics, nodes, executionTotalDuration]);

  // Apply filter and sort to table rows
  const sortedRows = useMemo(() => {
    let rows = hideCached ? tableRows.filter(r => !r.cacheHit) : tableRows;
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'type': cmp = a.type.localeCompare(b.type); break;
        case 'duration': cmp = a.duration - b.duration; break;
        case 'percent': cmp = a.percent - b.percent; break;
        case 'cache': cmp = (a.cacheHit ? 1 : 0) - (b.cacheHit ? 1 : 0); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [tableRows, hideCached, sortKey, sortDir]);

  const handleNodeClick = useCallback((nodeId: string) => {
    focusNode(nodeId);
  }, [focusNode]);

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  if (!open) return null;

  const hasMetrics = Object.keys(executionMetrics).length > 0;
  const bottleneckIds = new Set(bottlenecks.map(b => b.nodeId));

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onClose(); } }}
        role="dialog"
        aria-modal="true"
        aria-label="Execution profiling"
        style={{ maxWidth: 600 }}
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
            Profiling
          </span>
          <div style={{ display: 'flex', gap: 12, fontSize: '10px' }}>
            {hasMetrics && (
              <>
                <span style={{ color: 'var(--text-dim)' }}>
                  Total: <span style={{ color: 'var(--gold)' }}>{executionTotalDuration.toFixed(1)}ms</span>
                </span>
                <span style={{ color: 'var(--text-dim)' }}>
                  Cache: <span style={{ color: cacheHitRate > 50 ? 'var(--success)' : 'var(--text-dim)' }}>
                    {cacheHitRate.toFixed(0)}%
                  </span>
                </span>
                <span style={{ color: 'var(--text-dim)' }}>
                  Runs: <span style={{ color: 'var(--text-dim)' }}>{executionRunCount}</span>
                </span>
                <span style={{ color: 'var(--text-dim)' }}>
                  Nodes: <span style={{ color: 'var(--text-dim)' }}>{Object.keys(executionMetrics).length}</span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Cumulative execution statistics */}
        {executionStats.executionCount > 0 && (
          <div style={{
            padding: '6px 16px',
            borderBottom: '1px solid var(--divider)',
            display: 'flex',
            gap: 16,
            fontSize: '9px',
            fontFamily: "'JetBrains Mono', monospace",
            background: 'color-mix(in srgb, var(--bg-subtle) 50%, transparent)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Runs</span>
              <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{executionStats.executionCount}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg</span>
              <span style={{ color: 'var(--gold)', fontWeight: 700 }}>
                {executionStats.executionCount > 0
                  ? (executionStats.totalDuration / executionStats.executionCount).toFixed(1)
                  : '0'}ms
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cache</span>
              <span style={{ color: executionStats.totalNodesExecuted > 0 && (executionStats.totalCacheHits / executionStats.totalNodesExecuted * 100) > 50 ? 'var(--success)' : 'var(--text-dim)', fontWeight: 700 }}>
                {executionStats.totalNodesExecuted > 0
                  ? (executionStats.totalCacheHits / executionStats.totalNodesExecuted * 100).toFixed(0)
                  : '0'}%
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Errors</span>
              <span style={{ color: executionStats.errorCount > 0 ? 'var(--danger)' : 'var(--text-dim)', fontWeight: 700 }}>
                {executionStats.errorCount}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Memory</span>
              <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{memoryEstimate}</span>
            </div>
            {(executionStats.timeoutCount || 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Timeouts</span>
                <span style={{ color: 'var(--warning, #FFB347)', fontWeight: 700 }}>
                  {executionStats.timeoutCount}
                </span>
              </div>
            )}
            {executionStats.lastExecutedAt && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: 'auto' }}>
                <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last</span>
                <span style={{ color: 'var(--text-dim)' }}>
                  {new Date(executionStats.lastExecutedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Cache hit/miss ring visualization */}
        {hasMetrics && cacheBreakdown.total > 0 && (
          <div style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--divider)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: '10px',
          }}>
            <svg width="32" height="32" viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
              {/* Background ring (misses - gray) */}
              <circle
                cx="18" cy="18" r="14"
                fill="none"
                stroke="var(--text-faint)"
                strokeWidth="4"
                opacity={0.25}
              />
              {/* Foreground ring (hits - green) */}
              {cacheBreakdown.hits > 0 && (
                <circle
                  cx="18" cy="18" r="14"
                  fill="none"
                  stroke="var(--success)"
                  strokeWidth="4"
                  strokeDasharray={`${(cacheBreakdown.hits / cacheBreakdown.total) * 87.96} 87.96`}
                  strokeDashoffset="0"
                  strokeLinecap="round"
                  transform="rotate(-90 18 18)"
                  style={{ transition: 'stroke-dasharray 0.3s ease' }}
                />
              )}
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 700,
                fontSize: '11px',
                color: cacheBreakdown.hits === cacheBreakdown.total ? 'var(--success)' : 'var(--text)',
              }}>
                {cacheBreakdown.hits}/{cacheBreakdown.total} cached
              </span>
              <span style={{
                fontSize: '9px',
                color: 'var(--text-faint)',
              }}>
                {cacheBreakdown.misses} node{cacheBreakdown.misses !== 1 ? 's' : ''} re-executed
              </span>
            </div>
          </div>
        )}

        {/* View mode toggle + filter */}
        {hasMetrics && (
          <div style={{
            padding: '6px 16px',
            borderBottom: '1px solid var(--divider)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '10px',
          }}>
            <button
              onClick={() => setViewMode('chart')}
              style={{
                background: viewMode === 'chart' ? 'var(--teal)' : 'var(--bg-subtle)',
                color: viewMode === 'chart' ? 'var(--bg)' : 'var(--text-dim)',
                border: 'none',
                borderRadius: 4,
                padding: '3px 8px',
                cursor: 'pointer',
                fontSize: '9px',
                fontWeight: 600,
              }}
            >
              Chart
            </button>
            <button
              onClick={() => setViewMode('table')}
              style={{
                background: viewMode === 'table' ? 'var(--teal)' : 'var(--bg-subtle)',
                color: viewMode === 'table' ? 'var(--bg)' : 'var(--text-dim)',
                border: 'none',
                borderRadius: 4,
                padding: '3px 8px',
                cursor: 'pointer',
                fontSize: '9px',
                fontWeight: 600,
              }}
            >
              Table
            </button>
            <div style={{ flex: 1 }} />
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              color: 'var(--text-faint)',
              fontSize: '9px',
            }}>
              <input
                type="checkbox"
                checked={hideCached}
                onChange={e => setHideCached(e.target.checked)}
                style={{ width: 12, height: 12 }}
              />
              Hide cached
            </label>
          </div>
        )}

        {/* Content area */}
        <div className={styles.searchResults} style={{ maxHeight: 400, padding: '4px 0' }}>
          {!hasMetrics && (
            <div style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--text-faint)',
              fontSize: 12,
            }}>
              No profiling data. Execute the graph first.
            </div>
          )}

          {/* Bar chart view */}
          {hasMetrics && viewMode === 'chart' && (
            <>
              {(hideCached ? timeline.filter(e => !executionMetrics[e.nodeId]?.cacheHit) : timeline).map(entry => {
                const node = nodes[entry.nodeId];
                const metric = executionMetrics[entry.nodeId];
                const isBottleneck = bottleneckIds.has(entry.nodeId);
                const barWidth = Math.max((entry.duration / maxDuration) * 100, 2);
                const barColor = metric?.cacheHit ? 'var(--success)' : isBottleneck ? 'var(--danger)' : 'var(--gold)';
                const pct = executionTotalDuration > 0 ? (entry.duration / executionTotalDuration * 100) : 0;

                return (
                  <button
                    key={entry.nodeId}
                    className={styles.searchItem}
                    onClick={() => handleNodeClick(entry.nodeId)}
                    style={{ padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
                      <span style={{
                        fontSize: '10px',
                        color: 'var(--text)',
                        minWidth: 120,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'left',
                      }}>
                        {node?.title ?? entry.nodeId}
                      </span>
                      <div style={{
                        flex: 1,
                        height: 10,
                        background: 'var(--bg-subtle)',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${barWidth}%`,
                          height: '100%',
                          background: barColor,
                          borderRadius: 3,
                          opacity: 0.8,
                          transition: 'width 0.2s ease',
                        }} />
                      </div>
                      <span style={{
                        fontSize: '9px',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: barColor,
                        minWidth: 48,
                        textAlign: 'right',
                        whiteSpace: 'nowrap',
                      }}>
                        {metric?.cacheHit && '\u26A1'}
                        {entry.duration < 1 ? '<1ms' : entry.duration.toFixed(1) + 'ms'}
                      </span>
                      <span style={{
                        fontSize: '8px',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: 'var(--text-faint)',
                        minWidth: 32,
                        textAlign: 'right',
                      }}>
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* Table view */}
          {hasMetrics && viewMode === 'table' && (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '10px',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--divider)' }}>
                  {([
                    ['name', 'Node'],
                    ['type', 'Type'],
                    ['duration', 'Duration'],
                    ['percent', '% Total'],
                    ['cache', 'Cache'],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      style={{
                        padding: '6px 8px',
                        textAlign: key === 'name' || key === 'type' ? 'left' : 'right',
                        color: sortKey === key ? 'var(--teal)' : 'var(--text-faint)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '9px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}{sortArrow(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(row => {
                  const isBottleneck = bottleneckIds.has(row.nodeId);
                  return (
                    <tr
                      key={row.nodeId}
                      onClick={() => handleNodeClick(row.nodeId)}
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNodeClick(row.nodeId); } }}
                      style={{
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--divider)',
                        background: isBottleneck ? 'rgba(255,80,80,0.06)' : undefined,
                        outline: 'none',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--divider)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = isBottleneck ? 'rgba(255,80,80,0.06)' : ''; }}
                    >
                      <td style={{
                        padding: '5px 8px',
                        color: isBottleneck ? 'var(--danger)' : 'var(--text)',
                        maxWidth: 140,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {row.name}
                      </td>
                      <td style={{
                        padding: '5px 8px',
                        color: 'var(--text-faint)',
                        maxWidth: 80,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {row.type}
                      </td>
                      <td style={{
                        padding: '5px 8px',
                        textAlign: 'right',
                        color: row.cacheHit ? 'var(--success)' : isBottleneck ? 'var(--danger)' : 'var(--gold)',
                        whiteSpace: 'nowrap',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <div style={{
                            width: 40,
                            height: 4,
                            background: 'var(--bg-subtle)',
                            borderRadius: 2,
                            overflow: 'hidden',
                            flexShrink: 0,
                          }}>
                            <div style={{
                              width: `${Math.max((row.duration / maxDuration) * 100, 2)}%`,
                              height: '100%',
                              background: row.cacheHit ? 'var(--success)' : isBottleneck ? 'var(--danger)' : 'var(--gold)',
                              borderRadius: 2,
                              opacity: 0.7,
                              transition: 'width 0.2s ease',
                            }} />
                          </div>
                          <span>
                            {row.cacheHit ? '\u26A1' : ''}{row.duration < 1 ? '<1' : row.duration.toFixed(1)}ms
                          </span>
                        </div>
                      </td>
                      <td style={{
                        padding: '5px 8px',
                        textAlign: 'right',
                        color: 'var(--text-faint)',
                      }}>
                        {row.percent.toFixed(1)}%
                      </td>
                      <td style={{
                        padding: '5px 8px',
                        textAlign: 'right',
                        color: row.cacheHit ? 'var(--success)' : 'var(--text-faint)',
                      }}>
                        {row.cacheHit ? 'Yes' : 'No'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Legend */}
        {hasMetrics && (
          <div style={{
            padding: '6px 12px',
            borderTop: '1px solid var(--divider)',
            fontSize: '9px',
            color: 'var(--text-faint)',
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
          }}>
            <span><span style={{ color: 'var(--gold)' }}>{'\u25A0'}</span> Executed</span>
            <span><span style={{ color: 'var(--danger)' }}>{'\u25A0'}</span> Bottleneck</span>
            <span><span style={{ color: 'var(--success)' }}>{'\u26A1'}</span> Cached</span>
          </div>
        )}
      </div>
    </div>
  );
});

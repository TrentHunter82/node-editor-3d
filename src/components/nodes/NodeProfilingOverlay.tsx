import { memo } from 'react';

/** Compute heatmap color: green(fast) -> yellow -> red(slow) based on relative execution time */
export function computeHeatmapColor(
  showHeatmap: boolean,
  metric: { duration: number; cacheHit: boolean } | undefined,
  executionMaxNodeDuration: number,
): string | null {
  if (!showHeatmap || !metric || metric.cacheHit) return null;
  // Normalize: use duration relative to slowest node, clamped 0-1
  const maxDuration = Math.max(executionMaxNodeDuration, 1);
  const t = Math.min(metric.duration / maxDuration, 1);
  // Green(0) -> Yellow(0.5) -> Red(1)
  const r = t < 0.5 ? Math.round(255 * (t * 2)) : 255;
  const g = t < 0.5 ? 255 : Math.round(255 * (1 - (t - 0.5) * 2));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}00`;
}

/** Per-node profiling badge — compact timing display after execution */
export const ProfilingBadge = memo(function ProfilingBadge({ duration, cacheHit }: { duration: number; cacheHit: boolean }) {
  const color = cacheHit ? '#44DD88' : '#FFD700';
  const text = duration < 1 ? '<1ms' : duration.toFixed(1) + 'ms';
  return (
    <div
      title={cacheHit ? `${text} (cached)` : text}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 5px',
        borderRadius: 4,
        background: 'var(--overlay-bg)',
        border: `1px solid ${color}44`,
        fontSize: '8px',
        fontFamily: "'JetBrains Mono', monospace",
        color,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {cacheHit && <span style={{ fontSize: '7px', opacity: 0.7 }}>{'\u26A1'}</span>}
      {text}
    </div>
  );
});

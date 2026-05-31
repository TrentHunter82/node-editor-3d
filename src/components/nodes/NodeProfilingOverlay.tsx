import { memo } from 'react';

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

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

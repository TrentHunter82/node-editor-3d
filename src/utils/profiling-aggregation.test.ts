import { describe, it, expect } from 'vitest';
import { getBottleneckNodes, getCacheHitRate, getExecutionTimeline } from './profiling';
import type { NodeExecutionMetric } from '../types';

// Helper to create a metric entry
function metric(duration: number, cacheHit: boolean, timestamp: number): NodeExecutionMetric {
  return { duration, cacheHit, timestamp };
}

describe('getBottleneckNodes', () => {
  it('returns top N slowest nodes', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(10, false, 0),
      b: metric(50, false, 0),
      c: metric(30, false, 0),
      d: metric(5, false, 0),
      e: metric(40, false, 0),
    };

    const result = getBottleneckNodes(metrics, 3);

    expect(result).toHaveLength(3);
    expect(result[0].duration).toBe(50);
    expect(result[1].duration).toBe(40);
    expect(result[2].duration).toBe(30);
  });

  it('excludes cache hits', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(10, false, 0),
      b: metric(0, true, 0),
      c: metric(20, false, 0),
    };

    const result = getBottleneckNodes(metrics, 3);

    expect(result).toHaveLength(2);
    const nodeIds = result.map(r => r.nodeId);
    expect(nodeIds).not.toContain('b');
    expect(nodeIds).toContain('a');
    expect(nodeIds).toContain('c');
  });

  it('returns all nodes when n > total', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(10, false, 0),
      b: metric(20, false, 0),
    };

    const result = getBottleneckNodes(metrics, 5);

    expect(result).toHaveLength(2);
  });

  it('returns empty for empty metrics', () => {
    const result = getBottleneckNodes({}, 3);

    expect(result).toEqual([]);
  });

  it('sorted by duration descending', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(5, false, 0),
      b: metric(25, false, 0),
      c: metric(15, false, 0),
      d: metric(35, false, 0),
    };

    const result = getBottleneckNodes(metrics, 4);

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].duration).toBeGreaterThanOrEqual(result[i].duration);
    }
  });

  it('returns correct shape { nodeId, duration }', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      node1: metric(42, false, 100),
    };

    const result = getBottleneckNodes(metrics, 1);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ nodeId: 'node1', duration: 42 });
    expect(Object.keys(result[0]).sort()).toEqual(['duration', 'nodeId']);
  });
});

describe('getCacheHitRate', () => {
  it('returns 0 for empty metrics', () => {
    const result = getCacheHitRate({});

    expect(result).toBe(0);
  });

  it('returns 100 when all cache hits', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(0, true, 0),
      b: metric(0, true, 0),
      c: metric(0, true, 0),
    };

    const result = getCacheHitRate(metrics);

    expect(result).toBe(100);
  });

  it('returns 0 when no cache hits', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(10, false, 0),
      b: metric(20, false, 0),
      c: metric(30, false, 0),
    };

    const result = getCacheHitRate(metrics);

    expect(result).toBe(0);
  });

  it('returns correct percentage for mixed', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(0, true, 0),
      b: metric(10, false, 0),
      c: metric(0, true, 0),
      d: metric(20, false, 0),
    };

    const result = getCacheHitRate(metrics);

    expect(result).toBe(50);
  });

  it('returns correct percentage for 1/3', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(0, true, 0),
      b: metric(10, false, 0),
      c: metric(20, false, 0),
    };

    const result = getCacheHitRate(metrics);

    expect(result).toBeCloseTo(33.33, 1);
  });
});

describe('getExecutionTimeline', () => {
  it('returns entries sorted by start time', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(10, false, 300),
      b: metric(20, false, 100),
      c: metric(15, false, 200),
    };

    const result = getExecutionTimeline(metrics);

    expect(result).toHaveLength(3);
    expect(result[0].startTime).toBe(100);
    expect(result[1].startTime).toBe(200);
    expect(result[2].startTime).toBe(300);
    expect(result[0].nodeId).toBe('b');
    expect(result[1].nodeId).toBe('c');
    expect(result[2].nodeId).toBe('a');
  });

  it('returns correct shape { nodeId, startTime, duration }', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      node1: metric(42, false, 500),
    };

    const result = getExecutionTimeline(metrics);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ nodeId: 'node1', startTime: 500, duration: 42 });
    expect(Object.keys(result[0]).sort()).toEqual(['duration', 'nodeId', 'startTime']);
  });

  it('returns empty for empty metrics', () => {
    const result = getExecutionTimeline({});

    expect(result).toEqual([]);
  });

  it('handles nodes with same timestamp', () => {
    const metrics: Record<string, NodeExecutionMetric> = {
      a: metric(10, false, 100),
      b: metric(20, false, 100),
    };

    const result = getExecutionTimeline(metrics);

    expect(result).toHaveLength(2);
    const nodeIds = result.map(r => r.nodeId);
    expect(nodeIds).toContain('a');
    expect(nodeIds).toContain('b');
    expect(result[0].startTime).toBe(100);
    expect(result[1].startTime).toBe(100);
  });
});

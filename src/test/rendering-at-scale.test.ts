/**
 * Rendering at scale — pre-baked label textures + instanced connection lines.
 *
 * Covers the pure logic: the label material cache (sharing, refcounts,
 * eviction, jsdom fallback) and the shared connection-curve geometry that
 * Pipe and InstancedConnectionLines must agree on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  acquireLabel,
  releaseLabel,
  _labelCacheSize,
  _labelRefs,
  _resetLabelCache,
} from '../utils/labelTexture';
import { computeControlPoints, writeBezierSegments, type Vec3 } from '../utils/connectionGeometry';

describe('label texture cache', () => {
  beforeEach(() => { _resetLabelCache(); });

  it('shares one material across acquisitions of the same label', () => {
    const a = acquireLabel('Math', '#c8d6e5');
    const b = acquireLabel('Math', '#c8d6e5');
    expect(a.material).toBe(b.material);
    expect(_labelCacheSize()).toBe(1);
    expect(_labelRefs('Math', '#c8d6e5')).toBe(2);
  });

  it('different text or color gets a different entry', () => {
    const a = acquireLabel('Math', '#c8d6e5');
    const b = acquireLabel('Display', '#c8d6e5');
    const c = acquireLabel('Math', '#ffffff');
    expect(a.material).not.toBe(b.material);
    expect(a.material).not.toBe(c.material);
    expect(_labelCacheSize()).toBe(3);
  });

  it('release decrements refs without evicting below the cap', () => {
    acquireLabel('Math', '#fff');
    releaseLabel('Math', '#fff');
    expect(_labelRefs('Math', '#fff')).toBe(0);
    // Entry stays cached for reuse
    expect(_labelCacheSize()).toBe(1);
  });

  it('produces a positive aspect ratio even without canvas 2D (jsdom)', () => {
    const short = acquireLabel('ab', '#fff');
    const long = acquireLabel('a much longer node title', '#fff');
    expect(short.aspect).toBeGreaterThan(0);
    expect(long.aspect).toBeGreaterThan(short.aspect);
  });

  it('evicts unreferenced entries when over capacity', () => {
    // Fill past the 1024 cap with unreferenced labels
    for (let i = 0; i < 1100; i++) {
      acquireLabel(`label-${i}`, '#fff');
      releaseLabel(`label-${i}`, '#fff');
    }
    expect(_labelCacheSize()).toBeLessThanOrEqual(1024);
  });

  it('never evicts entries that are still referenced', () => {
    const held = acquireLabel('held', '#fff'); // refs = 1, never released
    for (let i = 0; i < 1200; i++) {
      acquireLabel(`bulk-${i}`, '#fff');
      releaseLabel(`bulk-${i}`, '#fff');
    }
    expect(_labelRefs('held', '#fff')).toBe(1);
    const again = acquireLabel('held', '#fff');
    expect(again.material).toBe(held.material);
  });
});

describe('connection curve geometry', () => {
  const start: Vec3 = [0, 0, 0];
  const end: Vec3 = [4, 0, 2];

  it('bezier style spreads control points horizontally with lift', () => {
    const { midA, midB } = computeControlPoints(start, end, 'bezier');
    expect(midA[0]).toBeCloseTo(0 + 4 * 0.4);
    expect(midA[1]).toBeCloseTo(0.15);
    expect(midB[0]).toBeCloseTo(4 - 4 * 0.4);
  });

  it('straight style degenerates to the endpoints', () => {
    const { midA, midB } = computeControlPoints(start, end, 'straight');
    expect(midA).toEqual(start);
    expect(midB).toEqual(end);
  });

  it('right-angle style turns at the horizontal midpoint', () => {
    const { midA, midB } = computeControlPoints(start, end, 'right-angle');
    expect(midA[0]).toBeCloseTo(2);
    expect(midB[0]).toBeCloseTo(2);
    expect(midA[2]).toBeCloseTo(start[2]);
    expect(midB[2]).toBeCloseTo(end[2]);
  });

  it('matches THREE.CubicBezierCurve3 sampling exactly', () => {
    const { midA, midB } = computeControlPoints(start, end, 'organic');
    const segments = 8;
    const out = new Float32Array(segments * 2 * 3);
    const written = writeBezierSegments(out, 0, start, midA, midB, end, segments);
    expect(written).toBe(out.length);

    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(...start),
      new THREE.Vector3(...midA),
      new THREE.Vector3(...midB),
      new THREE.Vector3(...end),
    );
    const probe = new THREE.Vector3();
    for (let i = 1; i <= segments; i++) {
      curve.getPoint(i / segments, probe);
      // Second vertex of segment i-1 is the curve point at t = i/segments
      const base = (i - 1) * 6 + 3;
      expect(out[base]).toBeCloseTo(probe.x, 5);
      expect(out[base + 1]).toBeCloseTo(probe.y, 5);
      expect(out[base + 2]).toBeCloseTo(probe.z, 5);
    }
  });

  it('segments are contiguous (each starts where the previous ended)', () => {
    const { midA, midB } = computeControlPoints(start, end, 'bezier');
    const segments = 8;
    const out = new Float32Array(segments * 2 * 3);
    writeBezierSegments(out, 0, start, midA, midB, end, segments);
    // First vertex is the start point
    expect([out[0], out[1], out[2]]).toEqual([...start]);
    for (let s = 1; s < segments; s++) {
      const prevEnd = (s - 1) * 6 + 3;
      const thisStart = s * 6;
      expect(out[thisStart]).toBe(out[prevEnd]);
      expect(out[thisStart + 1]).toBe(out[prevEnd + 1]);
      expect(out[thisStart + 2]).toBe(out[prevEnd + 2]);
    }
    // Last vertex is the end point
    const lastBase = segments * 6 - 3;
    expect(out[lastBase]).toBeCloseTo(end[0], 5);
    expect(out[lastBase + 1]).toBeCloseTo(end[1], 5);
    expect(out[lastBase + 2]).toBeCloseTo(end[2], 5);
  });
});

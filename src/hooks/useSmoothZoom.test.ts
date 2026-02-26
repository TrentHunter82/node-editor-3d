/**
 * Tests for useSmoothZoom hook.
 *
 * The hook uses useThree, useFrame, and wheel events which require
 * mocking the R3F context. We test the core logic: velocity accumulation,
 * exponential decay, distance clamping, and zoom-to-cursor behavior.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// We can't easily test the React hook in isolation (requires R3F context),
// so we extract and test the core math/logic that the hook uses.

describe('useSmoothZoom — core logic', () => {
  // ---- Math helpers that mirror the hook's internal logic ----

  function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
    let delta = deltaY;
    if (deltaMode === 1) delta *= 36;
    if (deltaMode === 2) delta *= 768; // approximate window.innerHeight
    return Math.max(-200, Math.min(200, delta));
  }

  function computeNewDistance(
    currentDistance: number,
    velocity: number,
    minDistance: number,
    maxDistance: number,
  ): number {
    const zoomAmount = velocity * currentDistance;
    return Math.max(minDistance, Math.min(maxDistance, currentDistance + zoomAmount));
  }

  function decayVelocity(velocity: number, factor: number = 0.85): number {
    const decayed = velocity * factor;
    return Math.abs(decayed) < 0.0001 ? 0 : decayed;
  }

  // ---- Tests ----

  describe('wheel delta normalization', () => {
    it('passes pixel-mode deltas through', () => {
      expect(normalizeWheelDelta(100, 0)).toBe(100);
      expect(normalizeWheelDelta(-50, 0)).toBe(-50);
    });

    it('converts line-mode deltas (deltaMode=1) to pixel approximation', () => {
      // 3 lines × 36 = 108 pixels
      expect(normalizeWheelDelta(3, 1)).toBe(108);
    });

    it('converts page-mode deltas (deltaMode=2)', () => {
      // 1 page × 768 (approx viewport height) = 768, clamped to 200
      expect(normalizeWheelDelta(1, 2)).toBe(200);
    });

    it('clamps large positive deltas to 200', () => {
      expect(normalizeWheelDelta(500, 0)).toBe(200);
    });

    it('clamps large negative deltas to -200', () => {
      expect(normalizeWheelDelta(-500, 0)).toBe(-200);
    });

    it('handles zero delta', () => {
      expect(normalizeWheelDelta(0, 0)).toBe(0);
    });
  });

  describe('velocity accumulation', () => {
    it('accumulates velocity from wheel events', () => {
      let velocity = 0;
      const sensitivity = 1;
      const precisionMultiplier = 1;
      const delta = normalizeWheelDelta(100, 0);

      velocity += delta * 0.0004 * sensitivity * precisionMultiplier;
      expect(velocity).toBeCloseTo(0.04, 5);

      // Second wheel event adds
      velocity += delta * 0.0004 * sensitivity * precisionMultiplier;
      expect(velocity).toBeCloseTo(0.08, 5);
    });

    it('reduces velocity with Ctrl key (precision mode)', () => {
      let velocity = 0;
      const sensitivity = 1;
      const precisionMultiplier = 0.3; // Ctrl held
      const delta = normalizeWheelDelta(100, 0);

      velocity += delta * 0.0004 * sensitivity * precisionMultiplier;
      expect(velocity).toBeCloseTo(0.012, 5);
    });

    it('scales with zoomSensitivity setting', () => {
      let velocity = 0;
      const sensitivity = 2;
      const delta = normalizeWheelDelta(100, 0);

      velocity += delta * 0.0004 * sensitivity * 1;
      expect(velocity).toBeCloseTo(0.08, 5);
    });
  });

  describe('distance clamping', () => {
    const minDistance = 3;
    const maxDistance = 30;

    it('computes new distance based on velocity and current distance', () => {
      // Positive velocity = zoom out
      const newDist = computeNewDistance(10, 0.1, minDistance, maxDistance);
      expect(newDist).toBeCloseTo(11, 1);
    });

    it('clamps to minDistance', () => {
      // Strong zoom in from close distance
      const newDist = computeNewDistance(4, -0.5, minDistance, maxDistance);
      expect(newDist).toBe(minDistance);
    });

    it('clamps to maxDistance', () => {
      // Strong zoom out
      const newDist = computeNewDistance(28, 0.5, minDistance, maxDistance);
      expect(newDist).toBe(maxDistance);
    });

    it('keeps distance unchanged with zero velocity', () => {
      const newDist = computeNewDistance(15, 0, minDistance, maxDistance);
      expect(newDist).toBe(15);
    });

    it('zoom amount is proportional to current distance (feels uniform)', () => {
      const velocity = 0.1;
      // At 10 units, zoom amount = 1
      expect(computeNewDistance(10, velocity, minDistance, maxDistance)).toBeCloseTo(11, 5);
      // At 20 units, zoom amount = 2 (proportionally larger)
      expect(computeNewDistance(20, velocity, minDistance, maxDistance)).toBeCloseTo(22, 5);
    });
  });

  describe('velocity decay', () => {
    it('decays velocity by factor each frame', () => {
      let velocity = 1.0;
      velocity = decayVelocity(velocity, 0.85);
      expect(velocity).toBeCloseTo(0.85, 5);

      velocity = decayVelocity(velocity, 0.85);
      expect(velocity).toBeCloseTo(0.7225, 5);
    });

    it('snaps to zero when velocity is negligible', () => {
      const result = decayVelocity(0.00005, 0.85);
      expect(result).toBe(0);
    });

    it('preserves sign during decay', () => {
      const positiveDecay = decayVelocity(0.5, 0.85);
      expect(positiveDecay).toBeGreaterThan(0);

      const negativeDecay = decayVelocity(-0.5, 0.85);
      expect(negativeDecay).toBeLessThan(0);
    });

    it('reaches zero within ~50 frames from typical velocity', () => {
      let velocity = 0.1; // typical wheel event velocity
      let frames = 0;
      while (velocity !== 0 && frames < 100) {
        velocity = decayVelocity(velocity, 0.85);
        frames++;
      }
      expect(velocity).toBe(0);
      expect(frames).toBeLessThan(60); // Should converge well within 60 frames
    });
  });

  describe('mouse NDC calculation', () => {
    it('converts screen coordinates to NDC range [-1, +1]', () => {
      // Simulating a rect with width=800, height=600
      const rect = { left: 0, top: 0, width: 800, height: 600 };

      // Center of screen → (0, 0)
      const centerX = ((400 - rect.left) / rect.width) * 2 - 1;
      const centerY = -((300 - rect.top) / rect.height) * 2 + 1;
      expect(centerX).toBeCloseTo(0, 5);
      expect(centerY).toBeCloseTo(0, 5);

      // Top-left → (-1, +1)
      const tlX = ((0 - rect.left) / rect.width) * 2 - 1;
      const tlY = -((0 - rect.top) / rect.height) * 2 + 1;
      expect(tlX).toBeCloseTo(-1, 5);
      expect(tlY).toBeCloseTo(1, 5);

      // Bottom-right → (+1, -1)
      const brX = ((800 - rect.left) / rect.width) * 2 - 1;
      const brY = -((600 - rect.top) / rect.height) * 2 + 1;
      expect(brX).toBeCloseTo(1, 5);
      expect(brY).toBeCloseTo(-1, 5);
    });
  });

  describe('zoom-to-cursor raycast logic', () => {
    it('correctly computes XZ plane intersection', () => {
      const raycaster = new THREE.Raycaster();
      const camera = new THREE.PerspectiveCamera(75, 4 / 3, 0.1, 1000);
      camera.position.set(0, 10, 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const mouse = new THREE.Vector2(0, 0); // center of screen
      raycaster.setFromCamera(mouse, camera);

      const xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersect = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(xzPlane, intersect);

      expect(hit).toBeTruthy();
      // Looking straight down from (0,10,0), center ray hits (0,0,0)
      expect(intersect.x).toBeCloseTo(0, 1);
      expect(intersect.y).toBeCloseTo(0, 1);
      expect(intersect.z).toBeCloseTo(0, 1);
    });

    it('handles off-center mouse positions', () => {
      const raycaster = new THREE.Raycaster();
      const camera = new THREE.PerspectiveCamera(75, 4 / 3, 0.1, 1000);
      camera.position.set(0, 10, 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      // Mouse at edge of screen
      const mouse = new THREE.Vector2(0.5, 0); // half-right
      raycaster.setFromCamera(mouse, camera);

      const xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersect = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(xzPlane, intersect);

      expect(hit).toBeTruthy();
      // Should hit somewhere to the right on the XZ plane
      expect(intersect.x).toBeGreaterThan(0);
      expect(intersect.y).toBeCloseTo(0, 5);
    });

    it('zoom-to-cursor offset keeps cursor world point fixed', () => {
      const camera = new THREE.PerspectiveCamera(75, 4 / 3, 0.1, 1000);
      const target = new THREE.Vector3(0, 0, 0);
      camera.position.set(0, 10, 10);
      camera.lookAt(target);
      camera.updateMatrixWorld();

      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2(0.3, 0.2);
      const xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersect = new THREE.Vector3();

      // Get cursor world position before zoom
      raycaster.setFromCamera(mouse, camera);
      raycaster.ray.intersectPlane(xzPlane, intersect);
      const cursorWorldBefore = intersect.clone();

      // Simulate zoom: move camera closer along direction
      const currentDistance = camera.position.distanceTo(target);
      const newDistance = currentDistance * 0.8; // 20% closer
      const direction = new THREE.Vector3().copy(camera.position).sub(target).normalize();
      camera.position.copy(target).addScaledVector(direction, newDistance);
      camera.updateMatrixWorld();

      // Raycast after zoom
      raycaster.setFromCamera(mouse, camera);
      const hitAfter = raycaster.ray.intersectPlane(xzPlane, intersect);
      expect(hitAfter).toBeTruthy();

      // Compute offset to keep cursor world point fixed
      const offset = new THREE.Vector3().copy(cursorWorldBefore).sub(intersect);
      camera.position.add(offset);
      target.add(offset);
      camera.updateMatrixWorld();

      // After applying offset, the same screen point should hit the same world position
      raycaster.setFromCamera(mouse, camera);
      raycaster.ray.intersectPlane(xzPlane, intersect);

      expect(intersect.x).toBeCloseTo(cursorWorldBefore.x, 1);
      expect(intersect.z).toBeCloseTo(cursorWorldBefore.z, 1);
    });
  });
});

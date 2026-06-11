/**
 * BakedLabel — a text label rendered as a cached canvas texture on a plane.
 * Replaces troika `<Text>` where labels appear per-node (titles, LOD labels):
 * unique (text, color) pairs bake once and share one material, so 1000 nodes
 * with repeated titles cost ~dozens of textures instead of 1000 SDF layouts.
 */
import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { acquireLabel, releaseLabel } from '../../utils/labelTexture';

// Shared unit plane — scaled per label
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

interface BakedLabelProps {
  text: string;
  color?: string;
  /** World-space height of the text quad */
  height: number;
  /** Clamp width (shrinks the whole label to fit) */
  maxWidth?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  onDoubleClick?: (e: ThreeEvent<MouseEvent>) => void;
}

export const BakedLabel = memo(function BakedLabel({
  text,
  color = '#c8d6e5',
  height,
  maxWidth,
  position,
  rotation,
  onDoubleClick,
}: BakedLabelProps) {
  // useMemo so the material is available on first render; the effect below
  // owns the acquire/release lifecycle (StrictMode-safe).
  const handle = useMemo(() => {
    const h = acquireLabel(text, color);
    releaseLabel(text, color); // balance the render-time acquire
    return h;
  }, [text, color]);
  useEffect(() => {
    acquireLabel(text, color);
    return () => releaseLabel(text, color);
  }, [text, color]);

  const scale = useMemo((): [number, number, number] => {
    let w = height * handle.aspect;
    let h = height;
    if (maxWidth !== undefined && w > maxWidth) {
      h = h * (maxWidth / w);
      w = maxWidth;
    }
    return [w, h, 1];
  }, [height, maxWidth, handle.aspect]);

  if (!text) return null;

  return (
    <mesh
      geometry={UNIT_PLANE}
      material={handle.material}
      position={position}
      rotation={rotation}
      scale={scale}
      onDoubleClick={onDoubleClick}
    />
  );
});

import { memo } from 'react';
import * as THREE from 'three';
import { useMatcap } from '../../hooks/useMatcap';

// Shared geometry for all screw meshes — allocated once
const SCREW_GEOMETRY = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8);

// Small screw/rivet decorations at corners of the node body
interface NodeDecorationsProps {
  width: number;
  height: number;
  depth: number;
}

export const NodeDecorations = memo(function NodeDecorations({ width, height, depth }: NodeDecorationsProps) {
  const matcap = useMatcap('chrome-dark');

  const hw = width / 2 - 0.12;
  const hd = depth / 2 - 0.12;
  const y = height / 2 + 0.01;

  const corners: [number, number, number][] = [
    [-hw, y, -hd],
    [hw, y, -hd],
    [-hw, y, hd],
    [hw, y, hd],
  ];

  return (
    <group>
      {corners.map((pos, i) => (
        <mesh key={i} position={pos} geometry={SCREW_GEOMETRY}>
          <meshMatcapMaterial matcap={matcap} />
        </mesh>
      ))}
    </group>
  );
});

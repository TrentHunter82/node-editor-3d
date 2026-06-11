import { memo, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { BakedLabel } from './BakedLabel';
import { useMatcap } from '../../hooks/useMatcap';
import { NODE_TYPE_CONFIG } from '../../types';
import type { EditorNode } from '../../types';
import type { MatcapName } from '../../utils/matcap';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../../store/slices/nodeSlice';

const COLOR_MAP: Record<string, MatcapName> = {
  teal: 'plastic-teal',
  orange: 'plastic-orange',
  coral: 'plastic-coral',
  'teal-coral': 'plastic-coral',
};

// Shared unit-sized low-poly geometry for all LOD nodes — scaled per-node
const LOD_GEO = new THREE.BoxGeometry(1, 1, 1);
// Selection outline unit geometry
const LOD_OUTLINE_GEO = new THREE.BoxGeometry(1, 1, 1);

interface NodeLODProps {
  node: EditorNode;
  selected: boolean;
  onSelect: (id: string, e: PointerEvent | MouseEvent) => void;
  /** Show label overlay (used in overview mode) */
  showLabel?: boolean;
}

/**
 * Simplified node representation for distant nodes.
 * No Html overlays, no ports, no animations — just a colored box.
 * This is the LOD version of NodeModule, used when nodes are far from camera.
 * In overview mode, showLabel adds a tiny title overlay.
 */
export const NodeLOD = memo(function NodeLOD({ node, selected, onSelect, showLabel }: NodeLODProps) {
  const colorKey = NODE_TYPE_CONFIG[node.type]?.color ?? 'teal';
  const matcap = useMatcap(COLOR_MAP[colorKey]);

  const handlePointerDown = useCallback((e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onSelect(node.id, e.nativeEvent);
  }, [node.id, onSelect]);

  // Per-node dimensions for variable-size nodes
  const nodeW = node.width ?? DEFAULT_NODE_WIDTH;
  const nodeD = node.height ?? DEFAULT_NODE_HEIGHT;
  const nodeH = 0.5; // Visual Y-thickness (constant)

  const bodyScale = useMemo(() => [nodeW, nodeH, nodeD] as [number, number, number], [nodeW, nodeD]);
  const outlineScale = useMemo(() => [nodeW + 0.06, nodeH + 0.06, nodeD + 0.06] as [number, number, number], [nodeW, nodeD]);

  return (
    <group position={node.position}>
      <mesh geometry={LOD_GEO} scale={bodyScale} onPointerDown={handlePointerDown}>
        <meshMatcapMaterial matcap={matcap} />
      </mesh>
      {selected && (
        <mesh geometry={LOD_OUTLINE_GEO} scale={outlineScale}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.15} depthWrite={false} />
        </mesh>
      )}
      {showLabel && (
        <BakedLabel
          text={node.title}
          position={[0, 0.26, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          height={0.07}
          color="#c8d6e5"
          maxWidth={nodeW - 0.1}
        />
      )}
    </group>
  );
});

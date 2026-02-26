import { useMemo } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';

const GUIDE_COLOR = new THREE.Color('#2EC4B6');
const GUIDE_LENGTH = 40;
const ALIGN_THRESHOLD = 0.15; // How close positions must be to trigger a guide

/**
 * Shows alignment guide lines when a dragged node aligns with other nodes.
 * Renders teal lines at X/Z positions where the dragged node matches
 * another node's coordinate within a threshold.
 */
export function AlignmentGuides() {
  const interaction = useEditorStore(s => s.interaction);
  const selectedIds = useEditorStore(s => s.selectedIds);
  const nodes = useEditorStore(s => s.nodes);

  // Compute alignment guides
  const guides = useMemo(() => {
    if (interaction !== 'dragging-node') return null;

    const selectedNodeIds = new Set<string>();
    const selectedPositions: [number, number, number][] = [];
    for (const id of selectedIds) {
      if (nodes[id]) {
        selectedNodeIds.add(id);
        selectedPositions.push(nodes[id].position);
      }
    }
    if (selectedPositions.length === 0) return null;

    // Use first selected node's position as reference
    const refPos = selectedPositions[0];

    // Collect X and Z positions of non-selected nodes
    const xGuides = new Set<number>();
    const zGuides = new Set<number>();

    for (const node of Object.values(nodes)) {
      if (selectedNodeIds.has(node.id)) continue;
      // Check X alignment
      if (Math.abs(node.position[0] - refPos[0]) < ALIGN_THRESHOLD) {
        xGuides.add(node.position[0]);
      }
      // Check Z alignment
      if (Math.abs(node.position[2] - refPos[2]) < ALIGN_THRESHOLD) {
        zGuides.add(node.position[2]);
      }
    }

    if (xGuides.size === 0 && zGuides.size === 0) return null;
    return { xGuides: [...xGuides], zGuides: [...zGuides] };
  }, [interaction, selectedIds, nodes]);

  if (!guides) return null;

  return (
    <group>
      {/* Z-axis guide lines at matching X positions */}
      {guides.xGuides.map((x, i) => (
        <line key={`x-${i}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([x, 0.03, -GUIDE_LENGTH, x, 0.03, GUIDE_LENGTH]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color={GUIDE_COLOR} transparent opacity={0.35} />
        </line>
      ))}
      {/* X-axis guide lines at matching Z positions */}
      {guides.zGuides.map((z, i) => (
        <line key={`z-${i}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([-GUIDE_LENGTH, 0.03, z, GUIDE_LENGTH, 0.03, z]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color={GUIDE_COLOR} transparent opacity={0.35} />
        </line>
      ))}
    </group>
  );
}

import { useMemo } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';

const GUIDE_COLOR = new THREE.Color('#FFD700');
const GUIDE_LENGTH = 40; // Long enough to span visible area

/**
 * Shows snap guide lines during node drag when snap is enabled.
 * Renders two yellow cross-hair lines at the snapped grid position
 * of the primary dragged node.
 */
export function SnapGuides() {
  const interaction = useEditorStore(s => s.interaction);
  const snapEnabled = useEditorStore(s => s.snapEnabled);
  const selectedIds = useEditorStore(s => s.selectedIds);
  const nodes = useEditorStore(s => s.nodes);
  const gridSnapSize = useSettingsStore(s => s.gridSnapSize);

  // Find the first selected node's position as the reference
  const primaryId = useMemo(() => {
    for (const id of selectedIds) {
      if (nodes[id]) return id;
    }
    return null;
  }, [selectedIds, nodes]);

  const primaryPos = primaryId ? nodes[primaryId]?.position : null;

  if (interaction !== 'dragging-node' || !snapEnabled || !primaryPos) return null;

  const snappedX = Math.round(primaryPos[0] / gridSnapSize) * gridSnapSize;
  const snappedZ = Math.round(primaryPos[2] / gridSnapSize) * gridSnapSize;

  // Fresh Float32Arrays per render. Only renders during drag (not a hot path).
  // Using a key based on snapped position forces R3F to remount geometry when
  // snap position changes, ensuring GPU buffers are updated correctly.
  const xPositions = new Float32Array([
    -GUIDE_LENGTH, 0.02, snappedZ,
     GUIDE_LENGTH, 0.02, snappedZ,
  ]);
  const zPositions = new Float32Array([
    snappedX, 0.02, -GUIDE_LENGTH,
    snappedX, 0.02,  GUIDE_LENGTH,
  ]);

  return (
    <group>
      {/* X-axis guide line (runs along X at snapped Z) */}
      <line key={`x-${snappedZ}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[xPositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={GUIDE_COLOR} transparent opacity={0.25} />
      </line>
      {/* Z-axis guide line (runs along Z at snapped X) */}
      <line key={`z-${snappedX}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[zPositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={GUIDE_COLOR} transparent opacity={0.25} />
      </line>
    </group>
  );
}

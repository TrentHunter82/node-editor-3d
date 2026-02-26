import { memo, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { ThreeEvent } from '@react-three/fiber';

// Larger button geometry for better hit targets (~0.12 units)
const BTN_GEO = new THREE.BoxGeometry(0.12, 0.12, 0.12);

// Action button colors
const LOCK_COLOR = '#FFB800';
const UNLOCK_COLOR = '#90A4AE';
const COLLAPSE_COLOR = '#64B5F6';
const DUPLICATE_COLOR = '#81C784';
const DELETE_COLOR = '#E8453C';

interface ActionButtonProps {
  position: [number, number, number];
  color: string;
  hoverColor: string;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}

/** Single 3D mesh action button with hover scale effect */
function ActionButton({ position, color, hoverColor, onClick }: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);

  const handleOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    if (useEditorStore.getState().interaction === 'idle') {
      document.body.style.cursor = 'pointer';
    }
  }, []);

  const handleOut = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    if (useEditorStore.getState().interaction === 'idle') {
      document.body.style.cursor = 'auto';
    }
  }, []);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick(e);
  }, [onClick]);

  return (
    <mesh
      geometry={BTN_GEO}
      position={position}
      scale={hovered ? 1.3 : 1}
      onClick={handleClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
      onPointerCancel={handleOut}
    >
      <meshBasicMaterial
        color={hovered ? hoverColor : color}
        transparent
        opacity={hovered ? 0.95 : 0.7}
      />
    </mesh>
  );
}

interface NodeQuickActionsProps {
  nodeId: string;
  locked?: boolean;
  /** Node width for positioning along right face */
  nodeW: number;
  /** Node body height */
  currentH: number;
}

/** Vertical strip of 3D mesh action buttons on the right face of the node.
 * Grouped: [Lock, Collapse] gap [Duplicate, Delete] */
export const NodeQuickActions = memo(function NodeQuickActions({ nodeId, locked, nodeW, currentH }: NodeQuickActionsProps) {
  const toggleLock = useEditorStore(s => s.toggleNodeLock);
  const toggleCollapse = useEditorStore(s => s.toggleNodeCollapse);
  const removeNode = useEditorStore(s => s.removeNode);
  const duplicateSelected = useEditorStore(s => s.duplicateSelected);
  const setSelection = useEditorStore(s => s.setSelection);

  const x = nodeW / 2 + 0.12; // Right face, offset for larger buttons
  const spacing = 0.18;       // Increased gap between buttons
  const groupGap = 0.08;      // Extra gap between action groups
  const startY = currentH / 4; // Start near top

  const handleLock = useCallback(() => toggleLock(nodeId), [nodeId, toggleLock]);
  const handleCollapse = useCallback(() => toggleCollapse(nodeId), [nodeId, toggleCollapse]);
  const handleDuplicate = useCallback(() => {
    setSelection(new Set([nodeId]));
    duplicateSelected();
  }, [nodeId, setSelection, duplicateSelected]);
  const handleDelete = useCallback(() => removeNode(nodeId), [nodeId, removeNode]);

  // Group 1: Node state (Lock, Collapse)
  const y0 = startY;
  const y1 = startY - spacing;
  // Group 2: Node operations (Duplicate, Delete) — extra gap after group 1
  const y2 = y1 - spacing - groupGap;
  const y3 = y2 - spacing;

  return (
    <group>
      {/* Group 1: State controls */}
      <ActionButton
        position={[x, y0, 0]}
        color={locked ? LOCK_COLOR : UNLOCK_COLOR}
        hoverColor={locked ? '#FFD54F' : '#B0BEC5'}
        onClick={handleLock}
      />
      <ActionButton
        position={[x, y1, 0]}
        color={COLLAPSE_COLOR}
        hoverColor="#90CAF9"
        onClick={handleCollapse}
      />
      {/* Group 2: Operations */}
      <ActionButton
        position={[x, y2, 0]}
        color={DUPLICATE_COLOR}
        hoverColor="#A5D6A7"
        onClick={handleDuplicate}
      />
      <ActionButton
        position={[x, y3, 0]}
        color={DELETE_COLOR}
        hoverColor="#EF5350"
        onClick={handleDelete}
      />
    </group>
  );
});

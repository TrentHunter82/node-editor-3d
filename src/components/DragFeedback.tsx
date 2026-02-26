import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../store/slices/nodeSlice';

// Shared unit geometry for ghost card — scaled per-node
const GHOST_GEO = new THREE.BoxGeometry(1.4, 0.02, 0.6);
const GHOST_MAT = new THREE.MeshBasicMaterial({
  color: '#2EC4B6',
  transparent: true,
  opacity: 0.15,
});
const GROUP_HIGHLIGHT_GEO = new THREE.PlaneGeometry(1, 1);
const GROUP_HIGHLIGHT_MAT = new THREE.MeshBasicMaterial({
  color: '#2EC4B6',
  transparent: true,
  opacity: 0,
  side: THREE.DoubleSide,
});

// Padding for group bounding box
const GROUP_PAD = 0.6;

/**
 * DragFeedback: Visual feedback during node dragging.
 * - Ghost preview cards at the target drop positions
 * - Group highlight when dragging near/over a group boundary
 */
export function DragFeedback() {
  const interaction = useEditorStore(s => s.interaction);
  const nodes = useEditorStore(s => s.nodes);
  const groups = useEditorStore(s => s.groups);
  const selectedIds = useEditorStore(s => s.selectedIds);

  const ghostRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const groupHighlightRef = useRef<THREE.Mesh>(null);
  const activeGroupRef = useRef<string | null>(null);

  // Compute group bounding boxes
  const groupBounds = useMemo(() => {
    const bounds: Record<string, { minX: number; maxX: number; minZ: number; maxZ: number; cx: number; cz: number; w: number; h: number }> = {};
    for (const group of Object.values(groups)) {
      const members = Object.values(nodes).filter(n => n.groupId === group.id);
      if (members.length === 0) continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const n of members) {
        minX = Math.min(minX, n.position[0]);
        maxX = Math.max(maxX, n.position[0]);
        minZ = Math.min(minZ, n.position[2]);
        maxZ = Math.max(maxZ, n.position[2]);
      }
      minX -= GROUP_PAD;
      maxX += GROUP_PAD;
      minZ -= GROUP_PAD;
      maxZ += GROUP_PAD;
      bounds[group.id] = {
        minX, maxX, minZ, maxZ,
        cx: (minX + maxX) / 2,
        cz: (minZ + maxZ) / 2,
        w: maxX - minX,
        h: maxZ - minZ,
      };
    }
    return bounds;
  }, [groups, nodes]);

  useFrame(({ invalidate }) => {
    const isDragging = interaction === 'dragging-node';

    // Update ghost cards: show at current positions of selected nodes during drag
    for (const [id, mesh] of ghostRefs.current) {
      const node = nodes[id];
      if (isDragging && node && selectedIds.has(id)) {
        mesh.visible = true;
        mesh.position.set(node.position[0], node.position[1] - 0.05, node.position[2]);
        // Scale ghost to match per-node dimensions
        const sx = (node.width ?? DEFAULT_NODE_WIDTH) / DEFAULT_NODE_WIDTH;
        const sz = (node.height ?? DEFAULT_NODE_HEIGHT) / DEFAULT_NODE_HEIGHT;
        mesh.scale.set(sx, 1, sz);
      } else {
        mesh.visible = false;
      }
    }

    // Group drop zone highlighting
    if (isDragging && groupHighlightRef.current) {
      // Find if any selected node is over a group it doesn't belong to
      let bestGroupId: string | null = null;
      for (const nodeId of selectedIds) {
        const node = nodes[nodeId];
        if (!node) continue;
        for (const [gid, b] of Object.entries(groupBounds)) {
          if (node.groupId === gid) continue; // Already in this group
          if (node.position[0] >= b.minX && node.position[0] <= b.maxX &&
              node.position[2] >= b.minZ && node.position[2] <= b.maxZ) {
            bestGroupId = gid;
            break;
          }
        }
        if (bestGroupId) break;
      }

      if (bestGroupId && groupBounds[bestGroupId]) {
        const b = groupBounds[bestGroupId];
        groupHighlightRef.current.visible = true;
        groupHighlightRef.current.position.set(b.cx, -0.09, b.cz);
        groupHighlightRef.current.scale.set(b.w + 0.4, b.h + 0.4, 1);
        // Pulse opacity for visual feedback
        const t = (Date.now() % 1000) / 1000;
        (groupHighlightRef.current.material as THREE.MeshBasicMaterial).opacity = 0.08 + Math.sin(t * Math.PI * 2) * 0.04;
        invalidate();
      } else {
        groupHighlightRef.current.visible = false;
      }
      activeGroupRef.current = bestGroupId;
    } else if (groupHighlightRef.current) {
      groupHighlightRef.current.visible = false;
    }
  });

  // Only render ghost meshes for selected nodes
  const selectedNodeIds = useMemo(() => {
    return Array.from(selectedIds).filter(id => nodes[id]);
  }, [selectedIds, nodes]);

  return (
    <group>
      {/* Ghost preview cards at node positions during drag */}
      {selectedNodeIds.map(id => (
        <mesh
          key={id}
          ref={(mesh: THREE.Mesh | null) => {
            if (mesh) ghostRefs.current.set(id, mesh);
            else ghostRefs.current.delete(id);
          }}
          geometry={GHOST_GEO}
          material={GHOST_MAT}
          visible={false}
        />
      ))}

      {/* Group drop zone highlight */}
      <mesh
        ref={groupHighlightRef}
        geometry={GROUP_HIGHLIGHT_GEO}
        material={GROUP_HIGHLIGHT_MAT}
        rotation-x={-Math.PI / 2}
        visible={false}
      />
    </group>
  );
}

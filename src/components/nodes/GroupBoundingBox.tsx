import { memo, useMemo, useCallback } from 'react';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import { PORT_TYPE_COLORS } from '../../types';
import type { PortType } from '../../types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../../store/slices/nodeSlice';

// Padding around the outermost nodes within the group
const PADDING = 0.6;
// Y position just below nodes
const GROUP_Y = -0.1;

// Shared geometry for the filled ground plane
const PLANE_GEO = new THREE.PlaneGeometry(1, 1);
// Shared geometry for the collapsed group card
const CARD_GEO = new THREE.BoxGeometry(1.4, 0.08, 0.6);
// Shared geometry for boundary port dots on collapsed card
const PORT_SPHERE_GEO = new THREE.SphereGeometry(0.05, 12, 12);

// Palette of group colors, indexed by hash of groupId
const GROUP_PALETTE = [
  '#2EC4B6', '#FF6B35', '#9B59B6', '#E8453C',
  '#3498DB', '#F1C40F', '#1ABC9C', '#E67E22',
];

/** Derive a stable color from a groupId string */
function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return GROUP_PALETTE[Math.abs(hash) % GROUP_PALETTE.length];
}

interface GroupBoundingBoxProps {
  groupId: string;
}

export const GroupBoundingBox = memo(function GroupBoundingBox({ groupId }: GroupBoundingBoxProps) {
  const group = useEditorStore(s => s.groups[groupId]);
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const selectedIds = useEditorStore(s => s.selectedIds);
  const toggleGroupCollapse = useEditorStore(s => s.toggleGroupCollapse);

  // Collect nodes belonging to this group
  const memberNodes = useMemo(() => {
    return Object.values(nodes).filter(n => n.groupId === groupId);
  }, [nodes, groupId]);

  const memberNodeIds = useMemo(() => new Set(memberNodes.map(n => n.id)), [memberNodes]);

  // Calculate bounding box from member node positions + dimensions
  const bounds = useMemo(() => {
    if (memberNodes.length === 0) return null;

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const node of memberNodes) {
      const [x, , z] = node.position;
      const halfW = (node.width ?? DEFAULT_NODE_WIDTH) / 2;
      const halfD = (node.height ?? DEFAULT_NODE_HEIGHT) / 2;
      if (x - halfW < minX) minX = x - halfW;
      if (x + halfW > maxX) maxX = x + halfW;
      if (z - halfD < minZ) minZ = z - halfD;
      if (z + halfD > maxZ) maxZ = z + halfD;
    }

    return {
      minX: minX - PADDING,
      maxX: maxX + PADDING,
      minZ: minZ - PADDING,
      maxZ: maxZ + PADDING,
    };
  }, [memberNodes]);

  // Compute boundary connections (crossing the group boundary) for the collapsed card
  // Returns port type info for rendering visual boundary port dots
  const boundaryInfo = useMemo(() => {
    if (!group?.collapsed) return null;
    const inputPorts: PortType[] = [];
    const outputPorts: PortType[] = [];
    // Deduplicate by (nodeId, portIndex) to show one dot per unique port, not per connection
    const seenOutputs = new Set<string>();
    const seenInputs = new Set<string>();
    for (const conn of Object.values(connections)) {
      const srcIn = memberNodeIds.has(conn.sourceNodeId);
      const tgtIn = memberNodeIds.has(conn.targetNodeId);
      if (srcIn && !tgtIn) {
        const key = `${conn.sourceNodeId}:${conn.sourcePortIndex}`;
        if (!seenOutputs.has(key)) {
          seenOutputs.add(key);
          const srcNode = nodes[conn.sourceNodeId];
          const portDef = srcNode?.outputs?.[conn.sourcePortIndex];
          outputPorts.push(portDef?.portType ?? 'any');
        }
      }
      if (!srcIn && tgtIn) {
        const key = `${conn.targetNodeId}:${conn.targetPortIndex}`;
        if (!seenInputs.has(key)) {
          seenInputs.add(key);
          const tgtNode = nodes[conn.targetNodeId];
          const portDef = tgtNode?.inputs?.[conn.targetPortIndex];
          inputPorts.push(portDef?.portType ?? 'any');
        }
      }
    }
    return { inputPorts, outputPorts };
  }, [group?.collapsed, connections, memberNodeIds, nodes]);

  const handleDoubleClick = useCallback(() => {
    toggleGroupCollapse(groupId);
  }, [groupId, toggleGroupCollapse]);

  if (!group || !bounds) return null;

  const color = group.color ?? colorFromId(groupId);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  // --- COLLAPSED GROUP: render a compact proxy card ---
  if (group.collapsed) {
    const isSelected = [...selectedIds].some(id => memberNodeIds.has(id));
    const inPorts = boundaryInfo?.inputPorts ?? [];
    const outPorts = boundaryInfo?.outputPorts ?? [];

    // Card dimensions for port placement
    const cardHalfW = 0.7; // half of 1.4
    const cardHalfD = 0.3; // half of 0.6

    return (
      <group position={[centerX, 0, centerZ]}>
        {/* Card body */}
        <mesh geometry={CARD_GEO}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={isSelected ? 0.5 : 0.3}
          />
        </mesh>
        {/* Selection outline */}
        {isSelected && (
          <mesh geometry={CARD_GEO} scale={[1.05, 1.2, 1.05]}>
            <meshBasicMaterial color="#ffffff" transparent opacity={0.15} />
          </mesh>
        )}
        {/* Boundary input port dots (left edge) */}
        {inPorts.map((pt, i) => {
          const z = inPorts.length === 1 ? 0 : (i / (inPorts.length - 1) - 0.5) * (cardHalfD * 2 - 0.1);
          return (
            <mesh key={`in-${i}`} geometry={PORT_SPHERE_GEO} position={[-cardHalfW - 0.05, 0, z]}>
              <meshBasicMaterial color={PORT_TYPE_COLORS[pt] ?? PORT_TYPE_COLORS.any} />
            </mesh>
          );
        })}
        {/* Boundary output port dots (right edge) */}
        {outPorts.map((pt, i) => {
          const z = outPorts.length === 1 ? 0 : (i / (outPorts.length - 1) - 0.5) * (cardHalfD * 2 - 0.1);
          return (
            <mesh key={`out-${i}`} geometry={PORT_SPHERE_GEO} position={[cardHalfW + 0.05, 0, z]}>
              <meshBasicMaterial color={PORT_TYPE_COLORS[pt] ?? PORT_TYPE_COLORS.any} />
            </mesh>
          );
        })}
        {/* Card label */}
        <Html center zIndexRange={[0, 0]} style={{ pointerEvents: 'auto', userSelect: 'none' }}>
          <div
            onDoubleClick={handleDoubleClick}
            style={{
              fontFamily: "'Archivo Black', sans-serif",
              fontSize: 11,
              color: 'var(--text-bright)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              textShadow: '0 1px 4px var(--shadow)',
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            <div style={{ color }}>{group.label}</div>
            {group.description && (
              <div style={{ fontSize: 7, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'none', letterSpacing: 0, opacity: 0.6, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {group.description}
              </div>
            )}
            <div style={{ fontSize: 8, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'none', letterSpacing: 0 }}>
              {memberNodes.length} nodes
              {boundaryInfo && (inPorts.length > 0 || outPorts.length > 0) && (
                <span> &middot; {inPorts.length}in/{outPorts.length}out</span>
              )}
            </div>
          </div>
        </Html>
      </group>
    );
  }

  // --- EXPANDED GROUP: render the bounding box ---
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;

  // Border rectangle corners (on XZ plane at GROUP_Y)
  const corners: [number, number, number][] = [
    [bounds.minX, GROUP_Y, bounds.minZ],
    [bounds.maxX, GROUP_Y, bounds.minZ],
    [bounds.maxX, GROUP_Y, bounds.maxZ],
    [bounds.minX, GROUP_Y, bounds.maxZ],
    [bounds.minX, GROUP_Y, bounds.minZ], // close the loop
  ];

  // Auto-size label width based on text length
  const labelMaxWidth = Math.max(80, Math.min(width * 40, 200));

  return (
    <group>
      {/* Semi-transparent filled plane on XZ */}
      <mesh
        geometry={PLANE_GEO}
        position={[centerX, GROUP_Y, centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[width, depth, 1]}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Wireframe border rectangle — color-coded to match group color */}
      <Line
        points={corners}
        color={color}
        lineWidth={2.5}
        transparent
        opacity={0.6}
        raycast={() => {}}
      />

      {/* Group label at top-left corner — auto-sized */}
      <Html
        position={[bounds.minX + 0.1, GROUP_Y + 0.05, bounds.minZ - 0.15]}
        center={false}
        zIndexRange={[0, 0]}
        style={{
          fontFamily: "'Archivo Black', sans-serif",
          fontSize: '11px',
          color,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          whiteSpace: 'nowrap',
          pointerEvents: 'auto',
          userSelect: 'none',
          textShadow: `0 1px 4px var(--shadow), 0 0 8px ${color}33`,
          cursor: 'pointer',
        }}
      >
        <div style={{ maxWidth: labelMaxWidth, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span onDoubleClick={handleDoubleClick}>{group.label}</span>
          {group.description && (
            <div style={{
              fontSize: '8px',
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
              textTransform: 'none',
              letterSpacing: 0,
              marginTop: 2,
              maxWidth: labelMaxWidth,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.7,
            }}>
              {group.description}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
});

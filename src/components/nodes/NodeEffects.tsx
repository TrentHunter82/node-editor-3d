import { useRef, useMemo, useEffect, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { Group, Mesh } from 'three';

// Shared geometry for ground shadow of elevated nodes
const SHADOW_CIRCLE_GEO = new THREE.CircleGeometry(0.4, 16);

const DIFF_HIGHLIGHT_COLORS = {
  added: '#44DD88',
  removed: '#FF4444',
  modified: '#FFD700',
};

/** Diff highlight overlay that fades out over 3 seconds */
export const FadingDiffHighlight = memo(function FadingDiffHighlight({ type, width, height, depth }: {
  type: 'added' | 'removed' | 'modified';
  width: number;
  height: number;
  depth: number;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const startTime = useRef(Date.now());

  // Reset start time when type changes (new highlight)
  useEffect(() => {
    startTime.current = Date.now();
  }, [type]);

  useFrame(({ invalidate }) => {
    if (!matRef.current) return;
    const elapsed = (Date.now() - startTime.current) / 1000; // seconds
    const duration = 3.0; // match the 3-second auto-clear timer
    // Fade from 0.3 to 0 over the duration, with a brief hold at full opacity
    const holdTime = 0.5; // hold at full opacity for 0.5s
    if (elapsed < holdTime) {
      matRef.current.opacity = 0.3;
    } else {
      const fadeProgress = Math.min((elapsed - holdTime) / (duration - holdTime), 1);
      matRef.current.opacity = 0.3 * (1 - fadeProgress);
    }
    // Keep requesting frames while fade is still active (demand mode)
    if (elapsed < duration) {
      invalidate();
    }
  });

  return (
    <RoundedBox args={[width + 0.09, height + 0.09, depth + 0.09]} radius={0.1} smoothness={4}>
      <meshBasicMaterial
        ref={matRef}
        color={DIFF_HIGHLIGHT_COLORS[type]}
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </RoundedBox>
  );
});

/** Brief expanding pulse when a node becomes selected */
export const SelectionPulse = memo(function SelectionPulse({ width, height, depth }: { width: number; height: number; depth: number }) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const scaleRef = useRef<Group>(null);
  const startTime = useRef(Date.now());

  useFrame(({ invalidate }) => {
    if (!matRef.current || !scaleRef.current) return;
    const elapsed = (Date.now() - startTime.current) / 1000;
    const duration = 0.35;
    if (elapsed >= duration) {
      // Hide after animation completes
      matRef.current.opacity = 0;
      return;
    }
    const t = elapsed / duration;
    // Ease-out: fast start, slow end
    const ease = 1 - (1 - t) * (1 - t);
    // Scale expands from 1.0 to 1.15
    const s = 1 + ease * 0.15;
    scaleRef.current.scale.set(s, s, s);
    // Opacity fades from 0.4 to 0
    matRef.current.opacity = 0.4 * (1 - ease);
    invalidate();
  });

  return (
    <group ref={scaleRef}>
      <RoundedBox args={[width + 0.08, height + 0.08, depth + 0.08]} radius={0.1} smoothness={4}>
        <meshBasicMaterial ref={matRef} color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </RoundedBox>
    </group>
  );
});

/** Subgraph node outer frame with hover-pulse animation */
export const SubgraphFrame = memo(function SubgraphFrame({ width, height, depth, hovered }: { width: number; height: number; depth: number; hovered: boolean }) {
  const meshRef = useRef<Mesh>(null);
  const wasHoveredRef = useRef(false);

  useFrame(({ clock, invalidate }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    if (hovered) {
      mat.opacity = 0.14 + Math.sin(clock.getElapsedTime() * 4) * 0.06;
      wasHoveredRef.current = true;
      invalidate();
    } else if (wasHoveredRef.current) {
      // Only reset once on transition from hovered → not hovered
      mat.opacity = 0.12;
      wasHoveredRef.current = false;
      invalidate();
    }
  });

  return (
    <RoundedBox
      ref={meshRef}
      args={[width + 0.04, height + 0.04, depth + 0.04]}
      radius={0.1}
      smoothness={4}
    >
      <meshBasicMaterial color="#E8453C" transparent opacity={0.12} depthWrite={false} />
    </RoundedBox>
  );
});

/** Small chevron button for collapse/expand on the node title bar */
export const CollapseChevron = memo(function CollapseChevron({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={collapsed ? 'Expand' : 'Collapse'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        background: 'var(--btn-bg)',
        border: 'none',
        borderRadius: '3px',
        color: 'var(--text-faint)',
        cursor: 'pointer',
        padding: 0,
        fontSize: '10px',
        lineHeight: 1,
        transition: 'background 0.15s, color 0.15s',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--panel-hover)';
        e.currentTarget.style.color = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--btn-bg)';
        e.currentTarget.style.color = 'var(--text-faint)';
      }}
    >
      {collapsed ? '\u25B6' : '\u25BC'}
    </button>
  );
});

/** Vertical guide line and ground shadow for nodes elevated above Y=0 */
export const ElevationIndicator = memo(function ElevationIndicator({ height }: { height: number }) {
  const linePositions = useMemo(
    () => new Float32Array([0, 0, 0, 0, -height, 0]),
    [height],
  );

  // Shadow grows and fades with height for a realistic drop shadow
  const shadowScale = 1 + height * 0.3;
  const shadowOpacity = Math.max(0.05, 0.25 - height * 0.03);

  return (
    <group>
      {/* Vertical dashed guide line (SketchUp blue axis style) */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[linePositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#4A90D9" transparent opacity={0.5} />
      </line>
      {/* Ground shadow circle — scales up and fades with height */}
      <mesh
        geometry={SHADOW_CIRCLE_GEO}
        position={[0, -height + 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[shadowScale, shadowScale, 1]}
      >
        <meshBasicMaterial color="#000000" transparent opacity={shadowOpacity} depthWrite={false} />
      </mesh>
    </group>
  );
});

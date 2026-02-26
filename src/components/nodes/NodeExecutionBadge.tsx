import { useRef, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { Mesh } from 'three';
import type { ExecutionState } from '../../types';

/** Execution state badge — shows running/complete/error icon */
export const ExecutionBadge = memo(function ExecutionBadge({ state }: { state: ExecutionState }) {
  const colors: Record<string, string> = {
    running: '#FFB800',
    complete: '#44DD88',
    error: '#E8453C',
  };
  const icons: Record<string, string> = {
    running: '\u25CB', // circle (spinner placeholder)
    complete: '\u2713', // check mark
    error: '\u2717', // X mark
  };
  const color = colors[state] ?? '#888';
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      background: color + '33',
      border: `1.5px solid ${color}`,
      fontSize: '10px',
      color,
      fontWeight: 700,
      animation: state === 'running' ? 'spin 1s linear infinite' : undefined,
      userSelect: 'none',
    }}>
      {icons[state]}
    </div>
  );
});

const GLOW_COLORS: Record<string, string> = {
  running: '#FFB800',  // yellow
  complete: '#44DD88', // green
  error: '#E8453C',    // red
};

/** Pulsing/glowing overlay for execution state */
export const ExecutionGlow = memo(function ExecutionGlow({ state, width, height, depth }: { state: string; width: number; height: number; depth: number }) {
  const meshRef = useRef<Mesh>(null);

  useFrame(({ clock, invalidate }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    if (state === 'running') {
      // Pulsing animation
      mat.opacity = 0.12 + Math.sin(clock.getElapsedTime() * 6) * 0.08;
      invalidate(); // Request next frame for continuous animation
    } else if (state === 'complete') {
      // Brief bright flash that fades
      mat.opacity = 0.2;
    } else {
      mat.opacity = 0.15;
    }
  });

  return (
    <RoundedBox
      ref={meshRef}
      args={[width + 0.1, height + 0.1, depth + 0.1]}
      radius={0.12}
      smoothness={4}
    >
      <meshBasicMaterial
        color={GLOW_COLORS[state] ?? '#888'}
        transparent
        opacity={0.15}
        depthWrite={false}
      />
    </RoundedBox>
  );
});

/** Validation error badge — red circle with ! and hover tooltip */
export const ValidationBadgeIcon = memo(function ValidationBadgeIcon({ errors }: { errors: string[] }) {
  const hasWarningOnly = errors.every(e => e.includes('warning'));
  const color = hasWarningOnly ? '#FFB800' : '#E8453C';
  const icon = '!';

  return (
    <div
      title={errors.join('\n')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        background: color + '33',
        border: `1.5px solid ${color}`,
        fontSize: '11px',
        color,
        fontWeight: 700,
        userSelect: 'none',
        cursor: 'help',
        pointerEvents: 'auto',
      }}
    >
      {icon}
    </div>
  );
});

/** Parse execution error message to extract useful parts */
function parseExecError(error: string): { message: string; tip: string | null } {
  // Error format: `${nodeType} "${title}" (${nodeId}): ${rawMsg}${hint} | tip: ${tipText} | inputs: ...`
  const colonIdx = error.indexOf(': ');
  const body = colonIdx >= 0 ? error.slice(colonIdx + 2) : error;

  // Extract tip if present
  const tipMatch = body.match(/\| tip: (.+?)(?:\s*\||$)/);
  const tip = tipMatch ? tipMatch[1].trim() : null;

  // Extract the main message (before any ` | ` metadata)
  const mainMsg = body.split(' | ')[0].trim();

  // Truncate for display
  const message = mainMsg.length > 60 ? mainMsg.slice(0, 60) + '...' : mainMsg;

  return { message, tip };
}

/** Execution error message display */
export const ErrorSummary = memo(function ErrorSummary({ error }: { error: string }) {
  const { message, tip } = parseExecError(error);

  return (
    <div
      title={error}
      style={{
        maxWidth: 180,
        padding: '2px 6px',
        background: 'color-mix(in srgb, var(--danger) 15%, transparent)',
        border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
        borderRadius: 3,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 8,
        color: 'var(--danger)',
        lineHeight: 1.3,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: 'help',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ fontWeight: 600 }}>{message}</div>
      {tip && (
        <div style={{
          color: 'var(--warning)',
          fontSize: 7,
          marginTop: 1,
          whiteSpace: 'normal',
          overflow: 'hidden',
          maxHeight: 24,
        }}>
          tip: {tip}
        </div>
      )}
    </div>
  );
});

import { memo, useState, useCallback, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useEditorStore } from '../../store/editorStore';
import { PORT_TYPE_COLORS } from '../../types';
import type { PortType, EditorNode } from '../../types';
import { isHexColor, formatNum, formatCompact, formatArrayExpanded } from '../../utils/valueFormat';

// Static styles extracted to module scope to avoid allocation on every render
const HTML_STYLE: React.CSSProperties = { pointerEvents: 'none', userSelect: 'none' };
const CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  padding: '2px 6px',
  background: 'rgba(0, 0, 0, 0.7)',
  borderRadius: 4,
  fontSize: 10,
  fontFamily: "'JetBrains Mono', monospace",
  whiteSpace: 'nowrap',
  maxWidth: 220,
  overflow: 'hidden',
};
const SWATCH_STYLE: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 2,
  border: '1px solid rgba(255,255,255,0.2)',
  flexShrink: 0,
};
const VEC3_LABEL_STYLE: React.CSSProperties = {
  fontSize: 8,
  opacity: 0.5,
  marginRight: 1,
};
const ARRAY_BADGE_STYLE: React.CSSProperties = {
  fontSize: 8,
  padding: '0 3px',
  borderRadius: 2,
  background: 'rgba(74, 144, 217, 0.25)',
  border: '1px solid rgba(74, 144, 217, 0.3)',
  color: '#8CB4E0',
  fontWeight: 600,
};
const OBJECT_BADGE_STYLE: React.CSSProperties = {
  fontSize: 8,
  padding: '0 3px',
  borderRadius: 2,
  background: 'rgba(155, 89, 182, 0.25)',
  border: '1px solid rgba(155, 89, 182, 0.3)',
  color: '#C49BD9',
  fontWeight: 600,
};
const EXPANDED_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: '3px 6px',
  background: 'rgba(0, 0, 0, 0.85)',
  borderRadius: 4,
  fontSize: 9,
  fontFamily: "'JetBrains Mono', monospace",
  maxWidth: 240,
  maxHeight: 100,
  overflow: 'hidden',
  pointerEvents: 'auto',
  cursor: 'pointer',
};

/** Shallow-compare two output records (same keys + same values by ===) */
function outputsEqual(a: Record<number, unknown> | undefined, b: Record<number, unknown> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/** Compact execution result label shown below nodes in 3D scene */
export const ValuePreview = memo(function ValuePreview({ nodeId, position }: { nodeId: string; position: [number, number, number] }) {
  // Cache object selectors via useRef for React 19 Object.is stability
  const outputsRef = useRef<Record<number, unknown> | undefined>(undefined);
  const outputs = useEditorStore(s => {
    const next = s.nodeOutputs[nodeId];
    if (outputsEqual(outputsRef.current, next)) return outputsRef.current;
    outputsRef.current = next;
    return next;
  });
  const showPreview = useEditorStore(s => s.showValuePreviews);
  const nodeRef = useRef<EditorNode | undefined>(undefined);
  const node = useEditorStore(s => {
    const next = s.nodes[nodeId];
    if (next === nodeRef.current) return nodeRef.current;
    nodeRef.current = next;
    return next;
  });
  const [expandedPort, setExpandedPort] = useState<number | null>(null);

  const toggleExpand = useCallback((portIndex: number) => {
    setExpandedPort(prev => prev === portIndex ? null : portIndex);
  }, []);

  if (!showPreview || !outputs || !node) return null;
  if (node.type === 'display') return null;

  const entries = Object.entries(outputs);
  if (entries.length === 0) return null;

  // Position below the node body
  const previewPos: [number, number, number] = [position[0], position[1] - 0.15, position[2]];

  return (
    <group position={previewPos}>
      <Html center zIndexRange={[0, 0]} wrapperClass="html-no-events" style={expandedPort !== null ? { pointerEvents: 'auto', userSelect: 'none' } : HTML_STYLE}>
        {expandedPort !== null ? (
          <ExpandedView
            val={outputs[expandedPort]}
            portType={node.outputs[expandedPort]?.portType ?? 'any'}
            onClose={() => setExpandedPort(null)}
          />
        ) : (
          <div style={CONTAINER_STYLE}>
            {entries.map(([portStr, val]) => {
              const portIndex = Number(portStr);
              const portDef = node.outputs[portIndex];
              const portType: PortType = portDef?.portType ?? 'any';
              const color = PORT_TYPE_COLORS[portType] ?? '#888';

              // Color swatch for color outputs
              if (portType === 'color' && typeof val === 'string' && isHexColor(val)) {
                return (
                  <span key={portStr} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <span style={{ ...SWATCH_STYLE, background: val }} />
                    <span style={{ color: '#c0c8d0', fontSize: 9 }}>{val}</span>
                  </span>
                );
              }

              // Vector3 display for vector outputs
              if (portType === 'vector3' && Array.isArray(val) && val.length === 3) {
                return (
                  <span key={portStr} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#c0c8d0' }}>
                    <span style={{ ...VEC3_LABEL_STYLE, color: '#E8453C' }}>x</span>{formatNum(val[0])}
                    <span style={{ ...VEC3_LABEL_STYLE, color: '#44DD88' }}>y</span>{formatNum(val[1])}
                    <span style={{ ...VEC3_LABEL_STYLE, color: '#4A90D9' }}>z</span>{formatNum(val[2])}
                  </span>
                );
              }

              // Boolean display with colored indicator
              if (portType === 'boolean' || typeof val === 'boolean') {
                const boolVal = Boolean(val);
                return (
                  <span key={portStr} style={{ color: boolVal ? '#44DD88' : '#E8453C', fontWeight: 600 }}>
                    {boolVal ? 'true' : 'false'}
                  </span>
                );
              }

              // Array display with length badge and click-to-expand
              if (Array.isArray(val)) {
                return (
                  <span
                    key={portStr}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: val.length > 3 ? 'pointer' : 'default', pointerEvents: val.length > 3 ? 'auto' : 'none' }}
                    onClick={val.length > 3 ? () => toggleExpand(portIndex) : undefined}
                  >
                    <span style={ARRAY_BADGE_STYLE}>{val.length}</span>
                    <span style={{ color }}>{formatCompact(val)}</span>
                  </span>
                );
              }

              // Object display with key count badge
              if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                const keys = Object.keys(val as Record<string, unknown>);
                return (
                  <span key={portStr} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <span style={OBJECT_BADGE_STYLE}>{keys.length}</span>
                    <span style={{ color: '#C49BD9', fontSize: 9 }}>
                      {keys.length <= 2 ? keys.join(', ') : `{${keys.length} keys}`}
                    </span>
                  </span>
                );
              }

              return (
                <span key={portStr} style={{ color }}>
                  {formatCompact(val)}
                </span>
              );
            })}
          </div>
        )}
      </Html>
    </group>
  );
});

/** Expanded view for arrays — shows first N elements */
function ExpandedView({ val, portType, onClose }: { val: unknown; portType: PortType; onClose: () => void }) {
  const color = PORT_TYPE_COLORS[portType] ?? '#888';

  if (!Array.isArray(val)) {
    return (
      <div style={EXPANDED_STYLE} onClick={onClose}>
        <span style={{ color }}>{formatCompact(val, 40)}</span>
      </div>
    );
  }

  const lines = formatArrayExpanded(val, 5);
  const hasMore = val.length > 5;

  return (
    <div style={EXPANDED_STYLE} onClick={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <span style={ARRAY_BADGE_STYLE}>{val.length}</span>
        <span style={{ color: '#8CB4E0', fontSize: 8 }}>items</span>
      </div>
      {lines.map((line, i) => (
        <span key={i} style={{ color: '#c0c8d0', fontSize: 9 }}>{line}</span>
      ))}
      {hasMore && (
        <span style={{ color: '#667788', fontSize: 8, fontStyle: 'italic' }}>
          ...and {val.length - 5} more
        </span>
      )}
      <span style={{ color: '#556677', fontSize: 7, marginTop: 2 }}>click to collapse</span>
    </div>
  );
}

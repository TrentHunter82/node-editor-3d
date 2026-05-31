import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { EditorNode, ExecutionState } from '../../types';
import { NODE_TYPE_CONFIG, PORT_TYPE_COLORS } from '../../types';
import { DEFAULT_NODE_WIDTH } from '../../store/slices/nodeSlice';
import { OutputReadout, DisplayReadout, ScrubLabel, ConnectionDots } from './ScreenExtras';
import { NODE_SCREEN_FIELDS, FIELD_TYPE_TO_PORT } from './nodeFields';
import type { FieldDef, FieldType } from './nodeFields';
import { isScreenOccluded } from '../../utils/nodeBodyRegistry';

import { ACCENT_HEX, hexToRgba, pushUndoOnFocus, setDataDirect } from './nodeScreenHelpers';

// Re-export for backward compatibility (used by tests, other modules)
export type { FieldType, FieldDef } from './nodeFields';
export { NODE_SCREEN_FIELDS } from './nodeFields';

// --- Non-color styles (module-scoped constants) ---

const SCREEN_STYLE_STATIC: React.CSSProperties = {
  background: 'rgba(5, 10, 20, 1)',
  borderRadius: '6px',
  padding: '10px 12px',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: '11px',
  color: '#c8d6e5',
  width: '210px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  position: 'relative' as const,
  overflow: 'hidden',
  pointerEvents: 'none',
};

const SCANLINE_STYLE_BASE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  borderRadius: '6px',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  marginBottom: '6px',
  borderRadius: '4px',
  padding: '2px 0',
  transition: 'background 0.1s',
};

const LABEL_STYLE_STATIC: React.CSSProperties = {
  fontSize: '8px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  flexShrink: 0,
  userSelect: 'none',
};

const INPUT_STYLE_STATIC: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.03)',
  borderRadius: '4px',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: '11px',
  fontWeight: 600,
  padding: '4px 6px',
  outline: 'none',
  flex: 1,
  minWidth: 0,
  transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
  pointerEvents: 'auto',
};

const ERROR_STYLE: React.CSSProperties = {
  color: 'var(--danger)',
  fontSize: '9px',
  marginTop: '4px',
  padding: '2px 4px',
  background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
  borderRadius: '2px',
  wordBreak: 'break-word',
};

// Title header strip — provides clear node identity at the top of the screen
// 12px + 700 weight makes it the most prominent element (values are 11px/600)
const HEADER_STYLE_STATIC: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '5px 8px',
  margin: '-10px -12px 6px',
  borderRadius: '5px 5px 0 0',
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// Section label (PARAMS / OUTPUTS headers)
const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: '7px',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  opacity: 0.7,
  marginBottom: 3,
};

// Separator line between sections
const SECTION_DIVIDER_STYLE: React.CSSProperties = {
  height: 1,
  opacity: 0.25,
  margin: '6px 0',
};

// --- CRT keyframes CSS builder ---

function buildKeyframesCss(accentHex: string): string {
  const glow02 = hexToRgba(accentHex, 0.2);
  const glow04 = hexToRgba(accentHex, 0.4);
  return `
@keyframes ns-poweron {
  0%   { clip-path: inset(49% 0 49% 0); filter: brightness(1.8); opacity: 0.6; }
  40%  { clip-path: inset(4% 0 4% 0); filter: brightness(1.2); opacity: 1; }
  85%  { clip-path: inset(0 0 0 0); filter: brightness(0.9); opacity: 0.92; }
  100% { clip-path: inset(0 0 0 0); filter: brightness(1); opacity: 1; }
}
@keyframes ns-exec-pulse {
  0%, 100% { box-shadow: 0 0 8px ${glow02}, inset 0 0 12px ${glow02}; }
  50%      { box-shadow: 0 0 20px ${glow04}, inset 0 0 24px ${glow04}; }
}
@keyframes ns-exec-flash {
  0%   { box-shadow: 0 0 24px rgba(68, 221, 136, 0.6); border-color: rgba(68, 221, 136, 0.8); }
  100% { box-shadow: 0 0 8px rgba(68, 221, 136, 0); border-color: ${hexToRgba(accentHex, 0.4)}; }
}
.ns-boot { animation: ns-poweron 0.6s ease-out forwards; }
.ns-exec-running { animation: ns-exec-pulse 1.2s ease-in-out infinite; }
.ns-exec-complete { animation: ns-exec-flash 0.4s ease-out forwards; }
[data-nodescreen] input:hover,
[data-nodescreen] select:hover,
[data-nodescreen] textarea:hover {
  background: rgba(255, 255, 255, 0.06) !important;
}
[data-nodescreen] input:focus,
[data-nodescreen] select:focus,
[data-nodescreen] textarea:focus {
  background: rgba(255, 255, 255, 0.04) !important;
  box-shadow: 0 0 0 1.5px var(--fc, ${hexToRgba(accentHex, 0.5)});
  border-color: var(--fc, ${hexToRgba(accentHex, 0.5)}) !important;
}
[data-nodescreen] button:hover {
  background: rgba(255, 255, 255, 0.1) !important;
}
`;
}

/** Stop pointer/click events on interactive elements from reaching the R3F canvas */
const STOP_PROPAGATION_HANDLERS = {
  onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); },
  onPointerUp: (e: React.PointerEvent) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); },
  onPointerMove: (e: React.PointerEvent) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); },
  onClick: (e: React.MouseEvent) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); },
};

/** Stop keyboard events from reaching global handlers */
const stopKey = (e: React.KeyboardEvent) => {
  e.stopPropagation();
  // Also stop the native event so window-level listeners don't see it
  e.nativeEvent.stopImmediatePropagation();
};

// --- Field renderers ---

// Stepper buttons for number fields (+/- increment/decrement)
const STEPPER_BTN_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '16px',
  height: '16px',
  background: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '3px',
  color: 'var(--text)',
  fontSize: '10px',
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
  fontFamily: "'JetBrains Mono', monospace",
  flexShrink: 0,
  transition: 'background 0.1s',
  pointerEvents: 'auto',
};

// Module-scoped style overrides to avoid per-render object creation
const SELECT_OVERRIDES: React.CSSProperties = { cursor: 'pointer', appearance: 'auto' as const };
const COLOR_OVERRIDES: React.CSSProperties = { width: '32px', height: '20px', padding: '1px', cursor: 'pointer' };
const TEXTAREA_OVERRIDES: React.CSSProperties = { width: '100%', resize: 'vertical' };
const BOOLEAN_STYLE: React.CSSProperties = { cursor: 'pointer', accentColor: '#2EC4B6', pointerEvents: 'auto' };

interface FieldProps {
  nodeId: string;
  field: FieldDef;
  value: unknown;
  inputStyle: React.CSSProperties;
}

function NumberField({ nodeId, field, value, inputStyle }: FieldProps) {
  const storeValue = (typeof value === 'number' && !Number.isNaN(value)) ? value : 0;
  const [localStr, setLocalStr] = useState<string | null>(null);
  const [flashInvalid, setFlashInvalid] = useState(false);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoPushed = useRef(false);

  useEffect(() => {
    return () => {
      if (flashTimeout.current !== null) clearTimeout(flashTimeout.current);
    };
  }, []);

  const onFocus = useCallback(() => {
    undoPushed.current = false;
  }, []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalStr(raw);
    if (!undoPushed.current) {
      pushUndoOnFocus();
      undoPushed.current = true;
    }
    const v = parseFloat(raw);
    if (!isNaN(v)) {
      setDataDirect(nodeId, field.key, v);
    } else if (raw !== '' && raw !== '-' && raw !== '.' && raw !== '-.') {
      setFlashInvalid(true);
      if (flashTimeout.current !== null) clearTimeout(flashTimeout.current);
      flashTimeout.current = setTimeout(() => {
        setFlashInvalid(false);
        flashTimeout.current = null;
      }, 300);
    }
  }, [nodeId, field.key]);

  const onBlur = useCallback(() => {
    setLocalStr(null);
  }, []);

  const style = useMemo(() => ({
    ...inputStyle,
    transition: 'border-color 0.15s',
    ...(flashInvalid ? { borderColor: 'rgba(232, 69, 60, 0.8)' } : {}),
  }), [inputStyle, flashInvalid]);

  const handleStep = useCallback((delta: number) => {
    if (!undoPushed.current) {
      pushUndoOnFocus();
      undoPushed.current = true;
    }
    const current = typeof value === 'number' ? value : 0;
    setDataDirect(nodeId, field.key, current + delta);
  }, [nodeId, field.key, value]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flex: 1, minWidth: 0 }}>
      <button
        style={STEPPER_BTN_STYLE}
        onClick={() => handleStep(-1)}
        onKeyDown={stopKey}
        onKeyUp={stopKey}
        title="Decrease"
        aria-label={`Decrease ${field.label}`}
      >-</button>
      <input
        type="number"
        value={localStr ?? storeValue}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={stopKey}
        onKeyUp={stopKey}
        step="any"
        style={style}
        aria-label={field.label}
      />
      <button
        style={STEPPER_BTN_STYLE}
        onClick={() => handleStep(1)}
        onKeyDown={stopKey}
        onKeyUp={stopKey}
        title="Increase"
        aria-label={`Increase ${field.label}`}
      >+</button>
    </div>
  );
}

function TextField({ nodeId, field, value, inputStyle }: FieldProps) {
  const strValue = typeof value === 'string' ? value : '';
  const undoPushed = useRef(false);

  const onFocus = useCallback(() => {
    undoPushed.current = false;
  }, []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!undoPushed.current) {
      pushUndoOnFocus();
      undoPushed.current = true;
    }
    setDataDirect(nodeId, field.key, e.target.value);
  }, [nodeId, field.key]);

  return (
    <input
      type="text"
      value={strValue}
      onChange={onChange}
      onFocus={onFocus}
      onKeyDown={stopKey}
      onKeyUp={stopKey}
      style={inputStyle}
      aria-label={field.label}
    />
  );
}

function SelectField({ nodeId, field, value, inputStyle }: FieldProps) {
  const strValue = typeof value === 'string' ? value : (field.options?.[0] ?? '');

  // Select is a single-action change, so use the normal undo-pushing action
  const updateNodeData = useEditorStore(s => s.updateNodeData);
  const onChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(nodeId, field.key, e.target.value);
  }, [nodeId, field.key, updateNodeData]);

  const mergedStyle = useMemo(() => ({ ...inputStyle, ...SELECT_OVERRIDES }), [inputStyle]);

  return (
    <select
      value={strValue}
      onChange={onChange}
      onKeyDown={stopKey}
      onKeyUp={stopKey}
      style={mergedStyle}
      aria-label={field.label}
    >
      {field.options?.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

function ColorField({ nodeId, field, value, inputStyle }: FieldProps) {
  const colorValue = typeof value === 'string' ? value : '#ffffff';
  const undoPushed = useRef(false);

  const onFocus = useCallback(() => {
    undoPushed.current = false;
  }, []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!undoPushed.current) {
      pushUndoOnFocus();
      undoPushed.current = true;
    }
    setDataDirect(nodeId, field.key, e.target.value);
  }, [nodeId, field.key]);

  const mergedStyle = useMemo(() => ({ ...inputStyle, ...COLOR_OVERRIDES }), [inputStyle]);

  return (
    <input
      type="color"
      value={colorValue}
      onChange={onChange}
      onFocus={onFocus}
      onKeyDown={stopKey}
      onKeyUp={stopKey}
      style={mergedStyle}
      aria-label={field.label}
    />
  );
}

function TextareaField({ nodeId, field, value, inputStyle }: FieldProps) {
  const strValue = typeof value === 'string' ? value : '';
  const undoPushed = useRef(false);

  const onFocus = useCallback(() => {
    undoPushed.current = false;
  }, []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!undoPushed.current) {
      pushUndoOnFocus();
      undoPushed.current = true;
    }
    setDataDirect(nodeId, field.key, e.target.value);
  }, [nodeId, field.key]);

  const mergedStyle = useMemo(() => ({ ...inputStyle, ...TEXTAREA_OVERRIDES }), [inputStyle]);

  return (
    <textarea
      value={strValue}
      onChange={onChange}
      onFocus={onFocus}
      onKeyDown={stopKey}
      onKeyUp={stopKey}
      rows={3}
      style={mergedStyle}
      aria-label={field.label}
    />
  );
}

function BooleanField({ nodeId, field, value }: FieldProps) {
  const checked = typeof value === 'boolean' ? value : value !== false && value !== 0 && value !== '' && value != null;
  const updateNodeData = useEditorStore(s => s.updateNodeData);
  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(nodeId, field.key, e.target.checked);
  }, [nodeId, field.key, updateNodeData]);

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onKeyDown={stopKey}
      onKeyUp={stopKey}
      style={BOOLEAN_STYLE}
      aria-label={field.label}
    />
  );
}

const FIELD_COMPONENTS: Record<FieldType, React.ComponentType<FieldProps>> = {
  number: NumberField,
  text: TextField,
  select: SelectField,
  color: ColorField,
  textarea: TextareaField,
  boolean: BooleanField,
};

// --- Execution state class helper ---

function execClassName(execState: ExecutionState | undefined): string {
  switch (execState) {
    case 'running': return 'ns-exec-running';
    case 'complete': return 'ns-exec-complete';
    default: return '';
  }
}

// --- Main component ---

interface NodeScreenProps {
  node: EditorNode;
  currentH: number;
  nodeW?: number;
  nodeD?: number;
}

export const NodeScreen = memo(function NodeScreen({ node, currentH, nodeW, nodeD }: NodeScreenProps) {
  const fields = useMemo(() => NODE_SCREEN_FIELDS[node.type] ?? [], [node.type]);
  const execState = useEditorStore(s => s.executionStates[node.id]) as ExecutionState | undefined;
  const execError = useEditorStore(s => s.executionErrors[node.id]) as string | undefined;

  // Resolve accent color from node type
  const accentHex = useMemo(() => {
    const colorKey = NODE_TYPE_CONFIG[node.type].color;
    return ACCENT_HEX[colorKey] ?? ACCENT_HEX.teal;
  }, [node.type]);

  // Scale screen width proportionally with node width.
  // Use 185px baseline (not 210) to leave a gap at corners for resize handles.
  const scaledWidth = nodeW != null ? Math.round(185 * nodeW / DEFAULT_NODE_WIDTH) : 185;

  // Safety net: limit screen height to mesh depth so content never overflows the 3D box
  const maxScreenH = nodeD != null ? Math.round(nodeD * 110) : undefined;

  // Memoized color-dependent styles
  const screenStyle = useMemo<React.CSSProperties>(() => ({
    ...SCREEN_STYLE_STATIC,
    width: `${scaledWidth}px`,
    ...(maxScreenH != null ? { maxHeight: `${maxScreenH}px` } : {}),
    border: execState === 'error'
      ? '1px solid var(--danger)'
      : `1px solid ${hexToRgba(accentHex, 0.4)}`,
    boxShadow: `0 0 14px ${hexToRgba(accentHex, 0.2)}, inset 0 0 20px ${hexToRgba(accentHex, 0.03)}`,
  }), [accentHex, execState, scaledWidth, maxScreenH]);

  const labelStyle = useMemo<React.CSSProperties>(() => ({
    ...LABEL_STYLE_STATIC,
    color: hexToRgba(accentHex, 0.5),
  }), [accentHex]);

  const inputStyle = useMemo<React.CSSProperties>(() => ({
    ...INPUT_STYLE_STATIC,
    border: `1px solid ${hexToRgba(accentHex, 0.2)}`,
  }), [accentHex]);

  const scanlineStyle = useMemo<React.CSSProperties>(() => ({
    ...SCANLINE_STYLE_BASE,
    background: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${hexToRgba(accentHex, 0.04)} 2px, ${hexToRgba(accentHex, 0.04)} 4px)`,
  }), [accentHex]);

  // Title header strip — accent-colored background for clear node identity
  const headerStyle = useMemo<React.CSSProperties>(() => ({
    ...HEADER_STYLE_STATIC,
    color: hexToRgba(accentHex, 0.95),
    background: hexToRgba(accentHex, 0.12),
    borderBottom: `1px solid ${hexToRgba(accentHex, 0.2)}`,
  }), [accentHex]);

  // Memoized CRT keyframes CSS
  const keyframesCss = useMemo(() => buildKeyframesCss(accentHex), [accentHex]);

  // Memoized per-field row styles to avoid GC pressure from inline objects in map loop
  const fieldRowStyles = useMemo(() => {
    const map: Record<string, React.CSSProperties> = {};
    for (const field of fields) {
      const isFullWidth = field.type === 'textarea';
      const fieldColor = PORT_TYPE_COLORS[FIELD_TYPE_TO_PORT[field.type]];
      const fieldColorFaded = hexToRgba(fieldColor, 0.5);
      map[field.key] = {
        ...(isFullWidth ? { marginBottom: '4px' } : ROW_STYLE),
        borderLeft: `2px solid ${hexToRgba(fieldColor, 0.4)}`,
        paddingLeft: '6px',
        '--fc': fieldColorFaded,
      } as React.CSSProperties;
    }
    return map;
  }, [fields]);

  // Memoized section label color style
  const sectionLabelStyle = useMemo<React.CSSProperties>(
    () => ({ ...SECTION_LABEL_STYLE, color: hexToRgba(accentHex, 0.5) }),
    [accentHex],
  );

  // Dynamic className
  const className = useMemo(() => {
    const parts = ['ns-boot'];
    const execClass = execClassName(execState);
    if (execClass) parts.push(execClass);
    return parts.join(' ');
  }, [execState]);

  const screenRef = useRef<HTMLDivElement>(null);
  const screenGroupRef = useRef<Group>(null);

  // Custom occlusion: hide screen when another node's body is in front.
  // Directly manipulates DOM (no React state / no invalidation) to avoid
  // infinite render loops with frameloop="demand".
  useFrame(({ camera }) => {
    if (!screenRef.current || !screenGroupRef.current) return;
    const hidden = isScreenOccluded(camera, screenGroupRef.current, node.id);
    screenRef.current.style.display = hidden ? 'none' : '';
  });

  const isCustom = node.type === 'custom';

  if (fields.length === 0 && !isCustom) return null;

  return (
    <group ref={screenGroupRef} position={[0, currentH / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <Html
        transform
        center
        zIndexRange={[50, 0]}
        style={{ pointerEvents: 'none' }}
        scale={0.3}
      >
        <div
          ref={screenRef}
          data-nodescreen
          className={className}
          style={screenStyle}
        >
          <style>{keyframesCss}</style>
          <div style={scanlineStyle} />
          {/* Title header strip — clear node identity */}
          <div style={headerStyle}>{node.title}</div>
          {/* Params section header */}
          {fields.length > 0 && (
            <div style={sectionLabelStyle}>
              params
            </div>
          )}
          {fields.map(field => {
            const Component = FIELD_COMPONENTS[field.type];
            const isNumber = field.type === 'number';
            const numValue = typeof node.data[field.key] === 'number' ? (node.data[field.key] as number) : 0;

            return (
              <div
                key={field.key}
                style={fieldRowStyles[field.key]}
                {...STOP_PROPAGATION_HANDLERS}
              >
                {isNumber ? (
                  <ScrubLabel nodeId={node.id} fieldKey={field.key} value={numValue} accentHex={accentHex}>
                    {field.label}
                  </ScrubLabel>
                ) : (
                  <span style={labelStyle}>{field.label}</span>
                )}
                <Component nodeId={node.id} field={field} value={node.data[field.key]} inputStyle={inputStyle} />
              </div>
            );
          })}
          {isCustom && (
            <div {...STOP_PROPAGATION_HANDLERS} style={{ pointerEvents: 'auto' }}>
              <CustomNodeExtras
                nodeId={node.id}
                node={node}
                labelStyle={labelStyle}
                accentHex={accentHex}
              />
            </div>
          )}
          {/* Section separator + outputs (or display readout for display nodes) */}
          <div style={{ ...SECTION_DIVIDER_STYLE, background: hexToRgba(accentHex, 1) }} />
          <div>
            {node.type === 'display' ? (
              <DisplayReadout nodeId={node.id} accentHex={accentHex} format={node.data.format as string | undefined} />
            ) : (
              <OutputReadout nodeId={node.id} accentHex={accentHex} />
            )}
          </div>
          {execState === 'error' && execError && (
            <div role="alert" style={ERROR_STYLE}>{execError}</div>
          )}
          <ConnectionDots nodeId={node.id} inputs={node.inputs} outputs={node.outputs} accentHex={accentHex} />
        </div>
      </Html>
    </group>
  );
});

// --- Custom node extras: port count controls, variable hints, syntax help ---

const COUNTER_BTN_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  background: 'var(--btn-bg)',
  border: '1px solid var(--btn-border)',
  borderRadius: '3px',
  color: 'var(--text)',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
  fontFamily: "'JetBrains Mono', monospace",
  pointerEvents: 'auto',
};

interface CustomNodeExtrasProps {
  nodeId: string;
  node: EditorNode;
  labelStyle: React.CSSProperties;
  accentHex: string;
}

function CustomNodeExtras({ nodeId, node, labelStyle, accentHex }: CustomNodeExtrasProps) {
  const updateCustomNodePorts = useEditorStore(s => s.updateCustomNodePorts);
  const [showHint, setShowHint] = useState(false);

  const inputCount = node.inputs.length;
  const outputCount = node.outputs.length;

  const handleInputChange = useCallback((delta: number) => {
    updateCustomNodePorts(nodeId, inputCount + delta, outputCount);
  }, [nodeId, inputCount, outputCount, updateCustomNodePorts]);

  const handleOutputChange = useCallback((delta: number) => {
    updateCustomNodePorts(nodeId, inputCount, outputCount + delta);
  }, [nodeId, inputCount, outputCount, updateCustomNodePorts]);

  return (
    <>
      {/* Port count controls */}
      <div style={{ ...ROW_STYLE, marginTop: '4px' }}>
        <span style={labelStyle}>Inputs</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            style={COUNTER_BTN_STYLE}
            onClick={() => handleInputChange(-1)}
            disabled={inputCount <= 0}
            onKeyDown={stopKey}
            onKeyUp={stopKey}
            aria-label="Remove input port"
          >-</button>
          <span style={{ fontSize: '11px', color: 'var(--text)', minWidth: '14px', textAlign: 'center' }}>
            {inputCount}
          </span>
          <button
            style={COUNTER_BTN_STYLE}
            onClick={() => handleInputChange(1)}
            disabled={inputCount >= 8}
            onKeyDown={stopKey}
            onKeyUp={stopKey}
            aria-label="Add input port"
          >+</button>
        </div>
      </div>
      <div style={ROW_STYLE}>
        <span style={labelStyle}>Outputs</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            style={COUNTER_BTN_STYLE}
            onClick={() => handleOutputChange(-1)}
            disabled={outputCount <= 1}
            onKeyDown={stopKey}
            onKeyUp={stopKey}
            aria-label="Remove output port"
          >-</button>
          <span style={{ fontSize: '11px', color: 'var(--text)', minWidth: '14px', textAlign: 'center' }}>
            {outputCount}
          </span>
          <button
            style={COUNTER_BTN_STYLE}
            onClick={() => handleOutputChange(1)}
            disabled={outputCount >= 8}
            onKeyDown={stopKey}
            onKeyUp={stopKey}
            aria-label="Add output port"
          >+</button>
        </div>
      </div>

      {/* Input variable labels */}
      {inputCount > 0 && (
        <div style={{ marginTop: '2px', marginBottom: '2px' }}>
          <span style={{ ...labelStyle, fontSize: '8px', color: hexToRgba(accentHex, 0.5) }}>
            vars: {Array.from({ length: inputCount }, (_, i) => `in${i}`).join(', ')}
          </span>
        </div>
      )}

      {/* Syntax hint toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
        <button
          onClick={() => setShowHint(v => !v)}
          onKeyDown={stopKey}
          onKeyUp={stopKey}
          style={{
            background: 'none',
            border: 'none',
            color: hexToRgba(accentHex, 0.6),
            fontSize: '10px',
            cursor: 'pointer',
            padding: '1px 3px',
            borderRadius: '3px',
            fontFamily: "'JetBrains Mono', monospace",
          }}
          title="Show expression syntax help"
          aria-label="Show expression syntax help"
          aria-expanded={showHint}
        >
          {showHint ? '\u25BC' : '?'} syntax
        </button>
      </div>
      {showHint && (
        <div style={{
          fontSize: '9px',
          color: 'var(--btn-text)',
          background: 'var(--bg-subtle)',
          borderRadius: '3px',
          padding: '4px 6px',
          marginTop: '2px',
          lineHeight: 1.4,
        }}>
          <div><b>Variables:</b> in0, in1, in2, ...</div>
          <div><b>Math:</b> Math.sin, Math.abs, Math.PI</div>
          <div><b>Examples:</b></div>
          <div style={{ color: 'var(--text-faint)', paddingLeft: '6px' }}>
            in0 * 2 + in1<br />
            Math.sin(in0) * 100<br />
            in0 {'>'} 0 ? in1 : in2
          </div>
        </div>
      )}
    </>
  );
}

import { useState, useCallback, useRef, memo } from 'react';
import { Html } from '@react-three/drei';
import { NODE_TYPE_CONFIG } from '../../types';
import type { EditorNode } from '../../types';
import { useEditorStore } from '../../store/editorStore';
import { ACCENT_HEX, pushUndoOnFocus, setDataDirect } from './nodeScreenHelpers';
import { formatCompact } from '../../utils/valueFormat';

/** Which data fields to show inline per node type */
const INLINE_FIELDS: Partial<Record<string, { key: string; label: string }[]>> = {
  source: [{ key: 'value', label: 'val' }],
  transform: [{ key: 'multiplier', label: '\u00D7' }, { key: 'offset', label: '+' }],
  filter: [{ key: 'threshold', label: 'thr' }],
  random: [{ key: 'min', label: 'min' }, { key: 'max', label: 'max' }],
  math: [{ key: 'operation', label: 'op' }],
  compare: [{ key: 'mode', label: 'cmp' }],
  clamp: [{ key: 'min', label: 'min' }, { key: 'max', label: 'max' }],
  remap: [{ key: 'inMin', label: 'in' }, { key: 'outMin', label: 'out' }],
  lerp: [{ key: 't', label: 't' }],
  'string-case': [{ key: 'mode', label: 'case' }],
  'string-split': [{ key: 'delimiter', label: 'delim' }],
  concat: [{ key: 'separator', label: 'sep' }],
  template: [{ key: 'defaultTemplate', label: 'tpl' }],
  // display: handled specially — shows live value instead of data field
  output: [{ key: 'format', label: 'fmt' }],
  timer: [{ key: 'intervalMs', label: 'ms' }],
  'color-picker': [{ key: 'color', label: 'col' }],
  'color-mix': [{ key: 't', label: 'mix' }],
  'http-fetch': [{ key: 'url', label: 'url' }],
};

/** Stop events from reaching R3F / global handlers */
const stopInlineEvent = (e: React.SyntheticEvent) => {
  e.stopPropagation();
  e.nativeEvent.stopImmediatePropagation();
};

export const InlineValueOverlay = memo(function InlineValueOverlay({ node, currentH }: { node: EditorNode; currentH: number }) {
  const isDisplay = node.type === 'display';
  const fields = INLINE_FIELDS[node.type];
  if (!fields && !isDisplay) return null;

  const colorKey = NODE_TYPE_CONFIG[node.type]?.color ?? 'teal';
  const accentHex = ACCENT_HEX[colorKey] ?? ACCENT_HEX.teal;

  return (
    <Html
      position={[0, currentH / 2 + 0.005, 0.15]}
      center
      distanceFactor={6}
      zIndexRange={[0, 0]}
      wrapperClass="html-no-events"
      style={{ pointerEvents: 'none' }}
    >
      <div
        style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          padding: '2px 6px',
          borderRadius: '4px',
          background: 'var(--overlay-bg)',
          border: `1px solid ${accentHex}33`,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        {isDisplay ? (
          <DisplayInlineValue nodeId={node.id} accentHex={accentHex} />
        ) : (
          fields!.map(f => (
            <InlineField
              key={f.key}
              nodeId={node.id}
              fieldKey={f.key}
              label={f.label}
              value={node.data[f.key]}
              accentHex={accentHex}
            />
          ))
        )}
      </div>
    </Html>
  );
});

/** Live value display for display nodes when NodeScreen is hidden */
const DisplayInlineValue = memo(function DisplayInlineValue({ nodeId, accentHex }: { nodeId: string; accentHex: string }) {
  const value = useEditorStore(s => s.nodeOutputs[nodeId]?.[0] ?? null);
  const displayStr = value === null || value === undefined
    ? '\u2014'
    : formatCompact(value, 18);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
      <span style={{ color: `${accentHex}88`, fontSize: '8px' }}>val</span>
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{displayStr}</span>
    </span>
  );
});

const InlineField = memo(function InlineField({ nodeId, fieldKey, label, value, accentHex }: {
  nodeId: string;
  fieldKey: string;
  label: string;
  value: unknown;
  accentHex: string;
}) {
  const [editing, setEditing] = useState(false);
  const [localStr, setLocalStr] = useState('');
  const undoPushed = useRef(false);

  const isNumber = typeof value === 'number';
  const displayValue = isNumber ? (Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(2))) : String(value ?? '');

  const startEdit = useCallback(() => {
    if (!isNumber) return; // Only numbers are inline-editable
    setLocalStr(String(value));
    setEditing(true);
    undoPushed.current = false;
  }, [value, isNumber]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const v = parseFloat(localStr);
    if (!isNaN(v)) {
      if (!undoPushed.current) {
        pushUndoOnFocus();
        undoPushed.current = true;
      }
      setDataDirect(nodeId, fieldKey, v);
    }
  }, [localStr, nodeId, fieldKey]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  }, [commitEdit]);

  // Scrub support: drag on label to adjust value
  const scrubStart = useRef<{ x: number; startVal: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!isNumber || editing) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrubStart.current = { x: e.clientX, startVal: value as number };
    undoPushed.current = false;
  }, [value, isNumber, editing]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!scrubStart.current) return;
    e.stopPropagation();
    const dx = e.clientX - scrubStart.current.x;
    if (Math.abs(dx) < 2) return;
    if (!undoPushed.current) {
      pushUndoOnFocus();
      undoPushed.current = true;
    }
    const sensitivity = e.shiftKey ? 0.01 : 0.1;
    const newVal = scrubStart.current.startVal + dx * sensitivity;
    setDataDirect(nodeId, fieldKey, Math.round(newVal * 100) / 100);
  }, [nodeId, fieldKey]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!scrubStart.current) return;
    e.stopPropagation();
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    // If barely moved, start text editing
    const dx = Math.abs(e.clientX - scrubStart.current.x);
    if (dx < 4) startEdit();
    scrubStart.current = null;
  }, [startEdit]);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    if (!scrubStart.current) return;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    scrubStart.current = null;
  }, []);

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', pointerEvents: 'auto' }}>
        <span style={{ color: `${accentHex}88`, fontSize: '8px' }}>{label}</span>
        <input
          autoFocus
          type="number"
          step="any"
          value={localStr}
          onChange={e => setLocalStr(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          onKeyUp={stopInlineEvent}
          style={{
            width: '48px',
            background: 'var(--btn-bg)',
            border: `1px solid ${accentHex}66`,
            borderRadius: '2px',
            color: 'var(--text)',
            fontFamily: 'inherit',
            fontSize: '10px',
            padding: '1px 3px',
            outline: 'none',
            pointerEvents: 'auto',
          }}
        />
      </span>
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        cursor: isNumber ? 'ew-resize' : 'default',
        // Only capture pointer events for number fields (scrub-to-adjust).
        // String/display fields are read-only — let events pass through to the 3D mesh.
        pointerEvents: isNumber ? 'auto' : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span style={{ color: `${accentHex}88`, fontSize: '8px' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{displayValue}</span>
    </span>
  );
});

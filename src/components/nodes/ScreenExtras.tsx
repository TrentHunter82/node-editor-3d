import { useCallback, useRef, useState, useEffect, memo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { hexToRgba, pushUndoOnFocus, setDataDirect } from './nodeScreenHelpers';
import { formatNumberPrecision, formatCompact } from '../../utils/valueFormat';

// ---------------------------------------------------------------------------
// MiniSparkline
// ---------------------------------------------------------------------------

interface MiniSparklineProps {
  data: number[];
  color: string;
}

export function MiniSparkline({ data, color }: MiniSparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid division by zero
  const w = 80;
  const h = 16;
  const pad = 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width={w}
      height={h}
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// OutputReadout
// ---------------------------------------------------------------------------

const READOUT_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '4px',
  fontSize: '9px',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  lineHeight: '14px',
};

function formatOutputValue(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return v.toFixed(3);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'string') return v.length > 20 ? v.slice(0, 20) + '\u2026' : v;
  if (typeof v === 'object') {
    // Compact JSON preview instead of "[object Object]"
    try {
      const json = JSON.stringify(v);
      return json.length > 24 ? json.slice(0, 24) + '\u2026' : json;
    } catch {
      return '{\u2026}';
    }
  }
  return String(v);
}

interface OutputReadoutProps {
  nodeId: string;
  accentHex: string;
}

export const OutputReadout = memo(function OutputReadout({ nodeId, accentHex: _accentHex }: OutputReadoutProps) {
  const outputs = useEditorStore(s => s.nodeOutputs[nodeId]);
  // Sparkline history: mutable ref for the ring buffer, state snapshot for render reads
  const historyRef = useRef<Map<number, number[]>>(new Map());
  const [sparkSnap, setSparkSnap] = useState<Map<number, number[]>>(new Map());

  // Update sparkline history when outputs change, then snapshot for render
  useEffect(() => {
    if (!outputs) return;
    const map = historyRef.current;
    for (const [portStr, val] of Object.entries(outputs)) {
      const port = Number(portStr);
      if (typeof val !== 'number') continue;
      let arr = map.get(port);
      if (!arr) {
        arr = [];
        map.set(port, arr);
      }
      arr.push(val);
      if (arr.length > 20) arr.shift(); // ring buffer of 20
    }
    // Snapshot for render — shallow copy of the map with cloned arrays
    setSparkSnap(new Map(Array.from(map.entries()).map(([k, v]) => [k, [...v]])));
  }, [outputs]);

  if (!outputs) return null;

  const entries = Object.entries(outputs);
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 2 }}>
      <div style={{
        fontSize: '7px',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: '#44DD88',
        opacity: 0.7,
        marginBottom: 3,
      }}>
        outputs
      </div>
      {entries.map(([portStr, val]) => {
        const port = Number(portStr);
        const sparkData = typeof val === 'number' ? sparkSnap.get(port) : undefined;
        return (
          <div key={portStr} style={READOUT_ROW}>
            <span style={{ color: 'rgba(68, 221, 136, 0.7)' }}>OUT{portStr}</span>
            <span style={{ color: 'var(--text)', textAlign: 'right', flex: 1, fontWeight: 600 }}>
              {formatOutputValue(val)}
            </span>
            {sparkData && sparkData.length >= 2 && (
              <MiniSparkline data={sparkData} color="#44DD88" />
            )}
          </div>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
// DisplayReadout — hero value readout for display/sink nodes
// ---------------------------------------------------------------------------

interface DisplayReadoutProps {
  nodeId: string;
  accentHex: string;
  format?: string;
}

function resolveTypeLabel(v: unknown): string {
  if (v === null || v === undefined) return 'no signal';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return typeof v;
}

function formatDisplayValue(v: unknown, fmt: string): string {
  if (v === null || v === undefined) return '\u2014'; // em dash
  if (typeof v === 'number') {
    switch (fmt) {
      case 'fixed': return v.toFixed(4);
      case 'integer': return Math.round(v).toString();
      case 'hex': return '0x' + (Math.round(v) >>> 0).toString(16).toUpperCase();
      case 'json': return JSON.stringify(v);
      default: return formatNumberPrecision(v);
    }
  }
  if (fmt === 'json') {
    try { return JSON.stringify(v, null, 2); } catch { /* fall through */ }
  }
  return formatCompact(v, 24);
}

export const DisplayReadout = memo(function DisplayReadout({ nodeId, accentHex, format }: DisplayReadoutProps) {
  // The display node is a sink (no outputs), so show the value arriving at its
  // input port 0 — resolved through the incoming connection's source output.
  const value = useEditorStore(s => {
    const incoming = Object.values(s.connections).find(
      c => c.targetNodeId === nodeId && c.targetPortIndex === 0
    );
    if (!incoming) return null;
    return s.nodeOutputs[incoming.sourceNodeId]?.[incoming.sourcePortIndex] ?? null;
  });
  const fmt = format ?? 'auto';
  const typeLabel = resolveTypeLabel(value);
  const displayStr = formatDisplayValue(value, fmt);

  // Sparkline history for numeric values
  const historyRef = useRef<number[]>([]);
  const [sparkSnap, setSparkSnap] = useState<number[]>([]);

  useEffect(() => {
    if (typeof value !== 'number') return;
    const arr = historyRef.current;
    arr.push(value);
    if (arr.length > 20) arr.shift();
    setSparkSnap([...arr]);
  }, [value]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4px 0' }}>
      {/* Type indicator label */}
      <span style={{
        fontSize: '7px',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: hexToRgba(accentHex, 0.5),
      }}>
        {typeLabel}
      </span>
      {/* Hero value */}
      <span style={{
        fontSize: '18px',
        fontWeight: 700,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: accentHex,
        textAlign: 'center',
        textShadow: `0 0 8px ${hexToRgba(accentHex, 0.4)}`,
        wordBreak: 'break-all',
        maxWidth: '100%',
        lineHeight: 1.2,
      }}>
        {displayStr}
      </span>
      {/* Sparkline for numeric values */}
      {typeof value === 'number' && sparkSnap.length >= 2 && (
        <MiniSparkline data={sparkSnap} color={accentHex} />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// ScrubLabel
// ---------------------------------------------------------------------------

interface ScrubLabelProps {
  nodeId: string;
  fieldKey: string;
  value: number;
  accentHex: string;
  children: React.ReactNode;
}

const SCRUB_LABEL_STYLE: React.CSSProperties = {
  cursor: 'ew-resize',
  fontSize: '8px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  flexShrink: 0,
  userSelect: 'none',
  pointerEvents: 'auto',
};

export function ScrubLabel({ nodeId, fieldKey, value, accentHex, children }: ScrubLabelProps) {
  const scrubRef = useRef<{
    startX: number;
    startValue: number;
    undoPushed: boolean;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault(); // prevent text selection
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      scrubRef.current = {
        startX: e.clientX,
        startValue: value,
        undoPushed: false,
      };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const scrub = scrubRef.current;
      if (!scrub) return;
      e.stopPropagation();

      if (!scrub.undoPushed) {
        pushUndoOnFocus();
        scrub.undoPushed = true;
      }

      const sensitivity = e.shiftKey ? 0.01 : 0.1;
      const delta = (e.clientX - scrub.startX) * sensitivity;
      setDataDirect(nodeId, fieldKey, scrub.startValue + delta);
    },
    [nodeId, fieldKey],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!scrubRef.current) return;
      e.stopPropagation();
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* may already be released */ }
      scrubRef.current = null;
    },
    [],
  );

  // Release pointer capture if browser interrupts (tab switch, scroll gesture, etc.)
  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!scrubRef.current) return;
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* may already be released */ }
      scrubRef.current = null;
    },
    [],
  );

  return (
    <span
      style={{ ...SCRUB_LABEL_STYLE, color: hexToRgba(accentHex, 0.5) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ConnectionDots
// ---------------------------------------------------------------------------

interface ConnectionDotsProps {
  nodeId: string;
  inputs: { id: string }[];
  outputs: { id: string }[];
  accentHex: string;
}

interface ConnStatus {
  inputs: boolean[];
  outputs: boolean[];
}

export const ConnectionDots = memo(function ConnectionDots({
  nodeId,
  inputs,
  outputs,
  accentHex,
}: ConnectionDotsProps) {
  // Cache selector result in a ref so useSyncExternalStore sees the same
  // reference (Object.is) when the derived data hasn't changed.
  // React 19 requires getSnapshot to return a cached value.
  const cacheRef = useRef<ConnStatus>({ inputs: [], outputs: [] });

  const connStatus = useEditorStore(
    useCallback(
      (s): ConnStatus => {
        const newInputs = inputs.map(() => false);
        const newOutputs = outputs.map(() => false);
        for (const c of Object.values(s.connections)) {
          if (c.targetNodeId === nodeId) newInputs[c.targetPortIndex] = true;
          if (c.sourceNodeId === nodeId) newOutputs[c.sourcePortIndex] = true;
        }
        // Return same reference if unchanged → satisfies Object.is check
        const prev = cacheRef.current;
        if (
          prev.inputs.length === newInputs.length &&
          prev.outputs.length === newOutputs.length &&
          prev.inputs.every((v, i) => v === newInputs[i]) &&
          prev.outputs.every((v, i) => v === newOutputs[i])
        ) {
          return prev;
        }
        const result = { inputs: newInputs, outputs: newOutputs };
        cacheRef.current = result;
        return result;
      },
      [nodeId, inputs, outputs],
    ),
  );

  const dotBase: React.CSSProperties = {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: '50%',
    pointerEvents: 'none',
  };

  const connectedStyle = (hex: string): React.CSSProperties => ({
    ...dotBase,
    background: hex,
    boxShadow: `0 0 4px ${hex}`,
  });

  const disconnectedStyle: React.CSSProperties = {
    ...dotBase,
    background: 'var(--text-dim)',
  };

  return (
    <>
      {/* Input dots on left edge */}
      {connStatus.inputs.map((connected, i) => (
        <div
          key={`in-${i}`}
          style={{
            ...(connected ? connectedStyle(accentHex) : disconnectedStyle),
            left: -3,
            top: 20 + i * 14,
          }}
        />
      ))}
      {/* Output dots on right edge */}
      {connStatus.outputs.map((connected, i) => (
        <div
          key={`out-${i}`}
          style={{
            ...(connected ? connectedStyle(accentHex) : disconnectedStyle),
            right: -3,
            top: 20 + i * 14,
          }}
        />
      ))}
    </>
  );
});

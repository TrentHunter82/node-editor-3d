import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { NODE_TYPE_CONFIG, PORT_TYPE_COLORS, type NodeType, type PortConfig } from '../../types';
import { getNodeLabel, TYPE_DESCRIPTIONS } from '../../types/nodeLabels';
import { TOOLTIP_STYLE } from './Tooltip';
import { useNodeHelp } from '../../hooks/useNodeHelp';
import type { PortHelp } from '../../utils/nodeHelp';

const SHOW_DELAY = 500;
const HIDE_DELAY = 100;
const TOOLTIP_GAP = 10;

interface NodeTypeTooltipProps {
  nodeType: NodeType;
  children: ReactNode;
}

const sectionLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 3,
};

function PortRow({ port }: { port: PortConfig }) {
  const dotColor = PORT_TYPE_COLORS[port.portType] ?? PORT_TYPE_COLORS.any;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 2 }}>
      <span style={{
        display: 'inline-block', width: 6, height: 6, minWidth: 6,
        borderRadius: '50%', background: dotColor, marginTop: 1,
      }} />
      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{port.label}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{port.portType}</span>
      {port.description && (
        <span style={{ color: 'var(--text-dim)', fontSize: 10, marginLeft: 2 }}>
          — {port.description}
        </span>
      )}
    </div>
  );
}

function PortSection({ label, ports, helpPorts }: { label: string; ports: PortConfig[]; helpPorts?: PortHelp[] }) {
  // Build a lookup map from help port names to descriptions
  const helpMap = useMemo(() => {
    if (!helpPorts) return null;
    const map = new Map<string, string>();
    for (const hp of helpPorts) map.set(hp.name.toLowerCase(), hp.description);
    return map;
  }, [helpPorts]);

  return (
    <div style={{ marginTop: 6 }}>
      <div style={sectionLabel}>{label}</div>
      {ports.length === 0
        ? <div style={{ color: 'var(--text-dim)', fontSize: 10, fontStyle: 'italic' }}>
            (no {label.toLowerCase()})
          </div>
        : ports.map((p) => {
            // Overlay help description if the port doesn't already have one
            const enriched = !p.description && helpMap?.has(p.label.toLowerCase())
              ? { ...p, description: helpMap.get(p.label.toLowerCase()) }
              : p;
            return <PortRow key={p.label} port={enriched} />;
          })
      }
    </div>
  );
}

export function NodeTypeTooltip({ nodeType, children }: NodeTypeTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const showTimer = useRef(0);
  const hideTimer = useRef(0);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const computePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return { top: 0, left: 0 };
    const rect = el.getBoundingClientRect();
    const estW = 300;
    const estH = 200;
    let top = rect.top;
    let left = rect.right + TOOLTIP_GAP;
    // If overflowing right, place to the left
    if (left + estW > window.innerWidth - 8) {
      left = rect.left - TOOLTIP_GAP - estW;
    }
    // Clamp vertical
    if (top + estH > window.innerHeight - 8) {
      top = window.innerHeight - 8 - estH;
    }
    if (top < 8) top = 8;
    return { top, left };
  }, []);

  const show = useCallback(() => {
    clearTimeout(hideTimer.current);
    showTimer.current = window.setTimeout(() => {
      setPos(computePosition());
      setVisible(true);
    }, SHOW_DELAY);
  }, [computePosition]);

  const hide = useCallback(() => {
    clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_DELAY);
  }, []);

  useEffect(() => () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  }, []);

  const config = NODE_TYPE_CONFIG[nodeType];
  const name = getNodeLabel(nodeType);
  const help = useNodeHelp(nodeType);
  const description = help?.summary ?? TYPE_DESCRIPTIONS[nodeType];

  const tooltip = visible && pos && createPortal(
    <div style={{
      position: 'fixed',
      top: pos.top,
      left: pos.left,
      zIndex: 300,
      pointerEvents: 'none',
      maxWidth: 320,
      padding: '8px 12px',
      ...TOOLTIP_STYLE,
    }}>
      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2 }}>{name}</div>
      {description && (
        <div style={{ color: 'var(--text-dim)', fontSize: 10, marginBottom: 2 }}>
          {description}
        </div>
      )}
      <PortSection label="Inputs" ports={config.inputs} helpPorts={help?.inputs} />
      <PortSection label="Outputs" ports={config.outputs} helpPorts={help?.outputs} />
      {help?.tips && help.tips.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={sectionLabel}>Tips</div>
          {help.tips.map((tip, i) => (
            <div key={i} style={{ color: 'var(--text-dim)', fontSize: 10, marginBottom: 2, paddingLeft: 8 }}>
              • {tip}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );

  return (
    <span
      ref={triggerRef}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      style={{ display: 'contents' }}
    >
      {children}
      {tooltip}
    </span>
  );
}

import { useState, useRef, useCallback, useEffect, type ReactNode, type CSSProperties } from 'react';

const SHOW_DELAY = 600; // ms before tooltip appears
const HIDE_DELAY = 100; // ms before tooltip disappears (prevents flicker)
const ARROW_SIZE = 5;
const TOOLTIP_GAP = 8;

/** Shared tooltip visual style constants — used by Tooltip and PortTooltip for consistency */
export const TOOLTIP_STYLE = {
  background: 'var(--panel-bg-solid)',
  border: '1px solid var(--panel-border)',
  borderRadius: 5,
  backdropFilter: 'blur(8px)',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  color: 'var(--text)',
  boxShadow: '0 2px 8px var(--overlay-bg)',
} as const;

type Placement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  /** Tooltip text label */
  label: string;
  /** Optional keyboard shortcut to display as a badge (e.g. "Ctrl+Z") */
  shortcut?: string;
  /** Preferred placement (auto-adjusts if clipped) */
  placement?: Placement;
  /** Tooltip content wraps this element */
  children: ReactNode;
}

/** Parse shortcut string into individual key tokens */
function parseShortcut(shortcut: string): string[] {
  return shortcut.split('+').map(k => k.trim());
}

const kbdStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 5px',
  borderRadius: 3,
  background: 'var(--btn-bg)',
  border: '1px solid var(--btn-border)',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  lineHeight: '16px',
  color: 'var(--text-dim)',
};

/**
 * Enhanced tooltip wrapper with delay, keyboard shortcut badges, and smart positioning.
 *
 * Usage:
 *   <Tooltip label="Undo" shortcut="Ctrl+Z">
 *     <button>...</button>
 *   </Tooltip>
 */
export function Tooltip({ label, shortcut, placement = 'right', children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; actualPlacement: Placement } | null>(null);
  const showTimer = useRef(0);
  const hideTimer = useRef(0);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const computePosition = useCallback((preferred: Placement): { top: number; left: number; actualPlacement: Placement } => {
    const el = triggerRef.current;
    if (!el) return { top: 0, left: 0, actualPlacement: preferred };
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Estimate tooltip size (will be approximate)
    const estW = 160;
    const estH = 32;

    const tryPlacement = (p: Placement): { top: number; left: number } | null => {
      let top: number, left: number;
      switch (p) {
        case 'right':
          top = cy - estH / 2;
          left = rect.right + TOOLTIP_GAP;
          break;
        case 'left':
          top = cy - estH / 2;
          left = rect.left - TOOLTIP_GAP - estW;
          break;
        case 'top':
          top = rect.top - TOOLTIP_GAP - estH;
          left = cx - estW / 2;
          break;
        case 'bottom':
          top = rect.bottom + TOOLTIP_GAP;
          left = cx - estW / 2;
          break;
      }
      // Check bounds
      if (left < 4 || left + estW > window.innerWidth - 4) return null;
      if (top < 4 || top + estH > window.innerHeight - 4) return null;
      return { top, left };
    };

    // Try preferred, then fallbacks
    const fallbackOrder: Placement[] = ['right', 'bottom', 'left', 'top'];
    const ordered = [preferred, ...fallbackOrder.filter(p => p !== preferred)];
    for (const p of ordered) {
      const result = tryPlacement(p);
      if (result) return { ...result, actualPlacement: p };
    }
    // Last resort: use preferred anyway
    const fallback = tryPlacement(preferred);
    return { top: fallback?.top ?? 0, left: fallback?.left ?? 0, actualPlacement: preferred };
  }, []);

  const show = useCallback(() => {
    clearTimeout(hideTimer.current);
    showTimer.current = window.setTimeout(() => {
      setPos(computePosition(placement));
      setVisible(true);
    }, SHOW_DELAY);
  }, [placement, computePosition]);

  const hide = useCallback(() => {
    clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setVisible(false);
    }, HIDE_DELAY);
  }, []);

  // Clear pending timers on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    };
  }, []);

  const keys = shortcut ? parseShortcut(shortcut) : null;

  return (
    <span
      ref={triggerRef}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      {children}
      {visible && pos && (
        <div
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 200,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 10px',
            whiteSpace: 'nowrap',
            ...TOOLTIP_STYLE,
          }}
        >
          <span>{label}</span>
          {keys && (
            <span style={{ display: 'flex', gap: 2, marginLeft: 2 }}>
              {keys.map((k, i) => (
                <kbd key={i} style={kbdStyle}>{k}</kbd>
              ))}
            </span>
          )}
          {/* Arrow */}
          <span
            style={{
              position: 'absolute',
              ...(pos.actualPlacement === 'right' ? {
                left: -ARROW_SIZE,
                top: '50%',
                marginTop: -ARROW_SIZE,
                borderRight: `${ARROW_SIZE}px solid var(--panel-bg-solid)`,
                borderTop: `${ARROW_SIZE}px solid transparent`,
                borderBottom: `${ARROW_SIZE}px solid transparent`,
              } : pos.actualPlacement === 'left' ? {
                right: -ARROW_SIZE,
                top: '50%',
                marginTop: -ARROW_SIZE,
                borderLeft: `${ARROW_SIZE}px solid var(--panel-bg-solid)`,
                borderTop: `${ARROW_SIZE}px solid transparent`,
                borderBottom: `${ARROW_SIZE}px solid transparent`,
              } : pos.actualPlacement === 'top' ? {
                bottom: -ARROW_SIZE,
                left: '50%',
                marginLeft: -ARROW_SIZE,
                borderTop: `${ARROW_SIZE}px solid var(--panel-bg-solid)`,
                borderLeft: `${ARROW_SIZE}px solid transparent`,
                borderRight: `${ARROW_SIZE}px solid transparent`,
              } : {
                top: -ARROW_SIZE,
                left: '50%',
                marginLeft: -ARROW_SIZE,
                borderBottom: `${ARROW_SIZE}px solid var(--panel-bg-solid)`,
                borderLeft: `${ARROW_SIZE}px solid transparent`,
                borderRight: `${ARROW_SIZE}px solid transparent`,
              }),
              width: 0,
              height: 0,
            }}
          />
        </div>
      )}
    </span>
  );
}

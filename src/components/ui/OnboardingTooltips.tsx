import { useState, useEffect, useCallback, useRef } from 'react';
import { useSettingsStore } from '../../store/settingsStore';

/** Tooltip definition with target element selector and content */
interface TooltipDef {
  /** CSS selector for the target element to point at */
  selector: string;
  /** Short title */
  title: string;
  /** Brief description */
  text: string;
  /** Arrow direction from tooltip to target */
  arrow: 'left' | 'right' | 'top' | 'bottom';
}

const TOOLTIPS: TooltipDef[] = [
  {
    selector: '[data-ui-panel] > div:nth-child(4)', // Toolbar (4th child)
    title: 'Toolbar',
    text: 'Add nodes, save/load files, and access tools here.',
    arrow: 'left',
  },
  {
    selector: '[aria-label="Node editor canvas"]',
    title: 'Canvas',
    text: 'Double-click to add nodes. Drag to move. Ctrl+K opens search.',
    arrow: 'top',
  },
  {
    selector: '[aria-label="Minimap navigation"]',
    title: 'Minimap',
    text: 'Click to navigate. Drag the viewport rectangle to pan.',
    arrow: 'right',
  },
  {
    selector: '[data-ui-panel] > div:nth-child(5)', // Inspector (5th child)
    title: 'Inspector',
    text: 'Select a node to view and edit its properties here.',
    arrow: 'right',
  },
  {
    selector: '[data-ui-panel] > div:nth-child(7)', // HelpOverlay (7th child)
    title: 'Keyboard Shortcuts',
    text: 'Press ? to see all shortcuts. Press F to zoom to fit.',
    arrow: 'bottom',
  },
];

const ARROW_SIZE = 6;
const MAX_POLL_ATTEMPTS = 120; // ~2 seconds at 60fps before giving up

export function OnboardingTooltips() {
  const onboardingCompleted = useSettingsStore(s => s.onboardingCompleted);
  const setOnboardingCompleted = useSettingsStore(s => s.setOnboardingCompleted);
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Show tooltips after a short delay on first launch
  useEffect(() => {
    if (onboardingCompleted) return;
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, [onboardingCompleted]);

  // Position tooltip near target element — stop polling after element found
  useEffect(() => {
    if (!visible || step >= TOOLTIPS.length) return;
    let attempts = 0;
    let found = false;
    const updatePos = () => {
      const el = document.querySelector(TOOLTIPS[step].selector);
      if (el) {
        setRect(el.getBoundingClientRect());
        found = true;
        // Once found, only re-poll occasionally to track layout shifts
        rafRef.current = window.setTimeout(() => {
          rafRef.current = requestAnimationFrame(updatePos);
        }, 500) as unknown as number;
      } else if (attempts < MAX_POLL_ATTEMPTS) {
        attempts++;
        rafRef.current = requestAnimationFrame(updatePos);
      }
      // After MAX_POLL_ATTEMPTS with no element, stop polling
    };
    updatePos();
    return () => {
      if (found) {
        clearTimeout(rafRef.current);
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, [visible, step]);

  // Auto-focus the dialog when it becomes visible
  useEffect(() => {
    if (!visible || !rect) return;
    requestAnimationFrame(() => {
      const btn = dialogRef.current?.querySelector<HTMLElement>('button:last-child');
      btn?.focus();
    });
  }, [visible, rect, step]);

  const handleNext = useCallback(() => {
    setStep(s => {
      if (s < TOOLTIPS.length - 1) return s + 1;
      setVisible(false);
      setOnboardingCompleted(true);
      return s;
    });
  }, [setOnboardingCompleted]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setOnboardingCompleted(true);
  }, [setOnboardingCompleted]);

  // Escape key to dismiss (capture phase per project convention)
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [visible, handleDismiss]);

  if (onboardingCompleted || !visible || step >= TOOLTIPS.length || !rect) return null;

  const tooltip = TOOLTIPS[step];

  // Calculate tooltip position based on arrow direction
  const TIP_W = 220;
  const TIP_H = 80;

  let top = 0;
  let left = 0;

  switch (tooltip.arrow) {
    case 'left':
      top = rect.top + rect.height / 2 - TIP_H / 2;
      left = rect.right + ARROW_SIZE + 8;
      break;
    case 'right':
      top = rect.top + rect.height / 2 - TIP_H / 2;
      left = rect.left - TIP_W - ARROW_SIZE - 8;
      break;
    case 'top':
      top = rect.bottom + ARROW_SIZE + 8;
      left = rect.left + rect.width / 2 - TIP_W / 2;
      break;
    case 'bottom':
      top = rect.top - TIP_H - ARROW_SIZE - 8;
      left = rect.left + rect.width / 2 - TIP_W / 2;
      break;
  }

  // Clamp to viewport
  top = Math.max(8, Math.min(window.innerHeight - TIP_H - 8, top));
  left = Math.max(8, Math.min(window.innerWidth - TIP_W - 8, left));

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Onboarding tip ${step + 1} of ${TOOLTIPS.length}`}
      style={{
        position: 'fixed',
        top,
        left,
        width: TIP_W,
        zIndex: 10000,
        background: 'var(--panel-bg)',
        border: '1px solid var(--teal)',
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: '0 4px 20px var(--shadow)',
        fontFamily: "'JetBrains Mono', monospace",
        color: 'var(--text)',
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 11, color: 'var(--teal)' }}>{tooltip.title}</span>
        <span style={{ fontSize: 9, opacity: 0.5 }}>{step + 1}/{TOOLTIPS.length}</span>
      </div>
      <div style={{ fontSize: 10, lineHeight: 1.4, opacity: 0.8, marginBottom: 8 }}>
        {tooltip.text}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-faint)',
            fontSize: 9,
            cursor: 'pointer',
            padding: '2px 4px',
            fontFamily: 'inherit',
          }}
        >
          Don't show again
        </button>
        <button
          onClick={handleNext}
          style={{
            background: 'var(--teal)',
            border: 'none',
            color: 'var(--bg)',
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 4,
            padding: '3px 10px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {step < TOOLTIPS.length - 1 ? 'Next' : 'Done'}
        </button>
      </div>
    </div>
  );
}

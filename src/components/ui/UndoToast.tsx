import { useEffect, useState, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const TOAST_DURATION = 1500; // ms

/**
 * Bottom-center toast notification for undo/redo actions.
 * Subscribes to the store's undoRedoEvent field and displays a brief
 * fade-in / fade-out message when the user undoes or redoes.
 */
export function UndoToast() {
  const prefersReducedMotion = useReducedMotion();
  const [label, setLabel] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(0);
  const innerTimerRef = useRef(0);

  useEffect(() => {
    // Subscribe to undoRedoEvent changes
    const unsub = useEditorStore.subscribe(
      s => s.undoRedoEvent,
      (event) => {
        if (!event) return;
        const parts = event.split(':');
        const type = parts[0];
        const actionLabel = parts[2] || '';
        setLabel(actionLabel
          ? `${type === 'undo' ? 'Undo' : 'Redo'}: ${actionLabel}`
          : type === 'undo' ? 'Undo' : 'Redo');
        setVisible(true);
        clearTimeout(timerRef.current);
        clearTimeout(innerTimerRef.current);
        timerRef.current = window.setTimeout(() => {
          setVisible(false);
          // Clear label after fade-out so the next aria-live announcement
          // triggers a fresh DOM insertion for screen readers
          innerTimerRef.current = window.setTimeout(() => setLabel(null), 300);
        }, TOAST_DURATION);
      }
    );
    return () => {
      unsub();
      clearTimeout(timerRef.current);
      clearTimeout(innerTimerRef.current);
    };
  }, []);

  // Always render the aria-live container so screen readers can observe it.
  // When empty, it's invisible but still in the accessibility tree.
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: prefersReducedMotion ? 'none' : 'opacity 0.25s ease',
      }}
    >
      {label && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            borderRadius: 6,
            background: 'var(--panel-bg)',
            border: '1px solid var(--panel-border)',
            backdropFilter: 'blur(8px)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 14, opacity: 0.6 }}>
            {label?.startsWith('Undo') ? '\u21B6' : '\u21B7'}
          </span>
          {label}
        </div>
      )}
    </div>
  );
}

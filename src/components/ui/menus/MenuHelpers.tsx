/**
 * Shared helper components used by context menu subcomponents.
 * Extracted from ContextMenu.tsx during Phase 42 architecture cleanup.
 */
import { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../../../store/editorStore';
import styles from '../../../styles/panels.module.css';
import type { ExecFn } from './menuShared';

export function CtxIcon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

export function TraceMenuItem({ nodeId, exec }: { nodeId: string; exec: ExecFn }) {
  const store = useEditorStore;
  const traceNodeId = useEditorStore(s => s.traceNodeId);
  const isTracing = traceNodeId === nodeId;

  return (
    <button
      className={styles.contextMenuItem}
      role="menuitem"
      tabIndex={-1}
      style={isTracing ? { color: 'var(--teal)' } : undefined}
      onClick={() => exec(() => store.getState().setTraceNode(isTracing ? null : nodeId))}
    >
      <CtxIcon d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4zm0-6a2 2 0 1 0 2 2 2 2 0 0 0-2-2z" />
      {isTracing ? 'Stop Tracing' : 'Trace Data Flow'}
    </button>
  );
}

export function CopyResultMenuItem({ nodeId, exec }: { nodeId: string; exec: ExecFn }) {
  const nodeOutputs = useEditorStore(s => s.nodeOutputs);
  const outputs = nodeOutputs[nodeId];

  if (!outputs || Object.keys(outputs).length === 0) return null;

  const handleCopy = () => {
    const formatted = Object.entries(outputs)
      .map(([port, value]) => {
        try {
          return `Output ${port}: ${JSON.stringify(value, null, 2)}`;
        } catch {
          return `Output ${port}: [unserializable]`;
        }
      })
      .join('\n');
    navigator.clipboard.writeText(formatted).catch(() => {
      // Fallback for insecure contexts
      const ta = document.createElement('textarea');
      ta.value = formatted;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  };

  return (
    <button
      className={styles.contextMenuItem}
      role="menuitem"
      tabIndex={-1}
      onClick={() => exec(handleCopy)}
    >
      <CtxIcon d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8 2h8v4H8z" />
      Copy Result
    </button>
  );
}

export function BreakpointConditionMenuItem({ nodeId }: { nodeId: string }) {
  const [editing, setEditing] = useState(false);
  const condition = useEditorStore(s => s.breakpointConditions[nodeId] ?? '');
  const [draft, setDraft] = useState(condition);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  if (editing) {
    return (
      <div style={{ padding: '4px 8px' }}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          placeholder="e.g. out0 > 10"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              if (draft.trim()) {
                useEditorStore.getState().setBreakpointCondition(nodeId, draft.trim());
              } else {
                useEditorStore.getState().clearBreakpointCondition(nodeId);
              }
              setEditing(false);
            } else if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          onBlur={() => setEditing(false)}
          style={{
            width: '100%',
            padding: '3px 6px',
            fontSize: '10px',
            fontFamily: "'JetBrains Mono', monospace",
            background: 'var(--bg-subtle)',
            border: '1px solid var(--warning)',
            borderRadius: 3,
            color: 'var(--text)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: '8px', color: 'var(--text-faint)', marginTop: 2 }}>
          Use out0, out1... or outputs[0]
        </div>
      </div>
    );
  }

  return (
    <button
      className={styles.contextMenuItem}
      role="menuitem"
      tabIndex={-1}
      onClick={() => setEditing(true)}
      style={{ color: condition ? 'var(--warning)' : undefined }}
    >
      <CtxIcon d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
      {condition ? `Condition: ${condition}` : 'Set Condition...'}
    </button>
  );
}

export function DisconnectAllMenuItem({ nodeId, exec }: { nodeId: string; exec: ExecFn }) {
  const store = useEditorStore;
  const connections = useEditorStore(s => s.connections);

  const nodeConnections = Object.values(connections).filter(c =>
    c.sourceNodeId === nodeId || c.targetNodeId === nodeId
  );

  if (nodeConnections.length === 0) return null;

  return (
    <button
      className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
      role="menuitem"
      tabIndex={-1}
      onClick={() => exec(() => {
        for (const conn of nodeConnections) {
          store.getState().removeConnection(conn.id);
        }
      })}
    >
      <CtxIcon d="M18 6L6 18M6 6l12 12" />
      Disconnect All ({nodeConnections.length})
    </button>
  );
}

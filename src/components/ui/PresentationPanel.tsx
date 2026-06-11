/**
 * Presentation / "mini-app" view — full-screen overlay that hides the wiring
 * and surfaces only parameter nodes (as form inputs) and display/output nodes
 * (as live readouts). Turns a finished calculator/sandbox graph into a clean,
 * shareable tool. Editing a parameter re-executes the graph automatically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from '../../styles/panels.module.css';
import { getPresentationInputs, getPresentationOutputs } from '../../utils/presentationView';
import { resolveNodeExportValue, valueToJSON, valueToCSV, copyTextToClipboard } from '../../utils/valueExport';
import { formatNumberPrecision } from '../../utils/valueFormat';
import type { FieldDef } from '../nodes/nodeFields';
import type { EditorNode } from '../../types';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--btn-border)',
  borderRadius: 4,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-subtle)',
  border: '1px solid var(--panel-border)',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.8,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  marginBottom: 8,
};

const copyBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--btn-border)',
  borderRadius: 4,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 9,
  fontFamily: 'var(--font-mono)',
  padding: '2px 6px',
};

/** One editable field. Text-ish fields commit on blur/Enter to avoid undo spam. */
function FieldEditor({ node, field, onCommit }: {
  node: EditorNode;
  field: FieldDef;
  onCommit: (nodeId: string, key: string, value: unknown) => void;
}) {
  const value = node.data[field.key];
  const extern = value === undefined || value === null ? '' : String(value);
  const [draft, setDraft] = useState<string>(extern);
  // Re-sync draft when the underlying value changes externally (undo, etc.) —
  // the setState-during-render "previous value" pattern from the React docs.
  const [lastExtern, setLastExtern] = useState(extern);
  if (extern !== lastExtern) {
    setLastExtern(extern);
    // Don't clobber an in-progress numeric edit that parses to the same value
    // (typing "9." commits 9, which would otherwise reset the field to "9")
    if (field.type !== 'number' || String(parseFloat(draft)) !== extern) {
      setDraft(extern);
    }
  }

  const fieldId = `present-${node.id}-${field.key}`;

  switch (field.type) {
    case 'number':
      return (
        <input
          id={fieldId}
          type="number"
          style={inputStyle}
          value={draft}
          step="any"
          onChange={e => {
            setDraft(e.target.value);
            const n = parseFloat(e.target.value);
            if (!Number.isNaN(n)) onCommit(node.id, field.key, n);
          }}
        />
      );
    case 'boolean':
      return (
        <input
          id={fieldId}
          type="checkbox"
          checked={value === true}
          onChange={e => onCommit(node.id, field.key, e.target.checked)}
        />
      );
    case 'select':
      return (
        <select
          id={fieldId}
          style={inputStyle}
          value={String(value ?? field.options?.[0] ?? '')}
          onChange={e => onCommit(node.id, field.key, e.target.value)}
        >
          {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case 'color':
      return (
        <input
          id={fieldId}
          type="color"
          style={{ ...inputStyle, padding: 2, height: 28, cursor: 'pointer' }}
          value={typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#2EC4B6'}
          onChange={e => onCommit(node.id, field.key, e.target.value)}
        />
      );
    case 'textarea':
      return (
        <textarea
          id={fieldId}
          style={{ ...inputStyle, minHeight: 48, resize: 'vertical' }}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => onCommit(node.id, field.key, draft)}
        />
      );
    default: // 'text'
      return (
        <input
          id={fieldId}
          type="text"
          style={inputStyle}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => onCommit(node.id, field.key, draft)}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      );
  }
}

function formatOutputValue(value: unknown): { text: string; isBlock: boolean } {
  if (value === undefined || value === null) return { text: '—', isBlock: false };
  if (typeof value === 'number') return { text: formatNumberPrecision(value), isBlock: false };
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false', isBlock: false };
  if (typeof value === 'string') return { text: value, isBlock: value.length > 48 || value.includes('\n') };
  try {
    return { text: JSON.stringify(value, null, 2), isBlock: true };
  } catch {
    return { text: String(value), isBlock: false };
  }
}

export function PresentationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const nodeOutputs = useEditorStore(s => s.nodeOutputs);
  const isExecuting = useEditorStore(s => s.isExecuting);
  const graphTab = useEditorStore(s => s.graphTabs[s.activeGraphId]);

  // Debounced re-execution after edits. executeGraph() no-ops while the wave
  // animation holds isExecuting, so the timer re-arms until the engine is idle
  // (otherwise an edit made during the ~1s animation would never re-run).
  const execTimer = useRef<number | null>(null);
  const scheduleRun = useCallback(() => {
    const arm = (delayMs: number) => {
      if (execTimer.current !== null) window.clearTimeout(execTimer.current);
      execTimer.current = window.setTimeout(() => {
        execTimer.current = null;
        const store = useEditorStore.getState();
        if (store.isExecuting) arm(150);
        else store.executeGraph();
      }, delayMs);
    };
    arm(250);
  }, []);
  const handleCommit = useCallback((nodeId: string, key: string, value: unknown) => {
    const store = useEditorStore.getState();
    if (store.nodes[nodeId]?.data[key] === value) return;
    store.updateNodeData(nodeId, key, value);
    if (!useSettingsStore.getState().autoExecute) scheduleRun();
  }, [scheduleRun]);
  useEffect(() => () => {
    if (execTimer.current !== null) window.clearTimeout(execTimer.current);
  }, []);

  const runNow = useCallback(() => {
    const store = useEditorStore.getState();
    if (store.isExecuting) store.resetExecution();
    store.executeGraph();
  }, []);

  // Fresh results when the view opens
  useEffect(() => {
    if (open) useEditorStore.getState().executeGraph();
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }, [onClose]);

  if (!open) return null;

  const inputs = getPresentationInputs(nodes);
  const outputs = getPresentationOutputs(nodes);

  return (
    <div
      className={styles.helpBackdrop}
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Presentation view"
    >
      <div
        className={styles.helpPanel}
        style={{ maxWidth: 820, width: '94%' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className={styles.helpTitle} style={{ marginBottom: 0, textAlign: 'left' }}>
            {graphTab?.name ?? 'Graph'}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className={styles.toolbarBtn}
              onClick={runNow}
              title="Re-run the graph"
            >
              {isExecuting ? 'Running…' : 'Run'}
            </button>
            <button className={styles.toolbarBtn} onClick={onClose} title="Back to editor (Esc)">
              Exit
            </button>
          </div>
        </div>
        {graphTab?.description && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
            {graphTab.description}
          </div>
        )}

        <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
          {/* Inputs */}
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            <div style={sectionLabelStyle}>Inputs</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {inputs.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  No parameter nodes (add a node with editable fields and no input ports).
                </div>
              )}
              {inputs.map(({ node, fields }) => (
                <div key={node.id} style={cardStyle}>
                  <div style={cardTitleStyle}>{node.title || node.type}</div>
                  {fields.map(field => (
                    <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--text-dim)' }}>
                      {field.label}
                      <FieldEditor node={node} field={field} onCommit={handleCommit} />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Outputs */}
          <div style={{ flex: '1 1 280px', minWidth: 240 }}>
            <div style={sectionLabelStyle}>Outputs</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {outputs.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  No display/output nodes in this graph.
                </div>
              )}
              {outputs.map(node => {
                const value = resolveNodeExportValue(node.id, nodes, connections, nodeOutputs);
                const { text, isBlock } = formatOutputValue(value);
                const json = valueToJSON(value);
                const csv = valueToCSV(value);
                return (
                  <div key={node.id} style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={cardTitleStyle}>{node.title || node.type}</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {json !== null && (
                          <button style={copyBtnStyle} onClick={() => copyTextToClipboard(json)} title="Copy value as JSON">
                            JSON
                          </button>
                        )}
                        {csv !== null && (
                          <button style={copyBtnStyle} onClick={() => copyTextToClipboard(csv)} title="Copy value as CSV">
                            CSV
                          </button>
                        )}
                      </div>
                    </div>
                    {isBlock ? (
                      <pre style={{
                        margin: 0, fontSize: 11, color: 'var(--text-bright)',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        maxHeight: 180, overflowY: 'auto',
                        fontFamily: 'var(--font-mono)',
                      }}>{text}</pre>
                    ) : (
                      <div style={{
                        fontSize: 22, color: 'var(--text-bright)',
                        fontFamily: 'var(--font-mono)', wordBreak: 'break-word',
                      }}>{text}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: 9, color: 'var(--text-dim)', textAlign: 'center' }}>
          Edits re-run the graph automatically · Esc to return to the editor
        </div>
      </div>
    </div>
  );
}

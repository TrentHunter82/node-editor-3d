import { memo, useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import styles from '../../styles/panels.module.css';

interface ValidationEntry {
  nodeId: string;
  nodeTitle: string;
  errors: string[];
  warnings: string[];
}

export const ValidationPanel = memo(function ValidationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const validationErrors = useEditorStore(s => s.validationErrors);
  const nodes = useEditorStore(s => s.nodes);
  const focusNode = useEditorStore(s => s.focusNode);
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-focus the panel when opened for keyboard/screen-reader accessibility
  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.focus();
    }
  }, [open]);

  // Group errors/warnings by node
  const entries = useMemo(() => {
    const result: ValidationEntry[] = [];
    for (const [nodeId, msgs] of Object.entries(validationErrors)) {
      if (!msgs || msgs.length === 0) continue;
      const node = nodes[nodeId];
      const errors: string[] = [];
      const warnings: string[] = [];
      for (const msg of msgs) {
        if (msg.includes('warning')) warnings.push(msg);
        else errors.push(msg);
      }
      result.push({
        nodeId,
        nodeTitle: node?.title ?? nodeId,
        errors,
        warnings,
      });
    }
    // Sort: errors first, then alphabetical by title
    result.sort((a, b) => {
      if (a.errors.length > 0 && b.errors.length === 0) return -1;
      if (a.errors.length === 0 && b.errors.length > 0) return 1;
      return a.nodeTitle.localeCompare(b.nodeTitle);
    });
    return result;
  }, [validationErrors, nodes]);

  if (!open) return null;

  const totalErrors = entries.reduce((sum, e) => sum + e.errors.length, 0);
  const totalWarnings = entries.reduce((sum, e) => sum + e.warnings.length, 0);

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
        role="dialog"
        aria-modal="true"
        aria-label="Validation errors"
        style={{ maxWidth: 480, outline: 'none' }}
      >
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: '13px',
            color: 'var(--text-bright)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Validation
          </span>
          <div style={{ display: 'flex', gap: 8, fontSize: '10px' }}>
            {totalErrors > 0 && (
              <span style={{ color: 'var(--danger)' }}>
                {totalErrors} error{totalErrors !== 1 ? 's' : ''}
              </span>
            )}
            {totalWarnings > 0 && (
              <span style={{ color: 'var(--warning)' }}>
                {totalWarnings} warning{totalWarnings !== 1 ? 's' : ''}
              </span>
            )}
            {totalErrors === 0 && totalWarnings === 0 && (
              <span style={{ color: 'var(--success)' }}>No issues</span>
            )}
          </div>
        </div>

        <div className={styles.searchResults} style={{ maxHeight: 400 }}>
          {entries.length === 0 && (
            <div style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--text-faint)',
              fontSize: 12,
            }}>
              No validation issues found.
            </div>
          )}
          {entries.map(entry => (
            <div key={entry.nodeId} style={{ padding: '4px 0' }}>
              <button
                className={styles.searchItem}
                onClick={() => { focusNode(entry.nodeId); onClose(); }}
                style={{ fontWeight: 600, gap: 6 }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: entry.errors.length > 0 ? 'var(--danger)' : 'var(--warning)',
                }} />
                {entry.nodeTitle}
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '9px',
                  opacity: 0.4,
                  fontWeight: 400,
                }}>
                  {entry.errors.length + entry.warnings.length} issue{entry.errors.length + entry.warnings.length !== 1 ? 's' : ''}
                </span>
              </button>
              {entry.errors.map((msg, i) => (
                <div key={`e-${i}`} style={{
                  padding: '2px 12px 2px 28px',
                  fontSize: '10px',
                  color: 'var(--danger)',
                  lineHeight: 1.4,
                }}>
                  {msg}
                </div>
              ))}
              {entry.warnings.map((msg, i) => (
                <div key={`w-${i}`} style={{
                  padding: '2px 12px 2px 28px',
                  fontSize: '10px',
                  color: 'var(--warning)',
                  lineHeight: 1.4,
                }}>
                  {msg}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--divider)',
          fontSize: '10px',
          color: 'var(--text-faint)',
          textAlign: 'center',
        }}>
          Click a node to focus it
        </div>
      </div>
    </div>
  );
});

import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import styles from '../../styles/panels.module.css';

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export function CheckpointPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const checkpoints = useEditorStore(s => s.checkpoints);
  const createCheckpoint = useEditorStore(s => s.createCheckpoint);
  const restoreCheckpoint = useEditorStore(s => s.restoreCheckpoint);
  const deleteCheckpoint = useEditorStore(s => s.deleteCheckpoint);
  const [newLabel, setNewLabel] = useState('');

  if (!open) return null;

  const entries = Object.values(checkpoints)
    .sort((a, b) => b.createdAt - a.createdAt);

  const handleCreate = () => {
    const label = newLabel.trim() || `Checkpoint ${entries.length + 1}`;
    createCheckpoint(label);
    setNewLabel('');
  };

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
        role="dialog"
        aria-modal="true"
        aria-label="Graph checkpoints"
        style={{ maxWidth: 420 }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--text-primary)',
          fontWeight: 600,
          fontSize: '14px',
        }}>
          <span>Checkpoints</span>
          <button
            onClick={onClose}
            className={styles.templateDelete}
            aria-label="Close"
            style={{ fontSize: '16px' }}
          >
            ×
          </button>
        </div>

        {/* Create new checkpoint */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          gap: '8px',
        }}>
          <input
            type="text"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="Checkpoint name..."
            style={{
              flex: 1,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--divider)',
              borderRadius: '4px',
              padding: '6px 10px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleCreate}
            style={{
              background: 'var(--teal)',
              color: 'var(--text-bright)',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            Save
          </button>
        </div>

        {/* Checkpoint list */}
        <div style={{
          maxHeight: 300,
          overflowY: 'auto',
          padding: entries.length > 0 ? '8px 0' : '16px',
        }}>
          {entries.length === 0 && (
            <div style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: '12px' }}>
              No checkpoints yet. Save one above.
            </div>
          )}
          {entries.map(cp => (
            <div
              key={cp.id}
              style={{
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--divider)',
              }}
            >
              <div>
                <div style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: 500 }}>
                  {cp.label}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
                  {timeAgo(cp.createdAt)} &middot; {Object.keys(cp.snapshot.nodes).length} nodes
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => restoreCheckpoint(cp.id)}
                  style={{
                    background: 'var(--bg-secondary)',
                    color: 'var(--teal)',
                    border: '1px solid var(--divider)',
                    borderRadius: '3px',
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Restore
                </button>
                <button
                  onClick={() => deleteCheckpoint(cp.id)}
                  style={{
                    background: 'none',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--divider)',
                    borderRadius: '3px',
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--divider)',
          color: 'var(--text-secondary)',
          fontSize: '10px',
          textAlign: 'center',
        }}>
          Max 20 checkpoints per graph
        </div>
      </div>
    </div>
  );
}

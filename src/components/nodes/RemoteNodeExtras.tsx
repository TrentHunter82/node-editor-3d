import { memo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { REMOTE_PROGRESS_KEY, REMOTE_STATUS_KEY, REMOTE_ERROR_KEY, REMOTE_QUEUE_POS_KEY } from '../../utils/remoteExecution';
import { hexToRgba } from './nodeScreenHelpers';
import type { ExecutionState } from '../../types';

/**
 * On-node controls for a remote-executed node (a node whose type is registered
 * via `registerRemoteNodeType`). Shows a Run/Cancel button, a live progress bar
 * fed by `node.data._remoteProgress`, and the last status/error. The actual
 * dispatch goes through the store actions, which run the node on the active
 * ExecutionBackend out-of-band — see `utils/remoteExecution.ts`.
 */

const BTN_STYLE: React.CSSProperties = {
  flex: 1,
  height: '20px',
  background: 'var(--btn-bg)',
  border: '1px solid var(--btn-border)',
  borderRadius: '3px',
  color: 'var(--text)',
  fontSize: '9px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  cursor: 'pointer',
  padding: 0,
  fontFamily: "'JetBrains Mono', monospace",
  pointerEvents: 'auto',
};

const PROGRESS_TRACK: React.CSSProperties = {
  height: '4px',
  borderRadius: '2px',
  background: 'var(--bg-subtle)',
  overflow: 'hidden',
  marginTop: '4px',
};

const stopKey = (e: React.KeyboardEvent) => {
  e.stopPropagation();
  e.nativeEvent.stopImmediatePropagation();
};

interface RemoteNodeExtrasProps {
  nodeId: string;
  accentHex: string;
}

export const RemoteNodeExtras = memo(function RemoteNodeExtras({ nodeId, accentHex }: RemoteNodeExtrasProps) {
  const dispatchRemoteNode = useEditorStore(s => s.dispatchRemoteNode);
  const cancelRemoteNode = useEditorStore(s => s.cancelRemoteNode);
  const execState = useEditorStore(s => s.executionStates[nodeId]) as ExecutionState | undefined;
  const progress = useEditorStore(s => {
    const p = s.nodes[nodeId]?.data[REMOTE_PROGRESS_KEY];
    return typeof p === 'number' ? p : 0;
  });
  const status = useEditorStore(s => {
    const v = s.nodes[nodeId]?.data[REMOTE_STATUS_KEY];
    return typeof v === 'string' ? v : 'idle';
  });
  const error = useEditorStore(s => {
    const v = s.nodes[nodeId]?.data[REMOTE_ERROR_KEY];
    return typeof v === 'string' ? v : '';
  });
  const queuePos = useEditorStore(s => {
    const v = s.nodes[nodeId]?.data[REMOTE_QUEUE_POS_KEY];
    return typeof v === 'number' ? v : 0;
  });

  const running = execState === 'running';
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <div style={{ marginTop: '4px' }}>
      <div style={{ display: 'flex', gap: '4px' }}>
        {running ? (
          <button
            style={{ ...BTN_STYLE, color: 'var(--danger)' }}
            onClick={() => cancelRemoteNode(nodeId)}
            onKeyDown={stopKey}
            onKeyUp={stopKey}
            aria-label="Cancel remote execution"
          >
            ◼ Cancel
          </button>
        ) : (
          <button
            style={{ ...BTN_STYLE, color: accentHex }}
            onClick={() => dispatchRemoteNode(nodeId)}
            onKeyDown={stopKey}
            onKeyUp={stopKey}
            aria-label="Run remotely"
          >
            ▸ Run remote
          </button>
        )}
      </div>
      {/* Progress bar — visible while running or after a run */}
      {(running || pct > 0) && (
        <div style={PROGRESS_TRACK}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: error ? 'var(--danger)' : accentHex,
            transition: 'width 0.12s linear',
          }} />
        </div>
      )}
      {/* Status / error line */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '7px',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        marginTop: '3px',
        color: error ? 'var(--danger)' : hexToRgba(accentHex, 0.6),
      }}>
        <span>{running ? (queuePos > 0 ? `queued #${queuePos}` : `running ${pct}%`) : status}</span>
        {error && <span title={error}>err</span>}
      </div>
    </div>
  );
});

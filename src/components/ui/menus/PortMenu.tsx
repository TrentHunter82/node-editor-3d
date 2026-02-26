/**
 * Port context menu — shown on right-click of a port.
 * Extracted from ContextMenu.tsx during Phase 42 architecture cleanup.
 */
import { useEditorStore } from '../../../store/editorStore';
import styles from '../../../styles/panels.module.css';
import { CtxIcon } from './MenuHelpers';
import type { ExecFn } from './menuShared';

export function PortMenu({ nodeId, portIndex, portType, exec }: { nodeId: string; portIndex: number; portType: 'input' | 'output'; exec: ExecFn }) {
  const store = useEditorStore;
  const connections = useEditorStore(s => s.connections);
  const node = useEditorStore(s => s.nodes[nodeId]);
  const portDef = node
    ? (portType === 'input' ? node.inputs[portIndex] : node.outputs[portIndex])
    : undefined;

  // Find connections on this port
  const portConnections = Object.values(connections).filter(c =>
    portType === 'input'
      ? c.targetNodeId === nodeId && c.targetPortIndex === portIndex
      : c.sourceNodeId === nodeId && c.sourcePortIndex === portIndex
  );

  const hasConnections = portConnections.length > 0;

  return (
    <>
      <div className={styles.contextMenuLabel} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {portDef?.label ?? (portType === 'input' ? 'Input' : 'Output')}
        <span style={{ fontSize: '8px', color: 'var(--text-faint)', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-mono)' }}>
          {portDef?.portType ?? 'any'}
        </span>
      </div>
      {hasConnections ? (
        <>
          <button
            className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              for (const conn of portConnections) {
                store.getState().removeConnection(conn.id);
              }
            })}
          >
            <CtxIcon d="M18 6L6 18M6 6l12 12" />
            Disconnect{portConnections.length > 1 ? ` (${portConnections.length})` : ''}
          </button>
          {portType === 'input' && portConnections.length === 1 && (
            <button
              className={styles.contextMenuItem}
              role="menuitem"
              tabIndex={-1}
              onClick={() => exec(() => store.getState().disconnectAndReroute(portConnections[0].id))}
            >
              <CtxIcon d="M13 17l5-5-5-5M6 17l5-5-5-5" />
              Detach &amp; Reroute
            </button>
          )}
        </>
      ) : (
        <div style={{ padding: '6px 10px', fontSize: '10px', color: 'var(--btn-text)' }}>
          No connections
        </div>
      )}
    </>
  );
}

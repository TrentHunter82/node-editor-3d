/**
 * Connection context menu — shown on right-click of a connection.
 * Extracted from ContextMenu.tsx during Phase 42 architecture cleanup.
 */
import { useEditorStore } from '../../../store/editorStore';
import { useSettingsStore } from '../../../store/settingsStore';
import styles from '../../../styles/panels.module.css';
import { CtxIcon } from './MenuHelpers';
import { CONNECTION_STYLES } from './menuShared';
import type { ExecFn } from './menuShared';

export function ConnectionMenu({ connectionId, exec }: { connectionId: string; exec: ExecFn }) {
  const store = useEditorStore;
  const connection = useEditorStore(s => s.connections[connectionId]);
  const globalStyle = useSettingsStore(s => s.connectionStyle);
  const currentStyle = connection?.styleOverride ?? null;

  return (
    <>
      <button
        className={styles.contextMenuItem}
        role="menuitem"
        tabIndex={-1}
        onClick={() => exec(() => {
          const label = window.prompt('Connection label:', connection?.label ?? '');
          if (label !== null) {
            store.getState().updateConnectionLabel(connectionId, label || undefined);
          }
        })}
      >
        <CtxIcon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        {connection?.label ? 'Edit Label' : 'Add Label'}
      </button>
      {connection?.label && (
        <button
          className={styles.contextMenuItem}
          role="menuitem"
          tabIndex={-1}
          onClick={() => exec(() => store.getState().updateConnectionLabel(connectionId, undefined))}
        >
          <CtxIcon d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
          Remove Label
        </button>
      )}
      <div className={styles.contextMenuDivider} />
      {/* Per-connection style override */}
      <div style={{ padding: '4px 12px 2px', fontSize: 8, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Style
      </div>
      <button
        className={styles.contextMenuItem}
        role="menuitem"
        tabIndex={-1}
        style={currentStyle === null ? { color: 'var(--teal)' } : undefined}
        onClick={() => exec(() => store.getState().updateConnectionStyle(connectionId, undefined))}
      >
        Default ({globalStyle})
      </button>
      {CONNECTION_STYLES.map(s => (
        <button
          key={s}
          className={styles.contextMenuItem}
          role="menuitem"
          tabIndex={-1}
          style={currentStyle === s ? { color: 'var(--teal)' } : undefined}
          onClick={() => exec(() => store.getState().updateConnectionStyle(connectionId, s))}
        >
          {s}
        </button>
      ))}
      <div className={styles.contextMenuDivider} />
      <button
        className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
        role="menuitem"
        tabIndex={-1}
        onClick={() => exec(() => store.getState().removeConnection(connectionId))}
      >
        <CtxIcon d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        Delete Connection
        <span className={styles.contextMenuShortcut}>Del</span>
      </button>
    </>
  );
}

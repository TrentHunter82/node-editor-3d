import { useState, useRef, useCallback, useEffect } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Tooltip } from './Tooltip';
import styles from '../../styles/panels.module.css';

export function WorkspaceTabBar() {
  const workspaceOrder = useWorkspaceStore(s => s.workspaceOrder);
  const workspaces = useWorkspaceStore(s => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore(s => s.switchWorkspace);
  const createWorkspace = useWorkspaceStore(s => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore(s => s.deleteWorkspace);
  const renameWorkspace = useWorkspaceStore(s => s.renameWorkspace);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = useCallback((id: string) => {
    const ws = workspaces[id];
    if (!ws) return;
    setEditingId(id);
    setEditValue(ws.name);
  }, [workspaces]);

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      renameWorkspace(editingId, editValue.trim());
    }
    setEditingId(null);
  }, [editingId, editValue, renameWorkspace]);

  const handleClose = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (workspaceOrder.length <= 1) return;
    deleteWorkspace(id);
  }, [workspaceOrder.length, deleteWorkspace]);

  // Don't render if there's only one workspace and it hasn't been explicitly
  // created — reduces visual clutter for single-workspace users
  if (workspaceOrder.length <= 1) {
    return (
      <div className={styles.workspaceBar}>
        <Tooltip label="New workspace" placement="bottom">
          <button
            className={styles.workspaceAdd}
            onClick={() => createWorkspace()}
            aria-label="New workspace"
          >
            +
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={styles.workspaceBar} role="tablist" aria-label="Workspace tabs">
      {workspaceOrder.map(id => {
        const ws = workspaces[id];
        if (!ws) return null;
        const isActive = id === activeWorkspaceId;
        const isEditing = editingId === id;

        return (
          <div
            key={id}
            className={`${styles.wsTab} ${isActive ? styles.wsTabActive : ''}`}
            role="tab"
            aria-selected={isActive}
            aria-label={ws.name}
            tabIndex={isActive ? 0 : -1}
            onClick={() => switchWorkspace(id)}
            onDoubleClick={() => startRename(id)}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                className={styles.tabInput}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={e => e.stopPropagation()}
                style={{ width: 80, fontSize: 10 }}
              />
            ) : (
              <span className={styles.wsTabName}>
                {ws.name}
                {ws.fileName && (
                  <span style={{ opacity: 0.4, fontSize: 9, marginLeft: 4 }}>
                    ({ws.fileName})
                  </span>
                )}
              </span>
            )}
            {workspaceOrder.length > 1 && (
              <button
                className={styles.tabClose}
                onClick={e => handleClose(e, id)}
                aria-label={`Close ${ws.name}`}
                tabIndex={-1}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <Tooltip label="New workspace" placement="bottom">
        <button
          className={styles.workspaceAdd}
          onClick={() => createWorkspace()}
          aria-label="New workspace"
        >
          +
        </button>
      </Tooltip>
    </div>
  );
}

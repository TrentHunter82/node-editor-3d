import { useState, useRef, useCallback, useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Tooltip } from './Tooltip';
import styles from '../../styles/panels.module.css';

export function GraphTabBar() {
  const graphOrder = useEditorStore(s => s.graphOrder);
  const graphTabs = useEditorStore(s => s.graphTabs);
  const activeGraphId = useEditorStore(s => s.activeGraphId);
  const breadcrumbDepth = useEditorStore(s => s.breadcrumbStack.length);
  const nodeCount = useEditorStore(s => Object.keys(s.nodes).length);
  const connectionCount = useEditorStore(s => Object.keys(s.connections).length);
  const switchGraph = useEditorStore(s => s.switchGraph);
  const createGraph = useEditorStore(s => s.createGraph);
  const deleteGraph = useEditorStore(s => s.deleteGraph);
  const renameGraph = useEditorStore(s => s.renameGraph);
  const reorderGraph = useEditorStore(s => s.reorderGraph);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [contextMenu, setContextMenu] = useState<{ graphId: string; x: number; y: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Focus input when editing begins
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.stopImmediatePropagation();
        setContextMenu(null);
      }
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  const startRename = useCallback((graphId: string) => {
    const tab = graphTabs[graphId];
    if (!tab) return;
    setEditingId(graphId);
    setEditValue(tab.name);
    setContextMenu(null);
  }, [graphTabs]);

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      renameGraph(editingId, editValue.trim());
    }
    setEditingId(null);
  }, [editingId, editValue, renameGraph]);

  const handleTabClick = useCallback((graphId: string) => {
    if (graphId !== activeGraphId) {
      switchGraph(graphId);
    }
  }, [activeGraphId, switchGraph]);

  const handleClose = useCallback((e: React.MouseEvent, graphId: string) => {
    e.stopPropagation();
    if (graphOrder.length <= 1) return; // Can't delete last tab
    deleteGraph(graphId);
  }, [graphOrder.length, deleteGraph]);

  const handleContextMenu = useCallback((e: React.MouseEvent, graphId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ graphId, x: e.clientX, y: e.clientY });
  }, []);

  const handleDuplicate = useCallback(() => {
    if (!contextMenu) return;
    // Create a new graph and copy the name
    const tab = graphTabs[contextMenu.graphId];
    createGraph(tab ? `${tab.name} (Copy)` : 'Copy');
    setContextMenu(null);
  }, [contextMenu, graphTabs, createGraph]);

  // Drag to reorder
  const handleDragStart = useCallback((graphId: string) => {
    setDragId(graphId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragId) {
      reorderGraph(dragId, dropIndex);
    }
    setDragId(null);
    setDragOverIndex(null);
  }, [dragId, reorderGraph]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverIndex(null);
  }, []);

  // Arrow key navigation between tabs (standard tablist pattern)
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, graphId: string) => {
    const idx = graphOrder.indexOf(graphId);
    if (idx === -1) return;
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % graphOrder.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + graphOrder.length) % graphOrder.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = graphOrder.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      switchGraph(graphOrder[nextIdx]);
      // Focus the newly activated tab
      const tabEl = scrollRef.current?.querySelector(`[data-graph-id="${graphOrder[nextIdx]}"]`) as HTMLElement | null;
      tabEl?.focus();
    }
  }, [graphOrder, switchGraph]);

  return (
    <div className={styles.tabBar} role="tablist" aria-label="Graph tabs">
      <div className={styles.tabBarScroll} ref={scrollRef}>
        {graphOrder.map((graphId, index) => {
          const tab = graphTabs[graphId];
          if (!tab) return null;
          const isActive = graphId === activeGraphId;
          const isEditing = editingId === graphId;
          const isDragging = dragId === graphId;
          const isDragOver = dragOverIndex === index;

          return (
            <div
              key={graphId}
              data-graph-id={graphId}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''} ${isDragging ? styles.tabDragging : ''} ${isDragOver ? styles.tabDragOver : ''}`}
              role="tab"
              aria-selected={isActive}
              aria-label={tab.name}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleTabClick(graphId)}
              onDoubleClick={() => startRename(graphId)}
              onContextMenu={(e) => handleContextMenu(e, graphId)}
              onKeyDown={(e) => handleTabKeyDown(e, graphId)}
              draggable={!isEditing}
              onDragStart={() => handleDragStart(graphId)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className={styles.tabInput}
                  aria-label="Rename graph tab"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingId(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className={styles.tabName}>{tab.name}</span>
                  {isActive && breadcrumbDepth === 0 && (
                    <span style={{
                      fontSize: '8px',
                      color: 'var(--text-faint)',
                      marginLeft: 4,
                      whiteSpace: 'nowrap',
                    }}>
                      {nodeCount}n {connectionCount}c
                    </span>
                  )}
                </>
              )}
              {graphOrder.length > 1 && (
                <button
                  className={styles.tabClose}
                  onClick={(e) => handleClose(e, graphId)}
                  aria-label={`Close ${tab.name}`}
                  tabIndex={-1}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Tooltip label="New graph" shortcut="Ctrl+T" placement="bottom">
        <button
          className={styles.tabAdd}
          onClick={() => createGraph()}
          aria-label="New graph tab"
        >
          +
        </button>
      </Tooltip>

      {/* Tab context menu */}
      {contextMenu && (
        <div
          className={styles.tabContextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Tab actions"
          onClick={(e) => e.stopPropagation()}
        >
          <button className={styles.tabContextItem} role="menuitem" onClick={() => startRename(contextMenu.graphId)}>
            Rename
          </button>
          <button className={styles.tabContextItem} role="menuitem" onClick={handleDuplicate}>
            Duplicate
          </button>
          {graphOrder.length > 1 && (
            <button
              className={`${styles.tabContextItem} ${styles.tabContextDanger}`}
              role="menuitem"
              onClick={() => { deleteGraph(contextMenu.graphId); setContextMenu(null); }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

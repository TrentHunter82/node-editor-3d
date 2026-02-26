/**
 * Node context menu — shown on right-click of a node.
 * Extracted from ContextMenu.tsx during Phase 42 architecture cleanup.
 */
import { useState } from 'react';
import { useEditorStore } from '../../../store/editorStore';
import { useSettingsStore } from '../../../store/settingsStore';
import styles from '../../../styles/panels.module.css';
import { CtxIcon, TraceMenuItem, CopyResultMenuItem, BreakpointConditionMenuItem, DisconnectAllMenuItem } from './MenuHelpers';
import type { ExecFn } from './menuShared';

function PresetMenu({ nodeId, node, exec }: { nodeId: string; node: { type: string; data: Record<string, unknown> }; exec: ExecFn }) {
  const store = useEditorStore;
  const presets = useSettingsStore(s => s.nodePresets);
  const saveNodePreset = useSettingsStore(s => s.saveNodePreset);
  const deleteNodePreset = useSettingsStore(s => s.deleteNodePreset);
  const [showPresets, setShowPresets] = useState(false);

  const matchingPresets = presets.filter(p => p.nodeType === node.type);

  return (
    <>
      <button
        className={styles.contextMenuItem}
        role="menuitem"
        tabIndex={-1}
        onClick={() => exec(() => {
          const name = window.prompt('Preset name:', `${node.type} preset`);
          if (name) {
            saveNodePreset({
              name: name.trim(),
              nodeType: node.type,
              data: JSON.parse(JSON.stringify(node.data)),
            });
          }
        })}
      >
        <CtxIcon d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        Save as Preset
      </button>
      {matchingPresets.length > 0 && (
        <button
          className={styles.contextMenuItem}
          role="menuitem"
          tabIndex={-1}
          onClick={() => setShowPresets(!showPresets)}
        >
          <CtxIcon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
          Apply Preset ({matchingPresets.length})
        </button>
      )}
      {showPresets && matchingPresets.map(preset => (
        <div key={preset.id} style={{ display: 'flex', alignItems: 'center' }}>
          <button
            className={styles.contextMenuItem}
            style={{ flex: 1, paddingLeft: 24 }}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              // Apply preset data to the node (single undo entry via batch)
              const updates = Object.entries(preset.data).map(([key, value]) => ({
                nodeId, key, value,
              }));
              if (updates.length > 0) store.getState().batchUpdateNodeData(updates);
            })}
          >
            {preset.name}
          </button>
          <button
            style={{
              background: 'none', border: 'none', color: 'var(--danger)',
              cursor: 'pointer', fontSize: 10, padding: '0 6px',
            }}
            title="Delete preset"
            onClick={(e) => { e.stopPropagation(); deleteNodePreset(preset.id); }}
          >
            &times;
          </button>
        </div>
      ))}
      <div className={styles.contextMenuDivider} />
    </>
  );
}

export function NodeMenu({ nodeId, exec }: { nodeId: string; exec: ExecFn }) {
  const store = useEditorStore;
  const node = useEditorStore(s => s.nodes[nodeId]);
  const groups = useEditorStore(s => s.groups);
  const breakpoints = useEditorStore(s => s.breakpoints);
  const pinnedNodeTypes = useSettingsStore(s => s.pinnedNodeTypes);
  if (!node) return null;

  const isSubgraph = node.type === 'subgraph';
  const isBoundary = node.type === 'subgraph-input' || node.type === 'subgraph-output';
  const nodeGroup = node.groupId ? groups[node.groupId] : undefined;
  const hasBreakpoint = !!breakpoints[nodeId];
  const isPinned = pinnedNodeTypes.includes(node.type);

  return (
    <>
      {/* Subgraph-specific actions */}
      {isSubgraph && (
        <>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => store.getState().enterSubgraph(nodeId))}
          >
            <CtxIcon d="M13 9l3 3-3 3M2 9l3 3-3 3M9 3v18" />
            Enter Subgraph
          </button>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => store.getState().expandSubgraph(nodeId))}
          >
            <CtxIcon d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            Expand Inline
          </button>
          <div className={styles.contextMenuDivider} />
        </>
      )}

      {/* Custom node: Edit Expression */}
      {node.type === 'custom' && (
        <>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => window.__openCustomNodeEditor?.(nodeId))}
          >
            <CtxIcon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            Edit Expression
          </button>
          <div className={styles.contextMenuDivider} />
        </>
      )}

      {/* Node presets */}
      {!isBoundary && <PresetMenu nodeId={nodeId} node={node} exec={exec} />}

      {/* Standard actions (hidden for boundary nodes) */}
      {!isBoundary && (
        <>
          <div className={styles.contextMenuLabel}>Edit</div>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              store.getState().setSelection(new Set([nodeId]));
              store.getState().duplicateSelected();
            })}
          >
            <CtxIcon d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1M9 9h13v13H9z" />
            Duplicate
            <span className={styles.contextMenuShortcut}>Ctrl+D</span>
          </button>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              store.getState().setSelection(new Set([nodeId]));
              store.getState().copySelected();
            })}
          >
            <CtxIcon d="M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            Copy
            <span className={styles.contextMenuShortcut}>Ctrl+C</span>
          </button>
          <div className={styles.contextMenuDivider} />
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              store.getState().setSelection(new Set([nodeId]));
              store.getState().createGroup();
            })}
          >
            <CtxIcon d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            Group
            <span className={styles.contextMenuShortcut}>Ctrl+G</span>
          </button>
          {node.groupId && nodeGroup && (
            <>
              <button
                className={styles.contextMenuItem}
                role="menuitem"
                tabIndex={-1}
                onClick={() => exec(() => store.getState().toggleGroupCollapse(node.groupId!))}
              >
                <CtxIcon d={nodeGroup.collapsed
                  ? "M4 14h8v-2H4v2zM4 18h12v-2H4v2zM4 10h16V8H4v2z"
                  : "M4 14h16v-2H4v2z"} />
                {nodeGroup.collapsed ? 'Expand Group' : 'Collapse Group'}
              </button>
              {/* Group color picker */}
              <div className={styles.contextMenuItem} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'default' }}>
                <CtxIcon d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z" />
                {['#2EC4B6', '#FF6B35', '#9B59B6', '#E8453C', '#3498DB', '#F1C40F', '#1ABC9C', '#E67E22'].map(c => (
                  <div
                    key={c}
                    onClick={() => exec(() => store.getState().setGroupColor(node.groupId!, c))}
                    style={{
                      width: 12, height: 12, borderRadius: 3,
                      background: c, cursor: 'pointer',
                      border: nodeGroup.color === c ? '2px solid var(--text-bright)' : '1px solid var(--panel-border)',
                    }}
                  />
                ))}
              </div>
              {/* Group description */}
              <button
                className={styles.contextMenuItem}
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  const gid = node.groupId!;
                  const current = nodeGroup.description ?? '';
                  const desc = window.prompt('Group description:', current);
                  if (desc !== null) {
                    exec(() => store.getState().setGroupDescription(gid, desc));
                  }
                }}
              >
                <CtxIcon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 18H8v-2h6v2zm2-4H8v-2h8v2zm-3-6V3.5L18.5 9H13z" />
                {nodeGroup.description ? 'Edit Description' : 'Add Description'}
              </button>
            </>
          )}
          <div className={styles.contextMenuDivider} />
        </>
      )}

      {!isBoundary && (
        <button
          className={styles.contextMenuItem}
          role="menuitem"
          tabIndex={-1}
          onClick={() => exec(() => store.getState().toggleNodeCollapse(nodeId))}
        >
          <CtxIcon d={node.collapsed ? "M4 14h8v-2H4v2zM4 18h12v-2H4v2zM4 10h16V8H4v2z" : "M4 14h16v-2H4v2z"} />
          {node.collapsed ? 'Expand' : 'Collapse'}
          <span className={styles.contextMenuShortcut}>Ctrl+,</span>
        </button>
      )}

      {!isBoundary && (
        <button
          className={styles.contextMenuItem}
          role="menuitem"
          tabIndex={-1}
          onClick={() => exec(() => store.getState().toggleNodeLock(nodeId))}
        >
          <CtxIcon d={node.locked
            ? "M12 17a2 2 0 100-4 2 2 0 000 4zm6-6V9A6 6 0 006 9v2a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2v-6a2 2 0 00-2-2zm-2 0H8V9a4 4 0 018 0v2z"
            : "M12 17a2 2 0 100-4 2 2 0 000 4zm6-6h-1V9A5 5 0 007 9v2H6a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2v-6a2 2 0 00-2-2z"} />
          {node.locked ? 'Unlock' : 'Lock'}
          <span className={styles.contextMenuShortcut}>Ctrl+L</span>
        </button>
      )}

      {/* Breakpoint toggle */}
      <button
        className={styles.contextMenuItem}
        role="menuitem"
        tabIndex={-1}
        onClick={() => exec(() => store.getState().toggleBreakpoint(nodeId))}
      >
        <CtxIcon d={hasBreakpoint
          ? "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
          : "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"} />
        {hasBreakpoint ? 'Remove Breakpoint' : 'Set Breakpoint'}
        <span className={styles.contextMenuShortcut}>B</span>
      </button>

      {/* Conditional breakpoint — set expression to conditionally pause */}
      {hasBreakpoint && (
        <BreakpointConditionMenuItem nodeId={nodeId} />
      )}

      {/* Pin/unpin node type as favorite */}
      {node.type !== 'custom' && node.type !== 'subgraph' && node.type !== 'subgraph-input' && node.type !== 'subgraph-output' && (
        <button
          className={styles.contextMenuItem}
          role="menuitem"
          tabIndex={-1}
          onClick={() => exec(() => {
            const settings = useSettingsStore.getState();
            if (settings.pinnedNodeTypes.includes(node.type)) {
              settings.unpinNodeType(node.type);
            } else {
              settings.pinNodeType(node.type);
            }
          })}
        >
          <CtxIcon d={isPinned
            ? "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
            : "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"} />
          {isPinned ? 'Unpin Type' : 'Pin Type'}
        </button>
      )}

      {/* Data flow tracing */}
      <div className={styles.contextMenuLabel}>Inspect</div>
      <TraceMenuItem nodeId={nodeId} exec={exec} />

      {/* Copy result to clipboard */}
      <CopyResultMenuItem nodeId={nodeId} exec={exec} />

      {/* Select Connected — select upstream/downstream/all connected nodes */}
      {!isBoundary && (
        <>
          <div className={styles.contextMenuLabel}>Select</div>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              store.getState().setSelection(new Set([nodeId]));
              store.getState().selectConnected('downstream');
            })}
          >
            <CtxIcon d="M5 12h14M12 5l7 7-7 7" />
            Select Downstream
          </button>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              store.getState().setSelection(new Set([nodeId]));
              store.getState().selectConnected('upstream');
            })}
          >
            <CtxIcon d="M19 12H5M12 19l-7-7 7-7" />
            Select Upstream
          </button>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              store.getState().setSelection(new Set([nodeId]));
              store.getState().selectConnected('both');
            })}
          >
            <CtxIcon d="M8 12H3M21 12h-5M12 5l4 7-4 7M12 5L8 12l4 7" />
            Select All Connected
          </button>
        </>
      )}

      {/* Disconnect All — remove all connections from this node */}
      <DisconnectAllMenuItem nodeId={nodeId} exec={exec} />

      {/* Boundary node info */}
      {isBoundary && (
        <div style={{ padding: '6px 10px', fontSize: '10px', color: 'var(--btn-text)' }}>
          {node.type === 'subgraph-input' ? 'Subgraph Input' : 'Subgraph Output'} (cannot be deleted)
        </div>
      )}

      {/* Delete — hidden for boundary nodes which cannot be removed */}
      {!isBoundary && (
        <>
          <div className={styles.contextMenuDivider} />
          <button
            className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => {
              if (isSubgraph) {
                store.getState().deleteSubgraphNode(nodeId);
              } else {
                store.getState().removeNode(nodeId);
              }
            })}
          >
            <CtxIcon d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            Delete
            <span className={styles.contextMenuShortcut}>Del</span>
          </button>
        </>
      )}
    </>
  );
}

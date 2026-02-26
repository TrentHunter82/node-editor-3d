import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useSettingsStore, BUILTIN_PRESETS } from '../store/settingsStore';
import { matchesKeyCombo, SHORTCUT_DEFS } from '../utils/keyboardShortcuts';
import { recordAction } from '../utils/macroRecorder';
import { readFromSystemClipboard } from '../store/slices/coreSlice';

export interface PanelCallbacks {
  toggleSearch: () => void;
  toggleFindReplace: () => void;
  toggleValidation: () => void;
  toggleSettings: () => void;
  toggleDebug: () => void;
  toggleProfiling: () => void;
  toggleNodeSearch: () => void;
  closeContextMenu: () => void;
}

/**
 * Get the current key combo for an action, respecting user overrides.
 */
function getBinding(actionId: string): string {
  const overrides = useSettingsStore.getState().keyBindingOverrides;
  if (actionId in overrides) return overrides[actionId];
  const def = SHORTCUT_DEFS.find(d => d.id === actionId);
  return def?.defaultKey ?? '';
}

/**
 * Check if a keyboard event matches the current binding for an action.
 * If it matches and recording is active, record the action.
 */
function matchesAction(e: KeyboardEvent, actionId: string): boolean {
  const combo = getBinding(actionId);
  if (!combo) return false;
  const matched = matchesKeyCombo(e, combo);
  if (matched) recordAction(actionId);
  return matched;
}

/**
 * Global keyboard shortcut handler extracted from App.tsx for modularity.
 * Handles all editor-wide keyboard shortcuts.
 * Supports user-customizable key bindings via settingsStore.keyBindingOverrides.
 */
export function useKeyboardShortcuts(callbacks: PanelCallbacks) {
  const {
    toggleSearch,
    toggleFindReplace,
    toggleValidation,
    toggleSettings,
    toggleDebug,
    toggleProfiling,
    toggleNodeSearch,
    closeContextMenu,
  } = callbacks;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // --- Shortcuts that work even in inputs (customizable) ---

      // Search / Command palette
      if (matchesAction(e, 'search') ||
          (e.key === 'P' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        toggleSearch();
        return;
      }
      // Node search (Ctrl+F when no panel open; falls through to find-replace if Ctrl+Shift+F)
      if (e.key === 'f' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        toggleNodeSearch();
        return;
      }
      // Find/Replace
      if (matchesAction(e, 'find-replace')) {
        e.preventDefault();
        toggleFindReplace();
        return;
      }
      // Validation panel
      if (matchesAction(e, 'validation')) {
        e.preventDefault();
        toggleValidation();
        return;
      }
      // Settings
      if (matchesAction(e, 'settings')) {
        e.preventDefault();
        toggleSettings();
        return;
      }
      // Debug panel
      if (matchesAction(e, 'debug-panel')) {
        e.preventDefault();
        toggleDebug();
        return;
      }
      // Execute selection
      if (matchesAction(e, 'execute-selection')) {
        e.preventDefault();
        const store = useEditorStore.getState();
        if (store.selectedIds.size > 0) {
          store.executeSelection(store.selectedIds);
        }
        return;
      }
      // Debug step
      if (matchesAction(e, 'debug-step')) {
        e.preventDefault();
        useEditorStore.getState().stepExecution();
        return;
      }
      // Debug resume
      if (matchesAction(e, 'debug-resume')) {
        e.preventDefault();
        useEditorStore.getState().resumeExecution();
        return;
      }

      // Toggle breakpoint on selected node
      if (matchesAction(e, 'toggle-breakpoint')) {
        e.preventDefault();
        const { selectedIds } = useEditorStore.getState();
        for (const id of selectedIds) {
          useEditorStore.getState().toggleBreakpoint(id);
        }
        return;
      }

      if (isInput) return;

      // --- Shortcuts that only work outside inputs ---

      // Escape: close context menu, cancel connection, deselect
      if (matchesAction(e, 'escape')) {
        const cm = useEditorStore.getState().contextMenu;
        if (cm) {
          closeContextMenu();
          return;
        }
        useEditorStore.getState().cancelConnection();
        useEditorStore.getState().setSelection(new Set());
        document.body.style.cursor = 'auto';
        return;
      }

      // Clear graph: Ctrl+Shift+Delete
      if (matchesAction(e, 'clear-graph')) {
        e.preventDefault();
        if (window.confirm('Clear all nodes, connections, and groups? This cannot be undone.')) {
          useEditorStore.getState().clearGraph();
        }
        return;
      }

      // Delete/Backspace
      if (matchesAction(e, 'delete') || e.key === 'Backspace') {
        const state = useEditorStore.getState();
        if (e.key === 'Backspace' && state.selectedIds.size === 0 && state.breadcrumbStack.length > 0) {
          state.exitSubgraph();
          return;
        }
        if (state.selectedIds.size === 0) return;
        // Confirm when deleting multiple connections (no nodes selected)
        if (state.selectedIds.size > 1) {
          const selectedConns = [...state.selectedIds].filter(id => state.connections[id]);
          const selectedNodes = [...state.selectedIds].filter(id => state.nodes[id]);
          if (selectedConns.length > 1 && selectedNodes.length === 0) {
            if (!window.confirm(`Delete ${selectedConns.length} connections?`)) return;
          }
        }
        state.deleteSelected();
        e.preventDefault();
        return;
      }

      // Select all
      if (matchesAction(e, 'select-all')) {
        e.preventDefault();
        const state = useEditorStore.getState();
        state.setSelection(new Set([
          ...Object.keys(state.nodes),
          ...Object.keys(state.connections),
        ]));
      }

      // Undo
      if (matchesAction(e, 'undo')) {
        e.preventDefault();
        useEditorStore.getState().undo();
      }

      // Redo
      if (matchesAction(e, 'redo') ||
          (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        useEditorStore.getState().redo();
      }

      // Copy
      if (matchesAction(e, 'copy')) {
        e.preventDefault();
        useEditorStore.getState().copySelected();
      }

      // Paste — try system clipboard first for cross-tab support, fall back to module-scoped
      if (matchesAction(e, 'paste')) {
        e.preventDefault();
        readFromSystemClipboard().then(() => {
          useEditorStore.getState().paste();
        });
      }

      // Duplicate
      if (matchesAction(e, 'duplicate')) {
        e.preventDefault();
        useEditorStore.getState().duplicateSelected();
      }

      // Ungroup (check before group)
      if (matchesAction(e, 'ungroup')) {
        e.preventDefault();
        const state = useEditorStore.getState();
        const groupIds = new Set<string>();
        for (const id of state.selectedIds) {
          const node = state.nodes[id];
          if (node?.groupId) groupIds.add(node.groupId);
        }
        for (const groupId of groupIds) {
          useEditorStore.getState().ungroupNodes(groupId);
        }
        return;
      }

      // Group selected
      if (matchesAction(e, 'group')) {
        e.preventDefault();
        useEditorStore.getState().createGroup();
        return;
      }

      // Toggle snap
      if (matchesAction(e, 'toggle-snap')) {
        useEditorStore.getState().toggleSnap();
      }

      // Toggle grid visibility
      if (matchesAction(e, 'toggle-grid')) {
        window.__toggleGrid?.();
      }

      // Zoom to fit
      if (matchesAction(e, 'zoom-fit')) {
        window.__zoomToFit?.();
      }

      // Toggle collapse
      if (matchesAction(e, 'toggle-collapse')) {
        const state = useEditorStore.getState();
        const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
        if (selectedNodeIds.length === 0) return;
        const anyExpanded = selectedNodeIds.some(id => !state.nodes[id].collapsed);
        if (anyExpanded) {
          state.collapseSelected();
        } else {
          state.expandSelected();
        }
      }

      // Toggle lock (batch for multi-select: single undo entry)
      if (matchesAction(e, 'toggle-lock')) {
        const state = useEditorStore.getState();
        const ids = [...state.selectedIds].filter(id => state.nodes[id]);
        if (ids.length === 1) {
          state.toggleNodeLock(ids[0]);
        } else if (ids.length > 1) {
          state.batchToggleNodeLock(ids);
        }
      }

      // Align horizontal
      if (matchesAction(e, 'align-h')) {
        e.preventDefault();
        useEditorStore.getState().alignSelected('center-x');
        return;
      }

      // Align vertical
      if (matchesAction(e, 'align-v')) {
        e.preventDefault();
        useEditorStore.getState().alignSelected('center-z');
        return;
      }

      // Auto-layout
      if (matchesAction(e, 'auto-layout')) {
        useEditorStore.getState().autoLayout();
      }

      // Select connected upstream
      if (matchesAction(e, 'select-upstream')) {
        useEditorStore.getState().selectConnected('upstream');
      }

      // Select connected downstream
      if (matchesAction(e, 'select-downstream')) {
        useEditorStore.getState().selectConnected('downstream');
      }

      // Select all connected
      if (matchesAction(e, 'select-both')) {
        useEditorStore.getState().selectConnected('both');
      }

      // Add note
      if (matchesAction(e, 'add-note')) {
        useEditorStore.getState().addNode('note');
      }

      // Quick-add nodes: 1=source, 2=transform, 3=filter, 4=output
      if (['1', '2', '3', '4'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const types = ['source', 'transform', 'filter', 'output'] as const;
        useEditorStore.getState().addNode(types[parseInt(e.key) - 1]);
      }

      // Toggle value previews
      if (matchesAction(e, 'toggle-values')) {
        useEditorStore.getState().toggleValuePreviews();
      }

      // Toggle error strategy
      if (matchesAction(e, 'toggle-error-strategy')) {
        const s = useEditorStore.getState();
        s.setErrorStrategy(s.errorStrategy === 'fail-fast' ? 'continue' : 'fail-fast');
      }

      // Toggle profiling panel
      if (matchesAction(e, 'toggle-profiling')) {
        toggleProfiling();
      }

      // Toggle minimap
      if (matchesAction(e, 'toggle-minimap')) {
        window.__toggleMinimap?.();
      }

      // Toggle inspector
      if (matchesAction(e, 'toggle-inspector')) {
        window.__toggleInspector?.();
      }

      // Toggle toolbar visibility
      if (matchesAction(e, 'toggle-toolbar')) {
        useSettingsStore.getState().toggleToolbarVisible();
      }

      // Toggle overview mode
      if (matchesAction(e, 'toggle-overview')) {
        const settings = useSettingsStore.getState();
        settings.toggleOverviewMode();
        // When entering overview mode, trigger zoom-to-fit to show entire graph
        if (!settings.overviewMode) {
          window.__zoomToFit?.();
        }
      }

      // Alt+Arrow: traverse connections (navigate graph topology)
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const state = useEditorStore.getState();
        const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
        if (selectedNodeIds.length !== 1) return;
        const nodeId = selectedNodeIds[0];
        const conns = Object.values(state.connections);

        // Alt+Left/Up = upstream (inputs), Alt+Right/Down = downstream (outputs)
        const goUpstream = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        const adjacent = goUpstream
          ? conns.filter(c => c.targetNodeId === nodeId).map(c => c.sourceNodeId)
          : conns.filter(c => c.sourceNodeId === nodeId).map(c => c.targetNodeId);
        // Deduplicate
        const unique = [...new Set(adjacent)].filter(id => state.nodes[id]);
        if (unique.length === 0) return;
        // Pick the first adjacent node (or cycle if already on one)
        state.setSelection(new Set([unique[0]]));
        return;
      }

      // Enter: start/complete port connection when a port is focused
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const state = useEditorStore.getState();
        const { focusedPort, interaction, pendingConnection } = state;

        if (interaction === 'drawing-connection' && pendingConnection && focusedPort) {
          // Complete connection to focused input port
          if (focusedPort.side === 'input') {
            e.preventDefault();
            state.completeConnection(focusedPort.nodeId, focusedPort.portIndex);
            state.setFocusedPort(null);
            return;
          }
        } else if (focusedPort && interaction === 'idle') {
          if (focusedPort.side === 'output') {
            // Start connection from focused output port
            e.preventDefault();
            state.startConnection(focusedPort.nodeId, focusedPort.portIndex);
            return;
          }
        }
      }

      // Enter: enter subgraph node (when exactly one subgraph node is selected)
      if (matchesAction(e, 'enter-subgraph')) {
        const state = useEditorStore.getState();
        const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
        if (selectedNodeIds.length === 1) {
          const node = state.nodes[selectedNodeIds[0]];
          if (node.type === 'subgraph') {
            e.preventDefault();
            state.enterSubgraph(selectedNodeIds[0]);
            return;
          }
        }
      }

      // Arrow keys: nudge selected nodes, or switch camera view presets when nothing selected
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const state = useEditorStore.getState();
        const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
        e.preventDefault();
        if (selectedNodeIds.length > 0) {
          const step = e.shiftKey ? 1.0 : 0.5;
          state.pushUndoSnapshot();
          const positions: Record<string, [number, number, number]> = {};
          for (const id of selectedNodeIds) {
            const pos = state.nodes[id].position;
            if (e.key === 'ArrowLeft') positions[id] = [pos[0] - step, pos[1], pos[2]];
            else if (e.key === 'ArrowRight') positions[id] = [pos[0] + step, pos[1], pos[2]];
            else if (e.key === 'ArrowUp') positions[id] = [pos[0], pos[1], pos[2] - step];
            else positions[id] = [pos[0], pos[1], pos[2] + step];
          }
          state.setNodePositions(positions);
        } else {
          // Camera view presets: arrow keys switch view angle when no nodes selected
          // Shift+Up = Front, plain Up = Top
          let preset: 'top' | 'front' | 'left' | 'right' | 'isometric' | undefined;
          if (e.key === 'ArrowUp') preset = e.shiftKey ? 'front' : 'top';
          else if (e.key === 'ArrowDown') preset = 'isometric';
          else if (e.key === 'ArrowLeft') preset = 'left';
          else if (e.key === 'ArrowRight') preset = 'right';
          if (preset) window.__flyToViewPreset?.(preset);
        }
      }

      // Reset camera
      if (matchesAction(e, 'reset-camera')) {
        e.preventDefault();
        const ctrl = window.__orbitControls;
        if (ctrl) {
          ctrl.target.set(0, 0, 0);
          ctrl.object.position.set(5, 6, 8);
          ctrl.update();
          window.__invalidate?.();
        }
      }

      // Zoom in / Zoom out
      if (matchesAction(e, 'zoom-in') || (e.key === '=' && !e.ctrlKey && !e.metaKey)) {
        const ctrl = window.__orbitControls;
        if (ctrl) {
          const dir = ctrl.object.position.clone().sub(ctrl.target).normalize();
          ctrl.object.position.addScaledVector(dir, -1.5);
          ctrl.update();
          window.__invalidate?.();
        }
      }
      if (matchesAction(e, 'zoom-out')) {
        const ctrl = window.__orbitControls;
        if (ctrl) {
          const dir = ctrl.object.position.clone().sub(ctrl.target).normalize();
          ctrl.object.position.addScaledVector(dir, 1.5);
          ctrl.update();
          window.__invalidate?.();
        }
      }

      // Tab: cycle ports on selected node, or cycle selection through nodes
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const state = useEditorStore.getState();
        const nodeIds = Object.keys(state.nodes);
        if (nodeIds.length === 0) return;
        const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);

        // If exactly one node is selected, cycle through its ports
        if (selectedNodeIds.length === 1) {
          const nodeId = selectedNodeIds[0];
          const node = state.nodes[nodeId];
          // Build flat port list: outputs first, then inputs
          const ports: { nodeId: string; portIndex: number; side: 'input' | 'output' }[] = [];
          for (let i = 0; i < node.outputs.length; i++) ports.push({ nodeId, portIndex: i, side: 'output' });
          for (let i = 0; i < node.inputs.length; i++) ports.push({ nodeId, portIndex: i, side: 'input' });
          if (ports.length === 0) return;

          const current = state.focusedPort;
          const currentIdx = current && current.nodeId === nodeId
            ? ports.findIndex(p => p.portIndex === current.portIndex && p.side === current.side)
            : -1;
          const dir = e.shiftKey ? -1 : 1;
          const nextIdx = (currentIdx + dir + ports.length) % ports.length;
          state.setFocusedPort(ports[nextIdx]);
          return;
        }

        // No single node selected — cycle through nodes
        const currentId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
        const currentIdx = currentId ? nodeIds.indexOf(currentId) : -1;
        const dir = e.shiftKey ? -1 : 1;
        const nextIdx = currentIdx === -1 ? 0 : (currentIdx + dir + nodeIds.length) % nodeIds.length;
        state.setSelection(new Set([nodeIds[nextIdx]]));
      }

      // Ctrl+Alt+1-4: apply workspace layout presets
      if (e.key >= '1' && e.key <= '4' && (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey) {
        e.preventDefault();
        const presetIdx = parseInt(e.key) - 1;
        const preset = BUILTIN_PRESETS[presetIdx];
        if (preset && window.__applyWorkspacePreset) {
          window.__applyWorkspacePreset(preset.openPanels, preset.minimapVisible, preset.inspectorVisible);
          useSettingsStore.getState().setActiveWorkspacePreset(preset.id);
        }
        return;
      }

      // Ctrl+1-9: switch to graph tab by position (exclude Ctrl+Alt combos handled above)
      if (e.key >= '1' && e.key <= '9' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const state = useEditorStore.getState();
        const idx = parseInt(e.key) - 1;
        if (idx < state.graphOrder.length) {
          state.switchGraph(state.graphOrder[idx]);
        }
      }

      // Alt+1-9: recall camera bookmark
      if (e.key >= '1' && e.key <= '9' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const bookmark = useSettingsStore.getState().cameraBookmarks[e.key];
        if (bookmark) {
          window.__recallCameraBookmark?.(parseInt(e.key));
        }
        return;
      }

      // Alt+Shift+1-9: save camera bookmark
      if (e.key >= '1' && e.key <= '9' && e.altKey && !e.ctrlKey && !e.metaKey && e.shiftKey) {
        e.preventDefault();
        const ctrl = window.__orbitControls;
        if (ctrl) {
          const cam = ctrl.object;
          useSettingsStore.getState().setCameraBookmark(parseInt(e.key), {
            position: [cam.position.x, cam.position.y, cam.position.z],
            target: [ctrl.target.x, ctrl.target.y, ctrl.target.z],
          });
        }
        return;
      }

      // New graph tab
      if (matchesAction(e, 'new-graph')) {
        e.preventDefault();
        useEditorStore.getState().createGraph();
      }

      // Close active graph tab
      if (matchesAction(e, 'close-graph')) {
        e.preventDefault();
        const state = useEditorStore.getState();
        if (state.graphOrder.length > 1) {
          state.deleteGraph(state.activeGraphId);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSearch, toggleFindReplace, toggleValidation, toggleSettings, toggleDebug, toggleProfiling, toggleNodeSearch, closeContextMenu]);
}

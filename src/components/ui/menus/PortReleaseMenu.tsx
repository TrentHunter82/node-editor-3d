/**
 * Port release menu — shown when dropping a connection wire on empty canvas.
 * Filters node types by port compatibility for quick node creation + wiring.
 * Extracted from ContextMenu.tsx during Phase 42 architecture cleanup.
 */
import { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../../../store/editorStore';
import { NODE_TYPE_CONFIG, isPortTypeCompatible, PORT_TYPE_COLORS } from '../../../types';
import type { NodeType, PortType, PortConfig, NodeCategory } from '../../../types';
import { getAllPluginDefs } from '../../../store/pluginStore';
import { getXZFromScreen } from '../screenProjection';
import styles from '../../../styles/panels.module.css';
import { NODE_BUTTON_MAP } from './menuShared';
import type { ExecFn } from './menuShared';

export function PortReleaseMenu({ sourceNodeId, sourcePortIndex, screenX, screenY, exec }: { sourceNodeId: string; sourcePortIndex: number; screenX: number; screenY: number; exec: ExecFn }) {
  const store = useEditorStore;
  const sourceNode = useEditorStore(s => s.nodes[sourceNodeId]);
  const customNodeDefs = useEditorStore(s => s.customNodeDefs);
  const [focusIdx, setFocusIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll focused item into view. Declared before the early returns below so the
  // hook order stays stable across renders (e.g. if the source node is deleted
  // while this menu is open) — see react-hooks/rules-of-hooks.
  useEffect(() => {
    if (focusIdx >= 0 && listRef.current) {
      const buttons = listRef.current.querySelectorAll('[role="menuitem"]');
      buttons[focusIdx]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIdx]);

  if (!sourceNode) return null;

  // Convert screen position to world XZ position for node placement
  const getWorldPos = (): [number, number, number] => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      const wp = getXZFromScreen(screenX, screenY, canvas);
      if (wp) return [wp[0], 0, wp[1]];
    }
    return [0, 0, 0];
  };

  // startConnection always originates from an output port (see connectionSlice.ts:160)
  const sourceIsOutput = true;
  const sourcePort = sourceNode.outputs[sourcePortIndex];
  if (!sourcePort) return null;

  const sourcePortType: PortType = sourcePort.portType;
  const sourcePortColor = PORT_TYPE_COLORS[sourcePortType] ?? PORT_TYPE_COLORS.any;

  // Get compatible node types using store selector (respects isOutput direction)
  const compatible = store.getState().getCompatibleNodeTypes(sourceNodeId, sourcePortIndex, sourceIsOutput);

  // Group by category — use NODE_BUTTON_MAP for O(1) lookup
  const grouped = new Map<NodeCategory, { type: NodeType; label: string; color: string }[]>();
  for (const { type, category } of compatible) {
    const btn = NODE_BUTTON_MAP.get(type);
    if (!btn) continue;
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push({ type: btn.type, label: btn.label, color: btn.color });
  }

  // Filter custom node defs to those with compatible ports
  const compatibleCustomDefs = Object.values(customNodeDefs).filter(def =>
    def.inputs.some(inp => isPortTypeCompatible(sourcePortType, inp.portType))
  );

  // Filter plugin node defs to those with compatible ports
  const compatiblePluginDefs = getAllPluginDefs().filter(pDef => {
    const config = pDef.inputs;
    return config.some((inp: PortConfig) => isPortTypeCompatible(sourcePortType, inp.portType));
  });

  // Build flat item list for keyboard navigation
  type MenuItem = { kind: 'builtin'; type: NodeType; label: string; color: string }
    | { kind: 'custom'; defId: string; name: string; color: string }
    | { kind: 'plugin'; pluginType: string; name: string; color: string };
  const flatItems: MenuItem[] = [];
  for (const [, items] of grouped) {
    for (const item of items) flatItems.push({ kind: 'builtin', ...item });
  }
  for (const def of compatibleCustomDefs) flatItems.push({ kind: 'custom', defId: def.id, name: def.name, color: def.color });
  for (const pDef of compatiblePluginDefs) flatItems.push({ kind: 'plugin', pluginType: pDef.type, name: pDef.name, color: pDef.color ?? '#2EC4B6' });

  const hasResults = flatItems.length > 0;

  const executeItem = (item: MenuItem) => {
    if (item.kind === 'builtin') {
      exec(() => {
        store.getState().addNodeAndConnect(item.type, getWorldPos(), sourceNodeId, sourcePortIndex, sourceIsOutput);
      });
    } else if (item.kind === 'custom') {
      exec(() => {
        const newNodeId = store.getState().addCustomNode(item.defId, getWorldPos());
        if (!newNodeId) return;
        const newNode = store.getState().nodes[newNodeId];
        if (!newNode) return;
        const compatibleIndex = newNode.inputs.findIndex(inp => isPortTypeCompatible(sourcePortType, inp.portType));
        if (compatibleIndex >= 0) {
          store.getState().addConnection(sourceNodeId, sourcePortIndex, newNodeId, compatibleIndex);
        }
      });
    } else if (item.kind === 'plugin') {
      exec(() => {
        const newNodeId = store.getState().addNode(item.pluginType as NodeType, getWorldPos());
        if (!newNodeId) return;
        const newNode = store.getState().nodes[newNodeId];
        if (!newNode) return;
        const compatibleIndex = newNode.inputs.findIndex(inp => isPortTypeCompatible(sourcePortType, inp.portType));
        if (compatibleIndex >= 0) {
          store.getState().addConnection(sourceNodeId, sourcePortIndex, newNodeId, compatibleIndex);
        }
      });
    }
  };

  // Keyboard navigation — PortReleaseMenu owns all arrow/Enter/Home/End handling
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!hasResults) return;
    let nextIdx = focusIdx;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextIdx = Math.min(focusIdx + 1, flatItems.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextIdx = Math.max(focusIdx - 1, 0);
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIdx = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIdx = flatItems.length - 1;
    } else if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < flatItems.length) {
      e.preventDefault();
      executeItem(flatItems[focusIdx]);
      return;
    } else {
      return;
    }
    setFocusIdx(nextIdx);
    // Sync DOM focus with visual highlight
    if (listRef.current) {
      const buttons = listRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]');
      buttons[nextIdx]?.focus();
    }
  };

  // Track flat index for rendering
  let itemIdx = 0;

  return (
    <div ref={listRef} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className={styles.contextMenuLabel} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        Connect to...
        <span style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: sourcePortColor,
          flexShrink: 0,
        }} />
        <span style={{ fontSize: '8px', color: 'var(--text-faint)', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-mono)' }}>
          {sourcePortType}
        </span>
      </div>
      {[...grouped.entries()].map(([category, items]) => (
        <div key={category}>
          <div className={styles.contextMenuLabel} style={{ paddingTop: '6px', fontSize: '8px' }}>
            {category}
          </div>
          {items.map(({ type, label, color }) => {
            const idx = itemIdx++;
            const isFocused = idx === focusIdx;
            const config = NODE_TYPE_CONFIG[type];
            const matchingPort = config.inputs.find(inp => isPortTypeCompatible(sourcePortType, inp.portType));
            const matchPortColor = matchingPort ? PORT_TYPE_COLORS[matchingPort.portType] : undefined;

            return (
              <button
                key={type}
                className={styles.contextMenuItem}
                role="menuitem"
                tabIndex={-1}
                style={isFocused ? { background: 'var(--hover-bg, rgba(46,196,182,0.15))' } : undefined}
                onClick={() => exec(() => {
                  store.getState().addNodeAndConnect(type, getWorldPos(), sourceNodeId, sourcePortIndex, sourceIsOutput);
                })}
              >
                <span className={styles.contextMenuDot} style={{ background: color }} />
                {label}
                {matchPortColor && (
                  <span style={{
                    marginLeft: 'auto',
                    display: 'inline-block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: matchPortColor,
                    opacity: 0.7,
                  }} />
                )}
              </button>
            );
          })}
        </div>
      ))}
      {compatibleCustomDefs.length > 0 && (
        <div>
          <div className={styles.contextMenuLabel} style={{ paddingTop: '6px', fontSize: '8px' }}>
            Custom
          </div>
          {compatibleCustomDefs.map(def => {
            const idx = itemIdx++;
            const isFocused = idx === focusIdx;
            return (
              <button
                key={def.id}
                className={styles.contextMenuItem}
                role="menuitem"
                tabIndex={-1}
                style={isFocused ? { background: 'var(--hover-bg, rgba(46,196,182,0.15))' } : undefined}
                onClick={() => executeItem({ kind: 'custom', defId: def.id, name: def.name, color: def.color })}
              >
                <span className={styles.contextMenuDot} style={{ background: def.color }} />
                {def.name}
                <span style={{ marginLeft: 'auto', fontSize: '9px', opacity: 0.4 }}>Custom</span>
              </button>
            );
          })}
        </div>
      )}
      {compatiblePluginDefs.length > 0 && (
        <div>
          <div className={styles.contextMenuLabel} style={{ paddingTop: '6px', fontSize: '8px' }}>
            Plugin
          </div>
          {compatiblePluginDefs.map(pDef => {
            const idx = itemIdx++;
            const isFocused = idx === focusIdx;
            return (
              <button
                key={pDef.type}
                className={styles.contextMenuItem}
                role="menuitem"
                tabIndex={-1}
                style={isFocused ? { background: 'var(--hover-bg, rgba(46,196,182,0.15))' } : undefined}
                onClick={() => executeItem({ kind: 'plugin', pluginType: pDef.type, name: pDef.name, color: pDef.color ?? '#2EC4B6' })}
              >
                <span className={styles.contextMenuDot} style={{ background: pDef.color ?? '#2EC4B6' }} />
                {pDef.name}
                <span style={{ marginLeft: 'auto', fontSize: '9px', opacity: 0.4 }}>Plugin</span>
              </button>
            );
          })}
        </div>
      )}
      {!hasResults && (
        <div style={{ padding: '8px 12px', color: 'var(--btn-text)', fontSize: '11px' }}>
          No compatible node types
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePluginStore, getAllPluginDefs } from '../../store/pluginStore';
import type { NodeType, NodeCategory, PortType } from '../../types';
import { NODE_CATEGORIES, NODE_TYPE_CONFIG, PORT_TYPE_COLORS } from '../../types';
import { useNodeHelp, preloadNodeHelp } from '../../hooks/useNodeHelp';
import { getNodeLabel, COLOR_HEX } from '../../types/nodeLabels';

/** Build the full node type list from NODE_CATEGORIES, excluding internal types */
const MENU_NODES: { type: NodeType; label: string; color: string; category: NodeCategory }[] =
  (Object.keys(NODE_CATEGORIES) as NodeType[])
    .filter(t => t !== 'subgraph-input' && t !== 'subgraph-output' && t !== 'custom')
    .map(type => ({
      type,
      label: getNodeLabel(type, true),
      color: COLOR_HEX[NODE_TYPE_CONFIG[type]?.color] ?? 'var(--teal)',
      category: NODE_CATEGORIES[type],
    }));

const CATEGORY_ORDER: string[] = ['Pinned', 'Recent', 'Core', 'Math', 'String', 'Logic', 'Vector', 'Data', 'Color', 'Live', 'Utility', 'Subgraph', 'Plugin'];

/** When set, the menu filters by compatible types and auto-connects the new node */
export interface ConnectInfo {
  sourceNodeId: string;
  sourcePortIndex: number;
  /** true = dragging from an output port (new node's input connects), false = from input */
  sourceIsOutput: boolean;
}

interface QuickNodeMenuProps {
  open: boolean;
  onClose: () => void;
  /** Screen position to display the menu at */
  screenPos?: { x: number; y: number };
  /** World position to create the node at (XZ plane) */
  worldPos?: [number, number];
  /** When set, filters by compatible port types and auto-connects the new node */
  connectInfo?: ConnectInfo;
}

/** Inline help tooltip panel for the focused node type in QuickNodeMenu */
function QNMHelpTooltip({ nodeType }: { nodeType: string }) {
  const help = useNodeHelp(nodeType);
  if (!help) return null;
  return (
    <div style={{
      position: 'absolute',
      left: 248,
      top: 0,
      width: 230,
      maxHeight: 300,
      overflowY: 'auto',
      background: 'var(--panel-bg-solid)',
      border: '1px solid var(--panel-border)',
      borderRadius: 8,
      padding: '8px 10px',
      boxShadow: '0 4px 16px var(--shadow)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '9px',
      color: 'var(--text)',
      pointerEvents: 'none',
      zIndex: 10000,
      scrollbarWidth: 'thin',
      scrollbarColor: 'var(--scrollbar-thumb) transparent',
    }}>
      <div style={{ fontWeight: 700, fontSize: '10px', color: 'var(--text-bright)', marginBottom: 3 }}>
        {help.summary}
      </div>
      <div style={{ color: 'var(--text-dim)', lineHeight: 1.4, marginBottom: 6 }}>
        {help.description}
      </div>
      {help.inputs.length > 0 && (
        <>
          <div style={{ fontSize: '7px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Inputs</div>
          {help.inputs.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 3, alignItems: 'baseline', marginBottom: 1 }}>
              <span style={{
                fontSize: '6px',
                padding: '0 2px',
                borderRadius: 2,
                background: (PORT_TYPE_COLORS[p.type as PortType] ?? '#888') + '18',
                color: PORT_TYPE_COLORS[p.type as PortType] ?? '#888',
              }}>{p.type}</span>
              <span style={{ color: 'var(--text)' }}>{p.name}</span>
            </div>
          ))}
        </>
      )}
      {help.outputs.length > 0 && (
        <>
          <div style={{ fontSize: '7px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 4, marginBottom: 2 }}>Outputs</div>
          {help.outputs.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 3, alignItems: 'baseline', marginBottom: 1 }}>
              <span style={{
                fontSize: '6px',
                padding: '0 2px',
                borderRadius: 2,
                background: (PORT_TYPE_COLORS[p.type as PortType] ?? '#888') + '18',
                color: PORT_TYPE_COLORS[p.type as PortType] ?? '#888',
              }}>{p.type}</span>
              <span style={{ color: 'var(--text)' }}>{p.name}</span>
            </div>
          ))}
        </>
      )}
      {help.tips && help.tips.length > 0 && (
        <>
          <div style={{ fontSize: '7px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 4, marginBottom: 2 }}>Tips</div>
          {help.tips.map((tip, i) => (
            <div key={i} style={{ color: 'var(--teal)', fontSize: '8px', lineHeight: 1.3, marginBottom: 1 }}>
              {tip}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function QuickNodeMenu({ open, onClose, screenPos, worldPos, connectInfo }: QuickNodeMenuProps) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const addNode = useEditorStore(s => s.addNode);
  const customNodeDefs = useEditorStore(s => s.customNodeDefs);
  const addCustomNode = useEditorStore(s => s.addCustomNode);
  const recentlyUsedNodes = useSettingsStore(s => s.recentlyUsedNodes);
  const pinnedNodeTypes = useSettingsStore(s => s.pinnedNodeTypes);
  // Subscribe to plugin registry changes for re-render
  const pluginVersion = usePluginStore(s => s.registryVersion);

  // When connectInfo is set, get the set of compatible node types
  const compatibleTypes = useMemo(() => {
    if (!connectInfo) return null;
    const types = useEditorStore.getState().getCompatibleNodeTypes(
      connectInfo.sourceNodeId,
      connectInfo.sourcePortIndex,
      connectInfo.sourceIsOutput,
    );
    return new Set(types.map(t => t.type));
  }, [connectInfo]);

  // Build combined list: built-in + custom nodes + plugin nodes + recent
  const allNodes = useMemo(() => {
    const customs = Object.values(customNodeDefs).map(def => ({
      type: 'custom' as NodeType,
      label: def.name,
      color: def.color,
      category: 'Custom' as string,
      customId: def.id,
      pluginType: undefined as string | undefined,
    }));
    const builtIn = MENU_NODES.map(n => ({ ...n, customId: undefined as string | undefined, pluginType: undefined as string | undefined }));

    // Plugin nodes
    const plugins = pluginVersion >= 0 ? getAllPluginDefs().map(pDef => ({
      type: pDef.type as NodeType,
      label: pDef.name,
      color: COLOR_HEX[pDef.color] ?? pDef.color ?? '#2EC4B6',
      category: (pDef.category || 'Plugin') as string,
      customId: undefined as string | undefined,
      pluginType: pDef.type,
    })) : [];

    // Build pinned section from pinnedNodeTypes
    const pinnedItems = pinnedNodeTypes
      .map(type => {
        const info = MENU_NODES.find(n => n.type === type);
        if (!info) return null;
        return { ...info, category: 'Pinned' as string, customId: undefined as string | undefined, pluginType: undefined as string | undefined };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);

    // Build recent section from recentlyUsedNodes
    const recentItems = recentlyUsedNodes
      .map(type => {
        const info = MENU_NODES.find(n => n.type === type);
        if (!info) return null;
        return { ...info, category: 'Recent' as string, customId: undefined as string | undefined, pluginType: undefined as string | undefined };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);

    return [...pinnedItems, ...recentItems, ...builtIn, ...customs, ...plugins];
  }, [customNodeDefs, recentlyUsedNodes, pinnedNodeTypes, pluginVersion]);

  const filtered = useMemo(() => {
    let list = allNodes;
    // Filter by compatible port types when connecting
    if (compatibleTypes) {
      list = list.filter(n => compatibleTypes.has(n.type));
    }
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    // When searching, exclude Pinned/Recent categories (they're duplicates of the real entries)
    return list.filter(
      n => n.category !== 'Recent' && n.category !== 'Pinned' && (n.label.toLowerCase().includes(q) || n.category.toLowerCase().includes(q) || n.type.toLowerCase().includes(q))
    );
  }, [search, allNodes, compatibleTypes]);

  // Reset state when opened; preload help data
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIndex(0);
      preloadNodeHelp();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep selectedIndex in bounds
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  const handleSelect = useCallback((node: typeof allNodes[0]) => {
    const pos: [number, number, number] = worldPos ? [worldPos[0], 0, worldPos[1]] : [0, 0, 0];
    // If connecting, use addNodeAndConnect for atomic node creation + wiring
    if (connectInfo && !node.customId && node.type !== 'subgraph') {
      useEditorStore.getState().addNodeAndConnect(
        (node.pluginType ?? node.type) as NodeType,
        pos,
        connectInfo.sourceNodeId,
        connectInfo.sourcePortIndex,
        connectInfo.sourceIsOutput,
      );
    } else if (node.customId) {
      addCustomNode(node.customId);
    } else if (node.pluginType) {
      addNode(node.pluginType as NodeType, pos);
    } else if (node.type === 'subgraph') {
      useEditorStore.getState().createSubgraph();
    } else {
      addNode(node.type, pos);
    }
    useSettingsStore.getState().addRecentlyUsedNode(node.type);
    onClose();
  }, [worldPos, addNode, addCustomNode, onClose, connectInfo]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex]);
      }
    }
  }, [filtered, selectedIndex, handleSelect, onClose]);

  // Scroll selected item into view (use ID lookup — children are grouped by category, not flat)
  useEffect(() => {
    const node = filtered[selectedIndex];
    if (!node) return;
    const optionId = `qnm-opt-${node.category === 'Recent' ? 'recent-' : ''}${node.pluginType ?? node.customId ?? node.type}`;
    document.getElementById(optionId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, filtered]);

  if (!open) return null;

  // Position: near cursor or centered
  const menuStyle: React.CSSProperties = screenPos
    ? {
        position: 'fixed',
        top: Math.max(0, Math.min(screenPos.y, window.innerHeight - 350)),
        left: Math.max(0, Math.min(screenPos.x, window.innerWidth - 260)),
        maxWidth: '100vw',
      }
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        maxWidth: '100vw',
      };

  // Group filtered by category for display
  const grouped = new Map<string, typeof filtered>();
  for (const n of filtered) {
    const list = grouped.get(n.category) ?? [];
    list.push(n);
    grouped.set(n.category, list);
  }

  // Map each item to its index in the filtered array for correct keyboard nav
  const filteredIndexMap = new Map(filtered.map((n, i) => [n, i]));

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 150,
          background: 'var(--overlay-bg)',
        }}
      />
      {/* Menu + tooltip container (position:relative for tooltip anchoring) */}
      <div style={{ ...menuStyle, zIndex: 151 }}>
      <div
        style={{
          position: 'relative',
          width: 240,
          maxHeight: 380,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 8,
          background: 'var(--panel-bg)',
          border: '1px solid var(--panel-border)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 4px 20px var(--shadow)',
          overflow: 'hidden',
          fontFamily: "'JetBrains Mono', monospace",
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div style={{ padding: '8px 8px 4px' }}>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls="qnm-listbox"
            aria-activedescendant={filtered[selectedIndex] ? `qnm-opt-${filtered[selectedIndex].category === 'Recent' ? 'recent-' : ''}${filtered[selectedIndex].pluginType ?? filtered[selectedIndex].customId ?? filtered[selectedIndex].type}` : undefined}
            value={search}
            onChange={e => { setSearch(e.target.value); setSelectedIndex(0); }}
            placeholder={connectInfo ? "Connect to..." : "Add node..."}
            style={{
              width: '100%',
              padding: '6px 8px',
              borderRadius: 5,
              border: '1px solid var(--btn-border)',
              background: 'var(--bg-subtle)',
              color: 'var(--text)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Node list */}
        <div
          id="qnm-listbox"
          ref={listRef}
          role="listbox"
          aria-label="Node types"
          style={{ overflowY: 'auto', padding: '4px 0' }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 11 }}>
              No nodes match &ldquo;{search}&rdquo;
            </div>
          )}
          {CATEGORY_ORDER.concat(
            grouped.has('Custom') ? ['Custom'] : [],
            // Include any dynamic plugin categories not in the static order
            ...[...grouped.keys()].filter(k => !CATEGORY_ORDER.includes(k) && k !== 'Custom').map(k => [k]),
          ).map(cat => {
            const items = grouped.get(cat);
            if (!items || items.length === 0) return null;
            return (
              <div key={cat} role="group" aria-label={cat}>
                <div style={{
                  padding: '4px 12px 2px',
                  fontSize: 9,
                  fontWeight: 600,
                  color: (cat === 'Recent' || cat === 'Pinned') ? 'var(--teal)' : 'var(--text-faint)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }} aria-hidden="true">
                  {cat}
                </div>
                {items.map(node => {
                  const idx = filteredIndexMap.get(node) ?? 0;
                  const isActive = idx === selectedIndex;
                  const optionId = `qnm-opt-${cat === 'Recent' ? 'recent-' : ''}${node.pluginType ?? node.customId ?? node.type}`;
                  return (
                    <div
                      key={optionId}
                      id={optionId}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelect(node)}
                      onPointerEnter={() => setSelectedIndex(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 12px',
                        cursor: 'pointer',
                        background: isActive ? 'color-mix(in srgb, var(--teal) 12%, transparent)' : 'transparent',
                        fontSize: 12,
                        color: isActive ? 'var(--text-bright)' : 'var(--text)',
                        transition: 'background 0.1s',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: node.color,
                        flexShrink: 0,
                      }} />
                      <span style={{ flex: 1 }}>{node.label}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '4px 12px 6px',
          fontSize: 10,
          color: 'var(--text-faint)',
          borderTop: '1px solid var(--divider)',
          textAlign: 'center',
        }}>
          {connectInfo ? 'Enter to add & connect' : 'Enter to add'} &middot; Esc to close
        </div>
      </div>

      {/* Help tooltip for focused node (outside overflow container) */}
      {filtered[selectedIndex] && (
        <QNMHelpTooltip nodeType={filtered[selectedIndex].pluginType ?? filtered[selectedIndex].type} />
      )}
      </div>
    </>
  );
}

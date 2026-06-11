import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePluginStore, getAllPluginDefs } from '../../store/pluginStore';
import type { NodeType, NodeCategory } from '../../types';
import { NODE_CATEGORIES, NODE_TYPE_CONFIG, PORT_TYPE_COLORS } from '../../types';
import type { PortType } from '../../types';
import { fuzzyMatchMulti } from '../../utils/fuzzyMatch';
import { useNodeHelp, preloadNodeHelp } from '../../hooks/useNodeHelp';
import { TYPE_LABELS, TYPE_DESCRIPTIONS, COLOR_HEX } from '../../types/nodeLabels';
import styles from '../../styles/panels.module.css';

/** Build the full node type list from NODE_CATEGORIES, excluding internal types */
const ALL_NODE_TYPES: { type: NodeType; label: string; color: string; category: NodeCategory; description: string }[] =
  (Object.keys(NODE_CATEGORIES) as NodeType[])
    .filter(t => t !== 'subgraph-input' && t !== 'subgraph-output' && t !== 'custom' && t !== 'subgraph')
    .map(type => ({
      type,
      label: TYPE_LABELS[type] ?? type,
      color: COLOR_HEX[NODE_TYPE_CONFIG[type]?.color] ?? 'var(--teal)',
      category: NODE_CATEGORIES[type],
      description: TYPE_DESCRIPTIONS[type] ?? '',
    }));

const CATEGORY_FILTERS: ('All' | NodeCategory)[] = ['All', 'Core', 'Math', 'String', 'Logic', 'Vector', 'Data', 'Color', 'Live', 'Utility', 'Subgraph'];

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Optional world position to place new nodes at (e.g. from double-click on canvas) */
  placeAt?: [number, number, number] | null;
}

interface SearchResult {
  id: string;
  label: string;
  section: 'pinned' | 'recent' | 'actions' | 'nodes';
  action: () => void;
  color?: string;
  /** Fuzzy match score for sorting (higher = better match) */
  score?: number;
  /** Short description shown on hover */
  description?: string;
  /** Node type for help lookup */
  nodeType?: string;
}

/** Inline help tooltip panel for the focused node type */
function NodeHelpTooltip({ nodeType }: { nodeType: string }) {
  const help = useNodeHelp(nodeType);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [flipSide, setFlipSide] = useState(false);

  // Detect if tooltip overflows viewport right edge and flip to left side
  useEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFlipSide(rect.right > window.innerWidth - 8);
  }, [nodeType]);

  if (!help) return null;
  return (
    <div
      ref={tooltipRef}
      id="sp-help-tooltip"
      role="tooltip"
      style={{
      position: 'absolute',
      ...(flipSide
        ? { right: '100%', marginRight: 8 }
        : { left: '100%', marginLeft: 8 }),
      top: 0,
      width: 260,
      maxHeight: 340,
      overflowY: 'auto',
      background: 'var(--panel-bg-solid)',
      border: '1px solid var(--panel-border)',
      borderRadius: 8,
      padding: '10px 12px',
      boxShadow: '0 4px 16px var(--shadow)',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10px',
      color: 'var(--text)',
      pointerEvents: 'none',
      zIndex: 10000,
      scrollbarWidth: 'thin',
      scrollbarColor: 'var(--scrollbar-thumb) transparent',
    }}>
      <div style={{ fontWeight: 700, fontSize: '11px', color: 'var(--text-bright)', marginBottom: 4 }}>
        {help.summary}
      </div>
      <div style={{ color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 8 }}>
        {help.description}
      </div>
      {help.inputs.length > 0 && (
        <>
          <div style={{ fontSize: '8px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Inputs</div>
          {help.inputs.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{
                fontSize: '7px',
                padding: '0 3px',
                borderRadius: 2,
                background: (PORT_TYPE_COLORS[p.type as PortType] ?? '#888') + '18',
                color: PORT_TYPE_COLORS[p.type as PortType] ?? '#888',
              }}>{p.type}</span>
              <span style={{ color: 'var(--text)' }}>{p.name}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: '9px' }}>{p.description}</span>
            </div>
          ))}
        </>
      )}
      {help.outputs.length > 0 && (
        <>
          <div style={{ fontSize: '8px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 6, marginBottom: 3 }}>Outputs</div>
          {help.outputs.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{
                fontSize: '7px',
                padding: '0 3px',
                borderRadius: 2,
                background: (PORT_TYPE_COLORS[p.type as PortType] ?? '#888') + '18',
                color: PORT_TYPE_COLORS[p.type as PortType] ?? '#888',
              }}>{p.type}</span>
              <span style={{ color: 'var(--text)' }}>{p.name}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: '9px' }}>{p.description}</span>
            </div>
          ))}
        </>
      )}
      {help.tips && help.tips.length > 0 && (
        <>
          <div style={{ fontSize: '8px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 6, marginBottom: 3 }}>Tips</div>
          {help.tips.map((tip, i) => (
            <div key={i} style={{ color: 'var(--teal)', fontSize: '9px', lineHeight: 1.4, marginBottom: 2 }}>
              {tip}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function SearchPalette({ open, onClose, placeAt }: SearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState<'All' | NodeCategory>('All');
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  const nodes = useEditorStore(s => s.nodes);
  const customNodeDefs = useEditorStore(s => s.customNodeDefs);
  const recentlyUsedNodes = useSettingsStore(s => s.recentlyUsedNodes);
  const pinnedNodeTypes = useSettingsStore(s => s.pinnedNodeTypes);
  // Subscribe to plugin registry changes to re-render when plugins are registered
  const pluginVersion = usePluginStore(s => s.registryVersion);

  // Stable ref for onClose so it doesn't invalidate the results memo on every parent render
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const results = useMemo((): SearchResult[] => {
    const close = () => onCloseRef.current();
    const q = query.toLowerCase().trim();
    const items: SearchResult[] = [];
    const addRecentlyUsed = useSettingsStore.getState().addRecentlyUsedNode;

    // Pinned/favorite nodes (shown at top when no query and no category filter)
    if (!q && categoryFilter === 'All' && pinnedNodeTypes.length > 0) {
      for (const pinnedType of pinnedNodeTypes) {
        const info = ALL_NODE_TYPES.find(n => n.type === pinnedType);
        if (info) {
          items.push({
            id: `pinned-${info.type}`,
            label: `Add ${info.label}`,
            section: 'pinned',
            color: info.color,
            nodeType: info.type,
            action: () => {
              useEditorStore.getState().addNode(info.type, placeAt ?? undefined);
              addRecentlyUsed(info.type);
              close();
            },
          });
        }
      }
    }

    // Recently used nodes (only when no query and no category filter)
    if (!q && categoryFilter === 'All' && recentlyUsedNodes.length > 0) {
      for (const recentType of recentlyUsedNodes) {
        const info = ALL_NODE_TYPES.find(n => n.type === recentType);
        if (info) {
          items.push({
            id: `recent-${info.type}`,
            label: `Add ${info.label}`,
            section: 'recent',
            color: info.color,
            nodeType: info.type,
            action: () => {
              useEditorStore.getState().addNode(info.type, placeAt ?? undefined);
              addRecentlyUsed(info.type);
              close();
            },
          });
        }
      }
    }

    // Action results: add node types (filtered by category and query)
    for (const info of ALL_NODE_TYPES) {
      if (categoryFilter !== 'All' && info.category !== categoryFilter) continue;
      const addLabel = `Add ${info.label}`;
      if (!q) {
        items.push({
          id: `add-${info.type}`,
          label: addLabel,
          section: 'actions',
          color: info.color,
          score: 50,
          description: info.description,
          nodeType: info.type,
          action: () => {
            useEditorStore.getState().addNode(info.type, placeAt ?? undefined);
            addRecentlyUsed(info.type);
            close();
          },
        });
      } else {
        const match = fuzzyMatchMulti(q, addLabel, info.type, info.category, info.description);
        if (match.score > 0) {
          items.push({
            id: `add-${info.type}`,
            label: addLabel,
            section: 'actions',
            color: info.color,
            score: match.score,
            description: info.description,
            nodeType: info.type,
            action: () => {
              useEditorStore.getState().addNode(info.type, placeAt ?? undefined);
              addRecentlyUsed(info.type);
              close();
            },
          });
        }
      }
    }

    // Custom node definitions
    for (const def of Object.values(customNodeDefs)) {
      if (categoryFilter !== 'All' && categoryFilter !== 'Utility') continue;
      const customLabel = `Add ${def.name} (Custom)`;
      if (!q) {
        items.push({
          id: `add-custom-${def.id}`,
          label: customLabel,
          section: 'actions',
          color: def.color,
          score: 50,
          action: () => {
            useEditorStore.getState().addCustomNode(def.id, placeAt ?? undefined);
            addRecentlyUsed('custom');
            close();
          },
        });
      } else {
        const match = fuzzyMatchMulti(q, customLabel, def.name);
        if (match.score > 0) {
          items.push({
            id: `add-custom-${def.id}`,
            label: customLabel,
            section: 'actions',
            color: def.color,
            score: match.score,
            action: () => {
              useEditorStore.getState().addCustomNode(def.id, placeAt ?? undefined);
              addRecentlyUsed('custom');
              close();
            },
          });
        }
      }
    }

    // Plugin node definitions
    if (pluginVersion >= 0) { // always true; dependency forces re-eval on plugin changes
      for (const pDef of getAllPluginDefs()) {
        const cat = pDef.category || 'Utility';
        if (categoryFilter !== 'All' && categoryFilter !== cat) continue;
        const pluginLabel = `Add ${pDef.name} (Plugin)`;
        if (!q) {
          items.push({
            id: `add-plugin-${pDef.type}`,
            label: pluginLabel,
            section: 'actions',
            color: COLOR_HEX[pDef.color] ?? 'var(--teal)',
            score: 50,
            action: () => {
              useEditorStore.getState().addNode(pDef.type as NodeType, placeAt ?? undefined);
              close();
            },
          });
        } else {
          const match = fuzzyMatchMulti(q, pluginLabel, pDef.name, pDef.type);
          if (match.score > 0) {
            items.push({
              id: `add-plugin-${pDef.type}`,
              label: pluginLabel,
              section: 'actions',
              color: COLOR_HEX[pDef.color] ?? 'var(--teal)',
              score: match.score,
              action: () => {
                useEditorStore.getState().addNode(pDef.type as NodeType, placeAt ?? undefined);
                close();
              },
            });
          }
        }
      }
    }

    // Subgraph creation
    if (categoryFilter === 'All' || categoryFilter === 'Utility' || categoryFilter === 'Subgraph') {
      const subLabel = 'Add Subgraph';
      if (!q || subLabel.toLowerCase().includes(q) || 'subgraph'.includes(q)) {
        items.push({
          id: 'add-subgraph',
          label: subLabel,
          section: 'actions',
          color: 'var(--coral)',
          action: () => {
            useEditorStore.getState().createSubgraph();
            addRecentlyUsed('subgraph');
            close();
          },
        });
      }
    }

    // Static actions (only shown when no category filter is active)
    if (categoryFilter === 'All') {
      const actions: { id: string; label: string; action: () => void }[] = [
        { id: 'zoom-fit', label: 'Zoom to Fit', action: () => { window.__zoomToFit?.(); close(); } },
        { id: 'select-all', label: 'Select All', action: () => { const s = useEditorStore.getState(); s.setSelection(new Set([...Object.keys(s.nodes), ...Object.keys(s.connections)])); close(); } },
        { id: 'toggle-snap', label: 'Toggle Snap to Grid', action: () => { useEditorStore.getState().toggleSnap(); close(); } },
        { id: 'auto-layout', label: 'Auto Layout', action: () => { useEditorStore.getState().autoLayout(); close(); } },
        { id: 'align-h', label: 'Align Selected Horizontal', action: () => { useEditorStore.getState().alignSelected('center-x'); close(); } },
        { id: 'align-v', label: 'Align Selected Vertical', action: () => { useEditorStore.getState().alignSelected('center-z'); close(); } },
        { id: 'convert-subgraph', label: 'Convert Selection to Subgraph', action: () => { useEditorStore.getState().convertSelectionToSubgraph(); close(); } },
        { id: 'toggle-error-strategy', label: 'Toggle Error Strategy (Fail-fast / Continue)', action: () => { const s = useEditorStore.getState(); s.setErrorStrategy(s.errorStrategy === 'fail-fast' ? 'continue' : 'fail-fast'); close(); } },
        { id: 'toggle-value-previews', label: 'Toggle Value Previews', action: () => { useEditorStore.getState().toggleValuePreviews(); close(); } },
        { id: 'find-replace', label: 'Find & Replace in Nodes (Ctrl+H)', action: () => { close(); window.__openFindReplace?.(); } },
        { id: 'validation-panel', label: 'Show Validation Errors (Ctrl+Shift+M)', action: () => { close(); window.__openValidation?.(); } },
        { id: 'profiling-panel', label: 'Show Profiling Panel (Shift+P)', action: () => { close(); window.__openProfiling?.(); } },
        { id: 'settings', label: 'Open Settings (Ctrl+,)', action: () => { close(); window.__openSettings?.(); } },
        { id: 'debug-panel', label: 'Show Debug Panel (Ctrl+Shift+D)', action: () => { close(); window.__openDebug?.(); } },
        { id: 'toggle-debug-mode', label: 'Toggle Debug Mode', action: () => { useEditorStore.getState().toggleDebugMode(); close(); } },
        { id: 'toggle-minimap', label: 'Toggle Minimap (Shift+M)', action: () => { window.__toggleMinimap?.(); close(); } },
        { id: 'toggle-inspector', label: 'Toggle Inspector (Shift+I)', action: () => { window.__toggleInspector?.(); close(); } },
        { id: 'toggle-toolbar', label: 'Toggle Toolbar (T)', action: () => { useSettingsStore.getState().toggleToolbarVisible(); close(); } },
        { id: 'graph-metadata', label: 'Edit Graph Info (Title, Description, Tags)', action: () => { close(); window.__openGraphMeta?.(); } },
        { id: 'checkpoints', label: 'Graph Checkpoints (Save / Restore)', action: () => { close(); window.__openCheckpoints?.(); } },
        { id: 'presentation', label: 'Presentation View (Mini-App)', action: () => { close(); window.__openPresentation?.(); } },
      ];

      for (const a of actions) {
        if (!q) {
          items.push({ ...a, section: 'actions', score: 30 });
        } else {
          const match = fuzzyMatchMulti(q, a.label);
          if (match.score > 0) {
            items.push({ ...a, section: 'actions', score: match.score });
          }
        }
      }
    }

    // Existing node results: focus on node (only when category filter is All)
    if (categoryFilter === 'All') {
      for (const node of Object.values(nodes)) {
        if (!q) {
          // Don't show existing nodes when no query (too noisy)
        } else {
          const match = fuzzyMatchMulti(q, node.title, node.type);
          if (match.score > 0) {
            const info = ALL_NODE_TYPES.find(n => n.type === node.type);
            items.push({
              id: `node-${node.id}`,
              label: node.title,
              section: 'nodes',
              color: info?.color,
              score: match.score,
              action: () => { useEditorStore.getState().setSelection(new Set([node.id])); close(); },
            });
          }
        }
      }
    }

    // Sort by score (higher = better match) when there's a query
    if (q) {
      // Sort within sections to preserve section grouping
      const recentItems = items.filter(i => i.section === 'recent');
      const actionItems = items.filter(i => i.section === 'actions');
      const nodeItems = items.filter(i => i.section === 'nodes');
      actionItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      nodeItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return [...recentItems, ...actionItems, ...nodeItems];
    }

    return items;
     
  }, [query, nodes, customNodeDefs, categoryFilter, recentlyUsedNodes, pinnedNodeTypes, pluginVersion, placeAt]);

  // Reset on open — setState in effect is intentional for one-time open transition
   
  useEffect(() => {
    if (open) {
      setQuery('');
      setFocusIndex(0);
      setCategoryFilter('All');
      preloadNodeHelp();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp focus when results change
  useEffect(() => {
    setFocusIndex(i => Math.min(i, Math.max(results.length - 1, 0)));
  }, [results.length]);
   

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[focusIndex]) {
      e.preventDefault();
      results[focusIndex].action();
    }
  }, [onClose, results, focusIndex]);

  // Scroll focused item into view when navigating with arrow keys
  useEffect(() => {
    const item = results[focusIndex];
    if (item) {
      document.getElementById(`sp-opt-${item.id}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIndex, results]);

  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const focusable = paletteRef.current?.querySelectorAll<HTMLElement>(
        'input, button, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  }, []);

  if (!open) return null;

  const pinnedResults = results.filter(r => r.section === 'pinned');
  const recentResults = results.filter(r => r.section === 'recent');
  const actionResults = results.filter(r => r.section === 'actions');
  const nodeResults = results.filter(r => r.section === 'nodes');

  return (
    <div
      className={styles.searchBackdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div ref={paletteRef} className={styles.searchPalette} onClick={e => e.stopPropagation()} onKeyDown={e => { handleKey(e); handleFocusTrap(e); }} style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          placeholder="Search nodes, actions..."
          aria-label="Search nodes and actions"
          role="combobox"
          aria-expanded={true}
          aria-controls="sp-listbox"
          aria-activedescendant={results[focusIndex] ? `sp-opt-${results[focusIndex].id}` : undefined}
          aria-describedby={results[focusIndex]?.nodeType ? 'sp-help-tooltip' : undefined}
          value={query}
          onChange={e => { setQuery(e.target.value); setFocusIndex(0); }}
        />
        {/* Category filter pills */}
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '4px 8px',
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--divider)',
        }}>
          {CATEGORY_FILTERS.map(cat => (
            <button
              key={cat}
              onClick={() => { setCategoryFilter(cat); setFocusIndex(0); }}
              aria-pressed={categoryFilter === cat}
              aria-label={`Filter by ${cat}`}
              style={{
                padding: '2px 8px',
                borderRadius: '10px',
                border: categoryFilter === cat ? '1px solid color-mix(in srgb, var(--teal) 50%, transparent)' : '1px solid var(--btn-border)',
                background: categoryFilter === cat ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'transparent',
                color: categoryFilter === cat ? 'var(--teal)' : 'var(--text-dim)',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                transition: 'all 0.1s',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
        {/* Result count indicator when filtering */}
        {query.trim() && (
          <div role="status" aria-live="polite" style={{
            padding: '2px 12px',
            fontSize: '10px',
            color: 'var(--text-faint)',
            fontFamily: 'var(--font-mono)',
            borderBottom: '1px solid var(--divider)',
          }}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
        )}
        <div
          id="sp-listbox"
          className={styles.searchResults}
          role="listbox"
          aria-label="Search results"
        >
          {pinnedResults.length > 0 && (
            <>
              <div className={styles.searchSectionLabel} aria-hidden="true" style={{ color: 'var(--teal)' }}>Pinned</div>
              {pinnedResults.map(r => {
                const idx = results.indexOf(r);
                return (
                  <div
                    key={r.id}
                    id={`sp-opt-${r.id}`}
                    role="option"
                    aria-selected={idx === focusIndex}
                    className={`${styles.searchItem} ${idx === focusIndex ? styles.searchItemActive : ''}`}
                    onClick={r.action}
                    onMouseEnter={() => setFocusIndex(idx)}
                  >
                    {r.color && <span className={styles.contextMenuDot} style={{ background: r.color }} />}
                    {r.label}
                  </div>
                );
              })}
            </>
          )}
          {recentResults.length > 0 && (
            <>
              <div className={styles.searchSectionLabel} aria-hidden="true">Recent</div>
              {recentResults.map(r => {
                const idx = results.indexOf(r);
                return (
                  <div
                    key={r.id}
                    id={`sp-opt-${r.id}`}
                    role="option"
                    aria-selected={idx === focusIndex}
                    className={`${styles.searchItem} ${idx === focusIndex ? styles.searchItemActive : ''}`}
                    onClick={r.action}
                    onMouseEnter={() => setFocusIndex(idx)}
                  >
                    {r.color && <span className={styles.contextMenuDot} style={{ background: r.color }} />}
                    {r.label}
                  </div>
                );
              })}
            </>
          )}
          {actionResults.length > 0 && (
            <>
              <div className={styles.searchSectionLabel} aria-hidden="true">
                {categoryFilter === 'All' ? 'Actions' : categoryFilter}
              </div>
              {actionResults.map(r => {
                const idx = results.indexOf(r);
                return (
                  <div
                    key={r.id}
                    id={`sp-opt-${r.id}`}
                    role="option"
                    aria-selected={idx === focusIndex}
                    className={`${styles.searchItem} ${idx === focusIndex ? styles.searchItemActive : ''}`}
                    onClick={r.action}
                    onMouseEnter={() => setFocusIndex(idx)}
                    title={r.description || undefined}
                  >
                    {r.color && <span className={styles.contextMenuDot} style={{ background: r.color }} />}
                    <span style={{ flex: 1 }}>{r.label}</span>
                    {r.description && idx === focusIndex && (
                      <span style={{ fontSize: '9px', color: 'var(--text-faint)', marginLeft: 8, flexShrink: 0 }}>
                        {r.description}
                      </span>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {nodeResults.length > 0 && (
            <>
              <div className={styles.searchSectionLabel} aria-hidden="true">Nodes</div>
              {nodeResults.map(r => {
                const idx = results.indexOf(r);
                return (
                  <div
                    key={r.id}
                    id={`sp-opt-${r.id}`}
                    role="option"
                    aria-selected={idx === focusIndex}
                    className={`${styles.searchItem} ${idx === focusIndex ? styles.searchItemActive : ''}`}
                    onClick={r.action}
                    onMouseEnter={() => setFocusIndex(idx)}
                  >
                    {r.color && <span className={styles.contextMenuDot} style={{ background: r.color }} />}
                    {r.label}
                  </div>
                );
              })}
            </>
          )}
          {results.length === 0 && query && (
            <div role="status" aria-live="polite" style={{ padding: '16px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '12px' }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
        <div className={styles.searchFooter}>
          <span><kbd>&uarr;&darr;</kbd> navigate</span>
          <span><kbd>Enter</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
        {/* Node help tooltip panel (shows when a node type is focused) */}
        {results[focusIndex]?.nodeType && (
          <NodeHelpTooltip nodeType={results[focusIndex].nodeType!} />
        )}
      </div>
    </div>
  );
}

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePluginStore, getAllPluginDefs } from '../../store/pluginStore';
import type { NodeType, NodeCategory } from '../../types';
import { NODE_CATEGORIES, NODE_TYPE_CONFIG } from '../../types';
import { importFromJSON } from '../../utils/serialization';
import { saveFile, openFile, saveToCurrentFile, getCurrentFileName } from '../../utils/fileAccess';
import type { MultiGraphStorage } from '../../utils/serialization';
import { generateGraphDocs } from '../../utils/graphDocs';
import { CustomNodeModal } from './CustomNodeModal';
import { ExportSVGDialog } from './ExportSVGDialog';
import { buildShareUrl } from '../../utils/shareUrl';
import { Tooltip } from './Tooltip';
import { NodeTypeTooltip } from './NodeTypeTooltip';
import { getNodeLabel, COLOR_HEX } from '../../types/nodeLabels';
import styles from '../../styles/panels.module.css';

/** Build full node type list from NODE_CATEGORIES */
const NODE_BUTTONS: { type: NodeType; label: string; color: string }[] =
  (Object.keys(NODE_CATEGORIES) as NodeType[])
    .filter(t => t !== 'subgraph-input' && t !== 'subgraph-output' && t !== 'custom' && t !== 'subgraph')
    .map(type => ({
      type,
      label: getNodeLabel(type, true),
      color: COLOR_HEX[NODE_TYPE_CONFIG[type]?.color] ?? 'var(--teal)',
    }));

/** Group node buttons by category */
const CATEGORY_ORDER: NodeCategory[] = ['Core', 'Math', 'String', 'Logic', 'Vector', 'Data', 'Color', 'Live', 'Utility', 'Subgraph'];

const BUTTONS_BY_CATEGORY: Record<NodeCategory, typeof NODE_BUTTONS> = (() => {
  const map = {} as Record<NodeCategory, typeof NODE_BUTTONS>;
  for (const cat of CATEGORY_ORDER) map[cat] = [];
  for (const btn of NODE_BUTTONS) {
    const cat = NODE_CATEGORIES[btn.type];
    map[cat].push(btn);
  }
  return map;
})();

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transition: 'transform 0.15s',
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        opacity: 0.5,
        flexShrink: 0,
      }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** Compact section header button for the left sidebar */
function SectionHeader({ label, section, collapsed, onToggle }: {
  label: string;
  section: string;
  collapsed: boolean;
  onToggle: (s: string) => void;
}) {
  return (
    <button
      className={`${styles.toolbarBtn} ${styles.toolbarSectionHeader}`}
      onClick={() => onToggle(section)}
      aria-expanded={!collapsed}
    >
      <ChevronIcon expanded={!collapsed} />
      <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-faint)' }}>{label}</span>
    </button>
  );
}

export function Toolbar() {
  const addNode = useEditorStore(s => s.addNode);
  const nodes = useEditorStore(s => s.nodes);
  const snapEnabled = useEditorStore(s => s.snapEnabled);
  const toggleSnap = useEditorStore(s => s.toggleSnap);
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);
  const copySelected = useEditorStore(s => s.copySelected);
  const paste = useEditorStore(s => s.paste);
  const autoLayout = useEditorStore(s => s.autoLayout);
  const alignSelected = useEditorStore(s => s.alignSelected);
  const customNodeDefs = useEditorStore(s => s.customNodeDefs);
  const addCustomNode = useEditorStore(s => s.addCustomNode);
  const showValuePreviews = useEditorStore(s => s.showValuePreviews);
  const toggleValuePreviews = useEditorStore(s => s.toggleValuePreviews);

  const recentFiles = useSettingsStore(s => s.recentFiles);
  const currentFileName = getCurrentFileName();
  // Subscribe to plugin registry changes for re-render
  const pluginVersion = usePluginStore(s => s.registryVersion);

  // Build dynamic plugin button groups (grouped by category)
  const pluginButtonGroups = useMemo(() => {
    if (pluginVersion < 0) return {}; // always false; dependency forces re-eval
    const groups: Record<string, { type: string; label: string; color: string }[]> = {};
    for (const pDef of getAllPluginDefs()) {
      const cat = pDef.category || 'Plugin';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({
        type: pDef.type,
        label: pDef.name,
        color: COLOR_HEX[pDef.color] ?? pDef.color ?? 'var(--teal)',
      });
    }
    return groups;
  }, [pluginVersion]);

  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [svgDialogOpen, setSvgDialogOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<NodeCategory>>(
    () => new Set<NodeCategory>(),
  );
  const [nodeFilter, setNodeFilter] = useState('');
  const paletteRef = useRef<HTMLDivElement>(null);

  /** Roving tabIndex keyboard handler for the node palette toolbar */
  const handlePaletteKeyDown = useCallback((e: React.KeyboardEvent) => {
    const container = paletteRef.current;
    if (!container) return;
    const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const isHomeEnd = e.key === 'Home' || e.key === 'End';
    if (!isArrow && !isHomeEnd) return;

    const focusable = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled])'
    );
    if (focusable.length === 0) return;
    const items = Array.from(focusable);
    const currentIdx = items.indexOf(document.activeElement as HTMLElement);
    if (currentIdx === -1) return; // focus is not inside the palette

    e.preventDefault();
    let nextIdx: number;
    if (e.key === 'ArrowDown') nextIdx = (currentIdx + 1) % items.length;
    else if (e.key === 'ArrowUp') nextIdx = (currentIdx - 1 + items.length) % items.length;
    else if (e.key === 'Home') nextIdx = 0;
    else nextIdx = items.length - 1; // End

    // Move tabIndex: old → -1, new → 0
    items[currentIdx].setAttribute('tabindex', '-1');
    items[nextIdx].setAttribute('tabindex', '0');
    items[nextIdx].focus();
  }, []);
  const toolbarCollapsedSections = useSettingsStore(s => s.toolbarCollapsedSections);
  const toggleToolbarSection = useSettingsStore(s => s.toggleToolbarSection);
  const overviewMode = useSettingsStore(s => s.overviewMode);
  const toggleOverviewMode = useSettingsStore(s => s.toggleOverviewMode);
  const toolbarVisible = useSettingsStore(s => s.toolbarVisible);
  const toggleToolbarVisible = useSettingsStore(s => s.toggleToolbarVisible);

  // Derive a Set for O(1) lookups from the persisted array
  const collapsedSections = useMemo(() => new Set(toolbarCollapsedSections), [toolbarCollapsedSections]);

  const toggleCategory = useCallback((cat: NodeCategory) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const toggleSection = useCallback((section: string) => {
    toggleToolbarSection(section);
  }, [toggleToolbarSection]);

  // Filter node buttons by search query
  const filteredButtonsByCategory = useMemo(() => {
    if (!nodeFilter.trim()) return BUTTONS_BY_CATEGORY;
    const q = nodeFilter.toLowerCase().trim();
    const result = {} as Record<NodeCategory, typeof NODE_BUTTONS>;
    for (const cat of CATEGORY_ORDER) {
      result[cat] = BUTTONS_BY_CATEGORY[cat].filter(
        btn => btn.label.toLowerCase().includes(q) || btn.type.toLowerCase().includes(q) || cat.toLowerCase().includes(q)
      );
    }
    return result;
  }, [nodeFilter]);

  const handleAdd = (type: NodeType) => {
    // Place new nodes near the camera's orbit target (where the user is looking)
    const ctrl = window.__orbitControls;
    const count = Object.keys(nodes).length;
    if (ctrl) {
      const target = ctrl.target;
      // Offset slightly so successive nodes don't stack exactly
      const offsetX = (count % 3 - 1) * 3;
      const offsetZ = (Math.floor(count / 3) % 3 - 1) * 2;
      addNode(type, [target.x + offsetX, 0, target.z + offsetZ]);
    } else {
      const x = (count % 4) * 3;
      const z = Math.floor(count / 4) * 2;
      addNode(type, [x, 0, z]);
    }
  };

  const handleZoomToFit = () => {
    window.__zoomToFit?.();
  };

  const handleExportImage = useCallback(() => {
    window.__exportImage?.();
  }, []);

  const handleExportDocs = useCallback(() => {
    const state = useEditorStore.getState();
    const { nodes, connections, groups } = state;
    const graphTab = state.graphTabs[state.activeGraphId];
    const graphName = graphTab?.name ?? 'Untitled Graph';

    const md = generateGraphDocs({ nodes, connections, groups, graphName, includeMermaid: true, executionStats: state.executionStats });

    // Download
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graphName.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleExportSVG = useCallback(() => {
    setSvgDialogOpen(true);
  }, []);

  const handleExport = useCallback(async () => {
    const storage = useEditorStore.getState().exportAllGraphs();
    const content = JSON.stringify(storage, null, 2);
    const name = await saveFile(content, 'node-graph');
    if (name) useSettingsStore.getState().addRecentFile(name);
  }, []);

  const handleImport = useCallback(async () => {
    const result = await openFile();
    if (!result) return;
    useSettingsStore.getState().addRecentFile(result.name);
    try {
      const parsed = JSON.parse(result.content);
      if (parsed && typeof parsed === 'object' && parsed.version === 2 && parsed.graphs) {
        // v2 multi-graph workspace
        useEditorStore.getState().importAllGraphs(parsed as MultiGraphStorage);
      } else {
        // Legacy v1 single-graph
        const data = importFromJSON(result.content);
        if (data) {
          useEditorStore.getState().importWorkflow(data);
        }
      }
    } catch {
      // Try legacy format as fallback
      const data = importFromJSON(result.content);
      if (data) {
        useEditorStore.getState().importWorkflow(data);
      }
    }
  }, []);

  // Share link: encode the active graph into a copyable URL
  const [shareToast, setShareToast] = useState<string | null>(null);
  const handleShareLink = useCallback(async () => {
    const s = useEditorStore.getState();
    const hasSubgraphs = Object.values(s.nodes).some(n => n.type === 'subgraph');
    const url = await buildShareUrl({
      nodes: s.nodes,
      connections: s.connections,
      groups: s.groups,
      customNodeDefs: s.customNodeDefs,
      ...(Object.keys(s.subgraphDefs).length > 0 ? { subgraphDefs: s.subgraphDefs } : {}),
    });
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      console.log('[share-url]', url);
    }
    setShareToast(
      !copied ? 'Copy failed — link logged to browser console'
      : hasSubgraphs ? 'Link copied — note: subgraph internals are not included'
      : 'Share link copied to clipboard',
    );
    setTimeout(() => setShareToast(null), 5000);
  }, []);

  // Merge import: imports graphs alongside existing workspace
  const [mergeToast, setMergeToast] = useState<string | null>(null);
  const handleMergeImport = useCallback(async () => {
    const result = await openFile();
    if (!result) return;
    try {
      const parsed = JSON.parse(result.content);
      if (parsed && typeof parsed === 'object' && parsed.version === 2 && parsed.graphs) {
        const storage = parsed as MultiGraphStorage;
        const graphCount = Object.keys(storage.graphs).length;
        let nodeCount = 0;
        for (const g of Object.values(storage.graphs)) {
          nodeCount += Object.keys((g as unknown as Record<string, unknown>).nodes ?? {}).length;
        }
        useEditorStore.getState().mergeImportedGraphs(storage);
        setMergeToast(`Merged ${graphCount} graph${graphCount !== 1 ? 's' : ''} (${nodeCount} nodes)`);
        setTimeout(() => setMergeToast(null), 3000);
      } else {
        setMergeToast('Merge requires v2 multi-graph format');
        setTimeout(() => setMergeToast(null), 3000);
      }
    } catch {
      setMergeToast('Failed to parse file');
      setTimeout(() => setMergeToast(null), 3000);
    }
  }, []);

  // Expose handleExportDocs as a window global for cross-component access
  useEffect(() => {
    window.__exportGraphDocs = handleExportDocs;
    return () => { window.__exportGraphDocs = undefined; };
  }, [handleExportDocs]);

  // Ctrl+S: save to current file handle or trigger Save As
  const handleQuickSave = useCallback(async () => {
    const storage = useEditorStore.getState().exportAllGraphs();
    const content = JSON.stringify(storage, null, 2);
    const saved = await saveToCurrentFile(content);
    if (saved) {
      useSettingsStore.getState().addRecentFile(saved);
    } else {
      // No file handle yet — fall through to Save As
      const name = await saveFile(content, 'node-graph');
      if (name) useSettingsStore.getState().addRecentFile(name);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleQuickSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleQuickSave]);

  return (
    <>
    {/* Toggle tab visible when toolbar is hidden */}
    {!toolbarVisible && (
      <Tooltip label="Show Toolbar (T)">
        <button
          className={styles.toolbarToggleTab}
          onClick={toggleToolbarVisible}
          aria-label="Show Toolbar"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </Tooltip>
    )}
    <div
      className={styles.toolbar}
      style={{
        transform: toolbarVisible ? 'translateX(0)' : 'translateX(calc(-100% - 24px))',
        opacity: toolbarVisible ? 1 : 0,
        pointerEvents: toolbarVisible ? 'auto' : 'none',
        transition: 'transform 0.2s ease-out, opacity 0.15s ease-out',
      }}
    >
      <div
        className={styles.toolbarSection}
        ref={paletteRef}
        role="toolbar"
        aria-orientation="vertical"
        aria-label="Node palette"
        onKeyDown={handlePaletteKeyDown}
      >
        <SectionHeader label="Add Node" section="addnode" collapsed={collapsedSections.has('addnode')} onToggle={toggleSection} />
        {!collapsedSections.has('addnode') && <>
        <div style={{ padding: '0 4px 4px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Filter nodes..."
            value={nodeFilter}
            onChange={e => setNodeFilter(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setNodeFilter('');
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Filter node types"
            tabIndex={0}
            style={{
              width: '100%',
              padding: '4px 24px 4px 8px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              background: 'var(--divider)',
              border: '1px solid var(--panel-border)',
              borderRadius: 6,
              color: 'var(--text)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {nodeFilter && (
            <button
              onClick={() => setNodeFilter('')}
              aria-label="Clear filter"
              tabIndex={-1}
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: 12,
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
        {CATEGORY_ORDER.map(cat => {
          const buttons = filteredButtonsByCategory[cat];
          if (buttons.length === 0) return null;
          const isFiltering = nodeFilter.trim().length > 0;
          const expanded = isFiltering || expandedCategories.has(cat);
          return (
            <div key={cat} role="group" aria-label={`${cat} nodes`}>
              <button
                className={styles.toolbarBtn}
                onClick={() => toggleCategory(cat)}
                aria-expanded={expanded}
                aria-label={`${cat} nodes`}
                tabIndex={-1}
                style={{ opacity: 0.7, fontSize: '10px', gap: '6px' }}
              >
                <ChevronIcon expanded={expanded} />
                {cat}
                <span style={{ fontSize: '8px', opacity: 0.5, marginLeft: 'auto' }}>{buttons.length}</span>
              </button>
              {expanded && buttons.map(({ type, label, color }) => (
                <NodeTypeTooltip key={type} nodeType={type}>
                  <button
                    className={styles.toolbarBtn}
                    onClick={() => handleAdd(type)}
                    tabIndex={-1}
                    style={{ paddingLeft: '22px' }}
                  >
                    <span className={styles.dot} style={{ background: color }} />
                    {label}
                  </button>
                </NodeTypeTooltip>
              ))}
            </div>
          );
        })}
        {/* Plugin node categories */}
        {Object.entries(pluginButtonGroups).map(([cat, buttons]) => {
          const expanded = expandedCategories.has(cat as NodeCategory);
          return (
            <div key={`plugin-${cat}`} role="group" aria-label={`${cat} plugin nodes`}>
              <button
                className={styles.toolbarBtn}
                onClick={() => toggleCategory(cat as NodeCategory)}
                aria-expanded={expanded}
                aria-label={`${cat} plugin nodes`}
                tabIndex={-1}
                style={{ opacity: 0.7, fontSize: '10px', gap: '6px' }}
              >
                <ChevronIcon expanded={expanded} />
                {cat} <span style={{ fontSize: '8px', opacity: 0.6 }}>(plugin)</span>
              </button>
              {expanded && buttons.map(({ type, label, color }) => (
                <Tooltip key={type} label={`Add ${label} (Plugin)`}>
                  <button
                    className={styles.toolbarBtn}
                    onClick={() => handleAdd(type as NodeType)}
                    tabIndex={-1}
                    style={{ paddingLeft: '22px' }}
                  >
                    <span className={styles.dot} style={{ background: color }} />
                    {label}
                  </button>
                </Tooltip>
              ))}
            </div>
          );
        })}
        </>}
      </div>

      <div className={styles.toolbarDivider} />

      <div className={styles.toolbarSection}>
        <SectionHeader label="File" section="file" collapsed={collapsedSections.has('file')} onToggle={toggleSection} />
        {!collapsedSections.has('file') && <>
        <Tooltip label="Save to current file" shortcut="Ctrl+S">
          <button
            className={styles.toolbarBtn}
            onClick={handleQuickSave}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save
          </button>
        </Tooltip>
        <div className={styles.toolbarRow}>
          <Tooltip label="Save As..." shortcut=".rne3d">
            <button className={styles.toolbarBtn} onClick={handleExport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Open file" shortcut=".rne3d">
            <button className={styles.toolbarBtn} onClick={handleImport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Export as PNG image">
            <button className={styles.toolbarBtn} onClick={handleExportImage}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Export documentation as Markdown">
            <button className={styles.toolbarBtn} onClick={handleExportDocs}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Export graph as SVG">
            <button className={styles.toolbarBtn} onClick={handleExportSVG}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <path d="M7 15l3-3 2 2 3-4 4 5" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Copy share link — anyone with the URL gets this graph">
            <button className={styles.toolbarBtn} onClick={handleShareLink}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
          </Tooltip>
        </div>
        {shareToast && (
          <div style={{
            padding: '4px 14px',
            fontSize: '9px',
            color: shareToast.startsWith('Copy failed') ? 'var(--danger)' : 'var(--success)',
            fontFamily: 'var(--font-mono)',
          }}>
            {shareToast}
          </div>
        )}
        <Tooltip label="Merge import — add graphs from another file without replacing current workspace">
          <button className={styles.toolbarBtn} onClick={handleMergeImport} style={{ width: '100%', justifyContent: 'center', fontSize: '10px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 3h5v5" /><path d="M8 3H3v5" />
              <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
              <path d="m15 9 6-6" />
            </svg>
            Merge Import
          </button>
        </Tooltip>
        {mergeToast && (
          <div style={{
            padding: '4px 14px',
            fontSize: '9px',
            color: mergeToast.startsWith('Failed') || mergeToast.startsWith('Merge requires') ? 'var(--danger)' : 'var(--success)',
            fontFamily: 'var(--font-mono)',
          }}>
            {mergeToast}
          </div>
        )}
        {currentFileName && (
          <div style={{
            padding: '2px 14px',
            fontSize: '9px',
            color: 'var(--btn-text)',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {currentFileName}
          </div>
        )}
        {recentFiles.length > 0 && (
          <RecentFilesList files={recentFiles} />
        )}
        </>}
      </div>

      <div className={styles.toolbarDivider} />

      <div className={styles.toolbarSection}>
        <SectionHeader label="Edit" section="edit" collapsed={collapsedSections.has('edit')} onToggle={toggleSection} />
        {!collapsedSections.has('edit') && <>
        <div className={styles.toolbarRow}>
          <Tooltip label="Undo" shortcut="Ctrl+Z">
            <button className={styles.toolbarBtn} onClick={undo}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Redo" shortcut="Ctrl+Shift+Z">
            <button className={styles.toolbarBtn} onClick={redo}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Copy selection" shortcut="Ctrl+C">
            <button className={styles.toolbarBtn} onClick={copySelected}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Paste" shortcut="Ctrl+V">
            <button className={styles.toolbarBtn} onClick={paste}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              </svg>
            </button>
          </Tooltip>
        </div>
        </>}
      </div>

      <div className={styles.toolbarDivider} />

      <div className={styles.toolbarSection}>
        <SectionHeader label="View" section="view" collapsed={collapsedSections.has('view')} onToggle={toggleSection} />
        {!collapsedSections.has('view') && <>
        <div className={styles.toolbarRow}>
          <Tooltip label="Zoom to fit all nodes" shortcut="F">
            <button className={styles.toolbarBtn} onClick={handleZoomToFit}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 3h6v6" />
                <path d="M9 21H3v-6" />
                <path d="M21 3l-7 7" />
                <path d="M3 21l7-7" />
              </svg>
              Fit
            </button>
          </Tooltip>
          <Tooltip label="Toggle snap to grid" shortcut="G">
            <button
              className={`${styles.toolbarBtn} ${snapEnabled ? styles.toolbarBtnActive : ''}`}
              onClick={toggleSnap}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              Snap
            </button>
          </Tooltip>
        </div>
        <Tooltip label="Bird's-eye overview mode — simplified nodes" shortcut="Shift+O">
          <button
            className={`${styles.toolbarBtn} ${overviewMode ? styles.toolbarBtnActive : ''}`}
            onClick={toggleOverviewMode}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Overview
          </button>
        </Tooltip>
        {/* Camera View Presets — compact icon-only row */}
        <div className={styles.toolbarRow}>
          <Tooltip label="Top view" shortcut="↑">
            <button className={styles.toolbarBtn} onClick={() => window.__flyToViewPreset?.('top')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v4" /><path d="M12 18v4" /><path d="M2 12h4" /><path d="M18 12h4" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Front view" shortcut="Shift+↑">
            <button className={styles.toolbarBtn} onClick={() => window.__flyToViewPreset?.('front')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="6" width="16" height="14" rx="2" /><path d="M12 2v4" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Left view" shortcut="←">
            <button className={styles.toolbarBtn} onClick={() => window.__flyToViewPreset?.('left')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12h4l3-9 4 18 3-9h4" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Right view" shortcut="→">
            <button className={styles.toolbarBtn} onClick={() => window.__flyToViewPreset?.('right')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12h-4l-3-9-4 18-3-9H3" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Isometric 3D view" shortcut="↓">
            <button className={styles.toolbarBtn} onClick={() => window.__flyToViewPreset?.('isometric')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2l10 6v8l-10 6L2 16V8z" />
                <path d="M12 8v14" /><path d="M2 8l10 6" /><path d="M22 8l-10 6" />
              </svg>
            </button>
          </Tooltip>
        </div>
        </>}
      </div>

      <div className={styles.toolbarDivider} />

      <div className={styles.toolbarSection}>
        <SectionHeader label="Layout" section="layout" collapsed={collapsedSections.has('layout')} onToggle={toggleSection} />
        {!collapsedSections.has('layout') && <>
        <Tooltip label="Auto-layout graph" shortcut="L">
          <button className={styles.toolbarBtn} onClick={autoLayout}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            Auto Layout
          </button>
        </Tooltip>
        <div className={styles.toolbarRow}>
          <Tooltip label="Align horizontal" shortcut="Ctrl+Shift+H">
            <button className={styles.toolbarBtn} onClick={() => alignSelected('center-x')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="3" x2="12" y2="21" />
                <line x1="6" y1="9" x2="18" y2="9" />
                <line x1="8" y1="15" x2="16" y2="15" />
              </svg>
              Align H
            </button>
          </Tooltip>
          <Tooltip label="Align vertical" shortcut="Ctrl+Shift+V">
            <button className={styles.toolbarBtn} onClick={() => alignSelected('center-z')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="9" y1="6" x2="9" y2="18" />
                <line x1="15" y1="8" x2="15" y2="16" />
              </svg>
              Align V
            </button>
          </Tooltip>
        </div>
        </>}
      </div>

      <div className={styles.toolbarDivider} />

      <div className={styles.toolbarSection}>
        <SectionHeader label="Display" section="display" collapsed={collapsedSections.has('display')} onToggle={toggleSection} />
        {!collapsedSections.has('display') && <>
        <div className={styles.toolbarRow}>
          <Tooltip label="Toggle value previews" shortcut="V">
            <button
              className={`${styles.toolbarBtn} ${showValuePreviews ? styles.toolbarBtnActive : ''}`}
              onClick={toggleValuePreviews}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Values
            </button>
          </Tooltip>
          <NodeScreensToggle />
          <HeatmapToggle />
        </div>
        </>}
      </div>

      <div className={styles.toolbarDivider} />

      {/* Subgraph — collapsible */}
      <div className={styles.toolbarSection}>
        <SectionHeader label="Subgraph" section="subgraph" collapsed={collapsedSections.has('subgraph')} onToggle={toggleSection} />
        {!collapsedSections.has('subgraph') && (
          <>
            <Tooltip label="Create an empty subgraph node">
              <button
                className={styles.toolbarBtn}
                onClick={() => useEditorStore.getState().createSubgraph()}
              >
                <span className={styles.dot} style={{ background: 'var(--coral)' }} />
                New Subgraph
              </button>
            </Tooltip>
            <Tooltip label="Wrap selected nodes into a subgraph">
              <button
                className={styles.toolbarBtn}
                onClick={() => useEditorStore.getState().convertSelectionToSubgraph()}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <rect x="7" y="7" width="10" height="10" rx="1" />
                </svg>
                Convert Selection
              </button>
            </Tooltip>
          </>
        )}
      </div>

      <div className={styles.toolbarDivider} />

      {/* Camera Bookmarks — collapsible */}
      <div className={styles.toolbarSection}>
        <SectionHeader label="Bookmarks" section="bookmarks" collapsed={collapsedSections.has('bookmarks')} onToggle={toggleSection} />
        {!collapsedSections.has('bookmarks') && <CameraBookmarksSection />}
      </div>

      <div className={styles.toolbarDivider} />

      {/* Custom Nodes — collapsible */}
      <div className={styles.toolbarSection}>
        <SectionHeader label="Custom" section="custom" collapsed={collapsedSections.has('custom')} onToggle={toggleSection} />
        {!collapsedSections.has('custom') && (
          <>
            {Object.values(customNodeDefs).map(def => (
              <Tooltip key={def.id} label={`Add ${def.name}`}>
                <button
                  className={styles.toolbarBtn}
                  onClick={() => addCustomNode(def.id)}
                >
                  <span className={styles.dot} style={{ background: def.color }} />
                  {def.name}
                </button>
              </Tooltip>
            ))}
            <Tooltip label="Define a new custom node type">
              <button
                className={styles.toolbarBtn}
                onClick={() => setCustomModalOpen(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create Custom...
              </button>
            </Tooltip>
          </>
        )}
      </div>

      {/* Custom Node Modal */}
      <CustomNodeModal open={customModalOpen} onClose={() => setCustomModalOpen(false)} />
      {/* SVG Export Dialog */}
      {svgDialogOpen && <ExportSVGDialog onClose={() => setSvgDialogOpen(false)} />}
    </div>
    </>
  );
}

/** Node screens toggle button — shows/hides editing panels on all nodes */
function NodeScreensToggle() {
  const showNodeScreens = useSettingsStore(s => s.showNodeScreens);
  return (
    <Tooltip label="Toggle node screens on all nodes">
      <button
        className={`${styles.toolbarBtn} ${showNodeScreens ? styles.toolbarBtnActive : ''}`}
        onClick={() => useSettingsStore.getState().setShowNodeScreens(!showNodeScreens)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        Screens
      </button>
    </Tooltip>
  );
}

/** Execution heatmap toggle button */
function HeatmapToggle() {
  const showHeatmap = useSettingsStore(s => s.showExecutionHeatmap);
  return (
    <Tooltip label="Toggle execution heatmap (green=fast, red=slow)">
      <button
        className={`${styles.toolbarBtn} ${showHeatmap ? styles.toolbarBtnActive : ''}`}
        onClick={() => useSettingsStore.getState().setShowExecutionHeatmap(!showHeatmap)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
        Heatmap
      </button>
    </Tooltip>
  );
}

/** Collapsible recent files list in the File section */
function RecentFilesList({ files }: { files: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const clearRecentFiles = useSettingsStore(s => s.clearRecentFiles);

  return (
    <div>
      <button
        className={styles.toolbarBtn}
        onClick={() => setExpanded(p => !p)}
        aria-expanded={expanded}
        aria-label="Recent files"
        style={{ opacity: 0.7, fontSize: '10px', gap: '6px' }}
      >
        <ChevronIcon expanded={expanded} />
        Recent ({files.length})
      </button>
      {expanded && (
        <div style={{ maxHeight: 120, overflowY: 'auto' }}>
          {files.map((name, i) => (
            <div
              key={`${name}-${i}`}
              className={styles.toolbarBtn}
              style={{
                paddingLeft: '22px',
                fontSize: '9px',
                opacity: 0.6,
                cursor: 'default',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={name}
            >
              {name}
            </div>
          ))}
          <button
            className={styles.toolbarBtn}
            onClick={clearRecentFiles}
            style={{ opacity: 0.4, fontSize: '9px', paddingLeft: '22px' }}
          >
            Clear Recent
          </button>
        </div>
      )}
    </div>
  );
}

/** Camera bookmarks section — compact 1-9 slot buttons */
function CameraBookmarksSection() {
  const bookmarks = useSettingsStore(s => s.cameraBookmarks);
  const setCameraBookmark = useSettingsStore(s => s.setCameraBookmark);
  const clearCameraBookmark = useSettingsStore(s => s.clearCameraBookmark);

  const handleSlotClick = useCallback((slot: number) => {
    const bm = useSettingsStore.getState().cameraBookmarks[String(slot)];
    if (bm) {
      window.__recallCameraBookmark?.(slot);
    } else {
      // Save current camera position to this slot
      const ctrl = window.__orbitControls;
      if (ctrl) {
        const cam = ctrl.object;
        setCameraBookmark(slot, {
          position: [cam.position.x, cam.position.y, cam.position.z],
          target: [ctrl.target.x, ctrl.target.y, ctrl.target.z],
        });
      }
    }
  }, [setCameraBookmark]);

  const handleSlotClear = useCallback((slot: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    clearCameraBookmark(slot);
  }, [clearCameraBookmark]);

  // Rendered directly inside the outer collapsible section — no inner collapse needed
  return (
    <div style={{ padding: '2px 10px 4px' }}>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(slot => {
          const filled = !!bookmarks[String(slot)];
          return (
            <Tooltip key={slot} label={filled ? `Recall bookmark ${slot} (Alt+${slot}). Right-click to clear.` : `Save bookmark ${slot} (click or Alt+Shift+${slot})`}>
              <button
                onClick={() => handleSlotClick(slot)}
                onContextMenu={e => { if (filled) handleSlotClear(slot, e); }}
                style={{
                  width: 22, height: 22,
                  borderRadius: 4,
                  border: `1px solid ${filled ? 'var(--teal)' : 'var(--btn-border)'}`,
                  background: filled ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
                  color: filled ? 'var(--teal)' : 'var(--text-faint)',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0,
                }}
                aria-label={filled ? `Recall camera bookmark ${slot}` : `Save camera bookmark ${slot}`}
              >
                {slot}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div style={{ fontSize: '8px', color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.3 }}>
        Click empty = save, filled = recall. Right-click = clear.
      </div>
    </div>
  );
}

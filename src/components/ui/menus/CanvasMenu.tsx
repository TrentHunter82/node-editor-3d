/**
 * Canvas context menu — shown on right-click of empty canvas.
 * Features: search/filter input, collapsible categories, max-height with scroll.
 * Redesigned in Phase 53 for usability. Keyboard nav added Phase 54.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useEditorStore } from '../../../store/editorStore';
import { NODE_CATEGORIES } from '../../../types';
import styles from '../../../styles/panels.module.css';
import { CtxIcon } from './MenuHelpers';
import { CATEGORY_ORDER, BUTTONS_BY_CATEGORY, NODE_BUTTONS } from './menuShared';
import type { ExecFn } from './menuShared';

type CatEntry = { kind: 'category'; cat: string } | { kind: 'item'; cat: string; btn: (typeof NODE_BUTTONS)[number] };

export function CanvasMenu({ exec }: { exec: ExecFn }) {
  const store = useEditorStore;
  const canPaste = useEditorStore(s => s.canPaste());
  const selectedIds = useEditorStore(s => s.selectedIds);
  const nodes = useEditorStore(s => s.nodes);
  const insideSubgraph = useEditorStore(s => s.breadcrumbStack.length > 0);

  const hasSelectedNodes = [...selectedIds].some(id => nodes[id]);
  const selectedNodeCount = [...selectedIds].filter(id => nodes[id]).length;

  // Search & navigation state
  const [search, setSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [catHighlightIndex, setCatHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-focus search input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Filtered nodes when searching
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return NODE_BUTTONS.filter(btn =>
      btn.label.toLowerCase().includes(q) ||
      btn.type.toLowerCase().includes(q) ||
      (NODE_CATEGORIES[btn.type] ?? '').toLowerCase().includes(q)
    );
  }, [search]);

  // Build flat navigable list for category view
  const catEntries = useMemo((): CatEntry[] => {
    const entries: CatEntry[] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = BUTTONS_BY_CATEGORY[cat];
      if (!items || items.length === 0) continue;
      entries.push({ kind: 'category', cat });
      if (expandedCats.has(cat)) {
        for (const btn of items) {
          entries.push({ kind: 'item', cat, btn });
        }
      }
    }
    return entries;
  }, [expandedCats]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  // Reset category highlight when entries change
  useEffect(() => {
    setCatHighlightIndex(i => Math.min(i, Math.max(0, catEntries.length - 1)));
  }, [catEntries]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (filtered) {
      const el = scrollRef.current?.querySelector(`[data-idx="${highlightIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    } else {
      const el = scrollRef.current?.querySelector(`[data-cat-idx="${catHighlightIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex, catHighlightIndex, filtered]);

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  /** Stop keyboard events from reaching global handlers */
  const stopKey = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Two-stage Escape: clear search first, close on second press
    if (e.key === 'Escape') {
      if (search) {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        setSearch('');
        return;
      }
      return; // empty search — let bubble to close menu
    }

    if (filtered) {
      // Navigation within search results
      if (filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightIndex(i => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const btn = filtered[highlightIndex];
          if (btn) exec(() => store.getState().addNode(btn.type));
        }
      }
    } else if (catEntries.length > 0) {
      // Navigation within collapsed categories
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCatHighlightIndex(i => Math.min(i + 1, catEntries.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCatHighlightIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const entry = catEntries[catHighlightIndex];
        if (entry) {
          if (entry.kind === 'category') {
            toggleCategory(entry.cat);
          } else {
            exec(() => store.getState().addNode(entry.btn.type));
          }
        }
      } else if (e.key === 'ArrowRight') {
        // Expand category if on a category header
        e.preventDefault();
        const entry = catEntries[catHighlightIndex];
        if (entry?.kind === 'category' && !expandedCats.has(entry.cat)) {
          toggleCategory(entry.cat);
        }
      } else if (e.key === 'ArrowLeft') {
        // Collapse category if on a category header or jump to parent category
        e.preventDefault();
        const entry = catEntries[catHighlightIndex];
        if (entry?.kind === 'category' && expandedCats.has(entry.cat)) {
          toggleCategory(entry.cat);
        } else if (entry?.kind === 'item') {
          // Jump to parent category header
          const catIdx = catEntries.findIndex(e => e.kind === 'category' && e.cat === entry.cat);
          if (catIdx >= 0) setCatHighlightIndex(catIdx);
        }
      }
    }

    // Stop ALL keys from triggering global shortcuts
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
  }, [filtered, highlightIndex, catEntries, catHighlightIndex, expandedCats, exec, store, toggleCategory, search]);

  // Compute active descendant ID for aria-activedescendant
  const activeDescendant = filtered
    ? (filtered.length > 0 ? `cm-opt-${highlightIndex}` : undefined)
    : (catEntries.length > 0 ? `cm-cat-${catHighlightIndex}` : undefined);

  return (
    <>
      {/* Exit Subgraph — only shown when inside a subgraph */}
      {insideSubgraph && (
        <>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => store.getState().exitSubgraph())}
          >
            <CtxIcon d="M9 11l-4 4 4 4M5 15h11a4 4 0 0 0 0-8h-1" />
            Exit Subgraph
            <span className={styles.contextMenuShortcut}>Backspace</span>
          </button>
          <div className={styles.contextMenuDivider} />
        </>
      )}
      {/* Selection operations — only shown when nodes are selected */}
      {hasSelectedNodes && (
        <>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => store.getState().createGroup())}
          >
            <CtxIcon d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            Group Selected
            <span className={styles.contextMenuShortcut}>Ctrl+G</span>
          </button>
          <button
            className={styles.contextMenuItem}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => store.getState().convertSelectionToSubgraph())}
          >
            <CtxIcon d="M13 9l3 3-3 3M2 9l3 3-3 3M9 3v18" />
            Convert to Subgraph
          </button>
          <div className={styles.contextMenuDivider} />
        </>
      )}
      {/* Align — shown when 2+ nodes are selected */}
      {selectedNodeCount >= 2 && (
        <>
          <div className={styles.contextMenuLabel}>Arrange</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, padding: '0 4px 4px' }}>
            {([
              ['left', 'M4 4v16', 'Align Left'],
              ['center-x', 'M12 4v16', 'Center X'],
              ['right', 'M20 4v16', 'Align Right'],
              ['top', 'M4 4h16', 'Align Top'],
              ['center-z', 'M4 12h16', 'Center Z'],
              ['bottom', 'M4 20h16', 'Align Bottom'],
            ] as const).map(([dir, icon, label]) => (
              <button
                key={dir}
                className={styles.contextMenuItem}
                role="menuitem"
                tabIndex={-1}
                title={label}
                aria-label={label}
                style={{ justifyContent: 'center', padding: '4px 6px', fontSize: 10 }}
                onClick={() => exec(() => store.getState().alignSelected(dir))}
              >
                <CtxIcon d={icon} />
              </button>
            ))}
          </div>
          {selectedNodeCount >= 3 && (
            <>
              <button
                className={styles.contextMenuItem}
                role="menuitem"
                tabIndex={-1}
                onClick={() => exec(() => store.getState().distributeSelected('horizontal'))}
              >
                <CtxIcon d="M4 4v16M10 12h4M20 4v16" />
                Distribute Horizontal
              </button>
              <button
                className={styles.contextMenuItem}
                role="menuitem"
                tabIndex={-1}
                onClick={() => exec(() => store.getState().distributeSelected('vertical'))}
              >
                <CtxIcon d="M4 4h16M12 10v4M4 20h16" />
                Distribute Vertical
              </button>
            </>
          )}
          <div className={styles.contextMenuDivider} />
        </>
      )}

      {/* Search input — auto-focused for instant filtering */}
      <div style={{ padding: '2px 4px 4px' }}>
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onKeyUp={stopKey}
          placeholder="Search nodes..."
          aria-label="Search nodes"
          role="combobox"
          aria-expanded={true}
          aria-controls="cm-listbox"
          aria-activedescendant={activeDescendant}
          className={styles.contextMenuSearchInput}
        />
      </div>

      <div className={styles.contextMenuDivider} />

      {/* Scrollable node list */}
      <div
        ref={scrollRef}
        id="cm-listbox"
        role="listbox"
        aria-label="Node types"
        style={{
          maxHeight: 'min(50vh, 350px)',
          overflowY: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--scrollbar-thumb) transparent',
        }}
      >
        {filtered ? (
          /* Search results — flat filtered list */
          filtered.length === 0 ? (
            <div role="status" style={{ padding: '8px 10px', color: 'var(--text-faint)', fontSize: 11, textAlign: 'center' }}>
              No nodes match &ldquo;{search}&rdquo;
            </div>
          ) : (
            filtered.map((btn, i) => (
              <button
                key={btn.type}
                id={`cm-opt-${i}`}
                data-idx={i}
                className={styles.contextMenuItem}
                role="option"
                aria-selected={i === highlightIndex}
                tabIndex={-1}
                style={i === highlightIndex ? { background: 'var(--divider)' } : undefined}
                onPointerEnter={() => setHighlightIndex(i)}
                onClick={() => exec(() => store.getState().addNode(btn.type))}
              >
                <span className={styles.contextMenuDot} style={{ background: btn.color }} />
                {btn.label}
                <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-faint)' }}>
                  {NODE_CATEGORIES[btn.type]}
                </span>
              </button>
            ))
          )
        ) : (
          /* Collapsible categories with keyboard navigation */
          <>
            {catEntries.map((entry, flatIdx) => {
              if (entry.kind === 'category') {
                const items = BUTTONS_BY_CATEGORY[entry.cat];
                const expanded = expandedCats.has(entry.cat);
                return (
                  <button
                    key={`cat-${entry.cat}`}
                    id={`cm-cat-${flatIdx}`}
                    data-cat-idx={flatIdx}
                    className={styles.contextMenuItem}
                    role="option"
                    aria-selected={flatIdx === catHighlightIndex}
                    aria-expanded={expanded}
                    tabIndex={-1}
                    onClick={() => toggleCategory(entry.cat)}
                    onPointerEnter={() => setCatHighlightIndex(flatIdx)}
                    style={{
                      fontWeight: 600,
                      ...(flatIdx === catHighlightIndex ? { background: 'var(--divider)' } : undefined),
                    }}
                  >
                    <span style={{ width: 14, fontSize: 10, color: 'var(--text-faint)', textAlign: 'center', flexShrink: 0 }}>
                      {expanded ? '▾' : '▸'}
                    </span>
                    {entry.cat}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)', fontWeight: 400 }}>
                      {items?.length ?? 0}
                    </span>
                  </button>
                );
              }
              return (
                <button
                  key={entry.btn.type}
                  id={`cm-cat-${flatIdx}`}
                  data-cat-idx={flatIdx}
                  className={styles.contextMenuItem}
                  role="option"
                  aria-selected={flatIdx === catHighlightIndex}
                  tabIndex={-1}
                  onPointerEnter={() => setCatHighlightIndex(flatIdx)}
                  style={{
                    paddingLeft: 28,
                    ...(flatIdx === catHighlightIndex ? { background: 'var(--divider)' } : undefined),
                  }}
                  onClick={() => exec(() => store.getState().addNode(entry.btn.type))}
                >
                  <span className={styles.contextMenuDot} style={{ background: entry.btn.color }} />
                  {entry.btn.label}
                </button>
              );
            })}
            <div className={styles.contextMenuDivider} />
            <button
              className={styles.contextMenuItem}
              role="menuitem"
              tabIndex={-1}
              onClick={() => exec(() => store.getState().createSubgraph())}
            >
              <span className={styles.contextMenuDot} style={{ background: 'var(--coral)' }} />
              Subgraph
            </button>
          </>
        )}
      </div>

      {/* Utility actions */}
      <div className={styles.contextMenuDivider} />
      <button
        className={styles.contextMenuItem}
        role="menuitem"
        tabIndex={-1}
        onClick={() => exec(() => store.getState().autoLayout())}
      >
        <CtxIcon d="M3 6h18M3 12h18M3 18h18" />
        Auto Layout
        <span className={styles.contextMenuShortcut}>L</span>
      </button>
      <button
        className={styles.contextMenuItem}
        role="menuitem"
        tabIndex={-1}
        disabled={!canPaste}
        onClick={() => canPaste && exec(() => store.getState().paste())}
      >
        <CtxIcon d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8 2h8v4H8z" />
        Paste
        <span className={styles.contextMenuShortcut}>Ctrl+V</span>
      </button>
      <button
        className={styles.contextMenuItem}
        role="menuitem"
        tabIndex={-1}
        onClick={() => exec(() => window.__zoomToFit?.())}
      >
        <CtxIcon d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        Zoom to Fit
        <span className={styles.contextMenuShortcut}>F</span>
      </button>
      <button
        className={styles.contextMenuItem}
        role="menuitem"
        tabIndex={-1}
        onClick={() => exec(() => {
          const s = store.getState();
          s.setSelection(new Set([...Object.keys(s.nodes), ...Object.keys(s.connections)]));
        })}
      >
        <CtxIcon d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
        Select All
        <span className={styles.contextMenuShortcut}>Ctrl+A</span>
      </button>
      {selectedIds.size > 0 && (
        <>
          <div className={styles.contextMenuDivider} />
          <button
            className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
            role="menuitem"
            tabIndex={-1}
            onClick={() => exec(() => store.getState().deleteSelected())}
          >
            <CtxIcon d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            Delete Selected ({selectedIds.size})
            <span className={styles.contextMenuShortcut}>Del</span>
          </button>
        </>
      )}
    </>
  );
}

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import styles from '../../styles/panels.module.css';

type ShortcutCategory = 'Selection' | 'Navigation' | 'Editing' | 'Execution' | 'Debug' | 'Panels' | 'Connections' | 'Camera' | 'View';

interface Shortcut {
  keys: string;
  desc: string;
  category: ShortcutCategory;
}

const SHORTCUTS: Shortcut[] = [
  // Selection
  { keys: 'Click', desc: 'Select node/connection', category: 'Selection' },
  { keys: 'Shift+Click', desc: 'Multi-select', category: 'Selection' },
  { keys: 'Drag empty space', desc: 'Box select nodes', category: 'Selection' },
  { keys: 'Ctrl+A', desc: 'Select all', category: 'Selection' },
  { keys: 'Tab / Shift+Tab', desc: 'Cycle through nodes', category: 'Selection' },
  { keys: 'Shift+U', desc: 'Select upstream nodes', category: 'Selection' },
  { keys: 'Shift+D', desc: 'Select downstream nodes', category: 'Selection' },
  { keys: 'Shift+B', desc: 'Select all connected', category: 'Selection' },
  { keys: 'Escape', desc: 'Cancel / Deselect', category: 'Selection' },

  // Navigation
  { keys: 'F', desc: 'Zoom to fit all nodes', category: 'Navigation' },
  { keys: 'Ctrl+0', desc: 'Reset camera position', category: 'Navigation' },
  { keys: 'Arrow keys', desc: 'Nudge selected / camera views (no selection)', category: 'Navigation' },
  { keys: '↑/↓/←/→', desc: 'Top / 3D / Left / Right view (no selection)', category: 'Navigation' },
  { keys: 'Shift+↑', desc: 'Front view (no selection)', category: 'Navigation' },
  { keys: 'Shift+Arrow', desc: 'Nudge by 1.0 unit (selection)', category: 'Navigation' },
  { keys: '+ / -', desc: 'Zoom in / out', category: 'Navigation' },
  { keys: 'Scroll / Pinch', desc: 'Zoom camera', category: 'Navigation' },
  { keys: 'Right-drag', desc: 'Pan camera', category: 'Navigation' },
  { keys: 'Alt+Drag', desc: 'Pan camera (alternative)', category: 'Navigation' },
  { keys: 'Middle-drag', desc: 'Orbit camera', category: 'Navigation' },
  { keys: 'Alt+Arrow', desc: 'Traverse connections (upstream/downstream)', category: 'Navigation' },
  { keys: 'Enter', desc: 'Enter selected subgraph', category: 'Navigation' },
  { keys: 'Double-click subgraph', desc: 'Enter subgraph', category: 'Navigation' },
  { keys: 'Backspace (empty sel.)', desc: 'Exit subgraph', category: 'Navigation' },

  // Camera
  { keys: 'Alt+1-9', desc: 'Recall camera bookmark', category: 'Camera' },
  { keys: 'Alt+Shift+1-9', desc: 'Save camera bookmark', category: 'Camera' },

  // Editing
  { keys: 'Delete / Backspace', desc: 'Delete selected', category: 'Editing' },
  { keys: 'Ctrl+Z', desc: 'Undo', category: 'Editing' },
  { keys: 'Ctrl+Shift+Z', desc: 'Redo', category: 'Editing' },
  { keys: 'Ctrl+C', desc: 'Copy selected nodes', category: 'Editing' },
  { keys: 'Ctrl+V', desc: 'Paste copied nodes', category: 'Editing' },
  { keys: 'Ctrl+D', desc: 'Duplicate selected', category: 'Editing' },
  { keys: 'Ctrl+Drag', desc: 'Duplicate and drag', category: 'Editing' },
  { keys: 'Double-click canvas', desc: 'Open node palette', category: 'Editing' },
  { keys: 'Double-click title', desc: 'Rename node', category: 'Editing' },
  { keys: 'Ctrl+G', desc: 'Group selected nodes', category: 'Editing' },
  { keys: 'Ctrl+Shift+G', desc: 'Ungroup selected', category: 'Editing' },
  { keys: 'Ctrl+Shift+Del', desc: 'Clear entire graph', category: 'Editing' },
  { keys: 'G', desc: 'Toggle snap-to-grid', category: 'Editing' },
  { keys: 'Shift+G', desc: 'Toggle grid visibility', category: 'Editing' },
  { keys: 'H', desc: 'Toggle collapse selected nodes', category: 'Editing' },
  { keys: 'Shift+L', desc: 'Toggle lock selected nodes', category: 'Editing' },
  { keys: 'L', desc: 'Auto-layout graph', category: 'Editing' },
  { keys: 'N', desc: 'Add note node', category: 'Editing' },
  { keys: '1-4', desc: 'Quick-add node (Source/Transform/Filter/Output)', category: 'Editing' },
  { keys: 'Ctrl+Shift+H', desc: 'Align selected horizontally', category: 'Editing' },
  { keys: 'Ctrl+Shift+V', desc: 'Align selected vertically', category: 'Editing' },
  { keys: 'Ctrl+H', desc: 'Find & replace in nodes', category: 'Editing' },

  // Connections
  { keys: 'Drag output port', desc: 'Start connection', category: 'Connections' },
  { keys: 'Click input port', desc: 'Complete connection', category: 'Connections' },
  { keys: 'Click occupied input', desc: 'Reroute connection', category: 'Connections' },
  { keys: 'Release on empty', desc: 'Quick-add compatible node & connect', category: 'Connections' },
  { keys: 'Right-click', desc: 'Context menu', category: 'Connections' },

  // Execution
  { keys: 'V', desc: 'Toggle value previews', category: 'Execution' },
  { keys: 'Shift+E', desc: 'Toggle error strategy', category: 'Execution' },

  // Debug
  { keys: 'F9', desc: 'Toggle breakpoint on selected node', category: 'Debug' },
  { keys: 'Ctrl+Shift+D', desc: 'Toggle debug panel', category: 'Debug' },
  { keys: 'Ctrl+Shift+E', desc: 'Execute selected nodes only', category: 'Debug' },
  { keys: 'F10', desc: 'Debug: step one wave', category: 'Debug' },
  { keys: 'F5', desc: 'Debug: resume execution', category: 'Debug' },

  // Panels
  { keys: 'Ctrl+K / Ctrl+Shift+P', desc: 'Open command palette', category: 'Panels' },
  { keys: 'Ctrl+,', desc: 'Open settings', category: 'Panels' },
  { keys: 'Shift+P', desc: 'Toggle profiling panel', category: 'Panels' },
  { keys: 'Shift+M', desc: 'Toggle minimap', category: 'Panels' },
  { keys: 'Shift+I', desc: 'Toggle inspector', category: 'Panels' },
  { keys: 'T', desc: 'Toggle toolbar', category: 'Panels' },
  { keys: 'Shift+O', desc: 'Toggle overview mode', category: 'View' },
  { keys: 'Ctrl+Shift+M', desc: 'Toggle validation panel', category: 'Panels' },
  { keys: 'Ctrl+T', desc: 'New graph tab', category: 'Panels' },
  { keys: 'Ctrl+W', desc: 'Close graph tab', category: 'Panels' },
  { keys: 'Ctrl+1-9', desc: 'Switch to graph tab', category: 'Panels' },
  { keys: 'Ctrl+Alt+1-4', desc: 'Apply workspace preset', category: 'Panels' },
  { keys: '?', desc: 'Toggle this shortcut reference', category: 'Panels' },
];

const CATEGORY_ORDER: ShortcutCategory[] = [
  'Selection', 'Navigation', 'Camera', 'View', 'Editing', 'Connections', 'Execution', 'Debug', 'Panels',
];

const CATEGORY_COLORS: Record<ShortcutCategory, string> = {
  Selection: 'var(--teal)',
  Navigation: 'var(--orange)',
  Editing: 'var(--coral)',
  Connections: 'var(--purple)',
  Execution: 'var(--success)',
  Debug: 'var(--warning)',
  Panels: '#6C8EBF',
  Camera: 'var(--orange)',
  View: 'var(--purple)',
};

/** Render keyboard key badges from a shortcut string */
function KeyBadges({ keys, highlight }: { keys: string; highlight: string }) {
  // Split on " / " for alternatives, then on "+" for combos
  const parts = keys.split(' / ');
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {parts.map((part, pi) => (
        <span key={pi} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {pi > 0 && <span style={{ color: 'var(--text-faint)', fontSize: 10, margin: '0 2px' }}>/</span>}
          {part.split('+').map((key, ki) => (
            <span key={ki} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {ki > 0 && <span style={{ color: 'var(--text-faint)', fontSize: 9 }}>+</span>}
              <kbd style={{
                display: 'inline-block',
                padding: '1px 6px',
                borderRadius: 4,
                background: 'var(--btn-bg)',
                border: '1px solid var(--btn-border)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                lineHeight: '18px',
                color: highlightMatch(key.trim(), highlight) ? 'var(--gold)' : 'var(--text)',
                whiteSpace: 'nowrap',
                minWidth: 18,
                textAlign: 'center',
              }}>{key.trim()}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function highlightMatch(text: string, query: string): boolean {
  if (!query) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

/** Highlight matching substring in description text */
function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight) return <>{text}</>;
  const escaped = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const splitRegex = new RegExp(`(${escaped})`, 'gi');
  const testRegex = new RegExp(`^${escaped}$`, 'i'); // non-global for .test() inside .map()
  const parts = text.split(splitRegex);
  return (
    <>
      {parts.map((part, i) =>
        testRegex.test(part) ? (
          <mark key={i} style={{ background: 'color-mix(in srgb, var(--gold) 25%, transparent)', color: 'var(--gold)', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function HelpOverlay() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return SHORTCUTS;
    const q = search.trim().toLowerCase();
    return SHORTCUTS.filter(
      s => s.keys.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)
    );
  }, [search]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<ShortcutCategory, Shortcut[]>();
    for (const s of filtered) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return map;
  }, [filtered]);

  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
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

  return (
    <div className={styles.helpBackdrop} onClick={() => { setOpen(false); setSearch(''); }} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts reference">
      <div ref={panelRef} className={styles.helpPanel} onClick={e => e.stopPropagation()} onKeyDown={handleFocusTrap} style={{ maxWidth: 700, maxHeight: '85vh', width: '90vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 8px' }}>
          <div className={styles.helpTitle} style={{ margin: 0, padding: 0 }}>Keyboard Shortcuts</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
              {filtered.length} shortcut{filtered.length !== 1 ? 's' : ''}
              {search && ` matching "${search}"`}
            </span>
            <button
              onClick={() => { setOpen(false); setSearch(''); }}
              aria-label="Close"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: 16,
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Search input */}
        <div style={{ padding: '0 16px 12px', position: 'sticky', top: 0, zIndex: 1 }}>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search shortcuts... (try: undo, debug, select, zoom)"
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 5,
              border: '1px solid var(--panel-border)',
              background: 'var(--btn-bg)',
              color: 'var(--text)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => e.target.style.borderColor = 'color-mix(in srgb, var(--teal) 50%, transparent)'}
            onBlur={e => e.target.style.borderColor = 'var(--panel-border)'}
          />
        </div>

        {/* Category quick-filter pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 16px 10px' }}>
          {CATEGORY_ORDER.map(cat => {
            const count = groupedByCategory.get(cat)?.length ?? 0;
            if (count === 0 && search) return null;
            return (
              <button
                key={cat}
                onClick={() => setSearch(search === cat.toLowerCase() ? '' : cat.toLowerCase())}
                style={{
                  padding: '2px 8px',
                  borderRadius: 10,
                  border: `1px solid ${search.toLowerCase() === cat.toLowerCase() ? CATEGORY_COLORS[cat] : 'var(--panel-border)'}`,
                  background: search.toLowerCase() === cat.toLowerCase() ? 'color-mix(in srgb, var(--teal) 10%, transparent)' : 'transparent',
                  color: count > 0 ? CATEGORY_COLORS[cat] : 'var(--text-faint)',
                  fontSize: 9,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: 'pointer',
                  opacity: count > 0 ? 1 : 0.4,
                }}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Categorized shortcuts in two-column layout for wider screens */}
        <div style={{ overflowY: 'auto', maxHeight: 'calc(85vh - 160px)', padding: '0 16px 12px' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
              No shortcuts match "{search}"
            </div>
          )}
          {CATEGORY_ORDER.map(cat => {
            const items = groupedByCategory.get(cat);
            if (!items || items.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  paddingBottom: 4,
                  borderBottom: `1px solid var(--divider)`,
                }}>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: CATEGORY_COLORS[cat],
                    flexShrink: 0,
                    opacity: 0.7,
                  }} />
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    fontWeight: 600,
                    color: CATEGORY_COLORS[cat],
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>{cat}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>({items.length})</span>
                </div>
                {items.map(({ keys, desc }) => (
                  <div key={keys} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '3px 0',
                    gap: 12,
                  }}>
                    <KeyBadges keys={keys} highlight={search} />
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      color: 'var(--text-dim)',
                      textAlign: 'right',
                      flexShrink: 0,
                    }}>
                      <HighlightText text={desc} highlight={search} />
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className={styles.helpFooter}>
          Press <kbd className={styles.helpKbd}>?</kbd> or <kbd className={styles.helpKbd}>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { NODE_CATEGORIES } from '../../types';
import type { NodeCategory, EditorNode } from '../../types';
import styles from '../../styles/panels.module.css';

const CATEGORY_FILTERS: NodeCategory[] = ['Core', 'Math', 'String', 'Logic', 'Vector', 'Data', 'Utility', 'Color', 'Live', 'Subgraph'];

type StatusFilter = 'all' | 'errors' | 'disconnected';
type PatternFilter = 'none' | 'isolated' | 'sources' | 'sinks' | 'highly-connected';

interface NodeSearchResult {
  node: EditorNode;
  matchField: 'title' | 'type' | 'data' | 'id';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function NodeSearchPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<NodeCategory | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [patternFilter, setPatternFilter] = useState<PatternFilter>('none');
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const executionErrors = useEditorStore(s => s.executionErrors);
  const focusNode = useEditorStore(s => s.focusNode);
  const setSearchHighlightIds = useEditorStore(s => s.setSearchHighlightIds);

  // Compute which nodes have disconnected inputs
  const disconnectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const connectedInputs = new Set<string>();
    for (const c of Object.values(connections)) {
      connectedInputs.add(`${c.targetNodeId}:${c.targetPortIndex}`);
    }
    for (const node of Object.values(nodes)) {
      for (let i = 0; i < node.inputs.length; i++) {
        if (!connectedInputs.has(`${node.id}:${i}`)) {
          ids.add(node.id);
          break;
        }
      }
    }
    return ids;
  }, [nodes, connections]);

  // Compute per-node connection counts for pattern filtering
  const nodeConnectionInfo = useMemo(() => {
    const inCount: Record<string, number> = {};
    const outCount: Record<string, number> = {};
    for (const c of Object.values(connections)) {
      inCount[c.targetNodeId] = (inCount[c.targetNodeId] || 0) + 1;
      outCount[c.sourceNodeId] = (outCount[c.sourceNodeId] || 0) + 1;
    }
    return { inCount, outCount };
  }, [connections]);

  // Filter and search results
  const results: NodeSearchResult[] = useMemo(() => {
    const allNodes = Object.values(nodes);
    let filtered = allNodes;

    // Category filter
    if (categoryFilter) {
      filtered = filtered.filter(n => {
        const cat = NODE_CATEGORIES[n.type as keyof typeof NODE_CATEGORIES];
        return cat === categoryFilter;
      });
    }

    // Status filter
    if (statusFilter === 'errors') {
      filtered = filtered.filter(n => executionErrors[n.id]);
    } else if (statusFilter === 'disconnected') {
      filtered = filtered.filter(n => disconnectedNodeIds.has(n.id));
    }

    // Pattern filter
    if (patternFilter === 'isolated') {
      filtered = filtered.filter(n => !nodeConnectionInfo.inCount[n.id] && !nodeConnectionInfo.outCount[n.id]);
    } else if (patternFilter === 'sources') {
      // Nodes with outputs but no inputs (data sources)
      filtered = filtered.filter(n => !nodeConnectionInfo.inCount[n.id] && (nodeConnectionInfo.outCount[n.id] || 0) > 0);
    } else if (patternFilter === 'sinks') {
      // Nodes with inputs but no outputs (data sinks)
      filtered = filtered.filter(n => (nodeConnectionInfo.inCount[n.id] || 0) > 0 && !nodeConnectionInfo.outCount[n.id]);
    } else if (patternFilter === 'highly-connected') {
      // Nodes with 3+ total connections
      filtered = filtered.filter(n => ((nodeConnectionInfo.inCount[n.id] || 0) + (nodeConnectionInfo.outCount[n.id] || 0)) >= 3);
    }

    // Text search
    if (!query.trim()) {
      return filtered.map(node => ({ node, matchField: 'title' as const }));
    }

    const pattern = new RegExp(escapeRegex(query.trim()), 'i');
    const matched: NodeSearchResult[] = [];

    for (const node of filtered) {
      if (pattern.test(node.title)) {
        matched.push({ node, matchField: 'title' });
      } else if (pattern.test(node.type)) {
        matched.push({ node, matchField: 'type' });
      } else if (pattern.test(node.id)) {
        matched.push({ node, matchField: 'id' });
      } else {
        // Search data values
        const dataStr = JSON.stringify(node.data ?? {});
        if (pattern.test(dataStr)) {
          matched.push({ node, matchField: 'data' });
        }
      }
    }

    return matched;
  }, [nodes, query, categoryFilter, statusFilter, patternFilter, executionErrors, disconnectedNodeIds, nodeConnectionInfo]);

  // Update 3D search highlights — compare before writing to avoid re-renders
  const prevHighlightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(results.map(r => r.node.id));
    // Only update store if the set contents actually changed
    const prev = prevHighlightRef.current;
    if (ids.size !== prev.size || [...ids].some(id => !prev.has(id))) {
      prevHighlightRef.current = ids;
      setSearchHighlightIds(ids);
    }
  }, [results, setSearchHighlightIds]);

  // Clear highlights only on unmount (not on every results change)
  useEffect(() => {
    return () => {
      prevHighlightRef.current = new Set();
      setSearchHighlightIds(new Set());
    };
  }, [setSearchHighlightIds]);

  // Clamp focus index
  useEffect(() => {
    if (focusIndex >= results.length) setFocusIndex(Math.max(0, results.length - 1));
  }, [results.length, focusIndex]);

  // Auto-focus input on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll focused item into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const item = container.children[focusIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const handleSelect = useCallback((nodeId: string) => {
    focusNode(nodeId);
    // Pan camera to the selected node
    const node = useEditorStore.getState().nodes[nodeId];
    if (node) {
      const ctrl = window.__orbitControls;
      if (ctrl) {
        ctrl.target.set(node.position[0], 0, node.position[2]);
        ctrl.update();
        window.__invalidate?.();
      }
    }
    onClose();
  }, [focusNode, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex(i => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      handleSelect(results[focusIndex]?.node.id);
      return;
    }
  }, [results, focusIndex, onClose, handleSelect]);

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
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { handleKeyDown(e); handleFocusTrap(e); }}
        role="dialog"
        aria-modal="true"
        aria-label="Node search"
        style={{ maxWidth: 420 }}
      >
        {/* Search input */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--divider)' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search nodes by name, type, or data..."
            value={query}
            onChange={e => { setQuery(e.target.value); setFocusIndex(0); }}
            aria-label="Search nodes"
            style={{
              width: '100%',
              background: 'var(--btn-bg)',
              border: '1px solid var(--btn-border)',
              borderRadius: 4,
              padding: '6px 10px',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filters */}
        <div style={{ padding: '6px 12px', display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--divider)' }}>
          {/* Category pills */}
          <button
            onClick={() => setCategoryFilter(null)}
            style={{
              padding: '1px 6px', fontSize: 8, borderRadius: 3,
              border: `1px solid ${categoryFilter === null ? 'var(--teal)' : 'var(--btn-border)'}`,
              background: categoryFilter === null ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
              color: categoryFilter === null ? 'var(--teal)' : 'var(--btn-text)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            All
          </button>
          {CATEGORY_FILTERS.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
              style={{
                padding: '1px 6px', fontSize: 8, borderRadius: 3,
                border: `1px solid ${categoryFilter === cat ? 'var(--teal)' : 'var(--btn-border)'}`,
                background: categoryFilter === cat ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
                color: categoryFilter === cat ? 'var(--teal)' : 'var(--btn-text)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {cat}
            </button>
          ))}
          {/* Status filters */}
          <div style={{ width: '100%', marginTop: 2, display: 'flex', gap: 4 }}>
            {(['all', 'errors', 'disconnected'] as StatusFilter[]).map(sf => (
              <button
                key={sf}
                onClick={() => setStatusFilter(sf)}
                style={{
                  padding: '1px 6px', fontSize: 8, borderRadius: 3,
                  border: `1px solid ${statusFilter === sf ? 'var(--orange)' : 'var(--btn-border)'}`,
                  background: statusFilter === sf ? 'color-mix(in srgb, var(--orange) 15%, transparent)' : 'var(--btn-bg)',
                  color: statusFilter === sf ? 'var(--orange)' : 'var(--btn-text)',
                  cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                }}
              >
                {sf === 'all' ? 'Any status' : sf}
              </button>
            ))}
          </div>
          {/* Pattern filters */}
          <div style={{ width: '100%', marginTop: 2, display: 'flex', gap: 4 }}>
            {([
              ['none', 'Any pattern'],
              ['isolated', 'Isolated'],
              ['sources', 'Sources'],
              ['sinks', 'Sinks'],
              ['highly-connected', 'Hub (3+)'],
            ] as [PatternFilter, string][]).map(([pf, label]) => (
              <button
                key={pf}
                onClick={() => setPatternFilter(pf)}
                style={{
                  padding: '1px 6px', fontSize: 8, borderRadius: 3,
                  border: `1px solid ${patternFilter === pf ? 'var(--purple, #a78bfa)' : 'var(--btn-border)'}`,
                  background: patternFilter === pf ? 'color-mix(in srgb, var(--purple, #a78bfa) 15%, transparent)' : 'var(--btn-bg)',
                  color: patternFilter === pf ? 'var(--purple, #a78bfa)' : 'var(--btn-text)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          role="listbox"
          aria-label="Search results"
          style={{ maxHeight: 300, overflowY: 'auto', padding: '4px 0' }}
        >
          {results.length === 0 && (
            <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 10, color: 'var(--text-faint)' }}>
              No matching nodes
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={r.node.id}
              role="option"
              aria-selected={i === focusIndex}
              onClick={() => handleSelect(r.node.id)}
              style={{
                padding: '4px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: i === focusIndex ? 'color-mix(in srgb, var(--teal) 10%, transparent)' : undefined,
                borderLeft: i === focusIndex ? '2px solid var(--teal)' : '2px solid transparent',
              }}
            >
              <span style={{
                fontSize: 8, color: 'var(--text-faint)', textTransform: 'uppercase',
                minWidth: 48, flexShrink: 0,
              }}>
                {NODE_CATEGORIES[r.node.type as keyof typeof NODE_CATEGORIES] ?? 'Custom'}
              </span>
              <span style={{
                fontSize: 10, color: 'var(--text-bright)',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {r.node.title}
              </span>
              <span style={{ fontSize: 8, color: 'var(--text-faint)', flexShrink: 0 }}>
                {r.node.type}
              </span>
              {executionErrors[r.node.id] && (
                <span style={{ fontSize: 8, color: 'var(--coral)', flexShrink: 0 }}>err</span>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--divider)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>
            {results.length} node{results.length !== 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: 8, color: 'var(--text-faint)' }}>
            Enter to focus &middot; Esc to close
          </span>
        </div>
      </div>
    </div>
  );
}

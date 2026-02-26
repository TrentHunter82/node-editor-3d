import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import styles from '../../styles/panels.module.css';

interface NodeMatch {
  kind: 'node';
  nodeId: string;
  title: string;
  type: string;
}

interface ConnectionMatch {
  kind: 'connection';
  connectionId: string;
  label: string;
  sourceTitle: string;
  targetTitle: string;
}

interface DataMatch {
  kind: 'data';
  nodeId: string;
  nodeTitle: string;
  dataKey: string;
  dataValue: string;
}

type Match = NodeMatch | ConnectionMatch | DataMatch;
type SearchScope = 'labels' | 'values' | 'both';

export function FindReplacePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [searchScope, setSearchScope] = useState<SearchScope>('both');
  const findRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const focusNode = useEditorStore(s => s.focusNode);
  const setSelection = useEditorStore(s => s.setSelection);
  const updateNodeTitle = useEditorStore(s => s.updateNodeTitle);
  const updateNodeData = useEditorStore(s => s.updateNodeData);
  const batchUpdateNodeTitles = useEditorStore(s => s.batchUpdateNodeTitles);
  const batchUpdateNodeData = useEditorStore(s => s.batchUpdateNodeData);

  const matches = useMemo((): Match[] => {
    if (!findQuery.trim()) return [];
    const q = findQuery.toLowerCase();
    const result: Match[] = [];
    const searchLabels = searchScope === 'labels' || searchScope === 'both';
    const searchValues = searchScope === 'values' || searchScope === 'both';
    for (const node of Object.values(nodes)) {
      // Search nodes by title and type (labels scope)
      if (searchLabels && (node.title.toLowerCase().includes(q) || node.type.includes(q))) {
        result.push({ kind: 'node', nodeId: node.id, title: node.title, type: node.type });
      }
      // Search data values (values scope)
      if (searchValues) {
        for (const [key, val] of Object.entries(node.data)) {
          const strVal = typeof val === 'string' ? val : typeof val === 'number' ? String(val) : null;
          if (strVal !== null && strVal.toLowerCase().includes(q)) {
            result.push({
              kind: 'data',
              nodeId: node.id,
              nodeTitle: node.title,
              dataKey: key,
              dataValue: strVal,
            });
          }
        }
      }
    }
    // Search connection labels (labels scope)
    if (searchLabels) {
      for (const conn of Object.values(connections)) {
        if (conn.label && conn.label.toLowerCase().includes(q)) {
          const src = nodes[conn.sourceNodeId];
          const tgt = nodes[conn.targetNodeId];
          result.push({
            kind: 'connection',
            connectionId: conn.id,
            label: conn.label,
            sourceTitle: src?.title ?? '?',
            targetTitle: tgt?.title ?? '?',
          });
        }
      }
    }
    return result;
  }, [findQuery, nodes, connections, searchScope]);

  // Reset state and focus input when panel opens.
  // setState in effect is acceptable here: it's a one-time reset on open transition,
  // not a continuous synchronization loop.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setFindQuery('');
      setReplaceQuery('');
      setMatchIndex(0);
      setSearchScope('both');
      requestAnimationFrame(() => findRef.current?.focus());
    }
  }, [open]);

  // Clamp match index when results change
  useEffect(() => {
    setMatchIndex(i => Math.min(i, Math.max(matches.length - 1, 0)));
  }, [matches.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Focus current match in scene
  useEffect(() => {
    if (matches.length > 0 && matchIndex < matches.length) {
      const match = matches[matchIndex];
      if (match.kind === 'node' || match.kind === 'data') {
        focusNode(match.nodeId);
      } else {
        // Select the connection so it highlights
        setSelection(new Set([match.connectionId]));
      }
    }
  }, [matchIndex, matches, focusNode, setSelection]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex(i => (i + 1) % matches.length);
  }, [matches.length]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setMatchIndex(i => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const replaceCurrent = useCallback(() => {
    if (matches.length === 0 || !replaceQuery) return;
    const match = matches[matchIndex];
    if (!match) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (match.kind === 'node') {
      const newTitle = match.title.replace(new RegExp(escaped, 'gi'), replaceQuery);
      updateNodeTitle(match.nodeId, newTitle);
    } else if (match.kind === 'data') {
      const newValue = match.dataValue.replace(new RegExp(escaped, 'gi'), replaceQuery);
      // Preserve number type if the original was a number and the result is numeric
      const node = nodes[match.nodeId];
      const originalValue = node?.data[match.dataKey];
      if (typeof originalValue === 'number') {
        const parsed = Number(newValue);
        updateNodeData(match.nodeId, match.dataKey, Number.isNaN(parsed) ? newValue : parsed);
      } else {
        updateNodeData(match.nodeId, match.dataKey, newValue);
      }
    }
  }, [matches, matchIndex, findQuery, replaceQuery, updateNodeTitle, updateNodeData, nodes]);

  const replaceAll = useCallback(() => {
    if (matches.length === 0 || !replaceQuery) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Separate title updates and data updates for batch operations
    const titleUpdates: { nodeId: string; title: string }[] = [];
    const dataUpdates: { nodeId: string; key: string; value: unknown }[] = [];
    for (const match of matches) {
      if (match.kind === 'node') {
        const newTitle = match.title.replace(new RegExp(escaped, 'gi'), replaceQuery);
        if (newTitle !== match.title) {
          titleUpdates.push({ nodeId: match.nodeId, title: newTitle });
        }
      } else if (match.kind === 'data') {
        const newValue = match.dataValue.replace(new RegExp(escaped, 'gi'), replaceQuery);
        if (newValue !== match.dataValue) {
          const node = nodes[match.nodeId];
          const originalValue = node?.data[match.dataKey];
          if (typeof originalValue === 'number') {
            const parsed = Number(newValue);
            dataUpdates.push({ nodeId: match.nodeId, key: match.dataKey, value: Number.isNaN(parsed) ? newValue : parsed });
          } else {
            dataUpdates.push({ nodeId: match.nodeId, key: match.dataKey, value: newValue });
          }
        }
      }
    }
    if (titleUpdates.length > 0) {
      batchUpdateNodeTitles(titleUpdates);
    }
    if (dataUpdates.length > 0) {
      batchUpdateNodeData(dataUpdates);
    }
  }, [matches, findQuery, replaceQuery, batchUpdateNodeTitles, batchUpdateNodeData, nodes]);

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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); goNext(); }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); goPrev(); }
    handleFocusTrap(e);
  }, [onClose, goNext, goPrev, handleFocusTrap]);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 52,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 150,
      animation: 'scaleIn 0.12s ease-out',
    }}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className={styles.searchPalette}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Find and replace"
        style={{ width: 380, outline: 'none' }}
      >
        {/* Find row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--divider)',
        }}>
          <input
            ref={findRef}
            className={styles.searchInput}
            style={{ padding: '6px 8px', borderBottom: 'none', flex: 1 }}
            placeholder="Find in titles & data..."
            aria-label="Find in nodes and data"
            value={findQuery}
            onChange={e => { setFindQuery(e.target.value); setMatchIndex(0); }}
          />
          <span style={{
            fontSize: '10px',
            color: 'var(--btn-text)',
            whiteSpace: 'nowrap',
            minWidth: 48,
            textAlign: 'right',
          }}>
            {matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : '0/0'}
          </span>
          <button
            onClick={goPrev}
            disabled={matches.length === 0}
            aria-label="Previous match"
            title="Previous (Shift+Enter)"
            style={{
              background: 'var(--btn-bg)',
              border: '1px solid var(--btn-border)',
              borderRadius: 4,
              color: 'var(--text)',
              cursor: matches.length === 0 ? 'default' : 'pointer',
              padding: '3px 6px',
              fontSize: '12px',
              opacity: matches.length === 0 ? 0.3 : 1,
            }}
          >
            {'\u25B2'}
          </button>
          <button
            onClick={goNext}
            disabled={matches.length === 0}
            aria-label="Next match"
            title="Next (Enter)"
            style={{
              background: 'var(--btn-bg)',
              border: '1px solid var(--btn-border)',
              borderRadius: 4,
              color: 'var(--text)',
              cursor: matches.length === 0 ? 'default' : 'pointer',
              padding: '3px 6px',
              fontSize: '12px',
              opacity: matches.length === 0 ? 0.3 : 1,
            }}
          >
            {'\u25BC'}
          </button>
          <button
            onClick={onClose}
            aria-label="Close find and replace"
            title="Close (Escape)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--btn-text)',
              cursor: 'pointer',
              padding: '2px 4px',
              fontSize: '14px',
            }}
          >
            {'\u00D7'}
          </button>
        </div>

        {/* Scope toggle */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 12px',
          borderBottom: '1px solid var(--divider)',
        }}>
          <span style={{ fontSize: '9px', color: 'var(--text-faint)', marginRight: 4 }}>Search in:</span>
          {(['labels', 'values', 'both'] as const).map(scope => (
            <button
              key={scope}
              onClick={() => { setSearchScope(scope); setMatchIndex(0); }}
              style={{
                padding: '1px 8px',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                borderRadius: 4,
                border: `1px solid ${searchScope === scope ? 'var(--teal)' : 'var(--btn-border)'}`,
                background: searchScope === scope ? 'color-mix(in srgb, var(--teal) 15%, transparent)' : 'var(--btn-bg)',
                color: searchScope === scope ? 'var(--teal)' : 'var(--btn-text)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {scope}
            </button>
          ))}
        </div>

        {/* Replace row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--divider)',
        }}>
          <input
            className={styles.searchInput}
            style={{ padding: '6px 8px', borderBottom: 'none', flex: 1 }}
            placeholder="Replace..."
            aria-label="Replace in node titles and data"
            value={replaceQuery}
            onChange={e => setReplaceQuery(e.target.value)}
          />
          <button
            onClick={replaceCurrent}
            disabled={matches.length === 0 || !replaceQuery}
            title="Replace current match"
            style={{
              background: 'color-mix(in srgb, var(--teal) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--teal) 20%, transparent)',
              borderRadius: 4,
              color: 'var(--teal)',
              cursor: matches.length === 0 || !replaceQuery ? 'default' : 'pointer',
              padding: '3px 8px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              opacity: matches.length === 0 || !replaceQuery ? 0.3 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            Replace
          </button>
          <button
            onClick={replaceAll}
            disabled={matches.length === 0 || !replaceQuery}
            title="Replace all matches"
            style={{
              background: 'color-mix(in srgb, var(--teal) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--teal) 20%, transparent)',
              borderRadius: 4,
              color: 'var(--teal)',
              cursor: matches.length === 0 || !replaceQuery ? 'default' : 'pointer',
              padding: '3px 8px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              opacity: matches.length === 0 || !replaceQuery ? 0.3 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            All
          </button>
        </div>

        {/* Match list */}
        {findQuery && (
          <div className={styles.searchResults} style={{ maxHeight: 200 }}>
            {matches.length === 0 && (
              <div style={{
                padding: 12,
                textAlign: 'center',
                color: 'var(--text-faint)',
                fontSize: 11,
              }}>
                No matches
              </div>
            )}
            {matches.map((m, i) => (
              <button
                key={m.kind === 'node' ? m.nodeId : m.kind === 'data' ? `${m.nodeId}-${m.dataKey}` : m.connectionId}
                className={`${styles.searchItem} ${i === matchIndex ? styles.searchItemActive : ''}`}
                onClick={() => {
                  setMatchIndex(i);
                  if (m.kind === 'node' || m.kind === 'data') focusNode(m.nodeId);
                  else setSelection(new Set([m.connectionId]));
                }}
                onMouseEnter={() => setMatchIndex(i)}
              >
                <span className={styles.searchItemDot} style={{
                  background: i === matchIndex ? 'var(--teal)' : 'var(--text-faint)',
                }} />
                {m.kind === 'node' ? m.title : m.kind === 'data' ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ opacity: 0.5, fontSize: '9px' }}>{m.nodeTitle}</span>
                    <span style={{ opacity: 0.3, fontSize: '8px' }}>{m.dataKey}=</span>
                    <span style={{ color: 'var(--orange)', fontSize: '9px' }}>{m.dataValue.length > 30 ? m.dataValue.slice(0, 30) + '...' : m.dataValue}</span>
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ opacity: 0.5, fontSize: '9px' }}>{m.sourceTitle}</span>
                    <span style={{ opacity: 0.3 }}>{'\u2192'}</span>
                    <span style={{ opacity: 0.5, fontSize: '9px' }}>{m.targetTitle}</span>
                    <span style={{ color: 'var(--teal)', fontSize: '9px' }}>{m.label}</span>
                  </span>
                )}
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '9px',
                  opacity: 0.4,
                }}>
                  {m.kind === 'node' ? m.type : m.kind === 'data' ? 'data' : 'connection'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

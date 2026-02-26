import { memo, useCallback, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Tooltip } from './Tooltip';
import styles from '../../styles/panels.module.css';

interface BreadcrumbItem {
  id: string;
  label: string;
}

/**
 * Horizontal breadcrumb trail for subgraph navigation.
 * Shows path: Main > SubGraph > Nested with clickable segments.
 * Only renders when inside a subgraph (breadcrumbStack.length > 0).
 */
export const BreadcrumbNav = memo(function BreadcrumbNav() {
  const breadcrumbStack = useEditorStore(s => s.breadcrumbStack);
  const activeGraphId = useEditorStore(s => s.activeGraphId);
  const graphTabs = useEditorStore(s => s.graphTabs);
  const exitSubgraph = useEditorStore(s => s.exitSubgraph);

  // Build breadcrumb items from the stack
  const items = useMemo((): BreadcrumbItem[] => {
    if (breadcrumbStack.length === 0) return [];

    const result: BreadcrumbItem[] = [];

    // Add each ancestor graph from the stack
    for (const entry of breadcrumbStack) {
      const tab = graphTabs[entry.graphId];
      result.push({
        id: entry.graphId,
        label: tab?.name ?? 'Graph',
      });
    }

    // Add current (active) graph as the last item
    const activeTab = graphTabs[activeGraphId];
    result.push({
      id: activeGraphId,
      label: activeTab?.name ?? 'Subgraph',
    });

    return result;
  }, [breadcrumbStack, activeGraphId, graphTabs]);

  // Navigate back to an ancestor by calling exitSubgraph the right number of times
  const handleNavigate = useCallback((targetGraphId: string) => {
    // Find how many levels to go back
    const targetIndex = items.findIndex(item => item.id === targetGraphId);
    if (targetIndex === -1 || targetIndex >= items.length - 1) return; // Already there or not found

    const levelsToExit = items.length - 1 - targetIndex;
    for (let i = 0; i < levelsToExit; i++) {
      exitSubgraph();
    }
  }, [items, exitSubgraph]);

  if (items.length < 2) return null;

  return (
    <nav className={styles.breadcrumb} aria-label="Graph navigation path">
      <Tooltip label="Exit subgraph" shortcut="Backspace" placement="bottom">
        <button
          className={styles.breadcrumbBack}
          onClick={exitSubgraph}
          aria-label="Exit subgraph"
        >
          &larr;
        </button>
      </Tooltip>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={item.id} className={styles.breadcrumbSegment}>
            {i > 0 && <span className={styles.breadcrumbSep} aria-hidden="true">&rsaquo;</span>}
            {isLast ? (
              <span className={styles.breadcrumbCurrent} aria-current="location">
                {item.label}
              </span>
            ) : (
              <BreadcrumbButton id={item.id} label={item.label} onNavigate={handleNavigate} />
            )}
          </span>
        );
      })}
    </nav>
  );
});

function BreadcrumbButton({ id, label, onNavigate }: { id: string; label: string; onNavigate: (id: string) => void }) {
  const handleClick = useCallback(() => onNavigate(id), [id, onNavigate]);
  return (
    <button className={styles.breadcrumbLink} onClick={handleClick}>
      {label}
    </button>
  );
}

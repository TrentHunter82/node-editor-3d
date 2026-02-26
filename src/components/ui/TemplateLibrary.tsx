import { useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import styles from '../../styles/panels.module.css';

export function TemplateLibrary() {
  const templates = useEditorStore(s => s.templates);
  const selectedCount = useEditorStore(s => s.selectedIds.size);
  const saveSelectionAsTemplate = useEditorStore(s => s.saveSelectionAsTemplate);
  const instantiateTemplate = useEditorStore(s => s.instantiateTemplate);
  const deleteTemplate = useEditorStore(s => s.deleteTemplate);
  const exportTemplates = useEditorStore(s => s.exportTemplates);
  const importTemplates = useEditorStore(s => s.importTemplates);

  const [expanded, setExpanded] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  // Group templates by category — memoized to avoid recreating on every render
  // Depend on `templates` (stable Zustand ref), compute templateList inside the memo
  const { grouped, templateList } = useMemo(() => {
    const list = Object.values(templates);
    const g = list.reduce<Record<string, typeof list>>((acc, t) => {
      const cat = t.category || 'User';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(t);
      return acc;
    }, {});
    return { grouped: g, templateList: list };
  }, [templates]);
  const hasTemplates = templateList.length > 0;

  const handleSave = useCallback(() => {
    if (!saveName.trim()) return;
    saveSelectionAsTemplate(saveName.trim());
    setSaveName('');
    setShowSaveInput(false);
  }, [saveName, saveSelectionAsTemplate]);

  const handleExport = useCallback(() => {
    const data = exportTemplates();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'templates.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [exportTemplates]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          importTemplates(data);
        } catch {
          // Silently ignore invalid files
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [importTemplates]);

  // If no templates and nothing selected, show minimal toggle
  if (!hasTemplates && selectedCount === 0 && !expanded) return null;

  return (
    <div className={styles.toolbar} style={{ top: 'auto', bottom: 48, left: 20, maxHeight: 300, overflowY: 'auto' }}>
      <div className={styles.toolbarSection}>
        <button
          className={styles.toolbarBtn}
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          style={{ opacity: 0.7, fontSize: '10px', gap: '6px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          Templates {hasTemplates ? `(${templateList.length})` : ''}
        </button>
      </div>

      {expanded && (
        <>
          {/* Save as template */}
          {selectedCount > 0 && (
            <div className={styles.templateSection}>
              {showSaveInput ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    className={styles.inspectorInput}
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSave();
                      if (e.key === 'Escape') setShowSaveInput(false);
                      e.stopPropagation();
                    }}
                    placeholder="Template name..."
                    autoFocus
                    style={{ flex: 1, width: 'auto' }}
                  />
                  <button className={styles.toolbarBtn} onClick={handleSave} style={{ padding: '4px 8px' }}>
                    Save
                  </button>
                </div>
              ) : (
                <button
                  className={styles.toolbarBtn}
                  onClick={() => setShowSaveInput(true)}
                  title="Save selected nodes as template"
                >
                  Save Selection as Template
                </button>
              )}
            </div>
          )}

          {/* Template list grouped by category */}
          {Object.entries(grouped).map(([category, tmpls]) => (
            <div key={category} className={styles.templateSection}>
              <div className={styles.toolbarSectionLabel}>{category}</div>
              {tmpls.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.templateItem}
                  onClick={() => instantiateTemplate(t.id)}
                  title={`${t.nodes.length} nodes, ${t.connections.length} connections`}
                >
                  <span className={styles.templateName}>{t.name}</span>
                  <span className={styles.templateMeta}>
                    {t.nodes.length}n {t.connections.length}c
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    className={styles.templateDelete}
                    onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
                    aria-label={`Delete ${t.name}`}
                    title="Delete template"
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          ))}

          {!hasTemplates && (
            <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text-faint)', fontFamily: 'JetBrains Mono, monospace' }}>
              No templates yet. Select nodes and save.
            </div>
          )}

          {/* Import/Export */}
          <div className={styles.toolbarDivider} />
          <div className={styles.templateActions}>
            <button className={styles.toolbarBtn} onClick={handleImport} style={{ flex: 1, justifyContent: 'center', padding: '6px 8px', fontSize: 10 }}>
              Import
            </button>
            <button className={styles.toolbarBtn} onClick={handleExport} style={{ flex: 1, justifyContent: 'center', padding: '6px 8px', fontSize: 10 }} disabled={!hasTemplates}>
              Export
            </button>
          </div>
        </>
      )}
    </div>
  );
}

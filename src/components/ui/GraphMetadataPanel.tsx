import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import styles from '../../styles/panels.module.css';

export function GraphMetadataPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const activeGraphId = useEditorStore(s => s.activeGraphId);
  const graphTab = useEditorStore(s => s.graphTabs[s.activeGraphId]);
  const renameGraph = useEditorStore(s => s.renameGraph);
  const updateGraphMetadata = useEditorStore(s => s.updateGraphMetadata);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  // Sync state when panel opens or graph changes
  useEffect(() => {
    if (open && graphTab) {
      setTitle(graphTab.name);
      setDescription(graphTab.description ?? '');
      setAuthor(graphTab.author ?? '');
      setTags(graphTab.tags ?? []);
      setTagInput('');
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync on open/graph switch, not on graphTab content changes mid-edit
  }, [open, activeGraphId]);

  const handleSave = useCallback(() => {
    if (!graphTab) return;
    if (title !== graphTab.name) {
      renameGraph(activeGraphId, title);
    }
    updateGraphMetadata(activeGraphId, { description, author, tags });
    onClose();
  }, [activeGraphId, graphTab, title, description, author, tags, renameGraph, updateGraphMetadata, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  }, [onClose, handleSave]);

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags(prev => [...prev, trimmed]);
    }
    setTagInput('');
  }, [tagInput, tags]);

  const removeTag = useCallback((tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  }, []);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(prev => prev.slice(0, -1));
    }
  }, [addTag, tagInput, tags.length]);

  if (!open || !graphTab) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--btn-border)',
    borderRadius: 4,
    color: 'var(--text)',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    color: 'var(--text-dim)',
    marginBottom: 4,
  };

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Graph metadata"
        style={{ maxWidth: 380 }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: "'Archivo Black', sans-serif",
            fontSize: 13,
            color: 'var(--text-bright)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Graph Info
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>
            Ctrl+Enter to save
          </span>
        </div>

        {/* Form */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Title */}
          <div>
            <label htmlFor="gmp-title" style={labelStyle}>Title</label>
            <input
              id="gmp-title"
              ref={titleRef}
              style={inputStyle}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Graph name"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="gmp-description" style={labelStyle}>Description</label>
            <textarea
              id="gmp-description"
              style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this graph do?"
            />
          </div>

          {/* Author */}
          <div>
            <label htmlFor="gmp-author" style={labelStyle}>Author</label>
            <input
              id="gmp-author"
              style={inputStyle}
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder="Author name"
            />
          </div>

          {/* Tags */}
          <div>
            <label htmlFor="gmp-tags" style={labelStyle}>Tags</label>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              padding: '4px 6px',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--btn-border)',
              borderRadius: 4,
              minHeight: 28,
              alignItems: 'center',
            }}>
              {tags.map(tag => (
                <span
                  key={tag}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '1px 6px',
                    background: 'color-mix(in srgb, var(--teal) 15%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--teal) 30%, transparent)',
                    borderRadius: 3,
                    fontSize: 10,
                    color: 'var(--teal)',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--teal)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="gmp-tags"
                style={{
                  flex: 1,
                  minWidth: 60,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  outline: 'none',
                  padding: '2px 0',
                }}
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder={tags.length === 0 ? 'Add tags...' : ''}
              />
            </div>
          </div>

          {/* Created date (read-only) */}
          <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>
            Created: {new Date(graphTab.createdAt).toLocaleDateString()}
          </div>
        </div>

        {/* Footer with save button */}
        <div style={{
          padding: '8px 16px 12px',
          borderTop: '1px solid var(--divider)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '5px 14px',
              background: 'var(--btn-bg)',
              border: '1px solid var(--btn-border)',
              borderRadius: 5,
              color: 'var(--btn-text)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '5px 14px',
              background: 'color-mix(in srgb, var(--teal) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--teal) 30%, transparent)',
              borderRadius: 5,
              color: 'var(--teal)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

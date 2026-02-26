import { useState, useRef, useCallback, useEffect } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { importFromJSON } from '../../utils/serialization';
import type { MultiGraphStorage } from '../../utils/serialization';

/**
 * Full-window drop zone for importing .json graph files via drag-and-drop.
 * Shows a visual overlay when a file is dragged over the window.
 */
export function FileDropZone() {
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const dragCounter = useRef(0);

  // Auto-dismiss import error after 3 seconds
  useEffect(() => {
    if (!importError) return;
    const tid = setTimeout(() => setImportError(null), 3000);
    return () => clearTimeout(tid);
  }, [importError]);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.json')) {
      setImportError('Only .json files are supported');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      useSettingsStore.getState().addRecentFile(file.name);
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && parsed.version === 2 && parsed.graphs) {
          useEditorStore.getState().importAllGraphs(parsed as MultiGraphStorage);
        } else {
          const data = importFromJSON(content);
          if (data) {
            useEditorStore.getState().importWorkflow(data);
          } else {
            setImportError('Invalid graph file format');
          }
        }
      } catch {
        const data = importFromJSON(content);
        if (data) {
          useEditorStore.getState().importWorkflow(data);
        } else {
          setImportError('Failed to parse JSON file');
        }
      }
    };
    reader.onerror = () => setImportError('Failed to read file');
    reader.readAsText(file);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    setImportError(null);
    const files = Array.from(e.dataTransfer.files);
    const jsonFile = files.find(f => f.name.endsWith('.json'));
    if (jsonFile) {
      handleFile(jsonFile);
    } else if (files.length > 0) {
      setImportError('Only .json files are supported');
    }
  }, [handleFile]);

  // Use window-level listeners to catch drags that start outside React's tree
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      if (dragCounter.current === 1) setIsDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current === 0) setIsDragging(false);
    };
    const onOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      setImportError(null);
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      const jsonFile = files.find(f => f.name.endsWith('.json'));
      if (jsonFile) {
        handleFile(jsonFile);
      } else if (files.length > 0) {
        setImportError('Only .json files are supported');
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFile]);

  return (
    <>
      {isDragging && (
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in srgb, var(--panel-bg-solid) 85%, transparent)',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'all',
          }}
        >
          <div style={{
            padding: '32px 48px',
            borderRadius: 16,
            border: '2px dashed var(--teal)',
            background: 'color-mix(in srgb, var(--teal) 8%, transparent)',
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            color: 'var(--teal)',
            textAlign: 'center',
            letterSpacing: 1,
          }}>
            Drop .json file to import graph
          </div>
        </div>
      )}
      {importError && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            bottom: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            padding: '10px 20px',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--danger) 15%, var(--panel-bg-solid))',
            border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-sm)',
            color: 'var(--danger)',
            backdropFilter: 'blur(8px)',
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          {importError}
        </div>
      )}
    </>
  );
}

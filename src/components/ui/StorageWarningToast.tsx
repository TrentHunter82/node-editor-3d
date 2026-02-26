import { useEditorStore } from '../../store/editorStore';

/**
 * Toast notification that surfaces storage warnings (e.g. failed IndexedDB saves).
 * Previously these were silent — users didn't know their work wasn't being saved.
 */
export function StorageWarningToast() {
  const warning = useEditorStore(s => s.storageWarning);
  const dismiss = useEditorStore(s => s.dismissStorageWarning);

  if (!warning) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 'calc(var(--toolbar-top) + 8px)',
        right: 'var(--panel-inset)',
        zIndex: 200,
        maxWidth: 340,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'color-mix(in srgb, var(--warning) 12%, var(--panel-bg-solid))',
        border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
        fontFamily: "var(--font-mono)",
        fontSize: 'var(--font-base)',
        color: 'var(--warning)',
        backdropFilter: 'blur(12px)',
        animation: 'storage-toast-in 0.15s ease-out',
      }}
    >
      <span style={{ fontSize: 'var(--font-xl)', flexShrink: 0 }}>&#9888;</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Save Warning</div>
        <div style={{ fontSize: 'var(--font-sm)', opacity: 0.85, color: 'var(--text)' }}>
          {warning}
        </div>
      </div>
      <button
        onClick={dismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-faint)',
          cursor: 'pointer',
          fontSize: 'var(--font-xl)',
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
        aria-label="Dismiss warning"
      >
        &times;
      </button>
    </div>
  );
}

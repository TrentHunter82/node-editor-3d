import { useCallback } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import styles from '../../styles/panels.module.css';

interface PanelToggle {
  id: string;
  label: string;
  /** Use window global opener or settings toggle */
  type: 'panel' | 'setting';
}

const PANEL_TOGGLES: PanelToggle[] = [
  { id: 'validation', label: 'Valid', type: 'panel' },
  { id: 'profiling', label: 'Profile', type: 'panel' },
  { id: 'debug', label: 'Debug', type: 'panel' },
  { id: 'timeline', label: 'Timeline', type: 'panel' },
  { id: 'undoHistory', label: 'Undo', type: 'panel' },
  { id: 'checkpoints', label: 'Ckpt', type: 'panel' },
  { id: 'dependencyGraph', label: 'Deps', type: 'panel' },
  { id: 'macro', label: 'Macro', type: 'panel' },
  { id: 'minimap', label: 'Map', type: 'setting' },
  { id: 'inspector', label: 'Insp', type: 'setting' },
  { id: 'toolbar', label: 'Tools', type: 'setting' },
];

export function PanelToggleBar() {
  // Direct field selector — referentially stable under Zustand+immer (no useRef needed)
  const openPanels = useSettingsStore(s => s.openPanels);
  const minimapVisible = useSettingsStore(s => s.minimapVisible);
  const inspectorVisible = useSettingsStore(s => s.inspectorVisible);
  const toolbarVisible = useSettingsStore(s => s.toolbarVisible);

  const handleToggle = useCallback((toggle: PanelToggle) => {
    if (toggle.type === 'setting') {
      const ss = useSettingsStore.getState();
      if (toggle.id === 'minimap') ss.setMinimapVisible(!ss.minimapVisible);
      else if (toggle.id === 'inspector') ss.setInspectorVisible(!ss.inspectorVisible);
      else if (toggle.id === 'toolbar') ss.toggleToolbarVisible();
      return;
    }
    // Panel type: toggle via setPanelOpen + window global
    const ss = useSettingsStore.getState();
    const isOpen = ss.openPanels.includes(toggle.id);
    if (isOpen) {
      ss.setPanelOpen(toggle.id, false);
    } else {
      // Open using the window global to sync React state
      const openerMap: Record<string, (() => void) | undefined> = {
        validation: window.__openValidation,
        profiling: window.__openProfiling,
        debug: window.__openDebug,
        timeline: window.__openTimeline,
        undoHistory: window.__openUndoHistory,
        checkpoints: window.__openCheckpoints,
        dependencyGraph: window.__openDependencyGraph,
        macro: window.__openMacroPanel,
      };
      const opener = openerMap[toggle.id];
      if (opener) opener();
    }
  }, []);

  const isActive = useCallback((toggle: PanelToggle): boolean => {
    if (toggle.type === 'setting') {
      if (toggle.id === 'minimap') return minimapVisible;
      if (toggle.id === 'inspector') return inspectorVisible;
      if (toggle.id === 'toolbar') return toolbarVisible;
      return false;
    }
    return openPanels.includes(toggle.id);
  }, [openPanels, minimapVisible, inspectorVisible, toolbarVisible]);

  return (
    <div className={styles.panelToggleBar} role="toolbar" aria-label="Panel toggles">
      {PANEL_TOGGLES.map(toggle => (
        <button
          key={toggle.id}
          className={`${styles.panelToggleBtn} ${isActive(toggle) ? styles.panelToggleBtnActive : ''}`}
          onClick={() => handleToggle(toggle)}
          aria-pressed={isActive(toggle)}
          title={`Toggle ${toggle.label} panel`}
        >
          {toggle.label}
        </button>
      ))}
    </div>
  );
}

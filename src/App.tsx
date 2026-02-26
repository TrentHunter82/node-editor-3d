import { lazy, Suspense, useEffect, useState, useCallback, useRef, type SetStateAction, type Dispatch } from 'react';
import { Canvas } from '@react-three/fiber';
import { SceneSetup } from './components/SceneSetup';
import { PostProcessing } from './components/PostProcessing';
import { NodeGraph } from './components/NodeGraph';
import { ConnectionGraph } from './components/connections/ConnectionGraph';
import { GridFloor } from './components/GridFloor';
import { Toolbar } from './components/ui/Toolbar';
import { ExecuteBar } from './components/ui/ExecuteBar';
import { Inspector } from './components/ui/Inspector';
import { StatusBar } from './components/ui/StatusBar';
import { HelpOverlay } from './components/ui/HelpOverlay';
import { ZoomToFit } from './components/ui/ZoomToFit';
import { BoxSelection, getXZFromScreen } from './components/ui/BoxSelection';
import { Minimap } from './components/ui/Minimap';
import { ContextMenu } from './components/ui/ContextMenu';
import { SearchPalette } from './components/ui/SearchPalette';
import { CameraProvider } from './components/CameraProvider';
import { GraphTabBar } from './components/ui/GraphTabBar';
import { WorkspaceTabBar } from './components/ui/WorkspaceTabBar';
import { TemplateLibrary } from './components/ui/TemplateLibrary';
import { BreadcrumbNav } from './components/ui/BreadcrumbNav';
import { ValidationPanel } from './components/ui/ValidationPanel';
import { ProfilingPanel } from './components/ui/ProfilingPanel';
import { UndoToast } from './components/ui/UndoToast';
import { StorageWarningToast } from './components/ui/StorageWarningToast';
import { ScreenReaderAnnouncer } from './components/ui/ScreenReaderAnnouncer';
import { OnboardingTooltips } from './components/ui/OnboardingTooltips';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { FileDropZone } from './components/ui/FileDropZone';
import { SnapGuides } from './components/SnapGuides';
import { AlignmentGuides } from './components/AlignmentGuides';
import { DragFeedback } from './components/DragFeedback';
import { PanelToggleBar } from './components/ui/PanelToggleBar';
import { useEditorStore } from './store/editorStore';
import { useSettingsStore } from './store/settingsStore';
import { isOnUIPanel } from './utils/uiDetection';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

// Lazy-loaded panels (only loaded when first opened)
const FindReplacePanel = lazy(() => import('./components/ui/FindReplacePanel').then(m => ({ default: m.FindReplacePanel })));
const SettingsPanel = lazy(() => import('./components/ui/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const DebugPanel = lazy(() => import('./components/ui/DebugPanel').then(m => ({ default: m.DebugPanel })));
const GraphMetadataPanel = lazy(() => import('./components/ui/GraphMetadataPanel').then(m => ({ default: m.GraphMetadataPanel })));
const TimelinePanel = lazy(() => import('./components/ui/TimelinePanel').then(m => ({ default: m.TimelinePanel })));
const UndoHistoryPanel = lazy(() => import('./components/ui/UndoHistoryPanel').then(m => ({ default: m.UndoHistoryPanel })));
const CheckpointPanel = lazy(() => import('./components/ui/CheckpointPanel').then(m => ({ default: m.CheckpointPanel })));
const CustomNodeEditorPanel = lazy(() => import('./components/ui/CustomNodeEditorPanel').then(m => ({ default: m.CustomNodeEditorPanel })));
const NodeSearchPanel = lazy(() => import('./components/ui/NodeSearchPanel').then(m => ({ default: m.NodeSearchPanel })));
const DependencyGraphPanel = lazy(() => import('./components/ui/DependencyGraphPanel').then(m => ({ default: m.DependencyGraphPanel })));
const MacroPanel = lazy(() => import('./components/ui/MacroPanel').then(m => ({ default: m.MacroPanel })));
const HelpGuidePanel = lazy(() => import('./components/ui/HelpGuidePanel').then(m => ({ default: m.HelpGuidePanel })));
const KeyboardShortcutsPanel = lazy(() => import('./components/ui/KeyboardShortcutsPanel').then(m => ({ default: m.KeyboardShortcutsPanel })));

/** Panel state hook that persists open/closed to settingsStore and syncs external changes */
function usePanelState(panelId: string): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [open, setOpenLocal] = useState(() => useSettingsStore.getState().openPanels.includes(panelId));
  const openRef = useRef(open);
  openRef.current = open;
  const setOpen: Dispatch<SetStateAction<boolean>> = useCallback((v) => {
    setOpenLocal(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      useSettingsStore.getState().setPanelOpen(panelId, next);
      return next;
    });
  }, [panelId]);
  // Sync from external changes (e.g. PanelToggleBar, workspace presets)
  useEffect(() => {
    return useSettingsStore.subscribe((state) => {
      const shouldBeOpen = state.openPanels.includes(panelId);
      if (shouldBeOpen !== openRef.current) {
        setOpenLocal(shouldBeOpen);
      }
    });
  }, [panelId]);
  return [open, setOpen];
}

export default function App() {
  const cancelConnection = useEditorStore(s => s.cancelConnection);
  const setSelection = useEditorStore(s => s.setSelection);
  const openContextMenu = useEditorStore(s => s.openContextMenu);
  const closeContextMenu = useEditorStore(s => s.closeContextMenu);
  const [searchOpen, setSearchOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = usePanelState('findReplace');
  const [validationOpen, setValidationOpen] = usePanelState('validation');
  const [profilingOpen, setProfilingOpen] = usePanelState('profiling');
  const [settingsOpen, setSettingsOpen] = usePanelState('settings');
  const [debugOpen, setDebugOpen] = usePanelState('debug');
  const [graphMetaOpen, setGraphMetaOpen] = usePanelState('graphMeta');
  const [timelineOpen, setTimelineOpen] = usePanelState('timeline');
  const [undoHistoryOpen, setUndoHistoryOpen] = usePanelState('undoHistory');
  const [checkpointsOpen, setCheckpointsOpen] = usePanelState('checkpoints');
  const [customNodeEditorNodeId, setCustomNodeEditorNodeId] = useState<string | null>(null);
  const [nodeSearchOpen, setNodeSearchOpen] = usePanelState('nodeSearch');
  const [dependencyGraphOpen, setDependencyGraphOpen] = usePanelState('dependencyGraph');
  const [macroOpen, setMacroOpen] = usePanelState('macro');
  const [helpGuideOpen, setHelpGuideOpen] = usePanelState('helpGuide');
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = usePanelState('keyboardShortcuts');
  const uiScale = useSettingsStore(s => s.uiScale);
  const theme = useSettingsStore(s => s.theme);

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Expose panel openers for SearchPalette
  useEffect(() => {
    const save = () => { modalTriggerRef.current = document.activeElement; };
    window.__openFindReplace = () => { save(); setFindReplaceOpen(true); };
    window.__openValidation = () => { save(); setValidationOpen(true); };
    window.__openProfiling = () => { save(); setProfilingOpen(true); };
    window.__openSettings = () => { save(); setSettingsOpen(true); };
    window.__openDebug = () => { save(); setDebugOpen(true); };
    window.__openGraphMeta = () => { save(); setGraphMetaOpen(true); };
    window.__openTimeline = () => { save(); setTimelineOpen(true); };
    window.__openUndoHistory = () => { save(); setUndoHistoryOpen(true); };
    window.__openCheckpoints = () => { save(); setCheckpointsOpen(true); };
    window.__openCustomNodeEditor = (nodeId: string) => { save(); setCustomNodeEditorNodeId(nodeId); };
    window.__toggleMinimap = () => { const ss = useSettingsStore.getState(); ss.setMinimapVisible(!ss.minimapVisible); };
    window.__toggleInspector = () => { const ss = useSettingsStore.getState(); ss.setInspectorVisible(!ss.inspectorVisible); };
    window.__toggleGrid = () => { const ss = useSettingsStore.getState(); ss.setGridVisible(!ss.gridVisible); };
    window.__openNodeSearch = () => { save(); setNodeSearchOpen(true); };
    window.__openDependencyGraph = () => { save(); setDependencyGraphOpen(true); };
    window.__openMacroPanel = () => { save(); setMacroOpen(true); };
    window.__openHelpGuide = () => { save(); setHelpGuideOpen(true); };
    window.__openKeyboardShortcuts = () => { save(); setKeyboardShortcutsOpen(true); };
    window.__applyWorkspacePreset = (openPanels, minimapVisible, inspectorVisible) => {
      const ss = useSettingsStore.getState();
      ss.setMinimapVisible(minimapVisible);
      ss.setInspectorVisible(inspectorVisible);
      // Map panel names to their setters
      const panelMap: Record<string, (open: boolean) => void> = {
        debug: setDebugOpen,
        profiling: setProfilingOpen,
        timeline: setTimelineOpen,
        undoHistory: setUndoHistoryOpen,
        validation: setValidationOpen,
        findReplace: setFindReplaceOpen,
        settings: setSettingsOpen,
        graphMeta: setGraphMetaOpen,
        checkpoints: setCheckpointsOpen,
        nodeSearch: setNodeSearchOpen,
        dependencyGraph: setDependencyGraphOpen,
        macro: setMacroOpen,
        helpGuide: setHelpGuideOpen,
        keyboardShortcuts: setKeyboardShortcutsOpen,
      };
      for (const [name, setter] of Object.entries(panelMap)) {
        setter(openPanels.includes(name));
      }
    };
    return () => { window.__openFindReplace = undefined; window.__openValidation = undefined; window.__openProfiling = undefined; window.__openSettings = undefined; window.__openDebug = undefined; window.__openGraphMeta = undefined; window.__openTimeline = undefined; window.__openUndoHistory = undefined; window.__openCheckpoints = undefined; window.__openCustomNodeEditor = undefined; window.__toggleMinimap = undefined; window.__toggleInspector = undefined; window.__toggleGrid = undefined; window.__openNodeSearch = undefined; window.__openDependencyGraph = undefined; window.__openMacroPanel = undefined; window.__openHelpGuide = undefined; window.__openKeyboardShortcuts = undefined; window.__applyWorkspacePreset = undefined; };
  }, []);

  // Load persisted graph from IndexedDB (async) or seed demo nodes
  useEffect(() => {
    const store = useEditorStore.getState();
    store.loadFromStorageAsync().then((loaded) => {
      if (!loaded) {
        store.addNode('source', [0, 0, 0]);
        store.addNode('transform', [3, 0, 0]);
        store.addNode('filter', [6, 0, 0]);
        store.addNode('output', [9, 0, 0]);
      }
    });
  }, []);

  // Track last missed-click time for double-click detection on empty canvas
  const lastMissedClickRef = useRef(0);
  // World position for placing new node from double-click
  const searchPlaceAtRef = useRef<[number, number, number] | null>(null);

  const handleMissedClick = (event: MouseEvent) => {
    // Only deselect for clicks that originated on the canvas element itself.
    // Clicks on Html overlays (NodeScreen, etc.) bubble to the R3F container
    // but should not trigger deselection.
    if (!(event.target instanceof HTMLCanvasElement)) return;

    const state = useEditorStore.getState();
    if (state.interaction === 'drawing-connection' && state.pendingConnection) {
      const { sourceNodeId, sourcePortIndex } = state.pendingConnection;
      // Open ContextMenu with port-release target (filtered by compatible port types)
      state.openContextMenu({
        x: event.clientX,
        y: event.clientY,
        target: { kind: 'port-release', sourceNodeId, sourcePortIndex },
      });
      state.cancelConnection();
      lastMissedClickRef.current = 0;
      return;
    }

    // Double-click on empty canvas: open SearchPalette at click position (ComfyUI-style)
    const now = Date.now();
    if (now - lastMissedClickRef.current < 400) {
      // Convert screen click to world XZ position for node placement
      const canvas = event.target as HTMLCanvasElement;
      const wp = getXZFromScreen(event.clientX, event.clientY, canvas);
      searchPlaceAtRef.current = wp ? [wp[0], 0, wp[1]] : null;
      setSearchOpen(true);
      lastMissedClickRef.current = 0;
      return;
    }
    lastMissedClickRef.current = now;

    setSelection(new Set());
    cancelConnection();
    // Safety: if interaction is somehow stuck, reset it on canvas click
    if (state.interaction !== 'idle') {
      state.setInteraction('idle');
      // cursor reset handled by setInteraction('idle')
    }
  };

  // Track which element had focus before a modal opened, so we can restore it on close
  const modalTriggerRef = useRef<Element | null>(null);
  const saveTrigger = useCallback(() => { modalTriggerRef.current = document.activeElement; }, []);
  const restoreTrigger = useCallback(() => {
    const el = modalTriggerRef.current;
    if (el && typeof (el as HTMLElement).focus === 'function') {
      (el as HTMLElement).focus();
    }
    modalTriggerRef.current = null;
  }, []);

  const toggleSearch = useCallback(() => {
    searchPlaceAtRef.current = null; // Clear position when opening via keyboard
    saveTrigger();
    setSearchOpen(v => !v);
  }, [saveTrigger]);
  const closeSearch = useCallback(() => {
    searchPlaceAtRef.current = null;
    setSearchOpen(false);
    restoreTrigger();
  }, [restoreTrigger]);
  const closeFindReplace = useCallback(() => { setFindReplaceOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeValidation = useCallback(() => { setValidationOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeProfiling = useCallback(() => { setProfilingOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeSettings = useCallback(() => { setSettingsOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeDebug = useCallback(() => { setDebugOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeGraphMeta = useCallback(() => { setGraphMetaOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeTimeline = useCallback(() => { setTimelineOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeUndoHistory = useCallback(() => { setUndoHistoryOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeCheckpoints = useCallback(() => { setCheckpointsOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeCustomNodeEditor = useCallback(() => { setCustomNodeEditorNodeId(null); restoreTrigger(); }, [restoreTrigger]);

  const closeNodeSearch = useCallback(() => { setNodeSearchOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeDependencyGraph = useCallback(() => { setDependencyGraphOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeMacro = useCallback(() => { setMacroOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeHelpGuide = useCallback(() => { setHelpGuideOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const closeKeyboardShortcuts = useCallback(() => { setKeyboardShortcutsOpen(false); restoreTrigger(); }, [restoreTrigger]);
  const toggleNodeSearch = useCallback(() => { saveTrigger(); setNodeSearchOpen(v => !v); }, [saveTrigger]);
  const toggleFindReplace = useCallback(() => { saveTrigger(); setFindReplaceOpen(v => !v); }, [saveTrigger]);
  const toggleValidation = useCallback(() => { saveTrigger(); setValidationOpen(v => !v); }, [saveTrigger]);
  const toggleSettings = useCallback(() => { saveTrigger(); setSettingsOpen(v => !v); }, [saveTrigger]);
  const toggleDebug = useCallback(() => { saveTrigger(); setDebugOpen(v => !v); }, [saveTrigger]);
  const toggleProfiling = useCallback(() => { saveTrigger(); setProfilingOpen(v => !v); }, [saveTrigger]);

  // Global keyboard shortcut handler (extracted to hook for modularity)
  useKeyboardShortcuts({
    toggleSearch,
    toggleFindReplace,
    toggleValidation,
    toggleSettings,
    toggleDebug,
    toggleProfiling,
    toggleNodeSearch,
    closeContextMenu,
  });

  // Safety net: reset interaction state on window blur — prevents stuck
  // drag/selection when the user switches tabs or clicks outside the browser.
  // Note: useNodeDrag handles its own blur cleanup (releases pointer capture,
  // resets drag state). This handler catches any remaining stale state.
  useEffect(() => {
    const handleBlur = () => {
      const state = useEditorStore.getState();
      if (state.interaction !== 'idle') {
        state.setInteraction('idle');
        // cursor reset handled by setInteraction('idle')
      }
      // Cancel pending connection to prevent dangling pipe on refocus
      if (state.pendingConnection) {
        state.cancelConnection();
      }
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  // Suppress browser context menu and show custom context menu
  // Only show if right-click was stationary (not a camera pan drag)
  useEffect(() => {
    let rightDragged = false;
    let rightDown = false;
    const DRAG_THRESHOLD_SQ = 400; // 20px — generous to prevent accidental context menu suppression
    let startX = 0, startY = 0;

    const onDown = (e: MouseEvent) => {
      if (e.button === 2) {
        rightDown = true;
        rightDragged = false;
        startX = e.clientX;
        startY = e.clientY;
      }
    };

    const onMove = (e: MouseEvent) => {
      if (rightDown && !rightDragged) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
          rightDragged = true;
        }
      }
    };

    const onUp = (e: MouseEvent) => {
      if (e.button === 2) rightDown = false;
    };

    const handler = (e: MouseEvent) => {
      e.preventDefault();
      // If right-click was dragged (panning camera), don't show menu
      if (rightDragged) {
        rightDragged = false;
        return;
      }
      // Only show canvas context menu on empty space (not on UI panels)
      if (isOnUIPanel(e.target)) return;
      openContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'canvas' } });
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('contextmenu', handler);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('contextmenu', handler);
    };
  }, [openContextMenu]);


  return (
    <>
      <ErrorBoundary label="3D Scene">
        <Canvas
          frameloop="demand"
          camera={{ position: [5, 6, 8], fov: 40 }}
          gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
          onPointerMissed={handleMissedClick}
          style={{ width: '100%', height: '100%', touchAction: 'none' }}
          role="application"
          aria-label="Node editor canvas — use Tab to navigate nodes, arrow keys to move, Alt+arrows to traverse connections"
        >
          <SceneSetup />
          <PostProcessing />
          <NodeGraph />
          <ConnectionGraph />
          <GridFloor />
          <SnapGuides />
          <AlignmentGuides />
          <DragFeedback />
          <ZoomToFit />
          <CameraProvider />
        </Canvas>
      </ErrorBoundary>
      <ErrorBoundary label="UI Panels">
        <div data-ui-panel style={uiScale !== 1 ? { zoom: uiScale } : undefined}>
          <WorkspaceTabBar />
          <GraphTabBar />
          <BreadcrumbNav />
          <Toolbar />
          <ExecuteBar />
          <Inspector />
          <StatusBar />
          <PanelToggleBar />
          <HelpOverlay />
          <BoxSelection />
          <Minimap />
          <ContextMenu />
          <SearchPalette open={searchOpen} onClose={closeSearch} placeAt={searchPlaceAtRef.current} />
          <ValidationPanel open={validationOpen} onClose={closeValidation} />
          <ProfilingPanel open={profilingOpen} onClose={closeProfiling} />
          <Suspense fallback={null}>
            {findReplaceOpen && <FindReplacePanel open={findReplaceOpen} onClose={closeFindReplace} />}
            {settingsOpen && <SettingsPanel open={settingsOpen} onClose={closeSettings} />}
            {debugOpen && <DebugPanel open={debugOpen} onClose={closeDebug} />}
            {timelineOpen && <TimelinePanel open={timelineOpen} onClose={closeTimeline} />}
            {undoHistoryOpen && <UndoHistoryPanel open={undoHistoryOpen} onClose={closeUndoHistory} />}
            {graphMetaOpen && <GraphMetadataPanel open={graphMetaOpen} onClose={closeGraphMeta} />}
            {checkpointsOpen && <CheckpointPanel open={checkpointsOpen} onClose={closeCheckpoints} />}
            {customNodeEditorNodeId && <CustomNodeEditorPanel open={customNodeEditorNodeId !== null} onClose={closeCustomNodeEditor} nodeId={customNodeEditorNodeId} />}
            {nodeSearchOpen && <NodeSearchPanel open={nodeSearchOpen} onClose={closeNodeSearch} />}
            {dependencyGraphOpen && <DependencyGraphPanel open={dependencyGraphOpen} onClose={closeDependencyGraph} />}
            {macroOpen && <MacroPanel onClose={closeMacro} />}
            {helpGuideOpen && <HelpGuidePanel open={helpGuideOpen} onClose={closeHelpGuide} />}
            {keyboardShortcutsOpen && <KeyboardShortcutsPanel open={keyboardShortcutsOpen} onClose={closeKeyboardShortcuts} />}
          </Suspense>
          <TemplateLibrary />
          <UndoToast />
          <StorageWarningToast />
          <ScreenReaderAnnouncer />
          <OnboardingTooltips />
        </div>
      </ErrorBoundary>
      <FileDropZone />
    </>
  );
}

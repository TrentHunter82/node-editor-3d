import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// --- Types ---

export type Theme = 'dark' | 'light';
export type ConnectionStyle = 'bezier' | 'straight' | 'right-angle' | 'organic';
export type LayoutMode = 'layered' | 'force';

/** Named workspace layout preset */
export interface WorkspacePreset {
  id: string;
  name: string;
  minimapVisible: boolean;
  inspectorVisible: boolean;
  /** Panel names that should be open */
  openPanels: string[];
}

/** Built-in workspace layout presets */
export const BUILTIN_PRESETS: WorkspacePreset[] = [
  { id: 'minimal', name: 'Minimal', minimapVisible: false, inspectorVisible: false, openPanels: [] },
  { id: 'debug', name: 'Debug', minimapVisible: true, inspectorVisible: false, openPanels: ['debug', 'profiling', 'timeline'] },
  { id: 'edit', name: 'Edit', minimapVisible: true, inspectorVisible: true, openPanels: ['undoHistory'] },
  { id: 'full', name: 'Full', minimapVisible: true, inspectorVisible: true, openPanels: ['debug', 'profiling', 'timeline', 'undoHistory', 'validation'] },
];

export interface CameraBookmark {
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * Keyboard shortcut override record.
 * Keys are action IDs (e.g., 'undo', 'redo', 'delete').
 * Values are key combo strings (e.g., 'ctrl+z', 'shift+d', 'f').
 * Only overridden shortcuts are stored; defaults are in useKeyboardShortcuts.
 */
export type KeyBindingOverrides = Record<string, string>;

/** Recorded keyboard macro definition */
export interface MacroDef {
  id: string;
  name: string;
  /** Array of action IDs from SHORTCUT_DEFS to replay */
  actions: string[];
  /** Playback delay between actions in ms */
  delayMs: number;
}

export interface NodePreset {
  id: string;
  name: string;
  nodeType: string;
  data: Record<string, unknown>;
}

export interface SettingsState {
  // Grid
  gridSnapSize: number;
  gridVisible: boolean;
  // Animation
  animationSpeed: number;
  // UI
  uiScale: number;
  theme: Theme;
  minimapVisible: boolean;
  inspectorVisible: boolean;
  // Camera
  zoomSensitivity: number;
  panSpeed: number;
  rotateSpeed: number;
  cameraDamping: number;
  /** How long (in seconds) damping animation continues after user stops interacting */
  dampingDuration: number;
  // Connections
  connectionStyle: ConnectionStyle;
  // Execution
  autoExecute: boolean;
  /** When true, re-execute the graph on an interval — drives `timer`/`http-fetch`
   * live data without manual Runs (dashboards, generative animation). */
  liveMode: boolean;
  /** Interval in ms between Live Mode re-executions (clamped 100–60000). */
  liveIntervalMs: number;
  /** When true, graph execution runs in a Web Worker (off main thread) */
  workerExecution: boolean;
  // Visual
  /** Animated dashes flowing along connections during/after execution */
  connectionFlowAnimation: boolean;
  /** Show execution time heatmap overlay on nodes (green=fast, red=slow) */
  showExecutionHeatmap: boolean;
  /** Show NodeScreen editing panels on all nodes (not just selected). Default: true */
  showNodeScreens: boolean;
  /** Render Bloom/Vignette post-processing (costs ~3-5ms per rendered frame). Default: true */
  postProcessing: boolean;
  /** Which backend remote nodes dispatch to. Default: in-process demo mock. */
  remoteBackend: 'demo' | 'comfyui';
  /** ComfyUI server base URL (used when remoteBackend is 'comfyui'). */
  comfyUrl: string;
  // Persistence
  autoSave: boolean;
  recentFiles: string[];
  recentlyUsedNodes: string[];
  // Camera bookmarks (slots 1-9)
  cameraBookmarks: Record<string, CameraBookmark>;
  // Keyboard shortcut overrides (action ID → key combo)
  keyBindingOverrides: KeyBindingOverrides;
  // Onboarding
  /** Whether the first-launch onboarding tooltips have been completed/dismissed */
  onboardingCompleted: boolean;
  // Node presets (workspace-global, persisted)
  nodePresets: NodePreset[];
  // Custom workspace layout presets (user-saved)
  workspacePresets: WorkspacePreset[];
  /** Currently active workspace preset ID (built-in or custom), null if custom state */
  activeWorkspacePreset: string | null;
  /** Panels that are open by default / persisted open state (e.g. ['validation']) */
  openPanels: string[];
  // Minimap size (persisted)
  minimapWidth: number;
  minimapHeight: number;
  // Keyboard macros
  macros: MacroDef[];
  // Pinned/favorite node types (shown at top of search palette and quick node menu)
  pinnedNodeTypes: string[];
  // Toolbar section collapsed state (section names that are collapsed)
  toolbarCollapsedSections: string[];
  // Graph overview mode (bird's-eye view with simplified node rendering)
  overviewMode: boolean;
  /** Maximum execution time in ms (0 = unlimited). Default: 30000 (30s) */
  maxExecutionMs: number;
  /** Layout algorithm mode for auto-layout */
  layoutMode: LayoutMode;
  /** Whether the left sidebar toolbar is visible (toggle with T key) */
  toolbarVisible: boolean;

  // Actions
  setGridSnapSize: (size: number) => void;
  setGridVisible: (visible: boolean) => void;
  setAnimationSpeed: (speed: number) => void;
  setUiScale: (scale: number) => void;
  setTheme: (theme: Theme) => void;
  setMinimapVisible: (visible: boolean) => void;
  setInspectorVisible: (visible: boolean) => void;
  setZoomSensitivity: (sensitivity: number) => void;
  setPanSpeed: (speed: number) => void;
  setRotateSpeed: (speed: number) => void;
  setCameraDamping: (damping: number) => void;
  setDampingDuration: (duration: number) => void;
  setConnectionStyle: (style: ConnectionStyle) => void;
  setAutoExecute: (enabled: boolean) => void;
  setLiveMode: (enabled: boolean) => void;
  setLiveIntervalMs: (ms: number) => void;
  setWorkerExecution: (enabled: boolean) => void;
  setConnectionFlowAnimation: (enabled: boolean) => void;
  setShowExecutionHeatmap: (enabled: boolean) => void;
  setShowNodeScreens: (enabled: boolean) => void;
  setPostProcessing: (enabled: boolean) => void;
  setRemoteBackend: (backend: 'demo' | 'comfyui') => void;
  setComfyUrl: (url: string) => void;
  setAutoSave: (enabled: boolean) => void;
  addRecentFile: (path: string) => void;
  clearRecentFiles: () => void;
  addRecentlyUsedNode: (type: string) => void;
  setCameraBookmark: (slot: number, bookmark: CameraBookmark) => void;
  clearCameraBookmark: (slot: number) => void;
  setKeyBinding: (actionId: string, keyCombo: string) => void;
  resetKeyBinding: (actionId: string) => void;
  resetAllKeyBindings: () => void;
  setOnboardingCompleted: (completed: boolean) => void;
  saveNodePreset: (preset: Omit<NodePreset, 'id'>) => string;
  applyNodePreset: (presetId: string) => NodePreset | undefined;
  deleteNodePreset: (presetId: string) => void;
  // Workspace layout presets
  saveWorkspacePreset: (name: string, openPanels: string[]) => string;
  deleteWorkspacePreset: (presetId: string) => void;
  setActiveWorkspacePreset: (presetId: string | null) => void;
  setPanelOpen: (panelId: string, open: boolean) => void;
  resetPanelLayout: () => void;
  setMinimapSize: (w: number, h: number) => void;
  // Macro actions
  saveMacro: (macro: Omit<MacroDef, 'id'>) => string;
  deleteMacro: (macroId: string) => void;
  updateMacro: (macroId: string, updates: Partial<Omit<MacroDef, 'id'>>) => void;
  pinNodeType: (type: string) => void;
  unpinNodeType: (type: string) => void;
  setToolbarCollapsedSections: (sections: string[]) => void;
  toggleToolbarSection: (section: string) => void;
  setOverviewMode: (enabled: boolean) => void;
  toggleOverviewMode: () => void;
  setMaxExecutionMs: (ms: number) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setToolbarVisible: (visible: boolean) => void;
  toggleToolbarVisible: () => void;
  resetToDefaults: () => void;
}

// --- Defaults ---

const STORAGE_KEY = 'settings-v1';
const MAX_RECENT_FILES = 10;
const MAX_RECENT_NODES = 8;

export const DEFAULT_SETTINGS = {
  gridSnapSize: 1,
  gridVisible: true,
  animationSpeed: 1,
  uiScale: 1,
  theme: 'dark' as Theme,
  minimapVisible: true,
  inspectorVisible: true,
  zoomSensitivity: 0.3,
  panSpeed: 0.8,
  rotateSpeed: 0.6,
  cameraDamping: 0.06,
  dampingDuration: 0.15,
  connectionStyle: 'bezier' as ConnectionStyle,
  autoExecute: false,
  liveMode: false,
  liveIntervalMs: 1000,
  workerExecution: false,
  connectionFlowAnimation: true,
  showExecutionHeatmap: false,
  showNodeScreens: true,
  postProcessing: true,
  remoteBackend: 'demo' as 'demo' | 'comfyui',
  comfyUrl: 'http://127.0.0.1:8188',
  autoSave: true,
  recentFiles: [] as string[],
  recentlyUsedNodes: [] as string[],
  cameraBookmarks: {} as Record<string, CameraBookmark>,
  keyBindingOverrides: {} as KeyBindingOverrides,
  onboardingCompleted: false,
  nodePresets: [] as NodePreset[],
  workspacePresets: [] as WorkspacePreset[],
  activeWorkspacePreset: null as string | null,
  openPanels: ['validation', 'profiling'] as string[],
  minimapWidth: 180,
  minimapHeight: 140,
  macros: [] as MacroDef[],
  pinnedNodeTypes: [] as string[],
  toolbarCollapsedSections: ['addnode', 'file', 'edit', 'view', 'layout', 'display', 'subgraph', 'custom', 'bookmarks'] as string[],
  overviewMode: false,
  maxExecutionMs: 30000,
  layoutMode: 'layered' as LayoutMode,
  toolbarVisible: true,
};

// --- Persistence ---

export function clampLoadedSettings(s: Record<string, unknown>): Partial<typeof DEFAULT_SETTINGS> {
  const out = { ...s } as Record<string, unknown>;
  // Clamp numeric settings to their valid ranges (same as setters)
  if (typeof out.gridSnapSize === 'number')    out.gridSnapSize    = Math.max(0.1, Math.min(100, out.gridSnapSize as number));
  if (typeof out.animationSpeed === 'number')  out.animationSpeed  = Math.max(0, Math.min(3, out.animationSpeed as number));
  if (typeof out.uiScale === 'number')         out.uiScale         = Math.max(0.5, Math.min(2, out.uiScale as number));
  if (typeof out.zoomSensitivity === 'number') out.zoomSensitivity = Math.max(0.1, Math.min(3, out.zoomSensitivity as number));
  if (typeof out.panSpeed === 'number')        out.panSpeed        = Math.max(0.1, Math.min(3, out.panSpeed as number));
  if (typeof out.rotateSpeed === 'number')     out.rotateSpeed     = Math.max(0.1, Math.min(3, out.rotateSpeed as number));
  if (typeof out.cameraDamping === 'number')   out.cameraDamping   = Math.max(0.01, Math.min(0.2, out.cameraDamping as number));
  if (typeof out.dampingDuration === 'number') out.dampingDuration = Math.max(0.1, Math.min(0.5, out.dampingDuration as number));
  if (typeof out.maxExecutionMs === 'number') out.maxExecutionMs  = Math.max(0, Math.min(300000, out.maxExecutionMs as number));
  if (typeof out.liveIntervalMs === 'number') out.liveIntervalMs = Math.max(100, Math.min(60000, out.liveIntervalMs as number));
  // Validate boolean fields — reject non-boolean values from corrupt localStorage
  const booleanFields = ['gridVisible', 'autoExecute', 'liveMode', 'workerExecution', 'connectionFlowAnimation',
    'showExecutionHeatmap', 'showNodeScreens', 'autoSave', 'onboardingCompleted',
    'minimapVisible', 'inspectorVisible', 'overviewMode', 'toolbarVisible'] as const;
  for (const key of booleanFields) {
    if (key in out && typeof out[key] !== 'boolean') delete out[key];
  }
  // Validate enums and arrays
  if (out.theme !== 'dark' && out.theme !== 'light') delete out.theme;
  if (out.connectionStyle !== 'bezier' && out.connectionStyle !== 'straight' && out.connectionStyle !== 'right-angle' && out.connectionStyle !== 'organic') delete out.connectionStyle;
  if (out.layoutMode !== 'layered' && out.layoutMode !== 'force') delete out.layoutMode;
  if (!Array.isArray(out.recentFiles) || !(out.recentFiles as unknown[]).every(f => typeof f === 'string')) out.recentFiles = [];
  if (!Array.isArray(out.recentlyUsedNodes) || !(out.recentlyUsedNodes as unknown[]).every(f => typeof f === 'string')) out.recentlyUsedNodes = [];
  // Validate cameraBookmarks as Record<string, { position: [...], target: [...] }>
  if (typeof out.cameraBookmarks !== 'object' || out.cameraBookmarks === null || Array.isArray(out.cameraBookmarks)) {
    out.cameraBookmarks = {};
  } else {
    const bm = out.cameraBookmarks as Record<string, unknown>;
    for (const key of Object.keys(bm)) {
      const v = bm[key] as { position?: unknown; target?: unknown } | null;
      if (!v || !Array.isArray(v.position) || v.position.length !== 3 || !Array.isArray(v.target) || v.target.length !== 3) {
        delete bm[key];
      }
    }
  }
  // Validate keyBindingOverrides as Record<string, string>
  if (typeof out.keyBindingOverrides !== 'object' || out.keyBindingOverrides === null || Array.isArray(out.keyBindingOverrides)) {
    out.keyBindingOverrides = {};
  } else {
    const kb = out.keyBindingOverrides as Record<string, unknown>;
    for (const key of Object.keys(kb)) {
      if (typeof kb[key] !== 'string') {
        delete kb[key];
      }
    }
  }
  // Validate nodePresets as array of { id, name, nodeType, data }
  if (!Array.isArray(out.nodePresets)) {
    out.nodePresets = [];
  } else {
    out.nodePresets = (out.nodePresets as unknown[]).filter((p): p is NodePreset => {
      if (typeof p !== 'object' || p === null || Array.isArray(p)) return false;
      const preset = p as Record<string, unknown>;
      return typeof preset.id === 'string' && typeof preset.name === 'string' &&
        typeof preset.nodeType === 'string' && typeof preset.data === 'object' && preset.data !== null;
    });
  }
  // Validate workspacePresets
  if (!Array.isArray(out.workspacePresets)) {
    out.workspacePresets = [];
  } else {
    out.workspacePresets = (out.workspacePresets as unknown[]).filter((p): p is WorkspacePreset => {
      if (typeof p !== 'object' || p === null || Array.isArray(p)) return false;
      const preset = p as Record<string, unknown>;
      return typeof preset.id === 'string' && typeof preset.name === 'string' &&
        typeof preset.minimapVisible === 'boolean' && typeof preset.inspectorVisible === 'boolean' &&
        Array.isArray(preset.openPanels);
    });
  }
  // Validate openPanels as string[]
  if (!Array.isArray(out.openPanels) || !(out.openPanels as unknown[]).every(f => typeof f === 'string')) {
    out.openPanels = DEFAULT_SETTINGS.openPanels;
  }
  // Validate minimap size
  if (typeof out.minimapWidth === 'number') out.minimapWidth = Math.max(120, Math.min(400, out.minimapWidth as number));
  if (typeof out.minimapHeight === 'number') out.minimapHeight = Math.max(100, Math.min(350, out.minimapHeight as number));
  // Validate macros
  if (!Array.isArray(out.macros)) {
    out.macros = [];
  } else {
    out.macros = (out.macros as unknown[]).filter((m): m is MacroDef => {
      if (typeof m !== 'object' || m === null || Array.isArray(m)) return false;
      const macro = m as Record<string, unknown>;
      return typeof macro.id === 'string' && typeof macro.name === 'string' &&
        Array.isArray(macro.actions) && (macro.actions as unknown[]).every(a => typeof a === 'string') &&
        typeof macro.delayMs === 'number' && isFinite(macro.delayMs as number) && (macro.delayMs as number) >= 0;
    });
  }
  // Validate pinnedNodeTypes as string[]
  if (!Array.isArray(out.pinnedNodeTypes) || !(out.pinnedNodeTypes as unknown[]).every(f => typeof f === 'string')) {
    out.pinnedNodeTypes = [];
  } else {
    // Cap at 10 pinned types
    out.pinnedNodeTypes = (out.pinnedNodeTypes as string[]).slice(0, 10);
  }
  // Validate toolbarCollapsedSections as string[]
  if (!Array.isArray(out.toolbarCollapsedSections) || !(out.toolbarCollapsedSections as unknown[]).every(f => typeof f === 'string')) {
    out.toolbarCollapsedSections = DEFAULT_SETTINGS.toolbarCollapsedSections;
  }
  if (typeof out.activeWorkspacePreset === 'string') {
    const builtinIds = BUILTIN_PRESETS.map(p => p.id);
    const customIds = (out.workspacePresets as WorkspacePreset[]).map(p => p.id);
    if (![...builtinIds, ...customIds].includes(out.activeWorkspacePreset)) {
      out.activeWorkspacePreset = null;
    }
  } else {
    out.activeWorkspacePreset = null;
  }
  return out as Partial<typeof DEFAULT_SETTINGS>;
}

function loadSettings(): Partial<typeof DEFAULT_SETTINGS> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return clampLoadedSettings(parsed);
  } catch {
    return {};
  }
}

function saveSettings(state: typeof DEFAULT_SETTINGS & { keyBindingOverrides: KeyBindingOverrides; onboardingCompleted: boolean }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

// --- Store ---

export const useSettingsStore = create<SettingsState>()(
  immer((set, get) => {
    const saved = loadSettings();
    return {
      ...DEFAULT_SETTINGS,
      ...saved,

      setGridSnapSize: (size) => {
        set(s => { s.gridSnapSize = Math.max(0.1, Math.min(100, size)); });
      },
      setGridVisible: (visible) => {
        set(s => { s.gridVisible = visible; });
      },
      setAnimationSpeed: (speed) => {
        set(s => { s.animationSpeed = Math.max(0, Math.min(3, speed)); });
      },
      setUiScale: (scale) => {
        set(s => { s.uiScale = Math.max(0.5, Math.min(2, scale)); });
      },
      setTheme: (theme) => {
        set(s => { s.theme = theme; });
      },
      setMinimapVisible: (visible) => {
        set(s => { s.minimapVisible = visible; });
      },
      setInspectorVisible: (visible) => {
        set(s => { s.inspectorVisible = visible; });
      },
      setZoomSensitivity: (sensitivity) => {
        set(s => { s.zoomSensitivity = Math.max(0.1, Math.min(3, sensitivity)); });
      },
      setPanSpeed: (speed) => {
        set(s => { s.panSpeed = Math.max(0.1, Math.min(3, speed)); });
      },
      setRotateSpeed: (speed) => {
        set(s => { s.rotateSpeed = Math.max(0.1, Math.min(3, speed)); });
      },
      setCameraDamping: (damping) => {
        set(s => { s.cameraDamping = Math.max(0.01, Math.min(0.2, damping)); });
      },
      setDampingDuration: (duration) => {
        set(s => { s.dampingDuration = Math.max(0.1, Math.min(0.5, duration)); });
      },
      setConnectionStyle: (style) => {
        set(s => { s.connectionStyle = style; });
      },
      setAutoExecute: (enabled) => {
        set(s => { s.autoExecute = enabled; });
      },
      setLiveMode: (enabled) => {
        set(s => { s.liveMode = enabled; });
      },
      setLiveIntervalMs: (ms) => {
        set(s => { s.liveIntervalMs = Math.max(100, Math.min(60000, ms)); });
      },
      setWorkerExecution: (enabled) => {
        set(s => { s.workerExecution = enabled; });
      },
      setConnectionFlowAnimation: (enabled) => {
        set(s => { s.connectionFlowAnimation = enabled; });
      },
      setShowExecutionHeatmap: (enabled) => {
        set(s => { s.showExecutionHeatmap = enabled; });
      },
      setShowNodeScreens: (enabled) => {
        set(s => { s.showNodeScreens = enabled; });
      },
      setPostProcessing: (enabled) => {
        set(s => { s.postProcessing = enabled; });
      },
      setRemoteBackend: (backend) => {
        set(s => { s.remoteBackend = backend; });
      },
      setComfyUrl: (url) => {
        set(s => { s.comfyUrl = url; });
      },
      setAutoSave: (enabled) => {
        set(s => { s.autoSave = enabled; });
      },
      addRecentFile: (path) => {
        set(s => {
          // Remove if already present, then add to front
          s.recentFiles = s.recentFiles.filter(f => f !== path);
          s.recentFiles.unshift(path);
          // Cap at max
          if (s.recentFiles.length > MAX_RECENT_FILES) {
            s.recentFiles = s.recentFiles.slice(0, MAX_RECENT_FILES);
          }
        });
      },
      clearRecentFiles: () => {
        set(s => { s.recentFiles = []; });
      },
      addRecentlyUsedNode: (type) => {
        set(s => {
          s.recentlyUsedNodes = s.recentlyUsedNodes.filter(t => t !== type);
          s.recentlyUsedNodes.unshift(type);
          if (s.recentlyUsedNodes.length > MAX_RECENT_NODES) {
            s.recentlyUsedNodes = s.recentlyUsedNodes.slice(0, MAX_RECENT_NODES);
          }
        });
      },
      setCameraBookmark: (slot, bookmark) => {
        if (slot < 1 || slot > 9) return;
        set(s => { s.cameraBookmarks[String(slot)] = bookmark; });
      },
      clearCameraBookmark: (slot) => {
        if (slot < 1 || slot > 9) return;
        set(s => { delete s.cameraBookmarks[String(slot)]; });
      },
      setKeyBinding: (actionId, keyCombo) => {
        set(s => { s.keyBindingOverrides[actionId] = keyCombo; });
      },
      resetKeyBinding: (actionId) => {
        set(s => { delete s.keyBindingOverrides[actionId]; });
      },
      resetAllKeyBindings: () => {
        set(s => { s.keyBindingOverrides = {}; });
      },
      setOnboardingCompleted: (completed) => {
        set(s => { s.onboardingCompleted = completed; });
      },
      saveNodePreset: (preset) => {
        const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        set(s => {
          s.nodePresets.push({ ...preset, id });
        });
        return id;
      },
      applyNodePreset: (presetId) => {
        return get().nodePresets.find(p => p.id === presetId);
      },
      deleteNodePreset: (presetId) => {
        set(s => {
          s.nodePresets = s.nodePresets.filter(p => p.id !== presetId);
        });
      },
      saveWorkspacePreset: (name, openPanels) => {
        const state = get();
        const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        set(s => {
          s.workspacePresets.push({
            id,
            name,
            minimapVisible: state.minimapVisible,
            inspectorVisible: state.inspectorVisible,
            openPanels,
          });
        });
        return id;
      },
      deleteWorkspacePreset: (presetId) => {
        set(s => {
          s.workspacePresets = s.workspacePresets.filter(p => p.id !== presetId);
          if (s.activeWorkspacePreset === presetId) s.activeWorkspacePreset = null;
        });
      },
      setActiveWorkspacePreset: (presetId) => {
        set(s => { s.activeWorkspacePreset = presetId; });
      },
      setPanelOpen: (panelId, open) => {
        set(s => {
          if (open && !s.openPanels.includes(panelId)) {
            s.openPanels.push(panelId);
          } else if (!open) {
            s.openPanels = s.openPanels.filter(p => p !== panelId);
          }
        });
      },
      resetPanelLayout: () => {
        set(s => {
          s.minimapVisible = DEFAULT_SETTINGS.minimapVisible;
          s.inspectorVisible = DEFAULT_SETTINGS.inspectorVisible;
          s.openPanels = [...DEFAULT_SETTINGS.openPanels];
          s.activeWorkspacePreset = null;
        });
      },
      setMinimapSize: (w, h) => {
        set(s => {
          s.minimapWidth = Math.max(120, Math.min(400, w));
          s.minimapHeight = Math.max(100, Math.min(350, h));
        });
      },
      saveMacro: (macro) => {
        const id = `macro-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        set(s => { s.macros.push({ ...macro, id }); });
        return id;
      },
      deleteMacro: (macroId) => {
        set(s => { s.macros = s.macros.filter(m => m.id !== macroId); });
      },
      updateMacro: (macroId, updates) => {
        set(s => {
          const idx = s.macros.findIndex(m => m.id === macroId);
          if (idx >= 0) Object.assign(s.macros[idx], updates);
        });
      },
      pinNodeType: (type) => {
        set(s => {
          if (s.pinnedNodeTypes.includes(type)) return;
          if (s.pinnedNodeTypes.length >= 10) return; // Max 10 pinned
          s.pinnedNodeTypes.push(type);
        });
      },
      unpinNodeType: (type) => {
        set(s => {
          s.pinnedNodeTypes = s.pinnedNodeTypes.filter(t => t !== type);
        });
      },
      setToolbarCollapsedSections: (sections) => {
        set(s => { s.toolbarCollapsedSections = sections; });
      },
      toggleToolbarSection: (section) => {
        set(s => {
          const idx = s.toolbarCollapsedSections.indexOf(section);
          if (idx >= 0) {
            s.toolbarCollapsedSections.splice(idx, 1);
          } else {
            s.toolbarCollapsedSections.push(section);
          }
        });
      },
      setOverviewMode: (enabled) => {
        set(s => { s.overviewMode = enabled; });
      },
      toggleOverviewMode: () => {
        set(s => { s.overviewMode = !s.overviewMode; });
      },
      setMaxExecutionMs: (ms) => {
        set(s => { s.maxExecutionMs = Math.max(0, Math.min(300000, ms)); });
      },
      setLayoutMode: (mode) => {
        set(s => { s.layoutMode = mode; });
      },
      setToolbarVisible: (visible) => {
        set(s => { s.toolbarVisible = visible; });
      },
      toggleToolbarVisible: () => {
        set(s => { s.toolbarVisible = !s.toolbarVisible; });
      },
      resetToDefaults: () => {
        set(s => {
          Object.assign(s, DEFAULT_SETTINGS);
          s.recentFiles = [];
          s.recentlyUsedNodes = [];
          s.keyBindingOverrides = {};
          s.nodePresets = [];
        });
      },
    };
  }),
);

// Auto-save subscriber: persist on change (debounced 200ms)
let _settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
useSettingsStore.subscribe(
  (state) => {
    if (_settingsSaveTimer) clearTimeout(_settingsSaveTimer);
    _settingsSaveTimer = setTimeout(() => {
      _settingsSaveTimer = null;
      saveSettings({
        gridSnapSize: state.gridSnapSize,
        gridVisible: state.gridVisible,
        animationSpeed: state.animationSpeed,
        uiScale: state.uiScale,
        theme: state.theme,
        minimapVisible: state.minimapVisible,
        inspectorVisible: state.inspectorVisible,
        zoomSensitivity: state.zoomSensitivity,
        panSpeed: state.panSpeed,
        rotateSpeed: state.rotateSpeed,
        cameraDamping: state.cameraDamping,
        dampingDuration: state.dampingDuration,
        connectionStyle: state.connectionStyle,
        autoExecute: state.autoExecute,
        liveMode: state.liveMode,
        liveIntervalMs: state.liveIntervalMs,
        workerExecution: state.workerExecution,
        connectionFlowAnimation: state.connectionFlowAnimation,
        showExecutionHeatmap: state.showExecutionHeatmap,
        showNodeScreens: state.showNodeScreens,
        postProcessing: state.postProcessing,
        remoteBackend: state.remoteBackend,
        comfyUrl: state.comfyUrl,
        autoSave: state.autoSave,
        recentFiles: state.recentFiles,
        recentlyUsedNodes: state.recentlyUsedNodes,
        cameraBookmarks: state.cameraBookmarks,
        keyBindingOverrides: state.keyBindingOverrides,
        onboardingCompleted: state.onboardingCompleted,
        nodePresets: state.nodePresets,
        workspacePresets: state.workspacePresets,
        activeWorkspacePreset: state.activeWorkspacePreset,
        openPanels: state.openPanels,
        minimapWidth: state.minimapWidth,
        minimapHeight: state.minimapHeight,
        macros: state.macros,
        pinnedNodeTypes: state.pinnedNodeTypes,
        toolbarCollapsedSections: state.toolbarCollapsedSections,
        overviewMode: state.overviewMode,
        maxExecutionMs: state.maxExecutionMs,
        layoutMode: state.layoutMode,
        toolbarVisible: state.toolbarVisible,
      });
    }, 200);
  },
);

// File System Access API (not yet in standard lib.dom.d.ts)
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  __zoomToFit?: () => void;
  __orbitControls?: import('three-stdlib').OrbitControls;
  __invalidate?: () => void;
  __store?: unknown;
  __openFindReplace?: () => void;
  __openValidation?: () => void;
  __openProfiling?: () => void;
  __openSettings?: () => void;
  __openDebug?: () => void;
  __openGraphMeta?: () => void;
  __openTimeline?: () => void;
  __openUndoHistory?: () => void;
  __openCheckpoints?: () => void;
  __toggleMinimap?: () => void;
  __toggleInspector?: () => void;
  __toggleGrid?: () => void;
  __exportImage?: () => void;
  __exportGraphDocs?: () => void;
  __recallCameraBookmark?: (slot: number) => void;
  __flyToViewPreset?: (preset: 'top' | 'front' | 'right' | 'left' | 'isometric') => void;
  __registerPlugin?: (def: import('./types').PluginNodeDef) => { success: boolean; error?: string };
  __unregisterPlugin?: (type: string) => boolean;
  __openCustomNodeEditor?: (nodeId: string) => void;
  __applyWorkspacePreset?: (openPanels: string[], minimapVisible: boolean, inspectorVisible: boolean) => void;
  __openNodeSearch?: () => void;
  __openDependencyGraph?: () => void;
  __openMacroPanel?: () => void;
  __openHelpGuide?: () => void;
  __openKeyboardShortcuts?: () => void;
  __openNodeHelp?: (nodeType: string) => void;
}

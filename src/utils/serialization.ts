import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { EditorNode, Connection, NodeGroup, CustomNodeDef, GraphData, GraphTab, NodeTemplate, SubgraphNodeDef } from '../types';
import { migrateStorageToCurrent, CURRENT_STORAGE_VERSION } from './storageMigrations';

const STORAGE_KEY = 'node-editor-3d-graph';
const IDB_NAME = 'node-editor-3d';
const IDB_VERSION = 1;
const IDB_STORE = 'workspace';
const IDB_WORKSPACE_KEY = 'current';

/** Legacy single-graph format (Phase 5 and earlier) */
export interface LegacyGraphData {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups?: Record<string, NodeGroup>;
  customNodeDefs?: Record<string, CustomNodeDef>;
  subgraphDefs?: Record<string, SubgraphNodeDef>;
  /** Inner graphs of subgraph nodes (recursively bundled), keyed by graph id */
  innerGraphs?: Record<string, GraphData>;
  /** Tab metadata for the bundled inner graphs */
  innerGraphTabs?: Record<string, GraphTab>;
}

/** Multi-graph storage format (Phase 6+) */
export interface MultiGraphStorage {
  version: 2;
  graphs: Record<string, GraphData>;
  graphTabs: Record<string, GraphTab>;
  activeGraphId: string;
  graphOrder: string[];
  templates: Record<string, NodeTemplate>;
  /** Subgraph definitions per active graph (persisted for restore) */
  subgraphDefs?: Record<string, SubgraphNodeDef>;
}

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(IDB_NAME, IDB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      },
    });
  }
  return dbPromise;
}

/** Reset the cached DB promise (for tests). */
export function _resetIDB(): void {
  dbPromise = null;
}

// ---------------------------------------------------------------------------
// Async IndexedDB API (primary persistence)
// ---------------------------------------------------------------------------

/**
 * Save multi-graph data to IndexedDB. Returns true on success.
 * No storage quota issues (IndexedDB typically has GB-scale limits).
 */
export async function saveMultiGraphAsync(storage: MultiGraphStorage): Promise<boolean> {
  try {
    const db = await getDB();
    await db.put(IDB_STORE, storage, IDB_WORKSPACE_KEY);
    return true;
  } catch (e) {
    console.warn('[node-editor-3d] IndexedDB save failed, falling back to localStorage:', e);
    // Fall back to localStorage
    return saveMultiGraph(storage);
  }
}

/**
 * Load multi-graph data from IndexedDB. Falls back to localStorage if IndexedDB
 * is empty (first-time migration) or unavailable.
 */
export async function loadMultiGraphAsync(): Promise<MultiGraphStorage | null> {
  try {
    const db = await getDB();
    const data = await db.get(IDB_STORE, IDB_WORKSPACE_KEY);
    if (data) {
      return normalizeMultiGraphData(data);
    }
    // IndexedDB is empty — try localStorage for backward compatibility
    const lsResult = loadMultiGraph();
    if (lsResult) {
      // Migrate: save to IndexedDB so future loads use it
      await db.put(IDB_STORE, lsResult, IDB_WORKSPACE_KEY).catch(() => {});
      // Remove from localStorage to reclaim space
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
    return lsResult;
  } catch (e) {
    console.warn('[node-editor-3d] IndexedDB load failed, falling back to localStorage:', e);
    return loadMultiGraph();
  }
}

/**
 * Clear graph data from IndexedDB (and localStorage for completeness).
 */
export async function clearGraphAsync(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(IDB_STORE, IDB_WORKSPACE_KEY);
  } catch { /* ignore */ }
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Synchronous localStorage API (kept for backward compat + tests)
// ---------------------------------------------------------------------------

/** Returns true on success, false if storage quota exceeded or unavailable. */
export function saveMultiGraph(storage: MultiGraphStorage): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalize and validate a raw multi-graph data object.
 * Shared between sync and async load paths. Runs the formal migration
 * chain first (see utils/storageMigrations.ts), then hardens the
 * current-version payload against missing/corrupt fields.
 */
function normalizeMultiGraphData(raw: unknown): MultiGraphStorage | null {
  const outcome = migrateStorageToCurrent(raw);
  if (outcome.error === 'future-version') {
    console.error(
      `[node-editor-3d] Saved workspace is version ${outcome.fromVersion}, but this app only understands up to ${CURRENT_STORAGE_VERSION}. ` +
      'The data was left untouched — update the app to load it.',
    );
    return null;
  }
  if (!outcome.data) return null;
  if (outcome.applied.length > 0) {
    console.info(`[node-editor-3d] Migrated saved workspace: ${outcome.applied.join(' → ')}`);
  }
  const data = outcome.data;

  // Check for v2 multi-graph format
  if (data.version === 2 && isPlainObject(data.graphs) && isPlainObject(data.graphTabs)) {
    // Normalize missing fields to prevent crashes in downstream code
    // Also validate that activeGraphId points to an existing graph — corrupted storage
    // may reference a deleted graph, causing downstream crashes on undefined access
    if (!data.activeGraphId || typeof data.activeGraphId !== 'string' ||
        !(data.activeGraphId in (data.graphs as Record<string, unknown>))) {
      data.activeGraphId = Object.keys(data.graphs as Record<string, unknown>)[0] ?? 'default';
    }
    if (!Array.isArray(data.graphOrder)) {
      // Fall back to graph keys (not graphTabs) since graphTabs may contain entries
      // that don't exist in graphs or vice versa
      data.graphOrder = Object.keys(data.graphs as Record<string, unknown>);
    } else {
      // Filter out stale IDs referencing deleted graphs (e.g. from partial save or corruption)
      const graphKeys = new Set(Object.keys(data.graphs as Record<string, unknown>));
      data.graphOrder = (data.graphOrder as string[]).filter(id => graphKeys.has(id));
      // Ensure all graphs have a graphOrder entry (missing entries from manual edits)
      for (const id of graphKeys) {
        if (!(data.graphOrder as string[]).includes(id)) {
          (data.graphOrder as string[]).push(id);
        }
      }
    }
    if (!isPlainObject(data.templates)) {
      data.templates = {};
    }
    // Normalize per-graph records: ensure each graph has required fields
    const graphs = data.graphs as Record<string, Record<string, unknown>>;
    for (const gId of Object.keys(graphs)) {
      const g = graphs[gId];
      if (!isPlainObject(g)) { delete graphs[gId]; continue; }
      if (!isPlainObject(g.nodes)) g.nodes = {};
      if (!isPlainObject(g.connections)) g.connections = {};
      if (!isPlainObject(g.groups)) g.groups = {};
      if (!isPlainObject(g.customNodeDefs)) g.customNodeDefs = {};
      if (!isPlainObject(g.subgraphDefs)) g.subgraphDefs = {};
      if (g.graphVariables !== undefined && !isPlainObject(g.graphVariables)) g.graphVariables = {};
      if (g.checkpoints !== undefined && !isPlainObject(g.checkpoints)) g.checkpoints = {};
    }
    if (Object.keys(graphs).length === 0) return null;
    return data as unknown as MultiGraphStorage;
  }

  return null;
}

/**
 * Load from localStorage. Handles both legacy (single graph) and new (multi-graph) formats.
 * Returns a normalized MultiGraphStorage in both cases.
 */
export function loadMultiGraph(): MultiGraphStorage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return normalizeMultiGraphData(data);
  } catch (e) {
    console.warn('[node-editor-3d] Failed to load saved graph:', e);
    return null;
  }
}

// --- Legacy API (kept for backward compatibility with tests) ---

export function saveGraph(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
  groups?: Record<string, NodeGroup>,
  customNodeDefs?: Record<string, CustomNodeDef>,
): void {
  const data: LegacyGraphData = { nodes, connections, groups: groups ?? {}, customNodeDefs: customNodeDefs ?? {} };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — ignore silently
  }
}

export function loadGraph(): LegacyGraphData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!isPlainObject(data)) return null;

    // Handle v2 format: return the active graph as legacy format
    if (data.version === 2 && isPlainObject(data.graphs)) {
      const activeId = data.activeGraphId as string;
      const graph = (data.graphs as Record<string, unknown>)[activeId];
      if (isPlainObject(graph) && isPlainObject(graph.nodes) && isPlainObject(graph.connections)) {
        return graph as unknown as LegacyGraphData;
      }
      return null;
    }

    if (!isPlainObject(data.nodes)) return null;
    if (!isPlainObject(data.connections)) return null;
    if (data.groups !== undefined && !isPlainObject(data.groups)) return null;
    if (data.customNodeDefs !== undefined && !isPlainObject(data.customNodeDefs)) return null;
    return data as unknown as LegacyGraphData;
  } catch (e) {
    console.warn('[node-editor-3d] Failed to load legacy graph:', e);
    return null;
  }
}

export function clearGraph(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportToJSON(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
  groups?: Record<string, NodeGroup>,
  customNodeDefs?: Record<string, CustomNodeDef>,
  subgraphDefs?: Record<string, SubgraphNodeDef>,
): void {
  const data: LegacyGraphData = {
    nodes,
    connections,
    groups: groups ?? {},
    customNodeDefs: customNodeDefs ?? {},
    ...(subgraphDefs && Object.keys(subgraphDefs).length > 0 ? { subgraphDefs } : {}),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'node-graph.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importFromJSON(jsonString: string): LegacyGraphData | null {
  try {
    const data = JSON.parse(jsonString);
    if (!isPlainObject(data)) return null;
    if (!isPlainObject(data.nodes)) return null;
    if (!isPlainObject(data.connections)) return null;
    if (data.groups !== undefined && !isPlainObject(data.groups)) return null;
    if (data.customNodeDefs !== undefined && !isPlainObject(data.customNodeDefs)) return null;
    if (data.subgraphDefs !== undefined && !isPlainObject(data.subgraphDefs)) return null;
    if (data.innerGraphs !== undefined) {
      if (!isPlainObject(data.innerGraphs)) return null;
      // Each bundled inner graph must at least be a graph-shaped object
      for (const inner of Object.values(data.innerGraphs)) {
        if (!isPlainObject(inner)) return null;
        if (!isPlainObject(inner.nodes)) return null;
        if (!isPlainObject(inner.connections)) return null;
      }
    }
    if (data.innerGraphTabs !== undefined && !isPlainObject(data.innerGraphTabs)) return null;
    return data as unknown as LegacyGraphData;
  } catch {
    return null;
  }
}

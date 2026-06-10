/**
 * Versioned storage migrations — the formal upgrade path for persisted
 * workspaces (IndexedDB / localStorage / imported files).
 *
 * Before this registry, version handling was ad-hoc: `version === 2` checks
 * inline in serialization.ts and an implicit "looks like a legacy single
 * graph" fallback. That works until the first breaking format change, at
 * which point old saves crash or silently vanish. The registry makes the
 * rules explicit:
 *
 *  - Every saved payload has a detectable version (pre-versioned legacy
 *    single-graph payloads count as v1).
 *  - To change the format: bump CURRENT_STORAGE_VERSION and register one
 *    migration step from the previous version. Chains compose (1→2→3…).
 *  - Loading data from a NEWER app version fails loudly (and leaves the
 *    stored bytes untouched) instead of silently dropping the workspace.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export const CURRENT_STORAGE_VERSION = 2;

export interface StorageMigration {
  from: number;
  to: number;
  description: string;
  migrate: (data: Record<string, unknown>) => Record<string, unknown>;
}

/** Registered upgrade steps, each from version N to N+1. */
export const STORAGE_MIGRATIONS: StorageMigration[] = [
  {
    from: 1,
    to: 2,
    description: 'Wrap legacy single-graph payload into multi-graph storage',
    migrate: (legacy) => {
      const graphId = 'default';
      return {
        version: 2,
        graphs: {
          [graphId]: {
            nodes: legacy.nodes,
            connections: legacy.connections,
            groups: legacy.groups ?? {},
            customNodeDefs: legacy.customNodeDefs ?? {},
            subgraphDefs: legacy.subgraphDefs ?? {},
          },
        },
        graphTabs: {
          [graphId]: { id: graphId, name: 'Main', createdAt: Date.now() },
        },
        activeGraphId: graphId,
        graphOrder: [graphId],
        templates: {},
      };
    },
  },
];

/**
 * Detect the storage version of a raw payload.
 * Pre-versioned legacy single-graph payloads (nodes + connections, no
 * version field) are v1. Returns null for unrecognizable data.
 */
export function detectStorageVersion(data: unknown): number | null {
  if (!isPlainObject(data)) return null;
  if (typeof data.version === 'number') return data.version;
  if (isPlainObject(data.nodes) && isPlainObject(data.connections)) return 1;
  return null;
}

export type MigrationError = 'unknown-format' | 'future-version' | 'missing-migration';

export interface MigrationOutcome {
  /** The payload at CURRENT_STORAGE_VERSION, or null on error. */
  data: Record<string, unknown> | null;
  /** Version the payload was detected at (null if unrecognizable). */
  fromVersion: number | null;
  /** Descriptions of migrations that ran, in order. */
  applied: string[];
  error?: MigrationError;
}

export interface MigrateOptions {
  migrations?: StorageMigration[];
  currentVersion?: number;
}

/**
 * Walk a payload through the migration chain up to the current version.
 * Never throws; never mutates the input on error paths.
 */
export function migrateStorageToCurrent(raw: unknown, opts: MigrateOptions = {}): MigrationOutcome {
  const migrations = opts.migrations ?? STORAGE_MIGRATIONS;
  const currentVersion = opts.currentVersion ?? CURRENT_STORAGE_VERSION;

  const fromVersion = detectStorageVersion(raw);
  if (fromVersion === null) {
    return { data: null, fromVersion: null, applied: [], error: 'unknown-format' };
  }
  if (fromVersion > currentVersion) {
    return { data: null, fromVersion, applied: [], error: 'future-version' };
  }

  let data = raw as Record<string, unknown>;
  const applied: string[] = [];
  let version = fromVersion;
  while (version < currentVersion) {
    const step = migrations.find(m => m.from === version);
    if (!step) {
      return { data: null, fromVersion, applied, error: 'missing-migration' };
    }
    data = step.migrate(data);
    applied.push(step.description);
    version = step.to;
  }
  return { data, fromVersion, applied };
}

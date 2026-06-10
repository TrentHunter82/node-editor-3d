import { describe, it, expect } from 'vitest';
import {
  detectStorageVersion,
  migrateStorageToCurrent,
  CURRENT_STORAGE_VERSION,
  type StorageMigration,
} from '../utils/storageMigrations';
import { loadMultiGraph } from '../utils/serialization';

const legacyPayload = {
  nodes: { n1: { id: 'n1', type: 'source', position: [0, 0, 0], title: 'n', data: {}, inputs: [], outputs: [] } },
  connections: {},
};

describe('detectStorageVersion', () => {
  it('reads an explicit version field', () => {
    expect(detectStorageVersion({ version: 2, graphs: {} })).toBe(2);
    expect(detectStorageVersion({ version: 7 })).toBe(7);
  });

  it('classifies pre-versioned single-graph payloads as v1', () => {
    expect(detectStorageVersion(legacyPayload)).toBe(1);
  });

  it('returns null for unrecognizable data', () => {
    expect(detectStorageVersion(null)).toBeNull();
    expect(detectStorageVersion('hello')).toBeNull();
    expect(detectStorageVersion({ foo: 1 })).toBeNull();
    expect(detectStorageVersion([])).toBeNull();
  });
});

describe('migrateStorageToCurrent', () => {
  it('migrates a v1 legacy payload to the current version', () => {
    const outcome = migrateStorageToCurrent(legacyPayload);
    expect(outcome.error).toBeUndefined();
    expect(outcome.fromVersion).toBe(1);
    expect(outcome.applied.length).toBe(1);
    const data = outcome.data as { version: number; graphs: Record<string, { nodes: Record<string, unknown> }>; activeGraphId: string };
    expect(data.version).toBe(CURRENT_STORAGE_VERSION);
    expect(data.activeGraphId).toBe('default');
    expect(data.graphs.default.nodes.n1).toBeDefined();
  });

  it('passes a current-version payload through untouched', () => {
    const v2 = { version: 2, graphs: { g: {} }, graphTabs: {}, activeGraphId: 'g', graphOrder: ['g'], templates: {} };
    const outcome = migrateStorageToCurrent(v2);
    expect(outcome.error).toBeUndefined();
    expect(outcome.applied).toEqual([]);
    expect(outcome.data).toBe(v2);
  });

  it('refuses future versions loudly instead of dropping data', () => {
    const outcome = migrateStorageToCurrent({ version: CURRENT_STORAGE_VERSION + 1 });
    expect(outcome.error).toBe('future-version');
    expect(outcome.data).toBeNull();
    expect(outcome.fromVersion).toBe(CURRENT_STORAGE_VERSION + 1);
  });

  it('reports unknown formats', () => {
    expect(migrateStorageToCurrent({ random: true }).error).toBe('unknown-format');
    expect(migrateStorageToCurrent(undefined).error).toBe('unknown-format');
  });

  it('composes multi-step chains in order', () => {
    const chain: StorageMigration[] = [
      { from: 1, to: 2, description: 'one→two', migrate: d => ({ ...d, version: 2, two: true }) },
      { from: 2, to: 3, description: 'two→three', migrate: d => ({ ...d, version: 3, three: true }) },
    ];
    const outcome = migrateStorageToCurrent(legacyPayload, { migrations: chain, currentVersion: 3 });
    expect(outcome.error).toBeUndefined();
    expect(outcome.applied).toEqual(['one→two', 'two→three']);
    expect((outcome.data as { two: boolean; three: boolean }).two).toBe(true);
    expect((outcome.data as { two: boolean; three: boolean }).three).toBe(true);
  });

  it('reports a gap in the chain as missing-migration', () => {
    const gappy: StorageMigration[] = [
      { from: 2, to: 3, description: 'two→three', migrate: d => d },
    ];
    const outcome = migrateStorageToCurrent(legacyPayload, { migrations: gappy, currentVersion: 3 });
    expect(outcome.error).toBe('missing-migration');
    expect(outcome.data).toBeNull();
  });
});

describe('serialization integration', () => {
  it('loadMultiGraph still migrates legacy localStorage payloads', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify(legacyPayload));
    const loaded = loadMultiGraph();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(2);
    expect(loaded!.graphs.default.nodes.n1).toBeDefined();
    localStorage.removeItem('node-editor-3d-graph');
  });

  it('loadMultiGraph returns null (not garbage) for future-version payloads', () => {
    localStorage.setItem('node-editor-3d-graph', JSON.stringify({ version: 99, graphs: {} }));
    expect(loadMultiGraph()).toBeNull();
    // The stored bytes are untouched — an app update can still load them
    expect(localStorage.getItem('node-editor-3d-graph')).toContain('99');
    localStorage.removeItem('node-editor-3d-graph');
  });
});

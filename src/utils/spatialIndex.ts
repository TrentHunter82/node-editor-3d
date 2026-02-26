/**
 * Grid-based spatial hash for O(1) cell lookups during viewport culling.
 * Divides the world into fixed-size cells and maintains a mapping of
 * cell → node IDs. Camera frustum queries check only cells that overlap
 * the frustum, avoiding the linear scan of all nodes.
 */

const DEFAULT_CELL_SIZE = 10;

/** Encode grid coordinates to a string key */
function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class SpatialIndex {
  /** cell size in world units */
  readonly cellSize: number;
  /** Map from cell key → Set of node IDs */
  private cells = new Map<string, Set<string>>();
  /** Map from node ID → cell key (for fast removal/update) */
  private nodeCell = new Map<string, string>();

  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  /** Convert a world X/Z position to cell coordinates */
  private toCellCoords(x: number, z: number): [number, number] {
    return [
      Math.floor(x / this.cellSize),
      Math.floor(z / this.cellSize),
    ];
  }

  /** Insert or update a node's position */
  update(nodeId: string, x: number, z: number): void {
    const [cx, cz] = this.toCellCoords(x, z);
    const newKey = cellKey(cx, cz);
    const oldKey = this.nodeCell.get(nodeId);

    // No change — skip
    if (oldKey === newKey) return;

    // Remove from old cell
    if (oldKey !== undefined) {
      const oldSet = this.cells.get(oldKey);
      if (oldSet) {
        oldSet.delete(nodeId);
        if (oldSet.size === 0) this.cells.delete(oldKey);
      }
    }

    // Add to new cell
    let newSet = this.cells.get(newKey);
    if (!newSet) {
      newSet = new Set();
      this.cells.set(newKey, newSet);
    }
    newSet.add(nodeId);
    this.nodeCell.set(nodeId, newKey);
  }

  /** Remove a node from the index */
  remove(nodeId: string): void {
    const key = this.nodeCell.get(nodeId);
    if (key === undefined) return;
    const set = this.cells.get(key);
    if (set) {
      set.delete(nodeId);
      if (set.size === 0) this.cells.delete(key);
    }
    this.nodeCell.delete(nodeId);
  }

  /** Clear the entire index */
  clear(): void {
    this.cells.clear();
    this.nodeCell.clear();
  }

  /**
   * Rebuild the index from a full nodes record.
   * Used after undo/redo/load when many nodes change at once.
   */
  rebuild(nodes: Record<string, { position: [number, number, number] }>): void {
    this.clear();
    for (const id in nodes) {
      const pos = nodes[id].position;
      this.update(id, pos[0], pos[2]);
    }
  }

  /**
   * Query all node IDs in cells overlapping an axis-aligned bounding box.
   * The AABB is defined in world XZ coordinates.
   * Returns an array of node IDs (may include nodes outside the exact AABB
   * due to cell granularity — caller should do precise checks).
   */
  queryAABB(minX: number, maxX: number, minZ: number, maxZ: number): string[] {
    const cMinX = Math.floor(minX / this.cellSize);
    const cMaxX = Math.floor(maxX / this.cellSize);
    const cMinZ = Math.floor(minZ / this.cellSize);
    const cMaxZ = Math.floor(maxZ / this.cellSize);

    const result: string[] = [];
    for (let cx = cMinX; cx <= cMaxX; cx++) {
      for (let cz = cMinZ; cz <= cMaxZ; cz++) {
        const set = this.cells.get(cellKey(cx, cz));
        if (set) {
          for (const id of set) {
            result.push(id);
          }
        }
      }
    }
    return result;
  }

  /** Number of nodes indexed */
  get size(): number {
    return this.nodeCell.size;
  }

  /** Number of non-empty cells */
  get cellCount(): number {
    return this.cells.size;
  }

  /** Check if a node is in the index */
  has(nodeId: string): boolean {
    return this.nodeCell.has(nodeId);
  }
}

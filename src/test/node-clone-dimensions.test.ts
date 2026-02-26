/**
 * Tests that node width/height are preserved through clone operations:
 * - duplicateSelected
 * - copy + paste
 * - instantiateTemplate
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { getMinNodeDepth } from '../utils/nodeDepth';

enableMapSet();

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.templates = {};
  });
}

function selectNodes(...ids: string[]) {
  useEditorStore.setState(s => { s.selectedIds = new Set(ids); });
}

function addNodeWithSize(type: string, width?: number, height?: number): string {
  const store = useEditorStore.getState();
  const id = store.addNode(type as any, [0, 0, 0]);
  if (width !== undefined || height !== undefined) {
    store.resizeNode(id, width ?? 1.6, height ?? 0.8);
  }
  return id;
}

describe('Node clone operations preserve width/height', () => {
  beforeEach(resetStore);

  describe('duplicateSelected', () => {
    it('preserves custom width and height on duplicated node', () => {
      const id = addNodeWithSize('math', 3.0, 2.0);
      selectNodes(id);
      useEditorStore.getState().duplicateSelected();

      const nodes = useEditorStore.getState().nodes;
      const dupId = Object.keys(nodes).find(nid => nid !== id)!;
      expect(dupId).toBeDefined();
      expect(nodes[dupId].width).toBe(3.0);
      expect(nodes[dupId].height).toBe(2.0);
    });

    it('does not add width/height when original has default size', () => {
      const id = addNodeWithSize('math');
      const state = useEditorStore.getState();
      expect(state.nodes[id].width).toBeUndefined();
      expect(state.nodes[id].height).toBe(getMinNodeDepth('math', 2, 1));

      selectNodes(id);
      useEditorStore.getState().duplicateSelected();

      const nodes = useEditorStore.getState().nodes;
      const dupId = Object.keys(nodes).find(nid => nid !== id)!;
      expect(nodes[dupId].width).toBeUndefined();
      expect(nodes[dupId].height).toBe(getMinNodeDepth('math', 2, 1));
    });

    it('preserves dimensions for multiple selected nodes', () => {
      const id1 = addNodeWithSize('math', 2.5, 1.5);
      const id2 = addNodeWithSize('transform', 4.0, 3.0);
      selectNodes(id1, id2);
      useEditorStore.getState().duplicateSelected();

      const nodes = useEditorStore.getState().nodes;
      const newIds = Object.keys(nodes).filter(nid => nid !== id1 && nid !== id2);
      expect(newIds.length).toBe(2);

      const dupNodes = newIds.map(nid => nodes[nid]);
      const dupMath = dupNodes.find(n => n.type === 'math')!;
      const dupTransform = dupNodes.find(n => n.type === 'transform')!;
      expect(dupMath.width).toBe(2.5);
      expect(dupMath.height).toBe(1.5);
      expect(dupTransform.width).toBe(4.0);
      expect(dupTransform.height).toBe(3.0);
    });
  });

  describe('copy + paste', () => {
    it('preserves custom width and height through clipboard', () => {
      const id = addNodeWithSize('filter', 2.0, 1.2);
      selectNodes(id);
      useEditorStore.getState().copySelected();
      useEditorStore.getState().paste();

      const nodes = useEditorStore.getState().nodes;
      const pastedId = Object.keys(nodes).find(nid => nid !== id)!;
      expect(pastedId).toBeDefined();
      expect(nodes[pastedId].width).toBe(2.0);
      expect(nodes[pastedId].height).toBe(1.2);
    });

    it('does not add width/height when pasting default-sized node', () => {
      const id = addNodeWithSize('math');
      selectNodes(id);
      useEditorStore.getState().copySelected();
      useEditorStore.getState().paste();

      const nodes = useEditorStore.getState().nodes;
      const pastedId = Object.keys(nodes).find(nid => nid !== id)!;
      expect(nodes[pastedId].width).toBeUndefined();
      expect(nodes[pastedId].height).toBe(getMinNodeDepth('math', 2, 1));
    });
  });

  describe('instantiateTemplate', () => {
    it('preserves custom width and height from template nodes', () => {
      const id = addNodeWithSize('clamp', 5.0, 3.5);
      selectNodes(id);
      useEditorStore.getState().saveSelectionAsTemplate('wide-node');

      const templates = useEditorStore.getState().templates;
      const templateId = Object.keys(templates)[0];
      expect(templateId).toBeDefined();

      useEditorStore.getState().instantiateTemplate(templateId, [10, 0, 10]);

      const nodes = useEditorStore.getState().nodes;
      const instanceId = Object.keys(nodes).find(nid => nid !== id)!;
      expect(instanceId).toBeDefined();
      expect(nodes[instanceId].width).toBe(5.0);
      expect(nodes[instanceId].height).toBe(3.5);
    });

    it('does not add width/height for default-sized template nodes', () => {
      const id = addNodeWithSize('math');
      selectNodes(id);
      useEditorStore.getState().saveSelectionAsTemplate('default-node');

      const templates = useEditorStore.getState().templates;
      const templateId = Object.keys(templates)[0];

      useEditorStore.getState().instantiateTemplate(templateId, [10, 0, 10]);

      const nodes = useEditorStore.getState().nodes;
      const instanceId = Object.keys(nodes).find(nid => nid !== id)!;
      expect(nodes[instanceId].width).toBeUndefined();
      expect(nodes[instanceId].height).toBe(getMinNodeDepth('math', 2, 1));
    });
  });

  describe('undo preserves dimensions', () => {
    it('undo after resize restores original undefined dimensions', () => {
      const id = addNodeWithSize('math');
      expect(useEditorStore.getState().nodes[id].width).toBeUndefined();

      useEditorStore.getState().resizeNode(id, 3.0, 2.0);
      expect(useEditorStore.getState().nodes[id].width).toBe(3.0);

      useEditorStore.getState().undo();
      expect(useEditorStore.getState().nodes[id].width).toBeUndefined();
    });

    it('undo after duplicate of resized node removes the duplicate', () => {
      const id = addNodeWithSize('math', 4.0, 2.5);
      selectNodes(id);
      useEditorStore.getState().duplicateSelected();

      const beforeUndo = Object.keys(useEditorStore.getState().nodes);
      expect(beforeUndo.length).toBe(2);

      useEditorStore.getState().undo();
      const afterUndo = Object.keys(useEditorStore.getState().nodes);
      expect(afterUndo.length).toBe(1);
      expect(useEditorStore.getState().nodes[id].width).toBe(4.0);
      expect(useEditorStore.getState().nodes[id].height).toBe(2.5);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { NODE_TYPE_CONFIG, isPortTypeCompatible } from './index';
import type { NodeType, PortType } from './index';

describe('NODE_TYPE_CONFIG', () => {
  const nodeTypes: NodeType[] = ['source', 'transform', 'filter', 'output'];

  it('defines config for all four node types', () => {
    for (const type of nodeTypes) {
      expect(NODE_TYPE_CONFIG[type]).toBeDefined();
      expect(NODE_TYPE_CONFIG[type]).toHaveProperty('color');
      expect(NODE_TYPE_CONFIG[type]).toHaveProperty('inputs');
      expect(NODE_TYPE_CONFIG[type]).toHaveProperty('outputs');
    }
  });

  it('source nodes have 0 inputs and 2 outputs', () => {
    expect(NODE_TYPE_CONFIG.source.inputs).toHaveLength(0);
    expect(NODE_TYPE_CONFIG.source.outputs).toHaveLength(2);
  });

  it('transform nodes have 2 inputs and 2 outputs', () => {
    expect(NODE_TYPE_CONFIG.transform.inputs).toHaveLength(2);
    expect(NODE_TYPE_CONFIG.transform.outputs).toHaveLength(2);
  });

  it('filter nodes have 1 input and 1 output', () => {
    expect(NODE_TYPE_CONFIG.filter.inputs).toHaveLength(1);
    expect(NODE_TYPE_CONFIG.filter.outputs).toHaveLength(1);
  });

  it('output nodes have 2 inputs and 0 outputs', () => {
    expect(NODE_TYPE_CONFIG.output.inputs).toHaveLength(2);
    expect(NODE_TYPE_CONFIG.output.outputs).toHaveLength(0);
  });

  it('all port configs have valid portType and label', () => {
    const validPortTypes: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'any'];
    for (const type of nodeTypes) {
      const cfg = NODE_TYPE_CONFIG[type];
      for (const port of [...cfg.inputs, ...cfg.outputs]) {
        expect(typeof port.label).toBe('string');
        expect(port.label.length).toBeGreaterThan(0);
        expect(validPortTypes).toContain(port.portType);
      }
    }
  });
});

describe('isPortTypeCompatible', () => {
  it('returns true for exact type matches', () => {
    const types: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean'];
    for (const t of types) {
      expect(isPortTypeCompatible(t, t)).toBe(true);
    }
  });

  it('returns true when source is any', () => {
    const types: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'any'];
    for (const t of types) {
      expect(isPortTypeCompatible('any', t)).toBe(true);
    }
  });

  it('returns true when target is any', () => {
    const types: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'any'];
    for (const t of types) {
      expect(isPortTypeCompatible(t, 'any')).toBe(true);
    }
  });

  it('returns false for incompatible types', () => {
    expect(isPortTypeCompatible('number', 'string')).toBe(false);
    expect(isPortTypeCompatible('string', 'number')).toBe(false);
    expect(isPortTypeCompatible('vector3', 'color')).toBe(false);
    expect(isPortTypeCompatible('boolean', 'number')).toBe(false);
    expect(isPortTypeCompatible('color', 'string')).toBe(false);
  });

  it('any-to-any is compatible', () => {
    expect(isPortTypeCompatible('any', 'any')).toBe(true);
  });
});

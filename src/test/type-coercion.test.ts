import { describe, it, expect } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { getCoercionRule, hasCoercion, getAllCoercions } from '../utils/typeCoercions';
import type { PortType } from '../types';

describe('getCoercionRule', () => {
  it('returns correct rule for number→string', () => {
    const rule = getCoercionRule('number', 'string');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('template');
    expect(rule!.inputPortIndex).toBe(1);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Number to string');
  });

  it('returns correct rule for string→number', () => {
    const rule = getCoercionRule('string', 'number');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('parse-number');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('String to number');
  });

  it('returns correct rule for vector3→number', () => {
    const rule = getCoercionRule('vector3', 'number');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('decompose-vec3');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Extract X from vector');
  });

  it('returns correct rule for number→vector3', () => {
    const rule = getCoercionRule('number', 'vector3');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('compose-vec3');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Number to vector (X)');
  });

  it('returns correct rule for number→boolean', () => {
    const rule = getCoercionRule('number', 'boolean');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('compare');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Number to boolean (> 0)');
  });

  it('returns correct rule for boolean→string', () => {
    const rule = getCoercionRule('boolean', 'string');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('template');
    expect(rule!.inputPortIndex).toBe(1);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Boolean to string');
  });

  it('returns null when source and target are the same type', () => {
    const sameTypes: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'any'];
    for (const type of sameTypes) {
      expect(getCoercionRule(type, type)).toBeNull();
    }
  });

  it('returns null when source is any', () => {
    expect(getCoercionRule('any', 'number')).toBeNull();
    expect(getCoercionRule('any', 'string')).toBeNull();
    expect(getCoercionRule('any', 'vector3')).toBeNull();
  });

  it('returns null when target is any', () => {
    expect(getCoercionRule('number', 'any')).toBeNull();
    expect(getCoercionRule('string', 'any')).toBeNull();
    expect(getCoercionRule('boolean', 'any')).toBeNull();
  });

  it('returns null for unregistered pairs', () => {
    expect(getCoercionRule('color', 'number')).toBeNull();
    expect(getCoercionRule('string', 'vector3')).toBeNull();
    expect(getCoercionRule('boolean', 'number')).toBeNull();
    expect(getCoercionRule('color', 'boolean')).toBeNull();
  });

  it('returned rule has correct structure with valid types', () => {
    const rule = getCoercionRule('number', 'string');
    expect(rule).not.toBeNull();
    expect(typeof rule!.converterType).toBe('string');
    expect(typeof rule!.inputPortIndex).toBe('number');
    expect(typeof rule!.outputPortIndex).toBe('number');
    expect(typeof rule!.description).toBe('string');
  });

  it('returns null for both any→any', () => {
    expect(getCoercionRule('any', 'any')).toBeNull();
  });
});

describe('hasCoercion', () => {
  it('returns true for all registered coercion pairs', () => {
    expect(hasCoercion('number', 'string')).toBe(true);
    expect(hasCoercion('string', 'number')).toBe(true);
    expect(hasCoercion('vector3', 'number')).toBe(true);
    expect(hasCoercion('number', 'vector3')).toBe(true);
    expect(hasCoercion('number', 'boolean')).toBe(true);
    expect(hasCoercion('boolean', 'string')).toBe(true);
  });

  it('returns false when source and target are the same type', () => {
    expect(hasCoercion('number', 'number')).toBe(false);
    expect(hasCoercion('string', 'string')).toBe(false);
    expect(hasCoercion('boolean', 'boolean')).toBe(false);
  });

  it('returns false when source is any', () => {
    expect(hasCoercion('any', 'number')).toBe(false);
    expect(hasCoercion('any', 'string')).toBe(false);
  });

  it('returns false when target is any', () => {
    expect(hasCoercion('number', 'any')).toBe(false);
    expect(hasCoercion('vector3', 'any')).toBe(false);
  });

  it('returns false for unregistered pairs', () => {
    expect(hasCoercion('color', 'number')).toBe(false);
    expect(hasCoercion('string', 'vector3')).toBe(false);
    expect(hasCoercion('boolean', 'number')).toBe(false);
    expect(hasCoercion('color', 'boolean')).toBe(false);
  });

  it('returns false for any→any', () => {
    expect(hasCoercion('any', 'any')).toBe(false);
  });
});

describe('getAllCoercions', () => {
  it('returns exactly 11 entries', () => {
    const coercions = getAllCoercions();
    expect(coercions).toHaveLength(11);
  });

  it('each entry has valid from/to PortType strings', () => {
    const validPortTypes: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'array', 'object', 'any'];
    const coercions = getAllCoercions();
    for (const entry of coercions) {
      expect(validPortTypes).toContain(entry.from);
      expect(validPortTypes).toContain(entry.to);
    }
  });

  it('each entry has a valid CoercionRule with all required fields', () => {
    const coercions = getAllCoercions();
    for (const entry of coercions) {
      expect(entry.rule).toBeDefined();
      expect(typeof entry.rule.converterType).toBe('string');
      expect(typeof entry.rule.inputPortIndex).toBe('number');
      expect(typeof entry.rule.outputPortIndex).toBe('number');
      expect(typeof entry.rule.description).toBe('string');
    }
  });

  it('contains all expected type pairs', () => {
    const coercions = getAllCoercions();
    const pairs = coercions.map(c => `${c.from}→${c.to}`);
    expect(pairs).toContain('number→string');
    expect(pairs).toContain('string→number');
    expect(pairs).toContain('vector3→number');
    expect(pairs).toContain('number→vector3');
    expect(pairs).toContain('number→boolean');
    expect(pairs).toContain('boolean→string');
  });

  it('all converter types are valid NodeType values', () => {
    const knownConverterTypes = ['template', 'parse-number', 'decompose-vec3', 'compose-vec3', 'compare', 'json-stringify', 'json-parse', 'object-values'];
    const coercions = getAllCoercions();
    for (const entry of coercions) {
      expect(knownConverterTypes).toContain(entry.rule.converterType);
    }
  });

  it('all port indices are non-negative integers', () => {
    const coercions = getAllCoercions();
    for (const entry of coercions) {
      expect(Number.isInteger(entry.rule.inputPortIndex)).toBe(true);
      expect(entry.rule.inputPortIndex).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(entry.rule.outputPortIndex)).toBe(true);
      expect(entry.rule.outputPortIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('all descriptions are non-empty strings', () => {
    const coercions = getAllCoercions();
    for (const entry of coercions) {
      expect(entry.rule.description.length).toBeGreaterThan(0);
    }
  });
});

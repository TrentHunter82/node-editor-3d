import { describe, it, expect } from 'vitest';
import {
  getCoercionRule,
  hasCoercion,
  getAllCoercions,
} from './typeCoercions';
import type { PortType } from '../types';

// ---------------------------------------------------------------------------
// getCoercionRule – registered coercion rules
// ---------------------------------------------------------------------------

describe('getCoercionRule', () => {
  // ---- number → string ----
  it('returns template rule for number → string', () => {
    const rule = getCoercionRule('number', 'string');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('template');
    expect(rule!.inputPortIndex).toBe(1);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Number to string');
    expect(rule!.initialData).toBeUndefined();
  });

  // ---- string → number ----
  it('returns parse-number rule for string → number', () => {
    const rule = getCoercionRule('string', 'number');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('parse-number');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('String to number');
  });

  // ---- vector3 → number ----
  it('returns decompose-vec3 rule for vector3 → number', () => {
    const rule = getCoercionRule('vector3', 'number');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('decompose-vec3');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Extract X from vector');
  });

  // ---- number → vector3 ----
  it('returns compose-vec3 rule for number → vector3', () => {
    const rule = getCoercionRule('number', 'vector3');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('compose-vec3');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Number to vector (X)');
  });

  // ---- number → boolean ----
  it('returns compare rule for number → boolean with initialData', () => {
    const rule = getCoercionRule('number', 'boolean');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('compare');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Number to boolean (> 0)');
    expect(rule!.initialData).toEqual({ mode: '>' });
  });

  // ---- boolean → string ----
  it('returns template rule for boolean → string', () => {
    const rule = getCoercionRule('boolean', 'string');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('template');
    expect(rule!.inputPortIndex).toBe(1);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Boolean to string');
  });

  // ---- array → string ----
  it('returns json-stringify rule for array → string', () => {
    const rule = getCoercionRule('array', 'string');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('json-stringify');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Array to JSON string');
  });

  // ---- object → string ----
  it('returns json-stringify rule for object → string', () => {
    const rule = getCoercionRule('object', 'string');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('json-stringify');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Object to JSON string');
  });

  // ---- string → array ----
  it('returns json-parse rule for string → array', () => {
    const rule = getCoercionRule('string', 'array');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('json-parse');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Parse JSON string as array');
  });

  // ---- string → object ----
  it('returns json-parse rule for string → object', () => {
    const rule = getCoercionRule('string', 'object');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('json-parse');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Parse JSON string as object');
  });

  // ---- object → array ----
  it('returns object-values rule for object → array', () => {
    const rule = getCoercionRule('object', 'array');
    expect(rule).not.toBeNull();
    expect(rule!.converterType).toBe('object-values');
    expect(rule!.inputPortIndex).toBe(0);
    expect(rule!.outputPortIndex).toBe(0);
    expect(rule!.description).toBe('Object values to array');
  });
});

// ---------------------------------------------------------------------------
// getCoercionRule – null returns (same type, 'any', unregistered)
// ---------------------------------------------------------------------------

describe('getCoercionRule – returns null', () => {
  // ---- same type → null ----
  const concreteTypes: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'array', 'object'];

  it.each(concreteTypes)(
    'returns null when source and target are both "%s"',
    (type) => {
      expect(getCoercionRule(type, type)).toBeNull();
    },
  );

  it('returns null when source and target are both "any"', () => {
    expect(getCoercionRule('any', 'any')).toBeNull();
  });

  // ---- source is 'any' ----
  it.each(concreteTypes)(
    'returns null when source is "any" and target is "%s"',
    (target) => {
      expect(getCoercionRule('any', target)).toBeNull();
    },
  );

  // ---- target is 'any' ----
  it.each(concreteTypes)(
    'returns null when target is "any" and source is "%s"',
    (source) => {
      expect(getCoercionRule(source, 'any')).toBeNull();
    },
  );

  // ---- unregistered pairs ----
  it('returns null for boolean → number (no registered coercion)', () => {
    expect(getCoercionRule('boolean', 'number')).toBeNull();
  });

  it('returns null for color → number (no registered coercion)', () => {
    expect(getCoercionRule('color', 'number')).toBeNull();
  });

  it('returns null for color → string (no registered coercion)', () => {
    expect(getCoercionRule('color', 'string')).toBeNull();
  });

  it('returns null for number → color (no registered coercion)', () => {
    expect(getCoercionRule('number', 'color')).toBeNull();
  });

  it('returns null for vector3 → string (no registered coercion)', () => {
    expect(getCoercionRule('vector3', 'string')).toBeNull();
  });

  it('returns null for string → boolean (no registered coercion)', () => {
    expect(getCoercionRule('string', 'boolean')).toBeNull();
  });

  it('returns null for array → number (no registered coercion)', () => {
    expect(getCoercionRule('array', 'number')).toBeNull();
  });

  it('returns null for boolean → vector3 (no registered coercion)', () => {
    expect(getCoercionRule('boolean', 'vector3')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasCoercion
// ---------------------------------------------------------------------------

describe('hasCoercion', () => {
  it('returns true for every registered coercion pair', () => {
    const registeredPairs: [PortType, PortType][] = [
      ['number', 'string'],
      ['string', 'number'],
      ['vector3', 'number'],
      ['number', 'vector3'],
      ['number', 'boolean'],
      ['boolean', 'string'],
      ['array', 'string'],
      ['object', 'string'],
      ['string', 'array'],
      ['string', 'object'],
      ['object', 'array'],
    ];
    for (const [from, to] of registeredPairs) {
      expect(hasCoercion(from, to)).toBe(true);
    }
  });

  it('returns false for same-type pairs', () => {
    expect(hasCoercion('number', 'number')).toBe(false);
    expect(hasCoercion('string', 'string')).toBe(false);
  });

  it('returns false when source is "any"', () => {
    expect(hasCoercion('any', 'number')).toBe(false);
  });

  it('returns false when target is "any"', () => {
    expect(hasCoercion('number', 'any')).toBe(false);
  });

  it('returns false for unregistered coercion pairs', () => {
    expect(hasCoercion('boolean', 'number')).toBe(false);
    expect(hasCoercion('color', 'vector3')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAllCoercions
// ---------------------------------------------------------------------------

describe('getAllCoercions', () => {
  it('returns exactly 11 coercion entries', () => {
    const all = getAllCoercions();
    expect(all).toHaveLength(11);
  });

  it('each entry has from, to, and rule properties', () => {
    const all = getAllCoercions();
    for (const entry of all) {
      expect(entry).toHaveProperty('from');
      expect(entry).toHaveProperty('to');
      expect(entry).toHaveProperty('rule');
      expect(typeof entry.from).toBe('string');
      expect(typeof entry.to).toBe('string');
      expect(typeof entry.rule).toBe('object');
    }
  });

  it('each rule contains required CoercionRule fields', () => {
    const all = getAllCoercions();
    for (const { rule } of all) {
      expect(typeof rule.converterType).toBe('string');
      expect(typeof rule.inputPortIndex).toBe('number');
      expect(typeof rule.outputPortIndex).toBe('number');
      expect(typeof rule.description).toBe('string');
    }
  });

  it('contains the number → string coercion', () => {
    const all = getAllCoercions();
    const match = all.find((e) => e.from === 'number' && e.to === 'string');
    expect(match).toBeDefined();
    expect(match!.rule.converterType).toBe('template');
  });

  it('contains the number → boolean coercion with initialData', () => {
    const all = getAllCoercions();
    const match = all.find((e) => e.from === 'number' && e.to === 'boolean');
    expect(match).toBeDefined();
    expect(match!.rule.initialData).toEqual({ mode: '>' });
  });

  it('does not contain reverse pairs that are not registered', () => {
    const all = getAllCoercions();
    const booleanToNumber = all.find((e) => e.from === 'boolean' && e.to === 'number');
    expect(booleanToNumber).toBeUndefined();
  });

  it('every entry is consistent with getCoercionRule', () => {
    const all = getAllCoercions();
    for (const { from, to, rule } of all) {
      const lookedUp = getCoercionRule(from, to);
      expect(lookedUp).not.toBeNull();
      expect(lookedUp).toEqual(rule);
    }
  });

  it('returns a new array each time (not a reference to internal state)', () => {
    const a = getAllCoercions();
    const b = getAllCoercions();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Directionality – coercions are one-way unless both directions are registered
// ---------------------------------------------------------------------------

describe('coercion directionality', () => {
  it('number → string exists but is a different rule than string → number', () => {
    const numToStr = getCoercionRule('number', 'string');
    const strToNum = getCoercionRule('string', 'number');
    expect(numToStr).not.toBeNull();
    expect(strToNum).not.toBeNull();
    expect(numToStr!.converterType).not.toBe(strToNum!.converterType);
  });

  it('number → vector3 and vector3 → number use different converter types', () => {
    const numToVec = getCoercionRule('number', 'vector3');
    const vecToNum = getCoercionRule('vector3', 'number');
    expect(numToVec).not.toBeNull();
    expect(vecToNum).not.toBeNull();
    expect(numToVec!.converterType).toBe('compose-vec3');
    expect(vecToNum!.converterType).toBe('decompose-vec3');
  });

  it('string → array and string → object both use json-parse but are distinct entries', () => {
    const strToArr = getCoercionRule('string', 'array');
    const strToObj = getCoercionRule('string', 'object');
    expect(strToArr).not.toBeNull();
    expect(strToObj).not.toBeNull();
    expect(strToArr!.converterType).toBe('json-parse');
    expect(strToObj!.converterType).toBe('json-parse');
    // They are different objects in the registry
    expect(strToArr).not.toBe(strToObj);
  });

  it('array → string and object → string both use json-stringify', () => {
    const arrToStr = getCoercionRule('array', 'string');
    const objToStr = getCoercionRule('object', 'string');
    expect(arrToStr!.converterType).toBe('json-stringify');
    expect(objToStr!.converterType).toBe('json-stringify');
  });
});

// ---------------------------------------------------------------------------
// initialData – only number → boolean has it
// ---------------------------------------------------------------------------

describe('initialData presence', () => {
  it('only number → boolean carries initialData', () => {
    const all = getAllCoercions();
    const withInitialData = all.filter((e) => e.rule.initialData !== undefined);
    expect(withInitialData).toHaveLength(1);
    expect(withInitialData[0].from).toBe('number');
    expect(withInitialData[0].to).toBe('boolean');
  });
});

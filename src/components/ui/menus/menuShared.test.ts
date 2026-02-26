import { describe, it, expect } from 'vitest';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../../../types';
import type { NodeType } from '../../../types';
import {
  typeToLabel,
  COLOR_VAR,
  EXCLUDED_FROM_MENU,
  NODE_BUTTONS,
  NODE_BUTTON_MAP,
  CATEGORY_ORDER,
  BUTTONS_BY_CATEGORY,
  CONNECTION_STYLES,
} from './menuShared';

// ---------------------------------------------------------------------------
// 1. typeToLabel
// ---------------------------------------------------------------------------
describe('typeToLabel', () => {
  describe('special-case types', () => {
    const specialCases: [string, string][] = [
      ['hsl-to-rgb', 'HSL to RGB'],
      ['rgb-to-hsl', 'RGB to HSL'],
      ['http-fetch', 'HTTP Fetch'],
      ['json-parse', 'JSON Parse'],
      ['json-stringify', 'JSON Stringify'],
      ['uri-encode', 'URI Encode'],
      ['uri-decode', 'URI Decode'],
      ['base64-encode', 'Base64 Encode'],
      ['base64-decode', 'Base64 Decode'],
      ['compose-vec3', 'Compose Vec3'],
      ['decompose-vec3', 'Decompose Vec3'],
      ['normalize-vec3', 'Normalize Vec3'],
      ['vec3-length', 'Vec3 Length'],
      ['stddev', 'Std Dev'],
      ['if-gate', 'If Gate'],
      ['get-var', 'Get Variable'],
      ['set-var', 'Set Variable'],
    ];

    it.each(specialCases)('maps "%s" to "%s"', (input, expected) => {
      expect(typeToLabel(input)).toBe(expected);
    });
  });

  describe('generic slug conversion', () => {
    it('converts a multi-hyphen slug to title case', () => {
      expect(typeToLabel('array-filter')).toBe('Array Filter');
    });

    it('capitalizes a single word', () => {
      expect(typeToLabel('source')).toBe('Source');
    });

    it('converts triple-hyphen slug correctly', () => {
      expect(typeToLabel('create-some-thing')).toBe('Create Some Thing');
    });

    it('handles already-capitalized input by preserving rest of word', () => {
      // The function only uppercases the first char; rest is kept as-is
      expect(typeToLabel('Source')).toBe('Source');
    });

    it('handles mixed case input without hyphens', () => {
      expect(typeToLabel('myNode')).toBe('MyNode');
    });

    it('handles two-word slug', () => {
      expect(typeToLabel('color-picker')).toBe('Color Picker');
    });

    it('handles single-char segments', () => {
      expect(typeToLabel('a-b-c')).toBe('A B C');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. EXCLUDED_FROM_MENU
// ---------------------------------------------------------------------------
describe('EXCLUDED_FROM_MENU', () => {
  it('contains exactly 3 entries', () => {
    expect(EXCLUDED_FROM_MENU.size).toBe(3);
  });

  it('contains subgraph', () => {
    expect(EXCLUDED_FROM_MENU.has('subgraph')).toBe(true);
  });

  it('contains subgraph-input', () => {
    expect(EXCLUDED_FROM_MENU.has('subgraph-input')).toBe(true);
  });

  it('contains subgraph-output', () => {
    expect(EXCLUDED_FROM_MENU.has('subgraph-output')).toBe(true);
  });

  it('does not contain arbitrary types', () => {
    expect(EXCLUDED_FROM_MENU.has('source')).toBe(false);
    expect(EXCLUDED_FROM_MENU.has('math')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. NODE_BUTTONS
// ---------------------------------------------------------------------------
describe('NODE_BUTTONS', () => {
  it('does not include any excluded types', () => {
    const types = NODE_BUTTONS.map(b => b.type);
    for (const excluded of EXCLUDED_FROM_MENU) {
      expect(types).not.toContain(excluded);
    }
  });

  it('every button has a non-empty label', () => {
    for (const btn of NODE_BUTTONS) {
      expect(btn.label.length).toBeGreaterThan(0);
    }
  });

  it('every button has a non-empty color', () => {
    for (const btn of NODE_BUTTONS) {
      expect(btn.color.length).toBeGreaterThan(0);
    }
  });

  it('every button type exists in NODE_TYPE_CONFIG', () => {
    for (const btn of NODE_BUTTONS) {
      expect(NODE_TYPE_CONFIG).toHaveProperty(btn.type);
    }
  });

  it('count matches NODE_TYPE_CONFIG minus excluded types', () => {
    const allTypes = Object.keys(NODE_TYPE_CONFIG) as NodeType[];
    const expectedCount = allTypes.filter(t => !EXCLUDED_FROM_MENU.has(t)).length;
    expect(NODE_BUTTONS.length).toBe(expectedCount);
  });

  it('has no duplicate types', () => {
    const types = NODE_BUTTONS.map(b => b.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

// ---------------------------------------------------------------------------
// 4. NODE_BUTTON_MAP
// ---------------------------------------------------------------------------
describe('NODE_BUTTON_MAP', () => {
  it('map size matches NODE_BUTTONS length', () => {
    expect(NODE_BUTTON_MAP.size).toBe(NODE_BUTTONS.length);
  });

  it('every NODE_BUTTONS entry is retrievable from the map', () => {
    for (const btn of NODE_BUTTONS) {
      expect(NODE_BUTTON_MAP.get(btn.type)).toBe(btn);
    }
  });

  it('returns undefined for an excluded type', () => {
    expect(NODE_BUTTON_MAP.get('subgraph' as NodeType)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. CATEGORY_ORDER
// ---------------------------------------------------------------------------
describe('CATEGORY_ORDER', () => {
  it('contains exactly 9 categories', () => {
    expect(CATEGORY_ORDER).toHaveLength(9);
  });

  it('has the expected order', () => {
    expect(CATEGORY_ORDER).toEqual([
      'Core', 'Math', 'String', 'Logic', 'Vector', 'Data', 'Color', 'Live', 'Utility',
    ]);
  });

  it('covers all categories used by non-excluded node types', () => {
    const usedCategories = new Set<string>();
    for (const btn of NODE_BUTTONS) {
      const cat = NODE_CATEGORIES[btn.type];
      if (cat) usedCategories.add(cat);
    }
    for (const cat of usedCategories) {
      expect(CATEGORY_ORDER).toContain(cat);
    }
  });

  it('does not include Subgraph (which is excluded from the menu)', () => {
    expect(CATEGORY_ORDER).not.toContain('Subgraph');
  });
});

// ---------------------------------------------------------------------------
// 6. BUTTONS_BY_CATEGORY
// ---------------------------------------------------------------------------
describe('BUTTONS_BY_CATEGORY', () => {
  it('every category in CATEGORY_ORDER has an array', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(Array.isArray(BUTTONS_BY_CATEGORY[cat])).toBe(true);
    }
  });

  it('total count across all categories matches NODE_BUTTONS length', () => {
    let total = 0;
    for (const cat of CATEGORY_ORDER) {
      total += BUTTONS_BY_CATEGORY[cat].length;
    }
    expect(total).toBe(NODE_BUTTONS.length);
  });

  it('all NODE_BUTTONS are accounted for across categories', () => {
    const allButtonsInCategories = CATEGORY_ORDER.flatMap(cat => BUTTONS_BY_CATEGORY[cat]);
    const typesInCategories = new Set(allButtonsInCategories.map(b => b.type));
    for (const btn of NODE_BUTTONS) {
      expect(typesInCategories.has(btn.type)).toBe(true);
    }
  });

  it('each button object in categories is the same reference as in NODE_BUTTONS', () => {
    const buttonsByType = new Map(NODE_BUTTONS.map(b => [b.type, b]));
    for (const cat of CATEGORY_ORDER) {
      for (const btn of BUTTONS_BY_CATEGORY[cat]) {
        expect(btn).toBe(buttonsByType.get(btn.type));
      }
    }
  });

  it('no category that should have nodes is empty', () => {
    // Build expected non-empty categories from NODE_CATEGORIES
    const catsWithNodes = new Set<string>();
    for (const btn of NODE_BUTTONS) {
      const cat = NODE_CATEGORIES[btn.type] ?? 'Utility';
      catsWithNodes.add(cat);
    }
    for (const cat of CATEGORY_ORDER) {
      if (catsWithNodes.has(cat)) {
        expect(BUTTONS_BY_CATEGORY[cat].length).toBeGreaterThan(0);
      }
    }
  });

  it('does not have entries outside CATEGORY_ORDER', () => {
    const categorySet = new Set<string>(CATEGORY_ORDER);
    for (const key of Object.keys(BUTTONS_BY_CATEGORY)) {
      expect(categorySet.has(key)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. COLOR_VAR
// ---------------------------------------------------------------------------
describe('COLOR_VAR', () => {
  it('maps teal to var(--teal)', () => {
    expect(COLOR_VAR.teal).toBe('var(--teal)');
  });

  it('maps orange to var(--orange)', () => {
    expect(COLOR_VAR.orange).toBe('var(--orange)');
  });

  it('maps coral to var(--coral)', () => {
    expect(COLOR_VAR.coral).toBe('var(--coral)');
  });

  it('maps teal-coral to #9B59B6', () => {
    expect(COLOR_VAR['teal-coral']).toBe('#9B59B6');
  });

  it('has exactly 4 keys', () => {
    expect(Object.keys(COLOR_VAR)).toHaveLength(4);
  });

  it('covers all color values used in NODE_TYPE_CONFIG', () => {
    const usedColors = new Set<string>();
    for (const key of Object.keys(NODE_TYPE_CONFIG) as NodeType[]) {
      usedColors.add(NODE_TYPE_CONFIG[key].color);
    }
    for (const color of usedColors) {
      expect(COLOR_VAR).toHaveProperty(color);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. CONNECTION_STYLES (bonus: simple constant sanity check)
// ---------------------------------------------------------------------------
describe('CONNECTION_STYLES', () => {
  it('contains 4 styles in the expected order', () => {
    expect(CONNECTION_STYLES).toEqual(['bezier', 'straight', 'right-angle', 'organic']);
  });
});

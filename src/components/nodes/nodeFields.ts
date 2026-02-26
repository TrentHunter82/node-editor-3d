/**
 * Field definitions per node type.
 *
 * Extracted to its own file to allow import from both NodeScreen.tsx and
 * utility modules (like nodeDepth.ts) without circular dependencies.
 */
import type { NodeType, PortType } from '../../types';

export type FieldType = 'number' | 'text' | 'select' | 'color' | 'textarea' | 'boolean';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
}

/** Map field type → port type for color accent strips */
export const FIELD_TYPE_TO_PORT: Record<FieldType, PortType> = {
  number: 'number',
  text: 'string',
  select: 'string',
  color: 'color',
  textarea: 'string',
  boolean: 'boolean',
};

export const NODE_SCREEN_FIELDS: Partial<Record<NodeType, FieldDef[]>> = {
  source: [
    { key: 'value', label: 'Value', type: 'number' },
    { key: 'label', label: 'Label', type: 'text' },
  ],
  transform: [
    { key: 'multiplier', label: 'Mult', type: 'number' },
    { key: 'offset', label: 'Offset', type: 'number' },
  ],
  filter: [
    { key: 'threshold', label: 'Thresh', type: 'number' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['greater', 'less', 'equal'] },
  ],
  output: [
    { key: 'format', label: 'Format', type: 'text' },
    { key: 'color', label: 'Color', type: 'color' },
  ],
  math: [
    { key: 'operation', label: 'Op', type: 'select', options: ['add', 'subtract', 'multiply', 'divide', 'power', 'modulo'] },
  ],
  clamp: [
    { key: 'min', label: 'Min', type: 'number' },
    { key: 'max', label: 'Max', type: 'number' },
  ],
  remap: [
    { key: 'inMin', label: 'In Min', type: 'number' },
    { key: 'inMax', label: 'In Max', type: 'number' },
    { key: 'outMin', label: 'Out Min', type: 'number' },
    { key: 'outMax', label: 'Out Max', type: 'number' },
  ],
  lerp: [
    { key: 'a', label: 'A', type: 'number' },
    { key: 'b', label: 'B', type: 'number' },
    { key: 't', label: 'T', type: 'number' },
  ],
  compare: [
    { key: 'mode', label: 'Mode', type: 'select', options: ['>', '<', '==', '!=', '>=', '<='] },
  ],
  'string-case': [
    { key: 'mode', label: 'Mode', type: 'select', options: ['upper', 'lower', 'title'] },
  ],
  'string-split': [
    { key: 'delimiter', label: 'Delim', type: 'text' },
  ],
  concat: [
    { key: 'separator', label: 'Sep', type: 'text' },
  ],
  template: [
    { key: 'defaultTemplate', label: 'Template', type: 'text' },
  ],
  switch: [
    { key: 'defaultIndex', label: 'Default', type: 'number' },
    { key: 'strictMode', label: 'Strict', type: 'boolean' },
  ],
  display: [
    { key: 'format', label: 'Format', type: 'select', options: ['auto', 'fixed', 'integer', 'hex', 'json'] },
  ],
  note: [
    { key: 'text', label: 'Text', type: 'textarea' },
  ],
  random: [
    { key: 'min', label: 'Min', type: 'number' },
    { key: 'max', label: 'Max', type: 'number' },
    { key: 'seed', label: 'Seed', type: 'number' },
  ],
  custom: [
    { key: 'expression', label: 'Expr', type: 'text' },
  ],
  timer: [
    { key: 'intervalMs', label: 'Interval (ms)', type: 'number' },
  ],
  'color-picker': [
    { key: 'color', label: 'Color', type: 'color' },
  ],
  'color-mix': [
    { key: 't', label: 'Mix', type: 'number' },
  ],
  'http-fetch': [
    { key: 'url', label: 'URL', type: 'text' },
  ],
};

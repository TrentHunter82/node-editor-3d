import { describe, it, expect } from 'vitest';
import { isOnUIPanel } from './uiDetection';

describe('isOnUIPanel', () => {
  it('returns false for null target', () => {
    expect(isOnUIPanel(null)).toBe(false);
  });

  it('returns false for a non-HTMLElement EventTarget', () => {
    const plainTarget = new EventTarget();
    expect(isOnUIPanel(plainTarget)).toBe(false);
  });

  it('returns false for an SVGElement target', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(isOnUIPanel(svg as unknown as EventTarget)).toBe(false);
  });

  it('returns false for an HTMLElement without data-ui-panel ancestor', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    try {
      expect(isOnUIPanel(div)).toBe(false);
    } finally {
      div.remove();
    }
  });

  it('returns true for an HTMLElement with data-ui-panel attribute', () => {
    const panel = document.createElement('div');
    panel.setAttribute('data-ui-panel', '');
    document.body.appendChild(panel);
    try {
      expect(isOnUIPanel(panel)).toBe(true);
    } finally {
      panel.remove();
    }
  });

  it('returns true for a child nested inside a data-ui-panel container', () => {
    const panel = document.createElement('div');
    panel.setAttribute('data-ui-panel', '');
    const child = document.createElement('span');
    panel.appendChild(child);
    document.body.appendChild(panel);
    try {
      expect(isOnUIPanel(child)).toBe(true);
    } finally {
      panel.remove();
    }
  });

  it('returns false for a sibling element outside the data-ui-panel container', () => {
    const wrapper = document.createElement('div');
    const panel = document.createElement('div');
    panel.setAttribute('data-ui-panel', '');
    const sibling = document.createElement('div');
    wrapper.appendChild(panel);
    wrapper.appendChild(sibling);
    document.body.appendChild(wrapper);
    try {
      expect(isOnUIPanel(sibling)).toBe(false);
    } finally {
      wrapper.remove();
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from './useReducedMotion';

/**
 * Tests for useReducedMotion hook.
 *
 * The hook uses useSyncExternalStore with window.matchMedia to track the
 * `(prefers-reduced-motion: reduce)` media query. In jsdom, matchMedia
 * returns `{ matches: false }` by default, so we mock it to control the
 * behavior.
 */

// Stores the registered 'change' event listeners so we can fire them manually
let changeListeners: Array<(event: { matches: boolean }) => void> = [];
let currentMatches = false;

// Factory that produces a mock MediaQueryList object
function createMockMQL(matches: boolean) {
  return {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((event: string, cb: (e: { matches: boolean }) => void) => {
      if (event === 'change') {
        changeListeners.push(cb);
      }
    }),
    removeEventListener: vi.fn((event: string, cb: (e: { matches: boolean }) => void) => {
      if (event === 'change') {
        changeListeners = changeListeners.filter(fn => fn !== cb);
      }
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

beforeEach(() => {
  changeListeners = [];
  currentMatches = false;

  // Override window.matchMedia with our controllable mock
  vi.stubGlobal('matchMedia', vi.fn((_query: string) => {
    return createMockMQL(currentMatches);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useReducedMotion', () => {
  it('returns false by default (no reduced-motion preference)', () => {
    currentMatches = false;

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
  });

  it('returns true when reduced motion is preferred', () => {
    currentMatches = true;

    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(true);
  });

  it('re-renders with the new value when the media query changes', () => {
    currentMatches = false;

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    // Simulate the OS/browser toggling reduced motion on
    act(() => {
      currentMatches = true;
      // Fire the change event to all registered listeners
      for (const listener of changeListeners) {
        listener({ matches: true });
      }
    });

    expect(result.current).toBe(true);
  });

  it('re-renders when toggling from true back to false', () => {
    currentMatches = true;

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);

    // Toggle off
    act(() => {
      currentMatches = false;
      for (const listener of changeListeners) {
        listener({ matches: false });
      }
    });

    expect(result.current).toBe(false);
  });

  it('registers an event listener on mount', () => {
    currentMatches = false;

    renderHook(() => useReducedMotion());

    // matchMedia should have been called with the correct query
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');

    // At least one 'change' listener should have been added
    expect(changeListeners.length).toBeGreaterThanOrEqual(1);
  });

  it('cleans up the event listener on unmount', () => {
    currentMatches = false;

    const { unmount } = renderHook(() => useReducedMotion());

    const listenersBefore = changeListeners.length;
    expect(listenersBefore).toBeGreaterThanOrEqual(1);

    unmount();

    // After unmount, the listener should have been removed
    expect(changeListeners.length).toBeLessThan(listenersBefore);
  });

  it('calls matchMedia with the correct media query string', () => {
    renderHook(() => useReducedMotion());

    expect(window.matchMedia).toHaveBeenCalledWith(
      '(prefers-reduced-motion: reduce)',
    );
  });
});

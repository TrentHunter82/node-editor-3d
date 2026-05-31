import { useState, useEffect } from 'react';
import type { NodeHelpEntry } from '../utils/nodeHelp';

/**
 * Lazy-loaded node help system.
 * nodeHelp.ts (~1500 lines of data) is only loaded on first use,
 * keeping it out of the initial bundle.
 */

type HelpModule = typeof import('../utils/nodeHelp');
let _module: HelpModule | null = null;
let _loadPromise: Promise<HelpModule> | null = null;
const _subscribers = new Set<() => void>();

function loadHelpModule(): Promise<HelpModule> {
  if (!_loadPromise) {
    _loadPromise = import('../utils/nodeHelp').then(mod => {
      _module = mod;
      // Notify all waiting subscribers
      for (const fn of _subscribers) fn();
      _subscribers.clear();
      return mod;
    });
  }
  return _loadPromise;
}

/**
 * React hook that lazily loads and returns node help for the given type.
 * Returns null while the module is loading (first use only — cached after).
 */
export function useNodeHelp(nodeType: string | null | undefined): NodeHelpEntry | null {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!nodeType) return;
    if (_module) return; // Already loaded
    const notify = () => forceUpdate(n => n + 1);
    _subscribers.add(notify);
    loadHelpModule();
    return () => { _subscribers.delete(notify); };
  }, [nodeType]);

  if (!nodeType || !_module) return null;
  return _module.getNodeHelp(nodeType) ?? null;
}

/**
 * Synchronous getter — returns null if module hasn't loaded yet.
 * Kicks off loading as a side effect.
 */
export function getNodeHelpLazy(nodeType: string): NodeHelpEntry | null {
  if (_module) return _module.getNodeHelp(nodeType) ?? null;
  loadHelpModule(); // Start loading
  return null;
}

/**
 * Preload the help module (call on hover of help-related UI).
 */
export function preloadNodeHelp(): void {
  loadHelpModule();
}

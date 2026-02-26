import { useSyncExternalStore } from 'react';

const MQ = '(prefers-reduced-motion: reduce)';

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MQ).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mql = window.matchMedia(MQ);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

/**
 * Returns true when the user prefers reduced motion.
 * Reacts to live changes of the OS/browser accessibility setting.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

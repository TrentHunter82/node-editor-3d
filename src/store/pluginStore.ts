import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { EditorNode, PluginNodeDef, PortConfig } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// --- Plugin Registry (module-scoped) ---

/** All registered plugin node definitions, keyed by type */
const pluginRegistry = new Map<string, PluginNodeDef>();

/** Get a plugin processor by node type, or undefined if not a plugin */
export function getPluginProcessor(
  type: string,
): ((node: EditorNode, inputs: Record<number, unknown>) => Record<number, unknown>) | undefined {
  return pluginRegistry.get(type)?.processor;
}

/** Get a plugin node definition by type */
export function getPluginDef(type: string): PluginNodeDef | undefined {
  return pluginRegistry.get(type);
}

/** Get all registered plugin definitions */
export function getAllPluginDefs(): PluginNodeDef[] {
  return Array.from(pluginRegistry.values());
}

/** Check if a type is a registered plugin type */
export function isPluginType(type: string): boolean {
  return pluginRegistry.has(type);
}

// --- Built-in type collision set ---
const builtInTypes = new Set(Object.keys(NODE_TYPE_CONFIG));

// --- Zustand store for reactive UI updates ---

interface PluginStoreState {
  /** Reactive counter that increments on any registry change (for UI re-renders) */
  registryVersion: number;
  /** Number of registered plugins */
  pluginCount: number;
}

export const usePluginStore = create<PluginStoreState>()(
  subscribeWithSelector(() => ({
    registryVersion: 0,
    pluginCount: 0,
  })),
);

// --- Registration API ---

export interface PluginRegistrationResult {
  success: boolean;
  error?: string;
}

/**
 * Register a plugin node definition.
 * Validates: no collision with built-in types, required fields present, processor is a function.
 * Returns { success: true } or { success: false, error: string }.
 */
export function registerPlugin(def: PluginNodeDef): PluginRegistrationResult {
  // Validate required fields
  if (!def.type || typeof def.type !== 'string') {
    return { success: false, error: 'Plugin must have a non-empty string "type"' };
  }
  if (!def.name || typeof def.name !== 'string') {
    return { success: false, error: 'Plugin must have a non-empty string "name"' };
  }
  if (typeof def.processor !== 'function') {
    return { success: false, error: 'Plugin must have a "processor" function' };
  }
  if (!Array.isArray(def.inputs)) {
    return { success: false, error: 'Plugin must have an "inputs" array' };
  }
  if (!Array.isArray(def.outputs)) {
    return { success: false, error: 'Plugin must have an "outputs" array' };
  }

  // Check for collision with built-in types
  if (builtInTypes.has(def.type)) {
    return { success: false, error: `Type "${def.type}" collides with a built-in node type` };
  }

  // Check for duplicate plugin registration
  if (pluginRegistry.has(def.type)) {
    return { success: false, error: `Plugin type "${def.type}" is already registered` };
  }

  // Validate port configs
  for (const port of def.inputs) {
    if (!port.label || !port.portType) {
      return { success: false, error: 'Each input port must have "label" and "portType"' };
    }
  }
  for (const port of def.outputs) {
    if (!port.label || !port.portType) {
      return { success: false, error: 'Each output port must have "label" and "portType"' };
    }
  }

  // Register
  pluginRegistry.set(def.type, { ...def });

  // Update reactive store
  usePluginStore.setState((s) => ({
    registryVersion: s.registryVersion + 1,
    pluginCount: pluginRegistry.size,
  }));

  return { success: true };
}

/**
 * Unregister a plugin node definition.
 * Existing nodes of this type are NOT deleted — they remain in the graph but
 * their processor will be unavailable. executeGraph handles missing processors
 * gracefully with an error message. This supports live-reload workflows where
 * plugins are unregistered and re-registered.
 * Returns true if it was registered and removed, false otherwise.
 */
export function unregisterPlugin(type: string): boolean {
  if (!pluginRegistry.has(type)) return false;
  pluginRegistry.delete(type);

  usePluginStore.setState((s) => ({
    registryVersion: s.registryVersion + 1,
    pluginCount: pluginRegistry.size,
  }));

  return true;
}

/**
 * Get port config for a plugin type (for addNode to create port definitions).
 */
export function getPluginPortConfig(type: string): { inputs: PortConfig[]; outputs: PortConfig[]; color: string } | undefined {
  const def = pluginRegistry.get(type);
  if (!def) return undefined;
  return { inputs: def.inputs, outputs: def.outputs, color: def.color || 'teal' };
}

// --- Window global for external plugins ---
if (typeof window !== 'undefined') {
  window.__registerPlugin = registerPlugin;
  window.__unregisterPlugin = unregisterPlugin;
}

// --- Test utility ---
export function _resetPluginRegistry(): void {
  pluginRegistry.clear();
  usePluginStore.setState({ registryVersion: 0, pluginCount: 0 });
}

import { useMemo } from 'react';
import { createMatcapTexture, MATCAP_CONFIGS, type MatcapName } from '../utils/matcap';
import type * as THREE from 'three';

// Global cache so textures are created once across all components
const textureCache = new Map<MatcapName, THREE.CanvasTexture>();

export function useMatcap(name: MatcapName): THREE.CanvasTexture {
  return useMemo(() => {
    const cached = textureCache.get(name);
    if (cached) return cached;

    const config = MATCAP_CONFIGS[name];
    const texture = createMatcapTexture(config.base, config.highlight);
    textureCache.set(name, texture);
    return texture;
  }, [name]);
}

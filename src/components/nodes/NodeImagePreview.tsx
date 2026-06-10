/**
 * NodeImagePreview — renders a node's image-typed output as a textured plane
 * floating above the node in the 3D scene. This is what makes remote image
 * workflows (ComfyUI) tangible: generated images appear in the graph itself.
 *
 * The payload convention for `image` ports is a URL string (e.g. the
 * ComfyUI /view endpoint). Textures load lazily with CORS enabled; load
 * failures simply render nothing.
 */
import { memo, useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import type { EditorNode } from '../../types';

/** Index of the first image-typed output port, or -1. */
export function firstImagePortIndex(node: Pick<EditorNode, 'outputs'>): number {
  return node.outputs.findIndex(o => o.portType === 'image');
}

interface ImagePlaneProps {
  url: string;
  /** Plane width in world units (height follows the image aspect). */
  width: number;
  /** Y offset of the plane's bottom edge above the node origin. */
  baseY: number;
}

function ImagePlane({ url, width, baseY }: ImagePlaneProps) {
  const invalidate = useThree(s => s.invalidate);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture(tex);
        invalidate(); // frameloop="demand": render the loaded texture
      },
      undefined,
      () => { /* load error — no preview */ },
    );
    return () => {
      cancelled = true;
      setTexture(prev => {
        prev?.dispose();
        return null;
      });
    };
  }, [url, invalidate]);

  if (!texture) return null;
  const img = texture.image as { width?: number; height?: number } | undefined;
  const aspect = img && img.width ? (img.height ?? 1) / img.width : 1;
  const planeH = width * aspect;

  return (
    <Billboard position={[0, baseY + planeH / 2, 0]}>
      <mesh>
        <planeGeometry args={[width, planeH]} />
        <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </Billboard>
  );
}

interface NodeImagePreviewProps {
  node: EditorNode;
  nodeW: number;
}

/**
 * Subscribes to the node's first image-typed output and shows it as a plane.
 * Renders nothing when the node has no image port or no URL yet.
 */
export const NodeImagePreview = memo(function NodeImagePreview({ node, nodeW }: NodeImagePreviewProps) {
  const portIndex = firstImagePortIndex(node);
  const value = useEditorStore(s =>
    portIndex >= 0 ? s.nodeOutputs[node.id]?.[portIndex] : undefined,
  );

  if (portIndex < 0 || typeof value !== 'string' || value.length === 0) return null;
  return <ImagePlane url={value} width={Math.max(1.6, nodeW)} baseY={0.7} />;
});

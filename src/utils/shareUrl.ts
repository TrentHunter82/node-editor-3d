import type { LegacyGraphData } from './serialization';
import { importFromJSON } from './serialization';

/**
 * URL sharing: encode a graph into a link anyone can open.
 *
 * The graph JSON is gzip-compressed (CompressionStream, with an uncompressed
 * fallback for environments without it) and base64url-encoded into the URL
 * *hash* (`#g=…`). The hash never reaches the server, so links work on any
 * static host regardless of routing, and graphs aren't logged in access logs.
 *
 * Param format: `<version>.<payload>` — `1.` gzip+base64url, `0.` plain
 * base64url. The version prefix lets the decoder evolve without breaking
 * old links.
 */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  // CompressionStream's writable side is typed WritableStream<BufferSource>;
  // Uint8Array is a BufferSource, but pipeThrough's generics are invariant.
  const reader = source.pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const hasCompressionStreams =
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Encode graph data into a share param (`1.…` gzip or `0.…` plain). */
export async function encodeGraphToShareParam(data: LegacyGraphData): Promise<string> {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  if (hasCompressionStreams) {
    const gzipped = await pipeThrough(bytes, new CompressionStream('gzip'));
    return `1.${bytesToBase64Url(gzipped)}`;
  }
  return `0.${bytesToBase64Url(bytes)}`;
}

/** Decode a share param back into validated graph data (null if invalid). */
export async function decodeShareParam(param: string): Promise<LegacyGraphData | null> {
  try {
    const dot = param.indexOf('.');
    if (dot < 1) return null;
    const version = param.slice(0, dot);
    const payload = param.slice(dot + 1);
    if (!payload) return null;

    let bytes = base64UrlToBytes(payload);
    if (version === '1') {
      if (!hasCompressionStreams) return null;
      bytes = await pipeThrough(bytes, new DecompressionStream('gzip'));
    } else if (version !== '0') {
      return null;
    }
    const json = new TextDecoder().decode(bytes);
    // importFromJSON validates the structural shape (nodes/connections/…)
    return importFromJSON(json);
  } catch {
    return null;
  }
}

/** Build a full share URL for the current location. */
export async function buildShareUrl(data: LegacyGraphData): Promise<string> {
  const param = await encodeGraphToShareParam(data);
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return `${base}#g=${param}`;
}

/** Extract the share param from a location hash, or null if absent. */
export function extractShareParam(hash: string): string | null {
  const match = /^#g=(.+)$/.exec(hash);
  return match ? match[1] : null;
}

/** Remove the share param from the address bar (so refresh doesn't re-import). */
export function clearShareParamFromLocation(): void {
  if (window.location.hash.startsWith('#g=')) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

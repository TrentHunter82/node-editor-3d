import { describe, it, expect } from 'vitest';
import {
  encodeGraphToShareParam,
  decodeShareParam,
  extractShareParam,
} from '../utils/shareUrl';
import type { LegacyGraphData } from '../utils/serialization';
import { BUILTIN_TEMPLATES } from '../utils/builtinTemplates';

function sampleGraph(): LegacyGraphData {
  const t = BUILTIN_TEMPLATES['builtin-tip-calc'];
  const nodes = Object.fromEntries(t.nodes.map(n => [n.id, structuredClone(n)]));
  const connections = Object.fromEntries(t.connections.map(c => [c.id, structuredClone(c)]));
  return { nodes, connections, groups: {}, customNodeDefs: {} };
}

describe('share URL codec', () => {
  it('round-trips a graph losslessly', async () => {
    const data = sampleGraph();
    const param = await encodeGraphToShareParam(data);
    const decoded = await decodeShareParam(param);
    expect(decoded).not.toBeNull();
    expect(decoded!.nodes).toEqual(data.nodes);
    expect(decoded!.connections).toEqual(data.connections);
  });

  it('produces a URL-safe param (no +, /, =, #, &)', async () => {
    const param = await encodeGraphToShareParam(sampleGraph());
    expect(param).toMatch(/^[01]\.[A-Za-z0-9_-]+$/);
  });

  it('compresses when CompressionStream is available', async () => {
    const data = sampleGraph();
    const param = await encodeGraphToShareParam(data);
    if (typeof CompressionStream !== 'undefined') {
      expect(param.startsWith('1.')).toBe(true);
      // Compressed param should be much smaller than raw JSON
      expect(param.length).toBeLessThan(JSON.stringify(data).length);
    } else {
      expect(param.startsWith('0.')).toBe(true);
    }
  });

  it('rejects garbage params without throwing', async () => {
    expect(await decodeShareParam('')).toBeNull();
    expect(await decodeShareParam('nodot')).toBeNull();
    expect(await decodeShareParam('1.!!!not-base64!!!')).toBeNull();
    expect(await decodeShareParam('9.QQ')).toBeNull();
    expect(await decodeShareParam('0.QQ')).toBeNull(); // valid b64, invalid JSON
  });

  it('rejects structurally invalid graph JSON', async () => {
    const bogus = btoa(JSON.stringify({ hello: 'world' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await decodeShareParam(`0.${bogus}`)).toBeNull();
  });

  it('extractShareParam parses #g= hashes only', () => {
    expect(extractShareParam('#g=1.abc')).toBe('1.abc');
    expect(extractShareParam('#other=x')).toBeNull();
    expect(extractShareParam('')).toBeNull();
    expect(extractShareParam('#g=')).toBeNull();
  });

  it('handles unicode in node titles and data', async () => {
    const data = sampleGraph();
    const firstId = Object.keys(data.nodes)[0];
    data.nodes[firstId].title = 'Σ ünïcode — 日本語 🎛️';
    data.nodes[firstId].data.note = '"quotes" & <tags>';
    const decoded = await decodeShareParam(await encodeGraphToShareParam(data));
    expect(decoded!.nodes[firstId].title).toBe('Σ ünïcode — 日本語 🎛️');
    expect(decoded!.nodes[firstId].data.note).toBe('"quotes" & <tags>');
  });
});

export type CountableSplatFormat = 'ply' | 'compressed-ply' | 'spz';

/** Read exact counts from fixed-size file headers without loading the payload. */
export function readHeaderSplatCount(format: CountableSplatFormat, prefix: Buffer): number {
  if (format === 'ply' || format === 'compressed-ply') {
    const header = prefix.toString('ascii');
    const end = header.search(/end_header\r?\n/);
    const match = end >= 0
      ? /(?:^|\r?\n)element vertex (\d+)(?:\r?\n|$)/.exec(header.slice(0, end))
      : null;
    return match?.[1] ? Number.parseInt(match[1], 10) : 0;
  }

  // Niantic SPZ header: magic, version, then uint32 point count.
  if (prefix.length >= 12 && prefix.subarray(0, 4).toString('ascii') === 'NGSP') {
    return prefix.readUInt32LE(8);
  }
  return 0;
}

/** Read exact counts from SOG/LOD metadata, including PlayCanvas cell manifests. */
export function readManifestSplatCount(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  for (const key of ['numSplats', 'splatCount', 'vertexCount', 'count']) {
    const count = record[key];
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) return Math.floor(count);
  }

  const children = (record.tree as Record<string, unknown> | undefined)?.children;
  if (Array.isArray(children)) {
    let total = 0;
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      const lods = (child as Record<string, unknown>).lods;
      if (!lods || typeof lods !== 'object') continue;
      const finest = (lods as Record<string, unknown>)['0'];
      if (!finest || typeof finest !== 'object') continue;
      const count = (finest as Record<string, unknown>).count;
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) total += Math.floor(count);
    }
    if (total > 0) return total;
  }
  return 0;
}

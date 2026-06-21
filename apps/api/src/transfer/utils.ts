import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function sha256Text(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function assertSafeRelativePath(path: string) {
  if (!path || path.includes('\\') || path.startsWith('/') || path.includes('\0')) throw new Error(`Unsafe archive path: ${path}`);
  const segments = path.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe archive path: ${path}`);
}

export async function assertRegularFile(path: string, root: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Archive entry is not a regular file: ${path}`);
  const [resolvedPath, resolvedRoot] = await Promise.all([realpath(path), realpath(root)]);
  const prefix = resolvedRoot.endsWith('/') || resolvedRoot.endsWith('\\') ? resolvedRoot : `${resolvedRoot}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!resolvedPath.startsWith(prefix)) throw new Error(`Archive entry escapes bundle root: ${path}`);
  return stat;
}

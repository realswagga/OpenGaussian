import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { TransferCryptoDescriptor } from './types.js';

const MAGIC = Buffer.from('OGENC1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
function scryptKey(passphrase: string, salt: Buffer, options: { N: number; r: number; p: number; maxmem: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(passphrase, salt, 64, options, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
  });
}

export function createCryptoDescriptor(): TransferCryptoDescriptor {
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: randomBytes(16).toString('base64'),
    cost: 32768,
    blockSize: 8,
    parallelization: 1,
  };
}

export async function deriveTransferKeys(passphrase: string, descriptor: TransferCryptoDescriptor) {
  if (passphrase.length < 12) throw new Error('Transfer passphrase must contain at least 12 characters');
  const material = await scryptKey(passphrase, Buffer.from(descriptor.salt, 'base64'), {
    N: descriptor.cost,
    r: descriptor.blockSize,
    p: descriptor.parallelization,
    maxmem: 128 * 1024 * 1024,
  });
  return { encryptionKey: material.subarray(0, 32), hmacKey: material.subarray(32, 64) };
}

export async function encryptFile(source: string, target: string, key: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const handle = await open(target, 'wx', 0o600);
  try {
    await handle.write(Buffer.concat([MAGIC, iv]));
  } finally {
    await handle.close();
  }
  await pipeline(createReadStream(source), cipher, createWriteStream(target, { flags: 'a', mode: 0o600 }));
  const output = await open(target, 'a');
  try {
    await output.write(cipher.getAuthTag());
  } finally {
    await output.close();
  }
}

export async function decryptFile(source: string, target: string, key: Buffer) {
  const handle = await open(source, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error('Encrypted file is truncated');
    const header = Buffer.alloc(MAGIC.length + IV_BYTES);
    await handle.read(header, 0, header.length, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Encrypted file header is invalid');
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(source, { start: header.length, end: stat.size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(target, { flags: 'wx', mode: 0o600 }),
    );
  } finally {
    await handle.close();
  }
}

export function manifestHmac(manifestBytes: Buffer | string, key: Buffer) {
  return createHmac('sha256', key).update(manifestBytes).digest('hex');
}

export function verifyManifestHmac(manifestBytes: Buffer, expectedHex: string, key: Buffer) {
  const expected = Buffer.from(expectedHex.trim(), 'hex');
  const actual = Buffer.from(manifestHmac(manifestBytes, key), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function readEncryptedJson<T>(source: string, key: Buffer, temporaryPath: string): Promise<T> {
  await decryptFile(source, temporaryPath, key);
  return JSON.parse(await readFile(temporaryPath, 'utf8')) as T;
}

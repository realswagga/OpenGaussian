import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCryptoDescriptor, decryptFile, deriveTransferKeys, encryptFile, manifestHmac, verifyManifestHmac } from '../crypto.js';
import { canonicalJson, assertSafeRelativePath, sha256Text } from '../utils.js';
import { parseEnv, serializeEnv, captureRuntimeConfig, redactRuntimeConfig } from '../config.js';

test('encrypts and authenticates transfer files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'og-transfer-'));
  const source = path.join(root, 'source');
  const encrypted = path.join(root, 'encrypted');
  const restored = path.join(root, 'restored');
  await writeFile(source, 'sensitive project state');
  const descriptor = createCryptoDescriptor();
  const keys = await deriveTransferKeys('correct horse battery staple', descriptor);
  await encryptFile(source, encrypted, keys.encryptionKey);
  await decryptFile(encrypted, restored, keys.encryptionKey);
  assert.equal(await readFile(restored, 'utf8'), 'sensitive project state');

  const bytes = await readFile(encrypted);
  bytes[Math.floor(bytes.length / 2)]! ^= 1;
  await writeFile(encrypted, bytes);
  await assert.rejects(() => decryptFile(encrypted, path.join(root, 'tampered'), keys.encryptionKey));
});

test('rejects wrong passphrases and authenticates canonical manifests', async () => {
  const descriptor = createCryptoDescriptor();
  const correct = await deriveTransferKeys('correct horse battery staple', descriptor);
  const wrong = await deriveTransferKeys('another sufficiently long passphrase', descriptor);
  const manifest = Buffer.from(canonicalJson({ z: 1, a: { y: true, x: 'value' } }));
  const hmac = manifestHmac(manifest, correct.hmacKey);
  assert.equal(verifyManifestHmac(manifest, hmac, correct.hmacKey), true);
  assert.equal(verifyManifestHmac(manifest, hmac, wrong.hmacKey), false);
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalJson({ defined: true, omitted: undefined }), '{"defined":true}');
});

test('validates archive paths', () => {
  assert.doesNotThrow(() => assertSafeRelativePath('objects/ab/abcdef'));
  for (const unsafe of ['../secret', '/absolute', 'objects/../secret', 'objects\\secret', '']) {
    assert.throws(() => assertSafeRelativePath(unsafe));
  }
});

test('round trips allowlisted environment configuration and redacts values', () => {
  const captured = captureRuntimeConfig({ DATABASE_URL: 'postgres://secret', JWT_SECRET: 'token', UNRELATED: 'ignored' });
  assert.deepEqual(Object.keys(captured).sort(), ['DATABASE_URL', 'JWT_SECRET']);
  const serialized = serializeEnv(captured);
  assert.deepEqual(parseEnv(serialized), captured);
  assert.deepEqual(redactRuntimeConfig(captured), { DATABASE_URL: '<redacted>', JWT_SECRET: '<redacted>' });
  assert.equal(sha256Text('same'), sha256Text('same'));
});

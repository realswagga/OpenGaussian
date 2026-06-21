import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { decryptRuntimeConfig, exportProject, importProject, listArchives, validateArchive } from './archive.js';
import { parseEnv, serializeEnv } from './config.js';
import { readFile, writeFile } from 'node:fs/promises';

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function readPassphrase() {
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    const value = Buffer.concat(chunks).toString('utf8').split(/\r?\n/, 1)[0]?.trim();
    if (!value) throw new Error('Passphrase was not provided on stdin');
    return value;
  }
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    return await readline.question('Transfer passphrase: ');
  } finally {
    readline.close();
  }
}

async function main() {
  const command = process.argv[2];
  const root = path.resolve(process.env.TRANSFER_BACKUP_DIR || '/backups');
  const prisma = new PrismaClient();
  const passphrase = ['export', 'validate', 'import', 'decrypt-config'].includes(command || '') ? await readPassphrase() : '';
  try {
    if (command === 'export') {
      const result = await exportProject({ prisma, passphrase, backupsRoot: root, name: option('name') });
      console.log(JSON.stringify({ ok: true, archive: result.path, manifest: result.manifest.id }));
      return;
    }
    if (command === 'validate') {
      const bundle = process.argv[3];
      if (!bundle) throw new Error('Usage: validate <bundle>');
      const result = await validateArchive(path.resolve(bundle), passphrase);
      console.log(JSON.stringify({ ok: true, id: result.manifest.id, rows: result.manifest.database.totalRows, objects: result.manifest.objects.length, bytes: result.manifest.objectBytes }));
      return;
    }
    if (command === 'import') {
      const bundle = process.argv[3];
      if (!bundle) throw new Error('Usage: import <bundle> --mode=fresh|replace');
      const mode = option('mode') === 'replace' ? 'replace' : 'fresh';
      const confirmed = mode === 'replace' && option('confirm') === `REPLACE:${path.basename(bundle)}`;
      const result = await importProject({ prisma, archiveRoot: path.resolve(bundle), backupsRoot: root, passphrase, mode, confirmed });
      if (process.argv.includes('--apply-config')) {
        const target = path.join(root, 'runtime.env.imported');
        await decryptRuntimeConfig(path.resolve(bundle), passphrase, target);
        const config = parseEnv(await readFile(target, 'utf8'));
        for (const value of process.argv.filter((item) => item.startsWith('--set='))) {
          const assignment = value.slice('--set='.length);
          const separator = assignment.indexOf('=');
          if (separator < 1) throw new Error(`Invalid configuration override: ${value}`);
          config[assignment.slice(0, separator)] = assignment.slice(separator + 1);
        }
        await writeFile(target, serializeEnv(config), { mode: 0o600 });
      }
      console.log(JSON.stringify({ ok: true, id: result.manifest.id, safetyArchive: result.safetyPath ?? null }));
      return;
    }
    if (command === 'decrypt-config') {
      const bundle = process.argv[3];
      const target = process.argv[4] || path.join(root, 'runtime.env.imported');
      if (!bundle) throw new Error('Usage: decrypt-config <bundle> [target]');
      await decryptRuntimeConfig(path.resolve(bundle), passphrase, path.resolve(target));
      console.log(JSON.stringify({ ok: true, target: path.resolve(target) }));
      return;
    }
    if (command === 'list') {
      console.log(JSON.stringify(await listArchives(root), null, 2));
      return;
    }
    throw new Error('Commands: export, validate <bundle>, import <bundle>, decrypt-config <bundle>, list');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

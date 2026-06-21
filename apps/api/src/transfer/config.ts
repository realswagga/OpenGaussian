export const TRANSFER_CONFIG_KEYS = [
  'NODE_ENV',
  'APP_PUBLIC_URL',
  'API_PUBLIC_URL',
  'ASSET_PUBLIC_URL',
  'DATABASE_URL',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'REDIS_URL',
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'S3_FORCE_PATH_STYLE',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'JWT_SECRET',
  'ADMIN_SEED_EMAIL',
  'ADMIN_SEED_PASSWORD',
  'MAX_UPLOAD_MB',
  'MAX_PREVIEW_UPLOAD_MB',
  'DEFAULT_LOD_BUDGET',
  'DEFAULT_MOBILE_LOD_BUDGET',
  'DEFAULT_VR_LOD_BUDGET',
  'WORKER_CONCURRENCY',
  'APP_PORT',
  'POSTGRES_PORT',
  'REDIS_PORT',
  'MINIO_API_PORT',
  'MINIO_CONSOLE_PORT',
] as const;

export type TransferRuntimeConfig = Partial<Record<(typeof TRANSFER_CONFIG_KEYS)[number], string>>;

export function captureRuntimeConfig(env: NodeJS.ProcessEnv = process.env): TransferRuntimeConfig {
  const config: TransferRuntimeConfig = {};
  for (const key of TRANSFER_CONFIG_KEYS) {
    if (env[key] !== undefined) config[key] = env[key];
  }
  return config;
}

export function serializeEnv(config: Record<string, string | undefined>) {
  return Object.entries(config)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n';
}

export function parseEnv(text: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    try { output[key] = JSON.parse(value); } catch { output[key] = value; }
  }
  return output;
}

export function redactRuntimeConfig(config: TransferRuntimeConfig) {
  return Object.fromEntries(Object.keys(config).sort().map((key) => [key, '<redacted>']));
}

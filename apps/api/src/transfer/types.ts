export const TRANSFER_ARCHIVE_VERSION = 1;

export interface TransferCryptoDescriptor {
  version: 1;
  algorithm: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  cost: number;
  blockSize: number;
  parallelization: number;
}

export interface TransferDatabaseTable {
  name: string;
  rows: number;
  digest: string;
}

export interface TransferObjectEntry {
  fileId: string;
  path: string;
  key: string;
  size: number;
  sha256: string;
  etag?: string;
  lastModified?: string;
  contentType?: string;
  contentEncoding?: string;
  cacheControl?: string;
  contentDisposition?: string;
  metadata?: Record<string, string>;
}

export interface TransferFileEntry {
  fileId: string;
  path: string;
  size: number;
  sha256: string;
  encrypted: boolean;
}

export interface TransferManifest {
  archiveVersion: 1;
  id: string;
  createdAt: string;
  appVersion: string;
  buildCommit: string | null;
  prismaSchemaSha256: string;
  database: {
    tables: TransferDatabaseTable[];
    totalRows: number;
  };
  objects: TransferObjectEntry[];
  objectBytes: number;
  bucket: string;
  configKeys: string[];
  files: TransferFileEntry[];
}

export interface TransferProgress {
  id: string;
  operation: 'export' | 'upload' | 'validate' | 'import';
  status: 'pending' | 'running' | 'completed' | 'failed';
  phase: string;
  objectsDone: number;
  objectsTotal: number;
  bytesDone: number;
  bytesTotal: number;
  message?: string;
  error?: string;
  startedAt: string;
  updatedAt: string;
}


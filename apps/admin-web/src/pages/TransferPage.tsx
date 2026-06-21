import { useEffect, useMemo, useState } from 'react';
import type { TransferArchiveSummary, TransferJobProgress } from '@gsplat/shared';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const CHUNK_BYTES = 8 * 1024 * 1024;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Request failed (${response.status})`);
  return body;
}

export default function TransferPage() {
  const { t } = useI18n();
  const [archives, setArchives] = useState<TransferArchiveSummary[]>([]);
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [name, setName] = useState('');
  const [job, setJob] = useState<TransferJobProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [restoreCommand, setRestoreCommand] = useState('');

  const load = () => fetch(`${API_BASE}/admin/transfer/archives`, { credentials: 'include' })
    .then(responseJson).then((body) => setArchives(body.items || [])).catch((reason) => setError(String(reason.message || reason)));

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!job || ['completed', 'failed'].includes(job.status)) return;
    const timer = window.setInterval(() => {
      fetch(`${API_BASE}/admin/transfer/jobs/${job.id}`, { credentials: 'include' })
        .then(responseJson)
        .then((body) => {
          setJob(body.job);
          if (body.job.status === 'completed') load();
        })
        .catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  async function authorize() {
    if (!password) throw new Error(t('transfer.passwordRequired'));
    const response = await fetch(`${API_BASE}/admin/transfer/reauth`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    });
    return (await responseJson(response)).token as string;
  }

  async function startExport() {
    setError(''); setNotice('');
    if (passphrase !== confirmPassphrase) return setError(t('transfer.passphraseMismatch'));
    setBusy(true);
    try {
      const token = await authorize();
      const response = await fetch(`${API_BASE}/admin/transfer/exports`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Transfer-Token': token },
        body: JSON.stringify({ passphrase, name: name || undefined }),
      });
      const body = await responseJson(response);
      setJob(body.job);
      setPassword(''); setPassphrase(''); setConfirmPassphrase('');
    } catch (reason: any) { setError(reason.message); } finally { setBusy(false); }
  }

  const directoryFiles = useMemo(() => {
    const map = new Map<string, File>();
    for (const file of files) {
      const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const parts = raw.split('/');
      map.set(parts.length > 1 ? parts.slice(1).join('/') : raw, file);
    }
    return map;
  }, [files]);

  async function stageDirectory() {
    setError(''); setNotice(''); setBusy(true);
    try {
      const manifestFile = directoryFiles.get('manifest.json');
      const hmacFile = directoryFiles.get('manifest.hmac');
      const cryptoFile = directoryFiles.get('crypto.json');
      if (!manifestFile || !hmacFile || !cryptoFile) throw new Error(t('transfer.invalidDirectory'));
      const [manifest, manifestHmac, crypto] = await Promise.all([
        manifestFile.text().then(JSON.parse), hmacFile.text(), cryptoFile.text().then(JSON.parse),
      ]);
      const token = await authorize();
      const init = await responseJson(await fetch(`${API_BASE}/admin/transfer/uploads`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Transfer-Token': token },
        body: JSON.stringify({ manifest, manifestHmac, crypto }),
      }));
      for (const expected of manifest.files as Array<{ fileId: string; path: string; size: number }>) {
        const file = directoryFiles.get(expected.path);
        if (!file || file.size !== expected.size) throw new Error(`${t('transfer.missingFile')}: ${expected.path}`);
        for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
          const chunk = file.slice(offset, Math.min(offset + CHUNK_BYTES, file.size));
          const end = offset + chunk.size - 1;
          await responseJson(await fetch(`${API_BASE}/admin/transfer/uploads/${init.uploadId}/files/${expected.fileId}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${end}/${file.size}` }, body: chunk,
          }));
        }
      }
      const finalizeToken = await authorize();
      const finalized = await responseJson(await fetch(`${API_BASE}/admin/transfer/uploads/${init.uploadId}/finalize`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Transfer-Token': finalizeToken },
        body: JSON.stringify({ passphrase }),
      }));
      setNotice(`${t('transfer.staged')}: ${finalized.archive}`);
      setFiles([]); setPassword(''); setPassphrase('');
      load();
    } catch (reason: any) { setError(reason.message); } finally { setBusy(false); }
  }

  async function prepareImport(id: string, mode: 'fresh' | 'replace') {
    setError(''); setBusy(true);
    try {
      const token = await authorize();
      const body = await responseJson(await fetch(`${API_BASE}/admin/transfer/archives/${encodeURIComponent(id)}/prepare-import`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Transfer-Token': token }, body: JSON.stringify({ mode }),
      }));
      setRestoreCommand(body.powershellCommand || body.command);
      setPassword('');
    } catch (reason: any) { setError(reason.message); } finally { setBusy(false); }
  }

  return (
    <div className="admin-page transfer-page">
      <header className="page-heading"><div><p className="eyebrow">{t('transfer.system')}</p><h1>{t('transfer.title')}</h1><p>{t('transfer.copy')}</p></div></header>
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="form-success">{notice}</div>}
      <section className="admin-card transfer-controls">
        <h2>{t('transfer.security')}</h2>
        <div className="form-grid">
          <label>{t('transfer.currentPassword')}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          <label>{t('transfer.passphrase')}<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" /></label>
          <label>{t('transfer.confirmPassphrase')}<input type="password" value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} autoComplete="new-password" /></label>
          <label>{t('transfer.archiveName')}<input value={name} onChange={(event) => setName(event.target.value)} placeholder="project-2026-06-21" /></label>
        </div>
        <button className="admin-button" disabled={busy} onClick={startExport}>{t('transfer.createExport')}</button>
      </section>
      {job && <section className="admin-card"><h2>{t('transfer.progress')}</h2><p>{job.phase} · {job.objectsDone}/{job.objectsTotal} · {formatBytes(job.bytesDone)}/{formatBytes(job.bytesTotal)}</p>{job.error && <div className="form-error">{job.error}</div>}</section>}
      <section className="admin-card">
        <h2>{t('transfer.stage')}</h2><p>{t('transfer.stageCopy')}</p>
        <input type="file" multiple {...({ webkitdirectory: '' } as any)} onChange={(event) => setFiles(Array.from(event.target.files || []))} />
        <button className="admin-button-secondary" disabled={busy || files.length === 0} onClick={stageDirectory}>{t('transfer.uploadValidate')}</button>
      </section>
      <section className="admin-card"><h2>{t('transfer.archives')}</h2>
        <div className="transfer-list">
          {archives.map((archive) => <article key={archive.id} className="transfer-item"><div><strong>{archive.id}</strong><p>{new Date(archive.createdAt).toLocaleString()} · {archive.totalRows} rows · {archive.objectCount} objects · {formatBytes(archive.objectBytes)}</p></div><div className="transfer-actions"><button className="admin-button-secondary" onClick={() => prepareImport(archive.id, 'fresh')}>{t('transfer.freshCommand')}</button><button className="admin-button-danger" onClick={() => prepareImport(archive.id, 'replace')}>{t('transfer.replaceCommand')}</button></div></article>)}
          {!archives.length && <p>{t('transfer.noArchives')}</p>}
        </div>
      </section>
      {restoreCommand && <section className="admin-card"><h2>{t('transfer.offlineCommand')}</h2><p>{t('transfer.offlineCopy')}</p><pre className="transfer-command">{restoreCommand}</pre></section>}
    </div>
  );
}

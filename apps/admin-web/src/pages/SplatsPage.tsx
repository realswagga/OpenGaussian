import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser, SplatSummary } from '@gsplat/shared';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || '/assets';

const statusOptions = ['ALL', 'DRAFT', 'PROCESSING', 'READY', 'PUBLISHED', 'FAILED', 'ARCHIVED'];

function posterUrl(key?: string | null) {
  return key ? `${ASSET_BASE}/${key}` : null;
}

function formatSize(bytes?: number | null) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SplatsTableSkeleton() {
  const { t } = useI18n();
  return (
    <div className="admin-table-wrap admin-table-wrap--skeleton" aria-label={t('splats.loading')}>
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="admin-skeleton-row" key={index}>
          <div className="admin-skeleton-thumb" />
          <div className="admin-skeleton-cell">
            <div className="admin-skeleton-line wide" />
            <div className="admin-skeleton-line short" />
          </div>
          <div className="admin-skeleton-line pill" />
          <div className="admin-skeleton-line pill" />
          <div className="admin-skeleton-line actions" />
        </div>
      ))}
    </div>
  );
}

export default function SplatsPage({ user }: { user: AuthUser }) {
  const { t } = useI18n();
  const [splats, setSplats] = useState<SplatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchSplats = () => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/admin/splats`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`Server error (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setSplats(data.items || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(fetchSplats, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return splats.filter((s) => {
      if (status !== 'ALL' && s.status !== status) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.organization?.name ?? '').toLowerCase().includes(q)
      );
    });
  }, [splats, search, status]);

  const postAction = async (id: string, action: 'publish' | 'unpublish') => {
    setActionLoading(`${id}:${action}`);
    try {
      const res = await fetch(`${API_BASE}/admin/splats/${id}/${action}`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || t('splats.actionFailed', { action }));
      }
      fetchSplats();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('splats.actionFailed', { action }));
    } finally {
      setActionLoading(null);
    }
  };

  const deleteSplat = async (splat: SplatSummary) => {
    if (!window.confirm(t('splats.deleteConfirm', { title: splat.title }))) return;
    setActionLoading(`${splat.id}:delete`);
    try {
      const res = await fetch(`${API_BASE}/admin/splats/${splat.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || t('splats.deleteFailed'));
      }
      fetchSplats();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('splats.deleteFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">{user.capabilities?.isMasterAdmin ? t('splats.globalLibrary') : t('splats.orgLibrary')}</p>
          <h1>{t('common.splats')}</h1>
          <p>{t('splats.copy')}</p>
        </div>
        <Link className="admin-button" to="/splats/new">{t('nav.newSplat')}</Link>
      </div>

      <div className="admin-panel admin-toolbar">
        <div className="admin-actions">
          <input className="admin-input admin-input--search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('splats.searchPlaceholder')} />
          <select className="admin-select admin-select--status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {statusOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="admin-error" style={{ marginBottom: 16 }}>{error}</div>}
      {loading && <SplatsTableSkeleton />}

      {!loading && filtered.length === 0 && <div className="admin-empty">{t('splats.noMatch')}</div>}

      {!loading && filtered.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('dashboard.splat')}</th>
                <th>{t('common.organization')}</th>
                <th>{t('common.status')}</th>
                <th>{t('splats.asset')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const image = posterUrl(s.posterKey);
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div className="admin-thumb">
                          {image && <img src={image} alt="" />}
                        </div>
                        <div>
                          <Link to={`/splats/${s.id}`} style={{ fontWeight: 700 }}>{s.title}</Link>
                          <div className="admin-muted" style={{ fontSize: 12 }}>{s.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td>{s.organization ? <span className="admin-pill">{s.organization.name}</span> : <span className="admin-muted">{t('common.unassigned')}</span>}</td>
                    <td><span className="admin-pill">{s.status}</span></td>
                    <td>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        {s.sourceFormat ? `.${s.sourceFormat}` : t('common.noSource')}<br />
                        {formatSize(s.sizeBytes)}
                      </div>
                    </td>
                    <td>
                      <div className="admin-actions">
                        <Link className="admin-button-secondary" to={`/splats/${s.id}`}>{t('splats.edit')}</Link>
                        <Link className="admin-button-secondary" to={`/splats/${s.id}/upload`}>{t('splats.upload')}</Link>
                        <Link className="admin-button-secondary" to={`/splats/${s.id}/markers-3d${s.servingVersionId ? `?versionId=${encodeURIComponent(s.servingVersionId)}` : ''}`}>{t('splats.editor3d')}</Link>
                        {s.status === 'READY' && (
                          <button className="admin-button-secondary" type="button" disabled={actionLoading === `${s.id}:publish`} onClick={() => postAction(s.id, 'publish')}>
                            {t('splats.publish')}
                          </button>
                        )}
                        {s.status === 'PUBLISHED' && (
                          <button className="admin-button-secondary" type="button" disabled={actionLoading === `${s.id}:unpublish`} onClick={() => postAction(s.id, 'unpublish')}>
                            {t('splats.unpublish')}
                          </button>
                        )}
                        {s.status === 'PUBLISHED' && <a className="admin-button-secondary" href={`/splats/${s.slug}`} target="_blank" rel="noreferrer">{t('splats.view')}</a>}
                        <button className="admin-button-secondary" type="button" disabled={actionLoading === `${s.id}:delete`} onClick={() => deleteSplat(s)}>
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

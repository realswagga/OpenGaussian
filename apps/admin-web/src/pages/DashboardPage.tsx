import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AdminDashboardStats,
  AdminLandingFeaturedResponse,
  AuthUser,
  LandingFeaturedMode,
} from '@gsplat/shared';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

function DashboardSkeleton() {
  const { t } = useI18n();
  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-skeleton-line short" />
          <div className="admin-skeleton-line title" />
          <div className="admin-skeleton-line" />
        </div>
      </div>
      <section className="admin-skeleton-grid" aria-label={t('dashboard.loading')}>
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="admin-card admin-card--skeleton" key={index}>
            <div className="admin-skeleton-line short" />
            <div className="admin-skeleton-line metric" />
          </div>
        ))}
      </section>
      <section className="admin-panel admin-panel--stacked">
        <div className="admin-skeleton-line title" />
        <div className="admin-skeleton-table" />
      </section>
    </>
  );
}

export default function DashboardPage({ user }: { user: AuthUser }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featured, setFeatured] = useState<AdminLandingFeaturedResponse | null>(null);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [featuredError, setFeaturedError] = useState('');
  const [featuredMessage, setFeaturedMessage] = useState('');
  const [featuredSaving, setFeaturedSaving] = useState(false);
  const [featuredMode, setFeaturedMode] = useState<LandingFeaturedMode>('latest');
  const [featuredSplatId, setFeaturedSplatId] = useState('');
  const isMasterAdmin = Boolean(user.capabilities?.isMasterAdmin);

  useEffect(() => {
    fetch(`${API_BASE}/admin/stats`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`Server error (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setStats(data as AdminDashboardStats);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!isMasterAdmin) return;

    setFeaturedLoading(true);
    setFeaturedError('');
    fetch(`${API_BASE}/admin/landing-featured`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`Server error (${r.status})`);
        return r.json();
      })
      .then((data: AdminLandingFeaturedResponse) => {
        setFeatured(data);
        setFeaturedMode(data.settings.mode);
        setFeaturedSplatId(data.settings.selectedSplatId ?? data.splat?.id ?? data.splats[0]?.id ?? '');
        setFeaturedLoading(false);
      })
      .catch((err) => {
        setFeaturedError(err.message);
        setFeaturedLoading(false);
      });
  }, [isMasterAdmin]);

  const saveFeaturedSettings = async () => {
    setFeaturedSaving(true);
    setFeaturedError('');
    setFeaturedMessage('');

    try {
      const res = await fetch(`${API_BASE}/admin/landing-featured`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: featuredMode,
          selectedSplatId: featuredMode === 'manual' ? featuredSplatId : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || `${t('dashboard.saveFailed')} (${res.status})`);
      }

      const data = await res.json() as AdminLandingFeaturedResponse;
      setFeatured(data);
      setFeaturedMode(data.settings.mode);
      setFeaturedSplatId(data.settings.selectedSplatId ?? data.splat?.id ?? data.splats[0]?.id ?? '');
      setFeaturedMessage(t('dashboard.featuredUpdated'));
    } catch (err) {
      setFeaturedError(err instanceof Error ? err.message : t('dashboard.saveFailed'));
    } finally {
      setFeaturedSaving(false);
    }
  };

  if (loading) return <DashboardSkeleton />;
  if (error || !stats) return <div className="admin-error">{t('dashboard.loadFailed', { error: error || 'Unknown error' })}</div>;

  const cards = [
    [t('dashboard.totalSplats'), stats.totalSplats],
    [t('dashboard.published'), stats.publishedSplats],
    [t('dashboard.processing'), stats.processingSplats],
    [t('dashboard.failed'), stats.failedSplats],
    [t('dashboard.markers'), stats.totalAnnotations],
    [t('dashboard.storage'), formatBytes(stats.storageBytesEstimate)],
  ];

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">{t('dashboard.workspace')}</p>
          <h1>{user.capabilities?.isMasterAdmin ? t('dashboard.globalOverview') : t('dashboard.orgOverview')}</h1>
          <p>{t('dashboard.copy')}</p>
        </div>
        <div className="admin-actions">
          <Link className="admin-button-secondary" to="/organizations">{t('common.organizations')}</Link>
          <Link className="admin-button" to="/splats/new">{t('nav.newSplat')}</Link>
        </div>
      </div>

      <section className="admin-grid">
        {cards.map(([label, value]) => (
          <div className="admin-card" key={label}>
            <p className="admin-stat-label">{label}</p>
            <p className="admin-stat-value">{value}</p>
          </div>
        ))}
      </section>

      {isMasterAdmin && (
        <section className="admin-panel" style={{ marginTop: 18 }}>
          <div className="admin-page-head" style={{ marginBottom: 6 }}>
            <div>
              <p className="admin-eyebrow">{t('dashboard.landing')}</p>
              <h1 style={{ fontSize: 24 }}>{t('dashboard.featuredSplat')}</h1>
              <p>{t('dashboard.featuredCopy')}</p>
            </div>
          </div>

          {featuredLoading ? (
            <div className="admin-empty">{t('dashboard.loadingFeatured')}</div>
          ) : (
            <div className="admin-form">
              {featuredError && <div className="admin-error">{featuredError}</div>}
              {featuredMessage && <div className="admin-success">{featuredMessage}</div>}

              <label className="admin-label">
                {t('dashboard.featureMode')}
                <select
                  className="admin-input"
                  value={featuredMode}
                  onChange={(event) => {
                    const mode = event.target.value as LandingFeaturedMode;
                    setFeaturedMode(mode);
                    if (mode === 'manual' && !featuredSplatId && featured?.splats[0]) {
                      setFeaturedSplatId(featured.splats[0].id);
                    }
                  }}
                >
                  <option value="manual">{t('dashboard.selectedSplat')}</option>
                  <option value="latest">{t('dashboard.latestSplat')}</option>
                  <option value="random">{t('dashboard.randomSplat')}</option>
                </select>
              </label>

              {featuredMode === 'manual' && (
                <label className="admin-label">
                  {t('dashboard.publishedSplat')}
                  <select
                    className="admin-input"
                    value={featuredSplatId}
                    onChange={(event) => setFeaturedSplatId(event.target.value)}
                    disabled={!featured?.splats.length}
                  >
                    {featured?.splats.length ? featured.splats.map((splat) => (
                      <option key={splat.id} value={splat.id}>
                        {splat.title}
                      </option>
                    )) : (
                      <option value="">{t('dashboard.noPublishedSplats')}</option>
                    )}
                  </select>
                </label>
              )}

              {featured?.splat && (
                <div className="admin-org-cell">
                  <div className="admin-thumb">
                    {featured.splat.posterUrl ? <img src={featured.splat.posterUrl} alt="" /> : <span>{featured.splat.title.slice(0, 1).toUpperCase()}</span>}
                  </div>
                  <div>
                    <strong>{featured.splat.title}</strong>
                    <div className="admin-muted" style={{ fontSize: 12 }}>{featured.splat.organization?.name ?? t('dashboard.noOrganization')}</div>
                    <div className="admin-muted" style={{ marginTop: 4 }}>
                      {t('dashboard.shownBy', { mode: featured.settings.mode === 'manual' ? t('dashboard.manualMode') : featured.settings.mode === 'latest' ? t('dashboard.latestMode') : t('dashboard.randomMode') })}
                    </div>
                  </div>
                </div>
              )}

              {!featured?.splat && <div className="admin-empty">{t('dashboard.noLandingSplats')}</div>}

              <div className="admin-actions">
                <button
                  className="admin-button"
                  type="button"
                  disabled={featuredSaving || (featuredMode === 'manual' && !featuredSplatId)}
                  onClick={() => void saveFeaturedSettings()}
                >
                  {featuredSaving ? t('common.saving') : t('dashboard.saveFeatured')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <div className="admin-page-head" style={{ marginBottom: 6 }}>
          <div>
            <p className="admin-eyebrow">{t('dashboard.queue')}</p>
            <h1 style={{ fontSize: 24 }}>{t('dashboard.recentJobs')}</h1>
          </div>
        </div>
        {stats.recentJobs.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('dashboard.splat')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.version')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentJobs.slice(0, 8).map((job) => (
                  <tr key={job.id}>
                    <td><Link to={`/splats/${job.splatId}`}>{job.splatTitle}</Link></td>
                    <td><span className="admin-pill">{job.status}</span></td>
                    <td>v{job.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-empty">{t('dashboard.noRecentJobs')}</div>
        )}
      </section>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AdminDashboardStats,
  AdminLandingFeaturedResponse,
  AuthUser,
  LandingFeaturedMode,
} from '@gsplat/shared';

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
  return (
    <>
      <div className="admin-page-head">
        <div>
          <div className="admin-skeleton-line short" />
          <div className="admin-skeleton-line title" />
          <div className="admin-skeleton-line" />
        </div>
      </div>
      <section className="admin-skeleton-grid" aria-label="Loading dashboard">
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
        throw new Error((data as { error?: { message?: string } }).error?.message || `Save failed (${res.status})`);
      }

      const data = await res.json() as AdminLandingFeaturedResponse;
      setFeatured(data);
      setFeaturedMode(data.settings.mode);
      setFeaturedSplatId(data.settings.selectedSplatId ?? data.splat?.id ?? data.splats[0]?.id ?? '');
      setFeaturedMessage('Landing featured splat updated.');
    } catch (err) {
      setFeaturedError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setFeaturedSaving(false);
    }
  };

  if (loading) return <DashboardSkeleton />;
  if (error || !stats) return <div className="admin-error">Failed to load dashboard: {error || 'Unknown error'}</div>;

  const cards = [
    ['Total splats', stats.totalSplats],
    ['Published', stats.publishedSplats],
    ['Processing', stats.processingSplats],
    ['Failed', stats.failedSplats],
    ['Markers', stats.totalAnnotations],
    ['Storage', formatBytes(stats.storageBytesEstimate)],
  ];

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">Workspace</p>
          <h1>{user.capabilities?.isMasterAdmin ? 'Global overview' : 'Organization overview'}</h1>
          <p>Operational status for the splats you can manage.</p>
        </div>
        <div className="admin-actions">
          <Link className="admin-button-secondary" to="/organizations">Organizations</Link>
          <Link className="admin-button" to="/splats/new">New splat</Link>
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
              <p className="admin-eyebrow">Landing page</p>
              <h1 style={{ fontSize: 24 }}>Featured splat</h1>
              <p>Choose which published splat appears in the public hero.</p>
            </div>
          </div>

          {featuredLoading ? (
            <div className="admin-empty">Loading featured settings...</div>
          ) : (
            <div className="admin-form">
              {featuredError && <div className="admin-error">{featuredError}</div>}
              {featuredMessage && <div className="admin-success">{featuredMessage}</div>}

              <label className="admin-label">
                Feature mode
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
                  <option value="manual">Selected splat</option>
                  <option value="latest">Latest published splat</option>
                  <option value="random">Random published splat</option>
                </select>
              </label>

              {featuredMode === 'manual' && (
                <label className="admin-label">
                  Published splat
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
                      <option value="">No published splats</option>
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
                    <div className="admin-muted" style={{ fontSize: 12 }}>{featured.splat.organization?.name ?? 'No organization'}</div>
                    <div className="admin-muted" style={{ marginTop: 4 }}>
                      Currently shown by {featured.settings.mode === 'manual' ? 'manual selection' : featured.settings.mode === 'latest' ? 'latest published mode' : 'random mode'}.
                    </div>
                  </div>
                </div>
              )}

              {!featured?.splat && <div className="admin-empty">No published splats are available for the landing page.</div>}

              <div className="admin-actions">
                <button
                  className="admin-button"
                  type="button"
                  disabled={featuredSaving || (featuredMode === 'manual' && !featuredSplatId)}
                  onClick={() => void saveFeaturedSettings()}
                >
                  {featuredSaving ? 'Saving...' : 'Save featured settings'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="admin-panel" style={{ marginTop: 18 }}>
        <div className="admin-page-head" style={{ marginBottom: 6 }}>
          <div>
            <p className="admin-eyebrow">Queue</p>
            <h1 style={{ fontSize: 24 }}>Recent jobs</h1>
          </div>
        </div>
        {stats.recentJobs.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Splat</th>
                  <th>Status</th>
                  <th>Version</th>
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
          <div className="admin-empty">No recent jobs.</div>
        )}
      </section>
    </>
  );
}

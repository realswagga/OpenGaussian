import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminDashboardStats, AuthUser } from '@gsplat/shared';

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

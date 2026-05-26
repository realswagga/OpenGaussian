import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge, Spinner } from '@gsplat/ui';
import type { AdminDashboardStats } from '@gsplat/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const statusColors: Record<string, string> = {
  PUBLISHED: '#22c55e',
  DRAFT: '#737373',
  PROCESSING: '#eab308',
  READY: '#a3a3a3',
  FAILED: '#ef4444',
  ARCHIVED: '#3a3a3a',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function DashboardPage() {
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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div style={{ padding: '2rem 0' }}>
        <Card style={{ borderColor: '#ef4444', background: '#1a0a0a', padding: '1.5rem' }}>
          <p style={{ color: '#ef4444', margin: 0, fontSize: '0.875rem' }}>
            Failed to load dashboard stats: {error || 'Unknown error'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '0.75rem', padding: '0.375rem 1rem', background: '#ffffff', border: 'none',
              borderRadius: 6, color: '#050505', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </Card>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Splats', value: stats.totalSplats },
    { label: 'Published', value: stats.publishedSplats, color: '#22c55e' },
    { label: 'Processing', value: stats.processingSplats, color: '#eab308' },
    { label: 'Failed', value: stats.failedSplats, color: '#ef4444' },
  ];

  const distribution = [
    { label: 'Draft', count: stats.draftSplats, color: '#737373' },
    { label: 'Processing', count: stats.processingSplats, color: '#eab308' },
    { label: 'Ready', count: stats.readySplats, color: '#a3a3a3' },
    { label: 'Published', count: stats.publishedSplats, color: '#22c55e' },
    { label: 'Failed', count: stats.failedSplats, color: '#ef4444' },
    { label: 'Archived', count: stats.archivedSplats, color: '#3a3a3a' },
  ].filter((d) => d.count > 0);

  const maxDist = Math.max(...distribution.map((d) => d.count), 1);

  return (
    <div style={{ paddingTop: '0.5rem' }}>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {statCards.map((s) => (
          <Card key={s.label} style={{ padding: '1.25rem 1.5rem' }}>
            <p style={{ fontSize: '0.6875rem', color: '#737373', margin: '0 0 0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {s.label}
            </p>
            <p style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: s.color || '#f5f5f5' }}>
              {s.value}
            </p>
          </Card>
        ))}

        {/* Storage / annotations card */}
        <Card style={{ padding: '1.25rem 1.5rem' }}>
          <p style={{ fontSize: '0.6875rem', color: '#737373', margin: '0 0 0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Storage (est.)
          </p>
          <p style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: '#f5f5f5' }}>
            {formatBytes(stats.storageBytesEstimate)}
          </p>
        </Card>

        <Card style={{ padding: '1.25rem 1.5rem' }}>
          <p style={{ fontSize: '0.6875rem', color: '#737373', margin: '0 0 0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Marks
          </p>
          <p style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: '#f5f5f5' }}>
            {stats.totalAnnotations}
          </p>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* Status distribution */}
        <Card style={{ padding: '1.25rem 1.5rem' }}>
          <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 1rem 0', color: '#f5f5f5' }}>
            Status Distribution
          </h3>
          {distribution.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: '#737373', margin: 0 }}>No splats yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {distribution.map((d) => (
                <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                  <span style={{ width: 70, fontSize: '0.75rem', color: '#a3a3a3' }}>{d.label}</span>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#1a1a1a', overflow: 'hidden' }}>
                    <div style={{
                      width: `${(d.count / maxDist) * 100}%`,
                      height: '100%',
                      borderRadius: 3,
                      background: d.color,
                      transition: 'width 400ms ease',
                    }} />
                  </div>
                  <span style={{ width: 24, textAlign: 'right', fontSize: '0.75rem', color: '#f5f5f5', fontWeight: 600 }}>
                    {d.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent jobs */}
        <Card style={{ padding: '1.25rem 1.5rem' }}>
          <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, margin: '0 0 1rem 0', color: '#f5f5f5' }}>
            Recent Jobs
          </h3>
          {stats.recentJobs.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: '#737373', margin: 0 }}>No recent jobs.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <th style={{ textAlign: 'left', padding: '0.375rem 0.5rem', color: '#737373', fontWeight: 400 }}>Splat</th>
                  <th style={{ textAlign: 'left', padding: '0.375rem 0.5rem', color: '#737373', fontWeight: 400 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentJobs.slice(0, 6).map((job) => (
                  <tr key={job.id} style={{ borderBottom: '1px solid #0d0d0d' }}>
                    <td style={{ padding: '0.375rem 0.5rem' }}>
                      <Link to={`/splats/${job.splatId}`} style={{ color: '#f5f5f5', textDecoration: 'none', fontSize: '0.75rem' }}>
                        {job.splatTitle}
                      </Link>
                      <span style={{ color: '#737373', fontSize: '0.6875rem', marginLeft: '0.375rem' }}>v{job.version}</span>
                    </td>
                    <td style={{ padding: '0.375rem 0.5rem' }}>
                      <Badge variant={
                        job.status === 'READY' ? 'success' :
                        job.status === 'FAILED' ? 'danger' :
                        job.status === 'RUNNING' ? 'warning' :
                        'default'
                      }>
                        {job.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <Link
          to="/splats/new"
          style={{
            padding: '0.5rem 1.25rem', background: '#ffffff', color: '#050505', borderRadius: 6,
            textDecoration: 'none', fontWeight: 600, fontSize: '0.8125rem',
            display: 'inline-block',
          }}
        >
          + New Splat
        </Link>
        <Link
          to="/splats"
          style={{
            padding: '0.5rem 1.25rem', background: '#171717', border: '1px solid #2a2a2a',
            borderRadius: 6, color: '#f5f5f5', textDecoration: 'none', fontSize: '0.8125rem',
            display: 'inline-block',
          }}
        >
          View All Splats
        </Link>
      </div>
    </div>
  );
}

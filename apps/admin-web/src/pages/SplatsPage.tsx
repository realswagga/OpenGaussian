import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { SplatSummary } from '@gsplat/shared';
import { Card, Badge, Button, Spinner, Input, Select, Modal } from '@gsplat/ui';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || '/assets';

const statusOptions = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'READY', label: 'Ready' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const statusVariant: Record<string, 'default' | 'success' | 'danger' | 'warning'> = {
  PUBLISHED: 'success',
  READY: 'default',
  DRAFT: 'default',
  PROCESSING: 'warning',
  FAILED: 'danger',
  ARCHIVED: 'default',
};

function getPosterUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `${ASSET_BASE}/${key}`;
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SplatsPage() {
  const [splats, setSplats] = useState<SplatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [deleteConfirm, setDeleteConfirm] = useState<SplatSummary | null>(null);
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

  useEffect(() => { fetchSplats(); }, []);

  const filtered = useMemo(() => {
    return splats.filter((s) => {
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (search && !s.title.toLowerCase().includes(search.toLowerCase()) && !s.slug.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [splats, search, statusFilter]);

  const doAction = async (id: string, action: string, url: string) => {
    setActionLoading(id);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || `${action} failed`);
      }
      fetchSplats();
    } catch (err) {
      alert(`${action}: ${err instanceof Error ? err.message : 'Error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setActionLoading(deleteConfirm.id);
    try {
      await fetch(`${API_BASE}/admin/splats/${deleteConfirm.id}`, { method: 'DELETE', credentials: 'include' });
      setDeleteConfirm(null);
      fetchSplats();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : 'Error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Render ──

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div style={{ paddingTop: '0.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Splats</h1>
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
      </div>

      {/* Error banner */}
      {error && (
        <Card style={{ borderColor: '#ef4444', background: '#1a0a0a', padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ color: '#ef4444', margin: 0, fontSize: '0.8125rem' }}>Error: {error}</p>
          <button onClick={fetchSplats} style={{ marginTop: '0.5rem', padding: '0.25rem 0.75rem', background: '#ffffff', border: 'none', borderRadius: 4, color: '#050505', fontSize: '0.75rem', cursor: 'pointer' }}>
            Retry
          </button>
        </Card>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <Input
          type="text"
          value={search}
          onChange={setSearch}
          placeholder="Search splats..."
          style={{ width: 260 }}
        />
        <Select
          options={statusOptions}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <Card style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: '#a3a3a3', fontSize: '0.875rem', margin: '0 0 1rem' }}>
            {splats.length === 0 ? 'No splats yet. Create one to get started.' : 'No splats match your filters.'}
          </p>
          {splats.length === 0 && (
            <Link
              to="/splats/new"
              style={{
                padding: '0.5rem 1.25rem', background: '#ffffff', color: '#050505', borderRadius: 6,
                textDecoration: 'none', fontWeight: 600, fontSize: '0.8125rem', display: 'inline-block',
              }}
            >
              Create First Splat
            </Link>
          )}
        </Card>
      )}

      {/* Card grid */}
      {filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.75rem' }}>
          {filtered.map((s) => {
            const posterUrl = getPosterUrl(s.posterKey);
            return (
              <Card key={s.id} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {/* Poster thumbnail */}
                <div style={{
                  width: '100%', height: 140, borderRadius: 6, background: '#111111',
                  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid #1a1a1a',
                }}>
                  {posterUrl ? (
                    <img src={posterUrl} alt={s.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ color: '#2a2a2a', fontSize: '0.75rem' }}>No preview</span>
                  )}
                </div>

                {/* Title + status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <div style={{ minWidth: 0 }}>
                    <Link
                      to={`/splats/${s.id}`}
                      style={{ color: '#f5f5f5', textDecoration: 'none', fontWeight: 600, fontSize: '0.875rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {s.title}
                    </Link>
                    <span style={{ fontSize: '0.6875rem', color: '#737373' }}>{s.slug}</span>
                  </div>
                  <Badge variant={statusVariant[s.status] || 'default'}>{s.status}</Badge>
                </div>

                {/* Metadata row */}
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.6875rem', color: '#737373' }}>
                  {s.splatCount != null && <span>{s.splatCount.toLocaleString()} splats</span>}
                  {s.sourceFormat && <span>.{s.sourceFormat}</span>}
                  {s.sizeBytes != null && <span>{formatSize(s.sizeBytes)}</span>}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginTop: 'auto' }}>
                  <Link
                    to={`/splats/${s.id}`}
                    style={{
                      padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
                      background: '#171717', border: '1px solid #2a2a2a', color: '#a3a3a3', textDecoration: 'none',
                    }}
                  >
                    Edit
                  </Link>
                  <Link
                    to={`/splats/${s.id}/upload`}
                    style={{
                      padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
                      background: '#171717', border: '1px solid #2a2a2a', color: '#a3a3a3', textDecoration: 'none',
                    }}
                  >
                    Upload
                  </Link>
                  <Link
                    to={`/splats/${s.id}/markers-3d`}
                    style={{
                      padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
                      background: '#171717', border: '1px solid #2a2a2a', color: '#a3a3a3', textDecoration: 'none',
                    }}
                  >
                    3D Editor
                  </Link>

                  {s.status === 'READY' && (
                    <button
                      onClick={() => doAction(s.id, 'Publish', `${API_BASE}/admin/splats/${s.id}/publish`)}
                      disabled={actionLoading === s.id}
                      style={{
                        padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
                        background: 'none', border: '1px solid #22c55e', color: '#22c55e', cursor: 'pointer',
                      }}
                    >
                      {actionLoading === s.id ? '...' : 'Publish'}
                    </button>
                  )}
                  {s.status === 'PUBLISHED' && (
                    <button
                      onClick={() => doAction(s.id, 'Unpublish', `${API_BASE}/admin/splats/${s.id}/unpublish`)}
                      disabled={actionLoading === s.id}
                      style={{
                        padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
                        background: 'none', border: '1px solid #eab308', color: '#eab308', cursor: 'pointer',
                      }}
                    >
                      {actionLoading === s.id ? '...' : 'Unpublish'}
                    </button>
                  )}
                  <button
                    onClick={() => setDeleteConfirm(s)}
                    style={{
                      padding: '0.25rem 0.625rem', fontSize: '0.6875rem', borderRadius: 4,
                      background: 'none', border: '1px solid #ef4444', color: '#ef4444', cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Splat">
        <p style={{ fontSize: '0.875rem', color: '#a3a3a3', marginBottom: '1rem' }}>
          Are you sure you want to delete <strong style={{ color: '#f5f5f5' }}>{deleteConfirm?.title}</strong>?
          This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={actionLoading === deleteConfirm?.id}>
            {actionLoading === deleteConfirm?.id ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

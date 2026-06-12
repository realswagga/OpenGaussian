import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { Card, Badge, Button, Spinner, Tabs } from '@gsplat/ui';
import type { AdminOrganization, AuthUser } from '@gsplat/shared';
import PreviewImageEditor from '../components/PreviewImageEditor';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

interface SplatFormData {
  title: string;
  slug: string;
  description: string;
  organizationId: string;
}

interface VersionItem {
  id: string;
  version: number;
  sourceKey: string;
  convertedKey?: string;
  lodKey?: string;
  posterKey?: string;
  processingStatus: string;
  processingLog?: string;
  metrics?: unknown;
  createdAt: string;
  updatedAt: string;
}

function MetadataTab({ form, setForm, saving, error, onSubmit, isNew, navigate, organizations }: {
  form: SplatFormData;
  setForm: (f: SplatFormData) => void;
  saving: boolean;
  error: string;
  onSubmit: (e: FormEvent) => void;
  isNew: boolean;
  navigate: ReturnType<typeof useNavigate>;
  organizations: AdminOrganization[];
}) {
  const fieldStyle: React.CSSProperties = {
    padding: '0.5rem 0.625rem',
    background: '#111111',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    color: '#f5f5f5',
    fontSize: '0.8125rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  return (
    <Card style={{ padding: '1.5rem' }}>
      <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, margin: '0 0 1.25rem 0' }}>
        {isNew ? 'Create Splat' : 'Edit Metadata'}
      </h2>

      {error && (
        <div style={{ padding: '0.625rem 0.75rem', background: '#1a0a0a', border: '1px solid #ef4444', borderRadius: 6, marginBottom: '1rem', color: '#ef4444', fontSize: '0.8125rem' }}>
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.6875rem', color: '#737373' }}>Organization</span>
          <select value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} required style={fieldStyle}>
            <option value="">Select organization</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.6875rem', color: '#737373' }}>Title</span>
          <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required style={fieldStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.6875rem', color: '#737373' }}>URL handle</span>
          <input type="text" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required pattern="[a-z0-9-]+" placeholder="my-scene" style={fieldStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.6875rem', color: '#737373' }}>Description</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
        </label>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/splats')}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function VersionsTab({ versions, loading }: { versions: VersionItem[]; loading: boolean }) {
  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}><Spinner size="sm" /></div>;

  if (versions.length === 0) {
    return (
      <Card style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: '#737373', fontSize: '0.8125rem', margin: '0 0 0.75rem' }}>No versions yet. Upload a file to create one.</p>
      </Card>
    );
  }

  return (
    <Card style={{ padding: '0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
            <th style={thStyle}>Version</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Source</th>
            <th style={thStyle}>Log</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
              <td style={tdStyle}>
                <span style={{ fontWeight: 600 }}>v{v.version}</span>
              </td>
              <td style={tdStyle}>
                <Badge variant={
                  v.processingStatus === 'READY' ? 'success' :
                  v.processingStatus === 'FAILED' ? 'danger' :
                  v.processingStatus === 'RUNNING' ? 'warning' : 'default'
                }>
                  {v.processingStatus}
                </Badge>
              </td>
              <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.6875rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.sourceKey?.split('/').pop() || '—'}
              </td>
              <td style={{ ...tdStyle, color: '#737373', fontSize: '0.6875rem', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.processingLog?.split('\n').pop() || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function PreviewTab({ splatId, posterKey, onPosterChanged }: {
  splatId: string;
  posterKey: string | null;
  onPosterChanged: (posterKey: string | null) => void;
}) {
  return (
    <PreviewImageEditor
      currentKey={posterKey}
      outputFilename={`preview-${splatId}.jpg`}
      uploadUrl={`${API_BASE}/admin/splats/${splatId}/preview`}
      resetUrl={`${API_BASE}/admin/splats/${splatId}/preview`}
      historyUrl={`${API_BASE}/admin/splats/${splatId}/previews`}
      incomingSourceKey={`gsplat_taken_preview_${splatId}`}
      onUploaded={onPosterChanged}
      onReset={() => onPosterChanged(null)}
    />
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.5rem 1rem', color: '#737373', fontWeight: 400, fontSize: '0.6875rem' };
const tdStyle: React.CSSProperties = { padding: '0.5rem 1rem' };

export default function SplatEditPage(_props: { user?: AuthUser }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isNew = !id || id === 'new';

  const [form, setForm] = useState<SplatFormData>({ title: '', slug: '', description: '', organizationId: '' });
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [splatId, setSplatId] = useState<string | null>(isNew ? null : id!);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [posterKey, setPosterKey] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState('metadata');

  // Current splat status for context actions
  const [splatStatus, setSplatStatus] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Version history
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/admin/organizations`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        const items = data.items || [];
        setOrganizations(items);
        setForm((current) => current.organizationId ? current : { ...current, organizationId: items[0]?.id || '' });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab === 'metadata' || tab === 'versions' || tab === 'preview') {
      setActiveTabId(tab);
    }
  }, [location.search]);

  useEffect(() => {
    if (isNew) return;

    setLoading(true);
    setError('');
    fetch(`${API_BASE}/admin/splats/${id}`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`Not found (${r.status})`);
        return r.json();
      })
      .then((data) => {
        // API returns { splat: { ... } }
        const s = data.splat || data;
        setForm({ title: s.title || '', slug: s.slug || '', description: s.description || '', organizationId: s.organizationId || '' });
        setSplatId(s.id || id);
        setSplatStatus(s.status || '');
        setPosterKey(s.posterKey || null);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id, isNew]);

  // Load versions when in edit mode
  useEffect(() => {
    if (isNew || !splatId) return;
    setVersionsLoading(true);
    fetch(`${API_BASE}/admin/splats/${splatId}/versions`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setVersions(data.items || []);
        setVersionsLoading(false);
      })
      .catch(() => setVersionsLoading(false));
  }, [splatId, isNew]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const url = isNew ? `${API_BASE}/admin/splats` : `${API_BASE}/admin/splats/${splatId}`;
      const method = isNew ? 'POST' : 'PATCH';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ...form, description: form.description || undefined }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || 'Save failed');
      }
      if (isNew) {
        const data = await res.json();
        const newId = data.splat?.id || data.id;
        navigate(`/splats/${newId}`);
      } else {
        setSaving(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  const doAction = async (action: string, url: string) => {
    setActionLoading(true);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || `${action} failed`);
      }
      // Refresh status
      const res = await fetch(`${API_BASE}/admin/splats/${splatId}`, { credentials: 'include' });
      const data = await res.json();
      const s = data.splat || data;
      setSplatStatus(s.status || '');
    } catch (err) {
      alert(`${action}: ${err instanceof Error ? err.message : 'Error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}><Spinner size="md" /></div>;
  }

  if (error) {
    return (
      <div style={{ paddingTop: '0.5rem' }}>
        <Card style={{ borderColor: '#ef4444', background: '#1a0a0a', padding: '1.5rem' }}>
          <p style={{ color: '#ef4444', margin: '0 0 1rem', fontSize: '0.875rem' }}>
            Failed to load splat: {error}
          </p>
          <Button variant="secondary" onClick={() => navigate('/splats')}>← Back to Splats</Button>
        </Card>
      </div>
    );
  }

  // If new, just show the form
  if (isNew) {
    return (
      <div style={{ paddingTop: '0.5rem', maxWidth: 600 }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem' }}>New Splat</h1>
        <MetadataTab form={form} setForm={setForm} saving={saving} error={error} onSubmit={handleSubmit} isNew={true} navigate={navigate} organizations={organizations} />
      </div>
    );
  }

  // Edit mode: tabbed interface with context actions
  const tabs = [
    {
      id: 'metadata',
      label: 'Metadata',
      content: <MetadataTab form={form} setForm={setForm} saving={saving} error={error} onSubmit={handleSubmit} isNew={false} navigate={navigate} organizations={organizations} />,
    },
    {
      id: 'versions',
      label: `Versions (${versions.length})`,
      content: <VersionsTab versions={versions} loading={versionsLoading} />,
    },
    {
      id: 'preview',
      label: 'Preview',
      content: splatId ? <PreviewTab splatId={splatId} posterKey={posterKey} onPosterChanged={setPosterKey} /> : null,
    },
  ];

  return (
    <div style={{ paddingTop: '0.5rem' }}>
      {/* Header with status badge and context actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.25rem 0' }}>{form.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Badge variant={
              splatStatus === 'PUBLISHED' ? 'success' :
              splatStatus === 'FAILED' ? 'danger' :
              splatStatus === 'PROCESSING' ? 'warning' :
              'default'
            }>
              {splatStatus || 'DRAFT'}
            </Badge>
            <span style={{ fontSize: '0.6875rem', color: '#737373' }}>{form.slug}</span>
          </div>
        </div>

        {/* Context action buttons */}
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          {splatStatus === 'PUBLISHED' && (
            <Button size="sm" variant="secondary" onClick={() => window.location.assign(`/splats/${encodeURIComponent(form.slug)}`)}>
              Take preview
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => navigate(`/splats/${splatId}/upload`)}>
            ↑ Upload
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate(`/splats/${splatId}/markers-3d`)}>
            ◧ 3D Editor
          </Button>
          {splatStatus === 'READY' && (
            <Button size="sm" variant="primary" disabled={actionLoading}
              onClick={() => doAction('Publish', `${API_BASE}/admin/splats/${splatId}/publish`)}>
              {actionLoading ? '...' : 'Publish'}
            </Button>
          )}
          {splatStatus === 'PUBLISHED' && (
            <Button size="sm" variant="secondary" disabled={actionLoading}
              style={{ borderColor: '#eab308', color: '#eab308' }}
              onClick={() => doAction('Unpublish', `${API_BASE}/admin/splats/${splatId}/unpublish`)}>
              {actionLoading ? '...' : 'Unpublish'}
            </Button>
          )}
        </div>
      </div>

      <p style={{ fontSize: '0.75rem', color: '#737373', margin: '0 0 1rem 0' }}>Edit splat details and manage versions.</p>

      <Tabs tabs={tabs} activeTabId={activeTabId} onTabChange={setActiveTabId} />
    </div>
  );
}

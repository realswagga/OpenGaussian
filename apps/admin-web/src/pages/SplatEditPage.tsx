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
  splatId?: string;
  version: number;
  sourceKey: string;
  convertedKey?: string | null;
  lodKey?: string | null;
  posterKey?: string | null;
  productionFormat?: string | null;
  splatCount?: number | null;
  sizeBytes?: number | null;
  settingsKey?: string | null;
  processingStatus: string;
  processingLog?: string | null;
  metrics?: unknown;
  markerCount?: number;
  isServed?: boolean;
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
    background: 'var(--color-input)',
    border: 'var(--rule)',
    borderRadius: 6,
    color: 'var(--admin-ink, var(--color-ink))',
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
        <div style={{ padding: '0.625rem 0.75rem', background: 'oklch(70% 0.14 25 / 0.14)', border: '1px solid var(--admin-danger, var(--color-error))', borderRadius: 6, marginBottom: '1rem', color: 'var(--admin-danger, var(--color-error))', fontSize: '0.8125rem' }}>
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--admin-muted, var(--color-muted))' }}>Organization</span>
          <select value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })} required style={fieldStyle}>
            <option value="">Select organization</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--admin-muted, var(--color-muted))' }}>Title</span>
          <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required style={fieldStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--admin-muted, var(--color-muted))' }}>URL handle</span>
          <input type="text" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required pattern="[a-z0-9-]+" placeholder="my-scene" style={fieldStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.6875rem', color: 'var(--admin-muted, var(--color-muted))' }}>Description</span>
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

function VersionsTab({ splatId, versions, loading, servingVersionId, actionLoading, onServe }: {
  splatId: string;
  versions: VersionItem[];
  loading: boolean;
  servingVersionId: string | null;
  actionLoading: string | null;
  onServe: (version: VersionItem) => void;
}) {
  const outputLabel = (version: VersionItem) => {
    const key = version.lodKey || version.convertedKey || version.sourceKey;
    return key?.split('/').pop() || '-';
  };

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}><Spinner size="sm" /></div>;

  if (versions.length === 0) {
    return (
      <Card style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.8125rem', margin: '0 0 0.75rem' }}>No versions yet. Upload a file to create one.</p>
      </Card>
    );
  }

  return (
    <Card style={{ padding: '0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
        <thead>
          <tr style={{ borderBottom: 'var(--rule)' }}>
            <th style={thStyle}>Version</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Output</th>
            <th style={thStyle}>Markers</th>
            <th style={thStyle}>Log</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
              <td style={tdStyle}>
                <span style={{ fontWeight: 600 }}>v{v.version}</span>
                {(v.isServed || servingVersionId === v.id) && (
                  <Badge variant="success" style={{ marginLeft: 8 }}>Served</Badge>
                )}
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
              <td style={{ ...tdStyle, maxWidth: 240 }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.6875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {outputLabel(v)}
                  </span>
                  <span style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.6875rem' }}>
                    {v.productionFormat || 'source'}{v.posterKey ? ' / preview' : ''}{v.settingsKey ? ' / settings' : ''}
                  </span>
                </div>
              </td>
              <td style={tdStyle}>{v.markerCount ?? 0}</td>
              <td style={{ ...tdStyle, color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.6875rem', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.processingLog?.split('\n').pop() || '—'}
              </td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Link className="admin-button-secondary" to={`/splats/${splatId}/markers-3d?versionId=${encodeURIComponent(v.id)}`}>3D editor</Link>
                  {v.processingStatus === 'READY' && !(v.isServed || servingVersionId === v.id) && (
                    <button className="admin-button-secondary" type="button" disabled={actionLoading === v.id} onClick={() => onServe(v)}>
                      {actionLoading === v.id ? 'Serving...' : 'Serve'}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function PreviewTab({ splatId, versions, selectedVersionId, onSelectedVersionIdChange, posterKey, onPosterChanged }: {
  splatId: string;
  versions: VersionItem[];
  selectedVersionId: string | null;
  onSelectedVersionIdChange: (versionId: string) => void;
  posterKey: string | null;
  onPosterChanged: (posterKey: string | null, versionId?: string | null) => void;
}) {
  const selectedVersion = versions.find((v) => v.id === selectedVersionId) || null;
  const baseUrl = selectedVersion
    ? `${API_BASE}/admin/splats/${splatId}/versions/${selectedVersion.id}`
    : `${API_BASE}/admin/splats/${splatId}`;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {versions.length > 0 && (
        <label className="admin-label" style={{ maxWidth: 320 }}>
          Preview version
          <select className="admin-select" value={selectedVersionId || ''} onChange={(event) => onSelectedVersionIdChange(event.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>v{v.version}{v.isServed ? ' (served)' : ''}</option>
            ))}
          </select>
        </label>
      )}
      <PreviewImageEditor
        currentKey={selectedVersion?.posterKey ?? posterKey}
        outputFilename={`preview-${splatId}${selectedVersion ? `-v${selectedVersion.version}` : ''}.jpg`}
        uploadUrl={`${baseUrl}/preview`}
        resetUrl={`${baseUrl}/preview`}
        historyUrl={`${baseUrl}/previews`}
        incomingSourceKey={`gsplat_taken_preview_${splatId}`}
        onUploaded={(key) => onPosterChanged(key, selectedVersion?.id ?? null)}
        onReset={() => onPosterChanged(null, selectedVersion?.id ?? null)}
      />
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.5rem 1rem', color: 'var(--admin-muted, var(--color-muted))', fontWeight: 400, fontSize: '0.6875rem' };
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
  const [servingVersionId, setServingVersionId] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);

  // Current splat status for context actions
  const [splatStatus, setSplatStatus] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [versionActionLoading, setVersionActionLoading] = useState<string | null>(null);

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
        setServingVersionId(s.servingVersionId || null);
        setPreviewVersionId((current) => current || s.servingVersionId || null);
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
        const items = data.items || [];
        setVersions(items);
        setPreviewVersionId((current) => current || items.find((v: VersionItem) => v.isServed)?.id || items[0]?.id || null);
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

  const serveVersion = async (version: VersionItem) => {
    if (!splatId) return;
    setVersionActionLoading(version.id);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/splats/${splatId}/versions/${version.id}/serve`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || 'Serve version failed');
      }
      const data = await res.json();
      const nextSplat = data.splat || {};
      setServingVersionId(version.id);
      setPreviewVersionId(version.id);
      setPosterKey(nextSplat.posterKey || version.posterKey || null);
      setSplatStatus(nextSplat.status || splatStatus);
      setVersions((current) => current.map((item) => ({ ...item, isServed: item.id === version.id })));
    } catch (err) {
      alert(`Serve version: ${err instanceof Error ? err.message : 'Serve version failed'}`);
    } finally {
      setVersionActionLoading(null);
    }
  };

  const handlePosterChanged = (nextPosterKey: string | null, versionId?: string | null) => {
    if (versionId) {
      setVersions((current) => current.map((item) => (
        item.id === versionId ? { ...item, posterKey: nextPosterKey } : item
      )));
      if (servingVersionId === versionId) setPosterKey(nextPosterKey);
      return;
    }
    setPosterKey(nextPosterKey);
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}><Spinner size="md" /></div>;
  }

  if (error) {
    return (
      <div style={{ paddingTop: '0.5rem' }}>
        <Card style={{ borderColor: 'var(--admin-danger, var(--color-error))', background: 'oklch(70% 0.14 25 / 0.14)', padding: '1.5rem' }}>
          <p style={{ color: 'var(--admin-danger, var(--color-error))', margin: '0 0 1rem', fontSize: '0.875rem' }}>
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
      content: splatId ? (
        <VersionsTab
          splatId={splatId}
          versions={versions}
          loading={versionsLoading}
          servingVersionId={servingVersionId}
          actionLoading={versionActionLoading}
          onServe={serveVersion}
        />
      ) : null,
    },
    {
      id: 'preview',
      label: 'Preview',
      content: splatId ? (
        <PreviewTab
          splatId={splatId}
          versions={versions}
          selectedVersionId={previewVersionId}
          onSelectedVersionIdChange={setPreviewVersionId}
          posterKey={posterKey}
          onPosterChanged={handlePosterChanged}
        />
      ) : null,
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
            <span style={{ fontSize: '0.6875rem', color: 'var(--admin-muted, var(--color-muted))' }}>{form.slug}</span>
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
          <Button size="sm" variant="secondary" onClick={() => navigate(`/splats/${splatId}/markers-3d${previewVersionId || servingVersionId ? `?versionId=${encodeURIComponent(previewVersionId || servingVersionId || '')}` : ''}`)}>
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

      <p style={{ fontSize: '0.75rem', color: 'var(--admin-muted, var(--color-muted))', margin: '0 0 1rem 0' }}>Edit splat details and manage versions.</p>

      <Tabs tabs={tabs} activeTabId={activeTabId} onTabChange={setActiveTabId} />
    </div>
  );
}


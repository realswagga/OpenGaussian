import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, Badge, Button, Spinner, Tabs } from '@gsplat/ui';
import type { AdminOrganization, AuthUser } from '@gsplat/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || '/assets';
const PREVIEW_OUTPUT_WIDTH = 1600;
const PREVIEW_OUTPUT_HEIGHT = 900;
const PREVIEW_ASPECT = PREVIEW_OUTPUT_WIDTH / PREVIEW_OUTPUT_HEIGHT;
const MAX_PREVIEW_SOURCE_MB = parseInt(import.meta.env.VITE_MAX_PREVIEW_UPLOAD_MB || '24', 10);

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

interface PreviewSource {
  file: File;
  url: string;
  width: number;
  height: number;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function assetUrl(key?: string | null, cacheKey?: number) {
  if (!key) return null;
  const suffix = cacheKey ? `?v=${cacheKey}` : '';
  return `${ASSET_BASE}/${key}${suffix}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCropRect(source: PreviewSource, zoom: number, offsetX: number, offsetY: number): CropRect {
  const sourceAspect = source.width / source.height;
  const baseHeight = sourceAspect > PREVIEW_ASPECT ? source.height : source.width / PREVIEW_ASPECT;
  const baseWidth = sourceAspect > PREVIEW_ASPECT ? source.height * PREVIEW_ASPECT : source.width;
  const width = baseWidth / zoom;
  const height = baseHeight / zoom;
  const maxCenterX = Math.max(0, (source.width - width) / 2);
  const maxCenterY = Math.max(0, (source.height - height) / 2);
  const centerX = source.width / 2 + (offsetX / 100) * maxCenterX;
  const centerY = source.height / 2 + (offsetY / 100) * maxCenterY;
  const maxX = Math.max(0, source.width - width);
  const maxY = Math.max(0, source.height - height);

  return {
    x: clamp(centerX - width / 2, 0, maxX),
    y: clamp(centerY - height / 2, 0, maxY),
    width,
    height,
  };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded'));
    image.src = url;
  });
}

async function renderPreviewBlob(source: PreviewSource, crop: CropRect) {
  const image = await loadImage(source.url);
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_OUTPUT_WIDTH;
  canvas.height = PREVIEW_OUTPUT_HEIGHT;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is not available');

  context.fillStyle = '#050505';
  context.fillRect(0, 0, PREVIEW_OUTPUT_WIDTH, PREVIEW_OUTPUT_HEIGHT);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    PREVIEW_OUTPUT_WIDTH,
    PREVIEW_OUTPUT_HEIGHT,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Preview image could not be created'));
    }, 'image/jpeg', 0.9);
  });
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
  onPosterChanged: (posterKey: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [cacheKey, setCacheKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    return () => {
      if (source?.url) URL.revokeObjectURL(source.url);
    };
  }, [source?.url]);

  const crop = useMemo(() => {
    if (!source) return null;
    return getCropRect(source, zoom, offsetX, offsetY);
  }, [source, zoom, offsetX, offsetY]);

  const currentPreviewUrl = assetUrl(posterKey, cacheKey);
  const canPanX = Boolean(source && crop && source.width - crop.width > 1);
  const canPanY = Boolean(source && crop && source.height - crop.height > 1);

  const selectSource = (file: File) => {
    const allowedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
    const allowedName = /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!allowedType && !allowedName) {
      setError('Preview source must be a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_PREVIEW_SOURCE_MB * 1024 * 1024) {
      setError(`Preview source exceeds ${MAX_PREVIEW_SOURCE_MB} MB.`);
      return;
    }

    setLoadingSource(true);
    setError('');
    setMessage('');

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setSource({ file, url, width: image.naturalWidth, height: image.naturalHeight });
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setLoadingSource(false);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setLoadingSource(false);
      setError('Preview source could not be loaded.');
    };
    image.src = url;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) selectSource(file);
    event.target.value = '';
  };

  const resetFrame = () => {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  };

  const uploadPreview = async () => {
    if (!source || !crop) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const blob = await renderPreviewBlob(source, crop);
      const formData = new FormData();
      formData.append('file', blob, `preview-${splatId}.jpg`);

      const res = await fetch(`${API_BASE}/admin/splats/${splatId}/preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || `Preview upload failed (${res.status})`);
      }

      const data = await res.json();
      const nextPosterKey = data.preview?.posterKey;
      if (!nextPosterKey) throw new Error('Preview upload returned no image key');

      onPosterChanged(nextPosterKey);
      setCacheKey(Date.now());
      setMessage('Preview updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview upload failed.');
    } finally {
      setSaving(false);
    }
  };

  const previewImageStyle: React.CSSProperties | undefined = source && crop
    ? {
        left: `${(-crop.x / crop.width) * 100}%`,
        top: `${(-crop.y / crop.height) * 100}%`,
        width: `${(source.width / crop.width) * 100}%`,
        height: `${(source.height / crop.height) * 100}%`,
      }
    : undefined;

  return (
    <Card className="admin-preview-manager" style={{ padding: 0 }}>
      <div className="admin-preview-layout">
        <section className="admin-preview-current" aria-label="Current preview">
          <div className="admin-preview-frame">
            {currentPreviewUrl ? <img src={currentPreviewUrl} alt="" /> : <span>No preview</span>}
          </div>
          <div className="admin-preview-caption">
            <strong>Current preview</strong>
            <span>{posterKey ? posterKey.split('/').pop() : 'No poster image'}</span>
          </div>
        </section>

        <section className="admin-reframe-panel" aria-label="Upload preview">
          <div className="admin-reframe-head">
            <div>
              <h2>Preview</h2>
              <p>16:9 poster, exported at {PREVIEW_OUTPUT_WIDTH}x{PREVIEW_OUTPUT_HEIGHT}.</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={saving || loadingSource}>
              {source ? 'Change image' : 'Select image'}
            </Button>
          </div>

          {error && <div className="admin-error admin-preview-message">{error}</div>}
          {message && <div className="admin-preview-success admin-preview-message">{message}</div>}

          <input
            ref={inputRef}
            className="admin-sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
          />

          {source && crop ? (
            <>
              <div className="admin-reframe-stage">
                <div className="admin-reframe-frame">
                  <img src={source.url} alt="" style={previewImageStyle} />
                  <span className="admin-reframe-rule admin-reframe-rule--vertical" />
                  <span className="admin-reframe-rule admin-reframe-rule--horizontal" />
                </div>
              </div>

              <div className="admin-reframe-controls">
                <label className="admin-range-field">
                  <span>Zoom</span>
                  <input className="admin-range" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
                  <strong>{Math.round(zoom * 100)}%</strong>
                </label>
                <label className="admin-range-field">
                  <span>X</span>
                  <input className="admin-range" type="range" min="-100" max="100" step="1" value={offsetX} disabled={!canPanX} onChange={(event) => setOffsetX(Number(event.target.value))} />
                  <strong>{offsetX}</strong>
                </label>
                <label className="admin-range-field">
                  <span>Y</span>
                  <input className="admin-range" type="range" min="-100" max="100" step="1" value={offsetY} disabled={!canPanY} onChange={(event) => setOffsetY(Number(event.target.value))} />
                  <strong>{offsetY}</strong>
                </label>
              </div>

              <div className="admin-preview-actions">
                <span className="admin-muted">{source.file.name} / {source.width}x{source.height}</span>
                <div className="admin-actions">
                  <Button type="button" variant="secondary" onClick={resetFrame} disabled={saving}>Reset</Button>
                  <Button type="button" variant="primary" onClick={uploadPreview} disabled={saving}>
                    {saving ? 'Uploading...' : 'Save preview'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <button className="admin-preview-drop" type="button" onClick={() => inputRef.current?.click()} disabled={saving || loadingSource}>
              {loadingSource ? 'Loading image...' : 'Select an image to reframe'}
            </button>
          )}
        </section>
      </div>
    </Card>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '0.5rem 1rem', color: '#737373', fontWeight: 400, fontSize: '0.6875rem' };
const tdStyle: React.CSSProperties = { padding: '0.5rem 1rem' };

export default function SplatEditPage(_props: { user?: AuthUser }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [form, setForm] = useState<SplatFormData>({ title: '', slug: '', description: '', organizationId: '' });
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [splatId, setSplatId] = useState<string | null>(isNew ? null : id!);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [posterKey, setPosterKey] = useState<string | null>(null);

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

      <Tabs tabs={tabs} defaultTabId="metadata" />
    </div>
  );
}

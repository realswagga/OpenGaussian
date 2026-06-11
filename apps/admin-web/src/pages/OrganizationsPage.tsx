import { useEffect, useState, type FormEvent } from 'react';
import type { AdminOrganization, AuthUser } from '@gsplat/shared';
import PreviewImageEditor from '../components/PreviewImageEditor';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || '/assets';

type OrganizationForm = {
  name: string;
  slug: string;
  description: string;
  websiteUrl: string;
  isPublic: boolean;
};

const emptyForm: OrganizationForm = {
  name: '',
  slug: '',
  description: '',
  websiteUrl: '',
  isPublic: true,
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formFromOrganization(org: AdminOrganization): OrganizationForm {
  return {
    name: org.name || '',
    slug: org.slug || '',
    description: org.description || '',
    websiteUrl: org.websiteUrl || '',
    isPublic: org.isPublic,
  };
}

function previewUrl(key: string) {
  return `${ASSET_BASE}/${key}`;
}

function OrganizationSkeleton() {
  return (
    <div className="admin-table-skeleton" aria-label="Loading organizations">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="admin-skeleton-row" key={index}>
          <div className="admin-skeleton-thumb" />
          <div className="admin-skeleton-cell">
            <div className="admin-skeleton-line wide" />
            <div className="admin-skeleton-line short" />
          </div>
          <div className="admin-skeleton-line pill" />
          <div className="admin-skeleton-line pill" />
          <div className="admin-skeleton-line pill" />
        </div>
      ))}
    </div>
  );
}

export default function OrganizationsPage({ user }: { user: AuthUser }) {
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<OrganizationForm>(emptyForm);

  const editingOrg = editingId ? organizations.find((org) => org.id === editingId) ?? null : null;
  const formMode = editingOrg ? 'edit' : 'create';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/organizations`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const data = await res.json();
      const items = data.items || [];
      setOrganizations(items);
      setLoading(false);
      return items as AdminOrganization[];
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
      setLoading(false);
      return [] as AdminOrganization[];
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  };

  const startEdit = (org: AdminOrganization) => {
    setEditingId(org.id);
    setForm(formFromOrganization(org));
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    const slug = form.slug || slugify(form.name);
    const body = {
      name: form.name,
      slug,
      description: form.description || null,
      websiteUrl: form.websiteUrl || null,
      isPublic: form.isPublic,
    };

    try {
      const res = await fetch(
        formMode === 'edit' && editingOrg
          ? `${API_BASE}/admin/organizations/${editingOrg.id}`
          : `${API_BASE}/admin/organizations`,
        {
          method: formMode === 'edit' ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || 'Save failed');
      }

      const data = await res.json();
      const next = data.organization as AdminOrganization;
      const items = await load();
      const refreshed = items.find((org) => org.id === next.id) ?? next;
      setEditingId(refreshed.id);
      setForm(formFromOrganization(refreshed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewUploaded = (previewKey: string) => {
    if (!editingOrg) return;
    setOrganizations((current) => current.map((org) => (
      org.id === editingOrg.id
        ? { ...org, previewKey, previewUrl: previewUrl(previewKey) }
        : org
    )));
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">{user.capabilities?.isMasterAdmin ? 'Global groups' : 'Your groups'}</p>
          <h1>Organizations</h1>
          <p>Publish splats under named groups with public organization pages.</p>
        </div>
      </div>

      {error && <div className="admin-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="admin-split">
        <section className="admin-table-wrap">
          {loading ? (
            <OrganizationSkeleton />
          ) : organizations.length === 0 ? (
            <div className="admin-empty">No organizations yet.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Members</th>
                  <th>Splats</th>
                  <th>Public</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id} className={org.id === editingId ? 'is-selected' : ''}>
                    <td>
                      <div className="admin-org-cell">
                        <div className="admin-thumb admin-thumb--org">
                          {org.previewUrl ? <img src={org.previewUrl} alt="" /> : <span>{org.name.slice(0, 1).toUpperCase()}</span>}
                        </div>
                        <div>
                          <strong>{org.name}</strong>
                          <div className="admin-muted" style={{ fontSize: 12 }}>{org.slug}</div>
                          {org.description && <div className="admin-muted" style={{ marginTop: 4 }}>{org.description}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{org.memberCount}</td>
                    <td>{org.publishedSplatCount} / {org.splatCount}</td>
                    <td><span className="admin-pill">{org.isPublic ? 'Public' : 'Hidden'}</span></td>
                    <td>
                      <button className="admin-button-secondary" type="button" onClick={() => startEdit(org)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="admin-side-stack">
          <section className="admin-panel">
            <div className="admin-form-head">
              <p className="admin-eyebrow">{formMode === 'edit' ? 'Edit group' : 'Create group'}</p>
              {formMode === 'edit' && (
                <button className="admin-button-secondary" type="button" onClick={startCreate}>
                  New group
                </button>
              )}
            </div>

            <form className="admin-form" onSubmit={submit}>
              <label className="admin-label">
                Name
                <input
                  className="admin-input"
                  value={form.name}
                  onChange={(event) => setForm((f) => ({ ...f, name: event.target.value, slug: f.slug || slugify(event.target.value) }))}
                  required
                />
              </label>
              <label className="admin-label">
                URL handle
                <input
                  className="admin-input"
                  value={form.slug}
                  onChange={(event) => setForm((f) => ({ ...f, slug: slugify(event.target.value) }))}
                  required
                />
              </label>
              <label className="admin-label">
                Description
                <textarea
                  className="admin-textarea"
                  value={form.description}
                  onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
                />
              </label>
              <label className="admin-label">
                Website
                <input
                  className="admin-input"
                  value={form.websiteUrl}
                  onChange={(event) => setForm((f) => ({ ...f, websiteUrl: event.target.value }))}
                />
              </label>
              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(event) => setForm((f) => ({ ...f, isPublic: event.target.checked }))}
                />
                <span>Public page</span>
              </label>
              <button className="admin-button" type="submit" disabled={saving}>
                {saving ? 'Saving...' : formMode === 'edit' ? 'Save changes' : 'Create organization'}
              </button>
            </form>
          </section>

        </div>
      </div>

      {editingOrg && (
        <section className="admin-org-preview-wrap">
          <PreviewImageEditor
            currentKey={editingOrg.previewKey ?? null}
            currentLabel="Organization preview"
            emptyLabel="No organization preview"
            outputFilename={`organization-${editingOrg.id}.jpg`}
            uploadUrl={`${API_BASE}/admin/organizations/${editingOrg.id}/preview`}
            historyUrl={`${API_BASE}/admin/organizations/${editingOrg.id}/previews`}
            className="admin-preview-manager--org"
            onUploaded={handlePreviewUploaded}
          />
        </section>
      )}
    </>
  );
}

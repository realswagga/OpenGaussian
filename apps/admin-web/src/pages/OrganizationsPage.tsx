import { useEffect, useState, type FormEvent } from 'react';
import type { AdminOrganization, AuthUser } from '@gsplat/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function OrganizationSkeleton() {
  return (
    <div className="admin-table-skeleton" aria-label="Loading organizations">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="admin-skeleton-row" key={index}>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', description: '', websiteUrl: '' });

  const load = () => {
    setLoading(true);
    fetch(`${API_BASE}/admin/organizations`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setOrganizations(data.items || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(load, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: form.name,
          slug: form.slug || slugify(form.name),
          description: form.description || null,
          websiteUrl: form.websiteUrl || null,
          isPublic: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || 'Create failed');
      }
      setForm({ name: '', slug: '', description: '', websiteUrl: '' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
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
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id}>
                    <td>
                      <strong>{org.name}</strong>
                      <div className="admin-muted" style={{ fontSize: 12 }}>{org.slug}</div>
                      {org.description && <div className="admin-muted" style={{ marginTop: 4 }}>{org.description}</div>}
                    </td>
                    <td>{org.memberCount}</td>
                    <td>{org.publishedSplatCount} / {org.splatCount}</td>
                    <td><span className="admin-pill">{org.isPublic ? 'Public' : 'Hidden'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="admin-panel">
          <p className="admin-eyebrow">Create group</p>
          <form className="admin-form" onSubmit={submit}>
            <label className="admin-label">
              Name
              <input className="admin-input" value={form.name} onChange={(event) => setForm((f) => ({ ...f, name: event.target.value, slug: f.slug || slugify(event.target.value) }))} required />
            </label>
            <label className="admin-label">
              URL handle
              <input className="admin-input" value={form.slug} onChange={(event) => setForm((f) => ({ ...f, slug: slugify(event.target.value) }))} required />
            </label>
            <label className="admin-label">
              Description
              <textarea className="admin-textarea" value={form.description} onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))} />
            </label>
            <label className="admin-label">
              Website
              <input className="admin-input" value={form.websiteUrl} onChange={(event) => setForm((f) => ({ ...f, websiteUrl: event.target.value }))} />
            </label>
            <button className="admin-button" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create organization'}</button>
          </form>
        </section>
      </div>
    </>
  );
}

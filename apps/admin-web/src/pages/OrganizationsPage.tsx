import { useEffect, useState, type FormEvent } from 'react';
import type { AdminOrganization, AuthUser } from '@gsplat/shared';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
  return (
    <div className="admin-table-skeleton" aria-label={t('org.loading')}>
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
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t('org.loading'));
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
        throw new Error((data as { error?: { message?: string } }).error?.message || t('dashboard.saveFailed'));
      }

      const data = await res.json();
      const next = data.organization as AdminOrganization;
      const items = await load();
      const refreshed = items.find((org) => org.id === next.id) ?? next;
      setEditingId(refreshed.id);
      setForm(formFromOrganization(refreshed));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dashboard.saveFailed'));
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

  const handlePreviewReset = () => {
    if (!editingOrg) return;
    setOrganizations((current) => current.map((org) => (
      org.id === editingOrg.id
        ? { ...org, previewKey: null, previewUrl: null }
        : org
    )));
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">{user.capabilities?.isMasterAdmin ? t('org.globalGroups') : t('org.yourGroups')}</p>
          <h1>{t('common.organizations')}</h1>
          <p>{t('org.copy')}</p>
        </div>
      </div>

      {error && <div className="admin-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="admin-split">
        <section className="admin-table-wrap">
          {loading ? (
            <OrganizationSkeleton />
          ) : organizations.length === 0 ? (
            <div className="admin-empty">{t('org.noOrganizations')}</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('common.organization')}</th>
                  <th>{t('common.members')}</th>
                  <th>{t('org.splats')}</th>
                  <th>{t('common.public')}</th>
                  <th>{t('common.actions')}</th>
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
                    <td><span className="admin-pill">{org.isPublic ? t('common.public') : t('common.hidden')}</span></td>
                    <td>
                      <button className="admin-button-secondary" type="button" onClick={() => startEdit(org)}>
                        {t('common.edit')}
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
              <p className="admin-eyebrow">{formMode === 'edit' ? t('org.editGroup') : t('org.createGroup')}</p>
              {formMode === 'edit' && (
                <button className="admin-button-secondary" type="button" onClick={startCreate}>
                  {t('org.newGroup')}
                </button>
              )}
            </div>

            <form className="admin-form" onSubmit={submit}>
              <label className="admin-label">
                {t('common.name')}
                <input
                  className="admin-input"
                  value={form.name}
                  onChange={(event) => setForm((f) => ({ ...f, name: event.target.value, slug: f.slug || slugify(event.target.value) }))}
                  required
                />
              </label>
              <label className="admin-label">
                {t('org.urlHandle')}
                <input
                  className="admin-input"
                  value={form.slug}
                  onChange={(event) => setForm((f) => ({ ...f, slug: slugify(event.target.value) }))}
                  required
                />
              </label>
              <label className="admin-label">
                {t('common.description')}
                <textarea
                  className="admin-textarea"
                  value={form.description}
                  onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
                />
              </label>
              <label className="admin-label">
                {t('common.website')}
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
                <span>{t('org.publicPage')}</span>
              </label>
              <button className="admin-button" type="submit" disabled={saving}>
                {saving ? t('common.saving') : formMode === 'edit' ? t('org.saveChanges') : t('org.createOrganization')}
              </button>
            </form>
          </section>

        </div>
      </div>

      {editingOrg && (
        <section className="admin-org-preview-wrap">
          <PreviewImageEditor
            currentKey={editingOrg.previewKey ?? null}
            currentLabel={t('org.previewLabel')}
            emptyLabel={t('org.noPreview')}
            outputFilename={`organization-${editingOrg.id}.jpg`}
            uploadUrl={`${API_BASE}/admin/organizations/${editingOrg.id}/preview`}
            resetUrl={`${API_BASE}/admin/organizations/${editingOrg.id}/preview`}
            historyUrl={`${API_BASE}/admin/organizations/${editingOrg.id}/previews`}
            className="admin-preview-manager--org"
            onUploaded={handlePreviewUploaded}
            onReset={handlePreviewReset}
          />
        </section>
      )}
    </>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminMembership, AdminOrganization, AuthUser, EditorPermissions } from '@gsplat/shared';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const permissionLabels: Array<[keyof EditorPermissions, string]> = [
  ['canCreateSplats', 'perm.createSplats'],
  ['canUploadSplats', 'perm.uploadAssets'],
  ['canEditSplats', 'perm.editMetadata'],
  ['canDeleteSplats', 'perm.deleteSplats'],
  ['canPublishSplats', 'perm.publish'],
  ['canEditMarkers', 'perm.markers3d'],
];

const defaultEditorPermissions: EditorPermissions = {
  canCreateSplats: false,
  canUploadSplats: true,
  canEditSplats: true,
  canDeleteSplats: false,
  canPublishSplats: false,
  canEditMarkers: true,
};

function canAddManagers(user: AuthUser) {
  return user.capabilities?.isMasterAdmin || user.role === 'MASTER_ADMIN' || user.role === 'ADMIN';
}

function MemberSkeleton() {
  const { t } = useI18n();
  return (
    <div className="admin-table-skeleton" aria-label={t('members.loading')}>
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="admin-skeleton-row" key={index}>
          <div className="admin-skeleton-cell">
            <div className="admin-skeleton-line wide" />
            <div className="admin-skeleton-line short" />
          </div>
          <div className="admin-skeleton-line pill" />
          <div className="admin-skeleton-line actions" />
        </div>
      ))}
    </div>
  );
}

export default function MembersPage({ user }: { user: AuthUser }) {
  const { t } = useI18n();
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [members, setMembers] = useState<AdminMembership[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'EDITOR' | 'MANAGER'>('EDITOR');
  const [permissions, setPermissions] = useState<EditorPermissions>(defaultEditorPermissions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedOrg = useMemo(() => organizations.find((org) => org.id === selectedOrgId), [organizations, selectedOrgId]);

  const loadOrganizations = () => {
    fetch(`${API_BASE}/admin/organizations`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        const items = data.items || [];
        setOrganizations(items);
        setSelectedOrgId((current) => current || items[0]?.id || '');
      })
      .catch((err) => setError(err.message));
  };

  const loadMembers = (orgId: string) => {
    if (!orgId) return;
    setLoading(true);
    fetch(`${API_BASE}/admin/organizations/${orgId}/members`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setMembers(data.items || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(loadOrganizations, []);
  useEffect(() => loadMembers(selectedOrgId), [selectedOrgId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrgId) return;
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/organizations/${selectedOrgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          role,
          permissions: role === 'EDITOR' ? permissions : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || t('members.addFailed'));
      }
      setEmail('');
      loadMembers(selectedOrgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('members.addFailed'));
    }
  };

  const patchMembership = async (member: AdminMembership, nextPermissions: Partial<EditorPermissions>) => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/admin/memberships/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ permissions: nextPermissions }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || t('members.updateFailed'));
      }
      loadMembers(selectedOrgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('members.updateFailed'));
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">{t('members.approvals')}</p>
          <h1>{t('common.members')}</h1>
          <p>{t('members.copy')}</p>
        </div>
      </div>

      {error && <div className="admin-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="admin-split">
        <section className="admin-table-wrap">
          <div className="admin-panel" style={{ border: 0, borderBottom: '1px solid var(--admin-rule)', borderRadius: 0 }}>
            <label className="admin-label">
              {t('common.organization')}
              <select className="admin-select" value={selectedOrgId} onChange={(event) => setSelectedOrgId(event.target.value)}>
                {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </label>
          </div>

          {loading ? (
            <MemberSkeleton />
          ) : members.length === 0 ? (
            <div className="admin-empty">{t('members.noMembers')}</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('members.user')}</th>
                  <th>{t('members.role')}</th>
                  <th>{t('members.permissions')}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.name || member.email}</strong>
                      <div className="admin-muted" style={{ fontSize: 12 }}>{member.email}</div>
                    </td>
                    <td><span className="admin-pill">{member.role}</span></td>
                    <td>
                      {member.role === 'MANAGER' ? (
                        <span className="admin-muted">{t('members.fullAccess')}</span>
                      ) : (
                        <div className="admin-checkbox-grid">
                          {permissionLabels.map(([key, label]) => (
                            <label className="admin-checkbox" key={key}>
                              <input
                                type="checkbox"
                                checked={member.permissions[key]}
                                onChange={(event) => patchMembership(member, { [key]: event.target.checked })}
                              />
                              {t(label)}
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="admin-panel">
          <p className="admin-eyebrow">{t('members.promoteClient')}</p>
          <form className="admin-form" onSubmit={submit}>
            <label className="admin-label">
              {t('members.clientEmail')}
              <input className="admin-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="client@example.com" required />
            </label>
            <label className="admin-label">
              {t('members.role')}
              <select className="admin-select" value={role} onChange={(event) => setRole(event.target.value as 'EDITOR' | 'MANAGER')}>
                <option value="EDITOR">Editor</option>
                {canAddManagers(user) && <option value="MANAGER">Manager</option>}
              </select>
            </label>
            {role === 'EDITOR' && (
              <div className="admin-checkbox-grid">
                {permissionLabels.map(([key, label]) => (
                  <label className="admin-checkbox" key={key}>
                    <input
                      type="checkbox"
                      checked={permissions[key]}
                      onChange={(event) => setPermissions((current) => ({ ...current, [key]: event.target.checked }))}
                    />
                    {t(label)}
                  </label>
                ))}
              </div>
            )}
            <button className="admin-button" type="submit" disabled={!selectedOrg}>{t('members.add')}</button>
          </form>
        </section>
      </div>
    </>
  );
}

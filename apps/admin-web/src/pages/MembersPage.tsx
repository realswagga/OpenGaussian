import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminMembership, AdminOrganization, AuthUser, EditorPermissions } from '@gsplat/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const permissionLabels: Array<[keyof EditorPermissions, string]> = [
  ['canCreateSplats', 'Create splats'],
  ['canUploadSplats', 'Upload assets'],
  ['canEditSplats', 'Edit metadata'],
  ['canDeleteSplats', 'Delete splats'],
  ['canPublishSplats', 'Publish'],
  ['canEditMarkers', '3D markers'],
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
  return (
    <div className="admin-table-skeleton" aria-label="Loading members">
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
        throw new Error((data as { error?: { message?: string } }).error?.message || 'Add member failed');
      }
      setEmail('');
      loadMembers(selectedOrgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add member failed');
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
        throw new Error((data as { error?: { message?: string } }).error?.message || 'Update failed');
      }
      loadMembers(selectedOrgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">Approvals</p>
          <h1>Members</h1>
          <p>Promote self-signed clients into managers or editors for an organization.</p>
        </div>
      </div>

      {error && <div className="admin-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="admin-split">
        <section className="admin-table-wrap">
          <div className="admin-panel" style={{ border: 0, borderBottom: '1px solid var(--admin-rule)', borderRadius: 0 }}>
            <label className="admin-label">
              Organization
              <select className="admin-select" value={selectedOrgId} onChange={(event) => setSelectedOrgId(event.target.value)}>
                {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
              </select>
            </label>
          </div>

          {loading ? (
            <MemberSkeleton />
          ) : members.length === 0 ? (
            <div className="admin-empty">No members in this organization.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Permissions</th>
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
                        <span className="admin-muted">Full organization access</span>
                      ) : (
                        <div className="admin-checkbox-grid">
                          {permissionLabels.map(([key, label]) => (
                            <label className="admin-checkbox" key={key}>
                              <input
                                type="checkbox"
                                checked={member.permissions[key]}
                                onChange={(event) => patchMembership(member, { [key]: event.target.checked })}
                              />
                              {label}
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
          <p className="admin-eyebrow">Promote client</p>
          <form className="admin-form" onSubmit={submit}>
            <label className="admin-label">
              Client email
              <input className="admin-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="client@example.com" required />
            </label>
            <label className="admin-label">
              Role
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
                    {label}
                  </label>
                ))}
              </div>
            )}
            <button className="admin-button" type="submit" disabled={!selectedOrg}>Add to organization</button>
          </form>
        </section>
      </div>
    </>
  );
}

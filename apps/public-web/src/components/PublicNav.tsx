import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '@gsplat/shared';
import { LanguageSwitch, useI18n } from '../i18n';
import { ThemeSwitch } from '../theme';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function initials(user: AuthUser) {
  const source = (user.name || user.email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const first = parts[0]?.charAt(0) ?? '';
    const second = parts[1]?.charAt(0) ?? '';
    return `${first}${second}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export default function PublicNav({ user: controlledUser }: { user?: AuthUser | null }) {
  const { t } = useI18n();
  const [user, setUser] = useState<AuthUser | null>(null);
  const activeUser = controlledUser === undefined ? user : controlledUser;

  useEffect(() => {
    if (controlledUser !== undefined) return;

    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => undefined);
  }, [controlledUser]);

  return (
    <nav className="og-nav" aria-label={t('nav.primary')}>
      <Link className="og-brand" to="/">OpenGaussian</Link>
      <div className="og-nav-links">
        <LanguageSwitch />
        <ThemeSwitch />
        {activeUser?.capabilities?.canAccessAdmin && <a className="og-nav-link" href="/admin/">{t('nav.admin')}</a>}
        {activeUser ? (
          <Link className="og-user-chip" to="/login" title={activeUser.email}>
            <span className="og-user-dot" aria-hidden="true">{initials(activeUser)}</span>
            <span>{activeUser.name || activeUser.email}</span>
          </Link>
        ) : (
          <Link className="og-button-secondary og-login-button" to="/login">{t('nav.login')}</Link>
        )}
      </div>
    </nav>
  );
}

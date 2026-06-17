import { BrowserRouter, Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import type { AuthUser } from '@gsplat/shared';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SplatsPage from './pages/SplatsPage';
import SplatEditPage from './pages/SplatEditPage';
import UploadPage from './pages/UploadPage';
import Annotation3DEditorPage from './pages/Annotation3DEditorPage';
import OrganizationsPage from './pages/OrganizationsPage';
import MembersPage from './pages/MembersPage';
import WidgetPage from './pages/WidgetPage';
import { I18nProvider, LanguageSwitch, useI18n } from './i18n';
import { ThemeSwitch, useTheme } from './theme';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

type IconName = 'overview' | 'splats' | 'organizations' | 'members' | 'widget' | 'plus' | 'external' | 'logout';

function Icon({ name }: { name: IconName }) {
  const common = { stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg className="admin-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
      {name === 'overview' && (
        <>
          <path {...common} d="M4 13.5 12 6l8 7.5" />
          <path {...common} d="M6.5 12v7h11v-7" />
        </>
      )}
      {name === 'splats' && (
        <>
          <circle {...common} cx="8" cy="8" r="2.6" />
          <circle {...common} cx="16" cy="7" r="1.8" />
          <circle {...common} cx="15" cy="16" r="3" />
          <path {...common} d="m10.2 9.5 2.9 4.2M10.5 7.7l3.8-.4" />
        </>
      )}
      {name === 'organizations' && (
        <>
          <path {...common} d="M5 20V7.5L12 4l7 3.5V20" />
          <path {...common} d="M8 20v-7h8v7M9 9h.01M12 9h.01M15 9h.01" />
        </>
      )}
      {name === 'members' && (
        <>
          <circle {...common} cx="9" cy="8" r="3" />
          <path {...common} d="M3.5 19c.9-3 2.8-4.5 5.5-4.5s4.6 1.5 5.5 4.5" />
          <path {...common} d="M16 7.5c1.9.2 3 1.4 3 3s-1.1 2.8-3 3M18 15c1.3.7 2.2 2 2.7 4" />
        </>
      )}
      {name === 'widget' && (
        <>
          <path {...common} d="M7 7h10v10H7z" />
          <path {...common} d="M4 4h4M16 4h4M4 20h4M16 20h4M4 8V4M20 8V4M4 16v4M20 16v4" />
        </>
      )}
      {name === 'plus' && <path {...common} d="M12 5v14M5 12h14" />}
      {name === 'external' && (
        <>
          <path {...common} d="M14 5h5v5" />
          <path {...common} d="m19 5-8 8" />
          <path {...common} d="M19 14v5H5V5h5" />
        </>
      )}
      {name === 'logout' && (
        <>
          <path {...common} d="M10 6H5v12h5" />
          <path {...common} d="M14 8l4 4-4 4M18 12H9" />
        </>
      )}
    </svg>
  );
}

function isMaster(user: AuthUser | null) {
  return user?.capabilities?.isMasterAdmin || user?.role === 'MASTER_ADMIN' || user?.role === 'ADMIN';
}

function isManager(user: AuthUser | null) {
  return Boolean(user?.memberships?.some((m) => m.role === 'MANAGER' && m.status === 'ACTIVE'));
}

function AppShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { t } = useI18n();
  const location = useLocation();
  const roleLabel = isMaster(user)
    ? t('role.master')
    : isManager(user)
      ? t('role.manager')
      : t('role.editor');
  const canManageOrg = isMaster(user) || isManager(user);
  const canUseWidget = canManageOrg;
  const title = useMemo(() => {
    if (location.pathname.startsWith('/splats')) return t('common.splats');
    if (location.pathname.startsWith('/organizations')) return t('common.organizations');
    if (location.pathname.startsWith('/members')) return t('common.members');
    if (location.pathname.startsWith('/widget')) return t('common.widget');
    return t('top.overview');
  }, [location.pathname, t]);

  const nav: Array<{ to: string; label: string; icon: IconName; show: boolean }> = [
    { to: '/', label: t('nav.home'), icon: 'overview', show: true },
    { to: '/splats', label: t('common.splats'), icon: 'splats', show: true },
    { to: '/organizations', label: t('nav.orgs'), icon: 'organizations', show: true },
    { to: '/members', label: t('common.members'), icon: 'members', show: canManageOrg },
    { to: '/widget', label: t('common.widget'), icon: 'widget', show: canUseWidget },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <Link to="/" aria-label="OpenGaussian admin">OG</Link>
          <span>{roleLabel}</span>
        </div>
        <nav className="admin-nav" aria-label={t('nav.adminAria')}>
          {nav.filter((item) => item.show).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} title={item.label} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-user">
          <span className="admin-avatar" aria-hidden="true">{(user.name || user.email).slice(0, 2).toUpperCase()}</span>
          <button className="admin-icon-button" type="button" onClick={onLogout} title={t('nav.signOut')}>
            <Icon name="logout" />
            <span className="admin-sr-only">{t('nav.signOut')}</span>
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title">
            <h1>{title}</h1>
            <span>{roleLabel} / {user.email}</span>
          </div>
          <div className="admin-actions">
            <LanguageSwitch />
            <ThemeSwitch />
            <a className="admin-button-secondary" href="/" target="_blank" rel="noreferrer"><Icon name="external" />{t('nav.publicSite')}</a>
            <Link className="admin-button" to="/splats/new"><Icon name="plus" />{t('nav.newSplat')}</Link>
          </div>
        </header>
        <div className="admin-content">
          <Routes>
            <Route path="/" element={<DashboardPage user={user} />} />
            <Route path="/splats" element={<SplatsPage user={user} />} />
            <Route path="/splats/new" element={<SplatEditPage user={user} />} />
            <Route path="/splats/:id" element={<SplatEditPage user={user} />} />
            <Route path="/splats/:id/upload" element={<UploadPage />} />
            <Route path="/splats/:id/markers-3d" element={<Annotation3DEditorPage />} />
            <Route path="/splats/:id/annotations-3d" element={<Annotation3DEditorPage />} />
            <Route path="/organizations" element={<OrganizationsPage user={user} />} />
            <Route path="/members" element={canManageOrg ? <MembersPage user={user} /> : <Navigate to="/" replace />} />
            <Route path="/widget" element={canUseWidget ? <WidgetPage /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

function NoAccess({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { t } = useI18n();
  return (
    <div className="admin-auth-wrap">
      <section className="admin-auth-card">
        <p className="admin-eyebrow">{t('auth.clientAccount')}</p>
        <h1>{t('auth.noWorkspace')}</h1>
        <p className="admin-muted">
          {t('auth.noWorkspaceCopy', { email: user.email })}
        </p>
        <div className="admin-actions" style={{ marginTop: 20 }}>
          <a className="admin-button" href="/">{t('auth.openCatalog')}</a>
          <button className="admin-button-secondary" type="button" onClick={onLogout}>{t('nav.signOut')}</button>
        </div>
      </section>
    </div>
  );
}

function AdminBootSkeleton() {
  const { t } = useI18n();
  return (
    <div className="admin-auth-wrap">
      <section className="admin-auth-card admin-auth-card--skeleton" aria-label={t('common.loadingWorkspace')}>
        <div className="admin-skeleton-line short" />
        <div className="admin-skeleton-line title" />
        <div className="admin-skeleton-line" />
        <div className="admin-skeleton-line" />
      </section>
    </div>
  );
}

function AppInner() {
  useTheme();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleLogout = () => {
    fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).finally(() => {
      setUser(null);
      navigate('/');
    });
  };

  if (loading) {
    return <AdminBootSkeleton />;
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  if (!user.capabilities?.canAccessAdmin) {
    return <NoAccess user={user} onLogout={handleLogout} />;
  }

  return <AppShell user={user} onLogout={handleLogout} />;
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter basename="/admin">
        <AppInner />
      </BrowserRouter>
    </I18nProvider>
  );
}

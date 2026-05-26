import { BrowserRouter, Routes, Route, Navigate, useLocation, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SplatsPage from './pages/SplatsPage';
import SplatEditPage from './pages/SplatEditPage';
import UploadPage from './pages/UploadPage';
import Annotation3DEditorPage from './pages/Annotation3DEditorPage';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function Sidebar({ email, onLogout }: { email: string; onLogout: () => void }) {
  const location = useLocation();
  const path = location.pathname;

  const isActive = (href: string) => {
    if (href === '/' || href === '') return path === '/';
    return path.startsWith(href);
  };

  const navItems = [
    { href: '/', label: 'Dashboard', icon: '◻' },
    { href: '/splats', label: 'Splats', icon: '◫' },
  ];

  // Context actions for splat edit pages
  const splatIdMatch = path.match(/^\/splats\/([^/]+)/);
  const splatId = splatIdMatch ? splatIdMatch[1] : null;
  const isNewSplat = path === '/splats/new';
  const showSplatActions = splatId && !isNewSplat;

  const linkStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    padding: '0.5rem 0.875rem',
    borderRadius: 6,
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: active ? '#f5f5f5' : '#a3a3a3',
    background: active ? '#171717' : 'transparent',
    border: active ? '1px solid #2a2a2a' : '1px solid transparent',
    textDecoration: 'none',
    transition: 'background 150ms, border-color 150ms, color 150ms',
  });

  const subLinkStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.375rem 0.875rem 0.375rem 2rem',
    borderRadius: 4,
    fontSize: '0.75rem',
    fontWeight: 400,
    color: active ? '#f5f5f5' : '#737373',
    background: active ? '#171717' : 'transparent',
    textDecoration: 'none',
    transition: 'color 150ms',
  });

  return (
    <div style={{
      width: 220,
      minWidth: 220,
      background: '#0d0d0d',
      borderRight: '1px solid #2a2a2a',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '1.25rem 1rem 0.75rem' }}>
        <Link to="/" style={{ textDecoration: 'none', color: '#f5f5f5', fontWeight: 700, fontSize: '0.9375rem', letterSpacing: '-0.01em' }}>
          GSplat Admin
        </Link>
      </div>

      {/* Nav links */}
      <nav style={{ padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
        {navItems.map((item) => (
          <Link key={item.href} to={item.href} style={linkStyle(isActive(item.href))}>
            <span style={{ width: 16, textAlign: 'center', fontSize: '0.875rem' }}>{item.icon}</span>
            {item.label}
          </Link>
        ))}

        {/* Splat context sub-navigation */}
        {showSplatActions && (
          <>
            <div style={{ fontSize: '0.625rem', color: '#737373', padding: '0.625rem 0.875rem 0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Splat Actions
            </div>
            <Link to={`/splats/${splatId}`} style={subLinkStyle(isActive(`/splats/${splatId}`) && !path.includes('/upload') && !path.includes('/annotations') && !path.includes('/markers'))}>
              ✎ Edit Details
            </Link>
            <Link to={`/splats/${splatId}/upload`} style={subLinkStyle(isActive(`/splats/${splatId}/upload`))}>
              ↑ Upload
            </Link>
            <Link to={`/splats/${splatId}/markers-3d`} style={subLinkStyle(isActive(`/splats/${splatId}/markers-3d`) || isActive(`/splats/${splatId}/annotations-3d`))}>
              ◧ 3D Editor
            </Link>
          </>
        )}
      </nav>

      {/* User section */}
      <div style={{
        padding: '0.75rem 1rem',
        borderTop: '1px solid #2a2a2a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.5rem',
      }}>
        <span style={{ fontSize: '0.6875rem', color: '#737373', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {email}
        </span>
        <button
          onClick={onLogout}
          title="Logout"
          style={{
            background: 'none',
            border: '1px solid #2a2a2a',
            borderRadius: 4,
            color: '#737373',
            cursor: 'pointer',
            fontSize: '0.6875rem',
            padding: '0.2rem 0.5rem',
          }}
        >
          ↪
        </button>
      </div>
    </div>
  );
}

function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  const breadcrumbStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontSize: '0.75rem',
    color: '#737373',
    padding: '0.625rem 0',
  };

  const linkStyle: React.CSSProperties = {
    color: '#a3a3a3',
    textDecoration: 'none',
  };

  const activeStyle: React.CSSProperties = {
    color: '#f5f5f5',
    fontWeight: 500,
  };

  // Build breadcrumb items (paths are relative to basename, no /admin prefix)
  const items: { label: string; href: string; active: boolean }[] = [];
  let accum = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    accum += '/' + seg;
    const isLast = i === segments.length - 1;
    items.push({
      label: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' '),
      href: accum,
      active: isLast,
    });
  }

  if (items.length === 0) return null;

  return (
    <div style={breadcrumbStyle}>
      {items.map((item, i) => (
        <span key={item.href} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          {i > 0 && <span style={{ color: '#2a2a2a' }}>/</span>}
          {item.active ? (
            <span style={activeStyle}>{item.label}</span>
          ) : (
            <Link to={item.href} style={linkStyle}>{item.label}</Link>
          )}
        </span>
      ))}
    </div>
  );
}

function AppInner() {
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
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

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050505', color: '#a3a3a3', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif' }}>
        Loading...
      </div>
    );
  }

  const handleLogin = (u: { email: string; role: string }) => setUser(u);
  const handleLogout = () => {
    fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).finally(() => {
      setUser(null);
      navigate('/');
    });
  };

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#050505', color: '#f5f5f5', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif' }}>
      <Sidebar email={user.email} onLogout={handleLogout} />

      <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 2rem 2rem' }}>
          <Breadcrumbs />
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/splats" element={<SplatsPage />} />
            <Route path="/splats/new" element={<SplatEditPage />} />
            <Route path="/splats/:id" element={<SplatEditPage />} />
            <Route path="/splats/:id/upload" element={<UploadPage />} />
            <Route path="/splats/:id/markers-3d" element={<Annotation3DEditorPage />} />
            <Route path="/splats/:id/annotations-3d" element={<Annotation3DEditorPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <AppInner />
    </BrowserRouter>
  );
}

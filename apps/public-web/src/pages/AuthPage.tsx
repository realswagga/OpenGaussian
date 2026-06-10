import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { AuthUser } from '@gsplat/shared';
import PublicNav from '../components/PublicNav';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function AuthPage({ initialMode }: { initialMode: 'login' | 'signup' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState(initialMode);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMode(location.pathname.includes('signup') ? 'signup' : initialMode);
  }, [location.pathname, initialMode]);

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'signup' ? 'signup' : 'login';
      const body = mode === 'signup' ? { email, password, name: name || undefined } : { email, password };
      const res = await fetch(`${API_BASE}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || 'Authentication failed');
      }
      const data = await res.json();
      setUser(data.user);
      if (data.user?.capabilities?.canAccessAdmin) window.location.assign('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).finally(() => setUser(null));
  };

  return (
    <div className="og-shell">
      <div className="og-backdrop" aria-hidden="true" />
      <PublicNav user={user} />

      <main className="og-page og-auth-wrap">
        <section className="og-auth-card">
          {user ? (
            <>
              <p className="og-eyebrow">Account</p>
              <h1>{user.name || user.email}</h1>
              <p className="og-card-desc" style={{ marginTop: 12 }}>
                You are signed in as {user.role === 'CLIENT' ? 'viewer' : user.role.toLowerCase()}.
              </p>
              <div className="og-hero-actions">
                <Link className="og-button" to="/search">Browse catalog</Link>
                {user.capabilities?.canAccessAdmin && <a className="og-button-secondary" href="/admin/">Open admin</a>}
                <button className="og-button-secondary" type="button" onClick={logout}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <p className="og-eyebrow">{mode === 'signup' ? 'Self sign up' : 'Log in'}</p>
              <h1>{mode === 'signup' ? 'Create account' : 'Sign in'}</h1>
              <form onSubmit={submit}>
                {mode === 'signup' && (
                  <label className="og-label">
                    Name
                    <input className="og-input" value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                )}
                <label className="og-label">
                  Email
                  <input className="og-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </label>
                <label className="og-label">
                  Password
                  <input className="og-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'signup' ? 8 : 1} />
                </label>
                {error && <div className="og-error">{error}</div>}
                <button className="og-button" type="submit" disabled={loading}>
                  {loading ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
                </button>
              </form>
              <p className="og-auth-switch">
                {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    const next = mode === 'signup' ? 'login' : 'signup';
                    setMode(next);
                    navigate(next === 'signup' ? '/signup' : '/login');
                  }}
                >
                  {mode === 'signup' ? 'Sign in' : 'Create account'}
                </button>
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

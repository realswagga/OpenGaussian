import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { AuthUser } from '@gsplat/shared';
import PublicNav from '../components/PublicNav';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function AuthPage({ initialMode }: { initialMode: 'login' | 'signup' }) {
  const { t } = useI18n();
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
        throw new Error((data as { error?: { message?: string } }).error?.message || t('auth.failed'));
      }
      const data = await res.json();
      setUser(data.user);
      if (data.user?.capabilities?.canAccessAdmin) window.location.assign('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.failed'));
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
              <p className="og-eyebrow">{t('auth.account')}</p>
              <h1>{user.name || user.email}</h1>
              <p className="og-card-desc" style={{ marginTop: 12 }}>
                {t('auth.signedInAs', { role: user.role === 'CLIENT' ? t('auth.viewer') : user.role.toLowerCase() })}
              </p>
              <div className="og-hero-actions">
                <Link className="og-button" to="/search">{t('auth.browseCatalog')}</Link>
                {user.capabilities?.canAccessAdmin && <a className="og-button-secondary" href="/admin/">{t('auth.openAdmin')}</a>}
                <button className="og-button-secondary" type="button" onClick={logout}>{t('auth.signOut')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="og-eyebrow">{mode === 'signup' ? t('auth.selfSignUp') : t('auth.logIn')}</p>
              <h1>{mode === 'signup' ? t('auth.createAccount') : t('auth.signIn')}</h1>
              <form onSubmit={submit}>
                {mode === 'signup' && (
                  <label className="og-label">
                    {t('auth.name')}
                    <input className="og-input" value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                )}
                <label className="og-label">
                  {t('auth.email')}
                  <input className="og-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </label>
                <label className="og-label">
                  {t('auth.password')}
                  <input className="og-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'signup' ? 8 : 1} />
                </label>
                {error && <div className="og-error">{error}</div>}
                <button className="og-button" type="submit" disabled={loading}>
                  {loading ? t('auth.wait') : mode === 'signup' ? t('auth.createAccount') : t('auth.signIn')}
                </button>
              </form>
              <p className="og-auth-switch">
                {mode === 'signup' ? t('auth.haveAccount') : t('auth.newHere')}{' '}
                <button
                  type="button"
                  onClick={() => {
                    const next = mode === 'signup' ? 'login' : 'signup';
                    setMode(next);
                    navigate(next === 'signup' ? '/signup' : '/login');
                  }}
                >
                  {mode === 'signup' ? t('auth.signIn') : t('auth.createAccount')}
                </button>
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

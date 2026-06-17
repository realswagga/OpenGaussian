import { useState, type FormEvent } from 'react';
import type { AuthUser } from '@gsplat/shared';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || t('auth.loginFailed'));
      }

      const data = await res.json();
      onLogin(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-auth-wrap">
      <section className="admin-auth-card">
        <p className="admin-eyebrow">{t('auth.adminKicker')}</p>
        <h1>{t('auth.signIn')}</h1>
        <p className="admin-muted">
          {t('auth.loginCopy')}
        </p>

        <form onSubmit={handleSubmit}>
          <label className="admin-label">
            {t('common.email')}
            <input
              className="admin-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="admin-label">
            {t('common.password')}
            <input
              className="admin-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <div className="admin-error">{error}</div>}

          <button className="admin-button" type="submit" disabled={loading}>
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>

        <p className="admin-muted" style={{ marginTop: 18 }}>
          {t('auth.newUsers')}
        </p>
        <a className="admin-button-secondary" href="/signup" style={{ width: '100%', marginTop: 10 }}>
          {t('auth.createAccount')}
        </a>
      </section>
    </div>
  );
}

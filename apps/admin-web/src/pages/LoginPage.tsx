import { useState, type FormEvent } from 'react';
import type { AuthUser } from '@gsplat/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
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
        throw new Error((data as { error?: { message?: string } }).error?.message || 'Login failed');
      }

      const data = await res.json();
      onLogin(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-auth-wrap">
      <section className="admin-auth-card">
        <p className="admin-eyebrow">OpenGaussian admin</p>
        <h1>Sign in</h1>
        <p className="admin-muted">
          Accounts can sign in here after they are promoted to manager or editor.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="admin-label">
            Email
            <input
              className="admin-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="admin-label">
            Password
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
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="admin-muted" style={{ marginTop: 18 }}>
          New users can create accounts on the public site.
        </p>
        <a className="admin-button-secondary" href="/signup" style={{ width: '100%', marginTop: 10 }}>
          Create account
        </a>
      </section>
    </div>
  );
}

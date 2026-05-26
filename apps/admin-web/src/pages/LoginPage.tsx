import { useState, type FormEvent } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

interface LoginPageProps {
  onLogin: (user: { email: string; role: string }) => void;
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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#050505',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 360,
          padding: '2rem',
          background: '#0d0d0d',
          border: '1px solid #2a2a2a',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, textAlign: 'center', marginBottom: '0.5rem' }}>
          GSplat Admin
        </h1>

        {error && (
          <div
            style={{
              padding: '0.5rem 0.75rem',
              background: '#1a0a0a',
              border: '1px solid #ef4444',
              borderRadius: 6,
              color: '#ef4444',
              fontSize: '0.8125rem',
            }}
          >
            {error}
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#a3a3a3' }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              padding: '0.625rem 0.75rem',
              background: '#111',
              border: '1px solid #2a2a2a',
              borderRadius: 6,
              color: '#f5f5f5',
              fontSize: '0.875rem',
              outline: 'none',
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#a3a3a3' }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              padding: '0.625rem 0.75rem',
              background: '#111',
              border: '1px solid #2a2a2a',
              borderRadius: 6,
              color: '#f5f5f5',
              fontSize: '0.875rem',
              outline: 'none',
            }}
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '0.625rem',
            background: '#ffffff',
            border: 'none',
            borderRadius: 6,
            color: '#050505',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
            marginTop: '0.25rem',
          }}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
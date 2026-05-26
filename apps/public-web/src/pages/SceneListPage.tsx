import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SplatSummary } from '@gsplat/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function SceneListPage() {
  const [scenes, setScenes] = useState<SplatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/splats`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setScenes(data.items || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const filtered = scenes.filter(
    (s) =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ minHeight: '100vh', padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Gaussian Splats</h1>
        <p style={{ color: '#a3a3a3', fontSize: '0.875rem' }}>
          {loading ? 'Loading scenes...' : `${scenes.length} scene${scenes.length !== 1 ? 's' : ''} available`}
        </p>
      </header>

      <input
        type="text"
        placeholder="Search scenes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%',
          padding: '0.75rem 1rem',
          background: '#0d0d0d',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          color: '#f5f5f5',
          fontSize: '0.875rem',
          marginBottom: '1.5rem',
          outline: 'none',
        }}
      />

      {error && (
        <div style={{ padding: '1rem', background: '#1a0a0a', border: '1px solid #ef4444', borderRadius: 8, marginBottom: '1rem' }}>
          Error: {error}
        </div>
      )}

      {loading && (
        <div style={{ color: '#a3a3a3', padding: '2rem 0' }}>Loading...</div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ color: '#a3a3a3', padding: '2rem 0' }}>
          {search ? 'No scenes match your search.' : 'No published scenes yet.'}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1rem',
        }}
      >
        {filtered.map((scene) => (
          <Link
            key={scene.id}
            to={`/splats/${scene.slug}`}
            style={{ textDecoration: 'none' }}
          >
            <div
              style={{
                background: '#0d0d0d',
                border: '1px solid #2a2a2a',
                borderRadius: 12,
                overflow: 'hidden',
                transition: 'border-color 120ms',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: 200,
                  background: '#111',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#737373',
                  fontSize: '0.75rem',
                }}
              >
                {scene.posterUrl ? (
                  <img
                    src={scene.posterUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  'No preview'
                )}
              </div>
              <div style={{ padding: '1rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#f5f5f5', marginBottom: '0.25rem' }}>
                  {scene.title}
                </h3>
                {scene.description && (
                  <p style={{ fontSize: '0.8125rem', color: '#a3a3a3', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                    {scene.description}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {scene.splatCount && (
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        color: '#737373',
                        padding: '0.125rem 0.5rem',
                        border: '1px solid #2a2a2a',
                        borderRadius: 4,
                      }}
                    >
                      {(scene.splatCount / 1000).toFixed(0)}K splats
                    </span>
                  )}
                  {scene.publishedAt && (
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        color: '#737373',
                        padding: '0.125rem 0.5rem',
                        border: '1px solid #2a2a2a',
                        borderRadius: 4,
                      }}
                    >
                      {new Date(scene.publishedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
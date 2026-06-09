import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OrganizationSummary, SplatListItem } from '@gsplat/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function OrganizationPage() {
  const { slug } = useParams<{ slug: string }>();
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [splats, setSplats] = useState<SplatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`${API_BASE}/organizations/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setOrganization(data.organization);
        setSplats(data.splats ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [slug]);

  return (
    <div className="og-shell">
      <div className="og-noise" />
      <nav className="og-nav" aria-label="Primary navigation">
        <Link className="og-brand" to="/">OpenGaussian</Link>
        <div className="og-nav-links">
          <Link className="og-nav-link" to="/search">Search</Link>
          <Link className="og-nav-link" to="/login">Client login</Link>
          <Link className="og-button-secondary" to="/admin">Admin</Link>
        </div>
      </nav>

      <main className="og-page">
        {loading && <div className="og-search-layout"><div className="og-empty">Loading organization...</div></div>}
        {error && <div className="og-search-layout"><div className="og-error">{error}</div></div>}
        {!loading && organization && (
          <>
            <section className="og-detail-hero">
              <p className="og-eyebrow">Organization</p>
              <h1>{organization.name}</h1>
              {organization.description && <p>{organization.description}</p>}
              <div className="og-meta">
                <span className="og-pill">{organization.publishedSplatCount ?? splats.length} published splats</span>
                {organization.websiteUrl && (
                  <a className="og-pill" href={organization.websiteUrl} target="_blank" rel="noreferrer">Website</a>
                )}
              </div>
            </section>

            <section className="og-band">
              <div className="og-section-head">
                <div>
                  <h2>Published splats</h2>
                  <p>Public scenes from {organization.name}.</p>
                </div>
              </div>
              {splats.length > 0 ? (
                <div className="og-grid">
                  {splats.map((scene) => (
                    <Link className="og-card" key={scene.id} to={`/splats/${scene.slug}`}>
                      <div className="og-card-media">
                        {scene.posterUrl ? <img src={scene.posterUrl} alt="" /> : <span>No preview</span>}
                      </div>
                      <div className="og-card-body">
                        <p className="og-card-title">{scene.title}</p>
                        {scene.description && <p className="og-card-desc">{scene.description}</p>}
                        <div className="og-meta">
                          {scene.splatCount != null && <span className="og-pill">{scene.splatCount.toLocaleString()} splats</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="og-empty">This organization has no public splats yet.</div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

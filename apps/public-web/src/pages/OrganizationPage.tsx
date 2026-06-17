import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { OrganizationSummary, SplatListItem } from '@gsplat/shared';
import PublicNav from '../components/PublicNav';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const CATALOG_STATE_KEY = 'opengaussian_catalog_state_v1';

export default function OrganizationPage() {
  const { t } = useI18n();
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [splats, setSplats] = useState<SplatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const returnToCatalog = () => {
    const rawState = window.sessionStorage.getItem(CATALOG_STATE_KEY);
    if (rawState) {
      try {
        const parsed = JSON.parse(rawState) as { pathname?: unknown };
        navigate(typeof parsed.pathname === 'string' && parsed.pathname.startsWith('/') ? parsed.pathname : '/');
      } catch {
        navigate('/');
      }
      return;
    }
    navigate('/');
  };

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
      <div className="og-backdrop" aria-hidden="true" />
      <PublicNav />

      <main className="og-page">
        {loading && <div className="og-search-layout"><div className="og-empty">{t('org.loading')}</div></div>}
        {error && <div className="og-search-layout"><div className="og-error">{error}</div></div>}
        {!loading && organization && (
          <>
            <section className={`og-detail-hero${organization.previewUrl ? ' og-detail-hero--with-preview' : ''}`}>
              <div className="og-detail-copy-row">
                <button className="og-detail-back" type="button" onClick={returnToCatalog} aria-label={t('org.back')}>
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m15 6-6 6 6 6" />
                  </svg>
                </button>

                <div>
                  <p className="og-eyebrow">{t('catalog.kind.organization')}</p>
                  <h1>{organization.name}</h1>
                  {organization.description && <p>{organization.description}</p>}
                  <div className="og-meta">
                    <span className="og-pill">{organization.publishedSplatCount ?? splats.length} {t('catalog.publishedSplats')}</span>
                    {organization.websiteUrl && (
                      <a className="og-pill" href={organization.websiteUrl} target="_blank" rel="noreferrer">{t('org.website')}</a>
                    )}
                  </div>
                </div>
              </div>
              {organization.previewUrl && (
                <div className="og-organization-preview" aria-hidden="true">
                  <img src={organization.previewUrl} alt="" />
                </div>
              )}
            </section>

            <section className="og-band">
              <div className="og-section-head">
                <div>
                  <h2>{t('org.publishedSplats')}</h2>
                  <p>{t('org.scenesFrom', { name: organization.name })}</p>
                </div>
              </div>
              {splats.length > 0 ? (
                <div className="og-grid">
                  {splats.map((scene) => (
                    <Link className="og-card" key={scene.id} to={`/splats/${scene.slug}`}>
                      <div className="og-card-media">
                        {scene.posterUrl ? <img src={scene.posterUrl} alt="" /> : <span>{t('org.noPreview')}</span>}
                      </div>
                      <div className="og-card-body">
                        <p className="og-card-title">{scene.title}</p>
                        {scene.description && <p className="og-card-desc">{scene.description}</p>}
                        <div className="og-meta">
                          {scene.splatCount != null && <span className="og-pill">{scene.splatCount.toLocaleString()} {t('org.splats')}</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="og-empty">{t('org.empty')}</div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

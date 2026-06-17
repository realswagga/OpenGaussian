import { useEffect, useMemo, useState } from 'react';
import type { SplatSummary } from '@gsplat/shared';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function WidgetPage() {
  const { t } = useI18n();
  const [splats, setSplats] = useState<SplatSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/admin/splats`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        const published = (data.items || []).filter((s: SplatSummary) => s.status === 'PUBLISHED');
        setSplats(published);
        setSelectedId(published[0]?.id || '');
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const selected = useMemo(() => splats.find((s) => s.id === selectedId), [splats, selectedId]);
  const snippet = selected
    ? `<script src="${window.location.origin}/widget/gs-viewer.js"></script>\n\n<gs-viewer\n  scene="${selected.slug}"\n  height="560"\n  quality="auto"\n  show-markers="true"\n  vr="true"\n  locked="false"\n  ui="full">\n</gs-viewer>`
    : '';

  const copy = async () => {
    if (!snippet) return;
    await navigator.clipboard?.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">{t('widget.embed')}</p>
          <h1>{t('common.widget')}</h1>
          <p>{t('widget.copy')}</p>
        </div>
      </div>

      {error && <div className="admin-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="admin-split">
        <section className="admin-panel">
          {loading ? (
            <div className="admin-card admin-card--skeleton">
              <div className="admin-skeleton-line short" />
              <div className="admin-skeleton-line title" />
              <div className="admin-skeleton-media" />
            </div>
          ) : (
            <form className="admin-form">
              <label className="admin-label">
                {t('widget.publishedSplat')}
                <select className="admin-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  {splats.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </label>
              {selected && (
                <div className="admin-preview-card">
                  <div className="admin-preview-media">
                    {selected.posterKey && <img src={`/assets/${selected.posterKey}`} alt="" />}
                  </div>
                  <div className="admin-preview-body">
                    <strong>{selected.title}</strong>
                    <div className="admin-muted">{selected.organization?.name}</div>
                  </div>
                </div>
              )}
            </form>
          )}
        </section>

        <section className="admin-panel">
          <p className="admin-eyebrow">{t('widget.snippet')}</p>
          {loading ? (
            <div className="admin-code admin-code--skeleton">
              <div className="admin-skeleton-line wide" />
              <div className="admin-skeleton-line" />
              <div className="admin-skeleton-line short" />
            </div>
          ) : snippet ? (
            <>
              <pre className="admin-code">{snippet}</pre>
              <button className="admin-button" type="button" onClick={copy}>{copied ? t('common.copied') : t('widget.copyEmbed')}</button>
            </>
          ) : (
            <div className="admin-empty">{t('widget.empty')}</div>
          )}
        </section>
      </div>
    </>
  );
}

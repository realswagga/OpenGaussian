import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { OrganizationSummary, SearchResponse, SplatListItem } from '@gsplat/shared';
import PublicNav from '../components/PublicNav';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

type SortField = 'date' | 'count';
type SortDirection = 'asc' | 'desc';

type CatalogItem =
  | {
      kind: 'splat';
      id: string;
      title: string;
      description: string | null;
      href: string;
      posterUrl: string | null;
      organizationName: string | null;
      count: number;
      date: string | null;
    }
  | {
      kind: 'organization';
      id: string;
      title: string;
      description: string | null;
      href: string;
      posterUrl: string | null;
      organizationName: null;
      count: number;
      date: string | null;
    };

function formatCount(value: number) {
  return value.toLocaleString();
}

function sortFieldLabel(value: SortField) {
  return value === 'date' ? 'Date' : 'Splat count';
}

const heroPoints = Array.from({ length: 42 }, (_, index) => {
  const angle = index * 2.399963229728653;
  const radius = Math.sqrt((index + 1) / 42);
  return {
    x: 50 + Math.cos(angle) * radius * 38,
    y: 50 + Math.sin(angle) * radius * 30,
    size: 3 + (index % 5),
  };
});

function itemDate(item: CatalogItem) {
  return item.date ? new Date(item.date).getTime() : 0;
}

function splatToItem(scene: SplatListItem): CatalogItem {
  return {
    kind: 'splat',
    id: scene.id,
    title: scene.title,
    description: scene.description,
    href: `/splats/${scene.slug}`,
    posterUrl: scene.posterUrl,
    organizationName: scene.organization?.name ?? null,
    count: scene.splatCount ?? 0,
    date: scene.publishedAt,
  };
}

function organizationToItem(org: OrganizationSummary): CatalogItem {
  return {
    kind: 'organization',
    id: org.id,
    title: org.name,
    description: org.description,
    href: `/orgs/${org.slug}`,
    posterUrl: org.previewUrl ?? null,
    organizationName: null,
    count: org.publishedSplatCount ?? org.splatCount ?? 0,
    date: org.createdAt ?? null,
  };
}

function SplatPointField() {
  return (
    <div className="catalog-hero-pointfield" aria-hidden="true">
      {heroPoints.map((point, index) => (
        <span
          key={index}
          style={{
            '--x': `${point.x}%`,
            '--y': `${point.y}%`,
            '--s': `${point.size}px`,
            '--d': `${index * 28}ms`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

function CatalogCard({ item, index }: { item: CatalogItem; index: number }) {
  const isSplat = item.kind === 'splat';
  const initial = item.title.trim().charAt(0).toUpperCase() || 'O';

  return (
    <Link className={`catalog-card catalog-card--${item.kind}`} to={item.href} style={{ '--i': index } as CSSProperties}>
      <div className="catalog-card-media" aria-hidden="true">
        {item.posterUrl ? (
          <img src={item.posterUrl} alt="" loading="lazy" />
        ) : (
          <div className="catalog-card-mark">
            <span>{initial}</span>
          </div>
        )}
        <span className="catalog-kind">{isSplat ? 'Splat' : 'Organization'}</span>
      </div>
      <div className="catalog-card-body">
        <div>
          <h2>{item.title}</h2>
          {item.description && <p>{item.description}</p>}
        </div>
        <div className="catalog-card-meta">
          {isSplat && item.organizationName && <span>{item.organizationName}</span>}
          <span>{formatCount(item.count)} {isSplat ? 'points' : 'published'}</span>
        </div>
      </div>
    </Link>
  );
}

function CatalogSkeleton() {
  return (
    <div className="catalog-grid" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <div className="catalog-card catalog-card--skeleton" key={index} style={{ '--i': index } as CSSProperties}>
          <div className="catalog-skeleton-media" />
          <div className="catalog-card-body">
            <div className="catalog-skeleton-line wide" />
            <div className="catalog-skeleton-line" />
            <div className="catalog-skeleton-line short" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeSplats, setIncludeSplats] = useState(true);
  const [includeOrganizations, setIncludeOrganizations] = useState(true);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [featuredHeroItem, setFeaturedHeroItem] = useState<CatalogItem | null>(null);
  const [resultsMinHeight, setResultsMinHeight] = useState(560);
  const [catalogDocked, setCatalogDocked] = useState(false);

  useEffect(() => {
    const nextQuery = params.get('q') ?? '';
    setQuery((current) => (current === nextQuery ? current : nextQuery));
  }, [params]);

  useEffect(() => {
    const next = query.trim();
    const timer = window.setTimeout(() => {
      setParams(next ? { q: next } : {}, { replace: true });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, setParams]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(`${API_BASE}/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`Server error (${res.status})`);
          return res.json();
        })
        .then((next) => {
          setData(next);
          setLoading(false);
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          setError(err.message);
          setLoading(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!settingsOpen) return;

    const closeOnPointer = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };

    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [settingsOpen]);

  useEffect(() => {
    const updateDocked = () => {
      const top = consoleRef.current?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
      setCatalogDocked(top <= 69);
    };

    updateDocked();
    window.addEventListener('scroll', updateDocked, { passive: true });
    window.addEventListener('resize', updateDocked);
    return () => {
      window.removeEventListener('scroll', updateDocked);
      window.removeEventListener('resize', updateDocked);
    };
  }, []);

  const items = useMemo(() => {
    const combined: CatalogItem[] = [
      ...(includeSplats ? (data?.splats ?? []).map(splatToItem) : []),
      ...(includeOrganizations ? (data?.organizations ?? []).map(organizationToItem) : []),
    ];

    return combined.sort((a, b) => {
      const av = sortField === 'date' ? itemDate(a) : a.count;
      const bv = sortField === 'date' ? itemDate(b) : b.count;
      const direction = sortDirection === 'asc' ? 1 : -1;
      if (av !== bv) return (av - bv) * direction;
      return a.title.localeCompare(b.title);
    });
  }, [data, includeOrganizations, includeSplats, sortDirection, sortField]);

  const heroCandidate = useMemo(() => items.find((item) => item.posterUrl) ?? items[0] ?? null, [items]);
  const heroItem = heroCandidate ?? featuredHeroItem;
  const feedKey = `${query}|${includeSplats}|${includeOrganizations}|${sortField}|${sortDirection}|${items.map((item) => item.id).join(':')}`;
  const isInitialLoading = loading && !data;
  const isRefreshing = loading && Boolean(data);
  const typeSummary = includeSplats && includeOrganizations ? 'Splats + Orgs' : includeSplats ? 'Splats' : includeOrganizations ? 'Orgs' : 'None';
  const filterSummary = `${sortFieldLabel(sortField)} / ${sortDirection === 'asc' ? 'Asc' : 'Desc'} / ${typeSummary}`;

  useLayoutEffect(() => {
    if (!resultsRef.current || isInitialLoading || items.length === 0) return;
    const height = Math.ceil(resultsRef.current.getBoundingClientRect().height);
    const maxStableHeight = Math.round(window.innerHeight * 1.35);
    const nextHeight = Math.min(Math.max(height, 560), maxStableHeight);
    setResultsMinHeight((current) => (nextHeight > current ? nextHeight : current));
  }, [feedKey, isInitialLoading, items.length]);

  useEffect(() => {
    if (heroCandidate) setFeaturedHeroItem(heroCandidate);
  }, [heroCandidate]);

  const heroPreview = (
    <>
      {isInitialLoading ? (
        <div className="catalog-hero-skeleton" />
      ) : heroItem?.posterUrl ? (
        <>
          <SplatPointField />
          <img src={heroItem.posterUrl} alt="" />
        </>
      ) : (
        <SplatPointField />
      )}
      <div className="og-hero-preview-caption">
        <span>{isInitialLoading ? 'Catalog loading' : heroItem?.title ?? 'No matching preview'}</span>
        <span>{heroItem ? formatCount(heroItem.count) : '-'} {heroItem?.kind === 'organization' ? 'published' : 'points'}</span>
      </div>
      {heroItem && <span className="og-hero-preview-action">Open {heroItem.kind === 'splat' ? 'scene' : 'organization'}</span>}
    </>
  );

  return (
    <div className="og-shell">
      <div className="og-backdrop" aria-hidden="true" />
      <PublicNav />

      <main className="og-page">
        <section className="og-hero">
          <div className="og-hero-copy">
            <p className="og-kicker">Live Gaussian catalogue</p>
            <h1>OpenGaussian</h1>
            <p>
              Search splats and organizations from one quiet surface, then open a scene without losing the visual thread.
            </p>
          </div>

          {heroItem ? (
            <Link className="og-hero-preview" to={heroItem.href} aria-label={`Open ${heroItem.title}`}>
              {heroPreview}
            </Link>
          ) : (
            <aside className="og-hero-preview" aria-label="Catalog preview">
              {heroPreview}
            </aside>
          )}
        </section>

        <section ref={consoleRef} className={`catalog-console${catalogDocked ? ' is-docked' : ''}`} id="catalog" aria-label="Search catalog">
          <div className="catalog-console-head">
            <div>
              <p className="og-kicker">Search area</p>
              <h2>One feed for splats and organizations.</h2>
            </div>
            <p className="catalog-count" aria-live="polite">
              {isRefreshing ? 'Refreshing…' : `${items.length} result${items.length === 1 ? '' : 's'}`}
            </p>
          </div>

          <div className="catalog-controls">
            <label className="catalog-search">
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scenes or organizations"
                aria-label="Search splats and organizations"
              />
            </label>

            <div className="catalog-filter-menu" ref={settingsRef}>
              <button
                className="catalog-filter-trigger"
                type="button"
                onClick={() => setSettingsOpen((open) => !open)}
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
              >
                <span>Sort & filters</span>
                <strong>{filterSummary}</strong>
              </button>

              {settingsOpen && (
                <div className="catalog-filter-popover" role="dialog" aria-label="Sort and filter results">
                  <label className="catalog-filter-combo">
                    <span>Sort by</span>
                    <select value={sortField} onChange={(event) => setSortField(event.target.value as SortField)}>
                      <option value="date">Date</option>
                      <option value="count">Splat count</option>
                    </select>
                  </label>

                  <div className="catalog-filter-section">
                    <span className="catalog-filter-label">Direction</span>
                    <div className="catalog-direction-tabs" role="group" aria-label="Sort direction">
                      <button type="button" className={sortDirection === 'desc' ? 'active' : ''} aria-pressed={sortDirection === 'desc'} onClick={() => setSortDirection('desc')}>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M12 5v14m0 0 5-5m-5 5-5-5" />
                        </svg>
                        <span>Desc</span>
                      </button>
                      <button type="button" className={sortDirection === 'asc' ? 'active' : ''} aria-pressed={sortDirection === 'asc'} onClick={() => setSortDirection('asc')}>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M12 19V5m0 0 5 5m-5-5-5 5" />
                        </svg>
                        <span>Asc</span>
                      </button>
                    </div>
                  </div>

                  <div className="catalog-filter-section">
                    <span className="catalog-filter-label">Show</span>
                    <div className="catalog-filter-checks" aria-label="Result type filters">
                      <label>
                        <input type="checkbox" checked={includeSplats} onChange={(event) => setIncludeSplats(event.target.checked)} />
                        <span>Splats</span>
                      </label>
                      <label>
                        <input type="checkbox" checked={includeOrganizations} onChange={(event) => setIncludeOrganizations(event.target.checked)} />
                        <span>Orgs</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {error && <div className="og-error">{error}</div>}

        <section className="catalog-results" ref={resultsRef} style={{ minHeight: resultsMinHeight }} aria-busy={loading}>
          {isInitialLoading ? (
            <CatalogSkeleton />
          ) : items.length > 0 ? (
            <div className="catalog-grid">
              {items.map((item, index) => <CatalogCard key={`${item.kind}:${item.id}`} item={item} index={index} />)}
            </div>
          ) : (
            <div className="og-empty">
              <strong>No matching public results.</strong>
              <span>Try enabling both result types or clearing the search phrase.</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

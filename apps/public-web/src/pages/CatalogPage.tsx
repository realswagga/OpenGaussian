import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { OrganizationSummary, SearchResponse, SplatListItem } from '@gsplat/shared';

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
      posterUrl: null;
      organizationName: null;
      count: number;
      date: string | null;
    };

function formatCount(value: number) {
  return value.toLocaleString();
}

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
    posterUrl: null,
    organizationName: null,
    count: org.publishedSplatCount ?? org.splatCount ?? 0,
    date: org.createdAt ?? null,
  };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

function CatalogCard({ item, index }: { item: CatalogItem; index: number }) {
  const isSplat = item.kind === 'splat';
  const initial = item.title.trim().charAt(0).toUpperCase() || 'O';

  return (
    <Link className={`catalog-card catalog-card--${item.kind}`} to={item.href} style={{ '--i': index } as CSSProperties}>
      <div className="catalog-card-media" aria-hidden="true">
        {isSplat && item.posterUrl ? (
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
  const reducedMotion = useReducedMotion();

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

  const heroItem = useMemo(() => items.find((item) => item.kind === 'splat' && item.posterUrl) ?? items[0], [items]);
  const feedKey = `${query}|${includeSplats}|${includeOrganizations}|${sortField}|${sortDirection}|${items.map((item) => item.id).join(':')}`;
  const isInitialLoading = loading && !data;
  const isRefreshing = loading && Boolean(data);

  const scrollToCatalog = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const target = document.getElementById('catalog');
    target?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="og-shell">
      <div className="og-backdrop" aria-hidden="true" />
      <nav className="og-nav" aria-label="Primary navigation">
        <Link className="og-brand" to="/">OpenGaussian</Link>
        <div className="og-nav-links">
          <a className="og-nav-link" href="#catalog" onClick={scrollToCatalog}>Explore</a>
          <Link className="og-nav-link" to="/login">Client login</Link>
          <Link className="og-button-secondary" to="/admin">Admin</Link>
        </div>
      </nav>

      <main className="og-page">
        <section className="og-hero">
          <div className="og-hero-copy">
            <p className="og-kicker">Live Gaussian catalogue</p>
            <h1>OpenGaussian</h1>
            <p>
              Search splats and organizations from one quiet surface, then open a scene without losing the visual thread.
            </p>
            <div className="og-hero-actions">
              <a className="og-button" href="#catalog" onClick={scrollToCatalog}>Explore splats</a>
              <Link className="og-button-secondary" to="/signup">Create client account</Link>
            </div>
          </div>

          <aside className="og-hero-preview" aria-label="Catalog preview">
            {isInitialLoading ? (
              <div className="catalog-hero-skeleton" />
            ) : heroItem?.posterUrl ? (
              <img src={heroItem.posterUrl} alt="" />
            ) : (
              <div className="catalog-hero-mark">{heroItem?.title?.charAt(0).toUpperCase() ?? 'O'}</div>
            )}
            <div className="og-hero-preview-caption">
              <span>{heroItem?.title ?? 'Catalog loading'}</span>
              <span>{heroItem ? formatCount(heroItem.count) : '—'} {heroItem?.kind === 'organization' ? 'published' : 'points'}</span>
            </div>
          </aside>
        </section>

        <section className="catalog-console" id="catalog" aria-label="Search catalog">
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
                placeholder="scene, organization, slug"
                aria-label="Search splats and organizations"
              />
            </label>

            <label className="catalog-select">
              <span>Sort</span>
              <select value={sortField} onChange={(event) => setSortField(event.target.value as SortField)}>
                <option value="date">Date</option>
                <option value="count">Splats count</option>
              </select>
            </label>

            <button
              className="catalog-direction"
              type="button"
              onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
              aria-label={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}
            >
              <span aria-hidden="true">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              {sortDirection === 'asc' ? 'Asc' : 'Desc'}
            </button>

            <div className="catalog-checks" aria-label="Result type filters">
              <label>
                <input type="checkbox" checked={includeSplats} onChange={(event) => setIncludeSplats(event.target.checked)} />
                <span>Splats</span>
              </label>
              <label>
                <input type="checkbox" checked={includeOrganizations} onChange={(event) => setIncludeOrganizations(event.target.checked)} />
                <span>Organizations</span>
              </label>
            </div>
          </div>
        </section>

        {error && <div className="og-error">{error}</div>}

        <section className="catalog-results" aria-busy={loading}>
          {isInitialLoading ? (
            <CatalogSkeleton />
          ) : items.length > 0 ? (
            <div className="catalog-grid" key={feedKey}>
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

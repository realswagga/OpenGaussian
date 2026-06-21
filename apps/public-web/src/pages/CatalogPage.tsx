import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { LandingFeaturedResponse, OrganizationSummary, SearchResponse, SplatListItem } from '@gsplat/shared';
import PublicNav from '../components/PublicNav';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const CATALOG_STATE_KEY = 'opengaussian_catalog_state_v1';

type SortField = 'date' | 'count';
type SortDirection = 'asc' | 'desc';

interface CatalogRestoreState {
  pathname: string;
  query: string;
  includeSplats: boolean;
  includeOrganizations: boolean;
  sortField: SortField;
  sortDirection: SortDirection;
  scrollY: number;
}

interface CatalogSplatItem {
  kind: 'splat';
  id: string;
  title: string;
  description: string | null;
  href: string;
  posterUrl: string | null;
  organizationId: string | null;
  organizationSlug: string | null;
  organizationName: string | null;
  organizationDescription: string | null;
  organizationPreviewUrl: string | null;
  count: number;
  date: string | null;
}

interface CatalogOrganizationGroup {
  id: string;
  title: string;
  description: string | null;
  href: string | null;
  posterUrl: string | null;
  count: number;
  date: string | null;
  splats: CatalogSplatItem[];
  synthetic?: boolean;
}

type CatalogHeroItem =
  | CatalogSplatItem
  | {
      kind: 'organization';
      id: string;
      title: string;
      description: string | null;
      href: string;
      posterUrl: string | null;
      count: number;
      date: string | null;
    };

function formatCount(value: number) {
  return value.toLocaleString();
}

function sortFieldLabel(value: SortField, t: (key: string) => string) {
  return value === 'date' ? t('catalog.sort.date') : t('catalog.sort.count');
}

function isSortField(value: unknown): value is SortField {
  return value === 'date' || value === 'count';
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

function readCatalogRestoreState(): CatalogRestoreState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CATALOG_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CatalogRestoreState>;
    return {
      pathname: typeof parsed.pathname === 'string' && parsed.pathname.startsWith('/') ? parsed.pathname : '/',
      query: typeof parsed.query === 'string' ? parsed.query : '',
      includeSplats: typeof parsed.includeSplats === 'boolean' ? parsed.includeSplats : true,
      includeOrganizations: typeof parsed.includeOrganizations === 'boolean' ? parsed.includeOrganizations : true,
      sortField: isSortField(parsed.sortField) ? parsed.sortField : 'date',
      sortDirection: isSortDirection(parsed.sortDirection) ? parsed.sortDirection : 'asc',
      scrollY: typeof parsed.scrollY === 'number' ? parsed.scrollY : 0,
    };
  } catch {
    window.sessionStorage.removeItem(CATALOG_STATE_KEY);
    return null;
  }
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

function dateValue(value: string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}

function splatToItem(scene: SplatListItem): CatalogSplatItem {
  return {
    kind: 'splat',
    id: scene.id,
    title: scene.title,
    description: scene.description,
    href: `/splats/${scene.slug}`,
    posterUrl: scene.posterUrl,
    organizationId: scene.organization?.id ?? null,
    organizationSlug: scene.organization?.slug ?? null,
    organizationName: scene.organization?.name ?? null,
    organizationDescription: scene.organization?.description ?? null,
    organizationPreviewUrl: scene.organization?.previewUrl ?? null,
    count: scene.splatCount ?? 0,
    date: scene.publishedAt,
  };
}

function organizationToGroup(org: OrganizationSummary): CatalogOrganizationGroup {
  return {
    id: org.id,
    title: org.name,
    description: org.description,
    href: `/orgs/${org.slug}`,
    posterUrl: org.previewUrl ?? null,
    count: org.publishedSplatCount ?? org.splatCount ?? 0,
    date: org.createdAt ?? null,
    splats: [],
  };
}

function groupFromSplatOrg(item: CatalogSplatItem): CatalogOrganizationGroup {
  if (!item.organizationId || !item.organizationSlug || !item.organizationName) {
    return {
      id: 'independent-splats',
      title: 'catalog.independentTitle',
      description: 'catalog.independentDescription',
      href: null,
      posterUrl: item.posterUrl,
      count: 0,
      date: item.date,
      splats: [],
      synthetic: true,
    };
  }

  return {
    id: item.organizationId,
    title: item.organizationName,
    description: item.organizationDescription,
    href: `/orgs/${item.organizationSlug}`,
    posterUrl: item.organizationPreviewUrl ?? null,
    count: 0,
    date: item.date,
    splats: [],
  };
}

function organizationToHeroItem(org: OrganizationSummary): CatalogHeroItem {
  return {
    kind: 'organization',
    id: org.id,
    title: org.name,
    description: org.description,
    href: `/orgs/${org.slug}`,
    posterUrl: org.previewUrl ?? null,
    count: org.publishedSplatCount ?? org.splatCount ?? 0,
    date: org.createdAt ?? null,
  };
}

function selectFeaturedHeroItem(source: SearchResponse | null | undefined): CatalogHeroItem | null {
  const splatCandidates = (source?.splats ?? []).map(splatToItem);
  const featuredSplat = splatCandidates.find((item) => item.posterUrl) ?? splatCandidates[0] ?? null;
  if (featuredSplat) return featuredSplat;

  const featuredOrg = (source?.organizations ?? []).find((org) => org.previewUrl) ?? (source?.organizations ?? [])[0];
  return featuredOrg ? organizationToHeroItem(featuredOrg) : null;
}

function sortSplats(items: CatalogSplatItem[], sortField: SortField, sortDirection: SortDirection) {
  return [...items].sort((a, b) => {
    const av = sortField === 'date' ? dateValue(a.date) : a.count;
    const bv = sortField === 'date' ? dateValue(b.date) : b.count;
    const direction = sortDirection === 'asc' ? 1 : -1;
    if (av !== bv) return (av - bv) * direction;
    return a.title.localeCompare(b.title);
  });
}

function sortGroups(groups: CatalogOrganizationGroup[], sortField: SortField, sortDirection: SortDirection) {
  return [...groups].sort((a, b) => {
    const av = sortField === 'date' ? dateValue(a.date) : a.count;
    const bv = sortField === 'date' ? dateValue(b.date) : b.count;
    const direction = sortDirection === 'asc' ? 1 : -1;
    if (av !== bv) return (av - bv) * direction;
    return a.title.localeCompare(b.title);
  });
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

function CatalogCard({ item, index }: { item: CatalogSplatItem; index: number }) {
  const { t } = useI18n();
  const initial = item.title.trim().charAt(0).toUpperCase() || 'S';

  return (
    <Link className="catalog-card catalog-card--splat" to={item.href} style={{ '--i': index } as CSSProperties}>
      <div className="catalog-card-media" aria-hidden="true">
        {item.posterUrl ? (
          <img src={item.posterUrl} alt="" loading="lazy" />
        ) : (
          <div className="catalog-card-mark">
            <span>{initial}</span>
          </div>
        )}
        <span className="catalog-kind">{t('catalog.kind.splat')}</span>
      </div>
      <div className="catalog-card-body">
        <div>
          <h2>{item.title}</h2>
          {item.description && <p>{item.description}</p>}
        </div>
        <div className="catalog-card-meta">
          {item.organizationName && <span>{item.organizationName}</span>}
          <span>{formatCount(item.count)} {t('catalog.points')}</span>
        </div>
      </div>
    </Link>
  );
}

function OrganizationGroup({
  group,
  index,
  showSplats,
  onOpen,
}: {
  group: CatalogOrganizationGroup;
  index: number;
  showSplats: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const initial = group.title.trim().charAt(0).toUpperCase() || 'O';
  const headerStyle = { '--i': index } as CSSProperties;
  const preview = (
    <div className="catalog-org-preview" aria-hidden="true">
      {group.posterUrl ? (
        <img src={group.posterUrl} alt="" loading="lazy" />
      ) : (
        <div className="catalog-card-mark">
          <span>{initial}</span>
        </div>
      )}
    </div>
  );
  const headerContent = (
    <>
      {preview}
      <div className="catalog-org-copy">
        <p className="og-kicker">{group.synthetic ? t('catalog.kind.sceneGroup') : t('catalog.kind.organization')}</p>
        <h2>{group.synthetic ? t(group.title) : group.title}</h2>
        {group.description && <p>{group.synthetic ? t(group.description) : group.description}</p>}
        <div className="catalog-org-meta">
          <span>{formatCount(group.count)} {t('catalog.publishedSplats')}</span>
        </div>
      </div>
      {group.href && <span className="catalog-org-open" aria-hidden="true">{t('catalog.open')}</span>}
    </>
  );

  return (
    <section className="catalog-org-group" style={headerStyle}>
      {group.href ? (
        <Link className="catalog-org-banner" to={group.href} onClick={onOpen}>
          {headerContent}
        </Link>
      ) : (
        <div className="catalog-org-banner catalog-org-banner--static">{headerContent}</div>
      )}

      {showSplats && group.splats.length > 0 && (
        <div className="catalog-org-splats" aria-label={`${group.synthetic ? t(group.title) : group.title} ${t('catalog.splats')}`}>
          {group.splats.map((item, itemIndex) => (
            <CatalogCard key={item.id} item={item} index={index * 4 + itemIndex} />
          ))}
        </div>
      )}
      {showSplats && group.splats.length === 0 && (
        <div className="catalog-org-empty">{t('catalog.noOrgMatches')}</div>
      )}
    </section>
  );
}

function CatalogSkeleton({ grouped }: { grouped: boolean }) {
  if (!grouped) {
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

  return (
    <div className="catalog-group-feed" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, groupIndex) => (
        <section className="catalog-org-group catalog-org-group--skeleton" key={groupIndex}>
          <div className="catalog-org-banner">
            <div className="catalog-skeleton-media" />
            <div className="catalog-card-body">
              <div className="catalog-skeleton-line short" />
              <div className="catalog-skeleton-line wide" />
              <div className="catalog-skeleton-line" />
            </div>
          </div>
          <div className="catalog-org-splats">
            {Array.from({ length: 3 }).map((_, index) => (
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
        </section>
      ))}
    </div>
  );
}

export default function CatalogPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const initialRestore = useMemo(() => readCatalogRestoreState(), []);
  const [query, setQuery] = useState(initialRestore?.query ?? params.get('q') ?? '');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [featuredData, setFeaturedData] = useState<LandingFeaturedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeSplats, setIncludeSplats] = useState(initialRestore?.includeSplats ?? true);
  const [includeOrganizations, setIncludeOrganizations] = useState(initialRestore?.includeOrganizations ?? true);
  const [sortField, setSortField] = useState<SortField>(initialRestore?.sortField ?? 'date');
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialRestore?.sortDirection ?? 'asc');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [resultsMinHeight, setResultsMinHeight] = useState(560);
  const [catalogDocked, setCatalogDocked] = useState(false);
  const pendingRestoreScrollRef = useRef<number | null>(initialRestore?.scrollY ?? null);
  const skipNextParamSyncRef = useRef(Boolean(initialRestore));

  useEffect(() => {
    if (skipNextParamSyncRef.current) {
      skipNextParamSyncRef.current = false;
      return;
    }
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
    const controller = new AbortController();
    fetch(`${API_BASE}/landing-featured`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Server error (${res.status})`);
        return res.json();
      })
      .then((next) => setFeaturedData(next))
      .catch((err) => {
        if (err.name !== 'AbortError') setFeaturedData(null);
      });

    return () => controller.abort();
  }, []);

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

  const splatItems = useMemo(() => sortSplats((data?.splats ?? []).map(splatToItem), sortField, sortDirection), [data, sortDirection, sortField]);

  const organizationPreviewUrls = useMemo(() => {
    const previews = new Map<string, string | null>();

    (data?.organizations ?? []).forEach((org) => {
      previews.set(org.id, org.previewUrl ?? null);
    });

    (data?.splats ?? []).forEach((scene) => {
      const org = scene.organization;
      if (!org) return;
      const current = previews.get(org.id);
      if (!current && org.previewUrl) {
        previews.set(org.id, org.previewUrl);
      } else if (!previews.has(org.id)) {
        previews.set(org.id, org.previewUrl ?? null);
      }
    });

    return previews;
  }, [data]);

  const organizationGroups = useMemo(() => {
    const groups = new Map<string, CatalogOrganizationGroup>();

    if (includeOrganizations) {
      (data?.organizations ?? []).forEach((org) => {
        groups.set(org.id, organizationToGroup(org));
      });
    }

    if (includeSplats) {
      splatItems.forEach((item) => {
        const key = item.organizationId ?? 'independent-splats';
        const existing = groups.get(key) ?? groupFromSplatOrg(item);
        const latestSplatDate = dateValue(item.date);
        const groupDate = dateValue(existing.date);
        const organizationPreviewUrl = item.organizationId ? organizationPreviewUrls.get(item.organizationId) ?? item.organizationPreviewUrl : null;
        existing.splats.push(item);
        existing.count = Math.max(existing.count, existing.splats.length);
        if (!existing.synthetic && organizationPreviewUrl) existing.posterUrl = organizationPreviewUrl;
        if (existing.synthetic && !existing.posterUrl && item.posterUrl) existing.posterUrl = item.posterUrl;
        if (latestSplatDate > groupDate) existing.date = item.date;
        groups.set(key, existing);
      });
    }

    const withSortedSplats = [...groups.values()].map((group) => ({
      ...group,
      posterUrl: group.synthetic ? group.posterUrl : organizationPreviewUrls.get(group.id) ?? group.posterUrl,
      splats: sortSplats(group.splats, sortField, sortDirection),
    }));

    return sortGroups(withSortedSplats, sortField, sortDirection);
  }, [data, includeOrganizations, includeSplats, organizationPreviewUrls, sortDirection, sortField, splatItems]);

  const flatSplatItems = includeSplats ? splatItems : [];
  const useGroupedResults = includeOrganizations;
  const resultCount = useGroupedResults
    ? organizationGroups.length + (includeSplats ? organizationGroups.reduce((total, group) => total + group.splats.length, 0) : 0)
    : flatSplatItems.length;

  const featuredHeroItem = useMemo(() => featuredData?.splat ? splatToItem(featuredData.splat) : null, [featuredData]);
  const activeHeroFallback = useMemo(() => selectFeaturedHeroItem(data), [data]);
  const heroItem = featuredHeroItem ?? activeHeroFallback;
  const feedIds = useGroupedResults
    ? organizationGroups.map((group) => `${group.id}:${group.splats.map((item) => item.id).join(',')}`).join('|')
    : flatSplatItems.map((item) => item.id).join(':');
  const feedKey = `${query}|${includeSplats}|${includeOrganizations}|${sortField}|${sortDirection}|${feedIds}`;
  const isInitialLoading = loading && !data;
  const isRefreshing = loading && Boolean(data);
  const typeSummary = includeSplats && includeOrganizations ? `${t('catalog.splats')} + ${t('catalog.orgs')}` : includeSplats ? t('catalog.splats') : includeOrganizations ? t('catalog.orgs') : t('catalog.none');
  const filterSummary = `${sortFieldLabel(sortField, t)} / ${sortDirection === 'asc' ? t('catalog.asc') : t('catalog.desc')} / ${typeSummary}`;

  const saveCatalogState = useCallback(() => {
    window.sessionStorage.setItem(
      CATALOG_STATE_KEY,
      JSON.stringify({
        pathname: window.location.pathname === '/search' ? '/search' : '/',
        query,
        includeSplats,
        includeOrganizations,
        sortField,
        sortDirection,
        scrollY: window.scrollY,
      } satisfies CatalogRestoreState),
    );
  }, [includeOrganizations, includeSplats, query, sortDirection, sortField]);

  useLayoutEffect(() => {
    if (!resultsRef.current || isInitialLoading || resultCount === 0) return;
    const height = Math.ceil(resultsRef.current.getBoundingClientRect().height);
    const maxStableHeight = Math.round(window.innerHeight * 1.35);
    const nextHeight = Math.min(Math.max(height, 560), maxStableHeight);
    setResultsMinHeight((current) => (nextHeight > current ? nextHeight : current));
  }, [feedKey, isInitialLoading, resultCount]);

  useLayoutEffect(() => {
    if (pendingRestoreScrollRef.current == null || isInitialLoading) return;
    const scrollY = pendingRestoreScrollRef.current;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: 'auto' });
      pendingRestoreScrollRef.current = null;
      window.sessionStorage.removeItem(CATALOG_STATE_KEY);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [feedKey, isInitialLoading]);

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
        <span>{isInitialLoading ? t('catalog.loading') : heroItem?.title ?? t('catalog.noPreview')}</span>
        <span>{heroItem ? formatCount(heroItem.count) : '-'} {heroItem?.kind === 'organization' ? t('catalog.published') : t('catalog.points')}</span>
      </div>
      {heroItem && <span className="og-hero-preview-action">{heroItem.kind === 'splat' ? t('catalog.openScene') : t('catalog.openOrganization')}</span>}
    </>
  );

  return (
    <div className="og-shell">
      <div className="og-backdrop" aria-hidden="true" />
      <PublicNav />

      <main className="og-page">
        <section className="og-hero">
          <div className="og-hero-copy">
            <p className="og-kicker">{t('catalog.heroKicker')}</p>
            <h1>OpenGaussian</h1>
            <p>
              {t('catalog.heroCopy')}
            </p>
          </div>

          {heroItem ? (
            <Link className="og-hero-preview" to={heroItem.href} onClick={heroItem.kind === 'organization' ? saveCatalogState : undefined} aria-label={`${t('catalog.open')} ${heroItem.title}`}>
              {heroPreview}
            </Link>
          ) : (
            <aside className="og-hero-preview" aria-label={t('catalog.previewLabel')}>
              {heroPreview}
            </aside>
          )}
        </section>

        <section ref={consoleRef} className={`catalog-console${catalogDocked ? ' is-docked' : ''}`} id="catalog" aria-label={t('catalog.searchArea')}>
          <div className="catalog-console-head">
            <p className="og-kicker">{t('catalog.searchArea')}</p>
            <p className="catalog-count" aria-live="polite">
              {isRefreshing ? t('catalog.refreshing') : t(resultCount === 1 ? 'catalog.result' : 'catalog.results', { count: resultCount })}
            </p>
          </div>

          <div className="catalog-controls">
            <label className="catalog-search">
              <span>{t('catalog.search')}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('catalog.searchPlaceholder')}
                aria-label={t('catalog.searchAria')}
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
                <span>{t('catalog.sortFilters')}</span>
                <strong>{filterSummary}</strong>
              </button>

              {settingsOpen && (
                <div className="catalog-filter-popover" role="dialog" aria-label={t('catalog.sortFilterAria')}>
                  <label className="catalog-filter-combo">
                    <span>{t('catalog.sortBy')}</span>
                    <select value={sortField} onChange={(event) => setSortField(event.target.value as SortField)}>
                      <option value="date">{t('catalog.sort.date')}</option>
                      <option value="count">{t('catalog.sort.count')}</option>
                    </select>
                  </label>

                  <div className="catalog-filter-section">
                    <span className="catalog-filter-label">{t('catalog.direction')}</span>
                    <div className="catalog-direction-tabs" role="group" aria-label={t('catalog.directionAria')}>
                      <button type="button" className={sortDirection === 'desc' ? 'active' : ''} aria-pressed={sortDirection === 'desc'} onClick={() => setSortDirection('desc')}>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M12 5v14m0 0 5-5m-5 5-5-5" />
                        </svg>
                        <span>{t('catalog.desc')}</span>
                      </button>
                      <button type="button" className={sortDirection === 'asc' ? 'active' : ''} aria-pressed={sortDirection === 'asc'} onClick={() => setSortDirection('asc')}>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M12 19V5m0 0 5 5m-5-5-5 5" />
                        </svg>
                        <span>{t('catalog.asc')}</span>
                      </button>
                    </div>
                  </div>

                  <div className="catalog-filter-section">
                    <span className="catalog-filter-label">{t('catalog.show')}</span>
                    <div className="catalog-filter-checks" aria-label={t('catalog.resultTypeAria')}>
                      <label>
                        <input type="checkbox" checked={includeSplats} onChange={(event) => setIncludeSplats(event.target.checked)} />
                        <span>{t('catalog.splats')}</span>
                      </label>
                      <label>
                        <input type="checkbox" checked={includeOrganizations} onChange={(event) => setIncludeOrganizations(event.target.checked)} />
                        <span>{t('catalog.orgs')}</span>
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
            <CatalogSkeleton grouped={useGroupedResults} />
          ) : resultCount > 0 ? (
            useGroupedResults ? (
              <div className="catalog-group-feed">
                {organizationGroups.map((group, index) => (
                  <OrganizationGroup key={group.id} group={group} index={index} showSplats={includeSplats} onOpen={saveCatalogState} />
                ))}
              </div>
            ) : (
              <div className="catalog-grid">
                {flatSplatItems.map((item, index) => <CatalogCard key={item.id} item={item} index={index} />)}
              </div>
            )
          ) : (
            <div className="og-empty">
              <strong>{t('catalog.emptyTitle')}</strong>
              <span>{t('catalog.emptyHint')}</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

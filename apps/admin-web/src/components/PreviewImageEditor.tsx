import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type PointerEvent,
} from 'react';
import { Card, Button } from '@gsplat/ui';
import { useI18n } from '../i18n';

const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL || '/assets';
const PREVIEW_OUTPUT_WIDTH = 1600;
const PREVIEW_OUTPUT_HEIGHT = 900;
const PREVIEW_ASPECT = PREVIEW_OUTPUT_WIDTH / PREVIEW_OUTPUT_HEIGHT;
const MAX_PREVIEW_SOURCE_MB = parseInt(import.meta.env.VITE_MAX_PREVIEW_UPLOAD_MB || '24', 10);

interface PreviewSource {
  file: File;
  url: string;
  width: number;
  height: number;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PreviewHistoryItem {
  id: string;
  key?: string;
  url: string;
  label: string;
  createdAt?: string | null;
  current?: boolean;
  source: 'stored' | 'capture';
}

interface TakenPreviewPayload {
  dataUrl: string;
  name?: string;
  width?: number;
  height?: number;
  createdAt?: string;
}

interface PreviewImageEditorProps {
  currentKey: string | null;
  currentLabel?: string;
  emptyLabel?: string;
  outputFilename: string;
  uploadUrl: string;
  resetUrl?: string;
  historyUrl?: string;
  incomingSourceKey?: string;
  className?: string;
  onUploaded: (previewKey: string) => void;
  onReset?: () => void;
}

function assetUrl(key?: string | null, cacheKey?: number) {
  if (!key) return null;
  const suffix = cacheKey ? `?v=${cacheKey}` : '';
  if (/^https?:\/\//i.test(key) || key.startsWith('/')) return `${key}${suffix}`;
  return `${ASSET_BASE}/${key}${suffix}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCropRect(source: PreviewSource, zoom: number, offsetX: number, offsetY: number): CropRect {
  const sourceAspect = source.width / source.height;
  const baseHeight = sourceAspect > PREVIEW_ASPECT ? source.height : source.width / PREVIEW_ASPECT;
  const baseWidth = sourceAspect > PREVIEW_ASPECT ? source.height * PREVIEW_ASPECT : source.width;
  const width = baseWidth / zoom;
  const height = baseHeight / zoom;
  const maxCenterX = Math.max(0, (source.width - width) / 2);
  const maxCenterY = Math.max(0, (source.height - height) / 2);
  const centerX = source.width / 2 + (offsetX / 100) * maxCenterX;
  const centerY = source.height / 2 + (offsetY / 100) * maxCenterY;
  const maxX = Math.max(0, source.width - width);
  const maxY = Math.max(0, source.height - height);

  return {
    x: clamp(centerX - width / 2, 0, maxX),
    y: clamp(centerY - height / 2, 0, maxY),
    width,
    height,
  };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded'));
    image.src = url;
  });
}

function imageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;

  for (const file of Array.from(data.files)) {
    if (file.type.startsWith('image/')) return file;
  }

  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }

  return null;
}

function isEditableElement(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
}

function validatePreviewSource(file: File, t: (key: string, values?: Record<string, string | number>) => string): string | null {
  const allowedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  const allowedName = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!allowedType && !allowedName) return t('preview.imageType');
  if (file.size > MAX_PREVIEW_SOURCE_MB * 1024 * 1024) return t('preview.imageSize', { max: MAX_PREVIEW_SOURCE_MB });
  return null;
}

function readImageFile(file: File) {
  return new Promise<PreviewSource>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ file, url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Preview source could not be loaded.'));
    };
    image.src = url;
  });
}

async function fileFromUrl(url: string, filename: string) {
  const res = await fetch(url, url.startsWith('data:') ? undefined : { credentials: 'include' });
  if (!res.ok) throw new Error(`Preview source could not be loaded (${res.status}).`);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

async function renderPreviewBlob(source: PreviewSource, crop: CropRect) {
  const image = await loadImage(source.url);
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_OUTPUT_WIDTH;
  canvas.height = PREVIEW_OUTPUT_HEIGHT;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is not available');

  context.fillStyle = '#050505';
  context.fillRect(0, 0, PREVIEW_OUTPUT_WIDTH, PREVIEW_OUTPUT_HEIGHT);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    PREVIEW_OUTPUT_WIDTH,
    PREVIEW_OUTPUT_HEIGHT,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Preview image could not be created'));
    }, 'image/jpeg', 0.9);
  });
}

function displayDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function PreviewImageEditor({
  currentKey,
  currentLabel = 'Current preview',
  emptyLabel = 'No preview image',
  outputFilename,
  uploadUrl,
  resetUrl,
  historyUrl,
  incomingSourceKey,
  className = '',
  onUploaded,
  onReset,
}: PreviewImageEditorProps) {
  const { t } = useI18n();
  currentLabel = currentLabel === 'Current preview' ? t('preview.current') : currentLabel;
  emptyLabel = emptyLabel === 'No preview image' ? t('preview.empty') : emptyLabel;
  const inputRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [cacheKey, setCacheKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [storedHistory, setStoredHistory] = useState<PreviewHistoryItem[]>([]);
  const [capturedHistory, setCapturedHistory] = useState<PreviewHistoryItem[]>([]);

  const selectSource = useCallback(async (file: File) => {
    const validationError = validatePreviewSource(file, t);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoadingSource(true);
    setError('');
    setMessage('');

    try {
      const nextSource = await readImageFile(file);
      setSource(nextSource);
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      panelRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preview.imageLoad'));
    } finally {
      setLoadingSource(false);
    }
  }, []);

  const loadSourceFromUrl = useCallback(async (url: string, label: string) => {
    setLoadingSource(true);
    setError('');
    setMessage('');

    try {
      const file = await fileFromUrl(url, label);
      const validationError = validatePreviewSource(file, t);
      if (validationError) throw new Error(validationError);
      const nextSource = await readImageFile(file);
      setSource(nextSource);
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      panelRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preview.imageLoad'));
    } finally {
      setLoadingSource(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!historyUrl) return;
    try {
      const res = await fetch(historyUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(`Preview history failed (${res.status})`);
      const data = await res.json();
      const items = (data.items || [])
        .filter((item: { previewUrl?: string | null }) => item.previewUrl)
        .map((item: { key?: string; previewUrl: string; label?: string; createdAt?: string | null; current?: boolean }) => ({
          id: item.key || item.previewUrl,
          key: item.key,
          url: item.previewUrl,
          label: item.label || item.key?.split('/').pop() || 'Preview',
          createdAt: item.createdAt ?? null,
          current: Boolean(item.current),
          source: 'stored' as const,
        }));
      setStoredHistory(items);
    } catch {
      setStoredHistory([]);
    }
  }, [historyUrl]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, currentKey]);

  useEffect(() => {
    return () => {
      if (source?.url) URL.revokeObjectURL(source.url);
    };
  }, [source?.url]);

  useEffect(() => {
    if (!incomingSourceKey) return;
    const raw = sessionStorage.getItem(incomingSourceKey);
    if (!raw) return;
    sessionStorage.removeItem(incomingSourceKey);

    try {
      const payload = JSON.parse(raw) as TakenPreviewPayload;
      if (!payload.dataUrl) return;
      const createdAt = payload.createdAt || new Date().toISOString();
      const label = payload.name || `taken-preview-${Date.now()}.jpg`;
      const item: PreviewHistoryItem = {
        id: `capture:${createdAt}`,
        url: payload.dataUrl,
        label,
        createdAt,
        current: false,
        source: 'capture',
      };
      setCapturedHistory((current) => [item, ...current].slice(0, 8));
      void loadSourceFromUrl(payload.dataUrl, label);
      setMessage(t('preview.loadedTaken'));
    } catch {
      setError(t('preview.loadTakenFailed'));
    }
  }, [incomingSourceKey, loadSourceFromUrl]);

  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent) => {
    if (event.defaultPrevented || saving || resetting || loadingSource || !managerRef.current) return;
      if (isEditableElement(document.activeElement)) return;

      const file = imageFileFromClipboard(event.clipboardData);
      if (!file) return;

      event.preventDefault();
      void selectSource(file);
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [loadingSource, resetting, saving, selectSource]);

  const crop = useMemo(() => {
    if (!source) return null;
    return getCropRect(source, zoom, offsetX, offsetY);
  }, [source, zoom, offsetX, offsetY]);

  const currentPreviewUrl = assetUrl(currentKey, cacheKey);
  const historyItems = useMemo(() => [...capturedHistory, ...storedHistory], [capturedHistory, storedHistory]);
  const canPanX = Boolean(source && crop && source.width - crop.width > 1);
  const canPanY = Boolean(source && crop && source.height - crop.height > 1);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void selectSource(file);
    event.target.value = '';
  };

  const handlePanelPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    if (saving || resetting || loadingSource || isEditableElement(event.target as Element)) return;

    const file = imageFileFromClipboard(event.clipboardData);
    if (!file) return;

    event.preventDefault();
    event.stopPropagation();
    void selectSource(file);
  };

  const focusPanelFromSurface = (event: PointerEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('a, button, input, select, textarea')) return;
    panelRef.current?.focus();
  };

  const resetFrame = () => {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  };

  const reframeCurrent = () => {
    if (!currentPreviewUrl) return;
    void loadSourceFromUrl(currentPreviewUrl, currentKey?.split('/').pop() || outputFilename);
  };

  const chooseHistoryItem = (item: PreviewHistoryItem) => {
    void loadSourceFromUrl(item.url, item.label);
  };

  const uploadPreview = async () => {
    if (!source || !crop) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const blob = await renderPreviewBlob(source, crop);
      const formData = new FormData();
      formData.append('file', blob, outputFilename);

      const res = await fetch(uploadUrl, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || `Preview upload failed (${res.status})`);
      }

      const data = await res.json();
      const nextPreviewKey = data.preview?.previewKey || data.preview?.posterKey;
      if (!nextPreviewKey) throw new Error('Preview upload returned no image key');

      const nextCacheKey = Date.now();
      const nextPreviewUrl = data.preview?.previewUrl || data.preview?.posterUrl || assetUrl(nextPreviewKey, nextCacheKey) || '';
      setStoredHistory((current) => [
        {
          id: nextPreviewKey,
          key: nextPreviewKey,
          url: nextPreviewUrl,
          label: nextPreviewKey.split('/').pop() || 'Preview',
          createdAt: new Date().toISOString(),
          current: true,
          source: 'stored' as const,
        },
        ...current.filter((item) => item.key !== nextPreviewKey).map((item) => ({ ...item, current: false })),
      ].slice(0, 60));
      onUploaded(nextPreviewKey);
      setCacheKey(nextCacheKey);
      setMessage(t('preview.updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preview.uploadFailed'));
    } finally {
      setSaving(false);
    }
  };

  const resetPreview = async () => {
    if (!resetUrl || !currentPreviewUrl) return;

    setResetting(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(resetUrl, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: { message?: string } }).error?.message || `Preview reset failed (${res.status})`);
      }

      setSource(null);
      setCacheKey(Date.now());
      setStoredHistory((current) => current.map((item) => ({ ...item, current: false })));
      onReset?.();
      setMessage(t('preview.resetDone'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('preview.resetFailed'));
    } finally {
      setResetting(false);
    }
  };

  const previewImageStyle: CSSProperties | undefined = source && crop
    ? {
        left: `${(-crop.x / crop.width) * 100}%`,
        top: `${(-crop.y / crop.height) * 100}%`,
        width: `${(source.width / crop.width) * 100}%`,
        height: `${(source.height / crop.height) * 100}%`,
      }
    : undefined;

  return (
    <Card className={`admin-preview-manager ${className}`.trim()} style={{ padding: 0 }}>
      <section ref={managerRef} className="admin-preview-layout" aria-label="Preview editor">
        <aside className="admin-preview-current" aria-label={currentLabel}>
          <div className="admin-preview-frame">
          {currentPreviewUrl ? <img src={currentPreviewUrl} alt="" /> : <span>{t('preview.noPreview')}</span>}
          </div>
          <div className="admin-preview-caption">
            <strong>{currentLabel}</strong>
            <span>{currentKey ? currentKey.split('/').pop() : emptyLabel}</span>
          </div>
          <div className="admin-preview-current-actions">
            <Button type="button" variant="secondary" onClick={reframeCurrent} disabled={!currentPreviewUrl || saving || resetting || loadingSource}>
              {t('preview.reframe')}
            </Button>
            {resetUrl && (
              <Button type="button" variant="danger" onClick={() => void resetPreview()} disabled={!currentPreviewUrl || saving || resetting || loadingSource}>
                {resetting ? t('preview.resetting') : t('preview.resetDefault')}
              </Button>
            )}
          </div>

          <div className="admin-preview-history" aria-label={t('preview.history')}>
            <div className="admin-preview-history-head">
              <strong>{t('preview.history')}</strong>
              {historyUrl && (
                <button type="button" className="admin-preview-history-refresh" onClick={() => void loadHistory()}>
                  {t('common.refresh')}
                </button>
              )}
            </div>
            {historyItems.length > 0 ? (
              <div className="admin-preview-history-list">
                {historyItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`admin-preview-history-item${item.current ? ' is-current' : ''}`}
                    onClick={() => chooseHistoryItem(item)}
                  >
                    <img src={item.url} alt="" />
                    <span>
                      <strong>{item.source === 'capture' ? t('preview.taken') : item.current ? t('preview.currentItem') : t('preview.stored')}</strong>
                      <em>{item.label}</em>
                      {item.createdAt && <small>{displayDate(item.createdAt)}</small>}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="admin-preview-history-empty">{t('preview.noSaved')}</div>
            )}
          </div>
        </aside>

        <section
          ref={panelRef}
          className="admin-reframe-panel"
          aria-label={t('preview.upload')}
          tabIndex={0}
          onPointerDown={focusPanelFromSurface}
          onPaste={handlePanelPaste}
        >
          <div className="admin-reframe-head">
            <div>
              <h2>{t('preview.poster')}</h2>
              <p>{t('preview.posterCopy', { width: PREVIEW_OUTPUT_WIDTH, height: PREVIEW_OUTPUT_HEIGHT })}</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={saving || resetting || loadingSource}>
              {source ? t('preview.changeImage') : t('preview.selectImage')}
            </Button>
          </div>

          {error && <div className="admin-error admin-preview-message">{error}</div>}
          {message && <div className="admin-preview-success admin-preview-message">{message}</div>}

          <input
            ref={inputRef}
            className="admin-sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
          />

          {source && crop ? (
            <>
              <div className="admin-reframe-stage">
                <div className="admin-reframe-frame">
                  <img src={source.url} alt="" style={previewImageStyle} />
                  <span className="admin-reframe-rule admin-reframe-rule--vertical" />
                  <span className="admin-reframe-rule admin-reframe-rule--horizontal" />
                </div>
              </div>

              <div className="admin-reframe-controls">
                <label className="admin-range-field">
                  <span>{t('preview.zoom')}</span>
                  <input className="admin-range" type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
                  <strong>{Math.round(zoom * 100)}%</strong>
                </label>
                <label className="admin-range-field">
                  <span>X</span>
                  <input className="admin-range" type="range" min="-100" max="100" step="1" value={offsetX} disabled={!canPanX} onChange={(event) => setOffsetX(Number(event.target.value))} />
                  <strong>{offsetX}</strong>
                </label>
                <label className="admin-range-field">
                  <span>Y</span>
                  <input className="admin-range" type="range" min="-100" max="100" step="1" value={offsetY} disabled={!canPanY} onChange={(event) => setOffsetY(Number(event.target.value))} />
                  <strong>{offsetY}</strong>
                </label>
              </div>

              <div className="admin-preview-actions">
                <span className="admin-muted">{source.file.name} / {source.width}x{source.height}</span>
                <div className="admin-actions">
                  <Button type="button" variant="secondary" onClick={resetFrame} disabled={saving || resetting}>{t('common.reset')}</Button>
                  <Button type="button" variant="primary" onClick={uploadPreview} disabled={saving || resetting}>
                    {saving ? t('preview.uploading') : t('preview.save')}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <button
              className="admin-preview-drop"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={saving || resetting || loadingSource}
            >
              {loadingSource ? t('preview.loadingImage') : t('preview.selectPaste')}
            </button>
          )}
        </section>
      </section>
    </Card>
  );
}

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ClipboardEvent, type PointerEvent } from 'react';
import { Card, Button } from '@gsplat/ui';

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

interface PreviewImageEditorProps {
  currentKey: string | null;
  currentLabel?: string;
  emptyLabel?: string;
  outputFilename: string;
  uploadUrl: string;
  onUploaded: (previewKey: string) => void;
}

function assetUrl(key?: string | null, cacheKey?: number) {
  if (!key) return null;
  const suffix = cacheKey ? `?v=${cacheKey}` : '';
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

export default function PreviewImageEditor({
  currentKey,
  currentLabel = 'Current preview',
  emptyLabel = 'No preview image',
  outputFilename,
  uploadUrl,
  onUploaded,
}: PreviewImageEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [cacheKey, setCacheKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectSource = (file: File) => {
    const allowedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
    const allowedName = /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!allowedType && !allowedName) {
      setError('Preview source must be a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_PREVIEW_SOURCE_MB * 1024 * 1024) {
      setError(`Preview source exceeds ${MAX_PREVIEW_SOURCE_MB} MB.`);
      return;
    }

    setLoadingSource(true);
    setError('');
    setMessage('');

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setSource({ file, url, width: image.naturalWidth, height: image.naturalHeight });
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setLoadingSource(false);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setLoadingSource(false);
      setError('Preview source could not be loaded.');
    };
    image.src = url;
  };

  useEffect(() => {
    return () => {
      if (source?.url) URL.revokeObjectURL(source.url);
    };
  }, [source?.url]);

  const crop = useMemo(() => {
    if (!source) return null;
    return getCropRect(source, zoom, offsetX, offsetY);
  }, [source, zoom, offsetX, offsetY]);

  const currentPreviewUrl = assetUrl(currentKey, cacheKey);
  const canPanX = Boolean(source && crop && source.width - crop.width > 1);
  const canPanY = Boolean(source && crop && source.height - crop.height > 1);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) selectSource(file);
    event.target.value = '';
  };

  const handlePanelPaste = (event: ClipboardEvent<HTMLElement>) => {
    if (saving || loadingSource || isEditableElement(event.target as Element)) return;

    const file = imageFileFromClipboard(event.clipboardData);
    if (!file) return;

    event.preventDefault();
    selectSource(file);
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

      onUploaded(nextPreviewKey);
      setCacheKey(Date.now());
      setMessage('Preview updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview upload failed.');
    } finally {
      setSaving(false);
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
    <Card className="admin-preview-manager" style={{ padding: 0 }}>
      <div className="admin-preview-layout">
        <section className="admin-preview-current" aria-label={currentLabel}>
          <div className="admin-preview-frame">
            {currentPreviewUrl ? <img src={currentPreviewUrl} alt="" /> : <span>No preview</span>}
          </div>
          <div className="admin-preview-caption">
            <strong>{currentLabel}</strong>
            <span>{currentKey ? currentKey.split('/').pop() : emptyLabel}</span>
          </div>
        </section>

        <section
          ref={panelRef}
          className="admin-reframe-panel"
          aria-label="Upload preview"
          tabIndex={0}
          onPointerDown={focusPanelFromSurface}
          onPaste={handlePanelPaste}
        >
          <div className="admin-reframe-head">
            <div>
              <h2>Preview</h2>
              <p>16:9 poster, exported at {PREVIEW_OUTPUT_WIDTH}x{PREVIEW_OUTPUT_HEIGHT}.</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={saving || loadingSource}>
              {source ? 'Change image' : 'Select image'}
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
                  <span>Zoom</span>
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
                  <Button type="button" variant="secondary" onClick={resetFrame} disabled={saving}>Reset</Button>
                  <Button type="button" variant="primary" onClick={uploadPreview} disabled={saving}>
                    {saving ? 'Uploading...' : 'Save preview'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <button
              className="admin-preview-drop"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={saving || loadingSource}
            >
              {loadingSource ? 'Loading image...' : 'Select or paste an image to reframe'}
            </button>
          )}
        </section>
      </div>
    </Card>
  );
}

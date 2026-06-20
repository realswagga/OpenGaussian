import { useEffect, useState, useRef, type CSSProperties, type DragEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, Badge, Spinner, ProgressBar, Button } from '@gsplat/ui';
import { useI18n } from '../i18n';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const MAX_MB = parseInt(import.meta.env.VITE_MAX_UPLOAD_MB || '2048', 10);

type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

interface ProcessingStep {
  key: 'validation' | 'metadata' | 'conversion' | 'lod' | 'preview';
  status: 'pending' | 'running' | 'done' | 'failed';
  label: string;
  message?: string;
}

const steps: ProcessingStep[] = [
  { key: 'validation', status: 'pending', label: 'upload.steps.validating' },
  { key: 'metadata', status: 'pending', label: 'upload.steps.metadata' },
  { key: 'conversion', status: 'pending', label: 'upload.steps.converting' },
  { key: 'lod', status: 'pending', label: 'upload.steps.lod' },
  { key: 'preview', status: 'pending', label: 'upload.steps.preview' },
];

function RunningSplat() {
  return (
    <span className="admin-upload-splat" aria-hidden="true">
      {Array.from({ length: 9 }).map((_, index) => (
        <i key={index} style={{ '--dot': index } as CSSProperties} />
      ))}
    </span>
  );
}

export default function UploadPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const finalizingRef = useRef(false);
  const finalizingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestLogRef = useRef('');

  const [splat, setSplat] = useState<{ id: string; title: string; status: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [processSteps, setProcessSteps] = useState<ProcessingStep[]>(steps);
  const [jobLog, setJobLog] = useState('');

  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/admin/splats/${id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setSplat(data.splat || data))
      .catch(() => setError(t('upload.loadFailed')));
  }, [id]);

  useEffect(() => () => {
    if (finalizingTimerRef.current) clearTimeout(finalizingTimerRef.current);
  }, []);

  // Poll job status via SSE
  useEffect(() => {
    if (!jobId || state !== 'processing') return;

    const abort = new AbortController();
    const url = `${API_BASE}/admin/jobs/${jobId}/events`;

    fetch(url, { credentials: 'include', signal: abort.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error('Connection failed');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                setJobStatus(data.status);

                if (data.log) {
                  latestLogRef.current = data.log;
                  setJobLog(data.log);
                  updateStepsFromLog(data.log);
                }

                if (data.type === 'done') {
                  if (data.status === 'READY') finishProcessing();
                  else failProcessing(data.log || '');
                }
                if (data.type === 'error') {
                  failProcessing(data.log || data.message || '');
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      })
      .catch(() => {
        // Connection failed — fallback to polling
        pollingTimerRef.current = setInterval(async () => {
          try {
            const r = await fetch(`${API_BASE}/admin/jobs/${jobId}`, { credentials: 'include' });
            if (!r.ok) return;
            const data = await r.json();
            setJobStatus(data.job.status);
            if (data.job.log) {
              latestLogRef.current = data.job.log;
              setJobLog(data.job.log);
              updateStepsFromLog(data.job.log);
            }
            if (data.job.status === 'READY' && pollingTimerRef.current) { finishProcessing(); clearInterval(pollingTimerRef.current); }
            if (data.job.status === 'FAILED' && pollingTimerRef.current) { failProcessing(data.job.log || ''); clearInterval(pollingTimerRef.current); }
          } catch { /* keep polling through transient network failures */ }
        }, 3000);
      });

    return () => {
      abort.abort();
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    };
  }, [jobId, state]);

  function updateStepsFromLog(log: string) {
    const lines = log.split('\n');
    setProcessSteps((previous) => previous.map((step) => {
      if (step.key === 'preview') return step;
      const stageLines = lines.filter((line) => line.includes(`STAGE ${step.key} `));
      if (stageLines.some((line) => line.includes(' FAILED:'))) return { ...step, status: 'failed', message: stageLines.at(-1) };
      if (stageLines.some((line) => line.includes(' COMPLETED:') || line.includes(' SKIPPED:'))) {
        return { ...step, status: 'done', message: stageLines.at(-1) };
      }
      if (stageLines.some((line) => line.includes(' STARTED'))) return { ...step, status: 'running', message: stageLines.at(-1) };
      return step;
    }));
  }

  function finishProcessing() {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setProcessSteps((previous) => previous.map((step) => ({
      ...step,
      status: step.key === 'preview' ? 'running' : 'done',
    })));
    finalizingTimerRef.current = setTimeout(() => {
      setProcessSteps((previous) => previous.map((step) => (
        step.key === 'preview' ? { ...step, status: 'done', message: 'Preview handoff prepared' } : step
      )));
      setState('done');
      finalizingRef.current = false;
      finalizingTimerRef.current = null;
    }, 1400);
  }

  function failProcessing(log: string) {
    const resolvedLog = log || latestLogRef.current;
    const failure = resolvedLog.split('\n').reverse().find((line) => line.includes(' FAILED:'));
    setError(failure?.replace(/^STAGE\s+\w+\s+FAILED:\s*/, '') || t('upload.processingFailed'));
    setState('error');
  }

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) validateAndSetFile(f);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) validateAndSetFile(f);
  };

  const validateAndSetFile = (f: File) => {
    const lowerName = f.name.toLowerCase();
    const accepted = ['.ply', '.spz', '.sog', '.compressed.ply', '.meta.json', '.lod-meta.json'];
    const ext = accepted.find((suffix) => lowerName.endsWith(suffix)) || `.${lowerName.split('.').pop()}`;
    const extOk = accepted.some((suffix) => lowerName.endsWith(suffix));
    if (!extOk) {
      setError(t('upload.unsupported', { ext, formats: accepted.join(', ') }));
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(t('upload.tooLarge', { max: MAX_MB }));
      return;
    }
    setFile(f);
    setError('');
  };

  const handleUpload = async () => {
    if (!file || !id) return;

    setState('uploading');
    setError('');
    setUploadProgress(0);
    setProcessSteps(steps.map((s) => ({ ...s, status: 'pending' as const, message: undefined })));

    const formData = new FormData();
    formData.append('file', file);

    // Use XMLHttpRequest for progress tracking
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener('load', async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          setJobId(data.version?.id);
          setJobStatus(data.version?.status || 'RUNNING');
          if (data.version?.status === 'FAILED') {
            setError(data.version.processingError || t('upload.processingFailed'));
            setState('error');
          } else {
            setState('processing');
          }
        } catch {
          setError(t('upload.processingFailed'));
          setState('error');
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          setError(data.error?.message || t('upload.uploadFailed', { status: xhr.status }));
        } catch {
          setError(t('upload.uploadFailed', { status: xhr.status }));
        }
        setState('error');
      }
    });

    xhr.addEventListener('error', () => { setError(t('upload.networkError')); setState('error'); });
    xhr.open('POST', `${API_BASE}/admin/splats/${id}/upload`);
    xhr.withCredentials = true;
    xhr.send(formData);
  };

  const resetUpload = () => {
    if (finalizingTimerRef.current) clearTimeout(finalizingTimerRef.current);
    finalizingTimerRef.current = null;
    finalizingRef.current = false;
    setState('idle');
    setFile(null);
    setJobId(null);
    setJobStatus('');
    setJobLog('');
    latestLogRef.current = '';
    setError('');
    setUploadProgress(0);
    setProcessSteps(steps.map((step) => ({ ...step, status: 'pending' as const, message: undefined })));
  };

  if (!id) {
    return <div style={{ padding: '2rem', color: 'var(--admin-danger, var(--color-error))' }}>{t('upload.noSplatId')}</div>;
  }

  const stepIcon = (status: string) => {
    switch (status) {
      case 'done': return '✓';
      case 'failed': return '×';
      default: return '·';
    }
  };

  return (
    <div style={{ paddingTop: '0.5rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>
        {t('upload.title', { title: splat ? `- ${splat.title}` : '' })}
      </h1>

      {error && (
        <div className="admin-error" style={{ marginBottom: '1rem' }} role="alert">{error}</div>
      )}

      {state === 'idle' && (
        <Card style={{ padding: '0' }}>
          {/* Drag-and-drop zone */}
          <div
            ref={dropRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'var(--admin-ink, var(--color-ink))' : 'var(--color-rule)'}`,
              borderRadius: 12,
              padding: '3rem 2rem',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? 'var(--color-input)' : 'transparent',
              transition: 'border-color 150ms, background 150ms',
              margin: '1.5rem',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem', color: 'var(--color-rule)' }}>📤</div>
            <p style={{ color: 'var(--admin-soft, var(--color-ink-soft))', fontSize: '0.875rem', margin: '0 0 0.5rem' }}>
              {t('upload.drop')} <span style={{ color: 'var(--admin-ink, var(--color-ink))', textDecoration: 'underline' }}>{t('upload.browse')}</span>
            </p>
            <p style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.6875rem', margin: 0 }}>
              {t('upload.accepted')}
            </p>
            <p style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.6875rem', margin: '0.25rem 0 0' }}>
              {t('upload.maxSize', { max: MAX_MB })}
            </p>
          </div>

          {/* Selected file */}
          {file && (
            <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ flex: 1, padding: '0.625rem 0.875rem', background: 'var(--color-input)', borderRadius: 6, border: 'var(--rule)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1rem' }}>📄</span>
                <div>
                  <p style={{ color: 'var(--admin-ink, var(--color-ink))', fontSize: '0.8125rem', margin: 0 }}>{file.name}</p>
                  <p style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.6875rem', margin: '0.125rem 0 0' }}>
                    {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--admin-muted, var(--color-muted))', cursor: 'pointer', fontSize: '1rem' }}
                >
                  ×
                </button>
              </div>
              <Button variant="primary" onClick={handleUpload}>{t('upload.process')}</Button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".ply,.spz,.sog,.compressed.ply,.meta.json,.lod-meta.json"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
        </Card>
      )}

      {/* Uploading state */}
      {state === 'uploading' && (
        <Card style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <Spinner size="sm" />
            <span style={{ fontSize: '0.875rem' }}>{t('upload.uploading', { name: file?.name ?? '' })}</span>
          </div>
          <ProgressBar value={uploadProgress} label={t('upload.progress')} />
        </Card>
      )}

      {/* Processing state */}
      {(state === 'processing' || state === 'done' || (state === 'error' && jobId)) && (
        <Card className="admin-upload-process" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {state === 'processing' ? <Spinner size="sm" /> : <span className={`admin-upload-result admin-upload-result--${state}`} aria-hidden="true">{state === 'done' ? '✓' : '×'}</span>}
            <div>
              <p style={{ color: 'var(--admin-ink, var(--color-ink))', fontSize: '0.875rem', fontWeight: 600, margin: 0 }}>
                {state === 'done' ? t('upload.complete') : state === 'error' ? t('upload.processingFailed') : t('upload.processing')}
              </p>
              <p style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.75rem', margin: '0.125rem 0 0' }}>
                {jobStatus && <Badge variant={jobStatus === 'READY' ? 'success' : jobStatus === 'FAILED' ? 'danger' : 'warning'}>{jobStatus}</Badge>}
              </p>
            </div>
          </div>

          {/* Step progress */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {processSteps.map((s) => (
              <div key={s.label} className={`admin-upload-step is-${s.status}`}>
                <span className="admin-upload-step__mark">{s.status === 'running' ? <RunningSplat /> : stepIcon(s.status)}</span>
                <span>{t(s.label)}</span>
              </div>
            ))}
          </div>

          {jobLog && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--color-input)', borderRadius: 6, border: 'var(--rule)', maxHeight: 200, overflow: 'auto' }}>
              <pre style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.6875rem', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                {jobLog}
              </pre>
            </div>
          )}

          {state === 'done' && (
            <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem' }}>
              <Link to={`/splats/${id}`} style={{ textDecoration: 'none' }}>
                <Button variant="primary">{t('upload.back')}</Button>
              </Link>
              <Button variant="secondary" onClick={resetUpload}>
                {t('upload.another')}
              </Button>
            </div>
          )}

          {state === 'error' && (
            <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Link to={`/splats/${id}`} style={{ textDecoration: 'none' }}>
                <Button variant="secondary">{t('upload.back')}</Button>
              </Link>
              <Button variant="primary" onClick={resetUpload}>{t('upload.tryAgain')}</Button>
            </div>
          )}
        </Card>
      )}

      {state === 'error' && !jobId && (
        <Button variant="primary" onClick={resetUpload}>{t('upload.tryAgain')}</Button>
      )}
    </div>
  );
}


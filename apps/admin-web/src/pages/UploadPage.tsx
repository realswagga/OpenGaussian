import { useEffect, useState, useRef, type DragEvent, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, Badge, Spinner, ProgressBar, Button } from '@gsplat/ui';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const MAX_MB = parseInt(import.meta.env.VITE_MAX_UPLOAD_MB || '2048', 10);

type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

interface ProcessingStep {
  status: 'pending' | 'running' | 'done' | 'failed';
  label: string;
  message?: string;
}

const steps: ProcessingStep[] = [
  { status: 'pending', label: 'Validating' },
  { status: 'pending', label: 'Extracting metadata' },
  { status: 'pending', label: 'Converting' },
  { status: 'pending', label: 'Generating LOD' },
  { status: 'pending', label: 'Generating preview' },
];

export default function UploadPage() {
  const { id } = useParams<{ id: string }>();
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      .catch(() => setError('Failed to load splat'));
  }, [id]);

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
                  setJobLog(data.log);
                  updateStepsFromLog(data.log);
                }

                if (data.type === 'done') {
                  setState(data.status === 'READY' ? 'done' : 'error');
                }
                if (data.type === 'timeout' || data.type === 'error') {
                  setState('error');
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      })
      .catch(() => {
        // Connection failed — fallback to polling
        const interval = setInterval(async () => {
          try {
            const r = await fetch(`${API_BASE}/admin/jobs/${jobId}`, { credentials: 'include' });
            if (!r.ok) { clearInterval(interval); return; }
            const data = await r.json();
            setJobStatus(data.job.status);
            if (data.job.log) {
              setJobLog(data.job.log);
              updateStepsFromLog(data.job.log);
            }
            if (data.job.status === 'READY') { setState('done'); clearInterval(interval); }
            if (data.job.status === 'FAILED') { setState('error'); clearInterval(interval); }
          } catch { clearInterval(interval); }
        }, 3000);
        return () => clearInterval(interval);
      });

    return () => abort.abort();
  }, [jobId, state]);

  function updateStepsFromLog(log: string) {
    setProcessSteps((prev) =>
      prev.map((s) => {
        if (log.includes(`${s.label}`)) {
          return { ...s, status: log.includes('FAILED') ? 'failed' : log.includes('complete') ? 'done' : 'running', message: log };
        }
        return s;
      }),
    );
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
    const ext = '.' + f.name.split('.').pop()?.toLowerCase();
    const accepted = ['.ply', '.spz', '.sog', '.json', '.compressed.ply'];
    const isCompressedPly = f.name.toLowerCase().endsWith('.compressed.ply');
    const extOk = accepted.includes(ext) || isCompressedPly;
    if (!extOk) {
      setError(`Unsupported format "${ext}". Accepted: ${accepted.join(', ')}`);
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`File exceeds ${MAX_MB} MB limit`);
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
        const data = JSON.parse(xhr.responseText);
        setJobId(data.version?.id);
        setState('processing');
        setJobStatus('RUNNING');
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          setError(data.error?.message || `Upload failed (${xhr.status})`);
        } catch {
          setError(`Upload failed (${xhr.status})`);
        }
        setState('error');
      }
    });

    xhr.addEventListener('error', () => { setError('Network error during upload'); setState('error'); });
    xhr.open('POST', `${API_BASE}/admin/splats/${id}/upload`);
    xhr.withCredentials = true;
    xhr.send(formData);
  };

  if (!id) {
    return <div style={{ padding: '2rem', color: 'var(--admin-danger, var(--color-error))' }}>No splat ID specified.</div>;
  }

  const stepIcon = (status: string) => {
    switch (status) {
      case 'done': return '✓';
      case 'running': return '⏳';
      case 'failed': return '✗';
      default: return '○';
    }
  };
  const stepColor = (status: string) => {
    switch (status) {
      case 'done': return '#22c55e';
      case 'running': return '#eab308';
      case 'failed': return 'var(--admin-danger, var(--color-error))';
      default: return 'var(--color-rule)';
    }
  };

  return (
    <div style={{ paddingTop: '0.5rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>
        Upload {splat ? `— ${splat.title}` : ''}
      </h1>

      {error && (
        <Card style={{ borderColor: 'var(--admin-danger, var(--color-error))', background: 'oklch(70% 0.14 25 / 0.14)', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          <p style={{ color: 'var(--admin-danger, var(--color-error))', fontSize: '0.8125rem', margin: 0 }}>{error}</p>
        </Card>
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
              Drop a splat file here or <span style={{ color: 'var(--admin-ink, var(--color-ink))', textDecoration: 'underline' }}>click to browse</span>
            </p>
            <p style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.6875rem', margin: 0 }}>
              Accepted: .ply, .spz, .sog, .compressed.ply, .meta.json, .lod-meta.json
            </p>
            <p style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.6875rem', margin: '0.25rem 0 0' }}>
              Max size: {MAX_MB} MB
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
              <Button variant="primary" onClick={handleUpload}>Upload & Process</Button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".ply,.spz,.sog,.compressed.ply,.json"
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
            <span style={{ fontSize: '0.875rem' }}>Uploading {file?.name}...</span>
          </div>
          <ProgressBar value={uploadProgress} label="Upload progress" />
        </Card>
      )}

      {/* Processing state */}
      {(state === 'processing' || state === 'done') && (
        <Card style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {state === 'processing' ? <Spinner size="sm" /> : <span style={{ fontSize: '1.25rem' }}>✓</span>}
            <div>
              <p style={{ color: 'var(--admin-ink, var(--color-ink))', fontSize: '0.875rem', fontWeight: 600, margin: 0 }}>
                {state === 'done' ? 'Processing complete!' : 'Processing...'}
              </p>
              <p style={{ color: 'var(--admin-muted, var(--color-muted))', fontSize: '0.75rem', margin: '0.125rem 0 0' }}>
                {jobStatus && <Badge variant={jobStatus === 'READY' ? 'success' : jobStatus === 'FAILED' ? 'danger' : 'warning'}>{jobStatus}</Badge>}
              </p>
            </div>
          </div>

          {/* Step progress */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {processSteps.map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', fontSize: '0.8125rem' }}>
                <span style={{ color: stepColor(s.status), width: 16, textAlign: 'center' }}>{stepIcon(s.status)}</span>
                <span style={{ color: s.status === 'pending' ? 'var(--admin-muted, var(--color-muted))' : 'var(--admin-ink, var(--color-ink))' }}>{s.label}</span>
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
                <Button variant="primary">← Back to Splat</Button>
              </Link>
              <Button variant="secondary" onClick={() => {
                setState('idle');
                setFile(null);
                setJobId(null);
                setJobLog('');
                setProcessSteps(steps.map((s) => ({ ...s, status: 'pending' as const })));
              }}>
                Upload Another
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}


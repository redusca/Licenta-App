import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, ChevronRight, FolderOpen, Files, FolderSearch,
    CheckCircle, AlertCircle, Film,
    Copy, Download, Check,
    Languages, FileText, Loader2,
} from 'lucide-react';
import { FolderPickerModal } from '../components/FolderPickerModal';

const FLASK_BASE = 'http://127.0.0.1:5000';
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.mpeg', '.mpg']);

const SOURCE_LANGUAGES = [
    { value: 'auto', label: 'Auto-detect' },
    { value: 'en', label: 'English' },
    { value: 'ro', label: 'Romanian' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'es', label: 'Spanish' },
    { value: 'it', label: 'Italian' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'nl', label: 'Dutch' },
    { value: 'ru', label: 'Russian' },
    { value: 'ja', label: 'Japanese' },
    { value: 'zh', label: 'Chinese' },
    { value: 'ko', label: 'Korean' },
    { value: 'ar', label: 'Arabic' },
    { value: 'tr', label: 'Turkish' },
    { value: 'pl', label: 'Polish' },
];

const TRANSLATE_LANGUAGES = [
    { value: '', label: 'No translation (keep original)' },
    { value: 'en', label: 'English' },
    { value: 'ro', label: 'Romanian' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'es', label: 'Spanish' },
    { value: 'it', label: 'Italian' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'nl', label: 'Dutch' },
    { value: 'ru', label: 'Russian' },
    { value: 'ja', label: 'Japanese' },
    { value: 'zh-CN', label: 'Chinese (Simplified)' },
    { value: 'ko', label: 'Korean' },
    { value: 'ar', label: 'Arabic' },
    { value: 'tr', label: 'Turkish' },
    { value: 'pl', label: 'Polish' },
];

type OutputMode = 'copy' | 'virtual_drive';
interface Progress { stage: string; message: string; pct: number }
interface SubtitleResult {
    srtPath: string; srtContent: string;
    numSegments: number; metrics: Record<string, any>;
}

function isVideoFile(name: string): boolean {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
}
function fmtSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}
function fmtSec(sec: number | undefined): string {
    if (sec == null) return '—';
    if (sec < 60) return `${sec.toFixed(1)} s`;
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
const STAGE_LABELS: Record<string, string> = {
    extracting_audio: 'Extracting audio',
    loading_model: 'Loading Whisper model',
    inference: 'Transcribing',
    translating: 'Translating',
    generating_srt: 'Building SRT',
    done: 'Done',
    error: 'Error',
};

// ── Shared card style ─────────────────────────────────────────────────────────
const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-card)',
    padding: 20,
    boxShadow: 'var(--shadow-sm)',
};

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ progress }: { progress: Progress }) {
    return (
        <div style={{ ...card, borderColor: 'var(--c-clay)', background: 'var(--c-clay-bg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Loader2 style={{ width: 18, height: 18, color: 'var(--c-clay)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', display: 'block' }}>{progress.message}</span>
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textTransform: 'capitalize' }}>
                        {STAGE_LABELS[progress.stage] ?? progress.stage.replace(/_/g, ' ')}
                    </p>
                </div>
            </div>
        </div>
    );
}

// ── Metric row ────────────────────────────────────────────────────────────────
function MetricRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 0',
            borderBottom: last ? 'none' : '1px solid var(--border)',
        }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{value}</span>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export const SubtitleGeneratorPage: React.FC = () => {
    const navigate = useNavigate();
    const [outputPath, setOutputPath] = useState('');
    const [showAppExplorer, setShowAppExplorer] = useState(false);

    const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; size: number } | null>(null);
    const [sourceLanguage, setSourceLanguage] = useState('auto');
    const [translateTo, setTranslateTo] = useState('');
    const [outputMode, setOutputMode] = useState<OutputMode>('copy');

    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [result, setResult] = useState<SubtitleResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        fetch(`${FLASK_BASE}/api/agent/config`).then(r => r.json()).then(d => setOutputPath(d.output_path || '')).catch(() => {});
    }, []);

    const pickFile = useCallback((path: string, name: string, size: number) => {
        setSelectedFile({ path, name, size });
        setResult(null); setError(null); setProgress(null);
    }, []);

    const handleAppExplorerSelect = useCallback((paths: string[]) => {
        if (!paths.length) return;
        pickFile(paths[0], paths[0].split(/[\\/]/).pop() || paths[0], 0);
    }, [pickFile]);

    const browseFiles = async () => {
        const paths = await (window as any).electronAPI?.selectFiles?.({
            filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v'] }],
        });
        if (!paths?.length) return;
        pickFile(paths[0], paths[0].split(/[\\/]/).pop() || paths[0], 0);
    };

    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (!dir) return;
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(dir)}`);
            const data = await res.json();
            const files = (data.files || []).filter((f: any) => !f.is_dir && isVideoFile(f.name));
            if (files.length > 0) pickFile(files[0].path, files[0].name, files[0].size || 0);
        } catch { setError('Failed to list files in that folder.'); }
    };

    const generate = async () => {
        if (!selectedFile) return;
        setRunning(true); setResult(null); setError(null);
        setProgress({ stage: 'starting', message: 'Starting subtitle generation...', pct: 0 });
        try {
            const response = await fetch(`${FLASK_BASE}/api/tools/subtitle-generator/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoPath: selectedFile.path, sourceLanguage, translateTo, outputMode, outputPath }),
            });
            if (!response.body) throw new Error('No response stream');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop() ?? '';
                for (const part of parts) {
                    for (const line of part.split('\n')) {
                        if (!line.startsWith('data: ')) continue;
                        let evt: any;
                        try { evt = JSON.parse(line.slice(6)); } catch { continue; }
                        if (evt.stage === 'error') { setError(evt.message); setRunning(false); setProgress(null); return; }
                        if (evt.stage === 'done') {
                            setResult({ srtPath: evt.srtPath ?? '', srtContent: evt.srtContent ?? '', numSegments: evt.numSegments ?? 0, metrics: evt.metrics ?? {} });
                            setProgress({ stage: 'done', message: 'Subtitles generated!', pct: 1 });
                            setRunning(false); return;
                        }
                        setProgress({ stage: evt.stage, message: evt.message ?? evt.stage, pct: evt.progress ?? 0 });
                    }
                }
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Subtitle generation failed');
            setProgress(null);
        } finally { setRunning(false); }
    };

    const copySrt = async () => {
        if (!result) return;
        await navigator.clipboard.writeText(result.srtContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const downloadSrt = () => {
        if (!result) return;
        const blob = new Blob([result.srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(selectedFile?.name.replace(/\.[^/.]+$/, '') ?? 'subtitles')}.srt`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const canRun = !!selectedFile && !running;

    const selectStyle: React.CSSProperties = {
        width: '100%', fontSize: 13, padding: '8px 12px',
        borderRadius: 'var(--r-control)', outline: 'none',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        color: 'var(--ink)', appearance: 'auto',
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Breadcrumb */}
            <nav style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--muted)' }}>
                <Link to="/tools" className="tool-title-link" style={{ fontSize: 13, fontWeight: 400 }}>Tools</Link>
                <ChevronRight style={{ width: 13, height: 13 }} />
                <Link to="/tools?category=video" className="tool-title-link" style={{ fontSize: 13, fontWeight: 400 }}>Video</Link>
                <ChevronRight style={{ width: 13, height: 13 }} />
                <Link to="/tools/subtitle-generator" className="tool-title-link" style={{ fontSize: 13, fontWeight: 400 }}>Subtitle Generator</Link>
                <ChevronRight style={{ width: 13, height: 13 }} />
                <span style={{ color: 'var(--ink)' }}>Run</span>
            </nav>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: 12,
                        background: 'var(--c-clay-bg)', border: '1px solid var(--c-clay)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                        <Film style={{ width: 24, height: 24, color: 'var(--c-clay)' }} />
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>Subtitle Generator</h1>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Whisper-powered SRT subtitles from any video, with optional translation</p>
                    </div>
                </div>
                <button onClick={() => navigate('/tools/subtitle-generator')} className="btn btn-secondary" style={{ fontSize: 13 }}>
                    <ArrowLeft style={{ width: 14, height: 14 }} />Back to Info
                </button>
            </div>

            {/* Main grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>

                {/* ── Left column ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                    {/* File picker */}
                    <div style={card}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Video File</p>
                            {selectedFile && !running && (
                                <button onClick={() => { setSelectedFile(null); setResult(null); setError(null); setProgress(null); }}
                                    className="btn btn-ghost" style={{ fontSize: 12, padding: '2px 8px', color: 'var(--c-clay)' }}>
                                    Clear
                                </button>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => setShowAppExplorer(true)} disabled={running} className="btn btn-primary" style={{ fontSize: 13 }}>
                                <FolderOpen style={{ width: 14, height: 14 }} />App Explorer
                            </button>
                            <button onClick={browseFiles} disabled={running} className="btn btn-secondary" style={{ fontSize: 13, opacity: running ? 0.5 : 1 }}>
                                <Files style={{ width: 14, height: 14 }} />Select Files
                            </button>
                            <button onClick={browseFolder} disabled={running} className="btn btn-secondary" style={{ fontSize: 13, opacity: running ? 0.5 : 1 }}>
                                <FolderSearch style={{ width: 14, height: 14 }} />Select Folder
                            </button>
                        </div>

                        {!selectedFile && (
                            <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                                gap: 10, padding: '40px 20px', marginTop: 12,
                                border: '2px dashed var(--border-2)', borderRadius: 'var(--r-card)',
                                textAlign: 'center',
                            }}>
                                <Film style={{ width: 36, height: 36, color: 'var(--faint)' }} />
                                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>No video file selected.</p>
                                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--faint)' }}>Supports MP4, MKV, AVI, MOV, WebM and more.</p>
                            </div>
                        )}

                        {selectedFile && (
                            <div style={{
                                marginTop: 12, display: 'flex', alignItems: 'center', gap: 12,
                                padding: '10px 14px', borderRadius: 'var(--r-control)',
                                background: 'var(--c-clay-bg)', border: '1px solid var(--c-clay)',
                            }}>
                                <Film style={{ width: 18, height: 18, color: 'var(--c-clay)', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ margin: 0, fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {selectedFile.name}
                                    </p>
                                    <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {selectedFile.path}
                                    </p>
                                </div>
                                {selectedFile.size > 0 && (
                                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{fmtSize(selectedFile.size)}</span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Progress */}
                    {running && progress && <ProgressBar progress={progress} />}

                    {/* SRT output */}
                    {result && (
                        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 16px', borderBottom: '1px solid var(--border)',
                                background: 'var(--surface-2)',
                            }}>
                                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
                                    <FileText style={{ width: 15, height: 15, color: 'var(--c-clay)' }} />
                                    SRT Preview
                                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>({result.numSegments} segments)</span>
                                </p>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={copySrt} className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }}>
                                        {copied ? <Check style={{ width: 13, height: 13, color: 'var(--c-sage)' }} /> : <Copy style={{ width: 13, height: 13 }} />}
                                        {copied ? 'Copied!' : 'Copy'}
                                    </button>
                                    <button onClick={downloadSrt} className="btn btn-secondary" style={{ fontSize: 12, padding: '5px 10px' }}>
                                        <Download style={{ width: 13, height: 13 }} />Download SRT
                                    </button>
                                </div>
                            </div>
                            <textarea
                                readOnly
                                value={result.srtContent}
                                style={{
                                    width: '100%', minHeight: 240, padding: 16,
                                    background: 'var(--surface)', color: 'var(--ink)',
                                    fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.6,
                                    resize: 'vertical', border: 'none', outline: 'none',
                                    display: 'block',
                                }}
                            />
                        </div>
                    )}

                    {/* Saved path */}
                    {result?.srtPath && (
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '10px 14px', borderRadius: 'var(--r-control)',
                            background: 'var(--c-sage-bg)', border: '1px solid var(--c-sage)',
                        }}>
                            <CheckCircle style={{ width: 15, height: 15, color: 'var(--c-sage)', flexShrink: 0, marginTop: 1 }} />
                            <span
                                style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--c-sage)', wordBreak: 'break-all', cursor: 'pointer' }}
                                onClick={() => (window as any).electronAPI?.showItemInFolder?.(result.srtPath)}
                                title="Click to show in Explorer"
                            >
                                Saved: {result.srtPath}
                            </span>
                        </div>
                    )}

                    {/* How to use hint */}
                    {!result && !running && (
                        <div style={{
                            padding: '10px 14px', borderRadius: 'var(--r-control)',
                            background: 'var(--surface-2)', border: '1px solid var(--border)',
                            fontSize: 12, color: 'var(--muted)', lineHeight: 1.5,
                        }}>
                            <strong style={{ color: 'var(--ink-2)' }}>How to use:</strong> After generating, load the{' '}
                            <code style={{ color: 'var(--c-clay)', fontFamily: 'var(--font-mono)' }}>.srt</code> file in VLC via{' '}
                            <em>Subtitle → Add Subtitle File</em>, or place it in the same folder as the video (same filename) for auto-detection.
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '10px 14px', borderRadius: 'var(--r-control)',
                            background: 'var(--c-clay-bg)', border: '1px solid var(--c-clay)',
                        }}>
                            <AlertCircle style={{ width: 15, height: 15, color: 'var(--c-clay)', flexShrink: 0, marginTop: 1 }} />
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--c-clay)' }}>{error}</p>
                        </div>
                    )}
                </div>

                {/* ── Right column ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                    {/* Video Language */}
                    <div style={card}>
                        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Video Language</p>
                        <select value={sourceLanguage} onChange={e => setSourceLanguage(e.target.value)} style={selectStyle}>
                            {SOURCE_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--faint)' }}>Spoken language in the video audio.</p>
                    </div>

                    {/* Translate To */}
                    <div style={card}>
                        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
                            <Languages style={{ width: 14, height: 14, color: 'var(--muted)' }} />Translate To
                        </p>
                        <select value={translateTo} onChange={e => setTranslateTo(e.target.value)} style={selectStyle}>
                            {TRANSLATE_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--faint)' }}>Uses Google Translate. Leave blank to keep original language.</p>
                    </div>

                    {/* Save SRT */}
                    <div style={card}>
                        <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Save SRT</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {([
                                { value: 'copy' as OutputMode, label: 'Same folder as video', desc: 'Saves .srt next to the video file.' },
                                { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Saves to SubtitleResults folder.' },
                            ]).map(opt => (
                                <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                                    <input
                                        type="radio" name="srt-output" value={opt.value}
                                        checked={outputMode === opt.value}
                                        onChange={() => setOutputMode(opt.value)}
                                        style={{ marginTop: 2, accentColor: 'var(--c-clay)', flexShrink: 0 }}
                                    />
                                    <div>
                                        <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{opt.label}</span>
                                        <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>{opt.desc}</p>
                                        {opt.value === 'virtual_drive' && outputMode === 'virtual_drive' && (
                                            <p style={{ margin: '3px 0 0', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--c-clay)', wordBreak: 'break-all' }}>
                                                {outputPath ? `${outputPath}\\SubtitleResults` : 'No output path set in Settings.'}
                                            </p>
                                        )}
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Generate button */}
                    <button
                        onClick={generate}
                        disabled={!canRun}
                        className="btn"
                        style={{
                            width: '100%', justifyContent: 'center',
                            fontSize: 14, fontWeight: 600, padding: '12px 16px',
                            background: canRun ? 'var(--c-clay)' : 'var(--surface-3)',
                            color: canRun ? 'white' : 'var(--muted)',
                            borderRadius: 'var(--r-card)',
                            cursor: canRun ? 'pointer' : 'not-allowed',
                            border: 'none',
                            boxShadow: canRun ? '0 4px 14px oklch(0.6 0.18 22 / 0.25)' : 'none',
                            transition: 'all .15s var(--ease)',
                        }}
                    >
                        {running ? (
                            <>
                                <Film style={{ width: 16, height: 16, animation: 'pulse-soft 1.2s ease-in-out infinite' }} />
                                {progress?.stage === 'loading_model' ? 'Loading model...'
                                    : progress?.stage === 'extracting_audio' ? 'Extracting audio...'
                                    : progress?.stage === 'translating' ? 'Translating...'
                                    : 'Generating subtitles...'}
                            </>
                        ) : (
                            <><Film style={{ width: 16, height: 16 }} />Generate Subtitles</>
                        )}
                    </button>

                    {/* Metrics */}
                    {result?.metrics && Object.keys(result.metrics).length > 0 && (() => {
                        const rows = [
                            result.metrics.inference_time_s != null && { label: 'Inference time', value: fmtSec(result.metrics.inference_time_s) },
                            result.metrics.audio_duration_s != null && { label: 'Audio duration', value: fmtSec(result.metrics.audio_duration_s) },
                            result.metrics.rtf != null && { label: 'Real-time factor', value: `${Number(result.metrics.rtf).toFixed(3)}×` },
                            result.metrics.num_chunks != null && { label: 'Segments', value: String(result.metrics.num_chunks) },
                            result.metrics.gpu_peak_mb != null && { label: 'GPU peak', value: `${Number(result.metrics.gpu_peak_mb).toFixed(0)} MB` },
                            result.metrics.device && { label: 'Device', value: String(result.metrics.device) },
                        ].filter(Boolean) as { label: string; value: string }[];
                        return (
                            <div style={card}>
                                <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Metrics</p>
                                {rows.map((r, i) => <MetricRow key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />)}
                            </div>
                        );
                    })()}
                </div>
            </div>

            <FolderPickerModal
                isOpen={showAppExplorer}
                mode="file"
                onSelect={(path) => { handleAppExplorerSelect([path]); setShowAppExplorer(false); }}
                onClose={() => setShowAppExplorer(false)}
            />
        </div>
    );
};

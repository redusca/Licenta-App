import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, Mic, ChevronRight, FolderOpen, Files, FolderSearch,
    CheckCircle, AlertCircle, FileAudio,
    Copy, Download, Check,
} from 'lucide-react';
import { FolderPickerModal } from '../components/FolderPickerModal';

// ── Constants ────────────────────────────────────────────────────────────────

const FLASK_BASE = 'http://127.0.0.1:5000';
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mka']);
const LANGUAGES = [
    { value: 'auto', label: 'Auto-detect' },
    { value: 'en', label: 'English' },
    { value: 'ro', label: 'Romanian' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'es', label: 'Spanish' },
    { value: 'it', label: 'Italian' },
    { value: 'pt', label: 'Portuguese' },
];

// ── Types ────────────────────────────────────────────────────────────────────

type OutputMode = 'none' | 'copy' | 'virtual_drive';
interface Progress {
    stage: string;
    message: string;
    pct: number;
}

interface TranscribeResult {
    transcription: string;
    outputPath?: string;
    metrics: Record<string, any>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAudioFile(name: string): boolean {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return AUDIO_EXTENSIONS.has(ext);
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

function fmtMs(sec: number | undefined): string {
    if (sec == null) return '—';
    return sec < 1 ? `${(sec * 1000).toFixed(0)} ms` : `${sec.toFixed(2)} s`;
}

const STAGE_LABELS: Record<string, string> = {
    loading_model: 'Loading model',
    preprocessing: 'Preprocessing audio',
    inference: 'Transcribing',
    done: 'Done',
    error: 'Error',
};

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: Progress }) {
    const pct = Math.round(progress.pct * 100);
    const isIndeterminate = progress.stage === 'loading_model' && pct < 30;
    return (
        <div className="bg-slate-900 border border-purple-500/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">{progress.message}</span>
                <span className="text-xs font-mono text-purple-400">{pct}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                {isIndeterminate ? (
                    <div className="h-full bg-linear-to-r from-purple-600 to-purple-400 rounded-full animate-pulse w-1/3" />
                ) : (
                    <div
                        className="h-full bg-linear-to-r from-purple-600 to-purple-400 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                )}
            </div>
            <p className="text-xs text-slate-500 capitalize">
                {STAGE_LABELS[progress.stage] ?? progress.stage.replace(/_/g, ' ')}
            </p>
        </div>
    );
}

// ── Metric row ───────────────────────────────────────────────────────────────

function MetricRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0">
            <span className="text-xs text-slate-500">{label}</span>
            <span className="text-xs font-mono text-slate-300">{value}</span>
        </div>
    );
}

// ── Main page component ──────────────────────────────────────────────────────

export const AudioTranscriberPage: React.FC = () => {
    const navigate = useNavigate();
    const [outputPath, setOutputPath] = useState('');
    const [showAppExplorer, setShowAppExplorer] = useState(false);

    const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; size: number } | null>(null);
    const [language, setLanguage] = useState('auto');
    const [maxNewTokens, setMaxNewTokens] = useState(256);
    const [expectedText, setExpectedText] = useState('');
    const [outputMode, setOutputMode] = useState<OutputMode>('none');

    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [result, setResult] = useState<TranscribeResult | null>(null);
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
            filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'mka'] }],
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
            const files = (data.files || []).filter((f: any) => !f.is_dir && isAudioFile(f.name));
            if (files.length > 0) pickFile(files[0].path, files[0].name, files[0].size || 0);
        } catch { setError('Failed to list files in that folder.'); }
    };

    const transcribe = async () => {
        if (!selectedFile) return;
        setRunning(true);
        setResult(null);
        setError(null);
        setProgress({ stage: 'starting', message: 'Connecting to AI Gateway...', pct: 0 });

        try {
            const response = await fetch(`${FLASK_BASE}/api/tools/audio-transcriber/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filePath: selectedFile.path,
                    language,
                    maxNewTokens,
                    expectedText: expectedText.trim() || null,
                    outputMode: outputMode === 'none' ? '' : outputMode,
                    outputPath,
                }),
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

                        if (evt.stage === 'error') {
                            setError(evt.message);
                            setRunning(false);
                            setProgress(null);
                            return;
                        }
                        if (evt.stage === 'done') {
                            setResult({
                                transcription: evt.transcription ?? '',
                                outputPath: evt.outputPath,
                                metrics: evt.metrics ?? {},
                            });
                            setProgress({ stage: 'done', message: 'Transcription complete!', pct: 1 });
                            setRunning(false);
                            return;
                        }
                        setProgress({
                            stage: evt.stage,
                            message: evt.message ?? evt.stage,
                            pct: evt.progress ?? 0,
                        });
                    }
                }
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Transcription failed');
            setProgress(null);
        } finally {
            setRunning(false);
        }
    };

    const copyTranscript = async () => {
        if (!result) return;
        await navigator.clipboard.writeText(result.transcription);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const downloadTranscript = () => {
        if (!result) return;
        const blob = new Blob([result.transcription], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(selectedFile?.name.replace(/\.[^/.]+$/, '') ?? 'transcript')}_transcript.txt`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const canRun = !!selectedFile && !running;

    return (
        <div className="space-y-6 max-w-6xl mx-auto">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools?category=audio" className="hover:text-slate-300 transition-colors">Audio</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/audio-transcriber" className="hover:text-slate-300 transition-colors">Audio Transcriber</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                        <Mic className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Audio Transcriber</h1>
                        <p className="text-sm text-slate-500">Speech-to-text using Whisper Large V3 — runs locally on the AI Gateway</p>
                    </div>
                </div>
                <button onClick={() => navigate('/tools/audio-transcriber')}
                    className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                    <ArrowLeft className="w-4 h-4" />Back to Info
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ── Left ── */}
                <div className="lg:col-span-2 space-y-4">

                    {/* File picker */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-slate-300">Audio File</p>
                            {selectedFile && !running && (
                                <button onClick={() => { setSelectedFile(null); setResult(null); setError(null); setProgress(null); }}
                                    className="text-xs text-slate-500 hover:text-red-400 transition-colors">Clear</button>
                            )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <button type="button" onClick={() => setShowAppExplorer(true)} disabled={running} className="btn btn-primary">
                                <FolderOpen className="w-4 h-4" />App Explorer
                            </button>
                            <button onClick={browseFiles} disabled={running} className="btn btn-secondary">
                                <Files className="w-4 h-4" />Select Files
                            </button>
                            <button onClick={browseFolder} disabled={running} className="btn btn-secondary">
                                <FolderSearch className="w-4 h-4" />Select Folder
                            </button>
                        </div>

                        {!selectedFile && (
                            <div className="flex flex-col items-center gap-3 py-12 mt-4 border-2 border-dashed border-slate-700 rounded-xl text-center">
                                <Mic className="w-10 h-10 text-slate-600" />
                                <p className="text-sm text-slate-500">No audio file selected.</p>
                                <p className="text-xs text-slate-600">Supports MP3, WAV, FLAC, OGG, M4A, AAC and more.</p>
                            </div>
                        )}

                        {selectedFile && (
                            <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700">
                                <FileAudio className="w-5 h-5 text-purple-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-mono truncate text-slate-200">{selectedFile.name}</p>
                                    <p className="text-xs text-slate-500 truncate">{selectedFile.path}</p>
                                </div>
                                {selectedFile.size > 0 && <span className="text-xs text-slate-500 shrink-0">{fmtSize(selectedFile.size)}</span>}
                            </div>
                        )}
                    </div>

                    {/* Progress bar */}
                    {running && progress && <ProgressBar progress={progress} />}

                    {/* Transcript output */}
                    {result && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-800/30">
                                <p className="text-sm font-semibold text-slate-300">Transcript</p>
                                <div className="flex items-center gap-2">
                                    <button onClick={copyTranscript}
                                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                                        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                                        {copied ? 'Copied!' : 'Copy'}
                                    </button>
                                    <button onClick={downloadTranscript}
                                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                                        <Download className="w-3.5 h-3.5" />Download TXT
                                    </button>
                                </div>
                            </div>
                            <textarea
                                readOnly
                                value={result.transcription}
                                className="w-full min-h-48 p-5 bg-transparent text-sm text-slate-200 resize-y font-sans leading-relaxed focus:outline-none"
                            />
                        </div>
                    )}

                    {/* Saved path */}
                    {result?.outputPath && (
                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/25 border border-emerald-200 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-sm">
                            <CheckCircle className="w-4 h-4 shrink-0" />
                            <span
                                className="text-xs font-mono break-all cursor-pointer hover:underline"
                                onClick={() => (window as any).electronAPI?.showItemInFolder?.(result.outputPath)}
                                title="Click to show in Explorer"
                            >Saved: {result.outputPath}</span>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <p>{error}</p>
                        </div>
                    )}
                </div>

                {/* ── Right ── */}
                <div className="space-y-4">

                    {/* Language */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <p className="text-sm font-semibold text-slate-300 mb-3">Language</p>
                        <select value={language} onChange={e => setLanguage(e.target.value)}
                            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:ring-1 focus:ring-purple-500/40">
                            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                    </div>

                    {/* Advanced */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <p className="text-sm font-semibold text-slate-300 mb-3">Advanced</p>
                        <div className="space-y-3">
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs text-slate-400">Max tokens</label>
                                    <span className="text-xs font-mono text-purple-400">{maxNewTokens}</span>
                                </div>
                                <input type="range" min={64} max={1024} step={64} value={maxNewTokens}
                                    onChange={e => setMaxNewTokens(Number(e.target.value))}
                                    className="w-full accent-purple-500" />
                                <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                                    <span>64 — short</span><span>1024 — long</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 block mb-1.5">
                                    Expected text <span className="text-slate-600">(optional — enables WER/CER)</span>
                                </label>
                                <textarea value={expectedText} onChange={e => setExpectedText(e.target.value)}
                                    placeholder="Paste ground-truth text..." rows={3}
                                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 resize-none focus:outline-none focus:ring-1 focus:ring-purple-500/40 placeholder-slate-600" />
                            </div>
                        </div>
                    </div>

                    {/* Save transcript */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <p className="text-sm font-semibold text-slate-300 mb-3">Save Transcript</p>
                        <div className="space-y-3">
                            {([
                                { value: 'none' as OutputMode, label: 'Do not save', desc: 'Transcript shown in app only.' },
                                { value: 'copy' as OutputMode, label: 'Same folder', desc: 'Save .txt alongside the audio file.' },
                                { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Save to TranscriptResults drive.' },
                            ]).map(opt => (
                                <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                                    <input type="radio" name="trans-output" value={opt.value}
                                        checked={outputMode === opt.value}
                                        onChange={() => setOutputMode(opt.value)}
                                        className="mt-0.5 accent-purple-500 shrink-0" />
                                    <div>
                                        <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{opt.label}</span>
                                        <p className="text-xs text-slate-500">{opt.desc}</p>
                                        {opt.value === 'virtual_drive' && outputMode === 'virtual_drive' && (
                                            <p className="text-xs font-mono mt-0.5 text-purple-400 break-all">
                                                {outputPath ? `${outputPath}\\TranscriptResults` : 'No output path set in Settings.'}
                                            </p>
                                        )}
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Run button */}
                    <button onClick={transcribe} disabled={!canRun}
                        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px 14px' }}>
                        {running ? (
                            <>
                                <Mic className="w-4 h-4 animate-pulse" />
                                {progress?.stage === 'loading_model' ? 'Loading model...' : 'Transcribing...'}
                            </>
                        ) : (
                            <><Mic className="w-4 h-4" />Transcribe Audio</>
                        )}
                    </button>

                    {/* Metrics */}
                    {result?.metrics && Object.keys(result.metrics).length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Metrics</p>
                            {result.metrics.inference_time_s != null && (
                                <MetricRow label="Inference time" value={fmtMs(result.metrics.inference_time_s)} />
                            )}
                            {result.metrics.audio_duration_s != null && (
                                <MetricRow label="Audio duration" value={fmtSec(result.metrics.audio_duration_s)} />
                            )}
                            {result.metrics.rtf != null && (
                                <MetricRow label="Real-time factor" value={`${Number(result.metrics.rtf).toFixed(3)}×`} />
                            )}
                            {result.metrics.num_tokens != null && (
                                <MetricRow label="Tokens generated" value={String(result.metrics.num_tokens)} />
                            )}
                            {result.metrics.gpu_peak_mb != null && (
                                <MetricRow label="GPU peak" value={`${Number(result.metrics.gpu_peak_mb).toFixed(0)} MB`} />
                            )}
                            {result.metrics.wer != null && (
                                <MetricRow label="WER" value={`${(Number(result.metrics.wer) * 100).toFixed(1)} %`} />
                            )}
                            {result.metrics.cer != null && (
                                <MetricRow label="CER" value={`${(Number(result.metrics.cer) * 100).toFixed(1)} %`} />
                            )}
                            {result.metrics.device && (
                                <MetricRow label="Device" value={String(result.metrics.device)} />
                            )}
                        </div>
                    )}
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

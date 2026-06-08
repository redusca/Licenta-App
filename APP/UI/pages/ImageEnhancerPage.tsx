import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, Sparkles, ChevronRight, FolderOpen,
    RefreshCw, CheckCircle, AlertCircle, FileImage,
    Download, Cpu, ZapOff, Zap, Monitor,
} from 'lucide-react';
import { FolderPickerModal } from '../components/FolderPickerModal';

// ── Constants ────────────────────────────────────────────────────────────────

const FLASK_BASE = 'http://127.0.0.1:5000';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ── Types ────────────────────────────────────────────────────────────────────

type OutputMode = 'copy' | 'virtual_drive';

interface GatewayModel { name: string; is_loaded: boolean; device: string; task: string }

interface Progress {
    stage: string;
    message: string;
    pct: number;
}

interface EnhanceResult {
    outputPath: string;
    previewBase64: string;
    metrics: Record<string, any>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function fmtMs(sec: number | undefined): string {
    if (sec == null) return '—';
    return sec < 1 ? `${(sec * 1000).toFixed(0)} ms` : `${sec.toFixed(2)} s`;
}

const STAGE_LABELS: Record<string, string> = {
    loading_model: 'Loading model',
    inference: 'Running inference',
    postprocess: 'Post-processing',
    done: 'Done',
    error: 'Error',
};

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: Progress }) {
    const pct = Math.round(progress.pct * 100);
    const isLoading = progress.stage === 'loading_model' && pct < 30;
    return (
        <div className="bg-slate-900 border border-blue-500/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">{progress.message}</span>
                <span className="text-xs font-mono text-blue-400">{pct}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                {isLoading ? (
                    <div className="h-full bg-linear-to-r from-blue-600 to-blue-400 rounded-full animate-pulse w-1/3" />
                ) : (
                    <div
                        className="h-full bg-linear-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-700 ease-out"
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

export const ImageEnhancerPage: React.FC = () => {
    const navigate = useNavigate();
    const [outputPath, setOutputPath] = useState('');
    const [showAppExplorer, setShowAppExplorer] = useState(false);

    const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; size: number } | null>(null);
    const [outputMode, setOutputMode] = useState<OutputMode>('copy');

    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [result, setResult] = useState<EnhanceResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [gatewayModels, setGatewayModels] = useState<GatewayModel[]>([]);
    const [gatewayOnline, setGatewayOnline] = useState<boolean | null>(null);

    useEffect(() => {
        fetch(`${FLASK_BASE}/api/agent/config`).then(r => r.json()).then(d => setOutputPath(d.output_path || '')).catch(() => {});
        fetch(`${FLASK_BASE}/api/tools/ai-gateway/status`).then(r => r.json()).then(gwData => {
            if (gwData?.status === 'ok') { setGatewayOnline(true); setGatewayModels(gwData.models || []); }
            else setGatewayOnline(false);
        }).catch(() => setGatewayOnline(false));
    }, []);

    const pickFile = useCallback((path: string, name: string, size: number) => {
        setSelectedFile({ path, name, size });
        setResult(null); setError(null); setProgress(null);
    }, []);

    const browseWindows = async () => {
        const paths = await (window as any).electronAPI?.selectFiles?.({
            filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
        });
        if (!paths?.length) return;
        pickFile(paths[0], paths[0].split(/[\\/]/).pop() || paths[0], 0);
    };

    const enhance = async () => {
        if (!selectedFile) return;
        setRunning(true);
        setResult(null);
        setError(null);
        setProgress({ stage: 'starting', message: 'Connecting to AI Gateway...', pct: 0 });

        try {
            const response = await fetch(`${FLASK_BASE}/api/tools/image-enhancer/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: selectedFile.path, outputMode, outputPath }),
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
                                previewBase64: evt.image_base64,
                                outputPath: evt.outputPath ?? '',
                                metrics: evt.metrics ?? {},
                            });
                            setProgress({ stage: 'done', message: 'Upscaling complete!', pct: 1 });
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
            setError(e instanceof Error ? e.message : 'Enhancement failed');
            setProgress(null);
        } finally {
            setRunning(false);
        }
    };

    const downloadResult = () => {
        if (!result) return;
        const link = document.createElement('a');
        link.href = `data:image/png;base64,${result.previewBase64}`;
        link.download = `${(selectedFile?.name.replace(/\.[^/.]+$/, '') ?? 'image')}_upscaled.png`;
        link.click();
    };

    const swin2srModel = gatewayModels.find(m => m.name === 'swin2sr' || m.name?.toLowerCase().includes('swin'));
    const canRun = !!selectedFile && !running && !(outputMode === 'virtual_drive' && !outputPath);
    const previewUrl = selectedFile ? `${FLASK_BASE}/api/tools/preview?path=${encodeURIComponent(selectedFile.path)}` : null;

    return (
        <div className="space-y-6 max-w-6xl mx-auto">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools?category=image" className="hover:text-slate-300 transition-colors">Image</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/image-enhancer" className="hover:text-slate-300 transition-colors">AI Image Enhancer</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">AI Image Enhancer</h1>
                        <p className="text-sm text-slate-500">Super-resolve images ×2 using Swin2SR — runs locally on the AI Gateway</p>
                    </div>
                </div>
                <button onClick={() => navigate('/tools/image-enhancer')}
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
                            <p className="text-sm font-semibold text-slate-300">Input Image</p>
                            {selectedFile && !running && (
                                <button onClick={() => { setSelectedFile(null); setResult(null); setError(null); setProgress(null); }}
                                    className="text-xs text-slate-500 hover:text-red-400 transition-colors">Clear</button>
                            )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <button onClick={() => setShowAppExplorer(true)} disabled={running} className="btn btn-primary">
                                <FolderOpen className="w-4 h-4" />App Explorer
                            </button>
                            <button onClick={browseWindows} disabled={running} className="btn btn-secondary">
                                <Monitor className="w-4 h-4" />Windows
                            </button>
                        </div>

                        {!selectedFile && (
                            <div className="flex flex-col items-center gap-3 py-12 mt-4 border-2 border-dashed border-slate-700 rounded-xl text-center">
                                <Sparkles className="w-10 h-10 text-slate-600" />
                                <p className="text-sm text-slate-500">No image selected.</p>
                                <p className="text-xs text-slate-600">Select a JPG, PNG, or WebP image to upscale ×2 with AI.</p>
                            </div>
                        )}

                        {selectedFile && (
                            <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700">
                                <FileImage className="w-5 h-5 text-blue-400 shrink-0" />
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

                    {/* Before / After */}
                    {selectedFile && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                                <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-800/30">
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Original</p>
                                </div>
                                <div className="flex items-center justify-center min-h-48 p-3 bg-slate-950/30">
                                    {previewUrl ? (
                                        <img src={previewUrl} alt="Original"
                                            className="max-w-full max-h-64 object-contain rounded"
                                            onError={e => (e.currentTarget.style.display = 'none')} />
                                    ) : (
                                        <p className="text-xs text-slate-600">Preview unavailable</p>
                                    )}
                                </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                                <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-800/30">
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Upscaled ×2</p>
                                </div>
                                <div className="flex items-center justify-center min-h-48 p-3 bg-slate-950/30">
                                    {result ? (
                                        <img src={`data:image/png;base64,${result.previewBase64}`}
                                            alt="Upscaled" className="max-w-full max-h-64 object-contain rounded" />
                                    ) : running ? (
                                        <div className="flex flex-col items-center gap-2 text-slate-500">
                                            <Sparkles className="w-8 h-8 text-blue-400 animate-pulse" />
                                            <p className="text-xs">{progress?.message ?? 'Processing...'}</p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-600">Result will appear here</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Done banner */}
                    {result && (
                        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-300 text-sm">
                            <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold mb-0.5">Image upscaled successfully</p>
                                {result.outputPath && (
                                    <p className="text-xs font-mono text-green-400 truncate">{result.outputPath}</p>
                                )}
                            </div>
                            <button onClick={downloadResult}
                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 rounded-lg transition-colors shrink-0">
                                <Download className="w-3.5 h-3.5" />Download
                            </button>
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

                    {/* Gateway status */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <p className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                            <Cpu className="w-4 h-4" />AI Gateway
                        </p>
                        {gatewayOnline === null ? (
                            <div className="flex items-center gap-2 text-slate-500 text-xs">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />Checking...
                            </div>
                        ) : gatewayOnline ? (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-xs text-green-400">
                                    <span className="w-2 h-2 rounded-full bg-green-400" />Online — port 8000
                                </div>
                                {swin2srModel && (
                                    <div className="flex items-center justify-between text-xs mt-1">
                                        <span className="text-slate-500">Swin2SR</span>
                                        <span className={`flex items-center gap-1 ${swin2srModel.is_loaded ? 'text-green-400' : 'text-slate-500'}`}>
                                            {swin2srModel.is_loaded
                                                ? <><Zap className="w-3 h-3" />Loaded ({swin2srModel.device})</>
                                                : <><ZapOff className="w-3 h-3" />Will load on first run</>}
                                        </span>
                                    </div>
                                )}
                                {!swin2srModel?.is_loaded && (
                                    <p className="text-xs text-slate-600 mt-1">First run downloads ~200 MB and loads into VRAM — may take 1–3 min.</p>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2 text-xs text-red-400">
                                    <span className="w-2 h-2 rounded-full bg-red-400" />Offline
                                </div>
                                <p className="text-xs text-slate-600">Start the Server container on port 8000 first.</p>
                            </div>
                        )}
                    </div>

                    {/* Output mode */}
                    {selectedFile && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Output Mode</p>
                            <div className="space-y-3">
                                {([
                                    { value: 'copy' as OutputMode, label: 'Same folder', desc: 'Save _upscaled.png alongside the original.' },
                                    { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Save to ImageEnhancerResults drive.' },
                                ]).map(opt => (
                                    <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                                        <input type="radio" name="enh-output" value={opt.value}
                                            checked={outputMode === opt.value}
                                            onChange={() => setOutputMode(opt.value)}
                                            className="mt-0.5 accent-blue-500 shrink-0" />
                                        <div>
                                            <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{opt.label}</span>
                                            <p className="text-xs text-slate-500">{opt.desc}</p>
                                            {opt.value === 'virtual_drive' && outputMode === 'virtual_drive' && (
                                                <p className="text-xs font-mono mt-0.5 text-blue-400">
                                                    {outputPath ? `${outputPath}\\ImageEnhancerResults` : 'No output path set in Settings.'}
                                                </p>
                                            )}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Run button */}
                    {selectedFile && (
                        <button onClick={enhance} disabled={!canRun}
                            className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px 14px' }}>
                            {running ? (
                                <>
                                    <Sparkles className="w-4 h-4 animate-pulse" />
                                    {progress?.stage === 'loading_model' ? 'Loading model...' : 'Upscaling...'}
                                </>
                            ) : (
                                <><Sparkles className="w-4 h-4" />Upscale ×2 with AI</>
                            )}
                        </button>
                    )}

                    {/* Metrics */}
                    {result?.metrics && Object.keys(result.metrics).length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Metrics</p>
                            {result.metrics.inference_time_s != null && (
                                <MetricRow label="Inference time" value={fmtMs(result.metrics.inference_time_s)} />
                            )}
                            {result.metrics.input_size && (
                                <MetricRow label="Input size" value={String(result.metrics.input_size)} />
                            )}
                            {result.metrics.output_size && (
                                <MetricRow label="Output size" value={String(result.metrics.output_size)} />
                            )}
                            {result.metrics.sharpness != null && (
                                <MetricRow label="Sharpness" value={Number(result.metrics.sharpness).toFixed(1)} />
                            )}
                            {result.metrics.device && (
                                <MetricRow label="Device" value={String(result.metrics.device)} />
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showAppExplorer && (
                <FolderPickerModal
                    isOpen
                    mode="file"
                    title="Select an image"
                    onClose={() => setShowAppExplorer(false)}
                    onSelect={path => { pickFile(path, path.split(/[\\/]/).pop() || path, 0); setShowAppExplorer(false); }}
                />
            )}
        </div>
    );
};

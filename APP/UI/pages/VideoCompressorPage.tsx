import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, Film, ChevronRight, HardDrive, FolderOpen,
    X, CheckCircle, AlertCircle, FileVideo,
    Check, Minus, Play, Loader2,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const FLASK_BASE = 'http://127.0.0.1:5000';
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm']);
const RESOLUTIONS = ['original', '1080p', '720p', '480p', '360p'];
const CODECS = ['h264', 'h265'];

// ── Types ────────────────────────────────────────────────────────────────────

interface FileItem { path: string; name: string; size: number; codec: string; crf: number; maxResolution: string; stripAudio: boolean; }
type OutputMode = 'replace' | 'copy' | 'virtual_drive';
type FileStatus = 'pending' | 'converting' | 'done' | 'failed';
interface FileResult {
    path: string;
    outputPath?: string;
    success: boolean;
    error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Main page component ──────────────────────────────────────────────────────

export const VideoCompressorPage: React.FC = () => {
    const navigate = useNavigate();
    const [files, setFiles] = useState<FileItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    
    // Global format defaults
    const [globalCodec, setGlobalCodec] = useState('h264');
    const [globalCrf, setGlobalCrf] = useState(28);
    const [globalResolution, setGlobalResolution] = useState('original');
    const [globalStripAudio, setGlobalStripAudio] = useState(false);

    const [outputMode, setOutputMode] = useState<OutputMode>('copy');
    const [outputPath, setOutputPath] = useState('');
    const [converting, setConverting] = useState(false);
    const [results, setResults] = useState<any | null>(null);
    const [convError, setConvError] = useState<string | null>(null);
    const [fileStatuses, setFileStatuses] = useState<Map<string, FileStatus>>(new Map());

    useEffect(() => {
        Promise.all([
            fetch(`${FLASK_BASE}/api/agent/config`).then(r => r.json()).catch(() => ({})),
        ]).then(([cfgData]) => {
            setOutputPath(cfgData.output_path || '');
        });
    }, []);

    const addFiles = useCallback((newFiles: FileItem[]) => {
        setFiles(prev => {
            const existing = new Set(prev.map(p => p.path));
            return [...prev, ...newFiles.filter(f => !existing.has(f.path))];
        });
        setSelected(prev => {
            const next = new Set(prev);
            newFiles.forEach(f => next.add(f.path));
            return next;
        });
    }, []);

    const browseFiles = async () => {
        const paths = await (window as any).electronAPI?.selectFiles?.({
            filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm'] }],
        });
        if (!paths || paths.length === 0) return;
        const newFiles: FileItem[] = paths.map((p: string) => ({
            path: p,
            name: p.split(/[\\/]/).pop() || p,
            size: 0,
            codec: globalCodec,
            crf: globalCrf,
            maxResolution: globalResolution,
            stripAudio: globalStripAudio,
        }));
        addFiles(newFiles);
    };

    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (!dir) return;
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(dir)}`);
            const data = await res.json();
            const videoFiles: FileItem[] = (data.files || [])
                .filter((f: any) => !f.is_dir && isVideoFile(f.name))
                .map((f: any) => ({ path: f.path, name: f.name, size: f.size || 0, codec: globalCodec, crf: globalCrf, maxResolution: globalResolution, stripAudio: globalStripAudio }));
            addFiles(videoFiles);
        } catch {
            setConvError('Failed to list files in that location.');
        }
    };

    const toggleSelect = (path: string) => setSelected(prev => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
    });

    const setFileProp = (path: string, prop: keyof FileItem, value: any) =>
        setFiles(prev => prev.map(f => f.path === path ? { ...f, [prop]: value } : f));

    const removeFile = (path: string) => {
        setFiles(prev => prev.filter(f => f.path !== path));
        setSelected(prev => { const n = new Set(prev); n.delete(path); return n; });
    };

    const applyGlobalSettings = () =>
        setFiles(prev => prev.map(f => ({ ...f, codec: globalCodec, crf: globalCrf, maxResolution: globalResolution, stripAudio: globalStripAudio })));

    const selectedFiles = files.filter(f => selected.has(f.path));
    const allSelected = files.length > 0 && files.every(f => selected.has(f.path));
    const someSelected = files.some(f => selected.has(f.path));

    const toggleAllFiles = () => {
        if (allSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(files.map(f => f.path)));
        }
    };

    const clearAll = () => {
        setFiles([]);
        setSelected(new Set());
        setResults(null);
        setConvError(null);
        setFileStatuses(new Map());
    };

    const convert = async () => {
        if (selectedFiles.length === 0) return;
        setConverting(true);
        setResults(null);
        setConvError(null);

        const statusMap = new Map<string, FileStatus>();
        selectedFiles.forEach(f => statusMap.set(f.path, 'converting'));
        setFileStatuses(new Map(statusMap));

        try {
            const res = await fetch(`${FLASK_BASE}/api/tools/video-compressor/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    files: selectedFiles.map(f => ({ path: f.path, codec: f.codec, crf: f.crf, maxResolution: f.maxResolution, stripAudio: f.stripAudio })),
                    outputMode,
                    outputPath,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            setResults(data);

            const newStatuses = new Map<string, FileStatus>();
            (data.results || []).forEach((r: FileResult) => {
                newStatuses.set(r.path, r.success ? 'done' : 'failed');
            });
            setFileStatuses(newStatuses);
        } catch (e: unknown) {
            setConvError(e instanceof Error ? e.message : 'Compression failed');
            const failMap = new Map<string, FileStatus>();
            selectedFiles.forEach(f => failMap.set(f.path, 'failed'));
            setFileStatuses(failMap);
        } finally {
            setConverting(false);
        }
    };

    const canConvert = selectedFiles.length > 0 && !converting
        && !(outputMode === 'virtual_drive' && !outputPath);

    const getStatusIcon = (path: string) => {
        const st = fileStatuses.get(path);
        if (!st || st === 'pending') return null;
        if (st === 'converting') return <Loader2 className="w-4 h-4 text-rose-400 animate-spin shrink-0" />;
        if (st === 'done') return <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />;
        if (st === 'failed') return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />;
        return null;
    };

    const getResultForFile = (path: string): FileResult | undefined => {
        if (!results?.results) return undefined;
        return results.results.find((r: FileResult) => r.path === path);
    };

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools?category=video" className="hover:text-slate-300 transition-colors">Video</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/video-compressor" className="hover:text-slate-300 transition-colors">Video Compressor</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                        <Film className="w-6 h-6 text-rose-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Video Compressor</h1>
                        <p className="text-sm text-slate-500">Batch compress videos to reduce file size</p>
                    </div>
                </div>
                <button type="button" onClick={() => navigate('/tools/video-compressor')}
                    className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Info
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* ── Left: File picker + file list ── */}
                <div className="lg:col-span-2 space-y-4">

                    {/* Add files bar */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-slate-300">Add Files</p>
                            {files.length > 0 && (
                                <button type="button" onClick={clearAll}
                                    className="text-xs text-slate-500 hover:text-red-400 transition-colors">
                                    Clear all
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <button type="button" onClick={browseFiles}
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-medium transition-colors">
                                <FileVideo className="w-4 h-4" />
                                Browse Files
                            </button>
                            <button type="button" onClick={browseFolder}
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition-colors">
                                <FolderOpen className="w-4 h-4" />
                                Browse Folder
                            </button>
                        </div>
                        {files.length === 0 && (
                            <div className="flex flex-col items-center gap-3 py-12 mt-4 border-2 border-dashed border-slate-700 rounded-xl text-center">
                                <Film className="w-10 h-10 text-slate-600" />
                                <p className="text-sm text-slate-500">No files added yet.</p>
                                <p className="text-xs text-slate-600">Use the buttons above to browse for video files.</p>
                            </div>
                        )}
                    </div>

                    {/* File list */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30">
                                <div className="flex items-center gap-3">
                                    <button type="button" onClick={toggleAllFiles}
                                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${allSelected
                                            ? 'bg-rose-500 border-rose-500 text-white'
                                            : someSelected
                                                ? 'bg-rose-500/30 border-rose-400 text-white'
                                                : 'border-slate-400 hover:border-slate-300'
                                            }`}>
                                        {allSelected ? <Check className="w-3 h-3" /> : someSelected ? <Minus className="w-3 h-3" /> : null}
                                    </button>
                                    <span className="text-sm text-slate-400">
                                        {selectedFiles.length}/{files.length} selected
                                    </span>
                                </div>
                            </div>

                            <div className="max-h-[55vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
                                {files.map(file => {
                                    const result = getResultForFile(file.path);
                                    return (
                                        <div key={file.path} className={`flex flex-col gap-2 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${fileStatuses.get(file.path) === 'failed' ? 'bg-red-500/5' : fileStatuses.get(file.path) === 'done' ? 'bg-green-500/5' : ''}`}>
                                            <div className="flex items-center gap-3">
                                                <button type="button" onClick={() => toggleSelect(file.path)}
                                                    className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${selected.has(file.path) ? 'bg-rose-500 border-rose-500 text-white' : 'border-slate-400 hover:border-slate-300'}`}>
                                                    {selected.has(file.path) && <Check className="w-3 h-3" />}
                                                </button>
                                                {getStatusIcon(file.path)}
                                                <FileVideo className="w-4 h-4 text-slate-500 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-mono truncate" title={file.path}>{file.name}</p>
                                                    {result && !result.success && <p className="text-xs text-red-400 mt-0.5">{result.error}</p>}
                                                    {result?.outputPath && <p className="text-xs text-green-500 mt-0.5 truncate">&rarr; {result.outputPath.split(/[\\/]/).pop()}</p>}
                                                </div>
                                                {file.size > 0 && <span className="text-xs text-slate-500 shrink-0">{fmtSize(file.size)}</span>}
                                                <button type="button" onClick={() => removeFile(file.path)} className="text-slate-600 hover:text-red-400 transition-colors shrink-0 p-1">
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>

                                            {/* File Settings Row */}
                                            <div className="flex items-center gap-4 pl-10 text-xs text-slate-400">
                                                <div className="flex items-center gap-1.5">
                                                    <span>Codec:</span>
                                                    <select value={file.codec} onChange={e => setFileProp(file.path, 'codec', e.target.value)}
                                                        className="px-1.5 py-1 rounded bg-slate-800 border border-slate-700 focus:outline-none">
                                                        {CODECS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                                                    </select>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span>CRF (0-51):</span>
                                                    <input type="number" min="0" max="51" value={file.crf} onChange={e => setFileProp(file.path, 'crf', parseInt(e.target.value) || 0)}
                                                        className="w-14 px-1.5 py-1 rounded bg-slate-800 border border-slate-700 outline-none text-right" />
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span>Max Res:</span>
                                                    <select value={file.maxResolution} onChange={e => setFileProp(file.path, 'maxResolution', e.target.value)}
                                                        className="px-1.5 py-1 rounded bg-slate-800 border border-slate-700 focus:outline-none">
                                                        {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                                                    </select>
                                                </div>
                                                <label className="flex items-center gap-1.5 cursor-pointer">
                                                    <input type="checkbox" checked={file.stripAudio} onChange={e => setFileProp(file.path, 'stripAudio', e.target.checked)} className="accent-rose-500" />
                                                    <span>Strip Audio</span>
                                                </label>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Right: Settings + convert ── */}
                <div className="space-y-4">

                    {/* Global compress settings */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <p className="text-sm font-semibold text-slate-300 mb-4">Compression Settings</p>
                        
                        <div className="space-y-4 text-sm">
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Codec</label>
                                <select value={globalCodec} onChange={e => setGlobalCodec(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:border-slate-500">
                                    {CODECS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                                </select>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs text-slate-500">CRF Value (Quality)</label>
                                    <span className="text-xs font-mono">{globalCrf}</span>
                                </div>
                                <input type="range" min="15" max="40" value={globalCrf} onChange={e => setGlobalCrf(parseInt(e.target.value))}
                                    className="w-full accent-rose-500" />
                                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                                    <span>High Qual (15)</span>
                                    <span>Small Size (40)</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Max Resolution</label>
                                <select value={globalResolution} onChange={e => setGlobalResolution(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:border-slate-500">
                                    {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={globalStripAudio} onChange={e => setGlobalStripAudio(e.target.checked)} className="accent-rose-500" />
                                <span className="text-sm text-slate-300">Strip Audio Track</span>
                            </label>
                            
                            <button type="button" onClick={applyGlobalSettings} disabled={files.length === 0}
                                className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 text-sm transition-colors disabled:opacity-50">
                                Apply to all files
                            </button>
                        </div>
                    </div>

                    {/* Output mode */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Output Mode</p>
                            <div className="space-y-3">
                                {([
                                    { value: 'replace' as OutputMode, label: 'Replace originals', desc: 'Overwrite the original files.' },
                                    { value: 'copy' as OutputMode, label: 'Copy in same folder', desc: 'Save alongside originals.' },
                                    { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Save to VideoCompressionResults drive.' },
                                ]).map(opt => (
                                    <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                                        <input type="radio" name="video_compressor-output" value={opt.value}
                                            checked={outputMode === opt.value}
                                            onChange={() => setOutputMode(opt.value)}
                                            className="mt-0.5 accent-rose-500 shrink-0" />
                                        <div>
                                            <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{opt.label}</span>
                                            <p className="text-xs text-slate-500">{opt.desc}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Convert button */}
                    {files.length > 0 && (
                        <button type="button" onClick={convert} disabled={!canConvert}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-rose-900/20">
                            {converting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Compressing {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    Compress {selectedFiles.length} video{selectedFiles.length !== 1 ? 's' : ''}
                                </>
                            )}
                        </button>
                    )}

                    {/* Error */}
                    {convError && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {convError}
                        </div>
                    )}

                    {/* Summary results */}
                    {results && (
                        <div className={`px-5 py-4 rounded-xl text-sm ${results.succeeded > 0 ? 'bg-green-500/10 border border-green-500/20 text-green-300' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle className="w-5 h-5 shrink-0" />
                                <span className="font-semibold">
                                    {results.succeeded}/{results.total} compressed successfully
                                </span>
                            </div>
                            {results.failed > 0 && (
                                <p className="text-xs text-red-400">{results.failed} file{results.failed !== 1 ? 's' : ''} failed.</p>
                            )}
                            {results.virtualDrivePath && (
                                <div className="mt-2 text-left">
                                    <p className="text-xs text-green-400 mb-2">Saved to: {results.virtualDrivePath}</p>
                                    <button type="button" onClick={() => navigate(`/files?path=${encodeURIComponent(results.virtualDrivePath)}`)}
                                        className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 text-green-300 rounded-lg hover:bg-green-500/30 transition-colors">
                                        <HardDrive className="w-3.5 h-3.5" />
                                        Open Virtual Drive
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

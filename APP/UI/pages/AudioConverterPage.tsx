import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, Music, ChevronRight, FolderOpen, Files, FolderSearch,
    X, CheckCircle, AlertCircle, FileAudio,
    Check, Minus, Play, Loader2, HardDrive,
} from 'lucide-react';
import { FolderPickerModal } from '../components/FolderPickerModal';

// ── Constants ────────────────────────────────────────────────────────────────

const FLASK_BASE = 'http://127.0.0.1:5000';
const OUTPUT_FORMATS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'];

// ── Types ────────────────────────────────────────────────────────────────────

interface FileItem { path: string; name: string; size: number; outputFormat: string }
type OutputMode = 'replace' | 'copy' | 'virtual_drive';
type FileStatus = 'pending' | 'converting' | 'done' | 'failed';
interface FileResult {
    path: string;
    outputPath?: string;
    success: boolean;
    error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

// ── Main page component ──────────────────────────────────────────────────────

export const AudioConverterPage: React.FC = () => {
    const navigate = useNavigate();
    const [files, setFiles] = useState<FileItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [globalFormat, setGlobalFormat] = useState('mp3');
    const [outputMode, setOutputMode] = useState<OutputMode>('copy');
    const [outputPath, setOutputPath] = useState('');
    const [converting, setConverting] = useState(false);
    const [results, setResults] = useState<any | null>(null);
    const [convError, setConvError] = useState<string | null>(null);
    const [showAppExplorer, setShowAppExplorer] = useState(false);
    const [fileStatuses, setFileStatuses] = useState<Map<string, FileStatus>>(new Map());

    useEffect(() => {
        fetch(`${FLASK_BASE}/api/agent/config`).then(r => r.json()).then(d => setOutputPath(d.output_path || '')).catch(() => {});
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
            filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'mka'] }],
        });
        if (!paths || paths.length === 0) return;
        addFiles(paths.map((p: string) => ({ path: p, name: p.split(/[\\/]/).pop() || p, size: 0, outputFormat: globalFormat })));
    };

    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (!dir) return;
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(dir)}`);
            const data = await res.json();
            const exts = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'mka']);
            const entries: { name: string; path: string; size: number; is_dir: boolean }[] = data.entries ?? [];
            const newFiles = entries
                .filter(e => !e.is_dir && exts.has((e.name.split('.').pop() ?? '').toLowerCase()))
                .map(e => ({ path: e.path, name: e.name, size: e.size, outputFormat: globalFormat }));
            if (newFiles.length > 0) addFiles(newFiles);
        } catch { /* ignore */ }
    };

    const handleAppExplorerSelect = (paths: string[]) => {
        addFiles(paths.map(p => ({ path: p, name: p.split(/[\\/]/).pop() || p, size: 0, outputFormat: globalFormat })));
    };

    const toggleSelect = (path: string) => setSelected(prev => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
    });

    const setFileFormat = (path: string, fmt: string) =>
        setFiles(prev => prev.map(f => f.path === path ? { ...f, outputFormat: fmt } : f));

    const removeFile = (path: string) => {
        setFiles(prev => prev.filter(f => f.path !== path));
        setSelected(prev => { const n = new Set(prev); n.delete(path); return n; });
    };

    const applyGlobalFormat = () =>
        setFiles(prev => prev.map(f => ({ ...f, outputFormat: globalFormat })));

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

        // Mark all selected as converting
        const statusMap = new Map<string, FileStatus>();
        selectedFiles.forEach(f => statusMap.set(f.path, 'converting'));
        setFileStatuses(new Map(statusMap));

        try {
            const res = await fetch(`${FLASK_BASE}/api/tools/audio-converter/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    files: selectedFiles.map(f => ({ path: f.path, outputFormat: f.outputFormat })),
                    outputMode,
                    outputPath,
                    preserveMetadata: true,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            setResults(data);

            // Update per-file statuses from results
            const newStatuses = new Map<string, FileStatus>();
            (data.results || []).forEach((r: FileResult) => {
                newStatuses.set(r.path, r.success ? 'done' : 'failed');
            });
            setFileStatuses(newStatuses);
        } catch (e: unknown) {
            setConvError(e instanceof Error ? e.message : 'Conversion failed');
            // Mark all as failed
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
        if (st === 'converting') return <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />;
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
                <Link to="/tools?category=audio" className="hover:text-slate-300 transition-colors">Audio</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/audio-converter" className="hover:text-slate-300 transition-colors">Audio Converter</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <Music className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Audio Converter</h1>
                        <p className="text-sm text-slate-500">Batch convert audio files between formats</p>
                    </div>
                </div>
                <button type="button" onClick={() => navigate('/tools/audio-converter')}
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
                            <button type="button" onClick={() => setShowAppExplorer(true)} className="btn btn-primary">
                                <FolderOpen className="w-4 h-4" />
                                App Explorer
                            </button>
                            <button type="button" onClick={browseFiles} className="btn btn-secondary">
                                <Files className="w-4 h-4" />
                                Select Files
                            </button>
                            <button type="button" onClick={browseFolder} className="btn btn-secondary">
                                <FolderSearch className="w-4 h-4" />
                                Select Folder
                            </button>
                        </div>

                        {/* Empty state */}
                        {files.length === 0 && (
                            <div className="flex flex-col items-center gap-3 py-12 mt-4 border-2 border-dashed border-slate-700 rounded-xl text-center">
                                <Music className="w-10 h-10 text-slate-600" />
                                <p className="text-sm text-slate-500">No files added yet.</p>
                                <p className="text-xs text-slate-600">Use App Explorer to browse drives and folders, or Windows to open a native dialog.</p>
                            </div>
                        )}
                    </div>

                    {/* File list */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                            {/* File list header */}
                            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30">
                                <div className="flex items-center gap-3">
                                    <button type="button" onClick={toggleAllFiles}
                                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${allSelected
                                            ? 'bg-blue-500 border-blue-500 text-white'
                                            : someSelected
                                                ? 'bg-blue-500/30 border-blue-400 text-white'
                                                : 'border-slate-400 hover:border-slate-300'
                                            }`}>
                                        {allSelected ? <Check className="w-3 h-3" /> : someSelected ? <Minus className="w-3 h-3" /> : null}
                                    </button>
                                    <span className="text-sm text-slate-400">
                                        {selectedFiles.length}/{files.length} selected
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <select value={globalFormat} onChange={e => setGlobalFormat(e.target.value)}
                                        className="text-xs px-2 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/40">
                                        {OUTPUT_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                                    </select>
                                    <button type="button" onClick={applyGlobalFormat}
                                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
                                        Apply to all
                                    </button>
                                </div>
                            </div>

                            {/* File rows */}
                            <div className="max-h-[45vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
                                {files.map(file => {
                                    const result = getResultForFile(file.path);
                                    return (
                                        <div key={file.path}
                                            className={`flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${fileStatuses.get(file.path) === 'failed' ? 'bg-red-500/5' : fileStatuses.get(file.path) === 'done' ? 'bg-green-500/5' : ''
                                                }`}>
                                            <button type="button" onClick={() => toggleSelect(file.path)}
                                                className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${selected.has(file.path)
                                                    ? 'bg-blue-500 border-blue-500 text-white'
                                                    : 'border-slate-400 hover:border-slate-300'
                                                    }`}>
                                                {selected.has(file.path) && <Check className="w-3 h-3" />}
                                            </button>

                                            {getStatusIcon(file.path)}

                                            <FileAudio className="w-4 h-4 text-slate-500 shrink-0" />

                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-mono truncate" title={file.path}>{file.name}</p>
                                                {result && !result.success && (
                                                    <p className="text-xs text-red-400 mt-0.5">{result.error}</p>
                                                )}
                                                {result?.outputPath && (
                                                    <p className="text-xs text-green-500 mt-0.5 truncate">
                                                        &rarr; {result.outputPath.split(/[\\/]/).pop()}
                                                    </p>
                                                )}
                                            </div>

                                            {file.size > 0 && (
                                                <span className="text-xs text-slate-500 shrink-0">{fmtSize(file.size)}</span>
                                            )}

                                            <select value={file.outputFormat} onChange={e => setFileFormat(file.path, e.target.value)}
                                                className="text-xs px-2 py-1 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 focus:outline-none shrink-0">
                                                {OUTPUT_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                                            </select>

                                            <button type="button" onClick={() => removeFile(file.path)}
                                                className="text-slate-600 hover:text-red-400 transition-colors shrink-0 p-1">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Right: Settings + convert ── */}
                <div className="space-y-4">

                    {/* Output mode */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Output Mode</p>
                            <div className="space-y-3">
                                {([
                                    { value: 'replace' as OutputMode, label: 'Replace originals', desc: 'Overwrite the original files.' },
                                    { value: 'copy' as OutputMode, label: 'Copy in same folder', desc: 'Save alongside originals.' },
                                    { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Save to AudioConversionResults drive.' },
                                ]).map(opt => (
                                    <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                                        <input type="radio" name="imgconv-output" value={opt.value}
                                            checked={outputMode === opt.value}
                                            onChange={() => setOutputMode(opt.value)}
                                            className="mt-0.5 accent-blue-500 shrink-0" />
                                        <div>
                                            <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{opt.label}</span>
                                            <p className="text-xs text-slate-500">{opt.desc}</p>
                                            {opt.value === 'virtual_drive' && outputMode === 'virtual_drive' && (
                                                <p className="text-xs font-mono mt-0.5 text-blue-400 break-all">
                                                    {outputPath ? `${String(outputPath)}\\AudioConversionResults` : 'No output path set in Settings.'}
                                                </p>
                                            )}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Convert button */}
                    {files.length > 0 && (
                        <button type="button" onClick={convert} disabled={!canConvert}
                            className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px 14px' }}>
                            {converting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Converting {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    Convert {selectedFiles.length} audio file{selectedFiles.length !== 1 ? 's' : ''}
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
                        <div className={`px-5 py-4 rounded-xl text-sm ${results.succeeded > 0 ? 'bg-emerald-50 dark:bg-emerald-900/25 border border-emerald-200 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400'}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle className="w-5 h-5 shrink-0" />
                                <span className="font-semibold">
                                    {results.succeeded}/{results.total} converted successfully
                                </span>
                            </div>
                            {results.failed > 0 && (
                                <p className="text-xs text-red-400">{results.failed} file{results.failed !== 1 ? 's' : ''} failed.</p>
                            )}
                            {results.virtualDrivePath && (
                                <div className="mt-2 text-left">
                                    <p
                                        className="text-xs font-mono mb-2 break-all cursor-pointer hover:underline"
                                        onClick={() => (window as any).electronAPI?.showItemInFolder?.(results.virtualDrivePath)}
                                        title="Click to show in Explorer"
                                    >Saved to: {results.virtualDrivePath}</p>
                                    <button type="button" onClick={() => navigate(`/files?path=${encodeURIComponent(results.virtualDrivePath)}`)}
                                        className="text-xs flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 rounded-lg transition-colors">
                                        <HardDrive className="w-3.5 h-3.5" />
                                        Open Virtual Drive
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showAppExplorer && (
                <FolderPickerModal
                    isOpen
                    mode="file"
                    multiSelect
                    title="Select audio files"
                    onClose={() => setShowAppExplorer(false)}
                    onSelect={path => { handleAppExplorerSelect([path]); setShowAppExplorer(false); }}
                    onSelectMultiple={paths => { handleAppExplorerSelect(paths); setShowAppExplorer(false); }}
                />
            )}
        </div>
    );
};

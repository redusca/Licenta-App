import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, Image, ChevronRight, HardDrive, FolderOpen,
    RefreshCw, X, CheckCircle, AlertCircle, FileImage,
    Folder, ChevronLeft, Check, Minus, Play, Loader2,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const FLASK_BASE = 'http://127.0.0.1:5000';
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif', '.gif']);
const OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif'];

// ── Types ────────────────────────────────────────────────────────────────────

interface DriveEntry { name: string; path: string; config?: { name: string } }
interface FileItem { path: string; name: string; size: number; outputFormat: string }
interface DirItem { name: string; path: string; is_dir: boolean; size: number }
type OutputMode = 'replace' | 'copy' | 'virtual_drive';
type FileStatus = 'pending' | 'converting' | 'done' | 'failed';
interface FileResult {
    path: string;
    outputPath?: string;
    success: boolean;
    error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isImageFile(name: string): boolean {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}

function fmtSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

// ── Drive folder browser modal ───────────────────────────────────────────────

function FolderBrowser({
    drives,
    onPickFiles,
    onClose,
    globalFormat,
}: {
    drives: DriveEntry[];
    onPickFiles: (files: FileItem[]) => void;
    onClose: () => void;
    globalFormat: string;
}) {
    const [currentDrive, setCurrentDrive] = useState<DriveEntry | null>(null);
    const [currentPath, setCurrentPath] = useState('');
    const [entries, setEntries] = useState<DirItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const loadPath = async (path: string) => {
        setLoading(true);
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            const items: DirItem[] = (data.files || [])
                .filter((f: any) => f.is_dir || isImageFile(f.name))
                .map((f: any) => ({ name: f.name, path: f.path, is_dir: f.is_dir, size: f.size || 0 }));
            setEntries(items);
            setCurrentPath(path);
            setSelected(new Set());
        } catch {
            setEntries([]);
        } finally {
            setLoading(false);
        }
    };

    const selectDrive = (d: DriveEntry) => {
        setCurrentDrive(d);
        loadPath(d.path);
    };

    const navigateUp = () => {
        if (!currentPath || !currentDrive) return;
        const parent = currentPath.replace(/[\\/][^\\/]+$/, '');
        const driveRoot = currentDrive.path.replace(/[\\/]+$/, '');
        const normalizedParent = parent.replace(/[\\/]+$/, '');
        // Only navigate up if we're still within the drive's root path
        if (normalizedParent && normalizedParent !== currentPath.replace(/[\\/]+$/, '') && normalizedParent.length >= driveRoot.length) {
            loadPath(parent);
        }
        // else: at drive root, don't allow exiting the drive
    };

    const openFolder = (path: string) => loadPath(path);

    const toggleFile = (path: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(path) ? next.delete(path) : next.add(path);
            return next;
        });
    };

    const imageEntries = entries.filter(e => !e.is_dir);
    const allImagesSelected = imageEntries.length > 0 && imageEntries.every(e => selected.has(e.path));
    const someImagesSelected = imageEntries.some(e => selected.has(e.path));

    const toggleAll = () => {
        if (allImagesSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(imageEntries.map(e => e.path)));
        }
    };

    const confirmSelection = () => {
        const picked: FileItem[] = entries
            .filter(e => !e.is_dir && selected.has(e.path))
            .map(e => ({ path: e.path, name: e.name, size: e.size, outputFormat: globalFormat }));
        onPickFiles(picked);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        {currentDrive && currentPath.replace(/[\\/]+$/, '') !== currentDrive.path.replace(/[\\/]+$/, '') && (
                            <button onClick={navigateUp}
                                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                        )}
                        <h3 className="text-base font-semibold">
                            {currentDrive
                                ? (currentDrive.config?.name ?? currentDrive.name)
                                : 'Select a Drive'}
                        </h3>
                        {currentPath && (
                            <span className="text-xs text-slate-500 font-mono truncate max-w-xs" title={currentPath}>
                                {currentPath}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 min-h-0">
                    {!currentDrive ? (
                        /* Drive list */
                        <div className="space-y-1">
                            {drives.length === 0 ? (
                                <p className="text-sm text-slate-500 text-center py-8">No virtual drives found.</p>
                            ) : drives.map((d, i) => (
                                <button key={i} onClick={() => selectDrive(d)}
                                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <HardDrive className="w-5 h-5 text-blue-400 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{d.config?.name ?? d.name ?? d.path}</p>
                                        <p className="text-xs text-slate-500 truncate">{d.path}</p>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                </button>
                            ))}
                        </div>
                    ) : loading ? (
                        <div className="flex items-center justify-center py-12 text-slate-500">
                            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                            Loading...
                        </div>
                    ) : entries.length === 0 ? (
                        <p className="text-sm text-slate-500 text-center py-12">No images or folders here.</p>
                    ) : (
                        /* File/folder list */
                        <div className="space-y-0.5">
                            {/* Select all toggle */}
                            {imageEntries.length > 0 && (
                                <div className="flex items-center gap-3 px-4 py-2 mb-1 border-b border-slate-200 dark:border-slate-800">
                                    <button onClick={toggleAll}
                                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${allImagesSelected
                                            ? 'bg-blue-500 border-blue-500 text-white'
                                            : someImagesSelected
                                                ? 'bg-blue-500/30 border-blue-400 text-white'
                                                : 'border-slate-400 hover:border-slate-300'
                                            }`}>
                                        {allImagesSelected ? <Check className="w-3 h-3" /> : someImagesSelected ? <Minus className="w-3 h-3" /> : null}
                                    </button>
                                    <span className="text-xs text-slate-500">{imageEntries.length} image{imageEntries.length !== 1 ? 's' : ''} — {selected.size} selected</span>
                                </div>
                            )}
                            {entries.map(entry => entry.is_dir ? (
                                <button key={entry.path} onClick={() => openFolder(entry.path)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                                    <span className="text-sm truncate flex-1">{entry.name}</span>
                                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                </button>
                            ) : (
                                <label key={entry.path}
                                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                                    <button
                                        onClick={() => toggleFile(entry.path)}
                                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${selected.has(entry.path)
                                            ? 'bg-blue-500 border-blue-500 text-white'
                                            : 'border-slate-400 hover:border-slate-300'
                                            }`}>
                                        {selected.has(entry.path) && <Check className="w-3 h-3" />}
                                    </button>
                                    <FileImage className="w-4 h-4 text-blue-400 shrink-0" />
                                    <span className="text-sm truncate flex-1 min-w-0">{entry.name}</span>
                                    <span className="text-xs text-slate-500 shrink-0">{fmtSize(entry.size)}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {currentDrive && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-800">
                        <span className="text-xs text-slate-500">
                            {selected.size} file{selected.size !== 1 ? 's' : ''} selected
                        </span>
                        <div className="flex gap-2">
                            <button onClick={onClose}
                                className="text-sm px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-slate-300 transition-colors">
                                Cancel
                            </button>
                            <button onClick={confirmSelection} disabled={selected.size === 0}
                                className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium transition-colors">
                                Add {selected.size} file{selected.size !== 1 ? 's' : ''}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Main page component ──────────────────────────────────────────────────────

export const ImageConverterPage: React.FC = () => {
    const navigate = useNavigate();
    const [drives, setDrives] = useState<DriveEntry[]>([]);
    const [files, setFiles] = useState<FileItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [globalFormat, setGlobalFormat] = useState('webp');
    const [quality, setQuality] = useState(85);
    const [outputMode, setOutputMode] = useState<OutputMode>('copy');
    const [outputPath, setOutputPath] = useState('');
    const [loadingDrives, setLoadingDrives] = useState(true);
    const [converting, setConverting] = useState(false);
    const [results, setResults] = useState<any | null>(null);
    const [convError, setConvError] = useState<string | null>(null);
    const [showBrowser, setShowBrowser] = useState(false);
    const [fileStatuses, setFileStatuses] = useState<Map<string, FileStatus>>(new Map());

    // Load drives + output path
    useEffect(() => {
        setLoadingDrives(true);
        Promise.all([
            fetch(`${FLASK_BASE}/api/drive/registry`).then(r => r.json()).catch(() => ({ drives: [] })),
            fetch(`${FLASK_BASE}/api/agent/config`).then(r => r.json()).catch(() => ({})),
        ]).then(([regData, cfgData]) => {
            setDrives(Array.isArray(regData.drives) ? regData.drives : []);
            setOutputPath(cfgData.output_path || '');
        }).finally(() => setLoadingDrives(false));
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

    // Browse local files with native file picker
    const browseFiles = async () => {
        const paths = await (window as any).electronAPI?.selectFiles?.({
            filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif'] }],
        });
        if (!paths || paths.length === 0) return;
        const newFiles: FileItem[] = paths.map((p: string) => ({
            path: p,
            name: p.split(/[\\/]/).pop() || p,
            size: 0,
            outputFormat: globalFormat,
        }));
        addFiles(newFiles);
    };

    // Browse a folder and add all images in it
    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (!dir) return;
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(dir)}`);
            const data = await res.json();
            const imageFiles: FileItem[] = (data.files || [])
                .filter((f: any) => !f.is_dir && isImageFile(f.name))
                .map((f: any) => ({ path: f.path, name: f.name, size: f.size || 0, outputFormat: globalFormat }));
            addFiles(imageFiles);
        } catch {
            setConvError('Failed to list files in that location.');
        }
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
            const res = await fetch(`${FLASK_BASE}/api/tools/image-converter/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    files: selectedFiles.map(f => ({ path: f.path, outputFormat: f.outputFormat })),
                    outputMode,
                    outputPath,
                    quality,
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
                <Link to="/tools?category=image" className="hover:text-slate-300 transition-colors">Image</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/image-converter" className="hover:text-slate-300 transition-colors">Image Converter</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <Image className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Image Converter</h1>
                        <p className="text-sm text-slate-500">Batch convert images between formats</p>
                    </div>
                </div>
                <button onClick={() => navigate('/tools/image-converter')}
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
                                <button onClick={clearAll}
                                    className="text-xs text-slate-500 hover:text-red-400 transition-colors">
                                    Clear all
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <button onClick={browseFiles}
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">
                                <FileImage className="w-4 h-4" />
                                Browse Files
                            </button>
                            <button onClick={browseFolder}
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition-colors">
                                <FolderOpen className="w-4 h-4" />
                                Browse Folder
                            </button>
                            <button onClick={() => setShowBrowser(true)} disabled={loadingDrives}
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40">
                                <HardDrive className="w-4 h-4" />
                                From Virtual Drive
                            </button>
                        </div>

                        {/* Empty state */}
                        {files.length === 0 && (
                            <div className="flex flex-col items-center gap-3 py-12 mt-4 border-2 border-dashed border-slate-700 rounded-xl text-center">
                                <Image className="w-10 h-10 text-slate-600" />
                                <p className="text-sm text-slate-500">No files added yet.</p>
                                <p className="text-xs text-slate-600">Use the buttons above to browse for image files or pick from a virtual drive.</p>
                            </div>
                        )}
                    </div>

                    {/* File list */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                            {/* File list header */}
                            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30">
                                <div className="flex items-center gap-3">
                                    <button onClick={toggleAllFiles}
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
                                    <button onClick={applyGlobalFormat}
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
                                            <button onClick={() => toggleSelect(file.path)}
                                                className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${selected.has(file.path)
                                                    ? 'bg-blue-500 border-blue-500 text-white'
                                                    : 'border-slate-400 hover:border-slate-300'
                                                    }`}>
                                                {selected.has(file.path) && <Check className="w-3 h-3" />}
                                            </button>

                                            {getStatusIcon(file.path)}

                                            <FileImage className="w-4 h-4 text-slate-500 shrink-0" />

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

                                            <button onClick={() => removeFile(file.path)}
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

                    {/* Quality */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-sm font-semibold text-slate-300">Quality (JPEG / WebP)</p>
                                <span className="text-sm font-mono text-blue-400 font-bold">{quality}</span>
                            </div>
                            <input type="range" min={1} max={100} value={quality}
                                onChange={e => setQuality(Number(e.target.value))}
                                className="w-full accent-blue-500" />
                            <div className="flex justify-between text-xs text-slate-600 mt-1">
                                <span>1 — smaller file</span>
                                <span>100 — best quality</span>
                            </div>
                        </div>
                    )}

                    {/* Output mode */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Output Mode</p>
                            <div className="space-y-3">
                                {([
                                    { value: 'replace' as OutputMode, label: 'Replace originals', desc: 'Overwrite the original files.' },
                                    { value: 'copy' as OutputMode, label: 'Copy in same folder', desc: 'Save alongside originals.' },
                                    { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Save to ImageConversionResults drive.' },
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
                                                <p className="text-xs font-mono mt-0.5 text-blue-400">
                                                    {outputPath ? `${outputPath}\\ImageConversionResults` : 'No output path set in Settings.'}
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
                        <button onClick={convert} disabled={!canConvert}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-blue-900/20">
                            {converting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Converting {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    Convert {selectedFiles.length} image{selectedFiles.length !== 1 ? 's' : ''}
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
                                    {results.succeeded}/{results.total} converted successfully
                                </span>
                            </div>
                            {results.failed > 0 && (
                                <p className="text-xs text-red-400">{results.failed} file{results.failed !== 1 ? 's' : ''} failed.</p>
                            )}
                            {results.virtualDrivePath && (
                                <p className="text-xs text-green-400 mt-1">Saved to: {results.virtualDrivePath}</p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Drive browser modal */}
            {showBrowser && (
                <FolderBrowser
                    drives={drives}
                    onPickFiles={addFiles}
                    onClose={() => setShowBrowser(false)}
                    globalFormat={globalFormat}
                />
            )}
        </div>
    );
};

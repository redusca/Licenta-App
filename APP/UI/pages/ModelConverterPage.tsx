import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, Box, ChevronRight, HardDrive, FolderOpen,
    RefreshCw, X, CheckCircle, AlertCircle, FileBox,
    Folder, ChevronLeft, Check, Minus, Play, Loader2,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const FLASK_BASE = 'http://127.0.0.1:5000';
const MODEL_EXTENSIONS = new Set(['.obj', '.fbx', '.glb', '.gltf', '.stl', '.ply', '.dae']);
const OUTPUT_FORMATS = ['obj', 'fbx', 'glb', 'gltf', 'stl', 'ply', 'dae'];

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

function isModelFile(name: string): boolean {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return MODEL_EXTENSIONS.has(ext);
}

function fmtSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

// Returns a short label for format display
function fmtLabel(fmt: string): string {
    return fmt.toUpperCase();
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
                .filter((f: any) => f.is_dir || isModelFile(f.name))
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
        if (normalizedParent && normalizedParent !== currentPath.replace(/[\\/]+$/, '') && normalizedParent.length >= driveRoot.length) {
            loadPath(parent);
        }
    };

    const openFolder = (path: string) => loadPath(path);

    const toggleFile = (path: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(path) ? next.delete(path) : next.add(path);
            return next;
        });
    };

    const modelEntries = entries.filter(e => !e.is_dir);
    const allModelsSelected = modelEntries.length > 0 && modelEntries.every(e => selected.has(e.path));
    const someModelsSelected = modelEntries.some(e => selected.has(e.path));

    const toggleAll = () => {
        if (allModelsSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(modelEntries.map(e => e.path)));
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
                            <button type="button" onClick={navigateUp}
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
                    <button type="button" onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 min-h-0">
                    {!currentDrive ? (
                        <div className="space-y-1">
                            {drives.length === 0 ? (
                                <p className="text-sm text-slate-500 text-center py-8">No virtual drives found.</p>
                            ) : drives.map((d, i) => (
                                <button key={i} onClick={() => selectDrive(d)}
                                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    <HardDrive className="w-5 h-5 text-cyan-400 shrink-0" />
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
                        <p className="text-sm text-slate-500 text-center py-12">No 3D models or folders here.</p>
                    ) : (
                        <div className="space-y-0.5">
                            {modelEntries.length > 0 && (
                                <div className="flex items-center gap-3 px-4 py-2 mb-1 border-b border-slate-200 dark:border-slate-800">
                                    <button type="button" onClick={toggleAll}
                                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${allModelsSelected
                                            ? 'bg-cyan-500 border-cyan-500 text-white'
                                            : someModelsSelected
                                                ? 'bg-cyan-500/30 border-cyan-400 text-white'
                                                : 'border-slate-400 hover:border-slate-300'
                                            }`}>
                                        {allModelsSelected ? <Check className="w-3 h-3" /> : someModelsSelected ? <Minus className="w-3 h-3" /> : null}
                                    </button>
                                    <span className="text-xs text-slate-500">{modelEntries.length} model{modelEntries.length !== 1 ? 's' : ''} — {selected.size} selected</span>
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
                                            ? 'bg-cyan-500 border-cyan-500 text-white'
                                            : 'border-slate-400 hover:border-slate-300'
                                            }`}>
                                        {selected.has(entry.path) && <Check className="w-3 h-3" />}
                                    </button>
                                    <Box className="w-4 h-4 text-cyan-400 shrink-0" />
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
                            <button type="button" onClick={onClose}
                                className="text-sm px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-slate-300 transition-colors">
                                Cancel
                            </button>
                            <button type="button" onClick={confirmSelection} disabled={selected.size === 0}
                                className="text-sm px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-medium transition-colors">
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

export const ModelConverterPage: React.FC = () => {
    const navigate = useNavigate();
    const [drives, setDrives] = useState<DriveEntry[]>([]);
    const [files, setFiles] = useState<FileItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [globalFormat, setGlobalFormat] = useState('glb');
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
            filters: [{ name: '3D Models', extensions: ['obj', 'fbx', 'glb', 'gltf', 'stl', 'ply', 'dae'] }],
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

    // Browse a folder and add all models in it
    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (!dir) return;
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(dir)}`);
            const data = await res.json();
            const modelFiles: FileItem[] = (data.files || [])
                .filter((f: any) => !f.is_dir && isModelFile(f.name))
                .map((f: any) => ({ path: f.path, name: f.name, size: f.size || 0, outputFormat: globalFormat }));
            addFiles(modelFiles);
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

        const statusMap = new Map<string, FileStatus>();
        selectedFiles.forEach(f => statusMap.set(f.path, 'converting'));
        setFileStatuses(new Map(statusMap));

        try {
            const res = await fetch(`${FLASK_BASE}/api/tools/model-converter/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    files: selectedFiles.map(f => ({ path: f.path, outputFormat: f.outputFormat })),
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
            setConvError(e instanceof Error ? e.message : 'Conversion failed');
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
        if (st === 'converting') return <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />;
        if (st === 'done') return <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />;
        if (st === 'failed') return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />;
        return null;
    };

    const getResultForFile = (path: string): FileResult | undefined => {
        if (!results?.results) return undefined;
        return results.results.find((r: FileResult) => r.path === path);
    };

    // Open the output folder containing the converted file
    const openOutputFile = (outputPath: string) => {
        (window as any).electronAPI?.showItemInFolder?.(outputPath);
    };

    return (
        <div className="space-y-6 max-w-6xl mx-auto">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools?category=3d" className="hover:text-slate-300 transition-colors">3D &amp; Modeling</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/model-converter" className="hover:text-slate-300 transition-colors">3D Model Converter</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                        <Box className="w-6 h-6 text-cyan-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">3D Model Converter</h1>
                        <p className="text-sm text-slate-500">Convert between OBJ, FBX, GLB, GLTF, STL, PLY, DAE</p>
                    </div>
                </div>
                <button type="button" onClick={() => navigate('/tools/model-converter')}
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
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors">
                                <FileBox className="w-4 h-4" />
                                Browse Files
                            </button>
                            <button type="button" onClick={browseFolder}
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition-colors">
                                <FolderOpen className="w-4 h-4" />
                                Browse Folder
                            </button>
                            <button type="button" onClick={() => setShowBrowser(true)} disabled={loadingDrives}
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40">
                                <HardDrive className="w-4 h-4" />
                                From Virtual Drive
                            </button>
                        </div>

                        {/* Empty state */}
                        {files.length === 0 && (
                            <div className="flex flex-col items-center gap-3 py-12 mt-4 border-2 border-dashed border-slate-700 rounded-xl text-center">
                                <Box className="w-10 h-10 text-slate-600" />
                                <p className="text-sm text-slate-500">No files added yet.</p>
                                <p className="text-xs text-slate-600">Use the buttons above to browse for 3D model files or pick from a virtual drive.</p>
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
                                            ? 'bg-cyan-500 border-cyan-500 text-white'
                                            : someSelected
                                                ? 'bg-cyan-500/30 border-cyan-400 text-white'
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
                                        className="text-xs px-2 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/40">
                                        {OUTPUT_FORMATS.map(f => <option key={f} value={f}>{fmtLabel(f)}</option>)}
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
                                                    ? 'bg-cyan-500 border-cyan-500 text-white'
                                                    : 'border-slate-400 hover:border-slate-300'
                                                    }`}>
                                                {selected.has(file.path) && <Check className="w-3 h-3" />}
                                            </button>

                                            {getStatusIcon(file.path)}

                                            <Box className="w-4 h-4 text-slate-500 shrink-0" />

                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-mono truncate" title={file.path}>{file.name}</p>
                                                {result && !result.success && (
                                                    <p className="text-xs text-red-400 mt-0.5">{result.error}</p>
                                                )}
                                                {result?.outputPath && (
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <p className="text-xs text-green-500 truncate">
                                                            &rarr; {result.outputPath.split(/[\\/]/).pop()}
                                                        </p>
                                                        <button
                                                            type="button"
                                                            onClick={() => openOutputFile(result.outputPath!)}
                                                            className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors underline shrink-0"
                                                        >
                                                            Open
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {file.size > 0 && (
                                                <span className="text-xs text-slate-500 shrink-0">{fmtSize(file.size)}</span>
                                            )}

                                            <select value={file.outputFormat} onChange={e => setFileFormat(file.path, e.target.value)}
                                                className="text-xs px-2 py-1 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 focus:outline-none shrink-0">
                                                {OUTPUT_FORMATS.map(f => <option key={f} value={f}>{fmtLabel(f)}</option>)}
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

                    {/* Info card */}
                    {files.length === 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Supported Formats</p>
                            <div className="space-y-2">
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Native (trimesh):</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['OBJ', 'GLB', 'GLTF', 'STL', 'PLY'].map(f => (
                                            <span key={f} className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                                {f}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 mb-1">Via Blender:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['FBX', 'DAE'].map(f => (
                                            <span key={f} className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                {f}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
                                FBX and DAE export requires Blender to be installed. All other formats are processed natively.
                            </p>
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
                                    { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Save to ModelConversionResults drive.' },
                                ]).map(opt => (
                                    <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                                        <input type="radio" name="mdl-output" value={opt.value}
                                            checked={outputMode === opt.value}
                                            onChange={() => setOutputMode(opt.value)}
                                            className="mt-0.5 accent-cyan-500 shrink-0" />
                                        <div>
                                            <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{opt.label}</span>
                                            <p className="text-xs text-slate-500">{opt.desc}</p>
                                            {opt.value === 'virtual_drive' && outputMode === 'virtual_drive' && (
                                                <p className="text-xs font-mono mt-0.5 text-cyan-400">
                                                    {outputPath ? `${String(outputPath)}\\ModelConversionResults` : 'No output path set in Settings.'}
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
                            className="w-full flex items-center justify-center gap-2 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-cyan-900/20">
                            {converting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Converting {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    Convert {selectedFiles.length} model{selectedFiles.length !== 1 ? 's' : ''}
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
                            {/* Show output file(s) */}
                            {results.results && results.results.length > 0 && (
                                <div className="mt-2 space-y-1.5">
                                    {results.results.filter((r: FileResult) => r.success && r.outputPath).map((r: FileResult, i: number) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <p className="text-xs text-green-400 truncate flex-1">
                                                \u2192 {r.outputPath!.split(/[\\/]/).pop()}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => openOutputFile(r.outputPath!)}
                                                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 transition-colors shrink-0"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                                Open
                                            </button>
                                        </div>
                                    ))}
                                </div>
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

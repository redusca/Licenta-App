import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, FileText, ChevronRight, HardDrive, FolderOpen,
    X, CheckCircle, AlertCircle, FileUp,
    Check, Minus, Play, Loader2, ExternalLink,
} from 'lucide-react';

const FLASK_BASE = 'http://127.0.0.1:5000';
const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.txt', '.html', '.htm', '.md', '.markdown']);
const OUTPUT_FORMATS = ['pdf', 'docx', 'txt', 'html', 'png'];

const CONVERSION_MAP: Record<string, string[]> = {
    '.pdf': ['docx', 'txt', 'html', 'png'],
    '.docx': ['pdf', 'txt', 'html'],
    '.doc': ['pdf', 'txt', 'html'],
    '.txt': ['pdf', 'docx'],
    '.html': ['pdf', 'docx'],
    '.htm': ['pdf', 'docx'],
    '.md': ['pdf', 'html', 'docx'],
    '.markdown': ['pdf', 'html', 'docx'],
};

interface FileItem { path: string; name: string; size: number; outputFormat: string }
type OutputMode = 'replace' | 'copy' | 'virtual_drive';
type FileStatus = 'pending' | 'converting' | 'done' | 'failed';
interface FileResult { path: string; outputPath?: string; success: boolean; error?: string }

function isDocFile(name: string): boolean {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return DOC_EXTENSIONS.has(ext);
}

function getFileExt(name: string): string {
    return '.' + (name.split('.').pop() ?? '').toLowerCase();
}

function getDefaultFormat(name: string): string {
    const ext = getFileExt(name);
    const allowed = CONVERSION_MAP[ext];
    return allowed?.[0] ?? 'pdf';
}

function getAllowedFormats(name: string): string[] {
    const ext = getFileExt(name);
    return CONVERSION_MAP[ext] ?? OUTPUT_FORMATS;
}

function fmtSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

const EXT_COLORS: Record<string, string> = {
    '.pdf': 'bg-red-500/15 text-red-400 border-red-500/20',
    '.docx': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    '.doc': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    '.txt': 'bg-slate-500/15 text-slate-400 border-slate-500/20',
    '.html': 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    '.htm': 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    '.md': 'bg-purple-500/15 text-purple-400 border-purple-500/20',
    '.markdown': 'bg-purple-500/15 text-purple-400 border-purple-500/20',
};

export const DocumentConverterPage: React.FC = () => {
    const navigate = useNavigate();
    const [files, setFiles] = useState<FileItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [globalFormat, setGlobalFormat] = useState('pdf');
    const [outputMode, setOutputMode] = useState<OutputMode>('copy');
    const [outputPath, setOutputPath] = useState('');
    const [converting, setConverting] = useState(false);
    const [results, setResults] = useState<any | null>(null);
    const [convError, setConvError] = useState<string | null>(null);
    const [fileStatuses, setFileStatuses] = useState<Map<string, FileStatus>>(new Map());

    useEffect(() => {
        fetch(`${FLASK_BASE}/api/agent/config`).then(r => r.json()).catch(() => ({}))
            .then(cfg => { setOutputPath(cfg.output_path || ''); });
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
            filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'txt', 'html', 'htm', 'md', 'markdown'] }],
        });
        if (!paths || paths.length === 0) return;
        const newFiles: FileItem[] = paths.map((p: string) => {
            const name = p.split(/[\\/]/).pop() || p;
            return { path: p, name, size: 0, outputFormat: getDefaultFormat(name) };
        });
        addFiles(newFiles);
    };

    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (!dir) return;
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(dir)}`);
            const data = await res.json();
            const docFiles: FileItem[] = (data.files || [])
                .filter((f: any) => !f.is_dir && isDocFile(f.name))
                .map((f: any) => ({ path: f.path, name: f.name, size: f.size || 0, outputFormat: getDefaultFormat(f.name) }));
            addFiles(docFiles);
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
        setFiles(prev => prev.map(f => {
            const allowed = getAllowedFormats(f.name);
            return { ...f, outputFormat: allowed.includes(globalFormat) ? globalFormat : allowed[0] };
        }));

    const selectedFiles = files.filter(f => selected.has(f.path));
    const allSelected = files.length > 0 && files.every(f => selected.has(f.path));
    const someSelected = files.some(f => selected.has(f.path));

    const toggleAllFiles = () => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(files.map(f => f.path)));
    };

    const clearAll = () => {
        setFiles([]); setSelected(new Set()); setResults(null); setConvError(null); setFileStatuses(new Map());
    };

    const convert = async () => {
        if (selectedFiles.length === 0) return;
        setConverting(true); setResults(null); setConvError(null);

        const statusMap = new Map<string, FileStatus>();
        selectedFiles.forEach(f => statusMap.set(f.path, 'converting'));
        setFileStatuses(new Map(statusMap));

        try {
            const res = await fetch(`${FLASK_BASE}/api/tools/document-converter/run`, {
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
        if (st === 'converting') return <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />;
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
                <Link to="/tools?category=documents" className="hover:text-slate-300 transition-colors">Documents</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/document-converter" className="hover:text-slate-300 transition-colors">Document Converter</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        <FileText className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Document Converter</h1>
                        <p className="text-sm text-slate-500">Convert between PDF, Word, TXT, HTML, Markdown & PNG</p>
                    </div>
                </div>
                <button type="button" onClick={() => navigate('/tools/document-converter')}
                    className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Info
                </button>
            </div>

            {/* Conversion matrix info */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm">
                <p className="text-xs text-slate-500 mb-2 font-medium">Supported conversions</p>
                <div className="flex flex-wrap gap-2 text-[11px]">
                    {Object.entries(CONVERSION_MAP).map(([ext, targets]) => (
                        <span key={ext} className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700">
                            <strong className="text-slate-300">{ext}</strong> → {targets.join(', ')}
                        </span>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: File picker + file list */}
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
                                className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors">
                                <FileUp className="w-4 h-4" />
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
                                <FileText className="w-10 h-10 text-slate-600" />
                                <p className="text-sm text-slate-500">No files added yet.</p>
                                <p className="text-xs text-slate-600">Add PDF, DOCX, TXT, HTML, or Markdown files to convert.</p>
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
                                            ? 'bg-amber-500 border-amber-500 text-white'
                                            : someSelected
                                                ? 'bg-amber-500/30 border-amber-400 text-white'
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
                                        className="text-xs px-2 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-500/40">
                                        {OUTPUT_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                                    </select>
                                    <button type="button" onClick={applyGlobalFormat}
                                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
                                        Apply to all
                                    </button>
                                </div>
                            </div>

                            <div className="max-h-[55vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
                                {files.map(file => {
                                    const result = getResultForFile(file.path);
                                    const ext = getFileExt(file.name);
                                    const extColor = EXT_COLORS[ext] || 'bg-slate-500/15 text-slate-400 border-slate-500/20';
                                    const allowed = getAllowedFormats(file.name);

                                    return (
                                        <div key={file.path}
                                            className={`flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors
                                                ${fileStatuses.get(file.path) === 'failed' ? 'bg-red-500/5' : fileStatuses.get(file.path) === 'done' ? 'bg-green-500/5' : ''}`}>

                                            <button type="button" onClick={() => toggleSelect(file.path)}
                                                className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${selected.has(file.path)
                                                    ? 'bg-amber-500 border-amber-500 text-white'
                                                    : 'border-slate-400 hover:border-slate-300'
                                                    }`}>
                                                {selected.has(file.path) && <Check className="w-3 h-3" />}
                                            </button>

                                            {getStatusIcon(file.path)}

                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold uppercase shrink-0 border ${extColor}`}>
                                                {ext.replace('.', '')}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-mono truncate" title={file.path}>{file.name}</p>
                                                {result && !result.success && <p className="text-xs text-red-400 mt-0.5">{result.error}</p>}
                                                {result?.outputPath && (
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <p className="text-xs text-green-500 truncate">→ {result.outputPath.split(/[\\/]/).pop()}</p>
                                                        <button type="button"
                                                            onClick={e => { e.stopPropagation(); (window as any).electronAPI?.showItemInFolder?.(result.outputPath); }}
                                                            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors shrink-0">
                                                            <ExternalLink className="w-2.5 h-2.5" />
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
                                                {allowed.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
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

                {/* Right: Settings + convert */}
                <div className="space-y-4">
                    {/* Output mode */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Output Mode</p>
                            <div className="space-y-3">
                                {([
                                    { value: 'copy' as OutputMode, label: 'Save in same folder', desc: 'Place output alongside originals.' },
                                    { value: 'replace' as OutputMode, label: 'Replace originals', desc: 'Overwrite the original files.' },
                                    { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Save to DocConvertResults drive.' },
                                ]).map(opt => (
                                    <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                                        <input type="radio" name="docconv-output" value={opt.value}
                                            checked={outputMode === opt.value}
                                            onChange={() => setOutputMode(opt.value)}
                                            className="mt-0.5 accent-amber-500 shrink-0" />
                                        <div>
                                            <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{opt.label}</span>
                                            <p className="text-xs text-slate-500">{opt.desc}</p>
                                            {opt.value === 'virtual_drive' && outputMode === 'virtual_drive' && (
                                                <p className="text-xs font-mono mt-0.5 text-amber-400">
                                                    {outputPath ? `${String(outputPath)}\\DocConvertResults` : 'No output path set in Settings.'}
                                                </p>
                                            )}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Notes */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Notes</p>
                            <div className="space-y-2 text-xs text-slate-500">
                                <p>• <strong className="text-slate-400">DOCX → PDF</strong> requires Microsoft Word installed.</p>
                                <p>• <strong className="text-slate-400">PDF → PNG</strong> renders each page as a separate image (200 DPI).</p>
                                <p>• <strong className="text-slate-400">PDF → DOCX</strong> works fully locally via pdf2docx.</p>
                                <p>• Format options per file are filtered to valid conversions only.</p>
                            </div>
                        </div>
                    )}

                    {/* Convert button */}
                    {files.length > 0 && (
                        <button type="button" onClick={convert} disabled={!canConvert}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-amber-900/20">
                            {converting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Converting {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    Convert {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
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
                            {results.results && results.results.length > 0 && (
                                <div className="mt-2 space-y-1.5">
                                    {results.results.filter((r: FileResult) => r.success && r.outputPath).map((r: FileResult, i: number) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <p className="text-xs text-green-400 truncate flex-1">
                                                → {r.outputPath!.split(/[\\/]/).pop()}
                                            </p>
                                            <button type="button"
                                                onClick={() => (window as any).electronAPI?.showItemInFolder?.(r.outputPath)}
                                                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 transition-colors shrink-0">
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
        </div>
    );
};

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, FileText, ChevronRight, HardDrive, FolderOpen,
    X, CheckCircle, AlertCircle, FileUp,
    Check, Minus, Play, Loader2, Scissors, Merge, ArrowRightLeft,
    GripVertical, ChevronDown, ChevronUp, FileDown, ExternalLink,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const FLASK_BASE = 'http://127.0.0.1:5000';
const PDF_EXTENSIONS = new Set(['.pdf']);
const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.doc']);

// ── Types ────────────────────────────────────────────────────────────────────

interface FileItem { path: string; name: string; size: number; pages?: number; }
type OutputMode = 'replace' | 'copy' | 'virtual_drive';
type TabMode = 'merge' | 'split' | 'convert';
type FileStatus = 'pending' | 'processing' | 'done' | 'failed';
interface FileResult {
    path: string;
    outputPath?: string;
    success: boolean;
    error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPdfFile(name: string): boolean {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return PDF_EXTENSIONS.has(ext);
}
function isDocFile(name: string): boolean {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return DOC_EXTENSIONS.has(ext);
}

function fmtSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function getFileExt(name: string): string {
    return '.' + (name.split('.').pop() ?? '').toLowerCase();
}

// ── Main page component ──────────────────────────────────────────────────────

export const PdfMergerPage: React.FC = () => {
    const navigate = useNavigate();
    const [files, setFiles] = useState<FileItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // Tab
    const [activeTab, setActiveTab] = useState<TabMode>('merge');

    // Merge settings
    const [outputFilename, setOutputFilename] = useState('merged');
    const [addBookmarks, setAddBookmarks] = useState(true);

    // Split settings
    const [pageRanges, setPageRanges] = useState('');
    const [splitOutputFilename, setSplitOutputFilename] = useState('');

    // Convert settings
    const [convertTo, setConvertTo] = useState<'pdf' | 'docx'>('docx');
    const [convertOutputFilename, setConvertOutputFilename] = useState('');

    // Output
    const [outputMode, setOutputMode] = useState<OutputMode>('copy');
    const [outputPath, setOutputPath] = useState('');
    const [processing, setProcessing] = useState(false);
    const [results, setResults] = useState<any | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fileStatuses, setFileStatuses] = useState<Map<string, FileStatus>>(new Map());

    // Drag state for reorder
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

    useEffect(() => {
        fetch(`${FLASK_BASE}/api/agent/config`).then(r => r.json()).catch(() => ({}))
            .then(cfg => { setOutputPath(cfg.output_path || ''); });
    }, []);

    // ── File management ──────────────────────────────────────────────────────

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

    // Fetch page counts for added PDF files
    const fetchPageCounts = async (paths: string[]) => {
        try {
            const res = await fetch(`${FLASK_BASE}/api/tools/pdf-merger/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'page_info', files: paths.map(p => ({ path: p })) }),
            });
            const data = await res.json();
            if (data.results) {
                setFiles(prev => prev.map(f => {
                    const info = data.results.find((r: any) => r.path === f.path);
                    return info && info.pages ? { ...f, pages: info.pages } : f;
                }));
            }
        } catch { /* ignore */ }
    };

    const browseFiles = async () => {
        const exts = activeTab === 'convert'
            ? ['pdf', 'docx', 'doc']
            : ['pdf'];
        const paths = await (window as any).electronAPI?.selectFiles?.({
            filters: [{ name: 'Documents', extensions: exts }],
        });
        if (!paths || paths.length === 0) return;
        const newFiles: FileItem[] = paths.map((p: string) => ({
            path: p,
            name: p.split(/[\\/]/).pop() || p,
            size: 0,
        }));
        addFiles(newFiles);
        const pdfPaths = paths.filter((p: string) => p.toLowerCase().endsWith('.pdf'));
        if (pdfPaths.length > 0) fetchPageCounts(pdfPaths);
    };

    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (!dir) return;
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(dir)}`);
            const data = await res.json();
            const checker = activeTab === 'convert' ? isDocFile : isPdfFile;
            const docFiles: FileItem[] = (data.files || [])
                .filter((f: any) => !f.is_dir && checker(f.name))
                .map((f: any) => ({ path: f.path, name: f.name, size: f.size || 0 }));
            addFiles(docFiles);
            const pdfPaths = docFiles.filter(f => f.name.toLowerCase().endsWith('.pdf')).map(f => f.path);
            if (pdfPaths.length > 0) fetchPageCounts(pdfPaths);
        } catch {
            setError('Failed to list files in that location.');
        }
    };

    const toggleSelect = (path: string) => setSelected(prev => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
    });

    const removeFile = (path: string) => {
        setFiles(prev => prev.filter(f => f.path !== path));
        setSelected(prev => { const n = new Set(prev); n.delete(path); return n; });
    };

    const selectedFiles = files.filter(f => selected.has(f.path));
    const allSelected = files.length > 0 && files.every(f => selected.has(f.path));
    const someSelected = files.some(f => selected.has(f.path));

    const toggleAllFiles = () => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(files.map(f => f.path)));
    };

    const clearAll = () => {
        setFiles([]); setSelected(new Set()); setResults(null); setError(null); setFileStatuses(new Map());
    };

    // ── Drag-and-drop reorder (merge mode) ───────────────────────────────────

    const handleDragStart = (idx: number) => setDragIdx(idx);
    const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); };
    const handleDragEnd = () => {
        if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
            setFiles(prev => {
                const next = [...prev];
                const [moved] = next.splice(dragIdx, 1);
                next.splice(dragOverIdx, 0, moved);
                return next;
            });
        }
        setDragIdx(null);
        setDragOverIdx(null);
    };

    const moveFile = (idx: number, dir: -1 | 1) => {
        setFiles(prev => {
            const next = [...prev];
            const newIdx = idx + dir;
            if (newIdx < 0 || newIdx >= next.length) return prev;
            [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
            return next;
        });
    };

    // ── Execute action ───────────────────────────────────────────────────────

    const execute = async () => {
        if (selectedFiles.length === 0) return;
        setProcessing(true); setResults(null); setError(null);

        const statusMap = new Map<string, FileStatus>();
        selectedFiles.forEach(f => statusMap.set(f.path, 'processing'));
        setFileStatuses(new Map(statusMap));

        try {
            const body: any = {
                action: activeTab,
                files: selectedFiles.map(f => ({ path: f.path })),
                outputMode,
                outputPath,
            };
            if (activeTab === 'merge') {
                body.outputFilename = outputFilename;
                body.addBookmarks = addBookmarks;
                // file order matters — use files in their displayed order
                body.files = files.filter(f => selected.has(f.path)).map(f => ({ path: f.path }));
            } else if (activeTab === 'split') {
                body.pageRanges = pageRanges;
                if (splitOutputFilename.trim()) body.outputFilename = splitOutputFilename.trim();
            } else if (activeTab === 'convert') {
                body.convertTo = convertTo;
                if (convertOutputFilename.trim()) body.outputFilename = convertOutputFilename.trim();
            }

            const res = await fetch(`${FLASK_BASE}/api/tools/pdf-merger/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            // Backend returns 200 even on logical failures — check data.success
            if (!data.success && data.error) {
                setError(data.error);
                const failMap = new Map<string, FileStatus>();
                selectedFiles.forEach(f => failMap.set(f.path, 'failed'));
                setFileStatuses(failMap);
                return;
            }

            setResults(data);

            const newStatuses = new Map<string, FileStatus>();
            (data.results || []).forEach((r: FileResult) => {
                newStatuses.set(r.path, r.success ? 'done' : 'failed');
            });
            // Also mark input files as done for merge (since the output is a new file)
            if (activeTab === 'merge' && data.success) {
                selectedFiles.forEach(f => newStatuses.set(f.path, 'done'));
            }
            setFileStatuses(newStatuses);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Operation failed');
            const failMap = new Map<string, FileStatus>();
            selectedFiles.forEach(f => failMap.set(f.path, 'failed'));
            setFileStatuses(failMap);
        } finally {
            setProcessing(false);
        }
    };

    const canExecute = selectedFiles.length > 0 && !processing
        && !(outputMode === 'virtual_drive' && !outputPath)
        && (activeTab !== 'split' || pageRanges.trim().length > 0);

    // ── Status icon helper ───────────────────────────────────────────────────

    const getStatusIcon = (path: string) => {
        const st = fileStatuses.get(path);
        if (!st || st === 'pending') return null;
        if (st === 'processing') return <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />;
        if (st === 'done') return <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />;
        if (st === 'failed') return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />;
        return null;
    };

    const getResultForFile = (path: string): FileResult | undefined => {
        if (!results?.results) return undefined;
        return results.results.find((r: FileResult) => r.path === path);
    };

    // ── Tab config ───────────────────────────────────────────────────────────

    const tabs: { key: TabMode; label: string; icon: React.ReactNode; desc: string }[] = [
        { key: 'merge', label: 'Merge & Reorder', icon: <Merge className="w-4 h-4" />, desc: 'Combine PDFs into one' },
        { key: 'split', label: 'Extract Pages', icon: <Scissors className="w-4 h-4" />, desc: 'Cut page ranges from a PDF' },
        { key: 'convert', label: 'Convert Format', icon: <ArrowRightLeft className="w-4 h-4" />, desc: 'PDF ↔ Word conversion' },
    ];

    const actionLabel = activeTab === 'merge' ? 'Merge' : activeTab === 'split' ? 'Extract' : 'Convert';

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6 max-w-6xl mx-auto">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools?category=documents" className="hover:text-slate-300 transition-colors">Documents</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/pdf-merger" className="hover:text-slate-300 transition-colors">PDF Toolkit</Link>
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
                        <h1 className="text-2xl font-bold">PDF Toolkit</h1>
                        <p className="text-sm text-slate-500">Merge, split, reorder & convert documents</p>
                    </div>
                </div>
                <button type="button" onClick={() => navigate('/tools/pdf-merger')}
                    className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Info
                </button>
            </div>

            {/* Action Tabs */}
            <div className="flex gap-2">
                {tabs.map(tab => (
                    <button key={tab.key} type="button"
                        onClick={() => { setActiveTab(tab.key); setResults(null); setError(null); setFileStatuses(new Map()); }}
                        className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === tab.key
                            ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300 shadow-lg shadow-amber-900/10'
                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                            }`}>
                        {tab.icon}
                        <div className="text-left">
                            <div>{tab.label}</div>
                            <div className="text-[10px] opacity-60 font-normal">{tab.desc}</div>
                        </div>
                    </button>
                ))}
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
                                <p className="text-xs text-slate-600">
                                    {activeTab === 'convert'
                                        ? 'Add PDF or DOCX files to convert between formats.'
                                        : activeTab === 'split'
                                            ? 'Add a PDF file to extract pages from.'
                                            : 'Add two or more PDF files to merge. Drag to reorder.'}
                                </p>
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
                                {activeTab === 'merge' && (
                                    <span className="text-xs text-slate-500">Drag to reorder &bull; Top = first in output</span>
                                )}
                            </div>

                            <div className="max-h-[55vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
                                {files.map((file, idx) => {
                                    const result = getResultForFile(file.path);
                                    const ext = getFileExt(file.name);
                                    const isDragging = dragIdx === idx;
                                    const isDragOver = dragOverIdx === idx;

                                    return (
                                        <div key={file.path}
                                            draggable={activeTab === 'merge'}
                                            onDragStart={() => handleDragStart(idx)}
                                            onDragOver={e => handleDragOver(e, idx)}
                                            onDragEnd={handleDragEnd}
                                            className={`flex items-center gap-3 px-5 py-3 transition-colors
                                                ${isDragging ? 'opacity-40' : ''}
                                                ${isDragOver ? 'border-t-2 border-amber-400' : ''}
                                                ${fileStatuses.get(file.path) === 'failed' ? 'bg-red-500/5' : fileStatuses.get(file.path) === 'done' ? 'bg-green-500/5' : ''}
                                                hover:bg-slate-50 dark:hover:bg-slate-800/30`}>

                                            {/* Drag handle (merge only) */}
                                            {activeTab === 'merge' && (
                                                <div className="flex flex-col gap-0.5 shrink-0 cursor-grab active:cursor-grabbing">
                                                    <GripVertical className="w-4 h-4 text-slate-600" />
                                                </div>
                                            )}

                                            <button type="button" onClick={() => toggleSelect(file.path)}
                                                className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${selected.has(file.path)
                                                    ? 'bg-amber-500 border-amber-500 text-white'
                                                    : 'border-slate-400 hover:border-slate-300'
                                                    }`}>
                                                {selected.has(file.path) && <Check className="w-3 h-3" />}
                                            </button>

                                            {getStatusIcon(file.path)}

                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold uppercase shrink-0 ${ext === '.pdf'
                                                    ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                                                    : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                                                }`}>
                                                {ext.replace('.', '')}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-mono truncate" title={file.path}>{file.name}</p>
                                                <div className="flex items-center gap-3 mt-0.5">
                                                    {file.pages && <span className="text-xs text-slate-500">{file.pages} page{file.pages !== 1 ? 's' : ''}</span>}
                                                    {file.size > 0 && <span className="text-xs text-slate-500">{fmtSize(file.size)}</span>}
                                                </div>
                                                {result && !result.success && <p className="text-xs text-red-400 mt-0.5">{result.error}</p>}
                                                {result?.outputPath && (
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <p className="text-xs text-green-500 truncate">→ {result.outputPath.split(/[\\/]/).pop()}</p>
                                                        <button
                                                            type="button"
                                                            onClick={e => { e.stopPropagation(); (window as any).electronAPI?.showItemInFolder?.(result.outputPath); }}
                                                            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors shrink-0"
                                                        >
                                                            <ExternalLink className="w-2.5 h-2.5" />
                                                            Open
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Reorder controls (merge mode) */}
                                            {activeTab === 'merge' && (
                                                <div className="flex flex-col gap-0.5 shrink-0">
                                                    <button type="button" onClick={() => moveFile(idx, -1)} disabled={idx === 0}
                                                        className="p-0.5 rounded hover:bg-slate-700 disabled:opacity-20 transition-colors">
                                                        <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                                                    </button>
                                                    <button type="button" onClick={() => moveFile(idx, 1)} disabled={idx === files.length - 1}
                                                        className="p-0.5 rounded hover:bg-slate-700 disabled:opacity-20 transition-colors">
                                                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                                    </button>
                                                </div>
                                            )}

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

                {/* ── Right: Settings + execute ── */}
                <div className="space-y-4">

                    {/* Tab-specific settings */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                        <p className="text-sm font-semibold text-slate-300 mb-4">
                            {activeTab === 'merge' ? 'Merge Settings' : activeTab === 'split' ? 'Split Settings' : 'Convert Settings'}
                        </p>

                        {activeTab === 'merge' && (
                            <div className="space-y-4 text-sm">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Output Filename</label>
                                    <input type="text" value={outputFilename} onChange={e => setOutputFilename(e.target.value)}
                                        placeholder="merged"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50 placeholder:text-slate-600" />
                                    <p className="text-[10px] text-slate-600 mt-1">Will produce "{outputFilename || 'merged'}.pdf"</p>
                                </div>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={addBookmarks} onChange={e => setAddBookmarks(e.target.checked)} className="accent-amber-500" />
                                    <span className="text-sm text-slate-300">Add bookmarks per source file</span>
                                </label>
                                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                                    <p className="text-xs text-amber-400/80">
                                        <strong>Tip:</strong> Drag files on the left or use the arrow buttons to control the page order in the merged PDF.
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'split' && (
                            <div className="space-y-4 text-sm">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Page Ranges</label>
                                    <input type="text" value={pageRanges} onChange={e => setPageRanges(e.target.value)}
                                        placeholder="e.g. 1-3, 5, 7-9"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50 placeholder:text-slate-600" />
                                    <p className="text-[10px] text-slate-600 mt-1">Comma-separated ranges. Each range creates a separate PDF.</p>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Output Filename (optional)</label>
                                    <input type="text" value={splitOutputFilename} onChange={e => setSplitOutputFilename(e.target.value)}
                                        placeholder="split_output"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50 placeholder:text-slate-600" />
                                    <p className="text-[10px] text-slate-600 mt-1">Base name for extracted files. Leave blank to use original name.</p>
                                </div>
                                {selectedFiles.length === 1 && selectedFiles[0].pages && (
                                    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                                        <p className="text-xs text-slate-400">
                                            Selected PDF has <strong className="text-slate-200">{selectedFiles[0].pages}</strong> pages.
                                            Valid range: 1–{selectedFiles[0].pages}
                                        </p>
                                    </div>
                                )}
                                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                                    <p className="text-xs text-amber-400/80">
                                        <strong>Tip:</strong> Select a single PDF file. Each comma-separated range will produce a separate output file.
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'convert' && (
                            <div className="space-y-4 text-sm">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Convert To</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button type="button" onClick={() => setConvertTo('docx')}
                                            className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border text-sm font-medium transition-all ${convertTo === 'docx'
                                                ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                                                : 'border-slate-700 text-slate-400 hover:border-slate-500'
                                                }`}>
                                            <FileDown className="w-4 h-4" />
                                            PDF → DOCX
                                        </button>
                                        <button type="button" onClick={() => setConvertTo('pdf')}
                                            className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border text-sm font-medium transition-all ${convertTo === 'pdf'
                                                ? 'bg-red-500/15 border-red-500/30 text-red-300'
                                                : 'border-slate-700 text-slate-400 hover:border-slate-500'
                                                }`}>
                                            <FileDown className="w-4 h-4" />
                                            DOCX → PDF
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Output Filename (optional)</label>
                                    <input type="text" value={convertOutputFilename} onChange={e => setConvertOutputFilename(e.target.value)}
                                        placeholder="converted_output"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 focus:outline-none focus:border-amber-500/50 placeholder:text-slate-600" />
                                    <p className="text-[10px] text-slate-600 mt-1">Leave blank to use original filename with new extension.</p>
                                </div>
                                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                                    <p className="text-xs text-amber-400/80">
                                        <strong>Note:</strong> DOCX → PDF conversion requires Microsoft Word installed on your system.
                                        PDF → DOCX works fully locally.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Output mode */}
                    {files.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm">
                            <p className="text-sm font-semibold text-slate-300 mb-3">Output Mode</p>
                            <div className="space-y-3">
                                {([
                                    { value: 'copy' as OutputMode, label: 'Save in same folder', desc: 'Place output alongside originals.' },
                                    { value: 'replace' as OutputMode, label: 'Replace originals', desc: 'Overwrite the original files.' },
                                    { value: 'virtual_drive' as OutputMode, label: 'Virtual drive', desc: 'Save to PdfToolResults drive.' },
                                ]).map(opt => (
                                    <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                                        <input type="radio" name="pdf-output" value={opt.value}
                                            checked={outputMode === opt.value}
                                            onChange={() => setOutputMode(opt.value)}
                                            className="mt-0.5 accent-amber-500 shrink-0" />
                                        <div>
                                            <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{opt.label}</span>
                                            <p className="text-xs text-slate-500">{opt.desc}</p>
                                            {opt.value === 'virtual_drive' && outputMode === 'virtual_drive' && (
                                                <p className="text-xs font-mono mt-0.5 text-amber-400">
                                                    {outputPath ? `${String(outputPath)}\\PdfToolResults` : 'No output path set in Settings.'}
                                                </p>
                                            )}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Execute button */}
                    {files.length > 0 && (
                        <button type="button" onClick={execute} disabled={!canExecute}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-amber-900/20">
                            {processing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {actionLabel}ing {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    {actionLabel} {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}
                                </>
                            )}
                        </button>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Summary results */}
                    {results && (
                        <div className={`px-5 py-4 rounded-xl text-sm ${results.success ? 'bg-green-500/10 border border-green-500/20 text-green-300' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle className="w-5 h-5 shrink-0" />
                                <span className="font-semibold">
                                    {results.succeeded ?? (results.success ? results.total ?? 1 : 0)}/{results.total ?? selectedFiles.length} processed successfully
                                </span>
                            </div>
                            {results.error && (
                                <p className="text-xs text-red-400 mt-1">{results.error}</p>
                            )}
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
                                                onClick={() => (window as any).electronAPI?.showItemInFolder?.(r.outputPath)}
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
        </div>
    );
};

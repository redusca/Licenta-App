import React, { useState, useEffect } from 'react';
import { X, HardDrive, Folder, File as FileIcon, ChevronRight, ArrowLeft, Loader2, Check, CheckSquare, Square } from 'lucide-react';

const FLASK_BASE = 'http://127.0.0.1:5000';

interface Entry {
    name: string;
    path: string;
    size: number;
    is_dir: boolean;
}

interface DrivePickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
    onSelectMulti?: (paths: string[]) => void;
    multiSelect?: boolean;
    filters?: string[]; // extensions like ['obj', 'gltf', 'png']
    title?: string;
}

export const DrivePickerModal: React.FC<DrivePickerModalProps> = ({ isOpen, onClose, onSelect, onSelectMulti, multiSelect = false, filters, title }) => {
    const [drives, setDrives] = useState<any[]>([]);
    const [history, setHistory] = useState<string[]>([]);
    const currentPath = history[history.length - 1] || null;
    const [entries, setEntries] = useState<Entry[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    
    useEffect(() => {
        if (!isOpen) {
            setHistory([]);
            setSelectedPaths(new Set());
            return;
        }
        fetch(`${FLASK_BASE}/api/drive/registry`)
            .then(r => r.json())
            .then(data => setDrives(data.drives || []));
    }, [isOpen]);

    const loadPath = async (path: string, pushHistory: boolean = true) => {
        setLoading(true);
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            
            let fetchedEntries = (data.files || []) as Entry[];
            if (filters && filters.length > 0) {
                fetchedEntries = fetchedEntries.filter(e => {
                    if (e.is_dir) return true;
                    const ext = e.name.split('.').pop()?.toLowerCase();
                    return ext && filters.includes(ext);
                });
            }
            fetchedEntries.sort((a, b) => {
                if (a.is_dir && !b.is_dir) return -1;
                if (!a.is_dir && b.is_dir) return 1;
                return a.name.localeCompare(b.name);
            });
            setEntries(fetchedEntries);
            if (pushHistory) setHistory(prev => [...prev, path]);
        } catch (e) {
            console.error("Failed to list folder", e);
        } finally {
            setLoading(false);
        }
    };

    const goBack = () => {
        setHistory(prev => {
            const next = [...prev];
            next.pop();
            return next;
        });
    };

    const toggleSelect = (path: string) => {
        setSelectedPaths(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    const confirmSelection = () => {
        const paths = Array.from(selectedPaths);
        if (paths.length > 0) {
            if (onSelectMulti) onSelectMulti(paths);
            else paths.forEach(p => onSelect(p));
        }
        onClose();
    };

    // Whenever history changes and we are not at root, load it
    useEffect(() => {
        if (!isOpen) return;
        if (currentPath) {
            loadPath(currentPath, false);
        } else {
            setEntries([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPath, isOpen]);

    if (!isOpen) return null;

    const fileEntries = entries.filter(e => !e.is_dir);
    const allFilesSelected = fileEntries.length > 0 && fileEntries.every(e => selectedPaths.has(e.path));

    const toggleSelectAll = () => {
        if (allFilesSelected) {
            // Deselect all files in current view
            setSelectedPaths(prev => {
                const next = new Set(prev);
                fileEntries.forEach(e => next.delete(e.path));
                return next;
            });
        } else {
            // Select all files in current view
            setSelectedPaths(prev => {
                const next = new Set(prev);
                fileEntries.forEach(e => next.add(e.path));
                return next;
            });
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col h-[70vh]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
                    <div className="flex items-center gap-3">
                        {currentPath && (
                            <button onClick={goBack} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                                <ArrowLeft className="w-5 h-5 text-slate-500" />
                            </button>
                        )}
                        <h2 className="font-semibold">{title || 'Select a file from My Drive'}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {multiSelect && currentPath && fileEntries.length > 0 && (
                            <button
                                onClick={toggleSelectAll}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                            >
                                {allFilesSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                {allFilesSelected ? 'Deselect All' : 'Select All'}
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 min-h-0 relative">
                    {!currentPath ? (
                        <div className="space-y-1">
                            {drives.length === 0 && <p className="text-center text-slate-500 py-8">No virtual drives found</p>}
                            {drives.map(d => (
                                <button key={d.path} onClick={() => loadPath(d.path, true)}
                                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors">
                                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex flex-col items-center justify-center shrink-0">
                                        <HardDrive className="w-5 h-5 text-blue-500" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm truncate">{d.name || d.path}</p>
                                        <p className="text-xs text-slate-500 truncate">{d.path}</p>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                </button>
                            ))}
                        </div>
                    ) : (
                        loading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                                <Loader2 className="w-6 h-6 animate-spin" />
                                <span className="text-sm">Loading folder...</span>
                            </div>
                        ) : entries.length === 0 ? (
                            <p className="text-center text-slate-500 py-12">No matching files found</p>
                        ) : (
                            <div className="space-y-1">
                                <p className="text-xs text-slate-500 mb-2 truncate max-w-full px-2" title={currentPath}>
                                    {currentPath}
                                </p>
                                {entries.map(e => e.is_dir ? (
                                    <button key={e.path} onClick={() => loadPath(e.path, true)}
                                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors">
                                        <Folder className="w-5 h-5 text-amber-400 shrink-0" />
                                        <span className="flex-1 text-sm truncate">{e.name}</span>
                                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                    </button>
                                ) : multiSelect ? (
                                    <button key={e.path} onClick={() => toggleSelect(e.path)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors group ${
                                            selectedPaths.has(e.path)
                                                ? 'bg-blue-500/10 border border-blue-500/30'
                                                : 'hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
                                        }`}>
                                        <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                                            selectedPaths.has(e.path)
                                                ? 'bg-blue-500 text-white'
                                                : 'border border-slate-600 text-transparent group-hover:border-slate-400'
                                        }`}>
                                            <Check className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="flex-1 text-sm truncate">{e.name}</span>
                                        <span className="text-xs text-slate-500 shrink-0">{(e.size / 1024).toFixed(1)} KB</span>
                                    </button>
                                ) : (
                                    <button key={e.path} onClick={() => { onSelect(e.path); onClose(); }}
                                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors group">
                                        <FileIcon className="w-5 h-5 text-slate-400 group-hover:text-blue-400 shrink-0 transition-colors" />
                                        <span className="flex-1 text-sm truncate">{e.name}</span>
                                        <span className="text-xs text-slate-500 shrink-0">{(e.size / 1024).toFixed(1)} KB</span>
                                    </button>
                                ))}
                            </div>
                        )
                    )}
                </div>

                {/* Footer with confirm button for multi-select mode */}
                {multiSelect && (
                    <div className="p-4 border-t border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-between">
                        <p className="text-sm text-slate-500">
                            {selectedPaths.size === 0
                                ? 'No files selected'
                                : `${selectedPaths.size} file${selectedPaths.size > 1 ? 's' : ''} selected`}
                        </p>
                        <button
                            onClick={confirmSelection}
                            disabled={selectedPaths.size === 0}
                            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600 flex items-center gap-2"
                        >
                            <Check className="w-4 h-4" />
                            Confirm Selection
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

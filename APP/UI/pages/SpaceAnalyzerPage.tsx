import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, ChevronRight, Folder, File, Loader2, PieChart, HardDrive, Play, ArrowUpCircle, FolderOpen
} from 'lucide-react';

const FLASK_BASE = 'http://127.0.0.1:5000';

interface NodeInfo {
    name: string;
    full_path: string;
    is_dir: boolean;
    size: number;
    created: number;
    modified: number;
    accessed: number;
}

interface AnalysisData {
    path: string;
    total_size: number;
    children: NodeInfo[];
}

function formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export const SpaceAnalyzerPage: React.FC = () => {
    const navigate = useNavigate();
    
    // UI State
    const [driveLetter, setDriveLetter] = useState<string>('C');
    const [running, setRunning] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    
    const [data, setData] = useState<AnalysisData | null>(null);
    const [history, setHistory] = useState<string[]>([]); // stack of paths
    const [targetDirInput, setTargetDirInput] = useState<string>(''); // specific folder
    const [availableDrives, setAvailableDrives] = useState<string[]>([]);

    useEffect(() => {
        fetch(`${FLASK_BASE}/api/tools/space-analyzer/drives`)
            .then(res => res.json())
            .then(data => {
                if (data.drives && data.drives.length > 0) {
                    setAvailableDrives(data.drives);
                    if (!data.drives.includes(driveLetter)) {
                        setDriveLetter(data.drives[0]);
                    }
                }
            })
            .catch(console.error);
    }, []);

    const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        if (val === 'FOLDER') {
            browseFolder();
        } else {
            setDriveLetter(val);
            setTargetDirInput('');
        }
    };

    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (dir) {
            setTargetDirInput(dir);
            // Auto-detect drive letter from path e.g. "C:\..."
            const match = dir.match(/^([a-zA-Z]):[/\\]/);
            if (match) {
                setDriveLetter(match[1].toUpperCase());
            }
        }
    };

    // Fetch data for a specific path
    const analyzePath = async (targetDir?: string) => {
        setRunning(true);
        setErrorMsg(null);

        try {
            const res = await fetch(`${FLASK_BASE}/api/tools/space-analyzer/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    driveLetter,
                    targetDir
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
            
            if (!result.success) {
                setErrorMsg(result.error || "Failed to analyze drive.");
            } else {
                setData(result.data);
                if (targetDir) {
                    if (history[history.length - 1] !== targetDir) {
                        setHistory([...history, targetDir]);
                    }
                } else {
                    setHistory([result.data.path]);
                }
            }
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Execution failed');
        } finally {
            setRunning(false);
        }
    };

    const handleNodeClick = (node: NodeInfo) => {
        if (node.is_dir) {
            analyzePath(node.full_path);
        } else {
            // Preview file natively or handle somehow
            if ((window as any).electronAPI) {
                (window as any).electronAPI.invoke('open-path', node.full_path).catch(console.error);
            }
        }
    };

    const goUp = () => {
        if (history.length > 1) {
            const newHistory = [...history];
            newHistory.pop(); // remove current
            const parent = newHistory.pop(); // remove parent to re-fetch it and add it back
            setHistory(newHistory);
            analyzePath(parent);
        } else {
            analyzePath(); // root
        }
    };

    const runTool = () => {
        setHistory([]);
        analyzePath(targetDirInput || undefined);
    };

    // Color generator based on name
    const getColor = (name: string, isDir: boolean) => {
        if (!isDir) return 'rgb(94 162 255 / 80%)'; // blueish for files
        const hash = name.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
        const hue = Math.abs(hash) % 360;
        return `hsl(${hue}, 70%, 45%)`; // vibrant colors for folders
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-10">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools?category=computer_tools" className="hover:text-slate-300 transition-colors">Computer Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Space Analyzer</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-500/10 border border-slate-500/20 flex items-center justify-center">
                        <PieChart className="w-6 h-6 text-slate-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Space Analyzer</h1>
                        <p className="text-sm text-slate-500">Fast visual disk space usage</p>
                    </div>
                </div>
                <button type="button" onClick={() => navigate('/tools')}
                    className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>
            </div>

            {/* Controls */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm flex items-end gap-4">
                <div className="flex-1 max-w-sm">
                    <label className="block text-xs text-slate-400 mb-1.5 uppercase font-semibold">Select Drive or Folder</label>
                    <div className="relative">
                        <select 
                            value={targetDirInput ? 'FOLDER' : driveLetter} 
                            onChange={handleSelectChange}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 appearance-none pl-10"
                        >
                            {availableDrives.length === 0 && <option value="C">C:\ (Windows)</option>}
                            {availableDrives.map(d => (
                                <option key={d} value={d}>{d}:\</option>
                            ))}
                            <option disabled>──────────</option>
                            <option value="FOLDER">📁 Select Folder...</option>
                        </select>
                        <HardDrive className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    </div>
                    {targetDirInput && (
                        <div className="mt-2 text-xs text-emerald-400 font-mono truncate px-1">
                            {targetDirInput}
                        </div>
                    )}
                </div>
                
                <button type="button" onClick={runTool} disabled={running}
                    className="shrink-0 flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm shadow-lg shadow-emerald-900/20">
                    {running && !data ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Analyze {driveLetter}:
                </button>
            </div>
            
            {errorMsg && (
                <div className="p-4 bg-red-900/30 border border-red-500/30 text-red-400 rounded-lg text-sm">
                    {errorMsg}
                </div>
            )}

            {/* Results visualization */}
            {data && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    
                    {/* Path header */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
                        <button onClick={goUp} disabled={history.length <= 1} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 disabled:opacity-30 transition-colors">
                            <ArrowUpCircle className="w-5 h-5" />
                        </button>
                        <div className="flex-1 font-mono text-sm break-all text-slate-300">
                            {data.path}
                        </div>
                        <div className="font-bold text-emerald-400 text-lg">
                            {formatBytes(data.total_size)}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Graphical Treemap (Slice & Dice approach) */}
                        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 h-[600px] flex overflow-hidden shadow-inner">
                            {running ? (
                                <div className="w-full h-full flex items-center justify-center text-slate-500 flex-col gap-2">
                                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                                    <span>Scanning...</span>
                                </div>
                            ) : data.children.length === 0 ? (
                                <div className="w-full h-full flex items-center justify-center text-slate-500">
                                    Empty folder
                                </div>
                            ) : (
                                <div className="w-full h-full flex flex-wrap content-start gap-1 p-1 bg-slate-950 rounded border border-slate-800/50">
                                    {data.children.slice(0, 50).map((child, i) => {
                                        const pct = (child.size / data.total_size) * 100;
                                        if (pct < 0.1) return null; // hide very small rects
                                        
                                        // simple flex grid layout proportionally
                                        return (
                                            <div 
                                                key={i}
                                                onClick={() => handleNodeClick(child)}
                                                className="group relative cursor-pointer hover:brightness-125 transition-all text-white overflow-hidden shadow-sm flex flex-col p-2"
                                                style={{ 
                                                    flex: `${Math.max(1, child.size)} ${Math.max(1, child.size)} auto`,
                                                    minWidth: `${Math.max(40, pct * 4)}px`,
                                                    minHeight: '40px',
                                                    height: `max(60px, ${pct}%)`,
                                                    backgroundColor: getColor(child.name, child.is_dir),
                                                }}
                                                title={`${child.name} (${formatBytes(child.size)})`}
                                            >
                                                <span className="font-semibold text-xs truncate drop-shadow-md z-10 select-none">
                                                    {child.name}
                                                </span>
                                                <span className="text-[10px] text-white/80 truncate drop-shadow-md z-10 select-none">
                                                    {formatBytes(child.size)}
                                                </span>
                                                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* File list pane */}
                        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-[600px] flex flex-col">
                            <div className="p-3 border-b border-slate-800 bg-slate-900/50 font-semibold text-sm text-slate-300">
                                Largest Items
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                                {data.children.map((child, i) => (
                                    <div 
                                        key={i} 
                                        onClick={() => handleNodeClick(child)}
                                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/50 cursor-pointer group transition-colors"
                                    >
                                        {child.is_dir ? 
                                            <Folder className="w-4 h-4 text-emerald-400 shrink-0" /> : 
                                            <File className="w-4 h-4 text-blue-400 shrink-0" />
                                        }
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm text-slate-300 truncate group-hover:text-white transition-colors">{child.name}</div>
                                            <div className="text-xs text-slate-500">
                                                {new Date(child.modified * 1000).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div className="text-sm font-mono text-slate-400 shrink-0">
                                            {formatBytes(child.size)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, ChevronRight, Folder, File, Loader2, PieChart, HardDrive, Play, ArrowUpCircle
} from 'lucide-react';
import { MediaPreviewModal } from '../components/MediaPreviewModal';

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

// Color generator based on name
const getColor = (name: string, isDir: boolean) => {
    if (!isDir) return 'rgb(94 162 255 / 80%)'; // blueish for files
    const hash = name.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 45%)`; // vibrant colors for folders
};

interface Rect { x: number; y: number; w: number; h: number; child: NodeInfo }

function binaryTreemap(items: NodeInfo[], x: number, y: number, w: number, h: number): Rect[] {
    if (items.length === 0) return [];
    if (items.length === 1) return [{ x, y, w, h, child: items[0] }];
    
    const totalSize = items.reduce((s, c) => s + c.size, 0);
    if (totalSize === 0) return []; // avoid NaN

    // find split point
    let sum = 0;
    let splitIdx = 0;
    for (let i = 0; i < items.length - 1; i++) {
        sum += items[i].size;
        splitIdx = i;
        if (sum >= totalSize / 2) break;
    }
    
    if (splitIdx === items.length - 1) splitIdx = items.length - 2;

    const left = items.slice(0, splitIdx + 1);
    const right = items.slice(splitIdx + 1);
    const leftRatio = left.reduce((s, c) => s + c.size, 0) / totalSize;
    
    if (w >= h) {
        const leftW = w * leftRatio;
        return [
            ...binaryTreemap(left, x, y, leftW, h),
            ...binaryTreemap(right, x + leftW, y, w - leftW, h)
        ];
    } else {
        const leftH = h * leftRatio;
        return [
            ...binaryTreemap(left, x, y, w, leftH),
            ...binaryTreemap(right, x, y + leftH, w, h - leftH)
        ];
    }
}

const TreemapChart = ({ data, onNodeClick }: { data: NodeInfo[], onNodeClick: (n:NodeInfo)=>void }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [bounds, setBounds] = useState({ w: 0, h: 0 });
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const isDragging = useRef(false);
    const dragMoved = useRef(false);
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setBounds({ w: entry.contentRect.width, h: entry.contentRect.height });
            }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        setTransform({ x: 0, y: 0, scale: 1 });
    }, [data]);

    const handleWheelRefs = useRef({ transform });
    handleWheelRefs.current = { transform };

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const { transform } = handleWheelRefs.current;
            const zoomSensitivity = 0.001;
            const delta = -e.deltaY * zoomSensitivity;
            let newScale = transform.scale * Math.exp(delta);
            
            if (newScale < 1) newScale = 1;

            if (newScale === 1) {
                 setTransform({ x: 0, y: 0, scale: 1 });
                 return;
            }
            
            const rect = el.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            
            const r = newScale / transform.scale;
            const newX = cursorX - (cursorX - transform.x) * r;
            const newY = cursorY - (cursorY - transform.y) * r;
            
            setTransform({ x: newX, y: newY, scale: newScale });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const handlePointerDown = (e: React.PointerEvent) => {
        isDragging.current = true;
        dragMoved.current = false;
        dragStart.current = { x: e.clientX, y: e.clientY, panX: transform.x, panY: transform.y };
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging.current) return;
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved.current = true;
        setTransform(prev => ({ ...prev, x: dragStart.current.panX + dx, y: dragStart.current.panY + dy }));
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        isDragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const rects = useMemo(() => {
        if (bounds.w === 0 || bounds.h === 0) return [];
        const sorted = [...data].filter(c => c.size > 0).sort((a, b) => b.size - a.size);
        const top = sorted.slice(0, 500); // 500 rects limits DOM nodes while being highly detailed
        return binaryTreemap(top, 0, 0, bounds.w, bounds.h);
    }, [data, bounds.w, bounds.h]);

    return (
        <div 
            ref={containerRef}
            className="w-full h-full relative cursor-grab active:cursor-grabbing overflow-hidden rounded bg-slate-950 touch-none select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            <div 
                className="absolute inset-0 origin-top-left"
                style={{ transform: `matrix(${transform.scale}, 0, 0, ${transform.scale}, ${transform.x}, ${transform.y})` }}
            >
                {rects.map((r, i) => {
                    const isTooSmall = r.w * transform.scale < 40 || r.h * transform.scale < 20;

                    return (
                        <div 
                            key={i}
                            onClick={(e) => { 
                                e.stopPropagation(); 
                                if (!dragMoved.current) onNodeClick(r.child); 
                            }}
                            className="absolute border border-slate-900 group hover:z-10 hover:brightness-125 transition-all text-white overflow-hidden shadow-sm flex flex-col p-1.5"
                            style={{ 
                                left: r.x, top: r.y, width: r.w, height: r.h,
                                backgroundColor: getColor(r.child.name, r.child.is_dir),
                            }}
                            title={`${r.child.name} (${formatBytes(r.child.size)})`}
                        >
                            {!isTooSmall && (
                                <>
                                    <span className="font-semibold text-xs truncate drop-shadow-md z-10 select-none">
                                        {r.child.name}
                                    </span>
                                    <span className="text-[10px] text-white/80 truncate drop-shadow-md z-10 select-none">
                                        {formatBytes(r.child.size)}
                                    </span>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
            
            {transform.scale > 1.05 && (
                 <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 backdrop-blur rounded text-xs font-mono text-emerald-400 pointer-events-none">
                      {Math.round(transform.scale * 100)}%
                 </div>
            )}
        </div>
    );
};

export const SpaceAnalyzerPage: React.FC = () => {
    const navigate = useNavigate();
    
    // UI State
    const [driveLetter, setDriveLetter] = useState<string>('C');
    const [running, setRunning] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [previewNode, setPreviewNode] = useState<NodeInfo | null>(null);
    
    // Loading State Simulator
    const [loadingStep, setLoadingStep] = useState(0);
    const [loadingFile, setLoadingFile] = useState("");

    const scanSteps = [
        "Initializing scan engine...",
        "Querying Master File Table...",
        "Parsing NTFS MFT records...",
        "Building directory hierarchy...",
        "Computing size aggregations...",
        "Optimizing visualization map..."
    ];

    const [data, setData] = useState<AnalysisData | null>(null);
    const [history, setHistory] = useState<string[]>([]); // stack of paths
    const [targetDirInput, setTargetDirInput] = useState<string>(''); // specific folder
    const [availableDrives, setAvailableDrives] = useState<string[]>([]);

    useEffect(() => {
        let intv: number, fileIntv: number;
        if (running) {
            setLoadingStep(0);
            intv = window.setInterval(() => {
                 setLoadingStep(prev => prev < scanSteps.length - 1 ? prev + 1 : prev);
            }, 400);

            const roots = targetDirInput ? [targetDirInput] : [`${driveLetter}:\\Windows\\System32`, `${driveLetter}:\\Users\\AppData`, `${driveLetter}:\\Program Files\\Common`];
            const dirNames = ["Cache", "Data", "Temp", "Logs", "Index", "Binaries", "Lib"];
            const sysNames = ["sys", "config", "registry", "cache", "manifest", "node", "core", "runtime"];
            const exts = [".dll", ".sys", ".dat", ".idx", ".log", ".bin", ".db", ".pak"];
            
            fileIntv = window.setInterval(() => {
                 const root = roots[Math.floor(Math.random() * roots.length)];
                 const dName = dirNames[Math.floor(Math.random() * dirNames.length)];
                 const fName = sysNames[Math.floor(Math.random() * sysNames.length)] + Math.floor(Math.random()*1000);
                 const ext = exts[Math.floor(Math.random() * exts.length)];
                 setLoadingFile(`${root}\\${dName}\\${fName}${ext}`);
            }, 50);
        }
        return () => {
           window.clearInterval(intv);
           window.clearInterval(fileIntv);
        };
    }, [running, driveLetter, targetDirInput]);

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
    const analyzePath = async (targetDir?: string, overwriteHistory?: string[]) => {
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
                if (overwriteHistory) {
                    setHistory(overwriteHistory);
                } else if (targetDir) {
                    setHistory(prev => prev.length > 0 && prev[prev.length - 1] === targetDir ? prev : [...prev, targetDir]);
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
            setPreviewNode(node);
        }
    };

    const goUp = () => {
        if (history.length > 1) {
            const newHistory = [...history];
            newHistory.pop(); // remove current
            const parent = newHistory[newHistory.length - 1]; // next current
            analyzePath(parent, newHistory);
        } else {
            analyzePath(); // root
        }
    };

    const runTool = () => {
        setHistory([]);
        analyzePath(targetDirInput || undefined);
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
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 uppercase font-semibold whitespace-nowrap hidden sm:block">Target:</span>
                    <div className="relative">
                        <select 
                            value={targetDirInput ? 'FOLDER' : driveLetter} 
                            onChange={handleSelectChange}
                            className="w-48 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 appearance-none pl-9"
                        >
                            {availableDrives.length === 0 && <option value="C">C:\ (Windows)</option>}
                            {availableDrives.map(d => (
                                <option key={d} value={d}>{d}:\</option>
                            ))}
                            <option disabled>──────────</option>
                            <option value="FOLDER">📁 Select Folder...</option>
                        </select>
                        <HardDrive className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    </div>
                </div>

                <button type="button" onClick={runTool} disabled={running}
                    className="shrink-0 flex items-center justify-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors text-sm shadow-sm">
                    {running && !data ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Analyze {targetDirInput ? 'Folder' : driveLetter + ':'}
                </button>

                {targetDirInput && (
                    <div className="text-xs text-emerald-400 font-mono truncate px-2 border-l border-slate-700 max-w-sm flex-1">
                        {targetDirInput}
                    </div>
                )}
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
                                <div className="w-full h-full flex items-center justify-center text-slate-500 flex-col gap-6 p-8">
                                    <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-2" />
                                    <div className="w-full max-w-sm flex flex-col gap-2">
                                        <div className="flex justify-between items-end">
                                             <span className="text-sm font-semibold text-emerald-400">{scanSteps[loadingStep]}</span>
                                             <span className="text-xs text-slate-500">{Math.round(((loadingStep + 1) / scanSteps.length) * 100)}%</span>
                                        </div>
                                        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden shadow-inner">
                                            <div 
                                                className="bg-emerald-500 h-full transition-all duration-300" 
                                                style={{ width: `${((loadingStep + 1) / scanSteps.length) * 100}%` }}
                                            />
                                        </div>
                                        <div className="text-[10px] text-slate-500 font-mono truncate mt-3 opactiy-80">
                                            Scanning: {loadingFile}
                                        </div>
                                    </div>
                                </div>
                            ) : data.children.length === 0 ? (
                                <div className="w-full h-full flex items-center justify-center text-slate-500">
                                    Empty folder
                                </div>
                            ) : (
                                <TreemapChart data={data.children} onNodeClick={handleNodeClick} />
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
            
            {previewNode && (
                <MediaPreviewModal 
                    file={{ name: previewNode.name, path: previewNode.full_path, size: previewNode.size, is_dir: false }} 
                    onClose={() => setPreviewNode(null)} 
                />
            )}
        </div>
    );
};

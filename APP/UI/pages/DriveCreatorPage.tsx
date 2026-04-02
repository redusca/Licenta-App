import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, ChevronRight, FolderTree, FolderOpen,
    CheckCircle, AlertCircle, Play, Loader2, HardDrive
} from 'lucide-react';

const FLASK_BASE = 'http://127.0.0.1:5000';

const CATEGORY_EXTENSIONS: Record<string, string[]> = {
    'image': ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif'],
    'audio': ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.wma', '.mka'],
    'video': ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
    'documents': ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.rtf', '.odt', '.ods', '.odp', '.zip', '.rar', '.7z'],
    '3d': ['.obj', '.fbx', '.glb', '.gltf', '.stl', '.ply'],
    'programming': ['.py', '.js', '.ts', '.html', '.css', '.tsx', '.jsx', '.cpp', '.cs', '.java', '.json']
};

const CATEGORY_LABELS: Record<string, string> = {
    'image': 'Images',
    'audio': 'Audio & Music',
    'video': 'Videos',
    'documents': 'Documents & Archives',
    '3d': '3D Models',
    'programming': 'Source Code'
};

export const DriveCreatorPage: React.FC = () => {
    const navigate = useNavigate();
    
    const [sourceFolder, setSourceFolder] = useState<string>('');
    const [driveName, setDriveName] = useState<string>('My New Folder Drive');
    const [category, setCategory] = useState<string>('image');
    const [action, setAction] = useState<'shortcuts'|'move'>('shortcuts');
    
    const [outputPath, setOutputPath] = useState<string>('');
    const [loadingConfig, setLoadingConfig] = useState(true);
    
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<any | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Initial load for config
    useEffect(() => {
        setLoadingConfig(true);
        fetch(`${FLASK_BASE}/api/agent/config`)
            .then(r => r.json())
            .then(data => setOutputPath(data.output_path || ''))
            .catch(() => {})
            .finally(() => setLoadingConfig(false));
    }, []);

    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (dir) setSourceFolder(dir);
    };

    const browseOutputFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (dir) setOutputPath(dir);
    };

    const runTool = async () => {
        if (!sourceFolder) {
            setErrorMsg("Please select a source folder first.");
            return;
        }
        if (!driveName.trim()) {
            setErrorMsg("Please provide a name for the Drive.");
            return;
        }

        setRunning(true);
        setResult(null);
        setErrorMsg(null);

        try {
            const res = await fetch(`${FLASK_BASE}/api/tools/drive-creator/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceFolder,
                    extensions: CATEGORY_EXTENSIONS[category],
                    driveName: driveName.trim(),
                    action,
                    outputPath
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            
            if (!data.success) {
                setErrorMsg(data.error || "No files were processed successfully.");
            } else {
                setResult(data);
                if (data.virtualDrivePath) {
                    try {
                        const stored = localStorage.getItem('knownDrives');
                        const drives = stored ? JSON.parse(stored) : [];
                        const driveType = action === 'shortcuts' ? 'shortcut' : 'move';
                        // Add only if not already present
                        if (!drives.some((d: any) => d.path === data.virtualDrivePath)) {
                            drives.push({ path: data.virtualDrivePath, name: driveName.trim(), type: driveType });
                            localStorage.setItem('knownDrives', JSON.stringify(drives));
                            fetch(`${FLASK_BASE}/api/drive/registry`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ drives })
                            }).catch(() => {});
                        }
                    } catch(e) {}
                }
            }
        } catch (e: unknown) {
            setErrorMsg(e instanceof Error ? e.message : 'Execution failed');
        } finally {
            setRunning(false);
        }
    };

    const canRun = sourceFolder.length > 0 && driveName.trim().length > 0 && !running && !!outputPath;

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools?category=documents" className="hover:text-slate-300 transition-colors">Documents & Utilities</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link to="/tools/drive-creator" className="hover:text-slate-300 transition-colors">Drive Creator</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">Run</span>
            </nav>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <FolderTree className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Drive Creator</h1>
                        <p className="text-sm text-slate-500">Fast folder-to-drive grouping using MFT</p>
                    </div>
                </div>
                <button type="button" onClick={() => navigate('/tools')}
                    className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Tools
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* ── Left: Main configuration ── */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                        <h2 className="text-sm font-semibold text-slate-300 mb-4">1. Select Target Directory</h2>
                        
                        <div className="flex gap-3 mb-4">
                            <button type="button" onClick={browseFolder}
                                className="flex-1 flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white transition-colors">
                                <FolderOpen className="w-4 h-4" />
                                Browse Source Folder
                            </button>
                        </div>
                        
                        {sourceFolder ? (
                            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                                <p className="text-xs text-slate-400 font-mono break-all">{sourceFolder}</p>
                            </div>
                        ) : (
                            <div className="p-4 border-2 border-dashed border-slate-700 rounded-lg text-center opacity-70">
                                <p className="text-sm text-slate-500">Pick a folder to aggregate files from.</p>
                            </div>
                        )}
                    </div>
                    
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                        <h2 className="text-sm font-semibold text-slate-300 mb-4">2. Tool Settings</h2>
                        
                        <div className="space-y-5">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1.5 uppercase font-semibold">Virtual Drive Name</label>
                                <input type="text" value={driveName} onChange={e => setDriveName(e.target.value)}
                                    placeholder="e.g. My Important Files"
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
                            </div>

                            <div>
                                <label className="block text-xs text-slate-400 mb-1.5 uppercase font-semibold">File Category</label>
                                <select 
                                    value={category} 
                                    onChange={e => setCategory(e.target.value)}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                                >
                                    {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                                        <option key={k} value={k}>{label}</option>
                                    ))}
                                </select>
                                <p className="text-xs text-slate-500 mt-2 font-mono break-words">
                                    Matches: {CATEGORY_EXTENSIONS[category].join(', ')}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Right: Output + Run ── */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col h-full">
                        <div className="flex-1">
                            <h2 className="text-sm font-semibold text-slate-300 mb-4">Output Configuration</h2>
                            
                            <div className="space-y-4">
                                {([
                                    { value: 'shortcuts', label: 'Create Shortcuts', desc: 'Safest. Creates .lnk shortcuts inside the new drive linking to original files.' },
                                    { value: 'move', label: 'Move Original Files', desc: 'Warning! Moves files entirely out of the source folder into the new Drive.' },
                                ]).map(opt => (
                                    <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                                        <input type="radio" name="dc-out" value={opt.value}
                                            checked={action === opt.value}
                                            onChange={() => setAction(opt.value as any)}
                                            className="mt-0.5 accent-emerald-500 shrink-0" />
                                        <div>
                                            <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors">{opt.label}</span>
                                            <p className="text-xs text-slate-500">{opt.desc}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>

                            <div className="mt-6 pt-4 border-t border-slate-800">
                                <label className="block text-xs text-slate-400 mb-2 uppercase font-semibold">Virtual Drive Location</label>
                                <div className="flex gap-2">
                                    <button type="button" onClick={browseOutputFolder}
                                        className="shrink-0 flex items-center justify-center px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 transition-colors">
                                        <FolderOpen className="w-4 h-4 mr-2" />
                                        Select Folder
                                    </button>
                                    <div className="flex-1 px-3 py-2 bg-slate-800/50 rounded-lg border border-slate-700 flex items-center overflow-hidden">
                                        {loadingConfig ? (
                                            <span className="text-xs text-slate-500 font-mono">Loading...</span>
                                        ) : outputPath ? (
                                            <span className="text-xs text-emerald-400 font-mono truncate">{outputPath}</span>
                                        ) : (
                                            <span className="text-xs text-red-400 font-mono">Required: Please select output location</span>
                                        )}
                                    </div>
                                </div>
                                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                                    Defaults to your global settings. You can optionally place this Virtual Drive anywhere.
                                </p>
                            </div>
                        </div>

                        {/* Convert button */}
                        <div className="mt-8">
                            <button type="button" onClick={runTool} disabled={!canRun}
                                className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors text-sm shadow-lg shadow-emerald-900/20">
                                {running ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Creating Drive...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-4 h-4" />
                                        Create Drive
                                    </>
                                )}
                            </button>

                            {/* Error */}
                            {errorMsg && (
                                <div className="mt-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm font-medium">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    {errorMsg}
                                </div>
                            )}

                            {/* Summary results */}
                            {result && result.success && (
                                <div className="mt-4 px-4 py-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm">
                                    <div className="flex items-center gap-2 mb-2 font-semibold text-emerald-400">
                                        <CheckCircle className="w-5 h-5 shrink-0" />
                                        Drive successfully created!
                                    </div>
                                    <p className="text-xs text-emerald-400/80 mb-3 ml-7">
                                        Processed {result.succeeded} files into '{driveName}'.
                                    </p>
                                    <div className="ml-7">
                                        <button type="button" onClick={() => navigate(`/files?path=${encodeURIComponent(result.virtualDrivePath)}`)}
                                            className="text-xs flex items-center gap-1.5 px-3 py-2 bg-emerald-500/20 text-emerald-300 font-medium rounded-lg hover:bg-emerald-500/30 transition-colors">
                                            <HardDrive className="w-3.5 h-3.5" />
                                            Open Virtual Drive
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

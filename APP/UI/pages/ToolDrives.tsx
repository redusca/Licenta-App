import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FolderOpen, RefreshCw, ExternalLink, Wrench, AlertCircle,
    HardDrive, Image, ChevronRight
} from 'lucide-react';

const FLASK = 'http://127.0.0.1:5000';

interface ToolDrive {
    path: string;
    name: string;
    tool: string;
}

const TOOL_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    image_converter: { label: 'Image Converter', icon: Image, color: 'blue' },
};

function DriveCard({ drive }: { drive: ToolDrive }) {
    const navigate = useNavigate();
    const meta = TOOL_LABELS[drive.tool] ?? { label: drive.tool, icon: Wrench, color: 'slate' };
    const Icon = meta.icon;

    const openInFiles = () => {
        // Navigate to /files — the drive will be visible in the drive list
        navigate('/files');
    };

    const openInExplorer = async () => {
        try {
            await fetch(`${FLASK}/api/drive/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: drive.path }),
            });
        } catch {
            // ignore
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm hover:border-blue-400/40 transition-colors">
            <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl bg-${meta.color}-500/10 border border-${meta.color}-500/20 flex items-center justify-center shrink-0`}>
                    <Icon className={`w-6 h-6 text-${meta.color}-400`} />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm">{drive.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Created by <span className="text-slate-400">{meta.label}</span>
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-500 font-mono mt-1 truncate" title={drive.path}>
                        {drive.path}
                    </p>
                </div>
            </div>

            <div className="flex gap-2 mt-4">
                <button
                    onClick={openInFiles}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
                >
                    <HardDrive className="w-3.5 h-3.5" />
                    Open in My Drive
                </button>
                <button
                    onClick={openInExplorer}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-colors"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Show in Explorer
                </button>
            </div>
        </div>
    );
}

export const ToolDrives: React.FC = () => {
    const [drives, setDrives] = useState<ToolDrive[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${FLASK}/api/tools/created-drives`);
            const data = await res.json();
            setDrives(Array.isArray(data.drives) ? data.drives : []);
        } catch (e) {
            setError('Could not reach the local backend.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Tool Created Drives</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Virtual drives automatically created by tools when processing files.
                    </p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Info card */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm">
                <FolderOpen className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                    When you run a tool with <strong>Virtual Drive</strong> output mode, it creates a dedicated
                    drive in your configured output path. All results appear here and in{' '}
                    <span className="font-medium">My Drive</span>.
                </p>
            </div>

            {loading && (
                <div className="flex justify-center py-16">
                    <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-blue-400 animate-spin" />
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {!loading && !error && drives.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                        <HardDrive className="w-8 h-8 text-slate-400" />
                    </div>
                    <div>
                        <p className="font-semibold text-slate-300">No tool drives yet</p>
                        <p className="text-sm text-slate-500 mt-1 max-w-xs">
                            Run a tool (like Image Converter) with the <strong>Virtual Drive</strong> output mode
                            to create your first tool drive.
                        </p>
                    </div>
                    <button
                        onClick={() => window.location.hash = '#/tools/image-converter'}
                        className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
                    >
                        <Wrench className="w-4 h-4" />
                        Go to Tools
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            )}

            {!loading && drives.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {drives.map((d) => (
                        <DriveCard key={d.path} drive={d} />
                    ))}
                </div>
            )}
        </div>
    );
};

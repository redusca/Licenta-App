import React, { useState, useEffect } from 'react';
import { Server, Key, CheckCircle, AlertCircle, FolderOpen, FolderCog } from 'lucide-react';

const FLASK = 'http://127.0.0.1:5000/api/agent';

interface AgentConfig {
    mode: 'server_proxy' | 'direct';
    server_url: string;
    api_key: string;
    api_key_set: boolean;
    container_url: string;
    output_path: string;
}

export const Settings: React.FC = () => {
    const [mode, setMode] = useState<'server_proxy' | 'direct'>('server_proxy');
    const [serverUrl, setServerUrl] = useState('http://localhost:8000');
    const [apiKey, setApiKey] = useState('');
    const [apiKeySet, setApiKeySet] = useState(false);
    const [containerUrl, setContainerUrl] = useState('');
    const [outputPath, setOutputPath] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch(`${FLASK}/config`)
            .then(r => r.json())
            .then((cfg: AgentConfig) => {
                setMode(cfg.mode);
                setServerUrl(cfg.server_url || 'http://localhost:8000');
                setApiKeySet(cfg.api_key_set ?? false);
                setContainerUrl(cfg.container_url || '');
                setOutputPath(cfg.output_path || '');
            })
            .catch(() => setError('Could not reach local backend.'))
            .finally(() => setLoading(false));
    }, []);

    const browseOutputPath = async () => {
        try {
            const dir = await (window as any).electronAPI?.selectDirectory?.();
            if (dir) setOutputPath(dir);
        } catch {
            // Electron API not available (dev browser mode)
        }
    };

    const save = async () => {
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            await fetch(`${FLASK}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    server_url: serverUrl,
                    api_key: apiKey,
                    container_url: containerUrl,
                    output_path: outputPath,
                }),
            });
            if (apiKey) setApiKeySet(true);
            setApiKey('');
            setSaved(true);
        } catch {
            setError('Save failed. Is the local backend running?');
        } finally {
            setSaving(false);
        }
    };

    const isConfigured = mode === 'server_proxy'
        ? serverUrl && apiKeySet
        : containerUrl && apiKeySet;

    return (
        <div className="space-y-6 max-w-2xl">
            <h1 className="text-2xl font-bold">Settings</h1>

            {/* Agent Connection card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
                    <Server className="w-4 h-4 text-slate-400" />
                    <h2 className="font-semibold text-sm">Agent Connection</h2>
                    <span className={`ml-auto flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${isConfigured
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'}`}>
                        {isConfigured
                            ? <><CheckCircle className="w-3 h-3" /> Configured</>
                            : <><AlertCircle className="w-3 h-3" /> Not configured</>}
                    </span>
                </div>

                <div className="px-6 py-5 space-y-5">
                    {error && (
                        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
                    )}

                    {/* Mode toggle */}
                    <div>
                        <label className="block text-xs text-slate-500 mb-2">Connection mode</label>
                        <div className="flex gap-2">
                            {(['server_proxy', 'direct'] as const).map(m => (
                                <button
                                    key={m}
                                    onClick={() => { setMode(m); setSaved(false); }}
                                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${mode === m
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-slate-400'}`}
                                >
                                    {m === 'server_proxy' ? '🖥  Server Proxy' : '🔌  Direct to Container'}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5">
                            {mode === 'server_proxy'
                                ? 'Requests route through your server: APP → SERVER → CONTAINER. Use the API key shown on the server\'s Containers page after deploying.'
                                : 'Connects directly to the container. Requires the container URL and its API key.'}
                        </p>
                    </div>

                    {/* Server URL (server_proxy only) */}
                    {mode === 'server_proxy' && (
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5">Server URL</label>
                            <input
                                type="text"
                                value={serverUrl}
                                onChange={e => { setServerUrl(e.target.value); setSaved(false); }}
                                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                placeholder="https://your-server.example.com"
                            />
                        </div>
                    )}

                    {/* Container URL (direct only) */}
                    {mode === 'direct' && (
                        <div>
                            <label className="block text-xs text-slate-500 mb-1.5">Container URL</label>
                            <input
                                type="text"
                                value={containerUrl}
                                onChange={e => { setContainerUrl(e.target.value); setSaved(false); }}
                                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                placeholder="http://localhost:49200"
                            />
                        </div>
                    )}

                    {/* API Key */}
                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 flex items-center gap-1.5">
                            <Key className="w-3 h-3" />
                            API Key
                            {apiKeySet && <span className="text-green-400">(saved)</span>}
                        </label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={e => { setApiKey(e.target.value); setSaved(false); }}
                            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            placeholder={apiKeySet ? '••••••••  (leave blank to keep existing)' : 'Paste the API key from the server\'s Containers page'}
                        />
                        <p className="text-xs text-slate-500 mt-1">
                            {mode === 'server_proxy'
                                ? 'The API key is generated when you deploy a container on the server. Open the server web UI → Containers → copy the key.'
                                : 'The API key shown after starting the container locally (in the terminal or .env file).'}
                        </p>
                    </div>

                    {/* Save */}
                    <div className="flex items-center gap-3 pt-1">
                        <button
                            onClick={save}
                            disabled={saving || loading}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                        {saved && <span className="text-xs text-green-400">Saved!</span>}
                    </div>
                </div>
            </div>

            {/* Tool Output Settings card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
                    <FolderCog className="w-4 h-4 text-slate-400" />
                    <h2 className="font-semibold text-sm">Tool Output Settings</h2>
                </div>

                <div className="px-6 py-5 space-y-4">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1.5 flex items-center gap-1.5">
                            <FolderOpen className="w-3 h-3" />
                            Output Path
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={outputPath}
                                onChange={e => { setOutputPath(e.target.value); setSaved(false); }}
                                className="flex-1 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono"
                                placeholder="C:\Users\You\Documents"
                            />
                            <button
                                onClick={browseOutputPath}
                                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-colors text-sm"
                                title="Browse for folder"
                            >
                                <FolderOpen className="w-4 h-4" />
                            </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5">
                            When a tool runs in <strong>Virtual Drive</strong> mode, it creates a drive folder
                            (e.g. <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 rounded">ImageConversionResults</code>)
                            inside this path. Leave blank to disable virtual drive output.
                        </p>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                        <button
                            onClick={save}
                            disabled={saving || loading}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                        {saved && <span className="text-xs text-green-400">Saved!</span>}
                    </div>
                </div>
            </div>
        </div>
    );
};

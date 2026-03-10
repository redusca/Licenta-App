import React, { useState, useEffect, useCallback } from 'react';
import { Cloud, Shield, Zap, Settings, CheckCircle, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

const FLASK = 'http://127.0.0.1:5000/api/agent';
const PROMPT = 'Give me a fun fact and say hello!';

// ── Types ──────────────────────────────────────────────────────────────────

interface AgentConfig {
    mode: 'server_proxy' | 'direct';
    server_url: string;
    api_key_set: boolean;
    container_url: string;
}

// ── Connection Status Card ─────────────────────────────────────────────────

function ConfigStatus({ onReady }: { onReady: (ok: boolean) => void }) {
    const [cfg, setCfg] = useState<AgentConfig | null>(null);

    useEffect(() => {
        fetch(`${FLASK}/config`)
            .then(r => r.json())
            .then((c: AgentConfig) => {
                setCfg(c);
                const ok = c.api_key_set && (
                    c.mode === 'server_proxy' ? !!c.server_url : !!c.container_url
                );
                onReady(ok);
            })
            .catch(() => onReady(false));
    }, [onReady]);

    const configured = cfg?.api_key_set && (
        cfg.mode === 'server_proxy' ? !!cfg.server_url : !!cfg.container_url
    );

    return (
        <div className={`flex items-center justify-between px-5 py-3.5 rounded-xl border mb-6 ${configured
            ? 'bg-green-500/10 border-green-500/20'
            : 'bg-yellow-500/10 border-yellow-500/20'}`}>
            <div className="flex items-center gap-2.5 text-sm">
                {configured
                    ? <CheckCircle className="w-4 h-4 text-green-400" />
                    : <AlertCircle className="w-4 h-4 text-yellow-400" />}
                <span className={configured ? 'text-green-300' : 'text-yellow-300'}>
                    {configured
                        ? `Agent connected via ${cfg!.mode === 'server_proxy' ? 'server proxy' : 'direct'} — ${cfg!.mode === 'server_proxy' ? cfg!.server_url : cfg!.container_url}`
                        : 'Agent not configured. Set server URL and API key in Settings.'}
                </span>
            </div>
            <Link
                to="/settings"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
            >
                <Settings className="w-3 h-3" />
                Settings
            </Link>
        </div>
    );
}

// ── Agent Hello Tool ───────────────────────────────────────────────────────

function AgentHelloTool({ configKey }: { configKey: number }) {
    const [response, setResponse] = useState<string | null>(null);
    const [toolCalls, setToolCalls] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Reset when config changes
    useEffect(() => { setResponse(null); setError(null); setToolCalls([]); }, [configKey]);

    const send = async () => {
        setLoading(true);
        setResponse(null);
        setError(null);
        setToolCalls([]);
        try {
            const res = await fetch(`${FLASK}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: PROMPT }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            setResponse(data.response);
            setToolCalls(data.tool_calls ?? []);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Request failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center border border-green-500/20">
                    <Zap className="w-5 h-5 text-green-400" />
                </div>
                <div>
                    <h3 className="font-bold text-base">Hello Agent</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Sends a prompt to the container agent</p>
                </div>
            </div>

            <div className="mb-4 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 font-mono">
                "{PROMPT}"
            </div>

            <button onClick={send} disabled={loading}
                className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors mb-4">
                {loading ? 'Waiting for agent…' : 'Send to Agent'}
            </button>

            {response && (
                <div className="text-sm bg-green-500/10 border border-green-500/20 text-green-300 rounded-lg px-4 py-3 leading-relaxed whitespace-pre-wrap">
                    {response}
                </div>
            )}
            {toolCalls.length > 0 && (
                <div className="mt-3 space-y-1">
                    <p className="text-xs text-slate-500 mb-1">Tool calls:</p>
                    {toolCalls.map((tc: any, i: number) => (
                        <div key={i} className="text-xs font-mono bg-slate-100 dark:bg-slate-800 rounded px-3 py-1.5 text-slate-400">
                            <span className="text-blue-400">{tc.tool_name}</span> → {tc.output}
                        </div>
                    ))}
                </div>
            )}
            {error && (
                <div className="text-sm bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-4 py-3">
                    {error}
                </div>
            )}
        </div>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export const Tools: React.FC = () => {
    const [configKey, setConfigKey] = useState(0);
    const handleReady = useCallback(() => setConfigKey(k => k + 1), []);

    return (
        <div className="space-y-10">
            {/* Hero */}
            <div className="relative rounded-2xl overflow-hidden bg-slate-900 text-white p-10 min-h-[180px] flex items-center">
                <div className="absolute inset-0 opacity-20">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
                </div>
                <div className="relative z-10 max-w-2xl">
                    <h1 className="text-3xl font-bold mb-3">Utility Tools</h1>
                    <p className="text-slate-300 text-lg leading-relaxed">
                        Tools that talk directly to your deployed agent container.
                    </p>
                </div>
            </div>

            {/* Connection status + tools */}
            <section>
                <ConfigStatus onReady={handleReady} />

                <h2 className="text-xl font-bold mb-4">Available Tools</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <AgentHelloTool configKey={configKey} />
                </div>
            </section>

            {/* Quick Extensions */}
            <section>
                <h2 className="text-xl font-bold mb-6">Quick Extensions</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-slate-800 dark:bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between text-white">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                                <Cloud className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h4 className="font-bold">Cloud Sync</h4>
                                <p className="text-xs text-slate-400">Last synced 2m ago</p>
                            </div>
                        </div>
                        <button className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors">Configure</button>
                    </div>
                    <div className="bg-slate-800 dark:bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between text-white">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-900/50 flex items-center justify-center border border-blue-500/30">
                                <Shield className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <h4 className="font-bold">File Encryption</h4>
                                <p className="text-xs text-slate-400">Vault is locked</p>
                            </div>
                        </div>
                        <button className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors">Open Vault</button>
                    </div>
                </div>
            </section>
        </div>
    );
};

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, Zap, CheckCircle, AlertCircle, Settings,
    Image, Music, Video, FileText, Archive, Box, Database,
    Code, Sparkles, Mic, Film, BrainCircuit, Table, ScanSearch,
    AudioWaveform, Clapperboard, Tag, Cpu, FolderOpen, ChevronRight,
    ExternalLink, PenTool, ImageOff
} from 'lucide-react';
import type { ToolDefinition } from '../data/tools';
import { useToolsCatalog } from '../hooks/useToolsCatalog';

// ── Icon resolver ───────────────────────────────────────────────────────────

const ICON_MAP: Record<string, any> = {
    Image, Music, Video, FileText, Archive, Box, Database, Code,
    Zap, Sparkles, Mic, Film, BrainCircuit, Table, ScanSearch,
    AudioWaveform, Clapperboard, Tag, Cpu, PenTool, ImageOff,
};

function ToolIcon({ name, className }: { name: string; className?: string }) {
    const Icon = ICON_MAP[name] ?? Zap;
    return <Icon className={className} />;
}

// ── Color maps  (explicit classes so Tailwind includes them) ────────────────

const COLOR_BG: Record<string, string> = {
    blue: 'bg-blue-500/10 border-blue-500/20',
    purple: 'bg-purple-500/10 border-purple-500/20',
    rose: 'bg-rose-500/10 border-rose-500/20',
    amber: 'bg-amber-500/10 border-amber-500/20',
    cyan: 'bg-cyan-500/10 border-cyan-500/20',
    indigo: 'bg-indigo-500/10 border-indigo-500/20',
    green: 'bg-green-500/10 border-green-500/20',
    emerald: 'bg-emerald-500/10 border-emerald-500/20',
    violet: 'bg-violet-500/10 border-violet-500/20',
};
const COLOR_TEXT: Record<string, string> = {
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    rose: 'text-rose-400',
    amber: 'text-amber-400',
    cyan: 'text-cyan-400',
    indigo: 'text-indigo-400',
    green: 'text-green-400',
    emerald: 'text-emerald-400',
    violet: 'text-violet-400',
};
const COLOR_BADGE: Record<string, string> = {
    blue: 'bg-blue-500/15 text-blue-300 border border-blue-500/25',
    purple: 'bg-purple-500/15 text-purple-300 border border-purple-500/25',
    rose: 'bg-rose-500/15 text-rose-300 border border-rose-500/25',
    amber: 'bg-amber-500/15 text-amber-300 border border-amber-500/25',
    cyan: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25',
    indigo: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/25',
    green: 'bg-green-500/15 text-green-300 border border-green-500/25',
    emerald: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25',
    violet: 'bg-violet-500/15 text-violet-300 border border-violet-500/25',
};

// ── Flask / config for hello agent ─────────────────────────────────────────

const FLASK = 'http://127.0.0.1:5000/api/agent';
const HELLO_PROMPT = 'Give me a fun fact and say hello!';

interface AgentConfig {
    mode: 'server_proxy' | 'direct';
    server_url: string;
    api_key_set: boolean;
    container_url: string;
}

function ConfigStatus({ onReady }: { onReady: (ok: boolean) => void }) {
    const [cfg, setCfg] = useState<AgentConfig | null>(null);

    useEffect(() => {
        fetch(`${FLASK}/config`)
            .then(r => r.json())
            .then((c: AgentConfig) => {
                setCfg(c);
                const ok = c.api_key_set && (c.mode === 'server_proxy' ? !!c.server_url : !!c.container_url);
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

// ── Hello Agent live runner (functional) ────────────────────────────────────

function HelloAgentRunner() {
    const [response, setResponse] = useState<string | null>(null);
    const [toolCalls, setToolCalls] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [configKey, setConfigKey] = useState(0);
    const handleReady = useCallback(() => setConfigKey(k => k + 1), []);

    useEffect(() => { setResponse(null); setError(null); setToolCalls([]); }, [configKey]);

    const send = async () => {
        setLoading(true); setResponse(null); setError(null); setToolCalls([]);
        try {
            const res = await fetch(`${FLASK}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: HELLO_PROMPT }),
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
        <div className="space-y-4">
            <ConfigStatus onReady={handleReady} />
            <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 font-mono">
                "{HELLO_PROMPT}"
            </div>
            <button onClick={send} disabled={loading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
                {loading ? 'Waiting for agent…' : 'Send to Agent'}
            </button>
            {response && (
                <div className="text-sm bg-green-500/10 border border-green-500/20 text-green-300 rounded-lg px-4 py-3 leading-relaxed whitespace-pre-wrap">
                    {response}
                </div>
            )}
            {toolCalls.length > 0 && (
                <div className="space-y-1">
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

// ── Mocked runner for non-implemented tools ─────────────────────────────────

function MockedRunner({ tool }: { tool: ToolDefinition }) {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                This tool is not yet implemented. The interface below shows the expected inputs.
            </div>

            {tool.fields.length === 0 && (
                <p className="text-sm text-slate-500 italic">No input fields defined for this tool.</p>
            )}

            <div className="space-y-3">
                {tool.fields.map(field => (
                    <div key={field.key} className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-300">
                            {field.label}
                            {field.required && <span className="text-red-400 text-xs">*</span>}
                        </label>
                        <p className="text-xs text-slate-500">{field.description}</p>
                        {field.type === 'file' || field.type === 'multifile' ? (
                            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-slate-600 bg-slate-800/50 text-slate-500 text-sm cursor-not-allowed">
                                <FolderOpen className="w-4 h-4" />
                                <span>{field.type === 'multifile' ? 'Select files…' : 'Select file…'}</span>
                                {field.acceptedExtensions && (
                                    <span className="text-xs ml-auto text-slate-600">{field.acceptedExtensions.join(', ')}</span>
                                )}
                            </div>
                        ) : field.type === 'select' ? (
                            <div className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-500 text-sm flex items-center justify-between cursor-not-allowed">
                                <span>{String(field.default ?? field.options?.[0] ?? '')}</span>
                                <ChevronRight className="w-3 h-3 rotate-90" />
                            </div>
                        ) : field.type === 'boolean' ? (
                            <div className="flex items-center gap-2">
                                <div className={`w-10 h-6 rounded-full border ${field.default ? 'bg-slate-600 border-slate-500' : 'bg-slate-800 border-slate-700'} cursor-not-allowed relative`}>
                                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-slate-400 transition-all ${field.default ? 'left-4' : 'left-0.5'}`} />
                                </div>
                                <span className="text-xs text-slate-500">{field.default ? 'Enabled' : 'Disabled'} (default)</span>
                            </div>
                        ) : (
                            <div className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-600 text-sm font-mono cursor-not-allowed">
                                {field.default !== undefined ? String(field.default) : <span className="italic">empty</span>}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <button disabled
                className="w-full py-2.5 bg-slate-700 text-slate-500 text-sm font-semibold rounded-lg cursor-not-allowed mt-2">
                Run Tool — Coming Soon
            </button>
        </div>
    );
}

// ── Tool runner URL map ──────────────────────────────────────────────────────
// Maps tool ID → route path for the full tool runner page.
const TOOL_RUNNER_ROUTES: Record<string, string> = {
    'image-converter': '/tools/image-converter/run',
    'remove-background': '/tools/remove-background/run',
    'image-to-svg': '/tools/image-to-svg/run',
    'video-converter': '/tools/video-converter/run',
    'video-compressor': '/tools/video-compressor/run',
    'audio-converter': '/tools/audio-converter/run',
    '3d-visualizer': '/tools/3d-visualizer/run',
    'drive-creator': '/tools/drive-creator/run',
    'space-analyzer': '/tools/space-analyzer/run',
    'pdf-merger': '/tools/pdf-merger/run',
    'model-converter': '/tools/model-converter/run',
    'document-converter': '/tools/document-converter/run',
};

// ── Main ToolDetail page ────────────────────────────────────────────────────

export const ToolDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { tools, categories, loading } = useToolsCatalog();
    const tool = tools.find(t => t.id === id);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                    <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-blue-400 animate-spin" />
                    <p className="text-sm">Loading tool…</p>
                </div>
            </div>
        );
    }

    if (!tool) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <p className="text-slate-400 text-lg">Tool not found.</p>
                <button onClick={() => navigate('/tools')}
                    className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back to Tools
                </button>
            </div>
        );
    }

    const bg = COLOR_BG[tool.accentColor] ?? COLOR_BG.blue;
    const text = COLOR_TEXT[tool.accentColor] ?? COLOR_TEXT.blue;
    const badge = COLOR_BADGE[tool.accentColor] ?? COLOR_BADGE.blue;

    return (
        <div className="space-y-8">

            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-sm text-slate-500">
                <Link to="/tools" className="hover:text-slate-300 transition-colors">Tools</Link>
                <ChevronRight className="w-3.5 h-3.5" />
                {tool.categories.slice(0, 1).map(catKey => {
                    const cat = categories.find(c => c.key === catKey)!
                    return (
                        <Link key={catKey} to={`/tools?category=${catKey}`}
                            className="hover:text-slate-300 transition-colors capitalize">
                            {cat.label}
                        </Link>
                    );
                })}
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-300">{tool.name}</span>
            </nav>

            {/* Header card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-sm">
                <div className="flex items-start gap-5">
                    <div className={`w-16 h-16 rounded-xl ${bg} flex items-center justify-center border shrink-0`}>
                        <ToolIcon name={tool.icon} className={`w-8 h-8 ${text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div>
                                <h1 className="text-2xl font-bold">{tool.name}</h1>
                                <p className="text-slate-500 dark:text-slate-400 mt-1">{tool.description}</p>
                            </div>
                            <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 font-mono shrink-0">
                                v{tool.version}
                            </span>
                        </div>

                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                            {/* AI badge */}
                            {tool.usesAI ? (
                                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 font-medium">
                                    <Cpu className="w-3 h-3" /> AI-Powered
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-slate-500/15 text-slate-400 border border-slate-500/25 font-medium">
                                    Local Processing
                                </span>
                            )}

                            {/* Category badges */}
                            {tool.categories.map(catKey => {
                                const cat = categories.find(c => c.key === catKey)!;
                                const catColor = categories.find(c => c.key === catKey)?.color ?? 'blue';
                                const catBadge = COLOR_BADGE[catColor] ?? COLOR_BADGE.blue;
                                return (
                                    <span key={catKey} className={`text-xs px-2.5 py-1 rounded-full font-medium ${catBadge}`}>
                                        {cat.label}
                                    </span>
                                );
                            })}

                            {/* Author */}
                            <span className="text-xs text-slate-500 ml-auto">by {tool.author}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

                {/* Left column — description + fields */}
                <div className="lg:col-span-3 space-y-6">

                    {/* About */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                        <h2 className="font-semibold text-base mb-3">About</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            {tool.longDescription}
                        </p>
                    </div>

                    {/* Supported File Extensions */}
                    {tool.fileExtensions.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                            <h2 className="font-semibold text-base mb-3">Supported File Types</h2>
                            <div className="flex flex-wrap gap-2">
                                {tool.fileExtensions.map(ext => (
                                    <span key={ext}
                                        className="text-xs font-mono px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                                        {ext}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Fields reference */}
                    {tool.fields.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                            <h2 className="font-semibold text-base mb-4">Input Fields</h2>
                            <div className="space-y-4">
                                {tool.fields.map(field => (
                                    <div key={field.key} className="flex gap-3">
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0 mt-2" />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium">{field.label}</span>
                                                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                                                    {field.type}
                                                </span>
                                                {field.required && (
                                                    <span className="text-xs text-red-400 font-medium">required</span>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{field.description}</p>
                                            {field.options && (
                                                <p className="text-xs text-slate-600 dark:text-slate-500 mt-1">
                                                    Options: {field.options.map(o => (
                                                        <code key={o} className="mx-0.5 px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{o}</code>
                                                    ))}
                                                </p>
                                            )}
                                            {field.acceptedExtensions && (
                                                <p className="text-xs text-slate-600 dark:text-slate-500 mt-1">
                                                    Accepts: {field.acceptedExtensions.join(', ')}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tags */}
                    {tool.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 pb-2">
                            <Tag className="w-3.5 h-3.5 text-slate-500 mt-0.5" />
                            {tool.tags.map(tag => (
                                <span key={tag}
                                    className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right column — usage steps + runner */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Usage steps */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                        <h2 className="font-semibold text-base mb-4">How to Use</h2>
                        <ol className="space-y-3">
                            {tool.usageSteps.map((step, i) => (
                                <li key={i} className="flex gap-3 text-sm text-slate-600 dark:text-slate-400">
                                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${badge}`}>
                                        {i + 1}
                                    </span>
                                    <span className="leading-relaxed">{step}</span>
                                </li>
                            ))}
                        </ol>
                    </div>

                    {/* Runner panel */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                        <h2 className="font-semibold text-base mb-4">Run Tool</h2>

                        {/* Tools with a dedicated runner page get Open Tool button */}
                        {TOOL_RUNNER_ROUTES[tool.id] ? (
                            <div className="space-y-3">
                                <p className="text-sm text-slate-500">
                                    Open the full tool interface to select files, configure options, and run the conversion.
                                </p>
                                <Link to={TOOL_RUNNER_ROUTES[tool.id]}
                                    className={`flex items-center justify-center gap-2 w-full py-3 font-semibold rounded-lg transition-colors text-sm text-white ${
                                        tool.accentColor === 'violet' ? 'bg-violet-600 hover:bg-violet-500'
                                        : tool.accentColor === 'rose' ? 'bg-rose-600 hover:bg-rose-500'
                                        : tool.accentColor === 'amber' ? 'bg-amber-600 hover:bg-amber-500'
                                        : tool.accentColor === 'green' ? 'bg-green-600 hover:bg-green-500'
                                        : tool.accentColor === 'emerald' ? 'bg-emerald-600 hover:bg-emerald-500'
                                        : tool.accentColor === 'purple' ? 'bg-purple-600 hover:bg-purple-500'
                                        : tool.accentColor === 'cyan' ? 'bg-cyan-600 hover:bg-cyan-500'
                                        : tool.accentColor === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-500'
                                        : 'bg-blue-600 hover:bg-blue-500'
                                    }`}>
                                    <ExternalLink className="w-4 h-4" />
                                    Open Tool
                                </Link>
                            </div>
                        ) : tool.id === 'hello-agent' ? (
                            <HelloAgentRunner />
                        ) : (
                            <MockedRunner tool={tool} />
                        )}
                    </div>
                </div>
            </div>

            {/* Back button */}
            <button onClick={() => navigate('/tools')}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors pb-4">
                <ArrowLeft className="w-4 h-4" /> Back to all tools
            </button>
        </div>
    );
};

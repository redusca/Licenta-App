import React, { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Zap, Cpu, X,
    Image, Music, Video, FileText, Archive, Box, Database,
    Code, Sparkles, Mic, Film, BrainCircuit, Table, ScanSearch,
    AudioWaveform, Clapperboard, LayoutGrid, List, ChevronRight,
    Search, AlertCircle, RefreshCw, ExternalLink, PenTool, ImageOff,
} from 'lucide-react';
import type { CategoryKey, CategoryMeta, ToolDefinition } from '../data/tools';
import { useToolsCatalog } from '../hooks/useToolsCatalog';

// ── Icon resolver ───────────────────────────────────────────────────────────

const ICON_MAP: Record<string, any> = {
    Image, Music, Video, FileText, Archive, Box, Database, Code,
    Zap, Sparkles, Mic, Film, BrainCircuit, Table, ScanSearch,
    AudioWaveform, Clapperboard, PenTool, ImageOff,
};

function ToolIcon({ name, className }: { name: string; className?: string }) {
    const Icon = ICON_MAP[name] ?? Zap;
    return <Icon className={className} />;
}

// ── Colour maps ─────────────────────────────────────────────────────────────

const COLOR_ICON: Record<string, string> = {
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    rose: 'bg-rose-500/10 border-rose-500/20 text-rose-400',
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
    cyan: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
    indigo: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400',
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    violet: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
};

const COLOR_SECTION: Record<string, string> = {
    blue: 'border-l-blue-500',
    purple: 'border-l-purple-500',
    rose: 'border-l-rose-500',
    amber: 'border-l-amber-500',
    cyan: 'border-l-cyan-500',
    indigo: 'border-l-indigo-500',
    green: 'border-l-green-500',
    emerald: 'border-l-emerald-500',
    violet: 'border-l-violet-500',
};

const COLOR_CAT_ICON: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-500/10',
    purple: 'text-purple-400 bg-purple-500/10',
    rose: 'text-rose-400 bg-rose-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    cyan: 'text-cyan-400 bg-cyan-500/10',
    indigo: 'text-indigo-400 bg-indigo-500/10',
    green: 'text-green-400 bg-green-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
    violet: 'text-violet-400 bg-violet-500/10',
};

const COLOR_FILTER_ACTIVE: Record<string, string> = {
    blue: 'bg-blue-600 text-white border-blue-600',
    purple: 'bg-purple-600 text-white border-purple-600',
    rose: 'bg-rose-600 text-white border-rose-600',
    amber: 'bg-amber-600 text-white border-amber-600',
    cyan: 'bg-cyan-600 text-white border-cyan-600',
    indigo: 'bg-indigo-600 text-white border-indigo-600',
    green: 'bg-green-600 text-white border-green-600',
    emerald: 'bg-emerald-600 text-white border-emerald-600',
    violet: 'bg-violet-600 text-white border-violet-600',
};

// ── Skeleton loader ─────────────────────────────────────────────────────────

function SkeletonCard() {
    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col gap-4 animate-pulse">
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-200 dark:bg-slate-800 shrink-0" />
                <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded w-2/3" />
                    <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-full" />
                    <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-4/5" />
                </div>
            </div>
            <div className="flex gap-1.5">
                <div className="h-5 w-10 bg-slate-200 dark:bg-slate-800 rounded-full" />
                <div className="h-5 w-14 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-5 w-14 bg-slate-200 dark:bg-slate-800 rounded" />
            </div>
            <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-lg mt-auto" />
        </div>
    );
}

const TOOL_RUNNER_ROUTES: Record<string, string> = {
    'image-converter': '/tools/image-converter/run',
    'remove-background': '/tools/remove-background/run',
    'image-to-svg': '/tools/image-to-svg/run',
    'video-converter': '/tools/video-converter/run',
    'audio-converter': '/tools/audio-converter/run',
    '3d-visualizer': '/tools/3d-visualizer/run',
    'drive-creator': '/tools/drive-creator/run',
    'space-analyzer': '/tools/space-analyzer/run',
};

// Maps tool accent color → Open button tailwind classes
const COLOR_OPEN_BTN: Record<string, string> = {
    blue: 'bg-blue-600 hover:bg-blue-500',
    violet: 'bg-violet-600 hover:bg-violet-500',
    rose: 'bg-rose-600 hover:bg-rose-500',
    amber: 'bg-amber-600 hover:bg-amber-500',
    cyan: 'bg-cyan-600 hover:bg-cyan-500',
    indigo: 'bg-indigo-600 hover:bg-indigo-500',
    green: 'bg-green-600 hover:bg-green-500',
    emerald: 'bg-emerald-600 hover:bg-emerald-500',
    purple: 'bg-purple-600 hover:bg-purple-500',
};

// ── Tool Card ───────────────────────────────────────────────────────────────

function ToolCard({ tool }: { tool: ToolDefinition }) {
    const iconCls = COLOR_ICON[tool.accentColor] ?? COLOR_ICON.blue;

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col gap-4">

            {/* Header */}
            <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center border shrink-0 ${iconCls}`}>
                    <ToolIcon name={tool.icon} className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm leading-snug">{tool.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                        {tool.description}
                    </p>
                </div>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5">
                {tool.usesAI && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 font-medium">
                        <Cpu className="w-2.5 h-2.5" /> AI
                    </span>
                )}
                {tool.fileExtensions.slice(0, 3).map(ext => (
                    <span key={ext}
                        className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                        {ext}
                    </span>
                ))}
                {tool.fileExtensions.length > 3 && (
                    <span className="text-xs text-slate-500">+{tool.fileExtensions.length - 3}</span>
                )}
            </div>

            {/* Footer */}
            <div className="mt-auto flex gap-2">
                <Link to={`/tools/${tool.id}`}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                    Details
                    <ChevronRight className="w-3.5 h-3.5" />
                </Link>
                {TOOL_RUNNER_ROUTES[tool.id] && (
                    <Link to={TOOL_RUNNER_ROUTES[tool.id]}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-white text-sm font-semibold transition-colors ${
                            COLOR_OPEN_BTN[tool.accentColor] ?? COLOR_OPEN_BTN.blue
                        }`}>
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open
                    </Link>
                )}
            </div>
        </div>
    );
}

// ── Category Section ────────────────────────────────────────────────────────

function CategorySection({
    meta,
    tools,
}: {
    meta: CategoryMeta;
    tools: ToolDefinition[];
}) {
    const borderCls = COLOR_SECTION[meta.color] ?? 'border-l-slate-500';
    const catIconCls = COLOR_CAT_ICON[meta.color] ?? 'text-slate-400 bg-slate-500/10';
    const CatIcon = ICON_MAP[meta.icon] ?? Zap;

    if (tools.length === 0) return null;

    return (
        <section className="space-y-4">
            <div className={`flex items-center gap-3 pl-4 border-l-4 ${borderCls}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${catIconCls}`}>
                    <CatIcon className="w-4 h-4" />
                </div>
                <div>
                    <h2 className="font-bold text-base">{meta.label}</h2>
                    <p className="text-xs text-slate-500">{meta.description}</p>
                </div>
                <span className="ml-auto text-xs text-slate-500 tabular-nums">
                    {tools.length} {tools.length === 1 ? 'tool' : 'tools'}
                </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {tools.map(t => <ToolCard key={t.id} tool={t} />)}
            </div>
        </section>
    );
}

// ── Main Page ───────────────────────────────────────────────────────────────

type ViewMode = 'categories' | 'list';

export const Tools: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { tools, categories, loading, error, reload } = useToolsCatalog();

    const urlCategory = searchParams.get('category') as CategoryKey | null;

    const [showHero, setShowHero] = useState<boolean>(() => {
        const v = localStorage.getItem('tools_showHero');
        return v === null ? true : v === 'true';
    });
    const [viewMode, setViewMode] = useState<ViewMode>(() =>
        localStorage.getItem('tools_viewMode') === 'list' ? 'list' : 'categories'
    );
    const [selectedCategory, setSelectedCategory] = useState<CategoryKey | 'all'>(
        () => urlCategory ?? (localStorage.getItem('tools_category') as CategoryKey | 'all') ?? 'all'
    );
    const [aiOnly, setAiOnly] = useState<boolean>(() =>
        localStorage.getItem('tools_aiOnly') === 'true'
    );
    const [query, setQuery] = useState('');

    // Persist filter state
    useEffect(() => { localStorage.setItem('tools_showHero', String(showHero)); }, [showHero]);
    useEffect(() => { localStorage.setItem('tools_viewMode', viewMode); }, [viewMode]);
    useEffect(() => { localStorage.setItem('tools_category', selectedCategory); }, [selectedCategory]);
    useEffect(() => { localStorage.setItem('tools_aiOnly', String(aiOnly)); }, [aiOnly]);

    // URL ?category= param overrides stored category (comes from detail page breadcrumb)
    useEffect(() => {
        if (urlCategory) {
            setSelectedCategory(urlCategory);
            setSearchParams(prev => { prev.delete('category'); return prev; }, { replace: true });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const filteredTools = useMemo(() => {
        return tools.filter(t => {
            const matchCat = selectedCategory === 'all' || t.categories.includes(selectedCategory as CategoryKey);
            const matchAI = !aiOnly || t.usesAI;
            const q = query.trim().toLowerCase();
            const matchQ = !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some(tag => tag.toLowerCase().includes(q));
            return matchCat && matchAI && matchQ;
        });
    }, [tools, selectedCategory, aiOnly, query]);

    const visibleCategories = useMemo(() => {
        return categories.filter(cat =>
            filteredTools.some(t => t.categories.includes(cat.key))
        );
    }, [categories, filteredTools]);

    return (
        <div className="space-y-8">

            {/* ── Hero ── */}
            {showHero && (
                <div className="relative rounded-2xl overflow-hidden bg-slate-900 text-white p-10 min-h-[160px] flex items-center">
                    <div className="absolute inset-0 opacity-20">
                        <div className="absolute top-0 right-0 w-72 h-72 bg-blue-500 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
                        <div className="absolute bottom-0 left-0 w-72 h-72 bg-violet-500 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3" />
                    </div>
                    <div className="relative z-10 max-w-2xl">
                        <h1 className="text-3xl font-bold mb-2">Utility Tools</h1>
                        <p className="text-slate-300 leading-relaxed">
                            Browse and run tools organised by file type. AI-powered tools connect to your agent container; local tools run on-device.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowHero(false)}
                        className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        aria-label="Dismiss"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* ── Error banner ── */}
            {error && (
                <div className="flex items-center justify-between px-5 py-3.5 rounded-xl border bg-red-500/10 border-red-500/20">
                    <div className="flex items-center gap-2.5 text-sm text-red-300">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        Could not load tool catalog from backend: {error}
                    </div>
                    <button onClick={reload}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:border-red-400 transition-colors">
                        <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                </div>
            )}

            {/* ── Toolbar ── */}
            <div className="flex flex-col gap-4">

                {/* Top row: search + view toggle */}
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search tools…"
                            className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-colors"
                        />
                    </div>

                    <button
                        onClick={() => setAiOnly(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                            aiOnly
                                ? 'bg-violet-600 border-violet-600 text-white'
                                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                        }`}
                    >
                        <Cpu className="w-3.5 h-3.5" />
                        AI Only
                    </button>

                    <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden ml-auto">
                        <button
                            onClick={() => setViewMode('categories')}
                            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                                viewMode === 'categories'
                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            <LayoutGrid className="w-4 h-4" />
                            Categories
                        </button>
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                        <button
                            onClick={() => setViewMode('list')}
                            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                                viewMode === 'list'
                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            <List className="w-4 h-4" />
                            All Tools
                        </button>
                    </div>
                </div>

                {/* Category filter pills */}
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setSelectedCategory('all')}
                        className={`px-3.5 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                            selectedCategory === 'all'
                                ? 'bg-slate-800 text-white border-slate-700'
                                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                        }`}
                    >
                        All
                    </button>
                    {categories.map(cat => {
                        const CatIcon = ICON_MAP[cat.icon] ?? Zap;
                        const isActive = selectedCategory === cat.key;
                        const activeCls = COLOR_FILTER_ACTIVE[cat.color] ?? 'bg-blue-600 text-white border-blue-600';
                        return (
                            <button
                                key={cat.key}
                                onClick={() => setSelectedCategory(cat.key)}
                                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                                    isActive
                                        ? activeCls
                                        : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                                }`}
                            >
                                <CatIcon className="w-3.5 h-3.5" />
                                {cat.label}
                            </button>
                        );
                    })}
                </div>

                {/* Result count */}
                {!loading && (
                    <p className="text-xs text-slate-500">
                        {filteredTools.length} {filteredTools.length === 1 ? 'tool' : 'tools'} found
                        {selectedCategory !== 'all' && ` in ${categories.find(c => c.key === selectedCategory)?.label}`}
                        {aiOnly && ' • AI only'}
                        {query && ` • matching "${query}"`}
                    </p>
                )}
            </div>

            {/* ── Content ── */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
            ) : filteredTools.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                    <Search className="w-10 h-10 opacity-30" />
                    <p className="text-base">No tools match your filters.</p>
                    <button
                        onClick={() => { setSelectedCategory('all'); setAiOnly(false); setQuery(''); }}
                        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                        Clear all filters
                    </button>
                </div>
            ) : viewMode === 'categories' ? (
                <div className="space-y-10">
                    {visibleCategories.map(cat => (
                        <CategorySection
                            key={cat.key}
                            meta={cat}
                            tools={filteredTools.filter(t => t.categories.includes(cat.key))}
                        />
                    ))}
                </div>
            ) : (
                <div className="space-y-4">
                    <h2 className="font-bold text-lg">All Tools</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredTools.map(tool => <ToolCard key={tool.id} tool={tool} />)}
                    </div>
                </div>
            )}
        </div>
    );
};

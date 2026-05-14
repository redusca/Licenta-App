import React, { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Cpu, X, Search, RefreshCw, AlertCircle,
    Zap, Image, Music, Video, FileText, Archive, Box, Code,
    Sparkles, Mic, Film, BrainCircuit, Table, ScanSearch,
    AudioWaveform, Clapperboard, PenTool, ImageOff, ChevronRight,
    LayoutGrid, List,
} from 'lucide-react';
import type { CategoryKey, CategoryMeta, ToolDefinition } from '../data/tools';
import { useToolsCatalog } from '../hooks/useToolsCatalog';

// ── Icon resolver ─────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ElementType> = {
    Image, Music, Video, FileText, Archive, Box, Code,
    Zap, Sparkles, Mic, Film, BrainCircuit, Table, ScanSearch,
    AudioWaveform, Clapperboard, PenTool, ImageOff,
};

function ToolIcon({ name, size = 20 }: { name: string; size?: number }) {
    const Icon = ICON_MAP[name] ?? Zap;
    return <Icon style={{ width: size, height: size }} />;
}

// ── Colour mapping: tailwind names → design tokens ────────────────────────────
const COLOR_TO_TOKEN: Record<string, string> = {
    blue:    'sky',
    cyan:    'sky',
    indigo:  'sky',
    sky:     'sky',
    purple:  'plum',
    violet:  'plum',
    rose:    'ochre',
    red:     'clay',
    pink:    'clay',
    amber:   'ochre',
    yellow:  'ochre',
    green:   'sage',
    emerald: 'sage',
    teal:    'sage',
    lime:    'sage',
    slate:   'sky',
    gray:    'sky',
    zinc:    'sky',
    stone:   'sage',
    neutral: 'sage',
};
function token(color: string): string {
    return COLOR_TO_TOKEN[color] ?? 'sky';
}

// ── Tool runner routes ────────────────────────────────────────────────────────
const TOOL_RUNNER_ROUTES: Record<string, string> = {
    'image-converter':    '/tools/image-converter/run',
    'remove-background':  '/tools/remove-background/run',
    'image-to-svg':       '/tools/image-to-svg/run',
    'video-converter':    '/tools/video-converter/run',
    'video-compressor':   '/tools/video-compressor/run',
    'audio-converter':    '/tools/audio-converter/run',
    '3d-visualizer':      '/tools/3d-visualizer/run',
    'drive-creator':      '/tools/drive-creator/run',
    'space-analyzer':     '/tools/space-analyzer/run',
    'pdf-merger':         '/tools/pdf-merger/run',
    'model-converter':    '/tools/model-converter/run',
    'document-converter': '/tools/document-converter/run',
};

// ── Skeleton ──────────────────────────────────────────────────────────────────
function SkeletonCard() {
    return (
        <div style={{
            padding: 16, borderRadius: 'var(--r-card)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-2)', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ height: 12, background: 'var(--surface-2)', borderRadius: 4, width: '55%' }} />
                    <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 4, width: '90%' }} />
                    <div style={{ height: 10, background: 'var(--surface-2)', borderRadius: 4, width: '70%' }} />
                </div>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
                <div style={{ height: 20, width: 34, background: 'var(--surface-2)', borderRadius: 'var(--r-pill)' }} />
                <div style={{ height: 20, width: 48, background: 'var(--surface-2)', borderRadius: 'var(--r-pill)' }} />
            </div>
            <div style={{ height: 32, background: 'var(--surface-2)', borderRadius: 'var(--r-control)' }} />
        </div>
    );
}

// ── Tool Card ─────────────────────────────────────────────────────────────────
function ToolCard({ tool }: { tool: ToolDefinition }) {
    const t = token(tool.accentColor);
    const runRoute = TOOL_RUNNER_ROUTES[tool.id];

    return (
        <div className="hover-card" style={{
            padding: 16, borderRadius: 'var(--r-card)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: `var(--c-${t}-bg)`, color: `var(--c-${t})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                    <ToolIcon name={tool.icon} size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tool.name}
                        </h3>
                        {tool.usesAI && (
                            <span className="pill pill-ai" style={{ fontSize: 10, padding: '2px 6px', flexShrink: 0 }}>
                                <Cpu style={{ width: 9, height: 9 }} /> AI
                            </span>
                        )}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                        {tool.description}
                    </p>
                </div>
            </div>

            {/* Extension chips */}
            {tool.fileExtensions.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {tool.fileExtensions.slice(0, 4).map(ext => (
                        <span key={ext} className="chip chip-mono">{ext}</span>
                    ))}
                    {tool.fileExtensions.length > 4 && (
                        <span className="chip chip-mono">+{tool.fileExtensions.length - 4}</span>
                    )}
                </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 7, marginTop: 'auto' }}>
                <Link to={`/tools/${tool.id}`} style={{ textDecoration: 'none', flex: runRoute ? 0 : 1 }}>
                    <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', fontSize: 12.5, padding: '7px 12px' }}>
                        Details
                    </button>
                </Link>
                {runRoute && (
                    <Link to={runRoute} style={{ textDecoration: 'none', flex: 1 }}>
                        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 12.5, padding: '7px 12px' }}>
                            Open <ChevronRight style={{ width: 12, height: 12 }} />
                        </button>
                    </Link>
                )}
            </div>
        </div>
    );
}

// ── Category Section ──────────────────────────────────────────────────────────
function CategorySection({ meta, tools }: { meta: CategoryMeta; tools: ToolDefinition[] }) {
    const t = token(meta.color);
    if (tools.length === 0) return null;
    return (
        <section>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: `var(--c-${t}-bg)`, color: `var(--c-${t})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                    <ToolIcon name={meta.icon} size={16} />
                </div>
                <div style={{ flex: 1 }}>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{meta.label}</h2>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{meta.description}</div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
                    {tools.length}
                </span>
            </header>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {tools.map(t => <ToolCard key={t.id} tool={t} />)}
            </div>
        </section>
    );
}

// ── Category filter pill ──────────────────────────────────────────────────────
function CatPill({ active, onClick, label, icon, accent, count }: {
    active: boolean; onClick: () => void; label: string;
    icon?: string; accent?: string; count: number;
}) {
    const t = accent ? token(accent) : null;
    return (
        <button onClick={onClick} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 11px', borderRadius: 'var(--r-pill)',
            background: active ? (t ? `var(--c-${t})` : 'var(--ink)') : 'var(--surface)',
            color: active ? 'var(--page)' : 'var(--ink-2)',
            border: '1px solid ' + (active ? 'transparent' : 'var(--border)'),
            fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap',
            transition: 'all .15s var(--ease)',
        }}>
            {icon && <ToolIcon name={icon} size={12} />}
            {label}
            <span style={{ fontSize: 10.5, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>{count}</span>
        </button>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type ViewMode = 'categories' | 'list';

export const Tools: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { tools, categories, loading, error, reload } = useToolsCatalog();

    const urlCategory = searchParams.get('category') as CategoryKey | null;

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

    useEffect(() => { localStorage.setItem('tools_viewMode', viewMode); }, [viewMode]);
    useEffect(() => { localStorage.setItem('tools_category', selectedCategory); }, [selectedCategory]);
    useEffect(() => { localStorage.setItem('tools_aiOnly', String(aiOnly)); }, [aiOnly]);

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

    const visibleCategories = useMemo(() =>
        categories.filter(cat => filteredTools.some(t => t.categories.includes(cat.key))),
        [categories, filteredTools]
    );

    return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--page)' }}>

            {/* ── Filter bar ── */}
            <div style={{
                padding: '10px 20px', flexShrink: 0,
                borderBottom: '1px solid var(--border)',
                background: 'var(--surface)',
                display: 'flex', alignItems: 'center', gap: 10,
            }}>
                {/* Search */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    height: 34, padding: '0 10px',
                    background: 'var(--page)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-control)', width: 220, flexShrink: 0,
                }}>
                    <Search style={{ width: 13, height: 13, color: 'var(--muted)', flexShrink: 0 }} />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search tools…"
                        style={{ border: 0, outline: 0, background: 'transparent', flex: 1, fontSize: 12.5, color: 'var(--ink)' }}
                    />
                    {query && (
                        <button onClick={() => setQuery('')} style={{ color: 'var(--muted)', display: 'flex' }}>
                            <X style={{ width: 11, height: 11 }} />
                        </button>
                    )}
                </div>

                <div className="divider-v" style={{ height: 22, flexShrink: 0 }} />

                {/* Category pills — horizontally scrollable */}
                <div style={{
                    flex: 1, display: 'flex', gap: 6, overflowX: 'auto',
                    scrollbarWidth: 'none', msOverflowStyle: 'none',
                    paddingBottom: 1,
                }}>
                    <CatPill active={selectedCategory === 'all'} onClick={() => setSelectedCategory('all')} label="All" count={tools.length} />
                    {categories.map(cat => (
                        <CatPill key={cat.key}
                            active={selectedCategory === cat.key}
                            onClick={() => setSelectedCategory(cat.key)}
                            label={cat.label}
                            icon={cat.icon}
                            accent={cat.color}
                            count={tools.filter(t => t.categories.includes(cat.key)).length}
                        />
                    ))}
                </div>

                <div className="divider-v" style={{ height: 22, flexShrink: 0 }} />

                {/* AI only toggle */}
                <button
                    onClick={() => setAiOnly(v => !v)}
                    className="btn"
                    style={{
                        flexShrink: 0, fontSize: 12.5, padding: '5px 11px',
                        background: aiOnly ? 'var(--c-plum)' : 'var(--surface-2)',
                        color: aiOnly ? 'var(--page)' : 'var(--ink-2)',
                        border: '1px solid ' + (aiOnly ? 'transparent' : 'var(--border)'),
                    }}
                >
                    <Cpu style={{ width: 12, height: 12 }} /> AI only
                </button>

                {/* View toggle */}
                <div style={{
                    display: 'flex', background: 'var(--surface-2)',
                    border: '1px solid var(--border)', borderRadius: 'var(--r-control)',
                    padding: 2, gap: 1, flexShrink: 0,
                }}>
                    {([['categories', LayoutGrid], ['list', List]] as const).map(([mode, Icon]) => (
                        <button key={mode} onClick={() => setViewMode(mode)} style={{
                            padding: '5px 8px', borderRadius: 7, display: 'flex', alignItems: 'center',
                            background: viewMode === mode ? 'var(--accent-soft)' : 'transparent',
                            color: viewMode === mode ? 'var(--accent-ink)' : 'var(--muted)',
                            transition: 'all .15s var(--ease)',
                        }}>
                            <Icon style={{ width: 14, height: 14 }} />
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Error banner ── */}
            {error && (
                <div style={{
                    margin: '10px 20px 0', padding: '10px 14px',
                    background: 'var(--c-clay-bg)', color: 'var(--c-clay)',
                    borderRadius: 'var(--r-control)',
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexShrink: 0,
                }}>
                    <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>Could not load tool catalog: {error}</span>
                    <button onClick={reload} className="btn btn-secondary" style={{ padding: '4px 9px', fontSize: 11.5 }}>
                        <RefreshCw style={{ width: 11, height: 11 }} /> Retry
                    </button>
                </div>
            )}

            {/* ── Tool count strip ── */}
            {!loading && !error && (
                <div style={{
                    padding: '8px 20px 0', flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 8,
                }}>
                    <span style={{ fontSize: 12, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
                        {filteredTools.length} {filteredTools.length === 1 ? 'tool' : 'tools'}
                        {selectedCategory !== 'all' && ` in ${categories.find(c => c.key === selectedCategory)?.label ?? selectedCategory}`}
                        {query && ` matching "${query}"`}
                    </span>
                </div>
            )}

            {/* ── Content ── */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 20px 32px' }}>
                {loading ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                        {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
                    </div>
                ) : filteredTools.length === 0 ? (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', padding: '60px 20px',
                        color: 'var(--faint)', gap: 10,
                    }}>
                        <Search style={{ width: 32, height: 32, opacity: 0.3 }} />
                        <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: 0 }}>No tools match your filters.</p>
                        <button
                            onClick={() => { setSelectedCategory('all'); setAiOnly(false); setQuery(''); }}
                            style={{ fontSize: 12.5, color: 'var(--accent-ink)', fontWeight: 500 }}
                        >
                            Clear all filters
                        </button>
                    </div>
                ) : viewMode === 'categories' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                        {visibleCategories.map(cat => (
                            <CategorySection
                                key={cat.key}
                                meta={cat}
                                tools={filteredTools.filter(t => t.categories.includes(cat.key))}
                            />
                        ))}
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                        {filteredTools.map(t => <ToolCard key={t.id} tool={t} />)}
                    </div>
                )}
            </div>
        </div>
    );
};

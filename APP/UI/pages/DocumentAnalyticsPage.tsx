import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, ChevronRight, BarChart2, FolderOpen, HardDrive,
    RefreshCw, X, CheckCircle, AlertCircle, FileText,
    Folder, ChevronLeft, Cpu, Zap, ZapOff, Brain, Hash,
    Clock, BookOpen, AlignLeft, Tag, Search,
} from 'lucide-react';

const FLASK_BASE = 'http://127.0.0.1:5000';
const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.html', '.htm']);

interface DriveEntry { name: string; path: string; config?: { name: string } }
interface DirItem { name: string; path: string; is_dir: boolean; size: number }

interface DocStats {
    word_count: number;
    character_count: number;
    character_count_no_spaces: number;
    sentence_count: number;
    paragraph_count: number;
    unique_words: number;
    avg_words_per_sentence: number;
    avg_word_length: number;
    reading_time_min: number;
    estimated_pages: number;
    top_keywords: string[];
    flesch_reading_ease: number;
    flesch_grade: string;
}

interface LLMInsights {
    summary: string;
    topics: string[];
    tone: string;
    entities: string[];
    truncated?: boolean;
    error?: string | null;
}

interface AnalyticsResult {
    success: boolean;
    stats: DocStats;
    llm_insights: LLMInsights;
    text_preview: string;
    file_name: string;
    file_size: number;
    file_ext: string;
    error?: string;
}

function isDocFile(name: string): boolean {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return DOC_EXTENSIONS.has(ext);
}

function fmtSize(bytes: number): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function fmtNum(n: number): string {
    return n.toLocaleString();
}

const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-card)',
    padding: 20,
    boxShadow: 'var(--shadow-sm)',
};

const ACCENT = 'var(--c-ochre)';
const ACCENT_BG = 'var(--c-ochre-bg)';

function MetricRow({ label, value, last }: { label: string; value: string | number; last?: boolean }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 0',
            borderBottom: last ? 'none' : '1px solid var(--border)',
        }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{value}</span>
        </div>
    );
}

function FleschBar({ score }: { score: number }) {
    const pct = Math.max(0, Math.min(100, score));
    const color = pct >= 70 ? 'var(--c-sage)' : pct >= 50 ? ACCENT : 'var(--c-clay)';
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Flesch Readability</span>
                <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{score} / 100</span>
            </div>
            <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.8s ease-out' }} />
            </div>
        </div>
    );
}

// ── Folder browser modal ──────────────────────────────────────────────────────
function FolderBrowser({
    drives, onPickFile, onClose,
}: {
    drives: DriveEntry[];
    onPickFile: (path: string, name: string, size: number) => void;
    onClose: () => void;
}) {
    const [currentDrive, setCurrentDrive] = useState<DriveEntry | null>(null);
    const [currentPath, setCurrentPath] = useState('');
    const [entries, setEntries] = useState<DirItem[]>([]);
    const [loading, setLoading] = useState(false);

    const loadPath = async (path: string) => {
        setLoading(true);
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            setEntries((data.files || [])
                .filter((f: any) => f.is_dir || isDocFile(f.name))
                .map((f: any) => ({ name: f.name, path: f.path, is_dir: f.is_dir, size: f.size || 0 })));
            setCurrentPath(path);
        } catch { setEntries([]); } finally { setLoading(false); }
    };

    const navigateUp = () => {
        if (!currentPath || !currentDrive) return;
        const parent = currentPath.replace(/[\\/][^\\/]+$/, '');
        const driveRoot = currentDrive.path.replace(/[\\/]+$/, '');
        const np = parent.replace(/[\\/]+$/, '');
        if (np && np !== currentPath.replace(/[\\/]+$/, '') && np.length >= driveRoot.length) loadPath(parent);
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'oklch(0 0 0 / 0.5)', backdropFilter: 'blur(4px)',
        }}>
            <div style={{
                ...card, padding: 0,
                width: '100%', maxWidth: 640, maxHeight: '80vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: 'var(--shadow-lg)',
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', borderBottom: '1px solid var(--border)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {currentDrive && currentPath.replace(/[\\/]+$/, '') !== currentDrive.path.replace(/[\\/]+$/, '') && (
                            <button onClick={navigateUp} className="btn btn-ghost" style={{ padding: 6 }}>
                                <ChevronLeft style={{ width: 16, height: 16 }} />
                            </button>
                        )}
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                            {currentDrive ? (currentDrive.config?.name ?? currentDrive.name) : 'Select a Drive'}
                        </h3>
                        {currentPath && (
                            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240, whiteSpace: 'nowrap' }}>
                                {currentPath}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="btn btn-ghost" style={{ padding: 6 }}>
                        <X style={{ width: 16, height: 16 }} />
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                    {!currentDrive ? (
                        drives.length === 0 ? (
                            <p style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 13 }}>No virtual drives found.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {drives.map((d, i) => (
                                    <button key={i} onClick={() => { setCurrentDrive(d); loadPath(d.path); }}
                                        className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', gap: 12, padding: '10px 12px', textAlign: 'left' }}>
                                        <HardDrive style={{ width: 18, height: 18, color: 'var(--c-sky)', flexShrink: 0 }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.config?.name ?? d.name}</p>
                                            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.path}</p>
                                        </div>
                                        <ChevronRight style={{ width: 14, height: 14, color: 'var(--muted)', flexShrink: 0 }} />
                                    </button>
                                ))}
                            </div>
                        )
                    ) : loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0', color: 'var(--muted)', gap: 8 }}>
                            <RefreshCw style={{ width: 18, height: 18 }} className="spin" />
                            <span style={{ fontSize: 13 }}>Loading...</span>
                        </div>
                    ) : entries.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)', fontSize: 13 }}>No documents or folders here.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {entries.map(entry => entry.is_dir ? (
                                <button key={entry.path} onClick={() => loadPath(entry.path)}
                                    className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', gap: 10, padding: '8px 12px' }}>
                                    <Folder style={{ width: 15, height: 15, color: 'var(--c-ochre)', flexShrink: 0 }} />
                                    <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{entry.name}</span>
                                    <ChevronRight style={{ width: 13, height: 13, color: 'var(--muted)', flexShrink: 0 }} />
                                </button>
                            ) : (
                                <button key={entry.path}
                                    onClick={() => { onPickFile(entry.path, entry.name, entry.size); onClose(); }}
                                    className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', gap: 10, padding: '8px 12px' }}>
                                    <FileText style={{ width: 15, height: 15, color: ACCENT, flexShrink: 0 }} />
                                    <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{entry.name}</span>
                                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{fmtSize(entry.size)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={onClose} className="btn btn-secondary" style={{ fontSize: 13 }}>Cancel</button>
                </div>
            </div>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export const DocumentAnalyticsPage: React.FC = () => {
    const navigate = useNavigate();
    const [drives, setDrives] = useState<DriveEntry[]>([]);
    const [loadingDrives, setLoadingDrives] = useState(true);
    const [showBrowser, setShowBrowser] = useState(false);
    const [gatewayOnline, setGatewayOnline] = useState<boolean | null>(null);
    const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);

    const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; size: number } | null>(null);
    const [includeLLM, setIncludeLLM] = useState(true);

    const [analyzing, setAnalyzing] = useState(false);
    const [result, setResult] = useState<AnalyticsResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoadingDrives(true);
        Promise.all([
            fetch(`${FLASK_BASE}/api/drive/registry`).then(r => r.json()).catch(() => ({ drives: [] })),
            fetch(`${FLASK_BASE}/api/tools/ai-gateway/status`).then(r => r.json()).catch(() => null),
            fetch('http://localhost:8000/api/ai/llm/status').then(r => r.json()).catch(() => null),
        ]).then(([regData, gwData, llmData]) => {
            setDrives(Array.isArray(regData.drives) ? regData.drives : []);
            setGatewayOnline(gwData?.status === 'ok');
            setLlmConfigured(llmData?.configured ?? null);
        }).finally(() => setLoadingDrives(false));
    }, []);

    const pickFile = useCallback((path: string, name: string, size: number) => {
        setSelectedFile({ path, name, size });
        setResult(null); setError(null);
    }, []);

    const browseFiles = async () => {
        const paths = await (window as any).electronAPI?.selectFiles?.({
            filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'html', 'htm'] }],
        });
        if (!paths?.length) return;
        pickFile(paths[0], paths[0].split(/[\\/]/).pop() || paths[0], 0);
    };

    const browseFolder = async () => {
        const dir = await (window as any).electronAPI?.selectDirectory?.();
        if (!dir) return;
        try {
            const res = await fetch(`${FLASK_BASE}/api/drive/list?path=${encodeURIComponent(dir)}`);
            const data = await res.json();
            const files = (data.files || []).filter((f: any) => !f.is_dir && isDocFile(f.name));
            if (files.length > 0) pickFile(files[0].path, files[0].name, files[0].size || 0);
        } catch { setError('Failed to list files in that folder.'); }
    };

    const analyze = async () => {
        if (!selectedFile) return;
        setAnalyzing(true); setResult(null); setError(null);
        try {
            const res = await fetch(`${FLASK_BASE}/api/tools/document-analytics/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: selectedFile.path, includeLLM }),
            });
            const data: AnalyticsResult = await res.json();
            if (!data.success) { setError(data.error ?? 'Analysis failed'); return; }
            setResult(data);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Analysis failed');
        } finally { setAnalyzing(false); }
    };

    const canRun = !!selectedFile && !analyzing;

    const selectStyle: React.CSSProperties = {
        width: '100%', fontSize: 13, padding: '8px 12px',
        borderRadius: 'var(--r-control)', outline: 'none',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        color: 'var(--ink)', appearance: 'auto',
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Breadcrumb */}
            <nav style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--muted)' }}>
                <Link to="/tools" className="tool-title-link" style={{ fontSize: 13, fontWeight: 400 }}>Tools</Link>
                <ChevronRight style={{ width: 13, height: 13 }} />
                <Link to="/tools?category=documents" className="tool-title-link" style={{ fontSize: 13, fontWeight: 400 }}>Documents</Link>
                <ChevronRight style={{ width: 13, height: 13 }} />
                <Link to="/tools/document-analytics" className="tool-title-link" style={{ fontSize: 13, fontWeight: 400 }}>Document Analytics</Link>
                <ChevronRight style={{ width: 13, height: 13 }} />
                <span style={{ color: 'var(--ink)' }}>Run</span>
            </nav>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: 12,
                        background: ACCENT_BG, border: `1px solid ${ACCENT}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                        <BarChart2 style={{ width: 24, height: 24, color: ACCENT }} />
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>Document Analytics</h1>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Statistics, readability, keywords, and AI insights for any document</p>
                    </div>
                </div>
                <button onClick={() => navigate('/tools/document-analytics')} className="btn btn-secondary" style={{ fontSize: 13 }}>
                    <ArrowLeft style={{ width: 14, height: 14 }} />Back to Info
                </button>
            </div>

            {/* Main grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>

                {/* ── Left column ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                    {/* File picker */}
                    <div style={card}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Document File</p>
                            {selectedFile && !analyzing && (
                                <button onClick={() => { setSelectedFile(null); setResult(null); setError(null); }}
                                    className="btn btn-ghost" style={{ fontSize: 12, padding: '2px 8px', color: ACCENT }}>
                                    Clear
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button onClick={browseFiles} disabled={analyzing} className="btn"
                                style={{ background: ACCENT, color: 'white', fontSize: 13, opacity: analyzing ? 0.5 : 1 }}>
                                <FileText style={{ width: 14, height: 14 }} />Browse File
                            </button>
                            <button onClick={browseFolder} disabled={analyzing} className="btn btn-secondary" style={{ fontSize: 13, opacity: analyzing ? 0.5 : 1 }}>
                                <FolderOpen style={{ width: 14, height: 14 }} />Browse Folder
                            </button>
                            <button onClick={() => setShowBrowser(true)} disabled={loadingDrives || analyzing}
                                className="btn btn-secondary" style={{ fontSize: 13, opacity: (loadingDrives || analyzing) ? 0.5 : 1 }}>
                                <HardDrive style={{ width: 14, height: 14 }} />From Virtual Drive
                            </button>
                        </div>

                        {!selectedFile && (
                            <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                                gap: 10, padding: '40px 20px', marginTop: 12,
                                border: '2px dashed var(--border-2)', borderRadius: 'var(--r-card)',
                                textAlign: 'center',
                            }}>
                                <BarChart2 style={{ width: 36, height: 36, color: 'var(--faint)' }} />
                                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>No document selected.</p>
                                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--faint)' }}>Supports PDF, DOCX, TXT, Markdown, HTML — from a single page to a full book.</p>
                            </div>
                        )}

                        {selectedFile && (
                            <div style={{
                                marginTop: 12, display: 'flex', alignItems: 'center', gap: 12,
                                padding: '10px 14px', borderRadius: 'var(--r-control)',
                                background: ACCENT_BG, border: `1px solid ${ACCENT}`,
                            }}>
                                <FileText style={{ width: 18, height: 18, color: ACCENT, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ margin: 0, fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {selectedFile.name}
                                    </p>
                                    <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {selectedFile.path}
                                    </p>
                                </div>
                                {selectedFile.size > 0 && (
                                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{fmtSize(selectedFile.size)}</span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Loading indicator */}
                    {analyzing && (
                        <div style={{ ...card, borderColor: ACCENT, background: ACCENT_BG }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <RefreshCw style={{ width: 16, height: 16, color: ACCENT }} className="spin" />
                                <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                                    Analyzing document{includeLLM ? ' — computing stats and getting AI insights…' : ' — computing statistics…'}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                            padding: '10px 14px', borderRadius: 'var(--r-control)',
                            background: 'var(--c-clay-bg)', border: '1px solid var(--c-clay)',
                        }}>
                            <AlertCircle style={{ width: 15, height: 15, color: 'var(--c-clay)', flexShrink: 0, marginTop: 1 }} />
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--c-clay)' }}>{error}</p>
                        </div>
                    )}

                    {/* Results */}
                    {result && (
                        <>
                            {/* Stats grid */}
                            <div style={card}>
                                <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
                                    <Hash style={{ width: 14, height: 14, color: 'var(--muted)' }} />Statistics
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                                    {[
                                        { label: 'Words', value: fmtNum(result.stats.word_count), icon: AlignLeft },
                                        { label: 'Sentences', value: fmtNum(result.stats.sentence_count), icon: AlignLeft },
                                        { label: 'Paragraphs', value: fmtNum(result.stats.paragraph_count), icon: AlignLeft },
                                        { label: 'Unique words', value: fmtNum(result.stats.unique_words), icon: Search },
                                        { label: 'Est. pages', value: result.stats.estimated_pages.toFixed(1), icon: BookOpen },
                                        { label: 'Reading time', value: result.stats.reading_time_min < 1 ? `${Math.round(result.stats.reading_time_min * 60)} sec` : `${result.stats.reading_time_min.toFixed(1)} min`, icon: Clock },
                                    ].map(({ label, value, icon: Icon }) => (
                                        <div key={label} style={{
                                            padding: '12px 14px', borderRadius: 'var(--r-control)',
                                            background: 'var(--surface-2)', border: '1px solid var(--border)',
                                            display: 'flex', flexDirection: 'column', gap: 4,
                                        }}>
                                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
                                            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{value}</span>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 14 }}>
                                    <MetricRow label="Characters (with spaces)" value={fmtNum(result.stats.character_count)} />
                                    <MetricRow label="Characters (no spaces)" value={fmtNum(result.stats.character_count_no_spaces)} />
                                    <MetricRow label="Avg words / sentence" value={result.stats.avg_words_per_sentence} />
                                    <MetricRow label="Avg word length" value={`${result.stats.avg_word_length} chars`} last />
                                </div>
                                <FleschBar score={result.stats.flesch_reading_ease} />
                                <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>{result.stats.flesch_grade}</p>
                            </div>

                            {/* Keywords */}
                            {result.stats.top_keywords.length > 0 && (
                                <div style={card}>
                                    <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
                                        <Tag style={{ width: 14, height: 14, color: 'var(--muted)' }} />Top Keywords
                                    </p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {result.stats.top_keywords.map(kw => (
                                            <span key={kw} style={{
                                                padding: '3px 10px', borderRadius: 20,
                                                background: ACCENT_BG, border: `1px solid ${ACCENT}`,
                                                fontSize: 12, color: 'var(--ink)', fontFamily: 'var(--font-mono)',
                                            }}>{kw}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* AI Insights */}
                            {result.llm_insights && !result.llm_insights.error && (
                                <div style={card}>
                                    <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
                                        <Brain style={{ width: 14, height: 14, color: 'var(--muted)' }} />AI Insights
                                        {result.llm_insights.truncated && (
                                            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--faint)' }}>(based on first 2 500 words)</span>
                                        )}
                                    </p>
                                    {result.llm_insights.summary && (
                                        <div style={{ marginBottom: 14 }}>
                                            <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Summary</p>
                                            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>{result.llm_insights.summary}</p>
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                        {result.llm_insights.topics.length > 0 && (
                                            <div>
                                                <p style={{ margin: '0 0 7px', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Topics</p>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    {result.llm_insights.topics.map(t => (
                                                        <span key={t} style={{ fontSize: 12, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT, flexShrink: 0 }} />{t}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div>
                                            {result.llm_insights.tone && (
                                                <div style={{ marginBottom: 10 }}>
                                                    <p style={{ margin: '0 0 5px', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tone</p>
                                                    <span style={{
                                                        padding: '3px 10px', borderRadius: 20,
                                                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                                                        fontSize: 12, color: 'var(--ink)', textTransform: 'capitalize',
                                                    }}>{result.llm_insights.tone}</span>
                                                </div>
                                            )}
                                            {result.llm_insights.entities.length > 0 && (
                                                <div>
                                                    <p style={{ margin: '0 0 5px', fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Entities</p>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                        {result.llm_insights.entities.slice(0, 6).map(e => (
                                                            <span key={e} style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {result.llm_insights?.error && (
                                <div style={{
                                    padding: '10px 14px', borderRadius: 'var(--r-control)',
                                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                                    fontSize: 12, color: 'var(--muted)',
                                }}>
                                    AI insights unavailable: {result.llm_insights.error}
                                </div>
                            )}

                            {/* Text preview */}
                            {result.text_preview && (
                                <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 7,
                                        padding: '10px 16px', borderBottom: '1px solid var(--border)',
                                        background: 'var(--surface-2)',
                                    }}>
                                        <AlignLeft style={{ width: 13, height: 13, color: 'var(--muted)' }} />
                                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Text Preview</span>
                                        <span style={{ fontSize: 11, color: 'var(--faint)' }}>(first 500 characters)</span>
                                    </div>
                                    <p style={{
                                        margin: 0, padding: 16,
                                        fontSize: 12, color: 'var(--muted)', lineHeight: 1.7,
                                        fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                    }}>{result.text_preview}</p>
                                </div>
                            )}

                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 14px', borderRadius: 'var(--r-control)',
                                background: 'var(--c-sage-bg)', border: '1px solid var(--c-sage)',
                            }}>
                                <CheckCircle style={{ width: 15, height: 15, color: 'var(--c-sage)', flexShrink: 0 }} />
                                <span style={{ fontSize: 12, color: 'var(--c-sage)' }}>
                                    Analysis complete — {fmtNum(result.stats.word_count)} words, {result.stats.estimated_pages.toFixed(1)} pages
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* ── Right column ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                    {/* LLM Gateway status */}
                    <div style={card}>
                        <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
                            <Cpu style={{ width: 14, height: 14, color: 'var(--muted)' }} />LLM Gateway
                        </p>
                        {gatewayOnline === null ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--muted)', fontSize: 12 }}>
                                <RefreshCw style={{ width: 13, height: 13 }} className="spin" />Checking...
                            </div>
                        ) : gatewayOnline ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--c-sage)' }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c-sage)', display: 'inline-block' }} />
                                    Online — port 8000
                                </div>
                                {llmConfigured !== null && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                                        <span style={{ color: 'var(--muted)' }}>Groq LLM</span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: llmConfigured ? 'var(--c-sage)' : 'var(--c-clay)' }}>
                                            {llmConfigured
                                                ? <><Zap style={{ width: 11, height: 11 }} />Configured</>
                                                : <><ZapOff style={{ width: 11, height: 11 }} />Key not set</>}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--c-clay)' }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c-clay)', display: 'inline-block' }} />
                                    Offline
                                </div>
                                <p style={{ margin: 0, fontSize: 11, color: 'var(--faint)' }}>Statistics work offline. Start the Server on port 8000 for AI insights.</p>
                            </div>
                        )}
                    </div>

                    {/* Options */}
                    <div style={card}>
                        <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Options</p>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={includeLLM}
                                onChange={e => setIncludeLLM(e.target.checked)}
                                style={{ marginTop: 2, accentColor: ACCENT, flexShrink: 0 }}
                            />
                            <div>
                                <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>AI Insights</span>
                                <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>
                                    Use Groq to generate summary, topics, tone, and key entities. Requires the Server on port 8000.
                                </p>
                            </div>
                        </label>
                    </div>

                    {/* Analyze button */}
                    <button
                        onClick={analyze}
                        disabled={!canRun}
                        className="btn"
                        style={{
                            width: '100%', justifyContent: 'center',
                            fontSize: 14, fontWeight: 600, padding: '12px 16px',
                            background: canRun ? ACCENT : 'var(--surface-3)',
                            color: canRun ? 'white' : 'var(--muted)',
                            borderRadius: 'var(--r-card)',
                            cursor: canRun ? 'pointer' : 'not-allowed',
                            border: 'none',
                            boxShadow: canRun ? `0 4px 14px oklch(0.7 0.15 75 / 0.25)` : 'none',
                            transition: 'all .15s var(--ease)',
                        }}
                    >
                        {analyzing ? (
                            <>
                                <RefreshCw style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
                                Analyzing…
                            </>
                        ) : (
                            <><BarChart2 style={{ width: 16, height: 16 }} />Analyze Document</>
                        )}
                    </button>

                    {/* Supported formats */}
                    <div style={{ ...card, padding: '14px 16px' }}>
                        <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Supported Formats</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {['.pdf', '.docx', '.txt', '.md', '.html', '.htm'].map(ext => (
                                <span key={ext} style={{
                                    padding: '2px 8px', borderRadius: 6,
                                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                                    fontSize: 11.5, color: 'var(--ink)', fontFamily: 'var(--font-mono)',
                                }}>{ext}</span>
                            ))}
                        </div>
                        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--faint)' }}>
                            From a single page to a full book — no size limit.
                        </p>
                    </div>
                </div>
            </div>

            {showBrowser && (
                <FolderBrowser drives={drives} onPickFile={pickFile} onClose={() => setShowBrowser(false)} />
            )}
        </div>
    );
};

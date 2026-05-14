import React, { useState, useEffect } from 'react';
import { Server, Key, CheckCircle, AlertCircle, FolderOpen, FolderCog, Save } from 'lucide-react';

const FLASK = 'http://127.0.0.1:5000/api/agent';

interface AgentConfig {
    server_url: string;
    api_key_set: boolean;
    output_path: string;
}

// ── Section card ─────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-card)', overflow: 'hidden',
        }}>
            {children}
        </div>
    );
}

function CardHeader({ icon, title, badge }: { icon: React.ReactNode; title: string; badge?: React.ReactNode }) {
    return (
        <div style={{
            padding: '14px 20px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
        }}>
            <span style={{ color: 'var(--muted)', display: 'flex', flexShrink: 0 }}>{icon}</span>
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{title}</h2>
            {badge}
        </div>
    );
}

function CardBody({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {children}
        </div>
    );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>{label}</label>
            {children}
            {hint && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5 }}>{hint}</p>}
        </div>
    );
}

function TextInput({ value, onChange, placeholder, type = 'text', mono }: {
    value: string; onChange: (v: string) => void;
    placeholder?: string; type?: string; mono?: boolean;
}) {
    return (
        <input
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            style={{
                width: '100%', padding: '9px 12px',
                background: 'var(--page)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-control)', fontSize: 13.5, color: 'var(--ink)',
                fontFamily: mono ? 'var(--font-mono)' : 'var(--font-body)',
                outline: 'none', boxSizing: 'border-box',
                transition: 'border-color .15s',
            }}
            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'; }}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--border)'; }}
        />
    );
}

export const Settings: React.FC = () => {
    const [serverUrl, setServerUrl] = useState('http://localhost:8000');
    const [apiKey, setApiKey] = useState('');
    const [apiKeySet, setApiKeySet] = useState(false);
    const [outputPath, setOutputPath] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch(`${FLASK}/config`)
            .then(r => r.json())
            .then((cfg: AgentConfig) => {
                setServerUrl(cfg.server_url || 'http://localhost:8000');
                setApiKeySet(cfg.api_key_set ?? false);
                setOutputPath(cfg.output_path || '');
            })
            .catch(() => setError('Could not reach local backend.'))
            .finally(() => setLoading(false));
    }, []);

    const browseOutputPath = async () => {
        try {
            const dir = await (window as any).electronAPI?.selectDirectory?.();
            if (dir) setOutputPath(dir);
        } catch { /* Electron API not available */ }
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
                    mode: 'server_proxy',
                    server_url: serverUrl,
                    api_key: apiKey,
                    output_path: outputPath,
                }),
            });
            if (apiKey) setApiKeySet(true);
            setApiKey('');
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError('Save failed. Is the local backend running?');
        } finally {
            setSaving(false);
        }
    };

    const isConfigured = serverUrl && apiKeySet;

    return (
        <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>

            <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: 'var(--display-tracking)' }}>
                    Settings
                </h1>
                <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>
                    Configure how the app connects to the AI agent.
                </p>
            </div>

            {error && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '12px 14px', borderRadius: 'var(--r-control)',
                    background: 'var(--c-clay-bg)', color: 'var(--c-clay)', fontSize: 13,
                }}>
                    <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{error}</span>
                </div>
            )}

            {/* Agent connection */}
            <Card>
                <CardHeader
                    icon={<Server size={15} />}
                    title="Agent Connection"
                    badge={
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            fontSize: 11.5, fontWeight: 500, padding: '3px 9px',
                            borderRadius: 'var(--r-pill)',
                            background: isConfigured ? 'var(--c-sage-bg)' : 'var(--c-ochre-bg)',
                            color: isConfigured ? 'var(--c-sage)' : 'var(--c-ochre)',
                        }}>
                            {isConfigured
                                ? <><CheckCircle size={11} /> Configured</>
                                : <><AlertCircle size={11} /> Not configured</>
                            }
                        </span>
                    }
                />
                <CardBody>
                    <Field label="Server URL">
                        <TextInput
                            value={serverUrl}
                            onChange={v => { setServerUrl(v); setSaved(false); }}
                            placeholder="https://your-server.example.com"
                        />
                    </Field>

                    <Field
                        label={
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <Key size={11} /> API Key
                                {apiKeySet && (
                                    <span style={{ fontSize: 11, color: 'var(--c-sage)', fontWeight: 500 }}>(saved)</span>
                                )}
                            </span>
                        }
                        hint="The API key is generated when you deploy a container on the server. Open the server web UI → Containers → copy the key."
                    >
                        <TextInput
                            type="password"
                            value={apiKey}
                            onChange={v => { setApiKey(v); setSaved(false); }}
                            placeholder={apiKeySet ? '••••••  (leave blank to keep existing)' : 'Paste the API key from the server'}
                        />
                    </Field>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                        <button
                            onClick={save}
                            disabled={saving || loading}
                            className="btn btn-primary"
                            style={{ opacity: (saving || loading) ? 0.5 : 1 }}
                        >
                            {saving ? <><span className="spin" style={{ display: 'inline-block', width: 12, height: 12, border: '1.5px solid currentColor', borderRightColor: 'transparent', borderRadius: '50%' }} /> Saving…</> : <><Save size={13} /> Save</>}
                        </button>
                        {saved && (
                            <span style={{ fontSize: 12.5, color: 'var(--c-sage)', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <CheckCircle size={13} /> Saved
                            </span>
                        )}
                    </div>
                </CardBody>
            </Card>

            {/* Tool output */}
            <Card>
                <CardHeader icon={<FolderCog size={15} />} title="Tool Output Settings" />
                <CardBody>
                    <Field
                        label={<span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><FolderOpen size={11} /> Output Path</span>}
                        hint={
                            <>
                                When a tool runs in <strong style={{ color: 'var(--ink-2)' }}>Virtual Drive</strong> mode, it creates a drive folder
                                (e.g. <code style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 4 }}>ImageConversionResults</code>)
                                inside this path. Leave blank to disable virtual drive output.
                            </>
                        }
                    >
                        <div style={{ display: 'flex', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                                <TextInput
                                    value={outputPath}
                                    onChange={v => { setOutputPath(v); setSaved(false); }}
                                    placeholder="C:\Users\You\Documents"
                                    mono
                                />
                            </div>
                            <button
                                onClick={browseOutputPath}
                                className="btn btn-secondary"
                                style={{ padding: '9px 12px', flexShrink: 0 }}
                                title="Browse for folder"
                            >
                                <FolderOpen size={15} />
                            </button>
                        </div>
                    </Field>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                        <button
                            onClick={save}
                            disabled={saving || loading}
                            className="btn btn-primary"
                            style={{ opacity: (saving || loading) ? 0.5 : 1 }}
                        >
                            {saving ? 'Saving…' : <><Save size={13} /> Save</>}
                        </button>
                        {saved && (
                            <span style={{ fontSize: 12.5, color: 'var(--c-sage)', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <CheckCircle size={13} /> Saved
                            </span>
                        )}
                    </div>
                </CardBody>
            </Card>
        </div>
    );
};

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'

const API = '/api/agent'

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2L13 10"/><path d="M21 2l-5 1 1-5"/><path d="M13 10l-2 2"/>
    </svg>
  )
}

export default function AgentKey() {
  const { token } = useAuth()
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [working, setWorking] = useState(false)

  const authHeader = { Authorization: `Bearer ${token}` }

  const fetchKey = useCallback(async () => {
    if (!token) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${API}/key`, { headers: authHeader })
      if (r.status === 404) { setApiKey(null); return }
      if (!r.ok) throw new Error(await r.text())
      const data = await r.json()
      setApiKey(data.api_key)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchKey() }, [fetchKey])

  async function generate() {
    setWorking(true)
    setError(null)
    try {
      const r = await fetch(`${API}/register`, { method: 'POST', headers: authHeader })
      if (!r.ok) throw new Error(await r.text())
      const data = await r.json()
      setApiKey(data.api_key)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function deleteKey() {
    if (!confirm('Delete your agent API key? The Electron app will need to be reconfigured.')) return
    setWorking(true)
    setError(null)
    try {
      const r = await fetch(`${API}/key`, { method: 'DELETE', headers: authHeader })
      if (!r.ok) throw new Error(await r.text())
      setApiKey(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  async function resetSession() {
    if (!apiKey) return
    setWorking(true)
    setError(null)
    try {
      const r = await fetch(`${API}/session`, { method: 'DELETE', headers: { 'X-API-Key': apiKey } })
      if (!r.ok && r.status !== 204) throw new Error(await r.text())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  function copy() {
    if (!apiKey) return
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="page-body" style={{ maxWidth: 640, margin: '0 auto', padding: '48px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'var(--accent-soft)', color: 'var(--accent-ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <KeyIcon />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Agent API Key</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Connect the FileO desktop app to this server</p>
        </div>
      </div>

      <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.7, margin: '16px 0 28px' }}>
        Generate one key per account and paste it into FileO's settings.
        The key authenticates your requests to the 5-worker agent pool running on this server.
      </p>

      {/* Error */}
      {error && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: 'oklch(0.25 0.08 25 / 0.2)', color: 'oklch(0.65 0.15 25)',
          border: '1px solid oklch(0.5 0.12 25 / 0.35)',
        }}>
          {error}
        </div>
      )}

      {/* Not logged in */}
      {!token && !loading && (
        <div style={{
          padding: '24px', borderRadius: 12, textAlign: 'center',
          background: 'var(--surface)', border: '1px solid var(--border)',
        }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
            Sign in with your account to generate or view your API key.
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && token && (
        <div style={{ padding: 24, color: 'var(--muted)', fontSize: 14 }}>Loading…</div>
      )}

      {/* Has key */}
      {!loading && token && apiKey && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Key display */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '16px 18px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--faint)', marginBottom: 10 }}>
              Your API Key
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <code style={{
                flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12.5,
                color: 'var(--c-sage)', wordBreak: 'break-all', lineHeight: 1.5,
              }}>
                {apiKey}
              </code>
              <button
                onClick={copy}
                className="btn btn-secondary"
                style={{ padding: '5px 10px', fontSize: 12, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Usage */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '16px 18px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--faint)', marginBottom: 10 }}>
              Usage in FileO
            </div>
            <pre style={{
              margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7,
              color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
{`POST ${window.location.origin}/api/agent/chat
X-API-Key: ${apiKey}

{ "message": "...", "tools": [] }`}
            </pre>
          </div>

          {/* Info */}
          <div style={{
            padding: '12px 16px', borderRadius: 10, fontSize: 13, color: 'var(--muted)',
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            lineHeight: 1.65,
          }}>
            The server runs <strong style={{ color: 'var(--ink-2)' }}>5 parallel agent workers</strong>. If all are busy, your request queues automatically. Each worker resumes your conversation history. Use "Reset session" to start fresh.
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              onClick={resetSession}
              disabled={working}
              className="btn btn-secondary"
              style={{ opacity: working ? 0.5 : 1 }}
            >
              Reset session
            </button>
            <button
              onClick={deleteKey}
              disabled={working}
              className="btn"
              style={{
                opacity: working ? 0.5 : 1,
                background: 'oklch(0.28 0.07 25 / 0.5)',
                color: 'oklch(0.65 0.15 25)',
                border: '1px solid oklch(0.45 0.1 25 / 0.4)',
              }}
            >
              Delete key
            </button>
          </div>
        </div>
      )}

      {/* No key yet */}
      {!loading && token && !apiKey && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '28px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
            You don't have an agent API key yet.<br/>
            Generate one to connect FileO to this server's agent pool.
          </div>
          <button
            onClick={generate}
            disabled={working}
            className="btn btn-primary"
            style={{ opacity: working ? 0.5 : 1 }}
          >
            {working ? 'Generating…' : 'Generate API key'}
          </button>
        </div>
      )}
    </main>
  )
}

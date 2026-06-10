import { useState, useEffect } from 'react'

const GITHUB_REPO = 'redusca/Licenta-App'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`

interface GhAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GhRelease {
  id: number
  tag_name: string
  name: string
  published_at: string
  prerelease: boolean
  draft: boolean
  html_url: string
  body?: string
  assets: GhAsset[]
}

function fmtSize(bytes: number) {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function WinIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 5.6L10.5 4.5V11.5H3V5.6ZM11.5 4.35L21 3V11.5H11.5V4.35ZM3 12.5H10.5V19.5L3 18.4V12.5ZM11.5 12.5H21V21L11.5 19.65V12.5Z"/>
    </svg>
  )
}

function DownloadArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  )
}

export default function Downloads() {
  const [releases, setReleases] = useState<GhRelease[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(RELEASES_API)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`)
        return r.json() as Promise<GhRelease[]>
      })
      .then(data => setReleases(data.filter(r => !r.draft)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const latest = releases.find(r => !r.prerelease) ?? releases[0]
  const winAsset = latest?.assets.find(a => /\.exe$/i.test(a.name))

  return (
    <main className="page-body dl-page">
      <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>
        Download Server
      </h1>
      <p style={{ margin: '0 0 36px', fontSize: 15, color: 'var(--muted)' }}>
        Windows installer for the AI backend server. Bundles the Electron app and the local Flask server.
      </p>

      {/* Main download card */}
      <div className="dl-card">
        <div className="dl-icon">
          <WinIcon />
        </div>
        <h2 className="dl-title">Windows Installer</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {latest && (
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
              background: 'var(--accent-soft)', color: 'var(--accent-ink)',
              border: '1px solid var(--border-2)',
            }}>
              {latest.tag_name}
            </span>
          )}
          {latest?.prerelease && (
            <span style={{
              fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 999,
              background: 'var(--surface-3)', color: 'var(--muted)',
              border: '1px solid var(--border)',
            }}>
              pre-release
            </span>
          )}
        </div>

        <p className="dl-sub">
          Windows 10 / 11 · x86-64 · Electron + Flask bundled
          {latest && ` · Released ${fmtDate(latest.published_at)}`}
          {winAsset?.size ? ` · ${fmtSize(winAsset.size)}` : ''}
        </p>

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading releases…</div>
        ) : error ? (
          <a
            href={`https://github.com/${GITHUB_REPO}/releases`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            View on GitHub ↗
          </a>
        ) : winAsset ? (
          <a
            href={winAsset.browser_download_url}
            className="btn btn-primary btn-lg"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}
          >
            <DownloadArrow />
            Download .exe
          </a>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>No binary attached yet</span>
        )}

        {/* Requirements */}
        <div className="dl-req" style={{ marginTop: 28 }}>
          <p className="dl-req-title">System requirements</p>
          {[
            'Windows 10 or Windows 11 (x86-64)',
            'No Python installation required — bundled via PyInstaller',
            '4 GB RAM recommended (8 GB for AI models)',
            'GPU optional — models fall back to CPU automatically',
            'Internet connection required for LLM API calls (Groq)',
          ].map(req => (
            <div key={req} className="dl-req-row">
              <div className="dl-dot"/>
              {req}
            </div>
          ))}
        </div>
      </div>

      {/* Older releases */}
      {!loading && !error && releases.length > 1 && (
        <p style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>
          Looking for an older version?{' '}
          <a
            href={`https://github.com/${GITHUB_REPO}/releases`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent-ink)' }}
          >
            View all releases on GitHub ↗
          </a>
        </p>
      )}

      {/* Docker section */}
      <section style={{ marginTop: 44 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', margin: '0 0 12px' }}>
          Self-host with Docker
        </h2>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 18px',
          fontFamily: 'var(--font-mono)', fontSize: 12.5,
          color: 'var(--ink-2)', lineHeight: 1.8,
        }}>
          <div style={{ color: 'var(--muted)', marginBottom: 4 }}># Full server stack</div>
          <div>docker compose -f Server/docker/docker-compose.yml up --build</div>
          <div style={{ color: 'var(--muted)', margin: '12px 0 4px' }}># Server image only</div>
          <div>docker pull ghcr.io/redusca/licenta-server:latest</div>
        </div>
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
          Source code and Dockerfiles on{' '}
          <a
            href={`https://github.com/${GITHUB_REPO}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent-ink)' }}
          >
            github.com/{GITHUB_REPO}
          </a>.
        </p>
      </section>
    </main>
  )
}

import { useState, useEffect } from 'react'

const GITHUB_REPO = 'redusca/Licenta-App'
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`
const RELEASES_API = '/api/releases'

// ── GitHub API types ──────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function assetFor(assets: GhAsset[], pattern: RegExp) {
  return assets.find(a => pattern.test(a.name))
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtSize(bytes: number) {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ── Download button ───────────────────────────────────────────────────────────

function DownloadButton({ asset, icon, label }: { asset?: GhAsset; icon: string; label: string }) {
  if (!asset) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800/40 border border-gray-700/40 opacity-40 cursor-not-allowed select-none">
        <span className="text-2xl">{icon}</span>
        <div>
          <div className="text-white font-medium text-sm">{label}</div>
          <div className="text-gray-600 text-xs">Not available</div>
        </div>
      </div>
    )
  }
  return (
    <a
      href={asset.browser_download_url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-brand-500/10 border border-brand-500/30 hover:bg-brand-500/20 hover:border-brand-500/60 transition-all group"
    >
      <span className="text-2xl">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-white font-medium text-sm group-hover:text-brand-300 transition-colors">{label}</div>
        {asset.size > 0 && <div className="text-gray-400 text-xs">{fmtSize(asset.size)}</div>}
      </div>
      <svg className="w-4 h-4 text-brand-400 group-hover:text-brand-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    </a>
  )
}

// ── Single release card ───────────────────────────────────────────────────────

function ReleaseCard({ release, isLatest }: { release: GhRelease; isLatest: boolean }) {
  const winAsset  = assetFor(release.assets, /\.exe$/i)
  const macAsset  = assetFor(release.assets, /\.dmg$/i)
  const linAsset  = assetFor(release.assets, /\.(AppImage|deb|tar\.gz)$/i)

  return (
    <section className="card mb-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <a
          href={release.html_url}
          target="_blank"
          rel="noreferrer"
          className="font-mono font-bold text-brand-400 hover:text-brand-300 transition-colors text-lg"
        >
          {release.tag_name}
        </a>

        {isLatest && (
          <span className="text-xs font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/40 px-2 py-0.5 rounded-full">
            Latest
          </span>
        )}
        {release.prerelease && (
          <span className="text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full">
            Pre-release
          </span>
        )}

        <span className="ml-auto text-xs text-gray-500">{fmtDate(release.published_at)}</span>
      </div>

      {/* ── Release name (if different from tag) ── */}
      {release.name && release.name !== release.tag_name && (
        <p className="text-gray-300 text-sm font-medium mb-2">{release.name}</p>
      )}

      {/* ── Release notes ── */}
      {release.body && (
        <p className="text-gray-500 text-sm mb-4 whitespace-pre-line leading-relaxed">{release.body}</p>
      )}

      {/* ── Download buttons ── */}
      {release.assets.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DownloadButton asset={winAsset} icon="🪟" label="Windows" />
          <DownloadButton asset={macAsset} icon="🍎" label="macOS" />
          <DownloadButton asset={linAsset} icon="🐧" label="Linux" />
        </div>
      ) : (
        <p className="text-xs text-gray-600 italic">No binaries attached — source only.</p>
      )}

      {/* ── Link to GitHub release page ── */}
      <div className="mt-4 pt-3 border-t border-gray-800 flex items-center gap-4 text-xs text-gray-600">
        <a
          href={release.html_url}
          target="_blank"
          rel="noreferrer"
          className="hover:text-brand-400 transition-colors"
        >
          View on GitHub ↗
        </a>
        {release.assets.map(a => (
          <a
            key={a.name}
            href={a.browser_download_url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-brand-400 transition-colors truncate"
            title={a.name}
          >
            {a.name}{a.size > 0 ? ` (${fmtSize(a.size)})` : ''}
          </a>
        ))}
      </div>
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

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
      // Show all releases (including pre-releases), skip drafts only
      .then(data => setReleases(data.filter(r => !r.draft)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Latest stable release (non-prerelease), or latest overall if none exists
  const latestStable = releases.find(r => !r.prerelease) ?? releases[0]

  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <div className="flex items-baseline justify-between mb-2">
        <h1 className="text-3xl font-bold text-white">Downloads</h1>
        <a
          href={GITHUB_RELEASES_PAGE}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
        >
          All releases on GitHub ↗
        </a>
      </div>
      <p className="text-gray-400 mb-10">
        Desktop client releases — each version links directly to its GitHub release page and assets.
      </p>

      {/* ── Loading / error states ───────────────────────────────────────────── */}
      {loading && (
        <div className="card mb-6">
          <p className="text-gray-500 text-sm">Loading releases…</p>
        </div>
      )}
      {error && (
        <div className="card mb-6 border-red-500/30">
          <p className="text-red-400 text-sm">Could not load releases: {error}</p>
        </div>
      )}
      {!loading && !error && releases.length === 0 && (
        <div className="card mb-6">
          <p className="text-gray-500 text-sm">No releases published yet.</p>
        </div>
      )}

      {/* ── Release list ─────────────────────────────────────────────────────── */}
      {releases.map(r => (
        <ReleaseCard key={r.id} release={r} isLatest={r.id === latestStable?.id} />
      ))}

      {/* ── Docker images ────────────────────────────────────────────────────── */}
      <section className="card mt-4">
        <h2 className="text-white font-semibold mb-4">Self-host with Docker</h2>
        <div className="font-mono text-sm text-green-400 bg-black/40 rounded-lg p-4 space-y-1.5">
          <div className="text-gray-600"># Container agent image</div>
          <div>docker pull ghcr.io/{GITHUB_REPO.split('/')[0]}/licenta-container:latest</div>
          <div className="pt-2 text-gray-600"># Full server stack (from repo root)</div>
          <div>docker compose -f Server/docker/docker-compose.yml up --build</div>
        </div>
        <p className="mt-3 text-xs text-gray-600">
          Source code and Dockerfiles are on{' '}
          <a
            href={`https://github.com/${GITHUB_REPO}`}
            target="_blank"
            rel="noreferrer"
            className="text-brand-400 hover:text-brand-300"
          >
            github.com/{GITHUB_REPO}
          </a>.
        </p>
      </section>
    </main>
  )
}
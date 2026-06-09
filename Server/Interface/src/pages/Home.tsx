import { Link } from 'react-router-dom'

const STATS = [
  { val: '4',       label: 'AI Models' },
  { val: '5',       label: 'Agent Workers' },
  { val: ':8000',   label: 'FastAPI Port' },
  { val: '2',       label: 'Deploy Modes' },
]

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    title: 'Auth & Access Control',
    desc: 'JWT-based authentication with Supabase PostgreSQL. Users register, receive tokens, and authenticate every API call. AgentKey table maps users to their AI gateway credentials.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
    ),
    title: 'AI Gateway',
    desc: 'Lazy-load/unload pattern for 4 models: Swin2SR (image super-resolution), Whisper (audio transcription), Gemini (language), and VideoSubtitle. Each loads on demand, unloads after idle timeout.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18M9 21V9"/>
      </svg>
    ),
    title: 'LangGraph Agent',
    desc: 'ReAct + Plan-and-Execute agent graph orchestrated by LangGraph. AgentPool maintains up to 5 concurrent workers, each backed by a Redis task queue (LPUSH/BRPOP) for durable message passing.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    title: 'SSE Streaming',
    desc: 'Agent progress streams via Server-Sent Events. The client receives real-time plan steps, tool call results, and final output — no polling, no websocket overhead.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    title: 'Human-in-the-Loop',
    desc: 'Tool execution requires approval from the FileO desktop app. The server POSTs tool call parameters to the callback_url, waits for approval, then continues the agent graph with the returned result.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    ),
    title: 'Self-Hostable',
    desc: 'Two deployment modes: server_proxy routes agent traffic through this server, direct_container runs locally inside the FileO Electron app. Docker Compose stack included.',
  },
]

export default function Home() {
  return (
    <main className="page-body">
      {/* Hero */}
      <section className="hero">
        <span className="hero-badge">FastAPI · LangGraph · Redis · Supabase</span>
        <h1 className="display" style={{ fontSize: 42, marginBottom: 18 }}>
          AI Agent Server<br />
          <em>built for FileO</em>
        </h1>
        <p className="hero-sub">
          A self-hostable FastAPI backend that manages authentication, runs
          AI models on demand, and orchestrates LangGraph agents with
          human-in-the-loop tool approval. Private by design.
        </p>
        <div className="hero-actions">
          <Link to="/downloads" className="btn btn-primary btn-lg">
            Download for Windows
          </Link>
          <Link to="/wiki" className="btn btn-secondary btn-lg">
            Read the docs
          </Link>
        </div>
      </section>

      {/* Stats */}
      <div className="stats-row">
        {STATS.map(s => (
          <div key={s.label} className="stat-card">
            <span className="stat-val">{s.val}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Features */}
      <section className="features-section">
        <p className="section-label">What's inside</p>
        <div className="features-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

    </main>
  )
}

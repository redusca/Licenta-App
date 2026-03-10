export default function Home() {
  return (
    <main className="max-w-6xl mx-auto px-4 py-16">
      {/* Hero */}
      <div className="text-center mb-20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-900/40 border border-brand-700/40 text-brand-400 text-xs font-medium mb-6">
          Open source · Self-hostable · Private AI
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold text-white tracking-tight mb-6 leading-tight">
          Run AI agents in<br />
          <span className="text-brand-400">secure containers</span>
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Licenta lets you deploy private AI agent environments backed by your own API key.
          Host on our server or bring your own infrastructure — your data never leaves your control.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <a href="/containers" className="btn-primary px-6 py-3 text-base">Get started</a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary px-6 py-3 text-base"
          >
            View on GitHub
          </a>
        </div>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {FEATURES.map(f => (
          <div key={f.title} className="card hover:border-gray-700 transition-colors">
            <div className="text-3xl mb-4">{f.icon}</div>
            <h3 className="text-white font-semibold mb-2">{f.title}</h3>
            <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Quick code sample */}
      <div className="mt-16 card">
        <h2 className="text-white font-semibold mb-4">Quick start</h2>
        <pre className="font-mono text-sm text-green-400 bg-black/40 rounded-lg p-4 overflow-x-auto">
{`# 1. Init your agent session
POST /api/agent/init
{ "tools": [{ "name": "search", "description": "...", "requires_ai": false }] }

# 2. Chat with the agent
POST /api/agent/chat
{ "session_id": "...", "message": "Find the latest news about AI" }

# Response
{ "response": "...", "tool_calls": [...], "secondary_ai_calls": [...] }`}
        </pre>
      </div>
    </main>
  )
}

const FEATURES = [
  {
    icon: '🔒',
    title: 'Private by design',
    desc: 'Each user gets their own isolated container. Your AI key and data never touch anyone else\'s environment.',
  },
  {
    icon: '🚀',
    title: 'One-click deploy',
    desc: 'Register, paste your Gemini API key, click Deploy. Your container is live in seconds on our infrastructure.',
  },
  {
    icon: '🔧',
    title: 'Bring your own tools',
    desc: 'Define custom tools at session init time. The agent picks them up automatically and can call the AI for tool-level reasoning.',
  },
]

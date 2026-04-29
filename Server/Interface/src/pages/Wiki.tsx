const SECTIONS = [
  {
    title: 'Architecture overview',
    content: `The Licenta platform consists of three components:

• **Server** — FastAPI backend managing accounts, container lifecycle, and acting as an HTTP proxy for server-hosted agent containers. Backed by PostgreSQL.

• **Container** — Per-user FastAPI + LangChain service running a Gemini-powered ReAct agent. Each container is isolated and authenticated via a unique API key.

• **APP** — Electron desktop app with a React UI, virtual drive management, and a chat interface that connects to the container agent.`,
  },
  {
    title: 'Agent API',
    content: `The container exposes three endpoints under \`/api/agent\`:

**POST /api/agent/init**  
Create a new agent session with a list of tool definitions.  
\`{ "tools": [{ "name": "...", "description": "...", "parameters": {}, "requires_ai": false }] }\`

**POST /api/agent/chat**  
Send a message to an existing session.  
\`{ "session_id": "...", "message": "..." }\`

**GET /api/agent/sessions**  
List active session IDs.`,
  },
  {
    title: 'Tool definitions',
    content: `Tools are defined at session init time. Each tool has:

- \`name\` — unique identifier
- \`description\` — what the agent sees when choosing tools  
- \`parameters\` — JSON Schema dict of expected input
- \`requires_ai\` — if true, the tool makes a secondary LLM call (3-tier pattern)

Tools with \`requires_ai: true\` allow the agent to delegate sub-tasks back to Gemini (e.g. summarise, classify, extract).`,
  },
  {
    title: 'Deployment modes',
    content: `**Server-hosted**: The server deploys your container as a Docker sibling container. You access it via \`POST /api/containers/proxy/{path}\` — the server transparently forwards calls, injecting your container API key.

**Self-hosted**: You run the container on your own infrastructure. Register its public URL in the platform. The APP communicates directly with your container — the server is not in the call path.`,
  },
]

export default function Wiki() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-white mb-2">Wiki</h1>
      <p className="text-gray-400 mb-10">Documentation and architecture reference.</p>
      <div className="space-y-6">
        {SECTIONS.map(s => (
          <div key={s.title} className="card">
            <h2 className="text-white font-semibold text-lg mb-3">{s.title}</h2>
            <div className="text-gray-400 text-sm leading-relaxed whitespace-pre-wrap">{s.content}</div>
          </div>
        ))}
      </div>
    </main>
  )
}

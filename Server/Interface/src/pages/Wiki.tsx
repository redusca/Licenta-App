import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

// ── Types ──────────────────────────────────────────────────────────────────────

interface WikiSection { id: string; label: string; pages: WikiPage[] }
interface WikiPage    { id: string; title: string; content: React.ReactNode }

// ── Helpers ────────────────────────────────────────────────────────────────────

function Code({ children }: { children: React.ReactNode }) {
  return <code className="wiki-inline-code">{children}</code>
}

function CodeBlock({ children, lang }: { children: string; lang?: string }) {
  return (
    <div className="wiki-code">
      {lang && <div className="wiki-code-lang">{lang}</div>}
      <pre><code>{children}</code></pre>
    </div>
  )
}

interface EndpointProps {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT'
  path: string; desc: string; auth?: boolean; body?: string; response?: string
}
function Endpoint({ method, path, desc, auth, body, response }: EndpointProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ep-card">
      <div className="ep-header" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
        <span className={`ep-badge m-${method}`}>{method}</span>
        <code className="ep-path">{path}</code>
        <span className="ep-desc">{desc}</span>
        {auth && <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', padding: '2px 7px', borderRadius: 999, border: '1px solid var(--border)', marginLeft: 'auto', flexShrink: 0 }}>auth</span>}
        <span style={{ fontSize: 11, color: 'var(--faint)', marginLeft: auth ? 6 : 'auto', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (body || response) && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface-2)' }}>
          {body && <div><div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Request body</div><pre style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', lineHeight: 1.6 }}>{body}</pre></div>}
          {response && <div><div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--faint)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Response</div><pre style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', lineHeight: 1.6 }}>{response}</pre></div>}
        </div>
      )}
    </div>
  )
}

function WikiTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 18 }}>
      <table className="wiki-table">
        <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

// ── SVG diagram components ─────────────────────────────────────────────────────

function DiagramBox({ x, y, w, h, label, sublabel, accent }: { x: number; y: number; w: number; h: number; label: string; sublabel?: string; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8"
        fill={accent ? 'var(--accent-soft)' : 'var(--surface-2)'}
        stroke={accent ? 'var(--accent)' : 'var(--border-2)'}
        strokeWidth="1.5"
      />
      <text x={x + w / 2} y={y + h / 2 - (sublabel ? 8 : 0)} textAnchor="middle" dominantBaseline="middle"
        fontSize="12" fontWeight="600" fill={accent ? 'var(--accent-ink)' : 'var(--ink)'} fontFamily="var(--font-display)">
        {label}
      </text>
      {sublabel && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" dominantBaseline="middle"
          fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-display)">
          {sublabel}
        </text>
      )}
    </g>
  )
}

function Arrow({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label?: string }) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  return (
    <g>
      <defs>
        <marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="var(--border-2)"/>
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border-2)" strokeWidth="1.5" markerEnd="url(#ah)"/>
      {label && <text x={mx + 4} y={my - 4} fontSize="10" fill="var(--muted)" fontFamily="var(--font-display)">{label}</text>}
    </g>
  )
}

function SvgWrap({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  return (
    <div className="wiki-diagram" style={{ padding: '20px', marginBottom: 18 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', maxWidth: w }}>
        {children}
      </svg>
    </div>
  )
}

// Diagram 1: Server architecture overview
function ArchDiagram() {
  return (
    <SvgWrap w={620} h={280}>
      {/* Server outer box */}
      <rect x="10" y="10" width="440" height="160" rx="12" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="6 3"/>
      <text x="230" y="30" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--faint)" fontFamily="var(--font-display)" letterSpacing="0.08em">LICENTA SERVER :8000</text>
      <DiagramBox x={24}  y={44} w={120} h={54} label="Auth" sublabel="/auth/*"/>
      <DiagramBox x={160} y={44} w={140} h={54} label="AI Gateway" sublabel="/ai/*"/>
      <DiagramBox x={316} y={44} w={120} h={54} label="Agent API" sublabel="/agent/*" accent/>

      {/* Redis */}
      <DiagramBox x={160} y={130} w={140} h={34} label="Redis Queue"/>

      {/* Arrow agent → redis */}
      <Arrow x1={376} y1={98} x2={300} y2={137} label="LPUSH"/>

      {/* FileO and Browser */}
      <DiagramBox x={470} y={44}  w={140} h={40} label="FileO Desktop" sublabel="tool callbacks" accent/>
      <DiagramBox x={470} y={100} w={140} h={40} label="Browser Client" sublabel="SSE stream"/>

      {/* Arrows agent → external */}
      <Arrow x1={436} y1={62} x2={470} y2={62}/>
      <Arrow x1={436} y1={84} x2={470} y2={118}/>
    </SvgWrap>
  )
}

// Diagram 2: User / AgentKey data model
function DataModelDiagram() {
  return (
    <SvgWrap w={500} h={200}>
      {/* User box */}
      <rect x="20" y="20" width="190" height="160" rx="8" fill="var(--surface)" stroke="var(--border-2)" strokeWidth="1.5"/>
      <rect x="20" y="20" width="190" height="32" rx="8" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5"/>
      <text x="115" y="41" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--accent-ink)" fontFamily="var(--font-display)">User</text>
      {[['id','UUID (PK)'],['email','TEXT UNIQUE'],['hashed_pw','TEXT'],['created_at','TIMESTAMPTZ']].map(([f, t], i) => (
        <g key={f}>
          <text x="34" y={72 + i * 24} fontSize="11" fontWeight="500" fill="var(--ink-2)" fontFamily="var(--font-mono)">{f}</text>
          <text x="206" y={72 + i * 24} textAnchor="end" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-mono)">{t}</text>
        </g>
      ))}

      {/* AgentKey box */}
      <rect x="290" y="20" width="190" height="160" rx="8" fill="var(--surface)" stroke="var(--border-2)" strokeWidth="1.5"/>
      <rect x="290" y="20" width="190" height="32" rx="8" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5"/>
      <text x="385" y="41" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--accent-ink)" fontFamily="var(--font-display)">AgentKey</text>
      {[['id','UUID (PK)'],['user_id','UUID (FK)'],['key_hash','TEXT'],['label','TEXT'],['created_at','TIMESTAMPTZ']].map(([f, t], i) => (
        <g key={f}>
          <text x="304" y={72 + i * 24} fontSize="11" fontWeight="500" fill={f === 'user_id' ? 'var(--accent-ink)' : 'var(--ink-2)'} fontFamily="var(--font-mono)">{f}</text>
          <text x="476" y={72 + i * 24} textAnchor="end" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-mono)">{t}</text>
        </g>
      ))}

      {/* FK line */}
      <line x1="210" y1="88" x2="290" y2="88" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3"/>
      <circle cx="210" cy="88" r="3" fill="var(--accent)"/>
      <circle cx="290" cy="88" r="3" fill="var(--accent)"/>
    </SvgWrap>
  )
}

// Diagram 3: BaseAIModel hierarchy
function ModelHierarchyDiagram() {
  return (
    <SvgWrap w={560} h={200}>
      {/* Base */}
      <DiagramBox x={170} y={10} w={220} h={52} label="BaseAIModel" sublabel="load · unload · run · _auto_unload_loop" accent/>

      {/* Lines down */}
      {[60, 170, 280, 390].map((cx, i) => (
        <g key={i}>
          <line x1={280} y1={62} x2={cx + 55} y2={130} stroke="var(--border-2)" strokeWidth="1.5"/>
          <rect x={cx} y={130} width="110" height="44" rx="7" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1.5"/>
        </g>
      ))}
      {['Swin2SR','Whisper','GeminiModel','VideoSubtitle'].map((name, i) => (
        <text key={name} x={115 + i * 110} y={156} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-display)">{name}</text>
      ))}
    </SvgWrap>
  )
}

// Diagram 4: AgentPool + Redis + workers
function AgentPoolDiagram() {
  return (
    <SvgWrap w={580} h={240}>
      {/* AgentPool */}
      <rect x="10" y="10" width="200" height="130" rx="10" fill="var(--surface)" stroke="var(--border-2)" strokeWidth="1.5"/>
      <rect x="10" y="10" width="200" height="32" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5"/>
      <text x="110" y="30" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--accent-ink)" fontFamily="var(--font-display)">AgentPool</text>
      {['submit_task(session_id, msg)','get_session(session_id)','stream_events(session_id)'].map((m, i) => (
        <text key={m} x="22" y={60 + i * 22} fontSize="10.5" fill="var(--ink-2)" fontFamily="var(--font-mono)">{m}</text>
      ))}

      {/* Redis */}
      <DiagramBox x={260} y={30} w={120} h={44} label="Redis" sublabel="agent:tasks"/>

      {/* Workers */}
      {[0,1,2,3,4].map(i => (
        <rect key={i} x={260 + i * 62} y={130} width="52" height="28" rx="6"
          fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1.5"/>
      ))}
      {[0,1,2,3,4].map(i => (
        <text key={i} x={286 + i * 62} y={149} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-display)">W{i+1}</text>
      ))}
      <text x="390" y="200" textAnchor="middle" fontSize="10.5" fill="var(--faint)" fontFamily="var(--font-display)">5 concurrent workers</text>

      {/* Arrows */}
      <Arrow x1={210} y1={55} x2={260} y2={55} label="LPUSH"/>
      <Arrow x1={320} y1={74} x2={320} y2={130} label="BRPOP"/>

      {/* LangGraph label */}
      <rect x="360" y="170" width="100" height="24" rx="6" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1"/>
      <text x="410" y="185" textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-display)">LangGraph graph</text>
      <line x1="286" y1="158" x2="360" y2="176" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 2"/>
    </SvgWrap>
  )
}

// Diagram 5: Human-in-the-loop sequence
function HitlDiagram() {
  const col1 = 80, col2 = 380
  const rows = [60, 100, 145, 190, 240, 285, 325]
  return (
    <SvgWrap w={500} h={360}>
      {/* Swimlane headers */}
      <rect x="20" y="10" width="160" height="32" rx="7" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5"/>
      <text x={col1} y="30" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--accent-ink)" fontFamily="var(--font-display)">Agent Graph</text>
      <rect x="310" y="10" width="170" height="32" rx="7" fill="var(--surface-2)" stroke="var(--border-2)" strokeWidth="1.5"/>
      <text x={col2} y="30" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink-2)" fontFamily="var(--font-display)">FileO Desktop</text>

      {/* Lifelines */}
      <line x1={col1} y1={42} x2={col1} y2={340} stroke="var(--border)" strokeWidth="1" strokeDasharray="5 4"/>
      <line x1={col2} y1={42} x2={col2} y2={340} stroke="var(--border)" strokeWidth="1" strokeDasharray="5 4"/>

      {/* Step labels */}
      {[
        { y: rows[0], from: col1, to: col2, dir: 1, label: 'POST /tool-call', sub: '{ tool, params, call_id }' },
        { y: rows[2], from: col2, to: col1, dir: -1, label: '(user approves in UI)', sub: null },
        { y: rows[4], from: col2, to: col1, dir: -1, label: 'POST /agent/tool-result', sub: '{ call_id, result, approved }' },
        { y: rows[6], from: col1, to: col1, dir: 0, label: 'graph resumes', sub: null },
      ].map(({ y, from, to, dir, label, sub }, i) => (
        <g key={i}>
          {dir !== 0 ? (
            <>
              <defs>
                <marker id={`ah${i}`} markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L7,3 z" fill="var(--border-2)"/>
                </marker>
              </defs>
              <line x1={from} y1={y} x2={to} y2={y} stroke="var(--border-2)" strokeWidth="1.5" markerEnd={`url(#ah${i})`}/>
            </>
          ) : (
            <rect x={col1 - 60} y={y - 10} width="120" height="22" rx="6" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1"/>
          )}
          <text x={(from + to) / 2} y={y - 8} textAnchor="middle" fontSize="11" fontWeight="500" fill="var(--ink-2)" fontFamily="var(--font-display)">{label}</text>
          {sub && <text x={(from + to) / 2} y={y + 16} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{sub}</text>}
        </g>
      ))}

      {/* "pause" annotation */}
      <rect x="120" y="108" width="80" height="28" rx="6" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1"/>
      <text x="160" y="126" textAnchor="middle" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-display)">⏸ paused</text>

      {/* FileO approval box */}
      <rect x="300" y="108" width="162" height="28" rx="6" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1"/>
      <text x="381" y="126" textAnchor="middle" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-display)">approval dialog shown</text>
    </SvgWrap>
  )
}

// ── Content pages ──────────────────────────────────────────────────────────────

const OVERVIEW_PAGE: WikiPage = {
  id: 'overview', title: 'Overview',
  content: (
    <>
      <p>
        The Licenta Server is a self-hostable FastAPI backend that provides authentication,
        an AI model gateway, and an agent orchestration system for the FileO desktop application.
        It runs on <Code>127.0.0.1:8000</Code> and communicates with the Electron app over localhost.
      </p>
      <h3>Component map</h3>
      <ArchDiagram />
      <h3>Deployment modes</h3>
      <p>Two modes via <Code>agent_config.json</Code>:</p>
      <ul>
        <li><strong>server_proxy</strong> — Agent traffic is routed through this server. The FileO app connects to the public server URL; all model calls happen server-side.</li>
        <li><strong>direct_container</strong> — The server runs locally inside the Electron app process. The FileO app communicates directly with <Code>localhost:8000</Code>.</li>
      </ul>
      <h3>Tech stack summary</h3>
      <WikiTable
        headers={['Layer', 'Technology', 'Purpose']}
        rows={[
          ['API', 'FastAPI + Uvicorn', 'Async HTTP, automatic OpenAPI docs'],
          ['Agent', 'LangGraph', 'ReAct + Plan-and-Execute graph execution'],
          ['Queue', 'Redis (LPUSH/BRPOP)', 'Durable task queue for agent workers'],
          ['AI models', 'Swin2SR, Whisper, Gemini, VideoSubtitle', 'Lazy-loaded AI gateway'],
          ['Database', 'Supabase PostgreSQL', 'Users and AgentKey persistence'],
          ['Auth', 'JWT (python-jose)', 'Stateless token authentication'],
          ['Desktop', 'Electron + React + TypeScript', 'FileO desktop application shell'],
        ]}
      />
    </>
  ),
}

const AUTH_PAGE: WikiPage = {
  id: 'auth', title: 'Authentication',
  content: (
    <>
      <p>
        All API endpoints (except <Code>/auth/register</Code> and <Code>/auth/login</Code>) require a
        JWT Bearer token. Tokens are issued at login and stored in <Code>localStorage</Code> by the
        frontend. The <Code>User</Code> and <Code>AgentKey</Code> tables live in Supabase PostgreSQL.
      </p>
      <h3>Data model</h3>
      <DataModelDiagram />
      <h3>Endpoints</h3>
      <Endpoint method="POST" path="/auth/register" desc="Create a new user account"
        body={`{\n  "email": "user@example.com",\n  "password": "secret123"\n}`}
        response={`{\n  "id": "uuid",\n  "email": "user@example.com"\n}`}
      />
      <Endpoint method="POST" path="/auth/login" desc="Obtain a JWT access token"
        body={`{\n  "email": "user@example.com",\n  "password": "secret123"\n}`}
        response={`{\n  "access_token": "eyJ...",\n  "token_type": "bearer"\n}`}
      />
      <Endpoint method="GET" path="/auth/me" desc="Return the authenticated user's profile" auth
        response={`{\n  "id": "uuid",\n  "email": "user@example.com",\n  "created_at": "2024-01-01T00:00:00Z"\n}`}
      />
      <Endpoint method="POST" path="/auth/keys" desc="Store a new AI gateway key" auth
        body={`{\n  "key": "sk-...",\n  "label": "Gemini key"\n}`}
        response={`{ "id": "uuid", "label": "Gemini key" }`}
      />
      <h3>Token lifecycle</h3>
      <p>
        Tokens are signed with <Code>HS256</Code> and expire after 7 days. The secret is read
        from the <Code>JWT_SECRET</Code> environment variable. Users re-authenticate after expiry.
      </p>
    </>
  ),
}

const AI_GATEWAY_PAGE: WikiPage = {
  id: 'ai-gateway', title: 'AI Gateway',
  content: (
    <>
      <p>
        The AI Gateway manages four AI models under a lazy-load/unload pattern.
        Each model extends <Code>BaseAIModel</Code> and is loaded on first use,
        then unloaded after an idle timeout to reclaim VRAM/RAM.
      </p>
      <h3>BaseAIModel hierarchy</h3>
      <ModelHierarchyDiagram />
      <h3>Models</h3>
      <WikiTable
        headers={['Model', 'Input', 'Output', 'usesAI', 'Backend']}
        rows={[
          ['Swin2SR', 'Image file', 'Upscaled image', 'No', 'PyTorch (local)'],
          ['Whisper', 'Audio file', 'Transcript text', 'No', 'OpenAI Whisper (local)'],
          ['GeminiModel', 'Text prompt', 'Text response', 'Yes', 'Gemini API (remote)'],
          ['VideoSubtitle', 'Video file', 'SRT subtitle file', 'No', 'Whisper + FFmpeg (local)'],
        ]}
      />
      <h3>Endpoints</h3>
      <Endpoint method="POST" path="/ai/upscale" desc="Upscale an image using Swin2SR" auth
        body={`multipart/form-data\n{\n  "file": <image binary>,\n  "scale": 2\n}`}
        response={`{ "url": "/static/output/<uuid>.png", "width": 1024, "height": 1024 }`}
      />
      <Endpoint method="POST" path="/ai/transcribe" desc="Transcribe audio using Whisper" auth
        body={`multipart/form-data\n{\n  "file": <audio binary>,\n  "language": "en"\n}`}
        response={`{ "text": "Transcribed content...", "segments": [...] }`}
      />
      <Endpoint method="POST" path="/ai/llm/generate" desc="Send a prompt to the Groq LLM" auth
        body={`{\n  "prompt": "Explain LangGraph",\n  "history": []\n}`}
        response={`{ "response": "LangGraph is a library...", "tokens_used": 142 }`}
      />
      <Endpoint method="POST" path="/ai/subtitle" desc="Generate subtitles for a video file" auth
        body={`multipart/form-data\n{\n  "file": <video binary>,\n  "language": "ro"\n}`}
        response={`{ "srt_url": "/static/output/<uuid>.srt" }`}
      />
      <Endpoint method="GET" path="/ai/status" desc="Return load state of all models" auth
        response={`{\n  "status": "ok",\n  "models": [\n    { "name": "swin2sr", "is_loaded": false, "device": "cpu" },\n    { "name": "whisper", "is_loaded": true,  "device": "cpu" }\n  ]\n}`}
      />
    </>
  ),
}

const AGENT_PAGE: WikiPage = {
  id: 'agent', title: 'Agent System',
  content: (
    <>
      <p>
        The agent system uses LangGraph to build a ReAct + Plan-and-Execute graph.
        An <Code>AgentPool</Code> maintains up to 5 concurrent worker threads, each listening
        on a Redis list (<Code>BRPOP agent:tasks</Code>). SSE streams progress back to clients.
      </p>
      <h3>AgentPool + Redis + workers</h3>
      <AgentPoolDiagram />
      <h3>LangGraph nodes</h3>
      <WikiTable
        headers={['Node', 'Role', 'Output']}
        rows={[
          ['plan', 'Groq LLM decomposes the user task into ordered steps', 'List of step strings'],
          ['execute', 'Dispatches the next step to ReAct sub-graph', 'Tool call or direct answer'],
          ['tool', 'POSTs to callback_url, waits for FileO approval', 'Tool execution result'],
          ['reflect', 'Checks if all steps are done or re-plans', 'done | replan | next_step'],
        ]}
      />
      <h3>Human-in-the-loop</h3>
      <p>
        When the agent selects a tool, the <Code>tool</Code> node sends an HTTP POST to
        the FileO app's <Code>callback_url</Code>. The graph pauses. FileO shows an approval
        dialog. On approval, it POSTs the result back to <Code>/agent/tool-result/&lt;call_id&gt;</Code>
        and the graph resumes.
      </p>
      <HitlDiagram />
      <h3>Endpoints</h3>
      <Endpoint method="POST" path="/agent/session" desc="Create a new agent session" auth
        body={`{\n  "callback_url": "http://127.0.0.1:9000/tool-approval",\n  "tools": ["image_convert", "audio_transcribe"]\n}`}
        response={`{ "session_id": "uuid" }`}
      />
      <Endpoint method="POST" path="/agent/chat" desc="Send a message; returns task_id for SSE" auth
        body={`{\n  "session_id": "uuid",\n  "message": "Transcribe all audio files in drive X"\n}`}
        response={`{ "task_id": "uuid" }`}
      />
      <Endpoint method="GET" path="/agent/stream/{session_id}" desc="SSE stream of agent events" auth
        response={`data: {"type":"plan","steps":["Step 1","Step 2"]}\ndata: {"type":"tool_call","tool":"audio_transcribe","params":{...}}\ndata: {"type":"done","answer":"All files transcribed."}`}
      />
      <Endpoint method="POST" path="/agent/tool-result/{call_id}" desc="Human-in-the-loop callback from FileO"
        body={`{\n  "result": { "transcript": "Hello world..." },\n  "approved": true\n}`}
        response={`{ "status": "resumed" }`}
      />
      <Endpoint method="GET" path="/agent/sessions" desc="List active sessions for the authenticated user" auth
        response={`[{ "session_id": "uuid", "created_at": "...", "status": "idle" }]`}
      />
    </>
  ),
}

const TECH_STACK_PAGE: WikiPage = {
  id: 'tech-stack', title: 'Tech Stack',
  content: (
    <>
      <p>Full dependency list for the server component.</p>
      <h3>Server dependencies</h3>
      <WikiTable
        headers={['Package', 'Version', 'Role']}
        rows={[
          ['fastapi + uvicorn', '≥0.110 / ≥0.29', 'Async HTTP framework + ASGI server'],
          ['sqlalchemy + alembic', 'latest', 'ORM and database migrations (PostgreSQL)'],
          ['psycopg2-binary', 'latest', 'PostgreSQL driver'],
          ['python-jose[cryptography]', '≥3.3', 'JWT signing and verification'],
          ['bcrypt', 'latest', 'Password hashing'],
          ['pydantic-settings', '≥2.0', 'Settings and request/response validation'],
          ['httpx', '≥0.27', 'Async HTTP client for tool callbacks'],
          ['redis[asyncio]', '≥5.0', 'Task queue (LPUSH/BRPOP) and pub/sub'],
          ['groq', '≥0.9', 'Groq LLM client (planning agent + LLM chat endpoints)'],
          ['langchain + langgraph', 'latest', 'ReAct agent graph execution'],
          ['langchain-google-genai', '≥1.0', 'Google AI SDK (tool-calling agent)'],
          ['torch + torchvision', '≥2.2', 'PyTorch for Swin2SR inference (CPU wheels)'],
          ['transformers + accelerate', 'latest', 'Whisper Large V3 inference'],
          ['pillow + numpy', '≥10.0', 'Image processing for Swin2SR'],
          ['soundfile', 'latest', 'Audio decoding for Whisper'],
        ]}
      />
      <h3>FileO desktop stack</h3>
      <WikiTable
        headers={['Technology', 'Role']}
        rows={[
          ['Electron 30', 'Desktop shell, IPC with renderer'],
          ['React 18 + TypeScript', 'Frontend UI'],
          ['Vite 5', 'Frontend build tool'],
          ['Flask 3 + Python 3.11', 'Local backend API (bundled via PyInstaller)'],
          ['Pillow, FFmpeg, SQLite', 'File processing tools'],
          ['Tailwind CSS', 'UI styling'],
        ]}
      />
      <h3>Infrastructure</h3>
      <WikiTable
        headers={['Service', 'Provider', 'Notes']}
        rows={[
          ['PostgreSQL', 'Self-hosted or cloud', 'User + AgentKey tables; configured via DATABASE_URL'],
          ['Redis', 'Self-hosted or Redis Cloud', 'Required for agent task queue; configured via REDIS_URL'],
          ['Groq API', 'Groq', 'GROQ_API_KEY required — planning agent and LLM chat endpoints'],
          ['Google AI API', 'Google', 'GOOGLE_API_KEY required — ReAct tool-calling agent'],
          ['Container', 'Docker / docker-compose', 'Compose stacks in Server/docker/'],
        ]}
      />
    </>
  ),
}

const IMPLEMENTATION_PAGE: WikiPage = {
  id: 'implementation', title: 'Implementation Notes',
  content: (
    <>
      <h3>Model lazy-load pattern</h3>
      <p>
        Each AI model is a singleton that loads itself on the first <Code>run()</Code> call
        and starts a background coroutine that unloads it after <Code>idle_timeout</Code> seconds
        of inactivity.
      </p>
      <CodeBlock lang="python">{`class BaseAIModel:
    def __init__(self, idle_timeout: int = 300):
        self._model = None
        self._loaded = False
        self._last_used = 0.0
        self.idle_timeout = idle_timeout

    async def run(self, *args, **kwargs):
        if not self._loaded:
            await self.load()
        self._last_used = time.time()
        return await self._run(*args, **kwargs)

    async def _auto_unload_loop(self):
        while True:
            await asyncio.sleep(30)
            if self._loaded and (time.time() - self._last_used) > self.idle_timeout:
                await self.unload()`}</CodeBlock>
      <h3>Redis task queue</h3>
      <p>
        Tasks are serialised to JSON and pushed onto <Code>agent:tasks</Code>.
        Each worker calls <Code>BRPOP agent:tasks 0</Code> (blocking). Progress events are published
        to <Code>agent:events:&lt;session_id&gt;</Code> for the SSE endpoint.
      </p>
      <CodeBlock lang="python">{`# Submit
redis.lpush("agent:tasks", json.dumps({
    "task_id": task_id, "session_id": session_id, "message": message,
}))

# Worker
while True:
    _, raw = redis.brpop("agent:tasks")
    task = json.loads(raw)
    async for event in run_agent_graph(task):
        redis.publish(f"agent:events:{task['session_id']}", json.dumps(event))`}</CodeBlock>
      <h3>SSE streaming</h3>
      <CodeBlock lang="python">{`@router.get("/agent/stream/{session_id}")
async def stream_events(session_id: str, user=Depends(get_current_user)):
    async def event_generator():
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"agent:events:{session_id}")
        async for message in pubsub.listen():
            if message["type"] == "message":
                yield f"data: {message['data']}\\n\\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")`}</CodeBlock>
      <h3>Virtual Drive integration</h3>
      <p>
        The FileO local Flask server exposes <Code>/api/drive</Code> endpoints for creating,
        listing, and deleting virtual drives. A virtual drive is a logical folder grouping
        backed by symlinks or physical file moves on NTFS, registered in a local SQLite database.
      </p>
    </>
  ),
}

// ── Registry ───────────────────────────────────────────────────────────────────

const SECTIONS: WikiSection[] = [
  { id: 'getting-started', label: 'Getting Started', pages: [OVERVIEW_PAGE] },
  { id: 'api', label: 'API Reference', pages: [AUTH_PAGE, AI_GATEWAY_PAGE, AGENT_PAGE] },
  { id: 'reference', label: 'Reference', pages: [TECH_STACK_PAGE, IMPLEMENTATION_PAGE] },
]
const ALL_PAGES: WikiPage[] = SECTIONS.flatMap(s => s.pages)

// ── Component ──────────────────────────────────────────────────────────────────

export default function Wiki() {
  const params = useParams<{ section?: string }>()
  const navigate = useNavigate()

  const currentId = params.section ?? 'overview'
  const currentPage = ALL_PAGES.find(p => p.id === currentId) ?? ALL_PAGES[0]

  return (
    <div className="page-body wiki-layout">
      <aside className="wiki-sidebar">
        {SECTIONS.map(section => (
          <div key={section.id} style={{ marginBottom: 20 }}>
            <div className="wiki-sidebar-label">{section.label}</div>
            <div className="wiki-sub-pages">
              {section.pages.map(page => (
                <button
                  key={page.id}
                  className={'wiki-page-btn' + (page.id === currentPage.id ? ' active' : '')}
                  onClick={() => navigate(`/wiki/${page.id}`)}
                >
                  {page.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>
      <article className="wiki-content">
        <div className="wiki-breadcrumb">
          <span>Wiki</span>
          <span>/</span>
          <span style={{ color: 'var(--ink)' }}>{currentPage.title}</span>
        </div>
        <h1 className="wiki-h1">{currentPage.title}</h1>
        <div className="wiki-body">
          {currentPage.content}
        </div>
      </article>
    </div>
  )
}

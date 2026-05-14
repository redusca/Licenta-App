import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import {
  Send, Loader2, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, ChevronLeft,
  Plus, Trash2, AlertCircle, Eye, EyeOff,
  Paperclip, HardDrive, FileText, X, Upload,
  ExternalLink, Sparkles, History,
} from 'lucide-react';
import { ToolApprovalCard, PendingTool } from '../components/ToolApprovalModal';
import { FolderPickerModal } from '../components/FolderPickerModal';

const AGENT = 'http://127.0.0.1:5000/api/agent';
const TOOLS = 'http://127.0.0.1:5000/api/tools';
const LS_HISTORY = 'chat_history';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Attachment {
  id: string;
  type: 'file' | 'drive';
  path: string;
  name: string;
}

interface LiveStep {
  id: number;
  description: string;
  type: 'tool' | 'llm';
  tool?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
}

interface LiveRun {
  status: string;
  plan: LiveStep[];
  synthesis: string;
}

interface ChatEntry {
  id: string;
  kind: 'user' | 'assistant' | 'error';
  content: string;
  attachments?: Attachment[];
}

interface HistoryChat {
  id: string;
  chatId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  entries: ChatEntry[];
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadHistory(): HistoryChat[] {
  try {
    return JSON.parse(localStorage.getItem(LS_HISTORY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(list: HistoryChat[]): void {
  const trimmed = list.slice(0, 30).map(c => ({
    ...c,
    entries: c.entries.slice(-60),
  }));
  localStorage.setItem(LS_HISTORY, JSON.stringify(trimmed));
}

function titleFromEntries(entries: ChatEntry[]): string {
  const first = entries.find(e => e.kind === 'user');
  if (!first) return 'New chat';
  return first.content.slice(0, 50) + (first.content.length > 50 ? '…' : '');
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const Avatar: React.FC<{ kind: 'bot' | 'user' }> = ({ kind }) => {
  if (kind === 'bot') {
    return (
      <div style={{
        width: 32, height: 32, borderRadius: 'var(--r-control)', flexShrink: 0,
        background: 'var(--accent-soft)', color: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Sparkles size={15} />
      </div>
    );
  }
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 'var(--r-control)', flexShrink: 0,
      background: 'var(--surface-2)', color: 'var(--ink-2)',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 600, fontSize: 13,
    }}>
      A
    </div>
  );
};

// ── Attachment chip ───────────────────────────────────────────────────────────

const AttachmentChip: React.FC<{ a: Attachment; onRemove?: () => void }> = ({ a, onRemove }) => {
  const tone = a.type === 'drive' ? 'sky' : 'sage';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 9px', fontSize: 11.5, fontWeight: 500,
      background: `var(--c-${tone}-bg)`, color: `var(--c-${tone})`,
      borderRadius: 'var(--r-pill)', maxWidth: 180,
    }}>
      {a.type === 'drive' ? <HardDrive size={11} /> : <FileText size={11} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          style={{ marginLeft: 2, display: 'flex', alignItems: 'center', color: 'inherit', opacity: 0.7 }}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
};

// ── Result renderer ────────────────────────────────────────────────────────────

function looksLikeFolder(p: string): boolean {
  const last = p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
  return !last.includes('.');
}

const ResultView: React.FC<{ raw: string }> = ({ raw }) => {
  const navigate = useNavigate();
  const trimmed = raw.trim();

  let node: React.ReactNode;
  let drivePath: string | null = null;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('primitive');

    if (parsed.virtualDrivePath) {
      drivePath = parsed.virtualDrivePath;
    } else if (parsed.outputPath && looksLikeFolder(parsed.outputPath)) {
      drivePath = parsed.outputPath;
    }

    if (Array.isArray(parsed.files)) {
      const files = parsed.files as any[];
      node = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{files.length} item(s)</p>
          {files.slice(0, 8).map((f: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', overflow: 'hidden' }}>
              <span style={{ color: 'var(--faint)', flexShrink: 0 }}>→</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || f.path || String(f)}</span>
              {f.size != null && (
                <span style={{ color: 'var(--faint)', flexShrink: 0 }}>
                  {f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`}
                </span>
              )}
            </div>
          ))}
          {files.length > 8 && <p style={{ fontSize: 11, color: 'var(--muted)' }}>…and {files.length - 8} more</p>}
        </div>
      );
    } else if ('success' in parsed || 'error' in parsed) {
      if (parsed.error) {
        node = <span style={{ fontSize: 11.5, color: 'var(--c-clay)' }}>{String(parsed.error)}</span>;
      } else {
        const summary = parsed.total != null
          ? `${parsed.succeeded ?? parsed.total}/${parsed.total} succeeded`
          : parsed.outputPath ?? (parsed.virtualDrivePath ?? 'Done');
        node = <span style={{ fontSize: 11.5, color: 'var(--c-sage)' }}>{summary}</span>;
      }
    } else {
      const str = JSON.stringify(parsed);
      node = <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', wordBreak: 'break-all' }}>{str.length > 240 ? str.slice(0, 240) + '…' : str}</span>;
    }
  } catch {
    node = <span style={{ fontSize: 11.5, color: 'var(--ink-2)', wordBreak: 'break-word' }}>{trimmed.length > 300 ? trimmed.slice(0, 300) + '…' : trimmed}</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {node}
      {drivePath && (
        <button
          onClick={() => navigate(`/files?path=${encodeURIComponent(drivePath!)}`)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, color: 'var(--accent-ink)', marginTop: 4 }}
        >
          <ExternalLink size={12} />
          Open in My Drives
        </button>
      )}
    </div>
  );
};

// ── Plan step row ─────────────────────────────────────────────────────────────

const PlanStep: React.FC<{ step: LiveStep }> = ({ step }) => {
  const [open, setOpen] = useState(false);
  const hasResult = (step.status === 'done' || step.status === 'error') && !!step.result;

  const dotColor: Record<LiveStep['status'], string> = {
    done:    'var(--c-sage)',
    running: 'var(--accent)',
    pending: 'transparent',
    error:   'var(--c-clay)',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          background: step.status === 'pending' ? 'transparent' : dotColor[step.status],
          color: 'var(--page)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: step.status === 'pending' ? '1.5px dashed var(--border-2)' : 'none',
        }}>
          {step.status === 'done'    && <CheckCircle2 size={11} />}
          {step.status === 'running' && <Loader2 size={10} className="spin" />}
          {step.status === 'error'   && <XCircle size={11} />}
          {step.status === 'pending' && <span style={{ width: 4, height: 4, borderRadius: 999, background: 'var(--faint)', display: 'block' }} />}
        </span>
        <span style={{
          fontSize: 13, flex: 1, minWidth: 0,
          color: step.status === 'pending' ? 'var(--muted)' : 'var(--ink)',
          fontWeight: step.status === 'running' ? 600 : 500,
        }}>
          {step.description}
        </span>
        {step.type === 'tool' && step.tool && (
          <code style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)',
            background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4, flexShrink: 0,
          }}>
            {step.tool}
          </code>
        )}
        {hasResult && (
          <button
            onClick={() => setOpen(v => !v)}
            style={{ flexShrink: 0, padding: 4, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}
            title={open ? 'Hide output' : 'Show output'}
          >
            {open ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </div>
      {open && hasResult && (
        <div style={{
          marginTop: 8, marginLeft: 30, padding: '10px 12px',
          background: 'var(--page)', border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 11.5, fontFamily: 'var(--font-mono)',
          color: 'var(--ink-2)',
        }}>
          <ResultView raw={step.result!} />
        </div>
      )}
    </div>
  );
};

// ── Run card ──────────────────────────────────────────────────────────────────

const RunCard: React.FC<{ run: LiveRun; planOpen: boolean; onTogglePlan: () => void }> = ({
  run, planOpen, onTogglePlan,
}) => {
  const doneCount = run.plan.filter(s => s.status === 'done').length;
  const totalCount = run.plan.length;
  const progress = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Avatar kind="bot" />
      <div style={{ flex: 1, maxWidth: '80%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>Agent</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: 'var(--accent-ink)', background: 'var(--accent-soft)',
            padding: '2px 8px', borderRadius: 999, fontWeight: 500,
          }}>
            <Loader2 size={8} className="spin" />
            {run.status}
          </span>
        </div>
        <div style={{
          padding: 16, borderRadius: 'var(--r-card)',
          background: 'var(--surface)', border: '1px solid var(--border)',
        }}>
          {run.plan.length > 0 && (
            <>
              <button
                onClick={onTogglePlan}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)',
                  marginBottom: planOpen ? 12 : 0,
                }}
              >
                {planOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Plan · {run.plan.length} step{run.plan.length !== 1 ? 's' : ''}
              </button>
              {planOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {run.plan.map(step => <PlanStep key={step.id} step={step} />)}
                </div>
              )}
              {totalCount > 0 && (
                <div style={{
                  marginTop: 14, paddingTop: 12,
                  borderTop: '1px dashed var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: 'var(--muted)',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{doneCount} / {totalCount} steps</span>
                  <div style={{ flex: 1, height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width .3s var(--ease)' }} />
                  </div>
                </div>
              )}
            </>
          )}
          {run.synthesis && (
            <div style={{ marginTop: run.plan.length > 0 ? 14 : 0, fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.synthesis}</ReactMarkdown>
              </div>
              <span style={{ display: 'inline-block', width: 2, height: 16, background: 'var(--accent)', marginLeft: 2, verticalAlign: 'middle', animation: 'pulse-soft 1.2s ease-in-out infinite' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Assistant bubble ──────────────────────────────────────────────────────────

const AssistantBubble: React.FC<{ content: string }> = ({ content }) => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
    <Avatar kind="bot" />
    <div style={{ maxWidth: '80%', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>Agent</span>
      </div>
      <div style={{
        padding: '12px 16px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-card)', borderTopLeftRadius: 6,
      }}>
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink)' }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  </div>
);

// ── User bubble ───────────────────────────────────────────────────────────────

const UserBubble: React.FC<{ content: string; attachments?: Attachment[] }> = ({ content, attachments }) => (
  <div style={{ display: 'flex', gap: 12, flexDirection: 'row-reverse', alignItems: 'flex-start' }}>
    <Avatar kind="user" />
    <div style={{ maxWidth: '75%' }}>
      <div style={{
        background: 'var(--accent)', color: 'var(--on-accent)',
        padding: '12px 16px', borderRadius: 'var(--r-card)',
        borderTopRightRadius: 6,
        fontSize: 14, lineHeight: 1.55,
      }}>
        {content}
      </div>
      {attachments && attachments.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {attachments.map(a => <AttachmentChip key={a.id} a={a} />)}
        </div>
      )}
    </div>
  </div>
);

// ── Error bubble ──────────────────────────────────────────────────────────────

const ErrorBubble: React.FC<{ content: string }> = ({ content }) => (
  <div style={{
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '12px 16px',
    background: 'var(--c-clay-bg)',
    borderRadius: 'var(--r-card)',
    fontSize: 13.5, color: 'var(--c-clay)',
  }}>
    <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
    <span>{content}</span>
  </div>
);

// ── History panel ─────────────────────────────────────────────────────────────

interface HistoryPanelProps {
  history: HistoryChat[];
  currentId: string | null;
  onSelect: (chat: HistoryChat) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ history, currentId, onSelect, onDelete, onNew, onClose }) => (
  <aside style={{
    width: 260, flexShrink: 0,
    background: 'var(--surface)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  }}>
    <div style={{ padding: '18px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Chats</span>
      <button
        onClick={onClose}
        style={{ padding: 6, borderRadius: 'var(--r-control)', color: 'var(--muted)', display: 'flex', alignItems: 'center', transition: 'all .15s var(--ease)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
      >
        <ChevronLeft size={14} />
      </button>
    </div>
    <div style={{ padding: '0 12px 8px' }}>
      <button
        onClick={onNew}
        className="btn btn-primary"
        style={{ width: '100%', justifyContent: 'center' }}
      >
        <Plus size={14} /> New chat
      </button>
    </div>
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 12px' }}>
      {history.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center', padding: '24px 12px' }}>No chat history yet</p>
      ) : (
        history.map(chat => {
          const isActive = chat.id === currentId;
          return (
            <div
              key={chat.id}
              style={{
                position: 'relative',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
                width: '100%', padding: '10px 12px', borderRadius: 10, marginBottom: 2,
                background: isActive ? 'var(--accent-soft)' : 'transparent',
                cursor: 'pointer',
                transition: 'background .12s var(--ease)',
              }}
              onClick={() => onSelect(chat)}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{
                fontSize: 12.5, lineHeight: 1.35,
                color: isActive ? 'var(--accent-ink)' : 'var(--ink-2)',
                fontWeight: isActive ? 600 : 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                width: '100%', display: 'block', paddingRight: 20,
              }}>
                {chat.title}
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>{fmtDate(chat.updatedAt)}</span>
              <button
                onClick={e => { e.stopPropagation(); onDelete(chat.id); }}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  padding: 4, color: 'var(--muted)', display: 'flex', alignItems: 'center',
                  borderRadius: 6, opacity: 0.4, transition: 'all .15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--c-clay)'; (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.opacity = '0.4'; }}
                title="Delete chat"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })
      )}
    </div>
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--c-sage)', boxShadow: '0 0 0 4px var(--c-sage-bg)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>Connected · Planning Agent</div>
        <div style={{ fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>12 tools available</div>
      </div>
    </div>
  </aside>
);

// ── Main component ─────────────────────────────────────────────────────────────

export const Chat: React.FC = () => {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [planOpen, setPlanOpen] = useState(true);
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryChat[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachPicker, setAttachPicker] = useState<'file' | 'drive' | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, live?.synthesis, pendingTool]);

  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAttachMenu]);

  useEffect(() => {
    if (!currentHistoryId || entries.length === 0) return;
    setHistory(prev => {
      const idx = prev.findIndex(c => c.id === currentHistoryId);
      const title = titleFromEntries(entries);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], entries, title, updatedAt: Date.now() };
      saveHistory(updated);
      return updated;
    });
  }, [entries, currentHistoryId]);

  useEffect(() => {
    const h = loadHistory();
    setHistory(h);
    if (h.length > 0) {
      const latest = h[0];
      setChatId(latest.chatId ?? null);
      setEntries(Array.isArray(latest.entries) ? latest.entries : []);
      setCurrentHistoryId(latest.id ?? null);
    } else {
      initChat();
    }
    return () => { readerRef.current?.cancel(); };
  }, []);

  const initChat = async () => {
    setInitError(null);
    try {
      const res = await fetch(`${AGENT}/chat/create`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create chat');
      const newId = data.chat_id as string;
      setChatId(newId);
      const newEntry: HistoryChat = {
        id: newId,
        chatId: newId,
        title: 'New chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        entries: [],
      };
      setCurrentHistoryId(newId);
      setHistory(prev => {
        const updated = [newEntry, ...prev];
        saveHistory(updated);
        return updated;
      });
    } catch (e: any) {
      setInitError(e.message);
    }
  };

  const recreateChat = async (): Promise<string | null> => {
    try {
      const res = await fetch(`${AGENT}/chat/create`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return null;
      const newId = data.chat_id as string;
      setChatId(newId);
      if (currentHistoryId) {
        setHistory(prev => {
          const idx = prev.findIndex(c => c.id === currentHistoryId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], chatId: newId };
          saveHistory(updated);
          return updated;
        });
      }
      return newId;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!live) return;
    const id = setInterval(async () => {
      if (pendingTool) return;
      try {
        const res = await fetch(`${TOOLS}/pending`);
        const list: PendingTool[] = await res.json();
        if (list.length > 0) setPendingTool(list[0]);
      } catch { /* ignore */ }
    }, 350);
    return () => clearInterval(id);
  }, [live, pendingTool]);

  const handleEvent = useCallback((evt: any) => {
    switch (evt.type) {
      case 'status':
        setLive(prev => prev ? { ...prev, status: evt.message ?? prev.status } : null);
        break;
      case 'plan':
        setPlanOpen(true);
        setLive(prev => prev ? {
          ...prev,
          status: evt.message ?? prev.status,
          plan: (evt.steps ?? []).map((s: any) => ({
            id: s.id,
            description: s.description,
            type: s.type ?? 'llm',
            tool: s.tool,
            status: 'pending',
          })),
        } : null);
        break;
      case 'step_start':
        setLive(prev => {
          if (!prev) return null;
          return {
            ...prev,
            status: evt.message ?? prev.status,
            plan: prev.plan.map(s =>
              s.id === evt.step_id
                ? { ...s, status: 'running', tool: evt.tool ?? s.tool }
                : s
            ),
          };
        });
        break;
      case 'step_done':
        setLive(prev => {
          if (!prev) return null;
          return {
            ...prev,
            plan: prev.plan.map(s =>
              s.id === evt.step_id ? { ...s, status: 'done', result: evt.result } : s
            ),
          };
        });
        break;
      case 'tool_error':
        setLive(prev => {
          if (!prev) return null;
          return {
            ...prev,
            plan: prev.plan.map(s =>
              s.id === evt.step_id ? { ...s, status: 'error', result: evt.error } : s
            ),
          };
        });
        break;
      case 'final_chunk':
        setLive(prev => prev ? { ...prev, synthesis: prev.synthesis + (evt.content ?? '') } : null);
        break;
      case 'final':
        setEntries(prev => [...prev, {
          id: `a-${Date.now()}`,
          kind: 'assistant',
          content: evt.response ?? '',
        }]);
        setLive(null);
        break;
      case 'error':
        setEntries(prev => [...prev, {
          id: `e-${Date.now()}`,
          kind: 'error',
          content: evt.message ?? 'Unknown error',
        }]);
        setLive(null);
        break;
      default:
        break;
    }
  }, []);

  const handleAttachSelect = (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    const type = attachPicker!;
    setAttachments(prev => [...prev, {
      id: `att-${Date.now()}-${Math.random()}`,
      type, path, name,
    }]);
    setAttachPicker(null);
  };

  const handleNativeFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      const path = (file as any).path || file.name;
      setAttachments(prev => [...prev, {
        id: `att-${Date.now()}-${Math.random()}`,
        type: 'file' as const,
        path,
        name: file.name,
      }]);
    }
    e.target.value = '';
  };

  const removeAttachment = (id: string) =>
    setAttachments(prev => prev.filter(a => a.id !== id));

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || live || !chatId) return;

    let fullMessage = msg;
    if (attachments.length > 0) {
      const lines = attachments.map(a =>
        `- ${a.type === 'drive' ? 'Virtual Drive' : 'File'}: ${a.path}`
      );
      fullMessage += `\n\n[Attached context:\n${lines.join('\n')}]`;
    }

    const sentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    setEntries(prev => [...prev, {
      id: `u-${Date.now()}`,
      kind: 'user',
      content: msg,
      attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
    }]);
    setLive({ status: 'Connecting…', plan: [], synthesis: '' });
    setPlanOpen(true);

    const doStream = async (cid: string): Promise<boolean> => {
      const resp = await fetch(`${AGENT}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: fullMessage, chat_id: cid }),
      });

      if (resp.status === 404) return false;

      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${resp.status}`);
      }

      const reader = resp.body!.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') break;
            try { handleEvent(JSON.parse(raw)); } catch { /* skip */ }
          }
        }
      }
      return true;
    };

    try {
      const ok = await doStream(chatId);
      if (!ok) {
        const newId = await recreateChat();
        if (newId) {
          await doStream(newId);
        } else {
          throw new Error('Chat session expired and could not be recreated.');
        }
      }
    } catch (e: any) {
      setEntries(prev => [...prev, {
        id: `e-${Date.now()}`,
        kind: 'error',
        content: e.message || 'Stream failed',
      }]);
      setLive(null);
    }
  };

  const approveTool = async (id: string, modifiedInput: Record<string, any>) => {
    setPendingTool(null);
    await fetch(`${TOOLS}/approve/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: modifiedInput }),
    }).catch(() => { /* ignore */ });
  };

  const rejectTool = async (id: string) => {
    setPendingTool(null);
    await fetch(`${TOOLS}/reject/${id}`, { method: 'POST' }).catch(() => { /* ignore */ });
  };

  const newChat = async () => {
    if (live) return;
    readerRef.current?.cancel();
    setEntries([]);
    setLive(null);
    setPendingTool(null);
    setAttachments([]);
    setChatId(null);
    setCurrentHistoryId(null);
    await initChat();
  };

  const switchToChat = (chat: HistoryChat) => {
    if (live) return;
    readerRef.current?.cancel();
    setChatId(chat.chatId);
    setEntries(chat.entries);
    setCurrentHistoryId(chat.id);
    setLive(null);
    setPendingTool(null);
    setAttachments([]);
  };

  const deleteHistoryChat = (id: string) => {
    const updated = history.filter(c => c.id !== id);
    saveHistory(updated);
    setHistory(updated);

    if (id !== currentHistoryId) return;

    readerRef.current?.cancel();
    setLive(null);
    setPendingTool(null);

    if (updated.length > 0) {
      const next = updated[0];
      setChatId(next.chatId);
      setEntries(next.entries);
      setCurrentHistoryId(next.id);
    } else {
      setEntries([]);
      setChatId(null);
      setCurrentHistoryId(null);
      initChat();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const SUGGESTED = [
    'What tools do you have?',
    'Convert all images in a drive to PNG',
    'Merge PDFs from a folder',
    'Scan my drives for large files',
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* History sidebar */}
      {historyOpen && (
        <HistoryPanel
          history={history}
          currentId={currentHistoryId}
          onSelect={chat => { switchToChat(chat); }}
          onDelete={deleteHistoryChat}
          onNew={newChat}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--page)' }}>

        {/* Thin top toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}>
          <button
            onClick={() => setHistoryOpen(v => !v)}
            title="Chat history"
            style={{
              padding: 7, borderRadius: 'var(--r-control)', display: 'flex', alignItems: 'center',
              color: historyOpen ? 'var(--accent-ink)' : 'var(--muted)',
              background: historyOpen ? 'var(--accent-soft)' : 'transparent',
              transition: 'all .15s var(--ease)',
            }}
            onMouseEnter={e => { if (!historyOpen) { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; } }}
            onMouseLeave={e => { if (!historyOpen) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; } }}
          >
            <History size={15} />
          </button>

          {chatId && (
            <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
              #{chatId.slice(0, 8)}
            </span>
          )}

          <div style={{ flex: 1 }} />

          <button
            onClick={newChat}
            disabled={!!live}
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px', opacity: live ? 0.4 : 1 }}
          >
            <Plus size={13} /> New chat
          </button>
        </div>

        {/* Init error */}
        {initError && (
          <div style={{
            margin: '12px 20px', padding: '12px 16px',
            background: 'var(--c-clay-bg)', borderRadius: 'var(--r-card)',
            fontSize: 13, color: 'var(--c-clay)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{initError}</span>
            <button
              onClick={initChat}
              style={{ fontSize: 12, textDecoration: 'underline', color: 'inherit' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Conversation */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 24px 8px' }}>
          <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Empty state */}
            {entries.length === 0 && !live && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', textAlign: 'center', gap: 18,
                padding: '24px 20px',
                userSelect: 'none',
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 'var(--r-lg)',
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Sparkles size={26} />
                </div>
                <div>
                  <p style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', letterSpacing: 'var(--display-tracking)', marginBottom: 6 }}>
                    How can I help?
                  </p>
                  <p style={{ fontSize: 13.5, color: 'var(--muted)', maxWidth: 320, lineHeight: 1.5 }}>
                    Ask me to organize files, convert media, analyze storage, or anything else.
                  </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%', maxWidth: 480 }}>
                  {SUGGESTED.map(hint => (
                    <button
                      key={hint}
                      onClick={() => { setInput(hint); inputRef.current?.focus(); }}
                      style={{
                        textAlign: 'left', fontSize: 12.5, padding: '10px 14px',
                        borderRadius: 'var(--r-card)',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        color: 'var(--ink-2)', lineHeight: 1.4,
                        transition: 'all .15s var(--ease)',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-2)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conversation entries */}
            {entries.map(entry => {
              if (entry.kind === 'user')      return <UserBubble key={entry.id} content={entry.content} attachments={entry.attachments} />;
              if (entry.kind === 'assistant') return <AssistantBubble key={entry.id} content={entry.content} />;
              return <ErrorBubble key={entry.id} content={entry.content} />;
            })}

            {/* Live agent run */}
            {live && (
              <RunCard
                run={live}
                planOpen={planOpen}
                onTogglePlan={() => setPlanOpen(v => !v)}
              />
            )}

            {/* Tool approval card */}
            {pendingTool && (
              <ToolApprovalCard
                tool={pendingTool}
                onApprove={approveTool}
                onReject={rejectTool}
              />
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div style={{ padding: '8px 24px 16px', flexShrink: 0 }}>
          <div style={{ maxWidth: 780, margin: '0 auto' }}>

            {/* Attachment chips */}
            {attachments.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {attachments.map(a => (
                  <AttachmentChip key={a.id} a={a} onRemove={() => removeAttachment(a.id)} />
                ))}
              </div>
            )}

            <div style={{
              background: 'var(--surface)', border: '1.5px solid var(--border)',
              borderRadius: 'var(--r-card)', padding: 12,
              boxShadow: 'var(--shadow-md)',
              transition: 'border-color .15s',
            }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!!live || !chatId}
                placeholder={
                  !chatId
                    ? 'Connecting to agent…'
                    : live
                    ? 'Agent is working…'
                    : 'Ask the agent to organize, convert, or analyze files…'
                }
                rows={2}
                style={{
                  width: '100%', resize: 'none',
                  border: 0, outline: 0, background: 'transparent',
                  fontSize: 14, color: 'var(--ink)', lineHeight: 1.5,
                  fontFamily: 'var(--font-body)',
                  padding: '4px 4px',
                  opacity: (!!live || !chatId) ? 0.5 : 1,
                }}
              />

              {/* Bottom action bar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                paddingTop: 8, borderTop: '1px solid var(--border)',
              }}>
                {/* Attach button + dropdown */}
                <div style={{ position: 'relative' }} ref={attachMenuRef}>
                  <button
                    onClick={() => setShowAttachMenu(v => !v)}
                    disabled={!!live || !chatId}
                    className="btn btn-ghost"
                    style={{ padding: '6px 10px', fontSize: 13, opacity: (!!live || !chatId) ? 0.4 : 1 }}
                    title="Attach file or virtual drive"
                  >
                    <Paperclip size={14} /> Attach
                  </button>

                  {showAttachMenu && (
                    <div style={{
                      position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 'var(--r-card)',
                      boxShadow: 'var(--shadow-lg)',
                      overflow: 'hidden', zIndex: 50, minWidth: 180,
                    }}>
                      <button
                        onClick={() => { setShowAttachMenu(false); setAttachPicker('file'); }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: 13, color: 'var(--ink-2)', textAlign: 'left', transition: 'background .1s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <FileText size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                        File from drive
                      </button>
                      <button
                        onClick={() => { setShowAttachMenu(false); setAttachPicker('drive'); }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: 13, color: 'var(--ink-2)', textAlign: 'left', transition: 'background .1s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <HardDrive size={14} style={{ color: 'var(--c-sky)', flexShrink: 0 }} />
                        Virtual drive
                      </button>
                      <button
                        onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: 13, color: 'var(--ink-2)', textAlign: 'left', transition: 'background .1s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <Upload size={14} style={{ color: 'var(--c-sage)', flexShrink: 0 }} />
                        Browse local files
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ flex: 1 }} />

                <span style={{ fontSize: 11, color: 'var(--faint)' }}>
                  <span className="kbd">⇧</span> + <span className="kbd">↵</span> for newline
                </span>

                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || !!live || !chatId}
                  className="btn btn-primary"
                  style={{ padding: '8px 14px', opacity: (!input.trim() || !!live || !chatId) ? 0.4 : 1 }}
                >
                  {live
                    ? <Loader2 size={13} className="spin" />
                    : <Send size={13} />
                  }
                  {live ? 'Working…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Hidden native file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleNativeFileSelect}
        />

        {/* Folder / drive picker modals */}
        {attachPicker === 'file' && (
          <FolderPickerModal
            isOpen
            mode="file"
            title="Select a file to attach"
            onClose={() => setAttachPicker(null)}
            onSelect={handleAttachSelect}
          />
        )}
        {attachPicker === 'drive' && (
          <FolderPickerModal
            isOpen
            mode="folder"
            title="Select a virtual drive to attach"
            onClose={() => setAttachPicker(null)}
            onSelect={handleAttachSelect}
          />
        )}
      </div>
    </div>
  );
};

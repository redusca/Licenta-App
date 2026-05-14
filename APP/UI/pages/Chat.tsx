import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import {
  Send, Bot, User, Loader2, CheckCircle2, XCircle,
  Wrench, Brain, ChevronDown, ChevronRight,
  Plus, Trash2, AlertCircle, Eye, EyeOff,
  Paperclip, HardDrive, FileText, X, Upload,
  History, MessageSquare, ChevronLeft, ExternalLink,
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
  // Keep newest 30 chats; cap entries per chat at 60
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

// ── Small sub-components ──────────────────────────────────────────────────────

const StepIcon: React.FC<{ status: LiveStep['status']; type: LiveStep['type'] }> = ({ status, type }) => {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />;
  if (status === 'done')    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === 'error')   return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  return type === 'tool'
    ? <Wrench className="w-3.5 h-3.5 text-slate-400 shrink-0" />
    : <Brain className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
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

    // Detect a drive/folder path worth linking to
    if (parsed.virtualDrivePath) {
      drivePath = parsed.virtualDrivePath;
    } else if (parsed.outputPath && looksLikeFolder(parsed.outputPath)) {
      drivePath = parsed.outputPath;
    }

    if (Array.isArray(parsed.files)) {
      const files = parsed.files as any[];
      node = (
        <div className="space-y-0.5">
          <p className="text-xs text-slate-400 mb-1">{files.length} item(s)</p>
          {files.slice(0, 8).map((f: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-400 truncate">
              <span className="text-slate-400 shrink-0">→</span>
              <span className="truncate">{f.name || f.path || String(f)}</span>
              {f.size != null && (
                <span className="text-slate-400 shrink-0">
                  {f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`}
                </span>
              )}
            </div>
          ))}
          {files.length > 8 && <p className="text-xs text-slate-400">…and {files.length - 8} more</p>}
        </div>
      );
    } else if ('success' in parsed || 'error' in parsed) {
      if (parsed.error) {
        node = <span className="text-xs text-red-500">{String(parsed.error)}</span>;
      } else {
        const summary = parsed.total != null
          ? `${parsed.succeeded ?? parsed.total}/${parsed.total} succeeded`
          : parsed.outputPath ?? (parsed.virtualDrivePath ?? 'Done');
        node = <span className="text-xs text-emerald-600 dark:text-emerald-400">{summary}</span>;
      }
    } else {
      const str = JSON.stringify(parsed);
      node = <span className="text-xs font-mono text-slate-500 break-all">{str.length > 240 ? str.slice(0, 240) + '…' : str}</span>;
    }
  } catch {
    node = <span className="text-xs text-slate-600 dark:text-slate-400 wrap-break-word">{trimmed.length > 300 ? trimmed.slice(0, 300) + '…' : trimmed}</span>;
  }

  return (
    <div className="space-y-2">
      {node}
      {drivePath && (
        <button
          onClick={() => navigate(`/files?path=${encodeURIComponent(drivePath!)}`)}
          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors mt-1"
        >
          <ExternalLink className="w-3 h-3 shrink-0" />
          Open in My Drive
        </button>
      )}
    </div>
  );
};

// ── Step row with expandable result ──────────────────────────────────────────

const StepRow: React.FC<{ step: LiveStep }> = ({ step }) => {
  const [expanded, setExpanded] = useState(false);
  const hasResult = (step.status === 'done' || step.status === 'error') && !!step.result;

  return (
    <div>
      <div className="flex items-center gap-2">
        <StepIcon status={step.status} type={step.type} />
        <span className={`text-xs flex-1 min-w-0 truncate ${
          step.status === 'running' ? 'text-blue-600 dark:text-blue-400 font-medium' :
          step.status === 'done'    ? 'text-emerald-600 dark:text-emerald-400' :
          step.status === 'error'   ? 'text-red-500' :
          'text-slate-500 dark:text-slate-400'
        }`}>{step.description}</span>
        {step.type === 'tool' && step.tool && (
          <span className="text-xs text-slate-400 font-mono shrink-0">({step.tool})</span>
        )}
        {hasResult && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="shrink-0 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            title={expanded ? 'Hide output' : 'Show output'}
          >
            {expanded ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        )}
      </div>
      {expanded && hasResult && (
        <div className="mt-1.5 ml-5 px-3 py-2 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 rounded-xl">
          <ResultView raw={step.result!} />
        </div>
      )}
    </div>
  );
};

// ── Attachment chips ──────────────────────────────────────────────────────────

const AttachmentChip: React.FC<{ a: Attachment; onRemove?: () => void }> = ({ a, onRemove }) => (
  <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/15 border border-blue-400/30 rounded-lg text-xs font-mono text-blue-700 dark:text-blue-300 max-w-55">
    {a.type === 'drive'
      ? <HardDrive className="w-3 h-3 shrink-0 text-blue-500" />
      : <FileText className="w-3 h-3 shrink-0 text-blue-400" />
    }
    <span className="truncate">{a.name}</span>
    {onRemove && (
      <button onClick={onRemove} className="shrink-0 ml-0.5 text-blue-400 hover:text-red-500 transition-colors">
        <X className="w-2.5 h-2.5" />
      </button>
    )}
  </span>
);

// ── Run card ──────────────────────────────────────────────────────────────────

const RunCard: React.FC<{ run: LiveRun; planOpen: boolean; onTogglePlan: () => void }> = ({
  run, planOpen, onTogglePlan,
}) => (
  <div className="flex gap-3">
    <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
      <Bot className="w-5 h-5 text-white" />
    </div>
    <div className="flex-1 max-w-[80%]">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-sm font-semibold">Agent</span>
      </div>
      <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-none p-4 space-y-3">

        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="italic">{run.status}</span>
        </div>

        {run.plan.length > 0 && (
          <div>
            <button
              onClick={onTogglePlan}
              className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-1.5"
            >
              {planOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Plan ({run.plan.length} step{run.plan.length !== 1 ? 's' : ''})
            </button>
            {planOpen && (
              <div className="space-y-2 pl-1">
                {run.plan.map(step => (
                  <StepRow key={step.id} step={step} />
                ))}
              </div>
            )}
          </div>
        )}

        {run.synthesis && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.synthesis}</ReactMarkdown>
            <span className="inline-block w-0.5 h-4 bg-blue-500 ml-0.5 animate-pulse align-middle" />
          </div>
        )}
      </div>
    </div>
  </div>
);

// ── Markdown-rendered assistant bubble ────────────────────────────────────────

const AssistantBubble: React.FC<{ content: string }> = ({ content }) => (
  <div className="flex gap-3">
    <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
      <Bot className="w-5 h-5 text-white" />
    </div>
    <div className="flex-1 max-w-[80%]">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-sm font-semibold">Agent</span>
      </div>
      <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-none px-4 py-3">
        <div className="prose prose-sm dark:prose-invert max-w-none
          prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
          prose-headings:mt-2 prose-headings:mb-1
          prose-code:bg-slate-200 dark:prose-code:bg-slate-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
          prose-pre:bg-slate-200 dark:prose-pre:bg-slate-700 prose-pre:rounded-xl prose-pre:p-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  </div>
);

const UserBubble: React.FC<{ content: string; attachments?: Attachment[] }> = ({ content, attachments }) => (
  <div className="flex gap-3 flex-row-reverse">
    <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
      <User className="w-5 h-5 text-orange-600" />
    </div>
    <div className="flex-1 max-w-[80%] flex flex-col items-end">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-sm font-semibold">You</span>
      </div>
      <div className="bg-blue-500 text-white rounded-2xl rounded-tr-none px-4 py-3 text-sm leading-relaxed">
        {content}
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.map(a => (
              <AttachmentChip key={a.id} a={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

const ErrorBubble: React.FC<{ content: string }> = ({ content }) => (
  <div className="flex items-start gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
    <span>{content}</span>
  </div>
);

// ── History panel ─────────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface HistoryPanelProps {
  history: HistoryChat[];
  currentId: string | null;
  onSelect: (chat: HistoryChat) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ history, currentId, onSelect, onDelete, onClose }) => (
  <div className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 dark:border-slate-800">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Chat History</span>
      <button
        onClick={onClose}
        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto py-1">
      {history.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-8 px-3">No chat history yet</p>
      ) : (
        history.map(chat => (
          <div
            key={chat.id}
            className={`group relative flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
              chat.id === currentId
                ? 'bg-blue-50 dark:bg-blue-900/30'
                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
            }`}
            onClick={() => onSelect(chat)}
          >
            <MessageSquare className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${chat.id === currentId ? 'text-blue-500' : 'text-slate-400'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium truncate ${chat.id === currentId ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}`}>
                {chat.title}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">{fmtDate(chat.updatedAt)}</p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onDelete(chat.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-red-500 transition-all shrink-0"
              title="Delete chat"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))
      )}
    </div>
  </div>
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

  // ── History state ──────────────────────────────────────────────────────────
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryChat[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  // ── Attachment state ───────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachPicker, setAttachPicker] = useState<'file' | 'drive' | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, live?.synthesis, pendingTool]);

  // ── Close attach menu on outside click ────────────────────────────────────
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

  // ── Auto-save current chat to history ─────────────────────────────────────
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

  // ── Init on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    const h = loadHistory();
    setHistory(h);
    if (h.length > 0) {
      // Restore the most recent chat
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
      // Create a history entry for this new chat
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

  // ── Recreate server chat on 404 (server restart wiped session) ───────────
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

  // ── Poll for pending tool approvals while streaming ────────────────────────
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

  // ── SSE event handler ──────────────────────────────────────────────────────
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

  // ── Attachment handlers ────────────────────────────────────────────────────

  const handleAttachSelect = (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    const type = attachPicker!;
    setAttachments(prev => [...prev, {
      id: `att-${Date.now()}-${Math.random()}`,
      type,
      path,
      name,
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

  // ── Send message ───────────────────────────────────────────────────────────
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

    // Returns false if the server returned 404 (chat session gone)
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
        // Server lost the chat (restart) — recreate and retry once
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

  // ── Approve / reject tool ──────────────────────────────────────────────────
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

  // ── New chat ───────────────────────────────────────────────────────────────
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

  // ── Switch to history chat ─────────────────────────────────────────────────
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

  // ── Delete history chat ────────────────────────────────────────────────────
  const deleteHistoryChat = (id: string) => {
    const updated = history.filter(c => c.id !== id);
    saveHistory(updated);
    setHistory(updated);

    if (id !== currentHistoryId) return;

    readerRef.current?.cancel();
    setLive(null);
    setPendingTool(null);

    if (updated.length > 0) {
      // Restore the most recent remaining chat
      const next = updated[0];
      setChatId(next.chatId);
      setEntries(next.entries);
      setCurrentHistoryId(next.id);
    } else {
      // No history left — start fresh
      setEntries([]);
      setChatId(null);
      setCurrentHistoryId(null);
      initChat();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">

      {/* History panel */}
      {historyOpen && (
        <HistoryPanel
          history={history}
          currentId={currentHistoryId}
          onSelect={chat => { switchToChat(chat); }}
          onDelete={deleteHistoryChat}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHistoryOpen(v => !v)}
              className={`p-1.5 rounded-lg transition-colors ${
                historyOpen
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Chat history"
            >
              <History className="w-4 h-4" />
            </button>
            <Bot className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">Planning Agent</span>
            {chatId && (
              <span className="text-xs text-slate-400 font-mono hidden sm:block">
                #{chatId.slice(0, 8)}
              </span>
            )}
          </div>
          <button
            onClick={newChat}
            disabled={!!live}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 disabled:opacity-40 transition-colors"
            title="Start new conversation"
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
          </button>
        </div>

        {/* Init error */}
        {initError && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{initError}</span>
            <button
              onClick={initChat}
              className="ml-auto underline hover:no-underline text-xs"
            >
              Retry
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-5 pr-1">

          {/* Empty state */}
          {entries.length === 0 && !live && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 select-none">
              <div className="w-16 h-16 rounded-full bg-blue-600/10 flex items-center justify-center">
                <Bot className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-slate-700 dark:text-slate-300 text-lg">
                  How can I help?
                </p>
                <p className="text-sm text-slate-400 mt-1 max-w-xs">
                  Ask me to organize files, convert media, analyze storage, or anything else.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 w-full max-w-md">
                {[
                  'What tools do you have?',
                  'Convert images to PNG',
                  'Merge these PDFs',
                  'Scan my virtual drive for large files',
                ].map(hint => (
                  <button
                    key={hint}
                    onClick={() => { setInput(hint); inputRef.current?.focus(); }}
                    className="text-left text-xs px-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors"
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

          {/* Inline tool approval / ask_user card */}
          {pendingTool && (
            <ToolApprovalCard
              tool={pendingTool}
              onApprove={approveTool}
              onReject={rejectTool}
            />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="mt-4 space-y-2">

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              {attachments.map(a => (
                <AttachmentChip key={a.id} a={a} onRemove={() => removeAttachment(a.id)} />
              ))}
            </div>
          )}

          <div className="relative flex items-center gap-2">
            {/* Attach button */}
            <div className="relative" ref={attachMenuRef}>
              <button
                onClick={() => setShowAttachMenu(v => !v)}
                disabled={!!live || !chatId}
                className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 disabled:opacity-40 transition-colors"
                title="Attach file or virtual drive"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Attach dropdown menu */}
              {showAttachMenu && (
                <div className="absolute bottom-full mb-2 left-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 min-w-45">
                  <button
                    onClick={() => { setShowAttachMenu(false); setAttachPicker('file'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left"
                  >
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    File from drive
                  </button>
                  <button
                    onClick={() => { setShowAttachMenu(false); setAttachPicker('drive'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left"
                  >
                    <HardDrive className="w-4 h-4 text-blue-500 shrink-0" />
                    Virtual drive
                  </button>
                  <button
                    onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left"
                  >
                    <Upload className="w-4 h-4 text-emerald-500 shrink-0" />
                    Browse local files
                  </button>
                </div>
              )}
            </div>

            {/* Text input */}
            <input
              ref={inputRef}
              type="text"
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
              className="flex-1 bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl py-4 pl-4 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 transition-all"
            />

            {/* Send button */}
            <button
              onClick={sendMessage}
              disabled={!input.trim() || !!live || !chatId}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-xl transition-colors"
            >
              {live
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>
        </div>

        {/* Hidden native file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleNativeFileSelect}
        />

        {/* Attachment file/drive picker */}
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

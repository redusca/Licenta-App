import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send, Bot, User, Loader2, CheckCircle2, XCircle,
  Clock, Wrench, Brain, ChevronDown, ChevronRight,
  Plus, Trash2, AlertCircle,
} from 'lucide-react';
import { ToolApprovalModal, PendingTool } from '../components/ToolApprovalModal';

const AGENT = 'http://127.0.0.1:5000/api/agent';
const TOOLS = 'http://127.0.0.1:5000/api/tools';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  synthesis: string;   // accumulates final_chunk content
}

interface ChatEntry {
  id: string;
  kind: 'user' | 'assistant' | 'error';
  content: string;
}

// ── Small sub-components ──────────────────────────────────────────────────────

const StepIcon: React.FC<{ status: LiveStep['status']; type: LiveStep['type'] }> = ({ status, type }) => {
  if (status === 'running')
    return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />;
  if (status === 'done')
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === 'error')
    return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  // pending
  return type === 'tool'
    ? <Wrench className="w-3.5 h-3.5 text-slate-400 shrink-0" />
    : <Brain className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
};

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

        {/* Status line */}
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="italic">{run.status}</span>
        </div>

        {/* Plan collapsible */}
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
              <div className="space-y-1.5 pl-1">
                {run.plan.map(step => (
                  <div key={step.id} className="flex items-center gap-2">
                    <StepIcon status={step.status} type={step.type} />
                    <span className={`text-xs ${
                      step.status === 'running'
                        ? 'text-blue-600 dark:text-blue-400 font-medium'
                        : step.status === 'done'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : step.status === 'error'
                        ? 'text-red-500'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      {step.description}
                    </span>
                    {step.type === 'tool' && step.tool && (
                      <span className="text-xs text-slate-400 font-mono">({step.tool})</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Streaming synthesis */}
        {run.synthesis && (
          <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
            {run.synthesis}
            <span className="inline-block w-0.5 h-4 bg-blue-500 ml-0.5 animate-pulse align-middle" />
          </div>
        )}
      </div>
    </div>
  </div>
);

const AssistantBubble: React.FC<{ content: string }> = ({ content }) => (
  <div className="flex gap-3">
    <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
      <Bot className="w-5 h-5 text-white" />
    </div>
    <div className="flex-1 max-w-[80%]">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-sm font-semibold">Agent</span>
      </div>
      <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-none px-4 py-3 text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    </div>
  </div>
);

const UserBubble: React.FC<{ content: string }> = ({ content }) => (
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

// ── Main component ─────────────────────────────────────────────────────────────

export const Chat: React.FC = () => {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [planOpen, setPlanOpen] = useState(true);
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, live?.synthesis]);

  // ── Init chat on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    initChat();
    return () => { readerRef.current?.cancel(); };
  }, []);

  const initChat = async () => {
    setInitError(null);
    try {
      const res = await fetch(`${AGENT}/chat/create`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create chat');
      setChatId(data.chat_id);
    } catch (e: any) {
      setInitError(e.message);
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

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || live || !chatId) return;

    setInput('');
    setEntries(prev => [...prev, { id: `u-${Date.now()}`, kind: 'user', content: msg }]);
    setLive({ status: 'Connecting…', plan: [], synthesis: '' });
    setPlanOpen(true);

    try {
      const resp = await fetch(`${AGENT}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, chat_id: chatId }),
      });

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
        // Split on SSE event boundaries (\n\n)
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') break;
            try {
              handleEvent(JSON.parse(raw));
            } catch { /* malformed — skip */ }
          }
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
    await fetch(`${AGENT}/chat/delete`, { method: 'DELETE' }).catch(() => { /* ignore */ });
    setEntries([]);
    setLive(null);
    setPendingTool(null);
    setChatId(null);
    await initChat();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
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
          <Trash2 className="w-3.5 h-3.5 ml-0.5 text-slate-400" />
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
                'Analyze my C drive',
                'Convert images to PNG',
                'Merge these PDFs',
                'What tools do you have?',
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
          if (entry.kind === 'user') return <UserBubble key={entry.id} content={entry.content} />;
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

        <div ref={bottomRef} />
      </div>

      {/* Pending tool approval banner */}
      {pendingTool && live && (
        <div className="mt-2 px-4 py-2.5 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-xl text-sm text-orange-700 dark:text-orange-400 flex items-center gap-2">
          <Clock className="w-4 h-4 shrink-0 animate-pulse" />
          Waiting for your approval to run <strong className="font-mono">{pendingTool.tool}</strong>…
        </div>
      )}

      {/* Input bar */}
      <div className="mt-4 relative">
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
          className="w-full bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl py-4 pl-4 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 transition-all"
        />
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

      {/* Tool approval modal */}
      {pendingTool && (
        <ToolApprovalModal
          tool={pendingTool}
          onApprove={approveTool}
          onReject={rejectTool}
        />
      )}
    </div>
  );
};

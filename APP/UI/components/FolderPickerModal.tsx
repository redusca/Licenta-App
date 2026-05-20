/**
 * FolderPickerModal — browse the app's virtual drives (Drives section)
 * and select a folder or a file.
 *
 * mode="folder"  → shows dirs only; footer "Use this folder" selects current path
 * mode="file"    → shows files too; clicking a file selects it
 * mode="any"     → both; footer button always present
 *
 * Uses the same /api/drive endpoints as DrivePickerModal, but adds
 * folder-selection support and physical drive fallback.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft, Folder, FileText, HardDrive,
  ChevronRight, X, Check, Loader2, Monitor, ExternalLink, CornerDownLeft,
} from 'lucide-react';

const FLASK = 'http://127.0.0.1:5000';

interface Drive { name: string; path: string; [k: string]: any; }
interface Entry { name: string; path: string; size: number; is_dir: boolean; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  mode?: 'folder' | 'file' | 'any';
  title?: string;
}

export const FolderPickerModal: React.FC<Props> = ({
  isOpen, onClose, onSelect, mode = 'folder', title,
}) => {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [pcDrives, setPcDrives] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);

  const current = history[history.length - 1] ?? null;

  // Load virtual drives + PC drives when the modal opens
  useEffect(() => {
    if (!isOpen) { setHistory([]); setEntries([]); setPathInput(''); return; }

    // 1. Read localStorage.knownDrives (source of truth from the Files page)
    let localDrives: Drive[] = [];
    try {
      const stored = localStorage.getItem('knownDrives');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) localDrives = parsed;
      }
    } catch { /* ignore */ }

    // 2. Fetch backend registry (includes tool-created drives + backup)
    fetch(`${FLASK}/api/drive/registry`)
      .then(r => r.json())
      .then(d => {
        const backendDrives: Drive[] = d.drives || [];
        const seen = new Set(localDrives.map(x => x.path?.toLowerCase()).filter(Boolean));
        const extra = backendDrives.filter(x => x.path && !seen.has(x.path.toLowerCase()));
        setDrives([...localDrives, ...extra].filter(x => x.path));
      })
      .catch(() => setDrives(localDrives));

    // 3. Fetch physical PC drive letters
    fetch(`${FLASK}/api/tools/space-analyzer/drives`)
      .then(r => r.json())
      .then(d => setPcDrives(d.drives || []))
      .catch(() => setPcDrives([]));
  }, [isOpen]);

  const openInExplorer = (path: string) => {
    fetch(`${FLASK}/api/drive/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {/* ignore */});
  };

  const loadPath = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${FLASK}/api/drive/list?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      let list: Entry[] = data.files || [];
      if (mode === 'folder') list = list.filter(e => e.is_dir);
      list.sort((a, b) =>
        a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name)
      );
      setEntries(list);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!isOpen || !current) { if (!current) setEntries([]); return; }
    loadPath(current);
  }, [current, isOpen, loadPath]);

  const enterPath = (path: string) => {
    setHistory(prev => [...prev, path]);
    setPathInput(path);
  };
  const goBack = () => {
    const prev = history.slice(0, -1);
    setHistory(prev);
    setPathInput(prev[prev.length - 1] ?? '');
  };

  const navigateTo = () => {
    const p = pathInput.trim();
    if (!p) return;
    setHistory(prev => [...prev, p]);
  };

  const selectEntry = (entry: Entry) => {
    if (entry.is_dir) {
      enterPath(entry.path);
    } else if (mode !== 'folder') {
      onSelect(entry.path);
      onClose();
    }
  };

  if (!isOpen) return null;

  const defaultTitle = mode === 'file' ? 'Select a file' : 'Select a folder';

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col mx-4"
        style={{ height: '60vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-2 px-4 py-3">
            {current && (
              <button
                onClick={goBack}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <span className="font-semibold text-sm flex-1">{title || defaultTitle}</span>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Path input bar — type any path to navigate directly */}
          <div className="flex items-center gap-1.5 px-3 pb-2.5">
            <input
              ref={pathInputRef}
              type="text"
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') navigateTo(); }}
              placeholder="Paste or type a path (e.g. C:\Users\redis\Desktop)"
              spellCheck={false}
              className="flex-1 text-xs font-mono bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors"
            />
            <button
              type="button"
              onClick={navigateTo}
              title="Navigate to path"
              className="shrink-0 flex items-center gap-1 px-2.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs transition-colors"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
              Go
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {!current ? (
            <div className="space-y-1 p-1">
              {/* Virtual Drives */}
              {drives.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-2 pt-1 pb-0.5">
                    Virtual Drives
                  </p>
                  {drives.map(d => (
                    <div key={d.path} className="flex items-center gap-1 group">
                      <button
                        onClick={() => enterPath(d.path)}
                        className="flex-1 flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors min-w-0"
                      >
                        <HardDrive className="w-5 h-5 text-blue-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{d.name || d.path}</p>
                          <p className="text-xs text-slate-400 font-mono truncate">{d.path}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                      </button>
                      <button
                        onClick={() => openInExplorer(d.path)}
                        title="Open location in Explorer"
                        className="opacity-0 group-hover:opacity-100 shrink-0 p-2 text-slate-400 hover:text-blue-500 transition-all rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </>
              )}

              {/* This PC — physical drives */}
              {pcDrives.length > 0 && (
                <>
                  <p className={`text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide px-2 pb-0.5 ${drives.length > 0 ? 'pt-3' : 'pt-1'}`}>
                    This PC
                  </p>
                  {pcDrives.map(d => (
                    <button
                      key={d}
                      onClick={() => enterPath(`${d}:\\`)}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors"
                    >
                      <Monitor className="w-5 h-5 text-slate-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{d}: Local Disk</p>
                        <p className="text-xs text-slate-400 font-mono">{d}:\</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>
                  ))}
                </>
              )}

              {drives.length === 0 && pcDrives.length === 0 && (
                <p className="text-center text-slate-400 text-sm py-10">
                  No drives found.
                </p>
              )}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 text-slate-400 py-12">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : entries.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-12">
              {mode === 'folder' ? 'No subfolders' : 'Empty folder'}
            </p>
          ) : (
            <div className="space-y-0.5">
              {entries.map(e => (
                <button
                  key={e.path}
                  onClick={() => selectEntry(e)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors group"
                >
                  {e.is_dir
                    ? <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                    : <FileText className="w-4 h-4 text-slate-400 group-hover:text-blue-400 shrink-0 transition-colors" />
                  }
                  <span className="flex-1 text-sm truncate">{e.name}</span>
                  {e.is_dir
                    ? <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    : <span className="text-xs text-slate-400 shrink-0">
                        {e.size > 1048576
                          ? `${(e.size / 1048576).toFixed(1)} MB`
                          : `${(e.size / 1024).toFixed(0)} KB`}
                      </span>
                  }
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer — "Use this folder" when in folder / any mode and inside a drive */}
        {(mode === 'folder' || mode === 'any') && current && (
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0 flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono truncate flex-1">{current}</span>
            <button
              onClick={() => { onSelect(current); onClose(); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              Use this folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

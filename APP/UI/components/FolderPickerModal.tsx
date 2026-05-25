/**
 * FolderPickerModal — full Explorer-style file / folder picker.
 *
 * mode="folder"  → navigate into folders; footer "Select Folder" confirms current dir.
 * mode="file"    → click a file to select it; double-click or "Open" confirms.
 * mode="any"     → selected file takes priority; otherwise current folder is confirmed.
 *
 * Layout:
 *   title bar
 *   toolbar   (back · fwd · up · breadcrumb address bar · view toggle)
 *   ┌ sidebar ─ content ─────────────────────────────────────────────┐
 *   │ Quick Access │ grid or list of entries with image thumbnails   │
 *   │ Virtual Drives│                                                │
 *   │ This PC      │                                                │
 *   └──────────────────────────────────────────────────────────────┘
 *   status bar    (selected path · Cancel · confirm button)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, ArrowRight, ArrowUp, ChevronRight,
  Folder, FileText, HardDrive, Monitor,
  Image, Music, Film, FileCode,
  X, Check, Loader2, Download,
  LayoutGrid, List as ListIcon,
} from 'lucide-react';

const FLASK = 'http://127.0.0.1:5000';

// ── File-type classification ───────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg', '.ico', '.heic']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma', '.opus']);
const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mkv', '.mov', '.webm', '.wmv', '.flv', '.m4v']);
const CODE_EXTS  = new Set(['.js', '.ts', '.tsx', '.jsx', '.py', '.css', '.html', '.json', '.yaml', '.yml', '.sh', '.cs', '.cpp', '.c', '.java', '.go', '.rs']);

interface Drive { name: string; path: string; [k: string]: any; }
interface Entry { name: string; path: string; size: number; is_dir: boolean; }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  mode?: 'folder' | 'file' | 'any';
  title?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1_048_576)  return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

function parentOf(path: string): string | null {
  const norm = path.replace(/[\\/]+$/, '');
  const sep  = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  if (sep <= 0) return null;
  const p = norm.slice(0, sep);
  return /^[A-Za-z]:$/.test(p) ? p + '\\' : p || null;
}

function breadcrumbsOf(path: string): { label: string; path: string }[] {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  let built = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i === 0 && /^[A-Za-z]:$/.test(p)) {
      built = p + '\\';
      crumbs.push({ label: p + '\\', path: built });
    } else {
      built = built
        ? (built.endsWith('\\') || built.endsWith('/') ? built + p : built + '\\' + p)
        : p;
      crumbs.push({ label: p, path: built });
    }
  }
  return crumbs;
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SidebarItem: React.FC<{
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}> = ({ label, icon, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-colors ${
      active
        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200'
    }`}
  >
    <span className="shrink-0">{icon}</span>
    <span className="truncate text-xs leading-snug">{label}</span>
  </button>
);

function quickIcon(name: string): React.ReactNode {
  const n = name.toLowerCase();
  if (n.includes('desktop'))  return <Monitor  className="w-3.5 h-3.5 text-slate-500" />;
  if (n.includes('download')) return <Download className="w-3.5 h-3.5 text-green-500" />;
  if (n.includes('picture') || n.includes('photo')) return <Image className="w-3.5 h-3.5 text-blue-400" />;
  if (n.includes('document')) return <FileText className="w-3.5 h-3.5 text-amber-500" />;
  if (n.includes('music'))    return <Music    className="w-3.5 h-3.5 text-purple-400" />;
  if (n.includes('video'))    return <Film     className="w-3.5 h-3.5 text-pink-400" />;
  return <Folder className="w-3.5 h-3.5 text-slate-400" />;
}

function EntryIcon({ name, isDir, size = 'sm' }: { name: string; isDir: boolean; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'w-10 h-10' : 'w-4 h-4';
  if (isDir) return <Folder className={`${cls} text-amber-400`} />;
  const ext = getExt(name);
  if (IMAGE_EXTS.has(ext)) return <Image    className={`${cls} text-blue-400`} />;
  if (AUDIO_EXTS.has(ext)) return <Music    className={`${cls} text-purple-400`} />;
  if (VIDEO_EXTS.has(ext)) return <Film     className={`${cls} text-pink-400`} />;
  if (CODE_EXTS.has(ext))  return <FileCode className={`${cls} text-green-400`} />;
  return <FileText className={`${cls} text-slate-400`} />;
}

const ImageThumb: React.FC<{ path: string; name: string }> = ({ path, name }) => {
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading');
  return (
    <div className="w-full h-full flex items-center justify-center">
      {state === 'loading' && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 animate-pulse rounded-lg" />
      )}
      <img
        src={`${FLASK}/api/tools/preview?path=${encodeURIComponent(path)}`}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover rounded-lg"
        style={{ display: state === 'err' ? 'none' : 'block' }}
        onLoad={() => setState('ok')}
        onError={() => setState('err')}
      />
      {state === 'err' && <EntryIcon name={name} isDir={false} size="lg" />}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export const FolderPickerModal: React.FC<Props> = ({
  isOpen, onClose, onSelect, mode = 'folder', title,
}) => {
  const [history,      setHistory]      = useState<string[]>([]);
  const [fwdStack,     setFwdStack]     = useState<string[]>([]);
  const [current,      setCurrent]      = useState<string | null>(null);
  const [entries,      setEntries]      = useState<Entry[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [selected,     setSelected]     = useState<Entry | null>(null);
  const [viewMode,     setViewMode]     = useState<'grid' | 'list'>('grid');
  const [addrEdit,     setAddrEdit]     = useState(false);
  const [addrInput,    setAddrInput]    = useState('');
  const [drives,       setDrives]       = useState<Drive[]>([]);
  const [pcDrives,     setPcDrives]     = useState<string[]>([]);
  const [quickAccess,  setQuickAccess]  = useState<Record<string, string>>({});

  const addrRef = useRef<HTMLInputElement>(null);

  // ── Navigate to a path ───────────────────────────────────────────────────────
  const goTo = useCallback((path: string) => {
    setCurrent(path);
    setHistory(prev => [...prev, path]);
    setFwdStack([]);
    setSelected(null);
    setAddrEdit(false);
    setAddrInput(path);
  }, []);

  const goBack = () => {
    if (history.length < 2) return;
    const next = history[history.length - 2];
    setFwdStack(f => [current!, ...f]);
    setHistory(h => h.slice(0, -1));
    setCurrent(next);
    setSelected(null);
    setAddrInput(next);
  };

  const goForward = () => {
    if (!fwdStack.length) return;
    const next = fwdStack[0];
    setFwdStack(f => f.slice(1));
    setHistory(h => [...h, next]);
    setCurrent(next);
    setSelected(null);
    setAddrInput(next);
  };

  const goUp = () => {
    if (!current) return;
    const p = parentOf(current);
    if (p) goTo(p);
  };

  // ── Load entries when current changes ────────────────────────────────────────
  useEffect(() => {
    if (!current) { setEntries([]); return; }
    setLoading(true);
    setSelected(null);
    fetch(`${FLASK}/api/drive/list?path=${encodeURIComponent(current)}`)
      .then(r => r.json())
      .then(d => {
        const list: Entry[] = (d.files || []).sort((a: Entry, b: Entry) =>
          a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );
        setEntries(list);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [current]);

  // ── Load sidebar data on open ────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setHistory([]); setFwdStack([]); setCurrent(null);
      setEntries([]); setSelected(null); setAddrEdit(false);
      return;
    }

    let local: Drive[] = [];
    try {
      const s = localStorage.getItem('knownDrives');
      if (s) { const p = JSON.parse(s); if (Array.isArray(p)) local = p; }
    } catch {}

    fetch(`${FLASK}/api/drive/registry`)
      .then(r => r.json())
      .then(d => {
        const backend: Drive[] = d.drives || [];
        const seen = new Set(local.map((x: Drive) => x.path?.toLowerCase()).filter(Boolean));
        const extra = backend.filter(x => x.path && !seen.has(x.path.toLowerCase()));
        setDrives([...local, ...extra].filter(x => x.path));
      })
      .catch(() => setDrives(local));

    fetch(`${FLASK}/api/tools/space-analyzer/drives`)
      .then(r => r.json())
      .then(d => setPcDrives(d.drives || []))
      .catch(() => setPcDrives([]));

    fetch(`${FLASK}/api/tools/user-folders`)
      .then(r => r.json())
      .then(d => setQuickAccess(d))
      .catch(() => setQuickAccess({}));
  }, [isOpen]);

  // ── Entry interaction ────────────────────────────────────────────────────────
  const handleClick = (e: Entry) => {
    if (e.is_dir) {
      goTo(e.path);
    } else if (mode !== 'folder') {
      setSelected(e);
    }
  };

  const handleDblClick = (e: Entry) => {
    if (e.is_dir) {
      goTo(e.path);
    } else if (mode !== 'folder') {
      onSelect(e.path);
      onClose();
    }
  };

  // ── Confirm ─────────────────────────────────────────────────────────────────
  const confirmPath = selected ? selected.path : current;
  const canConfirm  = mode === 'folder' ? !!current : !!selected || (mode === 'any' && !!current);

  const confirmLabel =
    selected          ? `Open "${selected.name}"` :
    mode === 'folder' ? 'Select Folder' :
    mode === 'any'    ? 'Select Folder' :
    'Open';

  const handleConfirm = () => {
    if (confirmPath) { onSelect(confirmPath); onClose(); }
  };

  // ── Address bar ──────────────────────────────────────────────────────────────
  const commitAddr = () => {
    const p = addrInput.trim();
    if (p) goTo(p);
    setAddrEdit(false);
  };

  if (!isOpen) return null;

  const crumbs = current ? breadcrumbsOf(current) : [];

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      style={{ zIndex: 9999 }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: '90vw', maxWidth: 1160, height: '87vh' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Title bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <span className="font-semibold text-sm text-slate-700 dark:text-slate-200">
            {title || (mode === 'file' ? 'Select a file' : 'Select a folder')}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Toolbar ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 shrink-0">
          <button onClick={goBack}    disabled={history.length < 2} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors" title="Back"><ArrowLeft  className="w-4 h-4" /></button>
          <button onClick={goForward} disabled={!fwdStack.length}  className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors" title="Forward"><ArrowRight className="w-4 h-4" /></button>
          <button onClick={goUp}      disabled={!current || !parentOf(current)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors" title="Up"><ArrowUp className="w-4 h-4" /></button>

          <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-0.5" />

          {/* Address bar */}
          <div
            className="flex-1 flex items-center bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 h-9 cursor-text overflow-hidden"
            onClick={() => {
              setAddrEdit(true);
              setAddrInput(current || '');
              setTimeout(() => addrRef.current?.select(), 40);
            }}
          >
            {addrEdit ? (
              <input
                ref={addrRef}
                type="text"
                value={addrInput}
                onChange={e => setAddrInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitAddr();
                  if (e.key === 'Escape') setAddrEdit(false);
                }}
                onBlur={commitAddr}
                autoFocus
                spellCheck={false}
                className="w-full text-xs font-mono bg-transparent focus:outline-none text-slate-700 dark:text-slate-200"
              />
            ) : (
              <div className="flex items-center gap-0.5 text-xs min-w-0 overflow-hidden">
                {crumbs.length === 0 && (
                  <span className="text-slate-400 italic text-xs">This PC — click to type a path</span>
                )}
                {crumbs.map((crumb, i) => (
                  <React.Fragment key={crumb.path}>
                    {i > 0 && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                    <button
                      onClick={e => { e.stopPropagation(); goTo(crumb.path); }}
                      className="px-1 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 text-slate-700 dark:text-slate-200 hover:text-blue-700 dark:hover:text-blue-300 transition-colors shrink-0 max-w-45 truncate"
                    >
                      {crumb.label}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-0.5" />

          <button
            onClick={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
            title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {viewMode === 'grid' ? <ListIcon className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
          </button>
        </div>

        {/* ── Main area ─────────────────────────────────────────────────────── */}
        <div className="flex-1 flex min-h-0">

          {/* Sidebar */}
          <div className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/60 dark:bg-slate-800/30 py-2 space-y-3">

            {Object.keys(quickAccess).length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-3 pb-1">Quick Access</p>
                {Object.entries(quickAccess).map(([name, path]) => (
                  <SidebarItem key={path} label={name} icon={quickIcon(name)} active={current === path} onClick={() => goTo(path)} />
                ))}
              </div>
            )}

            {drives.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-3 pb-1">Virtual Drives</p>
                {drives.map(d => (
                  <SidebarItem key={d.path} label={d.name || d.path} icon={<HardDrive className="w-3.5 h-3.5 text-blue-500" />} active={current === d.path} onClick={() => goTo(d.path)} />
                ))}
              </div>
            )}

            {pcDrives.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-3 pb-1">This PC</p>
                {pcDrives.map(d => (
                  <SidebarItem key={d} label={`${d}: Local Disk`} icon={<Monitor className="w-3.5 h-3.5 text-slate-500" />} active={current === `${d}:\\`} onClick={() => goTo(`${d}:\\`)} />
                ))}
              </div>
            )}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-auto min-w-0 min-h-0">

            {/* Home screen — no path selected yet */}
            {!current && (
              <div className="p-5 space-y-5">
                {drives.length > 0 && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Virtual Drives</p>
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                      {drives.map(d => (
                        <button key={d.path} onClick={() => goTo(d.path)} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-center group">
                          <HardDrive className="w-9 h-9 text-blue-500 group-hover:text-blue-600 transition-colors" />
                          <div>
                            <p className="text-xs font-medium truncate max-w-full text-slate-700 dark:text-slate-200">{d.name || d.path}</p>
                            <p className="text-[10px] text-slate-400 font-mono truncate">{d.path}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {pcDrives.length > 0 && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">This PC</p>
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                      {pcDrives.map(d => (
                        <button key={d} onClick={() => goTo(`${d}:\\`)} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-center group">
                          <Monitor className="w-9 h-9 text-slate-500 group-hover:text-slate-600 transition-colors" />
                          <div>
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{d}: Local Disk</p>
                            <p className="text-[10px] text-slate-400 font-mono">{d}:\</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {drives.length === 0 && pcDrives.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 text-slate-400 py-20">
                    <Monitor className="w-10 h-10 opacity-30" />
                    <p className="text-sm">No drives found</p>
                  </div>
                )}
              </div>
            )}

            {/* Loading */}
            {current && loading && (
              <div className="flex items-center justify-center gap-2 text-slate-400 py-20">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            )}

            {/* Empty */}
            {current && !loading && entries.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 text-slate-400 py-20">
                <Folder className="w-12 h-12 opacity-20" />
                <p className="text-sm">This folder is empty</p>
              </div>
            )}

            {/* Grid view */}
            {current && !loading && entries.length > 0 && viewMode === 'grid' && (
              <div className="p-4 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
                {entries.map(e => {
                  const isImg    = !e.is_dir && IMAGE_EXTS.has(getExt(e.name));
                  const inactive = mode === 'folder' && !e.is_dir;
                  const sel      = selected?.path === e.path;
                  return (
                    <button
                      key={e.path}
                      onClick={() => !inactive && handleClick(e)}
                      onDoubleClick={() => !inactive && handleDblClick(e)}
                      disabled={inactive}
                      className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 text-center transition-all select-none ${
                        inactive
                          ? 'opacity-25 cursor-not-allowed border-transparent'
                          : sel
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                            : 'border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <div className="relative w-18 h-18 flex items-center justify-center rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800">
                        {isImg
                          ? <ImageThumb path={e.path} name={e.name} />
                          : e.is_dir
                            ? <Folder className="w-11 h-11 text-amber-400" />
                            : <EntryIcon name={e.name} isDir={false} size="lg" />
                        }
                      </div>
                      <span className="text-[11px] text-slate-700 dark:text-slate-300 w-full leading-tight line-clamp-2 break-all">{e.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* List view */}
            {current && !loading && entries.length > 0 && viewMode === 'list' && (
              <div className="p-2">
                {/* Header */}
                <div className="grid text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-3 py-2 border-b border-slate-100 dark:border-slate-800 select-none"
                  style={{ gridTemplateColumns: '1fr 90px 70px' }}>
                  <span>Name</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Type</span>
                </div>
                {entries.map(e => {
                  const inactive = mode === 'folder' && !e.is_dir;
                  const sel      = selected?.path === e.path;
                  const ext      = getExt(e.name);
                  const isImg    = !e.is_dir && IMAGE_EXTS.has(ext);
                  return (
                    <button
                      key={e.path}
                      onClick={() => !inactive && handleClick(e)}
                      onDoubleClick={() => !inactive && handleDblClick(e)}
                      disabled={inactive}
                      className={`w-full grid items-center px-3 py-2 rounded-xl text-left transition-colors gap-3 select-none ${
                        inactive
                          ? 'opacity-25 cursor-not-allowed'
                          : sel
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                      }`}
                      style={{ gridTemplateColumns: '1fr 90px 70px' }}
                    >
                      {/* Name + icon */}
                      <span className="flex items-center gap-2.5 min-w-0">
                        {isImg ? (
                          <div className="w-7 h-7 rounded-md overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                            <ImageThumb path={e.path} name={e.name} />
                          </div>
                        ) : (
                          <EntryIcon name={e.name} isDir={e.is_dir} size="sm" />
                        )}
                        <span className="truncate text-sm">{e.name}</span>
                      </span>
                      {/* Size */}
                      <span className="text-right text-xs text-slate-400">
                        {!e.is_dir && e.size > 0 ? formatSize(e.size) : ''}
                      </span>
                      {/* Type */}
                      <span className="text-right text-xs text-slate-400">
                        {e.is_dir ? 'Folder' : ext ? ext.toUpperCase().slice(1) : 'File'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Status bar / footer ────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center gap-3 bg-slate-50/80 dark:bg-slate-800/50">
          {/* Selected path display */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-slate-600 dark:text-slate-400 truncate">
              {selected
                ? selected.path
                : current || 'Navigate to a folder to begin'
              }
            </p>
            {selected && !selected.is_dir && selected.size > 0 && (
              <p className="text-[10px] text-slate-400 mt-0.5">{formatSize(selected.size)}</p>
            )}
          </div>

          <button
            onClick={onClose}
            className="shrink-0 px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="shrink-0 flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            {confirmLabel}
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
};

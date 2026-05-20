/**
 * ToolApprovalCard — inline chat card shown when the planning agent wants to
 * run a tool requiring approval, or asks the user a question via ask_user.
 *
 * Renders as a chat bubble (no modal overlay) inside the message stream.
 *
 * Field rendering:
 *   ask_user / output   → 3-button picker: Copy (same folder) / Folder / Drive
 *   ask_user / folder   → folder browser
 *   ask_user / file     → file browser
 *   ask_user / drive    → drive letter dropdown
 *   ask_user / yesno    → Yes / No buttons
 *   ask_user / text     → free-text input
 *   driveLetter         → drive letter dropdown
 *   *folder* / *dir*    → folder browser
 *   *file* / *path*     → file browser
 *   files array         → dynamic rows with per-row file pickers
 *   string array        → tag chip input
 *   enum schema         → <select>
 *   boolean schema      → Yes / No
 *   number schema       → number input
 *   everything else     → plain text input
 */
import React, { useState, useEffect } from 'react';
import {
  AlertTriangle, Check, X, Wrench, Info,
  FolderOpen, HardDrive, ToggleLeft, ToggleRight,
  MessageSquare, Plus, FileText, Copy, Brain,
  FolderPlus, Image, Music, FileSearch,
} from 'lucide-react';
import { FolderPickerModal } from './FolderPickerModal';

const FLASK = 'http://127.0.0.1:5000';

// ── Public types ──────────────────────────────────────────────────────────────

export interface PendingTool {
  id: string;
  tool: string;
  input: Record<string, any>;
  definition: {
    name?: string;
    description?: string;
    requires_approval?: boolean;
    input_instructions?: string;
    output_description?: string;
    parameters?: {
      properties?: Record<string, {
        type?: string;
        description?: string;
        enum?: string[];
        items?: any;
      }>;
      required?: string[];
    };
  };
}

interface Props {
  tool: PendingTool;
  onApprove: (id: string, input: Record<string, any>) => void;
  onReject: (id: string) => void;
}

// ── Field kind inference ──────────────────────────────────────────────────────

type FieldKind =
  | 'hidden'
  | 'readonly'
  | 'output'
  | 'folder'
  | 'file'
  | 'drive'
  | 'yesno'
  | 'options'
  | 'enum'
  | 'number'
  | 'file_list'
  | 'tag_list'
  | 'text';

function inferKind(
  key: string,
  schema: { type?: string; enum?: string[]; items?: any } | undefined,
  isAskUser: boolean,
  askUserInputType?: string,
): FieldKind {
  if (isAskUser && key === 'question')   return 'readonly';
  if (isAskUser && key === 'input_type') return 'hidden';
  if (isAskUser && key === 'options')    return 'hidden';
  if (isAskUser && key === 'answer') {
    const t = askUserInputType ?? 'text';
    if (t === 'output')  return 'output';
    if (t === 'folder')  return 'folder';
    if (t === 'file')    return 'file';
    if (t === 'drive')   return 'drive';
    if (t === 'yesno')   return 'yesno';
    if (t === 'options') return 'options';
    return 'text';
  }

  if (schema?.type === 'boolean') return 'yesno';
  if (schema?.enum && schema.enum.length > 0) return 'enum';
  if (schema?.type === 'integer' || schema?.type === 'number') return 'number';
  if (schema?.type === 'array') {
    const k = key.toLowerCase();
    if (k === 'files' || k === 'paths' || k === 'items') return 'file_list';
    return 'tag_list';
  }

  const k = key.toLowerCase();
  if (k === 'driveletter' || k === 'drive') return 'drive';
  if (
    k.includes('folder') || k.endsWith('dir') ||
    k === 'outputpath' || k === 'sourcepath' || k === 'targetdir' ||
    k === 'sourcefolder' || k === 'outputfolder'
  ) return 'folder';
  if (k === 'filepath' || (k.includes('file') && k.includes('path'))) return 'file';

  return 'text';
}

function valueToString(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v, null, 0);
  return String(v);
}

// ── Tag list ──────────────────────────────────────────────────────────────────

const TagListInput: React.FC<{
  value: string[];
  onChange: (v: string[]) => void;
}> = ({ value, onChange }) => {
  const [draft, setDraft] = useState('');
  const tags = Array.isArray(value) ? value : [];

  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...tags, ...t.split(',').map(s => s.trim()).filter(Boolean)]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-8">
        {tags.map((tag, i) => (
          <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-mono">
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((_, idx) => idx !== i))} className="text-blue-400 hover:text-red-500 transition-colors">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs text-slate-400 italic">No items — type below and press Enter</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="e.g. .jpg, .png — press Enter to add"
          className="flex-1 text-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
        <button type="button" onClick={add} className="shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm transition-colors">
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// ── File list ─────────────────────────────────────────────────────────────────

const SUB_FIELD_META: Record<string, { label: string; type: 'text' | 'number' | 'select'; options?: string[] }> = {
  outputFormat:  { label: 'Output format', type: 'select', options: ['jpeg','png','webp','bmp','tiff','gif','obj','stl','ply','glb','gltf','fbx','dae','mp4','mp3','wav','flac','ogg','aac','pdf','docx'] },
  codec:         { label: 'Codec',         type: 'select', options: ['h264','h265'] },
  crf:           { label: 'Quality (0–51)', type: 'number' },
  maxResolution: { label: 'Max resolution', type: 'select', options: ['original','1080p','720p','480p','360p'] },
  stripAudio:    { label: 'Strip audio',   type: 'select', options: ['false','true'] },
  colormode:     { label: 'Color mode',    type: 'select', options: ['color','black_and_white'] },
  preset:        { label: 'Preset',        type: 'select', options: ['default','photo','flat','pastel'] },
};

const FileListInput: React.FC<{
  value: any[];
  onChange: (v: any[]) => void;
  onPickerRequest: (idx: number) => void;
}> = ({ value, onChange, onPickerRequest }) => {
  const items: any[] = Array.isArray(value) ? value : [];
  const extraKeys = Array.from(new Set(items.flatMap(item => Object.keys(item).filter(k => k !== 'path'))));

  const updateItem = (i: number, k: string, v: any) => {
    const updated = [...items];
    updated[i] = { ...updated[i], [k]: v };
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
          <div className="flex gap-2 items-center">
            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={item.path || ''}
              onChange={e => updateItem(i, 'path', e.target.value)}
              placeholder="File path…"
              spellCheck={false}
              className="flex-1 text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 min-w-0"
            />
            <button type="button" onClick={() => onPickerRequest(i)} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg text-xs text-slate-600 dark:text-slate-300 transition-colors">
              <HardDrive className="w-3.5 h-3.5" /> Browse
            </button>
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="shrink-0 p-1.5 text-slate-400 hover:text-red-500 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {extraKeys.map(k => {
            const meta = SUB_FIELD_META[k];
            const val = item[k] ?? '';
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-28 shrink-0">{meta?.label ?? k}</span>
                {meta?.type === 'select' && meta.options ? (
                  <select value={String(val)} onChange={e => updateItem(i, k, e.target.value)} className="flex-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                    {meta.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : meta?.type === 'number' ? (
                  <input type="number" value={val} onChange={e => updateItem(i, k, Number(e.target.value))} className="flex-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                ) : (
                  <input type="text" value={String(val)} onChange={e => updateItem(i, k, e.target.value)} className="flex-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                )}
              </div>
            );
          })}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { path: '' }])} className="w-full py-2.5 border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> Add file
      </button>
    </div>
  );
};

// ── Options picker (list of choices + free-text Other) ───────────────────────

const OptionsInput: React.FC<{
  value: string;
  options: string[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => {
  const isOther = value !== '' && !options.includes(value);
  const [customMode, setCustomMode] = useState(isOther);
  const [customText, setCustomText] = useState(isOther ? value : '');

  const selectOption = (opt: string) => {
    setCustomMode(false);
    onChange(opt);
  };

  const activateOther = () => {
    setCustomMode(true);
    onChange(customText);
  };

  return (
    <div className="space-y-2">
      {options.map((opt, i) => {
        const active = value === opt && !customMode;
        return (
          <button
            key={i}
            type="button"
            onClick={() => selectOption(opt)}
            className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-colors flex items-center gap-2.5 ${
              active
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 border-2 transition-colors ${
              active ? 'border-blue-500 bg-blue-500' : 'border-slate-300 dark:border-slate-600'
            }`} />
            {opt}
          </button>
        );
      })}

      {/* Other — free text */}
      <div>
        <button
          type="button"
          onClick={activateOther}
          className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-colors flex items-center gap-2.5 ${
            customMode
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
              : 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <span className={`w-2 h-2 rounded-full shrink-0 border-2 transition-colors ${
            customMode ? 'border-blue-500 bg-blue-500' : 'border-slate-300 dark:border-slate-600'
          }`} />
          <span className="italic">Other…</span>
        </button>
        {customMode && (
          <input
            type="text"
            value={customText}
            onChange={e => { setCustomText(e.target.value); onChange(e.target.value); }}
            placeholder="Type your answer…"
            autoFocus
            className="mt-2 w-full text-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors"
          />
        )}
      </div>
    </div>
  );
};

// ── Output picker (Copy / Folder / Drive) ─────────────────────────────────────

const OutputInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const [showPicker, setShowPicker] = useState<'folder' | 'drive' | null>(null);
  const [activeType, setActiveType] = useState<'copy' | 'folder' | 'drive' | null>(
    value === 'copy' ? 'copy' : value ? 'folder' : null,
  );

  const btnCls = (type: 'copy' | 'folder' | 'drive') =>
    `flex flex-col items-center gap-1.5 py-3.5 px-2 rounded-xl border-2 transition-colors text-center w-full ${
      activeType === type
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
        : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800'
    }`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={() => { setActiveType('copy'); onChange('copy'); }} className={btnCls('copy')}>
          <Copy className="w-5 h-5" />
          <span className="text-xs font-semibold">Copy</span>
          <span className="text-[10px] opacity-60 leading-tight">same folder</span>
        </button>
        <button type="button" onClick={() => { setActiveType('folder'); setShowPicker('folder'); }} className={btnCls('folder')}>
          <FolderOpen className="w-5 h-5" />
          <span className="text-xs font-semibold">Folder</span>
          <span className="text-[10px] opacity-60 leading-tight">select folder</span>
        </button>
        <button type="button" onClick={() => { setActiveType('drive'); setShowPicker('drive'); }} className={btnCls('drive')}>
          <HardDrive className="w-5 h-5" />
          <span className="text-xs font-semibold">Drive</span>
          <span className="text-[10px] opacity-60 leading-tight">virtual drive</span>
        </button>
      </div>

      {value && value !== 'copy' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl">
          <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate">{value}</span>
        </div>
      )}

      {showPicker && (
        <FolderPickerModal
          isOpen
          mode="folder"
          title={showPicker === 'folder' ? 'Select output folder' : 'Select virtual drive output'}
          onClose={() => setShowPicker(null)}
          onSelect={path => { onChange(path); setShowPicker(null); }}
        />
      )}
    </div>
  );
};

// ── Field renderer ────────────────────────────────────────────────────────────

interface FieldProps {
  fieldKey: string;
  value: any;
  schema?: { type?: string; description?: string; enum?: string[]; items?: any };
  kind: FieldKind;
  drives: string[];
  optionsList?: string[];
  onChange: (key: string, val: any) => void;
  onPickerOpen: (key: string, mode: 'folder' | 'file') => void;
  onFileListPickerOpen: (key: string, itemIndex: number) => void;
}

const FieldInput: React.FC<FieldProps> = ({
  fieldKey, value, schema, kind, drives, optionsList, onChange, onPickerOpen, onFileListPickerOpen,
}) => {
  const str = valueToString(value);

  switch (kind) {
    case 'hidden':  return null;

    case 'readonly':
      return (
        <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
          {str || <span className="text-slate-400 italic">(empty)</span>}
        </div>
      );

    case 'output':
      return <OutputInput value={str} onChange={v => onChange(fieldKey, v)} />;

    case 'yesno':
      return (
        <div className="flex gap-2">
          {(['yes', 'no'] as const).map(opt => {
            const active = value === true ? opt === 'yes' : value === false ? opt === 'no' : String(value).toLowerCase() === opt;
            return (
              <button key={opt} type="button" onClick={() => onChange(fieldKey, opt === 'yes')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border font-medium text-sm transition-colors ${
                  active
                    ? opt === 'yes' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-red-500 border-red-500 text-white'
                    : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}>
                {opt === 'yes' ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                {opt === 'yes' ? 'Yes' : 'No'}
              </button>
            );
          })}
        </div>
      );

    case 'enum':
      return (
        <select value={str} onChange={e => onChange(fieldKey, e.target.value)}
          className="w-full text-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors">
          {(schema?.enum ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );

    case 'drive':
      return (
        <select value={str} onChange={e => onChange(fieldKey, e.target.value)}
          className="w-full text-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors">
          <option value="">Select drive…</option>
          {drives.map(d => <option key={d} value={d}>{d}:\</option>)}
        </select>
      );

    case 'folder':
    case 'file': {
      const mode = kind === 'folder' ? 'folder' : 'file';
      return (
        <div className="flex gap-2">
          <input type="text" value={str} onChange={e => onChange(fieldKey, e.target.value)}
            placeholder={kind === 'folder' ? 'Choose a folder…' : 'Choose a file…'}
            spellCheck={false}
            className="flex-1 text-sm font-mono bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors min-w-0" />
          <button type="button" onClick={() => onPickerOpen(fieldKey, mode)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-xl text-sm text-slate-600 dark:text-slate-300 transition-colors">
            {kind === 'folder' ? <FolderOpen className="w-4 h-4" /> : <HardDrive className="w-4 h-4" />}
            Browse
          </button>
        </div>
      );
    }

    case 'options':
      return (
        <OptionsInput
          value={str}
          options={optionsList ?? []}
          onChange={v => onChange(fieldKey, v)}
        />
      );

    case 'number':
      return (
        <input type="number" value={str} onChange={e => onChange(fieldKey, Number(e.target.value))}
          className="w-full text-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors" />
      );

    case 'tag_list':
      return <TagListInput value={Array.isArray(value) ? value : []} onChange={v => onChange(fieldKey, v)} />;

    case 'file_list':
      return (
        <FileListInput
          value={Array.isArray(value) ? value : []}
          onChange={v => onChange(fieldKey, v)}
          onPickerRequest={idx => onFileListPickerOpen(fieldKey, idx)}
        />
      );

    default:
      return (
        <input type="text" value={str} onChange={e => onChange(fieldKey, e.target.value)}
          spellCheck={false}
          className="w-full text-sm font-mono bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors" />
      );
  }
};

// ── Smart Drive Build — rich file review card ─────────────────────────────────

interface SmartDriveFile {
  path: string;
  filename?: string;
  extension?: string;
  size_bytes?: number;
  type?: string;
  ai_description?: string | null;
  ai_tags?: string[];
  folder?: string | null;
}

function fileTypeIcon(type: string | undefined) {
  if (type === 'image')    return <Image    className="w-4 h-4 text-blue-400" />;
  if (type === 'audio')    return <Music    className="w-4 h-4 text-purple-400" />;
  if (type === 'document') return <FileText className="w-4 h-4 text-amber-400" />;
  return <FileSearch className="w-4 h-4 text-slate-400" />;
}

function fmtBytes(n: number | undefined): string {
  if (!n) return '';
  if (n < 1024)        return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const SmartDriveBuildApproval: React.FC<Props> = ({ tool, onApprove, onReject }) => {
  const rawFiles: SmartDriveFile[] = Array.isArray(tool.input.files) ? tool.input.files : [];

  // Enrich: add filename from path if missing
  const enriched: SmartDriveFile[] = rawFiles.map(f => ({
    ...f,
    filename: f.filename || f.path.split(/[\\/]/).pop() || f.path,
  }));

  // Collect unique folder names proposed by the agent
  const agentFolders = Array.from(new Set(enriched.map(f => f.folder || '').filter(Boolean)));

  const [driveName,   setDriveName]   = useState<string>(tool.input.driveName || 'Smart Drive');
  const [outputPath,  setOutputPath]  = useState<string>(tool.input.outputPath || '');
  const [action,      setAction]      = useState<'shortcuts' | 'move'>(tool.input.action === 'move' ? 'move' : 'shortcuts');
  const [checked,     setChecked]     = useState<boolean[]>(enriched.map(() => true));
  const [folders,     setFolders]     = useState<string[]>(enriched.map(f => f.folder || ''));
  const [extraFiles,  setExtraFiles]  = useState<SmartDriveFile[]>([]);
  const [showPicker,  setShowPicker]  = useState<'output' | 'add' | null>(null);
  const [newFilePath, setNewFilePath] = useState('');

  const allFiles = [...enriched, ...extraFiles];
  const allChecked = [...checked, ...extraFiles.map(() => true)];
  const allFolders = [...folders, ...extraFiles.map(f => f.folder || '')];

  const selectedCount = allChecked.filter(Boolean).length;

  const toggleCheck = (i: number) => {
    if (i < checked.length) {
      const next = [...checked]; next[i] = !next[i]; setChecked(next);
    }
  };

  const setFolder = (i: number, val: string) => {
    if (i < folders.length) {
      const next = [...folders]; next[i] = val; setFolders(next);
    } else {
      const ei = i - folders.length;
      const next = [...extraFiles];
      next[ei] = { ...next[ei], folder: val };
      setExtraFiles(next);
    }
  };

  const addManualFile = (path: string) => {
    if (!path) return;
    const filename = path.split(/[\\/]/).pop() || path;
    const ext = filename.includes('.') ? '.' + filename.split('.').pop()!.toLowerCase() : '';
    setExtraFiles(prev => [...prev, { path, filename, extension: ext, type: 'other', folder: '' }]);
  };

  const removeExtraFile = (ei: number) => {
    setExtraFiles(prev => prev.filter((_, idx) => idx !== ei));
  };

  const handleConfirm = () => {
    const finalFiles = allFiles
      .filter((_, i) => allChecked[i])
      .map((f, i) => ({
        path: f.path,
        folder: allFolders[allChecked.slice(0, allFiles.indexOf(f) + 1).filter(Boolean).length - 1 + allFiles.slice(0, allFiles.indexOf(f)).filter((_, j) => !allChecked[j]).length] || allFolders[allFiles.indexOf(f)] || '',
        ai_description: f.ai_description,
      }));

    // simpler: rebuild from checked indices
    const out: Array<{path: string; folder: string; ai_description?: string | null}> = [];
    allFiles.forEach((f, i) => {
      if (allChecked[i]) {
        out.push({ path: f.path, folder: allFolders[i] || '', ai_description: f.ai_description });
      }
    });

    onApprove(tool.id, {
      driveName,
      outputPath,
      action,
      files: out,
    });
  };

  return (
    <>
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-full bg-violet-600 flex items-center justify-center shrink-0">
          <Brain className="w-5 h-5 text-white" />
        </div>

        <div className="flex-1 max-w-[90%]">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-sm font-semibold">Agent</span>
            <span className="text-xs text-violet-500 dark:text-violet-400">wants to create a Smart Virtual Drive</span>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-violet-200 dark:border-violet-800/60 rounded-2xl rounded-tl-none overflow-hidden shadow-sm">

            {/* Header */}
            <div className="px-4 py-3 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-100 dark:border-violet-800/40 flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-500" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">smart_drive_build</span>
              <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                {selectedCount} / {allFiles.length} files selected
              </span>
            </div>

            <div className="px-4 py-4 space-y-4">

              {/* Drive name + output path + action */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Drive name</label>
                  <input
                    type="text"
                    value={driveName}
                    onChange={e => setDriveName(e.target.value)}
                    className="w-full text-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Save location</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={outputPath}
                      onChange={e => setOutputPath(e.target.value)}
                      placeholder="Select folder…"
                      spellCheck={false}
                      className="flex-1 text-xs font-mono bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/50 min-w-0"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPicker('output')}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-xl text-xs text-slate-600 dark:text-slate-300 transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Action selector */}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">File action</label>
                <div className="flex gap-2">
                  {(['shortcuts', 'move'] as const).map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setAction(opt)}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        action === opt
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                          : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-violet-300'
                      }`}
                    >
                      {opt === 'shortcuts' ? 'Create shortcuts' : 'Move files'}
                    </button>
                  ))}
                </div>
                {action === 'move' && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    Move will relocate the original files. This cannot be undone easily.
                  </p>
                )}
              </div>

              {/* File list */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                  Files proposed by agent
                </p>
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {allFiles.map((f, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-colors ${
                        allChecked[i]
                          ? 'border-violet-200 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-900/10'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 opacity-50'
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={() => toggleCheck(i)}
                        className={`mt-0.5 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                          allChecked[i]
                            ? 'bg-violet-600 border-violet-600'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {allChecked[i] && <Check className="w-2.5 h-2.5 text-white" />}
                      </button>

                      {/* Thumbnail or icon */}
                      {f.type === 'image' ? (
                        <img
                          src={`${FLASK}/api/tools/preview?path=${encodeURIComponent(f.path)}`}
                          alt=""
                          className="w-10 h-10 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                          {fileTypeIcon(f.type)}
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{f.filename || f.path}</p>
                        {f.ai_description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{f.ai_description}</p>
                        )}
                        <p className="text-[10px] text-slate-400 mt-0.5 font-mono truncate">{f.path}</p>
                      </div>

                      {/* Folder assignment */}
                      <div className="shrink-0 w-28">
                        <input
                          type="text"
                          value={allFolders[i]}
                          onChange={e => setFolder(i, e.target.value)}
                          placeholder="sub-folder…"
                          className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                          title="Sub-folder inside the drive (leave blank for root)"
                        />
                      </div>

                      {/* Remove extra file */}
                      {i >= enriched.length && (
                        <button
                          type="button"
                          onClick={() => removeExtraFile(i - enriched.length)}
                          className="shrink-0 p-1 text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add more files */}
                <button
                  type="button"
                  onClick={() => setShowPicker('add')}
                  className="mt-2 w-full py-2 border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-violet-400 dark:hover:border-violet-500 text-slate-500 hover:text-violet-600 dark:hover:text-violet-400 rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <FolderPlus className="w-3.5 h-3.5" /> Add more files
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-700/60">
              <button
                onClick={handleConfirm}
                disabled={selectedCount === 0 || !outputPath || !driveName}
                className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-3 rounded-xl transition-colors"
              >
                <Check className="w-4 h-4" />
                Create drive ({selectedCount} files)
              </button>
              <button
                onClick={() => onReject(tool.id)}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-sm font-medium py-2 px-3 rounded-xl transition-colors"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      {showPicker === 'output' && (
        <FolderPickerModal
          isOpen
          mode="folder"
          title="Select drive save location"
          onClose={() => setShowPicker(null)}
          onSelect={path => { setOutputPath(path); setShowPicker(null); }}
        />
      )}
      {showPicker === 'add' && (
        <FolderPickerModal
          isOpen
          mode="file"
          title="Add a file to the drive"
          onClose={() => setShowPicker(null)}
          onSelect={path => { addManualFile(path); setShowPicker(null); }}
        />
      )}
    </>
  );
};


// ── Inline approval card ──────────────────────────────────────────────────────

const GenericApprovalCard: React.FC<Props> = ({ tool, onApprove, onReject }) => {
  const [fields, setFields] = useState<Record<string, any>>({});
  const [drives, setDrives] = useState<string[]>([]);
  const [picker, setPicker] = useState<{ key: string; mode: 'folder' | 'file'; itemIndex?: number } | null>(null);

  const isAskUser = tool.tool === 'ask_user';
  const paramProps = tool.definition.parameters?.properties ?? {};

  useEffect(() => {
    setFields({ ...tool.input });
    fetch(`${FLASK}/api/tools/space-analyzer/drives`)
      .then(r => r.json())
      .then(d => setDrives(d.drives || []))
      .catch(() => setDrives(['C', 'D']));
  }, [tool.id]);

  const setField = (key: string, val: any) => setFields(prev => ({ ...prev, [key]: val }));

  const askUserInputType = isAskUser ? String(fields.input_type ?? 'text') : undefined;

  const fieldEntries = Object.entries(fields).filter(([k]) =>
    inferKind(k, paramProps[k], isAskUser, askUserInputType) !== 'hidden',
  );

  const questionText = isAskUser ? String(fields.question ?? '') : null;

  const handlePickerSelect = (path: string) => {
    if (!picker) return;
    if (picker.itemIndex !== undefined) {
      const arr = Array.isArray(fields[picker.key]) ? [...fields[picker.key]] : [];
      arr[picker.itemIndex] = { ...arr[picker.itemIndex], path };
      setField(picker.key, arr);
    } else {
      setField(picker.key, path);
    }
    setPicker(null);
  };

  return (
    <>
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
          {isAskUser
            ? <MessageSquare className="w-5 h-5 text-white" />
            : <AlertTriangle className="w-5 h-5 text-white" />
          }
        </div>

        <div className="flex-1 max-w-[80%]">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-sm font-semibold">Agent</span>
            <span className="text-xs text-orange-500 dark:text-orange-400">
              {isAskUser ? 'is asking you' : 'wants to run a tool'}
            </span>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-orange-200 dark:border-orange-800/60 rounded-2xl rounded-tl-none overflow-hidden shadow-sm">

            {!isAskUser && (
              <div className="px-4 py-3 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-800/40 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-mono font-medium text-slate-700 dark:text-slate-200">{tool.tool}</span>
              </div>
            )}

            <div className="px-4 py-4 space-y-4">
              {isAskUser && questionText && (
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
                  {questionText}
                </p>
              )}

              {!isAskUser && tool.definition.description && (
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {tool.definition.description}
                </p>
              )}

              {!isAskUser && tool.definition.input_instructions && (
                <div className="flex gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-slate-600 dark:text-slate-400">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-500" />
                  <span>{tool.definition.input_instructions}</span>
                </div>
              )}

              {fieldEntries.length > 0 && (
                <div className="space-y-4">
                  {!isAskUser && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Review &amp; adjust inputs
                    </p>
                  )}
                  {fieldEntries.map(([key, value]) => {
                    const schema = paramProps[key];
                    const kind = inferKind(key, schema, isAskUser, askUserInputType);
                    if (isAskUser && key === 'question') return null;
                    if (kind === 'hidden') return null;

                    const label = isAskUser && key === 'answer'
                      ? 'Your answer'
                      : key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

                    return (
                      <div key={key}>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          {label}
                          {schema?.description && !isAskUser && (
                            <span className="ml-1.5 font-normal text-xs text-slate-400">{schema.description}</span>
                          )}
                        </label>
                        <FieldInput
                          fieldKey={key}
                          value={value}
                          schema={schema}
                          kind={kind}
                          drives={drives}
                          optionsList={
                            isAskUser && key === 'answer' && askUserInputType === 'options'
                              ? (Array.isArray(fields.options) ? fields.options as string[] : [])
                              : undefined
                          }
                          onChange={setField}
                          onPickerOpen={(k, m) => setPicker({ key: k, mode: m })}
                          onFileListPickerOpen={(k, idx) => setPicker({ key: k, mode: 'file', itemIndex: idx })}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-700/60">
              <button
                onClick={() => onApprove(tool.id, { ...fields })}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded-xl transition-colors"
              >
                <Check className="w-4 h-4" />
                {isAskUser ? 'Submit' : 'Run tool'}
              </button>
              <button
                onClick={() => onReject(tool.id)}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-sm font-medium py-2 px-3 rounded-xl transition-colors"
              >
                <X className="w-4 h-4" />
                {isAskUser ? 'Skip' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {picker && (
        <FolderPickerModal
          isOpen
          mode={picker.mode}
          title={picker.mode === 'folder' ? 'Select a folder' : 'Select a file'}
          onClose={() => setPicker(null)}
          onSelect={handlePickerSelect}
        />
      )}
    </>
  );
};

export const ToolApprovalCard: React.FC<Props> = ({ tool, onApprove, onReject }) => {
  if (tool.tool === 'smart_drive_build') {
    return <SmartDriveBuildApproval tool={tool} onApprove={onApprove} onReject={onReject} />;
  }
  return <GenericApprovalCard tool={tool} onApprove={onApprove} onReject={onReject} />;
};

// Backward-compat alias
export const ToolApprovalModal = ToolApprovalCard;
